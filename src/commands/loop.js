import { SlashCommandBuilder } from 'discord.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Mode pengulangan')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Pilih mode loop')
        .setRequired(true)
        .addChoices(
          { name: 'off — tanpa loop', value: 'off' },
          { name: 'track — ulang lagu ini', value: 'track' },
          { name: 'queue — ulang seluruh antrian', value: 'queue' },
        ),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    player.loop = interaction.options.getString('mode', true);
    await interaction.reply({ embeds: [successEmbed(`Mode loop: **${player.loop}**.`)] });
  },
};
