import http from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
} from "discord.js";
import { config } from "./config.js";
import { slashCommands } from "./commands.js";
import { lavalinkSupervisor } from "./lavalink/supervisor.js";
import { log } from "./logger.js";
import { MusicService } from "./music/service.js";
import { flushState, state } from "./state.js";
import { denialPayload, whitelist } from "./whitelist.js";

/* -------------------------------------------------------------------- */
/* Discord client                                                       */
/* -------------------------------------------------------------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const music = new MusicService(client);

client.on("raw", (payload) => music.raw(payload));

/* -------------------------------------------------------------------- */
/* helpers                                                              */
/* -------------------------------------------------------------------- */

const RADIO_ALIASES = new Set(["24/7", "247", "radio", "radio247", "24-7"]);
const ON_WORDS = new Set(["on", "enable", "enabled", "start", "nyala", "nyalakan", "aktif", "aktifkan"]);
const OFF_WORDS = new Set(["off", "disable", "disabled", "stop", "mati", "matikan", "nonaktif"]);
const STATUS_WORDS = new Set(["status", "info", "cek"]);

function formatCommandError(error) {
  const message = error?.message || String(error || "Error");

  if (/timeout|aborted/i.test(message)) {
    return (
      "❌ **Koneksi audio timeout.** Server audio sedang sibuk.\n" +
      "💡 Coba lagi sebentar, atau pindah node dengan `?changenode`."
    );
  }
  if (/econnrefused|fetch failed|offline/i.test(message)) {
    return (
      "❌ **Server audio belum siap.**\n" +
      "💡 Bot sedang menyalakan Lavalink otomatis. Tunggu ±15 detik lalu coba lagi. Cek `?nodes`."
    );
  }
  return `❌ ${message}`;
}

function logDenied(guild, user) {
  log.warn(
    { guildId: guild?.id, guild: guild?.name, user: user?.tag || user?.username },
    "Akses ditolak: server belum terdaftar di whitelist",
  );
}

const interactionContext = (interaction) => ({
  guildId: interaction.guildId,
  channelId: interaction.channelId,
  member: interaction.member,
  user: interaction.user,
  reply: async (payload) => {
    const data = typeof payload === "string" ? { content: payload } : payload;
    if (interaction.deferred || interaction.replied) return interaction.editReply(data);
    return interaction.reply(data);
  },
  edit: (payload) =>
    interaction.editReply(typeof payload === "string" ? { content: payload } : payload),
});

/* -------------------------------------------------------------------- */
/* slash commands                                                       */
/* -------------------------------------------------------------------- */

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);

  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
        body: slashCommands,
      });
      log.info({ scope: `guild:${config.guildId}` }, "Slash commands terdaftar (guild)");
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: slashCommands });
      log.info({ scope: "global" }, "Slash commands terdaftar (global)");
    }
  } catch (error) {
    log.error({ error: error.message }, "Gagal mendaftarkan slash commands");
  }
}

/* -------------------------------------------------------------------- */
/* interactions                                                         */
/* -------------------------------------------------------------------- */

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isButton()) {
      // Only handle our own buttons, never steal other bots' interactions.
      if (!interaction.customId.startsWith("am_")) return;

      if (interaction.guildId && !whitelist.isAllowed(interaction.guildId)) {
        logDenied(interaction.guild, interaction.user);
        if (interaction.isRepliable()) {
          await interaction.reply(denialPayload(interaction.guild, { ephemeral: true })).catch(() => {});
        }
        return;
      }

      await music.handleButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

    if (!whitelist.isAllowed(interaction.guildId)) {
      logDenied(interaction.guild, interaction.user);
      await interaction.reply(denialPayload(interaction.guild, { ephemeral: true })).catch(() => {});
      return;
    }

    await interaction.deferReply();
    const ctx = interactionContext(interaction);

    switch (interaction.commandName) {
      case "play":
        return void (await music.play(ctx, interaction.options.getString("query", true)));
      case "skip":
        return void (await music.skip(ctx));
      case "stop":
        return void (await music.stop(ctx));
      case "pause":
        return void (await music.pause(ctx));
      case "resume":
        return void (await music.resume(ctx));
      case "queue":
        return void (await music.queue(ctx));
      case "nowplaying":
        return void (await music.nowPlaying(ctx));
      case "volume":
        return void (await music.volume(ctx, interaction.options.getInteger("level")));
      case "shuffle":
        return void (await music.shuffle(ctx));
      case "clear":
        return void (await music.clear(ctx));
      case "autoplay":
        return void (await music.autoplay(ctx, interaction.options.getBoolean("enabled")));
      case "loop":
        return void (await music.loop(ctx, interaction.options.getString("mode")));
      case "remove":
        return void (await music.remove(ctx, interaction.options.getInteger("position", true)));
      case "seek":
        return void (await music.seek(ctx, interaction.options.getString("time", true)));
      case "leave":
        return void (await music.leave(ctx));
      case "radio":
        return void (await music.radioCommand(
          ctx,
          interaction.options.getBoolean("enabled"),
          interaction.options.getString("seed"),
        ));
      case "ultrahd":
        return void (await music.ultrahd(ctx, interaction.options.getString("profile")));
      case "nodes":
        return void (await music.nodes(ctx));
      case "changenode":
        return void (await music.changeNode(ctx, interaction.options.getString("target", true)));
      case "ping":
        return void (await music.ping(ctx));
      case "help":
        return void (await music.help(ctx));
      default:
        return;
    }
  } catch (error) {
    log.error({ error: error.message, command: interaction.commandName }, "Interaction error");

    if (interaction.isRepliable()) {
      const content = formatCommandError(error);
      await (interaction.replied || interaction.deferred
        ? interaction.editReply({ content })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral })
      ).catch(() => {});
    }
  }
});

