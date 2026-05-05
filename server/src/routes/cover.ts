import type { FastifyPluginAsync } from 'fastify';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { db } from '../db.js';

async function sendCover(coverPath: string | null | undefined, req: any, reply: any) {
  if (!coverPath) return reply.code(404).send();
  try {
    const s = await stat(coverPath);
    const ext = extname(coverPath).toLowerCase();
    // ETag derived from mtime+size — invalidates whenever the cover file
    // changes (e.g. after a re-scrape) so browsers don't keep stale images.
    const etag = `"${s.mtimeMs.toString(36)}-${s.size.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    reply.header('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
    reply.header('Content-Length', s.size);
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=60, must-revalidate');
    return reply.send(createReadStream(coverPath));
  } catch {
    return reply.code(404).send();
  }
}

export const coverRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/cover/album/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT cover_path FROM albums WHERE id = ?').get(id) as
      { cover_path: string | null } | undefined;
    return sendCover(row?.cover_path, req, reply);
  });

  app.get<{ Params: { id: string } }>('/api/cover/track/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare(`
      SELECT a.cover_path FROM tracks t LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?
    `).get(id) as { cover_path: string | null } | undefined;
    return sendCover(row?.cover_path, req, reply);
  });
};
