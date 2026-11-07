import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { Track } from './Track.js';

const log = createLogger('spotify');

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let cachedToken = null; // { value, expiresAt }

export const SPOTIFY_URL_RE = /^(https?:\/\/)?(open\.spotify\.com|spoti\.fi)\//i;

export function isSpotifyUrl(input) {
  return SPOTIFY_URL_RE.test(input) || /^spotify:(track|album|playlist|artist):/i.test(input);
}

function parseTarget(input) {
  const uriMatch = input.match(/^spotify:(track|album|playlist|artist):([\w]+)/i);
  if (uriMatch) return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };

  const cleaned = input.split('?')[0].replace(/\/+$/, '');
  const match = cleaned.match(/\/(track|album|playlist|artist)\/([\w]+)/i);
  if (!match) return null;
  return { type: match[1].toLowerCase(), id: match[2] };
}

/* ------------------------------ Web API path ------------------------------ */

async function getToken() {
  if (!config.spotify.enabled) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    throw new Error(`Spotify auth gagal (${response.status})`);
  }

  const json = await response.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function api(path) {
  const token = await getToken();
  if (!token) throw new Error('Kredensial Spotify belum diatur');
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Spotify API ${response.status}`);
  return response.json();
}

function toTrack(item, requester, playlist = null) {
  const artists = (item.artists || []).map((artist) => artist.name).join(', ') || item.show?.name || 'Unknown';
  const images = item.album?.images || item.images || [];
  return new Track({
    title: item.name,
    url: item.external_urls?.spotify || null,
    duration: item.duration_ms ? Math.round(item.duration_ms / 1000) : 0,
    thumbnail: images[0]?.url || null,
    author: artists,
    requester,
    source: 'spotify',
    isLive: false,
    stream: { kind: 'search', target: `${artists} - ${item.name}` },
    playlist,
  });
}

async function collectPlaylistTracks(path, requester, playlistName, limit) {
  const tracks = [];
  let next = path;
  while (next && tracks.length < limit) {
    const page = await api(next);
    for (const entry of page.items || []) {
      const item = entry?.track ?? entry;
      if (!item || item.is_local) continue;
      if (item.type && item.type !== 'track') continue;
      tracks.push(toTrack(item, requester, playlistName));
      if (tracks.length >= limit) break;
    }
    next = page.next ? page.next.replace(API, '') : null;
  }
  return tracks;
}

/* --------------------- No-credentials fallback (embed) --------------------- */

async function fetchEmbedEntity(type, id) {
  const response = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!response.ok) throw new Error(`Spotify embed ${response.status}`);

  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Struktur halaman embed Spotify berubah');

  const data = JSON.parse(match[1]);
  const entity = data.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Entity Spotify tidak ditemukan di halaman embed');
  return entity;
}

function coverOf(entity) {
  return (
    entity.coverArt?.sources?.[0]?.url ||
    entity.visualIdentity?.image?.[0]?.url ||
    entity.album?.images?.[0]?.url ||
    null
  );
}

function embedToTracks(entity, requester, limit) {
  const cover = coverOf(entity);

  if (Array.isArray(entity.trackList) && entity.trackList.length) {
    return entity.trackList.slice(0, limit).map((item) => {
      const artist = item.subtitle || 'Unknown';
      return new Track({
        title: item.title || 'Tanpa judul',
        url: item.uri?.startsWith('spotify:') ? `https://open.spotify.com/${item.uri.split(':').slice(1).join('/')}` : null,
        duration: item.duration ? Math.round(item.duration / 1000) : 0,
        thumbnail: cover,
        author: artist,
        requester,
        source: 'spotify',
        stream: { kind: 'search', target: `${artist} - ${item.title}` },
      });
    });
  }

  const artist = (entity.artists || []).map((a) => a.name).join(', ') || entity.subtitle || 'Unknown';
  return [
    new Track({
      title: entity.title || entity.name || 'Spotify track',
      url: `https://open.spotify.com/track/${entity.id}`,
      duration: entity.duration ? Math.round(entity.duration / 1000) : 0,
      thumbnail: cover,
      author: artist,
      requester,
      source: 'spotify',
      stream: { kind: 'search', target: `${artist} - ${entity.title || entity.name}` },
    }),
  ];
}

/** Last resort: public oEmbed (title only, no playlist contents). */
async function oembedFallback(input, requester) {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(input)}`, {
    headers: { 'User-Agent': BROWSER_UA },
  });
  if (!response.ok) throw new Error('Spotify oEmbed gagal, cek apakah link valid.');
  const json = await response.json();
  const title = json.title || 'Spotify track';
  const artist = json.author_name || '';
  return {
    type: 'track',
    tracks: [
      new Track({
        title,
        url: input,
        duration: 0,
        thumbnail: json.thumbnail_url || null,
        author: artist || 'Unknown',
        requester,
        source: 'spotify',
        stream: { kind: 'search', target: artist ? `${artist} - ${title}` : title },
      }),
    ],
    playlistName: null,
    warning: 'Metadata Spotify terbatas — hasil pencarian mungkin kurang akurat.',
  };
}

/* -------------------------------- Resolver -------------------------------- */

export async function resolveSpotify(input, { requester = null, limit = 100 } = {}) {
  const target = parseTarget(input);
  if (!target) throw new Error('Link Spotify tidak dikenali.');

  if (config.spotify.enabled) {
    try {
      if (target.type === 'track') {
        const item = await api(`/tracks/${target.id}`);
        return { type: 'track', tracks: [toTrack(item, requester)], playlistName: null };
      }
      if (target.type === 'album') {
        const album = await api(`/albums/${target.id}`);
        const tracks = await collectPlaylistTracks(`/albums/${target.id}/tracks?limit=50`, requester, album.name, limit);
        return {
          type: 'playlist',
          tracks,
          playlistName: `${album.name} — ${album.artists?.[0]?.name ?? ''}`.trim(),
        };
      }
      if (target.type === 'playlist') {
        const playlist = await api(`/playlists/${target.id}`);
        const tracks = await collectPlaylistTracks(`/playlists/${target.id}/tracks?limit=100`, requester, playlist.name, limit);
        return { type: 'playlist', tracks, playlistName: playlist.name };
      }
      const artist = await api(`/artists/${target.id}`);
      const top = await api(`/artists/${target.id}/top-tracks?market=US`);
      const tracks = (top.tracks || []).slice(0, limit).map((item) => toTrack(item, requester, artist.name));
      return { type: 'playlist', tracks, playlistName: `${artist.name} — Top Tracks` };
    } catch (error) {
      log.warn('Spotify API gagal, fallback ke halaman embed:', error.message);
    }
  }

  try {
    const entity = await fetchEmbedEntity(target.type, target.id);
    const tracks = embedToTracks(entity, requester, limit);
    const isCollection = Array.isArray(entity.trackList) && entity.trackList.length > 0;
    return {
      type: isCollection ? 'playlist' : 'track',
      tracks,
      playlistName: isCollection ? entity.name || entity.title : null,
      warning: isCollection
        ? 'Playlist dibaca dari halaman embed Spotify (maksimal 50 track pertama). Isi SPOTIFY_CLIENT_ID/SECRET untuk playlist penuh.'
        : undefined,
    };
  } catch (error) {
    log.warn('Spotify embed gagal, fallback ke oEmbed:', error.message);
    return oembedFallback(input, requester);
  }
}
