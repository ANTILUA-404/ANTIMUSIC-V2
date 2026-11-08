/**
 * Static validation: syntax check every module, load commands/events,
 * and make sure the slash-command payloads are valid Discord API JSON.
 * Run with: npm run check
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/config.js';

const problems = [];
const notes = [];

const pass = (message) => console.log(`  \u001b[32m✓\u001b[0m ${message}`);
const fail = (message) => {
  problems.push(message);
  console.log(`  \u001b[31m✗\u001b[0m ${message}`);
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

console.log('\n1. Syntax check');
const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))];
let syntaxErrors = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    syntaxErrors += 1;
    fail(`Syntax error di ${path.relative(ROOT, file)}\n${String(error.stderr || error.message).slice(0, 400)}`);
  }
}
if (!syntaxErrors) pass(`${files.length} file lolos syntax check`);

console.log('\n2. Command payload');
const commandDir = path.join(ROOT, 'src', 'commands');
const commandFiles = fs.readdirSync(commandDir).filter((name) => name.endsWith('.js'));
const names = new Set();
for (const file of commandFiles) {
  try {
    const module = await import(pathToFileURL(path.join(commandDir, file)).href);
    const command = module.default;
    if (!command?.data || typeof command.execute !== 'function') {
      fail(`${file}: butuh "data" dan "execute"`);
      continue;
    }
    const json = command.data.toJSON();
    if (!json.name || !json.description) fail(`${file}: name/description kosong`);
    if (json.description.length > 100) fail(`${file}: description > 100 karakter`);
    if (names.has(json.name)) fail(`${file}: nama command duplikat "${json.name}"`);
    if (json.name !== file.replace(/\.js$/, '')) notes.push(`${file}: nama command "${json.name}" beda dari nama file`);
    JSON.stringify(json);
    names.add(json.name);
  } catch (error) {
    fail(`${file}: gagal di-import — ${error.message}`);
  }
}
if (!problems.length) pass(`${commandFiles.length} command valid: ${[...names].sort().join(', ')}`);

console.log('\n3. Event handlers');
const eventDir = path.join(ROOT, 'src', 'events');
const eventFiles = fs.readdirSync(eventDir).filter((name) => name.endsWith('.js'));
for (const file of eventFiles) {
  try {
    const module = await import(pathToFileURL(path.join(eventDir, file)).href);
    if (!module.default?.name || typeof module.default.execute !== 'function') {
      fail(`${file}: butuh "name" dan "execute"`);
    }
  } catch (error) {
    fail(`${file}: gagal di-import — ${error.message}`);
  }
}
if (!problems.length) pass(`${eventFiles.length} event handler valid`);

console.log('\n4. Binary dependencies');
if (process.argv.includes('--skip-binaries')) {
  console.log('  • dilewati (--skip-binaries)');
} else {
  try {
    const { config } = await import('../src/config.js');
    const { isFfmpegUsable } = await import('../src/utils/ffmpeg-install.js');

    const ffmpegBin = isFfmpegUsable(config.ffmpeg.bin)
      ? config.ffmpeg.bin
      : isFfmpegUsable('ffmpeg')
        ? 'ffmpeg'
        : null;

    if (!ffmpegBin) {
      fail('ffmpeg tidak ditemukan — jalankan: npm run install:ffmpeg');
    } else {
      const version = execFileSync(ffmpegBin, ['-hide_banner', '-version'], { encoding: 'utf8', timeout: 15_000 })
        .split('\n')[0]
        .trim();
      pass(`ffmpeg: ${version.slice(0, 60)}`);
    }

    const ytdlpVersion = execFileSync(config.ytdlp.bin, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim();
    pass(`yt-dlp: ${ytdlpVersion}`);
  } catch (error) {
    fail(`binary check gagal: ${error.message.split('\n')[0]}`);
  }
}

if (notes.length) {
  console.log('\nCatatan:');
  for (const note of notes) console.log(`  • ${note}`);
}

console.log('');
if (problems.length) {
  console.log(`\u001b[31m${problems.length} masalah ditemukan.\u001b[0m\n`);
  process.exit(1);
}
console.log('\u001b[32mSemua check lolos.\u001b[0m\n');