/* -------------------------------------------------------------------- */
/* prefix commands                                                      */
/* -------------------------------------------------------------------- */

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.member) return;
  if (!message.content.startsWith(config.prefix)) return;

  const body = message.content.slice(config.prefix.length).trim();
  if (!body) return;

  // Lisensi server: semua command ditolak kalau server belum terdaftar.
  if (!whitelist.isAllowed(message.guild.id)) {
    logDenied(message.guild, message.author);
    if (whitelist.shouldNotify(message.guild.id)) {
      await message.reply(denialPayload(message.guild)).catch(() => {});
    }
    return;
  }

  const [rawCommand, ...rest] = body.split(/\s+/);
  const command = rawCommand.toLowerCase();
  const argument = rest.join(" ");

  const ctx = {
    guildId: message.guild.id,
    channelId: message.channel.id,
    member: message.member,
    user: message.author,
    reply: (payload) => message.reply(typeof payload === "string" ? { content: payload } : payload),
  };

  try {
    if (["play", "p"].includes(command)) return void (await music.play(ctx, argument));
    if (["skip", "s", "next"].includes(command)) return void (await music.skip(ctx));
    if (command === "stop") return void (await music.stop(ctx));
    if (command === "pause") return void (await music.pause(ctx));
    if (command === "resume") return void (await music.resume(ctx));
    if (["queue", "q"].includes(command)) return void (await music.queue(ctx));
    if (["nowplaying", "np", "current"].includes(command)) return void (await music.nowPlaying(ctx));

    if (["volume", "vol", "v"].includes(command)) {
      const value = rest.length ? Number(rest[0]) : null;
      return void (await music.volume(ctx, value));
    }

    if (command === "shuffle") return void (await music.shuffle(ctx));
    if (command === "clear") return void (await music.clear(ctx));

    if (command === "autoplay") {
      const value = rest.length ? /^(on|true|1|yes|aktif|nyala)$/i.test(rest[0]) : null;
      return void (await music.autoplay(ctx, value));
    }

    if (command === "loop") {
      const mode = rest.length && ["off", "track", "queue"].includes(rest[0].toLowerCase())
        ? rest[0].toLowerCase()
        : null;
      return void (await music.loop(ctx, mode));
    }

    if (command === "remove") return void (await music.remove(ctx, Number(rest[0])));
    if (command === "seek") return void (await music.seek(ctx, argument));

    if (["leave", "disconnect", "dc"].includes(command)) return void (await music.leave(ctx));
    if (["ultrahd", "hd", "eq", "audio"].includes(command)) return void (await music.ultrahd(ctx, argument));
    if (["nodes", "cluster", "hosts"].includes(command)) return void (await music.nodes(ctx));
    if (["changenode", "switch", "movenode"].includes(command)) return void (await music.changeNode(ctx, argument));
    if (command === "ping") return void (await music.ping(ctx));
    if (["help", "h", "commands"].includes(command)) return void (await music.help(ctx));

    if (RADIO_ALIASES.has(command)) {
      const first = rest[0]?.toLowerCase();

      if (first && STATUS_WORDS.has(first)) {
        return void (await music.radioStatus(ctx));
      }

      if (first && ON_WORDS.has(first)) {
        const seed = rest.slice(1).join(" ").trim() || null;
        return void (await music.radioCommand(ctx, true, seed));
      }

      if (first && OFF_WORDS.has(first)) {
        return void (await music.radioCommand(ctx, false, null));
      }

      const seed = argument.trim() || null;
      // `?24/7 lofi hip hop` = nyalakan dengan seed tersebut, bukan toggle.
      return void (await music.radioCommand(ctx, seed ? true : null, seed));
    }
  } catch (error) {
    log.error({ error: error.message, command }, "Prefix command error");
    await message.reply(formatCommandError(error)).catch(() => {});
  }
});

