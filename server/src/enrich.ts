import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { COVERS_DIR } from './config.js';
import { getLibraryDirs } from './dirs.js';

export interface PathHints {
  title?: string;
  artist?: string;
  album?: string;
  track_no?: number;
  disc_no?: number;
  year?: number;
}

export interface Candidate {
  source: 'musicbrainz' | 'netease' | 'path';
  score: number;
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  year: number | null;
  track_no: number | null;
  disc_no: number | null;
  genre: string | null;
  cover_url: string | null;
  external_id: string;
  duration_ms?: number | null;
  meta?: Record<string, unknown>;
}

const UA = 'Lumen/0.1 ( https://github.com/lumen-music )';
const NE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://music.163.com/'
};

let mbBucket = 0;
async function throttleMB() {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - mbBucket));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  mbBucket = Date.now();
}

// ---------- Path / filename heuristics ----------

const TRACK_PREFIX_RE = /^\s*(\d{1,3})[\.\-\s_]+(.+)$/;
const ARTIST_TITLE_RE = /^(.+?)\s+[\-–—]\s+(.+)$/;
const YEAR_PAREN_RE = /\s*[\(\[（［]\s*(\d{4})\s*[\)\]）］]\s*/;
const DISC_RE = /\b(?:cd|disc|disk)\s*0*(\d{1,2})\b/i;

export function parsePathHints(filePath: string, libraryRoots: string[] = getLibraryDirs()): PathHints {
  const ext = extname(filePath);
  const filename = basename(filePath, ext);
  const dir = dirname(filePath);

  let relDir = dir;
  for (const root of libraryRoots) {
    if (dir === root) { relDir = ''; break; }
    if (dir.startsWith(root + sep)) { relDir = dir.slice(root.length + 1); break; }
  }
  const segments = relDir ? relDir.split(sep).filter(Boolean) : [];
  const hints: PathHints = {};

  // Disc folder detection (e.g., "CD1", "Disc 02")
  let discFromDir: number | undefined;
  if (segments.length > 0) {
    const m = segments[segments.length - 1].match(DISC_RE);
    if (m) {
      discFromDir = Number(m[1]);
      segments.pop();
    }
  }
  if (discFromDir != null) hints.disc_no = discFromDir;

  let nameOnly = filename;
  const t = filename.match(TRACK_PREFIX_RE);
  if (t) {
    hints.track_no = Number(t[1]);
    nameOnly = t[2].trim();
  }
  const at = nameOnly.match(ARTIST_TITLE_RE);
  if (at) {
    hints.artist = at[1].trim();
    hints.title = at[2].trim();
  } else {
    hints.title = nameOnly;
  }

  if (segments.length >= 2) {
    if (!hints.artist) hints.artist = segments[segments.length - 2];
    hints.album = segments[segments.length - 1];
  } else if (segments.length === 1) {
    hints.album = segments[0];
  }

  if (hints.album) {
    const ym = hints.album.match(YEAR_PAREN_RE);
    if (ym) {
      hints.year = Number(ym[1]);
      hints.album = hints.album.replace(YEAR_PAREN_RE, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return hints;
}

// ---------- MusicBrainz ----------

export async function searchMusicBrainz(q: { title?: string; artist?: string; album?: string; duration?: number | null }): Promise<Candidate[]> {
  if (!q.title) return [];
  await throttleMB();
  const parts: string[] = [`recording:"${escapeLucene(q.title)}"`];
  if (q.artist) parts.push(`artist:"${escapeLucene(q.artist)}"`);
  if (q.album) parts.push(`release:"${escapeLucene(q.album)}"`);
  const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(parts.join(' AND '))}&limit=8&fmt=json&inc=release-groups`;
  let data: any;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return [];
    data = await r.json();
  } catch { return []; }

  const out: Candidate[] = [];
  for (const rec of data.recordings ?? []) {
    // CRITICAL: pick the canonical release, not releases[0] (which is arbitrary
    // and often a Single/Compilation when the user really wants the original
    // Album). Order: prefer "Album" primary-type, then earliest date, then by
    // having the most tracks, then everything else.
    const release = pickCanonicalRelease(rec.releases ?? []);
    const credits = (rec['artist-credit'] ?? []) as any[];
    const artist = credits.map(c => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join('').trim();
    const albumArtist = credits.map(c => c.artist?.name || c.name || '').filter(Boolean).join(' / ');
    const baseScore = Math.max(0, Math.min(100, rec.score ?? 0)) / 100;
    let timeBonus = 0;
    if (q.duration && rec.length) {
      const diff = Math.abs(rec.length / 1000 - q.duration);
      timeBonus = Math.max(0, 1 - diff / 10);
    }
    const score = baseScore * 0.7 + timeBonus * 0.3;

    const releaseIds = (rec.releases ?? []).map((r: any) => r.id).filter(Boolean) as string[];
    const releaseGroupId: string | null = release?.['release-group']?.id ?? null;

    out.push({
      source: 'musicbrainz',
      score,
      title: rec.title,
      artist,
      album: release?.title ?? '',
      album_artist: albumArtist || artist,
      year: release?.date ? Number(release.date.slice(0, 4)) || null : null,
      track_no: extractTrackNo(release, rec.id),
      disc_no: null,
      genre: rec.tags?.[0]?.name ?? null,
      cover_url: release?.id ? `https://coverartarchive.org/release/${release.id}/front-500` : null,
      external_id: rec.id,
      duration_ms: rec.length ?? null,
      meta: { releaseIds, releaseGroupId, recordingId: rec.id }
    });
  }
  return out;
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  status?: string;
  'track-count'?: number;
  'release-group'?: { 'primary-type'?: string; 'secondary-types'?: string[]; id?: string };
}

