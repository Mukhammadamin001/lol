/* Encore Music: a free music player that runs in the browser.
 *
 * Where the music comes from:
 *  - Apple catalog: the public iTunes Search API. Every song is searchable and
 *    plays as Apple's free 30-second preview.
 *  - Free Full Songs: Audius, where independent artists share complete tracks.
 *  - My Files: audio files you own, kept in this browser's IndexedDB.
 *
 * Liked songs, playlists and history live in localStorage on this device. */
'use strict';

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const fmtTime = (sec) => {
  if (!isFinite(sec) || sec < 0) sec = 0;
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
};
const fmtTotal = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hashHue = (str) => {
  let h = 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const isPhone = () => matchMedia('(max-width: 820px)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Saved state ---------- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('encore.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('encore.' + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: keep working in memory */
    }
  },
};

const state = {
  country: store.get('country', 'us'),
  liked: store.get('liked', []),
  playlists: store.get('playlists', []),
  recent: store.get('recent', []),
  searches: store.get('searches', []),
  volume: store.get('volume', 0.8),
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 'off'), // off | all | one
  source: store.get('source', 'apple'), // apple | free | library
};
const save = (...keys) => keys.forEach((k) => store.set(k, state[k]));
const likedKeys = new Set(state.liked.map((s) => s.key));

const COUNTRIES = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany',
  fr: 'France', es: 'Spain', it: 'Italy', nl: 'Netherlands', se: 'Sweden', br: 'Brazil',
  mx: 'Mexico', in: 'India', jp: 'Japan', kr: 'South Korea', tr: 'Türkiye', ae: 'UAE',
  uz: 'Uzbekistan', kz: 'Kazakhstan', ru: 'Russia', ng: 'Nigeria', za: 'South Africa',
};

// Apple genre ids, used for the per-genre charts.
const GENRES = [
  { id: 14, name: 'Pop', c: ['#ff4e7a', '#ff9a5a'] },
  { id: 18, name: 'Hip-Hop/Rap', c: ['#5b2bd6', '#c03ccf'] },
  { id: 15, name: 'R&B/Soul', c: ['#7a3cff', '#ff6fb5'] },
  { id: 21, name: 'Rock', c: ['#c0392b', '#4a1c1c'] },
  { id: 17, name: 'Dance', c: ['#00a6d6', '#6a5bff'] },
  { id: 7, name: 'Electronic', c: ['#0f9488', '#2cc76b'] },
  { id: 20, name: 'Alternative', c: ['#355c7d', '#6c5b7b'] },
  { id: 6, name: 'Country', c: ['#b8641f', '#e3a93a'] },
  { id: 12, name: 'Latin', c: ['#f0432a', '#e88a12'] },
  { id: 51, name: 'K-Pop', c: ['#f45cc8', '#8a6bff'] },
  { id: 11, name: 'Jazz', c: ['#2c3e50', '#a8752c'] },
  { id: 5, name: 'Classical', c: ['#5d4157', '#8aa79a'] },
  { id: 1153, name: 'Metal', c: ['#2a2a2a', '#7a1222'] },
  { id: 24, name: 'Reggae', c: ['#13863a', '#c9a40e'] },
  { id: 16, name: 'Soundtrack', c: ['#1b2a4a', '#4a6fa5'] },
  { id: 10, name: 'Singer/Songwriter', c: ['#8e6e53', '#c9935a'] },
  { id: 2, name: 'Blues', c: ['#1e3c72', '#2a5298'] },
  { id: 29, name: 'Anime', c: ['#ff6fa3', '#ff8a6b'] },
  { id: 19, name: 'World', c: ['#0f766e', '#6aa40f'] },
  { id: 4, name: "Children's Music", c: ['#e9851a', '#e6b800'] },
];

const FREE_GENRES = ['', 'Electronic', 'Hip-Hop/Rap', 'Pop', 'Lo-Fi', 'R&B/Soul', 'Rock', 'House', 'Ambient', 'Alternative', 'Latin', 'Jazz', 'Classical'];

/* ---------- Song models ---------- */
// One shape for every source, so lists, the queue and the library treat them alike.
function fromItunes(r) {
  return {
    key: 'it:' + r.trackId,
    source: 'itunes',
    id: r.trackId,
    title: r.trackName || 'Untitled',
    artist: r.artistName || 'Unknown Artist',
    album: r.collectionName || '',
    albumId: r.collectionId || null,
    artistId: r.artistId || null,
    art: r.artworkUrl100 || r.artworkUrl60 || '',
    duration: (r.trackTimeMillis || 0) / 1000,
    url: r.previewUrl || '',
    preview: true,
    explicit: r.trackExplicitness === 'explicit',
    trackNumber: r.trackNumber || 0,
    disc: r.discNumber || 1,
    link: r.trackViewUrl || '',
  };
}

function albumFromItunes(r) {
  return {
    id: r.collectionId,
    title: r.collectionName || 'Untitled',
    artist: r.artistName || '',
    artistId: r.artistId || null,
    art: r.artworkUrl100 || '',
    year: (r.releaseDate || '').slice(0, 4),
    date: r.releaseDate || '',
    genre: r.primaryGenreName || '',
    explicit: r.collectionExplicitness === 'explicit',
    copyright: r.copyright || '',
    link: r.collectionViewUrl || '',
  };
}

function fromAudius(t) {
  return {
    key: 'au:' + t.id,
    source: 'audius',
    id: t.id,
    title: t.title || 'Untitled',
    artist: t.user?.name || 'Unknown Artist',
    album: '',
    genre: t.genre || '',
    art: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
    duration: t.duration || 0,
    preview: false,
    explicit: false,
    link: t.permalink ? 'https://audius.co' + t.permalink : '',
  };
}

function fromLocal(rec) {
  return {
    key: 'lf:' + rec.id,
    source: 'local',
    id: rec.id,
    title: rec.title,
    artist: rec.artist,
    album: rec.album || '',
    art: '',
    duration: rec.duration || 0,
    preview: false,
    explicit: false,
  };
}

const isPlayable = (s) => !!s && (s.source !== 'itunes' || !!s.url);

// Every song shown anywhere, by key, so buttons can find their song.
const songs = new Map();
// Lists rendered in the current view, so a click knows what to queue.
const lists = new Map();
let listSeq = 0;
function registerList(arr) {
  const id = 'l' + ++listSeq;
  lists.set(id, arr);
  arr.forEach((s) => songs.set(s.key, s));
  return id;
}

/* ---------- Network ---------- */
async function fetchJSON(url, timeout = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// The iTunes Search API answers JSONP, which works from any page, even file://.
let jsonpSeq = 0;
function jsonp(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const name = `__encoreJsonp${++jsonpSeq}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(new Error('The music catalog took too long to answer. Check your connection and try again.')), timeout);
    function finish(err, data) {
      clearTimeout(timer);
      window[name] = () => {}; // a late answer must not throw
      setTimeout(() => delete window[name], 60000);
      script.remove();
      if (err) reject(err);
      else resolve(data);
    }
    window[name] = (data) => finish(null, data);
    script.onerror = () => finish(new Error('Could not reach the music catalog. Check your connection and try again.'));
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`;
    document.head.append(script);
  });
}

const itunes = {
  async search(term, entity = 'song', limit = 50) {
    const q = new URLSearchParams({ term, media: 'music', entity, limit, country: state.country });
    return (await jsonp(`https://itunes.apple.com/search?${q}`)).results || [];
  },
  async lookup(ids, params = {}) {
    const q = new URLSearchParams({ country: state.country, ...params });
    return (await jsonp(`https://itunes.apple.com/lookup?id=${ids}&${q}`)).results || [];
  },
};

// Chart feeds give ids only, so the songs are then looked up in the catalog.
async function chartIds(kind, limit, genreId) {
  const cc = state.country;
  const feeds = [];
  if (!genreId) {
    feeds.push([
      `https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/${limit}/${kind}.json`,
      (d) => d.feed.results.map((x) => x.id),
    ]);
  }
  const name = kind === 'songs' ? 'topsongs' : 'topalbums';
  feeds.push([
    `https://itunes.apple.com/${cc}/rss/${name}/limit=${limit}${genreId ? '/genre=' + genreId : ''}/json`,
    (d) => [].concat(d.feed.entry || []).map((e) => e.id.attributes['im:id']),
  ]);
  for (const [url, pick] of feeds) {
    try {
      const ids = pick(await fetchJSON(url));
      if (ids.length) return ids;
    } catch {
      /* try the next feed */
    }
  }
  return [];
}

