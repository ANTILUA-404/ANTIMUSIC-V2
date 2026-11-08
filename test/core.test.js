import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';

import {
  escapeMarkdown,
  formatDuration,
  parseDuration,
  playlistDuration,
  progressBar,
  truncate,
} from '../src/utils/format.js';
import { parseTimeInput } from '../src/utils/guards.js';
import { FILTERS } from '../src/audio/filters.js';
import { stationToTrack } from '../src/structures/RadioStore.js';
import { Track } from '../src/structures/Track.js';
import { baseUrl, normalizeNode, probeLavalink } from '../src/audio/lavalink-node.js';

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(Number.NaN), 'LIVE');
  assert.equal(formatDuration(-5), 'LIVE');
});

test('parseDuration', () => {
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1:02:05'), 3725);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('abc'), null);
});

test('progressBar', () => {
  assert.equal(progressBar(0, 0), '🔴 LIVE');
  assert.equal(progressBar(100, 200).includes('🔘'), true);
  assert.equal(progressBar(0, 200).startsWith('🔘'), true);
  assert.equal(progressBar(200, 200).endsWith('🔘'), true);
});

test('truncate & escapeMarkdown', () => {
  assert.equal(truncate('hello world', 5), 'hell…');
  assert.equal(truncate('  spaced   out  '), 'spaced out');
  assert.equal(escapeMarkdown('*NSYNC_x'), '\\*NSYNC\\_x');
});

test('playlistDuration sums only finite durations', () => {
  assert.equal(playlistDuration([{ duration: 10 }, { duration: 5 }, { duration: Number.NaN }]), 15);
});

test('parseTimeInput handles mm:ss', () => {
  assert.equal(parseTimeInput('1:30'), 90);
  assert.equal(parseTimeInput('90'), 90);
  assert.equal(parseTimeInput('1:02:03'), 3723);
  assert.equal(parseTimeInput('x'), null);
  assert.equal(parseTimeInput('1:2:3:4'), null);
});

test('Track marks zero-duration items as live streams', () => {
  const live = Track.fromYtdlp(
    { title: 'radio', url: 'https://youtu.be/x', duration: 0, author: 'a', source: 'youtube', isLive: true },
    'u1',
  );
  assert.equal(live.isStream, true);
  assert.equal(live.stream.kind, 'ytdlp');

  const song = Track.fromYtdlp(
    { title: 'song', url: 'https://youtu.be/y', duration: 200, author: 'a', source: 'youtube', isLive: false },
    'u1',
  );
  assert.equal(song.isStream, false);
});

test('Track.fromDirectUrl uses ffmpeg-direct stream kind', () => {
  const track = Track.fromDirectUrl('https://ice2.somafm.com/groovesalad-128-mp3', { title: 'Groove Salad' });
  assert.equal(track.stream.kind, 'url');
  assert.equal(track.isStream, true);
});

test('ensurePlayable is a no-op for already playable tracks', async () => {
  const track = Track.fromDirectUrl('https://example.com/a.mp3');
  const same = await track.ensurePlayable();
  assert.equal(same, track);
  assert.equal(track.stream.kind, 'url');
});

test('stationToTrack maps station kind to stream kind', () => {
  const direct = stationToTrack({ id: 'a', name: 'A', url: 'https://x/y.mp3', kind: 'url' });
  assert.equal(direct.stream.kind, 'url');
  assert.equal(direct.source, 'radio');

  const yt = stationToTrack({ id: 'b', name: 'B', url: 'https://youtube.com/watch?v=x', kind: 'ytdlp' });
  assert.equal(yt.stream.kind, 'ytdlp');
});

test('all audio filters are non-empty strings except none', () => {
  assert.equal(FILTERS.none.ffmpeg, null);
  for (const [name, filter] of Object.entries(FILTERS)) {
    if (name === 'none') continue;
    assert.equal(typeof filter.ffmpeg, 'string', `${name}.ffmpeg harus string`);
    assert.ok(filter.ffmpeg.length > 3, `${name} filter terlalu pendek`);
    assert.equal(typeof filter.lavalink, 'function', `${name}.lavalink harus fungsi`);
  }
});

