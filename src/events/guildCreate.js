import { Events } from 'discord.js';
import { config } from '../config.js';
import { syncCommands } from '../utils/command-sync.js';
import { createLogger } from '../utils/logger.js';
import { denialPayload, whitelist } from '../whitelist.js';

const log = createLogger('guild-create');

export default {
  name: Events.GuildCreate,

  async execute(guild, client) {
    if (whitelist.isAllowed(guild.id)) {
      log.info(`Bot ditambahkan ke server berlisensi: ${guild.name} (${guild.id})`);
      // Daftarkan slash command khusus guild ini supaya langsung muncul (tanpa nunggu global).
      await syncCommands(client, { guildIds: [guild.id] });
      return;
    }

    log.warn(`Bot ditambahkan ke server TANPA lisensi: ${guild.name} (${guild.id})`);

    try {
      const me = guild.members.me ?? (await guild.members.fetchMe());
      const channel =
        guild.systemChannel ??
        guild.channels.cache.find(
          (candidate) =>
            candidate.isTextBased() &&
            !candidate.isDMBased() &&
            candidate.permissionsFor(me)?.has('SendMessages'),
        );

      if (channel?.isTextBased()) await channel.send(denialPayload(guild));
    } catch (error) {
      log.debug('Gagal kirim panel penolakan:', error.message);
    }

    if (config.whitelist.leaveUnauthorized) {
      await guild
        .leave()
        .then(() => log.info(`Keluar dari server tanpa lisensi: ${guild.name}`))
        .catch((error) => log.warn(`Gagal keluar dari ${guild.id}:`, error.message));
    }
  },
};