function pickCanonicalRelease(releases: MbRelease[]): MbRelease | undefined {
  if (releases.length === 0) return undefined;
  if (releases.length === 1) return releases[0];

  // Score each release. Higher = more "canonical".
  const scored = releases.map(r => {
    const rg = r['release-group'];
    const primary = (rg?.['primary-type'] || '').toLowerCase();
    const secondary = (rg?.['secondary-types'] || []).map(s => s.toLowerCase());
    let s = 0;
    if (primary === 'album') s += 100;
    else if (primary === 'ep') s += 60;
    else if (primary === 'single') s += 20;
    else s += 10;
    // Penalize compilations / live / soundtrack etc.
    if (secondary.includes('compilation')) s -= 80;
    if (secondary.includes('live')) s -= 50;
    if (secondary.includes('soundtrack')) s -= 30;
    if (secondary.includes('remix')) s -= 50;
    if (secondary.includes('demo')) s -= 40;
    // Prefer earlier (original) releases.
    const year = r.date ? Number(r.date.slice(0, 4)) : NaN;
    if (Number.isFinite(year)) s += (3000 - year) * 0.05;
    // Prefer "Official" status releases.
    if ((r.status || '').toLowerCase() === 'official') s += 10;
    // Prefer releases with more tracks (less likely to be a single).
    const tc = Number(r['track-count']) || 0;
    s += Math.min(20, tc);
    return { r, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored[0].r;
}

function extractTrackNo(release: any, recId: string): number | null {
  if (!release?.media) return null;
  for (const med of release.media) {
    for (const tr of med.tracks ?? []) {
      if (tr.recording?.id === recId) return Number(tr.position) || null;
    }
  }
  return null;
}

function escapeLucene(s: string): string {
  return s.replace(/([+\-!(){}\[\]^"~*?:\\\/])/g, '\\$1');
}

// ---------- NetEase ----------

export async function searchNetEase(q: { title?: string; artist?: string }): Promise<Candidate[]> {
  if (!q.title) return [];
  const keyword = `${q.title} ${q.artist ?? ''}`.trim();
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=8`;
  let data: any;
  try {
    const r = await fetch(url, { headers: NE_HEADERS });
    if (!r.ok) return [];
    data = await r.json();
  } catch { return []; }

  const songs: any[] = data.result?.songs ?? [];
  const out: Candidate[] = [];
  const localTitle = (q.title || '').toLowerCase();
  const localArtist = (q.artist || '').toLowerCase();
  for (const s of songs) {
    const artists = (s.artists ?? []).map((a: any) => a.name).filter(Boolean).join(' / ');
    const ts = (s.name || '').toLowerCase();
    const as = artists.toLowerCase();
    const titleHit =
      ts === localTitle ? 1 :
      (ts.startsWith(localTitle) || localTitle.startsWith(ts)) ? 0.85 :
      (ts.includes(localTitle) || localTitle.includes(ts)) ? 0.55 : 0.15;
    const artistHit = !localArtist
      ? 0.5
      : as === localArtist ? 1
      : as.split(/\s*\/\s*/).some((p: string) => p === localArtist) ? 0.95
      : as.includes(localArtist) ? 0.7
      : 0.05;
    const score = 0.55 * titleHit + 0.45 * artistHit;

    out.push({
      source: 'netease',
      score,
      title: s.name,
      artist: artists,
      album: s.album?.name ?? '',
      album_artist: artists,
      year: null,
      track_no: null,
      disc_no: null,
      genre: null,
      cover_url: s.album?.picUrl ?? s.album?.blurPicUrl ?? null,
      external_id: String(s.id),
      duration_ms: s.duration ?? null,
      meta: { albumId: s.album?.id }
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export async function fetchNetEaseLyrics(neteaseId: string): Promise<string | null> {
  const url = `https://music.163.com/api/song/lyric?id=${neteaseId}&lv=1&kv=1&tv=-1`;
  try {
    const r = await fetch(url, { headers: NE_HEADERS });
    if (!r.ok) return null;
    const data = await r.json() as any;
    const lrc: string | undefined = data.lrc?.lyric;
    const tlyric: string | undefined = data.tlyric?.lyric;
    if (!lrc) return null;
    if (tlyric) return mergeLrcWithTranslation(lrc, tlyric);
    return lrc;
  } catch { return null; }
}

function mergeLrcWithTranslation(orig: string, trans: string): string {
  const tMap = new Map<string, string>();
  for (const line of trans.split(/\r?\n/)) {
    const m = line.match(/^\[(\d+:\d+(?:\.\d+)?)\](.*)$/);
    if (m) tMap.set(m[1], m[2].trim());
  }
  return orig.split(/\r?\n/).map(line => {
    const m = line.match(/^\[(\d+:\d+(?:\.\d+)?)\](.*)$/);
    if (!m) return line;
    const t = tMap.get(m[1]);
    return t ? `${line}  /  ${t}` : line;
  }).join('\n');
}

// ---------- Aggregation ----------

export async function getCandidates(trackId: number): Promise<{ track: any; candidates: Candidate[] }> {
  const t = db.prepare('SELECT id, title, artist_name, album_name, album_artist, year, track_no, disc_no, duration, path FROM tracks WHERE id = ?').get(trackId) as any;
  if (!t) throw new Error('track not found');

  const queries = { title: t.title, artist: t.artist_name, album: t.album_name, duration: t.duration };

  const [mb, ne] = await Promise.all([
    searchMusicBrainz(queries).catch(() => []),
    searchNetEase({ title: t.title, artist: t.artist_name }).catch(() => [])
  ]);

  const pathHint = parsePathHints(t.path);
  const pathCand: Candidate | null = pathHint.title
    ? {
        source: 'path',
        score: 0.4,
        title: pathHint.title,
        artist: pathHint.artist ?? t.artist_name ?? '',
        album: pathHint.album ?? t.album_name ?? '',
        album_artist: pathHint.artist ?? t.album_artist ?? '',
        year: pathHint.year ?? t.year ?? null,
        track_no: pathHint.track_no ?? null,
        disc_no: pathHint.disc_no ?? null,
        genre: null,
        cover_url: null,
        external_id: 'path:' + trackId
      }
    : null;

  // Filter out obvious wrong candidates: artist mismatch on NetEase becomes
  // very low-score and shouldn't show up as a "match suggestion" at all.
  const filtered = [...mb, ...ne, ...(pathCand ? [pathCand] : [])]
    .filter(c => {
      if (c.source === 'netease') return c.score >= 0.6; // require some artist agreement
      return true;
    })
    .sort((a, b) => b.score - a.score);
  return { track: t, candidates: filtered.slice(0, 12) };
}

export async function applyCandidate(trackId: number, c: Candidate): Promise<void> {
  const t = db.prepare('SELECT album_id FROM tracks WHERE id = ?').get(trackId) as { album_id: number | null } | undefined;
  if (!t) throw new Error('track not found');

  const txn = db.transaction(() => {
    let artistId: number | null = null;
    if (c.artist) {
      const existing = db.prepare('SELECT id FROM artists WHERE name = ?').get(c.artist) as { id: number } | undefined;
      if (existing) artistId = existing.id;
      else {
        const r = db.prepare('INSERT INTO artists (name, sort_name) VALUES (?, ?)').run(c.artist, c.artist.toLowerCase());
        artistId = Number(r.lastInsertRowid);
      }
    }
    let albumId: number | null = null;
    const aaName = c.album_artist || c.artist;
    if (c.album && aaName) {
      // Try strict match first.
      let ex = db.prepare('SELECT id FROM albums WHERE name = ? AND album_artist = ?').get(c.album, aaName) as { id: number } | undefined;
      if (!ex) {
        // Forgiving match: same album name (case-insensitive, whitespace-collapsed)
        // and an album_artist that's near-equal (handles 简繁 1-char diff and
        // small variants like "Jay Chou" vs "Jay Chou feat. X" coming back from
        // MB's per-recording artist credit). Without this, a single album gets
        // split into multiple rows when MB returns slightly different
        // album_artist strings for different tracks.
        const candidates = db.prepare(
          "SELECT id, album_artist FROM albums WHERE LOWER(REPLACE(name, ' ', '')) = LOWER(REPLACE(?, ' ', ''))"
        ).all(c.album) as { id: number; album_artist: string }[];
        for (const a of candidates) {
          if (
            a.album_artist === aaName ||
            nearEqual(a.album_artist, aaName) ||
            a.album_artist.toLowerCase().includes(aaName.toLowerCase()) ||
            aaName.toLowerCase().includes(a.album_artist.toLowerCase())
          ) {
            ex = { id: a.id };
            break;
          }
        }
      }
      if (ex) albumId = ex.id;
      else {
        const r = db.prepare('INSERT INTO albums (name, album_artist, year, genre, added_at) VALUES (?, ?, ?, ?, ?)').run(c.album, aaName, c.year, c.genre, Date.now());
        albumId = Number(r.lastInsertRowid);
      }
    }
    db.prepare(`
      UPDATE tracks SET
        title = ?,
        artist_id = COALESCE(?, artist_id),
        artist_name = ?,
        album_id = COALESCE(?, album_id),
        album_name = ?,
        album_artist = ?,
        year = COALESCE(?, year),
        track_no = COALESCE(?, track_no),
        disc_no = COALESCE(?, disc_no),
        genre = COALESCE(?, genre)
      WHERE id = ?
    `).run(
      c.title,
      artistId,
      c.artist,
      albumId,
      c.album || null,
      aaName || null,
      c.year,
      c.track_no,
      c.disc_no,
      c.genre,
      trackId
    );
  });
  txn();

  // Cover (out of txn — network). Fall back along: candidate URL → MB
  // release-group → NetEase top match. Never iterate MB releases (would
  // burn MB rate-limit budget). If album already has a local cover, leave
  // it — we don't want to downgrade an embedded high-res cover.
  try {
    const targetAlbumId = (db.prepare('SELECT album_id FROM tracks WHERE id = ?').get(trackId) as { album_id: number | null } | undefined)?.album_id;
    if (targetAlbumId) {
      const album = db.prepare('SELECT cover_path, name, album_artist FROM albums WHERE id = ?').get(targetAlbumId) as { cover_path: string | null; name: string; album_artist: string } | undefined;
      if (album && !album.cover_path) {
        const blob = await fetchCoverWithFallbacks(c);
        if (blob) {
          const key = createHash('sha1').update(`${album.name.trim().toLowerCase()}\x00${album.album_artist.trim().toLowerCase()}`).digest('hex');
          const target = join(COVERS_DIR, `${key}.${blob.ext}`);
          writeFileSync(target, blob.data);
          db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(target, targetAlbumId);
        }
      }
    }
  } catch { /* skip cover failures */ }

  recomputeAggregates();
}

interface ImageBlob { data: Buffer; ext: 'jpg' | 'png' }

async function tryFetchImage(url: string, headers: Record<string, string>, timeoutMs = 4500): Promise<ImageBlob | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(url, { headers, redirect: 'follow', signal: ac.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024) return null; // suspiciously small
    return { data: buf, ext: ct.includes('png') ? 'png' : 'jpg' };
  } catch { return null; }
}

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/[\s（()）\[\]【】]/g, '');
}

// Approximate equality for CJK names — accepts 1-char difference (handles
// simplified/traditional variants like 周杰伦 ↔ 周杰倫). For non-CJK strings
// this still works as exact-only since Latin names rarely differ by one char.
function nearEqual(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return true;
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) diff++;
    if (diff > 1) return false;
  }
  return diff <= 1;
}

// Best signal: search NetEase by ALBUM (type=10). The album records carry
// a real picUrl pointing to the album cover (not an artist photo).
async function fetchNetEaseAlbumCover(albumName: string, albumArtist: string): Promise<ImageBlob | null> {
  if (!albumName || /unknown\s*album/i.test(albumName)) return null;
  if (!albumArtist) return null;
  try {
    const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(`${albumName} ${albumArtist}`)}&type=10&limit=10`;
    const r = await fetch(url, { headers: NE_HEADERS });
    if (!r.ok) return null;
    const data: any = await r.json();
    const albums: any[] = data.result?.albums ?? [];
    const localName = normTitle(albumName);
    const localArtist = albumArtist.trim().toLowerCase();
    const ranked = albums
      .map(a => {
        const an = normTitle(a.name || '');
        const ar = (a.artist?.name || '').trim().toLowerCase();
        const aliases: string[] = [
          (a.artist?.name || '').trim().toLowerCase(),
          ...((a.artist?.alias || []) as string[]).map((x: string) => x.toLowerCase())
        ];
        const nameScore = an === localName ? 1 : nearEqual(an, localName) ? 0.95 : 0;
        const artistScore =
          aliases.some(x => x === localArtist) ? 1
          : aliases.some(x => nearEqual(x, localArtist)) ? 0.95
          : nearEqual(ar, localArtist) ? 0.9
          : 0;
        // Tiebreaker: prefer multi-track full albums over same-name singles.
        const sizeBonus = Math.min(0.05, ((a.size || 1) - 1) * 0.02);
        return { a, score: 0.6 * nameScore + 0.4 * artistScore + sizeBonus };
      })
      .filter(x => x.score >= 0.93 && x.a.picUrl)
      .sort((a, b) => b.score - a.score);
    for (const { a } of ranked.slice(0, 3)) {
      const big = String(a.picUrl).split('?')[0] + '?param=1024y1024';
      const got = await tryFetchImage(big, NE_HEADERS);
      if (got) return got;
      const fallback = await tryFetchImage(String(a.picUrl), NE_HEADERS);
      if (fallback) return fallback;
    }
  } catch { /* skip */ }
  return null;
}

// Last-ditch: search Kugou track and use the album's image — only when the
// match is strict on TITLE, ARTIST and ALBUM all three; otherwise we risk the
// dreaded artist-photo-as-cover case the user reported.
async function fetchKugouCoverFor(title: string, artist: string, album?: string): Promise<ImageBlob | null> {
  const localTitle = normTitle(title);
  const localArtist = artist.trim().toLowerCase();
  const localAlbum = album ? normTitle(album) : null;
  const queries = [`${artist} ${title}`, `${title} ${artist}`];
  for (const q of queries) {
    try {
      const url = `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(q)}&pagesize=20&page=1&clientver=&srcappid=2919&clienttime=${Date.now()}`;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4500);
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' },
        signal: ac.signal
      });
      clearTimeout(timer);
      if (!r.ok) continue;
      const data: any = await r.json();
      const songs = (data.data?.lists ?? []) as any[];
      const ranked = songs
        .map(s => {
          const sn = normTitle(s.SongName || '');
          const an = (s.SingerName || '').trim().toLowerCase();
          const albName = normTitle(s.AlbumName || '');
          const titleStrict = sn === localTitle;
          const artistStrict = an.split(/[、,，;；\/&]+/).some((p: string) => p.trim() === localArtist);
          const albumStrict = !localAlbum || albName === localAlbum || albName.startsWith(localAlbum) || localAlbum.startsWith(albName);
          // All three must match strictly to avoid wrong covers (artist photos / remix art).
          if (!titleStrict || !artistStrict || !albumStrict) return { s, score: 0 };
          return { s, score: 1 };
        })
        .filter(x => x.score >= 1 && x.s.Image)
        .slice(0, 3);
      for (const { s } of ranked) {
        const cover = String(s.Image).replace(/\{size\}/g, '1080').replace(/^http:/, 'https:');
        const got = await tryFetchImage(cover, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/' });
        if (got) return got;
      }
    } catch { /* skip */ }
  }
  return null;
}

export async function fetchCoverWithFallbacks(c: Candidate): Promise<ImageBlob | null> {
  // 1) NetEase ALBUM search — this is the only signal that reliably returns an
  //    actual album cover (not an artist photo). Try it first when we know the
  //    album name + artist.
  const albumArtist = c.album_artist || c.artist;
  if (c.album && albumArtist) {
    const got = await fetchNetEaseAlbumCover(c.album, albumArtist);
    if (got) return got;
  }
  // 2) Direct candidate cover URL (CAA / NetEase track picUrl, etc.). Fast
  //    timeout so blocked CDNs fail fast.
  if (c.cover_url) {
    if (c.source === 'netease') {
      const big = c.cover_url.replace(/\?.*$/, '') + '?param=1024y1024';
      const got = await tryFetchImage(big, NE_HEADERS);
      if (got) return got;
    }
    const got = await tryFetchImage(c.cover_url, c.source === 'netease' ? NE_HEADERS : { 'User-Agent': UA });
    if (got) return got;
  }
  // 3) Kugou — STRICT title+artist+album triple-match. Only kicks in when we
  //    have all three pieces; otherwise it's too easy to get a remix's cover
  //    or, worse, an artist headshot.
  if (c.title && c.artist && c.album) {
    const got = await fetchKugouCoverFor(c.title, c.artist, c.album);
    if (got) return got;
  }
  // 4) Last resort: MB release-group cover (often blocked in CN).
  if (c.source === 'musicbrainz') {
    const rgId = (c.meta as any)?.releaseGroupId as string | undefined;
    if (rgId) {
      const got = await tryFetchImage(`https://coverartarchive.org/release-group/${rgId}/front-500`, { 'User-Agent': UA });
      if (got) return got;
    }
  }
  return null;
}

