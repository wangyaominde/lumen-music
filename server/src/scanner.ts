import { readdir, copyFile } from 'node:fs/promises';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFile } from 'music-metadata';
import { db } from './db.js';
import { COVERS_DIR, LOSSLESS_CODECS, SUPPORTED_EXTENSIONS } from './config.js';
import { parsePathHints } from './enrich.js';

export interface ScanState {
  running: boolean;
  total: number;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  failed: number;
  current: string;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export const scanState: ScanState = {
  running: false, total: 0, scanned: 0, added: 0, updated: 0, unchanged: 0,
  removed: 0, failed: 0, current: '', startedAt: null, finishedAt: null, error: null
};

const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules', '@eaDir']);

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) yield full;
    }
  }
}

function albumKey(name: string, albumArtist: string): string {
  return createHash('sha1').update(`${name.trim().toLowerCase()}\x00${albumArtist.trim().toLowerCase()}`).digest('hex');
}

function normalizeName(s: string | undefined | null, fallback: string): string {
  if (!s) return fallback;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

// --- mojibake detection + repair ---
// Common case in Chinese music: ID3v2.3 frames marked as Latin-1 but actually
// containing GBK/GB18030 bytes. music-metadata reads them as Latin-1, so we
// see the raw bytes as codepoints 0x80-0xFF. Re-encoding to bytes + decoding
// as GB18030 (or Big5 as a second guess) recovers the text.
//
// Vorbis comments (FLAC) are spec'd UTF-8; if a writer wrote GBK there, the
// reader gets U+FFFD replacement chars and the original bytes are gone — we
// can't recover that, scanner falls back to the filename for those.

const REPLACEMENT_CHAR = '�';

function looksMojibake(s: string | undefined | null): boolean {
  if (!s) return false;
  if (s.includes(REPLACEMENT_CHAR)) return true;
  // Latin-1 supplement chars clustered together — typical when GBK bytes get
  // misinterpreted as Latin-1. Plain English / accented Latin doesn't trip
  // this because the cluster ratio threshold is high.
  let supp = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x80 && c <= 0xFF) supp++;
  }
  return supp >= 2 && supp / s.length > 0.4;
}

function tryDecodeAs(s: string, encoding: 'gb18030' | 'big5' | 'shift_jis'): string | null {
  try {
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xFF) return null; // not raw bytes — give up
      bytes[i] = c;
    }
    const out = new TextDecoder(encoding, { fatal: false }).decode(bytes);
    if (out.includes(REPLACEMENT_CHAR)) return null;
    // Require at least one CJK char to consider it a successful repair —
    // otherwise we'd "fix" plain English into Chinese gibberish.
    if (!/[一-鿿぀-ヿ가-힯]/.test(out)) return null;
    return out;
  } catch { return null; }
}

function repairText(s: string | undefined | null): string | null {
  if (!s) return null;
  if (!looksMojibake(s)) return s;
  return (
    tryDecodeAs(s, 'gb18030') ??
    tryDecodeAs(s, 'big5') ??
    tryDecodeAs(s, 'shift_jis') ??
    null
  );
}

/**
 * Pick the best-available value for a tag field:
 *   1. If raw tag is fine, use it.
 *   2. If raw tag looks mojibake, try to repair via byte-level re-decode.
 *   3. If unrepairable, use the path-derived hint.
 *   4. Last resort: provided fallback.
 */
function pickField(rawTag: string | undefined | null, pathHint: string | undefined, fallback: string): string {
  const trimmed = (rawTag ?? '').trim();
  if (trimmed) {
    if (!looksMojibake(trimmed)) return trimmed;
    const repaired = repairText(trimmed);
    if (repaired) return repaired.trim();
    // unrepairable: drop through to path-hint
  }
  if (pathHint && pathHint.trim() && !looksMojibake(pathHint)) {
    return pathHint.trim();
  }
  return fallback;
}

function upsertArtist(name: string): number {
  const existing = db.prepare('SELECT id FROM artists WHERE name = ?').get(name) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO artists (name, sort_name) VALUES (?, ?)').run(name, name.toLowerCase());
  return Number(result.lastInsertRowid);
}

