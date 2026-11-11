// Runs the runtime scenario suite with its catalog split into shards that run at once (Hub #1674). Each shard is one
// `node --test` process of catalog.test.js with `BUNNY_SCENARIO_SHARD=i/n`; one more process runs the suite's other
// test files once. Every output line carries its process's label, and the run exits non-zero when any process does.
// Run it after `npm run build`. Hosted CI keeps calling `npm run test:runtime:scenarios:built` unchanged.
import {spawn} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exitStatus} from './native-test.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const SUITE = 'apps/runtime/dist/tests/scenarios';
const CATALOG = 'catalog.test.js';
const USAGE = 'usage: node scripts/scenario-shards.mjs [--shards N] [-- <node --test options>]';
export const DEFAULT_SHARDS = 4;

/** The shard count and extra `node --test` options of a command line, or an Error with the usage. */
export function parse(args) {
  const separator = args.indexOf('--');
  const own = separator === -1 ? args : args.slice(0, separator);
  const extra = separator === -1 ? [] : args.slice(separator + 1);
  let shards = String(DEFAULT_SHARDS);
  if (own.length === 2 && own[0] === '--shards') shards = own[1];
  else if (own.length !== 0) throw new Error(USAGE);
  if (!/^[1-9]\d?$/.test(shards)) throw new Error(`shards must be a whole number from 1 to 99, not ${shards}`);
  return {shards: Number(shards), extra};
}

/** The processes of a run: one per catalog shard, then one for the suite's other files, each run once. */
export function jobs(shards, files, extra = []) {
  if (!files.includes(CATALOG)) throw new Error(`${SUITE}/${CATALOG} is missing: run npm run build first`);
  const others = files.filter(file => file !== CATALOG);
  const test = names => ['--test', '--test-concurrency=1', ...extra, ...names.map(name => `${SUITE}/${name}`)];
  return [
    ...Array.from({length: shards}, (_, index) => ({
      label: `shard ${String(index + 1)}/${String(shards)}`, args: test([CATALOG]), env: {BUNNY_SCENARIO_SHARD: `${String(index + 1)}/${String(shards)}`},
    })),
    ...(others.length === 0 ? [] : [{label: 'other files', args: test(others), env: {}}]),
  ];
}

/** The run's exit status: 0 when every process exited 0, otherwise the first failing process's status. */
export function combinedStatus(statuses) {
  return statuses.find(status => status !== 0) ?? 0;
}

/** The test totals a `node --test` reporter printed (spec or tap), by name. */
export function totals(text) {
  const found = {};
  for (const match of text.matchAll(/^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)) found[match[1]] = Number(match[2]);
  return found;
}

/** Writes each complete line of a stream with a prefix, and keeps the stream's text in `kept` when one is given. */
function relay(stream, prefix, out, kept) {
  if (stream === null || stream === undefined) return;
  let partial = '';
  stream.setEncoding('utf8');
  stream.on('data', text => {
    kept?.push(text);
    const lines = (partial + text).split('\n');
    partial = lines.pop();
    for (const line of lines) out.write(`${prefix}${line}\n`);
  });
  stream.on('end', () => { if (partial !== '') out.write(`${prefix}${partial}\n`); });
}

/** The message of an error, or the value as text. */
const message = error => (error instanceof Error ? error.message : String(error));

/**
 * Runs the jobs at once from `cwd`, each line of their output prefixed with its label, and resolves to each job's
 * label, exit status, wall seconds and totals, read from its standard output alone. SIGINT and SIGTERM that `signals`
 * emits are passed on to every job. A job that cannot start ends with status 1 and a labelled message.
 */
export async function run(planned, {cwd = root, env = process.env, out = process.stdout, signals = process, start = spawn} = {}) {
  const children = [];
  const forward = signal => { for (const child of children) child.kill(signal); };
  signals.on('SIGINT', forward);
  signals.on('SIGTERM', forward);
  try {
    return await Promise.all(planned.map(async job => {
      const started = Date.now();
      const prefix = `[${job.label}] `;
      const stdout = [];
      const ended = await new Promise(done => {
        let child;
        try {
          child = start(process.execPath, job.args, {cwd, env: {...env, ...job.env}, stdio: ['ignore', 'pipe', 'pipe']});
        } catch (error) {
          done({error});
          return;
        }
        children.push(child);
        relay(child.stdout, prefix, out, stdout);
        relay(child.stderr, prefix, out);
        child.once('error', error => done({error}));
        child.once('close', (code, signal) => done({code, signal}));
      });
      if (ended.error !== undefined) out.write(`${prefix}could not start: ${message(ended.error)}\n`);
      const status = ended.error === undefined ? exitStatus(ended.code, ended.signal) : 1;
      return {label: job.label, status, seconds: (Date.now() - started) / 1000, totals: totals(stdout.join(''))};
    }));
  } finally {
    signals.off('SIGINT', forward);
    signals.off('SIGTERM', forward);
  }
}

/**
 * Runs the jobs as `run` does, with `TMPDIR` set to a new private directory under `tmp` by its resolved path, as
 * scripts/native-test.mjs makes, and removes that directory afterwards whatever the jobs' outcome.
 */
export async function runIsolated(planned, {tmp = '/tmp', env = process.env, warn = text => process.stderr.write(text), ...options} = {}) {
  const scratch = await mkdtemp(join(await realpath(tmp), 'bunny-shards.'));
  try {
    return await run(planned, {...options, env: {...env, TMPDIR: scratch}});
  } finally {
    // A directory left behind is reported, never allowed to replace the suite's own status.
    await rm(scratch, {recursive: true, force: true, maxRetries: 3}).catch(error => {
      warn(`scenario-shards: could not remove ${scratch}: ${message(error)}\n`);
    });
  }
}

/** The closing summary: one line per job, then the catalog shards' totals together. */
export function summary(results) {
  const line = ({tests = 0, pass = 0, fail = 0, skipped = 0}) => `tests ${String(tests)}, pass ${String(pass)}, fail ${String(fail)}, skipped ${String(skipped)}`;
  const shards = results.filter(result => result.label.startsWith('shard '));
  const sum = {};
  for (const {totals: counts} of shards) for (const [name, value] of Object.entries(counts)) sum[name] = (sum[name] ?? 0) + value;
  return [
    ...results.map(result => `scenario-shards: ${result.label}: exit ${String(result.status)} after ${result.seconds.toFixed(1)} s, ${line(result.totals)}`),
    `scenario-shards: catalog shards together: ${line(sum)}`,
  ].join('\n');
}

async function main() {
  const {shards, extra} = parse(process.argv.slice(2));
  const files = readdirSync(join(root, SUITE)).filter(file => file.endsWith('.test.js')).sort();
  const planned = jobs(shards, files, extra);
  process.stderr.write(`scenario-shards: the catalog in ${String(shards)} shards at once, and ${String(planned.length - shards)} process for the other files\n`);
  const started = Date.now();
  const results = await runIsolated(planned);
  process.stderr.write(`${summary(results)}\nscenario-shards: all done after ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.exitCode = combinedStatus(results.map(result => result.status));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`scenario-shards: ${message(error)}\n`);
    process.exitCode = 2;
  });
}
