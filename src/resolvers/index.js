import { config } from '../config.js';
import { Track } from '../structures/Track.js';
import { isSpotifyUrl, resolveSpotify } from '../structures/Spotify.js';
import { probePlaylist, probeSingle, searchYoutube } from '../utils/ytdlp.js';

const DIRECT_AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)(\?|$)/i;
const LIVE_STREAM_RE = /\.(pls|m3u8?)(\?|$)|:\d{2,5}\/(?:stream|;|live)/i;
const PLAYLIST_HINTS = [/[?&]list=/i, /\/sets\//i, /\/album\//i, /\/playlist\//i];

const isUrl = (input) => /^https?:\/\//i.test(input) || /^spotify:/i.test(input);

/**
 * Turns any user input into a normalized resolution result.
 * @returns {Promise<{type:'track'|'playlist'|'search', tracks: Track[], playlistName?: string, warning?: string}>}
 */
export async function resolveQuery(input, { requester = null, limit = 100 } = {}) {
  const query = String(input || '').trim();
  if (!query) throw new Error('Query-nya kosong.');

  if (!isUrl(query)) {
    const results = await searchYoutube(query, config.defaults.searchResults);
    if (!results.length) throw new Error(`Tidak ada hasil untuk "${query}".`);
    return { type: 'search', tracks: results.map((item) => Track.fromYtdlp(item, requester)), query };
  }

  if (isSpotifyUrl(query)) {
    const resolved = await resolveSpotify(query, { requester, limit });
    return {
      type: resolved.type,
      tracks: resolved.tracks,
      playlistName: resolved.playlistName,
      warning: resolved.warning,
    };
  }

  // Icecast / HLS / .pls radio endpoints -> FFmpeg reads them directly.
  if (LIVE_STREAM_RE.test(query) && !/(youtube|youtu\.be|soundcloud)/i.test(query)) {
    return { type: 'track', tracks: [Track.fromDirectUrl(query, { requester, source: 'radio' })] };
  }

  if (DIRECT_AUDIO_RE.test(query)) {
    return { type: 'track', tracks: [Track.fromDirectUrl(query, { requester, source: 'direct', isLive: false })] };
  }

  if (PLAYLIST_HINTS.some((pattern) => pattern.test(query))) {
    try {
      const playlist = await probePlaylist(query, limit);
      return {
        type: 'playlist',
        tracks: playlist.tracks.map((item) => Track.fromYtdlp(item, requester, playlist.title)),
        playlistName: playlist.title,
      };
    } catch {
      // Not a playlist after all - fall through to single-item probing.
    }
  }

  const data = await probeSingle(query);
  return {
    type: 'track',
    tracks: [Track.fromYtdlp(data, requester, data.playlistTitle || null)],
  };
}
