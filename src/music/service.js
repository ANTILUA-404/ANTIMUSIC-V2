import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { LavalinkManager } from "lavalink-client";
import { applyAudioQualityProfile, optimizeVoiceChannelBitrate, PROFILE_INFO } from "../audio-hd.js";
import { config } from "../config.js";
import { buildNodes } from "../lavalink/nodes.js";
import { lavalinkSupervisor } from "../lavalink/supervisor.js";
import { log } from "../logger.js";
import { allGuildStates, patchState, remember, state } from "../state.js";
import {
  baseEmbed,
  errorEmbed,
  isUrl,
  ms,
  normalizeQuery,
  oneLine,
  parseSeconds,
  requesterName,
  successEmbed,
  trackArtwork,
  trackAuthor,
  trackIdentifier,
  trackLength,
  trackTitle,
  trackUri,
  truncate,
} from "../utils.js";
import { RadioEngine } from "./radio.js";
import { parseMusicLink, resolveMusicLink, SERVICE_SEARCH_PREFIX, SOURCE_MANAGER } from "./links.js";

const SHORT_SOURCE = {
  yt: "ytsearch",
  ytm: "ytmsearch",
  sc: "scsearch",
  sp: "spsearch",
  am: "amsearch",
  dz: "dzsearch",
};

const SERVICE_LABEL = {
  spotify: "Spotify",
  applemusic: "Apple Music",
  deezer: "Deezer",
};

const NODE_PRIORITY = (node) => {
  const host = String(node?.options?.host || "").toLowerCase();
  const id = String(node?.id || "").toLowerCase();
  if (host.includes("127.0.0.1") || host.includes("localhost") || id.includes("primary")) return 1;
  if (host.includes("nazha") || id.includes("nazha")) return 2;
  if (host.includes("jirayu") || id.includes("jirayu")) return 3;
  if (host.includes("serenetia") || id.includes("serenetia")) return 4;
  return 5;
};

async function fetchYoutubeTitle(url) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const raw = String(data?.title || "").trim();
    if (!raw) return null;
    return (
      raw
        .replace(/\|+/g, " ")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\((official\s*(music)?\s*video|official\s*audio|lyrics?|remaster(ed)?)\)/gi, " ")
        .replace(/\s+/g, " ")
        .trim() || raw
    );
  } catch {
    return null;
  }
}

export class MusicService {
  constructor(client) {
    this.client = client;
    this.lastTrack = new Map();
    this.emptyTimers = new Map();
    this.idleTimers = new Map();
    this.npMessages = new Map();
    this.nodeCooldowns = new Map();
    this.autoplayBusy = new Set();
    this.autoplayPool = new Map();
    this.warmedUp = new Set();
    this.mixBrokenGuilds = new Set();
    this.radioReconnectAttempts = new Map();
    this.fallbackTried = new Set();
    this.lastFallbackNotice = new Map();
    this.lastErrorNotice = new Map();
    this.youtubeFailureStreak = 0;
    this.lastYoutubeFailureAt = 0;
    this.youtubeDegradedUntil = 0;
    this.destroying = false;

    this.radio = new RadioEngine(this);

    this.lavalink = new LavalinkManager({
      nodes: buildNodes(),
      sendToShard: (guildId, payload) => {
        const guild = this.client.guilds.cache.get(guildId);
        const shard = guild?.shard ?? this.client.ws.shards.first();
        shard?.send(payload);
      },
      client: { id: config.clientId, username: "ANTIMUSIC" },
      autoSkip: true,
      autoMove: true,
      autoSkipOnResolveError: true,
      playerOptions: {
        defaultSearchPlatform: "ytmsearch",
        volumeDecrementer: 1,
        useUnresolvedData: true,
        minAutoPlayMs: 3000,
        // Jangan bunuh player hanya karena beberapa track gagal beruntun
        // (misal YouTube memblokir IP server). Kita tangani sendiri di trackError.
        maxErrorsPerTime: { threshold: 120_000, maxAmount: 15 },
        onDisconnect: {
          autoReconnect: true,
          autoReconnectOnlyWithTracks: false,
          destroyPlayer: false,
        },
        onEmptyQueue: {
          autoPlayFunction: async (player) => {
            if (this.radio.isEnabled(player.guildId)) {
              await this.radio.onQueueEmpty(player);
              return;
            }
            if (state(player.guildId).autoplay) {
              await this.smartAutoplay(player, { autoStart: false });
            }
          },
        },
      },
      queueOptions: { maxPreviousTracks: 25 },
    });

    this.registerEvents();
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  init(user) {
    this.lavalink.init({ id: user.id, username: user.username });
  }

  raw(payload) {
    this.lavalink.sendRawData(payload);
  }

  getPlayer(guildId) {
    try {
      return this.lavalink.players.get(guildId) ?? null;
    } catch {
      return null;
    }
  }

  getAllPlayers() {
    try {
      return Array.from(this.lavalink.players.values());
    } catch {
      return [];
    }
  }

  async destroyAll() {
    this.destroying = true;
    for (const player of this.getAllPlayers()) {
      try {
        await player.destroy("shutdown", true);
      } catch {}
    }
  }

  /* ------------------------------------------------------------------ */
  /* node health                                                         */
  /* ------------------------------------------------------------------ */

  markNodeDegraded(nodeId, durationMs = 60_000) {
    const until = Math.max(this.nodeCooldowns.get(nodeId) || 0, Date.now() + durationMs);
    this.nodeCooldowns.set(nodeId, until);
  }

  isNodeHealthy(node) {
    if (!node || !node.connected || !node.info) return false;
    return Date.now() > (this.nodeCooldowns.get(node.id) || 0);
  }

  allNodes() {
    return Array.from(this.lavalink.nodeManager.nodes.values());
  }

  /**
   * Keeps exactly one live node per configured Lavalink.
   *
   * lavalink-client deletes a node from the manager once `retryAmount`
   * reconnects fail. After a long Lavalink outage the bot was left with zero
   * nodes, so every command answered "server audio offline" even though
   * Lavalink had already recovered. This rebuilds the node when that happens.
   */
  reviveNodes() {
    const manager = this.lavalink?.nodeManager;
    if (!manager) return false;

    let changed = false;

    for (const options of buildNodes()) {
      const existing = manager.nodes.get(options.id);

      if (!existing) {
        try {
          manager.createNode(options);
          changed = true;
          log.info({ node: options.id }, "Node Lavalink dibuat ulang");
        } catch (error) {
          log.warn({ node: options.id, error: error.message }, "Gagal membuat ulang node Lavalink");
          continue;
        }
      }

      const node = manager.nodes.get(options.id);
      if (!node || node.connected) continue;

      // The library is already retrying this one; let it finish.
      if (node.reconnectionState === "RECONNECTING") continue;

      try {
        node.connect();
      } catch {}
    }

    return changed;
  }

  pickNode({ exclude = null } = {}) {
    const nodes = this.allNodes().filter((node) => node.id !== exclude && node.connected && node.info);
    if (!nodes.length) return null;

    const healthy = nodes.filter((node) => this.isNodeHealthy(node));
    const pool = healthy.length ? healthy : nodes;
    return pool.sort((a, b) => NODE_PRIORITY(a) - NODE_PRIORITY(b))[0];
  }

  /**
   * First YouTube request after boot can take 10-20s while the plugin loads
   * its player script. Warm it up so the first `?play` is fast.
   */
  warmUpNode(node) {
    if (!node || this.warmedUp.has(node.id)) return;
    this.warmedUp.add(node.id);

    const timer = setTimeout(async () => {
      const startedAt = Date.now();
      try {
        const result = await node.search(
          { query: "lofi hip hop", source: "ytmsearch" },
          this.client.user ?? { id: config.clientId },
        );
        log.debug(
          { node: node.id, ms: Date.now() - startedAt, tracks: result?.tracks?.length ?? 0 },
          "Warm-up pencarian YouTube selesai",
        );
      } catch (error) {
        log.debug({ node: node.id, error: error.message }, "Warm-up pencarian gagal (tidak fatal)");
      }
    }, 2500);

    timer.unref?.();
  }

  /* ------------------------------------------------------------------ */
  /* YouTube degradation / SoundCloud fallback                           */
  /* ------------------------------------------------------------------ */

  /**
   * True when the failure comes from YouTube refusing to serve audio
   * (datacenter IP blocked, cipher broken, login wall, ...).
   */
  isYoutubeBlocked(reason) {
    return /all clients failed|requires login|sign in to confirm|player script|no supported audio streams|video is unavailable|page needs to be reloaded|must find sig function|not a bot|confirm you'?re not a bot/i.test(
      String(reason || ""),
    );
  }

  noteYoutubeFailure(player, reason) {
    const now = Date.now();

    if (!this.lastYoutubeFailureAt || now - this.lastYoutubeFailureAt > 120_000) {
      this.youtubeFailureStreak = 0;
    }

    this.lastYoutubeFailureAt = now;
    this.youtubeFailureStreak += 1;

    if (this.youtubeFailureStreak < 2 || now < this.youtubeDegradedUntil) return;

    this.youtubeDegradedUntil = now + 10 * 60 * 1000;

    log.warn(
      { guildId: player?.guildId, reason: oneLine(reason, 140) },
      "YouTube memblokir IP server ini (semua client gagal). " +
        "Pencarian sementara diarahkan ke SoundCloud selama 10 menit. " +
        "Solusi permanen: YOUTUBE_OAUTH_ENABLED=true atau pakai poToken.",
    );
  }

