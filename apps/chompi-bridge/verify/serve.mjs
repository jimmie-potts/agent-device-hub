// The process a CHOMPI bridge verification run serves (Hub #853): `node serve.mjs --data <dir> --port <n>`.
// The module guard goes first, so node-hid and koffi are refused before any bridge code runs; everything else loads
// afterwards. It prints one `{"ready":true,"url":...}` line when the page, the synthetic feed and the bridge are up,
// and a stable `chompi-start-failed: <cause>` line on stderr when they cannot start. SIGTERM and SIGINT stop it.
import './guard.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
};

let run;
try {
  const dataDir = argument('--data');
  const port = Number(argument('--port'));
  const proof = JSON.parse(await readFile(join(dataDir, 'proof.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return 'null'; throw error; }));
  const { startServer } = await import('./server.mjs');
  run = await startServer({ dataDir, port, proof, echo: line => process.stdout.write(`${line}\n`) });
} catch (error) {
  const cause = /^chompi-start-failed: [a-z0-9-]+$/.exec(String(error?.message ?? ''))?.[0] ?? `chompi-start-failed${typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code) ? `: ${error.code}` : ''}`;
  process.stderr.write(`${cause}\n`);
  process.exit(1);
}

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  const code = await run.close();
  process.exit(code === 0 ? 0 : 1);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdout.write(`${JSON.stringify({ ready: true, url: run.url })}\n`);
