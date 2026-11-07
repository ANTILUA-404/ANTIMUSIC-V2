# Deploy ANTIMUSIC di Pterodactyl

Panduan ini ditulis untuk panel Pterodactyl / Pelican / sejenisnya, termasuk penyebab
error yang dulu muncul di console:

```
connect ECONNREFUSED 127.0.0.1:2333
Lavalink node disconnected. Checking failover candidates...
SyntaxError: Unexpected token 'P', "Proxy erro"... is not valid JSON
```

---

## 0. Upgrade dari versi lama (WAJIB dibaca)

Kalau server kamu masih berisi project versi lama, **hapus file lama** dulu, kalau tidak
egg bisa tetap menjalankan kode lama:

Hapus (kalau ada):

```
dist/
tsconfig.json
index.ts
start.ts
src/*.ts          (semua file .ts di dalam src)
run-lavalink.bat
```

**Jangan hapus:** `.env`, folder `data/`, `lavalink/Lavalink.jar`, `lavalink/jre/`
(supaya tidak unduh ulang), dan `lavalink/application.yml` (akan ditulis ulang otomatis).

Lalu pastikan **Startup Command** memakai Node, bukan ts-node (lihat bagian 4).

---

## 1. Spesifikasi server yang disarankan

| Item | Minimum | Disarankan |
| --- | --- | --- |
| RAM | 1 GB | 1.5–2 GB |
| Disk | 2 GB | 3 GB (JAR 96 MB + JRE 45 MB + log) |
| Node image | Node.js 20 / 22 | Node.js 22 |
| CPU | 1 core | 2 core |

> Lavalink (Java) dan bot (Node) jalan dalam **satu** container. Kalau RAM cuma 512 MB,
> JVM akan dibunuh OS dan Lavalink mati tepat setelah start.

---

## 2. Upload file

1. Panel → server → tab **Files**.
2. Upload ZIP project, klik kanan → **Unzip**.
3. Pastikan struktur akhirnya seperti ini (bukan `antimusic/antimusic/...`):

```
/home/container/
├── index.js
├── package.json
├── .env
├── src/
├── lavalink/
├── scripts/
└── data/
```

Kalau hasil unzip ada di dalam subfolder, pindahkan isinya ke root
(`mv antimusic/* .` lalu `mv antimusic/.* .`).

---

## 3. Isi `.env`

Buka file `.env` di file manager panel, isi dua baris ini:

```env
DISCORD_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLIENT_ID=123456789012345678
```

Cara dapat:

