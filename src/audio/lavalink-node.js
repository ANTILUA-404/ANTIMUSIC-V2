/**
 * Normalisasi + preflight node Lavalink.
 *
 * Dua masalah nyata yang bikin bot kelihatan "Lavalink-nya belum aman" padahal
 * server Lavalink-nya sendiri sehat:
 *
 * 1. Skema/port salah tebak.
 *    Railway punya dua jalur yang gampang tertukar:
 *      internal : http://<service>.railway.internal:8080   (tanpa TLS)
 *      publik   : https://<domain>.up.railway.app:443      (TLS)
 *    Kalau salah, yang menjawab bukan Lavalink tapi proxy host — balasannya teks
 *    biasa "Proxy error", bukan JSON. lavalink-client lalu mati dengan
 *    `SyntaxError: Unexpected token 'P', "Proxy erro"... is not valid JSON`.
 *    Di sini skema + port diturunkan dari host-nya, bukan dari default buta.
 *
 * 2. Node belum siap saat bot boot (Railway cold start 30-120 detik).
 *    Kalau node diserahkan ke library dalam keadaan itu, `manager.init()` bisa
 *    menggantung: retry internal jalan terus, promise tidak pernah settle,
 *    `#waitForNode()` tidak pernah dieksekusi, dan fallback ke engine lokal
 *    tidak pernah terjadi. Karena itu kita cek dulu lewat HTTP `GET /v4/info`
 *    sampai menjawab JSON valid, baru node diserahkan ke lavalink-client.
 */

const INTERNAL_SUFFIXES = ['.railway.internal', '.internal', '.local'];
const PUBLIC_RAILWAY_SUFFIXES = ['.up.railway.app', '.railway.app'];
const PUBLIC_PORT = 443;
const INTERNAL_PORT = 8080;
const LOCAL_PORT = 2333;

/** Kind error yang tidak akan sembuh sendiri kalau ditunggu. */
const FATAL_KINDS = new Set(['auth', 'not-lavalink']);

const isIp = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

/**
 * Menyeragamkan satu node dari env/JSON jadi opsi yang dimengerti lavalink-client.
 *
 * Menerima:
 *   - `url` penuh   : "https://lavalink.example.com" / "http://lavalink.railway.internal:8080"
 *   - `host` polos  : "lavalink.railway.internal" / "1.2.3.4:2333"
 *   - `port`/`secure` eksplisit selalu menang atas hasil tebakan.
 *
 * @returns {{ node: object, notes: string[] }}
 */
