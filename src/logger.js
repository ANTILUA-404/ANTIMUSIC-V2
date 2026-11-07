/**
 * ANTIMUSIC logger.
 *
 * Output is human readable by default (nice inside Pterodactyl console),
 * and can be switched to one-line JSON with LOG_JSON=true for log collectors.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const LABELS = { trace: "TRACE", debug: "DEBUG", info: "INFO ", warn: "WARN ", error: "ERROR", fatal: "FATAL" };
const COLORS = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function pad(n, size = 2) {
  return String(n).padStart(size, "0");
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function serialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatContext(context) {
  if (!context || typeof context !== "object") return "";
  const parts = [];
  for (const [key, value] of Object.entries(context)) {
    const text = serialize(value);
    if (text === undefined) continue;
    parts.push(`${key}=${text}`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export class Logger {
  constructor(options = {}) {
    this.explicitLevel = options.level || null;
    this.scope = options.scope || null;
    this.explicitJson = options.json;
    this.explicitColor = options.color;
  }

  /** Resolved on every write so .env / panel variables always win. */
  get level() {
    const name = this.explicitLevel || process.env.LOG_LEVEL || "info";
    return LEVELS[String(name).toLowerCase()] ?? LEVELS.info;
  }

  get json() {
    if (typeof this.explicitJson === "boolean") return this.explicitJson;
    return String(process.env.LOG_JSON || "").toLowerCase() === "true";
  }

  get color() {
    if (typeof this.explicitColor === "boolean") return this.explicitColor;
    return Boolean(process.stdout.isTTY) && !this.json;
  }

  child(scope) {
    return new Logger({
      level: this.explicitLevel,
      scope: this.scope ? `${this.scope}:${scope}` : scope,
      json: this.explicitJson,
      color: this.explicitColor,
    });
  }

  setLevel(level) {
    if (LEVELS[level]) this.explicitLevel = level;
  }

  _emit(level, contextOrMessage, maybeMessage) {
    if (LEVELS[level] < this.level) return;

    let context = null;
    let message = "";

    if (typeof contextOrMessage === "string") {
      message = contextOrMessage;
    } else if (contextOrMessage instanceof Error) {
      context = { err: contextOrMessage.message };
      message = contextOrMessage.message;
    } else if (contextOrMessage && typeof contextOrMessage === "object") {
      context = contextOrMessage;
      message = typeof maybeMessage === "string" ? maybeMessage : "";
    } else {
      message = serialize(contextOrMessage) || "";
    }

    if (!message && context && typeof context.msg === "string") {
      message = context.msg;
      context = { ...context };
      delete context.msg;
    }

    if (this.json) {
      const record = {
        time: new Date().toISOString(),
        level,
        scope: this.scope || undefined,
        ...(context || {}),
        msg: message,
      };
      for (const [key, value] of Object.entries(record)) {
        if (value instanceof Error) record[key] = value.stack || value.message;
      }
      const line = JSON.stringify(record);
      if (level === "error" || level === "fatal") process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
      return;
    }

    const label = LABELS[level] || level.toUpperCase();
    const coloredLabel = this.color ? `${COLORS[level] || ""}${label}${RESET}` : label;
    const scope = this.scope ? `${DIM}[${this.scope}]${RESET} ` : "";
    const line = `${DIM}${timestamp()}${RESET} ${coloredLabel} ${scope}${message}${formatContext(context)}\n`;

    if (level === "error" || level === "fatal") process.stderr.write(line);
    else process.stdout.write(line);
  }

  trace(ctx, msg) { this._emit("trace", ctx, msg); }
  debug(ctx, msg) { this._emit("debug", ctx, msg); }
  info(ctx, msg) { this._emit("info", ctx, msg); }
  warn(ctx, msg) { this._emit("warn", ctx, msg); }
  error(ctx, msg) { this._emit("error", ctx, msg); }
  fatal(ctx, msg) { this._emit("fatal", ctx, msg); }
}

export const log = new Logger();
export const createLogger = (scope, level) => new Logger({ scope, level });
