#!/usr/bin/env node
/**
 * ANTIMUSIC doctor.
 *
 *   npm run doctor
 *
 * Memeriksa hal-hal yang paling sering bikin bot "online tapi tidak bisa
 * memutar musik": token, Java, Lavalink.jar, port, password, dan node.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const ROOT = process.cwd();
dotenv.config({ path: path.join(ROOT, ".env") });

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let failures = 0;
let warnings = 0;

const ok = (label, detail = "") => console.log(` ${GREEN}OK${RESET}    ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
const fail = (label, detail = "") => {
  failures += 1;
  console.log(` ${RED}FAIL${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
};
const warn = (label, detail = "") => {
  warnings += 1;
  console.log(` ${YELLOW}WARN${RESET}  ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
};

const env = (name, fallback = "") => String(process.env[name] ?? fallback).trim();
const num = (name, fallback) => {
  const value = Number(env(name));
  return Number.isFinite(value) && env(name) ? value : fallback;
};

function isPortOpen(port, host, timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

console.log("\n=== ANTIMUSIC DOCTOR ===\n");

/* 1. Node ------------------------------------------------------------- */
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok("Node.js", `v${process.versions.node}`);
else fail("Node.js terlalu lama", `v${process.versions.node} (butuh >= 20)`);

/* 2. .env ------------------------------------------------------------- */
if (fs.existsSync(path.join(ROOT, ".env"))) ok(".env ditemukan");
else fail(".env tidak ada", "copy .env.example menjadi .env");

const token = env("DISCORD_TOKEN");
const clientId = env("CLIENT_ID");

if (!token) fail("DISCORD_TOKEN kosong");
else if (!/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(token)) fail("DISCORD_TOKEN formatnya aneh", "harus 3 bagian dipisah titik");
else ok("DISCORD_TOKEN terisi", `${token.slice(0, 12)}...`);

if (!clientId) fail("CLIENT_ID kosong");
else if (!/^\d{15,25}$/.test(clientId)) fail("CLIENT_ID bukan angka", "ambil Application ID, bukan nama bot");
else ok("CLIENT_ID valid", clientId);

/* 3. Token ke Discord ------------------------------------------------ */
if (token && /^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/.test(token)) {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const user = await response.json();
      ok("Token Discord diterima", `${user.username} (${user.id})`);
      if (clientId && user.id !== clientId) {
        warn("CLIENT_ID beda dengan token", `token milik ${user.id}`);
      }
    } else {
      fail("Token Discord ditolak", `HTTP ${response.status}`);
    }
  } catch (error) {
    warn("Tidak bisa menghubungi Discord", error.message);
  }
}

/* 4. Lavalink -------------------------------------------------------- */
const host = env("LAVALINK_HOST", "127.0.0.1").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const port = num("LAVALINK_PORT", 2333);
const password = env("LAVALINK_PASSWORD", "antimusic-super-secret");
const embedded = env("LAVALINK_EMBEDDED", "true") === "true";

const open = await isPortOpen(port, host);
if (open) {
  try {
    const response = await fetch(`http://${host}:${port}/version`, {
      headers: { authorization: password },
      signal: AbortSignal.timeout(5000),
    });
    const text = (await response.text()).trim();

    if (response.status === 401) {
      fail("Password Lavalink salah", "samakan LAVALINK_PASSWORD di .env dengan application.yml");
    } else if (response.ok && /^\d+\.\d+\.\d+/.test(text)) {
      ok("Lavalink merespons", `v${text} di ${host}:${port}`);

      // Daftar sumber yang benar-benar aktif.
      try {
        const infoResponse = await fetch(`http://${host}:${port}/v4/info`, {
          headers: { authorization: password },
          signal: AbortSignal.timeout(5000),
        });
        const info = await infoResponse.json();
        if (Array.isArray(info?.sourceManagers)) {
          ok("Sumber musik aktif", info.sourceManagers.join(", "));
        }
        if (Array.isArray(info?.plugins) && info.plugins.length) {
          ok("Plugin", info.plugins.map((plugin) => `${plugin.name}@${plugin.version}`).join(", "));
        }
      } catch {}
    } else {
      fail("Lavalink membalas bukan JSON", `${text.slice(0, 80)} (proxy error?)`);
    }
  } catch (error) {
    fail("Lavalink tidak bisa dihubungi", error.message);
  }
} else if (embedded) {
  warn("Lavalink belum berjalan", "normal kalau bot sedang mati; bot akan menyalakannya sendiri");
} else {
  fail("Lavalink eksternal tidak terjangkau", `${host}:${port}`);
}

