import { Events, MessageFlags } from 'discord.js';
import { errorEmbed } from '../utils/discord.js';
import { UserError } from '../utils/guards.js';
import { createLogger } from '../utils/logger.js';
import { denialPayload, whitelist } from '../whitelist.js';

const log = createLogger('interaction');

export default {
  name: Events.InteractionCreate,

  async execute(interaction, client) {
    // Licence gate - server yang belum terdaftar tidak boleh memakai command apa pun.
    if (interaction.guildId && !whitelist.isAllowed(interaction.guildId)) {
      if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
      if (interaction.isRepliable()) {
        await interaction.reply(denialPayload(interaction.guild, { ephemeral: true })).catch(() => {});
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return interaction.respond([]).catch(() => {});
      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        log.debug('autocomplete error:', error.message);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const startedAt = Date.now();
    try {
      await command.execute(interaction, client);
      log.debug(`/${interaction.commandName} oleh ${interaction.user.tag} (${Date.now() - startedAt}ms)`);
    } catch (error) {
      const isUserError = error instanceof UserError;
      if (!isUserError) log.error(`/${interaction.commandName} gagal:`, error);

      const message = isUserError
        ? error.message
        : 'Ada error waktu jalanin command ini. Cek console bot buat detailnya.';

      const payload = { embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (replyError) {
        log.debug('gagal kirim pesan error:', replyError.message);
      }
    }
  },
};