/* -------------------------------------------------------------------- */
/* voice state                                                          */
/* -------------------------------------------------------------------- */

client.on("voiceStateUpdate", async (oldState, newState) => {
  const guildId = newState.guild.id || oldState.guild.id;
  const botId = client.user?.id;

  if (oldState.member?.id === botId) {
    const wasConnected = Boolean(oldState.channelId);
    const isConnected = Boolean(newState.channelId);

    if (wasConnected && !isConnected) {
      const player = music.getPlayer(guildId);

      if (music.radio.isEnabled(guildId)) {
        log.warn({ guildId }, "Bot keluar dari voice channel, mode 24/7 akan menyambung ulang");
        music.scheduleRadioReconnect(guildId, 3000);
      } else {
        // Give discord.js a moment to recover from a transient gateway hiccup.
        setTimeout(() => {
          const current = music.getPlayer(guildId);
          if (current && !current.connected && !music.radio.isEnabled(guildId)) {
            current.destroy("voice-disconnected").catch(() => {});
          }
        }, 12000).unref?.();
      }

      if (player) music.npMessages.delete(guildId);
      return;
    }

    if (isConnected && oldState.channelId !== newState.channelId) {
      const player = music.getPlayer(guildId);
      if (player) {
        player.voiceChannelId = newState.channelId;
        music.radio.updateChannels(guildId, { voiceChannelId: newState.channelId });
        log.info({ guildId, channelId: newState.channelId }, "Bot dipindahkan ke voice channel lain");
      }
    }
  }

  music.checkEmptyChannel(guildId);
});

client.on("guildDelete", async (guild) => {
  const player = music.getPlayer(guild.id);
  if (player) await player.destroy("guild-left").catch(() => {});
  music.cancelEmptyChannelTimer(guild.id);
  music.radio.clear(guild.id);
});

/* -------------------------------------------------------------------- */
/* lisensi server                                                       */
/* -------------------------------------------------------------------- */

/** Kirim panel "belum berlisensi" lalu keluar dari server. */
async function notifyAndLeave(guild) {
  try {
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));

    const channel =
      guild.systemChannel ??
      guild.channels.cache.find(
        (candidate) =>
          candidate.isTextBased?.() &&
          candidate.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages),
      );

    await channel?.send(denialPayload(guild)).catch(() => {});
  } catch {}

  await new Promise((resolve) => setTimeout(resolve, 2500));
  await guild.leave().catch(() => {});
}

client.on("guildCreate", async (guild) => {
  if (whitelist.isAllowed(guild.id)) {
    log.info({ guildId: guild.id, guild: guild.name }, "Bot ditambahkan ke server berlisensi");
    return;
  }

  log.warn({ guildId: guild.id, guild: guild.name }, "Bot ditambahkan ke server TANPA lisensi");

  if (!config.whitelist.leaveUnauthorized) return;
  await notifyAndLeave(guild);
});

/** Saat boot: bersihkan server yang tidak ada di whitelist. */
async function enforceWhitelistOnBoot(readyClient) {
  if (!config.whitelist.enabled) return;

  const unauthorized = readyClient.guilds.cache.filter((guild) => !whitelist.isAllowed(guild.id));
  if (!unauthorized.size) return;

  log.warn({ count: unauthorized.size }, "Bot berada di server tanpa lisensi");

  if (!config.whitelist.leaveUnauthorized) return;

  for (const guild of unauthorized.values()) {
    log.warn({ guildId: guild.id, guild: guild.name }, "Keluar dari server tanpa lisensi");
    await notifyAndLeave(guild);
  }
}

/* -------------------------------------------------------------------- */
/* ready                                                                */
/* -------------------------------------------------------------------- */

client.once(Events.ClientReady, async (readyClient) => {
  music.init(readyClient.user);

  log.info(
    { user: readyClient.user.tag, guilds: readyClient.guilds.cache.size, node: process.version },
    "ANTIMUSIC online",
  );

  readyClient.user.setActivity(`${config.prefix}play • /radio`, { type: 2 });

  await registerCommands();
  await enforceWhitelistOnBoot(readyClient);
  await music.restoreRadioSessions();
});

