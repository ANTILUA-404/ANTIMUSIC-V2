import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('yt-dlp');

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

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
  const url = `${RELEASE_BASE}/${asset}`;
  log.info(`Mengunduh yt-dlp dari ${url} ...`);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} saat mengunduh yt-dlp`);
  if (!response.body) throw new Error('Response kosong saat mengunduh yt-dlp');

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.download`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));

  if (process.platform !== 'win32') fs.chmodSync(temp, 0o755);
  fs.renameSync(temp, target);
  return target;
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
    log.error(`Gagal menyiapkan yt-dlp otomatis: ${error.message}`);
    log.error('Install manual lalu set YTDLP_PATH di .env (lihat README).');
    return null;
  }
}

export default ensureYtdlp;
