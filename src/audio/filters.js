/**
 * Preset filter untuk DUA engine.
 *
 * - `ffmpeg`   : filter chain FFmpeg (engine lokal)
 * - `lavalink` : mutasi `player.filterManager` (engine Lavalink)
 *
 * Nama filter sengaja sama supaya /filter bassboost terasa identik di kedua engine.
 */

export const FILTERS = {
  none: {
    label: 'tanpa filter',
    ffmpeg: null,
    lavalink: async (fm) => {
      await fm.resetFilters();
    },
  },

  bassboost: {
    label: 'bass lebih nendang',
    ffmpeg: 'bass=g=12,dynaudnorm=f=200',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.equalizer = [
        { band: 0, gain: 0.22 },
        { band: 1, gain: 0.18 },
        { band: 2, gain: 0.12 },
        { band: 3, gain: 0.06 },
        { band: 4, gain: 0.02 },
      ];
      await fm.applyPlayerFilters();
    },
  },

  nightcore: {
    label: 'cepat & tinggi',
    ffmpeg: 'asetrate=48000*1.25,aresample=48000',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.timescale = { speed: 1.2, pitch: 1.2, rate: 1 };
      await fm.applyPlayerFilters();
    },
  },

  vaporwave: {
    label: 'lambat & dreamy',
    ffmpeg: 'asetrate=48000*0.8,aresample=48000',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.timescale = { speed: 0.85, pitch: 0.85, rate: 1 };
      await fm.applyPlayerFilters();
    },
  },

  '8d': {
    label: 'audio muter',
    ffmpeg: 'apulsator=hz=0.09',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.rotation = { rotationHz: 0.2 };
      await fm.applyPlayerFilters();
    },
  },

  karaoke: {
    label: 'vokal diredam',
    ffmpeg: 'pan=stereo|c0=c0-c1|c1=c1-c0',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.karaoke = { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 };
      await fm.applyPlayerFilters();
    },
  },

  treble: {
    label: 'lebih cerah',
    ffmpeg: 'treble=g=8',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.equalizer = [
        { band: 10, gain: 0.2 },
        { band: 11, gain: 0.22 },
        { band: 12, gain: 0.24 },
        { band: 13, gain: 0.24 },
        { band: 14, gain: 0.2 },
      ];
      await fm.applyPlayerFilters();
    },
  },

  soft: {
    label: 'lebih halus',
    ffmpeg: 'lowpass=f=8000,volume=0.85',
    lavalink: async (fm) => {
      await fm.resetFilters();
      fm.data.lowPass = { smoothing: 20 };
      await fm.applyPlayerFilters();
    },
  },
};

export const FILTER_NAMES = Object.keys(FILTERS);

export const isFilterName = (name) => Object.prototype.hasOwnProperty.call(FILTERS, name);
