import { config } from "../config.js";
import { log } from "../logger.js";
import { patchState, remember, state } from "../state.js";
import { trackAuthor, trackIdentifier, trackLength, trackTitle, truncate } from "../utils.js";

const MAX_TRACK_MS = 25 * 60 * 1000;
const MIN_TRACK_MS = 30 * 1000;

/**
 * 24/7 radio engine.
 *
 * Keeps a per-guild buffer of "related" tracks and refills it from YouTube
 * Mix / related searches. It is designed to never run dry: when every search
 * fails it retries with a capped backoff, forever, without leaving the channel.
 */
export class RadioEngine {
  constructor(service) {
    this.service = service;
    this.pools = new Map();
    this.filling = new Map();
    this.retryTimers = new Map();
    this.failures = new Map();
    this.lastNotice = new Map();
  }

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  isEnabled(guildId) {
    return Boolean(state(guildId).radio);
  }

  enable(guildId, { seed = null, voiceChannelId = null, textChannelId = null, by = null } = {}) {
    patchState(guildId, {
      radio: true,
      autoplay: true,
      radioSeed: seed || state(guildId).radioSeed || null,
      radioVoiceChannelId: voiceChannelId || state(guildId).radioVoiceChannelId || null,
      radioTextChannelId: textChannelId || state(guildId).radioTextChannelId || null,
      radioSince: Date.now(),
      radioBy: by || state(guildId).radioBy || null,
    });
    log.info({ guildId, seed }, "Mode 24/7 diaktifkan");
  }

  disable(guildId, reason = "manual") {
    patchState(guildId, { radio: false, radioSince: null });
    this.clear(guildId);
    log.info({ guildId, reason }, "Mode 24/7 dimatikan");
  }

  updateChannels(guildId, { voiceChannelId, textChannelId }) {
    if (!this.isEnabled(guildId)) return;
    const patch = {};
    if (voiceChannelId) patch.radioVoiceChannelId = voiceChannelId;
    if (textChannelId) patch.radioTextChannelId = textChannelId;
    if (Object.keys(patch).length) patchState(guildId, patch);
  }

  rememberTitle(guildId, title) {
    if (!this.isEnabled(guildId) || !title) return;
    patchState(guildId, { radioLastTitle: truncate(title, 120) });
  }

  status(guildId) {
    const guildState = state(guildId);
    return {
      enabled: Boolean(guildState.radio),
      seed: guildState.radioSeed,
      lastTitle: guildState.radioLastTitle,
      since: guildState.radioSince,
      pool: this.pools.get(guildId)?.length ?? 0,
      voiceChannelId: guildState.radioVoiceChannelId,
      textChannelId: guildState.radioTextChannelId,
    };
  }

