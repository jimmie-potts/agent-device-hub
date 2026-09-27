// start, scenario, extend, stop, restart and doctor: the run lifecycle of
// docs/app-verification.md, identical for every application.
import {existsSync} from 'node:fs';
import {chmod, mkdir, open, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {delimiter, dirname, join} from 'node:path';
import {card, windowsLoopback} from './card.js';
import {latestFrozen, recoverOnStop, uncommitted} from './handoff.js';
import {LockedError, ProofStore, validateReceipt} from './receipt.js';
import {artifactDigest, candidate, resolveRoots, RootError, type Roots} from './roots.js';
import * as systemd from './systemd.js';
import {RECEIPT_VERSION, type AppPlugin, type CheckRecord, type CleanupItem, type ProbeContext, type Receipt, type RunState} from './types.js';
import {errorText, hex256, iso, newRunId, pause, runIdPattern, which} from './util.js';

export type Env = Readonly<Record<string, string | undefined>>;

export interface Io {
  env: Env;
  /** The one JSON result line. */
  result(value: Record<string, unknown>): void;
  /** Progress and the card, on stderr. */
  progress(line: string): void;
}

export const EXIT = {ok: 0, failed: 1, usage: 2, unavailable: 3} as const;
export const DEFAULT_LEASE_MINUTES = 120;
/** The installed services' ports (docs/app-verification.md). A run never serves on them. */
export const INSTALLED_PORTS: readonly number[] = [8788, 8765, 8787, 8791, 41230, 41231];

/** An own key of a plug-in record: `toString` or `__proto__` never names a scenario or step. */
export function has(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.hasOwn(record, key);
}

/** A lifecycle failure with a receipt cause. */
export class Failure extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`${code}: ${detail}`);
  }
}

export class Run {
  readonly store: ProofStore;
  constructor(readonly plugin: AppPlugin, readonly roots: Roots, readonly runId: string) {
    this.store = new ProofStore(join(roots.proof, runId));
  }
  get runtimeDir() {
    return join(this.roots.runtime, this.runId);
  }
  get dataDir() {
    return join(this.runtimeDir, 'data');
  }
  get tmpDir() {
    return join(this.runtimeDir, 'tmp');
  }
  get homeDir() {
    return join(this.runtimeDir, 'home');
  }
  get stdoutLog() {
    return join(this.runtimeDir, 'stdout.log');
  }
  get stderrLog() {
    return join(this.runtimeDir, 'stderr.log');
  }
  get unit() {
    return systemd.unitName(this.runId);
  }
  paths() {
    return {runId: this.runId, root: this.plugin.root, runtimeDir: this.runtimeDir, dataDir: this.dataDir};
  }
}

function probeContext(run: Run, scenario: string, url: string, port: number, signal: AbortSignal): ProbeContext {
  return {...run.paths(), scenario, url, port, signal};
}

// ---------------------------------------------------------------------------
// Launch and readiness, shared by start and reseed.

/** Empty the application's state and seed a scenario into it. */
async function seed(run: Run, scenario: string): Promise<void> {
  for (const dir of [run.dataDir, run.tmpDir, run.homeDir]) {
    await rm(dir, {recursive: true, force: true});
    await mkdir(dir, {mode: 0o700});
  }
  await writeFile(run.stdoutLog, '', {mode: 0o600});
  await writeFile(run.stderrLog, '', {mode: 0o600});
  if (!has(run.plugin.scenarios, scenario)) throw new Failure('seed-failed', `unknown scenario ${scenario}`);
  const definition = run.plugin.scenarios[scenario]!;
  try {
    await definition.seed({...run.paths(), scenario});
  } catch (error) {
    throw new Failure('seed-failed', errorText(error));
  }
}

/** Launch the app; returns the names of core variables (PATH, HOME, TMPDIR) the plug-in overrode. */
async function launch(run: Run, scenario: string, port: number, env: Env): Promise<string[]> {
  let spec;
  try {
    spec = await run.plugin.launch({...run.paths(), scenario, port, node: process.execPath});
  } catch (error) {
    throw new Failure('launch-failed', errorText(error));
  }
  if (!Array.isArray(spec.argv) || spec.argv.length === 0) throw new Failure('launch-failed', 'launch returned no argv');
  const path = [dirname(process.execPath), ...(env.PATH ?? '/usr/local/bin:/usr/bin:/bin').split(delimiter)].join(delimiter);
  const cwd = spec.cwd ?? run.plugin.root;
  const program = which(spec.argv[0]!, path, cwd);
  if (!program) throw new Failure('launch-failed', `program ${spec.argv[0]} was not found on PATH`);
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\n\0]/.test(value)) throw new Failure('launch-failed', `invalid environment entry ${key}`);
  }
  const started = await systemd.startService({
    unit: run.unit,
    argv: [program, ...spec.argv.slice(1)],
    cwd,
    // A private HOME keeps the app away from the caller's personal files unless the plug-in opts out.
    env: {PATH: path, HOME: run.homeDir, TMPDIR: run.tmpDir, ...spec.env},
    stdout: run.stdoutLog,
    stderr: run.stderrLog,
    description: `app-verify ${run.runId}`,
  });
  if (!started.ok) throw new Failure('launch-failed', started.reason);
  return ['PATH', 'HOME', 'TMPDIR'].filter(name => Object.hasOwn(spec.env ?? {}, name));
}

