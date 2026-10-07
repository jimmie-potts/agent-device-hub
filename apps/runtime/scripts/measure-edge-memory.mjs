#!/usr/bin/env node
// Measures the edge's memory under a stalled reader for #123 (Hub #835). Each run starts the runtime with the shipped core,
// its gateway and a module that publishes large state messages, connects a reader that subscribes to them and then stops
// reading, as a suspended host would, and samples the runtime: before the messages, while the reader is stalled, and
// after the edge's stall limit has ended the stream.
//   node apps/runtime/scripts/measure-edge-memory.mjs [--messages 2000] [--kib 64] [--stall-s 30] [--runs 3]
// Run `npm run build` first, with TMPDIR outside every Git checkout. The reader's token is synthetic and stays in this
// process; the runtime holds only its digest. Each sample reads VmRSS and VmHWM from /proc/<pid>/status and the health
// endpoint's `memory`. Output is one JSON line per run, then a summary.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {cpus, release, tmpdir, totalmem} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {
  messages: {type: 'string', default: '2000'}, kib: {type: 'string', default: '64'}, 'stall-s': {type: 'string', default: '30'}, runs: {type: 'string', default: '3'},
}});
const messages = Number(values.messages), kib = Number(values.kib), stallS = Number(values['stall-s']), runs = Number(values.runs);
if (![messages, kib, stallS, runs].every(value => Number.isSafeInteger(value) && value > 0) || kib > 200) {
  process.stderr.write('usage: measure-edge-memory.mjs [--messages 2000] [--kib 64 (at most 200)] [--stall-s 30] [--runs 3]\n');
  process.exit(2);
}
const INDEX = new URL('../dist/src/index.js', import.meta.url).href;
// The runtime: the shipped core, the gateway with the given stall limit, and a module that publishes on demand, each
// message with its own random content. The harness asks it to publish by a line on stdin, so the reader is stalled
// before anything flows.
const CHILD = `const {randomBytes} = await import('node:crypto');
const {buildModules, shippedModules, startRuntime} = await import(${JSON.stringify(INDEX)});
const [stateDir, configFile, stallMs, count, bytes] = process.argv.slice(1);
let sdk;
const ended = {streams: 0, dropped: 0};
const blaster = {manifest: {name: 'blaster', apiVersion: '1.0'}, start: context => { sdk = context.sdk; }, stop: () => {}};
const runtime = await startRuntime({modules: [...buildModules(shippedModules, false), blaster], port: 0, stateDir, configFile,
  log: record => {
    if (record.event_name === 'runtime.edge.disconnected') ended.streams += 1;
    if (record.event_name === 'runtime.delivery.dropped') ended.dropped += Number(record.attributes['bunny.delivery.dropped_count'] ?? 0);
  },
  edge: {schemas: {}, liveness: {stallMs: Number(stallMs)}}});
process.on('SIGTERM', () => { void runtime.stop().then(() => process.exit(0)); });
const lines = (await import('node:readline')).createInterface({input: process.stdin});
lines.on('line', async line => {
  if (line === 'gc') {
    globalThis.gc();
    process.stdout.write(JSON.stringify(ended) + '\\n');
    return;
  }
  for (let revision = 1; revision <= Number(count); revision += 1) {
    await sdk.publish('bunny.state.blob.b1', {kind: 'state', type: 'org.bunny.blob.updated', subject: 'b1', dataschema: 'https://bunny.invalid/events/blob/2.0',
      data: {id: 'b1', revision, pad: randomBytes(Math.ceil(Number(bytes) * 3 / 4)).toString('base64').slice(0, Number(bytes))}});
    await new Promise(resolve => { setImmediate(resolve); });
  }
  process.stdout.write('published\\n');
});
process.stdout.write(JSON.stringify({event: 'runtime.ready', url: runtime.url}) + '\\n');`;
const MiB = 1024 * 1024;
const round = value => Math.round(value * 10) / 10;
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** Collects garbage in the runtime first, so a sample shows what is still held, and says how many streams ended. */
async function sample(child, lines, url, label) {
  child.stdin.write('gc\n');
  const [line] = await once(lines, 'line');
  const {streams, dropped} = JSON.parse(line);
  const pid = child.pid;
  const text = await readFile(`/proc/${pid}/status`, 'utf8');
  const field = name => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
  const {memory} = await (await fetch(new URL('/api/runtime/v1/health', url))).json();
  return {at: label, streamsEnded: streams, dropsLogged: dropped, vmRssMiB: round(field('VmRSS') / 1024), vmHwmMiB: round(field('VmHWM') / 1024),
    heapUsedMiB: round(memory.heapUsedBytes / MiB), externalMiB: round(memory.externalBytes / MiB)};
}

