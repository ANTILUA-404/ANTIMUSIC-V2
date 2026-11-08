import { EventEmitter } from 'node:events';
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
import { spawnYtdlpAudio } from '../utils/ytdlp.js';
import { FILTERS } from './filters.js';

const log = createLogger('engine:local');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Engine lokal: yt-dlp -> FFmpeg -> PCM 48kHz -> @discordjs/voice.
 *
 * Dipakai kalau Lavalink tidak dikonfigurasi, tidak bisa dihubungi, atau
 * kuota Railway habis. Semua state per-guild disimpan di `this.guilds`.
 */
export class LocalEngine extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.name = 'local';
    this.ready = true;
    this.guilds = new Map();
  }

  async init() {
    this.ready = true;
    return this;
  }

  /** Engine lokal tidak butuh raw voice packet (koneksi diurus @discordjs/voice). */
  handleRaw() {}

  #state(guildId) {
    let state = this.guilds.get(guildId);
    if (!state) {
      state = {
        connection: null,
        player: createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play, maxMissedFrames: 5000 },
        }),
        processes: [],
        resource: null,
        current: null,
        startedAt: 0,
        seekOffset: 0,
        pausedAt: 0,
        filter: 'none',
        volume: config.defaults.volume,
        suppressIdle: false,
      };

      state.player.on(AudioPlayerStatus.Idle, () => {
        if (state.suppressIdle) {
          state.suppressIdle = false;
          return;
        }
        state.current = null;
        state.startedAt = 0;
        this.#kill(state);
        this.emit('trackEnd', guildId, 'finished');
      });

      state.player.on('error', (error) => {
        log.error(`[${guildId}] audio player: ${error.message}`);
        this.emit('error', guildId, error);
      });

      this.guilds.set(guildId, state);
    }
    return state;
  }

  status() {
    return {
      name: this.name,
      ready: true,
      guilds: this.guilds.size,
      detail: 'yt-dlp + FFmpeg lokal',
    };
  }

  /* ------------------------------ connection ----------------------------- */

  async ensureConnected(guild, channel) {
    const state = this.#state(guild.id);
    const existing = getVoiceConnection(guild.id);

    if (existing && existing.joinConfig.channelId === channel.id) {
      state.connection = existing;
      this.#attach(guild.id, state, existing);
      existing.subscribe(state.player);
      return state;
    }
    if (existing) existing.destroy();

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    state.connection = connection;
    this.#attach(guild.id, state, connection);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      state.connection = null;
      throw new Error('Gagal connect ke voice channel (timeout). Cek izin Connect + Speak.');
    }

    connection.subscribe(state.player);
    return state;
  }

  #attach(guildId, state, connection) {
    if (connection.__antimusicOwner === state) return;
    connection.__antimusicOwner = state;

    connection.on('stateChange', (oldState, newState) => {
      log.debug(`[${guildId}] voice: ${oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.emit('disconnect', guildId);
      }
      if (newState.status === VoiceConnectionStatus.Destroyed) this.#kill(state);
    });
    connection.on('error', (error) => log.warn(`[${guildId}] voice: ${error.message}`));
  }

  /* ------------------------------- playback ------------------------------ */

  async play(guild, track, { seek = 0 } = {}) {
    const state = this.#state(guild.id);
    const channel = guild.members.me?.voice?.channel;
    if (!channel) throw new Error('Bot belum ada di voice channel.');

    await this.ensureConnected(guild, channel);
    await track.ensurePlayable();

    this.#kill(state);
    const resource = this.#createResource(state, track, seek);

    state.current = track;
    state.seekOffset = seek;
    state.startedAt = Date.now();
    state.pausedAt = 0;
    state.resource = resource;
    state.player.play(resource);
    return track;
  }

  #createResource(state, track, seek) {
    const output = [
      '-vn',
      '-f',
      's16le',
      '-ar',
      String(config.ffmpeg.sampleRate),
      '-ac',
      String(config.ffmpeg.channels),
    ];
    const filter = FILTERS[state.filter]?.ffmpeg;
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
      ffmpeg = spawn(config.ffmpeg.bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...output], {
        windowsHide: true,
      });
      downloader.child.stdout.pipe(ffmpeg.stdin);
      ffmpeg.stdin.on('error', () => {});
      downloader.child.stdout.on('error', () => {});
      ffmpeg.on('close', () => downloader.kill());
      state.processes.push(downloader);
    }

    ffmpeg.stderr?.setEncoding('utf8');
    ffmpeg.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) log.debug(`[ffmpeg] ${text.slice(-200)}`);
    });
    ffmpeg.on('error', (error) => log.error(`ffmpeg: ${error.message}`));
    state.processes.push({ kill: () => this.#safeKill(ffmpeg) });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });
    resource.volume?.setVolume(state.volume / 100);
    return resource;
  }

  #safeKill(child) {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      /* sudah mati */
    }
  }

  #kill(state) {
    for (const proc of state.processes) {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }
    state.processes = [];
  }

  /* ------------------------------- controls ------------------------------ */

  async pause(guildId) {
    const state = this.guilds.get(guildId);
    if (!state?.current) throw new Error('Nggak ada yang sedang diputar.');
    if (state.player.state.status === AudioPlayerStatus.Paused) throw new Error('Lagu sudah di-pause.');
    state.pausedAt = Date.now();
    state.player.pause(true);
  }

  async resume(guildId) {
    const state = this.guilds.get(guildId);
    if (state?.player.state.status !== AudioPlayerStatus.Paused) throw new Error('Lagu tidak sedang di-pause.');
    state.player.unpause();
    if (state.pausedAt) {
      state.startedAt += Date.now() - state.pausedAt;
      state.pausedAt = 0;
    }
  }

  async stop(guildId) {
    const state = this.guilds.get(guildId);
    if (!state) return;
    state.suppressIdle = true;
    state.player.stop(true);
    state.current = null;
    state.startedAt = 0;
    this.#kill(state);
  }

  async destroy(guildId) {
    const state = this.guilds.get(guildId);
    if (!state) return;
    try {
      state.player.stop(true);
    } catch {
      /* ignore */
    }
    this.#kill(state);
    const connection = getVoiceConnection(guildId);
    if (connection) connection.destroy();
    this.guilds.delete(guildId);
  }

  async setVolume(guildId, volume) {
    const state = this.guilds.get(guildId);
    if (!state) return volume;
    state.volume = volume;
    state.resource?.volume?.setVolume(volume / 100);
    return volume;
  }

  async seek(guild, milliseconds) {
    const state = this.#state(guild.id);
    if (!state.current) throw new Error('Nggak ada yang sedang diputar.');
    if (state.current.isStream) throw new Error('Live stream tidak bisa di-seek.');
    const track = state.current;
    await this.play(guild, track, { seek: Math.floor(milliseconds / 1000) });
  }

  async setFilter(guildId, name) {
    const state = this.guilds.get(guildId);
    if (!state) return name;
    state.filter = name;
    if (state.current && !state.current.isStream) {
      const position = this.position(guildId);
      const guild = this.client.guilds.cache.get(guildId);
      if (guild) await this.play(guild, state.current, { seek: Math.floor(position / 1000) });
    }
    return name;
  }

  /* -------------------------------- state -------------------------------- */

  isPlaying(guildId) {
    const state = this.guilds.get(guildId);
    return state?.player.state.status === AudioPlayerStatus.Playing;
  }

  isPaused(guildId) {
    return this.guilds.get(guildId)?.player.state.status === AudioPlayerStatus.Paused;
  }

  position(guildId) {
    const state = this.guilds.get(guildId);
    if (!state?.current || state.current.isStream) return 0;
    const end = this.isPaused(guildId) ? state.pausedAt || Date.now() : Date.now();
    const elapsed = (end - state.startedAt) / 1000 + state.seekOffset;
    return Math.max(0, Math.min(state.current.duration * 1000, Math.round(elapsed * 1000)));
  }

  /** Info untuk /engine dan /health. */
  guildStatus(guildId) {
    const state = this.guilds.get(guildId);
    return {
      engine: this.name,
      connected: Boolean(state?.connection),
      playing: this.isPlaying(guildId),
      paused: this.isPaused(guildId),
      position: this.position(guildId),
    };
  }
}

export default LocalEngine;
