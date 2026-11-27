// What the Pixoo module's node:test suites share (Hub #843): the configuration section, synthetic core and playback
// records, stand-in owners on a test bus, and a host for one module instance. Every identity here is synthetic, and no
// test reaches a device: the module runs with `SimulatedPixoo`.
import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync, crc32} from 'node:zlib';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, sessionEntityId, type Identity, type PlaybackState, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, SESSION_SCHEMA, type SessionFacts} from '@jimmie-potts/event-contracts/v2/session';
import {
  InProcessBus, type BunnyModule, type CommandDraft, type Participant, type RequestResult, type Scheduler, type StateDraft, type Subscription,
} from '@jimmie-potts/sdk';
import {ModuleHarness, RecordedSpans, manualClock, moduleWaitBudgets, waitForObservation} from '@jimmie-potts/sdk/testing';
import {Library} from '../../src/library/index.js';
import {encodeHostedGif} from '../../src/media/index.js';
import {FAMILIES, pixooOwnSchemas, schemaOf, type DisplayRecord} from '../../src/module/schemas.js';
import {TICK_MS, createPixooModule, type PixooOptions} from '../../src/module/module.js';
import {DashboardPager} from '../../src/presentation/agent-dashboard.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {monitorView} from '../../src/presentation/sources.js';
import {frameDigest, SimulatedPixoo, type SimulatedMode} from '../../src/module/transport.js';

export const DEVICE = 'pixoo-1';
/** The module's section: a simulated Pixoo at a documentation address with the observed GIF profile. */
export const SECTION = {device: {id: DEVICE, label: 'Desk Pixoo', address: '192.168.1.50', profile: 'pixoo64-gif-2026-10-01'}};
/** Short waits, so tests reach the device's outcomes in milliseconds. */
export const FAST: NonNullable<PixooOptions['timing']> = {reachMs: 60, probeMs: 400, firstRetryMs: 20, syncMs: 2000, syncRetryMaxMs: 200};

export const IDENTITY: Identity = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'};
export const SESSION_ID = sessionEntityId(IDENTITY);

/** A synthetic `session/3.0` record observed at `atMs`, its work confirmed, with `patch` applied to its facts. */
export function sessionRecord(atMs: number, revision: number, patch: Partial<SessionFacts> = {}): Session30Record {
  return buildSession({
    id: SESSION_ID, revision, generation: 1, identity: IDENTITY, parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'}, work: 'active',
    attention: [], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'}, observedAtMs: atMs, lastEvidenceAtMs: atMs,
    children: {working: 0, unconfirmed: 0}, label: {value: 'Build', origin: 'user'}, ...patch,
  });
}
export const sessionState = (record: Session30Record): StateDraft<Session30Record> =>
  ({type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record});

/** A synthetic `playback/2.0` record, playing a track observed at `atMs`. */
export function playbackRecord(atMs: number, revision: number, title = 'Harvest Moon', player: 'playing' | 'paused' = 'playing'): PlaybackState {
  return {id: 'presented', revision, availability: 'available', observedAtMs: atMs, playback: {status: 'known', player, title, artist: 'Neil Young', controls: ['pause', 'next']}};
}
export const playbackState = (record: PlaybackState): StateDraft<PlaybackState> =>
  ({type: 'org.bunny.playback.updated', subject: record.id, dataschema: record.artwork === undefined ? schemaOf('playback') : 'https://bunny.invalid/events/playback/2.1', data: record});

/** A validator with every family the module's messages use. */
export function validator(): MessageValidator {
  const checker = new MessageValidator();
  registerCoreFamilies(checker);
  registerDeviceFamilies(checker);
  for (const [dataschema, schema] of Object.entries(pixooOwnSchemas)) checker.register(dataschema, schema);
  return checker;
}

/**
 * A clock for the module that moves only when a test advances it (Hub #1679, #1705). The module's own timers wait on
 * it, so a moment, a tick or a coalesced publish happens only once the test moves time past it. The bus keeps the real
 * clock: its request deadlines are a test's backstop, not the module's behavior.
 */
export class ManualClock {
  readonly #clock: ReturnType<typeof manualClock>;
  #settle: () => Promise<void> = turns;

  constructor(start = Date.now()) {
    this.#clock = manualClock(start);
  }

  readonly now = (): number => this.#clock.now();

