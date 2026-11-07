import { spawn } from 'node:child_process';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { relatedTracks, spawnYtdlpAudio } from '../utils/ytdlp.js';
import { UserError } from '../utils/guards.js';
import { stationToTrack } from './RadioStore.js';
import { Track } from './Track.js';

const log = createLogger('player');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const FILTERS = {
  none: null,
  bassboost: 'bass=g=12,dynaudnorm=f=200',
  nightcore: 'asetrate=48000*1.25,aresample=48000',
  vaporwave: 'asetrate=48000*0.8,aresample=48000',
  '8d': 'apulsator=hz=0.09',
  karaoke: 'pan=stereo|c0=c0-c1|c1=c1-c0',
  treble: 'treble=g=8',
  soft: 'lowpass=f=8000,volume=0.85',
};

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

    this.connection = null;
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: 5000 },
    });

    this._advancing = false;
    this._suppressIdle = false;
    this._idleTimer = null;
    this._retryTimer = null;
    this._radioRetries = 0;
    this._processes = [];
    this._resource = null;
    this._ffmpegError = '';
    this._seekOffset = 0;
    this._startedAt = 0;
    this._destroyed = false;

    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on(AudioPlayerStatus.Playing, () => {
      if (!this._startedAt) this._startedAt = Date.now();
    });
    this.player.on(AudioPlayerStatus.Paused, () => {
      this._pausedAt = Date.now();
    });
    this.player.on('error', (error) => {
      log.error(`[${this.guild.id}] audio player error: ${error.message}`);
    });
  }

  /* ------------------------------- getters ------------------------------- */

  get voiceChannel() {
    return this.guild.members.me?.voice?.channel ?? null;
  }

  get paused() {
    return this.player.state.status === AudioPlayerStatus.Paused;
  }

  get playing() {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  /** Seconds played of the current track (0 for live streams). */
  get elapsed() {
    if (!this.current || this.current.isStream) return 0;
    if (!this._startedAt) return this._seekOffset;
    const end = this.paused ? this._pausedAt || Date.now() : Date.now();
    const running = (end - this._startedAt) / 1000;
    return Math.max(0, Math.min(this.current.duration, this._seekOffset + running));
  }

  /* ----------------------------- connection ------------------------------ */

  async join(channel) {
    const existing = getVoiceConnection(this.guild.id);
    if (existing && existing.joinConfig.channelId === channel.id) {
      this.connection = existing;
      this.#attach(existing);
      existing.subscribe(this.player);
      return this.connection;
    }
    if (existing) existing.destroy();

    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    this.#attach(this.connection);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.connection.destroy();
      this.connection = null;
      throw new UserError('Gagal connect ke voice channel (timeout). Cek permission bot: Connect + Speak.');
    }

    this.connection.subscribe(this.player);
    this.#clearIdleTimer();
    return this.connection;
  }

  #attach(connection) {
    if (connection.__musicBotOwner === this) return;
    connection.__musicBotOwner = this;

    connection.on('stateChange', (oldState, newState) => {
      log.debug(`[${this.guild.id}] voice: ${oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (this.radio) this.#tryReconnect(connection);
        else this.destroy();
      }
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.#cleanupProcesses();
      }
    });
    connection.on('error', (error) => log.warn(`[${this.guild.id}] voice error: ${error.message}`));
  }

  async #tryReconnect(connection) {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      log.warn(`[${this.guild.id}] voice terputus, mencoba reconnect...`);
      try {
        connection.reconnect();
      } catch (error) {
        log.error(`[${this.guild.id}] reconnect gagal: ${error.message}`);
      }
    }
  }

  /* ------------------------------ playback ------------------------------- */

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
      this.#killProcesses();

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
      this._startedAt = 0;

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
    await track.ensurePlayable();
    // Kill any previous FFmpeg/yt-dlp pair first, otherwise a stale process keeps
    // buffering audio into a stream nobody reads (leak + overlapping sound).
    this.#killProcesses();

    const resource = this.#createResource(track, seek);

    this.current = track;
    this._seekOffset = seek;
    this._startedAt = Date.now();
    this._pausedAt = 0;
    this._resource = resource;
    this.player.play(resource);
    this.#clearIdleTimer();
  }

  async play() {
    if (this.paused) return this.resume();
    if (this.current && this.player.state.status === AudioPlayerStatus.AutoPaused) {
      this.player.unpause();
    }
    return undefined;
  }

  pause() {
    if (!this.current) throw new UserError('Nggak ada yang sedang diputar.');
    if (this.paused) throw new UserError('Lagu sudah di-pause.');
    this.player.pause(true);
  }

  resume() {
    if (!this.paused) throw new UserError('Lagu tidak sedang di-pause.');
    this.player.unpause();
    if (this._pausedAt) {
      // Shift the clock forward so /nowplaying progress stays accurate.
      this._startedAt += Date.now() - this._pausedAt;
      this._pausedAt = 0;
    }
  }

  async skip(amount = 1) {
    const count = Math.max(1, Math.floor(amount));
    if (this.radio && this.queue.length === 0) {
      throw new UserError('Mode radio 24/7 aktif — skip tidak berlaku. Pakai /radio stop dulu.');
    }
    if (!this.current && this.queue.length === 0) throw new UserError('Queue kosong.');

    this._suppressIdle = true;
    this.player.stop(true);

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
    const track = this.current;
    await this.startTrack(track, { seek: Math.floor(seconds) });
  }

  setVolume(value) {
    const volume = Math.max(0, Math.min(200, Math.floor(value)));
    this.volume = volume;
    this._resource?.volume?.setVolume(volume / 100);
    return volume;
  }

  async setFilter(name) {
    if (!(name in FILTERS)) throw new UserError(`Filter "${name}" tidak dikenal.`);
    if (this.filter === name) return name;
    this.filter = name;
    if (this.current && !this.current.isStream) {
      const position = this.elapsed;
      await this.startTrack(this.current, { seek: Math.floor(position) });
    }
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

  jump(index) {
    if (index < 0 || index >= this.queue.length) throw new UserError('Index di luar jangkauan queue.');
    const [target] = this.queue.splice(index, 1);
    this.queue.unshift(target);
    this._suppressIdle = true;
    this.player.stop(true);
    this.current = null;
    return this.playNext();
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.radio = null;
    this._startedAt = 0;
    this._seekOffset = 0;
    this._suppressIdle = true;
    this.player.stop(true);
    this.#killProcesses();
    this.#scheduleIdleLeave();
  }

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

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.#clearIdleTimer();
    this.#clearRetryTimer();
    this.queue = [];
    this.current = null;
    this.radio = null;
    try {
      this.player.stop(true);
    } catch {
      /* ignore */
    }
    this.#killProcesses();
    const connection = getVoiceConnection(this.guild.id);
    if (connection) connection.destroy();
    this.connection = null;
    this.client.players.delete(this.guild.id);
  }

  /* ------------------------------ internals ------------------------------ */

  #onIdle() {
    if (this._suppressIdle) {
      this._suppressIdle = false;
      return;
    }
    if (this._destroyed) return;

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

  #takeNext() {
    const next = this.queue.shift() ?? null;
    if (next && this.loop === 'queue') this.queue.push(next);
    return next;
  }

  #createResource(track, seek = 0) {
    const output = [
      '-vn',
      '-f',
      's16le',
      '-ar',
      String(config.ffmpeg.sampleRate),
      '-ac',
      String(config.ffmpeg.channels),
    ];
    // -af must come before the output target, otherwise FFmpeg treats it as a new output.
    const filter = FILTERS[this.filter];
    if (filter) output.push('-af', filter);
    output.push('pipe:1');

    let ffmpeg;

    if (track.stream.kind === 'url') {
      const args = ['-hide_banner', '-loglevel', 'error'];
      if (seek > 0) args.push('-ss', String(Math.floor(seek)));
      args.push(
        '-reconnect',
        '1',
        '-reconnect_streamed',
        '1',
        '-reconnect_delay_max',
        '5',
        '-user_agent',
        USER_AGENT,
        '-i',
        track.stream.target,
        ...output,
      );
      ffmpeg = spawn(config.ffmpeg.bin, args, { windowsHide: true });
    } else {
      const downloader = spawnYtdlpAudio(track.stream.target, { seek });
      ffmpeg = spawn(
        config.ffmpeg.bin,
        ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...output],
        { windowsHide: true },
      );

      downloader.child.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdin.on('error', () => {});
      downloader.child.stdout.on('error', () => {});
      ffmpeg.on('close', () => downloader.kill());
      this._processes.push(downloader);
    }

    this._ffmpegError = '';
    ffmpeg.stderr?.setEncoding('utf8');
    ffmpeg.stderr?.on('data', (chunk) => {
      this._ffmpegError = (this._ffmpegError + chunk).slice(-600);
    });
    ffmpeg.on('error', (error) => log.error(`[${this.guild.id}] ffmpeg: ${error.message}`));
    ffmpeg.on('close', (code) => {
      if (code && code !== 0 && this._ffmpegError) {
        log.debug(`[${this.guild.id}] ffmpeg exit ${code}: ${this._ffmpegError.slice(-200)}`);
      }
    });

    this._processes.push({ kill: () => this.#safeKill(ffmpeg) });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });
    resource.volume?.setVolume(this.volume / 100);
    return resource;
  }

  #safeKill(child) {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  #killProcesses() {
    for (const proc of this._processes) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
    this._processes = [];
  }

  #cleanupProcesses() {
    this.#killProcesses();
  }

  async #fetchAutoplay() {
    if (!this.current) return [];
    const videoId = this.current.stream?.target?.match(/[?&]v=([\w-]{11})/)?.[1] ||
      this.current.url?.match(/[?&]v=([\w-]{11})/)?.[1];
    if (!videoId) return [];

    const played = new Set(this.#recentTitles());
    const related = await relatedTracks(videoId, 10);
    const fresh = related.filter((track) => !played.has(track.title.toLowerCase()));

    return fresh.slice(0, 5).map((item) => Track.fromYtdlp(item, this.client.user?.id ?? null, 'Autoplay'));
  }

  #recentTitles() {
    const titles = this.queue.map((track) => track.title.toLowerCase());
    if (this.current) titles.push(this.current.title.toLowerCase());
    return titles;
  }

  #scheduleRadioRetry() {
    if (!this.radio) return;

    // Played fine for a while before dropping? Treat it as a fresh failure streak.
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
      this.startTrack(this.radio.track).catch((error) => {
        log.warn(`[${this.guild.id}] radio retry gagal: ${error.message}`);
        this.#scheduleRadioRetry();
      });
    }, delay);
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
