import type { FastifyPluginAsync } from 'fastify';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '../db.js';
import { DATA_DIR } from '../config.js';
import { ffmpegPath, hasFfmpeg } from '../lib/ffmpeg.js';

const COVER_CACHE_DIR = join(DATA_DIR, 'cache', 'covers');
const SIZES = new Set([96, 320, 800]);
// One hour of freshness kills the old per-minute revalidation storm, but a
// re-scraped cover still shows up within the hour — within max-age the
// browser never consults the ETag, so anything longer makes new art invisible.
const COVER_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

// Async (never spawnSync) so a resize burst can't starve audio streaming.
// The semaphore caps a cold album-grid load (60 covers at once) to a handful
// of concurrent encoder processes instead of one per cache miss.
const FFMPEG_MAX_CONCURRENT = 4;
let ffmpegRunning = 0;
const ffmpegWaiters: Array<() => void> = [];

async function runFfmpeg(args: string[]): Promise<boolean> {
  if (ffmpegRunning >= FFMPEG_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => ffmpegWaiters.push(resolve));
  }
  ffmpegRunning++;
  try {
    return await new Promise((resolve) => {
      let child;
      try {
        child = spawn(ffmpegPath!, args, { stdio: 'ignore' });
      } catch {
        resolve(false);
        return;
      }
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  } finally {
    ffmpegRunning--;
    ffmpegWaiters.shift()?.();
  }
}

// Concurrent misses for the same variant share one generation instead of
// each spawning their own ffmpeg.
const inflight = new Map<string, Promise<string | null>>();

/**
 * Path of a cached resized JPEG for (albumId, size), generated on demand.
 * The filename embeds the source mtime, so a re-scraped cover (new mtime)
 * naturally misses the cache; stale variants are unlinked once the fresh one
 * lands. Returns null when the variant can't be produced (missing source,
 * ffmpeg failure) — callers fall back to the original file.
 */
async function resizedCover(albumId: number, srcPath: string, size: number): Promise<string | null> {
  let src;
  try {
    src = await stat(srcPath);
  } catch {
    return null;
  }
  const name = `${albumId}-${size}-${Math.floor(src.mtimeMs).toString(36)}.jpg`;
  const dest = join(COVER_CACHE_DIR, name);
  try {
    await stat(dest);
    return dest;
  } catch {
    // cache miss — generate below
  }
  const pending = inflight.get(dest);
  if (pending) return pending;
  const job = generateVariant(albumId, srcPath, size, name, dest);
  inflight.set(dest, job);
  try {
    return await job;
  } finally {
    inflight.delete(dest);
  }
}

async function generateVariant(
  albumId: number, srcPath: string, size: number, name: string, dest: string
): Promise<string | null> {
  try {
    await mkdir(COVER_CACHE_DIR, { recursive: true });
  } catch {
    return null;
  }
  // Unique tmp name per request so concurrent misses never read (or clobber)
  // a half-written file; the rename into place is atomic.
  const tmp = join(COVER_CACHE_DIR, `.tmp-${randomBytes(4).toString('hex')}-${name}`);
  const ok = await runFfmpeg([
    '-i', srcPath,
    '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
    '-frames:v', '1',
    '-q:v', '4',
    '-y', tmp
  ]);
  if (!ok) {
    unlink(tmp).catch(() => {});
    return null;
  }
  try {
    await rename(tmp, dest);
  } catch {
    unlink(tmp).catch(() => {});
    return null;
  }
  // Opportunistically drop variants generated from an older source file.
  try {
    const prefix = `${albumId}-${size}-`;
    for (const f of await readdir(COVER_CACHE_DIR)) {
      if (f !== name && f.startsWith(prefix)) {
        unlink(join(COVER_CACHE_DIR, f)).catch(() => {});
      }
    }
  } catch {
    // best-effort cleanup only
  }
  return dest;
}

async function sendCover(coverPath: string | null | undefined, req: any, reply: any, albumId?: number | null) {
  if (!coverPath) return reply.code(404).send();

  let servePath = coverPath;
  const size = Number(req.query?.size);
  if (SIZES.has(size) && albumId != null && hasFfmpeg()) {
    const resized = await resizedCover(albumId, coverPath, size);
    if (resized) servePath = resized;
  }

  let s;
  try {
    s = await stat(servePath);
  } catch {
    // A resized variant can vanish between resolution and here (stale-variant
    // cleanup after a re-scrape) — the original is still the right answer.
    if (servePath === coverPath) return reply.code(404).send();
    servePath = coverPath;
    try {
      s = await stat(servePath);
    } catch {
      return reply.code(404).send();
    }
  }
  const ext = extname(servePath).toLowerCase();
  // ETag derived from mtime+size of the file actually served — invalidates
  // whenever the cover (or its resized variant) changes, e.g. after a
  // re-scrape.
  const etag = `"${s.mtimeMs.toString(36)}-${s.size.toString(36)}"`;
  reply.header('ETag', etag);
  reply.header('Cache-Control', COVER_CACHE_CONTROL);
  if (req.headers['if-none-match'] === etag) {
    return reply.code(304).send();
  }
  reply.header('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
  reply.header('Content-Length', s.size);
  return reply.send(createReadStream(servePath));
}

export const coverRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/api/cover/album/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT cover_path FROM albums WHERE id = ?').get(id) as
      { cover_path: string | null } | undefined;
    return sendCover(row?.cover_path, req, reply, id);
  });

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>('/api/cover/track/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const row = db.prepare(`
      SELECT a.id AS album_id, a.cover_path FROM tracks t LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ?
    `).get(id) as { album_id: number | null; cover_path: string | null } | undefined;
    return sendCover(row?.cover_path, req, reply, row?.album_id);
  });
};
