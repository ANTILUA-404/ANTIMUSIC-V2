import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { createLogger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('deploy');

async function collectCommands() {
  const dir = path.join(__dirname, 'commands');
  const body = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    if (module.default?.data) body.push(module.default.data.toJSON());
  }
  return body;
}

async function main() {
  if (!config.token) {
    log.error('DISCORD_TOKEN kosong. Isi dulu di .env');
    process.exit(1);
  }

  const body = await collectCommands();
  const rest = new REST().setToken(config.token);

  let clientId = config.clientId;
  if (!clientId) {
    const me = await rest.get(Routes.user());
    clientId = me.id;
    log.info(`CLIENT_ID tidak diisi, memakai id dari token: ${clientId}`);
  }

  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, config.guildId), { body });
    log.info(`✅ ${body.length} command terdaftar di guild ${config.guildId} (langsung aktif).`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    log.info(`✅ ${body.length} command terdaftar global (butuh sampai 1 jam buat muncul di semua server).`);
  }
}

main().catch((error) => {
  log.error('Deploy command gagal:', error);
  process.exit(1);
});
