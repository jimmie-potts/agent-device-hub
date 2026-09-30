// Explicit trusted host execution for the existing verification adapters.
// This routes a workflow; it does not confine Linux-user host authority.
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {access, readFile, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, delimiter} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {inspectTemporary} from './verify-host-command.mjs';

const APPS = {hub: 'agent-device-hub', compose: 'agent-device-hub', nanoleaf: 'codex-nanoleaf', pixoo: 'divoom-app-upgrade'};
const SINGLE = ['help', 'start', 'doctor', 'scenario', 'capture', 'handoff', 'extend', 'stop', 'restart'];
const COMPOSE = ['help', 'start', 'doctor', 'capture', 'inject', 'reset', 'handoff', 'extend', 'stop'];
const SYSTEMCTL = '/usr/bin/systemctl', SYSTEMD_RUN = '/usr/bin/systemd-run';
const USABLE = ['running', 'degraded', 'starting', 'initializing'];
const MAX_OUTPUT = 2 * 1024 * 1024;
export const HELP = 'npm run -s verify:host -- --host --app <hub|nanoleaf|pixoo|compose> --checkout <absolute> [--python <absolute>] [--fnm <absolute>] [--timeout-seconds <30..1800>] -- <operation> [arguments]';

export async function prepare(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0) throw new Error('use --host and separate adapter arguments with --');
  const options = {};
  for (let i = 0; i < separator; i++) {
    const key = argv[i];
    if (Object.hasOwn(options, key)) throw new Error('duplicate launcher option');
    if (key === '--host') { options[key] = true; continue; }
    if (!['--app', '--checkout', '--python', '--fnm', '--timeout-seconds'].includes(key) || i + 1 >= separator) throw new Error('unknown or incomplete launcher option');
    options[key] = argv[++i];
  }
  if (!options['--host']) throw new Error('--host is required: this executes with Linux-user host authority');
  const app = options['--app'];
  if (!Object.hasOwn(APPS, app)) throw new Error('unsupported application');
  const args = argv.slice(separator + 1);
  if (!(app === 'compose' ? COMPOSE : SINGLE).includes(args[0])) throw new Error('unsupported operation');
  if (args.some(arg => /[\x00-\x1f\x7f]/.test(arg)) || args.join('').length > 32768) throw new Error('invalid adapter arguments');
  const seconds = options['--timeout-seconds'] ?? '900';
  if (!/^\d+$/.test(seconds) || Number(seconds) < 30 || Number(seconds) > 1800) throw new Error('command timeout must be 30..1800 seconds');
  if (!isAbsolute(options['--checkout'] ?? '')) throw new Error('checkout must be absolute');
  const checkout = await realpath(options['--checkout']);
  let identity;
  try { identity = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')).name; }
  catch { throw new Error('checkout package identity is unreadable'); }
  if (identity !== APPS[app]) throw new Error('checkout does not match the selected application');
  const entrypoint = join(checkout, app === 'compose' ? 'apps/hub/verify/compose.mjs' : 'scripts/verify.mjs');
  await access(entrypoint, constants.R_OK);
  if (process.platform !== 'linux' || !process.getuid) throw new Error('host routing requires Linux with a user manager');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 5) throw new Error('run the launcher with Node 24.5+ in the 24.x line');
  const node = await realpath(process.execPath);
  // Preserve a venv executable path: realpath would discard Python's venv identity.
  for (const key of ['--python', '--fnm']) if (options[key]) {
    if (!isAbsolute(options[key]) || /[\x00-\x1f\x7f]/.test(options[key])) throw new Error(`${key} must be an absolute executable path`);
    await access(options[key], constants.X_OK);
  }
  const home = homedir();
  const runtime = `/run/user/${process.getuid()}`;
  const bus = `unix:path=${runtime}/bus`;
  const path = [...new Set([dirname(node), ...(options['--fnm'] ? [dirname(options['--fnm'])] : []), '/usr/bin', '/bin'])].join(delimiter);
  const helper = fileURLToPath(new URL('./verify-host-command.mjs', import.meta.url));
  const git = promisify(execFile);
  const common = await git('/usr/bin/git', ['-C', dirname(helper), 'rev-parse', '--path-format=absolute', '--git-common-dir'], {env: clientGitEnv(home)});
  const ownerRoot = dirname(await realpath(common.stdout.trim()));
  await git('/usr/bin/git', ['-C', ownerRoot, 'check-ignore', '-q', '.local/probe'], {env: clientGitEnv(home)});
  const token = randomUUID();
  const temporary = join(ownerRoot, '.local/scratch', `vh-${token.slice(0, 8)}`);
  if (Buffer.byteLength(temporary) > 70) throw new Error('launcher checkout path is too long for browser temporary sockets; use a shorter canonical checkout');
  const hostEnv = {HOME: home, PATH: path, LANG: 'C.UTF-8', XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: bus,
    TMPDIR: temporary, npm_config_cache: join(home, '.npm'), PLAYWRIGHT_BROWSERS_PATH: join(home, '.cache/ms-playwright')};
  if (options['--python']) hostEnv.PYTHON = options['--python'];
  const clientEnv = {HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', DBUS_SESSION_BUS_ADDRESS: bus};
  return {app, checkout, operation: args[0], unit: `app-verify-command-${token}.service`, temporary, token, helper,
    node, adapterArgs: [entrypoint, ...args], hostEnv, clientEnv, timeoutMs: Number(seconds) * 1000};
}

