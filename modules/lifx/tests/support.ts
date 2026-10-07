// What the LIFX module's tests share (Hub #928): a manual clock and scheduler, the module hosted in the kit's
// `ModuleHarness` on its own bus with simulated bulbs, a stand-in core that serves sessions and acknowledges outcomes,
// and builders for sessions and commands. Every message the bus carries is checked against profile 2.0 with the core,
// device and LIFX families.
import {copyFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {MessageValidator, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, sessionEntityId, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type BunnyModule, type Cancel, type CommandDraft, type Participant, type RequestResult, type Scheduler} from '@jimmie-potts/sdk';
import {followStandInAcks, ModuleHarness, RecordedSpans, standInAck, standInAckSchemas} from '@jimmie-potts/sdk/testing';
import {
  createLifxModule, LIFX_COLOR_SET_SCHEMA, LIFX_TEMPERATURE_SET_SCHEMA, registerLifxFamilies, SimulatedLifx, type LifxConfig, type LifxModuleOptions,
  type LifxNetwork,
} from '../src/index.js';

export const START_MS = Date.parse('2026-10-07T12:00:00.000Z');
export const PENDANT = {
  id: 'pendant-1', address: '192.0.2.40', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90,
  status: {brightnessCapPercent: 50, quietCapPercent: 20},
} as const;
/** The Beam: product 38 is LIFX Beam, which is not qualified (#319), so it gets no controls. */
export const BEAM = {id: 'beam', address: '192.0.2.41', vendor: 1, product: 38, firmwareMajor: 3, firmwareMinor: 70} as const;
export const SECTION = {bulbs: [PENDANT, BEAM]};

/**
 * node:test's test(), whose returned promise the runner awaits itself. The timeout makes a wait that never ends fail the
 * test instead of hanging the run.
 */
export function it(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void test(name, {timeout: 30_000}, body);
}

export const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
};

export type ManualClock = {now: () => number; scheduler: Scheduler; advance: (ms: number) => Promise<void>; pending: () => number};

/** A clock that moves only when a test advances it, running each timer that falls due in order. */
export function manualClock(start = START_MS): ManualClock {
  let now = start;
  let next = 0;
  const timers = new Map<number, {at: number; callback: () => void}>();
  const due = (end: number): number | undefined => {
    let found: number | undefined;
    for (const [id, timer] of timers) {
      const earliest = found === undefined ? undefined : timers.get(found);
      if (timer.at <= end && (earliest === undefined || timer.at < earliest.at)) found = id;
    }
    return found;
  };
  return {
    now: () => now,
    scheduler: {after: (delayMs, callback) => {
      const id = next;
      next += 1;
      timers.set(id, {at: now + delayMs, callback});
      const cancel: Cancel = () => { timers.delete(id); };
      return cancel;
    }},
    advance: async ms => {
      const end = now + ms;
      for (;;) {
        await flush();
        const id = due(end);
        const timer = id === undefined ? undefined : timers.get(id);
        if (id === undefined || timer === undefined) break;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = end;
      await flush();
    },
    pending: () => timers.size,
  };
}

/** Profile 2.0 with the core, device and LIFX families and the kit's stand-in acknowledgment. */
export function fullValidator(): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  registerLifxFamilies(validator);
  for (const [dataschema, schema] of Object.entries(standInAckSchemas)) validator.register(dataschema, schema);
  return validator;
}

const identity = (name: string): SessionRecord['identity'] => ({provider: 'claude', client: 'code', hostId: 'host-a', sourceId: 'claude-code', sessionId: name});
/** A session's shown state: what `highestStatus` ranks it as. */
export type Shown = 'working' | 'attention' | 'done' | 'idle';

/** A valid `session/2.0` record for a root session in `shown`, with its evidence at `atMs`. */
export function sessionRecord(name: string, shown: Shown, revision: number, atMs: number): SessionRecord {
  const turn = {status: 'known', id: 'turn-1'} as const;
  return {
    id: sessionEntityId(identity(name)), revision, generation: revision, identity: identity(name), parent: {status: 'top-level'}, turn,
    activity: shown === 'working' ? 'active' : 'idle',
    attention: shown === 'attention' ? [{id: {status: 'known', id: `approval-${name}`}, kind: 'approval', turn}] : [],
    notices: shown === 'done' ? [{id: 'a'.repeat(64), kind: 'turn-ended', turn, acknowledgedBy: []}] : [],
    read: 'unknown', unavailable: [{dimension: 'read', reason: 'unsupported'}], ordering: {status: 'unknown'},
    observedAtMs: atMs, lastEvidenceAtMs: atMs, freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0},
  };
}

