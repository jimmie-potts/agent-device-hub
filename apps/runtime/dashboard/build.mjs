// Builds the runtime's dashboard (Hub #922) into the runtime's `dist/dashboard/`: the page, its script and its styles,
// which the gateway serves at `/`, `/dashboard.js` and `/dashboard.css`. The page imports the SDK's remote client from
// `@jimmie-potts/sdk/remote`, so the SDK and the event contracts are built first.
import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const out = new URL('../dist/dashboard/', import.meta.url);
await mkdir(out, {recursive: true});
await build({
  entryPoints: [fileURLToPath(new URL('src/main.tsx', import.meta.url))], bundle: true, minify: true, format: 'esm', target: 'es2022',
  platform: 'browser', outfile: fileURLToPath(new URL('dashboard.js', out)), legalComments: 'eof', logLevel: 'warning',
});
await writeFile(new URL('index.html', out), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>B.U.N.N.Y. · Integration</title><link rel="stylesheet" href="/dashboard.css"></head><body><div id="root"></div>'
  + '<script type="module" src="/dashboard.js"></script></body></html>\n');

// Freeze the source identity at build time. The running gateway reads it once, never querying Git per request.
const root = fileURLToPath(new URL('../../../', import.meta.url));
let revision = null;
let dirty = null;
try {
  const found = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  if (/^[0-9a-f]{40}$/.test(found)) revision = found;
  dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim() !== '';
} catch { /* A source archive has no Git identity. */ }
const {version} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(new URL('../dist/src/build-identity.js', import.meta.url), 'export const BUILD_IDENTITY = Object.freeze(' + JSON.stringify({schema: 'runtime-build/2.0', version, revision, dirty, builtAt: new Date().toISOString()}) + ');\n');
