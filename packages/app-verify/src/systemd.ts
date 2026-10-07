// The only place the core talks to systemd. Everything is addressed by unit name;
// nothing is found or killed by port, process name or remembered PID.
import {readFile} from 'node:fs/promises';
import {ANY_RUN_ID, exec, pause, which} from './util.js';

/** Manager states that accept transient units; the same list the docs give. */
export const USABLE_MANAGER_STATES = ['running', 'degraded', 'starting', 'initializing'];

export const unitName = (runId: string) => `app-verify-${runId}.service`;
export const leaseBase = (runId: string, generation = 1) => `app-verify-${runId}-lease${generation > 1 ? `-${generation}` : ''}`;
export const leaseGeneration = (timer: string) => Number(/-lease-(\d+)\.timer$/.exec(timer)?.[1] ?? 1);

/**
 * The systemctl the lease runs when it fires, resolved from a fixed system
 * PATH, never the caller's: a shim or a removed tool on the caller's PATH
 * must not silently disarm a lease.
 */
export function leaseSystemctl(): string | undefined {
  return which('systemctl', '/usr/bin:/bin', '/');
}

/** `running`/`degraded` managers can run units; anything else is unavailable. */
export async function supervisor(): Promise<{available: true} | {available: false; reason: string}> {
  const result = await exec('systemctl', ['--user', 'is-system-running'], {timeoutMs: 10000});
  const state = result.stdout.trim();
  if (USABLE_MANAGER_STATES.includes(state)) return {available: true};
  return {available: false, reason: `systemctl --user is-system-running answered ${state || result.error || result.stderr.trim().split('\n')[0] || `exit ${result.code}`}`};
}

export type Properties = Record<string, string>;

/** `systemctl --user show` for one unit. `undefined` when systemctl itself failed. */
export async function show(unit: string, properties: readonly string[]): Promise<Properties | undefined> {
  const result = await exec('systemctl', ['--user', 'show', unit, '--timestamp=unix', ...properties.flatMap(p => ['-p', p])], {timeoutMs: 10000});
  if (result.code !== 0) return undefined;
  const values: Properties = {};
  for (const line of result.stdout.split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  return values;
}

export interface UnitState {
  loaded: boolean;
  active: string;
  mainPid: number | null;
  mainStartMonotonic: number | null;
}

export async function unitState(unit: string): Promise<UnitState | undefined> {
  const values = await show(unit, ['LoadState', 'ActiveState', 'MainPID', 'ExecMainStartTimestampMonotonic']);
  if (!values) return undefined;
  const pid = Number(values.MainPID), start = Number(values.ExecMainStartTimestampMonotonic);
  return {
    loaded: values.LoadState === 'loaded',
    active: values.ActiveState ?? 'unknown',
    mainPid: pid > 0 ? pid : null,
    mainStartMonotonic: start > 0 ? start : null,
  };
}

export interface TimerState {
  loaded: boolean;
  active: string;
  /** Unix seconds of the next elapse, or null. */
  nextElapse: number | null;
}

export async function timerState(timer: string): Promise<TimerState | undefined> {
  const values = await show(timer, ['LoadState', 'ActiveState', 'NextElapseUSecRealtime']);
  if (!values) return undefined;
  const next = /^@(\d+)$/.exec(values.NextElapseUSecRealtime ?? '');
  return {loaded: values.LoadState === 'loaded', active: values.ActiveState ?? 'unknown', nextElapse: next ? Number(next[1]) : null};
}

/** Loaded units whose names start with `prefix`. */
export async function listUnits(prefix: string): Promise<string[] | undefined> {
  const result = await exec('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', '--no-pager', `${prefix}*`], {timeoutMs: 10000});
  if (result.code !== 0) return undefined;
  return result.stdout.split('\n').map(line => line.trim().split(/\s+/)[0] ?? '').filter(name => name.startsWith(prefix));
}

/** A run's own service, `app-verify-<run id>.service`. A lease timer or its service, a thaw timer and the host route's command unit never match. */
const RUN_SERVICE = /^app-verify-(.+)\.service$/;

