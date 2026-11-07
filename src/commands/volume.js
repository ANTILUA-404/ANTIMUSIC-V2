import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Atur volume (0-200%)')
    .addIntegerOption((option) =>
      option.setName('level').setDescription('Volume 0-200').setRequired(true).setMinValue(0).setMaxValue(200),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const level = player.setVolume(interaction.options.getInteger('level', true));
    await interaction.reply({ embeds: [successEmbed(`Volume diset ke **${level}%**.`)] });
  },
};