export function recomputeAggregates() {
  db.exec(`
    UPDATE albums SET
      track_count = (SELECT COUNT(*) FROM tracks WHERE tracks.album_id = albums.id),
      duration = (SELECT COALESCE(SUM(duration), 0) FROM tracks WHERE tracks.album_id = albums.id);
    UPDATE artists SET
      album_count = (
        SELECT COUNT(DISTINCT album_id) FROM tracks
        WHERE tracks.album_id IS NOT NULL
        AND (tracks.artist_id = artists.id OR tracks.album_artist = artists.name)
      ),
      track_count = (
        SELECT COUNT(*) FROM tracks
        WHERE tracks.artist_id = artists.id OR tracks.album_artist = artists.name
      );
    DELETE FROM albums WHERE track_count = 0;
    DELETE FROM artists WHERE track_count = 0;
  `);
}

// ---------- Bulk enrichment ----------

export interface EnrichBatchState {
  running: boolean;
  total: number;
  done: number;
  improved: number;
  skipped: number;
  failed: number;
  current: string;
  startedAt: number | null;
  finishedAt: number | null;
}

export const enrichState: EnrichBatchState = {
  running: false, total: 0, done: 0, improved: 0, skipped: 0, failed: 0,
  current: '', startedAt: null, finishedAt: null
};

