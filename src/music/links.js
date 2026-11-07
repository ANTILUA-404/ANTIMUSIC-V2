/**
 * Resolver link musik (Spotify / Apple Music / Deezer).
 *
 * Dua jalur:
 *  1. Kalau plugin LavaSrc aktif dan node mendukung sourcenya, URL dikirim apa
 *     adanya ke Lavalink (playlist/album/lagu lengkap).
 *  2. Kalau tidak, metadata diambil dari endpoint publik (tanpa API key) lalu
 *     dicarikan lagu yang sama di YouTube/SoundCloud.
 *
 * Jadi link Spotify/Apple tetap bisa diputar walau belum punya kredensial.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TIMEOUT = 9000;

function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(options.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

/**
 * Mengenali URL musik yang butuh perlakuan khusus.
 * @returns {{service:string, kind:"track"|"album"|"playlist"|"artist", id:string, url:string}|null}
 */
export function parseMusicLink(rawUrl) {
  const input = String(rawUrl ?? "").trim();
  if (!input) return null;

  // URI gaya Spotify: spotify:track:4cOdK2wGLETKBW3PvgPWqT
  const uriMatch = input.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/);
  if (uriMatch) {
    return { service: "spotify", kind: uriMatch[1], id: uriMatch[2], url: input };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host.endsWith("spotify.com") || host.endsWith("spotify.link")) {
    const match = path.match(/\/(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
    if (match) return { service: "spotify", kind: match[1], id: match[2], url: input };
    return null;
  }

  if (host.endsWith("music.apple.com")) {
    const songId = url.searchParams.get("i");
    if (songId && /^\d+$/.test(songId)) {
      return { service: "applemusic", kind: "track", id: songId, url: input };
    }
    const match = path.match(/\/(song|album|playlist)\/[^/]+\/(\d+)/);
    if (match) {
      return {
        service: "applemusic",
        kind: match[1] === "song" ? "track" : match[1],
        id: match[2],
        url: input,
      };
    }
    return null;
  }

  if (host.endsWith("deezer.com")) {
    const match = path.match(/\/(track|album|playlist)\/(\d+)/);
    if (match) return { service: "deezer", kind: match[1], id: match[2], url: input };
    return null;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Spotify                                                             */
/* ------------------------------------------------------------------ */

async function resolveSpotifyTrack(id) {
  // Halaman embed berisi JSON kecil dengan title + artists, tanpa API key.
  try {
    const response = await fetchWithTimeout(`https://open.spotify.com/embed/track/${id}`);
    if (response.ok) {
      const html = await response.text();
      const title = html.match(/"title":"([^"]+)","artists":\[/)?.[1];
      const artist = html.match(/"artists":\[\{"name":"([^"]+)"/)?.[1];
      if (title) return { title, artist: artist || null };
    }
  } catch {}

  // Fallback: oEmbed resmi (judul saja).
  try {
    const response = await fetchWithTimeout(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`,
    );
    if (response.ok) {
      const data = await response.json();
      if (data?.title) return { title: String(data.title), artist: null };
    }
  } catch {}

  return null;
}

/* ------------------------------------------------------------------ */
/* Apple Music                                                         */
/* ------------------------------------------------------------------ */

function cleanAppleTitle(value) {
  // "Never Gonna Give You Up by Rick Astley on Apple Music"
  const match = String(value || "").match(/^(.*?)\s+by\s+(.*?)(?:\s+on\s+Apple\s+Music)?$/i);
  if (match) return { title: match[1].trim(), artist: match[2].trim() };
  return null;
}

async function resolveAppleTrack(id) {
  // 1. iTunes Lookup API (publik, tanpa key).
  try {
    const response = await fetchWithTimeout(`https://itunes.apple.com/lookup?id=${id}&entity=song`);
    if (response.ok) {
      const data = await response.json();
      const result = data?.results?.find((item) => item.wrapperType === "track" || item.kind === "song");
      if (result?.trackName) {
        return { title: result.trackName, artist: result.artistName || null };
      }
    }
  } catch {}

  // 2. Scrape halaman lagu (og:title / <title>).
  try {
    const response = await fetchWithTimeout(`https://music.apple.com/us/song/${id}`, { redirect: "follow" });
    if (response.ok) {
      const html = await response.text();
      const og = html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1];
      const parsed = og ? cleanAppleTitle(og) : null;
      if (parsed) return parsed;

      const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1];
      if (titleTag) {
        const cleaned = titleTag
          .replace(/^\u200e/, "")
          .replace(/\s*-\s*(Song|Album|Single|EP).*$/i, "")
          .replace(/\s*-\s*Apple\s*Music.*$/i, "")
          .trim();
        const byMatch = cleaned.match(/^(.*?)\s+by\s+(.*)$/i);
        if (byMatch) return { title: byMatch[1].trim(), artist: byMatch[2].trim() };
        if (cleaned) return { title: cleaned, artist: null };
      }
    }
  } catch {}

  return null;
}

/* ------------------------------------------------------------------ */
/* Deezer                                                              */
/* ------------------------------------------------------------------ */

async function resolveDeezerTrack(id) {
  try {
    const response = await fetchWithTimeout(`https://api.deezer.com/track/${id}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.title) return { title: data.title, artist: data.artist?.name || null };
  } catch {}
  return null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ambil judul + artis dari sebuah link musik.
 * Mengembalikan null kalau tidak bisa (mis. playlist tanpa plugin).
 */
export async function resolveMusicLink(link) {
  if (!link || link.kind !== "track") return null;

  try {
    if (link.service === "spotify") return await resolveSpotifyTrack(link.id);
    if (link.service === "applemusic") return await resolveAppleTrack(link.id);
    if (link.service === "deezer") return await resolveDeezerTrack(link.id);
  } catch {}

  return null;
}

/** Nama sumber Lavalink (sourceManagers) untuk tiap prefix pencarian. */
export const SOURCE_MANAGER = {
  ytmsearch: "youtube",
  ytsearch: "youtube",
  scsearch: "soundcloud",
  spsearch: "spotify",
  amsearch: "applemusic",
  dzsearch: "deezer",
};

/** Prefix pencarian untuk tiap layanan link. */
export const SERVICE_SEARCH_PREFIX = {
  spotify: "spsearch",
  applemusic: "amsearch",
  deezer: "dzsearch",
};
