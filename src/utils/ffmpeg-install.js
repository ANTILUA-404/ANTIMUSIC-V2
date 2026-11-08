import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { config, ROOT } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('ffmpeg');

/**
 * Sumber binary: release resmi paket `ffmpeg-static`.
 * Asset-nya berupa satu file binary yang di-gzip, contoh:
 *   ffmpeg-linux-x64.gz  /  ffmpeg-win32-x64.gz
 *
 * Kita unduh sendiri (bukan lewat install script npm) karena npm 11.7+
 * memblokir lifecycle script dependency secara default:
 *   npm warn allow-scripts ffmpeg-static@5.3.0 (install: node install.js)
 * Kalau script itu tidak jalan, binary-nya tidak pernah ada dan bot gagal
 * dengan "spawn .../ffmpeg-static/ffmpeg ENOENT".
 */
const FALLBACK_RELEASE = 'b6.1.1';
const RELEASES_BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download';

function releaseTag() {
  try {
    const pkgPath = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg['ffmpeg-static']?.['binary-release-tag'] || FALLBACK_RELEASE;
  } catch {
    return FALLBACK_RELEASE;
  }
}

/** Apakah binary ffmpeg di path ini benar-benar bisa dijalankan? */
export function isFfmpegUsable(bin = config.ffmpeg.bin) {
  if (!bin) return false;
  try {
    execFileSync(bin, ['-hide_banner', '-version'], {
      stdio: 'ignore',
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(target) {
  const release = releaseTag();
  const asset = `ffmpeg-${process.platform}-${process.arch}.gz`;
  const url = `${RELEASES_BASE}/${release}/${asset}`;
  log.info(`Mengunduh FFmpeg (${release}) dari ${url} ...`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} saat mengunduh ${asset}`);
  if (!response.body) throw new Error('Response kosong saat mengunduh FFmpeg');

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.download`;
  await pipeline(Readable.fromWeb(response.body), createGunzip(), fs.createWriteStream(temp));

  if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
  fs.renameSync(temp, target);
  return target;
}

/**
 * Memastikan FFmpeg tersedia, dengan urutan:
 *   1. FFMPEG_PATH di .env
 *   2. ./bin/ffmpeg  (hasil unduhan otomatis)
 *   3. `ffmpeg` dari PATH
 *   4. unduh ke ./bin/ffmpeg
 */
export async function ensureFfmpeg({ force = false } = {}) {
  if (!force && isFfmpegUsable(config.ffmpeg.bin)) return config.ffmpeg.bin;

  const explicit = process.env.FFMPEG_PATH?.trim();
  if (explicit && !force) {
    log.warn(`FFMPEG_PATH di-set ke "${explicit}" tapi binary tidak bisa dijalankan.`);
    log.warn('Hapus FFMPEG_PATH kalau mau bot mengunduh FFmpeg sendiri.');
    return null;
  }

  // VPS / image panel yang sudah punya ffmpeg sistem.
  if (!force && isFfmpegUsable('ffmpeg')) {
    config.ffmpeg.bin = 'ffmpeg';
    log.info('Memakai FFmpeg dari PATH.');
    return 'ffmpeg';
  }

  const target = path.join(config.paths.binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  try {
    await downloadTo(target);
    if (!isFfmpegUsable(target)) throw new Error('binary hasil unduhan tidak bisa dijalankan');
    config.ffmpeg.bin = target;
    log.info(`FFmpeg siap dipakai: ${target}`);
    return target;
  } catch (error) {
    log.error(`Gagal menyiapkan FFmpeg otomatis: ${error.message}`);
    log.error('Alternatif: install ffmpeg sistem lalu set FFMPEG_PATH di .env.');
    return null;
  }
}

export default ensureFfmpeg;
