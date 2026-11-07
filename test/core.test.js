/**
 * Test inti ANTIMUSIC — tidak butuh jaringan, tidak butuh Discord/Lavalink.
 * Jalankan: npm test
 */
process.env.DISCORD_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAA.BBBBB.CCCCCCCCCCCCCCCCCCCCCCCC";
process.env.CLIENT_ID = "123456789012345678";
process.env.LAVALINK_EMBEDDED = "false";
process.env.LOG_LEVEL = "error";

import test from "node:test";
import assert from "node:assert/strict";

const { parseMusicLink, SOURCE_MANAGER, SERVICE_SEARCH_PREFIX } = await import("../src/music/links.js");
const utils = await import("../src/utils.js");
const { ms, parseSeconds, truncate, isUrl, normalizeQuery, trackTitle, trackIdentifier } = utils;
const { renderLavalinkConfig } = await import("../src/lavalink/config-writer.js");
const { config } = await import("../src/config.js");
const { MusicService } = await import("../src/music/service.js");

/* ------------------------------------------------------------------ */
/* utils                                                               */
/* ------------------------------------------------------------------ */

test("ms() memformat durasi", () => {
  assert.equal(ms(0), "0:00");
  assert.equal(ms(65_000), "1:05");
  assert.equal(ms(3_725_000), "1:02:05");
  assert.equal(ms(-1), "0:00");
  assert.equal(ms(NaN), "0:00");
});

test("parseSeconds() menerima detik dan mm:ss", () => {
  assert.equal(parseSeconds("90"), 90);
  assert.equal(parseSeconds("1:30"), 90);
  assert.equal(parseSeconds("1:02:03"), 3723);
  assert.equal(parseSeconds("abc"), null);
  assert.equal(parseSeconds("-5"), null);
  assert.equal(parseSeconds("1:xx"), null);
});

test("truncate() memotong dengan elipsis", () => {
  assert.equal(truncate("abcdef", 10), "abcdef");
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.equal(truncate(null, 5), "");
});

test("isUrl() dan normalizeQuery()", () => {
  assert.equal(isUrl("https://youtu.be/abc"), true);
  assert.equal(isUrl("lofi hip hop"), false);
  assert.equal(normalizeQuery("youtube.com/watch?v=abc"), "https://youtube.com/watch?v=abc");
  assert.equal(normalizeQuery("  lofi  "), "lofi");
});

test("helper track aman untuk data kosong", () => {
  assert.equal(trackTitle(null), "Unknown track");
  assert.equal(trackIdentifier({ info: { identifier: "abc" } }), "abc");
});

/* ------------------------------------------------------------------ */
/* link musik                                                          */
/* ------------------------------------------------------------------ */

