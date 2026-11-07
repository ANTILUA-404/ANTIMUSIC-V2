import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('yt-dlp');

export class YtdlpError extends Error {
  constructor(message, stderr = '') {
    super(message);
    this.name = 'YtdlpError';
    this.stderr = stderr;
  }
}

// NOTE: --no-playlist must NOT live here; probePlaylist needs playlists enabled.
const COMMON_ARGS = ['--no-warnings', '--no-progress', '--ignore-config'];

function extraArgs() {
  const args = [];
  // HLS/live streams are downloaded through FFmpeg, so yt-dlp must know where it is.
  // ffmpeg-static ships a binary that is NOT on PATH, hence the explicit hint.
  if (config.ffmpeg.bin) args.push('--ffmpeg-location', config.ffmpeg.bin);
  if (config.ytdlp.cookies) args.push('--cookies', config.ytdlp.cookies);
  if (config.ytdlp.proxy) args.push('--proxy', config.ytdlp.proxy);
  if (config.ytdlp.extractorArgs) args.push('--extractor-args', config.ytdlp.extractorArgs);
  return args;
}

/** Runs yt-dlp and resolves with raw stdout. */
export function runYtdlp(args, { timeout = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytdlp.bin, [...COMMON_ARGS, ...extraArgs(), ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new YtdlpError(`yt-dlp timeout setelah ${timeout}ms`, stderr));
    }, timeout);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new YtdlpError(
          error.code === 'ENOENT'
            ? `yt-dlp tidak ditemukan ("${config.ytdlp.bin}"). Install yt-dlp atau set YTDLP_PATH di .env.`
            : error.message,
          stderr,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new YtdlpError(firstErrorLine(stderr) || `yt-dlp keluar dengan kode ${code}`, stderr));
    });
  });
}

function firstErrorLine(stderr) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[') || line.includes('ERROR'));
  const errorLine = lines.find((line) => line.includes('ERROR'));
  return (errorLine || lines[lines.length - 1] || '').replace(/^ERROR:\s*/i, '').slice(0, 300);
}

const isYoutubeId = (value) => typeof value === 'string' && /^[\w-]{11}$/.test(value);

function thumbnailFor(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  const thumbs = entry.thumbnails;
  if (Array.isArray(thumbs) && thumbs.length) {
    return thumbs[thumbs.length - 1]?.url || null;
  }
  if (isYoutubeId(entry.id)) return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
  return null;
}

function entryUrl(entry) {
  if (entry.webpage_url) return entry.webpage_url;
  if (entry.url && /^https?:/.test(entry.url)) return entry.url;
  if (isYoutubeId(entry.id)) return `https://www.youtube.com/watch?v=${entry.id}`;
  return null;
}

function normalizeEntry(entry, fallbackSource = 'unknown') {
  const url = entryUrl(entry);
  if (!url) return null;
  const duration = Number(entry.duration);
  return {
    title: entry.title || entry.fulltitle || 'Tanpa judul',
    url,
    duration: Number.isFinite(duration) ? duration : 0,
    thumbnail: thumbnailFor(entry),
    author: entry.uploader || entry.channel || entry.creator || entry.artist || 'Unknown',
    isLive: Boolean(entry.is_live || entry.live_status === 'is_live'),
    source: entry.extractor_key?.toLowerCase() || entry.ie_key?.toLowerCase() || fallbackSource,
    viewCount: Number(entry.view_count) || null,
  };
}

/** Full metadata for a single URL (video / track / live stream). */
export async function probeSingle(target) {
  const stdout = await runYtdlp(['--no-playlist', '--dump-single-json', '-f', 'bestaudio/best', '--', target], { timeout: 40_000 });
  const json = JSON.parse(stdout);
  if (json._type === 'playlist' || Array.isArray(json.entries)) {
    const first = (json.entries || []).find(Boolean);
    if (!first) throw new YtdlpError('Playlist kosong atau tidak bisa dibaca.');
    const normalized = normalizeEntry(first, 'youtube');
    if (!normalized) throw new YtdlpError('Tidak ada media yang bisa diputar dari URL tersebut.');
    return { ...normalized, playlistTitle: json.title || null, entryCount: json.entries?.length || 1 };
  }
  const normalized = normalizeEntry(json, 'youtube');
  if (!normalized) throw new YtdlpError('Metadata media tidak lengkap.');
  return normalized;
}

/** Playlist / album / mix -> array of tracks (flat, fast). */
export async function probePlaylist(target, limit = 100) {
  const stdout = await runYtdlp(
    ['--yes-playlist', '--dump-single-json', '--flat-playlist', '--playlist-end', String(Math.max(1, limit)), '--', target],
    { timeout: 90_000 },
  );
  const json = JSON.parse(stdout);
  const entries = (json.entries || []).filter(Boolean);
  const tracks = entries.map((entry) => normalizeEntry(entry, 'youtube')).filter(Boolean);
  if (!tracks.length) throw new YtdlpError('Playlist tidak berisi track yang bisa diputar.');
  return { title: json.title || 'Playlist', tracks, total: json.playlist_count || tracks.length };
}

/** ytsearch -> array of results. */
export async function searchYoutube(query, limit = 5) {
  const stdout = await runYtdlp(
    ['--no-playlist', '--dump-single-json', '--flat-playlist', '--playlist-end', String(Math.max(1, limit)), `ytsearch${Math.max(1, limit)}:${query}`],
    { timeout: 40_000 },
  );
  const json = JSON.parse(stdout);
  return (json.entries || []).map((entry) => normalizeEntry(entry, 'youtube')).filter(Boolean);
}

/** Picks the best matching YouTube video for a free-text query (used by Spotify). */
export async function searchOne(query) {
  const results = await searchYoutube(query, 1);
  if (!results.length) throw new YtdlpError(`Tidak ada hasil untuk "${query}"`);
  return results[0];
}

/** YouTube "mix" based autoplay: RD<videoId> playlist. */
export async function relatedTracks(videoId, limit = 10) {
  if (!isYoutubeId(videoId)) return [];
  try {
    const { tracks } = await probePlaylist(`https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`, limit + 1);
    return tracks.filter((track) => !track.url.includes(videoId));
  } catch (error) {
    log.debug('Autoplay mix gagal:', error.message);
    return [];
  }
}

/**
 * Spawns `yt-dlp -o -` and returns the raw audio stream.
 * Piping (instead of resolving a direct URL) keeps signatures/headers valid
 * and survives YouTube's frequent format changes.
 */
export function spawnYtdlpAudio(target, { seek = 0 } = {}) {
  const args = [
    ...COMMON_ARGS,
    '--no-playlist',
    '--quiet',
    '-f',
    'bestaudio/best',
    '-o',
    '-',
    ...(seek > 0 ? ['--download-sections', `*${Math.floor(seek)}-inf`, '--force-keyframes-at-cuts'] : []),
    // Options must come BEFORE the `--` separator, otherwise they are parsed as URLs.
    ...extraArgs(),
    '--',
    target,
  ];

  const child = spawn(config.ytdlp.bin, args, { windowsHide: true });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
  });
  child.on('error', (error) => log.error('yt-dlp stream error:', error.message));

  return {
    child,
    get stderr() {
      return stderr;
    },
    kill() {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    },
  };
}

export async function ytdlpVersion() {
  try {
    const stdout = await runYtdlp(['--version'], { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}