  readonly scheduler: Scheduler = {after: (delayMs, callback) => {
    const cancel = this.#clock.scheduler.after(delayMs, callback);
    // A zero-delay timer gives work a turn even when the test leaves time still.
    if (delayMs === 0) setImmediate(() => { this.#clock.advance(0); });
    return cancel;
  }};

  /** How the clock waits, before each timer it runs, for the work the earlier ones started. */
  settleWith(settle: () => Promise<void>): void {
    this.#settle = settle;
  }

  /**
   * Moves time `ms` forward, running each timer that falls due in order of its time, then of its scheduling. Before
   * each timer, and at the end, the work the earlier timers started settles, so no timer runs ahead of it.
   */
  async advance(ms: number): Promise<void> {
    const end = this.now() + ms;
    await this.#settle();
    while (this.#clock.stepToNextTimer(end)) await this.#settle();
    await this.#settle();
  }
}
/** A few turns of the event loop, for promised work and zero-delay timers in this process. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
/** Polls until `find` returns something, or fails after `timeoutMs`. */
export function waitFor<T>(find: () => T | undefined, what: string, timeoutMs: number = moduleWaitBudgets.pixoo.timeoutMs): Promise<T> {
  return waitForObservation(find, (value): value is T => value !== undefined, what, {...moduleWaitBudgets.pixoo, timeoutMs});
}

/** A PNG that declares `width` x `height` pixels and holds one row of image data: a pixel bomb's header, a few bytes long. */
export function declaredPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(2, 9);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(1 + width * 3))), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * One test's world: a bus, stand-ins for the core (sessions and notice acknowledgments) and the playback owner, a
 * simulated Pixoo, and the module in a harness on a private state directory. `restart` hosts a new instance on the same
 * state directory and device, as the runtime would after a restart.
 */
export class World {
  readonly bus: InProcessBus;
  readonly device: SimulatedPixoo;
  readonly spans = new RecordedSpans();
  /** Every message published on the bus, in order. */
  readonly seen: Message[] = [];
  /** The notice acknowledgments the stand-in core received. */
  readonly acknowledged: Message[] = [];
  readonly errors: unknown[] = [];
  readonly invalid: string[] = [];
  readonly probe: Participant;
  readonly core: Participant;
  readonly player: Participant;
  harness: ModuleHarness;
  module: BunnyModule;
  sessions: Session30Record[] = [];
  playback: PlaybackState[] = [];
  revision = 1;
  readonly #validator = validator();
  readonly #dir: string;
  readonly #options: Omit<PixooOptions, 'transport'>;
  readonly #section: unknown;
  readonly #hosted: ModuleHarness[] = [];
  readonly #subscriptions: Subscription[] = [];
  /** The module's clock when the test controls it, or undefined when the module runs on the real clock. */
  readonly clock: ManualClock | undefined;

