# Lavalink untuk Railway (ANTIMUSIC)
#
# Build context = folder ini (set "Root Directory" service Railway ke `railway`).
# Ukuran image ~ 400 MB (JRE 21 + Lavalink.jar 96 MB).
FROM eclipse-temurin:21-jre-jammy

ARG LAVALINK_VERSION=4.2.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/lavalink

# JAR di-bake supaya cold start tidak perlu unduh 96 MB lagi.
RUN curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -o Lavalink.jar \
    "https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar"

COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Railway meng-inject PORT; start.sh memakainya (fallback 2333 untuk lokal).
ENV PORT=2333
EXPOSE 2333

# tini: menangani SIGTERM dengan benar supaya JVM tidak jadi zombie saat redeploy.
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/lavalink/start.sh"]
