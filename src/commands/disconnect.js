import { SlashCommandBuilder } from 'discord.js';
import { clear247 } from '../structures/RadioStore.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('disconnect').setDescription('Keluarkan bot dari voice channel'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    if (player.radio) clear247(interaction.guild.id);
    await player.destroy();
    await interaction.reply({ embeds: [successEmbed('Bot keluar dari voice channel.')] });
  },
};
