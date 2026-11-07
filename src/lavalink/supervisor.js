import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";
import { log } from "../logger.js";
import { writeLavalinkConfig } from "./config-writer.js";

const JAR_MIN_BYTES = 20 * 1024 * 1024;
const LOG_MAX_BYTES = 8 * 1024 * 1024;
const RESTART_BACKOFF = [2000, 5000, 10000, 20000, 30000, 60000];
const STABLE_UPTIME_MS = 180_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortOpen(port, host = "127.0.0.1", timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

/** Downloads a URL to a file, following redirects, with a progress log every 5s. */
async function download(url, destination, label) {
  log.info({ url, label }, `Mengunduh ${label}...`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "ANTIMUSIC/2.0 (+lavalink bootstrap)" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const tmp = `${destination}.part`;
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp));

    const stat = await fsp.stat(tmp);
    if (stat.size < 1024) throw new Error(`File terlalu kecil (${humanSize(stat.size)})`);

    await fsp.rename(tmp, destination);
    log.info({ label, size: humanSize(stat.size) }, `${label} berhasil diunduh`);
    return stat.size;
  } finally {
    clearTimeout(timer);
  }
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 120_000, ...options });
}

export class LavalinkSupervisor {
  constructor() {
    this.child = null;
    this.state = "idle";
    this.startedAt = 0;
    this.restartAttempts = 0;
    this.watchdogTimer = null;
    this.restartTimer = null;
    this.startingPromise = null;
    this.failStreak = 0;
    this.stopping = false;
    this.ready = false;
    this.lastError = null;
    this.javaBinary = null;
    this.onReady = null;
    this.onDown = null;
  }

  /* ---------------------------------------------------------------- */
  /* status                                                           */
  /* ---------------------------------------------------------------- */

  status() {
    return {
      enabled: config.lavalink.embedded,
      state: this.state,
      ready: this.ready,
      pid: this.child?.pid ?? null,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      restarts: this.restartAttempts,
      port: config.lavalink.port,
      host: config.lavalink.host,
      memoryMb: config.lavalink.memoryMb,
      java: this.javaBinary,
      lastError: this.lastError,
    };
  }

  /* ---------------------------------------------------------------- */
  /* bootstrap                                                        */
  /* ---------------------------------------------------------------- */

  async ensure() {
    if (!config.lavalink.embedded) {
      this.state = "external";
      return true;
    }

    writeLavalinkConfig();

    if (await this.probe()) {
      this.state = "ready";
      this.ready = true;
      log.info(
        { host: config.lavalink.host, port: config.lavalink.port },
        "Lavalink sudah berjalan di port tersebut, proses lokal tidak dijalankan ulang",
      );
      this.onReady?.();
      return true;
    }

    if (await isPortOpen(config.lavalink.port, "127.0.0.1")) {
      this.state = "failed";
      this.lastError = "port-in-use";
      log.error(
        { port: config.lavalink.port },
        "Port Lavalink sudah dipakai proses lain yang bukan Lavalink milik bot. " +
          "Hentikan proses tersebut atau ganti LAVALINK_PORT di .env.",
      );
      return false;
    }

    return this.start();
  }

  async start() {
    if (this.startingPromise) return this.startingPromise;

    this.startingPromise = this._start().finally(() => {
      this.startingPromise = null;
    });

    return this.startingPromise;
  }

