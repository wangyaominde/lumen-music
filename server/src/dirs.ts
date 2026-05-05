import { db } from './db.js';

export function getLibraryDirs(): string[] {
  return (db.prepare('SELECT path FROM library_dirs').all() as { path: string }[]).map(r => r.path);
}
