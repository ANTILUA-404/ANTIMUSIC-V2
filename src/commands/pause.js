import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause lagu yang sedang diputar'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    player.pause();
    await interaction.reply({ embeds: [successEmbed('Lagu di-pause. Pakai `/resume` buat lanjut.')] });
  },
};
