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

  const existing = db.prepare('SELECT id, mtime FROM tracks WHERE path = ?').get(file) as { id: number; mtime: number } | undefined;
  if (existing && existing.mtime === mtime) return 'unchanged';

  const metadata = await parseFile(file, { duration: true, skipCovers: false });
  const c = metadata.common;
  const f = metadata.format;

  const hints = parsePathHints(file);
  const titleFallback = hints.title || basename(file).replace(/\.[^.]+$/, '');
  const title = normalizeName(c.title, titleFallback);
  const artistName = normalizeName(c.artist ?? c.artists?.[0], hints.artist || 'Unknown Artist');
  const albumArtist = normalizeName(c.albumartist, artistName);
  const albumName = normalizeName(c.album, hints.album || 'Unknown Album');
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
