import type { FastifyPluginAsync } from 'fastify';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { spawn } from 'node:child_process';
import { db } from '../db.js';
import { TRANSCODABLE_EXTENSIONS } from '../config.js';
import { ffmpegPath, hasFfmpeg } from '../lib/ffmpeg.js';

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

const TRANSCODABLE = TRANSCODABLE_EXTENSIONS;

export const streamRoutes: FastifyPluginAsync = async (app) => {
  // Lets the client decide whether requesting transcoded streams is useful.
  app.get('/api/config', async () => ({ transcoding: hasFfmpeg() }));

  app.get<{ Params: { id: string }; Querystring: { quality?: string; t?: string } }>(
    '/api/stream/:id',
    async (req, reply) => {
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

      // On-the-fly AAC transcode for lossless sources — cuts cellular
      // bandwidth ~10x. Output length is unknowable up front, so no ranges
      // and no caching; the client seeks by re-requesting with ?t=<seconds>.
      const quality = req.query.quality;
      if ((quality === 'aac256' || quality === 'aac128') && hasFfmpeg() && TRANSCODABLE.has(ext)) {
        const t = Number(req.query.t);
        const seek = Number.isFinite(t) && t > 0 ? t : 0;
        let child;
        try {
          child = spawn(ffmpegPath!, [
            ...(seek > 0 ? ['-ss', String(seek)] : []),
            '-i', track.path,
            '-map', 'a:0',
            '-vn',
            '-c:a', 'aac',
            '-b:a', quality === 'aac256' ? '256k' : '128k',
            '-f', 'adts',
            '-hide_banner',
            '-loglevel', 'error',
            'pipe:1'
          ], { stdio: ['ignore', 'pipe', 'pipe'] });
        } catch {
          child = null; // spawn failed synchronously — fall back to raw bytes
        }
        if (child) {
          const proc = child;
          let killIssued = false;
          const killChild = () => {
            if (killIssued || proc.exitCode !== null) return;
            killIssued = true;
            proc.kill('SIGKILL');
          };

          let stderrBuf = '';
          proc.stderr.setEncoding('utf8');
          proc.stderr.on('data', (chunk: string) => {
            if (stderrBuf.length < 8192) stderrBuf += chunk;
          });
          proc.on('error', (err) => {
            req.log.warn({ err, trackId: id }, 'ffmpeg transcode process error');
            killChild();
          });
          proc.on('close', (code) => {
            // code is null when we SIGKILL'd it (client went away) — only a
            // genuine nonzero exit mid-stream is worth logging.
            if (code !== null && code !== 0) {
              req.log.warn({ trackId: id, code, stderr: stderrBuf.trim() }, 'ffmpeg transcode exited nonzero');
            }
          });

          // Same writableFinished distinction as the raw branch below: kill
          // ffmpeg only when the response got cut off. A finished response
          // means stdout already ended, but reap a straggling child anyway —
          // killChild guards against double-kill.
          reply.raw.once('close', () => {
            if (!reply.raw.writableFinished) {
              killChild();
            } else if (proc.exitCode === null) {
              killChild();
            }
          });

          reply.code(200);
          reply.header('Content-Type', 'audio/aac');
          reply.header('Accept-Ranges', 'none');
          reply.header('Cache-Control', 'no-store');
          return reply.send(proc.stdout);
        }
      }

      // ETag tied to (size, mtime) — invalidates the browser cache when the
      // underlying file is replaced (e.g. swapping in a higher-quality version
      // at the same path).
      const etag = `"${stats.size.toString(36)}-${Math.floor(stats.mtimeMs).toString(36)}"`;
      if (req.headers['if-none-match'] === etag && !req.headers.range) {
        return reply.code(304).send();
      }
      reply.header('ETag', etag);
      // Just enough freshness for the next-track prefetch (fired <20s before
      // the transition) to be reused without a revalidation round trip. Kept
      // short because within max-age the browser never consults the ETag — a
      // replaced file would keep serving stale bytes for the whole window.
      reply.header('Cache-Control', 'private, max-age=3600');

      // Destroy the file read stream IF the response gets cut off before
      // completion (browser cancels mid-track, etc.). Crucially, do NOT destroy
      // when the response finishes successfully — `reply.raw.writableFinished`
      // distinguishes the two. Earlier we hooked req.raw 'close' which also
      // fires on successful completion, occasionally truncating the response
      // and surfacing as "Load failed" in the audio element.
      const attachAbortCleanup = (s: NodeJS.ReadableStream) => {
        const onClose = () => {
          if (!reply.raw.writableFinished && !(s as any).destroyed) {
            (s as any).destroy?.();
          }
        };
        reply.raw.once('close', onClose);
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
    }
  );
};
