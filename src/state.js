import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./logger.js";

const STATE_FILE = config.paths.stateFile;

const DEFAULT_GUILD_STATE = () => ({
  autoplay: config.autoplayDefault,
  loop: "off",
  volume: config.defaultVolume,
  history: [],
  ultraHd: true,
  hdProfile: "ultrahd",
  radio: false,
  radioSeed: null,
  radioLastTitle: null,
  radioVoiceChannelId: null,
  radioTextChannelId: null,
  radioSince: null,
  radioBy: null,
});

let db = { version: 2, guilds: {} };
let saveTimer = null;
let dirty = false;

function load() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.guilds && typeof parsed.guilds === "object") {
      db = { version: 2, ...parsed };
    }
  } catch (error) {
    log.warn({ error: error.message }, "state.json rusak / tidak bisa dibaca, memakai state kosong");
    try {
      fs.renameSync(STATE_FILE, `${STATE_FILE}.broken-${Date.now()}`);
    } catch {}
  }
}

function writeNow() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, STATE_FILE);
    dirty = false;
  } catch (error) {
    log.error({ error: error.message }, "Gagal menyimpan state.json");
  }
}

/** Debounced write: at most one disk write per second. */
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (dirty) writeNow();
  }, 1000);
}

export function flushState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (dirty) writeNow();
}

function normalize(guildState) {
  if (!Array.isArray(guildState.history)) guildState.history = [];
  if (!["off", "track", "queue"].includes(guildState.loop)) guildState.loop = "off";
  if (typeof guildState.volume !== "number" || Number.isNaN(guildState.volume)) {
    guildState.volume = config.defaultVolume;
  }
  if (typeof guildState.ultraHd !== "boolean") guildState.ultraHd = true;
  if (!["ultrahd", "bassboost", "vocal", "off"].includes(guildState.hdProfile)) {
    guildState.hdProfile = "ultrahd";
  }
  if (typeof guildState.autoplay !== "boolean") guildState.autoplay = config.autoplayDefault;
  if (typeof guildState.radio !== "boolean") guildState.radio = false;
  if (guildState.radioSeed != null && typeof guildState.radioSeed !== "string") guildState.radioSeed = null;
  return guildState;
}

export function state(guildId) {
  if (!db.guilds) db.guilds = {};
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = DEFAULT_GUILD_STATE();
    scheduleSave();
  }
  return normalize(db.guilds[guildId]);
}

export function peekState(guildId) {
  return db.guilds?.[guildId] ? normalize(db.guilds[guildId]) : null;
}

export function allGuildStates() {
  return Object.entries(db.guilds || {}).map(([guildId, value]) => [guildId, normalize(value)]);
}

export function patchState(guildId, patch) {
  db.guilds[guildId] = { ...state(guildId), ...patch };
  scheduleSave();
  return db.guilds[guildId];
}

export function deleteGuildState(guildId) {
  if (!db.guilds?.[guildId]) return;
  delete db.guilds[guildId];
  scheduleSave();
}

export function remember(guildId, identifier, limit = 60) {
  if (!identifier) return;
  const guildState = state(guildId);
  guildState.history = [identifier, ...guildState.history.filter((item) => item !== identifier)].slice(0, limit);
  scheduleSave();
}

export function wasPlayedRecently(guildId, identifier) {
  if (!identifier) return false;
  return state(guildId).history.includes(identifier);
}

load();

export { STATE_FILE };
