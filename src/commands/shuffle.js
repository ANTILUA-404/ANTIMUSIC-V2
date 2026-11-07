import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Acak urutan antrian'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    if (player.queue.length < 2) {
      return interaction.reply({ embeds: [successEmbed('Antrian terlalu pendek buat diacak.')] });
    }
    const count = player.shuffle();
    await interaction.reply({ embeds: [successEmbed(`Antrian diacak (**${count}** track).`)] });
  },
};
