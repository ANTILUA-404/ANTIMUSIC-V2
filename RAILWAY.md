# Lavalink di Railway (opsional, untuk kualitas & sumber maksimal)

Bot bisa jalan **tanpa** Lavalink (engine lokal yt-dlp + FFmpeg). Lavalink dipakai kalau kamu mau:

- CPU bot ~0% (decoding + encoding Opus dilakukan server Lavalink)
- filter DSP asli (equalizer, timescale, rotation, karaoke, lowpass)
- `opusEncodingQuality: 10` — kualitas Opus maksimal yang didukung Lavalink
- sumber tambahan lewat plugin (Spotify/Deezer/Apple mirroring)

> **Jujur soal "kualitas terbaik":** plafon kualitas tetap **bitrate voice channel Discord**
> (64 kbps gratis, 128 kbps Tier 2, 256 kbps Tier 3). Lavalink tidak bisa melewati itu.
> Yang Lavalink perbaiki: kestabilan, DSP, dan kualitas encoding di sisi server.
> Kalau server kamu belum boost, naikkan dulu bitrate channel — efeknya lebih terasa
> daripada ganti engine.

---

## 1. Deploy Lavalink ke Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → pilih `ANTIMUSIC-V2`
2. Buka service → **Settings**:
   - **Root Directory** → `railway`
   - Railway otomatis mendeteksi `railway/Dockerfile`
3. Tab **Variables**, isi minimal:

   | Variable | Nilai |
   |---|---|
   | `LAVALINK_PASSWORD` | password bebas, catat baik-baik (dipakai bot) |
   | `JAVA_MEMORY_MB` | `512` (trial) / `768`–`1024` (kalau kuat) |

4. Tab **Settings → Networking** → **Generate Domain**
5. Copy domain-nya, bentuknya `antimusic-production-xxxx.up.railway.app`

Deploy pertama butuh ~1–2 menit: image mengunduh JRE + `Lavalink.jar`, lalu Lavalink
mengunduh plugin YouTube & LavaSrc. Healthcheck `/version` menunggu sampai 300 detik.

Kalau berhasil, log Railway berakhir dengan:

```
Started Launcher in 15.6 seconds
```

---

## 2. Sambungkan bot ke Lavalink

Ada dua jalur. Pilih **salah satu**, jangan dicampur.

### 2a. Private networking (disarankan kalau bot juga di Railway)

Bot dan Lavalink di project yang sama? Lewat jalur internal saja: tanpa TLS,
tanpa kuota egress, dan tidak lewat proxy publik Railway.

```env
AUDIO_ENGINE=auto
AUDIO_FALLBACK_LOCAL=true

LAVALINK_HOST=lavalink.railway.internal   # <nama-service>.railway.internal
LAVALINK_PORT=8080                        # $PORT service Lavalink
LAVALINK_PASSWORD=password-yang-tadi
```

`<nama-service>` = nama service Lavalink di dashboard Railway (bukan nama project).
`LAVALINK_PORT` harus sama dengan `$PORT` service itu — cek tab **Variables**.

### 2b. Domain publik (kalau bot di luar Railway / Pterodactyl)

```env
AUDIO_ENGINE=auto
AUDIO_FALLBACK_LOCAL=true

LAVALINK_HOST=antimusic-production-xxxx.up.railway.app
LAVALINK_PORT=443
LAVALINK_PASSWORD=password-yang-tadi
LAVALINK_SECURE=true
```

> **Skema sekarang ditebak otomatis** dari host: `*.railway.internal` → `http`,
> `*.up.railway.app` → `https:443`. Jadi `LAVALINK_SECURE`/`LAVALINK_PORT` boleh
> dikosongkan; kalau diisi, nilainya tetap menang (kecuali kombinasi yang mustahil,
> mis. domain publik + port 2333 — itu dikoreksi dan diberi warning di log).
>
> `LAVALINK_PORT=2333` **hanya** untuk VPS yang port-nya dibuka langsung
> (`LAVALINK_SECURE=false`). Itu port internal container Railway, tidak terbuka ke luar.

Restart bot. Di console akan muncul:

```
INFO [engine:lavalink] node "main" siap: http://lavalink.railway.internal:8080 (Lavalink 4.2.2)
INFO [engine:lavalink] node "main" tersambung (lavalink.railway.internal:8080)
INFO [engine:lavalink] Lavalink siap: main@lavalink.railway.internal:8080
INFO [client] Engine audio aktif: lavalink (main@lavalink.railway.internal:8080)
```

Cek dari Discord dengan `/engine status`.

---

## 3. Kalau trial habis / node mati

Ini alasan `AUDIO_ENGINE=auto` + `AUDIO_FALLBACK_LOCAL=true` jadi default:

| Kondisi | Yang terjadi |
|---|---|
| Lavalink tidak bisa dihubungi saat start | Bot log error, lalu **otomatis pakai engine lokal**. Semua command tetap jalan |
| Node mati saat bot sedang jalan | `playerDisconnect` → radio retry; track berikutnya gagal → engine tetap Lavalink sampai restart |
| Mau paksa lokal sekarang | Set `AUDIO_ENGINE=local` lalu restart |

Artinya: **Railway mati ≠ bot mati.** Paling buruk kualitas turun ke engine lokal.

