import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/stats', async () => {
    const tracks = (db.prepare('SELECT COUNT(*) AS c FROM tracks').get() as { c: number }).c;
    const albums = (db.prepare('SELECT COUNT(*) AS c FROM albums').get() as { c: number }).c;
    const artists = (db.prepare('SELECT COUNT(*) AS c FROM artists').get() as { c: number }).c;
    const duration = (db.prepare('SELECT COALESCE(SUM(duration), 0) AS d FROM tracks').get() as { d: number }).d;
    const lossless = (db.prepare('SELECT COUNT(*) AS c FROM tracks WHERE lossless = 1').get() as { c: number }).c;
    return { tracks, albums, artists, duration, lossless };
  });

  app.get<{ Querystring: { sort?: string; page?: string; pageSize?: string; q?: string } }>(
    '/api/albums',
    async (req) => {
      const sort = req.query.sort ?? 'recent';
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 60)));
      const q = req.query.q?.trim() || null;

      const orderMap: Record<string, string> = {
        recent: 'a.added_at DESC, a.id DESC',
        name: 'a.name COLLATE NOCASE ASC',
        artist: 'a.album_artist COLLATE NOCASE ASC, a.year ASC',
        year: 'a.year DESC NULLS LAST, a.name ASC',
        random: 'RANDOM()'
      };
      const order = orderMap[sort] ?? orderMap.recent;

      let where = '1=1';
      const params: unknown[] = [];
      if (q) {
        where += ' AND (a.name LIKE ? OR a.album_artist LIKE ?)';
        const pat = `%${q}%`;
        params.push(pat, pat);
      }

      const items = db.prepare(`
        SELECT a.id, a.name, a.album_artist, a.year, a.genre, a.track_count, a.duration,
               (a.cover_path IS NOT NULL) AS has_cover
        FROM albums a
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ? OFFSET ?
      `).all(...params, pageSize, (page - 1) * pageSize);

      const total = (db.prepare(`SELECT COUNT(*) AS c FROM albums a WHERE ${where}`).get(...params) as { c: number }).c;
      return { items, total, page, pageSize };
    }
  );

  app.get<{ Params: { id: string } }>('/api/albums/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const album = db.prepare(`
      SELECT a.*, (a.cover_path IS NOT NULL) AS has_cover FROM albums a WHERE a.id = ?
    `).get(id);
    if (!album) return reply.code(404).send({ error: 'Not found' });
    const tracks = db.prepare(`
      SELECT id, title, artist_name, album_id, album_name, album_artist,
             track_no, disc_no, duration, codec, lossless,
             sample_rate, bit_depth, bitrate, file_size
      FROM tracks WHERE album_id = ?
      ORDER BY COALESCE(disc_no, 1), COALESCE(track_no, 9999), title
    `).all(id);
    return { album, tracks };
  });

  app.get<{ Querystring: { sort?: string; q?: string } }>('/api/artists', async (req) => {
    const sort = req.query.sort ?? 'name';
    const orderMap: Record<string, string> = {
      name: 'name COLLATE NOCASE ASC',
      albums: 'album_count DESC, name ASC',
      tracks: 'track_count DESC, name ASC'
    };
    const order = orderMap[sort] ?? orderMap.name;
    const q = req.query.q?.trim() || null;
    if (q) {
      return db.prepare(`SELECT * FROM artists WHERE name LIKE ? ORDER BY ${order}`).all(`%${q}%`);
    }
    return db.prepare(`SELECT * FROM artists WHERE track_count > 0 ORDER BY ${order}`).all();
  });

  app.get<{ Params: { id: string } }>('/api/artists/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    if (!artist) return reply.code(404).send({ error: 'Not found' });
    const albums = db.prepare(`
      SELECT a.id, a.name, a.year, a.album_artist, a.track_count, a.duration,
             (a.cover_path IS NOT NULL) AS has_cover
      FROM albums a
      WHERE a.album_artist = ? OR a.artist_id = ?
      ORDER BY a.year DESC NULLS LAST, a.name ASC
    `).all(artist.name, id);
    const topTracks = db.prepare(`
      SELECT t.id, t.title, t.duration, t.album_id, t.album_name,
             (a.cover_path IS NOT NULL) AS has_cover
      FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
      WHERE t.artist_id = ? OR t.album_artist = ?
      ORDER BY t.scanned_at DESC LIMIT 10
    `).all(id, artist.name);
    return { artist, albums, topTracks };
  });

  app.get<{ Params: { id: string } }>('/api/tracks/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const track = db.prepare(`
      SELECT t.*, (a.cover_path IS NOT NULL) AS has_cover
      FROM tracks t LEFT JOIN albums a ON a.id = t.album_id
      WHERE t.id = ?
    `).get(id);
    if (!track) return reply.code(404).send({ error: 'Not found' });
    return track;
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return { tracks: [], albums: [], artists: [] };
    const pat = `%${q}%`;
    return {
      tracks: db.prepare(`
        SELECT id, title, artist_name, album_name, album_id, duration, lossless
        FROM tracks
        WHERE title LIKE ? OR artist_name LIKE ? OR album_name LIKE ?
        LIMIT 30
      `).all(pat, pat, pat),
      albums: db.prepare(`
        SELECT id, name, album_artist, year, (cover_path IS NOT NULL) AS has_cover
        FROM albums WHERE name LIKE ? OR album_artist LIKE ?
        LIMIT 20
      `).all(pat, pat),
      artists: db.prepare(
        'SELECT id, name, track_count, album_count FROM artists WHERE name LIKE ? LIMIT 20'
      ).all(pat)
    };
  });

  app.get('/api/recent/albums', async () => {
    return db.prepare(`
      SELECT a.id, a.name, a.album_artist, a.year, a.track_count,
             (a.cover_path IS NOT NULL) AS has_cover
      FROM albums a ORDER BY a.added_at DESC LIMIT 20
    `).all();
  });
};
