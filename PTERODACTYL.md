# Deploy ANTIMUSIC v3 di Pterodactyl

Panduan untuk panel Pterodactyl / Pelican / sejenisnya.

**Kabar baiknya:** v3 tidak memakai Lavalink lagi, jadi semua error lama ini hilang:

```
connect ECONNREFUSED 127.0.0.1:2333
Port 2333 is already in use
401 Unauthorized (Lavalink)
SyntaxError: Unexpected token 'P', "Proxy erro"...
```

Tidak ada Java, tidak ada JAR yang diunduh, tidak ada JVM yang dibunuh OS karena kehabisan RAM.

---

## 0. Upgrade dari v2 (Lavalink)

Kalau server panel kamu masih berisi project v2:

**Hapus** (kalau ada):

```
lavalink/               (folder penuh: Lavalink.jar, jre/, application.yml)
```

**Jangan hapus:**

```
.env                    (token & lisensi kamu)
data/                   (whitelist.json, radio.json, station custom)
```

Lalu edit `.env`, hapus/boleh dibiarkan semua baris `LAVALINK_*` (v3 mengabaikannya),
dan pastikan variabel ini ada:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
WHITELIST_ENABLED=true
WHITELIST_GUILD_IDS=123456789012345678
```

**Startup command tetap sama** (`node index.js`), jadi egg tidak perlu diganti.

---

## 1. Spesifikasi server

| Item | Minimum | Disarankan |
| --- | --- | --- |
| RAM | **512 MB** | 1 GB |
| Disk | 500 MB | 1 GB (yt-dlp ±30 MB + cache) |
| Node image | Node.js 20 | Node.js 22 |
| CPU | 1 core | 1–2 core |

Bandingkan dengan v2 yang butuh 1–2 GB hanya untuk JVM + plugin. v3 idle di ±100 MB,
dan naik ke ±200–300 MB saat memutar audio di beberapa server.

---

## 2. Upload file

1. Panel → server → tab **Files**.
2. Upload ZIP project, klik kanan → **Unzip**.
3. Pastikan strukturnya di root container, bukan `antimusic/antimusic/...`:

```
/home/container/
├── index.js
├── start.js
├── package.json
├── .env
├── src/
├── scripts/
├── test/
├── bin/            (yt-dlp otomatis masuk sini)
└── data/
```

Kalau hasil unzip masuk ke subfolder: `mv antimusic/* . && mv antimusic/.* .`

---

## 3. Install dependency

Buka **Console** panel, jalankan:

```bash
npm install
```

Kalau panel membatasi console, pakai tombol **Start** sekali — `index.js` akan gagal
karena `node_modules` belum ada, lalu install manual lewat File Manager → terminal egg.

Setelah itu daftarkan slash command (sekali saja, atau setiap kali command berubah):

```bash
npm run deploy
```

---

## 4. Startup command

Di tab **Startup**:

| Setting | Nilai |
| --- | --- |
| Startup Command | `node index.js` |
| (alternatif) | `node start.js` kalau egg memakai `MAIN_FILE=start.js` |
| Node version | 20 / 22 |

Jangan pakai `npm start` di egg yang membungkus perintah dengan `sh -c` —
kadang signal SIGTERM tidak diteruskan dan panel tidak bisa stop server dengan bersih.

---

## 5. Port & health check

Panel menyuntikkan `SERVER_PORT` (port alokasi) ke container. Bot otomatis membuka
HTTP health endpoint di port itu:

```
GET http://127.0.0.1:SERVER_PORT/health
{"status":"ok","uptime":123,"guilds":2,"players":1,...}
```

- **Jangan isi `HEALTH_PORT`** di `.env` kalau deploy di panel — biarkan kosong supaya
  bot memakai `SERVER_PORT` dari panel.
- Kalau panel bilang server "offline" padahal bot jalan, cek port alokasi sudah dibuat
  di tab **Network** dan tidak bentrok.
- Di VPS tanpa panel, isi `HEALTH_PORT=3000` kalau mau endpoint-nya aktif.

---

## 6. yt-dlp otomatis

Container panel biasanya tidak punya `yt-dlp` dan kamu tidak bisa `apt-get`.
Karena itu bot **mengunduh sendiri** binary-nya ke `bin/yt-dlp` saat start pertama
(`YTDLP_AUTO_INSTALL=true`, default).

Update manual kalau YouTube berubah:

```bash
npm run install:ytdlp -- --force
```

Lalu restart server dari panel.

> Ukuran binary ±30 MB. Pastikan disk tidak penuh, kalau tidak unduhan gagal
> dan bot menolak memutar audio (error jelas di console).

---

## 7. Whitelist lisensi

Dua cara mengelola server yang boleh memakai bot:

**a. `.env`** (paling cepat)

```env
WHITELIST_ENABLED=true
WHITELIST_GUILD_IDS=123456789012345678,987654321098765432
```

**b. `data/whitelist.json`** (bisa diedit dari File Manager, tanpa restart)

```json
{
  "guilds": ["123456789012345678", "987654321098765432"]
}
```

File ini dicek ulang **setiap 30 detik**, jadi setelah pembayaran masuk kamu tinggal
tambah ID server → bot langsung aktif.

Kalau `WHITELIST_ENABLED=true` tapi daftarnya kosong, bot masuk **mode terbuka**
(semua server boleh) dan menulis warning besar di console — supaya kamu tidak terkunci
di instalasi baru.

Server yang tidak terdaftar akan:
1. Menerima panel "🔒 Server Belum Berlisensi" + tombol Hubungi Owner.
2. Otomatis di-kick kalau `WHITELIST_LEAVE_UNAUTHORIZED=true`.
3. Ditolak (ephemeral) setiap kali mencoba memakai slash command.

---

## 8. Cek kesehatan setelah deploy

Di console panel:

```bash
npm run doctor       # node, ffmpeg, yt-dlp, token, spotify, opus
npm run check        # validasi command & syntax
npm run audio-test   # bukti pipeline audio benar-benar keluar PCM
```

`audio-test` butuh ±30 detik dan mengunduh beberapa ratus KB — aman dijalankan di panel.

---

## 9. Masalah yang masih mungkin muncul

| Gejala | Solusi |
|---|---|
| `npm: command not found` | Egg bukan Node.js. Ganti egg ke Node.js 20/22 |
| `Cannot find module 'discord.js'` | `npm install` belum jalan |
| Bot online, command tidak muncul | `npm run deploy` lalu restart |
| `yt-dlp tidak ditemukan` | `npm run install:ytdlp` (cek disk tidak penuh) |
| Audio putus-putus | CPU/RAM kurang, atau jaringan VPS lambat. Coba `LOG_LEVEL=debug` |
| Panel restart terus | Health endpoint gagal bind → pastikan `HEALTH_PORT` kosong |
| `Sign in to confirm you're not a bot` | IP VPS diblokir YouTube → isi `YTDLP_COOKIES` (cookies.txt akun burner) |

---

## 10. Kalau mau balik ke v2

Kode Lavalink masih utuh di tag git:

```bash
git fetch --tags
git checkout v2.3.3-lavalink
```

Jangan lupa `npm install` ulang karena dependency-nya berbeda.
