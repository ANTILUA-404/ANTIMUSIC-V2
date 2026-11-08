import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('resume').setDescription('Lanjutkan lagu yang di-pause'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    await player.resume();
    await interaction.reply({ embeds: [successEmbed('Lanjut diputar.')] });
  },
};
