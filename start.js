/**
 * Alias entry point.
 *
 * Beberapa egg Pterodactyl memakai `start.js` sebagai MAIN_FILE.
 * File ini hanya meneruskan ke index.js supaya bootstrap dependency
 * (npm install otomatis) tetap ikut jalan.
 */
import './index.js';
