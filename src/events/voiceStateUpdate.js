import { Events } from 'discord.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('voice-state');

export default {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState, client) {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;

    const player = client.players.get(guild.id);
    if (!player?.connected) return;

    // Bot itself got disconnected / kicked.
    if (newState.id === client.user.id) {
      if (!newState.channelId && !player.radio) {
        log.debug(`[${guild.id}] bot keluar dari voice, cleanup.`);
        await player.destroy();
      }
      return;
    }

    const botChannelId = guild.members.me?.voice?.channelId;
    if (!botChannelId) return;

    const channel = guild.channels.cache.get(botChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((member) => !member.user.bot).size;
    if (humans > 0 || player.radio) return;

    // Everyone left - wait a bit in case they come right back.
    setTimeout(async () => {
      const livePlayer = client.players.get(guild.id);
      if (!livePlayer?.connected || livePlayer.radio) return;
      const currentChannel = guild.members.me?.voice?.channel;
      if (!currentChannel) return;
      const stillEmpty = currentChannel.members.filter((member) => !member.user.bot).size === 0;
      if (stillEmpty) {
        log.info(`[${guild.id}] channel kosong, bot keluar.`);
        await livePlayer.destroy();
      }
    }, 30_000);
  },
};