/**
 * The run ids whose service unit is live on this host, whichever app started them: a process is running, or is
 * starting (Hub #944). A unit that failed, exited or was collected is not live, and neither is one that is stopping.
 * `undefined` when systemctl cannot list units.
 */
export async function liveRuns(): Promise<string[] | undefined> {
  const result = await exec('systemctl', ['--user', 'list-units', '--all', '--plain', '--no-legend', '--no-pager', 'app-verify-*.service'], {timeoutMs: 10000});
  if (result.code !== 0) return undefined;
  const runs: string[] = [];
  for (const line of result.stdout.split('\n')) {
    // UNIT LOAD ACTIVE SUB DESCRIPTION
    const [unit = '', load, active, sub] = line.trim().split(/\s+/);
    const runId = RUN_SERVICE.exec(unit)?.[1];
    if (runId === undefined || !ANY_RUN_ID.test(runId) || load !== 'loaded') continue;
    if ((active === 'active' && sub === 'running') || active === 'activating') runs.push(runId);
  }
  return runs.sort();
}

/** The host-wide claim a guarded start holds while it creates a run (Hub #944). */
export const START_CLAIM = 'app-verify-start-claim.service';

/**
 * Take the claim: a transient unit that lives while process `pid` does. systemd-run refuses a unit name that already
 * exists, so only one start holds it. A start killed without releasing it leaves the unit for about a second, when its
 * loop sees `pid` gone; `RuntimeMaxSec` ends it in any case, so a stale claim never blocks for long.
 * `claimed` names the unit's invocation, which a release compares so it never stops a claim that another start took
 * after this one's expired; `held` when another start has it; `failed` with a reason when the unit could not be created
 * for another reason.
 */
export async function claimStart(pid: number): Promise<{claimed: string} | 'held' | {failed: string}> {
  const shell = which('sh', '/usr/bin:/bin', '/');
  if (!shell) return {failed: 'sh was not found in /usr/bin or /bin'};
  const result = await exec('systemd-run', [
    '--user', `--unit=${START_CLAIM.replace(/\.service$/, '')}`, '--collect', '--quiet',
    '--property=RuntimeMaxSec=1800s', '--property=TimeoutStopSec=5s', '--property=Description=app-verify start claim',
    '--', shell, '-c', 'while kill -0 "$1" 2>/dev/null; do sleep 1; done', 'sh', String(pid),
  ], {timeoutMs: 30000});
  if (result.code === 0) return {claimed: (await show(START_CLAIM, ['InvocationID']))?.InvocationID ?? ''};
  const claim = await show(START_CLAIM, ['LoadState', 'ActiveState']);
  if (claim?.LoadState === 'loaded' && (claim.ActiveState === 'active' || claim.ActiveState === 'activating')) return 'held';
  return {failed: (result.stderr.trim() || result.error || `systemd-run exit ${result.code}`).split('\n')[0]};
}

/** Stop the claim, unless it is no longer the one `invocation` took: its holder outlived `RuntimeMaxSec` and another start has it now. */
export async function releaseClaim(invocation: string): Promise<void> {
  const now = await show(START_CLAIM, ['InvocationID']);
  if (invocation !== '' && now?.InvocationID && now.InvocationID !== invocation) return;
  await stopUnit(START_CLAIM);
}

export interface ServiceSpec {
  unit: string;
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  stdout: string;
  stderr: string;
  description: string;
}

/** Start the application as a transient service owned by the user manager. */
export async function startService(spec: ServiceSpec): Promise<{ok: true} | {ok: false; reason: string}> {
  const args = [
    '--user', `--unit=${spec.unit}`, '--collect', '--quiet',
    '--property=KillMode=control-group', '--property=TimeoutStopSec=10s',
    `--property=Description=${spec.description}`,
    `--property=StandardOutput=append:${spec.stdout}`, `--property=StandardError=append:${spec.stderr}`,
    `--working-directory=${spec.cwd}`,
    ...Object.entries(spec.env).map(([key, value]) => `--setenv=${key}=${value}`),
    '--', ...spec.argv,
  ];
  const result = await exec('systemd-run', args, {timeoutMs: 30000});
  return result.code === 0 ? {ok: true} : {ok: false, reason: (result.stderr.trim() || result.error || `systemd-run exit ${result.code}`).split('\n')[0]};
}