* **DISCORD_TOKEN** → [Discord Developer Portal](https://discord.com/developers/applications)
  → pilih aplikasi → **Bot** → **Reset Token** → Copy.
* **CLIENT_ID** → tab **General Information** → **Application ID**.

Opsional tapi disarankan saat testing:

```env
GUILD_ID=id_server_kamu
```

Slash command jadi langsung muncul (tanpa `GUILD_ID` butuh ±1 jam untuk global).

**Jangan** menambahkan spasi atau enter di belakang token.

---

## 4. Startup command

Di tab **Startup**, ganti command menjadi:

```bash
npm install --omit=dev && node index.js
```

Egg bawaan sering memakai pola seperti ini:

```bash
if [[ "${MAIN_FILE}" == "*.js" ]]; then node ...; else ts-node --esm ...; fi
```

Pola itu **salah**: `"${MAIN_FILE}" == "*.js"` membandingkan string secara literal
(bukan glob), jadi hasilnya selalu `false` dan bot dijalankan lewat `ts-node`.
Project ini tidak butuh TypeScript sama sekali, jadi pakai command di atas.

Kalau egg punya variabel `MAIN_FILE`, isi dengan `index.js` dan pastikan
command-nya memakai `node index.js`.

---

## 5. Allocation / port

* Port utama server (allocation) dipakai untuk endpoint `/health`.
  Bot otomatis memakai variabel `SERVER_PORT` dari panel.
* Port **2333** hanya dipakai internal (localhost) dan **tidak perlu** dialokasikan.

Kalau panel memaksa `SERVER_PORT` dan kamu ingin health check di port lain:

```env
HEALTH_PORT=3000
```

> Inilah akar masalah versi lama: `SERVER_PORT` dari panel menimpa `server.port`
> Lavalink, sehingga Lavalink listen di port alokasi panel, bukan 2333. Versi ini
> memaksa `-Dserver.port=2333` dan membuang `SERVER_PORT` dari environment Java.

---

## 6. Start pertama (sabar)

Urutan log yang normal:

```
[ANTIMUSIC] Memulai ANTIMUSIC
[lavalink]  Mengunduh Lavalink.jar v4.2.2...          <- sekali saja, ±96 MB
[lavalink]  Java belum tersedia, mengunduh Portable OpenJDK 17...   <- sekali saja
[lavalink]  Menjalankan server Lavalink lokal...
[lavalink]  Menunggu Lavalink siap... (15s, 30s, ...)
[lavalink]  HTTP Lavalink aktif
[lavalink]  Server Lavalink lokal siap menerima koneksi
[ANTIMUSIC] Health server online (/health)
[ANTIMUSIC] ANTIMUSIC online
[ANTIMUSIC] Slash commands terdaftar
```

Durasi normal: **1–3 menit** pada start pertama (unduh JAR + JRE + plugin YouTube).
Start berikutnya: **20–40 detik**.

Kalau lebih dari 5 menit belum siap, lihat `lavalink/lavalink.log`.

---

## 7. Cara pakai cepat

```
?play lofi hip hop
?24/7 on lofi hip hop     <- mode radio: autoplay selamanya, tidak keluar VC
?24/7 status
?24/7 off
```

Di Discord, `/radio` adalah versi slash command-nya (Discord tidak mengizinkan
karakter `/` di nama slash command).

---

## 7b. Mengelola lisensi server (whitelist)

Bot hanya melayani server yang terdaftar. Server lain yang mengetik command akan
mendapat panel "Server Belum Berlisensi" berisi nama owner (`xelzlovecean_33932`).

**Cara menambah server yang sudah bayar (tanpa restart):**

1. Panel → tab **Files** → buka `data/whitelist.json`.
2. Tambahkan ID server ke array:

   ```json
   {
     "guilds": [
       "123456789012345678",
       "987654321098765432"
     ]
   }
   ```

3. Simpan. Bot memuat ulang otomatis dalam **≤30 detik**.
   Kalau ingin langsung, restart server.

**Alternatif permanen lewat `.env`:**

```env
WHITELIST_ENABLED=true
WHITELIST_GUILD_IDS=123456789012345678,987654321098765432
OWNER_USERNAME=xelzlovecean_33932
OWNER_USER_ID=              # opsional -> tombol "Hubungi Owner"
```

Cara dapat Server ID: Discord → Settings → Advanced → **Developer Mode** ON →
klik kanan nama server → **Copy Server ID**.

Catatan:

* `WHITELIST_GUILD_IDS` kosong **dan** `data/whitelist.json` kosong → bot masuk
  mode terbuka (semua server boleh) + warning di console. Isi salah satunya.
* Server tak berlisensi yang mengundang bot akan dikirimi panel lalu
  **otomatis ditendang** (`WHITELIST_LEAVE_UNAUTHORIZED=true`).
* Cek status lisensi di `https://<host>:<port>/health` → field `whitelist`.

---

## 8. Diagnosa

Jalankan dari panel **Console** (server boleh berhenti):

```bash
npm run doctor
```

Yang dicek: versi Node, isi `.env`, validitas token ke Discord, Java, `Lavalink.jar`,
port 2333, password, dan node cadangan.

Cek manual Lavalink:

```bash
curl -H "Authorization: antimusic-super-secret" http://127.0.0.1:2333/version
# harus balas: 4.2.2
```

---

## 9. Error yang sering muncul

| Log | Arti | Solusi |
| --- | --- | --- |
| `connect ECONNREFUSED 127.0.0.1:2333` | Lavalink belum/tidak listen di 2333 | Pastikan pakai versi ini (sudah memaksa port). Cek `lavalink/lavalink.log`. |
| `Web server failed to start. Port xxxxx already in use` | Port bentrok | Ganti `LAVALINK_PORT`, atau matikan Lavalink lain. |
| `401 Unauthorized` dari Lavalink | Password beda | Set `LAVALINK_MANAGE_CONFIG=true`, restart → `application.yml` ditulis ulang dari `.env`. |
| `Java belum tersedia...` lalu gagal | Unduhan JRE gagal | Coba restart (unduhan diulang otomatis 3×), atau set `LAVALINK_JAVA_BIN`. |
| `Lavalink.jar tidak lengkap` | Unduhan terputus | Hapus `lavalink/Lavalink.jar`, restart. |
| `This video requires login` | YouTube membatasi IP server | Pakai `?play sc:<judul>`, atau aktifkan OAuth (bagian 10). |
| Bot online tapi `?play` bilang server audio offline | Node belum connect | Tunggu 15–30 detik, cek `?nodes`. |
| Radio berhenti sendiri | Node kena rate limit | Bot retry otomatis (maks 2 menit). Cek `?24/7 status`. |

---

## 10. YouTube diblokir (kasus paling umum di Pterodactyl)

YouTube memblokir hampir semua IP datacenter. Gejalanya di log:

```
Client [ANDROID_VR] failed: This video requires login.
Client [WEB] failed: No supported audio streams available
Client [MWEB] failed: Must find sig function from script
(yts.version: 1.18.2) All clients failed to load the item.
```

Sejak v2.2 bot **tidak lagi diam**:

* Lagu yang gagal diputar otomatis diganti versi **SoundCloud**-nya (sekali per lagu,
  jadi tidak ada loop seperti versi sebelumnya).
* Setelah 3 kegagalan beruntun, pencarian diarahkan ke SoundCloud dulu selama 10 menit.
* Semua stack trace YouTube masuk ke `lavalink/lavalink.log`, **bukan** ke console panel.

### Solusi permanen: OAuth YouTube (gratis, paling efektif)

1. Edit `.env`:

   ```env
   YOUTUBE_OAUTH_ENABLED=true
   YOUTUBE_OAUTH_REFRESH_TOKEN=
   ```

2. Restart. Buka `lavalink/lavalink.log` (tab Files) atau console, cari baris:

   ```
   OAUTH INTEGRATION: go to https://www.google.com/device and enter code XXX-XXX-XXX
   ```

3. Buka link tersebut, masukkan kode, login pakai **akun burner** (jangan akun utama).
4. Setelah berhasil, log menampilkan refresh token (`1//0g...`). Copy ke `.env`:

   ```env
   YOUTUBE_OAUTH_REFRESH_TOKEN=1//0g...
   ```

5. Restart sekali lagi. Sekarang YouTube diakses sebagai user biasa.

> Kalau tidak ingin OAuth, biarkan `YOUTUBE_OAUTH_ENABLED=false`. Bot tetap jalan
> lewat SoundCloud, hanya saja kualitas/kelengkapan katalog YouTube berkurang.

### Alternatif lain

| Metode | Env | Kapan dipakai |
| --- | --- | --- |
| poToken | `YOUTUBE_PO_TOKEN`, `YOUTUBE_VISITOR_DATA` | tanpa login, untuk client WEB/WEBEMBEDDED |
| Remote cipher | `YOUTUBE_REMOTE_CIPHER_URL`, `YOUTUBE_REMOTE_CIPHER_PASSWORD` | error `must find sig function` |
| Lavalink eksternal | `LAVALINK_EMBEDDED=false` + `LAVALINK_HOST` | punya VPS/IP residential lain |

### Cek log Lavalink

Semua output Java ada di **`lavalink/lavalink.log`** (rotasi otomatis 8 MB).
Console panel hanya menampilkan log bot, jadi tidak lagi kebanjiran stack trace.

```bash
tail -n 100 lavalink/lavalink.log
grep -i "error\|failed" lavalink/lavalink.log | tail -20
```

---

## 10b. Spotify / Apple Music / Deezer

Link lagu dari ketiga layanan **sudah bisa diputar tanpa setting apa pun** — bot
mengambil judul + artis dari halaman publik lalu mencarikannya di SoundCloud/YouTube.

Untuk dukungan penuh (album, playlist, pencarian `sp:`/`am:`), isi `.env`:

```env
# Spotify - gratis, buat app di https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_COUNTRY_CODE=ID

# Apple Music - harus token JWT (3 bagian dipisah titik)
APPLE_MUSIC_MEDIA_API_TOKEN=
APPLE_MUSIC_COUNTRY_CODE=ID
```

Setelah restart, cek di console:

```
 INFO  Sumber musik aktif soundcloud, bandcamp, spotify, youtube, http
```

Kalau `spotify` tidak muncul, kredensialnya belum terbaca.

> **Penting:** token Apple yang formatnya salah membuat plugin gagal load dan
> Lavalink mati total. v2.3 memvalidasi token sebelum dipakai — kalau tidak valid,
> source Apple dimatikan otomatis dan bot tetap jalan.

**Urutan sumber audio** untuk lagu Spotify/Apple:

```env
LAVASRC_PROVIDERS=scsearch:%QUERY%,ytsearch:%QUERY%,ytsearch:"%ISRC%"
```

Default menaruh SoundCloud dulu (aman untuk IP yang diblokir YouTube).

---

## 11. Update project

1. Stop server.
2. Backup `.env` dan folder `data/`.
3. Upload ZIP baru, extract, timpa file lama ( **kecuali** `.env` dan `data/`).
4. Start.

`lavalink/Lavalink.jar`, `lavalink/jre/`, dan `lavalink/application.yml` akan dipakai
ulang, jadi tidak perlu unduh lagi.

---

## 12. Catatan keamanan

* Jangan pernah commit `.env` (sudah masuk `.gitignore`).
* `LAVALINK_PASSWORD` sebaiknya diganti, walaupun port 2333 tidak diekspos ke publik.
* `LAVALINK_ENABLE_FALLBACKS=false` (default) berarti query pencarian **tidak** dikirim
  ke server Lavalink milik orang lain.