test('loadCommands memuat seluruh command dari folder commands', async () => {
  const { loadCommands } = await import('../src/loaders.js');
  const fakeClient = { commands: new Map() };
  await loadCommands(fakeClient);
  const expected = fs.readdirSync(new URL('../src/commands', import.meta.url)).filter((f) => f.endsWith('.js')).length;
  assert.equal(fakeClient.commands.size, expected);
  assert.ok(fakeClient.commands.has('play'));
  assert.ok(fakeClient.commands.has('radio'));
});

test('syncCommands tidak error kalau client belum siap', async () => {
  const { syncCommands } = await import('../src/utils/command-sync.js');
  const result = await syncCommands({ commands: new Map() });
  assert.equal(result.skipped, true);
});

test('syncCommands mendaftar per-guild dan tidak mengulang saat payload sama', async () => {
  const { syncCommands } = await import('../src/utils/command-sync.js');
  const calls = [];
  const fakeClient = {
    application: {
      commands: {
        set: async (body, scope) => {
          calls.push({ scope: scope ?? 'global', count: body.length });
        },
      },
    },
    guilds: { cache: new Map([['111', {}], ['222', {}]]) },
    commands: new Map([
      ['play', { data: { toJSON: () => ({ name: 'play', description: 'putar' }) } }],
      ['stop', { data: { toJSON: () => ({ name: 'stop', description: 'stop' }) } }],
    ]),
  };

  await syncCommands(fakeClient, { force: true });
  assert.equal(calls.length, 2, 'harus daftar ke 2 guild');
  assert.deepEqual(calls.map((c) => c.scope).sort(), ['111', '222']);
  assert.equal(calls[0].count, 2);

  // Panggilan kedua dengan payload identik harus dilewati (anti rate-limit).
  const before = calls.length;
  await syncCommands(fakeClient);
  assert.equal(calls.length, before, 'tidak boleh memanggil API lagi');
});

test('GuildPlayer mengelola antrian di atas engine abstrak', async () => {
  const { EventEmitter } = await import('node:events');
  const { GuildPlayer } = await import('../src/structures/GuildPlayer.js');
  const { Track } = await import('../src/structures/Track.js');

  class FakeEngine extends EventEmitter {
    constructor() {
      super();
      this.name = 'fake';
      this.played = [];
      this.stops = 0;
      this.volume = 100;
    }
    handleRaw() {}
    status() {
      return { name: 'fake', ready: true, detail: 'test', guilds: 0 };
    }
    async ensureConnected() {}
    async play(guild, track) {
      this.played.push(track.title);
      this.current = track;
    }
    async pause() {}
    async resume() {}
    async stop() {
      this.stops += 1;
    }
    async destroy() {}
    async setVolume(_g, volume) {
      this.volume = volume;
      return volume;
    }
    async seek() {}
    async setFilter() {}
    isPlaying() {
      return Boolean(this.current);
    }
    isPaused() {
      return false;
    }
    position() {
      return 0;
    }
    guildStatus() {
      return { connected: true, playing: Boolean(this.current), paused: false, position: 0 };
    }
    end() {
      this.emit('trackEnd', 'g1', 'finished');
    }
  }

  const engine = new FakeEngine();
  const client = {
    players: new Map(),
    audioEngine: engine,
    user: { id: 'bot' },
    ensureEngine: async () => engine,
  };
  const guild = { id: 'g1', members: { me: { voice: { channel: { id: 'c1' } } } } };

  const player = new GuildPlayer(client, guild);
  player._ignoreEndMs = 0; // jangan tunggu jendela anti-dobel

  const a = Track.fromDirectUrl('https://x/a.mp3', { title: 'A' });
  const b = Track.fromDirectUrl('https://x/b.mp3', { title: 'B' });

  await player.enqueue([a, b]);
  assert.deepEqual(engine.played, ['A'], 'track pertama langsung diputar');
  assert.equal(player.queue.length, 1);

  engine.end();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(engine.played, ['A', 'B'], 'trackEnd memajukan antrian');
  assert.equal(player.current.title, 'B');

  player.loop = 'track';
  engine.end();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(engine.played.at(-1), 'B', 'loop track mengulang lagu yang sama');

  player.loop = 'off';
  await player.skip();
  assert.ok(engine.stops >= 1, 'skip memanggil engine.stop');
  assert.equal(player.current, null, 'antrian habis setelah skip');

  await player.destroy();
});

