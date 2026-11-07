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

/** Grace period after spawn before the watchdog may declare the JVM dead. */
const HEALTH_GRACE_MS = 90_000;
const TERM_GRACE_MS = 8_000;
const KILL_GRACE_MS = 6_000;
const PORT_FREE_WAIT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isPortOpen(port, host = "127.0.0.1", timeout = 1500) {
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

/** Waits until nothing is listening on `port`. Returns true when the port is free. */
export async function waitForPortFree(port, timeoutMs = PORT_FREE_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port, "127.0.0.1", 900))) return true;
    await sleep(250);
  }
  return !(await isPortOpen(port, "127.0.0.1", 900));
}

/**
 * Finds the PIDs of Lavalink processes listening on `port` (Linux only).
 *
 * This is what makes the port reclaim safe: we only ever kill a process whose
 * command line actually contains "Lavalink.jar". It is the difference between
 * recovering from a crashed run and shooting a random service in the foot.
 */
export function findLavalinkPidsOnPort(port) {
  if (process.platform !== "linux") return [];

  const inodes = new Set();

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;

      const local = parts[1];
      const state = parts[3];
      const inode = parts[9];

      // 0A == TCP_LISTEN
      if (state !== "0A") continue;

      const localPort = Number.parseInt(local.split(":").pop(), 16);
      if (localPort === port && inode !== "0") inodes.add(inode);
    }
  }

  if (!inodes.size) return [];

  const pids = new Set();
  let entries = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;

    let fds;
    try {
      fds = fs.readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }

    let holdsSocket = false;
    for (const fd of fds) {
      let target;
      try {
        target = fs.readlinkSync(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match && inodes.has(match[1])) {
        holdsSocket = true;
        break;
      }
    }
    if (!holdsSocket) continue;

    let cmdline = "";
    try {
      cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ");
    } catch {
      continue;
    }

    if (/Lavalink\.jar/i.test(cmdline)) pids.add(Number(entry));
  }

  return [...pids];
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

