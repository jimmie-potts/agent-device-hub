// The module test kit (Hub #882): one conformance suite that every module runs in a few lines, so all modules behave
// the same under ADR 0012. Each check hosts a fresh instance of the module on its own bus and state directory, with a
// stand-in owner for the families it copies, and checks every message it sees against profile 2.0. Only
// `moduleConformance` loads node:test, so another runner, such as Vitest, can run `conformanceChecks` itself.
//
// Under ADR 0012's failure isolation (policy A), a device's errors and timeouts are not module failures: a module turns
// them into outcomes and an `unavailable` device state. Only an error that escapes the module, from its start, a
// handler, a responder, a timer or a worker, stops it, so the kit fails a module whose handler, timer or worker fails.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MessageValidator, compareDelivery, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus} from '../in-process.js';
import {checkManifest, type BunnyModule} from '../module.js';
import type {CommandDraft, Participant, RequestResult} from '../sdk.js';
import {schemaFamily, type Snapshot} from '../sync.js';
import {standInAckSchemas} from './acknowledge.js';
import {ModuleHarness} from './harness.js';
import {checkModuleRecord} from './records.js';

export type ConformanceSpec = {
  /** A fresh instance of the module. The kit calls it again to restart the module on the same database. */
  create: () => BunnyModule;
  /** The payload schemas of the module's own families, by `dataschema`. The core families are registered already. */
  schemas?: Readonly<Record<string, object>>;
  /** The families the module serves with `serveSync`, if any. */
  serves?: readonly string[];
  /** The families the module copies with `sync` at start, and the snapshot the kit's stand-in owner, `bunny/core`, serves. */
  copies?: {families: readonly string[]; snapshot: Snapshot};
  /** A command the module accepts, if it answers any. It must report the command's outcome through its outbox. */
  accepted?: {key: string; draft: CommandDraft<object>};
  /** A command the module refuses, and the registry code it refuses it with, if it answers any. */
  refused?: {key: string; draft: CommandDraft<object>; code: ErrorCode};
  /** How long a start, stop, request, sync or awaited message may take, in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
};
export type ConformanceCheck = {name: string; run: () => Promise<void>};

/**
 * The checks' names, in the order the kit runs them. Every module runs the manifest and lifecycle checks; each other
 * check runs only when the spec names what it needs. The lifecycle check sees only what the harness tracks: the
 * module's responders and sync owners on the bus, the timers and workers it started through its context, and its
 * database. A timer, socket or handle the module opened another way is beyond it.
 */
export const CHECKS = {
  manifest: 'declares a manifest the runtime accepts',
  lifecycle: 'starts, and stops leaving nothing behind',
  serves: 'serves its families through sync',
  copies: 'copies the families it follows',
  accepts: 'accepts a command and replies',
  refuses: 'refuses a command with the shared error body',
  outbox: 'keeps the outcome in its outbox and sends it again after a restart',
} as const;

const DEFAULT_TIMEOUT_MS = 5000;
const flush = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

/** Rejects when `work` has not settled within `timeoutMs`. */
async function within<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error(`${what} did not finish within ${timeoutMs} ms`)); }, timeoutMs); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Polls until `find` returns something, or fails after `timeoutMs`. */
async function waitFor<T>(find: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (performance.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise(resolve => { setTimeout(resolve, 5); });
  }
}

/** One check's world: a bus, a state directory, the kit's own participants and the module in a harness. */
class World {
  readonly bus: InProcessBus;
  /** Every message published on the bus, in order. */
  readonly seen: Message[] = [];
  /** The sync requests the stand-in owner served. */
  readonly syncRequests: Message[] = [];
  readonly #invalid: string[] = [];
  readonly #errors: unknown[] = [];
  readonly #validator = new MessageValidator();
  readonly #spec: ConformanceSpec;
  readonly #dir: string;
  readonly #kit: Participant[] = [];
  /** Every instance of the module this world hosted, the current one last. */
  readonly #hosted: ModuleHarness[] = [];
  readonly timeoutMs: number;
  /** The kit's own participant, which sends requests and syncs. */
  readonly probe: Participant;
  harness: ModuleHarness;

