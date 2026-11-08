import { PermissionsBitField } from 'discord.js';

/** User-facing error with a clean message (never dumped as a stack trace). */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

/**
 * Validates that the user is in a voice channel and that the bot can join it.
 * @returns {Promise<import('discord.js').VoiceBasedChannel>}
 */
export async function ensureVoiceChannel(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    throw new UserError('Kamu harus join voice channel dulu sebelum pakai command ini.');
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  const current = me.voice?.channelId;
  if (current && current !== channel.id) {
    throw new UserError(`Bot sedang dipakai di <#${current}>. Join ke sana atau tunggu selesai.`);
  }

  const permissions = channel.permissionsFor(me);
  if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
    throw new UserError(`Bot nggak punya izin **Connect** di <#${channel.id}>.`);
  }
  if (!permissions.has(PermissionsBitField.Flags.Speak)) {
    throw new UserError(`Bot nggak punya izin **Speak** di <#${channel.id}>.`);
  }
  return channel;
}

export function requirePlayer(client, guild) {
  const player = client.players.get(guild.id);
  if (!player || !player.connected) {
    throw new UserError('Bot belum ada di voice channel. Pakai `/play` dulu.');
  }
  return player;
}

export function requireCurrentTrack(player) {
  if (!player?.current) throw new UserError('Nggak ada lagu yang sedang diputar.');
  return player.current;
}

/** Parses "1:23" / "83" into seconds. */
export function parseTimeInput(value) {
  const raw = String(value).trim();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length > 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return numbers.reduce((acc, part) => acc * 60 + part, 0);
}
