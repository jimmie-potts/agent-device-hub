import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('apps/hub/public',{recursive:true});
await build({entryPoints:['apps/dashboard/src/main.tsx'],bundle:true,minify:true,format:'esm',target:'es2022',outfile:'apps/hub/public/dashboard.js',legalComments:'eof'});
await writeFile('apps/hub/public/index.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BUNNY · Integration</title><link rel="stylesheet" href="/dashboard.css"></head><body><div id="root"></div><script type="module" src="/dashboard.js"></script></body></html>');