/** Downloads a URL to a file, following redirects, with a hard timeout. */
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
    /** @type {import("node:child_process").ChildProcess | null} */
    this.child = null;
    this.childStartedAt = 0;
    this.state = "idle";
    this.startedAt = 0;
    this.restartAttempts = 0;
    this.watchdogTimer = null;
    this.restartTimer = null;
    this.startPromise = null;
    this.failStreak = 0;
    this.healthBusy = false;
    this.killing = false;
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
      uptimeMs: this.childStartedAt ? Date.now() - this.childStartedAt : 0,
      restarts: this.restartAttempts,
      failStreak: this.failStreak,
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
    return this.start();
  }

  /** Single-flight: never spawn two JVMs because two callers asked at once. */
  start() {
    if (this.startPromise) return this.startPromise;

    this.startPromise = this._start().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async _start() {
    // Already supervised and alive: calling start() twice must be a no-op.
    // Without this guard a redundant start() tried to bind an occupied port,
    // "failed", and burned a backoff step (attempt jumped to 2 for one crash).
    if (this.child && this.child.exitCode === null && this.state !== "down") {
      return this.ready;
    }

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

      // Free the port BEFORE spawning. A leftover JVM from the previous run is
      // the reason the old build ended in "Port 2333 is already in use".
      const prepared = await this.preparePort();
      if (prepared === "adopted") return true;

      const { port, javaArgs } = config.lavalink;
      const args = [
        // Explicit system properties beat any SERVER_PORT env variable that
        // Pterodactyl / hosting panels inject into the container.
        `-Dserver.port=${port}`,
        "-Dfile.encoding=UTF-8",
        ...javaArgs,
        "-jar",
        "Lavalink.jar",
        // Highest priority for Spring Boot: command line arguments.
        `--server.port=${port}`,
      ];

      const env = { ...process.env };
      // These make Spring Boot bind to the panel allocation instead of our port.
      delete env.SERVER_PORT;
      delete env.SERVER_PORT_LOCAL;
      delete env.PORT;
      for (const key of Object.keys(env)) {
        if (key.startsWith("SPRING_")) delete env[key];
      }
      // An empty JAVA_TOOL_OPTIONS makes the JVM print "Picked up ..." on every
      // boot. Removing it entirely keeps lavalink.log clean.
      delete env.JAVA_TOOL_OPTIONS;

      log.info({ java, port, memory: `${config.lavalink.memoryMb}MB` }, "Menjalankan server Lavalink lokal...");

      const logFd = this.openLogFile();
      let child;
      try {
        child = spawn(java, args, {
          cwd: config.paths.lavalinkDir,
          env,
          // stdout/stderr langsung ke file, bukan pipe.
          // Output Lavalink (termasuk stack trace plugin YouTube saat IP server
          // diblokir) jadi tidak membanjiri console panel, tapi tetap lengkap
          // di lavalink/lavalink.log untuk diagnosa.
          stdio: ["ignore", logFd, logFd],
          windowsHide: true,
          // Own process group on POSIX so killChild() can reap the whole tree.
          detached: process.platform !== "win32",
        });
      } finally {
        try {
          fs.closeSync(logFd);
        } catch {}
      }

      const spawnedAt = Date.now();
      this.child = child;
      this.childStartedAt = spawnedAt;
      this.startedAt = spawnedAt;

      child.on("error", (error) => {
        this.lastError = error.message;
        log.error({ error: error.message }, "Gagal menjalankan proses Java Lavalink");
      });

      // Bind the exit handler to THIS child instance. The previous build used
      // `this.child`, so a late exit event from an old process nulled the
      // reference to the new one, orphaned it, and started an endless respawn.
      child.on("exit", (code, signal) => this.handleExit(child, spawnedAt, code, signal));

      this.startWatchdog();

      const outcome = await this.waitForReady(child, config.lavalink.startupTimeoutMs);

      if (outcome === "ready") {
        this.ready = true;
        this.state = "ready";
        log.info({ port }, "Server Lavalink lokal siap menerima koneksi");
        this.onReady?.();
        return true;
      }

      if (outcome === "exited") {
        // handleExit() already logged the reason and scheduled a restart.
        this.lastError = "process-exited-during-startup";
        return false;
      }

      this.lastError = "startup-timeout";
      this.dumpLastLogs();
      log.error(
        { timeoutMs: config.lavalink.startupTimeoutMs },
        "Lavalink tidak siap sebelum batas waktu. Periksa log di lavalink/lavalink.log",
      );
      await this.killChild("startup-timeout");
      this.scheduleRestart("startup-timeout");
      return false;
    } catch (error) {
      this.lastError = error.message;
      this.state = "failed";
      log.error({ error: error.message }, "Gagal menjalankan Lavalink lokal");
      this.scheduleRestart("start-failed");
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* port                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Makes sure nothing else is holding the Lavalink port.
   *
   * A previous run that was killed by the panel can leave a JVM behind. That
   * JVM keeps answering /version, so the bot happily "connects" to a process it
   * does not control, then everything falls apart when it finally dies.
   */
  async preparePort() {
    const port = config.lavalink.port;

    if (!(await isPortOpen(port, "127.0.0.1", 1200))) return true;

    // Never touch another process when reclaim is disabled (user runs their
    // own Lavalink next to the bot and only wants us to reuse it).
    const pids = config.lavalink.reclaimPort ? findLavalinkPidsOnPort(port) : [];

    if (pids.length) {
      log.warn({ port, pids }, "Port Lavalink ditahan sisa proses Lavalink lama, membebaskan port");
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }

      await sleep(1500);

      for (const pid of pids) {
        try {
          process.kill(pid, 0); // still alive?
          process.kill(pid, "SIGKILL");
        } catch {}
      }

      if (await waitForPortFree(port, 10_000)) return true;
    }

    if (!config.lavalink.reclaimPort && (await this.probe(5000))) {
      log.info({ port }, "Memakai Lavalink yang sudah berjalan (LAVALINK_RECLAIM_PORT=false)");
      this.state = "ready";
      this.ready = true;
      this.startedAt = Date.now();
      this.onReady?.();
      return "adopted";
    }

    if (await waitForPortFree(port, PORT_FREE_WAIT_MS)) return true;

    throw new Error(
      `Port ${port} masih dipakai proses lain. Hentikan proses tersebut atau ganti LAVALINK_PORT di .env.`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* readiness                                                        */
  /* ---------------------------------------------------------------- */

  async probe(timeout = 5000) {
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

  /** One probe can time out while the JVM is busy parsing a playlist. */
  async probeWithRetry() {
    const attempts = Math.max(1, config.lavalink.healthProbeAttempts);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (await this.probe(config.lavalink.healthProbeTimeoutMs)) return true;
      if (attempt < attempts) await sleep(1200);
    }
    return false;
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

  /**
   * @returns {Promise<"ready" | "exited" | "timeout">}
   */
  async waitForReady(child, timeoutMs) {
    const startedAt = Date.now();
    let lastNotice = 0;

    while (Date.now() - startedAt < timeoutMs) {
      if (this.child !== child || child.exitCode !== null || child.signalCode !== null) {
        return "exited";
      }

      if (await this.probe(config.lavalink.healthProbeTimeoutMs)) {
        // A late exit can land between the probe and this line.
        if (this.child === child && child.exitCode === null) return "ready";
        return "exited";
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed - lastNotice >= 15_000) {
        lastNotice = elapsed;
        log.info({ elapsedSec: Math.round(elapsed / 1000) }, "Menunggu Lavalink siap...");
      }

      await sleep(1000);
    }

    return "timeout";
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
  /* process lifecycle                                                */
  /* ---------------------------------------------------------------- */

  handleExit(child, spawnedAt, code, signal) {
    const uptime = Date.now() - spawnedAt;

    // Exit event from a process we already replaced: ignore it completely.
    // This single guard is what stops the respawn storm.
    if (this.child !== child) {
      log.debug({ pid: child.pid, code, signal }, "Proses Lavalink lama sudah berhenti (diabaikan)");
      return;
    }

    this.child = null;
    this.childStartedAt = 0;
    this.ready = false;
    this.failStreak = 0;

    if (this.stopping || this.state === "stopped") {
      this.state = "stopped";
      log.info({ code, signal }, "Proses Lavalink dihentikan");
      return;
    }

    this.state = "down";

    if (uptime > STABLE_UPTIME_MS) this.restartAttempts = 0;

    // Deliberate kill (watchdog / startup timeout): the caller already logged
    // the reason and schedules the restart. Dumping 25 log lines here would
    // flood the panel on every controlled restart.
    if (this.killing) {
      log.info({ code, signal, uptimeSec: Math.round(uptime / 1000) }, "Proses Lavalink dihentikan");
      return;
    }

    log.error(
      { code, signal, uptimeSec: Math.round(uptime / 1000) },
      "Proses Lavalink berhenti tidak normal",
    );
    this.dumpLastLogs();
    this.onDown?.();
    this.scheduleRestart("process-exit");
  }

  async waitForExit(child, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) return true;
      await sleep(150);
    }
    return child.exitCode !== null || child.signalCode !== null;
  }

  killTree(child, signal) {
    if (!child?.pid) return;

    if (process.platform !== "win32") {
      // Negative pid == the whole process group (detached spawn).
      try {
        process.kill(-child.pid, signal);
      } catch {}
    }

    try {
      child.kill(signal);
    } catch {}
  }

  async killChild(reason) {
    const child = this.child;

    if (!child) {
      await waitForPortFree(config.lavalink.port, 5000);
      return;
    }

    log.warn({ pid: child.pid, reason }, "Menghentikan proses Lavalink");
    this.ready = false;
    this.killing = true;

    try {
      try {
        child.kill("SIGTERM");
      } catch {}

      if (!(await this.waitForExit(child, TERM_GRACE_MS))) {
        log.warn({ pid: child.pid }, "Proses Lavalink tidak berhenti, mengirim SIGKILL");
        this.killTree(child, "SIGKILL");
        await this.waitForExit(child, KILL_GRACE_MS);
      }
    } finally {
      this.killing = false;
    }

    // Only clear the reference if it is still the process we just killed.
    if (this.child === child) {
      this.child = null;
      this.childStartedAt = 0;
    }

    if (!(await waitForPortFree(config.lavalink.port, PORT_FREE_WAIT_MS))) {
      log.warn({ port: config.lavalink.port }, "Port Lavalink masih ditahan setelah proses dihentikan");
    }
  }

  /**
   * Last-resort synchronous cleanup for `process.on("exit")`.
   *
   * Without it, a crash or a panel stop that does not wait for async shutdown
   * leaves an orphaned JVM behind — exactly what produced the
   * "Port 2333 is already in use" loop.
   */
  killSync() {
    const child = this.child;
    if (!child) return;

    this.stopping = true;
    this.killTree(child, "SIGKILL");
    this.child = null;
  }

  /* ---------------------------------------------------------------- */
  /* watchdog / restart                                               */
  /* ---------------------------------------------------------------- */

  startWatchdog() {
    if (this.watchdogTimer) return;

    this.watchdogTimer = setInterval(() => {
      void this.healthTick();
    }, config.lavalink.healthCheckIntervalMs);

    this.watchdogTimer.unref?.();
  }

  async healthTick() {
    // The interval can fire while the previous tick is still awaiting a probe.
    // Overlapping ticks were killing the same JVM twice and scheduling two
    // restarts (attempt=1 then attempt=2 three seconds apart).
    if (this.healthBusy) return;
    if (this.stopping || !config.lavalink.autoRestart) return;

    this.healthBusy = true;

    try {
      if (!this.child) {
        if (!this.startPromise && !this.restartTimer) {
          this.scheduleRestart("watchdog-missing-process");
        }
        return;
      }

      if (this.state === "starting") return;
      if (Date.now() - this.childStartedAt < HEALTH_GRACE_MS) return;

      const child = this.child;

      if (await this.probeWithRetry()) {
        const recovered = this.failStreak > 0;
        this.failStreak = 0;

        if (this.state !== "ready") {
          this.state = "ready";
          this.ready = true;
        }

        if (Date.now() - this.childStartedAt > STABLE_UPTIME_MS) this.restartAttempts = 0;

        if (recovered) {
          log.info({ node: "Lavalink-Primary" }, "Lavalink merespons kembali");
          this.onReady?.();
        }
        return;
      }

      // The child died while we were probing: handleExit() owns the restart.
      if (this.child !== child || child.exitCode !== null) return;

      this.failStreak += 1;

      if (this.failStreak < config.lavalink.healthFailThreshold) {
        if (this.failStreak === 1) {
          log.info(
            { failStreak: this.failStreak },
            "Lavalink lambat merespons pemeriksaan kesehatan, memantau ulang",
          );
        }
        return;
      }

      log.warn(
        { failStreak: this.failStreak, pid: child.pid },
        "Lavalink tidak merespons, menjalankan ulang proses",
      );
      this.state = "unhealthy";
      this.ready = false;
      await this.killChild("unhealthy");
      this.scheduleRestart("unhealthy");
    } finally {
      this.healthBusy = false;
    }
  }

  scheduleRestart(reason) {
    if (this.stopping || !config.lavalink.autoRestart) return;
    if (this.restartTimer) return;

    const delay = RESTART_BACKOFF[Math.min(this.restartAttempts, RESTART_BACKOFF.length - 1)];
    this.restartAttempts += 1;
    this.state = "restarting";

    log.warn({ reason, attempt: this.restartAttempts, delayMs: delay }, "Menjadwalkan restart Lavalink");

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null;
      if (this.stopping) return;
      if (this.child) return;

      // A start may still be finishing (it schedules its own retry on failure).
      if (this.startPromise) {
        try {
          await this.startPromise;
        } catch {}
        if (this.stopping || this.child) return;
      }

      await this.start();
    }, delay);

    this.restartTimer.unref?.();
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
      log.error("Java 17+ tidak ditemukan. Install Java 17 atau set LAVALINK_JAVA_BIN ke java.exe.");
      return null;
    }

    return this.installPortableJre();
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