client.on(Events.Error, (error) => log.error({ error: error.message }, "Discord client error"));
client.on(Events.Warn, (message) => log.debug({ warning: message }, "Discord client warning"));
client.on(Events.ShardError, (error) => log.error({ error: error.message }, "Discord shard error"));

/* -------------------------------------------------------------------- */
/* health server                                                        */
/* -------------------------------------------------------------------- */

const healthServer = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");

  if (request.url === "/health" || request.url === "/") {
    const players = music.getAllPlayers();
    const nodes = music.allNodes();

    response.statusCode = 200;
    response.end(
      JSON.stringify({
        ok: true,
        bot: client.user?.tag ?? null,
        guilds: client.guilds.cache.size,
        wsPing: client.ws.ping,
        uptime: Math.round(process.uptime()),
        players: players.length,
        playing: players.filter((player) => player.playing).length,
        radio: players.filter((player) => music.radio.isEnabled(player.guildId)).length,
        whitelist: {
          enabled: config.whitelist.enabled,
          openMode: whitelist.openMode,
          servers: whitelist.size,
        },
        nodes: nodes.map((node) => ({
          id: node.id,
          connected: Boolean(node.connected),
          players: node.stats?.players ?? 0,
        })),
        lavalink: lavalinkSupervisor.status(),
        memory: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
      }),
    );
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false }));
});

healthServer.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    log.warn({ port: config.healthPort }, "Port health check dipakai, memakai port acak");
    healthServer.listen(0, "0.0.0.0");
  } else {
    log.warn({ error: error.message }, "Health server error");
  }
});

healthServer.listen(config.healthPort, "0.0.0.0", () => {
  const address = healthServer.address();
  const port = typeof address === "object" && address ? address.port : config.healthPort;
  log.info({ port }, "Health server online (/health)");
});

/* -------------------------------------------------------------------- */
/* shutdown                                                             */
/* -------------------------------------------------------------------- */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info({ signal }, "Mematikan ANTIMUSIC...");

  try {
    await music.destroyAll();
  } catch {}

  flushState();

  try {
    client.destroy();
  } catch {}

  try {
    healthServer.close();
  } catch {}

  try {
    await lavalinkSupervisor.stop();
  } catch {}

  setTimeout(() => process.exit(0), 500).unref?.();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  const message = reason?.message || String(reason);

  // lavalink-client throws inside fetchInfo() when a node returns HTML
  // (proxy error page, Cloudflare challenge, ...) or when the socket dies
  // mid-handshake. Not fatal, and extremely noisy.
  if (
    /not valid JSON|Unexpected token|proxy error|does not provide any \/v4\/info|ON-OPEN-FETCH/i.test(message)
  ) {
    log.debug({ error: message }, "Node mengembalikan respons tidak valid (diabaikan)");
    return;
  }

  log.error({ error: message, stack: reason?.stack }, "Unhandled rejection");
});

process.on("uncaughtException", (error) => {
  log.fatal({ error: error.message, stack: error.stack }, "Uncaught exception, proses dihentikan");
  setTimeout(() => process.exit(1), 250).unref?.();
});

/* -------------------------------------------------------------------- */
/* boot                                                                 */
/* -------------------------------------------------------------------- */

log.info(
  {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    lavalink: `${config.lavalink.host}:${config.lavalink.port}`,
    embedded: config.lavalink.embedded,
  },
  "Memulai ANTIMUSIC",
);

if (config.lavalink.embedded) {
  // When Lavalink finally comes up, revive nodes that already gave up.
  lavalinkSupervisor.onReady = () => {
    for (const node of music.allNodes()) {
      if (node.connected) continue;
      try {
        node.connect();
      } catch {}
    }
  };

  // Start the supervisor in the background: the bot can log in to Discord
  // immediately while Lavalink boots (first boot downloads jar + JRE).
  void lavalinkSupervisor
    .ensure()
    .then((started) => {
      if (!started) log.warn("Lavalink lokal belum siap; bot akan mencoba lagi otomatis");
    })
    .catch((error) => log.error({ error: error.message }, "Bootstrap Lavalink gagal"));
} else {
  log.info({ host: config.lavalink.host }, "Memakai Lavalink eksternal (embedded dimatikan)");
}

try {
  await client.login(config.token);
} catch (error) {
  log.fatal({ error: error.message }, "Gagal login ke Discord. Periksa DISCORD_TOKEN di .env");
  await lavalinkSupervisor.stop().catch(() => {});
  process.exit(1);
}

export { client, music, state };
