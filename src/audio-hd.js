import { PermissionFlagsBits } from "discord.js";
import { log } from "./logger.js";

/** 15-band equalizer presets (Lavalink filter bands 0-14). */
export const EQ_PROFILES = {
  ultrahd: [
    0.15, 0.12, 0.07, 0.02, -0.02, -0.02, 0.0, 0.0, 0.03, 0.05, 0.08, 0.1, 0.13, 0.16, 0.2,
  ],
  bassboost: [
    0.25, 0.22, 0.16, 0.08, 0.02, -0.02, -0.04, 0.0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14,
  ],
  vocal: [
    -0.05, -0.05, 0.0, 0.02, 0.0, 0.02, 0.05, 0.08, 0.12, 0.14, 0.12, 0.1, 0.08, 0.05, 0.02,
  ],
  off: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const PROFILE_INFO = {
  ultrahd: {
    label: "Ultra HD Studio Master",
    description: "Keseimbangan sempurna: bass hangat & bertenaga, vokal jernih, treble berkilau kristal.",
    emoji: "💎",
  },
  bassboost: {
    label: "Ultra Bass Boost",
    description: "Sub-bass & mid-bass bertenaga ekstra untuk EDM, Phonk, Trap, dan Hip-Hop.",
    emoji: "🔊",
  },
  vocal: {
    label: "Vocal & Acoustic Clarity",
    description: "Fokus pada kejelasan vokal dan detail instrumen akustik tanpa dengung frekuensi rendah.",
    emoji: "🎤",
  },
  off: {
    label: "Standard Flat (Off)",
    description: "Audio original tanpa pemrosesan equalizer studio.",
    emoji: "⚪",
  },
};

function toBands(gains) {
  return gains.map((gain, band) => ({ band, gain }));
}

/**
 * Applies an equalizer profile to a player.
 * Safe to call at any time: every failure is swallowed and logged at debug level.
 */
export async function applyAudioQualityProfile(player, profile) {
  const filterManager = player?.filterManager;
  if (!filterManager) return false;

  const name = EQ_PROFILES[profile] ? profile : "ultrahd";

  try {
    if (name === "off") {
      await filterManager.clearEQ();
    } else {
      await filterManager.setEQ(toBands(EQ_PROFILES[name]));
    }
    log.debug({ guildId: player.guildId, profile: name }, "Profil audio diterapkan");
    return true;
  } catch (error) {
    log.debug({ guildId: player?.guildId, error: error?.message }, "Gagal menerapkan profil audio");
    return false;
  }
}

/** Raises the voice channel bitrate to the guild maximum when the bot may manage channels. */
export async function optimizeVoiceChannelBitrate(voiceChannel) {
  const fallback = {
    previousBitrate: voiceChannel?.bitrate ?? 0,
    currentBitrate: voiceChannel?.bitrate ?? 0,
    maxBitrate: voiceChannel?.guild?.maximumBitrate ?? 96000,
    boosted: false,
    canManage: false,
  };

  try {
    if (!voiceChannel || !voiceChannel.guild) return fallback;

    const currentBitrate = voiceChannel.bitrate ?? 64000;
    const maxBitrate = voiceChannel.guild.maximumBitrate ?? 96000;
    const botMember = voiceChannel.guild.members.me;
    const canManage = Boolean(
      botMember && voiceChannel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels),
    );

    if (currentBitrate < maxBitrate && canManage) {
      await voiceChannel
        .setBitrate(maxBitrate, "ANTIMUSIC Ultra HD Engine - auto bitrate maximizer")
        .catch(() => {});
      return { previousBitrate: currentBitrate, currentBitrate: maxBitrate, maxBitrate, boosted: true, canManage: true };
    }

    return { previousBitrate: currentBitrate, currentBitrate, maxBitrate, boosted: false, canManage };
  } catch (error) {
    log.debug({ channelId: voiceChannel?.id, error: error?.message }, "Gagal menaikkan bitrate voice channel");
    return fallback;
  }
}
