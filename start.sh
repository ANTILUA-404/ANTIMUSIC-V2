#!/usr/bin/env bash
#
# ANTIMUSIC launcher for Pterodactyl / VPS.
#   ./start.sh
#
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ANTIMUSIC] Node.js tidak ditemukan. Gunakan image Node.js 20/22." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ANTIMUSIC] Node.js v$(node -v) terlalu lama, butuh >= 20." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "[ANTIMUSIC] Memasang dependency..."
  npm install --omit=dev --no-audit --no-fund
fi

exec node index.js
