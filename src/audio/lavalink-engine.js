import { EventEmitter } from 'node:events';
import { LavalinkManager } from 'lavalink-client';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { FILTERS } from './filters.js';

const log = createLogger('engine:lavalink');

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
    const { nodes, searchSource, connectTimeoutMs } = config.audio.lavalink;

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
    await this.manager.init({ id: this.client.user.id, username: this.client.user.username });
    await this.#waitForNode(connectTimeoutMs);

    this.ready = true;
    log.info(`Lavalink siap: ${this.#nodeSummary()}`);
    return this;
  }

  #bindEvents() {
    const manager = this.manager;

    manager.nodeManager.on('connect', (node) => log.info(`node "${node.id}" tersambung (${node.options.host}:${node.options.port})`));
    manager.nodeManager.on('disconnect', (node, reason) => log.warn(`node "${node.id}" terputus: ${reason ?? 'unknown'}`));
    manager.nodeManager.on('error', (node, error) => log.error(`node "${node.id}" error: ${error?.message ?? error}`));

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
    throw new Error(`Lavalink tidak bisa dihubungi dalam ${Math.round(timeoutMs / 1000)}s (${reasons || 'tidak ada node'})`);
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
