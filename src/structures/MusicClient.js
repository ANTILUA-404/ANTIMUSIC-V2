import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { createEngine } from '../audio/index.js';
import { createLogger } from '../utils/logger.js';
import { GuildPlayer } from './GuildPlayer.js';

const log = createLogger('client');

export class MusicClient extends Client {
  constructor() {
    super({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      allowedMentions: { parse: ['users'], repliedUser: false },
    });

    this.commands = new Collection();
    this.players = new Map();
    this.cooldowns = new Map();

    /** Diisi oleh ensureEngine() (butuh client.user, jadi tidak di constructor). */
    this.audioEngine = null;
    this._enginePromise = null;

    // Lavalink butuh raw voice packet (VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE).
    this.on('raw', (data) => {
      try {
        this.audioEngine?.handleRaw?.(data);
      } catch (error) {
        log.debug('raw handler:', error.message);
      }
    });
  }

  /**
   * Membuat engine audio sekali saja (Lavalink, atau fallback lokal).
   * Semua command memanggil ini, jadi urutan start tidak jadi masalah.
   */
  async ensureEngine() {
    if (this.audioEngine) return this.audioEngine;
    if (!this._enginePromise) {
      this._enginePromise = createEngine(this)
        .then((engine) => {
          this.audioEngine = engine;
          log.info(`Engine audio aktif: ${engine.name} (${engine.status().detail})`);
          return engine;
        })
        .catch((error) => {
          this._enginePromise = null;
          throw error;
        });
    }
    return this._enginePromise;
  }

  /** Lazily creates (and caches) the guild player. */
  playerFor(guild) {
    let player = this.players.get(guild.id);
    if (!player) {
      player = new GuildPlayer(this, guild);
      this.players.set(guild.id, player);
    }
    return player;
  }

  /** Simple per-user cooldown guard. Returns remaining ms (0 = allowed). */
  cooldown(userId, commandName, seconds) {
    if (seconds <= 0) return 0;
    const key = `${userId}:${commandName}`;
    const now = Date.now();
    const expires = this.cooldowns.get(key) ?? 0;
    if (expires > now) return expires - now;
    this.cooldowns.set(key, now + seconds * 1000);
    if (this.cooldowns.size > 5000) this.cooldowns.clear();
    return 0;
  }
}
