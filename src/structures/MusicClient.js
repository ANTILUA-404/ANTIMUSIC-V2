import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { GuildPlayer } from './GuildPlayer.js';

export class MusicClient extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
      ],
      allowedMentions: { parse: ['users'], repliedUser: false },
    });

    this.commands = new Collection();
    this.players = new Map();
    this.cooldowns = new Map();
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
