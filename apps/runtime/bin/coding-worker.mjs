#!/usr/bin/env node
// The host-local coding worker (Hub #502): node coding-worker.mjs /absolute/private/coding-worker.json
const {main} = await import('@jimmie-potts/runtime/coding-worker');
try {await main(process.argv.slice(2), line => {process.stderr.write(`${line}\n`);});}
catch (error) {
  // A private-file refusal names the file in its message; the log line carries only the fixed problem, never a path.
  const line = error instanceof Error && 'problem' in error ? `coding-worker: private file ${String(error.problem)}`
    : error instanceof Error && /^(usage|coding-worker)/.test(error.message) ? error.message : `coding-worker failed: ${error instanceof Error ? error.name : 'unknown'}`;
  process.stderr.write(`${line}\n`); process.exitCode = 1;
}
