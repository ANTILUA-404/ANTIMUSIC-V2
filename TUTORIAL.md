# 📘 Tutorial Lengkap — dari nol sampai bot bunyi

Panduan ini ditulis urut. Ikuti dari atas, jangan lompat. Setiap langkah ada
**✅ checkpoint** — kalau hasilnya beda, berhenti di situ dan cek bagian
[Troubleshooting](#9-troubleshooting).

Dua jalur yang bisa kamu pilih:

| Jalur | Butuh | Hasil |
|---|---|---|
| **A. Cepat** (bagian 1 + 3 + 5) | token Discord + panel hosting | bot jalan pakai engine lokal (yt-dlp + FFmpeg) |
| **B. Lengkap** (semua bagian) | + akun Railway | bot jalan pakai Lavalink (kualitas & sumber maksimal) |

Kalau baru pertama kali, **selesaikan jalur A dulu** sampai bot bunyi. Baru
lanjut ke Railway. Lebih gampang debug satu masalah daripada dua.

---

## 0. Yang kamu butuh

- [ ] Akun Discord
- [ ] Server Discord tempat bot dipasang (kamu harus admin di sana)
- [ ] Panel hosting bot — tutorial ini pakai **Pterodactyl** (contoh: anjas.id)
- [ ] Akun GitHub (gratis) — buat clone repo di Railway
- [ ] Akun Railway (kredit trial $5 / ~30 hari) — **opsional**, hanya untuk Lavalink
- [ ] 15–30 menit

Yang **tidak** perlu: Java, Lavalink lokal, VPS, coding.

---

## 1. Bikin bot di Discord Developer Portal

### 1.1 Buat aplikasi

1. Buka <https://discord.com/developers/applications>
2. Klik **New Application** → kasih nama (mis. `ANTIMUSIC`) → **Create**
3. Di tab **General Information**, catat **Application ID** (deretan angka panjang).
   Ini yang nanti jadi `CLIENT_ID`.

### 1.2 Ambil token

1. Tab **Bot** (kiri)
2. Klik **Reset Token** → **Yes, do it!**
3. Klik **Copy**

> ⚠️ Token ini seperti password. Jangan pernah commit ke GitHub, jangan kirim ke
> orang. Kalau bocor, langsung **Reset Token** lagi.

✅ **Checkpoint:** kamu punya 2 hal — `Application ID` dan `Token`.

### 1.3 Jangan centang apa pun di "Privileged Gateway Intents"

Bot ini **tidak butuh** Message Content, Presence, atau Server Members Intent.
Biarkan semuanya OFF. Kalau kamu mencentangnya tanpa alasan, Discord bisa minta
verifikasi bot untuk server besar.

### 1.4 Undang bot ke server

Ganti `CLIENT_ID` di link bawah dengan Application ID kamu, buka di browser:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=3230720&scope=bot%20applications.commands
```

Pilih server → **Authorize**.

Angka `3230720` itu paket izin: View Channel, Send Messages, Embed Links,
Read History, **Connect**, **Speak**.

✅ **Checkpoint:** bot muncul di daftar member server kamu (statusnya offline, wajar).

---

## 2. Deploy Lavalink di Railway

> Lewati bagian ini kalau kamu pilih **jalur A**. Bot tetap jalan tanpa Lavalink.

Lavalink = server audio terpisah. Tugasnya decode audio dan encode Opus, jadi CPU
panel kamu kosong dan kualitasnya bisa diatur sampai `opusEncodingQuality: 10`.

### 2.1 Siapkan repo

Railway butuh akses ke repo GitHub. Kalau repo-nya belum ada di akun kamu:

1. Buka <https://github.com/ANTILUA-404/ANTIMUSIC-V2>
2. Klik **Fork** (kanan atas) → **Create fork**

Sekarang kamu punya salinan di `github.com/USERNAME/ANTIMUSIC-V2`.

> Pakai fork supaya update dari upstream tetap bisa (`git pull`), dan Railway
> bisa deploy ulang tiap kamu push.

### 2.2 Buat project Railway

1. Buka <https://railway.com> → login pakai GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Pilih repo `ANTIMUSIC-V2`
4. Railway mulai build. **Jangan tunggu** — kita harus set folder dulu (langkah 2.3),
   karena build pertama akan gagal (dia baca Dockerfile bot, bukan Lavalink).

### 2.3 Set Root Directory (WAJIB)

1. Klik service yang barusan dibuat
2. Tab **Settings**
3. Cari **Root Directory** → isi: `railway`
4. **Save**

Ini memberi tahu Railway: "Dockerfile Lavalink ada di folder `railway/`, bukan di root repo."

### 2.4 Isi Variables

Tab **Variables** → **New Variable**, tambahkan:

| Name | Value | Wajib? |
|---|---|---|
| `LAVALINK_PASSWORD` | password buatan sendiri, mis. `antimusic-9f3k2` | ✅ |
| `JAVA_MEMORY_MB` | `512` | ✅ |

Catat password-nya — nanti dipakai bot.

Opsional (lihat [bagian 6](#6-setelan-kualitas-audio)):

| Name | Value | Efek |
|---|---|---|
| `OPUS_ENCODING_QUALITY` | `10` | kualitas Opus maksimal (default sudah 10) |
| `RESAMPLING_QUALITY` | `HIGH` | kualitas resampling |
| `SPOTIFY_CLIENT_ID` | — | Spotify resolve langsung (butuh pasangan) |
| `SPOTIFY_CLIENT_SECRET` | — | wajib bareng Client ID |

> ⚠️ **Jangan aktifkan source tanpa kredensial.** Kalau kamu isi
> `SPOTIFY_CLIENT_ID` tapi `SPOTIFY_CLIENT_SECRET` kosong, start script
> otomatis mematikan Spotify (aman). Tapi kalau kamu edit `application.yml`
> manual dan menyalakan source tanpa key, **seluruh Lavalink mati** dengan
> `Deezer master key must be set` / `Spotify client id must be set`.

### 2.5 Deploy ulang

**Deployments** → titik tiga kanan atas → **Redeploy**.

Build pertama ~3–5 menit (unduh JRE + `Lavalink.jar` 96 MB). Log akan berhenti
lama di `Downloading...` — itu normal.

### 2.6 Buka akses publik

1. Tab **Settings** → **Networking**
2. Klik **Generate Domain** (di bagian Public Networking)
3. Copy domain-nya, bentuknya:

```
antimusic-production-a1b2.up.railway.app
```

✅ **Checkpoint:** buka domain itu di browser, tambahkan `/version`.
Harus muncul JSON:

```json
{"semver":"4.2.2","major":4,"minor":2,"patch":2,...}
```

Kalau muncul halaman error Railway → lihat log, biasanya deploy belum selesai.

### 2.7 Cek log sehat

Di tab **Deployments → View Logs**, baris terakhir yang benar kira-kira:

```
 ANTIMUSIC · Lavalink
 port=8080  mem=512m  opusQuality=10     ← port acak dari Railway, wajar
 spotify=false  deezer=false  apple=false
...
Started Launcher in 15.6 seconds
```

Kalau `Started Launcher` muncul, Lavalink siap.

---

## 3. Deploy bot di panel hosting (Pterodactyl / anjas.id)

### 3.1 Upload project

**Cara A — pakai Git (disarankan, update otomatis)**

Buka **Console** panel, jalankan:

```bash
cd /home/container
git clone https://github.com/USERNAME/ANTIMUSIC-V2.git .
```

Titik di akhir penting: artinya "clone ke folder ini".

**Cara B — upload ZIP**

1. Tab **Files** → **Upload** → pilih ZIP project
2. Klik kanan ZIP → **Unzip**
3. Kalau hasilnya jadi `antimusic/antimusic/...`, pindahkan isinya ke root
   (pilih semua di subfolder → **Move** → `/`)

✅ **Checkpoint:** di root `/home/container/` ada `index.js`, `package.json`, dan folder `src/`.

### 3.2 Buat file `.env`

Tab **Files** → **New File** → nama: `.env` → **Create File** → isi:

```env
DISCORD_TOKEN=token_dari_langkah_1
```

Simpan. Itu saja yang wajib.

> **Startup Command tidak perlu diubah.** Kalau field itu di-lock panel, biarkan.
> Repo ini jalan dengan `node index.js`, `node start.js`, maupun `npm start`.

### 3.3 Restart

Klik **Restart** (atau **Start** kalau mati).

**Pertama kali start butuh 1–3 menit**, karena bot mengunduh FFmpeg (±28 MB) dan
yt-dlp (±30 MB) ke folder `bin/`. Sabar.

✅ **Checkpoint — console harus menampilkan urutan ini:**

```
INFO  [main] Konfigurasi: /home/container/.env
[bootstrap] node_modules belum ada — menjalankan npm install...
INFO  [postinstall] FFmpeg: siap (/home/container/bin/ffmpeg)
INFO  [postinstall] yt-dlp: siap (/home/container/bin/yt-dlp)
INFO  [main] 19 command dimuat.
INFO  [loader] 4 event handler terpasang.
INFO  [health] Health server aktif di http://0.0.0.0:xxxxx/health
INFO  [ready] Login sebagai ANTIMUSIC#7110 • 1 server • 19 command
INFO  [commands] 19 slash command didaftarkan → guild 123... (instan)
```

Kalau baris pertama bilang `tidak ada .env`, file-nya belum kebaca — lihat
[Troubleshooting](#9-troubleshooting) baris pertama.

### 3.4 Slash command muncul di Discord

Buka server kamu, ketik `/` di kolom chat. Harusnya muncul `/play`, `/skip`,
`/radio`, dst.

Kalau belum muncul: tunggu 10 detik lalu refresh Discord (**Ctrl+R**).
Kalau tetap tidak ada, lihat log — apakah ada baris `slash command didaftarkan`.

---

## 4. Sambungkan bot ke Lavalink

> Hanya kalau kamu mengerjakan bagian 2.

Buka lagi `.env` di File Manager, tambahkan:

```env
AUDIO_ENGINE=auto
AUDIO_FALLBACK_LOCAL=true

LAVALINK_HOST=antimusic-production-a1b2.up.railway.app
LAVALINK_PORT=443
LAVALINK_PASSWORD=antimusic-9f3k2
LAVALINK_SECURE=true
```

Sesuaikan `LAVALINK_HOST` dengan domain dari langkah 2.6 dan password dari 2.4.

**Restart.** ✅ **Checkpoint:**

```
INFO  [engine:lavalink] node "main" tersambung (antimusic-production-a1b2.up.railway.app:443)
INFO  [engine:lavalink] Lavalink siap: main@antimusic-production-a1b2.up.railway.app:443
INFO  [client] Engine audio aktif: lavalink (main@...:443)
```

Lalu di Discord:

```
/engine status
```

Harus muncul embed dengan `Aktif: lavalink 🟢` dan node `connected`.

---

## 5. Tes di Discord

1. Masuk ke voice channel
2. Ketik `/play` → judul lagu, mis. `lofi hip hop`
3. Pilih satu dari dropdown
4. Bot masuk voice dan memutar

✅ **Checkpoint:** ada suara.

Kalau bot masuk tapi **hening**:

- Cek `/engine status` — kalau `lokal 🔴`, Lavalink belum konek (lihat bagian 4)
- Cek permission **Speak** bot di channel itu
- Jalankan `npm run audio-test` di console panel — kalau gagal, FFmpeg/yt-dlp bermasalah

### Command yang paling sering dipakai

| Command | Fungsi |
|---|---|
| `/play <judul atau URL>` | putar lagu / playlist / link Spotify |
| `/skip`, `/pause`, `/resume`, `/stop` | kontrol dasar |
| `/queue`, `/nowplaying` | lihat antrian & progres |
| `/volume 120` | volume 0–200% |
| `/filter bassboost` | filter (nightcore, vaporwave, 8d, karaoke, treble, soft) |
| `/loop queue`, `/shuffle` | pengulangan & acak |
| `/radio start station:lofi` | radio 24/7 (bot nongkrong terus) |
| `/engine status` | cek engine audio |

---

## 6. Setelan kualitas audio

Ini bagian yang sering disalahpahami. **Plafon kualitas ada di Discord, bukan di
bot:**

| Boost server | Bitrate voice maksimal |
|---|---|
| Tanpa boost | 96 kbps |
| Tier 1 | 128 kbps |
| Tier 2 | 256 kbps |
| Tier 3 | 384 kbps |

**Naikkan dulu bitrate channel** (kalau server kamu boost):
Server Settings → **Voice Channels** → pilih channel → **Bitrate** → geser maksimal.

Setelah itu, dua knob di sisi Lavalink:

```env
OPUS_ENCODING_QUALITY=10    # 0-10, 10 = terbaik
RESAMPLING_QUALITY=HIGH     # LOW / MEDIUM / HIGH / VERY_HIGH
```

Dan sumber audio: `LAVALINK_SEARCH_SOURCE=youtube` memberi audio Opus ~130–160 kbps,
yang **lebih tinggi dari plafon Discord**. Jadi setelah channel dinaikkan, Discord-lah
yang jadi bottleneck, bukan bot.

> Tanpa Lavalink (engine lokal), hasil audionya sama-sama Opus 48 kHz — bedanya
> di stabilitas dan fitur filter, bukan kualitas puncak.

---

## 7. Whitelist lisensi (kalau kamu jual akses)

Default: **mati** (semua server boleh pakai). Untuk mengaktifkan:

```env
WHITELIST_ENABLED=true
WHITELIST_GUILD_IDS=123456789012345678,987654321098765432
OWNER_USERNAME=nama_kamu
OWNER_USER_ID=123456789012345678
WHITELIST_LEAVE_UNAUTHORIZED=true
```

- `WHITELIST_GUILD_IDS` — ID server yang berlisensi (pisah koma). Cara dapat ID:
  Discord → Settings → Advanced → **Developer Mode** ON → klik kanan server → **Copy Server ID**
- `OWNER_USER_ID` — memunculkan tombol **Hubungi Owner** di panel penolakan
- Server yang tidak terdaftar: dapat panel "🔒 Server Belum Berlisensi", lalu
  ditendang otomatis

**Menambah server tanpa restart** — edit `data/whitelist.json` di File Manager:

```json
{
  "guilds": ["123456789012345678", "987654321098765432"]
}
```

File ini dibaca ulang **tiap 30 detik**. Jadi setelah pembayaran masuk, tambah ID,
tunggu setengah menit, bot langsung aktif di server itu.

> Kalau `WHITELIST_ENABLED=true` tapi daftarnya kosong, bot masuk **mode terbuka**
> (semua server boleh) dan menulis warning di console — supaya kamu tidak terkunci
> di instalasi baru.

---

## 8. Update & maintenance

### Kalau deploy pakai Git

```bash
cd /home/container
git pull
```

lalu **Restart**. Kalau `AUTO_UPDATE=1` di egg, restart saja sudah cukup.

### Kalau deploy pakai ZIP

Upload ZIP baru → unzip → timpa file lama. **Jangan hapus:**

- `.env` (token & setelan)
- `data/` (whitelist, sesi radio 24/7, station custom)

### Update yt-dlp (kalau YouTube berubah)

```bash
npm run install:ytdlp -- --force
```

### Update Lavalink / plugin (Railway)

Railway → Variables → ubah `YOUTUBE_PLUGIN_VERSION` (mis. `1.18.2` → versi baru)
→ Redeploy. Daftar versi: <https://github.com/lavalink-devs/youtube-source/releases>

### Cek kesehatan kapan saja

```bash
npm run doctor      # environment lengkap
npm run check       # validasi command & syntax
```

Atau buka `http://IP:PORT/health` (port alokasi panel).

---

## 9. Troubleshooting

### Cara baca console

Cari baris **paling bawah yang berwarna merah** dulu, bukan yang pertama. Lalu
cocokkan dengan tabel di bawah.

| Yang muncul | Arti | Solusi |
|---|---|---|
| `Konfigurasi: tidak ada .env, memakai env panel` | `.env` tidak terbaca | Pastikan nama file benar-benar `.env` (bukan `.env.txt`), letaknya sejajar `index.js`. Windows sering menambah `.txt` |
| `DISCORD_TOKEN kosong` | token tidak ada / salah nama variabel | Cek isi `.env`: `DISCORD_TOKEN=...` tanpa spasi, tanpa tanda kutip |
| `ffmpeg: spawn ... ENOENT` | binary FFmpeg belum ada | Restart (bot unduh sendiri), atau `npm run install:ffmpeg` |
| `npm warn allow-scripts` saat install | npm 11.7+ memblokir install script dependency | **Abaikan.** FFmpeg & yt-dlp diunduh oleh bot, bukan oleh dependency |
| `yt-dlp tidak ditemukan` | binary belum ada | `npm run install:ytdlp` |
| `Gagal connect ke voice channel (timeout)` | izin kurang / channel penuh | Beri izin **Connect** + **Speak** di channel itu |
| `Lavalink tidak bisa dihubungi dalam 20s` | node mati / password beda / port salah | Cek log Railway; pastikan `LAVALINK_PASSWORD` sama persis, `LAVALINK_PORT=443`, `LAVALINK_SECURE=true` |
| `401 Unauthorized` di log Railway | password bot ≠ password Lavalink | Samakan |
| `No Lavalink Node was provided` | REST Lavalink belum siap | Sudah ditangani otomatis (bot menunggu `node.info`). Kalau masih muncul, restart |
| `Deezer master key must be set` | source LavaSrc aktif tanpa kredensial | Jangan edit `application.yml` manual; isi kredensial lewat Variables |
| `Sign in to confirm you're not a bot` | IP server diblokir YouTube | Set `YOUTUBE_OAUTH_ENABLED=true` di Railway lalu ikuti device flow, **atau** pakai `AUDIO_ENGINE=local` |
| `All clients failed to load the item` | sama seperti di atas | Sama seperti di atas |
| `/engine status` bilang `lokal` | Lavalink gagal saat start | Lihat log tepat setelah `Engine audio` — pesan error-nya ada di situ |
| Bot keluar sendiri setelah 60 detik | channel kosong & bukan mode radio | Normal. Ubah `IDLE_LEAVE_SECONDS=0` kalau tidak mau |
| Slash command tidak muncul | belum terdaftar | Cek log `slash command didaftarkan`, lalu Ctrl+R di Discord |
| Audio putus-putus | CPU/RAM kurang atau jaringan | Naikkan `JAVA_MEMORY_MB` (Lavalink) atau pakai engine lokal |

### Cara cepat isolasi masalah

```bash
npm run doctor       # lingkungan: node, ffmpeg, yt-dlp, token, engine
npm run audio-test   # bukti pipeline audio benar-benar keluar PCM (tanpa Discord)
```

Kalau `audio-test` **lolos** tapi Discord hening → masalahnya di voice/izin, bukan audio.
Kalau `audio-test` **gagal** → masalahnya di FFmpeg/yt-dlp/jaringan.

---

## 10. Biaya & batas Railway

| Item | Kenyataan |
|---|---|
| Trial | kredit **$5**, berlaku ~30 hari |
| Pemakaian Lavalink 512 MB 24/7 | kira-kira menghabiskan kredit itu dalam ~30 hari |
| Setelah kredit habis | service berhenti (bukan ditagih otomatis) |
| Dampak ke bot | **tidak mati** — `AUDIO_ENGINE=auto` turun ke engine lokal |

Kalau mau Lavalink permanen tanpa biaya, image yang sama bisa jalan di:

- **Oracle Cloud Always Free** — ARM 4 core / 24 GB, gratis selamanya
- **Fly.io** — free allowance terbatas
- **VPS kecil** Rp 30–50 rb/bulan

Caranya sama, cuma ganti host:

```bash
docker build -t antimusic-lavalink railway/
docker run -d --restart unless-stopped -p 2333:2333 \
  -e LAVALINK_PASSWORD=rahasia -e JAVA_MEMORY_MB=768 \
  --name lavalink antimusic-lavalink
```

Lalu di bot: `LAVALINK_PORT=2333` dan `LAVALINK_SECURE=false`.

---

## 11. Checklist akhir

**Discord**
- [ ] Application ID dicatat
- [ ] Token dicatat & tidak dibagikan
- [ ] Bot sudah diundang dengan izin Connect + Speak
- [ ] Privileged intents dibiarkan OFF

**Railway (kalau pakai Lavalink)**
- [ ] Root Directory = `railway`
- [ ] `LAVALINK_PASSWORD` diisi & dicatat
- [ ] `JAVA_MEMORY_MB=512`
- [ ] Domain publik sudah digenerate
- [ ] `/version` di browser membalas JSON
- [ ] Log berakhir dengan `Started Launcher`

**Panel bot**
- [ ] Project ada di root `/home/container/`
- [ ] `.env` berisi `DISCORD_TOKEN`
- [ ] Console menampilkan `Konfigurasi: /home/container/.env`
- [ ] Console menampilkan `Login sebagai ...`
- [ ] Slash command muncul di Discord
- [ ] `/engine status` hijau (kalau pakai Lavalink)
- [ ] `/play` menghasilkan suara

**Kalau semua tercentang, selesai.** Simpan `.env` di tempat aman — isinya
token dan password Lavalink kamu.

---

Butuh referensi lain? [README.md](README.md) untuk daftar fitur & env lengkap,
[PTERODACTYL.md](PTERODACTYL.md) untuk seluk-beluk panel,
[RAILWAY.md](RAILWAY.md) untuk detail Lavalink.