  private constructor(dir: string, mode: SimulatedMode, options: Omit<PixooOptions, 'transport'>, section: unknown, clock: ManualClock | undefined) {
    this.#dir = dir;
    this.clock = clock;
    // A worker call, such as a render, runs outside this process's turns: the clock waits for the module's to end.
    clock?.settleWith(async () => {
      for (;;) {
        await turns();
        if (this.#hosted.every(harness => harness.runningWorkers() === 0)) return;
        await waitFor(() => this.#hosted.every(harness => harness.runningWorkers() === 0) ? true : undefined, 'the module\'s worker calls');
      }
    });
    this.#options = options;
    this.#section = section;
    this.device = new SimulatedPixoo({mode});
    this.module = createPixooModule({...this.#options, transport: this.device});
    this.bus = new InProcessBus({spans: this.spans, onError: error => { this.errors.push(error); }});
    this.probe = this.bus.connect('bunny/test');
    this.core = this.bus.connect('bunny/core');
    this.player = this.bus.connect('bunny/modules/playback');
    this.harness = this.#fresh();
  }

  /** `clock` runs the module on a clock the test advances; without it the module runs on the real clock. */
  static async open({mode = 'online', options = {}, section = SECTION, playback = true, clock}: {
    mode?: SimulatedMode; options?: Omit<PixooOptions, 'transport'>; section?: unknown; playback?: boolean; clock?: ManualClock;
  } = {}): Promise<World> {
    const world = new World(await mkdtemp(join(tmpdir(), 'pixoo-module-')), mode, {timing: FAST, ...options}, section, clock);
    world.#subscriptions.push(await world.probe.subscribe('bunny.*.*.*', message => {
      const checked = world.#validator.validate(message);
      if (!checked.ok) world.invalid.push(`${message.type}: ${checked.error.code} ${checked.error.detail ?? ''}`);
      world.seen.push(message);
    }));
    world.#subscriptions.push(await world.core.serveSync(['session'], () => ({revision: world.revision, states: world.sessions.map(sessionState)})));
    if (playback) await world.servePlayback();
    world.#subscriptions.push(await world.core.respond('bunny.cmd.notice-acknowledge.*', command => {
      world.acknowledged.push(command);
      return {status: 'accepted'};
    }));
    return world;
  }

  /** The module's private folder, as the runtime would create it beside its SQLite file. */
  get folder(): string {
    return join(this.#dir, 'pixoo');
  }

  /** The module's SQLite file, as the harness opens it. */
  get databaseFile(): string {
    return join(this.#dir, 'pixoo.sqlite');
  }

  /**
   * Runs `work` on the module's database: through the running module's own connection, since the module keeps its file
   * to itself (Hub #972) and no second connection can open it, and otherwise on a connection of the test's own.
   */
  withDatabase<T>(work: (database: DatabaseSync) => T): T {
    const running = this.harness.moduleDatabase();
    if (running !== undefined) return work(running);
    const database = new DatabaseSync(this.databaseFile);
    try {
      return work(database);
    } finally {
      database.close();
    }
  }

  /** Fills the module's library before it starts, as the library migration (#931) would leave it. */
  async populate(fill: (library: Library) => Promise<void>): Promise<void> {
    const database = new DatabaseSync(this.databaseFile);
    try {
      // A test's library is disposable, so filling it need not wait for the disk.
      database.exec('PRAGMA synchronous = OFF');
      const library = await Library.attach({database, directory: this.folder});
      try {
        await fill(library);
      } finally {
        await library.close();
      }
    } finally {
      database.close();
    }
  }

  /** The stand-in playback owner starts serving the playback record. */
  async servePlayback(): Promise<void> {
    this.#subscriptions.push(await this.player.serveSync(['playback'], () => ({revision: this.revision, states: this.playback.map(playbackState)})));
  }

  #fresh(): ModuleHarness {
    this.module = createPixooModule({...this.#options, transport: this.device});
    const harness = new ModuleHarness(this.module, {
      bus: this.bus, stateDir: this.#dir, spans: this.spans, ...(this.#section === undefined ? {} : {section: this.#section}),
      ...(this.clock === undefined ? {} : {clock: {now: this.clock.now}, scheduler: this.clock.scheduler}),
    });
    this.#hosted.push(harness);
    return harness;
  }

  async start(): Promise<void> {
    await this.harness.start();
  }

  async restart(): Promise<void> {
    await this.harness.stop();
    this.harness = this.#fresh();
    await this.harness.start();
  }

  /** The module's time: the test's clock when it has one, otherwise the real clock. */
  now(): number {
    return this.clock?.now() ?? Date.now();
  }

  /**
   * Moves the module's clock one presentation tick at a time until `find` returns something, and fails once `limitMs`
   * of the module's time have passed without it. Each tick's work settles before `find` reads, so no real-time wait
   * decides what it sees.
   */
  async tickUntil<T>(find: () => T | undefined, what: string, limitMs: number): Promise<T> {
    const clock = this.clock;
    if (clock === undefined) throw new Error('tickUntil needs a world on a manual clock');
    for (let elapsed = 0; ; elapsed += TICK_MS) {
      const found = find();
      if (found !== undefined) return found;
      if (elapsed >= limitMs) throw new Error(`${what} did not happen within ${limitMs} ms of the module's time`);
      await clock.advance(TICK_MS);
    }
  }

  /** Publishes a new session record from the stand-in core. */
  async publishSession(patch: Partial<SessionFacts> = {}): Promise<Session30Record> {
    this.revision += 1;
    const record = sessionRecord(this.now(), this.revision, patch);
    this.sessions = [record];
    await this.core.publish(`bunny.state.session.${record.id}`, {kind: 'state', ...sessionState(record)});
    return record;
  }

  /** Wait for the dashboard rendered from the published session, then return its frame digests for later comparisons. */
  async waitForSessionDashboard(session: Session30Record, limitMs = 5000): Promise<string[]> {
    const view = monitorView({state: 'current', revision: session.revision, sessions: [session]});
    const digests = renderDashboard(new DashboardPager().layout(view, this.now())).map(frameDigest);
    await this.waitForDashboard(digests, limitMs);
    return digests;
  }

  /** A session update can reach the module before its dashboard replaces the previous picture on the device. */
  async waitForDashboard(expected: readonly string[], limitMs = 5000): Promise<void> {
    const matches = () => {
      const actual = this.device.state().shown?.digests;
      return actual?.length === expected.length && actual.every((digest, index) => digest === expected[index]) ? true : undefined;
    };
    try {
      if (this.clock === undefined) await waitFor(matches, 'the session dashboard on the device', limitMs);
      else await this.tickUntil(matches, 'the session dashboard on the device', limitMs);
    } catch (cause) {
      const shown = this.device.state().shown;
      throw new Error(`Expected dashboard frames ${JSON.stringify(expected)}, device showed ${JSON.stringify(shown)}, Monitor ${JSON.stringify(this.display()?.monitor)}`, {cause});
    }
  }

  /** Publishes a new playback record from the stand-in playback owner. */
  async publishPlayback(title?: string, player?: 'playing' | 'paused'): Promise<PlaybackState> {
    this.revision += 1;
    const record = playbackRecord(this.now(), this.revision, title, player);
    this.playback = [record];
    await this.player.publish(`bunny.state.playback.${record.id}`, {kind: 'state', ...playbackState(record)});
    return record;
  }

  /** Sends one command to the Pixoo as the test participant. */
  request(family: string, type: string, data: object, options: {requestId?: string} = {}): Promise<RequestResult> {
    const draft: CommandDraft<object> = {type, subject: DEVICE, dataschema: schemaOf(family), data};
    return this.probe.request(`bunny.cmd.${family}.${DEVICE}`, draft, {timeoutMs: 5000, ...options});
  }

  /** The outcome of one request, once the module has published it. */
  outcome(requestId: string, timeoutMs: number = moduleWaitBudgets.pixoo.timeoutMs): Promise<Message<{requestId: string; result: string; evidence: string; error?: {code: string}}>> {
    return waitFor(() => this.seen.find(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId) as
      Message<{requestId: string; result: string; evidence: string; error?: {code: string}}> | undefined, `the outcome of ${requestId}`, timeoutMs);
  }

  /** The latest state of one of the module's records. */
  latest<T>(family: string, id = DEVICE): T | undefined {
    return this.seen.filter(message => message.kind === 'state' && message.source === 'bunny/modules/pixoo'
      && message.type === `org.bunny.${family}.updated` && message.subject === id).at(-1)?.data as T | undefined;
  }

  /** The module's records of `family` as a new copy syncs them, as a reader does. */
  async synced<T>(family: string): Promise<T[]> {
    const result = await this.probe.sync<Record<string, unknown>>([family], () => {}, {timeoutMs: 20_000});
    if (result.status !== 'synced') throw new Error(`the sync of ${family} was refused: ${result.error.error.code}`);
    const records = result.copy.states().map(state => state.data as T);
    await result.copy.close();
    return records;
  }

  deviceRecord(): DeviceRecord | undefined {
    return this.latest<DeviceRecord>('device');
  }

  display(): DisplayRecord | undefined {
    return this.latest<DisplayRecord>(FAMILIES.display);
  }

  /** Every log record of every instance this world hosted. */
  logs(): ModuleHarness['logs'] {
    return this.#hosted.flatMap(harness => harness.logs);
  }

  /** Every failure of every instance: a handler, timer or worker that failed, or a stop that threw or ran late. */
  failures(): unknown[] {
    return [...this.errors, ...this.#hosted.flatMap(harness => harness.failures)];
  }

  async close(): Promise<void> {
    await Promise.all(this.#hosted.map(harness => harness.stop()));
    for (const subscription of this.#subscriptions) await subscription.close();
    for (const participant of [this.probe, this.core, this.player]) await participant.close();
    await rm(this.#dir, {recursive: true, force: true});
  }
}

/** A GIF of `frames` 64x64 frames at 100 ms, which the hosted profile plays: two colors that differ for each `index`. */
export function hostedGif(index: number, frames: number): Buffer {
  return encodeHostedGif(Array.from({length: frames}, (_, frame) => {
    const rgb = new Uint8Array(12288);
    for (let pixel = 0; pixel < 4096; pixel += 1) rgb.set((pixel + frame) % 2 === 0 ? [index % 256, 0, 0] : [0, index % 256, 255], pixel * 3);
    return {rgb, delayMs: 100};
  }));
}

/** The bytes as one-chunk input, as the library's import reads them. */
export async function* bytesOf(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield await Promise.resolve(bytes);
}

const {GIFEncoder} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
/**
 * A two-frame GIF whose frames hold 200 colors each, all different, so its frames together hold 400: within the GIF
 * profile, but beyond the hosted GIF's 256 global colors.
 */
export function manyColorGif(): Buffer {
  const gif = GIFEncoder();
  for (const frame of [0, 1]) {
    const palette = Array.from({length: 200}, (_, color) => [frame * 100 + color % 100, Math.floor(color / 100) * 128, frame * 255]);
    const pixels = new Uint8Array(4096).map((_, pixel) => pixel % 200);
    gif.writeFrame(pixels, 64, 64, {palette, delay: 100, dispose: 1, transparent: false, repeat: 0});
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