async function chartSongs(limit, genreId) {
  const ids = await chartIds('songs', limit, genreId);
  if (!ids.length) return [];
  const found = await itunes.lookup(ids.join(','));
  const byId = new Map(found.filter((r) => r.wrapperType === 'track').map((r) => [String(r.trackId), fromItunes(r)]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

async function chartAlbums(limit, genreId) {
  const ids = await chartIds('albums', limit, genreId);
  if (!ids.length) return [];
  const found = await itunes.lookup(ids.join(','));
  const byId = new Map(found.filter((r) => r.wrapperType === 'collection').map((r) => [String(r.collectionId), albumFromItunes(r)]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
}

const AUDIUS_APP = 'EncoreMusic';
const audius = {
  base: 'https://api.audius.co/v1',
  async get(path, params = {}) {
    const qs = new URLSearchParams({ ...params, app_name: AUDIUS_APP });
    try {
      return (await fetchJSON(`${this.base}${path}?${qs}`)).data || [];
    } catch {
      /* fall back to asking the gateway for its list of hosts */
    }
    try {
      const { data: hosts = [] } = await fetchJSON('https://api.audius.co');
      for (const host of shuffled(hosts).slice(0, 3)) {
        const base = String(host).replace(/\/$/, '') + '/v1';
        try {
          const res = await fetchJSON(`${base}${path}?${qs}`);
          this.base = base;
          return res.data || [];
        } catch {
          /* next host */
        }
      }
    } catch {
      /* gateway unreachable */
    }
    throw new Error('The free music service is not answering right now. Try again in a minute.');
  },
  async trending(genre) {
    return clean(await this.get('/tracks/trending', genre ? { genre, time: 'week' } : { time: 'week' }));
  },
  async search(query) {
    return clean(await this.get('/tracks/search', { query }));
  },
  streamUrl(id) {
    return `${this.base}/tracks/${encodeURIComponent(id)}/stream?app_name=${AUDIUS_APP}`;
  },
};
function clean(tracks) {
  return tracks.filter((t) => t && t.is_streamable !== false && !t.is_stream_gated && !t.is_delete).map(fromAudius);
}

async function fetchLyrics(song) {
  const title = song.title
    .replace(/\s*[([](feat|ft|with|prod)\.?[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '')
    .trim();
  const q = new URLSearchParams({ track_name: title, artist_name: song.artist.split(/,|&| feat\.? /i)[0].trim() });
  const res = await fetchJSON(`https://lrclib.net/api/search?${q}`);
  return (Array.isArray(res) ? res : []).find((r) => r.syncedLyrics || r.plainLyrics || r.instrumental) || null;
}

/* ---------- My Files (IndexedDB) ---------- */
const localDb = {
  db: null,
  open() {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open('encore-music', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.db;
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
  all() { return this.run('readonly', (s) => s.getAll()); },
  get(id) { return this.run('readonly', (s) => s.get(id)); },
  put(rec) { return this.run('readwrite', (s) => s.put(rec)); },
  del(id) { return this.run('readwrite', (s) => s.delete(id)); },
};

let localSongs = [];
const localArt = new Map(); // file id -> object URL of its embedded cover
let localReady = Promise.resolve();

async function loadLocal() {
  try {
    const recs = await localDb.all();
    recs.sort((a, b) => b.added - a.added).forEach((rec) => registerLocal(rec, false));
  } catch {
    /* storage unavailable: My Files stays empty */
  }
}

function registerLocal(rec, atStart) {
  if (rec.art) localArt.set(rec.id, URL.createObjectURL(rec.art));
  const song = fromLocal(rec);
  if (atStart) localSongs.unshift(song);
  else localSongs.push(song);
  songs.set(song.key, song);
}

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;

async function importFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
  if (!files.length) {
    toast('Choose audio files such as MP3, M4A, WAV or FLAC.');
    return;
  }
  toast(`Adding ${plural(files.length, 'song')}…`);
  let added = 0;
  for (const file of files) {
    try {
      const tags = await readId3(file).catch(() => ({}));
      const base = file.name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}\s*[._-]\s*/, '');
      const [artist, title] = base.includes(' - ') ? base.split(/ - (.+)/) : ['', base];
      const rec = {
        id: uid(),
        title: (tags.title || title || file.name).trim(),
        artist: (tags.artist || artist || 'Unknown Artist').trim(),
        album: (tags.album || '').trim(),
        duration: await probeDuration(file),
        added: Date.now(),
        blob: file,
        art: tags.picture || null,
      };
      await localDb.put(rec);
      registerLocal(rec, true);
      added++;
    } catch (err) {
      console.warn('Could not add', file.name, err);
    }
  }
  if (added) toast(`Added ${plural(added, 'song')} to My Files`);
  else toast('This browser would not save the files. Private windows often block storage; try a regular window.');
  if (currentRoute === 'files' || currentRoute === 'library') refresh();
  else location.hash = '#/files';
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    const timer = setTimeout(() => done(0), 8000);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      clearTimeout(timer);
      done(probe.duration);
    };
    probe.onerror = () => {
      clearTimeout(timer);
      done(0);
    };
    probe.src = url;
  });
}

// Reads title, artist, album and cover art from an MP3's ID3v2.3/2.4 tag.
async function readId3(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return {};
  const ver = head[3];
  if (ver < 3) return {};
  const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
  const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const size = syncsafe(head, 6);
  const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  let p = 0;
  if (head[5] & 0x40) p = ver === 4 ? syncsafe(buf, 0) : be32(buf, 0) + 4; // skip extended header
  const out = {};
  while (p + 10 <= buf.length) {
    const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? syncsafe(buf, p + 4) : be32(buf, p + 4);
    const start = p + 10;
    const end = start + len;
    if (len <= 0 || end > buf.length) break;
    const data = buf.subarray(start, end);
    if (id === 'TIT2') out.title = id3Text(data);
    else if (id === 'TPE1') out.artist = id3Text(data);
    else if (id === 'TALB') out.album = id3Text(data);
    else if (id === 'APIC' && !out.picture) out.picture = id3Picture(data);
    p = end;
  }
  return out;
}

function id3Decode(bytes, enc) {
  let label = 'iso-8859-1';
  if (enc === 3) label = 'utf-8';
  else if (enc === 2) label = 'utf-16be';
  else if (enc === 1) label = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le';
  return new TextDecoder(label).decode(bytes).replace(/^﻿/, '');
}

function id3Text(data) {
  return id3Decode(data.subarray(1), data[0]).split('\0')[0].trim();
}

function id3Picture(data) {
  const enc = data[0];
  let i = 1;
  const mimeEnd = data.indexOf(0, i);
  if (mimeEnd < 0) return null;
  let mime = id3Decode(data.subarray(i, mimeEnd), 0) || 'image/jpeg';
  if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
  i = mimeEnd + 2; // terminator + picture type
  if (enc === 1 || enc === 2) {
    while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < data.length && data[i] !== 0) i++;
    i += 1;
  }
  return i < data.length ? new Blob([data.slice(i)], { type: mime }) : null;
}

/* ---------- Rendering helpers ---------- */
function sizeArt(url, size) {
  return url ? url.replace(/\/\d+x\d+(bb|cc)?(-\d+)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.jpg`) : '';
}

function artSrc(song, size) {
  if (!song) return '';
  if (song.source === 'local') return localArt.get(song.id) || '';
  if (song.source === 'itunes') return sizeArt(song.art, size);
  return song.art || '';
}

function artBox(src, seed, cls = '', inner = '') {
  const img = src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : icon('note', 'art-glyph');
  return `<div class="art ${cls}" style="--h:${hashHue(seed)}">${img}${inner}</div>`;
}

function artistLink(song) {
  return song.source === 'itunes' && song.artistId
    ? `<a href="#/artist/${song.artistId}">${esc(song.artist)}</a>`
    : esc(song.artist);
}

function albumText(song) {
  if (song.source === 'itunes' && song.albumId) return `<a href="#/album/${song.albumId}">${esc(song.album)}</a>`;
  if (song.source === 'audius') return esc(song.genre || 'Audius');
  return esc(song.album || 'My Files');
}

// Catalog songs are all previews, so only full-length Audius tracks get a tag.
function sourceChip(song) {
  return song.source === 'audius' ? '<span class="chip chip-full">Full</span>' : '';
}

function likeBtn(song, extra = '') {
  const on = likedKeys.has(song.key);
  return `<button class="icon-btn like${on ? ' on' : ''} ${extra}" data-like="${esc(song.key)}" aria-pressed="${on}" aria-label="${on ? 'Unlike' : 'Like'}">${icon(on ? 'heart-fill' : 'heart')}</button>`;
}

const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

// mode: list (art, title, album, time) · chart (art, rank, title) · track (number, title, time)
function songRow(song, listId, i, mode = 'list', albumArtist = '') {
  const overlay = `<span class="row-overlay">${icon('play')}${EQ}</span>`;
  const lead = mode === 'track'
    ? `<div class="row-num"><span class="row-n">${song.trackNumber || i + 1}</span>${overlay}</div>`
    : artBox(artSrc(song, 120), song.key, 'row-art', overlay) + (mode === 'chart' ? `<div class="row-rank">${i + 1}</div>` : '');
  const sub = mode === 'track' ? (song.artist !== albumArtist ? artistLink(song) : '') : artistLink(song);
  return `<div class="row row-${mode}${isPlayable(song) ? '' : ' is-disabled'}" data-list="${listId}" data-index="${i}" data-key="${esc(song.key)}" role="button" tabindex="0">
    ${lead}
    <div class="row-main">
      <div class="row-title"><span class="row-title-text">${esc(song.title)}</span>${song.explicit ? '<span class="badge-e" title="Explicit">E</span>' : ''}${mode === 'track' ? '' : sourceChip(song)}</div>
      ${sub ? `<div class="row-sub">${sub}</div>` : ''}
    </div>
    ${mode === 'list' ? `<div class="row-album">${albumText(song)}</div>` : ''}
    ${mode === 'chart' ? '' : `<div class="row-dur">${song.duration ? fmtTime(song.duration) : ''}</div>${likeBtn(song)}`}
    <button class="icon-btn row-more" data-more="${esc(song.key)}" aria-label="More options for ${esc(song.title)}">${icon('more')}</button>
  </div>`;
}

function rowsHtml(list, mode = 'list', albumArtist = '') {
  const id = registerList(list);
  return list.map((s, i) => songRow(s, id, i, mode, albumArtist)).join('');
}

function songCard(song, listId, i) {
  return `<div class="card" data-list="${listId}" data-index="${i}" data-key="${esc(song.key)}" role="button" tabindex="0">
    <div class="card-art">${artBox(artSrc(song, 400), song.key)}<span class="card-play">${icon('play')}</span></div>
    <div class="card-title"><span>${esc(song.title)}</span></div>
    <div class="card-sub">${esc(song.artist)}</div>
  </div>`;
}

function cardsHtml(list) {
  const id = registerList(list);
  return list.map((s, i) => songCard(s, id, i)).join('');
}

function albumCard(a) {
  return `<a class="card" href="#/album/${a.id}">
    <div class="card-art">${artBox(sizeArt(a.art, 400), 'al' + a.id)}</div>
    <div class="card-title"><span>${esc(a.title)}</span>${a.explicit ? '<span class="badge-e" title="Explicit">E</span>' : ''}</div>
    <div class="card-sub">${esc(a.artist)}${a.year ? ' · ' + esc(a.year) : ''}</div>
  </a>`;
}

function artistCard(ar) {
  return `<a class="card card-artist" href="#/artist/${ar.artistId}">
    <div class="card-art"><div class="art round" style="--h:${hashHue(ar.artistName)}"><span class="initials">${esc(initials(ar.artistName))}</span></div></div>
    <div class="card-title"><span>${esc(ar.artistName)}</span></div>
    <div class="card-sub">${esc(ar.primaryGenreName || 'Artist')}</div>
  </a>`;
}

function playlistArt(pl, cls = '') {
  const srcs = [...new Set(pl.songs.map((s) => artSrc(s, 300)).filter(Boolean))];
  if (srcs.length >= 4) {
    return `<div class="art collage ${cls}">${srcs.slice(0, 4).map((s) => `<img src="${esc(s)}" alt="" loading="lazy">`).join('')}</div>`;
  }
  if (srcs.length) return artBox(srcs[0], pl.id, cls);
  return `<div class="art art-playlist ${cls}" style="--h:${hashHue(pl.name)}">${icon('list')}</div>`;
}

function playlistCard(pl) {
  return `<a class="card" href="#/playlist/${pl.id}">
    <div class="card-art">${playlistArt(pl)}</div>
    <div class="card-title"><span>${esc(pl.name)}</span></div>
    <div class="card-sub">${plural(pl.songs.length, 'song')}</div>
  </a>`;
}

function genreTile(g) {
  return `<a class="genre" href="#/genre/${g.id}" style="--c1:${g.c[0]};--c2:${g.c[1]}"><span>${esc(g.name)}</span></a>`;
}

function scrollButtons(target) {
  return `<div class="scroll-btns">
    <button class="icon-btn" data-action="scroll" data-target="${target}" data-dir="-1" aria-label="Scroll back">${icon('chev-left')}</button>
    <button class="icon-btn" data-action="scroll" data-target="${target}" data-dir="1" aria-label="Scroll forward">${icon('chev-right')}</button>
  </div>`;
}

const skeletonRows = (n) => Array.from({ length: n }, () =>
  '<div class="row row-skel"><div class="skel skel-art"></div><div class="row-main"><div class="skel skel-line"></div><div class="skel skel-line short"></div></div></div>').join('');
const skeletonCards = (n) => Array.from({ length: n }, () =>
  '<div class="card"><div class="card-art"><div class="skel skel-square"></div></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>').join('');
const skeletonHero = () => `<header class="hero"><div class="skel skel-hero"></div><div class="hero-text" style="flex:1"><div class="skel skel-line" style="width:40%;height:28px"></div><div class="skel skel-line short"></div></div></header><div class="list">${skeletonRows(8)}</div>`;

function emptyState(ic, title, text, extra = '') {
  return `<div class="empty"><div class="empty-icon">${icon(ic)}</div><h3>${esc(title)}</h3>${text ? `<p>${text}</p>` : ''}${extra}</div>`;
}

function errorState(message) {
  return emptyState('alert', 'Couldn’t load this', esc(message), `<button class="btn" data-action="retry">Try Again</button>`);
}

function fail(box, err) {
  if (!box) return;
  box.classList.add('is-error');
  box.innerHTML = errorState(err?.message || 'Something went wrong.');
}

function playButtons(listId, count) {
  const off = count ? '' : ' disabled';
  return `<button class="btn primary" data-action="play-list" data-list="${listId}"${off}>${icon('play')}Play</button>
    <button class="btn primary" data-action="shuffle-list" data-list="${listId}"${off}>${icon('shuffle')}Shuffle</button>`;
}

/* ---------- Views ---------- */
const view = $('#view');
let renderSeq = 0;
let currentRoute = '';
const stale = (token) => token !== renderSeq;

function setView(html) {
  view.innerHTML = html;
  markCurrent();
}

function refresh() {
  const top = view.scrollTop;
  route();
  view.scrollTop = top;
}

const ROUTES = [
  [/^browse$/, viewBrowse],
  [/^free$/, viewFree],
  [/^search(?:\/(.*))?$/, (t, q) => viewSearch(t, q ? safeDecode(q) : '')],
  [/^genre\/(\d+)$/, (t, id) => viewGenre(t, Number(id))],
  [/^album\/(\d+)$/, viewAlbum],
  [/^artist\/(\d+)$/, viewArtist],
  [/^library$/, viewLibrary],
  [/^liked$/, viewLiked],
  [/^recent$/, viewRecent],
  [/^files$/, viewFiles],
  [/^playlist\/([\w-]+)$/, viewPlaylist],
];

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function route() {
  const path = location.hash.replace(/^#\/?/, '') || 'browse';
  const token = ++renderSeq;
  lists.clear();
  closeMenu();
  currentRoute = path;
  view.scrollTop = 0;
  highlightNav(path);
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) {
      fn(token, ...m.slice(1));
      return;
    }
  }
  location.replace('#/browse');
}

function highlightNav(path) {
  const top = path.split('/')[0];
  const libraryTops = ['library', 'liked', 'recent', 'files', 'playlist'];
  $$('[data-nav]').forEach((a) => {
    const nav = a.dataset.nav;
    const on = nav === path || nav === top || (nav === 'browse' && top === 'genre') || (nav === 'library' && libraryTops.includes(top));
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function countryPicker() {
  const opts = Object.entries(COUNTRIES)
    .map(([cc, name]) => `<option value="${cc}"${cc === state.country ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');
  return `<label class="country" for="country-select">${icon('globe')}<span class="sr-only">Store country</span><select id="country-select">${opts}</select></label>`;
}

function viewBrowse(token) {
  setView(`
    <header class="page-head">
      <div class="page-head-text">
        <h1>Browse</h1>
        <p class="lede">Every song in the Apple Music catalog, free to play as a 30-second preview. For complete songs, open <a href="#/free">Free Full Songs</a> or add your own in <a href="#/files">My Files</a>.</p>
      </div>
      ${countryPicker()}
    </header>
    <section class="section">
      <div class="section-head">
        <h2 id="top-songs-title">Top Songs</h2>
        <button class="btn small" id="top-songs-play" data-action="play-list" disabled>${icon('play')}Play</button>
        ${scrollButtons('top-songs')}
      </div>
      <div class="chart-grid" id="top-songs">${skeletonRows(12)}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Top Albums</h2>${scrollButtons('top-albums')}</div>
      <div class="shelf" id="top-albums">${skeletonCards(8)}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Browse by Genre</h2></div>
      <div class="genre-grid">${GENRES.map(genreTile).join('')}</div>
    </section>`);

  (async () => {
    const box = $('#top-songs');
    try {
      let list = await chartSongs(48);
      let title = 'Top Songs';
      if (!list.length) {
        list = (await itunes.search('top hits', 'song', 48)).map(fromItunes);
        title = 'Popular Songs';
      }
      if (stale(token)) return;
      $('#top-songs-title').textContent = title;
      const id = registerList(list);
      box.innerHTML = list.map((s, i) => songRow(s, id, i, 'chart')).join('');
      const play = $('#top-songs-play');
      play.dataset.list = id;
      play.disabled = !list.length;
      markCurrent();
    } catch (err) {
      if (!stale(token)) fail(box, err);
    }
  })();

  (async () => {
    const box = $('#top-albums');
    try {
      let albums = await chartAlbums(24);
      if (!albums.length) albums = (await itunes.search('greatest hits', 'album', 24)).map(albumFromItunes);
      if (stale(token)) return;
      box.innerHTML = albums.map(albumCard).join('');
    } catch (err) {
      if (!stale(token)) fail(box, err);
    }
  })();
}

async function viewGenre(token, id) {
  const g = GENRES.find((x) => x.id === id);
  if (!g) {
    location.replace('#/browse');
    return;
  }
  setView(`
    <header class="genre-banner" style="--c1:${g.c[0]};--c2:${g.c[1]}">
      <a class="back" href="#/browse">${icon('chev-left')}Browse</a>
      <h1>${esc(g.name)}</h1>
      <p>The most played ${esc(g.name)} songs and albums right now.</p>
    </header>
    <section class="section">
      <div class="section-head"><h2>Top Songs</h2><button class="btn small" id="genre-play" data-action="play-list" disabled>${icon('play')}Play</button></div>
      <div class="list" id="genre-songs">${skeletonRows(10)}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Albums</h2>${scrollButtons('genre-albums')}</div>
      <div class="shelf" id="genre-albums">${skeletonCards(8)}</div>
    </section>`);

  const [songsRes, albumsRes] = await Promise.allSettled([
    chartSongs(50, g.id).then(async (l) => (l.length ? l : (await itunes.search(g.name, 'song', 50)).map(fromItunes))),
    chartAlbums(20, g.id).then(async (l) => (l.length ? l : (await itunes.search(g.name, 'album', 20)).map(albumFromItunes))),
  ]);
  if (stale(token)) return;
  const songBox = $('#genre-songs');
  if (songsRes.status === 'fulfilled') {
    const list = songsRes.value;
    const lid = registerList(list);
    songBox.innerHTML = list.length ? list.map((s, i) => songRow(s, lid, i)).join('') : emptyState('note', 'No songs here yet', '');
    const play = $('#genre-play');
    play.dataset.list = lid;
    play.disabled = !list.length;
  } else fail(songBox, songsRes.reason);
  const albumBox = $('#genre-albums');
  if (albumsRes.status === 'fulfilled') albumBox.innerHTML = albumsRes.value.map(albumCard).join('');
  else fail(albumBox, albumsRes.reason);
  markCurrent();
}

/* Free Full Songs (Audius) */
let freeGenre = '';
let freeQuery = '';
let freeSeq = 0;

function viewFree() {
  setView(`
    <header class="page-head">
      <div class="page-head-text">
        <h1>Free Full Songs</h1>
        <p class="lede">Complete tracks that independent artists share for free on Audius. No account, no subscription and no time limit.</p>
      </div>
    </header>
    <div class="search-tools">
      <form class="search-box" id="free-form" role="search">${icon('search')}<input id="free-input" type="search" placeholder="Search free songs" autocomplete="off" enterkeyhint="search" value="${esc(freeQuery)}" aria-label="Search free songs"></form>
      <div class="chips" id="free-genres">${FREE_GENRES.map((g) => `<button class="chip-btn" data-action="free-genre" data-genre="${esc(g)}">${esc(g || 'All')}</button>`).join('')}</div>
    </div>
    <section class="section">
      <div class="section-head"><h2 id="free-title">Trending This Week</h2><button class="btn small" id="free-play" data-action="play-list" disabled>${icon('play')}Play</button></div>
      <div class="list" id="free-list">${skeletonRows(10)}</div>
    </section>`);
  loadFree();
}

async function loadFree() {
  const seq = ++freeSeq;
  const box = $('#free-list');
  if (!box) return;
  box.classList.remove('is-error');
  $$('#free-genres .chip-btn').forEach((b) => b.classList.toggle('on', b.dataset.genre === freeGenre && !freeQuery));
  $('#free-title').textContent = freeQuery ? `Results for “${freeQuery}”` : freeGenre ? `Trending in ${freeGenre}` : 'Trending This Week';
  box.innerHTML = skeletonRows(10);
  const play = $('#free-play');
  play.disabled = true;
  try {
    const list = freeQuery ? await audius.search(freeQuery) : await audius.trending(freeGenre);
    if (seq !== freeSeq || !box.isConnected) return;
    if (!list.length) {
      box.innerHTML = emptyState('search', 'No songs found', 'Try another search or pick a different genre.');
      return;
    }
    const id = registerList(list);
    box.innerHTML = list.map((s, i) => songRow(s, id, i)).join('');
    play.dataset.list = id;
    play.disabled = false;
    markCurrent();
  } catch (err) {
    if (seq === freeSeq && box.isConnected) {
      fail(box, err);
      box.insertAdjacentHTML('beforeend', '<p class="muted" style="text-align:center">You can still add your own music in <a class="link-btn" href="#/files">My Files</a>.</p>');
    }
  }
}

/* Search */
let searchQuery = '';
let searchSeq = 0;
const SOURCES = [['apple', 'Apple Catalog'], ['free', 'Free Full Songs'], ['library', 'Your Library']];

function viewSearch(token, q = '') {
  searchQuery = q;
  setView(`
    <header class="page-head"><div class="page-head-text"><h1>Search</h1></div></header>
    <div class="search-tools">
      <form class="search-box" id="search-form" role="search">${icon('search')}<input id="search-input" type="search" placeholder="Artists, songs, albums" autocomplete="off" enterkeyhint="search" value="${esc(q)}" aria-label="Search"></form>
      <div class="seg" role="tablist" aria-label="Where to search">
        ${SOURCES.map(([k, label]) => `<button role="tab" class="seg-btn${state.source === k ? ' on' : ''}" aria-selected="${state.source === k}" data-action="source" data-source="${k}">${label}</button>`).join('')}
      </div>
    </div>
    <div class="results" id="search-results"></div>`);
  const side = $('#side-search');
  if (document.activeElement !== side && side.value !== q) side.value = q;
  if (!q) (isPhone() ? $('#search-input') : side).focus({ preventScroll: true });
  runSearch(q);
}

async function runSearch(raw) {
  const q = raw.trim();
  const seq = ++searchSeq;
  const box = $('#search-results');
  if (!box) return;
  if (!q) {
    box.innerHTML = searchHome();
    return;
  }
  if (state.source === 'library') {
    box.innerHTML = librarySearch(q);
    markCurrent();
    return;
  }
  box.innerHTML = `<div class="list">${skeletonRows(8)}</div>`;
  try {
    if (state.source === 'free') {
      const list = await audius.search(q);
      if (seq !== searchSeq) return;
      box.innerHTML = list.length
        ? `<section class="section"><div class="section-head"><h2>Full Songs</h2></div><div class="list">${rowsHtml(list)}</div></section>`
        : emptyState('search', `No free songs match “${esc(q)}”`, 'Free Full Songs only has music that artists upload to Audius. Try the Apple Catalog for everything else.');
    } else {
      const [s, a, r] = await Promise.allSettled([
        itunes.search(q, 'song', 30),
        itunes.search(q, 'album', 16),
        itunes.search(q, 'musicArtist', 10),
      ]);
      if (seq !== searchSeq) return;
      if (s.status === 'rejected' && a.status === 'rejected' && r.status === 'rejected') throw s.reason;
      const songList = s.status === 'fulfilled' ? s.value.filter((x) => x.wrapperType === 'track').map(fromItunes) : [];
      const albums = a.status === 'fulfilled' ? a.value.map(albumFromItunes) : [];
      const artists = r.status === 'fulfilled' ? r.value.filter((x) => x.artistId) : [];
      if (!songList.length && !albums.length && !artists.length) {
        box.innerHTML = emptyState('search', `No results for “${esc(q)}”`, 'Check the spelling, or try the store country selector on Browse.');
        return;
      }
      let html = '';
      if (songList.length) html += `<section class="section"><div class="section-head"><h2>Songs</h2></div><div class="list">${rowsHtml(songList)}</div></section>`;
      if (albums.length) html += `<section class="section"><div class="section-head"><h2>Albums</h2>${scrollButtons('res-albums')}</div><div class="shelf" id="res-albums">${albums.map(albumCard).join('')}</div></section>`;
      if (artists.length) html += `<section class="section"><div class="section-head"><h2>Artists</h2>${scrollButtons('res-artists')}</div><div class="shelf" id="res-artists">${artists.map(artistCard).join('')}</div></section>`;
      box.innerHTML = html;
    }
    markCurrent();
  } catch (err) {
    if (seq === searchSeq) box.innerHTML = errorState(err.message);
  }
}

function searchHome() {
  const recent = state.searches.length
    ? `<section class="section"><div class="section-head"><h2>Recent Searches</h2></div><div class="recent-searches">${state.searches
        .map((term) => `<div class="rs"><button class="rs-term" data-action="search-term" data-q="${esc(term)}">${icon('clock')}<span>${esc(term)}</span></button><button class="icon-btn" data-action="forget-search" data-q="${esc(term)}" aria-label="Remove ${esc(term)}">${icon('close')}</button></div>`)
        .join('')}</div></section>`
    : '';
  return `${recent}<section class="section"><div class="section-head"><h2>Browse by Genre</h2></div><div class="genre-grid">${GENRES.map(genreTile).join('')}</div></section>`;
}

function libraryPool() {
  const seen = new Map();
  [...state.liked, ...state.playlists.flatMap((p) => p.songs), ...localSongs, ...state.recent].forEach((s) => {
    if (!seen.has(s.key)) seen.set(s.key, s);
  });
  return [...seen.values()];
}

function librarySearch(q) {
  const needle = q.toLowerCase();
  const match = (s) => [s.title, s.artist, s.album].some((v) => String(v || '').toLowerCase().includes(needle));
  const hits = libraryPool().filter(match);
  const pls = state.playlists.filter((p) => p.name.toLowerCase().includes(needle));
  if (!hits.length && !pls.length) {
    return emptyState('library', `Nothing in your library matches “${esc(q)}”`, 'Your library is your liked songs, playlists, files and recently played songs.');
  }
  let html = '';
  if (pls.length) html += `<section class="section"><div class="section-head"><h2>Playlists</h2></div><div class="card-grid">${pls.map(playlistCard).join('')}</div></section>`;
  if (hits.length) html += `<section class="section"><div class="section-head"><h2>Songs</h2></div><div class="list">${rowsHtml(hits)}</div></section>`;
  return html;
}

function saveSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  state.searches = [q, ...state.searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  save('searches');
}

/* Album */
async function viewAlbum(token, id) {
  setView(skeletonHero());
  try {
    const res = await itunes.lookup(id, { entity: 'song', limit: 200 });
    if (stale(token)) return;
    const c = res.find((r) => r.wrapperType === 'collection');
    if (!c) throw new Error('This album isn’t available in the selected store country.');
    const album = albumFromItunes(c);
    const tracks = res
      .filter((r) => r.wrapperType === 'track')
      .map(fromItunes)
      .sort((a, b) => a.disc - b.disc || a.trackNumber - b.trackNumber);
    const listId = registerList(tracks);
    const multiDisc = new Set(tracks.map((t) => t.disc)).size > 1;
    let body = '';
    tracks.forEach((t, i) => {
      if (multiDisc && (i === 0 || tracks[i - 1].disc !== t.disc)) body += `<div class="disc">Disc ${t.disc}</div>`;
      body += songRow(t, listId, i, 'track', album.artist);
    });
    const total = tracks.reduce((sum, t) => sum + t.duration, 0);
    const released = album.date ? new Date(album.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    setView(`
      <header class="hero">
        ${artBox(sizeArt(album.art, 600), 'al' + album.id, 'hero-art')}
        <div class="hero-text">
          <div class="eyebrow">Album</div>
          <h1>${esc(album.title)}</h1>
          ${album.artistId ? `<a class="hero-artist" href="#/artist/${album.artistId}">${esc(album.artist)}</a>` : `<span class="hero-artist">${esc(album.artist)}</span>`}
          <div class="hero-meta">${[album.genre, album.year].filter(Boolean).map(esc).join(' · ')} · 30-second previews</div>
          <div class="hero-actions">
            ${playButtons(listId, tracks.some(isPlayable))}
            ${album.link ? `<a class="btn ghost" href="${esc(album.link)}" target="_blank" rel="noopener">${icon('external')}Apple Music</a>` : ''}
          </div>
        </div>
      </header>
      <div class="list">${body}</div>
      <p class="list-foot">${released ? esc(released) + '<br>' : ''}${plural(tracks.length, 'song')}, ${fmtTotal(total)}${album.copyright ? '<br>' + esc(album.copyright) : ''}</p>`);
  } catch (err) {
    if (!stale(token)) setView(errorState(err.message));
  }
}

/* Artist */
async function viewArtist(token, id) {
  setView(skeletonHero());
  try {
    const [songRes, albumRes] = await Promise.all([
      itunes.lookup(id, { entity: 'song', limit: 100 }),
      itunes.lookup(id, { entity: 'album', limit: 100 }),
    ]);
    if (stale(token)) return;
    const artist = songRes.concat(albumRes).find((r) => r.wrapperType === 'artist');
    if (!artist) throw new Error('This artist isn’t available in the selected store country.');
    const seenSongs = new Set();
    const top = songRes
      .filter((r) => r.wrapperType === 'track' && r.previewUrl)
      .map(fromItunes)
      .filter((s) => {
        const k = s.title.toLowerCase();
        if (seenSongs.has(k)) return false;
        seenSongs.add(k);
        return true;
      })
      .slice(0, 40);
    const seenAlbums = new Set();
    const albums = albumRes
      .filter((r) => r.wrapperType === 'collection')
      .map(albumFromItunes)
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((a) => {
        const k = a.title.toLowerCase();
        if (seenAlbums.has(k)) return false;
        seenAlbums.add(k);
        return true;
      });
    const cover = sizeArt(albums[0]?.art || top[0]?.art || '', 600);
    const listId = registerList(top);
    setView(`
      <header class="artist-hero" style="--h:${hashHue(artist.artistName)}">
        ${cover ? `<img class="artist-hero-bg" src="${esc(cover)}" alt="">` : ''}
        <div class="art round" style="--h:${hashHue(artist.artistName)}"><span class="initials">${esc(initials(artist.artistName))}</span></div>
        <div class="artist-hero-text">
          <div class="eyebrow">${esc(artist.primaryGenreName || 'Artist')}</div>
          <h1>${esc(artist.artistName)}</h1>
          <div class="hero-actions">${playButtons(listId, top.length)}</div>
        </div>
      </header>
      ${top.length ? `<section class="section"><div class="section-head"><h2>Top Songs</h2>${scrollButtons('artist-top')}</div><div class="chart-grid" id="artist-top">${top.map((s, i) => songRow(s, listId, i, 'chart')).join('')}</div></section>` : ''}
      ${albums.length ? `<section class="section"><div class="section-head"><h2>Albums</h2></div><div class="card-grid">${albums.map(albumCard).join('')}</div></section>` : ''}`);
  } catch (err) {
    if (!stale(token)) setView(errorState(err.message));
  }
}

/* Library */
async function viewLibrary(token) {
  await localReady;
  if (stale(token)) return;
  const recent = state.recent.slice(0, 16);
  setView(`
    <header class="page-head"><div class="page-head-text"><h1>Library</h1></div></header>
    <nav class="lib-links" aria-label="Library">
      <a href="#/liked">${icon('heart')}<span>Liked Songs</span><em>${state.liked.length}</em>${icon('chev-right')}</a>
      <a href="#/recent">${icon('clock')}<span>Recently Played</span><em>${state.recent.length}</em>${icon('chev-right')}</a>
      <a href="#/files">${icon('upload')}<span>My Files</span><em>${localSongs.length}</em>${icon('chev-right')}</a>
    </nav>
    <section class="section">
      <div class="section-head"><h2>Playlists</h2><button class="btn small" data-action="new-playlist">${icon('plus')}New Playlist</button></div>
      ${state.playlists.length ? `<div class="card-grid">${state.playlists.map(playlistCard).join('')}</div>` : '<p class="muted">Create a playlist, then use the ••• menu on any song to add it.</p>'}
    </section>
    ${recent.length ? `<section class="section"><div class="section-head"><h2>Recently Played</h2>${scrollButtons('lib-recent')}</div><div class="shelf" id="lib-recent">${cardsHtml(recent)}</div></section>` : ''}`);
}

function collectionPage({ eyebrow, title, art, meta, list, extra = '', empty, playlistId }) {
  const listId = registerList(list);
  return `
    <header class="hero">
      ${art}
      <div class="hero-text">
        <div class="eyebrow">${esc(eyebrow)}</div>
        <h1>${esc(title)}</h1>
        <div class="hero-meta">${meta}</div>
        <div class="hero-actions">${list.length ? playButtons(listId, list.some(isPlayable)) : ''}${extra}</div>
      </div>
    </header>
    ${list.length ? `<div class="list"${playlistId ? ` data-playlist="${esc(playlistId)}"` : ''}>${list.map((s, i) => songRow(s, listId, i)).join('')}</div>` : empty}`;
}

const listMeta = (list) => {
  const total = list.reduce((sum, s) => sum + (s.duration || 0), 0);
  return `${plural(list.length, 'song')}${total ? ', ' + fmtTotal(total) : ''}`;
};

async function viewLiked(token) {
  await localReady;
  if (stale(token)) return;
  setView(collectionPage({
    eyebrow: 'Library',
    title: 'Liked Songs',
    art: `<div class="art hero-art art-liked">${icon('heart-fill')}</div>`,
    meta: listMeta(state.liked),
    list: state.liked,
    empty: emptyState('heart', 'No liked songs yet', 'Tap the heart on any song and it shows up here.', '<a class="btn" href="#/browse">Browse Music</a>'),
  }));
}

async function viewRecent(token) {
  await localReady;
  if (stale(token)) return;
  setView(collectionPage({
    eyebrow: 'Library',
    title: 'Recently Played',
    art: `<div class="art hero-art art-recent">${icon('clock')}</div>`,
    meta: plural(state.recent.length, 'song'),
    list: state.recent,
    extra: state.recent.length ? `<button class="btn ghost" data-action="clear-recent">Clear History</button>` : '',
    empty: emptyState('clock', 'Nothing played yet', 'Songs you play show up here.', '<a class="btn" href="#/browse">Browse Music</a>'),
  }));
}

async function viewFiles(token) {
  await localReady;
  if (stale(token)) return;
  setView(collectionPage({
    eyebrow: 'Library',
    title: 'My Files',
    art: `<div class="art hero-art art-files">${icon('upload')}</div>`,
    meta: `${listMeta(localSongs)} · play in full, saved in this browser`,
    list: localSongs,
    extra: `<button class="btn" data-action="import">${icon('plus')}Add Music</button>`,
    empty: `<div class="empty dropzone" data-action="import" role="button" tabindex="0">
      <div class="empty-icon">${icon('upload')}</div>
      <h3>Add music you own</h3>
      <p>Drop MP3, M4A, WAV, OGG or FLAC files here, or click to choose them. They stay on this device and play from start to finish.</p>
    </div>`,
  }));
}

async function viewPlaylist(token, id) {
  await localReady;
  if (stale(token)) return;
  const pl = state.playlists.find((p) => p.id === id);
  if (!pl) {
    setView(emptyState('list', 'Playlist not found', 'It may have been deleted.', '<a class="btn" href="#/library">Go to Library</a>'));
    return;
  }
  setView(collectionPage({
    eyebrow: 'Playlist',
    title: pl.name,
    art: playlistArt(pl, 'hero-art'),
    meta: listMeta(pl.songs),
    list: pl.songs,
    playlistId: pl.id,
    extra: `<button class="btn ghost" data-action="rename-playlist" data-pl="${esc(pl.id)}">Rename</button>
      <button class="btn ghost" data-action="delete-playlist" data-pl="${esc(pl.id)}">${icon('trash')}Delete</button>`,
    empty: emptyState('list', 'This playlist is empty', 'Open the ••• menu on any song and choose Add to Playlist.', '<a class="btn" href="#/browse">Browse Music</a>'),
  }));
}

function renderSidebarPlaylists() {
  const nav = $('#playlist-nav');
  nav.innerHTML = state.playlists.length
    ? state.playlists.map((p) => `<a href="#/playlist/${esc(p.id)}" data-nav="playlist/${esc(p.id)}">${icon('list')}<span>${esc(p.name)}</span></a>`).join('')
    : '<p class="side-empty">No playlists yet</p>';
  highlightNav(currentRoute);
}

/* ---------- Library actions ---------- */
function toggleLike(song) {
  if (!song) return;
  if (likedKeys.has(song.key)) {
    state.liked = state.liked.filter((s) => s.key !== song.key);
    likedKeys.delete(song.key);
    toast('Removed from Liked Songs');
  } else {
    state.liked.unshift(song);
    likedKeys.add(song.key);
    toast('Added to Liked Songs');
  }
  save('liked');
  syncLikeButtons(song.key);
  if (currentRoute === 'liked') refresh();
}

function syncLikeButtons(key) {
  const on = likedKeys.has(key);
  $$('[data-like]').forEach((b) => {
    if (b.dataset.like !== key) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Unlike' : 'Like');
    b.innerHTML = icon(on ? 'heart-fill' : 'heart');
  });
}

function pushRecent(song) {
  state.recent = [song, ...state.recent.filter((s) => s.key !== song.key)].slice(0, 60);
  save('recent');
}

const findPlaylist = (id) => state.playlists.find((p) => p.id === id);

function promptNewPlaylist(withSong) {
  openModal({
    title: 'New Playlist',
    input: { placeholder: 'Playlist name', value: '' },
    confirm: 'Create',
    onConfirm: (name) => {
      const pl = { id: uid(), name, songs: withSong ? [withSong] : [], created: Date.now() };
      state.playlists.push(pl);
      save('playlists');
      renderSidebarPlaylists();
      if (withSong) {
        toast(`Added to “${name}”`);
        if (currentRoute === 'library') refresh();
      } else {
        toast(`Created “${name}”`);
        location.hash = '#/playlist/' + pl.id;
      }
    },
  });
}

function addToPlaylist(id, song) {
  const pl = findPlaylist(id);
  if (!pl || !song) return;
  if (pl.songs.some((s) => s.key === song.key)) {
    toast(`Already in “${pl.name}”`);
    return;
  }
  pl.songs.push(song);
  save('playlists');
  toast(`Added to “${pl.name}”`);
  if (currentRoute === 'playlist/' + id || currentRoute === 'library') refresh();
}

function removeFromPlaylist(id, song) {
  const pl = findPlaylist(id);
  if (!pl) return;
  pl.songs = pl.songs.filter((s) => s.key !== song.key);
  save('playlists');
  toast(`Removed from “${pl.name}”`);
  refresh();
}

function renamePlaylist(id) {
  const pl = findPlaylist(id);
  if (!pl) return;
  openModal({
    title: 'Rename Playlist',
    input: { value: pl.name, placeholder: 'Playlist name' },
    confirm: 'Save',
    onConfirm: (name) => {
      pl.name = name;
      save('playlists');
      renderSidebarPlaylists();
      refresh();
    },
  });
}

function deletePlaylist(id) {
  const pl = findPlaylist(id);
  if (!pl) return;
  openModal({
    title: `Delete “${pl.name}”?`,
    text: 'This removes the playlist from this browser. The songs stay in the catalog and in your other lists.',
    confirm: 'Delete',
    danger: true,
    onConfirm: () => {
      state.playlists = state.playlists.filter((p) => p.id !== id);
      save('playlists');
      renderSidebarPlaylists();
      toast('Playlist deleted');
      location.hash = '#/library';
    },
  });
}

function confirmDeleteFile(song) {
  openModal({
    title: `Delete “${song.title}”?`,
    text: 'This removes the file from My Files, your playlists and your liked songs on this device.',
    confirm: 'Delete',
    danger: true,
    onConfirm: async () => {
      try {
        await localDb.del(song.id);
      } catch {
        toast('This browser would not delete the file. Try again.');
        return;
      }
      localSongs = localSongs.filter((s) => s.key !== song.key);
      const art = localArt.get(song.id);
      if (art) URL.revokeObjectURL(art);
      localArt.delete(song.id);
      state.liked = state.liked.filter((s) => s.key !== song.key);
      likedKeys.delete(song.key);
      state.recent = state.recent.filter((s) => s.key !== song.key);
      state.playlists.forEach((p) => (p.songs = p.songs.filter((s) => s.key !== song.key)));
      save('liked', 'recent', 'playlists');
      toast('File deleted');
      refresh();
    },
  });
}

/* ---------- Player ---------- */
const audio = $('#audio');
const playerEl = $('#player');
const npEl = $('#np');
const P = { queue: [], original: [], index: -1, objectUrl: null, errors: 0, loadSeq: 0 };
let seeking = false;

const current = () => P.queue[P.index] || null;

async function resolveUrl(song) {
  if (song.source === 'itunes') return song.url || null;
  if (song.source === 'audius') return audius.streamUrl(song.id);
  if (song.source === 'local') {
    const rec = await localDb.get(song.id).catch(() => null);
    return rec ? URL.createObjectURL(rec.blob) : null;
  }
  return null;
}

function playFromList(listId, index) {
  const list = lists.get(listId);
  const song = list?.[index];
  if (!song) return;
  if (!isPlayable(song)) {
    toast('Apple has no preview for this song.');
    return;
  }
  if (current()?.key === song.key) {
    togglePlay();
    return;
  }
  const playable = list.filter(isPlayable);
  startQueue(playable, playable.indexOf(song));
}

function startQueue(list, start = 0, shuffle = false) {
  if (!list.length) {
    toast('There’s nothing here that can play.');
    return;
  }
  if (shuffle && !state.shuffle) {
    state.shuffle = true;
    save('shuffle');
    syncModeButtons();
  }
  if (shuffle) start = Math.floor(Math.random() * list.length);
  P.original = list.slice();
  if (state.shuffle) {
    P.queue = [list[start], ...shuffled(list.filter((_, i) => i !== start))];
    P.index = 0;
  } else {
    P.queue = list.slice();
    P.index = start;
  }
  P.errors = 0;
  load(true);
}

async function load(autoplay) {
  const song = current();
  if (!song) return;
  const seq = ++P.loadSeq;
  songs.set(song.key, song);
  renderNowPlaying(song);
  saveSession();
  const url = await resolveUrl(song);
  if (seq !== P.loadSeq) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    return;
  }
  if (P.objectUrl) {
    URL.revokeObjectURL(P.objectUrl);
    P.objectUrl = null;
  }
  if (!url) {
    toast(`“${song.title}” can’t be played. It may have been deleted.`);
    skipAfterError();
    return;
  }
  if (url.startsWith('blob:')) P.objectUrl = url;
  audio.src = url;
  if (autoplay) {
    pushRecent(song);
    try {
      await audio.play();
    } catch (err) {
      if (err.name === 'NotAllowedError') toast('Press play to start listening.');
    }
  }
}

function saveSession() {
  const start = Math.max(0, P.index - 50);
  store.set('session', { queue: P.queue.slice(start, start + 200), index: P.index - start });
}

function togglePlay() {
  const song = current();
  if (!song) {
    toast('Pick a song to start listening.');
    return;
  }
  if (!audio.currentSrc) {
    load(true);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function next(auto = false) {
  if (!P.queue.length) return;
  if (P.index < P.queue.length - 1) {
    P.index++;
    load(true);
  } else if (state.repeat === 'all') {
    P.index = 0;
    load(true);
  } else if (auto) {
    // End of the queue: rewind to the first song, paused.
    P.index = 0;
    load(false);
  } else {
    toast('That’s the end of the queue.');
  }
}

function prev() {
  if (!P.queue.length) return;
  if (audio.currentTime > 3 || (P.index === 0 && state.repeat !== 'all')) {
    audio.currentTime = 0;
    return;
  }
  P.index = P.index > 0 ? P.index - 1 : P.queue.length - 1;
  load(true);
}

function skipAfterError() {
  if (++P.errors > 3) {
    P.errors = 0;
    toast('Several songs in a row failed to play. Check your connection.');
    return;
  }
  setTimeout(() => next(true), 700);
}

function seekBy(sec) {
  if (!isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + sec));
}

function playNext(song) {
  if (!P.queue.length) {
    startQueue([song]);
    return;
  }
  P.queue.splice(P.index + 1, 0, song);
  toast(`“${song.title}” plays next`);
  if (npPanel === 'queue') renderQueue();
}

function addToQueue(song) {
  if (!P.queue.length) {
    startQueue([song]);
    return;
  }
  P.queue.push(song);
  toast(`Added “${song.title}” to the queue`);
  if (npPanel === 'queue') renderQueue();
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  save('shuffle');
  const cur = current();
  if (cur) {
    if (state.shuffle) {
      P.queue = [...P.queue.slice(0, P.index + 1), ...shuffled(P.queue.slice(P.index + 1))];
    } else {
      const i = P.original.findIndex((s) => s.key === cur.key);
      if (i >= 0) {
        P.queue = P.original.slice();
        P.index = i;
      }
    }
  }
  syncModeButtons();
  toast(state.shuffle ? 'Shuffle on' : 'Shuffle off');
  if (npPanel === 'queue') renderQueue();
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat] || 'off';
  save('repeat');
  syncModeButtons();
  toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one song' }[state.repeat]);
}

function syncModeButtons() {
  $$('.js-shuffle').forEach((b) => {
    b.classList.toggle('on', state.shuffle);
    b.setAttribute('aria-pressed', String(state.shuffle));
  });
  $$('.js-repeat').forEach((b) => {
    b.classList.toggle('on', state.repeat !== 'off');
    b.setAttribute('aria-label', `Repeat: ${state.repeat}`);
    b.innerHTML = icon(state.repeat === 'one' ? 'repeat-one' : 'repeat');
  });
}

function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  audio.volume = v;
  state.volume = v;
  $$('.js-vol').forEach((r) => {
    r.value = v;
    r.style.setProperty('--p', v * 100 + '%');
  });
  saveVolume();
}
const saveVolume = debounce(() => save('volume'), 400);

function renderNowPlaying(song) {
  playerEl.classList.toggle('is-empty', !song);
  $('#p-art-wrap').innerHTML = artBox(artSrc(song, 120), song?.key || 'none', 'p-art');
  $('#p-title').textContent = song ? song.title : 'Not Playing';
  $('#p-artist').textContent = song ? song.artist : 'Pick any song to start';
  $$('.js-like').forEach((b) => {
    b.dataset.like = song?.key || '';
    b.hidden = !song;
  });
  if (song) syncLikeButtons(song.key);
  $$('.js-chip').forEach((c) => {
    c.hidden = !song || song.source === 'local';
    c.textContent = song?.preview ? 'Preview · 30 sec' : 'Full song';
    c.classList.toggle('chip-full', !!song && !song.preview);
  });
  $('#np-more').dataset.more = song?.key || '';
  $('#np-art-wrap').innerHTML = artBox(artSrc(song, 600), song?.key || 'none', 'np-art');
  const big = artSrc(song, 600);
  const bg = $('#np-bg');
  if (big) bg.src = big;
  else bg.removeAttribute('src');
  bg.hidden = !big;
  $('#np-title').textContent = song?.title || '';
  $('#np-artist').textContent = song?.artist || '';
  $('#np-from').textContent = song ? (song.album || (song.source === 'audius' ? 'Free on Audius' : 'My Files')) : 'Now Playing';
  document.title = song ? `${song.title} · ${song.artist}` : 'Encore Music';
  updateMediaSession(song);
  markCurrent();
  syncProgress();
  if (npPanel === 'lyrics') loadLyrics();
  else if (npPanel === 'queue') renderQueue();
}

function markCurrent() {
  const key = current()?.key;
  $$('.is-current').forEach((el) => el.classList.remove('is-current'));
  if (!key) return;
  $$('[data-key]').forEach((el) => {
    if (el.dataset.key === key) el.classList.add('is-current');
  });
}

function syncPlayState() {
  const paused = audio.paused;
  document.body.classList.toggle('is-playing', !paused);
  $$('.js-play').forEach((b) => {
    b.innerHTML = icon(paused ? 'play' : 'pause');
    b.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = paused ? 'paused' : 'playing';
}

function syncProgress() {
  const dur = audio.duration;
  const cur = audio.currentTime || 0;
  const ok = isFinite(dur) && dur > 0;
  const pct = ok ? (cur / dur) * 100 : 0;
  if (!seeking) {
    $$('.js-seek').forEach((r) => {
      r.value = ok ? Math.round((cur / dur) * 1000) : 0;
      r.style.setProperty('--p', pct + '%');
    });
    $$('.js-cur').forEach((el) => (el.textContent = fmtTime(cur)));
  }
  $$('.js-dur').forEach((el) => (el.textContent = ok ? '-' + fmtTime(dur - cur) : '0:00'));
  playerEl.style.setProperty('--p', pct + '%');
  if (lyricLines && npPanel === 'lyrics') highlightLyric(cur);
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  try {
    const art = artSrc(song, 600);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      artwork: art ? [{ src: art, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  } catch {
    /* metadata is optional */
  }
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => (audio.currentSrc ? audio.play().catch(() => {}) : togglePlay()),
    pause: () => audio.pause(),
    previoustrack: prev,
    nexttrack: () => next(),
    seekbackward: () => seekBy(-10),
    seekforward: () => seekBy(10),
    seekto: (d) => {
      if (isFinite(d.seekTime)) audio.currentTime = d.seekTime;
    },
  };
  for (const [action, fn] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      /* action not supported here */
    }
  }
}

audio.addEventListener('play', syncPlayState);
audio.addEventListener('pause', syncPlayState);
audio.addEventListener('timeupdate', syncProgress);
audio.addEventListener('durationchange', syncProgress);
audio.addEventListener('playing', () => (P.errors = 0));
audio.addEventListener('ended', () => {
  if (state.repeat === 'one') {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } else next(true);
});
audio.addEventListener('error', () => {
  const song = current();
  if (!song || !audio.getAttribute('src')) return;
  toast(`Couldn’t play “${song.title}”. Skipping.`);
  skipAfterError();
});

/* ---------- Now Playing ---------- */
let npPanel = null; // null | 'lyrics' | 'queue'
let lyricLines = null;
let lyricIdx = -1;
let lyricsFor = null;

function openNP(panel) {
  if (!current()) {
    toast('Play a song first.');
    return;
  }
  npEl.hidden = false;
  requestAnimationFrame(() => npEl.classList.add('open'));
  if (panel !== undefined) setPanel(panel);
  else setPanel(npPanel);
}

function closeNP() {
  npEl.classList.remove('open');
  setTimeout(() => {
    if (!npEl.classList.contains('open')) npEl.hidden = true;
  }, reducedMotion() ? 0 : 380);
}

function setPanel(panel) {
  npPanel = panel || null;
  npEl.classList.toggle('has-panel', !!npPanel);
  $('#np-panel').hidden = !npPanel;
  $$('[data-action="np-lyrics"]').forEach((b) => b.classList.toggle('on', npPanel === 'lyrics'));
  $$('[data-action="np-queue"]').forEach((b) => b.classList.toggle('on', npPanel === 'queue'));
  if (npPanel === 'lyrics') loadLyrics();
  else if (npPanel === 'queue') renderQueue();
  else {
    lyricLines = null;
    lyricsFor = null;
    $('#np-panel').dataset.for = '';
  }
}

function togglePanel(panel) {
  if (npEl.hidden) openNP(panel);
  else setPanel(npPanel === panel ? null : panel);
}

function parseLrc(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines;
}

async function loadLyrics() {
  const song = current();
  const panel = $('#np-panel');
  if (!song) return;
  if (lyricsFor === song.key && panel.dataset.for === song.key) return;
  lyricsFor = song.key;
  panel.dataset.for = song.key;
  lyricLines = null;
  lyricIdx = -1;
  panel.innerHTML = '<p class="np-note">Looking for lyrics…</p>';
  try {
    const hit = await fetchLyrics(song);
    if (lyricsFor !== song.key) return;
    if (!hit) {
      panel.innerHTML = '<p class="np-note">No lyrics found for this song.</p>';
    } else if (hit.instrumental) {
      panel.innerHTML = '<p class="np-note">This song is instrumental.</p>';
    } else if (hit.syncedLyrics && !song.preview) {
      lyricLines = parseLrc(hit.syncedLyrics);
      panel.innerHTML = `<div class="lyrics">${lyricLines.map((l, i) => `<p data-action="lyric-seek" data-i="${i}">${esc(l.text || '♪')}</p>`).join('')}<p class="np-note">Lyrics from LRCLIB</p></div>`;
      highlightLyric(audio.currentTime || 0);
    } else {
      const text = hit.plainLyrics || hit.syncedLyrics.replace(/^\[[^\]]*\]\s?/gm, '');
      const note = song.preview ? 'The preview plays 30 seconds. These are the lyrics for the whole song.' : '';
      panel.innerHTML = `<div class="lyrics plain">${note ? `<p class="np-note">${note}</p>` : ''}${text.split('\n').map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}<p class="np-note">Lyrics from LRCLIB</p></div>`;
    }
  } catch {
    if (lyricsFor === song.key) {
      panel.innerHTML = '<p class="np-note">Lyrics aren’t available right now. Check your connection.</p>';
      panel.dataset.for = '';
    }
  }
}

function highlightLyric(t) {
  let i = -1;
  for (let k = 0; k < lyricLines.length && lyricLines[k].t <= t + 0.25; k++) i = k;
  if (i === lyricIdx) return;
  lyricIdx = i;
  const panel = $('#np-panel');
  const lines = $$('.lyrics p[data-i]', panel);
  lines.forEach((p, k) => p.classList.toggle('active', k === i));
  const el = lines[i];
  if (el) panel.scrollTo({ top: el.offsetTop - panel.clientHeight / 2 + el.offsetHeight / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function renderQueue() {
  const panel = $('#np-panel');
  panel.dataset.for = '';
  lyricsFor = null;
  lyricLines = null;
  const upcoming = P.queue.slice(P.index + 1, P.index + 101);
  panel.innerHTML = `
    <div class="q-head"><h3>Playing Next</h3>${upcoming.length ? '<button class="link-btn" data-action="clear-queue">Clear</button>' : ''}</div>
    ${upcoming.length
      ? `<ol class="q-list">${upcoming.map((s, i) => {
          const qi = P.index + 1 + i;
          return `<li class="q-item" data-action="queue-jump" data-qi="${qi}">${artBox(artSrc(s, 120), s.key, 'q-art')}<div class="q-text"><div class="q-title">${esc(s.title)}</div><div class="q-sub">${esc(s.artist)}</div></div><button class="icon-btn" data-action="queue-remove" data-qi="${qi}" aria-label="Remove ${esc(s.title)} from the queue">${icon('close')}</button></li>`;
        }).join('')}</ol>`
      : '<p class="np-note">Nothing is queued. Use Play Next or Add to Queue from any song’s ••• menu.</p>'}`;
}

/* ---------- Song menu ---------- */
const menuEl = $('#menu');
let menuSong = null;
let menuPlaylist = null;
let menuAnchor = null;

function openSongMenu(song, anchor) {
  if (!song) return;
  menuSong = song;
  menuAnchor = anchor;
  menuPlaylist = anchor.closest('[data-playlist]')?.dataset.playlist || null;
  renderMenuMain();
  placeMenu();
}

function renderMenuMain() {
  const s = menuSong;
  const liked = likedKeys.has(s.key);
  const items = [
    isPlayable(s) && ['play-next', 'next-up', 'Play Next'],
    isPlayable(s) && ['add-queue', 'queue', 'Add to Queue'],
    ['add-playlist', 'plus', 'Add to Playlist…'],
    ['like', liked ? 'heart-fill' : 'heart', liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'],
    s.albumId && ['go-album', 'disc', 'Go to Album'],
    s.artistId && ['go-artist', 'mic', 'Go to Artist'],
    menuPlaylist && ['remove-from-playlist', 'minus', 'Remove from This Playlist'],
    s.source === 'local' && ['delete-file', 'trash', 'Delete from My Files'],
  ].filter(Boolean);
  const links = [
    s.source !== 'local' && [`https://www.youtube.com/results?search_query=${encodeURIComponent(`${s.artist} ${s.title}`)}`, 'Find the Full Song on YouTube'],
    s.link && [s.link, s.source === 'audius' ? 'Open on Audius' : 'Open in Apple Music'],
  ].filter(Boolean);
  menuEl.innerHTML = `
    <div class="menu-backdrop" data-m="close"></div>
    <div class="menu-sheet" role="menu" aria-label="Options for ${esc(s.title)}">
      <div class="menu-head">${artBox(artSrc(s, 120), s.key, 'menu-art')}<div class="menu-head-text"><div class="menu-title">${esc(s.title)}</div><div class="menu-sub">${esc(s.artist)}</div></div></div>
      ${items.map(([act, ic, label]) => `<button class="menu-item${act === 'delete-file' ? ' danger' : ''}" role="menuitem" data-m="${act}">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}
      ${links.length ? '<div class="menu-sep"></div>' + links.map(([href, label]) => `<a class="menu-item" role="menuitem" href="${esc(href)}" target="_blank" rel="noopener">${icon('external')}<span>${esc(label)}</span></a>`).join('') : ''}
    </div>`;
}

function renderMenuPlaylists() {
  $('.menu-sheet', menuEl).innerHTML = `
    <button class="menu-item" data-m="back">${icon('chev-left')}<span>Add to Playlist</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item" data-m="new-playlist-with">${icon('plus')}<span>New Playlist…</span></button>
    ${state.playlists.map((p) => `<button class="menu-item" data-m="add-to" data-pl="${esc(p.id)}">${icon('list')}<span>${esc(p.name)}</span></button>`).join('')}`;
}

function placeMenu() {
  menuEl.hidden = false;
  const sheet = $('.menu-sheet', menuEl);
  if (isPhone()) {
    menuEl.classList.add('as-sheet');
    sheet.style.left = sheet.style.top = '';
  } else {
    menuEl.classList.remove('as-sheet');
    const r = menuAnchor?.isConnected ? menuAnchor.getBoundingClientRect() : { top: innerHeight / 3, bottom: innerHeight / 3, right: innerWidth / 2 };
    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    const left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12));
    let top = r.bottom + 6;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 6);
    sheet.style.left = left + 'px';
    sheet.style.top = top + 'px';
  }
  $('.menu-item', sheet)?.focus({ preventScroll: true });
}

function closeMenu() {
  if (menuEl.hidden) return;
  menuEl.hidden = true;
  menuEl.innerHTML = '';
  if (menuAnchor?.isConnected) menuAnchor.focus({ preventScroll: true });
}

menuEl.addEventListener('click', (e) => {
  if (e.target.closest('a.menu-item')) {
    closeMenu();
    return;
  }
  const btn = e.target.closest('[data-m]');
  if (!btn) return;
  const s = menuSong;
  switch (btn.dataset.m) {
    case 'add-playlist':
      renderMenuPlaylists();
      placeMenu();
      return;
    case 'back':
      renderMenuMain();
      placeMenu();
      return;
    case 'play-next': playNext(s); break;
    case 'add-queue': addToQueue(s); break;
    case 'add-to': addToPlaylist(btn.dataset.pl, s); break;
    case 'like': toggleLike(s); break;
    case 'go-album': location.hash = '#/album/' + s.albumId; break;
    case 'go-artist': location.hash = '#/artist/' + s.artistId; break;
    case 'remove-from-playlist': removeFromPlaylist(menuPlaylist, s); break;
    case 'new-playlist-with':
      closeMenu();
      promptNewPlaylist(s);
      return;
    case 'delete-file':
      closeMenu();
      confirmDeleteFile(s);
      return;
  }
  if (btn.dataset.m === 'go-album' || btn.dataset.m === 'go-artist') closeNP();
  closeMenu();
});

/* ---------- Modal & toast ---------- */
const modalEl = $('#modal');

function openModal({ title, text = '', input = null, confirm = 'OK', danger = false, onConfirm }) {
  modalEl.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <form class="modal-card" id="modal-form" novalidate>
      <h3 id="modal-title">${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${input ? `<input id="modal-input" class="field" type="text" maxlength="80" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" aria-labelledby="modal-title">` : ''}
      <div class="modal-actions">
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirm)}</button>
      </div>
    </form>`;
  modalEl.hidden = false;
  const field = $('#modal-input');
  if (field) {
    field.focus();
    field.select();
  } else $('button[type="submit"]', modalEl).focus();
  $('#modal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = field ? field.value.trim() : true;
    if (field && !value) {
      field.focus();
      return;
    }
    closeModal();
    onConfirm(value);
  });
  $$('[data-close]', modalEl).forEach((b) => b.addEventListener('click', closeModal));
}

function closeModal() {
  modalEl.hidden = true;
  modalEl.innerHTML = '';
}

const toastEl = $('#toast');
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => {
      if (!toastEl.classList.contains('show')) toastEl.hidden = true;
    }, 250);
  }, 2600);
}

/* ---------- Events ---------- */
const actions = {
  'toggle-play': togglePlay,
  next: () => next(),
  prev,
  shuffle: toggleShuffle,
  repeat: cycleRepeat,
  'open-np': () => openNP(),
  'close-np': closeNP,
  'np-lyrics': () => togglePanel('lyrics'),
  'np-queue': () => togglePanel('queue'),
  'play-list': (el) => {
    const list = lists.get(el.dataset.list);
    if (list) startQueue(list.filter(isPlayable), 0);
  },
  'shuffle-list': (el) => {
    const list = lists.get(el.dataset.list);
    if (list) startQueue(list.filter(isPlayable), 0, true);
  },
  'new-playlist': () => promptNewPlaylist(),
  'rename-playlist': (el) => renamePlaylist(el.dataset.pl),
  'delete-playlist': (el) => deletePlaylist(el.dataset.pl),
  import: () => $('#file-input').click(),
  'clear-recent': () => {
    state.recent = [];
    save('recent');
    refresh();
  },
  source: (el) => {
    state.source = el.dataset.source;
    save('source');
    $$('.seg-btn').forEach((b) => {
      const on = b.dataset.source === state.source;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    runSearch(searchQuery);
  },
  'search-term': (el) => {
    location.hash = '#/search/' + encodeURIComponent(el.dataset.q);
  },
  'forget-search': (el) => {
    state.searches = state.searches.filter((x) => x !== el.dataset.q);
    save('searches');
    runSearch('');
  },
  'free-genre': (el) => {
    freeGenre = el.dataset.genre;
    freeQuery = '';
    const input = $('#free-input');
    if (input) input.value = '';
    loadFree();
  },
  scroll: (el) => {
    const target = document.getElementById(el.dataset.target);
    if (target) target.scrollBy({ left: Number(el.dataset.dir) * target.clientWidth * 0.9, behavior: reducedMotion() ? 'auto' : 'smooth' });
  },
  retry: () => refresh(),
  'clear-queue': () => {
    P.queue.splice(P.index + 1);
    renderQueue();
  },
  'queue-jump': (el) => {
    P.index = Number(el.dataset.qi);
    load(true);
  },
  'queue-remove': (el) => {
    P.queue.splice(Number(el.dataset.qi), 1);
    renderQueue();
  },
  'lyric-seek': (el) => {
    const line = lyricLines?.[Number(el.dataset.i)];
    if (line) audio.currentTime = line.t;
  },
};

document.addEventListener('click', (e) => {
  const t = e.target;
  const like = t.closest('[data-like]');
  if (like) {
    toggleLike(songs.get(like.dataset.like));
    return;
  }
  const more = t.closest('[data-more]');
  if (more) {
    openSongMenu(songs.get(more.dataset.more), more);
    return;
  }
  const inResults = t.closest('#search-results');
  if (inResults && searchQuery) saveSearch(searchQuery);
  if (t.closest('a')) return;
  const act = t.closest('[data-action]');
  if (act) {
    actions[act.dataset.action]?.(act, e);
    return;
  }
  const item = t.closest('[data-list][data-index]');
  if (item) playFromList(item.dataset.list, Number(item.dataset.index));
});

const onSearchInput = debounce((q) => {
  if (!currentRoute.startsWith('search')) {
    location.hash = '#/search/' + encodeURIComponent(q);
    return;
  }
  history.replaceState(null, '', '#/search/' + encodeURIComponent(q));
  currentRoute = 'search/' + q;
  searchQuery = q;
  runSearch(q);
}, 320);

const onFreeInput = debounce((q) => {
  freeQuery = q.trim();
  loadFree();
}, 400);

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'search-input' || t.id === 'side-search') {
    if (t.id === 'search-input') $('#side-search').value = t.value;
    onSearchInput(t.value);
  } else if (t.id === 'free-input') {
    onFreeInput(t.value);
  } else if (t.classList.contains('js-seek')) {
    seeking = true;
    const dur = audio.duration;
    t.style.setProperty('--p', t.value / 10 + '%');
    if (isFinite(dur)) $$('.js-cur').forEach((el) => (el.textContent = fmtTime((t.value / 1000) * dur)));
  } else if (t.classList.contains('js-vol')) {
    setVolume(Number(t.value));
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList.contains('js-seek')) {
    if (isFinite(audio.duration)) audio.currentTime = (t.value / 1000) * audio.duration;
    seeking = false;
    syncProgress();
  } else if (t.id === 'country-select') {
    state.country = t.value;
    save('country');
    refresh();
  } else if (t.id === 'file-input') {
    importFiles(t.files);
    t.value = '';
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.id === 'search-form' || form.id === 'side-search-form') {
    e.preventDefault();
    const q = $('input', form).value;
    saveSearch(q);
    if (!currentRoute.startsWith('search')) location.hash = '#/search/' + encodeURIComponent(q);
    else runSearch(q);
    if (isPhone()) $('input', form).blur();
  } else if (form.id === 'free-form') {
    e.preventDefault();
    freeQuery = $('#free-input').value.trim();
    loadFree();
  }
});

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key === 'Escape') {
    if (!modalEl.hidden) closeModal();
    else if (!menuEl.hidden) closeMenu();
    else if (!npEl.hidden) closeNP();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'range';
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.key === 'Enter' || e.key === ' ') && t.matches('[role="button"]')) {
    e.preventDefault();
    t.click();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && t.closest('button, a')) return;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (e.key === 'ArrowRight' && e.shiftKey) next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) prev();
  else if (e.key === 'ArrowRight' && t.type !== 'range') seekBy(5);
  else if (e.key === 'ArrowLeft' && t.type !== 'range') seekBy(-5);
  else if (e.key === '/') {
    e.preventDefault();
    (isPhone() ? null : $('#side-search'))?.focus();
    if (isPhone()) location.hash = '#/search';
  }
});

// Missing artwork falls back to the gradient behind it.
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.art')) e.target.remove();
}, true);

// Drag audio files anywhere onto the page to add them to My Files.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    document.body.classList.remove('dragging');
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  importFiles(e.dataTransfer.files);
});

/* ---------- Start ---------- */
function init() {
  [...state.liked, ...state.recent, ...state.playlists.flatMap((p) => p.songs)].forEach((s) => songs.set(s.key, s));
  localReady = loadLocal();
  setVolume(state.volume);
  syncModeButtons();
  syncPlayState();
  setupMediaSession();
  renderSidebarPlaylists();

  const session = store.get('session', null);
  if (session?.queue?.length) {
    P.queue = session.queue;
    P.original = session.queue.slice();
    P.index = Math.min(Math.max(0, session.index || 0), P.queue.length - 1);
    P.queue.forEach((s) => songs.set(s.key, s));
    localReady.then(() => renderNowPlaying(current()));
  } else {
    renderNowPlaying(null);
  }

  window.addEventListener('hashchange', route);
  route();
}

init();
