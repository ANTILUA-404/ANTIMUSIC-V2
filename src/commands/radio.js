import { ChannelType, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import {
  addStation,
  clear247,
  get247,
  getStation,
  listStations,
  removeStation,
  save247,
} from '../structures/RadioStore.js';
import { errorEmbed, infoEmbed, stationListEmbed, successEmbed, warnEmbed } from '../utils/discord.js';
import { escapeMarkdown, formatDuration, truncate } from '../utils/format.js';
import { ensureVoiceChannel, UserError } from '../utils/guards.js';

const looksLikeUrl = (value) => /^https?:\/\//i.test(value);

function resolveStationInput(input) {
  const found = getStation(input);
  if (found) return found;

  if (looksLikeUrl(input)) {
    return {
      id: `custom-${Date.now().toString(36)}`,
      name: truncate(input.replace(/^https?:\/\//, ''), 60),
      url: input,
      kind: /(youtube\.com|youtu\.be)/i.test(input) ? 'ytdlp' : 'url',
      custom: true,
      temporary: true,
    };
  }
  throw new UserError(`Station "${input}" tidak ditemukan. Lihat daftar dengan \`/radio list\`.`);
}

export default {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Mode radio 24/7 — bot betah nongkrong di voice channel')
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Mulai radio 24/7 di voice channel kamu')
        .addStringOption((option) =>
          option
            .setName('station')
            .setDescription('Nama/id station, atau tempel URL stream langsung')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Voice channel tujuan (default: channel kamu)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
        ),
    )
    .addSubcommand((sub) => sub.setName('stop').setDescription('Matikan radio 24/7 dan keluar dari voice'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Lihat status radio 24/7 di server ini'))
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Daftar station radio yang tersedia')
        .addIntegerOption((option) => option.setName('page').setDescription('Halaman').setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Tambah station radio custom (disimpan permanen)')
        .addStringOption((option) => option.setName('name').setDescription('Nama station').setRequired(true).setMaxLength(60))
        .addStringOption((option) => option.setName('url').setDescription('URL stream (mp3/aac/ogg/HLS) atau URL YouTube live').setRequired(true))
        .addStringOption((option) =>
          option
            .setName('kind')
            .setDescription('Tipe sumber')
            .addChoices({ name: 'Direct stream (Icecast/HLS)', value: 'url' }, { name: 'YouTube live (yt-dlp)', value: 'ytdlp' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Hapus station custom')
        .addStringOption((option) => option.setName('station').setDescription('Nama/id station custom').setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const stations = listStations().filter((station) => !focused.value || station.name.toLowerCase().includes(focused.value.toLowerCase()) || station.id.includes(focused.value.toLowerCase()));
    await interaction.respond(
      stations.slice(0, 25).map((station) => ({
        name: `${station.name} (${station.id})`.slice(0, 100),
        value: station.id,
      })),
    );
  },

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'list') {
      const page = interaction.options.getInteger('page') ?? 1;
      return interaction.reply({ embeds: [stationListEmbed(listStations(), { page })] });
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true);
      const url = interaction.options.getString('url', true);
      const kind = interaction.options.getString('kind') ?? (/(youtube\.com|youtu\.be)/i.test(url) ? 'ytdlp' : 'url');
      const station = addStation({ name, url, kind });
      return interaction.reply({
        embeds: [successEmbed(`Station **${escapeMarkdown(station.name)}** ditambahkan dengan id \`${station.id}\`.\nMulai dengan \`/radio start station:${station.id}\`.`)],
      });
    }

    if (sub === 'remove') {
      const input = interaction.options.getString('station', true);
      const station = getStation(input);
      if (!station) return interaction.reply({ embeds: [errorEmbed('Station tidak ditemukan.')], flags: MessageFlags.Ephemeral });
      if (!station.custom) {
        return interaction.reply({ embeds: [warnEmbed('Station bawaan tidak bisa dihapus.')], flags: MessageFlags.Ephemeral });
      }
      const removed = removeStation(station.id);
      return interaction.reply({
        embeds: [removed ? successEmbed(`Station **${escapeMarkdown(station.name)}** dihapus.`) : errorEmbed('Gagal menghapus station.')],
      });
    }

    if (sub === 'status') {
      const saved = get247(guildId);
      const player = client.players.get(guildId);
      const lines = [
        `**Mode 24/7:** ${player?.radio ? '🟢 aktif' : '⚪ tidak aktif'}`,
        saved ? `**Station tersimpan:** ${escapeMarkdown(saved.stationName ?? saved.stationId)}` : null,
        saved ? `**Voice channel:** <#${saved.voiceChannelId}>` : null,
        player?.radio ? `**Uptime:** ${formatDuration((Date.now() - (player.radio.since ?? Date.now())) / 1000)}` : null,
        player?.connection ? '**Koneksi voice:** tersambung' : '**Koneksi voice:** terputus',
        `**Retry otomatis:** sampai ${config.radio.maxRetries}x dengan jeda ${config.radio.retryDelayMs}ms`,
      ].filter(Boolean);

      return interaction.reply({ embeds: [infoEmbed(lines.join('\n'))] });
    }

    if (sub === 'stop') {
      const player = client.players.get(guildId);
      clear247(guildId);
      if (player) {
        player.stopRadio();
        await player.stop();
        await player.destroy();
      }
      return interaction.reply({ embeds: [successEmbed('Radio 24/7 dimatikan, bot keluar dari voice channel.')] });
    }

    // sub === 'start'
    await interaction.deferReply();
    const input = interaction.options.getString('station', true);
    const targetChannel = interaction.options.getChannel('channel') ?? interaction.member?.voice?.channel;

    if (!targetChannel) throw new UserError('Kamu harus join voice channel dulu, atau isi opsi `channel`.');

    const station = resolveStationInput(input);
    if (station.temporary) addStation({ name: station.name, url: station.url, kind: station.kind });

    const player = client.playerFor(interaction.guild);
    await player.join(targetChannel);
    await player.startRadio(station, { requester: interaction.user.id });

    player.radio.since = Date.now();
    save247(guildId, {
      voiceChannelId: targetChannel.id,
      stationId: station.id,
      stationName: station.name,
    });

    const embed = new EmbedBuilder()
      .setColor('#E91E63')
      .setAuthor({ name: '🔴 Radio 24/7 aktif' })
      .setTitle(truncate(station.name, 90))
      .setDescription(
        `Bot bakal nongkrong terus di <#${targetChannel.id}> dan auto-reconnect kalau stream putus.\n` +
          `Matikan dengan \`/radio stop\`.`,
      )
      .addFields(
        { name: 'Station ID', value: `\`${station.id}\``, inline: true },
        { name: 'Tipe', value: station.kind === 'ytdlp' ? 'YouTube live' : 'Direct stream', inline: true },
        { name: 'Auto-reconnect', value: `${config.radio.maxRetries}x`, inline: true },
      );

    return interaction.editReply({ embeds: [embed] });
  },
};