/**
 * Start a lease timer that stops `unit` at `expiresAt` (Unix seconds, wall
 * clock), and read it back. A realtime timer elapses at the receipt's
 * `expiresAt`, including after the host sleeps.
 */
export async function startLease(base: string, unit: string, expiresAt: number, description: string): Promise<{ok: true} | {ok: false; reason: string}> {
  const systemctl = leaseSystemctl();
  if (!systemctl) return {ok: false, reason: 'systemctl was not found in /usr/bin or /bin'};
  const result = await exec('systemd-run', [
    '--user', `--unit=${base}`, '--collect', '--quiet',
    `--on-calendar=@${expiresAt}`, '--timer-property=AccuracySec=1s',
    `--description=${description}`,
    '--', systemctl, '--user', 'stop', unit,
  ], {timeoutMs: 30000});
  if (result.code !== 0) return {ok: false, reason: (result.stderr.trim() || result.error || `systemd-run exit ${result.code}`).split('\n')[0]};
  const state = await timerState(`${base}.timer`);
  if (!state?.loaded || state.active !== 'active' || state.nextElapse !== expiresAt) {
    // Never leave a timer the receipt does not name: it could stop the unit at an unrecorded time.
    await stopUnit(`${base}.timer`);
    return {ok: false, reason: !state?.loaded || state.active !== 'active' ? 'lease timer did not become active' : `lease timer elapses at ${state.nextElapse}, expected ${expiresAt}`};
  }
  return {ok: true};
}

/**
 * Stop a unit by name and wait until systemd has unloaded it. Returns
 * `removed` when it was loaded, `absent` when it was not, `left` when it is
 * still loaded after the timeout and `unknown` when systemctl cannot answer.
 */
export async function stopUnit(unit: string, timeoutMs = 20000): Promise<'removed' | 'absent' | 'left' | 'unknown'> {
  const before = await show(unit, ['LoadState', 'ActiveState']);
  if (!before) return 'unknown';
  if (before.LoadState !== 'loaded') return 'absent';
  await exec('systemctl', ['--user', 'stop', unit], {timeoutMs});
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const after = await show(unit, ['LoadState', 'ActiveState']);
    if (!after) return 'unknown';
    if (after.LoadState !== 'loaded') return 'removed';
    // A transient unit that stopped but is not yet collected counts as gone once inactive or failed.
    if (after.ActiveState === 'inactive' || after.ActiveState === 'failed') {
      await exec('systemctl', ['--user', 'reset-failed', unit], {timeoutMs: 5000});
      const collected = await show(unit, ['LoadState']);
      if (collected && collected.LoadState !== 'loaded') return 'removed';
    }
    if (Date.now() > deadline) return 'left';
    await pause(100);
  }
}

/**
 * Loopback TCP ports the unit's processes listen on, read from `ss` and the
 * unit's cgroup; `undefined` when either cannot be read.
 */
export async function listeningPorts(unit: string): Promise<number[] | undefined> {
  const group = (await show(unit, ['ControlGroup']))?.ControlGroup;
  if (!group) return undefined;
  const procs = await readFile(`/sys/fs/cgroup${group}/cgroup.procs`, 'utf8').catch(() => undefined);
  if (procs === undefined) return undefined;
  const pids = new Set(procs.split('\n').filter(Boolean));
  const listed = await exec('ss', ['-ltnpH'], {timeoutMs: 10000});
  if (listed.code !== 0) return undefined;
  const ports = new Set<number>();
  let attributed = false;
  for (const line of listed.stdout.split('\n')) {
    const local = /\s(127\.0\.0\.1|\[::ffff:127\.0\.0\.1\]):(\d+)\s/.exec(line);
    const owners = [...line.matchAll(/pid=(\d+)/g)].map(m => m[1]);
    if (owners.length) attributed = true;
    if (local && owners.some(pid => pids.has(pid))) ports.add(Number(local[2]));
  }
  // Without any owner attribution (a sandbox that hides other processes' sockets), the read proves nothing.
  if (!attributed) return undefined;
  return [...ports].sort((a, b) => a - b);
}
