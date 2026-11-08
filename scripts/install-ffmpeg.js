#!/usr/bin/env node
/**
 * Unduh FFmpeg standalone ke ./bin (dipakai otomatis saat bot start).
 *
 *   node scripts/install-ffmpeg.js          # install kalau belum ada
 *   node scripts/install-ffmpeg.js --force  # unduh ulang
 */
import { config } from '../src/config.js';
import { createLogger } from '../src/utils/logger.js';
import { ensureFfmpeg, isFfmpegUsable } from '../src/utils/ffmpeg-install.js';

const log = createLogger('install');
const force = process.argv.includes('--force');

if (!force && isFfmpegUsable()) {
  log.info(`FFmpeg sudah tersedia: ${config.ffmpeg.bin}`);
  process.exit(0);
}

const result = await ensureFfmpeg({ force });
if (!result) {
  log.error('Gagal menyiapkan FFmpeg.');
  process.exit(1);
}
log.info(`Selesai. FFmpeg ada di ${result}`);
