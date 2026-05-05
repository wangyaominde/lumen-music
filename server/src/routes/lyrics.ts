import type { FastifyPluginAsync } from 'fastify';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, dirname, basename } from 'node:path';
import { db } from '../db.js';
import { fetchNetEaseLyrics, searchNetEase } from '../enrich.js';

export const lyricsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/lyrics/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const track = db.prepare('SELECT path, title, artist_name FROM tracks WHERE id = ?').get(id) as
      { path: string; title: string; artist_name: string } | undefined;
    if (!track) return reply.code(404).send({ error: 'Not found' });

    // 1. Local .lrc next to file
    const ext = extname(track.path);
    const base = track.path.slice(0, track.path.length - ext.length);
    const candidates = [`${base}.lrc`, `${base}.LRC`, join(dirname(track.path), `${basename(base)}.lrc`)];
    for (const c of candidates) {
      try {
        const s = await stat(c);
        if (s.isFile()) {
          const content = await readFile(c, 'utf8');
          return { source: 'local', content };
        }
      } catch { /* skip */ }
    }

    // 2. NetEase fallback — iterate strong matches until one with lyrics is found.
    // Require artist match (score >= 0.78) so we don't return cover-song lyrics
    // for the wrong artist (NetEase often hides original artists due to licensing).
    try {
      const songs = await searchNetEase({ title: track.title, artist: track.artist_name });
      for (const song of songs.filter(s => s.score >= 0.78).slice(0, 6)) {
        const lrc = await fetchNetEaseLyrics(song.external_id);
        if (lrc && lrc.split('\n').filter(l => /\[\d+:\d+/.test(l)).length >= 3) {
          return { source: 'netease', content: lrc, matched_as: `${song.artist} – ${song.title}` };
        }
      }
    } catch { /* ignore */ }

    return reply.code(404).send({ error: 'No lyrics found' });
  });
};
