#!/usr/bin/env bash
#
# ANTIMUSIC launcher untuk Pterodactyl / VPS.
#   ./start.sh
#
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[antimusic] node_modules belum ada, menjalankan npm install..."
  npm install
fi

if [ ! -f .env ]; then
  echo "[antimusic] .env belum ada."
  echo "            copy .env.example menjadi .env lalu isi DISCORD_TOKEN & CLIENT_ID."
  exit 1
fi

exec node index.js
