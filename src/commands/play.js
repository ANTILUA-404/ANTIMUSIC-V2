import {
  ActionRowBuilder,
  ComponentType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { resolveQuery } from '../resolvers/index.js';
import { addedEmbed, errorEmbed, playlistEmbed } from '../utils/discord.js';
import { formatDuration, truncate } from '../utils/format.js';
import { ensureVoiceChannel } from '../utils/guards.js';

async function showSearchPicker(interaction, player, result, playNext) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('music:pick')
    .setPlaceholder('Pilih lagu yang mau diputar')
    .addOptions(
      result.tracks.map((track, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(track.title, 90))
          .setDescription(`${truncate(track.author, 35)} • ${formatDuration(track.duration)}`)
          .setValue(String(index)),
      ),
    );

  await interaction.editReply({
    content: `🔎 Hasil pencarian untuk **${truncate(result.query, 70)}** — pilih dalam 25 detik:`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });

  const message = await interaction.fetchReply();
  try {
    const picked = await message.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 25_000,
      filter: (component) => component.user.id === interaction.user.id,
    });

    const track = result.tracks[Number(picked.values[0])];
    if (!track) throw new Error('Track tidak ditemukan.');

    await picked.deferUpdate();
    const position = player.queue.length + (player.current ? 1 : 0) + 1;
    await player.enqueue(track, { next: playNext });
    await interaction.editReply({
      content: null,
      embeds: [addedEmbed(track, { position: playNext ? 1 : position })],
      components: [],
    });
  } catch {
    await interaction
      .editReply({ content: '⏱️ Pencarian dibatalkan (waktu habis).', components: [] })
      .catch(() => {});
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Putar lagu dari YouTube, Spotify, SoundCloud, atau link langsung')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Judul lagu, URL YouTube/Spotify/SoundCloud, atau link stream')
        .setRequired(true)
        .setMaxLength(500),
    )
    .addBooleanOption((option) => option.setName('next').setDescription('Taruh paling depan di antrian')),

  async execute(interaction, client) {
    await interaction.deferReply();

    const query = interaction.options.getString('query', true).trim();
    const playNext = interaction.options.getBoolean('next') ?? false;

    const channel = await ensureVoiceChannel(interaction);
    const player = client.playerFor(interaction.guild);
    await player.join(channel);

    const result = await resolveQuery(query, {
      requester: interaction.user.id,
      limit: config.defaults.maxQueue,
    });

    if (!result.tracks.length) {
      return interaction.editReply({ embeds: [errorEmbed('Tidak ada track yang bisa diputar dari input itu.')] });
    }

    if (result.type === 'search' && result.tracks.length > 1) {
      return showSearchPicker(interaction, player, result, playNext);
    }

    if (result.type === 'playlist') {
      await player.enqueue(result.tracks, { next: playNext });
      const embed = playlistEmbed({
        name: result.playlistName,
        tracks: result.tracks,
        requester: interaction.user.id,
      });
      if (result.warning) embed.setFooter({ text: truncate(result.warning, 120) });
      return interaction.editReply({ embeds: [embed] });
    }

    const [track] = result.tracks;
    const position = player.queue.length + (player.current ? 1 : 0) + 1;
    await player.enqueue(track, { next: playNext });

    const embed = addedEmbed(track, { position: playNext ? 1 : position });
    if (result.warning) embed.setFooter({ text: truncate(result.warning, 120) });
    return interaction.editReply({ embeds: [embed] });
  },
};