/** Opens the edge's stream, reads its ready event, subscribes to the blobs, and never reads again. */
async function stalledReader(url, token) {
  const {connection, response} = await new Promise((resolve, reject) => {
    const opened = request(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${token}`}}, stream => {
      let text = '';
      const onData = chunk => {
        text += chunk.toString('utf8');
        const ready = /event: ready\ndata: (.*)\n\n/.exec(text);
        if (ready === null) return;
        stream.off('data', onData);
        stream.pause();
        resolve({connection: JSON.parse(ready[1]).connection, response: stream});
      };
      stream.on('data', onData);
    });
    opened.once('error', reject);
    opened.end();
  });
  const subscribed = await fetch(new URL('/api/sdk/v1/subscribe', url), {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({schema: 'sdk-remote/1.0', connection, id: 'stalled', pattern: 'bunny.state.blob.*'})});
  if (subscribed.status !== 200) throw new Error(`the subscription answered ${subscribed.status}`);
  return response;
}

async function measure() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'bunny-edge-'));
  await chmod(dir, 0o700);
  const token = `tok_SYNTHETIC835_${randomBytes(24).toString('base64url')}`;
  const {tokenDigest, CONFIG_SCHEMA, CREDENTIALS_SCHEMA} = await import(INDEX);
  const credentials = join(dir, 'edge-credentials.json'), config = join(dir, 'runtime-config.json');
  await writeFile(credentials, JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: 'reader', source: 'bunny/parts/reader', digest: tokenDigest(token), scopes: ['read'], devices: []},
  ]}), {mode: 0o600});
  await writeFile(config, JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {credentials, launcher: false}}), {mode: 0o600});
  await mkdir(join(dir, 'state'), {mode: 0o700});
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', CHILD, join(dir, 'state'), config, String(stallS * 1000), String(messages), String(kib * 1024)],
    {stdio: ['pipe', 'pipe', 'ignore']});
  let reader;
  try {
    const lines = createInterface({input: child.stdout});
    const [line] = await once(lines, 'line');
    const {url} = JSON.parse(line);
    reader = await stalledReader(url, token);
    await sleep(2000);
    const samples = [await sample(child, lines, url, 'stalled reader, before the messages')];
    child.stdin.write('go\n');
    await once(lines, 'line');
    samples.push(await sample(child, lines, url, `stalled, after ${messages} messages of ${kib} KiB`));
    await sleep(stallS * 1000 + 5000);
    samples.push(await sample(child, lines, url, `${stallS} s stall limit passed`));
    child.kill('SIGTERM');
    const [code, signal] = await once(child, 'exit');
    return {messages, kib, stallS, exit: {code, signal}, samples};
  } finally {
    reader?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(dir, {recursive: true, force: true});
  }
}

const results = [];
for (let run = 0; run < runs; run += 1) {
  const result = await measure();
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
const at = (index, key) => [Math.min(...results.map(result => result.samples[index][key])), Math.max(...results.map(result => result.samples[index][key]))];
process.stdout.write(`${JSON.stringify({
  summary: {messages, kib, stallS, runs, before: {vmRssMiB: at(0, 'vmRssMiB')}, stalled: {vmRssMiB: at(1, 'vmRssMiB'), heapUsedMiB: at(1, 'heapUsedMiB')},
    ended: {vmRssMiB: at(2, 'vmRssMiB'), heapUsedMiB: at(2, 'heapUsedMiB'), vmHwmMiB: at(2, 'vmHwmMiB')}},
  host: {node: process.version, kernel: release(), cpu: cpus()[0]?.model, cpus: cpus().length, memoryGiB: round(totalmem() / 1024 ** 3)},
})}\n`);