  isYoutubeDegraded() {
    return Date.now() < this.youtubeDegradedUntil;
  }

  /**
   * Replaces a YouTube track that failed to play with the same song from
   * SoundCloud. Runs at most once per track, so a broken queue cannot loop.
   */
  async replaceWithSoundcloud(player, track) {
    if (!track) return false;

    const key = trackIdentifier(track);
    if (!key) return false;
    if (this.fallbackTried.has(key)) return false;

    this.fallbackTried.add(key);
    if (this.fallbackTried.size > 400) this.fallbackTried.clear();

    const query = `${trackAuthor(track)} ${trackTitle(track)}`
      .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ")
      .replace(/\b(official|lyrics?|audio|video|mv|hd|4k|remaster(ed)?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!query) return false;

    const result = await this.search(player, `sc:${query}`).catch(() => null);
    // Only accept a real SoundCloud track: accepting another YouTube result
    // would put us back in the same failure loop.
    const replacement = (result?.tracks || []).find(
      (candidate) => String(candidate?.info?.sourceName || "").toLowerCase() === "soundcloud",
    );
    if (!replacement) return false;

    replacement.requester = track.requester ?? this.client.user;

    // Put it at the front of the upcoming queue.
    await player.queue.add(replacement, 0).catch(() => null);

    if (!player.playing && !player.queue?.current) {
      await player.play().catch(() => {});
    }

    await this.notifyFallback(player, track, replacement);
    return true;
  }

  async notifyFallback(player, original, replacement) {
    const now = Date.now();
    const last = this.lastFallbackNotice.get(player.guildId) || 0;
    if (now - last < 30_000) return;
    this.lastFallbackNotice.set(player.guildId, now);

    const channel = this.client.channels.cache.get(player.textChannelId);
    await channel
      ?.send?.({
        embeds: [
          baseEmbed("🔁 Dialihkan ke SoundCloud")
            .setColor(0x38bdf8)
            .setDescription(
              `YouTube menolak memutar **${truncate(trackTitle(original), 60)}** dari server ini.\n` +
                `Bot otomatis memutar versi SoundCloud: **${truncate(trackTitle(replacement), 60)}**`,
            )
            .setFooter({ text: "Aktifkan OAuth YouTube agar bisa memutar langsung dari YouTube" }),
        ],
      })
      .catch?.(() => {});
  }

  async notifyTrackError(player, track, reason, blocked) {
    const now = Date.now();
    const last = this.lastErrorNotice.get(player.guildId) || 0;
    if (now - last < 30_000) return;
    this.lastErrorNotice.set(player.guildId, now);

    const explanation = blocked
      ? "YouTube memblokir pemutaran dari server ini (semua client gagal).\n" +
        "💡 **Solusi permanen:** set `YOUTUBE_OAUTH_ENABLED=true` di `.env`, restart, lalu ikuti kode OAuth di console.\n" +
        "💡 Sementara: pakai `?play sc:<judul>` untuk memutar via SoundCloud."
      : oneLine(reason, 300);

    const channel = this.client.channels.cache.get(player.textChannelId);
    await channel
      ?.send?.({
        embeds: [errorEmbed("Gagal memutar lagu", `**${truncate(trackTitle(track), 60)}**\n\n${explanation}`)],
      })
      .catch?.(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  registerEvents() {
    const manager = this.lavalink;

    manager.nodeManager.on("connect", (node) => {
      this.nodeCooldowns.delete(node.id);
      log.info({ node: node.id, host: node.options.host, port: node.options.port }, "Node Lavalink terhubung");
      node.updateSession?.(true, 300_000).catch?.(() => {});
      this.warmUpNode(node);
    });

    manager.nodeManager.on("reconnecting", (node) => {
      // The library retries every 10s; logging each attempt floods the panel.
      const key = `reconnect:${node.id}`;
      const last = this.nodeCooldowns.get(key) || 0;
      if (Date.now() - last < 60_000) return;

      this.nodeCooldowns.set(key, Date.now());
      log.info({ node: node.id }, "Node Lavalink mencoba menyambung ulang");
    });

    manager.nodeManager.on("error", (node, error) => {
      const message = error?.message || String(error);
      this.markNodeDegraded(node.id, 90_000);

      // Keep this quiet: a dead node used to flood the console every 5 seconds.
      const key = `err:${node.id}`;
      const last = this.nodeCooldowns.get(key) || 0;
      if (Date.now() - last > 30_000) {
        this.nodeCooldowns.set(key, Date.now());
        log.warn({ node: node.id, error: message }, "Node Lavalink error");
      }
    });

    manager.nodeManager.on("disconnect", (node, reason) => {
      this.markNodeDegraded(node.id, 90_000);

      const key = `down:${node.id}`;
      const last = this.nodeCooldowns.get(key) || 0;
      if (Date.now() - last > 30_000) {
        this.nodeCooldowns.set(key, Date.now());
        log.warn({ node: node.id, code: reason?.code, reason: reason?.reason }, "Node Lavalink terputus");
      }

      // Give the node a few seconds to come back before moving players.
      setTimeout(() => {
        void this.failoverFromNode(node);
      }, 6000).unref?.();
    });

    manager.on("trackStart", (player, track) => {
      this.clearIdleTimer(player.guildId);
      this.cancelEmptyChannelTimer(player.guildId);
      this.radioReconnectAttempts.delete(player.guildId);

      if (track) {
        this.lastTrack.set(player.guildId, track);
        remember(player.guildId, trackIdentifier(track));
        this.radio.rememberTitle(player.guildId, trackTitle(track));
      }

      player.lastPosition = 0;
      player.lastPositionChange = Date.now();

      const guildState = state(player.guildId);
      if (guildState.ultraHd) {
        void applyAudioQualityProfile(player, guildState.hdProfile);
      }

      void this.publishNowPlaying(player, track);
    });

    manager.on("trackEnd", () => {
      // Intentionally empty: the now-playing message is reused (edited) on the
      // next track instead of spamming a new message for every song.
    });

    manager.on("trackError", async (player, track, payload) => {
      const reason = payload?.exception?.message || payload?.message || "Gagal memutar audio";
      const blocked = this.isYoutubeBlocked(reason);

      // `reason` contains the whole Java stack trace: keep one line in the panel.
      log.warn(
        {
          guildId: player.guildId,
          track: truncate(trackTitle(track), 60),
          reason: oneLine(reason, 160),
          youtubeBlocked: blocked,
        },
        "Track error",
      );

      // YouTube menolak memutar dari IP server ini: jangan ulangi track yang
      // sama (dulu bikin loop tanpa akhir), tapi cari versi SoundCloud-nya.
      if (blocked) {
        this.noteYoutubeFailure(player, reason);

        const replaced = await this.replaceWithSoundcloud(player, track);
        if (replaced) return;
      }

      await this.notifyTrackError(player, track, reason, blocked);
    });

    manager.on("trackStuck", async (player, track) => {
      log.warn({ guildId: player.guildId, track: truncate(trackTitle(track), 60) }, "Track stuck");
      await player.skip(0, false).catch(() => {});
    });

    manager.on("queueEnd", async (player) => {
      this.npMessages.delete(player.guildId);

      if (this.destroying) return;

      // Radio must never stop: if autoplay did not manage to refill, retry forever.
      if (this.radio.isEnabled(player.guildId)) {
        log.debug({ guildId: player.guildId }, "Antrean habis pada mode 24/7, menjadwalkan pengisian ulang");
        this.radio.scheduleRetry(player);
        return;
      }

      if (state(player.guildId).autoplay) {
        const handled = await this.smartAutoplay(player, { autoStart: true });
        if (handled) return;
      }

      const channel = this.client.channels.cache.get(player.textChannelId);

      if (config.idleDestroyMs <= 0) {
        await channel?.send?.("🛑 Antrean habis. ANTIMUSIC tetap standby di voice channel.").catch?.(() => {});
        return;
      }

      await channel
        ?.send?.(`🛑 Antrean habis. ANTIMUSIC keluar dalam ${Math.round(config.idleDestroyMs / 1000)} detik.`)
        .catch?.(() => {});

      this.scheduleIdleDestroy(player);
    });

    manager.on("playerDisconnect", (player) => {
      this.npMessages.delete(player.guildId);
      if (this.destroying) return;
      if (!this.radio.isEnabled(player.guildId)) return;

      log.warn({ guildId: player.guildId }, "Bot terputus dari voice channel, mencoba menyambung ulang (24/7)");
      this.scheduleRadioReconnect(player.guildId, 5000);
    });

    manager.on("playerDestroy", (player) => {
      this.npMessages.delete(player.guildId);
      this.lastTrack.delete(player.guildId);
      this.autoplayBusy.delete(player.guildId);
      this.autoplayPool.delete(player.guildId);
      this.cancelEmptyChannelTimer(player.guildId);
      this.clearIdleTimer(player.guildId);
    });
  }

  /* ------------------------------------------------------------------ */
  /* failover                                                            */
  /* ------------------------------------------------------------------ */

  async failoverFromNode(node) {
    if (this.destroying) return;

    const affected = this.getAllPlayers().filter(
      (player) => player.node?.id === node.id && !player.destroyed,
    );
    if (!affected.length) return;

    const target = this.pickNode({ exclude: node.id });
    if (!target) {
      log.error({ node: node.id }, "Tidak ada node pengganti untuk failover");
      return;
    }

    for (const player of affected) {
      try {
        await player.changeNode(target, false);
        const guildState = state(player.guildId);
        if (guildState.ultraHd) await applyAudioQualityProfile(player, guildState.hdProfile).catch(() => {});

        log.info({ guildId: player.guildId, from: node.id, to: target.id }, "Player dipindahkan ke node cadangan");

        const channel = this.client.channels.cache.get(player.textChannelId);
        await channel
          ?.send?.(`🛡️ Node \`${node.id}\` terputus. Pemutaran dialihkan otomatis ke **${target.id}**.`)
          .catch?.(() => {});
      } catch (error) {
        log.error({ guildId: player.guildId, error: error.message }, "Failover player gagal");
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* timers                                                              */
  /* ------------------------------------------------------------------ */

  scheduleIdleDestroy(player) {
    this.clearIdleTimer(player.guildId);
    if (config.idleDestroyMs <= 0) return;

    const timer = setTimeout(async () => {
      this.idleTimers.delete(player.guildId);
      const current = this.getPlayer(player.guildId);
      if (!current || current.destroyed) return;
      if (this.radio.isEnabled(player.guildId)) return;
      if (current.playing || current.queue?.current || current.queue?.tracks?.length) return;

      await current.destroy("idle").catch(() => {});
    }, config.idleDestroyMs);

    timer.unref?.();
    this.idleTimers.set(player.guildId, timer);
  }

  clearIdleTimer(guildId) {
    const timer = this.idleTimers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(guildId);
    }
  }

  cancelEmptyChannelTimer(guildId) {
    const timer = this.emptyTimers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.emptyTimers.delete(guildId);
    }
  }

  scheduleRadioReconnect(guildId, delay = 5000) {
    if (this.emptyTimers.has(`radio:${guildId}`)) return;

    const attempts = this.radioReconnectAttempts.get(guildId) || 0;
    if (attempts >= 15) {
      log.error({ guildId }, "Gagal menyambung ulang ke voice channel setelah 15 percobaan, radio berhenti mencoba");
      return;
    }
    this.radioReconnectAttempts.set(guildId, attempts + 1);

    const timer = setTimeout(async () => {
      this.emptyTimers.delete(`radio:${guildId}`);
      if (!this.radio.isEnabled(guildId)) return;

      const player = this.getPlayer(guildId);
      if (!player || player.destroyed) {
        await this.restoreRadioForGuild(guildId);
        return;
      }

      if (player.connected) {
        this.radioReconnectAttempts.delete(guildId);
        return;
      }

      const ok = await this.reconnectPlayer(player).catch(() => false);
      if (ok) {
        this.radioReconnectAttempts.delete(guildId);
        await this.radio.kickstart(player).catch(() => false);
      } else {
        this.scheduleRadioReconnect(guildId, Math.min(delay * 2, 60_000));
      }
    }, delay);

    timer.unref?.();
    this.emptyTimers.set(`radio:${guildId}`, timer);
  }

  checkEmptyChannel(guildId) {
    const player = this.getPlayer(guildId);
    if (!player || player.destroyed || !player.connected || !player.voiceChannelId) {
      this.cancelEmptyChannelTimer(guildId);
      return;
    }

    // 24/7 radio never leaves, even with zero listeners.
    if (this.radio.isEnabled(guildId)) {
      this.cancelEmptyChannelTimer(guildId);
      return;
    }

    if (config.emptyChannelLeaveMs <= 0) return;

    const guild = this.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(player.voiceChannelId);
    if (!channel?.isVoiceBased()) return;

    const humans = channel.members.filter((member) => !member.user.bot);

    if (humans.size > 0) {
      this.cancelEmptyChannelTimer(guildId);
      return;
    }

    if (this.emptyTimers.has(guildId)) return;

    log.debug({ guildId }, "Voice channel kosong, memulai timer keluar");

    const timer = setTimeout(async () => {
      this.emptyTimers.delete(guildId);
      if (this.radio.isEnabled(guildId)) return;

      const current = this.getPlayer(guildId);
      if (!current || current.destroyed || !current.connected) return;

      const guildNow = this.client.guilds.cache.get(guildId);
      const channelNow = guildNow?.channels.cache.get(current.voiceChannelId);
      if (channelNow?.isVoiceBased?.() && channelNow.members.filter((m) => !m.user.bot).size > 0) return;

      const textChannel = this.client.channels.cache.get(current.textChannelId);
      await textChannel?.send?.("👋 Voice channel kosong. ANTIMUSIC keluar.").catch?.(() => {});
      await current.destroy("empty-channel").catch(() => {});
    }, config.emptyChannelLeaveMs);

    timer.unref?.();
    this.emptyTimers.set(guildId, timer);
  }

  /* ------------------------------------------------------------------ */
  /* voice helpers                                                       */
  /* ------------------------------------------------------------------ */

  voiceChannel(ctx) {
    return ctx.member?.voice?.channel ?? null;
  }

  sameVoice(ctx, player) {
    const channel = this.voiceChannel(ctx);
    if (!channel) return false;
    if (!player?.connected) return true;
    return !player.voiceChannelId || player.voiceChannelId === channel.id;
  }

  async reconnectPlayer(player) {
    if (!player || player.destroyed) return false;
    if (player.connected) return true;

    const guildState = state(player.guildId);
    const voiceChannelId = player.voiceChannelId || guildState.radioVoiceChannelId;
    if (!voiceChannelId) return false;

    const guild = this.client.guilds.cache.get(player.guildId);
    const channel = guild?.channels.cache.get(voiceChannelId);
    if (!channel?.isVoiceBased()) return false;

    player.voiceChannelId = voiceChannelId;
    if (!player.textChannelId && guildState.radioTextChannelId) {
      player.textChannelId = guildState.radioTextChannelId;
    }

    try {
      await player.connect();
      const current = state(player.guildId);
      if (current.ultraHd) await applyAudioQualityProfile(player, current.hdProfile).catch(() => {});
      return true;
    } catch (error) {
      log.warn({ guildId: player.guildId, error: error.message }, "Gagal menyambung ulang ke voice channel");
      return false;
    }
  }

  async restoreRadioForGuild(guildId) {
    if (!this.radio.isEnabled(guildId)) return false;

    const guildState = state(guildId);
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;

    const voiceChannel = guild.channels.cache.get(guildState.radioVoiceChannelId);
    if (!voiceChannel?.isVoiceBased()) {
      log.warn({ guildId }, "Voice channel 24/7 tidak ditemukan lagi");
      return false;
    }

    const node = this.pickNode();
    if (!node) {
      log.warn({ guildId }, "Belum ada node Lavalink untuk memulihkan radio");
      this.scheduleRadioReconnect(guildId, 15000);
      return false;
    }

    let player = this.getPlayer(guildId);
    if (!player || player.destroyed) {
      try {
        player = this.lavalink.createPlayer({
          guildId,
          voiceChannelId: voiceChannel.id,
          textChannelId: guildState.radioTextChannelId || undefined,
          selfDeaf: true,
          selfMute: false,
          volume: guildState.volume,
          node,
        });
      } catch (error) {
        log.warn({ guildId, error: error.message }, "Gagal membuat player untuk radio");
        return false;
      }
    }

    await this.reconnectPlayer(player).catch(() => false);
    await this.radio.kickstart(player).catch(() => false);
    return true;
  }

  async restoreRadioSessions() {
    if (!config.radio.restoreOnBoot) return;

    const sessions = allGuildStates().filter(([, guildState]) => guildState.radio);
    if (!sessions.length) return;

    log.info({ sessions: sessions.length }, "Memulihkan sesi radio 24/7 setelah restart");

    for (const [guildId] of sessions) {
      setTimeout(() => {
        void this.restoreRadioForGuild(guildId);
      }, 4000).unref?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* player bootstrap                                                    */
  /* ------------------------------------------------------------------ */

  async ensurePlayer(ctx) {
    const voice = this.voiceChannel(ctx);
    if (!voice) throw new Error("Kamu harus masuk voice channel terlebih dahulu.");

    const me = ctx.member.guild.members.me ?? (await ctx.member.guild.members.fetch(this.client.user.id).catch(() => null));
    if (me) {
      const permissions = voice.permissionsFor(me);
      if (!permissions?.has(PermissionFlagsBits.Connect)) {
        throw new Error(`ANTIMUSIC tidak punya izin **Connect** di <#${voice.id}>.`);
      }
      if (!permissions?.has(PermissionFlagsBits.Speak)) {
        throw new Error(`ANTIMUSIC tidak punya izin **Speak** di <#${voice.id}>.`);
      }
    }

    const nodes = this.allNodes();
    if (!nodes.length) throw new Error("Tidak ada node Lavalink yang terkonfigurasi.");

    // During the first boot Lavalink may still be starting; wait a little so
    // the user's first `?play` does not fail with a scary error.
    if (config.lavalink.embedded) {
      await lavalinkSupervisor.waitUntilReady(15000);
    }

    const targetNode = this.pickNode();
    if (!targetNode) {
      const summary = nodes
        .map((node) => `• \`${node.id}\` (${node.options.host}:${node.options.port}) — ${node.connected ? "connected" : "offline"}`)
        .join("\n");
      throw new Error(
        `Semua server audio (Lavalink) sedang offline.\n${summary}\n` +
          `Cek \`?nodes\` atau log panel. Bot akan menyambung ulang otomatis.`,
      );
    }

    let player = this.getPlayer(ctx.guildId);

    // A destroyed player can linger in the manager map after a failed
    // reconnect; clear it so createPlayer() does not throw "already exists".
    if (player && player.destroyed) {
      try {
        this.lavalink.players.delete(ctx.guildId);
      } catch {}
      player = null;
    }

    if (player && !player.destroyed && (!player.node?.connected || !this.isNodeHealthy(player.node))) {
      await player.changeNode(targetNode, false).catch(() => {});
    }

    if (player && !player.destroyed && player.connected && player.voiceChannelId && player.voiceChannelId !== voice.id) {
      const currentChannel = ctx.member.guild.channels.cache.get(player.voiceChannelId);
      const listeners = currentChannel?.isVoiceBased?.()
        ? currentChannel.members.filter((member) => !member.user.bot).size
        : 0;

      if (listeners > 0 && !this.radio.isEnabled(ctx.guildId)) {
        throw new Error(`ANTIMUSIC sedang dipakai di <#${player.voiceChannelId}>.`);
      }

      player.voiceChannelId = voice.id;
      player.textChannelId = ctx.channelId;
      await player.connect().catch(() => {});
      this.radio.updateChannels(ctx.guildId, { voiceChannelId: voice.id, textChannelId: ctx.channelId });
      return player;
    }

    const guildState = state(ctx.guildId);

    if (!player || player.destroyed) {
      player = this.lavalink.createPlayer({
        guildId: ctx.guildId,
        voiceChannelId: voice.id,
        textChannelId: ctx.channelId,
        selfDeaf: true,
        selfMute: false,
        volume: guildState.volume,
        node: targetNode,
      });

      await player.connect();

      if (guildState.loop && guildState.loop !== "off") {
        await player.setRepeatMode(guildState.loop).catch(() => {});
      }
    } else {
      player.textChannelId = ctx.channelId;
      if (!player.connected) {
        player.voiceChannelId = voice.id;
        await player.connect();
      }
    }

    await optimizeVoiceChannelBitrate(voice).catch(() => {});
    if (guildState.ultraHd) await applyAudioQualityProfile(player, guildState.hdProfile).catch(() => {});

    this.radio.updateChannels(ctx.guildId, { voiceChannelId: voice.id, textChannelId: ctx.channelId });

    return player;
  }

  /* ------------------------------------------------------------------ */
  /* search                                                              */
  /* ------------------------------------------------------------------ */

  candidateNodes(player) {
    const connected = this.allNodes().filter((node) => node.connected && node.info);
    if (!connected.length) return [];

    const preferred = player?.node && this.isNodeHealthy(player.node) ? [player.node] : [];
    const rest = connected
      .filter((node) => !preferred.some((p) => p.id === node.id))
      .sort((a, b) => {
        const healthA = this.isNodeHealthy(a) ? 0 : 1;
        const healthB = this.isNodeHealthy(b) ? 0 : 1;
        return healthA - healthB || NODE_PRIORITY(a) - NODE_PRIORITY(b);
      });

    return [...preferred, ...rest];
  }

  /** Apakah node punya source manager untuk prefix pencarian tertentu. */
  nodeHasSource(node, source) {
    const manager = SOURCE_MANAGER[source];
    if (!manager) return true;

    const managers = node?.info?.sourceManagers;
    if (!Array.isArray(managers) || !managers.length) return true;
    return managers.includes(manager);
  }

  /**
   * Searches across every connected node and source until something is found.
   * Never throws a raw fetch/JSON error to the user.
   *
   * Supports source prefixes, e.g. `sc:lofi girl`, `sp:daft punk`.
   * Link Spotify / Apple Music / Deezer ditangani otomatis: lewat LavaSrc
   * kalau tersedia, atau diubah jadi pencarian teks kalau belum.
   */
  async search(player, rawQuery, { direct = false } = {}) {
    let query = normalizeQuery(rawQuery);
    let preferredSource = null;

    const prefix = query.match(
      /^(ytmsearch|ytsearch|scsearch|spsearch|amsearch|dzsearch|ytm|yt|sc|sp|am|dz|jssearch):/i,
    );
    if (prefix) {
      const key = prefix[1].toLowerCase();
      preferredSource = SHORT_SOURCE[key] || key;
      query = query.slice(prefix[0].length).trim();
    }

    if (!query) throw new Error("Query kosong.");

    const nodes = this.candidateNodes(player);
    if (!nodes.length) {
      throw new Error(
        "Semua server audio (Lavalink) sedang offline. Bot akan menyambung ulang otomatis, coba lagi sebentar lagi.",
      );
    }

    /* ---- link musik (Spotify / Apple Music / Deezer) ---- */
    const musicLink = parseMusicLink(query);
    let linkDirect = false;

    if (musicLink) {
      const sourceKey = SERVICE_SEARCH_PREFIX[musicLink.service];
      const managerName = SOURCE_MANAGER[sourceKey];
      const supported = nodes.some((node) => this.nodeHasSource(node, sourceKey));

      if (supported) {
        linkDirect = true;
      } else {
        const meta = await resolveMusicLink(musicLink).catch(() => null);

        if (!meta?.title) {
          if (musicLink.kind !== "track") {
            throw new Error(
              `Link ${SERVICE_LABEL[musicLink.service]} **${musicLink.kind}** butuh plugin LavaSrc.\n` +
                "💡 Isi kredensial di `.env` (lihat README bagian Spotify/Apple Music), " +
                "atau putar lagunya satu per satu.",
            );
          }
          throw new Error(
            `Link ${SERVICE_LABEL[musicLink.service]} ini tidak bisa dibaca.\n` +
              "💡 Coba ketik judul lagunya langsung: `?play <judul>`.",
          );
        }

        query = [meta.artist, meta.title].filter(Boolean).join(" ").trim();
        preferredSource = null;
        log.info(
          { service: musicLink.service, resolved: query, manager: managerName },
          "Link musik diubah menjadi pencarian teks (plugin tidak tersedia)",
        );
      }
    }

    const isDirect = linkDirect || direct || isUrl(query);

    const defaultSources = this.isYoutubeDegraded()
      ? ["scsearch", "ytmsearch", "ytsearch"]
      : ["ytmsearch", "ytsearch", "scsearch"];
    const sources = isDirect
      ? [null]
      : preferredSource
        ? [preferredSource, ...defaultSources.filter((source) => source !== preferredSource)]
        : defaultSources;

    const requester = this.client.user ?? { id: config.clientId, username: "ANTIMUSIC" };
    let lastError = null;
    const deadline = Date.now() + config.nodes.searchBudgetMs;

    for (const node of nodes) {
      let nodeFailed = false;

      for (const source of sources) {
        if (Date.now() > deadline) {
          log.warn({ query: truncate(query, 60) }, "Batas waktu pencarian tercapai");
          break;
        }

        // Jangan buang waktu ke sumber yang tidak dipunyai node ini.
        if (source && !this.nodeHasSource(node, source)) continue;

        try {
          const payload = source ? { query, source } : { query };
          const result = await node.search(payload, requester);

          if (result?.loadType === "error") {
            const message = result.exception?.message || "Lavalink search error";
            lastError = new Error(message);
            if (/timeout|aborted|login|all clients failed|sign in/i.test(message)) {
              this.markNodeDegraded(node.id, 45_000);
            }
            continue;
          }

          if (result?.tracks?.length) return result;
        } catch (error) {
          const message = error?.message || String(error);
          lastError = error;

          // "Unexpected token 'P', Proxy erro..." and friends land here.
          if (/timeout|aborted|fetch failed|econnreset|econnrefused|json|proxy/i.test(message)) {
            this.markNodeDegraded(node.id, 60_000);
            nodeFailed = true;
          }
        }

        if (nodeFailed) break;
      }

      if (nodeFailed) continue;
    }

    /* ---- LavaSrc gagal memuat link: coba metadata publik ---- */
    if (musicLink) {
      const meta = await resolveMusicLink(musicLink).catch(() => null);

      if (meta?.title) {
        const textQuery = [meta.artist, meta.title].filter(Boolean).join(" ").trim();
        log.info({ service: musicLink.service, textQuery }, "LavaSrc gagal, memakai pencarian teks");
        return this.search(player, textQuery);
      }

      if (musicLink.kind !== "track") {
        throw new Error(
          `Gagal memuat ${musicLink.kind} dari ${SERVICE_LABEL[musicLink.service]}.\n` +
            "💡 Cek kredensial plugin di `.env`, atau putar lagunya satu per satu.",
        );
      }
    }

    // Last resort for YouTube links: search by the real video title.
    if (isDirect && /(youtube\.com|youtu\.be)/i.test(query)) {
      const title = await fetchYoutubeTitle(query);
      if (title) {
        log.info({ title }, "Link YouTube gagal dimuat, mencoba pencarian berdasarkan judul");
        try {
          return await this.search(player, title);
        } catch {}
      }
    }

    const message = lastError?.message || "";
    if (/timeout|aborted/i.test(message)) {
      throw new Error(
        "Pencarian timeout karena server audio sedang sibuk.\n💡 Coba lagi, atau pakai `?play sc:<judul>` (SoundCloud).",
      );
    }
    if (/login|all clients failed|sign in/i.test(message)) {
      throw new Error(
        "YouTube membatasi pemutaran langsung (login required).\n💡 Coba `?play sc:<judul>` untuk memutar lewat SoundCloud.",
      );
    }

    throw new Error("Lagu tidak ditemukan. Coba kata kunci atau link lain.");
  }

  /* ------------------------------------------------------------------ */
  /* playback                                                            */
  /* ------------------------------------------------------------------ */

  async play(ctx, query) {
    const text = String(query ?? "").trim();
    if (!text) {
      return ctx.reply({ content: "❌ Masukkan judul atau link lagu. Contoh: `?play Bohemian Rhapsody`." });
    }

    let player;
    try {
      player = await this.ensurePlayer(ctx);
    } catch (error) {
      return ctx.reply({ embeds: [errorEmbed("Tidak bisa join voice channel", error.message)] });
    }

    const currentQueue = player.queue?.tracks?.length ?? 0;
    if (currentQueue >= config.maxQueueSize) {
      return ctx.reply({ content: `❌ Antrean sudah penuh (${config.maxQueueSize} lagu).` });
    }

    let result;
    try {
      result = await this.search(player, text);
    } catch (error) {
      return ctx.reply({ embeds: [errorEmbed("Pencarian gagal", error.message)] });
    }

    if (!result?.tracks?.length) {
      return ctx.reply({ content: "❌ Lagu tidak ditemukan." });
    }

    const slots = Math.max(1, config.maxQueueSize - currentQueue);
    const tracks = result.tracks.slice(0, slots);

    await player.queue.add(tracks.length === 1 ? tracks[0] : tracks);

    if (!player.playing && !player.queue?.current) {
      if (player.paused) await player.resume().catch(() => {});
      await player.play().catch((error) => log.warn({ error: error.message }, "player.play() gagal"));
    }

    const isPlaylist = tracks.length > 1 || String(result.loadType || "").toLowerCase().includes("playlist");

    if (isPlaylist) {
      const name = result.playlist?.title || result.playlist?.name;
      return ctx.reply({
        embeds: [
          baseEmbed("📚 Playlist ditambahkan")
            .setDescription(
              `${name ? `**${truncate(name, 80)}**\n` : ""}**${tracks.length}** lagu masuk ke antrean.`,
            )
            .setFooter({ text: `Total antrean: ${player.queue?.tracks?.length ?? 0} lagu` }),
        ],
      });
    }

    const track = tracks[0];
    const uri = trackUri(track);
    const description = `${uri ? `**[${truncate(trackTitle(track), 80)}](${uri})**` : `**${truncate(trackTitle(track), 80)}**`}\n${trackAuthor(track)}`;

    return ctx.reply({
      embeds: [
        successEmbed("✅ Ditambahkan ke antrean", description).setFooter({
          text: `Posisi: #${player.queue?.tracks?.length ?? 1} • ${ms(trackLength(track))}`,
        }),
      ],
    });
  }

  async skip(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }
    if (!player.queue?.current) return ctx.reply({ content: "❌ Tidak ada lagu yang sedang diputar." });

    await player.skip(0, false).catch(() => {});
    return ctx.reply({ content: "⏭️ Lagu di-skip." });
  }

  async stop(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const wasRadio = this.radio.isEnabled(ctx.guildId);
    if (wasRadio) this.radio.disable(ctx.guildId, "stop");

    this.clearIdleTimer(ctx.guildId);
    this.cancelEmptyChannelTimer(ctx.guildId);
    this.autoplayPool.delete(ctx.guildId);

    if (player.queue?.tracks?.length) {
      await player.queue.splice(0, player.queue.tracks.length).catch(() => {});
    }

    await player.destroy("command-stop").catch(() => {});

    return ctx.reply({
      content: wasRadio
        ? "⏹️ Pemutaran dihentikan dan mode 24/7 dimatikan. ANTIMUSIC keluar dari voice channel."
        : "⏹️ Pemutaran dihentikan, antrean dibersihkan, ANTIMUSIC keluar.",
    });
  }

  async pause(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }
    if (player.paused) return ctx.reply({ content: "⏸️ Sudah dalam keadaan pause." });

    player.lastPosition = this.getPosition(player);
    player.lastPositionChange = null;
    await player.pause().catch(() => {});
    await this.updateNowPlaying(player);
    return ctx.reply({ content: "⏸️ Pemutaran dijeda." });
  }

  async resume(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }
    if (!player.paused) return ctx.reply({ content: "▶️ Tidak sedang dijeda." });

    player.lastPositionChange = Date.now();
    await player.resume().catch(() => {});
    await this.updateNowPlaying(player);
    return ctx.reply({ content: "▶️ Pemutaran dilanjutkan." });
  }

  async volume(ctx, value) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });

    if (value == null || Number.isNaN(Number(value))) {
      return ctx.reply({ content: `🔊 Volume saat ini: **${player.volume}%**` });
    }

    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const volume = Math.max(0, Math.min(200, Math.round(Number(value))));
    await player.setVolume(volume).catch(() => {});
    patchState(ctx.guildId, { volume });
    await this.updateNowPlaying(player);
    return ctx.reply({ content: `🔊 Volume diset ke **${volume}%**` });
  }

