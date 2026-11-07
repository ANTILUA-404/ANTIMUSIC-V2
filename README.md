# ANTIMUSIC v2

Discord music bot bertenaga **Discord.js 14 + Lavalink v4**, dengan **Lavalink embedded**
(bot menyalakan & mengawasi sendiri), auto-failover node, dan **mode 24/7 (radio)**.

Dirancang untuk jalan mulus di **Pterodactyl / hosting panel** tanpa perlu VPS Lavalink terpisah.

---

## Kenapa versi ini beda?

Versi sebelumnya mati di `ECONNREFUSED 127.0.0.1:2333` walaupun log Lavalink bilang
`Lavalink is ready to accept connections`. Penyebabnya bukan bug Lavalink, tapi **variabel
lingkungan panel**:

> Pterodactyl menyuntikkan `SERVER_PORT` (port alokasi server) ke dalam container.
> Spring Boot membaca `SERVER_PORT` sebagai `server.port` dan **menimpanya** di atas
> `application.yml`. Jadi Lavalink diam-diam listen di port alokasi panel, bukan 2333,
> sementara bot terus menembak 2333 → `ECONNREFUSED` selamanya.

Sudah diverifikasi:

| Perintah | Port yang dipakai Lavalink |
| --- | --- |
| `java -jar Lavalink.jar` (dengan `SERVER_PORT=45678`) | **45678** ❌ |
| `java -Dserver.port=2333 -jar Lavalink.jar` | **2333** ✅ |

Perbaikan di v2:

* `-Dserver.port` + `--server.port` dipaksa saat spawn, dan `SERVER_PORT` /
  `SERVER_PORT_LOCAL` / `PORT` dibuang dari environment proses Java.
* `lavalink/application.yml` **di-generate ulang setiap start** dari `.env`, jadi password
  dan port tidak mungkin beda lagi (penyebab `401 Unauthorized`).
* OAuth YouTube dimatikan secara default (dulu `enabled: true` + refresh token kosong →
  plugin minta device code dan polling terus-menerus membanjiri log).
* Watchdog: proses Lavalink dicek tiap 10 detik, auto-restart dengan backoff kalau mati.
* Node publik pihak ketiga **off by default** → tidak ada lagi spam
  `SyntaxError: Unexpected token 'P', "Proxy erro"...` dan `Unhandled rejection`.
* Reconnect node dibatasi (12 percobaan) → tidak ada lagi log tiap 5 detik.
* Satu pesan *Now Playing* yang di-edit, bukan pesan baru tiap lagu.

---

## Fitur

* **Mode 24/7 / radio** — autoplay tanpa henti, tidak pernah keluar voice channel,
  auto-reconnect, dan otomatis pulih setelah bot restart.
* **Spotify / Apple Music / Deezer** — link lagu, album, dan playlist didukung.
  Tanpa kredensial pun link lagu tetap bisa diputar (metadata diambil dari halaman
  publik, audio dicari di SoundCloud/YouTube).
* **Anti-blokir YouTube** — kalau YouTube menolak memutar dari IP server, bot otomatis
  mengalihkan lagu ke versi SoundCloud dan mengarahkan pencarian berikutnya ke
  SoundCloud selama 10 menit (tidak ada lagi loop "All clients failed").
* **Console bersih** — seluruh output Lavalink (termasuk stack trace plugin YouTube)
  ditulis ke `lavalink/lavalink.log`, bukan membanjiri panel.
* Embedded Lavalink: unduh JAR + JRE portabel otomatis, health check, auto-restart.
* Multi-node failover (opsional) + `?nodes` / `?changenode`.
* Slash command **dan** prefix command.
* Queue, loop, shuffle, seek, volume 0–200, autoplay pintar.
* Ultra HD audio engine (EQ profil + auto bitrate voice channel).
* State per-server persisten (`data/state.json`).
* Health endpoint `/health` untuk monitoring panel.
* `npm run doctor` untuk diagnosa cepat saat bot tidak mau bunyi.

---

## Quick start (Pterodactyl)
1. Upload seluruh isi folder ini ke server (tab **Files**), lalu extract.
2. Buka `.env`, isi minimal:

   ```env
   DISCORD_TOKEN=token_bot_kamu
   CLIENT_ID=application_id_bot
   ```

3. Pastikan **Startup Command** egg seperti ini (bukan `ts-node`):

   ```bash
   npm install --omit=dev && node index.js
   ```

4. Start server. Pertama kali jalan bot akan mengunduh `Lavalink.jar` (±96 MB) dan
   OpenJDK 17 portabel (±40 MB). Sabar 1–3 menit, progress terlihat di console.
5. Setelah muncul `Server Lavalink lokal siap menerima koneksi` dan
   `ANTIMUSIC online`, coba `?play` di Discord.