/** Names only, never values: a run that dropped its private HOME or TMPDIR says so. */
async function noteOverrides(run: Run, io: Io, overrides: string[]): Promise<void> {
  if (overrides.length) io.progress(`${run.runId}: the plug-in overrides ${overrides.join(', ')}; stop removes only the runtime directory`);
}

/** Wait for the ready line and a passing probe. Returns the URL and port. */
async function ready(run: Run, scenario: string, expectedPort: number): Promise<{url: string; port: number}> {
  const timeoutMs = run.plugin.readiness.timeoutMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  let offset = 0, pending = '', url: string | undefined, port = 0, lastProbe = '';
  for (;;) {
    if (!url) {
      const handle = await open(run.stdoutLog, 'r').catch(() => undefined);
      if (handle) {
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const {bytesRead} = await handle.read(buffer, 0, buffer.length, offset);
          offset += bytesRead;
          pending += buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await handle.close();
        }
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          let announced;
          try {
            announced = run.plugin.readiness.line(line);
          } catch {
            announced = undefined;
          }
          if (!announced) continue;
          let parsed: URL;
          try {
            parsed = new URL(announced.url);
          } catch {
            throw new Failure('launch-failed', 'the ready line named an invalid URL');
          }
          if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Failure('launch-failed', 'the application did not bind 127.0.0.1 with an explicit port');
          url = parsed.href;
          port = Number(parsed.port);
          if (expectedPort && port !== expectedPort) throw new Failure('port-changed', `relaunched on port ${port}, expected ${expectedPort}`);
          if ([...INSTALLED_PORTS, ...(run.plugin.reservedPorts ?? [])].includes(port)) throw new Failure('port-reserved', `the application announced reserved port ${port}`);
          break;
        }
      }
    }
    if (url) {
      const remaining = Math.max(250, Math.min(5000, deadline - Date.now()));
      try {
        const result = await run.plugin.readiness.probe(probeContext(run, scenario, url, port, AbortSignal.timeout(remaining)));
        if (result.ok) return {url, port};
        lastProbe = result.reason;
      } catch (error) {
        lastProbe = errorText(error);
      }
    }
    const unit = await systemd.unitState(run.unit);
    if (unit && (!unit.loaded || unit.active === 'failed' || unit.active === 'inactive')) {
      throw new Failure('unit-exited', `the application exited before it was ready (${unit.loaded ? unit.active : 'unit collected'})`);
    }
    if (Date.now() > deadline) {
      throw new Failure('readiness-timeout', url ? `readiness probe did not pass within ${timeoutMs} ms: ${lastProbe}` : `no ready line within ${timeoutMs} ms`);
    }
    await pause(100);
  }
}

async function boundaryChecks(run: Run, scenario: string, url: string, port: number, env: Env): Promise<CheckRecord[]> {
  const checks: CheckRecord[] = [{id: 'readiness', outcome: 'passed'}];
  for (const check of run.plugin.checks ?? []) {
    let record: CheckRecord;
    try {
      const outcome = await check.run(probeContext(run, scenario, url, port, AbortSignal.timeout(15000)));
      record = outcome.outcome === 'passed' ? {id: check.id, outcome: 'passed'} : {id: check.id, outcome: outcome.outcome, reason: outcome.reason};
    } catch (error) {
      record = {id: check.id, outcome: 'failed', reason: errorText(error)};
    }
    checks.push(record);
    if (record.outcome === 'failed') {
      const failure = new Failure('check-failed', `${check.id}: ${record.reason}`);
      (failure as Failure & {checks?: CheckRecord[]}).checks = checks;
      throw failure;
    }
  }
  checks.push(await windowsLoopback(port, env));
  return checks;
}

async function identity(run: Run): Promise<{mainPid: number; mainStartMonotonic: number}> {
  const unit = await systemd.unitState(run.unit);
  if (!unit?.loaded || unit.active !== 'active' || !unit.mainPid || !unit.mainStartMonotonic) throw new Failure('unit-exited', 'the application unit is not active after readiness');
  return {mainPid: unit.mainPid, mainStartMonotonic: unit.mainStartMonotonic};
}

/**
 * The plug-in's own one-line cause for a failed start or reseed, from the last
 * 4 KB of the app's stderr. The tail stays in memory; only a validated single
 * line the plug-in chose to return is recorded.
 */
