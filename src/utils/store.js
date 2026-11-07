import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('store');

/**
 * Tiny JSON persistence helper.
 * Writes atomically (tmp file + rename) so a crash never leaves a half-written file.
 */
export class JsonStore {
  constructor(fileName, defaults = {}) {
    this.file = path.join(config.dataDir, fileName);
    this.defaults = defaults;
    this.data = this.#load();
  }

  #load() {
    try {
      if (!fs.existsSync(this.file)) return structuredClone(this.defaults);
      const raw = fs.readFileSync(this.file, 'utf8').trim();
      if (!raw) return structuredClone(this.defaults);
      const parsed = JSON.parse(raw);
      return { ...structuredClone(this.defaults), ...parsed };
    } catch (error) {
      log.warn(`Gagal membaca ${path.basename(this.file)}, mulai dari kosong:`, error.message);
      return structuredClone(this.defaults);
    }
  }

  get(key, fallback = undefined) {
    return this.data[key] ?? fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
    return value;
  }

  delete(key) {
    delete this.data[key];
    this.save();
  }

  all() {
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      log.error(`Gagal menyimpan ${path.basename(this.file)}:`, error.message);
    }
  }
}
