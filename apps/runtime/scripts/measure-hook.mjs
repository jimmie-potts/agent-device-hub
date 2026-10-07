#!/usr/bin/env node
// Measures the 2.0 agent hook end to end (Hub #926): from starting `bin/monitor-hook.mjs` as a client's hook command does
// to its exit, against a disposable runtime's edge. The runtime is the shipped entry point (`dist/src/main.js`) with the
// core and its gateway, in its own process, with one converted producer credential; each hook is a new Node process with
// an unchanged 1.x producer file and a synthetic Claude Code payload. It also measures the hook against a stopped runtime
// (a closed port) and one that never answers, which end at the hook's own budget. Every observation sent to the live
// runtime must be accepted, by the core's `message.received` records.
//   node apps/runtime/scripts/measure-hook.mjs [--runs 25] [--stopped 5] [--silent 3]
// Run `npm run build` first, with TMPDIR outside every Git checkout. The token is synthetic, and the runtime holds only
// its digest. Output is one JSON line per case, then a summary with the median and the worst of each.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {cpus, release, tmpdir, totalmem} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {runs: {type: 'string', default: '25'}, stopped: {type: 'string', default: '5'}, silent: {type: 'string', default: '3'}}});
const runs = Number(values.runs), stoppedRuns = Number(values.stopped), silentRuns = Number(values.silent);
if (![runs, stoppedRuns, silentRuns].every(value => Number.isSafeInteger(value) && value >= 0) || runs < 1) {
  process.stderr.write('usage: measure-hook.mjs [--runs 25] [--stopped 5] [--silent 3]\n');
  process.exit(2);
}
const MAIN = fileURLToPath(new URL('../dist/src/main.js', import.meta.url));
const HOOK = fileURLToPath(new URL('../bin/monitor-hook.mjs', import.meta.url));
const {CONFIG_SCHEMA, CREDENTIALS_SCHEMA, tokenDigest} = await import(new URL('../dist/src/index.js', import.meta.url).href);
const {producerCredentialId, producerSource} = await import(new URL('../dist/src/hook/index.js', import.meta.url).href);
const SOURCE = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code-hooks', hook: 'SessionStart'};
// The client's hooks for one turn with an approval, in order; each run sends the next.
const TURN = [
  ['SessionStart', {}], ['UserPromptSubmit', {prompt: 'synthetic prompt'}], ['PermissionRequest', {tool_name: 'Bash'}],
  ['PostToolUse', {tool_use_id: 'tool-1', tool_response: {output: 'synthetic'}}], ['Stop', {}],
];
// Claude Code variables a test run inside an agent session would carry; the hook gets none of them.
const HOOK_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CLAUDE_CODE_') && name !== 'CODEX_HOME'));
const round = value => Math.round(value * 10) / 10;

async function writePrivate(file, text) {
  await writeFile(file, text, {mode: 0o600});
  await chmod(file, 0o600);
}

/** One hook process, from its start to its exit, with `input` on stdin. */
async function hook(producer, input) {
  const started = performance.now();
  const child = spawn(process.execPath, [HOOK, producer], {stdio: ['pipe', 'pipe', 'pipe'], env: HOOK_ENV});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const [code, signal] = await once(child, 'exit');
  return {ms: round(performance.now() - started), code, signal, quiet: output === ''};
}

async function producerFile(dir, name, port, token) {
  const folder = join(dir, name);
  await mkdir(folder, {mode: 0o700});
  const path = join(folder, 'producer.json');
  await writePrivate(path, JSON.stringify({lifecycleVersion: '1.2', enabled: true, qualified: true, source: SOURCE, endpoint: `http://127.0.0.1:${port}/api/monitor/v1/events`, token}));
  return path;
}

const statistics = samples => {
  const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] : round((sorted[middle - 1] + sorted[middle]) / 2);
  return {runs: sorted.length, medianMs: median, worstMs: sorted.at(-1), bestMs: sorted[0], allExitedQuietly: samples.every(sample => sample.code === 0 && sample.signal === null && sample.quiet)};
};

const dir = await mkdtemp(join(await realpath(tmpdir()), 'bunny-hook-'));
await chmod(dir, 0o700);
let runtime;
const silent = createServer(() => {});
try {
  const token = `tok_SYNTHETIC926_${randomBytes(20).toString('base64url').slice(0, 26)}`;
  const credentials = join(dir, 'edge-credentials.json'), config = join(dir, 'runtime-config.json');
  await writePrivate(credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: producerCredentialId(SOURCE), source: producerSource(SOURCE), digest: tokenDigest(token), scopes: ['ingest']},
  ]}));
  await writePrivate(config, JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {credentials, launcher: false}}));
  await mkdir(join(dir, 'state'), {mode: 0o700});
  runtime = spawn(process.execPath, [MAIN, '--port', '0', '--state-dir', join(dir, 'state'), '--config', config, '--edge', '--environment', 'test'], {stdio: ['ignore', 'pipe', 'pipe']});
  // The core's intake records, from the runtime's journal on stderr.
  const intake = [];
  createInterface({input: runtime.stderr}).on('line', line => {
    try {
      const record = JSON.parse(line);
      if (record.event_name === 'message.received') intake.push(record.attributes['bunny.outcome']);
    } catch {
      // Not a record.
    }
  });
  const [ready] = await once(createInterface({input: runtime.stdout}), 'line');
  const {port} = new URL(JSON.parse(ready).url);
  const live = await producerFile(dir, 'live', port, token);

  const results = {};
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const [name, extra] = TURN[run % TURN.length];
    const session = `measure-${Math.floor(run / TURN.length)}`;
    const sample = await hook(live, JSON.stringify({hook_event_name: name, session_id: session, prompt_id: `prompt-${session}`, cwd: '/home/owner/projects/demo', ...extra}));
    samples.push(sample);
    process.stdout.write(`${JSON.stringify({case: 'live', hook: name, ...sample})}\n`);
  }
  // Give the core a moment to log the last intake.
  await new Promise(resolve => { setTimeout(resolve, 200); });
  results.live = {...statistics(samples), accepted: intake.filter(outcome => outcome === 'accepted').length};

  // A stopped runtime: a port nothing listens on.
  const closed = createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const closedPort = closed.address().port;
  closed.close();
  await once(closed, 'close');
  const stopped = await producerFile(dir, 'stopped', closedPort, token);
  const stoppedSamples = [];
  for (let run = 0; run < stoppedRuns; run += 1) stoppedSamples.push(await hook(stopped, JSON.stringify({hook_event_name: 'Stop', session_id: 'measure-stopped'})));
  if (stoppedSamples.length > 0) results.stopped = statistics(stoppedSamples);

  // A runtime that takes every call and never answers.
  silent.listen(0, '127.0.0.1');
  await once(silent, 'listening');
  const stuck = await producerFile(dir, 'silent', silent.address().port, token);
  const silentSamples = [];
  for (let run = 0; run < silentRuns; run += 1) silentSamples.push(await hook(stuck, JSON.stringify({hook_event_name: 'Stop', session_id: 'measure-silent'})));
  if (silentSamples.length > 0) results.silent = statistics(silentSamples);

  process.stdout.write(`${JSON.stringify({
    summary: results,
    host: {node: process.version, kernel: release(), cpu: cpus()[0]?.model, cpus: cpus().length, memoryGiB: round(totalmem() / 1024 ** 3)},
  })}\n`);
} finally {
  silent.closeAllConnections();
  silent.close();
  if (runtime !== undefined && runtime.exitCode === null) {
    runtime.kill('SIGTERM');
    await once(runtime, 'exit');
  }
  await rm(dir, {recursive: true, force: true});
}