export function normalizeNode(input = {}, env = process.env) {
  const notes = [];
  const raw = String(input.url ?? input.host ?? '').trim();
  if (!raw) throw new Error('node Lavalink tanpa host/url');

  let host = raw;
  let port;
  let secure;
  let fromUrl = false;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`URL Lavalink tidak valid: ${raw}`);
    }
    fromUrl = true;
    host = parsed.hostname;
    port = parsed.port ? Number(parsed.port) : undefined;
    secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  } else {
    // "host:8080" atau "host/path" (tanpa skema)
    const withoutPath = raw.split('/')[0];
    const match = /^(.*?)(?::(\d+))?$/.exec(withoutPath);
    host = match?.[1] ?? withoutPath;
    if (match?.[2]) port = Number(match[2]);
  }

  host = host.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!host) throw new Error(`host Lavalink tidak valid: ${raw}`);

  // Skema dari URL penuh selalu menang; `secure` eksplisit hanya untuk input tanpa skema.
  const explicitPort = Number(input.port);
  const hasExplicitPort =
    input.port !== undefined && input.port !== null && input.port !== '' && Number.isFinite(explicitPort) && explicitPort > 0;
  if (hasExplicitPort && port === undefined) port = explicitPort;
  if (!fromUrl && typeof input.secure === 'boolean') secure = input.secure;

  const lower = host.toLowerCase();
  const isInternal = INTERNAL_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || lower === 'localhost';
  const isPublicRailway = PUBLIC_RAILWAY_SUFFIXES.some((suffix) => lower.endsWith(suffix));

  if (secure === undefined) {
    if (isInternal) secure = false;
    else if (isPublicRailway) secure = true;
    else if (port !== undefined) secure = port === PUBLIC_PORT;
    else secure = !isIp(host); // domain polos -> TLS, IP polos -> http
  }

  if (port === undefined) {
    if (isInternal) port = INTERNAL_PORT;
    else if (secure) port = PUBLIC_PORT;
    else port = LOCAL_PORT;
  }

  // Koreksi kombinasi yang mustahil, dengan catatan supaya user tahu.
  if (isPublicRailway && !secure) {
    notes.push('domain *.up.railway.app selalu HTTPS — secure dipaksa true');
    secure = true;
  }
  if (isPublicRailway && port !== PUBLIC_PORT && port !== 80) {
    notes.push(`port ${port} tidak terbuka di domain publik Railway — dipakai 443`);
    port = PUBLIC_PORT;
  }
  if (isInternal && secure) {
    notes.push('host *.railway.internal tidak memakai TLS — secure dipaksa false');
    secure = false;
  }

  const retryAmount = Number(input.retryAmount ?? env.LAVALINK_RETRY_AMOUNT);
  const retryDelay = Number(input.retryDelay ?? env.LAVALINK_RETRY_DELAY_MS);

  return {
    node: {
      id: String(input.id ?? 'main'),
      host,
      port,
      secure,
      authorization: String(input.password ?? input.authorization ?? env.LAVALINK_PASSWORD ?? ''),
      retryAmount: Number.isFinite(retryAmount) ? retryAmount : 10,
      retryDelay: Number.isFinite(retryDelay) ? retryDelay : 5_000,
    },
    notes,
  };
}

/** Basis URL HTTP untuk node ini (dipakai preflight & pesan error). */
export function baseUrl(node) {
  const scheme = node.secure ? 'https' : 'http';
  const port = Number(node.port);
  const isDefault = (node.secure && port === 443) || (!node.secure && port === 80);
  return `${scheme}://${node.host}${isDefault ? '' : `:${port}`}`;
}

export class LavalinkProbeError extends Error {
  constructor(kind, message, { status, body, hint } = {}) {
    super(message);
    this.name = 'LavalinkProbeError';
    this.kind = kind;
    this.status = status;
    this.body = body;
    this.hint = hint;
  }
}

/**
 * Satu kali cek `GET /v4/info`. Melempar LavalinkProbeError dengan `kind` yang
 * bisa dipakai untuk membedakan "belum boot" vs "konfigurasi salah".
 */
export async function probeLavalink(node, { timeoutMs = 8_000 } = {}) {
  const url = `${baseUrl(node)}/v4/info`;

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: node.authorization ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new LavalinkProbeError('timeout', `${url} tidak menjawab dalam ${timeoutMs}ms`, {
        hint: 'port salah, container belum listen, atau host memblokir koneksi',
      });
    }
    throw new LavalinkProbeError('network', `${url} gagal dihubungi (${code ?? error.message})`, {
      hint:
        code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? 'host tidak dikenal — di Railway pakai <nama-service>.railway.internal'
          : 'pastikan Lavalink listen di 0.0.0.0 dan port-nya sama dengan LAVALINK_PORT',
    });
  }

  const body = await response.text().catch(() => '');

  if (response.status === 401 || response.status === 403) {
    throw new LavalinkProbeError('auth', `${url} menolak kredensial (HTTP ${response.status})`, {
      status: response.status,
      body,
      hint: 'LAVALINK_PASSWORD di bot harus sama persis dengan yang dipakai service Lavalink',
    });
  }

  let info;
  try {
    info = JSON.parse(body);
  } catch {
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 120);
    const viaProxy = /proxy error|application failed to respond|bad gateway|gateway time-?out|service unavailable|no healthy/i.test(body);
    throw new LavalinkProbeError(viaProxy ? 'proxy' : 'non-json', `${url} membalas non-JSON: "${snippet || '(kosong)'}"`, {
      status: response.status,
      body,
      hint: viaProxy
        ? 'itu balasan proxy host, bukan Lavalink. Di Railway: host internal (http, port container) atau domain publik dengan port 443 + secure=true'
        : 'pastikan host/port menunjuk ke Lavalink v4, bukan web server lain',
    });
  }

  if (!info?.version) {
    throw new LavalinkProbeError('not-lavalink', `${url} menjawab JSON tapi bukan /v4/info Lavalink`, {
      status: response.status,
      body,
      hint: 'cek path /v4 — mungkin ini Lavalink v3 atau service lain',
    });
  }

  if (!response.ok) {
    throw new LavalinkProbeError('http', `${url} HTTP ${response.status}`, { status: response.status, body });
  }

  return { info, url };
}