  private constructor(spec: ConformanceSpec, dir: string) {
    this.#spec = spec;
    this.#dir = dir;
    this.timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    registerCoreFamilies(this.#validator);
    for (const [dataschema, schema] of Object.entries({...standInAckSchemas, ...spec.schemas})) this.#validator.register(dataschema, schema);
    this.bus = new InProcessBus({onError: (error, {source}) => { if (source === this.harness.source) this.#errors.push(error); }});
    this.probe = this.#connect('bunny/kit');
    this.harness = this.fresh();
  }

  static async open(spec: ConformanceSpec): Promise<World> {
    const world = new World(spec, await mkdtemp(join(tmpdir(), 'bunny-kit-')));
    const watcher = world.#connect('bunny/kit-watch');
    await watcher.subscribe('bunny.*.*.*', message => {
      world.check(message, 'a published message');
      world.seen.push(message);
    });
    const {copies} = spec;
    if (copies !== undefined) {
      await world.#connect('bunny/core').serveSync(copies.families, request => {
        world.check(request, 'a sync request');
        world.syncRequests.push(request);
        return copies.snapshot;
      });
    }
    return world;
  }

  /** A new instance of the module on this world's bus and state directory. */
  fresh(): ModuleHarness {
    const harness = new ModuleHarness(this.#spec.create(), {bus: this.bus, stateDir: this.#dir, stopTimeoutMs: this.timeoutMs});
    this.#hosted.push(harness);
    return harness;
  }

  check(message: unknown, where: string): void {
    const result = this.#validator.validate(message);
    if (!result.ok) this.#invalid.push(`${where}: ${result.error.code} ${result.error.detail ?? ''}`);
  }

  async start(): Promise<void> {
    await within(this.harness.start(), this.timeoutMs, 'the module\'s start');
  }

  request(command: {key: string; draft: CommandDraft<object>}): Promise<RequestResult> {
    return this.probe.request(command.key, command.draft, {timeoutMs: this.timeoutMs});
  }

  /**
   * Every message the world saw followed profile 2.0, every record the module logged is one the runtime writes whole as a
   * diagnostic-contract record, and no handler, timer or worker of the module failed.
   */
  async verify(): Promise<void> {
    await flush();
    assert.deepEqual(this.#invalid, [], 'every message follows profile 2.0');
    const unwritten = this.#hosted.flatMap(harness => harness.logs.map(entry => checkModuleRecord(harness.name, entry)))
      .filter(problem => problem !== undefined);
    assert.deepEqual(unwritten, [], 'every log record is a registered module record');
    assert.deepEqual([...this.#errors, ...this.#hosted.flatMap(harness => harness.failures)], [], 'no handler, timer or worker of the module failed');
  }

  async close(): Promise<void> {
    await Promise.all(this.#hosted.map(harness => harness.stop()));
    await Promise.all(this.#kit.map(participant => participant.close()));
    await rm(this.#dir, {recursive: true, force: true});
  }

  #connect(source: string): Participant {
    const participant = this.bus.connect(source);
    this.#kit.push(participant);
    return participant;
  }
}

/** Runs `body` in a fresh world, verifies what it saw, and always cleans up. */
async function inWorld(spec: ConformanceSpec, body: (world: World) => Promise<void>): Promise<void> {
  const world = await World.open(spec);
  try {
    await body(world);
    await world.verify();
  } finally {
    await world.close();
  }
}

type Command = {key: string; draft: CommandDraft<object>};

const manifest = (spec: ConformanceSpec): Promise<void> => {
  const problem = checkManifest(spec.create().manifest);
  assert.equal(problem, undefined, problem?.detail);
  return Promise.resolve();
};

const lifecycle = (spec: ConformanceSpec): Promise<void> => inWorld(spec, async world => {
  await world.start();
  await world.harness.stop();
  if (spec.accepted !== undefined) {
    const request = await world.request(spec.accepted);
    assert.equal(request.status === 'rejected' && request.error.error.code, 'unavailable', 'no responder is left');
  }
  if (spec.serves !== undefined) {
    const sync = await world.probe.sync(spec.serves, () => {}, {timeoutMs: world.timeoutMs});
    assert.equal(sync.status === 'rejected' && sync.error.error.code, 'unavailable', 'no sync owner is left');
  }
  assert.equal(world.harness.pendingTimers(), 0, 'no timer is left');
  assert.equal(world.harness.runningWorkers(), 0, 'no worker is left');
  assert.equal(world.harness.databaseOpen(), false, 'the database is closed');
});

const serves = (spec: ConformanceSpec, families: readonly string[]): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.probe.sync(families, () => {}, {timeoutMs: world.timeoutMs});
  assert.equal(result.status, 'synced', 'the module serves a sync of its families');
  if (result.status !== 'synced') return;
  world.check(result.message, 'sync.completed');
  for (const state of result.copy.states()) {
    world.check(state, 'a synced state');
    assert.equal(state.source, world.harness.source);
    assert.ok(families.includes(schemaFamily(state.dataschema) ?? ''), `${state.dataschema} is a served family`);
  }
  await result.copy.close();
});

const copies = (spec: ConformanceSpec, families: readonly string[]): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const asked = world.syncRequests.filter(request => request.source === world.harness.source);
  assert.ok(asked.length > 0, 'the module syncs the families it copies when it starts');
  for (const request of asked) {
    const requested = (request.data as {families?: unknown}).families;
    assert.ok(Array.isArray(requested) && requested.every(family => families.includes(String(family))), 'it asks only for the families it copies');
  }
});

const accepts = (spec: ConformanceSpec, command: Command): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.request(command);
  assert.equal(result.status, 'accepted');
  if (result.status === 'accepted') world.check(result.reply, 'the reply');
});

const refuses = (spec: ConformanceSpec, command: Command & {code: string}): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.request(command);
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.ok(result.reply, 'the module itself refused it, in a reply');
  world.check(result.reply, 'the reply');
  assert.equal(result.error.error.code, command.code);
});

