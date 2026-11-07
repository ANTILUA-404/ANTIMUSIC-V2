/** 215 -> "3:35", 3725 -> "1:02:05" */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'LIVE';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parses "3:35", "1:02:05" or plain seconds into a number. */
export function parseDuration(input) {
  if (input === undefined || input === null || input === '') return null;
  const raw = String(input).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

export function progressBar(current, total, size = 18) {
  if (!Number.isFinite(total) || total <= 0) return '🔴 LIVE';
  const ratio = Math.min(1, Math.max(0, current / total));
  const index = Math.round(ratio * (size - 1));
  return `${'▬'.repeat(index)}🔘${'▬'.repeat(Math.max(0, size - 1 - index))}`;
}

export function truncate(text, max = 60) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Escapes markdown so titles like "*NSYNC" don't break embeds. */
export function escapeMarkdown(text = '') {
  return String(text).replace(/([*_`~\\|>])/g, '\\$1');
}

export function link(text, url) {
  return `[${escapeMarkdown(truncate(text, 70))}](${url})`;
}

export function playlistDuration(tracks) {
  return tracks.reduce((sum, track) => sum + (Number.isFinite(track.duration) ? track.duration : 0), 0);
}
