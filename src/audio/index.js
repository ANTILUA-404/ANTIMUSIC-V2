import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { LavalinkEngine } from './lavalink-engine.js';
import { LocalEngine } from './local-engine.js';

const log = createLogger('engine');

/**
 * Memilih engine audio.
 *
 *   AUDIO_ENGINE=auto      -> coba Lavalink, gagal? pakai lokal (default)
 *   AUDIO_ENGINE=lavalink  -> wajib Lavalink, error kalau tidak tersedia
 *   AUDIO_ENGINE=local     -> selalu lokal (yt-dlp + FFmpeg)
 *
 * Ini yang membuat bot tetap hidup kalau trial Railway habis / node down.
 */
export async function createEngine(client) {
  const mode = config.audio.engine;
  const lavalinkReady = config.audio.lavalink.enabled;

  if (mode === 'local' || (mode === 'auto' && !lavalinkReady)) {
    if (mode === 'auto' && !lavalinkReady) {
      log.info('LAVALINK_HOST kosong -> pakai engine lokal (yt-dlp + FFmpeg).');
    }
    const engine = new LocalEngine(client);
    await engine.init();
    return engine;
  }

  const engine = new LavalinkEngine(client);
  try {
    await engine.init();
    return engine;
  } catch (error) {
    log.error(`Lavalink tidak siap: ${error.message}`);

    if (mode === 'lavalink' || !config.audio.fallbackLocal) {
      log.error('AUDIO_ENGINE=lavalink dan AUDIO_FALLBACK_LOCAL=false -> bot berhenti.');
      throw error;
    }

    log.warn('Turun ke engine lokal (yt-dlp + FFmpeg). Bot tetap bisa memutar audio.');
    log.warn('Kalau Lavalink baru hidup belakangan, restart bot supaya pindah ke engine Lavalink.');
    await engine.dispose().catch(() => {});
    const fallback = new LocalEngine(client);
    await fallback.init();
    return fallback;
  }
}

export { LavalinkEngine, LocalEngine };
export default createEngine;
