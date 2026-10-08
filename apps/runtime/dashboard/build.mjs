// Builds the runtime's dashboard (Hub #922) into the runtime's `dist/dashboard/`: the page, its script and its styles,
// which the gateway serves at `/`, `/dashboard.js` and `/dashboard.css`. The page imports the SDK's remote client from
// `@jimmie-potts/sdk/remote`, so the SDK and the event contracts are built first.
import {build} from 'esbuild';
import {mkdir, writeFile} from 'node:fs/promises';
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
