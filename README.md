# ANTIMUSIC v3

Discord music bot bertenaga **Discord.js 14 + yt-dlp + FFmpeg**.
**Tanpa Lavalink, tanpa Java.** Satu proses Node.js, satu perintah start.

Mode **24/7 radio**, **whitelist lisensi server**, **health endpoint untuk panel**, dan
dukungan **YouTube / Spotify / SoundCloud / Bandcamp / Twitch / Vimeo / link stream langsung**.

---

## Kenapa v3? (dan kenapa Lavalink dibuang)

v2 jalan di atas Lavalink v4 embedded. Itu keputusan yang benar untuk saat itu, tapi
di Pterodactyl biayanya mahal:

| Masalah di v2 | Akar sebab | Status di v3 |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:2333` | `SERVER_PORT` dari panel menimpa `server.port` Spring Boot | ❌ tidak ada Java = tidak ada Spring Boot |
| Crash loop port 2333 | sisa JVM dari run sebelumnya menahan port | ❌ tidak ada JVM |
| `401 Unauthorized` | password di `application.yml` beda dengan `.env` | ❌ tidak ada Lavalink |
| RAM 400–800 MB | JVM + plugin YouTube + LavaSrc | ✅ ±100–200 MB |
| Start 1–3 menit | unduh plugin + warmup JVM | ✅ ±3 detik |
| YouTube plugin sering putus | plugin & client YouTube berubah | ✅ `yt-dlp` update sendiri (`npm run install:ytdlp -- --force`) |

Yang **tidak** berubah: nama bot, entrypoint (`index.js`), variabel `.env` inti,
fitur whitelist lisensi, dan cara deploy di panel. Jadi egg Pterodactyl lama tetap bisa dipakai —
cuma Java-nya sekarang boleh dihapus.

---

## Fitur

| Kategori | Detail |
|---|---|
| **Sumber** | YouTube (video + live), Spotify (track/album/playlist/artist), SoundCloud, Bandcamp, Twitch, Vimeo, + ribuan situs lain via yt-dlp |
| **Link langsung** | File audio (`.mp3`, `.m4a`, `.flac`, `.ogg`, `.opus`, `.wav`) dan stream Icecast/HLS |
| **Pencarian** | `/play <judul>` → dropdown 5 hasil, tinggal pilih |
| **Antrian** | Sampai 500 track, pagination, hapus, acak, lompat |
| **Kontrol** | Pause/resume, skip multi, seek, volume 0–200%, loop off/track/queue |
| **Filter audio** | bassboost, nightcore, vaporwave, 8d, karaoke, treble, soft |
| **Autoplay** | Antrian habis → ambil lagu mirip dari YouTube Mix |
| **Radio 24/7** | Bot betah di voice, auto-reconnect, **balik sendiri setelah restart** |
| **Station radio** | 12 preset (SomaFM, Radio Paradise, NTS, Lofi Girl, Prambors, Gen FM) + custom |
| **Lisensi** | Whitelist server dari `.env` **atau** `data/whitelist.json` (auto-reload 30 detik) |
| **Panel** | Health endpoint di `SERVER_PORT` + entrypoint `index.js` / `start.js` |

---

## Quick start — cukup isi token, lalu Start

Bot ini **zero-setup**. Saat start dia melakukan sendiri:

| Otomatis | Kapan |
|---|---|
| `npm install` kalau `node_modules` belum ada | sebelum bot dimuat |
| Unduh FFmpeg + yt-dlp ke `bin/` | setelah install / saat boot |
| Daftarkan 18 slash command | setiap start, hanya kalau command berubah |
| Buka health endpoint di `SERVER_PORT` | saat boot (dipakai panel) |
| Pulihkan sesi radio 24/7 | saat boot |

Jadi yang perlu kamu lakukan cuma **satu**: memberi token.

### Paling cepat — import egg Pterodactyl

> **Pelanggan hosting panel** (anjas.id, dsb.) tidak bisa import egg — itu normal.
> Langkah khusus untuk kalian ada di [PTERODACTYL.md bagian 🏠](PTERODACTYL.md).

1. Admin panel → **Nests** → **Import Egg** → pilih `deploy/pterodactyl-egg.json`
2. **Create Server** pakai egg `ANTIMUSIC v3`
3. Isi **Discord Bot Token** di tab Startup
4. **Start**

Installer otomatis clone repo, `npm install`, dan mengunduh FFmpeg + yt-dlp.
Setelah itu setiap restart akan `git pull` sendiri (`AUTO_UPDATE=1`).

### Kalau server-nya sudah ada (upgrade)

```bash
git pull
```

lalu isi `DISCORD_TOKEN` di tab **Startup** panel (atau di `.env`), dan tekan **Start**.
**Tidak perlu** `npm install` manual, **tidak perlu** `npm run deploy`.

### Jalan di komputer sendiri

```bash
npm install          # sekaligus unduh FFmpeg + yt-dlp
cp .env.example .env # isi DISCORD_TOKEN
npm start
```

Variabel minimal yang wajib: **`DISCORD_TOKEN`** saja.
`CLIENT_ID` opsional (diambil dari token), `GUILD_ID` opsional.

Invite bot (ganti `CLIENT_ID` dengan Application ID kamu):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=3230720&scope=bot%20applications.commands
```

