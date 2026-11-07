import { ActivityType, Events } from 'discord.js';
import { config } from '../config.js';
import { clear247, getStation, list247 } from '../structures/RadioStore.js';
import { createLogger } from '../utils/logger.js';
import { whitelist } from '../whitelist.js';

const log = createLogger('ready');

/** Keluar dari server yang tidak terdaftar di whitelist lisensi. */
async function sweepUnauthorizedGuilds(client) {
  if (!config.whitelist.enabled || whitelist.openMode || !config.whitelist.leaveUnauthorized) return;

  const unauthorized = [...client.guilds.cache.values()].filter((guild) => !whitelist.isAllowed(guild.id));
  if (!unauthorized.length) return;

  log.warn(`${unauthorized.length} server tanpa lisensi terdeteksi saat boot, keluar...`);
  for (const guild of unauthorized) {
    await guild
      .leave()
      .then(() => log.info(`Keluar dari server tanpa lisensi: ${guild.name} (${guild.id})`))
      .catch((error) => log.warn(`Gagal keluar dari ${guild.id}:`, error.message));
  }
}

async function restoreRadioSessions(client) {
  const saved = list247();
  const entries = Object.entries(saved);
  if (!entries.length) return;

  log.info(`Memulihkan ${entries.length} sesi radio 24/7...`);

  for (const [guildId, session] of entries) {
    try {
      const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId));
      if (!guild) continue;

      const channel = guild.channels.cache.get(session.voiceChannelId) ?? (await guild.channels.fetch(session.voiceChannelId).catch(() => null));
      if (!channel?.isVoiceBased()) {
        log.warn(`[${guildId}] voice channel untuk radio sudah tidak ada, sesi dihapus.`);
        clear247(guildId);
        continue;
      }

      const station = getStation(session.stationId);
      if (!station) {
        log.warn(`[${guildId}] station "${session.stationId}" tidak ditemukan.`);
        continue;
      }

      const player = client.playerFor(guild);
      await player.join(channel);
      await player.startRadio(station);
      player.radio.since = Date.now();
      log.info(`[${guildId}] radio ${station.name} dipulihkan di #${channel.name}`);
    } catch (error) {
      log.error(`[${guildId}] gagal memulihkan radio: ${error.message}`);
    }
  }
}

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    log.info(`Login sebagai ${client.user.tag} • ${client.guilds.cache.size} server • ${client.commands.size} command`);

    client.user.setPresence({
      activities: [{ name: '/play • radio 24/7', type: ActivityType.Listening }],
      status: 'online',
    });

    await sweepUnauthorizedGuilds(client);

    if (config.radio.restoreOnBoot) await restoreRadioSessions(client);
  },
};
