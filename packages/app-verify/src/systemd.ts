// The only place the core talks to systemd. Everything is addressed by unit name;
// nothing is found or killed by port, process name or remembered PID.
import {exec, pause} from './util.js';

export const unitName = (runId: string) => `app-verify-${runId}.service`;
export const leaseBase = (runId: string, generation = 1) => `app-verify-${runId}-lease${generation > 1 ? `-${generation}` : ''}`;
export const leaseGeneration = (timer: string) => Number(/-lease-(\d+)\.timer$/.exec(timer)?.[1] ?? 1);

/** `running`/`degraded` managers can run units; anything else is unavailable. */
export async function supervisor(): Promise<{available: true} | {available: false; reason: string}> {
  const result = await exec('systemctl', ['--user', 'is-system-running'], {timeoutMs: 10000});
  const state = result.stdout.trim();
  if (['running', 'degraded', 'starting', 'initializing'].includes(state)) return {available: true};
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
  return result.code === 0 ? {ok: true} : {ok: false, reason: (result.stderr.trim() || result.error || `systemd-run exit ${result.code}`).split('\n')[0]!};
}

/**
 * Start a lease timer that stops `unit` at `expiresAt` (Unix seconds, wall
 * clock), and read it back. A realtime timer elapses at the receipt's
 * `expiresAt`, including after the host sleeps.
 */
export async function startLease(base: string, unit: string, expiresAt: number, description: string): Promise<{ok: true} | {ok: false; reason: string}> {
  const systemctl = (await exec('sh', ['-c', 'command -v systemctl'])).stdout.trim() || '/usr/bin/systemctl';
  const result = await exec('systemd-run', [
    '--user', `--unit=${base}`, '--collect', '--quiet',
    `--on-calendar=@${expiresAt}`, '--timer-property=AccuracySec=1s',
    `--description=${description}`,
    '--', systemctl, '--user', 'stop', unit,
  ], {timeoutMs: 30000});
  if (result.code !== 0) return {ok: false, reason: (result.stderr.trim() || result.error || `systemd-run exit ${result.code}`).split('\n')[0]!};
  const state = await timerState(`${base}.timer`);
  if (!state?.loaded || state.active !== 'active') return {ok: false, reason: 'lease timer did not become active'};
  if (state.nextElapse !== expiresAt) return {ok: false, reason: `lease timer elapses at ${state.nextElapse}, expected ${expiresAt}`};
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