/** The general and LIFX commands, as an operator sends them. */
export const command = {
  power: (id: string, on: boolean, guards: object = {}): CommandDraftFor => ({
    key: `bunny.cmd.power-set.${id}`, draft: {type: 'org.bunny.power.set.requested', subject: id, dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on, ...guards}},
  }),
  brightness: (id: string, percent: number): CommandDraftFor => ({
    key: `bunny.cmd.brightness-set.${id}`, draft: {type: 'org.bunny.brightness.set.requested', subject: id, dataschema: 'https://bunny.invalid/events/brightness-set/2.0', data: {percent}},
  }),
  mode: (id: string, mode: string): CommandDraftFor => ({
    key: `bunny.cmd.device-mode-set.${id}`, draft: {type: 'org.bunny.device-mode.set.requested', subject: id, dataschema: 'https://bunny.invalid/events/device-mode-set/2.0', data: {mode}},
  }),
  color: (id: string, hue: number, saturation: number): CommandDraftFor => ({
    key: `bunny.cmd.lifx-color-set.${id}`, draft: {type: 'org.bunny.lifx-color.set.requested', subject: id, dataschema: LIFX_COLOR_SET_SCHEMA, data: {hue, saturation}},
  }),
  temperature: (id: string, kelvin: number): CommandDraftFor => ({
    key: `bunny.cmd.lifx-temperature-set.${id}`, draft: {type: 'org.bunny.lifx-temperature.set.requested', subject: id, dataschema: LIFX_TEMPERATURE_SET_SCHEMA, data: {kelvin}},
  }),
};
export type CommandDraftFor = {key: string; draft: CommandDraft<object>};

export type WorldOptions = {
  section?: unknown;
  /** The state directory to start in, such as a copy of another world's taken as a crash would leave it. */
  dir?: string;
  /** How the module reaches its bulbs, when not `network` itself, such as a wrapper around it. */
  transport?: LifxNetwork;
  /** How many messages one subscription's queue on the bus holds. Defaults to the bus's 1024. */
  maxQueued?: number;
  network?: SimulatedLifx;
  /** Whether the module follows the stand-in core's acknowledgments. Defaults to true. */
  acknowledged?: boolean;
  /** Whether the stand-in core serves sessions. Defaults to true. */
  core?: boolean;
  beforePublish?: (message: Message<unknown>) => void;
};

/** The LIFX module on its own bus, with simulated bulbs, a stand-in core and an operator, on a manual clock. */
export class World {
  readonly clock = manualClock();
  readonly spans = new RecordedSpans();
  readonly bus: InProcessBus;
  readonly network: SimulatedLifx;
  /** Every message published on the bus, in order. */
  readonly published: Message[] = [];
  /** Messages that broke profile 2.0, and where. */
  readonly invalid: string[] = [];
  /** Errors the bus reported from the module's handlers. */
  readonly errors: unknown[] = [];
  readonly sessions = new Map<string, SessionRecord>();
  readonly #validator = fullValidator();
  readonly #options: WorldOptions;
  /** The state directory the module's database and private folder live in. */
  readonly dir: string;
  readonly #participants: Participant[] = [];
  /** Every instance of the module this world hosted, the current one last. */
  readonly hosted: ModuleHarness[] = [];
  #revision = 0;
  #core: Participant | undefined;
  operator: Participant;
  /** The module's own SQLite database, once its start opened it. */
  db: DatabaseSync | undefined;
  /** While true, the stand-in core refuses every sync of its sessions, as an owner that cannot serve. */
  refuseSync = false;

  private constructor(dir: string, options: WorldOptions) {
    this.dir = dir;
    this.#options = options;
    this.network = options.network ?? new SimulatedLifx();
    this.bus = new InProcessBus({
      now: this.clock.now, scheduler: this.clock.scheduler, spans: this.spans, onError: error => { this.errors.push(error); },
      ...(options.maxQueued === undefined ? {} : {maxQueued: options.maxQueued}),
    });
    this.operator = this.#connect('bunny/parts/operator');
  }

