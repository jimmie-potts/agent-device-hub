// The module test kit (Hub #882): one conformance suite that every module runs in a few lines, so all modules behave
// the same under ADR 0012. Each check hosts a fresh instance of the module on its own bus and state directory, with a
// stand-in owner for the families it copies, and checks every message it sees against profile 2.0. Only
// `moduleConformance` loads node:test, so another runner, such as Vitest, can run `conformanceChecks` itself.
//
// Several modules serve one family, such as `device`, each for its own devices (Hub #967), so the kit syncs a module's
// families from the module by name, and its stand-in owner can serve under the owner a module names.
//
// Under ADR 0012's failure isolation (policy A), a device's errors and timeouts are not module failures: a module turns
// them into outcomes and an `unavailable` device state. Only an error that escapes the module, from its start, a
// handler, a responder, a timer or a worker, stops it, so the kit fails a module whose handler, timer or worker fails.
//
// The kit also checks the baseline records and spans (Hub #949): the bus's records of the accepted and refused commands,
// with the command's trace; their request, queue and execute spans and their parents; and the outcome's publication,
// recorded once, with its replay linked to the stored context. No span may lose its parent.
//
// A module opens only local resources in start and reaches its device later, so the kit also starts a module whose
// device never answers and fails it when that start does not finish, or when it never reports the device unavailable.
// No message, command, sync request, record, span, reply or synced state may carry one of the module's secrets (Hub #919).
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MessageValidator, compareDelivery, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {Diagnostic} from '../diagnostics.js';
import {InProcessBus} from '../in-process.js';
import {checkConfiguration, checkManifest, type BunnyModule} from '../module.js';
import type {CommandDraft, Participant, RequestResult, TraceContext} from '../sdk.js';
import {schemaFamily, type Snapshot} from '../sync.js';
import {traceFields} from '../trace.js';
import {standInAckSchemas} from './acknowledge.js';
import {ModuleHarness} from './harness.js';
import {checkModuleRecord} from './records.js';
import {RecordedSpans, lostParents, type RecordedSpan} from './spans.js';

export type ConformanceSpec = {
  /** A fresh instance of the module. The kit calls it again to restart the module on the same database. */
  create: () => BunnyModule;
  /** The payload schemas of the module's own families, by `dataschema`. The core families are registered already. */
  schemas?: Readonly<Record<string, object>>;
  /** The families the module serves with `serveSync`, if any. */
  serves?: readonly string[];
  /**
   * The families the module copies with `sync` at start, and the snapshot the kit's stand-in owner serves. The stand-in
   * is `bunny/core` unless `owner` names the source the module syncs them from, such as `bunny/modules/lifx` for a
   * module that copies one device module's `device` records.
   */
  copies?: {families: readonly string[]; snapshot: Snapshot; owner?: string};
  /** A command the module accepts, if it answers any. It must report the command's outcome through its outbox. */
  accepted?: {key: string; draft: CommandDraft<object>};
  /** A command the module refuses, and the registry code it refuses it with, if it answers any. */
  refused?: {key: string; draft: CommandDraft<object>; code: ErrorCode};
  /**
   * The module's section of the runtime's configuration file, as the runtime would read it, for a module that takes one.
   * The manifest check fails when the runtime would refuse it.
   */
  config?: unknown;
  /** The synthetic text of each secret file the section names, by name. No message, record or reply may carry one. */
  secrets?: Readonly<Record<string, string>>;
  /**
   * Policy A (ADR 0012, "Failure isolation"), for a module that reaches a device: a fresh instance whose simulated
   * device never answers, with the same section and secrets, and how to recognize the state message by which the module
   * reports that device `unavailable`. Its start must finish within `startWithinMs`, 1000 by default, because start opens
   * only local resources and the module reaches its device later.
   */
  offline?: {create: () => BunnyModule; unavailable: (message: Message) => boolean; startWithinMs?: number};
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
  offline: 'starts while its device never answers, and reports it unavailable',
  serves: 'serves its families through sync',
  copies: 'copies the families it follows',
  accepts: 'accepts a command and replies',
  refuses: 'refuses a command with the shared error body',
  outbox: 'keeps the outcome in its outbox and sends it again after a restart',
} as const;