---

## 4. Spotify / Deezer di sisi Lavalink (opsional)

Bot sudah bisa memutar link Spotify **tanpa** kredensial apa pun (metadata diambil dari
halaman embed publik, audio dicarikan di YouTube). Kalau kamu isi kredensial di **Railway**,
LavaSrc bisa resolve langsung dengan ISRC matching yang lebih akurat:

```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_COUNTRY_CODE=ID
```

⚠️ **Jangan aktifkan source tanpa kredensial.** LavaSrc melempar exception saat startup
(`Deezer master key must be set`) dan **mematikan seluruh proses Lavalink**, bukan cuma
source itu. Karena itu `railway/start.sh` hanya menulis `spotify: true` kalau
`SPOTIFY_CLIENT_ID` **dan** `SPOTIFY_CLIENT_SECRET` sama-sama terisi.

---

## 5. Tuning

| Variable (Railway) | Default | Efek |
|---|---|---|
| `JAVA_MEMORY_MB` | `512` | Heap JVM. 512 cukup untuk ~5–10 guild aktif |
| `OPUS_ENCODING_QUALITY` | `10` | 0–10, makin tinggi makin bagus (dan makin berat) |
| `RESAMPLING_QUALITY` | `HIGH` | `LOW` / `MEDIUM` / `HIGH` / `VERY_HIGH` |
| `YOUTUBE_PLUGIN_VERSION` | `1.18.2` | Naikkan kalau YouTube berubah |
| `LAVASRC_VERSION` | `4.8.3` | Plugin Spotify/Deezer |
| `YOUTUBE_OAUTH_ENABLED` | `false` | `true` kalau IP Railway diblokir YouTube |
| `YOUTUBE_OAUTH_REFRESH_TOKEN` | — | Token dari OAuth device flow (akun burner) |

Tuning di sisi **bot** (bukan service Lavalink):

| Variable (bot) | Default | Efek |
|---|---|---|
| `LAVALINK_STARTUP_WAIT_MS` | `90000` | Berapa lama bot menunggu `/v4/info` hidup sebelum pindah ke engine lokal. Naikkan kalau deploy pertama Lavalink lambat (unduh plugin) |
| `LAVALINK_CONNECT_TIMEOUT_MS` | `20000` | Batas waktu `manager.init()` + menunggu node connected setelah preflight lolos |
| `LAVALINK_SECURE` / `LAVALINK_PORT` | otomatis | Kosongkan biar ditebak dari host; isi hanya kalau mau memaksa |

Kalau muncul `All clients failed to load the item` / `Video requires login`,
IP Railway kamu kena pembatasan YouTube. Solusi: aktifkan OAuth (akun burner) atau
turunkan ke `AUDIO_ENGINE=local` yang memakai yt-dlp (lebih tahan pemblokiran IP).

---

## 6. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `SyntaxError: Unexpected token 'P', "Proxy erro"... is not valid JSON` | Bot menembak URL yang salah: proxy host yang menjawab, bukan Lavalink. Biasanya `LAVALINK_HOST` internal tapi `secure=true`, atau domain publik dengan `LAVALINK_PORT=2333`. Versi ini sudah menormalkan skema/port otomatis dan melaporkannya sebagai `proxy: ... membalas non-JSON`. Perbaiki host/port sesuai bagian 2 |
| Log `Lavalink belum siap (12s/90s) ...` berulang | Normal saat cold start: bot menunggu `/v4/info` hidup. Kalau mentok sampai timeout, cek detail per node di baris terakhir error |
| Bot: `Lavalink tidak siap dalam 90s` | Node belum siap / password salah / port beda. Cek log Railway, pastikan `LAVALINK_PASSWORD` sama persis dan `LAVALINK_PORT` = `$PORT` service Lavalink |
| `401 Unauthorized` di log Lavalink | Password di bot ≠ password di Railway |
| Railway: healthcheck gagal | Boot pertama lambat (unduh plugin). Tunggu / naikkan `healthcheckTimeout` |
| Railway: `Port already in use` | Seharusnya tidak terjadi — `start.sh` membuang `SERVER_PORT` dan memaksa `-Dserver.port` |
| Lavalink crash saat start | Cek source LavaSrc tanpa kredensial (lihat bagian 4) |
| Audio putus-putus | RAM kurang (`JAVA_MEMORY_MB` naik) atau CPU node lemah |
| `/engine status` bilang `lokal` | `LAVALINK_HOST` kosong atau init gagal — cek console bot |

---

## 7. Alternatif selain Railway

Image yang sama (`railway/Dockerfile`) bisa dipakai di mana saja:

```bash
docker build -t antimusic-lavalink railway/
docker run -d --restart unless-stopped \
  -p 2333:2333 \
  -e LAVALINK_PASSWORD=rahasia \
  -e JAVA_MEMORY_MB=768 \
  --name lavalink antimusic-lavalink
```

Lalu di bot: `LAVALINK_HOST=<ip-vps>`, `LAVALINK_PORT=2333`, `LAVALINK_SECURE=false`.

Pilihan lain yang punya free tier lebih panjang: Oracle Cloud Always Free (ARM 4 core/24 GB),
Fly.io, atau VPS kecil. Semua butuh `LAVALINK_PASSWORD` + port terbuka.