/* ------------------------- Lavalink node normalisasi ------------------------ */

test('normalizeNode: domain publik tanpa port -> https:443', () => {
  const { node, notes } = normalizeNode({ id: 'main', host: 'lavalink.example.com' });
  assert.equal(node.host, 'lavalink.example.com');
  assert.equal(node.port, 443);
  assert.equal(node.secure, true);
  assert.equal(baseUrl(node), 'https://lavalink.example.com');
  assert.deepEqual(notes, []);
});

test('normalizeNode: host internal Railway -> http:8080 (tanpa TLS)', () => {
  const { node } = normalizeNode({ id: 'main', host: 'lavalink.railway.internal' });
  assert.equal(node.secure, false);
  assert.equal(node.port, 8080);
  assert.equal(baseUrl(node), 'http://lavalink.railway.internal:8080');
});

test('normalizeNode: host internal + LAVALINK_SECURE=true dikoreksi jadi http', () => {
  const { node, notes } = normalizeNode({ host: 'lavalink.railway.internal', secure: true });
  assert.equal(node.secure, false);
  assert.equal(notes.length, 1);
});

test('normalizeNode: URL penuh menang atas host/port', () => {
  const { node } = normalizeNode({ url: 'http://lavalink.railway.internal:9000', port: 443, secure: true });
  assert.equal(node.port, 9000);
  assert.equal(node.secure, false);
});

test('normalizeNode: domain publik Railway dipaksa 443 walau port 2333', () => {
  const { node, notes } = normalizeNode({ host: 'antimusic-production-xxxx.up.railway.app', port: 2333 });
  assert.equal(node.port, 443);
  assert.equal(node.secure, true);
  assert.ok(notes.some((note) => note.includes('443')));
});

test('normalizeNode: IP polos -> http:2333, password masuk authorization', () => {
  const { node } = normalizeNode({ host: '10.0.0.5', password: 'rahasia' });
  assert.equal(node.secure, false);
  assert.equal(node.port, 2333);
  assert.equal(node.authorization, 'rahasia');
  assert.equal(baseUrl(node), 'http://10.0.0.5:2333');
});

test('normalizeNode: host:port tanpa skema diparse', () => {
  const { node } = normalizeNode({ host: '127.0.0.1:2333' });
  assert.equal(node.host, '127.0.0.1');
  assert.equal(node.port, 2333);
  assert.equal(node.secure, false);
});

/* ----------------------------- preflight /v4/info --------------------------- */

async function withServer(handler, run) {
  const { createServer } = await import('node:http');
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('probeLavalink: balasan /v4/info valid dianggap siap', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, '/v4/info');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: { semver: '4.2.2', major: 4 }, sourceManagers: [] }));
    },
    async (port) => {
      const { node } = normalizeNode({ host: `127.0.0.1:${port}` });
      const { info, url } = await probeLavalink(node, { timeoutMs: 2000 });
      assert.equal(info.version.semver, '4.2.2');
      assert.equal(url, `http://127.0.0.1:${port}/v4/info`);
    },
  );
});

test('probeLavalink: "Proxy error" diklasifikasi proxy, bukan SyntaxError', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Proxy error: upstream tidak menjawab');
    },
    async (port) => {
      const { node } = normalizeNode({ host: `127.0.0.1:${port}` });
      await assert.rejects(
        () => probeLavalink(node, { timeoutMs: 2000 }),
        (error) => {
          assert.equal(error.name, 'LavalinkProbeError');
          assert.equal(error.kind, 'proxy');
          assert.match(error.message, /Proxy error/);
          assert.ok(error.hint.includes('proxy'));
          return true;
        },
      );
    },
  );
});

test('probeLavalink: 401 jadi kind auth dengan hint password', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('Unauthorized');
    },
    async (port) => {
      const { node } = normalizeNode({ host: `127.0.0.1:${port}` });
      await assert.rejects(
        () => probeLavalink(node, { timeoutMs: 2000 }),
        (error) => {
          assert.equal(error.kind, 'auth');
          assert.match(error.hint, /LAVALINK_PASSWORD/);
          return true;
        },
      );
    },
  );
});
