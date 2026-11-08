import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('yt-dlp');

// Dua kanal: rilis stabil, lalu nightly. Kalau GitHub sedang lemot/504,
// kanal kedua sering masih jalan.
const CHANNELS = [
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download',
  'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download',
];

async function fetchWithTimeout(url, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'follow', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function isYtdlpUsable(bin = config.ytdlp.bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(target) {
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const temp = `${target}.download`;
  const errors = [];

  for (const base of CHANNELS) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        log.info(`Mengunduh yt-dlp (percobaan ${attempt}) dari ${base} ...`);
        const response = await fetchWithTimeout(`${base}/${asset}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error('response kosong');

        fs.mkdirSync(path.dirname(target), { recursive: true });
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));

        if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
        fs.renameSync(temp, target);
        return target;
      } catch (error) {
        errors.push(`${new URL(base).host}: ${error.message}`);
        try {
          fs.rmSync(temp, { force: true });
        } catch {
          /* ignore */
        }
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  throw new Error(`semua sumber gagal (${errors.join('; ')})`);
}

/**
 * Makes sure a working yt-dlp exists.
 *
 * Pterodactyl containers usually do not ship yt-dlp and you cannot apt-get there,
 * so on first boot we drop the standalone binary into ./bin and use it from then on.
 */
export async function ensureYtdlp({ force = false } = {}) {
  if (!force && isYtdlpUsable()) return config.ytdlp.bin;

  const explicit = process.env.YTDLP_PATH?.trim();
  if (explicit && !force) {
    log.warn(`YTDLP_PATH di-set ke "${explicit}" tapi binary tidak bisa dijalankan.`);
    return null;
  }

  if (!config.ytdlp.autoInstall) {
    log.warn('yt-dlp tidak ditemukan dan YTDLP_AUTO_INSTALL=false. Bot tidak akan bisa memutar audio.');
    return null;
  }

  const target = path.join(config.paths.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  try {
    await downloadTo(target);
    if (!isYtdlpUsable(target)) throw new Error('binary hasil unduhan tidak bisa dijalankan');
    config.ytdlp.bin = target;
    log.info(`yt-dlp siap dipakai: ${target}`);
    return target;
  } catch (error) {
    if (config.audio.lavalink.enabled) {
      log.warn(`yt-dlp tidak tersedia (${error.message}) — TIDAK masalah: Lavalink aktif, jadi pencarian & pemutaran tetap jalan.`);
      log.warn('yt-dlp hanya dipakai kalau bot turun ke engine lokal.');
    } else {
      log.error(`Gagal menyiapkan yt-dlp otomatis: ${error.message}`);
      log.error('Install manual lalu set YTDLP_PATH di .env (lihat TUTORIAL.md).');
    }
    return null;
  }
}

export default ensureYtdlp;