if (embedded) {
  const jar = path.join(ROOT, "lavalink", "Lavalink.jar");
  if (fs.existsSync(jar)) {
    const size = fs.statSync(jar).size;
    if (size > 20 * 1024 * 1024) ok("Lavalink.jar ada", `${Math.round(size / 1024 / 1024)} MB`);
    else fail("Lavalink.jar tidak lengkap", `${Math.round(size / 1024)} KB`);
  } else {
    warn("Lavalink.jar belum ada", "akan diunduh otomatis saat bot start");
  }

  const javaCandidates = [
    env("LAVALINK_JAVA_BIN"),
    env("JAVA_HOME") ? path.join(env("JAVA_HOME"), "bin", process.platform === "win32" ? "java.exe" : "java") : "",
    path.join(ROOT, "lavalink", "jre", "bin", process.platform === "win32" ? "java.exe" : "java"),
    "java",
  ].filter(Boolean);

  let javaFound = false;
  for (const candidate of javaCandidates) {
    if (candidate !== "java" && !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
    const output = `${result.stderr || ""}${result.stdout || ""}`;
    const match = output.match(/version "(\d+)/);
    if (match && Number(match[1]) >= 17) {
      ok("Java tersedia", `${candidate} (v${match[1]})`);
      javaFound = true;
      break;
    }
  }
  if (!javaFound) warn("Java 17+ belum ada", "bot akan mengunduh OpenJDK portabel otomatis (Linux)");
}

/* 4b. Sumber musik (Spotify / Apple / Deezer) ------------------------ */
const spotifyReady = Boolean(env("SPOTIFY_CLIENT_ID") && env("SPOTIFY_CLIENT_SECRET"));
const appleRaw = env("APPLE_MUSIC_MEDIA_API_TOKEN");
const appleIsJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(appleRaw);
const deezerReady = Boolean(env("DEEZER_ARL") && env("DEEZER_MASTER_DECRYPTION_KEY"));

if (spotifyReady) ok("Spotify: kredensial terisi");
else warn("Spotify: tanpa kredensial", "link lagu tetap jalan lewat pencarian teks");

if (appleRaw && !appleIsJwt) {
  fail("APPLE_MUSIC_MEDIA_API_TOKEN bukan JWT", "source Apple dimatikan otomatis (harus 3 bagian dipisah titik)");
} else if (appleIsJwt) {
  ok("Apple Music: token JWT valid");
} else {
  warn("Apple Music: tanpa token", "link lagu tetap jalan lewat pencarian teks");
}

if (deezerReady) ok("Deezer: kredensial terisi");
else if (env("DEEZER_ARL") || env("DEEZER_MASTER_DECRYPTION_KEY")) {
  warn("Deezer: kredensial tidak lengkap", "butuh DEEZER_ARL + DEEZER_MASTER_DECRYPTION_KEY");
}

/* 5. Fallback -------------------------------------------------------- */
if (env("LAVALINK_ENABLE_FALLBACKS", "false") === "true") {
  warn("Node cadangan publik aktif", "lambat / tidak stabil, dan trafik lewat server orang lain");
}

/* 6. Ringkasan ------------------------------------------------------- */
console.log("");
if (failures === 0 && warnings === 0) {
  console.log(`${GREEN}Semua pemeriksaan lolos. Jalankan: npm start${RESET}\n`);
} else if (failures === 0) {
  console.log(`${YELLOW}${warnings} peringatan, tidak ada error fatal.${RESET}\n`);
} else {
  console.log(`${RED}${failures} masalah harus diperbaiki sebelum bot bisa jalan normal.${RESET}\n`);
  process.exitCode = 1;
}
