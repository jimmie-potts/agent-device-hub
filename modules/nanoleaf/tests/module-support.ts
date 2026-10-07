// The Nanoleaf module's test world (Hub #844): the module hosted as the runtime would (the SDK kit's `ModuleHarness`) on
// its own in-process bus, a manual clock and scheduler that drive the bus, the module and its worker, a stand-in core
// that serves `session/2.0` through sync and takes notice acknowledgments, a simulated Lines controller, and parts that
// send commands and keep what was published. Every message the world sees is checked against profile 2.0, with the core
// and device families and the module's own registered. Nothing reaches a device, a port or personal state.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, mkdirSync, mkdtempSync, openSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync, constants} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, sessionEntityId, type Identity, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type CommandDraft, type Participant, type RequestResult, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness, type HarnessRecord, type RecordedSpans} from '@jimmie-potts/sdk/testing';
import {createNanoleafModule, LINES_ADDRESS, lockFile, nanoleafSchemas, SimulatedNanoleaf, SYNTHETIC_TOKEN, type SimulatedKind} from '../src/index.js';

export const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
/**
 * The families a reader syncs from the module, and the owner it names: `device` is a shared family, which every device
 * module serves for its own devices, so a reader syncs it from `bunny/modules/nanoleaf` by name (Hub #967).
 */
export const READ_FAMILIES = ['device', 'nanoleaf-wall', 'nanoleaf-animations'] as const;
export const NANOLEAF_OWNER = 'bunny/modules/nanoleaf';
/** The qualified source every scripted session comes from, and one the section does not qualify. */
export const QUALIFIED = {provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'source'} as const;
export const UNQUALIFIED = {provider: 'claude', client: 'code', hostId: 'host', sourceId: 'other'} as const;
/** The synthetic section the runtime would read from its configuration file. */
export const SECTION = {
  devices: [{id: 'wall', kind: 'lines', address: LINES_ADDRESS, secret: 'token'}], qualifiedSources: [QUALIFIED],
  secrets: {token: '/nowhere/nanoleaf-token'},
} as const;
// An instant off any round second, as a real clock's is, so the worker's waits come to fractions of a millisecond.
export const START_MS = Date.parse('2026-10-07T12:00:00.137Z');
// Virtual time moves in steps that do not divide the worker's waits, so a timer fires a little late, as a real one does.
const STEP_MS = 7;

