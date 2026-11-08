import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeNode } from './audio/lavalink-node.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root. */
export const ROOT = path.resolve(__dirname, '..');

/**
 * `.env` SELALU dibaca dari root project, bukan dari current working directory.
 *
 * Panel (Pterodactyl, dsb.) kadang menjalankan `node /home/container/index.js`
 * dari direktori lain, sehingga `dotenv/config` biasa akan melewatkan .env dan
 * bot mati dengan "DISCORD_TOKEN kosong" padahal file-nya ada.
 *
 * dotenv TIDAK menimpa env yang sudah ada, jadi variabel dari tab Startup panel
 * tetap menang.
 */
const ENV_FILE = path.join(ROOT, '.env');
const envLoaded = fs.existsSync(ENV_FILE);
if (envLoaded) dotenv.config({ path: ENV_FILE, quiet: true });

export const envFile = envLoaded ? ENV_FILE : null;

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const binDir = path.join(ROOT, 'bin');
const localYtdlp = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const localFfmpeg = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

/**
 * Resolution order for yt-dlp:
 *   1. YTDLP_PATH in .env
 *   2. ./bin/yt-dlp  (auto-downloaded by scripts/install-ytdlp.js on first boot)
 *   3. `yt-dlp` from PATH
 */
function resolveYtdlp() {
  const fromEnv = process.env.YTDLP_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(localYtdlp)) return localYtdlp;
  return 'yt-dlp';
}

/**
 * Resolution order for FFmpeg:
 *   1. FFMPEG_PATH in .env
 *   2. ./bin/ffmpeg  (auto-downloaded; tidak lagi bergantung pada install
 *      script npm `ffmpeg-static` yang diblokir npm 11.7+)
 *   3. `ffmpeg` from PATH
 */
function resolveFfmpeg() {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (fs.existsSync(localFfmpeg)) return localFfmpeg;
  return 'ffmpeg';
}

/** IDLE_DESTROY_MS (v2) is accepted as an alias so old .env files keep working. */
function idleLeaveSeconds() {
  if (process.env.IDLE_LEAVE_SECONDS !== undefined && process.env.IDLE_LEAVE_SECONDS !== '') {
    return toNumber(process.env.IDLE_LEAVE_SECONDS, 60);
  }
  if (process.env.IDLE_DESTROY_MS !== undefined && process.env.IDLE_DESTROY_MS !== '') {
    return Math.round(toNumber(process.env.IDLE_DESTROY_MS, 60_000) / 1000);
  }
  return 60;
}

/**
 * Node Lavalink (mis. Railway). Kosong = engine lokal (yt-dlp + FFmpeg).
 * `LAVALINK_NODES` (JSON array) menang atas variabel tunggal, berguna untuk failover.
 *
 * Skema + port diturunkan di `normalizeNode()` (lihat audio/lavalink-node.js):
 * host internal Railway otomatis http, domain publik otomatis https/443. Jadi
 * `LAVALINK_SECURE` boleh dikosongkan dan tidak ada lagi salah tebak yang
 * berujung "Proxy error" + `SyntaxError: Unexpected token 'P'`.
 */
function lavalinkNodes() {
  const retryAmount = toNumber(process.env.LAVALINK_RETRY_AMOUNT, 10);
  const retryDelay = toNumber(process.env.LAVALINK_RETRY_DELAY_MS, 5000);

  const build = (input) => {
    const { node, notes } = normalizeNode({ retryAmount, retryDelay, ...input }, process.env);
    for (const note of notes) console.warn(`[config] node "${node.id}": ${note}`);
    return node;
  };

  const raw = process.env.LAVALINK_NODES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((node, index) =>
          build({ ...node, id: String(node.id ?? `node-${index + 1}`) }),
        );
      }
    } catch (error) {
      console.warn('[config] LAVALINK_NODES bukan JSON valid, diabaikan');
    }
  }

  const target = process.env.LAVALINK_URL?.trim() || process.env.LAVALINK_HOST?.trim();
  if (!target) return [];

  const secureEnv = process.env.LAVALINK_SECURE?.trim();

  return [
    build({
      id: process.env.LAVALINK_NODE_ID?.trim() || 'main',
      url: target,
      // undefined = biar normalizeNode yang menebak dari host/port.
      port: process.env.LAVALINK_PORT?.trim() || undefined,
      secure: secureEnv ? toBool(secureEnv, undefined) : undefined,
      password: process.env.LAVALINK_PASSWORD?.trim() || '',
    }),
  ];
}

const LAVALINK_NODES = lavalinkNodes();

