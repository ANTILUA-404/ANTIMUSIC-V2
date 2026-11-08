/**
 * Environment doctor — cek semua prasyarat sebelum jalanin bot.
 * Run with: npm run doctor
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';

const lines = [];
const add = (status, label, detail = '') => lines.push({ status, label, detail });

const which = (bin) => {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(cmd, [bin], { encoding: 'utf8', timeout: 5000 }).split(/\r?\n/)[0].trim();
  } catch {
    return null;
  }
};

// Node
const major = Number(process.versions.node.split('.')[0]);
add(major >= 18 ? 'ok' : 'bad', `Node.js ${process.versions.node}`, major >= 18 ? '' : 'butuh >= 18.17');

// ffmpeg
const { isFfmpegUsable } = await import('../src/utils/ffmpeg-install.js');
const ffmpegPath = config.ffmpeg.bin;
if (isFfmpegUsable(ffmpegPath)) {
  const out = execFileSync(ffmpegPath, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 15_000 });
  const version = out.split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
  add('ok', `FFmpeg ${version}`, ffmpegPath);
} else if (isFfmpegUsable('ffmpeg')) {
  add('ok', 'FFmpeg dari PATH', 'ffmpeg');
} else {
  add('bad', 'FFmpeg tidak ditemukan', 'jalankan: npm run install:ffmpeg');
}

// yt-dlp
try {
  const version = execFileSync(config.ytdlp.bin, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim();
  add('ok', `yt-dlp ${version}`, config.ytdlp.bin);
} catch {
  add('bad', 'yt-dlp tidak ditemukan', 'install: winget install yt-dlp / pip install -U yt-dlp / brew install yt-dlp');
}

// token
if (config.token) {
  const looksValid = /^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(config.token) || config.token.length > 50;
  add(looksValid ? 'ok' : 'warn', 'DISCORD_TOKEN terisi', looksValid ? 'format wajar' : 'format token kelihatan aneh');
} else {
  add('bad', 'DISCORD_TOKEN kosong', 'copy .env.example ke .env lalu isi');
}

if (config.clientId) add('ok', 'CLIENT_ID terisi', config.clientId);
else add('warn', 'CLIENT_ID kosong', 'deploy-commands akan ambil id dari token');

if (config.guildId) add('ok', 'GUILD_ID terisi', 'slash command langsung aktif di guild ini');
else add('warn', 'GUILD_ID kosong', 'command global butuh sampai 1 jam muncul');

// Spotify
if (config.spotify.enabled) add('ok', 'Spotify credentials terisi', 'playlist/album Spotify didukung penuh');
else add('warn', 'Spotify credentials kosong', 'masih jalan via halaman embed (maks 50 track/playlist)');

// Audio engine
const lavalink = config.audio.lavalink;
if (config.audio.engine === 'local') {
  add('ok', 'Audio engine: lokal', 'yt-dlp + FFmpeg (tanpa server tambahan)');
} else if (!lavalink.enabled) {
  add('ok', 'Audio engine: lokal', 'LAVALINK_HOST kosong -> engine lokal');
} else {
  const nodes = lavalink.nodes.map((node) => `${node.host}:${node.port}${node.secure ? ' (TLS)' : ''}`).join(', ');
  add('ok', `Audio engine: ${config.audio.engine}`, `node: ${nodes}`);
  if (config.audio.fallbackLocal) add('ok', 'Fallback lokal aktif', 'kalau Lavalink mati, bot tetap bunyi');
  else add('warn', 'Fallback lokal MATI', 'bot berhenti kalau Lavalink tidak tersedia');
}

// Opus
try {
  await import('opusscript');
  add('ok', 'Opus encoder (opusscript)', 'pure JS, tidak butuh native build / node-gyp');
} catch {
  add('bad', 'Tidak ada opus encoder', 'npm install opusscript');
}

// Whitelist
if (config.whitelist.enabled) {
  const fromEnv = config.whitelist.guildIds.length;
  add(
    fromEnv ? 'ok' : 'warn',
    `Whitelist lisensi AKTIF (${fromEnv} dari .env)`,
    fromEnv ? 'server lain akan ditolak' : 'daftar kosong = mode terbuka, isi WHITELIST_GUILD_IDS',
  );
} else {
  add('warn', 'Whitelist lisensi mati', 'WHITELIST_ENABLED=false - semua server bebas memakai bot');
}

// data dir
try {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.accessSync(config.dataDir, fs.constants.W_OK);
  add('ok', 'Folder data bisa ditulis', config.dataDir);
} catch (error) {
  add('bad', 'Folder data tidak bisa ditulis', error.message);
}

const icon = { ok: '\u001b[32m✓\u001b[0m', warn: '\u001b[33m!\u001b[0m', bad: '\u001b[31m✗\u001b[0m' };

console.log(`\n\u001b[1mMusic Bot — Environment Check\u001b[0m`);
console.log(`\u001b[90m${os.platform()} ${os.arch()} • ${ROOT}\u001b[0m\n`);
for (const line of lines) {
  console.log(`  ${icon[line.status]} ${line.label}`);
  if (line.detail) console.log(`    \u001b[90m${line.detail}\u001b[0m`);
}

const bad = lines.filter((line) => line.status === 'bad').length;
const warn = lines.filter((line) => line.status === 'warn').length;
console.log(`\n${bad ? `\u001b[31m${bad} masalah kritis\u001b[0m` : '\u001b[32mSiap jalan\u001b[0m'}${warn ? ` • ${warn} peringatan` : ''}\n`);
process.exit(bad ? 1 : 0);