  /** Opens a world and starts the module in it. */
  static async open(options: WorldOptions = {}): Promise<World> {
    const world = new World(options.dir ?? await mkdtemp(join(tmpdir(), 'lifx-module-')), options);
    const watcher = world.#connect('bunny/test/watcher');
    await watcher.subscribe('bunny.*.*.*', message => {
      const result = world.#validator.validate(message);
      if (!result.ok) world.invalid.push(`${message.type}: ${result.error.code} ${result.error.detail ?? ''}`);
      world.published.push(message);
    });
    if (options.core !== false) await world.serveCore();
    await world.start();
    return world;
  }

  get harness(): ModuleHarness {
    const current = this.hosted.at(-1);
    if (current === undefined) throw new Error('no module started');
    return current;
  }

  /** Starts a new instance of the module on the same state directory, as the runtime does at each start. */
  async start(options: Partial<LifxModuleOptions> = {}): Promise<void> {
    const {acknowledged = true, beforePublish} = this.#options;
    const inner = createLifxModule({
      transport: this.#options.transport ?? this.network, ...(acknowledged ? {acknowledgments: followStandInAcks} : {}), ...(beforePublish === undefined ? {} : {beforePublish}), ...options,
    });
    // The same module, with its database kept here, so a test can fill the disk under it.
    const module: BunnyModule<LifxConfig> = {
      manifest: inner.manifest,
      start: context => inner.start({...context, database: () => {
        this.db = context.database();
        return this.db;
      }}),
      stop: () => inner.stop(),
    };
    const harness = new ModuleHarness(module, {
      bus: this.bus, stateDir: this.dir, clock: {now: this.clock.now}, scheduler: this.clock.scheduler, spans: this.spans,
      section: this.#options.section ?? SECTION,
    });
    this.hosted.push(harness);
    await harness.start();
    await flush();
  }

  /** Stops the module and starts it again on the same database, as a runtime restart would. */
  async restart(options: Partial<LifxModuleOptions> = {}): Promise<void> {
    await this.harness.stop();
    await this.start(options);
  }

  /** Sends a command as the operator and returns its result, letting virtual time pass while it runs. */
  async send(sent: CommandDraftFor, options: {requestId?: string; timeoutMs?: number} = {}): Promise<RequestResult> {
    const result = this.operator.request(sent.key, sent.draft, {timeoutMs: options.timeoutMs ?? 5000, ...(options.requestId === undefined ? {} : {requestId: options.requestId})});
    await flush();
    return result;
  }

  /** Publishes a session's new record from the stand-in core; `change` adjusts the record before it goes out. */
  async session(name: string, shown: Shown, change: (record: SessionRecord) => SessionRecord = record => record): Promise<void> {
    this.#revision += 1;
    const record = change(sessionRecord(name, shown, this.#revision, this.clock.now()));
    this.sessions.set(record.id, record);
    await this.#core?.publish(`bunny.state.session.${record.id}`, {
      kind: 'state', type: 'org.bunny.session.updated', subject: record.id, dataschema: 'https://bunny.invalid/events/session/2.0', data: record,
    });
    await flush();
  }

