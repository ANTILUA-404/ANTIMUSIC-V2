import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';

const CATEGORIES = [
  { name: '🎵 Pemutaran', commands: ['play', 'pause', 'resume', 'skip', 'stop', 'seek', 'jump'] },
  { name: '📻 Radio 24/7', commands: ['radio'] },
  { name: '📋 Antrian', commands: ['queue', 'nowplaying', 'remove', 'shuffle', 'loop', 'autoplay'] },
  { name: '🎛️ Audio', commands: ['volume', 'filter'] },
  { name: '🔌 Lainnya', commands: ['disconnect', 'help'] },
];

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('Lihat semua command bot'),

  async execute(interaction, client) {
    const embed = new EmbedBuilder()
      .setColor(config.embed.color)
      .setAuthor({ name: 'Music Bot — Command List' })
      .setDescription(
        '**Sumber yang didukung:** YouTube, Spotify, SoundCloud, Bandcamp, Twitch, Vimeo, file audio langsung, ' +
          'dan ribuan situs lain via yt-dlp.\n' +
          '**Radio 24/7:** bot tetap di voice channel, auto-reconnect, dan balik lagi setelah restart.',
      );

    for (const category of CATEGORIES) {
      const lines = category.commands
        .map((name) => client.commands.get(name))
        .filter(Boolean)
        .map((command) => {
          const json = command.data.toJSON();
          const options = (json.options ?? [])
            .filter((option) => option.type === 3 || option.type === 4 || option.type === 5 || option.type === 7)
            .map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`))
            .join(' ');
          const subcommands = (json.options ?? []).filter((option) => option.type === 1).map((option) => option.name);
          const suffix = subcommands.length ? ` <${subcommands.join('|')}>` : options ? ` ${options}` : '';
          return `\`/${json.name}${suffix}\` — ${json.description}`;
        });

      if (lines.length) embed.addFields({ name: category.name, value: lines.join('\n').slice(0, 1024) });
    }

    embed.setFooter({ text: 'Tip: /radio list buat lihat semua station • /play <judul> buat cari lagu' });
    await interaction.reply({ embeds: [embed] });
  },
};