/** A clock and scheduler moved only by the test. */
export class TestClock {
  ms = START_MS;
  readonly #timers = new Set<{at: number; callback: () => void}>();
  readonly now = (): number => this.ms;
  /** As the runtime's module scheduler, it takes whole milliseconds only. */
  readonly scheduler: Scheduler = {after: (delayMs, callback) => {
    if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new RangeError('delayMs must be an integer from 0');
    const timer = {at: this.ms + delayMs, callback};
    this.#timers.add(timer);
    return () => { this.#timers.delete(timer); };
  }};

  /** When each pending timer is due, so a test can act just after a long wait began. */
  dueTimes(): number[] {
    return [...this.#timers].map(timer => timer.at);
  }

  advance(ms: number): void {
    this.ms += ms;
    for (const timer of [...this.#timers].sort((a, b) => a.at - b.at)) {
      if (timer.at > this.ms) break;
      if (this.#timers.delete(timer)) timer.callback();
    }
  }
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
};

export type SessionOptions = {
  identity?: Identity; activity?: SessionRecord['activity']; turn?: string; attention?: SessionRecord['attention'];
  notices?: SessionRecord['notices']; read?: SessionRecord['read']; title?: string; generation?: number;
};

/** A notice ID as the owner gives one: a SHA-256 hash. */
export const noticeId = (name: string): string => createHash('sha256').update(name).digest('hex');

/**
 * The stand-in core: it serves `session/2.0` through sync, publishes each change at a new revision, and takes the
 * module's notice acknowledgments, keeping each request it got.
 */
export class StandInCore {
  readonly sessions = new Map<string, SessionRecord>();
  readonly acknowledgments: Message[] = [];
  revision = 1;
  /** While set, the core takes each acknowledgment and answers none until `releaseAcknowledgments`. */
  holdAcknowledgments = false;
  readonly #held: (() => void)[] = [];
  #participant: Participant | undefined;

  constructor(readonly clock: TestClock) {}

  async attach(bus: InProcessBus): Promise<void> {
    const core = bus.connect('bunny/core');
    this.#participant = core;
    await core.serveSync(['session'], () => ({revision: this.revision, states: [...this.sessions.values()].map(record => this.#draft(record))}));
    await core.respond('bunny.cmd.notice-acknowledge.*', async command => {
      this.acknowledgments.push(command);
      if (this.holdAcknowledgments) await new Promise<void>(resolve => { this.#held.push(resolve); });
      return {status: 'accepted'};
    });
  }

  /** Answers every acknowledgment the core holds, and later ones at once. */
  releaseAcknowledgments(): void {
    this.holdAcknowledgments = false;
    for (const release of this.#held.splice(0)) release();
  }

  /**
   * Publishes every named session's working record at once, then `last`'s finished turn, without waiting between them,
   * as a burst a slow subscriber cannot keep up with.
   */
  async burst(names: readonly string[], last: string): Promise<void> {
    await Promise.all([...names.map(name => this.set(name)), this.finish(last)]);
  }

  /** Publishes a session's record at the next revision. */
  async set(name: string, options: SessionOptions = {}): Promise<SessionRecord> {
    const identity = options.identity ?? {...QUALIFIED, sessionId: name};
    const id = sessionEntityId(identity);
    this.revision += 1;
    const turn = options.turn ?? 't1';
    const record: SessionRecord = {
      id, revision: this.revision, generation: options.generation ?? 0, identity, parent: {status: 'top-level'}, turn: {status: 'known', id: turn},
      activity: options.activity ?? 'active', attention: options.attention ?? [], notices: options.notices ?? [], read: options.read ?? 'unknown',
      unavailable: [], ordering: {status: 'unknown'}, observedAtMs: this.clock.now(), lastEvidenceAtMs: this.clock.now(), freshness: 'current',
      restartUncertain: false, children: {active: 0, uncertain: 0}, ...(options.title === undefined ? {} : {title: {value: options.title, source: 'provider'}}),
    };
    this.sessions.set(id, record);
    await this.#participant?.publish(`bunny.state.session.${id}`, {kind: 'state', ...this.#draft(record)});
    return record;
  }

  /** A finished turn: idle with one unread notice. */
  finish(name: string, turn = 't1', identity?: Identity): Promise<SessionRecord> {
    // Only Codex Desktop reports read evidence.
    const desktop = (identity ?? QUALIFIED).client === 'desktop';
    return this.set(name, {activity: 'idle', turn, read: desktop ? 'unread' : 'unknown', notices: [{id: noticeId(`${name}:${turn}`), kind: 'turn-ended', turn: {status: 'known', id: turn},
      acknowledgedBy: []}], ...(identity === undefined ? {} : {identity})});
  }

  async remove(name: string): Promise<void> {
    const id = sessionEntityId({...QUALIFIED, sessionId: name});
    this.sessions.delete(id);
    this.revision += 1;
    await this.#participant?.publish(`bunny.state.session.${id}`, {kind: 'removal', type: 'org.bunny.session.removed', subject: id,
      dataschema: 'https://bunny.invalid/events/removal/2.0', data: {entity: {family: 'session', id}, revision: this.revision, reason: 'retired'}});
  }

  /** The core goes away: it serves no sync and takes no acknowledgment until the world ends. */
  async close(): Promise<void> {
    this.releaseAcknowledgments();
    const participant = this.#participant;
    this.#participant = undefined;
    await participant?.close();
  }

  #draft(record: SessionRecord): {type: string; subject: string; dataschema: string; data: SessionRecord} {
    return {type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record};
  }
}

export type WorldOptions = {
  online?: boolean; section?: unknown; stateDir?: string; devices?: Readonly<Record<string, SimulatedKind>>;
  /** How many messages may wait in one subscription's queue on the world's bus; a fuller one drops, as a slow subscriber's does. */
  maxQueued?: number;
  /** Records the module's spans. */
  spans?: RecordedSpans;
};

/** One module world. `restart` stops the module and starts a new instance on the same state directory and device. */
export class ModuleWorld {
  readonly clock = new TestClock();
  readonly bus: InProcessBus;
  readonly core: StandInCore;
  readonly device: SimulatedNanoleaf;
  readonly stateDir: string;
  /** Every message published on the bus, in order. */
  readonly seen: Message[] = [];
  readonly invalid: string[] = [];
  readonly errors: unknown[] = [];
  /** The sources whose sync copy an overflow restarted, once per restart. */
  readonly syncRestarts: string[] = [];
  readonly harnesses: ModuleHarness[] = [];
  harness: ModuleHarness;
  operator!: Participant;
  readonly #validator = new MessageValidator();
  #section: unknown;
  #watcher: Participant | undefined;
  readonly #spans: RecordedSpans | undefined;
  readonly #locks: DatabaseSync[] = [];

  private constructor(options: WorldOptions) {
    this.stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), 'nanoleaf-module-'));
    this.device = new SimulatedNanoleaf({online: options.online ?? true, now: () => this.clock.now(), ...(options.devices === undefined ? {} : {devices: options.devices})});
    this.#section = options.section ?? SECTION;
    this.#spans = options.spans;
    registerCoreFamilies(this.#validator);
    registerDeviceFamilies(this.#validator);
    for (const [dataschema, schema] of Object.entries(nanoleafSchemas)) this.#validator.register(dataschema, schema);
    this.bus = new InProcessBus({now: this.clock.now, scheduler: this.clock.scheduler, onError: error => { this.errors.push(error); },
      onSyncRestart: scope => { this.syncRestarts.push(scope.source); }, ...(options.maxQueued === undefined ? {} : {maxQueued: options.maxQueued})});
    this.core = new StandInCore(this.clock);
    this.harness = this.#fresh();
  }

  static async open(context: TestContext, options: WorldOptions = {}): Promise<ModuleWorld> {
    const world = new ModuleWorld(options);
    context.after(() => world.close());
    await world.core.attach(world.bus);
    const watcher = world.bus.connect('bunny/test/watcher');
    world.#watcher = watcher;
    await watcher.subscribe('bunny.*.*.*', message => {
      const checked = world.#validator.validate(message);
      if (!checked.ok) world.invalid.push(`${message.type}: ${checked.error.code} ${checked.error.detail ?? ''}`);
      world.seen.push(message);
    });
    world.operator = world.bus.connect('bunny/parts/operator');
    return world;
  }

  #fresh(): ModuleHarness {
    const harness = new ModuleHarness(createNanoleafModule({transport: this.device.request}), {
      bus: this.bus, stateDir: this.stateDir, clock: {now: this.clock.now}, scheduler: this.clock.scheduler, section: this.#section,
      secrets: {token: SYNTHETIC_TOKEN}, ...(this.#spans === undefined ? {} : {spans: this.#spans}),
    });
    this.harnesses.push(harness);
    return harness;
  }

  async start(): Promise<void> {
    await this.harness.start();
    await this.advance(0);
  }

  /**
   * Stops the module and starts a new instance on the same store, folder and device, as a runtime restart does, with a
   * new section of the configuration file when one is given.
   */
  async restart(section?: unknown): Promise<void> {
    await this.stopModule();
    if (section !== undefined) this.#section = section;
    this.harness = this.#fresh();
    await this.start();
  }

  async stopModule(): Promise<void> {
    const stopping = this.harness.stop();
    // The participant's close waits for running handlers, whose timers this clock runs.
    for (let turn = 0; turn < 200; turn += 1) {
      const done = await Promise.race([stopping.then(() => true), settle().then(() => false)]);
      if (done) return;
      this.clock.advance(STEP_MS);
    }
    await stopping;
  }

  /** Lets `ms` of virtual time pass, in steps, letting the module's async work run between them. */
  async advance(ms: number): Promise<void> {
    await settle();
    for (let passed = 0; passed < ms; passed += STEP_MS) {
      this.clock.advance(Math.min(STEP_MS, ms - passed));
      await settle();
    }
  }

  /** Advances until `check` holds, or fails after `withinMs` of virtual time. */
  async until(check: () => boolean, withinMs: number, what: string): Promise<void> {
    for (let passed = 0; ; passed += STEP_MS) {
      if (check()) return;
      if (passed >= withinMs) assert.fail(`within ${withinMs} ms: ${what}`);
      await this.advance(STEP_MS);
    }
  }

  /** Sends a command as the operator and returns its result once the module answers. */
  async request(key: string, draft: CommandDraft<object>, timeoutMs = 30_000): Promise<RequestResult> {
    // The SDK sets the payload's `requestId`; a test names it through the request's options.
    const {requestId} = draft.data as {requestId?: unknown};
    const result = this.operator.request(key, draft, {timeoutMs, ...(typeof requestId === 'string' ? {requestId} : {})});
    let answered: RequestResult | undefined;
    void result.then(value => { answered = value; });
    await this.until(() => answered !== undefined, timeoutMs, `the answer to ${key}`);
    return answered as RequestResult;
  }

  /** The newest published state of one entity of the module's. */
  state<T>(family: string, id: string): T | undefined {
    const message = [...this.seen].reverse().find(item => item.kind === 'state' && item.source === 'bunny/modules/nanoleaf'
      && item.dataschema === `https://bunny.invalid/events/${family}/2.0` && (item.data as {id?: unknown}).id === id);
    return message?.data as T | undefined;
  }

  device_(): DeviceRecord | undefined {
    return this.state<DeviceRecord>('device', 'wall');
  }

  wall(): WallState | undefined {
    return this.state<WallState>('nanoleaf-wall', 'wall');
  }

  /** The outcomes the module published for one request. */
  outcomes(requestId: string): Message<{requestId: string; result: string; evidence: string; error?: {code: string}}>[] {
    return this.seen.filter(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId) as
      Message<{requestId: string; result: string; evidence: string; error?: {code: string}}>[];
  }

  /** Every record the module logged, from every instance. */
  logs(): HarnessRecord[] {
    return this.harnesses.flatMap(harness => harness.logs);
  }

  /** The Lines controller's recent writes. */
  writes(): {endpoint: string; atMs: number; animType?: string; loop?: boolean; on?: boolean; brightness?: number; select?: string}[] {
    return this.device.state().devices[LINES_ADDRESS]?.recent ?? [];
  }

  /**
   * Reads the module's store directly: through the running module's own connection, since the module keeps its file to
   * itself (Hub #972), and otherwise as the test's own connection.
   */
  query(sql: string, ...params: (string | number)[]): unknown[][] {
    const running = this.harness.moduleDatabase();
    const db = running ?? new DatabaseSync(join(this.stateDir, 'nanoleaf.sqlite'), {readOnly: true});
    try {
      const statement = db.prepare(sql);
      statement.setReturnArrays(true);
      return statement.all(...params) as unknown as unknown[][];
    } finally {
      if (running === undefined) db.close();
    }
  }

  /** Every message the world saw followed profile 2.0, and no handler, timer or worker of the module failed. */
  verifyMessages(): void {
    assert.deepEqual(this.invalid, [], 'every message follows profile 2.0');
    assert.deepEqual(this.harnesses.flatMap(harness => harness.failures), [], 'no timer, worker or stop of the module failed');
  }

  /**
   * As `verifyMessages`, and no worker pass failed with an exception for any reason but an unreachable device: a failed
   * pass is logged with its error's type, which a hold or a refusing device's record never carries.
   */
  verify(): void {
    this.verifyMessages();
    assert.deepEqual(this.logs().filter(record => record.event === 'operation.failed' && record.fields['error.type'] !== undefined)
      .map(record => record.fields), [], 'no pass failed');
  }

  /**
   * Holds the device's worker lock from the test's own connection, as a second instance would, until the returned
   * function releases it. The lock file is made private first, as the module makes it.
   */
  lockDevice(device = 'wall'): () => void {
    const folder = join(this.stateDir, 'nanoleaf');
    mkdirSync(folder, {recursive: true, mode: 0o700});
    closeSync(openSync(join(folder, lockFile(device)), 'a', 0o600));
    return this.#lock(join(folder, lockFile(device)), 'EXCLUSIVE');
  }

  /**
   * Makes the running module's store refuse its work, as a failing disk would, on the module's own connection, since the
   * module keeps its file to itself (Hub #972) and no other connection can lock it. `writes`: the connection turns
   * `query_only`, so SQLite refuses each write and `BEGIN IMMEDIATE` as a read-only database. `everything`: an authorizer
   * denies every statement, reads included. The returned function gives the store back.
   */
  refuseStore(what: 'writes' | 'everything'): () => void {
    const db = this.harness.moduleDatabase();
    if (db === undefined) throw new Error('the module has no open store');
    if (what === 'writes') db.exec('PRAGMA query_only = ON');
    else db.setAuthorizer(() => constants.SQLITE_DENY);
    return () => {
      if (!db.isOpen) return;
      if (what === 'writes') db.exec('PRAGMA query_only = OFF');
      else db.setAuthorizer(null);
    };
  }

  #lock(path: string, kind: 'IMMEDIATE' | 'EXCLUSIVE'): () => void {
    const lock = new DatabaseSync(path, {timeout: 0});
    lock.exec(`BEGIN ${kind}`);
    this.#locks.push(lock);
    return () => {
      if (!lock.isOpen) return;
      if (lock.isTransaction) lock.exec('ROLLBACK');
      lock.close();
    };
  }

  async close(): Promise<void> {
    for (const lock of this.#locks) if (lock.isOpen) lock.close();
    this.device.release();
    await Promise.allSettled(this.harnesses.map(harness => harness.stop()));
    await this.#watcher?.close();
    await this.operator.close();
    await this.core.close();
    rmSync(this.stateDir, {recursive: true, force: true});
  }
}

export type WallState = {
  id: string; revision: number; configurationRevision: number; mode: string; modePending: boolean; source: string; pendingEdit: boolean; layout: string;
  held: boolean; failing: boolean;
  settings: {style: string; coverage: string}; tasks: {id: string; status: string; element: string | null; evictionToken?: string}[];
  elements: {id: string; task: string | null; project: string | null}[]; projects: {id: string}[];
};

/** A general device command's routing key and draft. */
export function deviceCommand(family: string, data: object, device = 'wall'): {key: string; draft: CommandDraft<object>} {
  const [entity, verb] = family === 'device-mode-set' ? ['device-mode', 'set'] : family === 'zone-power-set' ? ['zone-power', 'set']
    : [family.slice(0, family.lastIndexOf('-')), family.slice(family.lastIndexOf('-') + 1)];
  return {key: `bunny.cmd.${family}.${device}`, draft: {type: `org.bunny.${entity}.${verb}.requested`, subject: device,
    dataschema: `https://bunny.invalid/events/${family}/2.0`, data}};
}

/** One of the module's own commands. */
export function moduleCommand(family: string, type: string, data: object, device = 'wall'): {key: string; draft: CommandDraft<object>} {
  return {key: `bunny.cmd.${family}.${device}`, draft: {type, subject: device, dataschema: `https://bunny.invalid/events/${family}/2.0`, data}};
}

export const removeDir = (path: string): void => { rmSync(path, {recursive: true, force: true}); };