> Bot ini **tidak butuh privileged intents**. Cukup `Guilds` + `Guild Voice States`,
> jadi tidak ada yang perlu dicentang di Discord Developer Portal.

### Cek dulu kalau ada masalah

```bash
npm run doctor       # node, ffmpeg, yt-dlp, token, spotify, opus, whitelist
npm run check        # validasi syntax + payload semua command
npm test             # unit test logika inti
npm run audio-test   # tes pipeline audio nyata (tanpa Discord)
```

---

## Command


| Command | Fungsi |
|---|---|
| `/play <query> [next]` | Putar dari judul/URL. `next:true` = taruh paling depan |
| `/pause` `/resume` | Pause / lanjut |
| `/skip [jumlah]` | Skip 1 atau beberapa lagu |
| `/seek <mm:ss>` | Lompat ke detik tertentu |
| `/jump <posisi>` | Langsung putar lagu ke-N |
| `/stop` | Stop, kosongkan antrian, keluar dari voice |
| `/queue [halaman]` | Lihat antrian (10 per halaman) |
| `/nowplaying` | Progress bar + info lagu |
| `/remove <posisi>` | Hapus lagu dari antrian |
| `/shuffle` | Acak antrian |
| `/loop <off\|track\|queue>` | Mode pengulangan |
| `/volume <0-200>` | Volume |
| `/filter <nama>` | Pasang audio filter |
| `/autoplay <on\|off>` | Lagu mirip otomatis |
| `/radio start <station>` | **Mode radio 24/7** |
| `/radio stop` / `status` / `list` / `add` / `remove` | Kelola radio |
| `/disconnect` | Keluarkan bot dari voice |
| `/help` | Daftar command |

---

## Radio 24/7

```bash
/radio start station:lofi
/radio list
/radio add name:"Radio Kampus" url:"https://stream.example.com/live.mp3"
/radio status
/radio stop
```

Cara kerjanya:

- Bot masuk voice channel dan memutar **stream tanpa batas** (bukan antrian lagu).
- Koneksi voice putus → `reconnect()` otomatis.
- Stream mati → retry dengan backoff (5s, 10s, 15s, … maks `RADIO_MAX_RETRIES`).
  Kalau sempat main >1 menit, hitungan retry di-reset (bukan gagal permanen).
- Sesi disimpan di `data/radio.json`; setelah restart bot join lagi ke channel yang sama.
- Saat mode radio aktif, bot **tidak** auto-leave walau channel kosong, dan `/skip` dinonaktifkan.

> Station YouTube live butuh 5–15 detik untuk start (ekstraksi stream).
> Station Icecast seperti SomaFM jauh lebih cepat dan lebih stabil.

---

## Spotify

Tanpa kredensial, bot tetap bisa memutar track **dan** playlist Spotify: metadata diambil
dari halaman embed publik (judul, artis, durasi, cover, maks 50 track per playlist),
lalu dicarikan versi audionya di YouTube.

Mau playlist/album penuh? Isi kredensial gratis:

1. <https://developer.spotify.com/dashboard> → **Create app**
2. Copy **Client ID** + **Client Secret** ke `.env`

