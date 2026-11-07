import { SlashCommandBuilder } from 'discord.js';
import { nowPlayingEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Info lagu yang sedang diputar'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    await interaction.reply({ embeds: [nowPlayingEmbed(player)] });
  },
};
