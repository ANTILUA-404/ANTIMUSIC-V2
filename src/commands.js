import { SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Putar lagu dari YouTube / YouTube Music / SoundCloud / link")
    .addStringOption((option) =>
      option.setName("query").setDescription("Judul lagu atau link").setRequired(true),
    ),

  new SlashCommandBuilder().setName("skip").setDescription("Lewati lagu yang sedang diputar"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop, bersihkan antrean, dan keluar dari voice channel"),
  new SlashCommandBuilder().setName("pause").setDescription("Jeda pemutaran"),
  new SlashCommandBuilder().setName("resume").setDescription("Lanjutkan pemutaran"),
  new SlashCommandBuilder().setName("queue").setDescription("Tampilkan antrean lagu"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Detail lagu yang sedang diputar"),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Lihat atau ubah volume (0-200)")
    .addIntegerOption((option) =>
      option.setName("level").setDescription("Level volume 0-200").setMinValue(0).setMaxValue(200).setRequired(false),
    ),

  new SlashCommandBuilder().setName("shuffle").setDescription("Acak antrean lagu"),
  new SlashCommandBuilder().setName("clear").setDescription("Hapus semua lagu di antrean"),

  new SlashCommandBuilder()
    .setName("autoplay")
    .setDescription("Nyalakan/matikan autoplay pintar (lagu lanjutan seirama)")
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Aktif atau nonaktif").setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Atur mode perulangan")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Mode loop")
        .setRequired(false)
        .addChoices(
          { name: "Off", value: "off" },
          { name: "Track", value: "track" },
          { name: "Queue", value: "queue" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Hapus satu lagu dari antrean")
    .addIntegerOption((option) =>
      option.setName("position").setDescription("Posisi antrean (mulai dari 1)").setMinValue(1).setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("seek")
    .setDescription("Lompat ke detik / menit tertentu (contoh: 90 atau 1:30)")
    .addStringOption((option) =>
      option.setName("time").setDescription("Waktu, contoh 90 atau 1:30").setRequired(true),
    ),

  new SlashCommandBuilder().setName("leave").setDescription("Keluar dari voice channel"),

  new SlashCommandBuilder()
    .setName("radio")
    .setDescription("Mode 24/7: autoplay tanpa henti, tidak pernah keluar voice channel")
    .addBooleanOption((option) =>
      option.setName("enabled").setDescription("Aktifkan / matikan mode 24/7").setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("seed")
        .setDescription("Acuan radio: judul lagu, artis, atau genre (contoh: lofi hip hop)")
        .setRequired(false),
    ),

  new SlashCommandBuilder()
    .setName("ultrahd")
    .setDescription("Audio engine Ultra HD: status & profil equalizer")
    .addStringOption((option) =>
      option
        .setName("profile")
        .setDescription("Pilih profil audio")
        .setRequired(false)
        .addChoices(
          { name: "💎 Ultra HD Studio Master", value: "ultrahd" },
          { name: "🔊 Ultra Bass Boost", value: "bassboost" },
          { name: "🎤 Vocal & Acoustic Clarity", value: "vocal" },
          { name: "⚪ Standard Flat (Off)", value: "off" },
        ),
    ),

  new SlashCommandBuilder().setName("nodes").setDescription("Status cluster node Lavalink & failover"),

  new SlashCommandBuilder()
    .setName("changenode")
    .setDescription("Pindahkan pemutaran ke node Lavalink lain")
    .addStringOption((option) =>
      option.setName("target").setDescription("Nomor urut atau nama host/node").setRequired(true),
    ),

  new SlashCommandBuilder().setName("ping").setDescription("Latensi bot & Lavalink"),
  new SlashCommandBuilder().setName("help").setDescription("Daftar perintah ANTIMUSIC"),
];

export const slashCommands = commands.map((command) => command.toJSON());
export default slashCommands;