Bot memakai *Client Credentials flow* (metadata publik saja, tanpa login user).

---

## Konfigurasi `.env`

| Variable | Default | Keterangan |
|---|---|---|
| `DISCORD_TOKEN` | — | **Wajib** |
| `CLIENT_ID` | dari token | Application ID |
| `GUILD_ID` | — | Daftarkan command per-server (instan) |
| `DEFAULT_VOLUME` | `80` | 0–200 |
| `MAX_QUEUE_SIZE` | `500` | Batas antrian |
| `IDLE_LEAVE_SECONDS` | `60` | Auto-leave setelah sepi (`0` = matikan). Alias: `IDLE_DESTROY_MS` |
| `SEARCH_RESULTS` | `5` | Jumlah hasil dropdown |
| `AUTOPLAY` | `false` | Alias: `AUTOPLAY_DEFAULT` |
| `DEFAULT_LOOP` | `off` | `off`/`track`/`queue` |
| `HEALTH_PORT` | — | Port health endpoint (di panel otomatis pakai `SERVER_PORT`) |
| `YTDLP_PATH` | `./bin/yt-dlp` → PATH | Path binary yt-dlp |
| `YTDLP_AUTO_INSTALL` | `true` | Unduh yt-dlp ke `./bin` kalau belum ada |
| `FFMPEG_PATH` | `./bin/ffmpeg` → PATH | Override FFmpeg |
| `YTDLP_COOKIES` | — | Cookie Netscape (konten age-restricted) |
| `YTDLP_PROXY` | — | Proxy untuk yt-dlp |
| `YTDLP_EXTRACTOR_ARGS` | — | Mis. `youtube:player_client=web,android` |
| `SPOTIFY_CLIENT_ID` / `SECRET` | — | Playlist Spotify penuh |
| `RADIO_RESTORE_ON_BOOT` | `true` | Pulihkan sesi 24/7 setelah restart |
| `RADIO_RETRY_DELAY_MS` | `5000` | Backoff awal radio |
| `RADIO_MAX_RETRIES` | `10` | Batas retry radio |
| `WHITELIST_ENABLED` | `false` | Aktifkan lisensi server |
| `WHITELIST_GUILD_IDS` | — | ID server yang diizinkan (pisah koma) |
| `OWNER_USERNAME` | `owner` | Nama yang muncul di panel penolakan |
| `OWNER_USER_ID` | — | Memunculkan tombol "Hubungi Owner" |
| `WHITELIST_LEAVE_UNAUTHORIZED` | `true` | Keluar dari server tanpa lisensi |
| `LOG_LEVEL` | `info` | `error`/`warn`/`info`/`debug` |

---

## Migrasi dari v2 (Lavalink)

1. **Startup command tidak berubah**: tetap `node index.js` (atau `npm start`).
   `start.js` juga masih ada untuk egg yang memakai `MAIN_FILE=start.js`.
2. **Hapus folder `lavalink/`** dan seluruh variabel `LAVALINK_*` dari `.env` — sudah tidak dibaca.
   Kalau dibiarkan pun tidak error, cuma diabaikan.
3. **Java tidak dipakai lagi.** Egg Pterodactyl boleh tetap yang Node.js; kalau punya
   Dockerfile sendiri, image-nya cukup Node 20+.
