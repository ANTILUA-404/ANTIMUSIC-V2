#!/usr/bin/env bash
#
# Entrypoint Lavalink untuk Railway (atau Docker/VPS mana pun).
#
# Tiga hal yang WAJIB ditangani di sini — semuanya pernah bikin bot mati:
#
# 1. Spring Boot membaca env SERVER_PORT dan MENIMPA server.port dari yml.
#    Di Pterodactyl itu bikin Lavalink listen di port alokasi panel, sementara
#    bot terus menembak 2333 -> ECONNREFUSED selamanya. Jadi SERVER_PORT dibuang
#    dan port dipaksa lewat -Dserver.port + --server.port.
#
# 2. LavaSrc mematikan SELURUH proses kalau sebuah source diaktifkan tanpa
#    kredensial ("Deezer master key must be set"). Karena itu source hanya
#    di-enable kalau kredensialnya benar-benar ada.
#
# 3. Port harus mengikuti $PORT dari Railway, bukan hardcode 2333.
#
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-2333}"
PASSWORD="${LAVALINK_PASSWORD:-antimusic-change-me}"
MEM="${JAVA_MEMORY_MB:-512}"
OPUS_QUALITY="${OPUS_ENCODING_QUALITY:-10}"
RESAMPLING="${RESAMPLING_QUALITY:-HIGH}"
YT_PLUGIN="${YOUTUBE_PLUGIN_VERSION:-1.18.2}"
LAVASRC_VERSION="${LAVASRC_VERSION:-4.8.3}"

# Kredensial -> hanya source yang siap yang diaktifkan.
SPOTIFY_ON=false
if [[ -n "${SPOTIFY_CLIENT_ID:-}" && -n "${SPOTIFY_CLIENT_SECRET:-}" ]]; then
  SPOTIFY_ON=true
fi

DEEZER_ON=false
if [[ -n "${DEEZER_MASTER_KEY:-}" ]]; then
  DEEZER_ON=true
fi

APPLE_ON=false
if [[ -n "${APPLE_MUSIC_TOKEN:-}" ]]; then
  APPLE_ON=true
fi

echo "──────────────────────────────────────────────"
echo " ANTIMUSIC · Lavalink"
echo " port=$PORT  mem=${MEM}m  opusQuality=$OPUS_QUALITY"
echo " spotify=$SPOTIFY_ON  deezer=$DEEZER_ON  apple=$APPLE_ON"
echo "──────────────────────────────────────────────"

cat > application.yml <<YAML
server:
  port: ${PORT}
  address: 0.0.0.0

lavalink:
  plugins:
    - dependency: "dev.lavalink.youtube:youtube-plugin:${YT_PLUGIN}"
      snapshot: false
    - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:${LAVASRC_VERSION}"
      snapshot: false
  server:
    password: "${PASSWORD}"
    sources:
      # YouTube ditangani plugin youtube-source, bukan source bawaan.
      youtube: false
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: true
      http: true
      local: false
    filters:
      volume: true
      equalizer: true
      karaoke: true
      timescale: true
      tremolo: true
      vibrato: true
      distortion: true
      rotation: true
      channelMix: true
      lowPass: true
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    # 10 = kualitas Opus maksimum yang didukung Lavalink.
    opusEncodingQuality: ${OPUS_QUALITY}
    resamplingQuality: ${RESAMPLING}
    trackStuckThresholdMs: 10000
    useSeekGhosting: true
    youtubePlaylistLoadLimit: 6
    playerUpdateInterval: 5
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
    gc-warnings: true

plugins:
  youtube:
    enabled: true
    allowSearch: true
    # MUSIC untuk pencarian, sisanya untuk playback. TVHTML5_SIMPLY tidak butuh login.
    clients:
      - MUSIC
      - ANDROID_VR
      - WEB
      - WEBEMBEDDED
      - TVHTML5_SIMPLY
      - MWEB
    # Kalau IP Railway diblokir YouTube, isi refresh token (lihat RAILWAY.md).
    oauth:
      enabled: ${YOUTUBE_OAUTH_ENABLED:-false}
      refreshToken: "${YOUTUBE_OAUTH_REFRESH_TOKEN:-}"
      skipInitialization: false
  lavasrc:
    providers:
      - "ytsearch:%QUERY%"
      - "scsearch:%QUERY%"
    sources:
      spotify: ${SPOTIFY_ON}
      deezer: ${DEEZER_ON}
      applemusic: ${APPLE_ON}
      ytdlp: false
      flowerytts: false
      youtube: true
YAML

# Blok kredensial hanya ditulis kalau source-nya aktif.
if [[ "$SPOTIFY_ON" == "true" ]]; then
  cat >> application.yml <<YAML
    spotify:
      clientId: "${SPOTIFY_CLIENT_ID}"
      clientSecret: "${SPOTIFY_CLIENT_SECRET}"
      countryCode: "${SPOTIFY_COUNTRY_CODE:-ID}"
YAML
fi

if [[ "$DEEZER_ON" == "true" ]]; then
  cat >> application.yml <<YAML
    deezer:
      masterKey: "${DEEZER_MASTER_KEY}"
      decryptionKey: "${DEEZER_DECRYPTION_KEY:-}"
      countryCode: "${DEEZER_COUNTRY_CODE:-ID}"
YAML
fi

if [[ "$APPLE_ON" == "true" ]]; then
  cat >> application.yml <<YAML
    applemusic:
      mediaAPIToken: "${APPLE_MUSIC_TOKEN}"
      countryCode: "${APPLE_MUSIC_COUNTRY_CODE:-ID}"
YAML
fi

# SERVER_PORT / PORT adalah milik platform, bukan milik Lavalink.
unset SERVER_PORT SERVER_PORT_LOCAL || true

if [[ "${GENERATE_ONLY:-0}" == "1" ]]; then
  echo "application.yml ditulis (GENERATE_ONLY=1), tidak menjalankan Lavalink."
  exit 0
fi

if [[ ! -f Lavalink.jar ]]; then
  echo "Lavalink.jar tidak ada — mengunduh ${LAVALINK_VERSION:-4.2.2}..."
  curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -o Lavalink.jar \
    "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION:-4.2.2}/Lavalink.jar"
fi

echo "Menjalankan Lavalink di 0.0.0.0:${PORT} ..."
exec java \
  -Dserver.port="${PORT}" \
  -Xms"${MEM}m" -Xmx"${MEM}m" \
  -XX:+UseG1GC \
  -XX:+ExitOnOutOfMemoryError \
  -jar Lavalink.jar \
  --server.port="${PORT}"
