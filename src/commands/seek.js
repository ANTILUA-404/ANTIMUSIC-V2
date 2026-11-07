import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { formatDuration } from '../utils/format.js';
import { parseTimeInput, requirePlayer, UserError } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Lompat ke detik tertentu di lagu ini')
    .addStringOption((option) =>
      option.setName('waktu').setDescription('Format mm:ss atau detik, contoh 1:30').setRequired(true),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const seconds = parseTimeInput(interaction.options.getString('waktu', true));
    if (seconds === null) throw new UserError('Format waktu tidak valid. Contoh: `1:30` atau `90`.');

    await interaction.deferReply();
    await player.seek(seconds);
    await interaction.editReply({ embeds: [successEmbed(`Lompat ke **${formatDuration(seconds)}**.`)] });
  },
};
