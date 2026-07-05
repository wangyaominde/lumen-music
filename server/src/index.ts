import Fastify from 'fastify';
import compress from '@fastify/compress';
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
import { userRoutes } from './routes/users.js';
import { SESSION_COOKIE, userBySession } from './auth.js';

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
// Compress JSON/text payloads only. Audio (audio/*) and cover (image/*)
// streams are already-encoded bytes and must pass through untouched —
// customTypes replaces the default type regex, and neither audio nor image
// types are compressible per mime-db, so they never hit the encoder.
await app.register(compress, {
  global: true,
  encodings: ['br', 'gzip'],
  customTypes: /^application\/json(?:;|$)|^text\//
});

// Endpoints that require admin role. Listeners get 403 here.
const ADMIN_PREFIXES = ['/api/scan', '/api/enrich', '/api/users'];

// Auth gate: every /api/* call (except /api/auth/login|setup|status|logout)
// requires a valid session. A session resolves to a user; admin-only routes
// further require role==='admin'. Static assets / index.html pass through —
// the SPA itself is harmless without data; the gate just denies the data.
app.addHook('preHandler', async (req, reply) => {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return;

  const isPublicAuth =
    url === '/api/auth/login' ||
    url === '/api/auth/setup' ||
    url === '/api/auth/status' ||
    url === '/api/auth/logout';
  const token = (req as any).cookies?.[SESSION_COOKIE];
  const user = userBySession(token);

  if (isPublicAuth) {
    if (user) (req as any).user = user;
    return;
  }
  if (!user) return reply.code(401).send({ error: 'unauthorized' });
  (req as any).user = user;

  if (user.role !== 'admin' && ADMIN_PREFIXES.some(p => url.startsWith(p))) {
    return reply.code(403).send({ error: 'admin only' });
  }
});

await app.register(authRoutes);
await app.register(userRoutes);
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
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: false,
    // Without this the plugin emits its own Cache-Control (max-age=0) via
    // reply headers, which override anything setHeaders puts on the raw res.
    cacheControl: false,
    setHeaders: (res, filePath) => {
      // Vite content-hashes everything under assets/ — cache forever.
      // index.html (also the SPA notFound fallback below) must revalidate on
      // every load so new deploys land immediately.
      res.setHeader(
        'Cache-Control',
        filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      );
    }
  });
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
