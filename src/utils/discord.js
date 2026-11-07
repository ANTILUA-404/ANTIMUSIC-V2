import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { escapeMarkdown, formatDuration, link, progressBar, truncate } from './format.js';

export const errorEmbed = (description) =>
  new EmbedBuilder().setColor(config.embed.error).setDescription(`❌ ${description}`);

export const successEmbed = (description) =>
  new EmbedBuilder().setColor(config.embed.success).setDescription(`✅ ${description}`);

export const warnEmbed = (description) =>
  new EmbedBuilder().setColor(config.embed.warn).setDescription(`⚠️ ${description}`);

export const infoEmbed = (description) =>
  new EmbedBuilder().setColor(config.embed.color).setDescription(description);

const SOURCE_LABEL = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  radio: 'Radio',
  direct: 'Direct',
  bandcamp: 'Bandcamp',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
};

const sourceLabel = (source) => SOURCE_LABEL[source] || (source ? source[0].toUpperCase() + source.slice(1) : 'Unknown');

export function trackLine(track, index) {
  const title = track.url ? link(track.title, track.url) : escapeMarkdown(truncate(track.title, 60));
  const duration = track.isStream ? '🔴 LIVE' : formatDuration(track.duration);
  return `\`${String(index).padStart(2, '0')}.\` ${title} \`${duration}\``;
}

export function addedEmbed(track, { position = null, playlist = null } = {}) {
  const embed = new EmbedBuilder()
    .setColor(config.embed.success)
    .setAuthor({ name: playlist ? `Playlist ditambahkan • ${truncate(playlist, 50)}` : 'Ditambahkan ke antrian' })
    .setDescription(
      `${track.url ? link(track.title, track.url) : escapeMarkdown(track.title)}\n` +
        `👤 ${escapeMarkdown(truncate(track.author, 40))} • \`${track.isStream ? 'LIVE' : formatDuration(track.duration)}\` • ${sourceLabel(track.source)}`,
    );

  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  if (position !== null) embed.setFooter({ text: `Posisi #${position} di antrian` });
  return embed;
}

export function playlistEmbed({ name, tracks, requester }) {
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  const preview = tracks.slice(0, 8).map((track, index) => trackLine(track, index + 1)).join('\n');
  const embed = new EmbedBuilder()
    .setColor(config.embed.success)
    .setAuthor({ name: 'Playlist ditambahkan' })
    .setTitle(truncate(name || 'Playlist', 80))
    .setDescription(`${preview}${tracks.length > 8 ? `\n… dan **${tracks.length - 8}** track lainnya` : ''}`)
    .addFields(
      { name: 'Jumlah', value: `${tracks.length} track`, inline: true },
      { name: 'Durasi', value: total ? formatDuration(total) : '—', inline: true },
      { name: 'Requester', value: `<@${requester}>`, inline: true },
    );

  const thumb = tracks.find((track) => track.thumbnail)?.thumbnail;
  if (thumb) embed.setThumbnail(thumb);
  return embed;
}

export function nowPlayingEmbed(player) {
  const track = player.current;
  if (!track) return infoEmbed('Nggak ada yang sedang diputar.');

  const embed = new EmbedBuilder()
    .setColor(config.embed.color)
    .setAuthor({ name: player.radio ? '🔴 Radio 24/7' : '🎶 Now Playing' })
    .setTitle(truncate(track.title, 90));

  if (track.url) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);

  const elapsed = player.elapsed;
  const bar = progressBar(elapsed, track.duration);
  embed.setDescription(
    track.isStream
      ? `🔴 **LIVE** • ${escapeMarkdown(track.author)}\n${bar}`
      : `${bar}\n\`${formatDuration(elapsed)} / ${formatDuration(track.duration)}\``,
  );

  embed.addFields(
    { name: 'Artist/Channel', value: escapeMarkdown(truncate(track.author, 40)), inline: true },
    { name: 'Volume', value: `${player.volume}%`, inline: true },
    { name: 'Loop', value: player.loop, inline: true },
  );

  if (track.requester) embed.setFooter({ text: `Diminta oleh ${player.guild.members.cache.get(track.requester)?.displayName ?? 'seseorang'}` });
  return embed;
}

export function queueEmbed(player, { page = 1, perPage = 10 } = {}) {
  const { queue } = player;
  if (!queue.length) {
    return infoEmbed(player.current ? 'Antrian kosong — tinggal lagu yang sedang diputar.' : 'Antrian kosong.');
  }

  const pages = Math.ceil(queue.length / perPage);
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * perPage;
  const slice = queue.slice(start, start + perPage);
  const totalDuration = queue.reduce((sum, track) => sum + (track.duration || 0), 0);

  return new EmbedBuilder()
    .setColor(config.embed.color)
    .setAuthor({ name: `Antrian • ${queue.length} track` })
    .setDescription(slice.map((track, index) => trackLine(track, start + index + 1)).join('\n'))
    .addFields(
      { name: 'Total durasi', value: totalDuration ? formatDuration(totalDuration) : 'LIVE', inline: true },
      { name: 'Loop', value: player.loop, inline: true },
      { name: 'Autoplay', value: player.autoplay ? 'on' : 'off', inline: true },
    )
    .setFooter({ text: `Halaman ${current}/${pages}` });
}

export function stationListEmbed(stations, { page = 1, perPage = 10 } = {}) {
  const pages = Math.max(1, Math.ceil(stations.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const slice = stations.slice((current - 1) * perPage, current * perPage);

  return new EmbedBuilder()
    .setColor(config.embed.color)
    .setAuthor({ name: `📻 Station radio (${stations.length})` })
    .setDescription(
      slice
        .map((station, index) => `\`${(current - 1) * perPage + index + 1}.\` **${station.name}**\n┗ \`${station.id}\`${station.custom ? ' • custom' : ''}`)
        .join('\n'),
    )
    .setFooter({ text: `Halaman ${current}/${pages} • pakai /radio start station:<id>` });
}
