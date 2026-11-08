import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root. */
export const ROOT = path.resolve(__dirname, '..');

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const binDir = path.join(ROOT, 'bin');
const localYtdlp = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const localFfmpeg = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

/**
 * Resolution order for yt-dlp:
 *   1. YTDLP_PATH in .env
 *   2. ./bin/yt-dlp  (auto-downloaded by scripts/install-ytdlp.js on first boot)
 *   3. `yt-dlp` from PATH
 */
function resolveYtdlp() {
  const fromEnv = process.env.YTDLP_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(localYtdlp)) return localYtdlp;
  return 'yt-dlp';
}

/**
 * Resolution order for FFmpeg:
 *   1. FFMPEG_PATH in .env
 *   2. ./bin/ffmpeg  (auto-downloaded; tidak lagi bergantung pada install
 *      script npm `ffmpeg-static` yang diblokir npm 11.7+)
 *   3. `ffmpeg` from PATH
 */
function resolveFfmpeg() {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(localFfmpeg)) return localFfmpeg;
  return 'ffmpeg';
}

/** IDLE_DESTROY_MS (v2) is accepted as an alias so old .env files keep working. */
function idleLeaveSeconds() {
  if (process.env.IDLE_LEAVE_SECONDS !== undefined && process.env.IDLE_LEAVE_SECONDS !== '') {
    return toNumber(process.env.IDLE_LEAVE_SECONDS, 60);
  }
  if (process.env.IDLE_DESTROY_MS !== undefined && process.env.IDLE_DESTROY_MS !== '') {
    return Math.round(toNumber(process.env.IDLE_DESTROY_MS, 60_000) / 1000);
  }
  return 60;
}

export const config = {
  token: process.env.DISCORD_TOKEN?.trim() || '',
  clientId: process.env.CLIENT_ID?.trim() || '',
  /** Optional: register slash commands to a single guild (instant, great for dev). */
  guildId: process.env.GUILD_ID?.trim() || null,

  paths: {
    root: ROOT,
    dataDir: path.join(ROOT, 'data'),
    binDir,
  },

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID?.trim() || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET?.trim() || '',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  ytdlp: {
    bin: resolveYtdlp(),
    /** Download yt-dlp into ./bin when the binary is missing (Pterodactyl friendly). */
    autoInstall: toBool(process.env.YTDLP_AUTO_INSTALL, true),
    /** Netscape cookie file, useful for age-restricted / members-only content. */
    cookies: process.env.YTDLP_COOKIES?.trim() || null,
    proxy: process.env.YTDLP_PROXY?.trim() || null,
    /** Extractor args, e.g. "youtube:player_client=web,android" */
    extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS?.trim() || null,
  },

  ffmpeg: {
    bin: resolveFfmpeg(),
    /** 48kHz stereo PCM as required by Discord voice. */
    sampleRate: 48_000,
    channels: 2,
    bitrate: '128k',
  },

  defaults: {
    volume: Math.min(200, Math.max(0, toNumber(process.env.DEFAULT_VOLUME, 80))),
    maxQueue: toNumber(process.env.MAX_QUEUE_SIZE, 500),
    /** Auto-leave the voice channel after this many seconds of silence. */
    idleLeaveSeconds: idleLeaveSeconds(),
    /** How many results to show in the search picker. */
    searchResults: Math.min(10, Math.max(1, toNumber(process.env.SEARCH_RESULTS, 5))),
    /** Keep playing related tracks when the queue runs out. */
    autoplay: toBool(process.env.AUTOPLAY ?? process.env.AUTOPLAY_DEFAULT, false),
    /** Default loop mode: off | track | queue */
    loop: ['off', 'track', 'queue'].includes(process.env.DEFAULT_LOOP) ? process.env.DEFAULT_LOOP : 'off',
  },

  radio: {
    /** Reconnect backoff for a dropped 24/7 stream. */
    retryDelayMs: toNumber(process.env.RADIO_RETRY_DELAY_MS, 5_000),
    maxRetries: toNumber(process.env.RADIO_MAX_RETRIES, 10),
    /** Rejoin saved 24/7 sessions after a restart. */
    restoreOnBoot: toBool(process.env.RADIO_RESTORE_ON_BOOT, true),
  },

  /** HTTP health endpoint - Pterodactyl sets SERVER_PORT automatically. */
  health: {
    port: toNumber(process.env.SERVER_PORT ?? process.env.HEALTH_PORT, 0),
  },

  /** Server licence gating (same behaviour as ANTIMUSIC v2). */
  whitelist: {
    enabled: toBool(process.env.WHITELIST_ENABLED, false),
    guildIds: String(process.env.WHITELIST_GUILD_IDS ?? '')
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value) => /^\d{15,25}$/.test(value)),
    ownerUsername: process.env.OWNER_USERNAME?.trim() || 'owner',
    ownerUserId: process.env.OWNER_USER_ID?.trim() || '',
    leaveUnauthorized: toBool(process.env.WHITELIST_LEAVE_UNAUTHORIZED, true),
    notifyCooldownMs: toNumber(process.env.WHITELIST_NOTIFY_COOLDOWN_MS, 10_000),
  },

  embed: {
    color: process.env.EMBED_COLOR || '#5865F2',
    success: '#57F287',
    error: '#ED4245',
    warn: '#FEE75C',
  },

  dataDir: path.join(ROOT, 'data'),
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function assertRuntimeConfig() {
  const problems = [];
  if (!config.token) problems.push('DISCORD_TOKEN belum diisi di file .env');
  if (!config.clientId) problems.push('CLIENT_ID belum diisi di file .env');
  return problems;
}
