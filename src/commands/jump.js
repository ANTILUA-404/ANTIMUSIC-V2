import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Langsung putar lagu ke-N dari antrian')
    .addIntegerOption((option) =>
      option.setName('posisi').setDescription('Nomor lagu di /queue').setRequired(true).setMinValue(1),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const position = interaction.options.getInteger('posisi', true);

    await interaction.deferReply();
    await player.jump(position - 1);
    await interaction.editReply({
      embeds: [successEmbed(`Langsung ke posisi #${position}${player.current ? `: **${player.current.title}**` : ''}.`)],
    });
  },
};
