import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { startHealthServer } from './health.js';
import { loadCommands, loadEvents } from './loaders.js';
import { MusicClient } from './structures/MusicClient.js';
import { ensureFfmpeg } from './utils/ffmpeg-install.js';
import { createLogger } from './utils/logger.js';
import { ensureYtdlp } from './utils/ytdlp-install.js';

const log = createLogger('main');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new MusicClient();
  await loadCommands(client);
  await loadEvents(client);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  if (DRY_RUN) {
    log.info('Dry-run: command & event berhasil dimuat, skip login.');
    for (const command of client.commands.values()) {
      const json = command.data.toJSON();
      log.info(`  /${json.name} — ${json.description}`);
    }
    client.destroy();
    return;
  }

  if (!config.token) {
    log.error('DISCORD_TOKEN kosong. Copy .env.example jadi .env lalu isi token-nya.');
    process.exit(1);
  }

  // FFmpeg dulu: yt-dlp butuh tahu lokasinya untuk stream live/HLS.
  await ensureFfmpeg();
  await ensureYtdlp();
  startHealthServer(client, { version: pkg.version });

  client.on('error', (error) => log.error('Discord client error:', error.message));
  client.on('warn', (message) => log.warn('Discord warn:', message));

  process.on('SIGINT', () => shutdown(client, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(client, 'SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason));
  process.on('uncaughtException', (error) => log.error('Uncaught exception:', error));

  await client.login(config.token);
}

main().catch((error) => {
  log.error('Gagal start bot:', error);
  process.exit(1);
});
