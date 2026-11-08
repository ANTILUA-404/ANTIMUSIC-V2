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

## 🏠 Kalau kamu pelanggan hosting panel (anjas.id, dsb.)

Banyak penyedia Indonesia — termasuk **anjas.id** (panel `mc.anjas.id`) — menjual
"Discord bot hosting" berbasis Pterodactyl. Di situ kamu **bukan admin panel**, jadi:

- ❌ **tidak bisa** import egg → `deploy/pterodactyl-egg.json` tidak dipakai
- ❌ **tidak bisa** mengubah startup command
- ✅ **bisa** mengisi variabel di tab Startup, upload file, dan membaca console

Kabar baiknya: untuk kasus ini kamu memang tidak butuh egg. Bot mengurus dirinya sendiri.

### Langkahnya

> **Startup Command tidak perlu diubah.** Kalau panel mengunci field itu (umum di
> hosting panel seperti anjas.id), biarkan apa adanya. Repo ini jalan dengan
> `node index.js`, `node start.js`, maupun `npm start` — dan kalau egg-nya tidak
> menjalankan `npm install`, `index.js` menjalankannya sendiri.
>
> Semua konfigurasi lewat **`.env`** di File Manager. Tidak ada yang wajib di tab Startup.

1. **Tab Files** — project harus ada di **root** container, bukan di subfolder:

   ```
   /home/container/index.js
   /home/container/package.json
   /home/container/src/
   ```

   Kalau hasil unzip masuk ke `antimusic/antimusic/...`, pindahkan isinya ke root
   (File Manager: pilih semua isi subfolder → Move → `/`).

2. **Buat `.env`** di root — File Manager → **New File** → nama `.env` → isi:

   ```env
   DISCORD_TOKEN=token_kamu
   ```

   Hanya itu yang wajib. Opsional (semua bisa ditambah nanti):

   ```env
   WHITELIST_ENABLED=true
   WHITELIST_GUILD_IDS=123456789012345678
   AUDIO_ENGINE=auto
   LAVALINK_HOST=xxx.up.railway.app
   ```

   > `.env` selalu dibaca dari **root project**, bukan dari working directory.
   > Jadi tidak masalah kalau panel menjalankan proses dari direktori lain.

3. **Restart.** Console akan menampilkan urutan ini:

   ```
   INFO [main] Konfigurasi: /home/container/.env
   [bootstrap] node_modules belum ada — menjalankan npm install...
   INFO [ffmpeg] FFmpeg siap dipakai: /home/container/bin/ffmpeg
   INFO [yt-dlp] yt-dlp siap dipakai: /home/container/bin/yt-dlp
   INFO [ready] Login sebagai ANTIMUSIC#7110 • 2 server • 19 command
   INFO [commands] 19 slash command didaftarkan → guild 123... (instan)
   ```

   Slash command langsung muncul di Discord — tidak perlu `npm run deploy`.

Kalau baris pertama bilang `Konfigurasi: tidak ada .env`, berarti file-nya belum
terbaca: cek namanya benar-benar `.env` (bukan `.env.txt`) dan letaknya di root,
sejajar `index.js`.

### Catatan khusus panel hosting


| Hal | Penjelasan |
|---|---|
| **Jangan isi `HEALTH_PORT`** | Panel sudah menyuntikkan `SERVER_PORT`; kalau diisi bisa bentrok dan server dianggap mati |
| **Console error `ts-node`** | Egg generik mendeteksi `MAIN_FILE` dengan pola `"*.js"` yang bisa salah. **Tidak perlu diapa-apakan**: repo ini sudah membawa `tsconfig.json` + entrypoint tanpa top-level await, jadi jalur ts-node tetap jalan |
| **Update bot** | Kalau project dari git: `AUTO_UPDATE=1` lalu restart. Kalau upload ZIP: upload ulang, **jangan** hapus `data/` dan `.env` |
| **Kuota disk** | FFmpeg ±28 MB + yt-dlp ±30 MB + `node_modules` ±80 MB |
| **`npm run deploy`** | Tidak perlu — didaftarkan otomatis setiap start |
| **Tidak bisa akses console?** | Tidak masalah, semua otomatis. Kalau perlu paksa install: restart saja, `index.js` menjalankan `npm install` sendiri |

### Kalau panel membatasi waktu start

`npm install` pertama kali butuh ±30–60 detik (belum termasuk unduh FFmpeg + yt-dlp).
Kalau panel mematikan proses karena dianggap hang, jalankan sekali dari console:

```bash
npm install
```

lalu Start lagi. Setelah itu start berikutnya cepat karena semua sudah ada di disk.

---

## ⚡ Cara tercepat: import egg (nol setup)

1. Admin panel → **Nests** → **Import Egg** → pilih file `deploy/pterodactyl-egg.json`
2. **Create Server** dengan egg **ANTIMUSIC v3**
3. Buka tab **Startup** → isi **Discord Bot Token** (satu-satunya yang wajib)
4. Tekan **Start**

