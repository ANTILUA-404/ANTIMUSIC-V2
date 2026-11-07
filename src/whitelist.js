import fs from "node:fs";
import path from "node:path";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const FILE = path.join(config.paths.dataDir, "whitelist.json");
const FILE_TEMPLATE = {
  _catatan: "Tambahkan ID server Discord yang boleh memakai bot ini. Perubahan otomatis terbaca dalam 30 detik tanpa restart.",
  guilds: [],
};

function parseIds(raw) {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{15,25}$/.test(value));
}

/**
 * Server licence / whitelist.
 *
 * Sumber ID (digabung):
 *   1. WHITELIST_GUILD_IDS di .env  (dipisah koma / spasi)
 *   2. data/whitelist.json          (bisa diedit dari file manager panel)
 *
 * File JSON dicek ulang tiap 30 detik, jadi owner bisa menambah server yang
 * baru bayar tanpa restart bot.
 */
class Whitelist {
  constructor() {
    this.ids = new Set();
    this.openMode = false;
    this.fileStamp = "";
    this.notifiedAt = new Map();
    this.reload();
    this.ensureFile();

    const timer = setInterval(() => this.refreshIfChanged(), 30_000);
    timer.unref?.();
  }

  ensureFile() {
    try {
      if (fs.existsSync(FILE)) return;
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(FILE_TEMPLATE, null, 2), "utf8");
      this.fileStamp = this.stamp();
    } catch (error) {
      log.warn({ error: error.message }, "Tidak bisa membuat data/whitelist.json");
    }
  }

  stamp() {
    try {
      const stat = fs.statSync(FILE);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "missing";
    }
  }

  readFileIds() {
    try {
      if (!fs.existsSync(FILE)) return [];
      const raw = fs.readFileSync(FILE, "utf8").trim();
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (parsed && Array.isArray(parsed.guilds)) return parsed.guilds.map(String);
      return [];
    } catch (error) {
      log.warn({ error: error.message }, "data/whitelist.json tidak valid, diabaikan");
      return [];
    }
  }

  reload() {
    const fromEnv = parseIds(config.whitelist.guildIds.join(" "));
    const fromFile = parseIds(this.readFileIds().join(" "));

    this.ids = new Set([...fromEnv, ...fromFile]);
    this.fileStamp = this.stamp();

    // Enabled but empty = open mode. Better than locking the owner out on a
    // fresh install; a loud warning tells them to fill the list.
    this.openMode = config.whitelist.enabled && this.ids.size === 0;

    if (!config.whitelist.enabled) {
      log.warn("Whitelist server DIMATIKAN (WHITELIST_ENABLED=false) - semua server bisa memakai bot");
    } else if (this.openMode) {
      log.warn(
        "Whitelist aktif tapi daftarnya kosong - semua server diizinkan sementara. " +
          "Isi WHITELIST_GUILD_IDS di .env atau data/whitelist.json.",
      );
    } else {
      log.info({ servers: this.ids.size }, "Whitelist server dimuat");
    }
  }

  refreshIfChanged() {
    if (!config.whitelist.enabled) return;
    const stamp = this.stamp();
    if (stamp === this.fileStamp) return;
    log.info("data/whitelist.json berubah, memuat ulang daftar lisensi");
    this.reload();
  }

  isAllowed(guildId) {
    if (!config.whitelist.enabled) return true;
    if (this.openMode) return true;
    if (!guildId) return false;
    return this.ids.has(String(guildId));
  }

  get size() {
    return this.ids.size;
  }

  list() {
    return [...this.ids];
  }

  /** Anti-spam untuk pesan penolakan di channel (bukan interaksi ephemeral). */
  shouldNotify(guildId, cooldownMs = config.whitelist.notifyCooldownMs) {
    const last = this.notifiedAt.get(guildId) || 0;
    if (Date.now() - last < cooldownMs) return false;
    this.notifiedAt.set(guildId, Date.now());
    return true;
  }
}

export const whitelist = new Whitelist();

/** Panel yang muncul di server yang belum berlisensi. */
export function buildDenialPanel(guild) {
  const owner = config.whitelist.ownerUsername;
  const serverName = guild?.name ? `**${guild.name}**` : "Server ini";

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🔒 Server Belum Berlisensi")
    .setDescription(
      `${serverName} belum terdaftar di whitelist **ANTIMUSIC**.\n\n` +
        "Untuk membeli izin pemakaian bot, silakan hubungi owner:\n" +
        `> 👑 **${owner}**\n\n` +
        "Setelah pembayaran dikonfirmasi, owner akan mendaftarkan ID server ini " +
        "dan bot langsung aktif tanpa perlu restart.",
    )
    .addFields(
      { name: "Status Lisensi", value: "❌ Tidak aktif", inline: true },
      { name: "Server ID", value: `\`${guild?.id ?? "-"}\``, inline: true },
      { name: "Owner Bot", value: `\`${owner}\``, inline: true },
    )
    .setFooter({ text: "ANTIMUSIC • Sistem Lisensi Server" })
    .setTimestamp();
}

/** Tombol "Hubungi Owner" (hanya jika OWNER_USER_ID diisi). */
export function buildDenialComponents() {
  const ownerId = config.whitelist.ownerUserId;
  if (!ownerId || !/^\d{15,25}$/.test(ownerId)) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Hubungi Owner")
        .setEmoji("💬")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/users/${ownerId}`),
    ),
  ];
}

export function denialPayload(guild, { ephemeral = false } = {}) {
  const payload = {
    embeds: [buildDenialPanel(guild)],
  };

  const components = buildDenialComponents();
  if (components.length) payload.components = components;
  if (ephemeral) payload.flags = 64; // MessageFlags.Ephemeral

  return payload;
}

export default whitelist;