4. Variabel lama yang **masih jalan**: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`,
   `DEFAULT_VOLUME`, `MAX_QUEUE_SIZE`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
   `WHITELIST_*`, `OWNER_*`, `LOG_LEVEL`.
5. Variabel yang **diganti**: `IDLE_DESTROY_MS` → `IDLE_LEAVE_SECONDS` (nilai lama tetap
   diterima sebagai alias), `AUTOPLAY_DEFAULT` → `AUTOPLAY`.
6. `PREFIX` tidak dipakai lagi — semua lewat slash command.
7. Kode v2 utuh di tag **`v2.3.3-lavalink`**:
   ```bash
   git checkout v2.3.3-lavalink
   ```

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Bot join voice tapi **hening** | `npm run audio-test`. Kalau gagal → yt-dlp/FFmpeg bermasalah. Kalau lolos → cek permission **Speak** |
| `yt-dlp tidak ditemukan` | `npm run install:ytdlp`, atau set `YTDLP_PATH` |
| `ffmpeg: spawn ... ENOENT` | Binary FFmpeg belum ada (npm memblokir install script dependency). Jalankan `npm run install:ffmpeg`, atau cukup restart bot — versi ini mengunduh sendiri |
| `npm warn allow-scripts` saat install | npm 11.7+ memblokir lifecycle script dependency. Tidak masalah: FFmpeg & yt-dlp diunduh oleh `postinstall` milik bot, bukan oleh dependency |
| `Sign in to confirm you're not a bot` | `npm run install:ytdlp -- --force` (update), atau isi `YTDLP_COOKIES` dengan `cookies.txt` dari browser |
| `HTTP Error 403` | Update yt-dlp; alternatif `YTDLP_EXTRACTOR_ARGS=youtube:player_client=web,android` |
| `Gagal connect ke voice (timeout)` | Izin Connect/Speak kurang, atau channel penuh |
| Slash command tidak muncul | `npm run deploy`; kalau global tunggu ~1 jam atau isi `GUILD_ID` |
| Playlist Spotify cuma 50 lagu | Isi `SPOTIFY_CLIENT_ID`/`SECRET` |
| Radio YouTube live lama start | Normal 5–15 detik. Pakai station Icecast kalau mau instan |
| Bot keluar sendiri | Channel kosong >30 detik dan bukan mode radio. Atur `IDLE_LEAVE_SECONDS` |
| Panel bilang server offline | Health endpoint tidak listen. Pastikan `HEALTH_PORT` kosong (pakai `SERVER_PORT`) atau isi port alokasi |

---

## Struktur project

```
index.js / start.js          # entrypoint + bootstrap npm install otomatis
deploy/pterodactyl-egg.json  # egg siap import (nol setup)
src/
├── index.js                 # bootstrap: load command/event, yt-dlp, health, login
├── config.js                # semua env + resolusi path binary
├── health.js                # HTTP health endpoint untuk panel
├── whitelist.js             # lisensi server (env + data/whitelist.json)
├── deploy-commands.js        # deploy manual (opsional, sudah otomatis)
├── loaders.js               # loader command & event
├── commands/                # 18 slash command
├── events/                  # interactionCreate, ready, guildCreate, voiceStateUpdate
├── resolvers/index.js       # query/URL -> Track
├── structures/
│   ├── GuildPlayer.js       # antrian, FFmpeg pipe, filter, radio retry
│   ├── Track.js             # model track + lazy resolve Spotify -> YouTube
│   ├── Spotify.js           # Web API + fallback embed/oEmbed
│   ├── RadioStore.js        # station + sesi 24/7 (JSON)
│   └── MusicClient.js
├── utils/                   # ytdlp(+install), ffmpeg-install, command-sync, store, format, logger, guards, embed
└── data/stations.js         # preset radio

scripts/                     # check, doctor, audio-test, install-ffmpeg, install-ytdlp, postinstall
test/core.test.js            # unit test (node:test)
```

### Alur audio

```
URL/query
   │
   ├─ Spotify ──► metadata (API / embed) ──► cari di YouTube ──┐
   ├─ YouTube/SoundCloud/… ──► yt-dlp --dump-single-json ──────┤
   └─ Stream langsung ─────────────────────────────────────────┤
                                                               ▼
                                     yt-dlp -f bestaudio -o - │ FFmpeg
                                                               ▼
                                         PCM s16le 48kHz stereo → Discord
```

Di-pipe, bukan pakai URL langsung, karena URL `googlevideo` butuh signature + header yang
berubah-ubah. Piping membuat bot tetap jalan walau YouTube mengganti format.

---

## Deploy

- **Pterodactyl / Pelican**: lihat [PTERODACTYL.md](PTERODACTYL.md)
- **Docker**: `docker compose up -d --build`
- **PM2**:
  ```bash
  npm install -g pm2
  pm2 start index.js --name antimusic
  pm2 save && pm2 startup
  ```

---

## Lisensi

MIT — lihat [LICENSE](LICENSE).

Musik dari YouTube/Spotify tunduk pada ToS platform masing-masing.
Gunakan untuk server yang kamu kelola sendiri.
