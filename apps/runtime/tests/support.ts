// Shared helpers for the runtime suites: small in-test fixture modules, private state directories and runtimes that stop
// after their test. These helpers serve only this package's tests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {parseRecord} from '@jimmie-potts/bunny-observability';
import type {BunnyModule, CommandDraft, Draft, ModuleContext, Scheduler} from '@jimmie-potts/sdk';
import {HEALTH_PATH, startRuntime, type LogRecord, type ModuleHealth, type Runtime, type RuntimeHealth, type RuntimeOptions} from '../src/index.js';

/** node:test's test() with a timeout, so a wait that never ends fails the test instead of hanging the run. */
export function it(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void test(name, {timeout: 20_000}, body);
}

/** A new private state directory outside any checkout, removed after the test. */
export async function stateDir(context: TestContext): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-runtime-')));
  context.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

/** An in-test module. Its start keeps the context for the test, then runs `body`; it counts its stops. */
export type Fixture = BunnyModule & {context: ModuleContext | undefined; stops: number};
export function fixture(name: string, body: (context: ModuleContext) => void | Promise<void> = () => {}, apiVersion = '1.0'): Fixture {
  const module: Fixture = {
    manifest: {name, apiVersion},
    context: undefined,
    stops: 0,
    start: context => {
      module.context = context;
      return body(context);
    },
    stop: () => { module.stops += 1; },
  };
  return module;
}

/** The context a fixture's start received. */
export function contextOf(module: Fixture): ModuleContext {
  assert.ok(module.context, `${module.manifest.name} has started`);
  return module.context;
}

/** The runtime package's version, which its records carry as `service.version`. */
export const RUNTIME_PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {version: string}).version;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fails unless each record, as the one JSON line the runtime writes, passes the diagnostic contract's validator. */
export function assertContractRecords(records: readonly LogRecord[]): void {
  for (const record of records) assert.equal(parseRecord(JSON.stringify(record)).ok, true, `${record.event_name} is a contract record`);
}

/**
 * Fails unless the writer dropped exactly `dropped` records and its sink lost none, as `runtime.stopped` counts them. A
 * record the contract refuses never reaches the sink, so only these counts show it.
 */
export function assertNoLostRecords(records: readonly LogRecord[], dropped = 0): void {
  const stopped = records.find(record => record.event_name === 'runtime.stopped');
  assert.ok(stopped, 'the runtime wrote runtime.stopped');
  assert.equal(stopped.attributes['bunny.telemetry.dropped_count'], dropped, 'records the contract refused');
  assert.equal(stopped.attributes['bunny.telemetry.failure_count'], 0, 'records the sink lost');
}

/**
 * A runtime on a free loopback port with a fresh state directory, collecting its log records. It stops after the test.
 * Then every record it wrote must pass the diagnostic contract's validator, and, unless the test passes its own sink, the
 * writer must have dropped none, or exactly `expected.dropped` for a test that logs refused records on purpose.
 */
export async function run(
  context: TestContext, options: Partial<RuntimeOptions> & {modules: readonly BunnyModule[]}, expected: {dropped?: number} = {},
): Promise<{runtime: Runtime; logs: LogRecord[]}> {
  const logs: LogRecord[] = [];
  const runtime = await startRuntime({port: 0, stateDir: await stateDir(context), log: record => { logs.push(record); }, ...options});
  context.after(async () => {
    await runtime.stop();
    assertContractRecords(logs);
    if (options.log === undefined) assertNoLostRecords(logs, expected.dropped);
  });
  return {runtime, logs};
}

export async function health(url: string): Promise<{status: number; body: RuntimeHealth}> {
  const response = await fetch(new URL(HEALTH_PATH, url));
  return {status: response.status, body: await response.json() as RuntimeHealth};
}

/** The named module's entry in a health report. */
export function entry(report: RuntimeHealth, name: string): ModuleHealth {
  const found = report.modules.find(module => module.name === name);
  assert.ok(found, `health lists ${name}`);
  return found;
}

/** Waits until `condition` holds, polling on real timers, and fails after `timeoutMs`. */
export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000, what = 'the condition'): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!await condition()) {
    if (performance.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise(resolve => { setTimeout(resolve, 5); });
  }
}

/** Lets every queued delivery run: setImmediate runs after all pending promise callbacks. */
export const flush = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

/** The promise's value if it has settled once pending deliveries ran, or undefined while it is still pending. */
export async function peek<T>(promise: Promise<T>): Promise<T | undefined> {
  const pending = Symbol('pending');
  const value = await Promise.race([promise, flush().then(() => pending)]);
  return value === pending ? undefined : value as T;
}

export function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(settle => { resolve = settle; });
  return {promise, resolve};
}

export const START = Date.parse('2026-10-06T12:00:00.000Z');

/** A clock and scheduler that move only when the test advances them. */
export function manualClock(start = START): {now: () => number; scheduler: Scheduler; advance: (ms: number) => void; pending: () => number} {
  let now = start;
  const timers = new Set<{at: number; callback: () => void}>();
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const timer = {at: now + delayMs, callback};
      timers.add(timer);
      return () => { timers.delete(timer); };
    }},
    advance: ms => {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) break;
        if (timers.delete(timer)) timer.callback();
      }
    },
    pending: () => timers.size,
  };
}

const BASE = 'https://bunny.invalid/events/';
export const session = (revision: number): Draft<{id: string; revision: number}> =>
  ({kind: 'state', type: 'org.bunny.session.updated', subject: 's1', dataschema: `${BASE}test-session/2.0`, data: {id: 's1', revision}});
export const turnEnded: Draft<{sessionId: string}> =
  {kind: 'occurrence', type: 'org.bunny.turn.ended', subject: 's1', dataschema: `${BASE}test-turn/2.0`, data: {sessionId: 's1'}};
export const setMode: CommandDraft<{mode: string}> =
  {type: 'org.bunny.mode.set.requested', subject: 'wall', dataschema: `${BASE}test-mode/2.0`, data: {mode: 'quiet'}};