export async function enrichBatch(opts: { minScore?: number; onlyWeak?: boolean } = {}): Promise<void> {
  if (enrichState.running) return;
  const minScore = opts.minScore ?? 0.78;
  Object.assign(enrichState, {
    running: true, total: 0, done: 0, improved: 0, skipped: 0, failed: 0,
    current: '', startedAt: Date.now(), finishedAt: null
  });

  try {
    const tracks = opts.onlyWeak !== false
      ? db.prepare(`
          SELECT id FROM tracks
          WHERE artist_name IN ('', 'Unknown Artist')
             OR album_name IN ('', 'Unknown Album')
             OR title IN ('', 'Unknown')
             OR title = REPLACE(REPLACE(REPLACE(LOWER(SUBSTR(path, 1)), '.flac', ''), '.mp3', ''), '.m4a', '')
        `).all() as { id: number }[]
      : db.prepare('SELECT id FROM tracks').all() as { id: number }[];

    // We over-allocate total to include a final cover-refresh pass per
    // missing-cover album, so progress doesn't oscillate.
    const noCoverAlbums = (db.prepare('SELECT id, name, album_artist FROM albums WHERE cover_path IS NULL').all() as { id: number; name: string; album_artist: string }[]);
    enrichState.total = tracks.length + noCoverAlbums.length;
    for (const { id } of tracks) {
      try {
        const t = db.prepare('SELECT title, artist_name FROM tracks WHERE id = ?').get(id) as any;
        enrichState.current = `${t?.artist_name ?? ''} – ${t?.title ?? ''}`;
        const { candidates } = await getCandidates(id);
        // For automatic application we accept ONLY MusicBrainz high-confidence,
        // or NetEase candidates with a near-perfect artist+title match.
        // Path heuristic alone is never auto-applied.
        const top = candidates.find(c =>
          (c.source === 'musicbrainz' && c.score >= minScore) ||
          (c.source === 'netease' && c.score >= 0.95)
        );
        if (top) {
          await applyCandidate(id, top);
          enrichState.improved++;
        } else {
          enrichState.skipped++;
        }
      } catch {
        enrichState.failed++;
      }
      enrichState.done++;
    }

    // Cover refresh pass: for every album still without a cover, try the
    // multi-source fallback (NetEase → Kugou → MB) using the first track.
    const stillMissing = db.prepare('SELECT id, name, album_artist FROM albums WHERE cover_path IS NULL').all() as { id: number; name: string; album_artist: string }[];
    for (const a of stillMissing) {
      enrichState.current = `封面: ${a.album_artist} – ${a.name}`;
      try {
        const t = db.prepare('SELECT title, artist_name FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no, id LIMIT 1').get(a.id) as { title: string; artist_name: string } | undefined;
        if (t) {
          const fake: Candidate = {
            source: 'netease', score: 1,
            title: t.title, artist: t.artist_name,
            album: a.name, album_artist: a.album_artist,
            year: null, track_no: null, disc_no: null, genre: null,
            cover_url: null, external_id: ''
          };
          const blob = await fetchCoverWithFallbacks(fake);
          if (blob) {
            const key = createHash('sha1').update(`${a.name.trim().toLowerCase()}\x00${a.album_artist.trim().toLowerCase()}`).digest('hex');
            const target = join(COVERS_DIR, `${key}.${blob.ext}`);
            writeFileSync(target, blob.data);
            db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(target, a.id);
            enrichState.improved++;
          } else {
            enrichState.skipped++;
          }
        } else {
          enrichState.skipped++;
        }
      } catch {
        enrichState.failed++;
      }
      enrichState.done++;
    }
  } finally {
    enrichState.running = false;
    enrichState.finishedAt = Date.now();
    enrichState.current = '';
  }
}
