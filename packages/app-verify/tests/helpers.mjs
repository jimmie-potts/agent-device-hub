// Test sandbox for the core: a disposable Git checkout with the fixture plug-in,
// a runtime root outside it, and a CLI runner that executes the real wrapper in
// a child process so tests can interrupt it. Every unit a test creates carries
// the sandbox's unique app name, and `close()` stops exactly those units.
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const plugin = join(packageRoot, 'tests/fixture-app/plugin.mjs');
/** The core as this test resolves it: the workspace build, or the installed archive in the package check. */
const core = import.meta.resolve('@jimmie-potts/app-verify');

/** Whether this host has a user systemd manager. Returns a skip reason, or undefined when available. */
export function supervisorSkipReason() {
  const result = spawnSync('systemctl', ['--user', 'is-system-running'], {encoding: 'utf8'});
  const state = (result.stdout ?? '').trim();
  if (['running', 'degraded', 'starting', 'initializing'].includes(state)) return undefined;
  const reason = `no systemd --user manager (is-system-running: ${state || result.error?.message || (result.stderr ?? '').trim() || 'no answer'})`;
  if (process.env.APP_VERIFY_REQUIRE_SYSTEMD === '1') throw new Error(`APP_VERIFY_REQUIRE_SYSTEMD=1 but ${reason}`);
  process.stderr.write(`SKIP lifecycle tests: ${reason}. They run on a Linux host with a user manager; see packages/app-verify/README.md.\n`);
  return reason;
}

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}}).trim();

/** `options` are extra `createPlugin` options for the default wrapper, such as declared `inputs`. */
export async function sandbox({playwright, options: extra = {}} = {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'app-verify-test-')));
  const app = `avt-${randomBytes(3).toString('hex')}`;
  const repo = join(base, 'repo'), stateRoot = join(base, 'state'), markerDir = join(base, 'markers');
  await mkdir(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'user.name', 'Fixture');
  await writeFile(join(repo, 'tracked.txt'), 'one\n');
  await writeFile(join(repo, '.gitignore'), '.local/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'fixture');
  const wrapper = async (root, name = 'verify.mjs', more = extra) => {
    const options = {root, app, markerDir, pidFile: join(base, 'helper.pid'), ...(playwright ? {playwright} : {}), ...more};
    await writeFile(join(root, name), `import {runCli} from ${JSON.stringify(core)};\nimport {createPlugin} from ${JSON.stringify(plugin)};\nprocess.exitCode = await runCli(createPlugin(${JSON.stringify(options)}), process.argv.slice(2));\n`);
    return join(root, name);
  };
  // The wrapper is untracked, so it does not make the checkout dirty.
  await writeFile(join(repo, '.git/info/exclude'), 'verify*.mjs\n', {flag: 'a'});
  const script = await wrapper(repo);
  // Operations get a TMPDIR inside the sandbox, so a deliberately killed capture's browser profile goes with it.
  await mkdir(join(base, 'tmp'));
  const env = {...process.env, TMPDIR: join(base, 'tmp'), APP_VERIFY_STATE_ROOT: stateRoot, APP_VERIFY_WINDOWS_CHECK: 'off'};
  delete env.APP_VERIFY_PROOF_ROOT;
  const proofRoot = join(repo, '.local/evidence/verify');

  /** Run one operation. `onSpawn` receives the child for interruption tests. */
  function cli(args, {extraEnv = {}, onSpawn, cwd = repo, entry = script} = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {cwd, env: {...env, ...extraEnv}, stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => (stdout += chunk));
      child.stderr.on('data', chunk => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code, signal) => {
        const lines = stdout.trim().split('\n').filter(Boolean);
        let result;
        try {
          result = lines.length ? JSON.parse(lines.at(-1)) : undefined;
        } catch {
          result = undefined;
        }
        resolve({code, signal, stdout, stderr, lines, result});
      });
      onSpawn?.(child);
    });
  }

  const receipt = async runId => JSON.parse(await readFile(join(proofRoot, runId, 'receipt.json'), 'utf8'));
  const events = async runId => (await readFile(join(proofRoot, runId, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

  async function close() {
    for (const name of units(app)) spawnSync('systemctl', ['--user', 'stop', name], {encoding: 'utf8'});
    const leftover = units(app);
    // Frozen proof is read-only by design; restore write permission only to delete the sandbox.
    await makeWritable(base);
    await rm(base, {recursive: true, force: true});
    if (leftover.length) throw new Error(`units left after stop: ${leftover.join(', ')}`);
  }

  return {base, app, repo, stateRoot, proofRoot, markerDir, env, git: (...args) => git(repo, ...args), wrapper, cli, receipt, events, close};
}

/** Loaded units for an app, by the contract's naming. */
export function units(app) {
  const listed = spawnSync('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', '--no-pager', `app-verify-${app}-*`], {encoding: 'utf8'}).stdout ?? '';
  return listed.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(name => name && name.startsWith(`app-verify-${app}-`));
}

/** `systemctl --user show` properties as an object. */
export function show(unit, ...properties) {
  const output = spawnSync('systemctl', ['--user', 'show', unit, '--timestamp=unix', ...properties.flatMap(p => ['-p', p])], {encoding: 'utf8'}).stdout ?? '';
  return Object.fromEntries(output.trim().split('\n').filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

export async function makeWritable(path) {
  if (!existsSync(path)) return;
  const info = await stat(path);
  if (info.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) await makeWritable(join(path, entry));
  } else if (info.isFile()) await chmod(path, 0o600);
}

/** Poll until `check` returns a truthy value or the deadline passes. */
export async function until(check, message, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** Whether a TCP connection to the port is refused. */
export async function refused(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(2000)});
    return false;
  } catch {
    return true;
  }
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
