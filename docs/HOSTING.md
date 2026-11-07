# Hosting Lavalink — mana yang bisa, mana yang tidak

Pertanyaan yang paling sering muncul: **"Lavalink bisa di Vercel / hosting gratis?"**
Jawaban singkat: **tidak bisa.** Berikut alasannya dan apa yang harus dipakai.

---

## Kenapa Vercel (dan serverless lain) tidak bisa

Lavalink bukan fungsi HTTP biasa. Dia aplikasi **Java Spring Boot** yang harus hidup terus:

| Kebutuhan Lavalink | Vercel / Netlify / Cloudflare Workers |
| --- | --- |
| Proses Java yang hidup 24/7 | Serverless: fungsi mati setelah request selesai |
| WebSocket server (`/v4/websocket`) untuk bot | Tidak ada server WebSocket persisten |
| Koneksi **UDP** ke voice Discord (JDA-NAS) | Tidak ada UDP keluar |
| Disk bisa ditulis (plugin, cache, log) | Filesystem read-only |
| RAM 512 MB – 1 GB | Fungsi dibatasi (memori & waktu eksekusi) |
| Proses berjalan > 60 detik | Timeout request 10–60 detik |

Jadi kalau dipaksa, hasilnya: deploy "sukses" tapi bot tetap `ECONNREFUSED` karena tidak ada
proses yang benar-benar hidup.

> Vercel cocok untuk **dashboard/landing page** bot, bukan untuk Lavalink-nya.

## Kenapa hosting panel gratis (mis. Silly Development) sering gagal

Yang dibutuhkan:

1. **Java 17+** (bukan Node/Python).
2. **RAM ≥ 1 GB** (JVM + bot Node dalam satu container).
3. **Outbound UDP** ke `discord.gg` voice.
4. Proses long-running + disk writable.

Banyak panel gratis hanya menyediakan Node/Python, membatasi RAM 512 MB, atau mematikan
container saat idle. Kalau panel kamu **tidak punya egg Java**, Lavalink tidak akan jalan.

---

## Yang benar-benar bekerja

### Opsi A — Semua di satu server Pterodactyl (paling gampang, default v2)

Bot **menyalakan Lavalink sendiri** di dalam container yang sama:

```
Pterodactyl container
├── node index.js        (bot)
└── java -jar Lavalink.jar   (di-spawn & diawasi bot)
```

* Bot otomatis mengunduh `Lavalink.jar` + OpenJDK 17 portabel.
* Watchdog restart kalau Lavalink mati.
* Tidak perlu port tambahan, tidak perlu VPS kedua.
* Syarat: **RAM server minimal 1 GB** (disarankan 1.5–2 GB).

Ini yang dipakai `.env` default (`LAVALINK_EMBEDDED=true`).

### Opsi B — Lavalink terpisah di VPS kecil

Kalau RAM panel cuma 512 MB, pisahkan Lavalink ke VPS 1 GB:

**Di VPS Lavalink** (Docker):

```bash
docker run -d --name lavalink \
  -p 2333:2333 \
  -v $(pwd)/application.yml:/opt/Lavalink/application.yml \
  --restart unless-stopped \
  ghcr.io/lavalink-devs/lavalink:4
```

Atau pakai `docker-compose.yml` di repo ini (service `lavalink`).

**Di Pterodactyl** (`.env` bot):

```env
LAVALINK_EMBEDDED=false
LAVALINK_HOST=IP_VPS_KAMU
LAVALINK_PORT=2333
LAVALINK_PASSWORD=password-panjang-dan-acak
LAVALINK_SECURE=false
```

> **Keamanan:** jangan biarkan port 2333 terbuka ke internet tanpa password kuat.
> Lebih aman: firewall hanya untuk IP panel, atau SSH tunnel.

### Opsi C — Railway / Render / Fly.io / Koyeb

Bisa, dengan image `ghcr.io/lavalink-devs/lavalink:4`:

* **Fly.io** — paling cocok (proses persisten, region dekat Discord).
* **Railway/Render** — paket gratis biasanya *sleep* saat idle → bot disconnect.
* Butuh **TCP port** publik + volume untuk `application.yml`.

Tetap set `LAVALINK_EMBEDDED=false` di bot.

---

## Ringkasan

| Platform | Lavalink | Catatan |
| --- | --- | --- |
| Pterodactyl (embedded) | ✅ | default repo ini, paling simpel |
| VPS + Docker | ✅ | opsi B, stabil |
| Fly.io / Railway (paid) | ✅ | butuh Docker + port TCP |
| Render free / Railway free | ⚠️ | sleep saat idle |
| **Vercel / Netlify / Cloudflare** | ❌ | serverless, tanpa UDP & proses persisten |
| Panel gratis tanpa Java | ❌ | tidak ada runtime Java |

Kalau kamu tetap ingin "semua di satu tempat", pakai **Opsi A** — tidak ada yang perlu
dipisah, dan itu yang sudah otomatis di repo ini.