Panduan lengkap + troubleshooting: **[PTERODACTYL.md](PTERODACTYL.md)**.

### Butuh Lavalink terpisah?

**Tidak.** Bot menyalakan & mengawasi Lavalink sendiri di container yang sama, jadi
cukup satu server Pterodactyl. Kalau RAM panel terbatas atau kamu ingin memisahkan
Lavalink ke VPS lain, baca **[docs/HOSTING.md](docs/HOSTING.md)**.

> ⚠️ Lavalink **tidak bisa** dijalankan di Vercel/Netlify/Cloudflare — butuh proses Java
> persisten + UDP. Penjelasan lengkap ada di dokumen di atas.

### Test

```bash
npm test
```

17 test inti (parser link, deteksi error YouTube, circuit breaker, generator config)
jalan tanpa perlu token, Discord, atau Lavalink. Cocok juga untuk CI.

---

## Menjalankan di PC / VPS

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
# isi DISCORD_TOKEN & CLIENT_ID
npm start
```

Butuh **Node.js 20+**. Java 17+ opsional — kalau tidak ada, bot mengunduh OpenJDK
portabel otomatis (Linux). Di Windows, install Java 17+ atau set `LAVALINK_JAVA_BIN`.

Cek dulu tanpa start bot:

```bash
npm run doctor
```

---

## Mode 24/7 (radio)

| Perintah | Fungsi |
| --- | --- |
| `?24/7` | nyalakan / matikan (toggle) |
| `?24/7 on` | nyalakan |
| `?24/7 on lofi hip hop` | nyalakan dengan seed tertentu |
| `?24/7 off` | matikan |
| `?24/7 status` | lihat status radio |
| `/radio` | versi slash command (`enabled`, `seed`) |

Saat aktif:

* Autoplay dipaksa ON dan antrean **selalu** diisi ulang dari YouTube Mix / related
  search; kalau semua sumber gagal, bot mencoba lagi terus dengan backoff (maks 2 menit).
* `checkEmptyChannel` di-skip → bot **tidak keluar** walau voice channel kosong.
* Kalau koneksi voice putus / bot dipindah / bot restart, bot menyambung ulang sendiri
  dan melanjutkan radio (channel terakhir disimpan di `data/state.json`).
* Tombol 📻 di pesan Now Playing juga bisa dipakai toggle.

> Catatan: Discord **tidak mengizinkan** karakter `/` di nama slash command, jadi versi
> slash-nya bernama `/radio`. Prefix `?24/7` tetap bisa diketik persis seperti itu.

Matikan kapan saja dengan `?24/7 off`, `?stop`, atau `?leave`.

---

## Lisensi / whitelist server

Bot hanya mau melayani server yang terdaftar. Server lain yang mencoba memakai
command akan mendapat panel:

> 🔒 **Server Belum Berlisensi**
> Server **Nama Server** belum terdaftar di whitelist **ANTIMUSIC**.
> Untuk membeli izin pemakaian bot, silakan hubungi owner:
> 👑 **xelzlovecean_33932**
> Status Lisensi: ❌ Tidak aktif · Server ID: `...` · Owner Bot: `xelzlovecean_33932`

Daftar server bisa diisi dari dua tempat (digabung):

1. **`.env`**

   ```env
   WHITELIST_ENABLED=true
   WHITELIST_GUILD_IDS=123456789012345678,987654321098765432
   OWNER_USERNAME=xelzlovecean_33932
   OWNER_USER_ID=          # opsional, memunculkan tombol "Hubungi Owner"
   ```

2. **`data/whitelist.json`** (bisa diedit dari file manager panel, **tanpa restart**)

   ```json
   {
     "guilds": ["123456789012345678"]
   }
   ```

   File ini otomatis dibuat saat pertama kali bot jalan. Perubahan terbaca
   maksimal 30 detik kemudian.

Cara mendapatkan Server ID: Discord → Settings → Advanced → **Developer Mode** ON →
klik kanan nama server → **Copy Server ID**.

Perilaku tambahan:

* Server tak berlisensi yang mengundang bot akan **otomatis dikirimi panel lalu
  ditinggalkan** (`WHITELIST_LEAVE_UNAUTHORIZED=true`).
* Kalau daftar masih kosong, bot masuk **mode terbuka** (semua server diizinkan)
  dan menulis peringatan besar di console — supaya kamu tidak terkunci sendiri.
* `WHITELIST_ENABLED=false` mematikan sistem lisensi sepenuhnya.

---

## Perintah

Prefix default `?`. Semua juga tersedia sebagai slash command.

```text
?play <judul/link>     ?skip            ?stop
?pause                 ?resume          ?queue / ?q
?np                    ?volume <0-200>  ?seek <detik|mm:ss>
?shuffle               ?clear           ?remove <n>
?loop off|track|queue  ?autoplay on|off ?24/7 [on|off|status] [seed]
?hd studio|bass|vocal|off              ?nodes
?changenode <nomor/nama>               ?ping
?leave                 ?help
```

---

## Konfigurasi penting (.env)

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | **wajib** |
| `CLIENT_ID` | — | **wajib**, Application ID |
| `GUILD_ID` | kosong | isi saat testing agar slash command instan |
| `PREFIX` | `?` | prefix command teks |
| `DEFAULT_VOLUME` | `70` | 0–200 |
| `IDLE_DESTROY_MS` | `15000` | keluar setelah antrean habis; `0` = standby |
| `EMPTY_CHANNEL_LEAVE_MS` | `30000` | keluar saat VC kosong; `0` = tidak pernah |
| `HEALTH_PORT` | `SERVER_PORT` / `3000` | port endpoint `/health` |
| `LAVALINK_EMBEDDED` | `true` | bot jalankan Lavalink sendiri |
| `LAVALINK_PORT` | `2333` | port internal Lavalink |
| `LAVALINK_PASSWORD` | `antimusic-super-secret` | disinkronkan otomatis ke `application.yml` |
| `LAVALINK_MEMORY_MB` | otomatis | RAM JVM; default ±45% `SERVER_MEMORY` |
| `LAVALINK_STARTUP_TIMEOUT_MS` | `240000` | tunggu Lavalink siap |
| `LAVALINK_ENABLE_FALLBACKS` | `false` | pakai node publik pihak ketiga |
| `LAVALINK_FALLBACKS` | kosong | JSON array node cadangan sendiri |
| `RADIO_RESTORE_ON_BOOT` | `true` | pulihkan radio setelah restart |
| `RADIO_DEFAULT_SEED` | `lofi hip hop mix` | seed awal radio |
| `WHITELIST_ENABLED` | `true` | aktifkan sistem lisensi server |
| `WHITELIST_GUILD_IDS` | kosong | ID server yang boleh memakai bot |
| `OWNER_USERNAME` | `xelzlovecean_33932` | nama owner di panel penolakan |
| `OWNER_USER_ID` | kosong | memunculkan tombol "Hubungi Owner" |
| `WHITELIST_LEAVE_UNAUTHORIZED` | `true` | keluar dari server tanpa lisensi |
| `LOG_LEVEL` | `info` | `debug` untuk diagnosa |

Daftar lengkap ada di `.env.example`.

---

## Struktur

```text
index.js                     entry point (node index.js)
src/
  index.js                   bootstrap Discord, health server, shutdown
  config.js                  parser + validasi .env
  logger.js                  logger ringkas (bisa JSON)
  state.js                   state per-server (data/state.json)
  whitelist.js               lisensi server + panel penolakan
  commands.js                definisi slash command
  audio-hd.js                EQ & bitrate
  lavalink/
    supervisor.js            spawn/watchdog/restart Lavalink.jar
    config-writer.js         generate application.yml dari .env
    nodes.js                 daftar node + kebijakan retry
  music/
    service.js               player, queue, command, failover
    radio.js                 engine mode 24/7
    links.js                 resolver Spotify / Apple Music / Deezer
