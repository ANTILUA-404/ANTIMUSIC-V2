import { DEFAULT_STATIONS } from '../data/stations.js';
import { Track } from './Track.js';
import { JsonStore } from '../utils/store.js';

export const radioStore = new JsonStore('radio.json', { guilds: {}, stations: {} });

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

/** Built-in presets merged with user-added stations. */
export function listStations() {
  const custom = radioStore.get('stations', {});
  const merged = new Map();
  for (const station of DEFAULT_STATIONS) merged.set(station.id, station);
  for (const [id, station] of Object.entries(custom)) merged.set(id, station);
  return [...merged.values()];
}

export function getStation(query) {
  if (!query) return null;
  const needle = String(query).toLowerCase().trim();
  const stations = listStations();
  return (
    stations.find((station) => station.id === slugify(needle)) ||
    stations.find((station) => station.id === needle) ||
    stations.find((station) => station.name.toLowerCase() === needle) ||
    stations.find((station) => station.name.toLowerCase().includes(needle)) ||
    null
  );
}

export function addStation({ name, url, kind = 'url' }) {
  const id = slugify(name);
  if (!id) throw new Error('Nama station tidak valid.');
  const station = { id, name: String(name).slice(0, 60), url, kind, custom: true };
  const custom = { ...radioStore.get('stations', {}) };
  custom[id] = station;
  radioStore.set('stations', custom);
  return station;
}

export function removeStation(id) {
  const custom = { ...radioStore.get('stations', {}) };
  if (!custom[id]) return false;
  delete custom[id];
  radioStore.set('stations', custom);
  return true;
}

export function stationToTrack(station, requester = null) {
  const track = new Track({
    title: station.name,
    url: station.url,
    duration: 0,
    thumbnail: null,
    author: '24/7 Radio',
    requester,
    source: 'radio',
    isLive: true,
    stream: { kind: station.kind === 'ytdlp' ? 'ytdlp' : 'url', target: station.url },
  });
  track.stationId = station.id;
  return track;
}

/* -------- 24/7 persistence (so the bot rejoins after a restart) -------- */

export function save247(guildId, payload) {
  const guilds = { ...radioStore.get('guilds', {}) };
  guilds[guildId] = { ...payload, since: Date.now() };
  radioStore.set('guilds', guilds);
}

export function get247(guildId) {
  return radioStore.get('guilds', {})[guildId] || null;
}

export function clear247(guildId) {
  const guilds = { ...radioStore.get('guilds', {}) };
  if (!guilds[guildId]) return;
  delete guilds[guildId];
  radioStore.set('guilds', guilds);
}

export function list247() {
  return radioStore.get('guilds', {});
}
