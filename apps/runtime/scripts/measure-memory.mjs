#!/usr/bin/env node
// Measures the shipped runtime's memory for #123. Each run starts a runtime on port 0 with a temporary state directory,
// samples it at fixed times after its ready line and stops it with SIGTERM.
//   node apps/runtime/scripts/measure-memory.mjs [--variant shipped|no-lag-check|simulated] [--at 5,15,30,60] [--runs 3]
// `shipped` runs the entry point, `apps/runtime/dist/src/main.js`, without a configuration file, so the core runs and each
// device module that takes a configuration is refused; `no-lag-check` runs that runtime without its watchdog thread, to
// show that thread's cost; `simulated` runs the entry point with `--simulate` and a private configuration file that gives
// each such module its factory's simulated section, so every shipped module runs on its simulated devices, idle. Run
// `npm run build` first, with TMPDIR outside every Git checkout. Each sample
// reads VmRSS (resident now), VmHWM (the resident peak so far) and Threads from /proc/<pid>/status, and the health
// endpoint's `memory`, which is `process.memoryUsage()` inside the runtime. Output is one JSON line per run, then a summary.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {cpus, release, tmpdir, totalmem} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {
  variant: {type: 'string', default: 'shipped'}, at: {type: 'string', default: '5,15,30,60'}, runs: {type: 'string', default: '3'},
}});
const times = values.at.split(',').map(Number);
const runs = Number(values.runs);
if (!['shipped', 'no-lag-check', 'simulated'].includes(values.variant) || times.some(at => !(at > 0)) || !(runs >= 1)) {
  process.stderr.write('usage: measure-memory.mjs [--variant shipped|no-lag-check|simulated] [--at 5,15,30,60] [--runs 3]\n');
  process.exit(2);
}
const MAIN = fileURLToPath(new URL('../dist/src/main.js', import.meta.url));
const INDEX = new URL('../dist/src/index.js', import.meta.url).href;
/** The runtime tests' one helper for simulated sections, which the build compiles with the tests. */
const SIMULATED = new URL('../dist/tests/fixtures/simulated.js', import.meta.url).href;
const BARE = `const {buildModules, shippedModules, startRuntime} = await import(${JSON.stringify(INDEX)});
const runtime = await startRuntime({modules: buildModules(shippedModules, false), port: 0, stateDir: process.argv[1], log: () => {}});
process.on('SIGTERM', () => { void runtime.stop().then(() => process.exit(0)); });
process.stdout.write(JSON.stringify({event: 'runtime.ready', url: runtime.url}) + '\\n');`;
const HEALTH = '/api/runtime/v1/health';
const MiB = 1024 * 1024;
const round = value => Math.round(value * 10) / 10;

async function status(pid) {
  const text = await readFile(`/proc/${pid}/status`, 'utf8');
  const field = name => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
  return {vmRssMiB: round(field('VmRSS') / 1024), vmHwmMiB: round(field('VmHWM') / 1024), threads: field('Threads')};
}

/**
 * A private configuration file that gives each shipped module that takes a configuration its factory's simulated
 * section, with its secret files holding only the synthetic token.
 */
async function configuration(dir) {
  const [{shippedModules}, {writeSimulatedConfiguration}] = await Promise.all([import(INDEX), import(SIMULATED)]);
  return writeSimulatedConfiguration(dir, shippedModules);
}

async function measure() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'bunny-measure-'));
  const state = join(dir, 'state');
  const simulated = values.variant === 'simulated' ? ['--simulate', '--config', await configuration(join(dir, 'config'))] : [];
  const args = values.variant === 'no-lag-check' ? ['--input-type=module', '-e', BARE, state] : [MAIN, '--port', '0', '--state-dir', state, ...simulated];
  const child = spawn(process.execPath, args, {stdio: ['ignore', 'pipe', 'ignore']});
  try {
    const [line] = await once(createInterface({input: child.stdout}), 'line');
    const {url} = JSON.parse(line);
    const began = performance.now();
    const samples = [];
    for (const at of times) {
      await new Promise(resolve => { setTimeout(resolve, Math.max(0, at * 1000 - (performance.now() - began))); });
      const {memory} = await (await fetch(new URL(HEALTH, url))).json();
      samples.push({atS: at, ...await status(child.pid), rssMiB: round(memory.rssBytes / MiB), heapUsedMiB: round(memory.heapUsedBytes / MiB),
        heapTotalMiB: round(memory.heapTotalBytes / MiB), externalMiB: round(memory.externalBytes / MiB)});
    }
    child.kill('SIGTERM');
    const [code, signal] = await once(child, 'exit');
    return {variant: values.variant, exit: {code, signal}, samples};
  } finally {
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
const last = results.map(result => result.samples.at(-1));
const span = key => [Math.min(...last.map(sample => sample[key])), Math.max(...last.map(sample => sample[key]))];
process.stdout.write(`${JSON.stringify({
  summary: {variant: values.variant, runs, atS: times.at(-1), vmRssMiB: span('vmRssMiB'), vmHwmMiB: span('vmHwmMiB'),
    heapUsedMiB: span('heapUsedMiB'), heapTotalMiB: span('heapTotalMiB'), threads: span('threads')},
  host: {node: process.version, kernel: release(), cpu: cpus()[0]?.model, cpus: cpus().length, memoryGiB: round(totalmem() / 1024 ** 3)},
})}\n`);