/**
 * Tunggu sampai minimal satu node menjawab `/v4/info` dengan JSON valid.
 * Ini yang membuat cold start Railway aman: bot menunggu (dengan progres log),
 * bukan menyerahkan node setengah jadi ke library lalu menggantung.
 */
export async function waitForLavalink(nodes, { timeoutMs = 90_000, log } = {}) {
  if (!nodes?.length) throw new Error('tidak ada node Lavalink yang dikonfigurasi');

  const started = Date.now();
  const deadline = started + Math.max(1_000, timeoutMs);
  const lastError = new Map();
  const totalSeconds = Math.round(Math.max(1_000, timeoutMs) / 1000);
  let attempt = 0;
  let nextLogAt = 0;
  let delay = 1_000;

  while (Date.now() < deadline) {
    attempt += 1;

    for (const node of nodes) {
      try {
        const { info, url } = await probeLavalink(node, { timeoutMs: 8_000 });
        log?.info?.(`node "${node.id}" siap: ${url} (Lavalink ${info.version?.semver ?? '?'})`);
        return { node, info };
      } catch (error) {
        lastError.set(node.id, error);
      }
    }

    // Konfigurasi yang jelas salah jangan ditunggu sampai timeout.
    const kinds = nodes.map((node) => lastError.get(node.id)?.kind);
    if (attempt >= 3 && kinds.every((kind) => FATAL_KINDS.has(kind))) {
      throw describeFailure(nodes, lastError, `Lavalink menolak konfigurasi ini (${totalSeconds}s belum habis)`);
    }

    const elapsed = Date.now() - started;
    if (Date.now() >= nextLogAt) {
      const detail = nodes
        .map((node) => `${node.id}: ${lastError.get(node.id)?.message ?? '-'}`)
        .join(' | ');
      log?.warn?.(`Lavalink belum siap (${Math.round(elapsed / 1000)}s/${totalSeconds}s) ${detail}`);
      nextLogAt = Date.now() + 15_000;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
    delay = Math.min(5_000, Math.round(delay * 1.6));
  }

  throw describeFailure(nodes, lastError, `Lavalink tidak siap dalam ${totalSeconds}s`);
}

function describeFailure(nodes, lastError, headline) {
  const lines = nodes.map((node) => {
    const error = lastError.get(node.id);
    return `  ${node.id} (${baseUrl(node)}) -> ${error ? `${error.kind}: ${error.message}` : 'belum dicek'}`;
  });
  const hints = [...new Set([...lastError.values()].map((error) => error?.hint).filter(Boolean))];
  const error = new LavalinkProbeError('timeout', [headline, ...lines, ...hints.map((hint) => `  hint: ${hint}`)].join('\n'));
  error.hints = hints;
  return error;
}

export default { normalizeNode, baseUrl, probeLavalink, waitForLavalink, LavalinkProbeError };