function clientGitEnv(home) { return {HOME: home, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}; }
// ExecStopPost uses systemd's command grammar: ':' disables environment
// expansion and doubled '%' preserves literal specifiers. It is never a shell.
export function unitWord(value) { if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('invalid systemd word'); return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"'; }

// execFile never invokes a shell. Killing this directly owned client is not
// preview cleanup; the exact user unit is stopped and read back separately.
export function execute(program, args, options) {
  return new Promise(resolve => {
    execFile(program, args, {env: options.env, encoding: 'utf8', timeout: options.timeoutMs,
      maxBuffer: MAX_OUTPUT, killSignal: 'SIGKILL', signal: options.signal}, (error, stdout, stderr) => {
      resolve({code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        stdout: stdout ?? '', stderr: stderr ?? '', interrupted: Boolean(error && (error.killed || error.signal || typeof error.code !== 'number'))});
    });
  });
}
function properties(text) {
  return Object.fromEntries(text.trim().split('\n').filter(line => line.includes('=')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
}
function adapterResult(text) {
  const lines = text.trim().split('\n');
  if (lines.length !== 1) return null;
  try { const result = JSON.parse(lines[0]); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; }
  catch { return null; }
}

export async function runHost(plan, {execute: run = execute, inspectTemporary: inspect = inspectTemporary, signal, progress = () => {}} = {}) {
  const value = {hostCommandVersion: '1', app: plan.app, checkout: plan.checkout, operation: plan.operation,
    unit: plan.unit, temporary: plan.temporary, temporaryCleanup: 'not-started', state: 'unavailable', cleanup: 'not-started', adapterExit: null, result: null};
  const client = {env: plan.clientEnv, timeoutMs: 5000};
  let manager;
  try { manager = await run(SYSTEMCTL, ['--user', 'is-system-running'], {...client, signal}); }
  catch { manager = {code: null, stdout: ''}; }
  if (signal?.aborted || !USABLE.includes(manager.stdout.trim())) {
    return {code: 3, value: {...value, error: 'supervisor-unavailable', next: 'Check user-manager access in this session; no host command was launched.'}};
  }
  const launchArgs = ['--user', '--quiet', '--wait', '--pipe', '--collect', '--expand-environment=no', `--unit=${plan.unit}`,
    '--property=KillMode=control-group', '--property=TimeoutStopSec=5s', `--property=RuntimeMaxSec=${plan.timeoutMs / 1000}s`,
    `--property=ExecStopPost=:/usr/bin/env -i ${[plan.node, plan.helper, 'cleanup', plan.temporary, plan.token].map(unitWord).join(' ')}`,
    `--working-directory=${plan.checkout}`, '--', '/usr/bin/env', '-i',
    ...Object.entries(plan.hostEnv).map(([key, val]) => `${key}=${val}`), plan.node, plan.helper, 'run', plan.temporary, plan.token, ...plan.adapterArgs];
  progress(`Host command: ${plan.unit}\nTemporary storage: ${plan.temporary}\nTrusted Linux-user execution; preview units retain their own leases.\n`);
  let launched;
  try {
    launched = await run(SYSTEMD_RUN, launchArgs, {...client, timeoutMs: plan.timeoutMs + 10000, signal});
  } catch { launched = {code: null, stdout: '', interrupted: true}; }
  value.adapterExit = launched.code;
  value.result = adapterResult(launched.stdout);
  // Always settle this command's whole cgroup, including helpers left by an
  // interrupted adapter. Never infer ownership of an app unit from its port.
  const show = async () => {
    try { return await run(SYSTEMCTL, ['--user', 'show', plan.unit, '--property=LoadState,ActiveState,SubState,MainPID', '--no-pager'], client); }
    catch { return {code: null, stdout: ''}; }
  };
  let observed = await show();
  const gone = r => {
    if (r.code !== 0) return false;
    const p = properties(r.stdout);
    return p.LoadState === 'not-found' && p.ActiveState === 'inactive' && p.MainPID === '0';
  };
  if (!gone(observed)) {
    try { await run(SYSTEMCTL, ['--user', 'stop', plan.unit], {...client, timeoutMs: 10000}); } catch { /* Readback owns outcome. */ }
    observed = await show();
  }
  value.cleanup = gone(observed) ? 'verified' : 'unknown';
  try { value.temporaryCleanup = await inspect(plan.temporary); } catch { value.temporaryCleanup = 'unknown'; }
  if (value.temporaryCleanup !== 'removed' || launched.interrupted || signal?.aborted || value.result === null || value.cleanup !== 'verified') {
    return {code: 1, value: {...value, state: 'uncertain', error: 'host-command-unverified',
      next: 'Do not retry start. Read doctor and owned receipts from this checkout, identify any created previews, and stop only those runs if needed. Command cleanup is not preview cleanup. If temporary cleanup is unverified, inspect the reported scratch path and remove it only after matching its .owner token to this command unit.'}};
  }
  // Adapter failure and usage/unavailable codes retain their meaning.
  const code = [0, 1, 2, 3].includes(launched.code) ? launched.code : 1;
  return {code, value: {...value, state: code === 0 ? 'completed' : 'failed'}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--help')) {
      console.log(JSON.stringify({operation: 'help', command: HELP, authority: 'Explicit trusted Linux-user host execution; not a sandbox.'}));
    } else {
      let plan;
      try { plan = await prepare(process.argv.slice(2)); }
      catch { console.log(JSON.stringify({state: 'unavailable', error: 'invalid-host-request', command: HELP})); process.exitCode = 2; }
      if (plan) {
        const outcome = await runHost(plan, {signal: controller.signal, progress: line => process.stderr.write(line)});
        console.log(JSON.stringify(outcome.value)); process.exitCode = outcome.code;
      }
    }
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
}
