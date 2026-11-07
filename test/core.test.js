import test from 'node:test';
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
import { FILTERS } from '../src/structures/GuildPlayer.js';
import { stationToTrack } from '../src/structures/RadioStore.js';
import { Track } from '../src/structures/Track.js';

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
  assert.equal(FILTERS.none, null);
  for (const [name, filter] of Object.entries(FILTERS)) {
    if (name === 'none') continue;
    assert.equal(typeof filter, 'string', `${name} harus string`);
    assert.ok(filter.length > 3, `${name} filter terlalu pendek`);
  }
});
