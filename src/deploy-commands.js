import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './loaders.js';
import { syncCommands } from './utils/command-sync.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('deploy');

/**
 * Deploy manual.
 *
 * Sebenarnya TIDAK PERLU dijalankan lagi: bot mendaftarkan slash command
 * sendiri setiap kali start (lihat src/utils/command-sync.js).
 * Script ini berguna kalau mau memaksa daftar ulang sekarang juga.
 */
async function main() {
  if (!config.token) {
    log.error('DISCORD_TOKEN kosong. Isi di .env atau di tab Startup panel.');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await loadCommands(client);

  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(config.token);
  await ready;

  const result = await syncCommands(client, { force: true });

  for (const entry of result.results ?? []) {
    if (entry.error) log.error(`${entry.scope}: ${entry.error}`);
    else log.info(`${entry.scope}: ${entry.changed ? 'didaftarkan' : 'sudah sinkron'} (${entry.count ?? 0} command)`);
  }

  log.info('Selesai. Bot akan mendaftar ulang otomatis kalau command berubah.');
  client.destroy();
}

main().catch((error) => {
  log.error('Deploy command gagal:', error.message ?? error);
  process.exit(1);
});
