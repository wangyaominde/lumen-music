import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { COVERS_DIR, DATA_DIR, DB_PATH } from './config.js';

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(COVERS_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS library_dirs (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  added_at INTEGER NOT NULL,
  last_scan INTEGER
);

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_name TEXT,
  album_count INTEGER DEFAULT 0,
  track_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  album_artist TEXT NOT NULL,
  year INTEGER,
  genre TEXT,
  cover_path TEXT,
  track_count INTEGER DEFAULT 0,
  duration REAL DEFAULT 0,
  added_at INTEGER NOT NULL,
  UNIQUE(name, album_artist)
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  artist_name TEXT NOT NULL,
  album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
  album_name TEXT NOT NULL,
  album_artist TEXT NOT NULL,
  track_no INTEGER,
  disc_no INTEGER,
  year INTEGER,
  genre TEXT,
  duration REAL,
  bitrate INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  codec TEXT,
  container TEXT,
  lossless INTEGER DEFAULT 0,
  file_size INTEGER,
  mtime INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);
CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);
CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist);
CREATE INDEX IF NOT EXISTS idx_albums_name ON albums(name);
CREATE INDEX IF NOT EXISTS idx_albums_album_artist ON albums(album_artist);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pl_tracks ON playlist_tracks(playlist_id, position);

CREATE TABLE IF NOT EXISTS favorites (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plays_track ON plays(track_id);
CREATE INDEX IF NOT EXISTS idx_plays_at ON plays(played_at DESC);

CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'listener')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_seen ON sessions(last_seen DESC);
`;

// Idempotent column-add for sessions.user_id (SQLite has no ADD COLUMN
// IF NOT EXISTS, so we ask PRAGMA first).
function ensureColumn(table: string, col: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

db.exec(SCHEMA);

ensureColumn('sessions', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE CASCADE');

// Migrate single-PIN setup → first admin user.
const legacyAuth = db.prepare('SELECT password_hash, created_at, updated_at FROM auth WHERE id = 1').get() as
  { password_hash: string; created_at: number; updated_at: number } | undefined;
const anyUser = db.prepare('SELECT 1 FROM users LIMIT 1').get();
if (legacyAuth && !anyUser) {
  db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run('admin', legacyAuth.password_hash, 'admin', legacyAuth.created_at, legacyAuth.updated_at);
  // Old sessions had no user_id — they'll be treated as invalid by the new
  // auth check, which is what we want.
  db.exec('DELETE FROM sessions WHERE user_id IS NULL');
}