export const config = {
  token: process.env.DISCORD_TOKEN?.trim() || '',
  clientId: process.env.CLIENT_ID?.trim() || '',
  /** Optional: register slash commands to a single guild (instant, great for dev). */
  guildId: process.env.GUILD_ID?.trim() || null,

  paths: {
    root: ROOT,
    dataDir: path.join(ROOT, 'data'),
    binDir,
  },

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID?.trim() || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET?.trim() || '',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  ytdlp: {
    bin: resolveYtdlp(),
    /** Download yt-dlp into ./bin when the binary is missing (Pterodactyl friendly). */
    autoInstall: toBool(process.env.YTDLP_AUTO_INSTALL, true),
    /** Netscape cookie file, useful for age-restricted / members-only content. */
    cookies: process.env.YTDLP_COOKIES?.trim() || null,
    proxy: process.env.YTDLP_PROXY?.trim() || null,
    /** Extractor args, e.g. "youtube:player_client=web,android" */
    extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS?.trim() || null,
  },

  ffmpeg: {
    bin: resolveFfmpeg(),
    /** 48kHz stereo PCM as required by Discord voice. */
    sampleRate: 48_000,
    channels: 2,
    bitrate: '128k',
  },

  defaults: {
    volume: Math.min(200, Math.max(0, toNumber(process.env.DEFAULT_VOLUME, 80))),
    maxQueue: toNumber(process.env.MAX_QUEUE_SIZE, 500),
    /** Auto-leave the voice channel after this many seconds of silence. */
    idleLeaveSeconds: idleLeaveSeconds(),
    /** How many results to show in the search picker. */
    searchResults: Math.min(10, Math.max(1, toNumber(process.env.SEARCH_RESULTS, 5))),
    /** Keep playing related tracks when the queue runs out. */
    autoplay: toBool(process.env.AUTOPLAY ?? process.env.AUTOPLAY_DEFAULT, false),
    /** Default loop mode: off | track | queue */
    loop: ['off', 'track', 'queue'].includes(process.env.DEFAULT_LOOP) ? process.env.DEFAULT_LOOP : 'off',
  },

  radio: {
    /** Reconnect backoff for a dropped 24/7 stream. */
    retryDelayMs: toNumber(process.env.RADIO_RETRY_DELAY_MS, 5_000),
    maxRetries: toNumber(process.env.RADIO_MAX_RETRIES, 10),
    /** Rejoin saved 24/7 sessions after a restart. */
    restoreOnBoot: toBool(process.env.RADIO_RESTORE_ON_BOOT, true),
  },

  /** Pilihan engine audio: lavalink (utama) atau lokal (yt-dlp + FFmpeg). */
  audio: {
    /** auto = coba Lavalink dulu, kalau gagal pakai lokal. */
    engine: ['auto', 'lavalink', 'local'].includes(process.env.AUDIO_ENGINE)
      ? process.env.AUDIO_ENGINE
      : 'auto',
    /** Kalau Lavalink tidak bisa dihubungi, turun ke engine lokal (bukan mati). */
    fallbackLocal: toBool(process.env.AUDIO_FALLBACK_LOCAL, true),
    lavalink: {
      enabled: LAVALINK_NODES.length > 0,
      nodes: LAVALINK_NODES,
      searchSource: process.env.LAVALINK_SEARCH_SOURCE?.trim() || 'youtube',
      /** Tunggu node benar-benar menjawab /v4/info sebelum menyerah ke engine lokal. */
      startupWaitMs: toNumber(process.env.LAVALINK_STARTUP_WAIT_MS, 90_000),
      connectTimeoutMs: toNumber(process.env.LAVALINK_CONNECT_TIMEOUT_MS, 20_000),
    },
  },

  /** Zero-setup: daftarkan slash command otomatis setiap start (kalau berubah). */
  commands: {
    autoDeploy: toBool(process.env.AUTO_DEPLOY_COMMANDS, true),
  },

  /** HTTP health endpoint - Pterodactyl sets SERVER_PORT automatically. */
  health: {
    port: toNumber(process.env.SERVER_PORT ?? process.env.HEALTH_PORT, 0),
  },

  /** Server licence gating (same behaviour as ANTIMUSIC v2). */
  whitelist: {
    enabled: toBool(process.env.WHITELIST_ENABLED, false),
    guildIds: String(process.env.WHITELIST_GUILD_IDS ?? '')
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value) => /^\d{15,25}$/.test(value)),
    ownerUsername: process.env.OWNER_USERNAME?.trim() || 'owner',
    ownerUserId: process.env.OWNER_USER_ID?.trim() || '',
    leaveUnauthorized: toBool(process.env.WHITELIST_LEAVE_UNAUTHORIZED, true),
    notifyCooldownMs: toNumber(process.env.WHITELIST_NOTIFY_COOLDOWN_MS, 10_000),
  },

  embed: {
    color: process.env.EMBED_COLOR || '#5865F2',
    success: '#57F287',
    error: '#ED4245',
    warn: '#FEE75C',
  },

  dataDir: path.join(ROOT, 'data'),
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function assertRuntimeConfig() {
  const problems = [];
  if (!config.token) problems.push('DISCORD_TOKEN belum diisi di file .env');
  if (!config.clientId) problems.push('CLIENT_ID belum diisi di file .env');
  return problems;
}
