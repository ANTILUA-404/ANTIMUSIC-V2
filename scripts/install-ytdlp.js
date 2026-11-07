#!/usr/bin/env node
/**
 * Unduh yt-dlp standalone ke ./bin (dipakai otomatis saat bot pertama kali start).
 *
 *   node scripts/install-ytdlp.js          # install kalau belum ada
 *   node scripts/install-ytdlp.js --force  # unduh ulang (mis. setelah update)
 */
import { config } from '../src/config.js';
import { createLogger } from '../src/utils/logger.js';
import { ensureYtdlp, isYtdlpUsable } from '../src/utils/ytdlp-install.js';

const log = createLogger('install');
const force = process.argv.includes('--force');

if (!force && isYtdlpUsable()) {
  log.info(`yt-dlp sudah tersedia: ${config.ytdlp.bin}`);
  process.exit(0);
}

const result = await ensureYtdlp({ force });
if (!result) {
  log.error('Gagal menyiapkan yt-dlp.');
  process.exit(1);
}
log.info(`Selesai. yt-dlp ada di ${result}`);
