// Runs one `node --test` package script natively with a fixed number of test files at a time (Hub #1639). A bare
// `node --test` starts one worker per core less one, and Node refuses `--test-concurrency` in NODE_OPTIONS, so this
// runner passes the flag itself. Hosted CI keeps calling the package scripts unchanged.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {constants} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const USAGE = 'usage: node scripts/native-test.mjs <package script> [--workers N] [-- <node --test options>]';
export const DEFAULT_WORKERS = 2;

/** The script name, worker count and extra `node --test` options of a command line, or an Error with the usage. */
export function parse(args) {
  const [name, ...rest] = args;
  const separator = rest.indexOf('--');
  const own = separator === -1 ? rest : rest.slice(0, separator);
  const extra = separator === -1 ? [] : rest.slice(separator + 1);
  let workers = String(DEFAULT_WORKERS);
  if (own.length === 2 && own[0] === '--workers') workers = own[1];
  else if (own.length !== 0) throw new Error(USAGE);
  if (name === undefined || name.startsWith('-')) throw new Error(USAGE);
  if (!/^[1-9]\d{0,2}$/.test(workers)) throw new Error(`workers must be a positive whole number, not ${workers}`);
  return {name, workers: Number(workers), extra};
}

/** The package script with its worker bound. Only one plain `node --test` command with no bound of its own is accepted. */
export function boundedCommand(script, workers, extra = []) {
  if (typeof script !== 'string' || !script.startsWith('node --test ') || /[;&|`$<>()]/.test(script)) {
    throw new Error('the package script must be one plain `node --test` command; build first and name its :built script');
  }
  if (script.includes('--test-concurrency')) throw new Error('the package script already bounds its workers; run it with npm run');
  const quoted = extra.map(option => `'${option.replaceAll("'", "'\\''")}'`);
  return ['node --test', `--test-concurrency=${String(workers)}`, ...quoted, script.slice('node --test '.length)].join(' ');
}

/** The run's exit status: the child's code, or 128 plus the number of the signal that ended it, as a shell reports. */
export function exitStatus(code, signal) {
  if (code !== null) return code;
  const number = signal === null ? undefined : constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

async function main() {
  const {name, workers, extra} = parse(process.argv.slice(2));
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  if (!Object.hasOwn(scripts, name)) throw new Error(`no package script named ${name}`);
  const command = boundedCommand(scripts[name], workers, extra);
  // A private temporary directory of the run's own under /tmp, by its resolved path. macOS reaches both /tmp and its
  // per-user temporary directory through a link, which the runtime's private-file checks refuse as they should, and
  // the resolved per-user path is too long for the launcher's Unix socket once a test adds its state directory.
  const scratch = await mkdtemp(join(await realpath('/tmp'), 'bunny-native.'));
  process.stderr.write(`native-test: ${name} with at most ${String(workers)} test files at a time\n`);
  const child = spawn('/bin/sh', ['-c', command], {cwd: root, stdio: 'inherit', env: {...process.env, TMPDIR: scratch}});
  const forward = signal => child.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const [code, signal] = await new Promise(done => { child.once('exit', (...result) => done(result)); });
  process.exitCode = exitStatus(code, signal);
  // A directory left behind is reported, never allowed to replace the suite's own status.
  await rm(scratch, {recursive: true, force: true, maxRetries: 3}).catch(error => {
    process.stderr.write(`native-test: could not remove ${scratch}: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`native-test: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