  clear(guildId) {
    this.pools.delete(guildId);
    this.failures.delete(guildId);
    const timer = this.retryTimers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(guildId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* queue refill                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Adds tracks to the player queue. Returns the amount of tracks added.
   */
  async feed(player, count = 1) {
    if (!player || player.destroyed) return 0;

    const pool = await this.ensurePool(player);
    if (!pool.length) return 0;

    const take = Math.min(count, pool.length);
    const picked = pool.splice(0, take);

    try {
      await player.queue.add(picked.length === 1 ? picked[0] : picked);
    } catch (error) {
      log.warn({ guildId: player.guildId, error: error.message }, "Gagal menambahkan track radio ke antrean");
      return 0;
    }

    for (const track of picked) {
      remember(player.guildId, trackIdentifier(track));
    }

    return picked.length;
  }

  async ensurePool(player) {
    const guildId = player.guildId;
    const pool = this.pools.get(guildId);
    if (pool && pool.length) return pool;

    const inFlight = this.filling.get(guildId);
    if (inFlight) return inFlight;

    const promise = this.buildPool(player)
      .then((tracks) => {
        this.pools.set(guildId, tracks);
        return tracks;
      })
      .catch((error) => {
        log.warn({ guildId, error: error.message }, "Gagal menyusun pool radio");
        return [];
      })
      .finally(() => {
        this.filling.delete(guildId);
      });

    this.filling.set(guildId, promise);
    return promise;
  }

  seedQuery(player) {
    const guildId = player.guildId;
    const guildState = state(guildId);

    const lastTrack = this.service.lastTrack.get(guildId);
    if (lastTrack) {
      const title = trackTitle(lastTrack);
      const author = trackAuthor(lastTrack);
      const cleanAuthor = /unknown/i.test(author) ? "" : author.replace(/\s*-\s*Topic$/i, "").trim();
      return {
        track: lastTrack,
        query: cleanAuthor ? `${cleanAuthor} ${title}` : title,
        title,
      };
    }

    const fallbackSeed = guildState.radioLastTitle || guildState.radioSeed || config.radio.defaultSeed;
    return { track: null, query: fallbackSeed, title: fallbackSeed };
  }

  async buildPool(player) {
    const guildId = player.guildId;
    const guildState = state(guildId);
    const seed = this.seedQuery(player);
    const collected = [];
    const seen = new Set(guildState.history || []);
    const seenTitles = new Set();
    let streams = 0;

    const push = (tracks) => {
      for (const track of tracks || []) {
        if (!track?.info) continue;
        const id = trackIdentifier(track);
        if (!id || seen.has(id)) continue;

        const isStream = Boolean(track.info.isStream);
        const length = trackLength(track);

        if (isStream) {
          // Live streams never end; a couple per pool is nice, more is repetitive.
          if (streams >= 2) continue;
        } else if (length < MIN_TRACK_MS || length > MAX_TRACK_MS) {
          continue;
        }

        // Same title from different uploads (very common on YouTube) would make
        // the radio feel like a broken loop.
        const titleKey = this.service.cleanTitle(trackTitle(track));
        if (titleKey && seenTitles.has(titleKey)) continue;

        seen.add(id);
        if (titleKey) seenTitles.add(titleKey);
        if (isStream) streams += 1;

        collected.push(track);
        if (collected.length >= config.radio.batchSize) return true;
      }
      return false;
    };

    // 1. YouTube "Mix" playlist of the current track (RD<videoId>).
    // Some setups/plugin versions cannot resolve RD mixes; remember the failure
    // so we do not pay that timeout on every refill.
    const videoId = this.service.extractYouTubeVideoId(seed.track);
    if (videoId && !this.service.mixBrokenGuilds.has(guildId)) {
      const mixUrl = `https://www.youtube.com/playlist?list=RD${videoId}`;
      const mix = await this.service.search(player, mixUrl, { direct: true }).catch(() => null);
      if (mix?.tracks?.length) {
        log.debug({ guildId, count: mix.tracks.length }, "Pool radio dari YouTube Mix");
        if (push(mix.tracks)) return collected;
      } else {
        this.service.mixBrokenGuilds.add(guildId);
        log.debug({ guildId }, "YouTube Mix tidak bisa dipakai, memakai related search");
      }
    }

    // 2. Related searches around the seed.
    const relatedQueries = [
      `${seed.query} radio`,
      `${seed.query} mix`,
      `${seed.query} similar songs`,
    ];

    for (const query of relatedQueries) {
      if (collected.length >= config.radio.batchSize) break;
      const result = await this.service.search(player, query).catch(() => null);
      if (result?.tracks?.length) {
        if (push(result.tracks)) return collected;
      }
    }

    // 3. Never run dry: fall back to generic radio queries.
    if (collected.length < 3) {
      for (const query of config.radio.fallbackQueries) {
        if (collected.length >= config.radio.batchSize) break;
        const result = await this.service.search(player, query).catch(() => null);
        if (result?.tracks?.length) push(result.tracks);
      }
    }

    if (!collected.length) {
      log.warn({ guildId, seed: seed.query }, "Pool radio kosong setelah semua sumber dicoba");
    } else {
      log.info({ guildId, tracks: collected.length, seed: seed.query }, "Pool radio diisi");
    }

    return collected;
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Called from the LavalinkManager `onEmptyQueue.autoPlayFunction` hook.
   * Returning after adding a track keeps the player alive automatically.
   */
  async onQueueEmpty(player) {
    const guildId = player.guildId;
    if (!this.isEnabled(guildId)) return false;

    try {
      const added = await this.feed(player, 1);
      if (added > 0) {
        this.failures.delete(guildId);

        // Pre-buffer the next batch in the background so playback never stalls.
        const pool = this.pools.get(guildId) || [];
        if (pool.length <= 2) {
          void this.ensurePool(player).catch(() => {});
        }
        return true;
      }
    } catch (error) {
      log.warn({ guildId, error: error.message }, "Radio gagal mengisi antrean");
    }

    this.scheduleRetry(player);
    return false;
  }

  scheduleRetry(player) {
    const guildId = player.guildId;
    if (!this.isEnabled(guildId)) return;
    if (this.retryTimers.has(guildId)) return;

    const failures = (this.failures.get(guildId) || 0) + 1;
    this.failures.set(guildId, failures);

    const delay = Math.min(config.radio.retryMs * Math.min(failures, 4), 120_000);

    const timer = setTimeout(async () => {
      this.retryTimers.delete(guildId);
      if (!this.isEnabled(guildId)) return;

      const current = this.service.getPlayer(guildId);
      if (!current || current.destroyed) return;

      if (!current.connected) {
        await this.service.reconnectPlayer(current).catch(() => {});
      }

      const added = await this.feed(current, 1).catch(() => 0);
      if (added > 0) {
        this.failures.delete(guildId);
        if (!current.playing) {
          await current.play().catch(() => {});
        }
        log.info({ guildId, delay }, "Radio berhasil dilanjutkan setelah percobaan ulang");
      } else {
        this.scheduleRetry(current);
      }
    }, delay);

    timer.unref?.();
    this.retryTimers.set(guildId, timer);
  }

  /** Kicks the radio when the queue is empty but the player is still connected. */
  async kickstart(player) {
    if (!this.isEnabled(player.guildId)) return false;
    if (player.playing || player.queue?.current) return false;

    const added = await this.feed(player, 1).catch(() => 0);
    if (added > 0) {
      await player.play().catch(() => {});
      return true;
    }

    this.scheduleRetry(player);
    return false;
  }
}

export default RadioEngine;
