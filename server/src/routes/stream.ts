import type { FastifyPluginAsync } from 'fastify';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { db } from '../db.js';

const MIME: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.alac': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.ape': 'audio/x-ape',
  '.wv': 'audio/x-wavpack',
  '.dsf': 'audio/x-dsd',
  '.dff': 'audio/x-dsd'
};

export const streamRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/stream/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const track = db.prepare('SELECT path FROM tracks WHERE id = ?').get(id) as { path: string } | undefined;
    if (!track) return reply.code(404).send({ error: 'Not found' });

    let stats;
    try {
      stats = await stat(track.path);
    } catch {
      return reply.code(404).send({ error: 'File missing on disk' });
    }
    const total = stats.size;
    const ext = extname(track.path).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';

    // ETag tied to (size, mtime) — invalidates the browser cache when the
    // underlying file is replaced (e.g. swapping in a higher-quality version
    // at the same path).
    const etag = `"${stats.size.toString(36)}-${Math.floor(stats.mtimeMs).toString(36)}"`;
    if (req.headers['if-none-match'] === etag && !req.headers.range) {
      return reply.code(304).send();
    }
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, no-cache, must-revalidate');

    // When the browser cancels (track switched mid-load, user paused, etc.)
    // we have to actively destroy the file read stream so its file descriptor
    // and the underlying socket get released. Without this, rapid track
    // switching piles up half-open streams and eventually the browser hits
    // its 6-per-origin connection cap, freezing playback.
    const attachAbortCleanup = (s: NodeJS.ReadableStream) => {
      const onAbort = () => { (s as any).destroy?.(); };
      req.raw.once('close', onAbort);
      req.raw.once('aborted', onAbort);
      return s;
    };

    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        let start = Number(m[1]);
        let end = m[2] ? Number(m[2]) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start >= total) {
          reply.code(416);
          reply.header('Content-Range', `bytes */${total}`);
          return reply.send();
        }
        if (end >= total) end = total - 1;
        const chunkSize = end - start + 1;
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Length', chunkSize);
        reply.header('Content-Type', contentType);
        return reply.send(attachAbortCleanup(createReadStream(track.path, { start, end })));
      }
    }
    reply.header('Content-Length', total);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', contentType);
    return reply.send(attachAbortCleanup(createReadStream(track.path)));
  });
};
