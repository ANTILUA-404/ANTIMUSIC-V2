import { EventEmitter } from 'node:events';
import { LavalinkManager } from 'lavalink-client';
import { config } from '../config.js';
import { isSpotifyUrl, resolveSpotify } from '../structures/Spotify.js';
import { Track } from '../structures/Track.js';
import { createLogger } from '../utils/logger.js';
import { FILTERS } from './filters.js';
import { waitForLavalink } from './lavalink-node.js';

const log = createLogger('engine:lavalink');

/** Batasi promise yang bisa menggantung (mis. manager.init() saat node belum siap). */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} tidak selesai dalam ${Math.round(ms / 1000)}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Engine Lavalink (node eksternal, mis. Railway).
 *
 * Queue tetap dipegang GuildPlayer; Lavalink hanya memutar SATU track pada satu
 * waktu (`clientTrack` / `encoded`). Jadi perilaku /queue, loop, radio 24/7 dan
 * autoplay identik dengan engine lokal.
 *
 * Keuntungan dibanding engine lokal:
 * - decoding + encoding Opus dilakukan server (CPU bot ~0)
 * - filter DSP asli (equalizer, timescale, rotation, karaoke, lowpass)
 * - `opusEncodingQuality: 10` di sisi Lavalink (kualitas opus maksimal)
 * - sumber tambahan lewat plugin (Spotify/Deezer mirroring kalau kredensial diisi)
 */