Installer akan clone repo, `npm install`, dan mengunduh FFmpeg + yt-dlp.
Setiap restart berikutnya `git pull` otomatis (`AUTO_UPDATE=1`), dependency dan
slash command juga diurus sendiri. **Tidak ada langkah manual lain.**

Egg itu sudah mengisi semua variabel yang biasanya kamu setting manual
(`AUTO_UPDATE`, `AUTO_DEPLOY_COMMANDS`, `DEFAULT_VOLUME`, whitelist, Spotify, dll).

> Sudah punya server dan tidak mau bikin ulang? Langsung ke bagian
> [3](#3-dependency--slash-command-otomatis) — semuanya sekarang otomatis.

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
├── bin/            (ffmpeg + yt-dlp otomatis masuk sini)
└── data/
```

Kalau hasil unzip masuk ke subfolder: `mv antimusic/* . && mv antimusic/.* .`

---

## 3. Dependency & slash command (otomatis)

**Tidak ada yang perlu dijalankan manual.** Cukup tekan **Start**:

| Yang dikerjakan bot | Kapan |
|---|---|
| `npm install` kalau `node_modules` belum ada | sebelum bot dimuat (`index.js`) |
| Unduh FFmpeg + yt-dlp ke `bin/` | `postinstall`, dan diulang saat boot kalau hilang |
| Daftarkan 18 slash command | saat ready, hanya kalau payload berubah |
| Health endpoint di `SERVER_PORT` | saat boot |

Kalau egg kamu **sudah** menjalankan `npm install` di startup command (seperti egg
Node.js standar), itu tidak masalah — hasilnya sama, cuma lebih cepat sedikit.

Kalau ingin memaksa daftar ulang slash command sekarang juga:

```bash
npm run deploy
```

Kalau ingin mematikan otomatisasi daftar command (misal mau kontrol manual):

```env
AUTO_DEPLOY_COMMANDS=false
```

> Slash command didaftarkan **per-guild** (instan, tidak perlu nunggu 1 jam).
> Kalau bot belum ada di server mana pun, baru dipakai pendaftaran global.

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

Egg bawaan repo (`deploy/pterodactyl-egg.json`) sudah memakai perintah ini plus
`git pull` otomatis dan `npm install`:

```bash
if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; \
if [[ -f /home/container/package.json ]]; then npm install --no-audit --no-fund; fi; \
node /home/container/index.js
```

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

## 6. FFmpeg & yt-dlp otomatis

Container panel biasanya tidak punya `ffmpeg` maupun `yt-dlp`, dan kamu tidak bisa `apt-get`.
Karena itu bot **mengunduh sendiri** kedua binary ke `bin/`:

| Binary | Ukuran | Dipakai untuk |
|---|---|---|
| `bin/ffmpeg` | ±28 MB | decode audio ke PCM 48kHz |
| `bin/yt-dlp` | ±30 MB | ambil stream dari YouTube/SoundCloud/dll |

Urutan pencarian: `FFMPEG_PATH`/`YTDLP_PATH` di `.env` → `bin/` → `PATH`.
Unduhan terjadi otomatis saat `npm install` (postinstall) dan diulang saat bot start
kalau binary-nya belum ada.

### Kalau console menampilkan `ffmpeg: spawn ... ENOENT`

Itu artinya binary FFmpeg belum ada. Penyebab paling umum: **npm 11.7+ memblokir
lifecycle script dependency** dan menulis begini saat install:

```
npm warn allow-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   ffmpeg-static@5.3.0 (install: node install.js)
```

Versi ini **tidak lagi bergantung** pada install script itu (dependency `ffmpeg-static`
sudah dihapus), jadi cukup:

```bash
npm run install:ffmpeg
npm run install:ytdlp
```

lalu restart server. Atau langsung restart saja — bot akan mengunduh sendiri saat boot.

Kalau kamu masih memakai versi lama yang punya `ffmpeg-static`, perbaikannya:

```bash
npm rebuild ffmpeg-static        # jalankan ulang install script-nya
# atau
npm approve-scripts ffmpeg-static
```

Update manual kalau YouTube berubah:

```bash
npm run install:ytdlp -- --force
npm run install:ffmpeg -- --force
```

> Pastikan disk tidak penuh, kalau tidak unduhan gagal dan bot menolak memutar audio
> (error-nya jelas di console).

---

### Lavalink opsional

Kalau kamu menjalankan Lavalink di Railway/VPS, isi di tab Startup:

\`\`\`env
AUDIO_ENGINE=auto
AUDIO_FALLBACK_LOCAL=true
LAVALINK_HOST=xxx.up.railway.app
LAVALINK_PORT=443
LAVALINK_PASSWORD=rahasia
LAVALINK_SECURE=true
\`\`\`

Panduan lengkap: **[RAILWAY.md](RAILWAY.md)**.
Kalau Lavalink mati, bot otomatis kembali ke engine lokal — tidak perlu ubah apa pun.

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
| `ffmpeg ... ENOENT` | `npm run install:ffmpeg`, lalu restart |
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