  /**
   * Publishes `count` new records of one session at once, without waiting, so a subscription whose queue is shorter
   * drops some of them and its copy must sync again.
   */
  flood(name: string, shown: Shown, count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.#revision += 1;
      const record = sessionRecord(name, shown, this.#revision, this.clock.now());
      this.sessions.set(record.id, record);
      void this.#core?.publish(`bunny.state.session.${record.id}`, {
        kind: 'state', type: 'org.bunny.session.updated', subject: record.id, dataschema: 'https://bunny.invalid/events/session/2.0', data: record,
      });
    }
  }

  /** Sets a bulb's mode as an operator would, and lets its paint, if any, go out. */
  async mode(id: string, mode: string): Promise<void> {
    const result = await this.send(command.mode(id, mode));
    if (result.status !== 'accepted') throw new Error(`the mode command was ${result.status}`);
    await this.clock.advance(1);
  }

  /**
   * A new state directory holding the module's SQLite file as it is on disk now, as the runtime would find it after a
   * crash at this point. The module's private folder, with its leases, is not copied: a crash releases them.
   */
  async crashCopy(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lifx-crash-'));
    await copyFile(join(this.dir, 'lifx.sqlite'), join(dir, 'lifx.sqlite'));
    return dir;
  }

  /** The module's published records of one bulb, of one family, oldest first. */
  records<T>(family: 'device' | 'lifx-light', id: string): T[] {
    return this.published.filter(message => message.dataschema === `https://bunny.invalid/events/${family}/2.0` && message.subject === id)
      .map(message => message.data as T);
  }

  /** The bulb's last published device record. */
  device(id: string): DeviceRecord | undefined {
    return this.records<DeviceRecord>('device', id).at(-1);
  }

  /** The module's outcomes, oldest first, optionally for one request. */
  outcomes(requestId?: string): Message[] {
    return this.published.filter(message => message.kind === 'outcome' && (requestId === undefined || (message.data as {requestId?: unknown}).requestId === requestId));
  }

  /** The packets of one type the simulated bulb at `address` got. */
  packets(address: string, type?: number): number {
    return this.network.state().packets.filter(packet => packet.address === address && (type === undefined || packet.type === type)).length;
  }

  /** The module's log records of `event`, from every instance this world hosted. */
  logs(event: string): ModuleHarness['logs'] {
    return this.hosted.flatMap(harness => harness.logs).filter(entry => entry.event === event);
  }

  async close(): Promise<void> {
    for (const harness of this.hosted) await harness.stop();
    for (const participant of this.#participants) await participant.close();
    await rm(this.dir, {recursive: true, force: true});
  }

  /** The stand-in core: it serves the sessions, and acknowledges each outcome it hears, as the fixture core does. */
  async serveCore(): Promise<void> {
    const core = this.#connect('bunny/core');
    this.#core = core;
    await core.serveSync(['session'], () => this.refuseSync ? errorBody('unavailable', {detail: 'the stand-in core refuses'}) : ({
      revision: this.#revision,
      states: [...this.sessions.values()].map(record => ({type: 'org.bunny.session.updated', subject: record.id, dataschema: 'https://bunny.invalid/events/session/2.0', data: record})),
    }));
    await core.subscribe('bunny.event.*.*', async message => {
      if (message.kind !== 'outcome') return;
      const {key, draft} = standInAck(message);
      await core.publish(key, draft, {parent: message});
    });
  }

  #connect(source: string): Participant {
    const participant = this.bus.connect(source);
    this.#participants.push(participant);
    return participant;
  }
}

/**
 * Leaves the module's database no room to grow, as a full disk would, through SQLite's own full-disk path: small pages and
 * a page limit at the file's size, so the next change that needs a page fails with SQLITE_FULL.
 */
export function fillDisk(db: DatabaseSync): void {
  db.exec('PRAGMA page_size = 512; VACUUM');
  const pages = (db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  db.exec(`PRAGMA max_page_count = ${pages}`);
}

/** Gives the database its room back. */
export function roomOnDisk(db: DatabaseSync): void {
  db.exec('PRAGMA max_page_count = 1073741823');
}

/** A bulb's device record as a reader syncs it now. A bulb the module never reached publishes no change of its own. */
export async function synced(world: World, id: string): Promise<DeviceRecord | undefined> {
  const sync = await world.operator.sync<DeviceRecord>(['device'], () => {}, {timeoutMs: 5000});
  if (sync.status !== 'synced') return undefined;
  const record = sync.copy.states().find(state => state.data.id === id)?.data;
  await sync.copy.close();
  return record;
}

/** The bulb's color as the simulated bulb shows it, in degrees and percent. */
export function shownColor(network: SimulatedLifx, address: string): {hue: number; saturation: number; brightness: number; kelvin: number; power: boolean} | undefined {
  const bulb = network.state().bulbs[address];
  if (bulb === undefined) return undefined;
  const {hue, saturation, brightness, kelvin} = bulb.color;
  return {
    hue: Math.round((hue * 360) / 65535), saturation: Math.round((saturation * 100) / 65535), brightness: Math.round((brightness * 100) / 65535), kelvin,
    power: bulb.power,
  };
}
