import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env");

if (fs.existsSync(ENV_FILE)) {
  dotenv.config({ path: ENV_FILE });
} else {
  dotenv.config();
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const clean = (value) => String(value ?? "").trim();

const str = (value, fallback = "") => {
  const v = clean(value);
  return v || fallback;
};

const num = (value, fallback) => {
  const text = clean(value);
  if (!text) return fallback; // "" must not become 0
  const v = Number(text);
  return Number.isFinite(v) ? v : fallback;
};

const int = (value, fallback) => Math.trunc(num(value, fallback));

const bool = (value, fallback = false) => {
  const v = clean(value).toLowerCase();
  if (!v) return fallback;
  if (["1", "true", "yes", "on", "y", "aktif", "enabled"].includes(v)) return true;
  if (["0", "false", "no", "off", "n", "nonaktif", "disabled"].includes(v)) return false;
  return fallback;
};

const list = (value, fallback = []) => {
  const v = clean(value);
  if (!v) return fallback;
  return v.split(",").map((x) => x.trim()).filter(Boolean);
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isLocalHost = (host) => ["127.0.0.1", "localhost", "0.0.0.0", "::1", "lavalink"].includes(String(host).toLowerCase());

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

const problems = [];

function required(name, value, hint) {
  if (!value) {
    problems.push({ name, hint });
    return "";
  }
  return value;
}

const token = required(
  "DISCORD_TOKEN",
  str(process.env.DISCORD_TOKEN),
  "Buka tab Files di Pterodactyl -> edit file .env -> isi DISCORD_TOKEN dengan token bot kamu (Discord Developer Portal -> Bot -> Reset Token).",
);

const clientId = required(
  "CLIENT_ID",
  str(process.env.CLIENT_ID),
  "Isi CLIENT_ID dengan Application ID bot kamu (Discord Developer Portal -> General Information -> Application ID).",
);

if (token && !/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(token)) {
  problems.push({
    name: "DISCORD_TOKEN",
    hint: "Format token tidak valid. Token bot harus terdiri dari 3 bagian dipisahkan titik (xxx.yyy.zzz). Pastikan tidak ada spasi/enter di akhir baris.",
  });
}

if (clientId && !/^\d{15,25}$/.test(clientId)) {
  problems.push({
    name: "CLIENT_ID",
    hint: "CLIENT_ID harus berupa angka (Application ID), bukan nama bot atau token.",
  });
}

if (problems.length) {
  const lines = [
    "",
    "================================================================",
    " ANTIMUSIC - KONFIGURASI BELUM LENGKAP",
    "================================================================",
  ];
  for (const p of problems) {
    lines.push(` [X] ${p.name}`);
    lines.push(`     ${p.hint}`);
    lines.push("");
  }
  lines.push(" Setelah diperbaiki, restart server dari panel Pterodactyl.");
  lines.push("================================================================");
  lines.push("");
  console.error(lines.join("\n"));
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Lavalink                                                            */
/* ------------------------------------------------------------------ */

const rawHost = str(process.env.LAVALINK_HOST, "127.0.0.1")
  .replace(/^https?:\/\//i, "")
  .replace(/\/+$/, "")
  .replace(/:\d+$/, "");

const secureByPort = num(process.env.LAVALINK_PORT, 2333) === 443;
const lavalinkPort = clamp(int(process.env.LAVALINK_PORT, secureByPort ? 443 : 2333), 1, 65535);
const lavalinkSecure = bool(process.env.LAVALINK_SECURE, secureByPort);
const lavalinkPassword = str(process.env.LAVALINK_PASSWORD, "antimusic-super-secret").replace(/^["']|["']$/g, "");

const lavalinkHost = rawHost || "127.0.0.1";
const localHost = isLocalHost(lavalinkHost);

/** Embedded = we start & supervise the Lavalink jar ourselves. */
const embedded = bool(process.env.LAVALINK_EMBEDDED, localHost) && localHost;

/**
 * Reads the container memory limit straight from the cgroup.
 *
 * Pterodactyl sets SERVER_MEMORY, but other panels (Pelican, generic Docker,
 * plain VPS) do not. Without this the JVM could ask for more heap than the
 * container has, get OOM-killed by the kernel, and look "unhealthy" forever.
 */
function detectContainerMemoryMb() {
  const sources = [
    "/sys/fs/cgroup/memory.max", // cgroup v2
    "/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
  ];

  for (const file of sources) {
    try {
      const raw = fs.readFileSync(file, "utf8").trim();
      if (!raw || raw === "max") continue;

      const bytes = Number(raw);
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      // cgroup v1 reports a huge sentinel value when there is no limit.
      if (bytes > 64 * 1024 ** 3) continue;

      return Math.floor(bytes / 1024 / 1024);
    } catch {}
  }

  return 0;
}

/**
 * Memory for the embedded JVM. We never take everything: the Node process
 * needs room too, and going over the container limit means SIGKILL.
 */
const serverMemory = int(process.env.SERVER_MEMORY, 0) || detectContainerMemoryMb();
const memoryMb = clamp(
  int(process.env.LAVALINK_MEMORY_MB, serverMemory ? Math.max(384, Math.min(1024, Math.floor(serverMemory * 0.45))) : 512),
  256,
  4096,
);

const javaArgs = list(process.env.LAVALINK_JAVA_ARGS, [
  `-Xms${Math.max(128, Math.floor(memoryMb / 2))}M`,
  `-Xmx${memoryMb}M`,
  // Exit instead of hanging half-dead when the heap is exhausted; the watchdog
  // then restarts it cleanly.
  "-XX:+ExitOnOutOfMemoryError",
  "-Djava.awt.headless=true",
]);

function parseFallbacks(raw) {
  const text = clean(raw);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.host)
      .map((item, index) => ({
        id: str(item.id, `Lavalink-Fallback-${index + 1}`),
        host: str(item.host).replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(/:\d+$/, ""),
        port: clamp(int(item.port, 443), 1, 65535),
        authorization: str(item.authorization ?? item.password, ""),
        secure: bool(item.secure, int(item.port, 443) === 443),
      }));
  } catch {
    console.warn("[ANTIMUSIC] LAVALINK_FALLBACKS bukan JSON yang valid, daftar fallback diabaikan.");
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Spotify / Apple Music / Deezer                                      */
/* ------------------------------------------------------------------ */

const spotifyClientId = str(process.env.SPOTIFY_CLIENT_ID);
const spotifyClientSecret = str(process.env.SPOTIFY_CLIENT_SECRET);
const spotifyEnabled = Boolean(spotifyClientId && spotifyClientSecret);

if (spotifyEnabled && (!/^[a-f0-9]{32}$/i.test(spotifyClientId) || !/^[a-f0-9]{32}$/i.test(spotifyClientSecret))) {
  console.warn(
    "[ANTIMUSIC] SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET bentuknya tidak biasa (normalnya 32 karakter hex). Tetap dicoba.",
  );
}

const appleToken = str(process.env.APPLE_MUSIC_MEDIA_API_TOKEN);
const appleTokenIsJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(appleToken);

if (appleToken && !appleTokenIsJwt) {
  // LavaSrc melempar exception saat token tidak valid -> Lavalink mati total.
  // Lebih baik source Apple dimatikan daripada bot tidak bisa start.
  console.warn(
    "[ANTIMUSIC] APPLE_MUSIC_MEDIA_API_TOKEN bukan JWT valid (harus 3 bagian dipisah titik). " +
      "Source Apple Music DIMATIKAN supaya Lavalink tidak crash. Link Apple tetap bisa diputar lewat pencarian teks.",
  );
}

const appleEnabled = Boolean(appleToken && appleTokenIsJwt);

const deezerArl = str(process.env.DEEZER_ARL);
const deezerMasterKey = str(process.env.DEEZER_MASTER_DECRYPTION_KEY);
const deezerEnabled = Boolean(deezerArl && deezerMasterKey);

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

const dataDir = path.join(ROOT, "data");
const lavalinkDir = path.join(ROOT, "lavalink");

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export const config = {
  root: ROOT,
  envFile: ENV_FILE,

  token,
  clientId,
  guildId: str(process.env.GUILD_ID) || null,
  prefix: str(process.env.PREFIX, "?"),

  defaultVolume: clamp(int(process.env.DEFAULT_VOLUME, 70), 0, 200),
  maxQueueSize: clamp(int(process.env.MAX_QUEUE_SIZE, 500), 1, 10000),

  /** 0 = player never auto-destroys when the queue ends. */
  idleDestroyMs: clamp(int(process.env.IDLE_DESTROY_MS, 15000), 0, 3_600_000),
  /** 0 = bot never leaves an empty voice channel on its own. */
  emptyChannelLeaveMs: clamp(int(process.env.EMPTY_CHANNEL_LEAVE_MS, 30000), 0, 3_600_000),

  autoplayDefault: bool(process.env.AUTOPLAY_DEFAULT, false),

  healthPort: clamp(int(process.env.HEALTH_PORT, int(process.env.SERVER_PORT, 3000)), 1, 65535),

  logLevel: str(process.env.LOG_LEVEL, "info").toLowerCase(),
  logJson: bool(process.env.LOG_JSON, false),

  lavalink: {
    host: lavalinkHost,
    port: lavalinkPort,
    password: lavalinkPassword,
    secure: lavalinkSecure,
    embedded,
    memoryMb,
    javaArgs,
    javaBin: str(process.env.LAVALINK_JAVA_BIN),
    startupTimeoutMs: clamp(int(process.env.LAVALINK_STARTUP_TIMEOUT_MS, 240_000), 15_000, 900_000),
    autoRestart: bool(process.env.LAVALINK_AUTO_RESTART, true),

    /* --- health check -------------------------------------------------
     * One slow HTTP probe is normal while the JVM parses a large playlist or
     * retries a blocked YouTube request. The old build killed the process
     * after 3 probes with a 3s timeout, which produced false positives and
     * a restart loop. Now: retry the probe, require several consecutive
     * failures, and never judge a JVM that just booted.
     * ----------------------------------------------------------------- */
    healthCheckIntervalMs: clamp(int(process.env.LAVALINK_HEALTH_INTERVAL_MS, 15_000), 5000, 120_000),
    healthProbeTimeoutMs: clamp(int(process.env.LAVALINK_HEALTH_TIMEOUT_MS, 6000), 1000, 30_000),
    healthProbeAttempts: clamp(int(process.env.LAVALINK_HEALTH_ATTEMPTS, 2), 1, 5),
    healthFailThreshold: clamp(int(process.env.LAVALINK_HEALTH_FAILS, 5), 2, 20),

    /** Kill a leftover Lavalink.jar that still holds the port from a past run. */
    reclaimPort: bool(process.env.LAVALINK_RECLAIM_PORT, true),

    manageConfig: bool(process.env.LAVALINK_MANAGE_CONFIG, true),
    jarVersion: str(process.env.LAVALINK_VERSION, "4.2.2"),
    youtubePlugin: str(process.env.LAVALINK_YOUTUBE_PLUGIN, "1.18.2"),
    youtubeClients: list(process.env.LAVALINK_YOUTUBE_CLIENTS, [
      "MUSIC",
      "ANDROID_VR",
      "WEB",
      "WEBEMBEDDED",
      "TVHTML5_SIMPLY",
      "MWEB",
    ]),
    youtubeOAuth: bool(process.env.YOUTUBE_OAUTH_ENABLED, false),
    youtubeRefreshToken: str(process.env.YOUTUBE_OAUTH_REFRESH_TOKEN),
    youtubePoToken: str(process.env.YOUTUBE_PO_TOKEN),
    youtubeVisitorData: str(process.env.YOUTUBE_VISITOR_DATA),
    youtubeRemoteCipherUrl: str(process.env.YOUTUBE_REMOTE_CIPHER_URL),
    youtubeRemoteCipherPassword: str(process.env.YOUTUBE_REMOTE_CIPHER_PASSWORD),
    youtubeRemoteCipherUserAgent: str(process.env.YOUTUBE_REMOTE_CIPHER_USER_AGENT, "ANTIMUSIC"),
  },

  nodes: {
    enableFallbacks: bool(process.env.LAVALINK_ENABLE_FALLBACKS, false),
    fallbacks: parseFallbacks(process.env.LAVALINK_FALLBACKS),
    requestTimeoutMs: clamp(int(process.env.LAVALINK_REQUEST_TIMEOUT_MS, 20000), 1000, 60_000),
    /** Total time budget for one user search across every node/source. */
    searchBudgetMs: clamp(int(process.env.LAVALINK_SEARCH_BUDGET_MS, 45000), 5000, 180_000),
  },

  /** Spotify / Apple Music / Deezer lewat plugin LavaSrc. */
  musicSources: {
    lavasrcEnabled: bool(process.env.LAVASRC_ENABLED, true),
    pluginVersion: str(process.env.LAVASRC_VERSION, "4.8.3"),
    /** Urutan sumber audio untuk "mirroring" Spotify/Apple (metadata -> audio). */
    providers: list(process.env.LAVASRC_PROVIDERS, [
      "scsearch:%QUERY%",
      "ytsearch:%QUERY%",
      'ytsearch:"%ISRC%"',
    ]),
    spotify: {
      enabled: spotifyEnabled,
      clientId: spotifyClientId,
      clientSecret: spotifyClientSecret,
      countryCode: str(process.env.SPOTIFY_COUNTRY_CODE, "ID"),
      playlistLoadLimit: clamp(int(process.env.SPOTIFY_PLAYLIST_LOAD_LIMIT, 6), 1, 20),
      albumLoadLimit: clamp(int(process.env.SPOTIFY_ALBUM_LOAD_LIMIT, 6), 1, 20),
      resolveArtistsInSearch: bool(process.env.SPOTIFY_RESOLVE_ARTISTS, true),
    },
    appleMusic: {
      enabled: appleEnabled,
      mediaApiToken: appleEnabled ? appleToken : "",
      countryCode: str(process.env.APPLE_MUSIC_COUNTRY_CODE, "ID"),
      playlistLoadLimit: clamp(int(process.env.APPLE_MUSIC_PLAYLIST_LOAD_LIMIT, 6), 1, 20),
      albumLoadLimit: clamp(int(process.env.APPLE_MUSIC_ALBUM_LOAD_LIMIT, 6), 1, 20),
    },
    deezer: {
      enabled: deezerEnabled,
      arl: deezerArl,
      masterDecryptionKey: deezerMasterKey,
    },
  },

  radio: {
    /** Start 24/7 radio automatically on every guild that enables it. */
    restoreOnBoot: bool(process.env.RADIO_RESTORE_ON_BOOT, true),
    /** Default seed when the radio has no "last track" yet. */
    defaultSeed: str(process.env.RADIO_DEFAULT_SEED, "lofi hip hop mix"),
    /** Last-resort queries so the radio can never run dry. */
    fallbackQueries: list(process.env.RADIO_FALLBACK_QUERIES, [
      "lofi hip hop radio",
      "chillhop mix",
      "instrumental study music",
      "acoustic covers playlist",
      "synthwave retrowave mix",
    ]),
    /** How many tracks to buffer per refill. */
    batchSize: clamp(int(process.env.RADIO_BATCH_SIZE, 15), 1, 50),
    /** Retry delay when a refill fails. */
    retryMs: clamp(int(process.env.RADIO_RETRY_MS, 15000), 3000, 300_000),
  },

  whitelist: {
    /** true = hanya server di daftar yang boleh memakai bot. */
    enabled: bool(process.env.WHITELIST_ENABLED, true),
    /** ID server dari .env (dipisah koma / spasi). */
    guildIds: list(process.env.WHITELIST_GUILD_IDS),
    /** Nama owner yang ditampilkan di panel "belum berlisensi". */
    ownerUsername: str(process.env.OWNER_USERNAME, "xelzlovecean_33932"),
    /** Opsional: ID numerik owner supaya muncul tombol "Hubungi Owner". */
    ownerUserId: str(process.env.OWNER_USER_ID),
    /** Keluar otomatis dari server yang tidak berlisensi. */
    leaveUnauthorized: bool(process.env.WHITELIST_LEAVE_UNAUTHORIZED, true),
    /** Jeda minimal antar panel penolakan di channel yang sama. */
    notifyCooldownMs: clamp(int(process.env.WHITELIST_NOTIFY_COOLDOWN_MS, 10000), 1000, 600000),
  },

  paths: {
    dataDir,
    lavalinkDir,
    stateFile: path.join(dataDir, "state.json"),
    lavalinkLog: path.join(lavalinkDir, "lavalink.log"),
    jarFile: path.join(lavalinkDir, "Lavalink.jar"),
    configFile: path.join(lavalinkDir, "application.yml"),
    configTemplate: path.join(lavalinkDir, "application.yml.example"),
    jreDir: path.join(lavalinkDir, "jre"),
  },
};

export default config;
