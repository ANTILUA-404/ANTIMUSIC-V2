import { config } from "../config.js";

/**
 * Public (third party) Lavalink nodes.
 *
 * They are DISABLED by default on purpose:
 *  - they are shared, rate limited and frequently return proxy/HTML errors,
 *  - every search query and voice payload travels through someone else's server.
 *
 * Enable with LAVALINK_ENABLE_FALLBACKS=true if you really want a backup pool.
 */
const PUBLIC_FALLBACKS = [
  {
    id: "Lavalink-Nazha",
    host: "lavalink.nazha.online",
    port: 443,
    authorization: "nazhafreelava",
    secure: true,
  },
  {
    id: "Lavalink-Jirayu",
    host: "lavalink.jirayu.net",
    port: 443,
    authorization: "youshallnotpass",
    secure: true,
  },
  {
    id: "Lavalink-Serenetia",
    host: "lavalinkv4.serenetia.com",
    port: 443,
    authorization: "https://seretia.link/discord",
    secure: true,
  },
];

const NODE_BEHAVIOUR = {
  // Long enough to survive a slow first boot (jar + JRE download), but still
  // finite: the library stops hammering instead of retrying forever.
  retryAmount: 30,
  retryDelay: 10_000,
  retryTimespan: 600_000,
  requestSignalTimeoutMS: config.nodes.requestTimeoutMs,
  heartBeatInterval: 30_000,
  enablePingOnStatsCheck: true,
};

function normalize(node) {
  return {
    ...NODE_BEHAVIOUR,
    ...node,
    port: Number(node.port) || 2333,
    secure: Boolean(node.secure),
    authorization: String(node.authorization ?? ""),
  };
}

export function buildNodes() {
  const primary = normalize({
    id: "Lavalink-Primary",
    host: config.lavalink.host,
    port: config.lavalink.port,
    authorization: config.lavalink.password,
    secure: config.lavalink.secure,
  });

  const nodes = [primary];

  if (!config.nodes.enableFallbacks) return nodes;

  const candidates = [...config.nodes.fallbacks, ...PUBLIC_FALLBACKS];
  for (const candidate of candidates) {
    if (!candidate?.host) continue;
    const duplicate = nodes.some(
      (node) => node.host.toLowerCase() === candidate.host.toLowerCase() && node.port === candidate.port,
    );
    if (duplicate) continue;
    nodes.push(normalize(candidate));
  }

  return nodes;
}

export function nodeLabel(node) {
  const options = node?.options || node || {};
  return `${options.host}:${options.port}`;
}