const outbox = (spec: ConformanceSpec, command: Command): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.request(command);
  assert.equal(result.status, 'accepted');
  const source = world.harness.source;
  const isOutcome = (message: Message): boolean =>
    message.source === source && message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === result.requestId;
  const outcome = await waitFor(() => world.seen.find(isOutcome), world.timeoutMs, 'the outcome');
  // The kit's stand-in core never acknowledges it, so a restart sends it again, unchanged: a consumer that missed it
  // still gets it, and one that has it drops the duplicate by (source, id). A module that publishes the outcome
  // outside its outbox never sends it again.
  await world.harness.stop();
  world.harness = world.fresh();
  await world.start();
  const sent = await waitFor(() => {
    const copies = world.seen.filter(message => message.source === source && message.id === outcome.id);
    return copies.length > 1 ? copies : undefined;
  }, world.timeoutMs, 'the outcome again after the restart');
  for (const copy of sent.slice(1)) assert.equal(compareDelivery(outcome, copy), 'duplicate', 'the resent outcome is the stored one');
});

/** The conformance checks that apply to one module, in the order of `CHECKS`, to run under any test runner. */
export function conformanceChecks(spec: ConformanceSpec): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [
    {name: CHECKS.manifest, run: () => manifest(spec)},
    {name: CHECKS.lifecycle, run: () => lifecycle(spec)},
  ];
  const {serves: served, copies: copied, accepted, refused} = spec;
  if (served !== undefined) checks.push({name: CHECKS.serves, run: () => serves(spec, served)});
  if (copied !== undefined) checks.push({name: CHECKS.copies, run: () => copies(spec, copied.families)});
  if (accepted !== undefined) checks.push({name: CHECKS.accepts, run: () => accepts(spec, accepted)});
  if (refused !== undefined) checks.push({name: CHECKS.refuses, run: () => refuses(spec, refused)});
  if (accepted !== undefined) checks.push({name: CHECKS.outbox, run: () => outbox(spec, accepted)});
  return checks;
}

/** Registers the conformance checks as a node:test suite named for the module. Only this loads node:test. */
export function moduleConformance(spec: ConformanceSpec): void {
  const {describe, test} = process.getBuiltinModule('node:test');
  void describe(`module ${spec.create().manifest.name} conformance`, () => {
    for (const check of conformanceChecks(spec)) void test(check.name, {timeout: 60_000}, () => check.run());
  });
}