function upsertAlbum(
  name: string,
  albumArtist: string,
  artistId: number,
  year: number | null,
  genre: string | null,
  coverPath: string | null
): number {
  const existing = db.prepare('SELECT id, cover_path, year FROM albums WHERE name = ? AND album_artist = ?').get(name, albumArtist) as
    { id: number; cover_path: string | null; year: number | null } | undefined;
  if (existing) {
    if (coverPath && !existing.cover_path) {
      db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(coverPath, existing.id);
    }
    if (year && !existing.year) {
      db.prepare('UPDATE albums SET year = ? WHERE id = ?').run(year, existing.id);
    }
    return existing.id;
  }
  const result = db.prepare(`
    INSERT INTO albums (name, artist_id, album_artist, year, genre, cover_path, added_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, artistId, albumArtist, year, genre, coverPath, Date.now());
  return Number(result.lastInsertRowid);
}

interface PictureLike { format: string; data: Buffer | Uint8Array }

async function extractCover(file: string, picture: PictureLike | undefined, key: string): Promise<string | null> {
  if (picture && picture.data) {
    const ext = picture.format?.includes('png') ? 'png' : 'jpg';
    const target = join(COVERS_DIR, `${key}.${ext}`);
    if (!existsSync(target)) {
      const data = picture.data instanceof Uint8Array ? Buffer.from(picture.data) : picture.data as Buffer;
      writeFileSync(target, data);
    }
    return target;
  }
  const folder = dirname(file);
  const candidates = [
    'cover.jpg', 'cover.jpeg', 'cover.png',
    'folder.jpg', 'folder.jpeg', 'folder.png',
    'front.jpg', 'front.jpeg', 'front.png',
    'AlbumArt.jpg', 'AlbumArt.png',
    'album.jpg', 'album.png',
    'Folder.jpg', 'Cover.jpg'
  ];
  for (const candidate of candidates) {
    const p = join(folder, candidate);
    if (existsSync(p)) {
      const ext = candidate.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      const target = join(COVERS_DIR, `${key}.${ext}`);
      if (!existsSync(target)) {
        try { await copyFile(p, target); } catch { return null; }
      }
      return target;
    }
  }
  return null;
}

async function scanFile(file: string): Promise<'added' | 'updated' | 'unchanged'> {
  const stats = statSync(file);
  const mtime = Math.floor(stats.mtimeMs);

  const existing = db.prepare('SELECT id, mtime, file_size, title, artist_name, album_name FROM tracks WHERE path = ?').get(file) as
    { id: number; mtime: number; file_size: number; title: string; artist_name: string; album_name: string } | undefined;
  // Skip if BOTH mtime and size match — that catches `cp -p` style replacements
  // that preserve mtime but change content / quality. If the existing record
  // carries mojibake, re-process regardless so the repair logic gets a chance.
  if (existing && existing.mtime === mtime && existing.file_size === stats.size) {
    const stale = looksMojibake(existing.title) || looksMojibake(existing.artist_name) || looksMojibake(existing.album_name);
    if (!stale) return 'unchanged';
  }

  const metadata = await parseFile(file, { duration: true, skipCovers: false });
  const c = metadata.common;
  const f = metadata.format;

  const hints = parsePathHints(file);
  const titleFallback = hints.title || basename(file).replace(/\.[^.]+$/, '');
  const rawTitle = c.title ?? null;
  const rawArtist = c.artist ?? c.artists?.[0] ?? null;
  const rawAlbumArtist = c.albumartist ?? null;
  const rawAlbum = c.album ?? null;

  const title = pickField(rawTitle, hints.title, titleFallback);
  const artistName = pickField(rawArtist, hints.artist, 'Unknown Artist');
  const albumArtist = pickField(rawAlbumArtist, hints.artist, artistName);
  const albumName = pickField(rawAlbum, hints.album, 'Unknown Album');
  const trackNo = c.track?.no ?? hints.track_no ?? null;
  const discNo = c.disk?.no ?? hints.disc_no ?? 1;
  const year = c.year ?? hints.year ?? null;
  const genre = c.genre?.[0] ?? null;
  const codec = (f.codec ?? f.container ?? '').toString();
  const losslessByCodec = LOSSLESS_CODECS.has(codec.toUpperCase());
  const lossless = (losslessByCodec || f.lossless === true) ? 1 : 0;

  const artistId = upsertArtist(artistName);
  const aaId = upsertArtist(albumArtist);
  const key = albumKey(albumName, albumArtist);
  const coverPath = await extractCover(file, c.picture?.[0] as PictureLike | undefined, key);
  const albumId = upsertAlbum(albumName, albumArtist, aaId, year, genre, coverPath);

  if (existing) {
    db.prepare(`
      UPDATE tracks SET
        title = ?, artist_id = ?, artist_name = ?, album_id = ?, album_name = ?, album_artist = ?,
        track_no = ?, disc_no = ?, year = ?, genre = ?, duration = ?, bitrate = ?, sample_rate = ?,
        bit_depth = ?, channels = ?, codec = ?, container = ?, lossless = ?, file_size = ?, mtime = ?,
        scanned_at = ?
      WHERE id = ?
    `).run(
      title, artistId, artistName, albumId, albumName, albumArtist,
      trackNo, discNo, year, genre, f.duration ?? null, f.bitrate ?? null, f.sampleRate ?? null,
      f.bitsPerSample ?? null, f.numberOfChannels ?? null, codec, f.container ?? null, lossless, stats.size, mtime,
      Date.now(), existing.id
    );
    return 'updated';
  }
  db.prepare(`
    INSERT INTO tracks (path, title, artist_id, artist_name, album_id, album_name, album_artist,
      track_no, disc_no, year, genre, duration, bitrate, sample_rate, bit_depth, channels, codec,
      container, lossless, file_size, mtime, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    file, title, artistId, artistName, albumId, albumName, albumArtist,
    trackNo, discNo, year, genre, f.duration ?? null, f.bitrate ?? null, f.sampleRate ?? null,
    f.bitsPerSample ?? null, f.numberOfChannels ?? null, codec, f.container ?? null, lossless, stats.size, mtime,
    Date.now()
  );
  return 'added';
}

function recomputeAggregates() {
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

export async function scanLibrary(dirs: string[]): Promise<void> {
  if (scanState.running) return;
  Object.assign(scanState, {
    running: true, total: 0, scanned: 0, added: 0, updated: 0, unchanged: 0,
    removed: 0, failed: 0, current: '', startedAt: Date.now(), finishedAt: null, error: null
  });

  try {
    const seen = new Set<string>();
    const allFiles: string[] = [];
    for (const dir of dirs) {
      for await (const file of walk(dir)) allFiles.push(file);
    }
    scanState.total = allFiles.length;

    for (const file of allFiles) {
      scanState.current = file;
      seen.add(file);
      try {
        const status = await scanFile(file);
        if (status === 'added') scanState.added++;
        else if (status === 'updated') scanState.updated++;
        else scanState.unchanged++;
      } catch {
        scanState.failed++;
      }
      scanState.scanned++;
    }

    const allTracks = db.prepare('SELECT id, path FROM tracks').all() as { id: number; path: string }[];
    const removeStmt = db.prepare('DELETE FROM tracks WHERE id = ?');
    const removeMany = db.transaction((ids: number[]) => { for (const id of ids) removeStmt.run(id); });
    const toRemove: number[] = [];
    for (const t of allTracks) {
      if (seen.has(t.path)) continue;
      const inScannedDir = dirs.some(d => t.path.startsWith(d));
      if (inScannedDir && !existsSync(t.path)) toRemove.push(t.id);
    }
    if (toRemove.length) removeMany(toRemove);
    scanState.removed = toRemove.length;

    recomputeAggregates();

    const updateScan = db.prepare('UPDATE library_dirs SET last_scan = ? WHERE path = ?');
    for (const dir of dirs) updateScan.run(Date.now(), dir);
  } catch (e) {
    scanState.error = (e as Error).message;
  } finally {
    scanState.running = false;
    scanState.finishedAt = Date.now();
    scanState.current = '';
  }
}

export { getLibraryDirs } from './dirs.js';
