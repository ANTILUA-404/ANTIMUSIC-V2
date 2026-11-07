import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('autoplay')
    .setDescription('Putar lagu mirip otomatis kalau antrian habis')
    .addStringOption((option) =>
      option
        .setName('status')
        .setDescription('Aktifkan atau matikan')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    player.autoplay = interaction.options.getString('status', true) === 'on';
    await interaction.reply({
      embeds: [successEmbed(`Autoplay **${player.autoplay ? 'aktif' : 'mati'}**.`)],
    });
  },
};
