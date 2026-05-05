import type { FastifyPluginAsync } from 'fastify';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { applyCandidate, enrichBatch, enrichState, fetchCoverWithFallbacks, getCandidates, recomputeAggregates, type Candidate } from '../enrich.js';
import { db } from '../db.js';
import { COVERS_DIR } from '../config.js';

/**
 * After a per-album scrape, look for *folders that the user clearly named
 * after this album*, and pull weakly-tagged sibling tracks in those folders
 * into the canonical album. The triggers are conservative on purpose:
 *
 *   1. The folder must host ≥2 freshly-anchored tracks of the canonical album
 *      (rules out random "downloads/" piles).
 *   2. The folder's basename must lexically match the album name (rules out
 *      generic "Music/" buckets — only kicks in when the user organized files
 *      as `…/<Album Name>/`).
 *   3. Each sibling track being moved must currently sit in a *weak* album:
 *      Unknown Album / Unknown Artist, mojibake characters in the album name,
 *      or an orphaned single-track album. Anything that looks like a real,
 *      different album is left alone.
 *
 * This way the heuristic only kicks in for "the user dumped a folder named
 * after the album, scrape resolved most of it, but a couple files had
 * broken tags" — exactly the case where it helps.
 */
function consolidateByDirectory(canonicalAlbumId: number, anchorTrackIds: number[]): number {
  if (!canonicalAlbumId || anchorTrackIds.length === 0) return 0;

  const album = db.prepare('SELECT name, album_artist FROM albums WHERE id = ?').get(canonicalAlbumId) as
    { name: string; album_artist: string } | undefined;
  if (!album) return 0;

  const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, '');
  const albumNorm = norm(album.name);
  if (!albumNorm || albumNorm === 'unknownalbum') return 0;

  const placeholders = anchorTrackIds.map(() => '?').join(',');
  const anchorPaths = db.prepare(
    `SELECT path FROM tracks WHERE id IN (${placeholders})`
  ).all(...anchorTrackIds) as { path: string }[];

  // Step 1: dirs with ≥2 anchor tracks AND folder name resembles album name.
  const dirCounts = new Map<string, number>();
  for (const p of anchorPaths) {
    const d = dirname(p.path);
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  }
  const folderLikeAlbum = (dir: string) => {
    const base = norm(dir.split('/').pop() ?? dir.split('\\').pop() ?? dir);
    if (!base) return false;
    return base === albumNorm || base.includes(albumNorm) || albumNorm.includes(base);
  };
  const consolidatedDirs = new Set(
    [...dirCounts.entries()]
      .filter(([d, c]) => c >= 2 && folderLikeAlbum(d))
      .map(([d]) => d)
  );
  if (consolidatedDirs.size === 0) return 0;

  // Step 2: for each candidate sibling track, only move it if it's currently
  // in a "weak" album (the user clearly couldn't get good tags on it).
  const REPLACEMENT = '�';
  const isWeakAlbum = (a: { name: string; album_artist: string; track_count: number } | undefined): boolean => {
    if (!a) return true; // orphan
    if (/unknown\s*album/i.test(a.name)) return true;
    if (/unknown\s*artist/i.test(a.album_artist)) return true;
    if (a.name.includes(REPLACEMENT) || a.album_artist.includes(REPLACEMENT)) return true;
    if (a.track_count <= 1) return true;
    return false;
  };

  const allTracks = db.prepare('SELECT id, path, album_id FROM tracks').all() as
    { id: number; path: string; album_id: number | null }[];
  const albumLookup = new Map<number, { name: string; album_artist: string; track_count: number }>();
  for (const row of db.prepare('SELECT id, name, album_artist, track_count FROM albums').all() as any[]) {
    albumLookup.set(row.id, row);
  }

  const movedIds: number[] = [];
  for (const t of allTracks) {
    if (t.album_id === canonicalAlbumId) continue;
    if (!consolidatedDirs.has(dirname(t.path))) continue;
    const cur = t.album_id ? albumLookup.get(t.album_id) : undefined;
    if (!isWeakAlbum(cur)) continue;
    movedIds.push(t.id);
  }
  if (movedIds.length === 0) return 0;

  const upd = db.prepare('UPDATE tracks SET album_id = ?, album_name = ?, album_artist = ? WHERE id = ?');
  db.transaction(() => {
    for (const id of movedIds) upd.run(canonicalAlbumId, album.name, album.album_artist, id);
  })();
  recomputeAggregates();
  return movedIds.length;
}

