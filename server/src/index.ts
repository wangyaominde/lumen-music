import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST, PORT } from './config.js';
import { libraryRoutes } from './routes/library.js';
import { scanRoutes } from './routes/scan.js';
import { coverRoutes } from './routes/cover.js';
import { streamRoutes } from './routes/stream.js';
import { playlistRoutes } from './routes/playlists.js';
import { favoriteRoutes } from './routes/favorites.js';
import { lyricsRoutes } from './routes/lyrics.js';
import { enrichRoutes } from './routes/enrich.js';
import { authRoutes } from './routes/auth.js';
import { SESSION_COOKIE, validateSession } from './auth.js';

const app = Fastify({ logger: { level: 'info' }, bodyLimit: 50 * 1024 * 1024 });

// Accept empty JSON bodies on POST/DELETE rather than 400'ing.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const s = (body as string) ?? '';
  if (s.trim() === '') return done(null, undefined);
  try { done(null, JSON.parse(s)); } catch (e) { done(e as Error); }
});

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);

// Auth gate: every /api/* call (except /api/auth/*) requires a valid session.
// Static assets / index.html pass through — the SPA itself is harmless without
// data; the gate just denies the data.
app.addHook('preHandler', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return;
  if (url.startsWith('/api/auth/')) return;
  const token = (req as any).cookies?.[SESSION_COOKIE];
  if (!validateSession(token)) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
});

await app.register(authRoutes);
await app.register(libraryRoutes);
await app.register(scanRoutes);
await app.register(coverRoutes);
await app.register(streamRoutes);
await app.register(playlistRoutes);
await app.register(favoriteRoutes);
await app.register(lyricsRoutes);
await app.register(enrichRoutes);

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
    reply.sendFile('index.html');
  });
}

try {
  const addr = await app.listen({ port: PORT, host: HOST });
  app.log.info(`Lumen Music listening at ${addr}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
