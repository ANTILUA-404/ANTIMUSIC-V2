import { SlashCommandBuilder } from 'discord.js';
import { infoEmbed, successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip lagu sekarang')
    .addIntegerOption((option) =>
      option.setName('jumlah').setDescription('Skip beberapa lagu sekaligus').setMinValue(1).setMaxValue(50),
    ),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const amount = interaction.options.getInteger('jumlah') ?? 1;
    const skipped = player.current?.title ?? '—';

    await player.skip(amount);

    const next = player.current;
    await interaction.reply({
      embeds: [
        next
          ? successEmbed(`Skip **${skipped}**.\nSekarang: **${next.title}**`)
          : infoEmbed(`Skip **${skipped}**. Antrian sudah habis.`),
      ],
    });
  },
};
