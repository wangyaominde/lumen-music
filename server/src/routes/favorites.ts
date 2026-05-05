import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';

export const favoriteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/favorites', async () => {
    return db.prepare(`
      SELECT t.id, t.title, t.artist_name, t.album_name, t.album_id,
             t.duration, t.lossless, f.added_at
      FROM favorites f JOIN tracks t ON t.id = f.track_id
      ORDER BY f.added_at DESC
    `).all();
  });

  app.get('/api/favorites/ids', async () => {
    const rows = db.prepare('SELECT track_id FROM favorites').all() as { track_id: number }[];
    return rows.map(r => r.track_id);
  });

  app.post<{ Params: { id: string } }>('/api/favorites/:id', async (req) => {
    db.prepare('INSERT OR IGNORE INTO favorites (track_id, added_at) VALUES (?, ?)').run(Number(req.params.id), Date.now());
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/favorites/:id', async (req) => {
    db.prepare('DELETE FROM favorites WHERE track_id = ?').run(Number(req.params.id));
    return { ok: true };
  });
};