test("parseMusicLink() mengenali Spotify", () => {
  assert.deepEqual(parseMusicLink("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x"), {
    service: "spotify",
    kind: "track",
    id: "4cOdK2wGLETKBW3PvgPWqT",
    url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x",
  });
  assert.equal(parseMusicLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").kind, "playlist");
  assert.equal(parseMusicLink("spotify:track:4cOdK2wGLETKBW3PvgPWqT").id, "4cOdK2wGLETKBW3PvgPWqT");
});

test("parseMusicLink() mengenali Apple Music", () => {
  const albumLink = parseMusicLink("https://music.apple.com/us/album/x/1559885420?i=1559885421");
  assert.equal(albumLink.service, "applemusic");
  assert.equal(albumLink.kind, "track");
  assert.equal(albumLink.id, "1559885421");

  const songLink = parseMusicLink("https://music.apple.com/us/song/x/1559885421");
  assert.equal(songLink.id, "1559885421");
});

test("parseMusicLink() mengenali Deezer", () => {
  const link = parseMusicLink("https://www.deezer.com/track/3135556");
  assert.equal(link.service, "deezer");
  assert.equal(link.id, "3135556");
});

test("parseMusicLink() tidak salah mengenali link lain", () => {
  assert.equal(parseMusicLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseMusicLink("lofi hip hop"), null);
  assert.equal(parseMusicLink(""), null);
});

test("peta sumber konsisten", () => {
  assert.equal(SOURCE_MANAGER.spsearch, "spotify");
  assert.equal(SOURCE_MANAGER.amsearch, "applemusic");
  assert.equal(SOURCE_MANAGER.dzsearch, "deezer");
  assert.equal(SERVICE_SEARCH_PREFIX.spotify, "spsearch");
});

/* ------------------------------------------------------------------ */
/* config lavalink                                                     */
/* ------------------------------------------------------------------ */

test("application.yml yang di-generate berisi konfigurasi wajib", () => {
  const yaml = renderLavalinkConfig();

  assert.match(yaml, /server:\n {2}port: 2333/);
  assert.match(yaml, /password: "antimusic-super-secret"/);
  assert.match(yaml, /youtube: false/);
  assert.match(yaml, /youtube-plugin:1\.18\.2/);
  assert.match(yaml, /TVHTML5_SIMPLY/);
  // Tanpa kredensial, plugin LavaSrc tidak boleh ikut (biar tidak ada crash).
  assert.equal(yaml.includes("lavasrc"), false);
});

test("port Lavalink dipaksa lewat argumen JVM", () => {
  // Nilai ini yang menyelamatkan bot dari SERVER_PORT milik Pterodactyl.
  assert.equal(config.lavalink.port, 2333);
  assert.equal(config.lavalink.embedded, false);
});

/* ------------------------------------------------------------------ */
/* logika musik                                                        */
/* ------------------------------------------------------------------ */

const service = new MusicService({
  user: { id: "1", username: "ANTIMUSIC" },
  guilds: { cache: new Map() },
  channels: { cache: new Map() },
  ws: { shards: { first: () => null } },
});

test("deteksi error YouTube cocok dengan pesan asli Lavalink", () => {
  const blocked = [
    "(yts.version: 1.18.2) All clients failed to load the item.",
    "This video requires login.",
    "No supported audio streams available, available types:",
    "Must find sig function from script: /s/player/a5c2aafe/base.js",
    "The page needs to be reloaded.",
    "This video is unavailable",
  ];
  for (const message of blocked) assert.equal(service.isYoutubeBlocked(message), true, message);

  assert.equal(service.isYoutubeBlocked("Track ended normally"), false);
  assert.equal(service.isYoutubeBlocked(""), false);
});

test("circuit breaker YouTube aktif setelah 2 kegagalan berurutan", () => {
  service.youtubeDegradedUntil = 0;
  service.youtubeFailureStreak = 0;
  service.lastYoutubeFailureAt = 0;

  service.noteYoutubeFailure({ guildId: "1" }, "All clients failed");
  assert.equal(service.isYoutubeDegraded(), false);

  service.noteYoutubeFailure({ guildId: "1" }, "All clients failed");
  assert.equal(service.isYoutubeDegraded(), true);
});

test("circuit breaker YouTube reset kalau kegagalan berjauhan", () => {
  service.youtubeDegradedUntil = 0;
  service.youtubeFailureStreak = 0;
  service.lastYoutubeFailureAt = 0;

  service.noteYoutubeFailure({ guildId: "1" }, "All clients failed");
  // Kegagalan berikutnya 5 menit kemudian: bukan blokir massal.
  service.lastYoutubeFailureAt = Date.now() - 300_000;
  service.noteYoutubeFailure({ guildId: "1" }, "All clients failed");

  assert.equal(service.isYoutubeDegraded(), false);
});

test("isSameSong() tidak salah menganggap lagu berbeda", () => {
  assert.equal(service.isSameSong("Dewi (Official Audio)", "Dewi"), true);
  assert.equal(service.isSameSong("Dewi", "Pupus"), false);
});

test("extractYouTubeVideoId()", () => {
  assert.equal(service.extractYouTubeVideoId({ info: { identifier: "dQw4w9WgXcQ", sourceName: "youtube" } }), "dQw4w9WgXcQ");
  assert.equal(
    service.extractYouTubeVideoId({ info: { identifier: "x", uri: "https://youtu.be/dQw4w9WgXcQ" } }),
    "dQw4w9WgXcQ",
  );
  assert.equal(service.extractYouTubeVideoId({ info: { identifier: "sc123", sourceName: "soundcloud" } }), null);
});

test("nodeHasSource() menghormati sourceManagers", () => {
  const node = { info: { sourceManagers: ["youtube", "soundcloud"] } };
  assert.equal(service.nodeHasSource(node, "ytsearch"), true);
  assert.equal(service.nodeHasSource(node, "scsearch"), true);
  assert.equal(service.nodeHasSource(node, "spsearch"), false);
  assert.equal(service.nodeHasSource({ info: { sourceManagers: [] } }, "spsearch"), true);
});

/* ------------------------------------------------------------------ */
/* supervisor: log hygiene + port helpers                              */
/* ------------------------------------------------------------------ */

test("oneLine() meratakan stack trace jadi satu baris", () => {
  const { oneLine } = utils;
  const raw = "Client [ANDROID_VR] failed: This video requires login.\n\tat dev.lavalink.youtube.Client\n\tat java.base/Foo";
  const out = oneLine(raw, 200);

  assert.equal(out.includes("\n"), false);
  assert.equal(out.includes("\t"), false);
  assert.match(out, /^Client \[ANDROID_VR\] failed: This video requires login\. at dev\.lavalink\.youtube\.Client/);
  assert.equal(oneLine("  banyak    spasi  "), "banyak spasi");
  assert.equal(oneLine(""), "");
});

test("isPortOpen() dan waitForPortFree()", async () => {
  const net = await import("node:net");
  const { isPortOpen, waitForPortFree } = await import("../src/lavalink/supervisor.js");

  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  assert.equal(await isPortOpen(port), true);
  assert.equal(await waitForPortFree(port, 1200), false);

  await new Promise((resolve) => server.close(resolve));

  assert.equal(await waitForPortFree(port, 5000), true);
  assert.equal(await isPortOpen(port), false);
});

test("findLavalinkPidsOnPort() tidak pernah mengembalikan proses non-Lavalink", async () => {
  const { findLavalinkPidsOnPort } = await import("../src/lavalink/supervisor.js");
  const pids = findLavalinkPidsOnPort(1); // port 1 tidak pernah dipakai Lavalink
  assert.deepEqual(pids, []);
});
