#!/usr/bin/env node
// The host-local coding worker (Hub #502): node coding-worker.mjs /absolute/private/coding-worker.json
const {main} = await import('@jimmie-potts/runtime/coding-worker');
try {await main(process.argv.slice(2), line => {process.stderr.write(`${line}\n`);});}
catch (error) {process.stderr.write(`${error instanceof Error ? error.message : 'coding-worker failed'}\n`); process.exitCode = 1;}
