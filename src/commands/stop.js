import { SlashCommandBuilder } from 'discord.js';
import { clear247 } from '../structures/RadioStore.js';
import { successEmbed } from '../utils/discord.js';
import { requirePlayer } from '../utils/guards.js';

export default {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop musik, kosongkan antrian, dan keluar dari voice'),
  async execute(interaction, client) {
    const player = requirePlayer(client, interaction.guild);
    const wasRadio = Boolean(player.radio);
    if (wasRadio) clear247(interaction.guild.id);

    player.stopRadio();
    player.stop();
    await player.destroy();

    await interaction.reply({
      embeds: [successEmbed(wasRadio ? 'Radio 24/7 dimatikan, bot keluar dari voice.' : 'Musik dihentikan dan bot keluar dari voice.')],
    });
  },
};
