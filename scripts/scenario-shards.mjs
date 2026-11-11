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

/** Writes each complete line of a stream with a prefix, and keeps the stream's text for its totals. */
function relay(stream, prefix, out, kept) {
  let partial = '';
  stream.setEncoding('utf8');
  stream.on('data', text => {
    kept.push(text);
    const lines = (partial + text).split('\n');
    partial = lines.pop();
    for (const line of lines) out.write(`${prefix}${line}\n`);
  });
  stream.on('end', () => { if (partial !== '') out.write(`${prefix}${partial}\n`); });
}

/**
 * Runs the jobs at once from `cwd`, each line of their output prefixed with its label, and resolves to each job's
 * label, exit status, wall seconds and totals. SIGINT and SIGTERM are passed on to every job.
 */
export async function run(planned, {cwd = root, env = process.env, out = process.stdout} = {}) {
  const children = [];
  const forward = signal => { for (const child of children) child.kill(signal); };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  try {
    return await Promise.all(planned.map(async job => {
      const started = Date.now();
      const child = spawn(process.execPath, job.args, {cwd, env: {...env, ...job.env}, stdio: ['ignore', 'pipe', 'pipe']});
      children.push(child);
      const kept = [];
      relay(child.stdout, `[${job.label}] `, out, kept);
      relay(child.stderr, `[${job.label}] `, out, kept);
      const [code, signal] = await new Promise(done => { child.once('close', (...result) => done(result)); });
      return {label: job.label, status: exitStatus(code, signal), seconds: (Date.now() - started) / 1000, totals: totals(kept.join(''))};
    }));
  } finally {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
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
  // A private temporary directory of the run's own under /tmp, by its resolved path, as scripts/native-test.mjs makes.
  const scratch = await mkdtemp(join(await realpath('/tmp'), 'bunny-shards.'));
  process.stderr.write(`scenario-shards: the catalog in ${String(shards)} shards at once, and ${String(planned.length - shards)} process for the other files\n`);
  const started = Date.now();
  const results = await run(planned, {env: {...process.env, TMPDIR: scratch}});
  process.stderr.write(`${summary(results)}\nscenario-shards: all done after ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  process.exitCode = combinedStatus(results.map(result => result.status));
  // A directory left behind is reported, never allowed to replace the suite's own status.
  await rm(scratch, {recursive: true, force: true, maxRetries: 3}).catch(error => {
    process.stderr.write(`scenario-shards: could not remove ${scratch}: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`scenario-shards: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
