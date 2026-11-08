import fs from 'node:fs';
import path from 'node:path';
import { config, envFile, ROOT } from './config.js';
import { startHealthServer } from './health.js';
import { loadCommands, loadEvents } from './loaders.js';
import { MusicClient } from './structures/MusicClient.js';
import { ensureFfmpeg } from './utils/ffmpeg-install.js';
import { createLogger } from './utils/logger.js';
import { ensureYtdlp } from './utils/ytdlp-install.js';

const log = createLogger('main');
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Coba unduh yt-dlp lagi secara berkala (5, 10, 15, ... menit, maks 8x).
 *
 * Hanya relevan kalau Lavalink aktif: tanpa yt-dlp bot tetap bisa mencari dan
 * memutar lewat Lavalink. Kalau GitHub sedang 504, ini yang menyembuhkan sendiri
 * tanpa perlu restart.
 */
function scheduleYtdlpRetry(attempt) {
  if (attempt > 8) {
    log.warn('Berhenti mencoba unduh yt-dlp. Bot tetap jalan lewat Lavalink.');
    return;
  }

  const delayMs = Math.min(30 * 60_000, attempt * 5 * 60_000);
  log.info(`yt-dlp belum ada, coba lagi dalam ${Math.round(delayMs / 60_000)} menit.`);

  const timer = setTimeout(async () => {
    try {
      const bin = await ensureYtdlp();
      if (bin) log.info(`yt-dlp berhasil diunduh (percobaan ${attempt}): ${bin}`);
      else scheduleYtdlpRetry(attempt + 1);
    } catch {
      scheduleYtdlpRetry(attempt + 1);
    }
  }, delayMs);

  timer.unref?.();
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
  log.info(envFile ? `Konfigurasi: ${envFile}` : 'Konfigurasi: tidak ada .env, memakai env panel.');

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
    log.error('DISCORD_TOKEN kosong.');
    log.error('Di panel: File Manager -> buat file .env di root server -> isi DISCORD_TOKEN=token_kamu');
    log.error('Tidak perlu mengubah Startup Command.');
    process.exit(1);
  }

  // FFmpeg dulu: yt-dlp butuh tahu lokasinya untuk stream live/HLS.
  await ensureFfmpeg();

  // Kalau Lavalink aktif, yt-dlp tidak dipakai untuk cari/putar apa pun.
  // Jangan tahan startup karena unduhan yang lambat atau kena 504.
  if (config.audio.lavalink.enabled && config.audio.engine !== 'local') {
    // Tidak menahan startup. Kalau gagal (mis. GitHub 504), coba lagi berkala
    // di background sampai berhasil — tanpa perlu restart bot.
    ensureYtdlp()
      .then((bin) => {
        if (!bin) scheduleYtdlpRetry(1);
      })
      .catch(() => scheduleYtdlpRetry(1));
  } else {
    await ensureYtdlp();
  }
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
