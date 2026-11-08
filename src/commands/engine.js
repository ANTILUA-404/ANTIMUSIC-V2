import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/discord.js';
import { escapeMarkdown } from '../utils/format.js';

const fmtMs = (value) => (Number.isFinite(value) ? `${Math.round(value)} ms` : '—');
const fmtPct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');

export default {
  data: new SlashCommandBuilder()
    .setName('engine')
    .setDescription('Info & perbaikan engine audio (Lavalink / lokal)')
    .addSubcommand((sub) => sub.setName('status').setDescription('Lihat engine yang dipakai dan status node'))
    .addSubcommand((sub) => sub.setName('reconnect').setDescription('Coba sambungkan ulang ke node Lavalink')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'reconnect') {
      await interaction.deferReply();
      if (!config.audio.lavalink.enabled) {
        return interaction.editReply({ embeds: [errorEmbed('LAVALINK_HOST belum diisi, bot memakai engine lokal.')] });
      }

      const engine = client.audioEngine;
      if (engine?.name !== 'lavalink') {
        return interaction.editReply({
          embeds: [errorEmbed('Engine aktif bukan Lavalink. Set `AUDIO_ENGINE=lavalink` lalu restart bot.')],
        });
      }

      try {
        const nodes = [...engine.manager.nodeManager.nodes.values()];
        for (const node of nodes) {
          if (!node.connected) node.connect();
        }
        return interaction.editReply({
          embeds: [successEmbed(`Mencoba menyambung ulang ${nodes.length} node. Cek \`/engine status\` beberapa detik lagi.`)],
        });
      } catch (error) {
        return interaction.editReply({ embeds: [errorEmbed(`Reconnect gagal: ${escapeMarkdown(error.message)}`)] });
      }
    }

    // status
    const engine = client.audioEngine;
    if (!engine) {
      return interaction.reply({ embeds: [infoEmbed('Engine audio belum siap. Coba lagi sebentar.')], flags: 64 });
    }

    const status = engine.status();
    const embed = new EmbedBuilder()
      .setColor(config.embed.color)
      .setAuthor({ name: '🎛️ Audio Engine' })
      .setDescription(
        `**Aktif:** \`${status.name}\` ${status.ready ? '🟢' : '🔴'}\n` +
          `**Detail:** ${escapeMarkdown(status.detail)}\n` +
          `**Guild aktif:** ${status.guilds}`,
      );

    if (status.nodes?.length) {
      embed.addFields({
        name: 'Node Lavalink',
        value: status.nodes
          .map(
            (node) =>
              `\`${node.id}\` ${node.connected ? '🟢' : '🔴'} ${node.host}${node.secure ? ' (TLS)' : ''}\n` +
              `┗ players: ${node.players ?? '—'} • CPU: ${fmtPct(node.cpu)}`,
          )
          .join('\n')
          .slice(0, 1024),
      });
    }

    if (engine.name === 'lavalink') {
      const player = client.players.get(interaction.guild.id);
      const guildStatus = player ? engine.guildStatus(interaction.guild.id) : null;
      if (guildStatus) {
        embed.addFields({
          name: 'Server ini',
          value: `voice: ${guildStatus.connected ? 'tersambung' : 'terputus'} • node: \`${guildStatus.node ?? '—'}\` • ping: ${fmtMs(engine.manager.getPlayer(interaction.guild.id)?.ping?.lavalink)}`,
          inline: false,
        });
      }
    }

    embed.setFooter({
      text:
        engine.name === 'lavalink'
          ? 'Kualitas audio mengikuti bitrate voice channel + opusEncodingQuality di Lavalink'
          : 'Engine lokal: batas kualitas = bitrate voice channel Discord',
    });

    return interaction.reply({ embeds: [embed] });
  },
};
