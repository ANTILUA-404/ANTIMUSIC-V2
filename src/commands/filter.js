import { SlashCommandBuilder } from 'discord.js';
import { FILTERS } from '../audio/filters.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

const LABELS = {
  none: 'none — tanpa filter',
  bassboost: 'bassboost — bass lebih nendang',
  nightcore: 'nightcore — cepat & tinggi',
  vaporwave: 'vaporwave — lambat & dreamy',
  '8d': '8d — audio muter',
  karaoke: 'karaoke — vokal diredam',
  treble: 'treble — lebih cerah',
  soft: 'soft — lebih halus',
};

export default {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Pasang audio filter')
    .addStringOption((option) =>
      option
        .setName('nama')
        .setDescription('Pilih filter')
        .setRequired(true)
        .addChoices(...Object.keys(FILTERS).map((key) => ({ name: LABELS[key] ?? key, value: key }))),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const name = interaction.options.getString('nama', true);

    await interaction.deferReply();
    await player.setFilter(name);
    await interaction.editReply({ embeds: [successEmbed(`Filter diset ke **${name}**.`)] });
  },
};