export const enrichRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/enrich/candidates/:id', async (req, reply) => {
    const id = Number(req.params.id);
    try {
      const result = await getCandidates(id);
      return result;
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string }; Body: { candidate: Candidate } }>('/api/enrich/apply/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!req.body?.candidate) return reply.code(400).send({ error: 'candidate required' });
    try {
      await applyCandidate(id, req.body.candidate);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.post<{ Body?: { minScore?: number; onlyWeak?: boolean } }>('/api/enrich/run', async (req, reply) => {
    if (enrichState.running) return reply.code(409).send({ error: 'enrichment already running' });
    void enrichBatch(req.body ?? {}).catch(() => {});
    return { ok: true, started: true };
  });

  app.get('/api/enrich/status', async () => enrichState);

  // Scrape an entire album: auto-apply MusicBrainz-strict matches per track,
  // returning per-track results (applied / skipped / no-match).
  app.post<{ Params: { id: string }; Body?: { minScore?: number } }>('/api/enrich/album/:id', async (req, reply) => {
    const albumId = Number(req.params.id);
    const minScore = req.body?.minScore ?? 0.78;
    const album = db.prepare('SELECT id, name FROM albums WHERE id = ?').get(albumId) as { id: number; name: string } | undefined;
    if (!album) return reply.code(404).send({ error: 'album not found' });

    const tracks = db.prepare('SELECT id, title FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no, title').all(albumId) as { id: number; title: string }[];
    const results: Array<{ track_id: number; title: string; status: 'applied' | 'skipped' | 'no-match' | 'failed'; chosen?: Candidate; topScore?: number }> = [];

    // Lock the album / album_artist / year to whatever the FIRST high-confidence
    // candidate resolves to, then coerce subsequent tracks' candidates to use
    // the same values. Otherwise MB's per-recording artist credits (which
    // differ when a track has a featured guest, or when MB has the artist in
    // both 简体 and 繁体) would split this single album into multiple rows.
    let canonicalAlbum: string | null = null;
    let canonicalAlbumArtist: string | null = null;
    let canonicalYear: number | null = null;

    for (const t of tracks) {
      try {
        const { candidates } = await getCandidates(t.id);
        const top = candidates.find(c =>
          (c.source === 'musicbrainz' && c.score >= minScore) ||
          (c.source === 'netease' && c.score >= 0.95)
        );
        if (top) {
          if (!canonicalAlbum && top.album) {
            canonicalAlbum = top.album;
            canonicalAlbumArtist = top.album_artist || top.artist;
            canonicalYear = top.year;
          }
          // Coerce album-level fields so every track lands in the same album row.
          const coerced: Candidate = canonicalAlbum
            ? { ...top, album: canonicalAlbum, album_artist: canonicalAlbumArtist || top.album_artist, year: top.year ?? canonicalYear }
            : top;
          await applyCandidate(t.id, coerced);
          results.push({ track_id: t.id, title: t.title, status: 'applied', chosen: coerced, topScore: top.score });
        } else {
          const best = candidates[0];
          results.push({ track_id: t.id, title: t.title, status: best ? 'skipped' : 'no-match', topScore: best?.score });
        }
      } catch {
        results.push({ track_id: t.id, title: t.title, status: 'failed' });
      }
    }
    // Directory-based consolidation: tracks share a folder → same album.
    const appliedTrackIds = results.filter(r => r.status === 'applied').map(r => r.track_id);
    let canonicalAlbumId: number | null = null;
    if (appliedTrackIds.length > 0) {
      const ph = appliedTrackIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT album_id, COUNT(*) AS c FROM tracks WHERE id IN (${ph}) GROUP BY album_id ORDER BY c DESC LIMIT 1`
      ).all(...appliedTrackIds) as { album_id: number; c: number }[];
      canonicalAlbumId = rows[0]?.album_id ?? null;
    }
    const consolidated = canonicalAlbumId
      ? consolidateByDirectory(canonicalAlbumId, appliedTrackIds)
      : 0;

    return {
      album: album.name,
      total: tracks.length,
      applied: results.filter(r => r.status === 'applied').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      noMatch: results.filter(r => r.status === 'no-match').length,
      failed: results.filter(r => r.status === 'failed').length,
      consolidated, // tracks pulled in from the same directory
      results
    };
  });

  // Detect and auto-merge duplicate albums (same album name, near-equal
  // album_artist). Targets the album in each duplicate group with the most
  // tracks and folds the others into it. Returns a report. Admin-gated by
  // virtue of being under /api/enrich/*.
  app.post('/api/enrich/cleanup-duplicates', async (_req, reply) => {
    const albums = db.prepare(`
      SELECT id, name, album_artist, year, cover_path, track_count
      FROM albums
    `).all() as { id: number; name: string; album_artist: string; year: number | null; cover_path: string | null; track_count: number }[];

    const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, '');
    const nearEq = (a: string, b: string) => {
      const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
      if (x === y) return true;
      if (x.length !== y.length || !x) return false;
      let d = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++d > 1) return false;
      return d <= 1;
    };
    const sameAlbum = (a: typeof albums[0], b: typeof albums[0]) => {
      if (norm(a.name) !== norm(b.name)) return false;
      const aa = a.album_artist.trim().toLowerCase();
      const bb = b.album_artist.trim().toLowerCase();
      return aa === bb || nearEq(aa, bb) || aa.includes(bb) || bb.includes(aa);
    };

    // Group via union-find / linear scan
    const remaining = [...albums];
    const groups: typeof albums[] = [];
    while (remaining.length) {
      const seed = remaining.shift()!;
      const group = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (sameAlbum(seed, remaining[i])) {
          group.push(remaining[i]);
          remaining.splice(i, 1);
        }
      }
      groups.push(group);
    }

    let mergedAlbums = 0;
    let movedTracks = 0;
    const report: Array<{ kept: { id: number; name: string; album_artist: string }; merged: number[] }> = [];

    const merge = db.transaction((srcIds: number[], dstId: number) => {
      for (const src of srcIds) {
        const moved = db.prepare('UPDATE tracks SET album_id = ? WHERE album_id = ?').run(dstId, src).changes;
        movedTracks += moved;
        // If the source album had a cover and the destination didn't, inherit it.
        const dst = db.prepare('SELECT cover_path FROM albums WHERE id = ?').get(dstId) as { cover_path: string | null } | undefined;
        const srcRow = db.prepare('SELECT cover_path FROM albums WHERE id = ?').get(src) as { cover_path: string | null } | undefined;
        if (dst && !dst.cover_path && srcRow?.cover_path) {
          db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(srcRow.cover_path, dstId);
        }
        db.prepare('DELETE FROM albums WHERE id = ?').run(src);
        mergedAlbums++;
      }
    });

    for (const g of groups) {
      if (g.length < 2) continue;
      // Keep the one with the most tracks; tie-break on lowest id (stable).
      g.sort((a, b) => b.track_count - a.track_count || a.id - b.id);
      const target = g[0];
      const sources = g.slice(1).map(a => a.id);
      merge(sources, target.id);
      report.push({
        kept: { id: target.id, name: target.name, album_artist: target.album_artist },
        merged: sources
      });
    }

    if (mergedAlbums > 0) recomputeAggregates();
    return { mergedAlbums, movedTracks, groups: report.length, report };
  });

  // Refresh just the cover for an album (no metadata change). Useful when
  // metadata is already correct but the cover slot is empty.
  app.post<{ Params: { id: string } }>('/api/enrich/cover/album/:id', async (req, reply) => {
    const albumId = Number(req.params.id);
    const album = db.prepare('SELECT id, name, album_artist FROM albums WHERE id = ?').get(albumId) as
      { id: number; name: string; album_artist: string } | undefined;
    if (!album) return reply.code(404).send({ error: 'album not found' });

    // Pick a representative track for title-based image search
    const track = db.prepare('SELECT title, artist_name FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no, id LIMIT 1').get(albumId) as
      { title: string; artist_name: string } | undefined;
    if (!track) return reply.code(404).send({ error: 'no tracks in album' });

    const fakeCandidate: Candidate = {
      source: 'netease', // routes through NetEase + Kugou fallbacks
      score: 1,
      title: track.title,
      artist: track.artist_name,
      album: album.name,
      album_artist: album.album_artist,
      year: null, track_no: null, disc_no: null, genre: null,
      cover_url: null,
      external_id: ''
    };
    const blob = await fetchCoverWithFallbacks(fakeCandidate);
    if (!blob) return reply.code(404).send({ error: 'no cover found from any source' });

    const key = createHash('sha1').update(`${album.name.trim().toLowerCase()}\x00${album.album_artist.trim().toLowerCase()}`).digest('hex');
    const target = join(COVERS_DIR, `${key}.${blob.ext}`);
    writeFileSync(target, blob.data);
    db.prepare('UPDATE albums SET cover_path = ? WHERE id = ?').run(target, albumId);
    return { ok: true, bytes: blob.data.length };
  });
};
