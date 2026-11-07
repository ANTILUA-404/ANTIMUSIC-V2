import { SlashCommandBuilder } from 'discord.js';
import { queueEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Lihat antrian lagu')
    .addIntegerOption((option) => option.setName('halaman').setDescription('Halaman antrian').setMinValue(1)),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const page = interaction.options.getInteger('halaman') ?? 1;
    await interaction.reply({ embeds: [queueEmbed(player, { page })] });
  },
};
