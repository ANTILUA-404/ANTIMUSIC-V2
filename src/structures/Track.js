import { searchOne } from '../utils/ytdlp.js';

/**
 * A single playable item.
 *
 * stream.kind:
 *  - 'ytdlp'  -> feed the page URL to yt-dlp (YouTube, SoundCloud, Bandcamp, Vimeo, Twitch, ...)
 *  - 'url'    -> hand the URL straight to FFmpeg (radio / direct audio files / HLS)
 *  - 'search' -> unresolved Spotify item, resolved to YouTube on first play
 */
export class Track {
  constructor({
    title,
    url = null,
    duration = 0,
    thumbnail = null,
    author = 'Unknown',
    requester = null,
    source = 'unknown',
    isLive = false,
    stream = null,
    playlist = null,
    encoded = null,
  }) {
    this.title = title;
    this.url = url;
    this.duration = Number.isFinite(duration) ? duration : 0;
    this.thumbnail = thumbnail;
    this.author = author;
    this.requester = requester;
    this.source = source;
    this.isLive = Boolean(isLive) || this.duration === 0;
    this.stream = stream;
    this.playlist = playlist;
    /** base64 track Lavalink (diisi setelah resolve pertama, biar tidak cari ulang) */
    this.encoded = encoded;
    this.addedAt = Date.now();
  }

  get isStream() {
    return this.isLive || this.duration === 0;
  }

  get identifier() {
    return this.url || this.stream?.target || this.title;
  }

  /** Spotify items only carry metadata, so we look up the audio on YouTube once. */
  async ensurePlayable() {
    if (this.stream?.kind !== 'search') return this;
    const match = await searchOne(this.stream.target);
    this.url = this.url || match.url;
    this.stream = { kind: 'ytdlp', target: match.url };
    if (!this.duration) this.duration = match.duration || 0;
    if (!this.thumbnail) this.thumbnail = match.thumbnail;
    this.resolvedFrom = match.url;
    return this;
  }

  static fromYtdlp(data, requester, playlist = null) {
    return new Track({
      title: data.title,
      url: data.url,
      duration: data.duration,
      thumbnail: data.thumbnail,
      author: data.author,
      requester,
      source: data.source || 'youtube',
      isLive: data.isLive,
      stream: { kind: 'ytdlp', target: data.url },
      playlist,
    });
  }

  /**
   * Dari hasil pencarian Lavalink. `encoded` ikut disimpan supaya pemutaran
   * berikutnya (loop/replay) tidak perlu query ke node lagi.
   */
  static fromLavalink(lavalinkTrack, requester, playlist = null) {
    const info = lavalinkTrack?.info ?? {};
    const isStream = Boolean(info.isStream) || info.duration === 0;
    return new Track({
      title: info.title ?? 'Tanpa judul',
      url: info.uri ?? null,
      duration: isStream ? 0 : Math.round((info.duration ?? 0) / 1000),
      thumbnail: info.artworkUrl ?? null,
      author: info.author ?? 'Unknown',
      requester,
      source: info.sourceName ?? 'lavalink',
      isLive: isStream,
      stream: { kind: 'lavalink', target: info.uri ?? info.identifier ?? null },
      playlist,
      encoded: lavalinkTrack?.encoded ?? null,
    });
  }

  static fromDirectUrl(url, { title, requester, source = 'direct', isLive = true } = {}) {
    return new Track({
      title: title || url.split('/').pop() || 'Stream',
      url,
      duration: 0,
      thumbnail: null,
      author: source,
      requester,
      source,
      isLive,
      stream: { kind: 'url', target: url },
    });
  }

  toJSON() {
    return {
      title: this.title,
      url: this.url,
      duration: this.duration,
      thumbnail: this.thumbnail,
      author: this.author,
      source: this.source,
      isLive: this.isLive,
      stream: this.stream,
    };
  }

  static fromJSON(json, requester = null) {
    return new Track({ ...json, requester });
  }
}
