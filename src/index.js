import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config, ROOT } from './config.js';
import { startHealthServer } from './health.js';
import { MusicClient } from './structures/MusicClient.js';
import { createLogger } from './utils/logger.js';
import { ensureFfmpeg } from './utils/ffmpeg-install.js';
import { ensureYtdlp } from './utils/ytdlp-install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('main');
const DRY_RUN = process.argv.includes('--dry-run');

async function loadCommands(client) {
  const dir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    const command = module.default;
    if (!command?.data || typeof command.execute !== 'function') {
      log.warn(`Command ${file} dilewati (butuh "data" dan "execute").`);
      continue;
    }
    client.commands.set(command.data.name, command);
  }
  log.info(`${client.commands.size} command dimuat.`);
}

async function loadEvents(client) {
  const dir = path.join(__dirname, 'events');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    const event = module.default;
    if (!event?.name || typeof event.execute !== 'function') {
      log.warn(`Event ${file} dilewati.`);
      continue;
    }
    const handler = (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((error) =>
        log.error(`Event ${event.name} error:`, error),
      );
    };
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  }
  log.info(`${files.length} event handler terpasang.`);
}

async function shutdown(client, signal) {
  log.info(`Menerima ${signal}, mematikan bot...`);
  for (const player of [...client.players.values()]) {
    try {
      await player.destroy();
    } catch {
      /* ignore */
    }
  }
  try {
    client.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

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
