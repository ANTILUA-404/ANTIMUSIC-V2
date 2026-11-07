import http from 'node:http';
import { config } from './config.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('health');

/**
 * Tiny HTTP endpoint so Pterodactyl (and uptime monitors) can see the bot is alive.
 *
 * On Pterodactyl the panel injects SERVER_PORT and expects the process to listen
 * on it - without this the server shows as "offline" and gets restarted.
 * Locally it stays disabled unless HEALTH_PORT is set.
 */
export function startHealthServer(client, { version = 'unknown' } = {}) {
  const port = config.health.port;
  if (!port) {
    log.debug('Health server dimatikan (SERVER_PORT / HEALTH_PORT kosong)');
    return null;
  }

  const server = http.createServer((request, response) => {
    const url = (request.url || '/').split('?')[0];

    if (url !== '/' && url !== '/health' && url !== '/healthz') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const ready = client.isReady();
    const body = {
      status: ready ? 'ok' : 'starting',
      version,
      uptime: Math.round(process.uptime()),
      guilds: client.guilds?.cache?.size ?? 0,
      players: client.players?.size ?? 0,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };

    response.writeHead(ready ? 200 : 503, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  });

  server.on('error', (error) => {
    log.warn(`Health server gagal listen di :${port} - ${error.message}`);
  });

  server.listen(port, '0.0.0.0', () => {
    log.info(`Health server aktif di http://0.0.0.0:${port}/health`);
  });

  server.unref?.();
  return server;
}

export default startHealthServer;
