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
import {registerCoreFamilies, sessionEntityId, type Identity, type PlaybackState, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type CommandDraft, type Participant, type RequestResult, type StateDraft, type Subscription} from '@jimmie-potts/sdk';
import {ModuleHarness, RecordedSpans, followStandInAcks, standInAckSchemas} from '@jimmie-potts/sdk/testing';
import {Library} from '../../src/library/index.js';
import {encodeHostedGif} from '../../src/media/index.js';
import {DEVICE_SCHEMA, FAMILIES, pixooOwnSchemas, schemaOf, type DisplayRecord} from '../../src/module/schemas.js';
import {createPixooModule, type PixooOptions} from '../../src/module/module.js';
import {SimulatedPixoo, type SimulatedMode} from '../../src/module/transport.js';

export const DEVICE = 'pixoo-1';
/** The module's section: a simulated Pixoo at a documentation address with the observed GIF profile. */
export const SECTION = {device: {id: DEVICE, label: 'Desk Pixoo', address: '192.168.1.50', profile: 'pixoo64-gif-2026-10-01'}};
/** Short waits, so tests reach the device's outcomes in milliseconds. */
export const FAST: NonNullable<PixooOptions['timing']> = {reachMs: 60, probeMs: 400, firstRetryMs: 20, syncMs: 2000, syncRetryMaxMs: 200};

export const IDENTITY: Identity = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code', sessionId: 'session-sim-1'};
export const SESSION_ID = sessionEntityId(IDENTITY);

/** A synthetic `session/2.0` record observed at `atMs`, current, with `patch` applied. */
export function sessionRecord(atMs: number, revision: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: SESSION_ID, revision, generation: 1, identity: IDENTITY, parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'}, activity: 'active',
    attention: [], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'}, observedAtMs: atMs, lastEvidenceAtMs: atMs,
    freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}, label: {value: 'Build', origin: 'user'}, ...patch,
  };
}
export const sessionState = (record: SessionRecord): StateDraft<SessionRecord> =>
  ({type: 'org.bunny.session.updated', subject: record.id, dataschema: schemaOf('session'), data: record});

/** A synthetic `playback/2.0` record, playing a track observed at `atMs`. */
export function playbackRecord(atMs: number, revision: number, title = 'Harvest Moon', player: 'playing' | 'paused' = 'playing'): PlaybackState {
  return {id: 'presented', revision, availability: 'available', observedAtMs: atMs, playback: {status: 'known', player, title, artist: 'Neil Young', controls: ['pause', 'next']}};
}
export const playbackState = (record: PlaybackState): StateDraft<PlaybackState> =>
  ({type: 'org.bunny.playback.updated', subject: record.id, dataschema: schemaOf('playback'), data: record});

/** A validator with every family the module's messages use. */
export function validator(): MessageValidator {
  const checker = new MessageValidator();
  registerCoreFamilies(checker);
  registerDeviceFamilies(checker);
  for (const [dataschema, schema] of Object.entries({...standInAckSchemas, ...pixooOwnSchemas})) checker.register(dataschema, schema);
  return checker;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
/** Polls until `find` returns something, or fails after `timeoutMs`. */
export async function waitFor<T>(find: () => T | undefined, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
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
  sessions: SessionRecord[] = [];
  playback: PlaybackState[] = [];
  revision = 1;
  readonly #validator = validator();
  readonly #dir: string;
  readonly #options: Omit<PixooOptions, 'transport'>;
  readonly #section: unknown;
  readonly #hosted: ModuleHarness[] = [];
  readonly #subscriptions: Subscription[] = [];

  private constructor(dir: string, mode: SimulatedMode, options: Omit<PixooOptions, 'transport'>, section: unknown) {
    this.#dir = dir;
    this.#options = options;
    this.#section = section;
    this.device = new SimulatedPixoo({mode});
    this.bus = new InProcessBus({spans: this.spans, onError: error => { this.errors.push(error); }});
    this.probe = this.bus.connect('bunny/test');
    this.core = this.bus.connect('bunny/core');
    this.player = this.bus.connect('bunny/modules/playback');
    this.harness = this.#fresh();
  }

  static async open({mode = 'online', options = {}, section = SECTION, playback = true}: {
    mode?: SimulatedMode; options?: Omit<PixooOptions, 'transport'>; section?: unknown; playback?: boolean;
  } = {}): Promise<World> {
    const world = new World(await mkdtemp(join(tmpdir(), 'pixoo-module-')), mode, {timing: FAST, acknowledgments: followStandInAcks, ...options}, section);
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

  /** Fills the module's library before it starts, as the library migration (#931) would leave it. */
  async populate(fill: (library: Library) => Promise<void>): Promise<void> {
    const database = new DatabaseSync(this.databaseFile);
    try {
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
    const harness = new ModuleHarness(createPixooModule({...this.#options, transport: this.device}), {
      bus: this.bus, stateDir: this.#dir, spans: this.spans, ...(this.#section === undefined ? {} : {section: this.#section}),
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

  /** Publishes a new session record from the stand-in core. */
  async publishSession(patch: Partial<SessionRecord> = {}): Promise<SessionRecord> {
    this.revision += 1;
    const record = sessionRecord(Date.now(), this.revision, patch);
    this.sessions = [record];
    await this.core.publish(`bunny.state.session.${record.id}`, {kind: 'state', ...sessionState(record)});
    return record;
  }

  /** Publishes a new playback record from the stand-in playback owner. */
  async publishPlayback(title?: string, player?: 'playing' | 'paused'): Promise<PlaybackState> {
    this.revision += 1;
    const record = playbackRecord(Date.now(), this.revision, title, player);
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
  outcome(requestId: string, timeoutMs = 5000): Promise<Message<{requestId: string; result: string; evidence: string; error?: {code: string}}>> {
    return waitFor(() => this.seen.find(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId) as
      Message<{requestId: string; result: string; evidence: string; error?: {code: string}}> | undefined, `the outcome of ${requestId}`, timeoutMs);
  }

  /** The latest state of one of the module's records. */
  latest<T>(family: string, id = DEVICE): T | undefined {
    const schema = family === 'device' ? DEVICE_SCHEMA : schemaOf(family);
    return this.seen.filter(message => message.kind === 'state' && message.dataschema === schema && message.subject === id).at(-1)?.data as T | undefined;
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