test/core.test.js            17 unit test (npm test)
scripts/doctor.js            diagnosa mandiri
docs/HOSTING.md              Lavalink: mana yang bisa, mana yang tidak
data/state.json              preferensi server (dibuat otomatis)
lavalink/                    Lavalink.jar, JRE, application.yml, log
```

---

## Troubleshooting singkat

| Gejala | Penyebab & solusi |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:2333` | v2 sudah memperbaikinya. Kalau masih muncul, cek `?nodes` dan log `lavalink/lavalink.log`. |
| `401 Unauthorized` | Password beda. Set `LAVALINK_MANAGE_CONFIG=true` lalu restart (file di-generate ulang). |
| `Port 2333 is already in use` | Ada Lavalink lain di server. Matikan, atau ganti `LAVALINK_PORT`. |
| Bot online tapi perintah bilang "server audio offline" | Lavalink masih start (1–3 menit pertama) atau JAR/JRE gagal diunduh. Cek log. |
| `All clients failed to load the item` / `This video requires login` | **YouTube memblokir IP server.** Bot otomatis pindah ke SoundCloud. Solusi permanen: aktifkan OAuth (lihat di bawah). |
| `must find sig function from script` | Cipher YouTube berubah. Pakai `TVHTML5_SIMPLY` (default v2.2) atau remote cipher server. |
| Radio diam setelah beberapa lagu | Cek `?24/7 status`; kalau buffer 0, node sedang rate-limited. Bot akan retry otomatis. |

---

## YouTube diblokir? (paling sering terjadi di VPS/Pterodactyl)

YouTube makin agresif memblokir IP datacenter. Gejalanya di log:

```
Client [ANDROID_VR] failed: This video requires login.
Client [WEB] failed: No supported audio streams available
Client [MWEB] failed: Must find sig function from script
(yts.version: 1.18.2) All clients failed to load the item.
```

Yang **sudah otomatis** dilakukan bot:

1. Lagu yang gagal diputar dicarikan versi **SoundCloud**-nya, lalu diputar
   (sekali per lagu, tidak ada loop).
2. Setelah 3 kegagalan beruntun, pencarian diarahkan ke SoundCloud dulu selama
   10 menit, jadi `?play` tetap menghasilkan lagu.
3. Semua detail error masuk ke `lavalink/lavalink.log`, bukan console panel.

Solusi **permanen** (pilih salah satu):

### A. OAuth YouTube (paling efektif, gratis)

```env
YOUTUBE_OAUTH_ENABLED=true
YOUTUBE_OAUTH_REFRESH_TOKEN=
```

1. Restart bot.
2. Di console muncul:

   ```
   OAUTH INTEGRATION: go to https://www.google.com/device and enter code XXX-XXX-XXX
   ```

3. Buka link, masukkan kode, login pakai **akun burner** (jangan akun utama).
4. Setelah selesai, console menampilkan refresh token (`1//0g...`).
5. Copy ke `.env` → `YOUTUBE_OAUTH_REFRESH_TOKEN=1//0g...`, lalu restart.

### B. poToken (tanpa login)

Ambil `poToken` + `visitorData` dari
[iv-org/youtube-trusted-session-generator](https://github.com/iv-org/youtube-trusted-session-generator),
lalu:

```env
YOUTUBE_PO_TOKEN=...
YOUTUBE_VISITOR_DATA=...
```

Berlaku untuk client `WEB` / `WEBEMBEDDED`.

### C. Remote cipher server (kalau error `must find sig function`)

Deploy [yt-cipher](https://github.com/kikkia/yt-cipher), lalu:

```env
YOUTUBE_REMOTE_CIPHER_URL=http://127.0.0.1:8001
YOUTUBE_REMOTE_CIPHER_PASSWORD=password_kamu
```

### D. Jalankan Lavalink di IP rumahan/VPS lain

Set `LAVALINK_EMBEDDED=false` dan arahkan `LAVALINK_HOST` ke Lavalink tersebut.
IP residential hampir tidak pernah diblokir.

---

## Spotify / Apple Music / Deezer

Bot mendukung link dari ketiga layanan itu, **tanpa kredensial pun jalan**:

| Yang kamu kirim | Tanpa kredensial | Dengan kredensial |
| --- | --- | --- |
| Link lagu (`/track/...`, `?i=...`) | ✅ judul+artis diambil dari halaman publik, audio dicari di SoundCloud/YouTube | ✅ resolusi resmi + audio mirror |
| Link album / playlist | ❌ (butuh plugin) | ✅ semua track dimuat |
| Pencarian `?play sp:judul` | ❌ | ✅ |

### Aktifkan dukungan penuh

**Spotify** (gratis, 2 menit):

1. Buka <https://developer.spotify.com/dashboard> → **Create app** (isi apa saja).
2. Copy **Client ID** dan **Client Secret**.
3. Isi `.env`:

   ```env
   SPOTIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SPOTIFY_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SPOTIFY_COUNTRY_CODE=ID
   ```

**Apple Music** (butuh token JWT):

```env
APPLE_MUSIC_MEDIA_API_TOKEN=eyJhbGciOi...
APPLE_MUSIC_COUNTRY_CODE=ID
```

> Token ini **wajib** berbentuk JWT (3 bagian dipisah titik). Kalau formatnya salah,
> bot otomatis mematikan source Apple supaya Lavalink tidak crash — link lagu Apple
> tetap bisa diputar lewat pencarian teks.

**Deezer** (opsional):

```env
DEEZER_ARL=...
DEEZER_MASTER_DECRYPTION_KEY=...
```

### Urutan sumber audio (mirroring)

Spotify/Apple tidak menyediakan file audio, jadi lagunya dicarikan ke sumber lain.
Atur lewat:

```env
LAVASRC_PROVIDERS=scsearch:%QUERY%,ytsearch:%QUERY%,ytsearch:"%ISRC%"
```

Default di atas menaruh **SoundCloud lebih dulu** karena paling aman di VPS yang
IP-nya diblokir YouTube. Kalau YouTube di server kamu normal, taruh `ytsearch` dulu.

Cek hasilnya dengan `npm run doctor` — akan tampil daftar sumber aktif, misal:

```
 OK   Sumber musik aktif  soundcloud, bandcamp, spotify, youtube, http
 OK   Plugin              lavasrc-plugin@4.8.3, youtube-plugin@1.18.2
```

---

## Lisensi

MIT — lihat [LICENSE](LICENSE).
