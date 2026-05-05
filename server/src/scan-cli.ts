import { db } from './db.js';
import { getLibraryDirs, scanLibrary, scanState } from './scanner.js';

const args = process.argv.slice(2);
for (const arg of args) {
  try {
    db.prepare('INSERT INTO library_dirs (path, added_at) VALUES (?, ?)').run(arg, Date.now());
  } catch { /* already added */ }
}

const dirs = getLibraryDirs();
if (dirs.length === 0) {
  console.error('No library directories. Pass paths as arguments or add via API.');
  process.exit(1);
}

console.log('Scanning:', dirs);
const reportInterval = setInterval(() => {
  if (!scanState.running) return;
  const pct = scanState.total ? Math.floor((scanState.scanned / scanState.total) * 100) : 0;
  process.stdout.write(`\r[${pct}%] ${scanState.scanned}/${scanState.total}  +${scanState.added} ~${scanState.updated} =${scanState.unchanged} !${scanState.failed}   `);
}, 250);

await scanLibrary(dirs);
clearInterval(reportInterval);
console.log(`\nDone. added=${scanState.added}, updated=${scanState.updated}, unchanged=${scanState.unchanged}, removed=${scanState.removed}, failed=${scanState.failed}`);
process.exit(0);
