import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { relatedTracks } from '../utils/ytdlp.js';
import { UserError } from '../utils/guards.js';
import { stationToTrack } from './RadioStore.js';
import { Track } from './Track.js';

const log = createLogger('player');

/**
 * Antrian + kontrol per-guild.
 *
 * Player ini TIDAK tahu engine mana yang dipakai: semua pemutaran didelegasikan
 * ke `client.audioEngine` (Lavalink atau lokal). Queue, loop, radio 24/7,
 * autoplay, dan idle-leave tetap sama di kedua engine.
 */
export class GuildPlayer {
  constructor(client, guild) {
    this.client = client;
    this.guild = guild;

    this.queue = [];
    this.current = null;
    this.volume = config.defaults.volume;
    this.loop = config.defaults.loop;
    this.autoplay = config.defaults.autoplay;
    this.filter = 'none';
    this.radio = null;

    this._channel = null;
    this._advancing = false;
    this._idleTimer = null;
    this._retryTimer = null;
    this._radioRetries = 0;
    this._ignoreEndUntil = 0;
    /** Jendela abaikan event trackEnd setelah pergantian track (ms). */
    this._ignoreEndMs = 1500;
    this._startedAt = 0;
    this._destroyed = false;
    this._bound = false;
  }

  get engine() {
    return this.client.audioEngine;
  }

  get voiceChannel() {
    return this.guild.members.me?.voice?.channel ?? null;
  }

  get connected() {
    return Boolean(this.engine?.guildStatus(this.guild.id)?.connected);
  }

  get playing() {
    return Boolean(this.engine?.isPlaying(this.guild.id));
  }

  get paused() {
    return Boolean(this.engine?.isPaused(this.guild.id));
  }

  /** Posisi lagu dalam DETIK. */
  get elapsed() {
    return (this.engine?.position(this.guild.id) ?? 0) / 1000;
  }

  /* ------------------------------ engine wiring --------------------------- */

  #ensureBound() {
    if (this._bound) return;
    const engine = this.engine;
    if (!engine) return;

    engine.on('trackEnd', (guildId) => {
      if (guildId === this.guild.id) this.#onTrackEnd();
    });

    engine.on('error', (guildId, error) => {
      if (guildId === this.guild.id) log.warn(`[${this.guild.id}] engine: ${error?.message ?? error}`);
    });

    engine.on('disconnect', (guildId) => {
      if (guildId !== this.guild.id) return;
      log.warn(`[${this.guild.id}] voice terputus`);
      if (this.radio) this.#scheduleRadioRetry();
    });

