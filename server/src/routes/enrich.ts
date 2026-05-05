import type { FastifyPluginAsync } from 'fastify';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { applyCandidate, enrichBatch, enrichState, fetchCoverWithFallbacks, getCandidates, type Candidate } from '../enrich.js';
import { db } from '../db.js';
import { COVERS_DIR } from '../config.js';

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
    for (const t of tracks) {
      try {
        const { candidates } = await getCandidates(t.id);
        const top = candidates.find(c =>
          (c.source === 'musicbrainz' && c.score >= minScore) ||
          (c.source === 'netease' && c.score >= 0.95)
        );
        if (top) {
          await applyCandidate(t.id, top);
          results.push({ track_id: t.id, title: t.title, status: 'applied', chosen: top, topScore: top.score });
        } else {
          const best = candidates[0];
          results.push({ track_id: t.id, title: t.title, status: best ? 'skipped' : 'no-match', topScore: best?.score });
        }
      } catch {
        results.push({ track_id: t.id, title: t.title, status: 'failed' });
      }
    }
    return {
      album: album.name,
      total: tracks.length,
      applied: results.filter(r => r.status === 'applied').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      noMatch: results.filter(r => r.status === 'no-match').length,
      failed: results.filter(r => r.status === 'failed').length,
      results
    };
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