  async shuffle(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const count = player.queue?.tracks?.length ?? 0;
    if (count < 2) return ctx.reply({ content: "❌ Butuh minimal 2 lagu di antrean." });

    await player.queue.shuffle();
    return ctx.reply({ content: `🔀 **${count}** lagu di antrean berhasil diacak.` });
  }

  async clear(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const count = player.queue?.tracks?.length ?? 0;
    if (!count) return ctx.reply({ content: "❌ Antrean sudah kosong." });

    this.autoplayPool.delete(ctx.guildId);
    this.radio.clear(ctx.guildId);
    await player.queue.splice(0, count).catch(() => {});
    return ctx.reply({ content: `🧹 **${count}** lagu dihapus dari antrean.` });
  }

  async remove(ctx, position) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const tracks = player.queue?.tracks ?? [];
    if (!tracks.length) return ctx.reply({ content: "❌ Antrean kosong." });
    if (!Number.isInteger(position) || position < 1 || position > tracks.length) {
      return ctx.reply({ content: `❌ Posisi tidak valid. Masukkan angka 1 sampai ${tracks.length}.` });
    }

    const removed = tracks[position - 1];
    await player.queue.splice(position - 1, 1).catch(() => {});

    return ctx.reply({ content: `🗑️ Dihapus: **${truncate(trackTitle(removed), 80)}**` });
  }

  async seek(ctx, input) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const track = player.queue?.current;
    if (!track) return ctx.reply({ content: "❌ Tidak ada lagu yang diputar." });
    if (track.info?.isStream || track.info?.isSeekable === false) {
      return ctx.reply({ content: "❌ Track ini tidak bisa di-seek (live stream)." });
    }

    const seconds = parseSeconds(input);
    if (seconds == null) {
      return ctx.reply({ content: "❌ Format waktu salah. Contoh: `?seek 90` atau `?seek 1:30`." });
    }

    const length = trackLength(track);
    const target = seconds * 1000;
    if (length > 0 && target >= length) {
      return ctx.reply({ content: `❌ Melebihi durasi lagu (${ms(length)}).` });
    }

    await player.seek(target).catch(() => {});
    player.lastPosition = target;
    player.lastPositionChange = Date.now();
    await this.updateNowPlaying(player);

    return ctx.reply({ content: `⏩ Seek ke **${ms(target)}**.` });
  }

  async loop(ctx, mode) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    let next = "off";
    if (mode && ["off", "track", "queue"].includes(mode)) {
      next = mode;
    } else {
      const current = player.repeatMode || state(ctx.guildId).loop || "off";
      next = current === "off" ? "track" : current === "track" ? "queue" : "off";
    }

    await player.setRepeatMode(next).catch(() => {});
    patchState(ctx.guildId, { loop: next });
    await this.updateNowPlaying(player);

    const labels = { off: "OFF ⚪", track: "TRACK 🔂", queue: "QUEUE 🔁" };
    return ctx.reply({ content: `🔁 Mode loop: **${labels[next]}**` });
  }

  async autoplay(ctx, enabled) {
    const current = state(ctx.guildId).autoplay;
    const next = enabled == null ? !current : Boolean(enabled);

    patchState(ctx.guildId, { autoplay: next });
    if (!next) this.autoplayPool.delete(ctx.guildId);

    const player = this.getPlayer(ctx.guildId);
    if (player && !player.destroyed) {
      await this.updateNowPlaying(player);
      if (next && player.connected && !player.playing && !player.queue?.current) {
        void this.smartAutoplay(player, { autoStart: true });
      }
    }

    return ctx.reply({
      content: `♾️ Smart autoplay: **${next ? "ON 🟢" : "OFF ⚪"}**${
        next ? "\nLagu lanjutan seirama akan diputar otomatis saat antrean habis." : ""
      }`,
    });
  }

  /* ------------------------------------------------------------------ */
  /* 24/7 radio command                                                  */
  /* ------------------------------------------------------------------ */

  async radioCommand(ctx, enabled, seedInput) {
    const current = state(ctx.guildId).radio;
    const next = enabled == null ? !current : Boolean(enabled);
    const seed = String(seedInput ?? "").trim() || null;

    if (!next) {
      this.radio.disable(ctx.guildId, "command");
      const player = this.getPlayer(ctx.guildId);
      if (player && !player.destroyed) {
        await this.updateNowPlaying(player);
        this.checkEmptyChannel(ctx.guildId);
      }

      return ctx.reply({
        embeds: [
          baseEmbed("📴 Mode 24/7 Dimatikan")
            .setDescription(
              "Bot kembali ke perilaku normal:\n" +
                "• Keluar otomatis saat voice channel kosong\n" +
                "• Keluar saat antrean habis (jika autoplay off)",
            )
            .setColor(0x6b7280),
        ],
      });
    }

    let player;
    try {
      player = await this.ensurePlayer(ctx);
    } catch (error) {
      return ctx.reply({ embeds: [errorEmbed("Tidak bisa memulai mode 24/7", error.message)] });
    }

    this.radio.enable(ctx.guildId, {
      seed,
      voiceChannelId: this.voiceChannel(ctx)?.id,
      textChannelId: ctx.channelId,
      by: ctx.user?.id,
    });

    patchState(ctx.guildId, { autoplay: true, radioLastTitle: seed || state(ctx.guildId).radioLastTitle });

    let started = false;
    if (seed) {
      const result = await this.search(player, seed).catch(() => null);
      if (result?.tracks?.length) {
        await player.queue.add(result.tracks[0]).catch(() => {});
        started = true;
      }
    }

    if (!started && !player.playing && !player.queue?.current) {
      started = await this.radio.kickstart(player).catch(() => false);
    }

    const status = this.radio.status(ctx.guildId);

    return ctx.reply({
      embeds: [
        baseEmbed("📻 Mode 24/7 Aktif")
          .setColor(0x22c55e)
          .setDescription(
            "ANTIMUSIC sekarang berjalan seperti **radio**:\n" +
              "• ♾️ Autoplay tanpa henti, antrean tidak pernah kosong\n" +
              "• 🚪 Tidak akan keluar voice channel walau tidak ada pendengar\n" +
              "• 🔌 Otomatis menyambung ulang jika terputus / bot restart\n\n" +
              `**Seed:** \`${status.seed || seed || config.radio.defaultSeed}\`\n` +
              `**Status pemutaran:** ${started ? "▶️ berjalan" : "⏳ menunggu antrean"}`,
          )
          .setFooter({ text: "Matikan dengan /radio enabled:false atau ?24/7 off" }),
      ],
    });
  }

  async radioStatus(ctx) {
    const status = this.radio.status(ctx.guildId);
    const player = this.getPlayer(ctx.guildId);

    const since = status.since ? `<t:${Math.floor(status.since / 1000)}:R>` : "-";
    const voiceChannel = status.voiceChannelId ? `<#${status.voiceChannelId}>` : "-";

    return ctx.reply({
      embeds: [
        baseEmbed("📻 Status Mode 24/7")
          .setColor(status.enabled ? 0x22c55e : 0x6b7280)
          .setDescription(
            `**Status:** ${status.enabled ? "🟢 AKTIF" : "⚪ Nonaktif"}\n` +
              `**Sejak:** ${since}\n` +
              `**Voice channel:** ${voiceChannel}\n` +
              `**Seed:** \`${status.seed || config.radio.defaultSeed}\`\n` +
              `**Lagu terakhir:** ${status.lastTitle ? truncate(status.lastTitle, 70) : "-"}\n` +
              `**Buffer radio:** ${status.pool} lagu\n` +
              `**Sedang diputar:** ${player?.queue?.current ? truncate(trackTitle(player.queue.current), 70) : "-"}`,
          )
          .setFooter({ text: "?24/7 on | ?24/7 off" }),
      ],
    });
  }

  async leave(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada player aktif." });
    if (!this.sameVoice(ctx, player)) {
      return ctx.reply({ content: "❌ Kamu harus berada di voice channel yang sama dengan bot." });
    }

    const wasRadio = this.radio.isEnabled(ctx.guildId);
    if (wasRadio) this.radio.disable(ctx.guildId, "leave");

    this.cancelEmptyChannelTimer(ctx.guildId);
    this.clearIdleTimer(ctx.guildId);
    await player.destroy("command-leave").catch(() => {});

    return ctx.reply({
      content: wasRadio
        ? "👋 ANTIMUSIC keluar dan mode 24/7 dimatikan."
        : "👋 ANTIMUSIC keluar dari voice channel.",
    });
  }

  /* ------------------------------------------------------------------ */
  /* autoplay                                                            */
  /* ------------------------------------------------------------------ */

  cleanTitle(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/(official\s*(music)?\s*video|official\s*audio|lyrics?|full\s*album|cover|remix|acoustic|live|slowed|reverb|hd|4k|audio|video)/gi, " ")
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  isSameSong(a, b) {
    const first = this.cleanTitle(a);
    const second = this.cleanTitle(b);
    if (!first || !second) return false;
    if (first === second) return true;
    if (first.includes(second) || second.includes(first)) return true;

    const wordsA = new Set(first.split(" ").filter((word) => word.length > 2));
    const wordsB = new Set(second.split(" ").filter((word) => word.length > 2));
    if (!wordsA.size || !wordsB.size) return false;

    let matches = 0;
    for (const word of wordsA) if (wordsB.has(word)) matches++;
    return matches / Math.max(wordsA.size, wordsB.size) >= 0.55;
  }

  extractYouTubeVideoId(track) {
    if (!track) return null;
    const identifier = track?.info?.identifier;
    const source = String(track?.info?.sourceName || "");
    if (identifier && /^[\w-]{11}$/.test(identifier) && (!source || source.includes("youtube"))) {
      return identifier;
    }
    const uri = trackUri(track);
    const match = uri?.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
    return match ? match[1] : null;
  }

  async smartAutoplay(player, { autoStart = true } = {}) {
    const guildId = player.guildId;
    if (this.autoplayBusy.has(guildId)) return false;
    this.autoplayBusy.add(guildId);

    try {
      const seed = this.lastTrack.get(guildId) || player.queue?.previous?.[0] || player.queue?.current;
      if (!seed) return false;

      const guildState = state(guildId);
      const seedTitle = trackTitle(seed);
      const seedAuthor = trackAuthor(seed);
      const cleanAuthor = /unknown/i.test(seedAuthor) ? "" : seedAuthor.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
      const seedId = trackIdentifier(seed);

      const filterPool = (tracks) =>
        (tracks || []).filter((track) => {
          const id = trackIdentifier(track);
          if (!id || guildState.history.includes(id) || id === seedId) return false;
          if (this.isSameSong(trackTitle(track), seedTitle)) return false;
          return true;
        });

      let pool = filterPool(this.autoplayPool.get(guildId) || []);

      if (!pool.length) {
        let mixTracks = [];

        const videoId = this.extractYouTubeVideoId(seed);
        if (videoId && !this.mixBrokenGuilds.has(guildId)) {
          const mixUrl = `https://www.youtube.com/playlist?list=RD${videoId}`;
          const mix = await this.search(player, mixUrl, { direct: true }).catch(() => null);
          if (mix?.tracks?.length) mixTracks = mix.tracks;
          else this.mixBrokenGuilds.add(guildId);
        }

        if (!mixTracks.length && cleanAuthor) {
          for (const query of [`${cleanAuthor} radio`, `${cleanAuthor} mix`, `${cleanAuthor} popular songs`]) {
            const result = await this.search(player, query).catch(() => null);
            if (result?.tracks?.length) {
              mixTracks = result.tracks;
              break;
            }
          }
        }

        if (!mixTracks.length) {
          const result = await this.search(player, `${seedTitle} similar songs`).catch(() => null);
          if (result?.tracks?.length) mixTracks = result.tracks;
        }

        pool = filterPool(mixTracks);
      }

      if (!pool.length) {
        log.warn({ guildId, seed: truncate(seedTitle, 60) }, "Autoplay tidak menemukan lagu yang cocok");
        return false;
      }

      const next = pool.shift();
      this.autoplayPool.set(guildId, pool);

      await player.queue.add(next);
      if (autoStart) {
        player.lastPosition = 0;
        player.lastPositionChange = Date.now();
        await player.play().catch(() => {});
      }

      const channel = this.client.channels.cache.get(player.textChannelId);
      await channel
        ?.send?.({
          embeds: [
            baseEmbed("♾️ Autoplay")
              .setDescription(
                `Melanjutkan dengan lagu seirama:\n**${truncate(trackTitle(next), 80)}**\n${trackAuthor(next)}`,
              )
              .setFooter({ text: `Sisa rekomendasi: ${pool.length}` }),
          ],
        })
        .catch?.(() => {});

      return true;
    } catch (error) {
      log.warn({ guildId, error: error.message }, "Smart autoplay gagal");
      return false;
    } finally {
      this.autoplayBusy.delete(guildId);
    }
  }

  /* ------------------------------------------------------------------ */
  /* embeds / messages                                                   */
  /* ------------------------------------------------------------------ */

  getPosition(player) {
    if (!player?.queue?.current) return 0;
    const length = trackLength(player.queue.current);
    if (!length || player.queue.current.info?.isStream) return 0;

    let position = 0;
    if (typeof player.lastPosition === "number") {
      position = player.paused || !player.lastPositionChange
        ? player.lastPosition
        : player.lastPosition + (Date.now() - player.lastPositionChange);
    } else if (typeof player.position === "number") {
      position = player.position;
    }

    return Math.min(Math.max(0, position), length);
  }

  controls(player) {
    const paused = player?.paused ?? false;
    const guildState = state(player.guildId);
    const autoplay = guildState.autoplay;
    const radio = guildState.radio;

    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("am_pause")
        .setEmoji(paused ? "▶️" : "⏸️")
        .setLabel(paused ? "Resume" : "Pause")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("am_skip")
        .setEmoji("⏭️")
        .setLabel("Skip")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("am_autoplay")
        .setEmoji("♾️")
        .setLabel(autoplay ? "Autoplay ON" : "Autoplay OFF")
        .setStyle(autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("am_radio")
        .setEmoji("📻")
        .setLabel(radio ? "24/7 ON" : "24/7 OFF")
        .setStyle(radio ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("am_stop")
        .setEmoji("⏹️")
        .setLabel("Stop")
        .setStyle(ButtonStyle.Danger),
    );
  }

  /** Markdown link when a URI exists, bold text otherwise (no broken `[]()`). */
  trackLink(track, limit = 70) {
    const title = truncate(trackTitle(track), limit);
    const uri = trackUri(track);
    return uri ? `**[${title}](${uri})**` : `**${title}**`;
  }

  nowPlayingEmbed(track, player) {
    const uri = trackUri(track);
    const length = trackLength(track);
    const isStream = Boolean(track?.info?.isStream);
    const paused = player?.paused ?? false;
    const guildState = state(player.guildId);

    const title = truncate(trackTitle(track), 80).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const duration = isStream ? "🔴 LIVE" : length ? ms(length) : "0:00";

    const embed = baseEmbed("🎧 ANTIMUSIC • Now Playing")
      .setDescription(`${uri ? `**[${title}](${uri})**` : `**${title}**`}${paused ? "\n\n⏸️ *(dijeda)*" : ""}`)
      .addFields(
        { name: "Artist", value: truncate(trackAuthor(track), 40), inline: true },
        { name: "Durasi", value: duration, inline: true },
        { name: "Volume", value: `${player.volume ?? guildState.volume}%`, inline: true },
        { name: "Requester", value: requesterName(track, this.client.user?.id), inline: true },
        { name: "Autoplay", value: guildState.autoplay ? "ON 🟢" : "OFF ⚪", inline: true },
        {
          name: "Mode 24/7",
          value: guildState.radio ? "AKTIF 📻" : "OFF",
          inline: true,
        },
        {
          name: "Kualitas",
          value: guildState.ultraHd ? `${PROFILE_INFO[guildState.hdProfile].emoji} ${PROFILE_INFO[guildState.hdProfile].label}` : "⚪ Standard",
          inline: true,
        },
        { name: "Loop", value: String(player.repeatMode || guildState.loop || "off").toUpperCase(), inline: true },
      )
      .setFooter({ text: "ANTIMUSIC • Ultra HD Engine" });

    const artwork = trackArtwork(track);
    if (artwork) embed.setThumbnail(artwork);
    return embed;
  }

  async publishNowPlaying(player, track) {
    if (!track) return;
    const channel = this.client.channels.cache.get(player.textChannelId);
    if (!channel?.isTextBased?.()) return;

    const payload = { embeds: [this.nowPlayingEmbed(track, player)], components: [this.controls(player)] };
    const existing = this.npMessages.get(player.guildId);

    if (existing) {
      try {
        await existing.edit(payload);
        return;
      } catch {
        this.npMessages.delete(player.guildId);
      }
    }

    try {
      const message = await channel.send(payload);
      this.npMessages.set(player.guildId, message);
    } catch {}
  }

  async updateNowPlaying(player) {
    const message = this.npMessages.get(player.guildId);
    const track = player?.queue?.current;
    if (!message || !track) return;

    await message
      .edit({ embeds: [this.nowPlayingEmbed(track, player)], components: [this.controls(player)] })
      .catch(() => {});
  }

  /* ------------------------------------------------------------------ */
  /* info commands                                                       */
  /* ------------------------------------------------------------------ */

  async queue(ctx) {
    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed) return ctx.reply({ content: "❌ Tidak ada antrean aktif." });

    const current = player.queue?.current;
    const tracks = player.queue?.tracks ?? [];
    if (!current && !tracks.length) return ctx.reply({ content: "❌ Antrean kosong." });

    let description = "";
    if (current) {
      description += `**Sedang diputar:**\n▶️ ${this.trackLink(current, 70)} \`[${ms(trackLength(current))}]\`\n\n`;
    }

    if (tracks.length) {
      description += "**Berikutnya:**\n";
      description += tracks
        .slice(0, 15)
        .map((track, index) => `\`${index + 1}.\` ${this.trackLink(track, 55)} \`[${ms(trackLength(track))}]\``)
        .join("\n");
      if (tracks.length > 15) description += `\n\n*…dan ${tracks.length - 15} lagu lainnya.*`;
    } else {
      description += "*Tidak ada lagu berikutnya.*";
    }

    const guildState = state(ctx.guildId);
    const total = tracks.reduce((sum, track) => sum + trackLength(track), trackLength(current));

    return ctx.reply({
      embeds: [
        baseEmbed(`📋 Antrean (${tracks.length} lagu)`)
          .setDescription(description)
          .setFooter({
            text: `Total: ${ms(total)} • Loop: ${String(player.repeatMode || "off").toUpperCase()} • Autoplay: ${
              guildState.autoplay ? "ON" : "OFF"
            } • 24/7: ${guildState.radio ? "ON" : "OFF"}`,
          }),
      ],
    });
  }

  async nowPlaying(ctx) {
    const player = this.getPlayer(ctx.guildId);
    const track = player?.queue?.current;
    if (!player || player.destroyed || !track) {
      return ctx.reply({ content: "❌ Tidak ada lagu yang diputar." });
    }
    return ctx.reply({ embeds: [this.nowPlayingEmbed(track, player)], components: [this.controls(player)] });
  }

  async ping(ctx) {
    const player = this.getPlayer(ctx.guildId);
    const lavalinkPing = player?.ping?.lavalink ? `${Math.round(player.ping.lavalink)}ms` : "N/A";
    const node = player?.node?.id ?? "N/A";

    return ctx.reply({
      content:
        `🏓 **Pong!**\n` +
        `• Discord Gateway: **${this.client.ws.ping}ms**\n` +
        `• Lavalink: **${lavalinkPing}** (node \`${node}\`)\n` +
        `• Embedded Lavalink: \`${lavalinkSupervisor.status().state}\``,
    });
  }

  async nodes(ctx) {
    const nodes = this.allNodes();
    if (!nodes.length) return ctx.reply({ content: "❌ Tidak ada node Lavalink terkonfigurasi." });

    const player = this.getPlayer(ctx.guildId);
    const currentId = player?.node?.id;
    const connected = nodes.filter((node) => node.connected).length;
    const supervisor = lavalinkSupervisor.status();

    const lines = [
      `**Cluster:** \`${connected}/${nodes.length}\` terhubung • **Auto-failover:** \`${config.nodes.enableFallbacks ? "AKTIF" : "cadangan nonaktif"}\``,
      supervisor.enabled
        ? `**Lavalink lokal:** \`${supervisor.state}\` • pid \`${supervisor.pid ?? "-"}\` • restart \`${supervisor.restarts}\`\n`
        : "",
    ];

    nodes.forEach((node, index) => {
      const isCurrent = currentId === node.id;
      const healthy = this.isNodeHealthy(node);
      const icon = !node.connected ? "🔴" : healthy ? "🟢" : "🟡";
      const ping = node.heartBeatPing ?? node.ping?.lavalink;
      const players = node.stats?.players ?? 0;
      const playing = node.stats?.playingPlayers ?? 0;

      lines.push(
        `${icon} **${index + 1}. ${node.id}** ${isCurrent ? "*(dipakai 🎧)*" : ""}\n` +
          `• \`${node.options.host}:${node.options.port}\` (${node.options.secure ? "SSL" : "no SSL"})\n` +
          `• ${node.connected ? (healthy ? "Connected" : "Connected (cooldown)") : "Offline"} • ping \`${ping ? `${Math.round(ping)}ms` : "N/A"}\` • \`${playing}/${players}\``,
      );
    });

    return ctx.reply({
      embeds: [baseEmbed("🌐 Lavalink Cluster").setDescription(lines.filter(Boolean).join("\n"))],
    });
  }

  async changeNode(ctx, input) {
    const raw = String(input ?? "").trim();
    if (!raw) return ctx.reply({ content: "❌ Contoh: `?changenode 2` atau `?changenode Lavalink-Nazha`." });

    const player = this.getPlayer(ctx.guildId);
    if (!player || player.destroyed || !player.connected) {
      return ctx.reply({ content: "❌ Bot belum terhubung ke voice channel." });
    }

    const nodes = this.allNodes();
    const target = /^\d+$/.test(raw)
      ? nodes[Number(raw) - 1]
      : nodes.find(
          (node) =>
            node.id.toLowerCase() === raw.toLowerCase() ||
            node.options.host.toLowerCase().includes(raw.toLowerCase()),
        );

    if (!target) return ctx.reply({ content: `❌ Node \`${raw}\` tidak ditemukan. Lihat \`?nodes\`.` });
    if (!target.connected) return ctx.reply({ content: `❌ Node **${target.id}** sedang offline.` });
    if (player.node?.id === target.id) {
      return ctx.reply({ content: `ℹ️ Sudah memakai **${target.id}**.` });
    }

    const previous = player.node?.id ?? "unknown";
    await player.changeNode(target, false).catch((error) => {
      log.warn({ error: error.message }, "changeNode gagal");
    });

    const guildState = state(ctx.guildId);
    if (guildState.ultraHd) await applyAudioQualityProfile(player, guildState.hdProfile).catch(() => {});

    return ctx.reply({
      embeds: [
        successEmbed(
          "🔄 Pindah node berhasil",
          `**Dari:** \`${previous}\`\n**Ke:** 🟢 **${target.id}** (\`${target.options.host}:${target.options.port}\`)\nPemutaran berlanjut tanpa berhenti.`,
        ),
      ],
    });
  }

  async ultrahd(ctx, profileInput) {
    const raw = String(profileInput ?? "").trim().toLowerCase();
    const guildState = state(ctx.guildId);
    const player = this.getPlayer(ctx.guildId);
    const voice = this.voiceChannel(ctx);

    const bitrateInfo = voice
      ? await optimizeVoiceChannelBitrate(voice)
      : { previousBitrate: 0, currentBitrate: 0, maxBitrate: 0, boosted: false, canManage: false };

    if (raw) {
      let target = null;
      if (["ultrahd", "hd", "studio", "on", "enable", "master"].includes(raw)) target = "ultrahd";
      else if (["bass", "bassboost", "heavybass"].includes(raw)) target = "bassboost";
      else if (["vocal", "acoustic", "clarity", "clear"].includes(raw)) target = "vocal";
      else if (["off", "flat", "disable", "none", "normal"].includes(raw)) target = "off";

      if (!target) {
        return ctx.reply({
          content:
            "❌ Profil tidak dikenal. Pilihan:\n" +
            "• `?hd studio` — 💎 Ultra HD Studio Master\n" +
            "• `?hd bass` — 🔊 Ultra Bass Boost\n" +
            "• `?hd vocal` — 🎤 Vocal & Acoustic Clarity\n" +
            "• `?hd off` — ⚪ Standard Flat",
        });
      }

      patchState(ctx.guildId, { ultraHd: target !== "off", hdProfile: target });
      if (player && !player.destroyed && player.connected) {
        await applyAudioQualityProfile(player, target);
        await this.updateNowPlaying(player);
      }

      const info = PROFILE_INFO[target];
      const kbps = Math.round((voice?.bitrate ?? bitrateInfo.currentBitrate) / 1000);

      return ctx.reply({
        embeds: [
          baseEmbed(`${info.emoji} ${info.label}`).setDescription(
            `**Status:** ${target !== "off" ? "🟢 Aktif" : "⚪ Nonaktif"}\n` +
              `**Deskripsi:** ${info.description}\n` +
              `**Bitrate channel:** \`${kbps} kbps\`${bitrateInfo.boosted ? " *(dimaksimalkan)*" : ""}\n` +
              `**Output:** \`48 kHz stereo Opus\``,
          ),
        ],
      });
    }

    const info = PROFILE_INFO[guildState.hdProfile];
    const kbps = Math.round((voice?.bitrate ?? bitrateInfo.currentBitrate) / 1000);
    const maxKbps = Math.round((voice?.guild?.maximumBitrate ?? bitrateInfo.maxBitrate) / 1000);

    return ctx.reply({
      embeds: [
        baseEmbed("💎 Ultra HD Audio Engine").setDescription(
          `**Engine:** ${guildState.ultraHd ? "🟢 AKTIF" : "⚪ Nonaktif"}\n` +
            `**Profil:** ${info.emoji} **${info.label}**\n` +
            `*${info.description}*\n\n` +
            `**Bitrate channel:** \`${kbps} kbps\` (maks server: ${maxKbps} kbps)\n` +
            `**Output:** \`48 kHz stereo Opus\`\n\n` +
            "**Ganti profil:** `?hd studio` • `?hd bass` • `?hd vocal` • `?hd off`\n" +
            "💡 Beri izin **Manage Channels** agar bitrate otomatis dimaksimalkan.",
        ),
      ],
    });
  }

  async help(ctx) {
    return ctx.reply({
      embeds: [
        baseEmbed("⚡ ANTIMUSIC • Panduan").setDescription(
          "**🎶 Pemutaran**\n" +
            "• `?play <judul/link>` — YouTube, Spotify, Apple Music, Deezer, SoundCloud\n" +
            "• `?play sp:<judul>` — cari langsung di Spotify (butuh kredensial)\n" +
            "• `?skip` — lewati lagu\n" +
            "• `?stop` — stop + bersihkan antrean + keluar\n" +
            "• `?pause` / `?resume` — jeda / lanjut\n" +
            "• `?queue` — lihat antrean\n" +
            "• `?np` — lagu yang sedang diputar\n" +
            "• `?seek <detik|mm:ss>` — lompat ke waktu tertentu\n" +
            "• `?volume <0-200>` — atur volume\n" +
            "• `?shuffle` / `?clear` / `?remove <n>` — kelola antrean\n" +
            "• `?loop [off|track|queue]` — mode perulangan\n" +
            "• `?autoplay [on|off]` — lagu lanjutan otomatis\n\n" +
            "**📻 Mode 24/7 (Radio)**\n" +
            "• `?24/7` — nyalakan / matikan mode radio\n" +
            "• `?24/7 on lofi hip hop` — mulai radio dengan seed tertentu\n" +
            "• `/radio` — versi slash command\n" +
            "• Saat aktif: autoplay tanpa henti, tidak pernah keluar voice channel, otomatis reconnect\n\n" +
            "**⚙️ Lainnya**\n" +
            "• `?hd [studio|bass|vocal|off]` — kualitas audio\n" +
            "• `?nodes` — status node Lavalink\n" +
            "• `?changenode <nomor/nama>` — pindah node\n" +
            "• `?ping` — latensi\n" +
            "• `?leave` — keluar voice channel",
        ).setFooter({ text: "Prefix ? atau slash command /" }),
      ],
    });
  }

  /* ------------------------------------------------------------------ */
  /* buttons                                                             */
  /* ------------------------------------------------------------------ */

  async handleButton(interaction) {
    if (!interaction.inGuild()) return;

    const player = this.getPlayer(interaction.guildId);
    if (!player || player.destroyed) {
      return interaction.reply({ content: "❌ Player sudah tidak aktif.", flags: MessageFlags.Ephemeral });
    }

    const voice = interaction.member?.voice?.channel;
    if (!voice || (player.voiceChannelId && player.voiceChannelId !== voice.id)) {
      return interaction.reply({
        content: "❌ Masuk ke voice channel yang sama dengan bot untuk memakai tombol ini.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const ctx = {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      member: interaction.member,
      user: interaction.user,
      reply: async (payload) => {
        const data = typeof payload === "string" ? { content: payload } : payload;
        return interaction.editReply(data);
      },
    };

    switch (interaction.customId) {
      case "am_pause": {
        if (player.paused) {
          player.lastPositionChange = Date.now();
          await player.resume().catch(() => {});
          await this.updateNowPlaying(player);
          return ctx.reply("▶️ Dilanjutkan.");
        }
        player.lastPosition = this.getPosition(player);
        player.lastPositionChange = null;
        await player.pause().catch(() => {});
        await this.updateNowPlaying(player);
        return ctx.reply("⏸️ Dijeda.");
      }
      case "am_skip":
        await player.skip(0, false).catch(() => {});
        return ctx.reply("⏭️ Lagu di-skip.");
      case "am_autoplay":
        return this.autoplay(ctx, !state(ctx.guildId).autoplay);
      case "am_radio":
        return this.radioCommand(ctx, !state(ctx.guildId).radio, null);
      case "am_stop":
        return this.stop(ctx);
      default:
        return ctx.reply("❓ Tombol tidak dikenal.");
    }
  }
}

export default MusicService;