export class LavalinkEngine extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.name = 'lavalink';
    this.ready = false;
    this.manager = null;
    this.filters = new Map(); // guildId -> nama filter aktif
  }

  /* --------------------------------- setup -------------------------------- */

  async init() {
    const { nodes, searchSource, connectTimeoutMs, startupWaitMs } = config.audio.lavalink;

    // 1. Preflight HTTP. Node yang belum boot (Railway cold start 30-120s) TIDAK
    //    boleh langsung diserahkan ke lavalink-client: `manager.init()` bisa
    //    menggantung karena retry internalnya, lalu fallback lokal tidak jalan.
    //    Di sini kita juga menangkap balasan non-JSON ("Proxy error") dengan
    //    pesan yang jelas, bukan `SyntaxError: Unexpected token 'P'`.
    await waitForLavalink(nodes, { timeoutMs: startupWaitMs, log });

    this.manager = new LavalinkManager({
      nodes,
      sendToShard: (guildId, payload) => this.client.guilds.cache.get(guildId)?.shard?.send(payload),
      client: { id: this.client.user.id, username: this.client.user.username },
      // Kita yang mengatur antrian, jadi jangan biarkan library auto-skip.
      autoSkip: false,
      autoMove: true,
      playerOptions: {
        defaultSearchPlatform: searchSource,
        volumeDecrementer: 1,
        applyVolumeAsFilter: false,
        onDisconnect: { autoReconnect: true, destroyPlayer: false },
        onEmptyQueue: { destroyAfterMs: 0 },
      },
      queueOptions: { maxPreviousTracks: 5 },
    });

    this.#bindEvents();

    try {
      await withTimeout(
        this.manager.init({ id: this.client.user.id, username: this.client.user.username }),
        connectTimeoutMs,
        'LavalinkManager.init',
      );
    } catch (error) {
      // Jangan tinggalkan retry internal library jalan di belakang layar.
      await this.dispose().catch(() => {});
      throw error;
    }

    await this.#waitForNode(connectTimeoutMs);

    this.ready = true;
    log.info(`Lavalink siap: ${this.#nodeSummary()}`);
    return this;
  }

  #bindEvents() {
    const manager = this.manager;
    const lastErrorAt = new Map();

    manager.nodeManager.on('connect', (node) => log.info(`node "${node.id}" tersambung (${node.options.host}:${node.options.port})`));
    manager.nodeManager.on('disconnect', (node, reason) => log.warn(`node "${node.id}" terputus: ${reason ?? 'unknown'}`));
    manager.nodeManager.on('error', (node, error) => {
      // Satu error per 15 detik per node: cukup untuk diagnosa, tidak membanjiri log.
      const now = Date.now();
      if (now - (lastErrorAt.get(node.id) ?? 0) < 15_000) return;
      lastErrorAt.set(node.id, now);
      log.warn(`node "${node.id}" error: ${error?.message ?? error}`);
    });

    manager.on('trackEnd', (player, track, payload) => {
      // 'replaced' = kita sendiri yang mengganti track -> jangan lanjut antrian.
      if (payload?.reason === 'replaced') return;
      this.emit('trackEnd', player.guildId, payload?.reason ?? 'finished');
    });

    manager.on('trackStuck', (player, track, payload) => {
      log.warn(`[${player.guildId}] track stuck ${payload?.thresholdMs ?? '?'}ms: ${track?.info?.title ?? '-'}`);
      this.emit('trackEnd', player.guildId, 'stuck');
    });

    manager.on('trackError', (player, track, payload) => {
      const message = payload?.exception?.message ?? 'track error';
      log.warn(`[${player.guildId}] track error: ${message}`);
      this.emit('error', player.guildId, new Error(message));
      this.emit('trackEnd', player.guildId, 'error');
    });

    manager.on('playerDisconnect', (player) => this.emit('disconnect', player.guildId));
  }

  async #waitForNode(timeoutMs) {
    const started = Date.now();
    const nodes = () => [...this.manager.nodeManager.nodes.values()];

    while (Date.now() - started < timeoutMs) {
      // `connected` saja belum cukup: REST /v4/info harus sudah terbaca,
      // kalau belum, player.search akan gagal dengan "No Lavalink Node was provided".
      if (nodes().some((node) => node.connected && node.info)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const reasons = nodes()
      .map((node) => `${node.id}: ${node.connected ? (node.info ? 'ok' : 'REST belum siap') : 'tidak tersambung'}`)
      .join(', ');
    throw new Error(
      `node tidak siap dalam ${Math.round(timeoutMs / 1000)}s (${reasons || 'tidak ada node'}) — ` +
        'cek LAVALINK_PASSWORD dan port; lihat log "Lavalink belum siap" di atas untuk detail',
    );
  }

  #nodeSummary() {
    return [...this.manager.nodeManager.nodes.values()]
      .map((node) => `${node.id}@${node.options.host}:${node.options.port}${node.connected ? '' : ' (offline)'}`)
      .join(', ');
  }

  /** Dipakai saat init gagal, supaya timer reconnect tidak menggantung. */
  async dispose() {
    this.ready = false;
    try {
      for (const node of this.manager?.nodeManager?.nodes?.values?.() ?? []) {
        node.destroy('dispose', true);
      }
    } catch {
      /* ignore */
    }
  }

  status() {
    const nodes = this.manager
      ? [...this.manager.nodeManager.nodes.values()].map((node) => ({
          id: node.id,
          host: `${node.options.host}:${node.options.port}`,
          secure: Boolean(node.options.secure),
          connected: Boolean(node.connected),
          players: node.stats?.playingPlayers ?? null,
          cpu: node.stats?.cpu?.lavalinkLoad ?? null,
        }))
      : [];

    return {
      name: this.name,
      ready: this.ready,
      guilds: this.manager?.players?.size ?? 0,
      nodes,
      detail: nodes.length ? this.#nodeSummary() : 'belum terhubung',
    };
  }

  /** Teruskan VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE ke Lavalink. */
  handleRaw(data) {
    if (!this.manager) return;
    if (data?.t !== 'VOICE_STATE_UPDATE' && data?.t !== 'VOICE_SERVER_UPDATE') return;
    this.manager.sendRawData(data).catch((error) => log.debug(`sendRawData: ${error.message}`));
  }

  /* ------------------------------ connection ----------------------------- */

  async #playerFor(guild, channel) {
    let player = this.manager.getPlayer(guild.id);

    if (player && player.voiceChannelId && channel && player.voiceChannelId !== channel.id) {
      log.info(`[${guild.id}] pindah voice channel, player dibuat ulang`);
      await player.destroy('pindah voice channel');
      player = null;
    }

    if (!player) {
      player = this.manager.createPlayer({
        guildId: guild.id,
        voiceChannelId: channel?.id,
        textChannelId: guild.systemChannelId ?? undefined,
        selfDeaf: true,
        selfMute: false,
        volume: 100,
      });
    }

    if (!player.connected) await player.connect();
    return player;
  }

  async ensureConnected(guild, channel) {
    await this.#playerFor(guild, channel);
  }

  /* ------------------------------- playback ------------------------------ */

  async play(guild, track, { seek = 0 } = {}) {
    const player = await this.#playerFor(guild, guild.members.me?.voice?.channel);

    const resolved = await this.#resolve(player, track);
    const options = {};
    if (seek > 0) options.position = Math.floor(seek * 1000);

    if (resolved?.encoded && !resolved?.info) {
      // encoded yang sudah di-cache dari pemutaran sebelumnya
      options.track = { encoded: resolved.encoded, requester: track.requester ?? undefined };
    } else {
      options.clientTrack = resolved;
    }

    await player.play(options);
    return track;
  }

  async #resolve(player, track) {
    if (track.encoded) return { encoded: track.encoded };

    // Track hasil resolver Spotify tidak punya URL -> cari pakai judul.
    const isSearch = track.stream?.kind === 'search';
    const query = isSearch ? track.stream.target : track.url || track.stream?.target;
    if (!query) throw new Error(`Track "${track.title}" tidak punya sumber yang bisa diputar.`);

    const result = await player.search(
      { query, source: isSearch ? config.audio.lavalink.searchSource : undefined },
      track.requester ? { id: track.requester } : { id: 'unknown' },
    );

    const found = result?.tracks?.[0];
    if (!found) {
      throw new Error(`Tidak ada hasil Lavalink untuk "${track.title}"`);
    }

    track.encoded = found.encoded;
    if (!track.duration && found.info?.duration) track.duration = Math.round(found.info.duration / 1000);
    return found;
  }

  /* -------------------------------- resolve ------------------------------ */

  #anyNode() {
    const node = [...this.manager.nodeManager.nodes.values()].find((n) => n.connected && n.info);
    if (!node) throw new Error('Belum ada node Lavalink yang siap. Coba /engine status.');
    return node;
  }

  /**
   * Resolver untuk /play.
   *
   * Semua pencarian dilakukan oleh Lavalink, jadi dengan engine ini bot TIDAK
   * membutuhkan yt-dlp sama sekali (yt-dlp hanya dipakai engine lokal).
   */
  async resolve(input, { requester = null, limit = 100 } = {}) {
    const query = String(input || '').trim();
    if (!query) throw new Error('Query-nya kosong.');

    // Spotify tetap lewat resolver kita (metadata), audio dicarikan Lavalink.
    if (isSpotifyUrl(query)) {
      const resolved = await resolveSpotify(query, { requester, limit });
      return {
        type: resolved.type,
        tracks: resolved.tracks,
        playlistName: resolved.playlistName,
        warning: resolved.warning,
      };
    }

    const node = this.#anyNode();
    const isLink = /^https?:\/\//i.test(query);
    const result = await node.search(
      { query, source: isLink ? undefined : config.audio.lavalink.searchSource },
      requester ? { id: requester } : { id: 'unknown' },
    );

    const tracks = result?.tracks ?? [];
    if (!tracks.length) throw new Error(`Tidak ada hasil untuk "${query}".`);

    if (result.loadType === 'playlist') {
      return {
        type: 'playlist',
        tracks: tracks.slice(0, limit).map((t) => Track.fromLavalink(t, requester, result.playlistInfo?.name ?? null)),
        playlistName: result.playlistInfo?.name ?? 'Playlist',
      };
    }

    if (isLink) {
      return { type: 'track', tracks: [Track.fromLavalink(tracks[0], requester)] };
    }

    return {
      type: 'search',
      query,
      tracks: tracks.slice(0, limit).map((t) => Track.fromLavalink(t, requester)),
    };
  }

  /** Lagu terkait untuk autoplay, tanpa yt-dlp (pakai YouTube Mix). */
  async related(videoId, limit = 5) {
    try {
      const node = this.#anyNode();
      const result = await node.search(
        { query: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}` },
        { id: 'autoplay' },
      );
      return (result?.tracks ?? [])
        .filter((track) => track.info?.identifier !== videoId)
        .slice(0, limit)
        .map((track) => Track.fromLavalink(track, null, 'Autoplay'));
    } catch (error) {
      log.warn(`autoplay gagal: ${error.message}`);
      return [];
    }
  }

  /* ------------------------------- controls ------------------------------ */

  async pause(guildId) {
    const player = this.manager.getPlayer(guildId);
    if (!player) throw new Error('Nggak ada yang sedang diputar.');
    if (player.paused) throw new Error('Lagu sudah di-pause.');
    await player.pause();
  }

  async resume(guildId) {
    const player = this.manager.getPlayer(guildId);
    if (!player?.paused) throw new Error('Lagu tidak sedang di-pause.');
    await player.resume();
  }

  async stop(guildId) {
    const player = this.manager.getPlayer(guildId);
    if (!player) return;
    await player.stopPlaying(true, false);
  }

  async destroy(guildId) {
    const player = this.manager.getPlayer(guildId);
    this.filters.delete(guildId);
    if (!player) return;
    await player.destroy('destroy').catch(() => {});
  }

  async setVolume(guildId, volume) {
    const player = this.manager.getPlayer(guildId);
    if (player) await player.setVolume(volume);
    return volume;
  }

  async seek(guildId, milliseconds) {
    const player = this.manager.getPlayer(guildId);
    if (!player) throw new Error('Nggak ada yang sedang diputar.');
    await player.seek(milliseconds);
  }

  async setFilter(guildId, name) {
    const player = this.manager.getPlayer(guildId);
    if (!player) return name;
    const preset = FILTERS[name];
    if (!preset?.lavalink) return name;
    await preset.lavalink(player.filterManager);
    this.filters.set(guildId, name);
    return name;
  }

  /* -------------------------------- state -------------------------------- */

  isPlaying(guildId) {
    return Boolean(this.manager?.getPlayer(guildId)?.playing);
  }

  isPaused(guildId) {
    return Boolean(this.manager?.getPlayer(guildId)?.paused);
  }

  position(guildId) {
    const player = this.manager?.getPlayer(guildId);
    return player?.position ?? 0;
  }

  guildStatus(guildId) {
    const player = this.manager?.getPlayer(guildId);
    return {
      engine: this.name,
      connected: Boolean(player?.connected),
      playing: Boolean(player?.playing),
      paused: Boolean(player?.paused),
      position: player?.position ?? 0,
      node: player?.node?.id ?? null,
    };
  }
}

export default LavalinkEngine;
