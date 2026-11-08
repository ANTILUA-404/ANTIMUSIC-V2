# ANTIMUSIC v3 - single container (Discord.js + yt-dlp + FFmpeg)
# Tidak ada Java/Lavalink di image ini.
FROM node:22-bookworm-slim

# ca-certificates: unduhan HTTPS (yt-dlp, Discord API)
# python3: hanya dipakai kalau kamu memasang yt-dlp versi pip; binary standalone tidak butuh
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# @discordjs/opus opsional: kalau build native gagal, opusscript dipakai otomatis.
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Bake FFmpeg + yt-dlp ke dalam image supaya cold start tidak perlu unduh lagi.
RUN node scripts/install-ffmpeg.js && node scripts/install-ytdlp.js

ENV NODE_ENV=production
ENV LOG_LEVEL=info

EXPOSE 3000

CMD ["node", "index.js"]
