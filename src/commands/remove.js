import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Hapus lagu dari antrian berdasarkan nomor')
    .addIntegerOption((option) =>
      option.setName('posisi').setDescription('Nomor lagu di /queue').setRequired(true).setMinValue(1),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const position = interaction.options.getInteger('posisi', true);
    const removed = player.remove(position - 1);
    await interaction.reply({ embeds: [successEmbed(`Dihapus dari antrian: **${removed.title}**.`)] });
  },
};
