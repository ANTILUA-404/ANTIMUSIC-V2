/**
 * Dijalankan otomatis setelah `npm install`.
 *
 * Tujuan: siapkan FFmpeg + yt-dlp tanpa bergantung pada install script
 * dependency (yang diblokir npm 11.7+ / panel Pterodactyl).
 *
 * Script ini TIDAK PERNAH gagal — kalau unduhan gagal, `npm install`
 * tetap sukses dan bot akan mencoba lagi saat start.
 */
const silent = process.env.CI || process.env.ANTIMUSIC_SKIP_POSTINSTALL === '1';

if (silent) {
  console.log('[postinstall] dilewati (CI / ANTIMUSIC_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const { createLogger } = await import('../src/utils/logger.js');
const log = createLogger('postinstall');

for (const [label, loader] of [
  ['FFmpeg', () => import('../src/utils/ffmpeg-install.js').then((m) => m.ensureFfmpeg())],
  ['yt-dlp', () => import('../src/utils/ytdlp-install.js').then((m) => m.ensureYtdlp())],
]) {
  try {
    const result = await loader();
    if (result) log.info(`${label}: siap (${result})`);
    else log.warn(`${label}: belum tersedia, akan dicoba lagi saat bot start`);
  } catch (error) {
    log.warn(`${label}: ${error.message}`);
  }
}

process.exit(0);
