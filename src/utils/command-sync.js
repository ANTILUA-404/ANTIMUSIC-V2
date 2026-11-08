import crypto from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from './logger.js';
import { JsonStore } from './store.js';

const log = createLogger('commands');

/** Menyimpan hash payload terakhir per scope, supaya restart tidak daftar ulang. */
const store = new JsonStore('commands-sync.json', { scopes: {} });

const hashOf = (body) => crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);

export function commandPayload(client) {
  return [...client.commands.values()].map((command) => command.data.toJSON());
}

async function applyScope(client, body, hash, scope, force) {
  const state = { ...store.get('scopes', {}) };
  if (!force && state[scope]?.hash === hash) return { scope, changed: false };

  // scope === 'global' -> command global, selain itu id guild (instan).
  if (scope === 'global') await client.application.commands.set(body);
  else await client.application.commands.set(body, scope);

  state[scope] = { hash, count: body.length, at: Date.now() };
  store.set('scopes', state);
  return { scope, changed: true, count: body.length };
}

/**
 * Daftarkan slash command otomatis.
 *
 * Strategi: kalau bot sudah ada di server, daftarkan per-guild (langsung muncul,
 * tanpa menunggu propagasi global ±1 jam). Kalau belum di server mana pun,
 * pakai global sebagai fallback.
 *
 * Hash payload disimpan di data/commands-sync.json, jadi restart biasa tidak
 * memanggil API Discord lagi (aman dari rate limit).
 */
export async function syncCommands(client, { guildIds = null, force = false } = {}) {
  if (!force && !config.commands.autoDeploy) {
    return { skipped: true, reason: 'AUTO_DEPLOY_COMMANDS=false' };
  }
  if (!client.application) {
    return { skipped: true, reason: 'client.application belum siap' };
  }

  const body = commandPayload(client);
  if (!body.length) return { skipped: true, reason: 'tidak ada command untuk didaftarkan' };

  const hash = hashOf(body);

  let scopes;
  if (guildIds?.length) scopes = guildIds;
  else if (config.guildId) scopes = [config.guildId];
  else scopes = [...client.guilds.cache.keys()];

  if (!scopes.length) scopes = ['global'];

  const results = [];
  for (const scope of scopes) {
    try {
      results.push(await applyScope(client, body, hash, scope, force));
    } catch (error) {
      log.warn(`Gagal daftarkan command di ${scope === 'global' ? 'global' : `guild ${scope}`}: ${error.message}`);
      results.push({ scope, error: error.message });
    }
  }

  const changed = results.filter((result) => result.changed);
  if (changed.length) {
    const where = changed
      .map((result) => (result.scope === 'global' ? 'global (±1 jam)' : `guild ${result.scope} (instan)`))
      .join(', ');
    log.info(`${body.length} slash command didaftarkan → ${where}`);
  } else {
    log.debug('Slash command sudah sinkron, tidak perlu daftar ulang.');
  }

  return { count: body.length, results };
}

export default syncCommands;