async function appCause(run: Run): Promise<string | undefined> {
  const name = run.plugin.readiness.failureCause;
  if (!name) return undefined;
  let tail = '';
  try {
    const handle = await open(run.stderrLog, 'r');
    try {
      const size = (await handle.stat()).size, length = Math.min(size, 4096);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      tail = buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  if (!tail) return undefined;
  try {
    const cause = name.call(run.plugin.readiness, tail);
    // Printable ASCII only: no control, bidi or zero-width characters can reshape a receipt or terminal line.
    if (typeof cause === 'string' && cause.length <= 200 && /^[\x20-\x7e]+$/.test(cause)) return cause;
  } catch {
    // A plug-in that throws never masks the core's own cause.
  }
  return undefined;
}

const withCause = (detail: string, cause: string | undefined) => (cause ? `${detail}; app: ${cause}` : detail);

// ---------------------------------------------------------------------------
// Cleanup through unit names only.

export async function cleanup(run: Run, receipt: Receipt | undefined, expectRuntimeDir: boolean): Promise<{result: 'clean' | 'partial' | 'unknown'; items: CleanupItem[]}> {
  const items: CleanupItem[] = [];
  const timers = new Set<string>();
  if (receipt) timers.add(receipt.owned.leaseTimer);
  const listed = await systemd.listUnits(`app-verify-${run.runId}-lease`);
  for (const name of listed ?? []) if (name.endsWith('.timer')) timers.add(name);
  if (timers.size === 0) timers.add(`${systemd.leaseBase(run.runId)}.timer`);
  for (const timer of timers) items.push({kind: 'lease-timer', name: timer, outcome: listed === undefined ? 'unknown' : await systemd.stopUnit(timer)});
  items.push({kind: 'unit', name: run.unit, outcome: await systemd.stopUnit(run.unit)});
  if (existsSync(run.runtimeDir)) {
    await rm(run.runtimeDir, {recursive: true, force: true});
    items.push({kind: 'runtime-dir', name: run.runId, outcome: existsSync(run.runtimeDir) ? 'left' : 'removed'});
  } else items.push({kind: 'runtime-dir', name: run.runId, outcome: 'absent'});
  const result = items.some(i => i.outcome === 'unknown') ? 'unknown'
    : items.some(i => i.outcome === 'left') || (expectRuntimeDir && items.at(-1)!.outcome === 'absent') ? 'partial' : 'clean';
  return {result, items};
}

// ---------------------------------------------------------------------------
// start

export interface StartOptions {
  scenario: string;
  leaseMinutes: number;
  restarts?: string;
}

export async function start(plugin: AppPlugin, io: Io, options: StartOptions): Promise<{code: number; receipt?: Receipt; value: Record<string, unknown>}> {
  const operation = {operation: 'start'};
  const supervisor = await systemd.supervisor();
  if (!supervisor.available) return {code: EXIT.unavailable, value: {...operation, state: 'failed', cause: 'supervisor-unavailable', detail: supervisor.reason}};
  let rootsFound: Roots;
  try {
    rootsFound = await resolveRoots(plugin, io.env);
  } catch (error) {
    if (error instanceof RootError) return {code: EXIT.failed, value: {...operation, state: 'failed', cause: error.code, detail: error.message}};
    throw error;
  }
  const build = await candidate(plugin);
  const run = new Run(plugin, rootsFound, newRunId(plugin.app));
  const {runId} = run;
  // 1. The proof directory and a `starting` receipt naming everything start will create.
  await mkdir(rootsFound.proof, {recursive: true});
  await mkdir(run.store.dir);
  const receipt: Receipt = {
    receiptVersion: RECEIPT_VERSION,
    runId,
    app: plugin.app,
    repository: plugin.repository,
    roots: rootsFound.labels,
    state: 'starting',
    startedAt: iso(),
    ...(options.restarts ? {restarts: options.restarts} : {}),
    build: {...build, artifactDigest: null},
    scenario: {name: options.scenario, version: build.sourceRevision, seededAt: null},
    components: plugin.components.map(c => ({...c})),
    checks: [],
    captures: [],
    preview: null,
    owned: {unit: run.unit, leaseTimer: `${systemd.leaseBase(runId)}.timer`, port: null, runtimeDir: runId, proofDir: runId, mainPid: null, mainStartMonotonic: null},
    proof: {frozenAt: null},
    failure: null,
    cleanup: {result: null},
    secrets: 'none recorded',
  };
  await run.store.write(receipt);
  await run.store.event('created', {unit: run.unit, leaseTimer: receipt.owned.leaseTimer, runtimeDir: runId, scenario: options.scenario, build, ...(options.restarts ? {restarts: options.restarts} : {})});
  io.progress(`${runId}: starting ${plugin.app} (${build.sourceRevision.slice(0, 8)}${build.dirty ? ', dirty' : ''}), scenario ${options.scenario}`);
  let port: number | null = null;
  try {
    if (plugin.build.prepare) {
      try {
        await plugin.build.prepare({root: plugin.root, signal: AbortSignal.timeout(15 * 60000)});
      } catch (error) {
        throw new Failure('build-failed', errorText(error));
      }
      await run.store.event('prepared');
    }
    // 2. Runtime directory and seed.
    await mkdir(rootsFound.runtime, {recursive: true, mode: 0o700});
    try {
      await mkdir(run.runtimeDir, {mode: 0o700});
      await chmod(run.runtimeDir, 0o700);
    } catch (error) {
      throw new Failure('runtime-root-unusable', errorText(error));
    }
    await seed(run, options.scenario);
    const seededAt = iso();
    await run.store.event('seeded', {scenario: options.scenario});
    // 3. The lease exists before the application.
    const expiresAt = Math.ceil((Date.now() + options.leaseMinutes * 60000) / 1000);
    const lease = await systemd.startLease(systemd.leaseBase(runId), run.unit, expiresAt, `app-verify lease ${runId}`);
    if (!lease.ok) throw new Failure('lease-failed', lease.reason);
    await run.store.event('lease-started', {timer: receipt.owned.leaseTimer, expiresAt: iso(expiresAt * 1000)});
    // 4. The application under its unit.
    const overrides = await launch(run, options.scenario, 0, io.env);
    await run.store.event('unit-started', {unit: run.unit, ...(overrides.length ? {overrides} : {})});
    await noteOverrides(run, io, overrides);
    // 5. Readiness, identity, artifact, boundary checks.
    const announced = await ready(run, options.scenario, 0);
    port = announced.port;
    await run.store.event('ready', {port});
    let digest: string;
    try {
      digest = await artifactDigest(plugin, announced.url, AbortSignal.timeout(15000));
    } catch (error) {
      throw new Failure('artifact-unreadable', errorText(error));
    }
    const checks = await boundaryChecks(run, options.scenario, announced.url, port, io.env);
    const live = await identity(run);
    // 6. The running receipt.
    Object.assign(receipt, {
      state: 'running' satisfies RunState,
      build: {...receipt.build, artifactDigest: digest},
      scenario: {...receipt.scenario, seededAt},
      checks,
      preview: {url: announced.url, expiresAt: iso(expiresAt * 1000), leaseMinutes: options.leaseMinutes},
    });
    Object.assign(receipt.owned, {port, ...live});
    await run.store.write(receipt);
    await run.store.event('running', {port, url: announced.url, mainPid: live.mainPid});
    const lines = card(receipt, plugin.command);
    for (const line of lines) io.progress(line);
    return {code: EXIT.ok, receipt, value: {...operation, runId, state: 'running', url: announced.url, port, scenario: options.scenario, build: receipt.build, expiresAt: receipt.preview!.expiresAt, proofDir: run.store.dir, card: lines}};
  } catch (error) {
    const caught = error instanceof Failure ? error : new Failure('launch-failed', errorText(error));
    const failure = new Failure(caught.code, withCause(caught.detail, await appCause(run)));
    (failure as Failure & {checks?: CheckRecord[]}).checks = (caught as Failure & {checks?: CheckRecord[]}).checks;
    io.progress(`${runId}: start failed: ${failure.message}`);
    const cleaned = await cleanup(run, receipt, false);
    const checks = (failure as Failure & {checks?: CheckRecord[]}).checks;
    Object.assign(receipt, {state: 'failed' satisfies RunState, failure: {cause: failure.code, at: iso(), detail: failure.detail}, cleanup: {...cleaned, at: iso()}, ...(checks ? {checks} : {})});
    receipt.owned.port = port;
    await run.store.write(receipt);
    await run.store.event('start-failed', {cause: failure.code, detail: failure.detail, cleanup: cleaned.result});
    return {code: EXIT.failed, receipt, value: {...operation, runId, state: 'failed', cause: failure.code, detail: failure.detail, cleanup: cleaned, proofDir: run.store.dir}};
  }
}

// ---------------------------------------------------------------------------
// Loading an existing run.

export class UsageError extends Error {}

export async function load(plugin: AppPlugin, io: Io, runId: string | undefined): Promise<Run> {
  if (!runId || !runIdPattern(plugin.app).test(runId)) throw new UsageError(`expected a ${plugin.app} run id`);
  let found: Roots;
  try {
    found = await resolveRoots(plugin, io.env);
  } catch (error) {
    if (error instanceof RootError) throw new Failure(error.code, error.message);
    throw error;
  }
  return new Run(plugin, found, runId);
}

async function readReceipt(run: Run): Promise<Receipt> {
  if (!run.store.exists()) throw new Failure('unknown-run', `no receipt for ${run.runId}`);
  const receipt = await run.store.read();
  const checked = validateReceipt(receipt);
  if (!checked.ok) throw new Failure('invalid-receipt', checked.errors[0]!);
  return receipt;
}

/** The run must be running and its live unit must match the receipt. */
async function requireRunning(run: Run): Promise<Receipt> {
  const receipt = await readReceipt(run);
  if (receipt.state !== 'running') throw new Failure('run-not-running', `${run.runId} is ${receipt.state}`);
  const unit = await systemd.unitState(run.unit);
  if (!unit?.loaded || unit.active !== 'active') throw new Failure('run-not-running', `${run.unit} is not active`);
  if (unit.mainPid !== receipt.owned.mainPid || unit.mainStartMonotonic !== receipt.owned.mainStartMonotonic) throw new Failure('run-not-running', `${run.unit} does not match the receipt's process identity`);
  return receipt;
}

// ---------------------------------------------------------------------------
// scenario and handoff --reset: reseed on the same port, keeping id and lease.

export async function reseed(run: Run, io: Io, receipt: Receipt, scenario: string): Promise<{code: number; value: Record<string, unknown>}> {
  try {
    const stopped = await systemd.stopUnit(run.unit);
    if (stopped !== 'removed' && stopped !== 'absent') throw new Failure('unit-exited', `${run.unit} did not stop (${stopped})`);
    await seed(run, scenario);
    const seededAt = iso();
    const timer = await systemd.timerState(receipt.owned.leaseTimer);
    if (!timer?.loaded || timer.active !== 'active') throw new Failure('lease-failed', 'the lease elapsed during the reseed');
    const overrides = await launch(run, scenario, receipt.owned.port!, io.env);
    await noteOverrides(run, io, overrides);
    const announced = await ready(run, scenario, receipt.owned.port!);
    const checks = await boundaryChecks(run, scenario, announced.url, announced.port, io.env);
    const live = await identity(run);
    const updated = await run.store.update(current => {
      current.scenario = {name: scenario, version: current.build.sourceRevision, seededAt};
      current.checks = checks;
      Object.assign(current.owned, live);
    });
    await run.store.event('reseeded', {scenario, mainPid: live.mainPid});
    io.progress(`${run.runId}: reseeded to ${scenario} on port ${announced.port}`);
    return {code: EXIT.ok, value: {runId: run.runId, state: 'running', scenario, port: announced.port, url: announced.url, seededAt, receipt: updated}};
  } catch (error) {
    const caught = error instanceof Failure ? error : new Failure('launch-failed', errorText(error));
    const failure = new Failure(caught.code, withCause(caught.detail, await appCause(run)));
    io.progress(`${run.runId}: reseed failed, stopping the run: ${failure.message}`);
    const cleaned = await cleanup(run, receipt, false);
    await run.store.update(current => {
      Object.assign(current, {state: 'stopped' satisfies RunState, failure: {cause: 'reset-failed', at: iso(), detail: `${failure.code}: ${failure.detail}`}, cleanup: {...cleaned, at: iso()}});
    });
    await run.store.event('reset-failed', {scenario, cause: failure.code, detail: failure.detail, cleanup: cleaned.result});
    return {code: EXIT.failed, value: {runId: run.runId, state: 'stopped', cause: 'reset-failed', detail: `${failure.code}: ${failure.detail}`, cleanup: cleaned}};
  }
}

export async function scenario(plugin: AppPlugin, io: Io, runId: string | undefined, name: string | undefined) {
  const run = await load(plugin, io, runId);
  if (!name || !has(plugin.scenarios, name)) throw new UsageError(`the fixtures define no scenario ${name ?? '(none)'}; see help`);
  const receipt = await requireRunning(run);
  const result = await reseed(run, io, receipt, name);
  const {receipt: _unused, ...value} = result.value;
  return {code: result.code, value: {operation: 'scenario', ...value}};
}

// ---------------------------------------------------------------------------
// extend: make the next lease timer before breaking the old one.

export async function extend(plugin: AppPlugin, io: Io, runId: string | undefined, leaseMinutes: number) {
  const run = await load(plugin, io, runId);
  const receipt = await requireRunning(run);
  const old = receipt.owned.leaseTimer;
  // The next generation is above every lease timer that exists, including one a killed extend left behind.
  const leases = ((await systemd.listUnits(`app-verify-${run.runId}-lease`)) ?? []).filter(name => name.endsWith('.timer'));
  const next = systemd.leaseBase(run.runId, Math.max(systemd.leaseGeneration(old), ...leases.map(systemd.leaseGeneration)) + 1);
  const expiresAt = Math.ceil((Date.now() + leaseMinutes * 60000) / 1000);
  const lease = await systemd.startLease(next, run.unit, expiresAt, `app-verify lease ${run.runId}`);
  if (!lease.ok) {
    await run.store.event('extend-failed', {timer: `${next}.timer`, reason: lease.reason});
    throw new Failure('lease-failed', `the new lease timer could not be started; ${old} still holds the old expiry (${lease.reason})`);
  }
  // The receipt names the new lease before any old one stops, so it always names a live lease and the true expiry.
  let updated: Receipt;
  try {
    updated = await run.store.update(current => {
      current.owned.leaseTimer = `${next}.timer`;
      current.preview = {...current.preview!, expiresAt: iso(expiresAt * 1000), leaseMinutes};
    });
  } catch (error) {
    // The receipt still names the old lease, so the new timer must not stay armed unrecorded.
    await systemd.stopUnit(`${next}.timer`);
    throw error;
  }
  // Only the new lease may remain: an older or stray timer could stop the run before the recorded expiry.
  const retired: Record<string, string> = {};
  for (const timer of new Set([old, ...leases])) retired[timer] = await systemd.stopUnit(timer);
  await run.store.event('extended', {timer: `${next}.timer`, replaced: retired, expiresAt: updated.preview!.expiresAt});
  const lines = card(updated, plugin.command);
  for (const line of lines) io.progress(line);
  const left = Object.entries(retired).filter(([, outcome]) => outcome !== 'removed' && outcome !== 'absent').map(([timer]) => timer);
  return {code: left.length ? EXIT.failed : EXIT.ok, value: {operation: 'extend', runId: run.runId, state: 'running', expiresAt: updated.preview!.expiresAt, leaseTimer: `${next}.timer`, ...(left.length ? {left} : {}), card: lines}};
}

// ---------------------------------------------------------------------------
// stop

export async function stop(plugin: AppPlugin, io: Io, runId: string | undefined) {
  const run = await load(plugin, io, runId);
  // Unit names come from the run id, so an unreadable receipt never blocks cleanup; the file is left as found.
  let receipt: Receipt | undefined, unreadable: string | undefined;
  if (run.store.exists()) {
    try {
      const value = await run.store.read();
      const checked = validateReceipt(value);
      if (checked.ok) receipt = value;
      else unreadable = checked.errors[0];
    } catch (error) {
      unreadable = errorText(error);
    }
  }
  if (unreadable !== undefined) {
    const cleaned = await cleanup(run, undefined, false);
    await run.store.event('stopped', {state: 'stale', receipt: 'unreadable', cleanup: cleaned.result, items: cleaned.items}).catch(() => undefined);
    const ok = cleaned.items.every(i => i.outcome !== 'left' && i.outcome !== 'unknown');
    return {code: ok ? EXIT.ok : EXIT.failed, value: {operation: 'stop', runId: run.runId, state: 'stale', receipt: 'unreadable', detail: unreadable, cleanup: cleaned}};
  }
  const live = receipt ? receipt.state === 'starting' || receipt.state === 'running' : false;
  const unitBefore = await systemd.unitState(run.unit);
  const leases = await systemd.listUnits(`app-verify-${run.runId}-lease`);
  const anything = !!unitBefore?.loaded || (leases?.length ?? 0) > 0 || existsSync(run.runtimeDir);
  if (receipt && !live && !anything) {
    // Already stopped, failed or expired with nothing left: report without rewriting.
    return {code: EXIT.ok, value: {operation: 'stop', runId: run.runId, state: receipt.state, cleanup: receipt.cleanup}};
  }
  if (!receipt && !anything) throw new Failure('unknown-run', `nothing is known about ${run.runId}`);
  // Units, timers and the runtime directory go first: no proof state can keep a run serving.
  const cleaned = await cleanup(run, receipt, live);
  let state: RunState = receipt?.state ?? 'stopped';
  if (receipt && live) {
    const expired = !unitBefore?.loaded && receipt.preview !== null && Date.parse(receipt.preview.expiresAt) <= Date.now();
    state = expired ? 'expired' : 'stopped';
  }
  for (const item of cleaned.items) if (item.outcome === 'left' || item.outcome === 'unknown') io.progress(`${run.runId}: ${item.kind} ${item.name} is ${item.outcome}; stop it by name with systemctl --user stop ${item.name}`);
  const ok = cleaned.items.every(i => i.outcome !== 'left' && i.outcome !== 'unknown');
  let proof: Awaited<ReturnType<typeof recoverOnStop>> = {proof: 'none'};
  if (receipt) {
    try {
      // Then proof recovery under the lock: an interrupted handoff can no longer finish once the run stops.
      await run.store.update(async current => {
        proof = await recoverOnStop(run.store.dir, current);
        current.state = state;
        current.cleanup = {...cleaned, at: iso()};
      });
    } catch (error) {
      // The cleanup already happened; report it with the refusal instead of hiding it.
      if (!(error instanceof LockedError)) throw error;
      return {code: EXIT.failed, value: {operation: 'stop', runId: run.runId, state, cleanup: cleaned, error: 'receipt-locked', detail: error.message}};
    }
    if (proof.proof === 'committed') await run.store.event('frozen-committed', {manifest: proof.digest});
    if (proof.proof === 'conflict') io.progress(`${run.runId}: proof-conflict: ${proof.reason}; the files are left for inspection`);
    await run.store.event('stopped', {state, cleanup: cleaned.result, items: cleaned.items, proof: proof.proof});
  }
  const {digest: _digest, ...reported} = proof;
  return {code: ok ? EXIT.ok : EXIT.failed, value: {operation: 'stop', runId: run.runId, state, cleanup: cleaned, ...(reported.proof !== 'none' ? {proof: reported} : {})}};
}

// ---------------------------------------------------------------------------
// restart

export async function restart(plugin: AppPlugin, io: Io, runId: string | undefined) {
  const run = await load(plugin, io, runId);
  const previous = await readReceipt(run);
  const stopped = await stop(plugin, io, run.runId);
  if (stopped.code !== EXIT.ok) return {code: stopped.code, value: {...stopped.value, operation: 'restart'}};
  const started = await start(plugin, io, {scenario: previous.scenario.name, leaseMinutes: previous.preview?.leaseMinutes ?? DEFAULT_LEASE_MINUTES, restarts: run.runId});
  if (!started.receipt) return {code: started.code, value: {...started.value, operation: 'restart', restarts: run.runId}};
  const next = started.receipt.build;
  const same = !previous.build.dirty && !next.dirty && next.sourceRevision !== 'unknown' && next.sourceRevision === previous.build.sourceRevision
    && (next.artifactDigest === null || previous.build.artifactDigest === null || next.artifactDigest === previous.build.artifactDigest);
  const continuity = same ? 'same-candidate' : 'different-candidate';
  await new ProofStore(join(run.roots.proof, started.receipt.runId)).event('restarts', {previous: run.runId, previousBuild: previous.build, continuity});
  if (!same) io.progress(`${started.receipt.runId}: a different candidate from ${run.runId}; its proof does not continue the earlier run`);
  return {code: started.code, value: {...started.value, operation: 'restart', restarts: run.runId, continuity}};
}

// ---------------------------------------------------------------------------
// doctor: read live state, never repair.

export async function sums(directory: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (prefix: string) => {
    for (const entry of (await readdir(join(directory, prefix), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      // A frozen set holds regular files only; a link or device could change what a sum covers.
      else if (!entry.isFile()) throw new Failure('proof-irregular', `${path} is not a regular file`);
      else if (path !== 'SHA256SUMS') {
        const handle = await open(join(directory, path), 'r');
        try {
          found.set(path, hex256(await handle.readFile()));
        } finally {
          await handle.close();
        }
      }
    }
  };
  await walk('');
  return found;
}

/**
 * The frozen set's integrity: `ok`, `tampered` (a file, the manifest or its
 * recorded digest differs, or an entry is not a regular file), `missing`
 * (the receipt says frozen but `verified/` or `SHA256SUMS` is gone) or
 * `not-frozen`.
 */
export async function verifySums(proofDir: string, receipt: Receipt | undefined): Promise<'ok' | 'tampered' | 'missing' | 'partial' | 'conflict' | 'unreadable' | 'not-frozen'> {
  try {
    return await checkSums(proofDir, receipt);
  } catch (error) {
    // One damaged proof file never hides the other runs doctor lists.
    if (!(error instanceof Failure)) return 'unreadable';
    throw error;
  }
}

async function checkSums(proofDir: string, receipt: Receipt | undefined): Promise<'ok' | 'tampered' | 'missing' | 'partial' | 'conflict' | 'not-frozen'> {
  const verified = join(proofDir, 'verified');
  const manifest = join(verified, 'SHA256SUMS');
  if (!receipt?.proof.frozenAt) {
    // An interrupted handoff: `partial` when rerunning handoff finishes it, `conflict` when it would refuse.
    if (existsSync(verified)) return !receipt || (await uncommitted(proofDir, receipt)).kind === 'conflict' ? 'conflict' : 'partial';
    return existsSync(join(proofDir, 'verified.partial')) ? 'partial' : 'not-frozen';
  }
  if (!existsSync(manifest)) return 'missing';
  const text = await readFile(manifest, 'utf8');
  // The digest recorded before the rename; a later commit event never replaces it.
  const recorded = (await latestFrozen(proofDir))?.manifest;
  if (recorded !== undefined && recorded !== 'sha256:' + hex256(text)) return 'tampered';
  const expected = new Map(text.trim().split('\n').filter(Boolean).map(line => {
    const [sum, ...path] = line.split('  ');
    return [path.join('  '), sum ?? ''] as [string, string];
  }));
  let actual: Map<string, string>;
  try {
    actual = await sums(verified);
  } catch (error) {
    if (error instanceof Failure && error.code === 'proof-irregular') return 'tampered';
    throw error;
  }
  if (expected.size !== actual.size) return 'tampered';
  for (const [path, sum] of expected) if (actual.get(path) !== sum) return 'tampered';
  return 'ok';
}

export async function doctor(plugin: AppPlugin, io: Io, runId: string | undefined) {
  let found: Roots;
  try {
    found = await resolveRoots(plugin, io.env);
  } catch (error) {
    if (error instanceof RootError) throw new Failure(error.code, error.message);
    throw error;
  }
  const pattern = runIdPattern(plugin.app);
  const ids = new Set<string>();
  if (runId !== undefined) {
    if (!pattern.test(runId)) throw new UsageError(`expected a ${plugin.app} run id`);
    ids.add(runId);
  } else {
    const units = await systemd.listUnits(`app-verify-${plugin.app}-`);
    for (const name of units ?? []) {
      const match = /^app-verify-(.+?)(?:-lease(?:-\d+)?)?\.(?:service|timer)$/.exec(name);
      if (match && pattern.test(match[1]!)) ids.add(match[1]!);
    }
    for (const root of [found.runtime, found.proof]) {
      for (const entry of existsSync(root) ? await readdir(root) : []) if (pattern.test(entry)) ids.add(entry);
    }
  }
  const runs = [];
  for (const id of [...ids].sort()) runs.push(await assess(new Run(plugin, found, id), io));
  if (runId !== undefined && runs[0]!.receipt === null && runs[0]!.unit === null && runs[0]!.runtimeDir === 'missing' && runs[0]!.leaseTimer === null) {
    throw new Failure('unknown-run', `nothing is known about ${runId}`);
  }
  return {code: EXIT.ok, value: {operation: 'doctor', app: plugin.app, runs}};
}

async function assess(run: Run, io: Io) {
  const reasons: string[] = [];
  let receipt: Receipt | undefined;
  let receiptInfo: {state: RunState} | {state: null; problem: string} | null = null;
  if (run.store.exists()) {
    try {
      receipt = await run.store.read();
      const checked = validateReceipt(receipt);
      if (checked.ok) receiptInfo = {state: receipt.state};
      else {
        receiptInfo = {state: null, problem: checked.errors[0]!};
        receipt = undefined;
      }
    } catch (error) {
      receiptInfo = {state: null, problem: errorText(error)};
    }
  }
  const unit = await systemd.unitState(run.unit);
  const unitRow = unit?.loaded ? {name: run.unit, active: unit.active, mainPid: unit.mainPid, mainStartMonotonic: unit.mainStartMonotonic} : null;
  const leases = ((await systemd.listUnits(`app-verify-${run.runId}-lease`)) ?? []).filter(n => n.endsWith('.timer'));
  const timers = [];
  for (const name of leases) {
    const state = await systemd.timerState(name);
    if (state?.loaded) timers.push({name, active: state.active, nextElapse: state.nextElapse === null ? null : iso(state.nextElapse * 1000)});
  }
  const runtimeDir = existsSync(run.runtimeDir) ? 'present' : 'missing';
  const active = unit?.loaded && unit.active === 'active';
  let state: string;
  if (!receipt) {
    state = 'stale';
    reasons.push(receiptInfo ? `receipt-invalid: ${(receiptInfo as {problem: string}).problem}` : 'receipt-missing');
  } else if (receipt.state === 'running' || receipt.state === 'starting') {
    if (!unit?.loaded || !active) {
      const expired = receipt.preview !== null && Date.parse(receipt.preview.expiresAt) <= Date.now();
      state = expired ? 'expired' : 'stale';
      reasons.push(expired ? 'lease-expired' : 'unit-gone');
      if (runtimeDir === 'present') reasons.push('runtime-dir-awaits-stop');
    } else {
      state = receipt.state;
      if (receipt.state === 'running' && (unit.mainPid !== receipt.owned.mainPid || unit.mainStartMonotonic !== receipt.owned.mainStartMonotonic)) {
        state = 'stale';
        reasons.push('identity-mismatch');
      }
      if (!timers.some(t => t.name === receipt!.owned.leaseTimer && t.active === 'active')) {
        state = 'stale';
        reasons.push('lease-timer-missing');
      }
      // Another armed lease could stop the run before the recorded expiry.
      if (timers.some(t => t.name !== receipt!.owned.leaseTimer)) {
        state = 'stale';
        reasons.push('extra-lease-timer');
      }
    }
    if (runtimeDir === 'missing') {
      state = 'stale';
      reasons.push('runtime-dir-missing');
    }
  } else {
    state = receipt.state;
    if (unitRow || timers.length || runtimeDir === 'present') {
      state = 'stale';
      reasons.push('resources-outlive-receipt');
    }
  }
  let health: CheckRecord | null = null, artifact: string | null = null, windows: CheckRecord | null = null;
  const checks: CheckRecord[] = [];
  let listener: {recorded: number; ports: number[] | null; outcome: 'matches' | 'mismatch' | 'unread'} | null = null;
  if (receipt?.preview && receipt.owned.port && active) {
    const url = receipt.preview.url, port = receipt.owned.port;
    try {
      const probe = await run.plugin.readiness.probe(probeContext(run, receipt.scenario.name, url, port, AbortSignal.timeout(5000)));
      health = probe.ok ? {id: 'health', outcome: 'passed'} : {id: 'health', outcome: 'failed', reason: probe.reason};
    } catch (error) {
      health = {id: 'health', outcome: 'failed', reason: errorText(error)};
    }
    try {
      artifact = (await artifactDigest(run.plugin, url, AbortSignal.timeout(5000))) === receipt.build.artifactDigest ? 'matches' : 'changed';
    } catch {
      artifact = 'unread';
    }
    if (artifact === 'changed') {
      state = 'stale';
      reasons.push('artifact-changed');
    }
    // The actual listener: the recorded port must be one the unit's own processes listen on.
    const ports = await systemd.listeningPorts(run.unit);
    listener = ports === undefined ? {recorded: port, ports: null, outcome: 'unread'} : {recorded: port, ports, outcome: ports.includes(port) ? 'matches' : 'mismatch'};
    if (listener.outcome === 'mismatch') {
      state = 'stale';
      reasons.push('listener-mismatch');
    }
    windows = await windowsLoopback(port, io.env);
    for (const check of run.plugin.checks ?? []) {
      if (!check.doctor) continue;
      try {
        const outcome = await check.run(probeContext(run, receipt.scenario.name, url, port, AbortSignal.timeout(15000)));
        checks.push(outcome.outcome === 'passed' ? {id: check.id, outcome: 'passed'} : {id: check.id, outcome: outcome.outcome, reason: outcome.reason});
      } catch (error) {
        checks.push({id: check.id, outcome: 'failed', reason: errorText(error)});
      }
    }
  }
  return {
    runId: run.runId,
    state,
    reasons,
    receipt: receiptInfo,
    unit: unitRow,
    leaseTimer: timers[0] ?? null,
    leaseTimers: timers,
    runtimeDir,
    build: receipt?.build ?? null,
    scenario: receipt?.scenario.name ?? null,
    preview: receipt?.preview ? {...receipt.preview, remainingMinutes: Math.max(0, Math.round((Date.parse(receipt.preview.expiresAt) - Date.now()) / 60000))} : null,
    health,
    artifact,
    listener,
    checks,
    failure: receipt?.failure ?? null,
    proof: {frozenAt: receipt?.proof.frozenAt ?? null, sums: existsSync(run.store.dir) ? await verifySums(run.store.dir, receipt) : 'not-frozen'},
    windows,
  };
}

