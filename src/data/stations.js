/**
 * Default 24/7 radio stations.
 * `kind: 'url'`   -> direct Icecast/HLS stream, FFmpeg reads it natively.
 * `kind: 'ytdlp'` -> YouTube live stream, yt-dlp resolves it (auto-refreshes URL).
 * Add your own with /radio add, or edit data/stations.json.
 */
export const DEFAULT_STATIONS = [
  {
    id: 'lofi',
    name: 'Lofi Girl — beats to relax/study to',
    url: 'https://www.youtube.com/watch?v=rFZHOHl-L8A',
    kind: 'ytdlp',
    tags: ['lofi', 'chill'],
  },
  {
    id: 'synthwave',
    name: 'Lofi Girl — synthwave radio',
    url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
    kind: 'ytdlp',
    tags: ['synthwave', 'retro'],
  },
  {
    id: 'groovesalad',
    name: 'SomaFM — Groove Salad',
    url: 'https://ice2.somafm.com/groovesalad-128-mp3',
    kind: 'url',
    tags: ['downtempo', 'chill'],
  },
  {
    id: 'dronezone',
    name: 'SomaFM — Drone Zone',
    url: 'https://ice2.somafm.com/dronezone-128-mp3',
    kind: 'url',
    tags: ['ambient', 'focus'],
  },
  {
    id: 'lush',
    name: 'SomaFM — Lush',
    url: 'https://ice2.somafm.com/lush-128-mp3',
    kind: 'url',
    tags: ['vocal', 'chill'],
  },
  {
    id: 'beatblender',
    name: 'SomaFM — Beat Blender',
    url: 'https://ice2.somafm.com/beatblender-128-mp3',
    kind: 'url',
    tags: ['house', 'deep'],
  },
  {
    id: 'defcon',
    name: 'SomaFM — DEF CON Radio',
    url: 'https://ice2.somafm.com/defcon-128-mp3',
    kind: 'url',
    tags: ['electronic', 'hacker'],
  },
  {
    id: 'indiepop',
    name: 'SomaFM — Indie Pop Rocks',
    url: 'https://ice2.somafm.com/indiepop-128-mp3',
    kind: 'url',
    tags: ['indie', 'pop'],
  },
  {
    id: 'radioparadise',
    name: 'Radio Paradise — Main Mix',
    url: 'https://stream.radioparadise.com/mp3-192',
    kind: 'url',
    tags: ['eclectic', 'rock'],
  },
  {
    id: 'nts',
    name: 'NTS Radio — Live 1',
    url: 'https://stream-relay-geo.ntslive.net/stream',
    kind: 'url',
    tags: ['eclectic', 'underground'],
  },
  {
    id: 'prambors',
    name: 'Prambors FM Jakarta',
    url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/PRAMBORS.mp3',
    kind: 'url',
    tags: ['indonesia', 'pop'],
  },
  {
    id: 'genfm',
    name: 'Gen FM Jakarta',
    url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/GENFM.mp3',
    kind: 'url',
    tags: ['indonesia', 'pop'],
  },
];