  async _start() {
    this.stopping = false;
    this.ready = false;
    this.failStreak = 0;
    this.state = "starting";

    try {
      const jar = await this.ensureJar();
      if (!jar) throw new Error("Lavalink.jar tidak tersedia");

      const java = await this.ensureJava();
      if (!java) throw new Error("Java runtime tidak tersedia");

      this.javaBinary = java;
      writeLavalinkConfig();

      const { port, javaArgs } = config.lavalink;
      const args = [
        // Explicit system properties beat any SERVER_PORT env variable that
        // Pterodactyl / hosting panels inject into the container.
        `-Dserver.port=${port}`,
        `-Dlavalink.server.port=${port}`,
        "-Dfile.encoding=UTF-8",
        ...javaArgs,
        "-jar",
        "Lavalink.jar",
        // Highest priority for Spring Boot: command line arguments.
        `--server.port=${port}`,
        `--lavalink.server.port=${port}`,
      ];

      const env = { ...process.env };
      // These make Spring Boot bind to the panel allocation instead of our port.
      delete env.SERVER_PORT;
      delete env.SERVER_PORT_LOCAL;
      delete env.PORT;
      for (const key of Object.keys(env)) {
        if (key.startsWith("SPRING_")) delete env[key];
      }
      env.JAVA_TOOL_OPTIONS = "";

      log.info(
        { java, port, memory: `${config.lavalink.memoryMb}MB` },
        "Menjalankan server Lavalink lokal...",
      );

      const logFd = this.openLogFile();

      this.child = spawn(java, args, {
        cwd: config.paths.lavalinkDir,
        env,
        // stdout/stderr langsung ke file, bukan pipe.
        // Output Lavalink (termasuk stack trace plugin YouTube saat IP server
        // diblokir) jadi tidak membanjiri console panel, tapi tetap lengkap
        // di lavalink/lavalink.log untuk diagnosa.
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      });

      try {
        fs.closeSync(logFd);
      } catch {}

      this.startedAt = Date.now();

      this.child.on("error", (error) => {
        this.lastError = error.message;
        log.error({ error: error.message }, "Gagal menjalankan proses Java Lavalink");
      });

      this.child.on("exit", (code, signal) => {
        const uptime = Date.now() - this.startedAt;
        this.ready = false;
        this.state = "down";
        this.child = null;

        if (this.stopping) {
          log.info({ code, signal }, "Proses Lavalink dihentikan");
          return;
        }

        if (uptime > STABLE_UPTIME_MS) this.restartAttempts = 0;

        log.error(
          { code, signal, uptimeSec: Math.round(uptime / 1000) },
          "Proses Lavalink berhenti tidak normal",
        );
        this.dumpLastLogs();
        this.onDown?.();
        this.scheduleRestart("process-exit");
      });

      this.startWatchdog();

      const ok = await this.waitForReady(config.lavalink.startupTimeoutMs);
      if (!ok) {
        this.lastError = "startup-timeout";
        this.dumpLastLogs();
        log.error(
          { timeoutMs: config.lavalink.startupTimeoutMs },
          "Lavalink tidak siap sebelum batas waktu. Periksa log di lavalink/lavalink.log",
        );
        await this.killChild("startup-timeout");
        this.scheduleRestart("startup-timeout");
        return false;
      }

      this.ready = true;
      this.state = "ready";
      log.info({ port }, "Server Lavalink lokal siap menerima koneksi");
      this.onReady?.();
      return true;
    } catch (error) {
      this.lastError = error.message;
      this.state = "failed";
      log.error({ error: error.message }, "Gagal menjalankan Lavalink lokal");
      this.scheduleRestart("start-failed");
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* readiness                                                        */
  /* ---------------------------------------------------------------- */

  async probe(timeout = 2500) {
    const url = `http${config.lavalink.secure ? "s" : ""}://${config.lavalink.host}:${config.lavalink.port}/version`;
    try {
      const response = await fetch(url, {
        headers: { authorization: config.lavalink.password },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) return false;
      const text = (await response.text()).trim();
      return /^\d+\.\d+\.\d+/.test(text);
    } catch {
      return false;
    }
  }

  /** Short, user-facing wait so the first command can succeed during boot. */
  async waitUntilReady(timeoutMs = 15000) {
    if (this.ready) return true;
    if (!config.lavalink.embedded) return true;

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.ready) return true;
      await sleep(400);
    }
    return this.ready;
  }

  async waitForReady(timeoutMs) {
    const startedAt = Date.now();
    let lastNotice = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (!this.child) return false;

      if (await this.probe()) return true;

      const elapsed = Date.now() - startedAt;
      if (elapsed - lastNotice >= 15000) {
        lastNotice = elapsed;
        log.info({ elapsedSec: Math.round(elapsed / 1000) }, "Menunggu Lavalink siap...");
      }

      await sleep(1000);
    }

    return false;
  }