    this._bound = true;
  }

  async #ready() {
    this.#ensureBound();
    await this.client.ensureEngine();
    this.#ensureBound();
    if (!this.engine) throw new UserError('Engine audio belum siap, coba lagi sebentar.');
    return this.engine;
  }

  /* ------------------------------- connection ---------------------------- */

  async join(channel) {
    const engine = await this.#ready();
    this._channel = channel;
    await engine.ensureConnected(this.guild, channel);
    this.#clearIdleTimer();
  }

  /* ------------------------------- playback ------------------------------ */

  async enqueue(tracks, { next = false } = {}) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (!list.length) return 0;

    if (this.queue.length + list.length > config.defaults.maxQueue) {
      throw new UserError(`Queue penuh (maksimal ${config.defaults.maxQueue} track).`);
    }

    if (next) this.queue.unshift(...list);
    else this.queue.push(...list);

    if (!this.current && !this.playing) await this.playNext();
    return list.length;
  }

  async playNext() {
    if (this._advancing) return;
    this._advancing = true;
    try {
      this.#clearIdleTimer();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        let track = this.#takeNext();

        if (!track && this.autoplay && !this.radio) {
          const auto = await this.#fetchAutoplay();
          if (auto.length) {
            this.queue.push(...auto);
            track = this.#takeNext();
          }
        }

        if (!track) break;

        try {
          await this.startTrack(track);
          return;
        } catch (error) {
          log.warn(`[${this.guild.id}] gagal memutar "${track.title}": ${error.message}`);
        }
      }

      this.current = null;

      if (this.radio) {
        this.#scheduleRadioRetry();
        return;
      }
      this.#scheduleIdleLeave();
    } finally {
      this._advancing = false;
    }
  }

  async startTrack(track, { seek = 0 } = {}) {
    const engine = await this.#ready();
    const channel = this._channel ?? this.voiceChannel;
    if (!channel) throw new UserError('Bot belum ada di voice channel.');

    this._channel = channel;
    // Abaikan event "trackEnd" yang muncul akibat pergantian track.
    this._ignoreEndUntil = Date.now() + this._ignoreEndMs;

    await engine.ensureConnected(this.guild, channel);
    await engine.play(this.guild, track, { seek });

    this.current = track;
    this._startedAt = Date.now();
    this._radioRetries = 0;
    this.#clearIdleTimer();
  }

  #takeNext() {
    const next = this.queue.shift() ?? null;
    if (next && this.loop === 'queue') this.queue.push(next);
    return next;
  }

  #onTrackEnd() {
    if (this._destroyed) return;
    if (Date.now() < this._ignoreEndUntil) return;

    if (this.loop === 'track' && this.current && !this.radio) {
      const track = this.current;
      this.startTrack(track).catch((error) => {
        log.warn(`[${this.guild.id}] loop track gagal: ${error.message}`);
        this.playNext();
      });
      return;
    }

    this.playNext().catch((error) => log.error(`[${this.guild.id}] playNext error: ${error.message}`));
  }

  /* ------------------------------- controls ------------------------------ */

  async pause() {
    if (!this.current) throw new UserError('Nggak ada yang sedang diputar.');
    if (this.paused) throw new UserError('Lagu sudah di-pause.');
    await this.#ready();
    await this.engine.pause(this.guild.id);
  }

  async resume() {
    if (!this.paused) throw new UserError('Lagu tidak sedang di-pause.');
    await this.#ready();
    await this.engine.resume(this.guild.id);
  }

  async skip(amount = 1) {
    const count = Math.max(1, Math.floor(amount));
    if (this.radio && this.queue.length === 0) {
      throw new UserError('Mode radio 24/7 aktif — skip tidak berlaku. Pakai /radio stop dulu.');
    }
    if (!this.current && this.queue.length === 0) throw new UserError('Queue kosong.');

    await this.#ready();
    this._ignoreEndUntil = Date.now() + this._ignoreEndMs;
    await this.engine.stop(this.guild.id);

    for (let i = 1; i < count && this.queue.length > 0; i += 1) this.queue.shift();
    this.current = null;
    await this.playNext();
  }

  async seek(seconds) {
    if (!this.current) throw new UserError('Nggak ada yang sedang diputar.');
    if (this.current.isStream) throw new UserError('Live stream tidak bisa di-seek.');
    if (seconds < 0 || seconds > this.current.duration) {
      throw new UserError(`Posisi harus antara 0 dan ${Math.floor(this.current.duration)} detik.`);
    }

    await this.#ready();
    this._ignoreEndUntil = Date.now() + this._ignoreEndMs;
    await this.engine.seek(this.guild.id, Math.floor(seconds * 1000));
  }

  async setVolume(value) {
    const volume = Math.max(0, Math.min(200, Math.floor(value)));
    this.volume = volume;
    await this.#ready();
    await this.engine.setVolume(this.guild.id, volume);
    return volume;
  }

  async setFilter(name) {
    await this.#ready();
    this.filter = name;
    await this.engine.setFilter(this.guild.id, name);
    return name;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    return this.queue.length;
  }

  remove(index) {
    if (index < 0 || index >= this.queue.length) throw new UserError('Index di luar jangkauan queue.');
    return this.queue.splice(index, 1)[0];
  }

  async jump(index) {
    if (index < 0 || index >= this.queue.length) throw new UserError('Index di luar jangkauan queue.');
    const [target] = this.queue.splice(index, 1);
    this.queue.unshift(target);

    await this.#ready();
    this._ignoreEndUntil = Date.now() + this._ignoreEndMs;
    await this.engine.stop(this.guild.id);
    this.current = null;
    await this.playNext();
  }

  async stop() {
    this.queue = [];
    this.current = null;
    this.radio = null;
    this._ignoreEndUntil = Date.now() + this._ignoreEndMs;
    try {
      await this.engine?.stop(this.guild.id);
    } catch (error) {
      log.debug(`[${this.guild.id}] stop: ${error.message}`);
    }
    this.#scheduleIdleLeave();
  }

  /* --------------------------------- radio ------------------------------- */

  async startRadio(station, { requester = null } = {}) {
    const track = stationToTrack(station, requester);
    this.radio = { station, track };
    this.queue = [];
    this._radioRetries = 0;
    await this.startTrack(track);
    return track;
  }

  stopRadio() {
    this.radio = null;
    this.#clearRetryTimer();
    this._radioRetries = 0;
  }

  #scheduleRadioRetry() {
    if (!this.radio || this._destroyed) return;

    // Sempat main lama sebelum putus? hitungan gagal di-reset.
    if (this._startedAt && Date.now() - this._startedAt > 60_000) this._radioRetries = 0;
    this._radioRetries += 1;

    if (this._radioRetries > config.radio.maxRetries) {
      log.warn(`[${this.guild.id}] radio gagal ${this._radioRetries}x, berhenti mencoba.`);
      this.radio = null;
      this.#scheduleIdleLeave();
      return;
    }

    const delay = Math.min(60_000, config.radio.retryDelayMs * this._radioRetries);
    log.info(`[${this.guild.id}] radio reconnect dalam ${delay}ms (percobaan ${this._radioRetries})`);
    this.#clearRetryTimer();
    this._retryTimer = setTimeout(() => {
      if (!this.radio) return;
      this._startedAt = Date.now();
      this.startTrack(this.radio.track).catch((error) => {
        log.warn(`[${this.guild.id}] radio retry gagal: ${error.message}`);
        this.#scheduleRadioRetry();
      });
    }, delay);
    this._retryTimer.unref?.();
  }

  /* -------------------------------- lifecycle ---------------------------- */

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.#clearIdleTimer();
    this.#clearRetryTimer();
    this.queue = [];
    this.current = null;
    this.radio = null;

    try {
      await this.engine?.destroy(this.guild.id);
    } catch (error) {
      log.debug(`[${this.guild.id}] destroy engine: ${error.message}`);
    }
    this.client.players.delete(this.guild.id);
  }

  #fetchAutoplay() {
    if (!this.current) return Promise.resolve([]);
    const videoId =
      this.current.stream?.target?.match(/[?&]v=([\w-]{11})/)?.[1] ||
      this.current.url?.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!videoId) return Promise.resolve([]);

    const played = new Set(this.queue.map((track) => track.title.toLowerCase()));
    played.add(this.current.title.toLowerCase());

    return relatedTracks(videoId, 10).then((related) =>
      related
        .filter((item) => !played.has(item.title.toLowerCase()))
        .slice(0, 5)
        .map((item) => Track.fromYtdlp(item, this.client.user?.id ?? null, 'Autoplay')),
    );
  }

  #scheduleIdleLeave() {
    if (this.radio) return;
    this.#clearIdleTimer();
    const ms = config.defaults.idleLeaveSeconds * 1000;
    if (ms <= 0) return;
    this._idleTimer = setTimeout(() => {
      if (this.radio || this.current || this.queue.length > 0) return;
      log.info(`[${this.guild.id}] idle ${config.defaults.idleLeaveSeconds}s, keluar dari voice.`);
      this.destroy();
    }, ms);
    this._idleTimer.unref?.();
  }

  #clearIdleTimer() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  #clearRetryTimer() {
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }
}
