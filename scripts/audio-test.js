/**
 * End-to-end audio test — tanpa Discord, tanpa token.
 * Memastikan yt-dlp + FFmpeg benar-benar mengeluarkan PCM 48kHz stereo.
 *
 *   node scripts/audio-test.js                       (default: YouTube live + radio SomaFM)
 *   node scripts/audio-test.js "<url>" 8             (url custom, 8 detik)
 */
import { spawn } from 'node:child_process';
import { config } from '../src/config.js';
import { DEFAULT_STATIONS } from '../src/data/stations.js';
import { spawnYtdlpAudio } from '../src/utils/ytdlp.js';

const target = process.argv[2] || 'https://www.youtube.com/watch?v=rFZHOHl-L8A';
const seconds = Number(process.argv[3]) || 6;
const EXPECTED_BYTES_PER_SEC = 48_000 * 2 * 2; // 48kHz, stereo, 16-bit

const ffmpegOutput = () => [
  '-vn',
  '-f',
  's16le',
  '-ar',
  String(config.ffmpeg.sampleRate),
  '-ac',
  String(config.ffmpeg.channels),
  'pipe:1',
];

function measure(stream, label) {
  return new Promise((resolve) => {
    let bytes = 0;
    let chunks = 0;
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      chunks += 1;
    });
    stream.on('error', (error) => console.log(`  ! stream error: ${error.message}`));
    setTimeout(() => {
      const kbps = ((bytes * 8) / seconds / 1000).toFixed(0);
      const expected = ((EXPECTED_BYTES_PER_SEC * seconds) / 1024).toFixed(0);
      const ok = bytes > EXPECTED_BYTES_PER_SEC * seconds * 0.5;
      console.log(
        `  ${ok ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${label}: ${(bytes / 1024).toFixed(0)} KB dalam ${seconds}s ` +
          `(${chunks} chunk, ~${kbps} kbps, target ~${expected} KB)`,
      );
      resolve(ok);
    }, seconds * 1000);
  });
}

async function testYtdlpPipeline() {
  console.log(`\n\u001b[1m1) YouTube via yt-dlp pipe\u001b[0m\n   ${target}`);
  const downloader = spawnYtdlpAudio(target);
  const ffmpeg = spawn(config.ffmpeg.bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...ffmpegOutput()], {
    windowsHide: true,
  });
  downloader.child.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdin.on('error', () => {});
  ffmpeg.stderr.setEncoding('utf8');
  let ffmpegError = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegError += chunk;
  });

  const ok = await measure(ffmpeg.stdout, 'PCM output');
  if (!ok && ffmpegError) console.log(`   ffmpeg: ${ffmpegError.slice(-300).trim()}`);
  if (!ok && downloader.stderr) console.log(`   yt-dlp: ${downloader.stderr.slice(-300).trim()}`);

  downloader.kill();
  ffmpeg.kill('SIGKILL');
  return ok;
}

async function testDirectRadio() {
  const station = DEFAULT_STATIONS.find((item) => item.kind === 'url') ?? DEFAULT_STATIONS[0];
  console.log(`\n\u001b[1m2) Direct radio stream via FFmpeg\u001b[0m\n   ${station.name} — ${station.url}`);
  const ffmpeg = spawn(
    config.ffmpeg.bin,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_delay_max',
      '5',
      '-i',
      station.url,
      ...ffmpegOutput(),
    ],
    { windowsHide: true },
  );
  console.log('DEBUG pid', ffmpeg.pid, 'args', ffmpeg.spawnargs.slice(1).join(' '));
  ffmpeg.stderr.setEncoding('utf8');
  let ffmpegError = '';
  ffmpeg.stderr.on('data', (chunk) => {
    ffmpegError += chunk;
  });

  const ok = await measure(ffmpeg.stdout, 'PCM output');
  if (!ok && ffmpegError) console.log(`   ffmpeg: ${ffmpegError.slice(-300).trim()}`);
  ffmpeg.kill('SIGKILL');
  return ok;
}

const results = [await testYtdlpPipeline(), await testDirectRadio()];
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} pipeline audio jalan.${passed === results.length ? ' \u001b[32mSiap dipakai.\u001b[0m' : ''}\n`);
process.exit(passed === results.length ? 0 : 1);