const DEFAULT_TIMEOUT_MS = 5000;
/** How long a module's start may take while its device never answers: long enough for local resources only. */
const OFFLINE_START_MS = 1000;
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
  /** What the bus reported to `onDiagnostic`, in order. */
  readonly diagnostics: Diagnostic[] = [];
  /** The bus's spans and the hosted module's. */
  readonly spans = new RecordedSpans();
  /** The trace contexts of the replies the kit's requests got. */
  readonly #replies: TraceContext[] = [];
  /** What the kit's own participant got back: request results with their replies, and synced states. */
  readonly answers: unknown[] = [];
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
    this.bus = new InProcessBus({
      onError: (error, {source}) => { if (source === this.harness.source) this.#errors.push(error); },
      onDiagnostic: diagnostic => { this.diagnostics.push(diagnostic); }, spans: this.spans,
    });
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
      await world.#connect(copies.owner ?? 'bunny/core').serveSync(copies.families, request => {
        world.check(request, 'a sync request');
        world.syncRequests.push(request);
        return copies.snapshot;
      });
    }
    return world;
  }

  /** A new instance of the module, from `create`, on this world's bus and state directory, with the spec's section and secrets. */
  fresh(create: () => BunnyModule = this.#spec.create): ModuleHarness {
    const {config, secrets} = this.#spec;
    const harness = new ModuleHarness(create(), {
      bus: this.bus, stateDir: this.#dir, stopTimeoutMs: this.timeoutMs, spans: this.spans,
      ...(config === undefined ? {} : {section: config}), ...(secrets === undefined ? {} : {secrets}),
    });
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

  async request(command: {key: string; draft: CommandDraft<object>}): Promise<RequestResult> {
    const result = await this.probe.request(command.key, command.draft, {timeoutMs: this.timeoutMs});
    if (result.status !== 'uncertain' && result.reply !== undefined) this.#replies.push({traceparent: result.reply.traceparent});
    this.answers.push(result);
    return result;
  }

  /** The bus's records about one request, as `<event> <level> <outcome> [<code>]`. */
  decisions(requestId: string): string[] {
    return this.diagnostics.filter(record => record.requestId === requestId)
      .map(record => [record.event, record.level, record.outcome, record.code].filter(part => part !== undefined).join(' '));
  }

  /**
   * The request's span, with its queue and execute spans, after checking that every record about the request carries the
   * command's trace, that the queue and execute spans are children of the request span, and that each one ended without
   * an error: an accepted command and a typed refusal are no failures.
   */
  commandSpans(requestId: string): {request: RecordedSpan; queue: RecordedSpan; execute: RecordedSpan} {
    const [request, ...others] = this.spans.named('bunny.command.request').filter(span => span.attributes['bunny.request.id'] === requestId);
    assert.ok(request !== undefined && others.length === 0, 'the bus recorded one request span for the command');
    for (const record of this.diagnostics.filter(entry => entry.requestId === requestId)) {
      const ids = record.trace === undefined ? undefined : traceFields(record.trace);
      assert.deepEqual([ids?.traceId, ids?.spanId], [request.traceId, request.spanId], `${record.event} carries the command's trace`);
    }
    const child = (name: RecordedSpan['name']): RecordedSpan => {
      const found = this.spans.named(name).filter(span => span.traceId === request.traceId && span.parentSpanId === request.spanId);
      assert.equal(found.length, 1, `one ${name} span, the request span's child`);
      return found[0] as RecordedSpan;
    };
    const queue = child('bunny.command.queue'), execute = child('bunny.command.execute');
    for (const span of [request, queue, execute]) {
      assert.ok(span.endedAtMs !== undefined, `${span.name} ended`);
      assert.equal(span.status, 'unset', `${span.name}'s status`);
    }
    return {request, queue, execute};
  }

  /** The `outcome.published` records of every instance of the module this world hosted, for one request. */
  publications(requestId: string): ModuleHarness['logs'] {
    return this.#hosted.flatMap(harness => harness.logs).filter(entry => entry.event === 'outcome.published' && entry.fields['bunny.request.id'] === requestId);
  }

  /**
   * Every message the world saw followed profile 2.0, every record the module logged is one the runtime writes whole as a
   * diagnostic-contract record, no span lost its parent, no message, record or answer carries one of the module's
   * secrets, and no handler, timer or worker of the module failed.
   */
  async verify(): Promise<void> {
    await flush();
    assert.deepEqual(this.#invalid, [], 'every message follows profile 2.0');
    const contexts = [...this.seen, ...this.syncRequests, ...this.#replies, ...this.#hosted.flatMap(harness => harness.received)];
    const lost = lostParents(this.spans.spans, contexts).map(span => span.name);
    assert.deepEqual(lost, [], 'every span\'s parent is a recorded span or a message\'s own span');
    const unwritten = this.#hosted.flatMap(harness => harness.logs.map(entry => checkModuleRecord(harness.name, entry)))
      .filter(problem => problem !== undefined);
    assert.deepEqual(unwritten, [], 'every log record is a registered module record');
    assert.deepEqual(this.#leaks(), [], 'no message, log record or answer carries a secret the module read');
    assert.deepEqual([...this.#errors, ...this.#hosted.flatMap(harness => harness.failures)], [], 'no handler, timer or worker of the module failed');
  }

  /** Where one of the spec's secrets appears, named by kind and never quoted. */
  #leaks(): string[] {
    const secrets = Object.values(this.#spec.secrets ?? {}).map(text => text.replace(/[\r\n]+$/, '')).filter(text => text !== '');
    if (secrets.length === 0) return [];
    const carries = (value: unknown): boolean => {
      const text = JSON.stringify(value);
      return secrets.some(secret => text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)));
    };
    const places: [string, readonly unknown[]][] = [
      ['a published message', this.seen], ['a sync request', this.syncRequests], ['an answer the kit got', this.answers],
      ['a command or sync the module sent', this.#hosted.flatMap(harness => harness.sent)], ['a log record', this.#hosted.flatMap(harness => harness.logs)],
      ['a span', this.spans.spans],
    ];
    return places.filter(([, values]) => values.some(carries)).map(([place]) => `${place} carries a secret`);
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
  const declared = spec.create().manifest;
  const problem = checkManifest(declared);
  assert.equal(problem, undefined, problem?.detail);
  const configured = checkConfiguration(declared, spec.config);
  assert.equal(configured.status, 'accepted', configured.status === 'refused' ? `the runtime would refuse its section: ${configured.problem.detail}` : '');
  return Promise.resolve();
};

/** Policy A: started while its device never answers, the module still starts at once and reports the device unavailable. */
const offline = (spec: ConformanceSpec, given: NonNullable<ConformanceSpec['offline']>): Promise<void> => inWorld(spec, async world => {
  world.harness = world.fresh(given.create);
  const limit = given.startWithinMs ?? OFFLINE_START_MS;
  await within(world.harness.start(), limit, 'while its device never answers, the module\'s start, which under policy A opens only local resources,');
  const source = world.harness.source;
  await waitFor(() => world.seen.find(message => message.source === source && message.kind === 'state' && given.unavailable(message)), world.timeoutMs,
    'a state that reports the device unavailable');
});

const lifecycle = (spec: ConformanceSpec): Promise<void> => inWorld(spec, async world => {
  await world.start();
  await world.harness.stop();
  if (spec.accepted !== undefined) {
    const request = await world.request(spec.accepted);
    assert.equal(request.status === 'rejected' && request.error.error.code, 'unavailable', 'no responder is left');
  }
  if (spec.serves !== undefined) {
    const sync = await world.probe.sync(spec.serves, () => {}, {timeoutMs: world.timeoutMs, owner: world.harness.source});
    assert.equal(sync.status === 'rejected' && sync.error.error.code, 'unavailable', 'no sync owner is left');
  }
  assert.equal(world.harness.pendingTimers(), 0, 'no timer is left');
  assert.equal(world.harness.runningWorkers(), 0, 'no worker is left');
  assert.equal(world.harness.databaseOpen(), false, 'the database is closed');
});

const serves = (spec: ConformanceSpec, families: readonly string[]): Promise<void> => inWorld(spec, async world => {
  await world.start();
  // By name, as a consumer of a family that several modules serve, such as `device`, syncs each of them.
  const result = await world.probe.sync(families, () => {}, {timeoutMs: world.timeoutMs, owner: world.harness.source});
  assert.equal(result.status, 'synced', 'the module serves a sync of its families');
  if (result.status !== 'synced') return;
  world.check(result.message, 'sync.completed');
  for (const state of result.copy.states()) {
    world.check(state, 'a synced state');
    world.answers.push(state);
    assert.equal(state.source, world.harness.source);
    assert.ok(families.includes(schemaFamily(state.dataschema) ?? ''), `${state.dataschema} is a served family`);
  }
  await result.copy.close();
});

const copies = (spec: ConformanceSpec, {families, owner}: NonNullable<ConformanceSpec['copies']>): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const asked = world.syncRequests.filter(request => request.source === world.harness.source);
  assert.ok(asked.length > 0, 'the module syncs the families it copies when it starts');
  for (const request of asked) {
    const requested = (request.data as {families?: unknown}).families;
    assert.ok(Array.isArray(requested) && requested.every(family => families.includes(String(family))), 'it asks only for the families it copies');
  }
  // Here the stand-in is their only owner, but in the runtime other owners may serve them too, and a sync that names
  // none is then refused.
  if (owner !== undefined) {
    const unnamed = world.harness.sent.filter(sent => sent.call === 'sync' && sent.families.some(family => families.includes(family)) && sent.owner !== owner);
    assert.deepEqual(unnamed, [], `it syncs them from ${owner} by name`);
  }
});

const accepts = (spec: ConformanceSpec, command: Command): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.request(command);
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  world.check(result.reply, 'the reply');
  await flush();
  assert.deepEqual(world.decisions(result.requestId), ['command.admitted info queued', 'command.replied info accepted'], 'the bus\'s records');
  const {execute} = world.commandSpans(result.requestId);
  assert.equal(traceFields(result.reply)?.spanId, execute.spanId, 'the reply carries the execute span\'s context');
});

const refuses = (spec: ConformanceSpec, command: Command & {code: string}): Promise<void> => inWorld(spec, async world => {
  await world.start();
  const result = await world.request(command);
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.ok(result.reply, 'the module itself refused it, in a reply');
  world.check(result.reply, 'the reply');
  assert.equal(result.error.error.code, command.code);
  await flush();
  assert.deepEqual(world.decisions(result.requestId), ['command.admitted info queued', `command.replied info rejected ${command.code}`], 'the bus\'s records');
  world.commandSpans(result.requestId);
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
  // Its publication is recorded once, in its own trace, and the replay is linked to the stored context, never its child.
  await flush();
  const records = world.publications(result.requestId);
  assert.equal(records.length, 1, 'the outcome\'s first publication is recorded once: pass the module\'s log and trace to its Outbox');
  const stored = traceFields(outcome);
  assert.equal(records[0]?.trace === undefined ? undefined : traceFields(records[0].trace)?.traceId, stored?.traceId, 'in the outcome\'s own trace');
  const publishes = world.spans.named('bunny.outcome.publish').filter(span => span.attributes['bunny.message.id'] === outcome.id);
  assert.equal(publishes.length, 2, 'a publish span for the first publication and for the replay');
  const [first, replay] = publishes;
  assert.equal(first?.parentSpanId, stored?.spanId, 'the first publication continues the stored context');
  assert.equal(replay?.parentSpanId, undefined, 'the replay is never reparented');
  assert.deepEqual(replay?.links, [{traceId: stored?.traceId, spanId: stored?.spanId}], 'the replay links to the stored context');
});

/** The conformance checks that apply to one module, in the order of `CHECKS`, to run under any test runner. */
export function conformanceChecks(spec: ConformanceSpec): ConformanceCheck[] {
  const checks: ConformanceCheck[] = [
    {name: CHECKS.manifest, run: () => manifest(spec)},
    {name: CHECKS.lifecycle, run: () => lifecycle(spec)},
  ];
  const {serves: served, copies: copied, accepted, refused, offline: unreachable} = spec;
  if (unreachable !== undefined) checks.push({name: CHECKS.offline, run: () => offline(spec, unreachable)});
  if (served !== undefined) checks.push({name: CHECKS.serves, run: () => serves(spec, served)});
  if (copied !== undefined) checks.push({name: CHECKS.copies, run: () => copies(spec, copied)});
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
