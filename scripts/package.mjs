#!/usr/bin/env node
/**
 * Build a self-contained, deployable Lumen Music bundle.
 *
 * Layout produced under ./release/ :
 *   server/       compiled JS + prod-only node_modules
 *   web/dist/     static front-end assets (served by server)
 *   data/         empty placeholder for runtime DB + covers
 *   start.sh      entry point
 *   README.md     deploy notes
 *
 * After running: tar/zip ./release/ → copy to host → ./start.sh
 */
import { execSync } from 'node:child_process';
import { rm, mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const release = join(root, 'release');
const srvDir = join(release, 'server');

const log = (s) => console.log(`\x1b[36m▶\x1b[0m ${s}`);
const ok  = (s) => console.log(`\x1b[32m✓\x1b[0m ${s}`);
const sh  = (cmd, cwd) => execSync(cmd, { cwd: cwd ?? root, stdio: 'inherit' });

log('cleaning previous release');
await rm(release, { recursive: true, force: true });
await mkdir(srvDir, { recursive: true });
await mkdir(join(release, 'web'), { recursive: true });
// NOTE: intentionally do NOT create release/data/ here. The bundle ships
// without a data/ directory so that re-extracting a new tarball over an
// existing install never touches the user's library.db / covers/. start.sh
// creates the dir on first launch if missing.

log('building server (tsc → server/dist)');
sh('pnpm --filter @lumen/server build');

log('building web (vite → web/dist)');
sh('pnpm --filter @lumen/web build');

log('copying server compiled output');
await cp(join(root, 'server/dist'), join(srvDir, 'dist'), { recursive: true });

log('writing release server package.json (prod deps only)');
const srvPkg = JSON.parse(await readFile(join(root, 'server/package.json'), 'utf8'));
const releasePkg = {
  name: '@lumen/server',
  version: srvPkg.version,
  private: true,
  type: 'module',
  main: 'dist/index.js',
  scripts: { start: 'node dist/index.js' },
  dependencies: srvPkg.dependencies,
  engines: { node: '>=20' }
};
await writeFile(join(srvDir, 'package.json'), JSON.stringify(releasePkg, null, 2) + '\n');

log('installing prod deps (npm install --omit=dev)');
sh('npm install --omit=dev --no-audit --no-fund --silent', srvDir);

log('copying web dist');
await cp(join(root, 'web/dist'), join(release, 'web/dist'), { recursive: true });

log('writing start.sh');
const startSh = `#!/usr/bin/env sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Default data dir lives next to the bundle. Override by exporting
# LUMEN_DATA_DIR before running this script. Created on first launch so the
# bundle itself stays free of state — re-extracting a new tarball over an
# old install never touches it.
: "\${LUMEN_DATA_DIR:=$ROOT/data}"
export LUMEN_DATA_DIR
mkdir -p "$LUMEN_DATA_DIR"

cd "$ROOT/server"
exec node --enable-source-maps dist/index.js
`;
await writeFile(join(release, 'start.sh'), startSh, { mode: 0o755 });

log('writing upgrade.sh (in-place upgrade helper)');
const upgradeSh = `#!/usr/bin/env sh
# Drop a new lumen-music tarball next to the running install and run this to
# replace server/ + web/ + start.sh in place while preserving data/. Restart
# the service afterward.
#
#   ./upgrade.sh /path/to/lumen-music-vX.Y.Z-<target>.tar.gz
set -eu
TAR="\${1:?usage: ./upgrade.sh <new-bundle.tar.gz>}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "Upgrading $ROOT from $TAR ..."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TAR" -C "$TMP"

# Replace the code-bearing directories. Anything new in the bundle wins.
rm -rf "$ROOT/server" "$ROOT/web" "$ROOT/start.sh" "$ROOT/upgrade.sh" "$ROOT/README.md" "$ROOT/lumen-music.service" "$ROOT/.env.example" 2>/dev/null || true
cp -R "$TMP/." "$ROOT/"

echo "Done. Your data/ directory is untouched. Restart the service now."
`;
await writeFile(join(release, 'upgrade.sh'), upgradeSh, { mode: 0o755 });

log('writing systemd unit (optional)');
const unit = `[Unit]
Description=Lumen Music Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/lumen-music/server
Environment=NODE_ENV=production
Environment=PORT=4477
Environment=HOST=0.0.0.0
Environment=LUMEN_DATA_DIR=/opt/lumen-music/data
ExecStart=/usr/bin/env node dist/index.js
Restart=on-failure
RestartSec=5
User=lumen

[Install]
WantedBy=multi-user.target
`;
await writeFile(join(release, 'lumen-music.service'), unit);

log('writing .env example');
await writeFile(join(release, '.env.example'), `# Override these as needed before running ./start.sh
# PORT=4477
# HOST=0.0.0.0
# LUMEN_DATA_DIR=../data
# NODE_ENV=production    # required behind HTTPS so cookies get Secure flag
`);

log('writing README');
const readme = `# Lumen Music — Production Bundle

Self-contained build of Lumen Music. Includes the compiled server, the static
front-end assets, prod-only \`node_modules\`, a start script, and a systemd unit
template.

Built on \`${process.platform}-${process.arch}\` with Node \`${process.version}\`.

---

## Quick start

\`\`\`bash
./start.sh
\`\`\`

Then open \`http://<host>:4477/\`. First visit asks you to set a 6-digit PIN.

## Upgrading

Drop the new tarball alongside the install and run the in-place helper —
\`data/\` (your library, PIN hashes, sessions, covers) is preserved untouched:

\`\`\`bash
./upgrade.sh /path/to/lumen-music-vX.Y.Z-<target>.tar.gz
sudo systemctl restart lumen-music    # or however you run it
\`\`\`

Or do it manually: extract the new tarball over the install (\`tar\` won't
delete files inside \`data/\` that the new bundle doesn't contain — the new
bundle ships without a \`data/\` directory exactly for this reason):

\`\`\`bash
tar -xzf lumen-music-vX.Y.Z-<target>.tar.gz -C /opt/lumen-music
\`\`\`

## Configuration

All via environment variables:

| Var | Default | Notes |
|---|---|---|
| \`PORT\` | \`4477\` | TCP port to listen on |
| \`HOST\` | \`0.0.0.0\` | Bind address |
| \`LUMEN_DATA_DIR\` | \`../data\` | Where \`library.db\` and \`covers/\` live |
| \`NODE_ENV\` | (unset) | Set to \`production\` when behind HTTPS — flips cookie \`Secure\` flag |

\`./start.sh\` already \`cd\`s into \`server/\` so the default \`LUMEN_DATA_DIR=../data\`
points at the \`data/\` folder next to it.

## Cross-platform deploy

The bundle includes a precompiled \`better-sqlite3\` native binding for the
build host (\`${process.platform}-${process.arch}\`). Deploying to a different
platform? Rebuild it once on the target:

\`\`\`bash
cd server
npm rebuild better-sqlite3
\`\`\`

This needs the host's standard build toolchain (Xcode CLI on macOS, or
\`build-essential\` + \`python3\` on Debian/Ubuntu).

## Reverse proxy

Lumen serves both the API and the SPA on the same port, so a single
\`proxy_pass\` is enough. Caddy example:

\`\`\`
music.example.com {
  reverse_proxy localhost:4477
}
\`\`\`

Nginx example (note the \`Range\` / large body bits matter for streaming):

\`\`\`nginx
server {
  server_name music.example.com;
  listen 443 ssl http2;
  client_max_body_size 50m;
  proxy_buffering off;
  location / {
    proxy_pass http://127.0.0.1:4477;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
  }
}
\`\`\`

When proxied behind HTTPS, run the server with \`NODE_ENV=production\` so the
session cookie gets the \`Secure\` flag.

## systemd

A unit template is included as \`lumen-music.service\`. To install:

\`\`\`bash
sudo useradd -r -s /bin/false lumen
sudo mkdir -p /opt/lumen-music
sudo cp -R . /opt/lumen-music/
sudo chown -R lumen:lumen /opt/lumen-music
sudo cp lumen-music.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lumen-music
\`\`\`

## Data directory

Everything that needs to persist (library index + extracted album covers) lives
in \`data/\`. Back this up — losing it just means re-scanning, not losing files,
but it includes scrape results and your access PIN hash.

## Layout

\`\`\`
.
├── server/                  compiled JS + node_modules (prod only)
│   ├── dist/index.js
│   └── package.json
├── web/dist/                static front-end (served by server)
├── start.sh                 entry script (creates data/ on first launch)
├── upgrade.sh               in-place upgrade helper, preserves data/
├── lumen-music.service      systemd unit template
├── .env.example
└── README.md

# at runtime, alongside the bundle:
└── data/                    library.db, covers/   (NOT in the tarball)
\`\`\`
`;
await writeFile(join(release, 'README.md'), readme);

const size = execSync(`du -sh ${release}`).toString().trim().split(/\s+/)[0];
const fileCount = execSync(`find ${release} -type f | wc -l`).toString().trim();
console.log('');
ok(`bundle ready at \x1b[1m${release}\x1b[0m  (${size}, ${fileCount} files)`);
console.log('');
console.log('  Run locally:   cd release && ./start.sh');
console.log('  Tar for ship:  tar -czf lumen-music.tar.gz -C release .');
console.log('');
