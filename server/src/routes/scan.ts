import type { FastifyPluginAsync } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db.js';
import { getLibraryDirs, scanLibrary, scanState } from '../scanner.js';

export const scanRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/scan/dirs', async () => {
    return db.prepare('SELECT * FROM library_dirs ORDER BY id').all();
  });

  app.post<{ Body: { path: string } }>('/api/scan/dirs', async (req, reply) => {
    if (!req.body?.path) return reply.code(400).send({ error: 'path is required' });
    const p = resolve(req.body.path);
    if (!existsSync(p)) return reply.code(400).send({ error: 'Path does not exist' });
    try {
      const r = db.prepare('INSERT INTO library_dirs (path, added_at) VALUES (?, ?)').run(p, Date.now());
      return { id: r.lastInsertRowid, path: p };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('UNIQUE')) return reply.code(409).send({ error: 'Already added' });
      throw e;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/scan/dirs/:id', async (req) => {
    db.prepare('DELETE FROM library_dirs WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  app.post('/api/scan/run', async (_req, reply) => {
    if (scanState.running) return reply.code(409).send({ error: 'Scan already running' });
    const dirs = getLibraryDirs();
    if (dirs.length === 0) return reply.code(400).send({ error: 'No library directories configured' });
    void scanLibrary(dirs).catch(() => {});
    return { ok: true, started: true };
  });

  app.get('/api/scan/status', async () => scanState);
};
