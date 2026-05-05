import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';

export const playlistRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/playlists', async () => {
    return db.prepare(`
      SELECT p.id, p.name, p.created_at, p.updated_at,
             COUNT(pt.id) AS track_count,
             COALESCE(SUM(t.duration), 0) AS duration
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
      LEFT JOIN tracks t ON t.id = pt.track_id
      GROUP BY p.id ORDER BY p.updated_at DESC
    `).all();
  });

  app.post<{ Body: { name: string } }>('/api/playlists', async (req, reply) => {
    if (!req.body?.name) return reply.code(400).send({ error: 'name required' });
    const now = Date.now();
    const r = db.prepare('INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)').run(req.body.name, now, now);
    return { id: r.lastInsertRowid, name: req.body.name };
  });

  app.get<{ Params: { id: string } }>('/api/playlists/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const pl = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
    if (!pl) return reply.code(404).send();
    const tracks = db.prepare(`
      SELECT t.id, t.title, t.artist_name, t.album_name, t.album_id,
             t.duration, t.lossless, pt.position, pt.id AS pt_id
      FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id
      WHERE pt.playlist_id = ? ORDER BY pt.position
    `).all(id);
    return { playlist: pl, tracks };
  });

  app.post<{ Params: { id: string }; Body: { trackIds: number[] } }>('/api/playlists/:id/tracks', async (req) => {
    const id = Number(req.params.id);
    const trackIds = req.body.trackIds || [];
    const max = (db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM playlist_tracks WHERE playlist_id = ?').get(id) as { m: number }).m;
    const ins = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?, ?, ?, ?)');
    const now = Date.now();
    db.transaction(() => {
      let p = max;
      for (const t of trackIds) ins.run(id, t, ++p, now);
      db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(now, id);
    })();
    return { ok: true, added: trackIds.length };
  });

  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async (req) => {
    db.prepare('DELETE FROM playlists WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string; ptid: string } }>('/api/playlists/:id/tracks/:ptid', async (req) => {
    db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?').run(Number(req.params.ptid), Number(req.params.id));
    return { ok: true };
  });
};