  /* ---------------------------------------------------------------- */
  /* logs (file based: nothing from Java reaches the panel console)   */
  /* ---------------------------------------------------------------- */

  openLogFile() {
    const file = config.paths.lavalinkLog;

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });

      if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {}

    try {
      fs.appendFileSync(file, `\n===== Lavalink start ${new Date().toISOString()} =====\n`);
    } catch {}

    return fs.openSync(file, "a");
  }

  /** Last N non-empty lines of lavalink.log (used when something breaks). */
  recentLogs(count = 25) {
    try {
      const raw = fs.readFileSync(config.paths.lavalinkLog, "utf8");
      return raw.split(/\r?\n/).filter((line) => line.trim()).slice(-count);
    } catch {
      return [];
    }
  }

  dumpLastLogs(count = 25) {
    const lines = this.recentLogs(count);
    if (!lines.length) return;
    log.error(`---- ${count} baris terakhir lavalink/lavalink.log ----`);
    for (const line of lines) log.error(line.slice(0, 500));
    log.error("------------------------------------------------------");
  }

  /* ---------------------------------------------------------------- */
  /* watchdog / restart                                               */
  /* ---------------------------------------------------------------- */

  startWatchdog() {
    if (this.watchdogTimer) return;

    this.watchdogTimer = setInterval(async () => {
      if (this.stopping || !config.lavalink.autoRestart) return;

      if (!this.child) {
        this.scheduleRestart("watchdog-missing-process");
        return;
      }

      if (this.state === "starting") return;

      const ok = await this.probe(3000);
      if (ok) {
        this.failStreak = 0;
        if (this.state !== "ready") {
          this.state = "ready";
          this.ready = true;
        }
        return;
      }

      this.failStreak += 1;
      log.warn({ failStreak: this.failStreak }, "Lavalink tidak merespons pemeriksaan kesehatan");

      if (this.failStreak >= 3) {
        this.state = "unhealthy";
        this.ready = false;
        await this.killChild("unhealthy");
        this.scheduleRestart("unhealthy");
      }
    }, 10_000);

    this.watchdogTimer.unref?.();
  }

  scheduleRestart(reason) {
    if (this.stopping || !config.lavalink.autoRestart) return;
    if (this.restartTimer) return;

    const delay = RESTART_BACKOFF[Math.min(this.restartAttempts, RESTART_BACKOFF.length - 1)];
    this.restartAttempts += 1;
    this.state = "restarting";

    log.warn(
      { reason, attempt: this.restartAttempts, delayMs: delay },
      "Menjadwalkan restart Lavalink",
    );

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.stopping) return;
      await this.start();
    }, delay);
    this.restartTimer.unref?.();
  }

  async killChild(reason) {
    const child = this.child;
    if (!child) return;

    log.warn({ pid: child.pid, reason }, "Menghentikan proses Lavalink");
    try {
      child.kill("SIGTERM");
    } catch {}

    const deadline = Date.now() + 8000;
    while (this.child && Date.now() < deadline) {
      await sleep(200);
    }

    if (this.child) {
      try {
        this.child.kill("SIGKILL");
      } catch {}
      this.child = null;
    }
  }

  async stop() {
    this.stopping = true;
    this.ready = false;
    this.state = "stopped";

    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    await this.killChild("shutdown");
  }

  /* ---------------------------------------------------------------- */
  /* jar / java                                                       */
  /* ---------------------------------------------------------------- */

  async ensureJar() {
    const jar = config.paths.jarFile;

    try {
      const stat = await fsp.stat(jar);
      if (stat.size >= JAR_MIN_BYTES) return true;
      log.warn({ size: humanSize(stat.size) }, "Lavalink.jar tidak valid, mengunduh ulang");
      await fsp.rm(jar, { force: true });
    } catch {}

    const version = config.lavalink.jarVersion;
    const urls = [
      `https://github.com/lavalink-devs/Lavalink/releases/download/${version}/Lavalink.jar`,
      `https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar`,
    ];

    for (const url of urls) {
      try {
        await download(url, jar, `Lavalink.jar v${version}`);
        const stat = await fsp.stat(jar);
        if (stat.size >= JAR_MIN_BYTES) return true;
      } catch (error) {
        log.warn({ url, error: error.message }, "Gagal mengunduh Lavalink.jar dari mirror ini");
      }
    }

    return false;
  }

  systemJavaVersion(binary) {
    try {
      const result = runCommand(binary, ["-version"]);
      const output = `${result.stderr || ""}${result.stdout || ""}`;
      const match = output.match(/version "?(\d+)(?:\.(\d+))?/);
      if (!match) return 0;
      const major = Number(match[1]);
      return major === 1 ? Number(match[2] || 0) : major;
    } catch {
      return 0;
    }
  }

  async ensureJava() {
    const isWindows = process.platform === "win32";
    const binaryName = isWindows ? "java.exe" : "java";

    const candidates = [];
    if (config.lavalink.javaBin) candidates.push(config.lavalink.javaBin);
    if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, "bin", binaryName));
    candidates.push(binaryName);

    for (const candidate of candidates) {
      if (candidate !== binaryName && !fs.existsSync(candidate)) continue;
      const version = this.systemJavaVersion(candidate);
      if (version >= 17) {
        log.info({ java: candidate, version }, "Memakai Java yang sudah terpasang");
        return candidate;
      }
    }

    // Fall back to the portable runtime shipped next to the jar.
    const portable = path.join(config.paths.jreDir, "bin", binaryName);
    if (fs.existsSync(portable)) {
      if (!isWindows) {
        try {
          fs.chmodSync(portable, 0o755);
        } catch {}
      }
      return portable;
    }

    if (isWindows) {
      log.error(
        "Java 17+ tidak ditemukan. Install Java 17 atau set LAVALINK_JAVA_BIN ke java.exe.",
      );
      return null;
    }

    const installed = await this.installPortableJre();
    return installed;
  }

  async installPortableJre() {
    const arch = process.arch === "arm64" ? "aarch64" : "x64";
    const url = `https://api.adoptium.net/v3/binary/latest/17/ga/linux/${arch}/jre/hotspot/normal/eclipse`;
    const archive = path.join(config.paths.lavalinkDir, "jre17.tar.gz");

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        log.info({ attempt }, "Java belum tersedia, mengunduh Portable OpenJDK 17...");
        await download(url, archive, "Portable OpenJDK 17");

        await fsp.rm(config.paths.jreDir, { recursive: true, force: true });
        await fsp.mkdir(config.paths.jreDir, { recursive: true });

        const tar = runCommand("tar", ["-xzf", archive, "-C", config.paths.jreDir, "--strip-components=1"]);
        if (tar.status !== 0) {
          throw new Error(`tar gagal: ${(tar.stderr || "").slice(0, 200)}`);
        }

        await fsp.rm(archive, { force: true });

        const java = path.join(config.paths.jreDir, "bin", "java");
        if (!fs.existsSync(java)) throw new Error("bin/java tidak ditemukan setelah ekstraksi");

        fs.chmodSync(java, 0o755);
        log.info({ java }, "Portable OpenJDK 17 siap dipakai");
        return java;
      } catch (error) {
        log.warn({ attempt, error: error.message }, "Percobaan memasang Java portabel gagal");
        await sleep(1500 * attempt);
      }
    }

    return null;
  }
}

export const lavalinkSupervisor = new LavalinkSupervisor();
export default lavalinkSupervisor;
