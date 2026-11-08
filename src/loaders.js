import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('loader');

export async function loadCommands(client) {
  const dir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    const command = module.default;
    if (!command?.data || typeof command.execute !== 'function') {
      log.warn(`Command ${file} dilewati (butuh "data" dan "execute").`);
      continue;
    }
    client.commands.set(command.data.name, command);
  }
  log.info(`${client.commands.size} command dimuat.`);
}

export async function loadEvents(client) {
  const dir = path.join(__dirname, 'events');
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.js'));
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    const event = module.default;
    if (!event?.name || typeof event.execute !== 'function') {
      log.warn(`Event ${file} dilewati.`);
      continue;
    }
    const handler = (...args) => {
      Promise.resolve(event.execute(...args, client)).catch((error) =>
        log.error(`Event ${event.name} error:`, error),
      );
    };
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);
  }
  log.info(`${files.length} event handler terpasang.`);
}
