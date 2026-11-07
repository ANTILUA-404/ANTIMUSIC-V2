import { EmbedBuilder } from "discord.js";

export function ms(ms = 0) {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function parseSeconds(input) {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  const text = String(input).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p) || p < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function truncate(value = "", limit = 80) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

/**
 * Collapses a multi-line error (Lavalink sends full stack traces inside
 * `exception.message`) into one log line.
 *
 * Without this the panel console gets flooded with raw Java stack frames,
 * which is exactly what made the old logs unreadable.
 */
export function oneLine(value = "", limit = 200) {
  const text = String(value ?? "")
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, limit);
}

export function normalizeQuery(query) {
  const trimmed = String(query ?? "").trim();
  if (/^(www\.|youtube\.com|youtu\.be|music\.youtube\.com)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function isUrl(value) {
  try {
    const url = new URL(normalizeQuery(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function trackTitle(track) {
  return track?.info?.title || track?.title || "Unknown track";
}

export function trackUri(track) {
  return track?.info?.uri || track?.uri || null;
}

export function trackAuthor(track) {
  return track?.info?.author || track?.author || "Unknown";
}

export function trackLength(track) {
  return track?.info?.duration ?? track?.info?.length ?? track?.duration ?? 0;
}

export function trackIdentifier(track) {
  return track?.info?.identifier || track?.encoded || trackUri(track) || trackTitle(track);
}

export function trackArtwork(track) {
  if (track?.info?.artworkUrl) return track.info.artworkUrl;
  const id = track?.info?.identifier;
  const source = String(track?.info?.sourceName || "");
  if (id && /^[\w-]{11}$/.test(id) && (source.includes("youtube") || String(track?.info?.uri || "").includes("youtu"))) {
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  return null;
}

export function requesterName(track, botId) {
  const requester = track?.requester;
  if (!requester) return "Unknown";
  if (botId && requester.id === botId) return "Autoplay ♾️";
  return requester.globalName || requester.username || requester.tag || "Unknown";
}

export function baseEmbed(title) {
  return new EmbedBuilder().setColor(0x7c3aed).setTitle(title).setTimestamp();
}

export function errorEmbed(title, description) {
  return new EmbedBuilder().setColor(0xef4444).setTitle(title).setDescription(description).setTimestamp();
}

export function successEmbed(title, description) {
  return new EmbedBuilder().setColor(0x22c55e).setTitle(title).setDescription(description).setTimestamp();
}

export function chunk(array, size) {
  const output = [];
  for (let i = 0; i < array.length; i += size) output.push(array.slice(i, i + size));
  return output;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries an async function with exponential backoff. */
export async function retry(fn, { attempts = 3, baseDelay = 500, maxDelay = 8000, onError } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (error) {
      lastError = error;
      if (onError) onError(error, i);
      if (i === attempts - 1) break;
      const delay = Math.min(maxDelay, baseDelay * 2 ** i);
      await sleep(delay);
    }
  }
  throw lastError;
}
