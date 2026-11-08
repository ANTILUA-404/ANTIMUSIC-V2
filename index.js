/**
 * ANTIMUSIC entry point.
 *
 * Pterodactyl (dan process manager lain) cukup menjalankan `node index.js`.
 *
 * File ini sengaja dibuat "bodoh tapi tahan banting": sebelum memuat bot,
 * dia memastikan dependency sudah ada. Jadi kalau kamu upload project lalu
 * langsung tekan Start di egg Node.js generik (yang tidak menjalankan
 * `npm install`), bot tetap bisa jalan sendiri.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function ensureDependencies() {
  if (process.env.ANTIMUSIC_SKIP_AUTOINSTALL === '1') return;
  if (fs.existsSync(path.join(ROOT, 'node_modules', 'discord.js', 'package.json'))) return;

  console.log('[bootstrap] node_modules belum ada — menjalankan npm install...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    execFileSync(npm, ['install', '--no-audit', '--no-fund'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 15 * 60 * 1000,
      env: process.env,
      // Node 20+ menolak spawn .cmd tanpa shell di Windows (EINVAL).
      shell: process.platform === 'win32',
    });
  } catch (error) {
    console.error('[bootstrap] npm install gagal:', error.message);
    console.error('[bootstrap] Jalankan manual di console panel: npm install');
    process.exit(1);
  }
}

ensureDependencies();

/**
 * Dynamic import (bukan static) karena static import dieksekusi SEBELUM
 * ensureDependencies().
 *
 * Sengaja TANPA top-level await: sebagian panel (egg Node.js generik) menjalankan
 * entrypoint lewat `ts-node --esm`, dan TLA bisa gagal di jalur itu.
 */
(async () => {
  await import('./src/index.js');
})().catch((error) => {
  console.error('[bootstrap] Gagal memuat bot:', error);
  process.exit(1);
});
