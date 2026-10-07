// Shared helpers for the Tidbyt module's tests: a manual clock, session and playback records, stand-in owners for the
// core's sessions and the playback module's record, and the module hosted by the module test kit's harness on a manual
// clock with the simulated cloud.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test as nodeTest, type TestContext} from 'node:test';
import {MessageValidator, errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies, sessionEntityId, type Identity, type PlaybackState, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type Participant, type Scheduler, type Snapshot} from '@jimmie-potts/sdk';
import {ModuleHarness, RecordedSpans, type HarnessRecord} from '@jimmie-potts/sdk/testing';
import {DEVICE_SCHEMA, SIMULATED_SECTION, createTidbytModule, type TidbytModuleOptions} from '../src/module.js';
import {SIMULATED_API_KEY, SimulatedCloud, type SimulatedCloudOptions} from '../src/simulated.js';

/** node:test's test() with a timeout, so a wait that never ends fails the test instead of hanging the run. */
export function test(name: string, body: (context: TestContext) => void | Promise<void>): void {
  void nodeTest(name, {timeout: 60_000}, body);
}

export const START_MS = Date.parse('2026-10-07T12:00:00.000Z');
/** The render deadline the hosted module gets, on the manual clock. */
export const RENDER_TIMEOUT_MS = 3_600_000;
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;

/** A manual wall clock with a scheduler on it. `advance` runs every timer that falls due, in order. */
export function manualClock(start = START_MS): {now: () => number; scheduler: Scheduler; advance: (ms: number) => void; pending: () => number} {
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
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = Math.max(now, due.at);
        if (timers.delete(due)) due.callback();
      }
      now = end;
    },
    pending: () => timers.size,
  };
}

/** Lets promises and I/O that are already due run. */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
}

/** Waits in real time, as a worker thread replies, until `check` holds, or fails after `ms`. */
export async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => { setTimeout(resolve, 5); });
  }
  await flush();
}

let sessions = 0;
/** A synthetic session's identity. */
export const identity = (sessionId = `session-${++sessions}`, provider: Identity['provider'] = 'claude'): Identity =>
  ({provider, client: provider === 'codex' ? 'cli' : 'code', hostId: 'host-sim', sourceId: 'source-sim', sessionId});

/** A `session/2.0` record with nothing outstanding unless overridden, fresh at `atMs`. */
export function session(overrides: Partial<SessionRecord> & {at?: number} = {}): SessionRecord {
  const {at = START_MS, ...rest} = overrides;
  const who = rest.identity ?? identity();
  return {
    id: sessionEntityId(who), revision: 1, generation: 1, identity: who, parent: {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'},
    activity: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [], ordering: {status: 'unknown'}, observedAtMs: at, lastEvidenceAtMs: at,
    freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}, ...rest,
  };
}
export const working = (overrides: Partial<SessionRecord> & {at?: number} = {}): SessionRecord => session({activity: 'active', ...overrides});
export const asking = (overrides: Partial<SessionRecord> & {at?: number} = {}): SessionRecord => session({
  activity: 'active', attention: [{id: {status: 'known', id: 'ask-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}], ...overrides,
});
export const notice = (acknowledgedBy: string[] = []): SessionRecord['notices'][number] =>
  ({id: 'notice-1', kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy});
export const finished = (overrides: Partial<SessionRecord> & {at?: number} = {}): SessionRecord => session({notices: [notice()], ...overrides});

export const PLAYBACK_ID = SIMULATED_SECTION.nowPlaying.playback;
/** A `playback/2.0` record: a track playing, unless overridden. */
export function playback(player: 'playing' | 'paused' | 'stopped' | 'inactive' | 'unknown' = 'playing', extra: Partial<PlaybackState> = {}, track: {title?: string; artist?: string} = {title: 'Harvest Moon', artist: 'Neil Young'}): PlaybackState {
  return {
    id: PLAYBACK_ID, revision: 1, availability: 'available', observedAtMs: START_MS,
    playback: {status: 'known', player, ...track, controls: player === 'playing' ? ['pause', 'next', 'previous'] : []}, ...extra,
  };
}
export const unavailablePlayback = (): PlaybackState => ({id: PLAYBACK_ID, revision: 1, availability: 'unavailable', playback: {status: 'unknown'}});

const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
const PLAYBACK_SCHEMA = 'https://bunny.invalid/events/playback/2.0';

/**
 * A stand-in owner of one family on the bus: it serves a sync of its records and publishes each change at a new revision.
 * `refuse` makes it refuse syncs, and `hold` makes its next sync wait until `release`.
 */
export class StandIn<T extends {id: string; revision: number}> {
  readonly #participant: Participant;
  readonly #family: 'session' | 'playback';
  readonly #records = new Map<string, T>();
  #revision = 0;
  refuse = false;
  #held: Promise<void> | undefined;
  #release: () => void = () => {};
  /** How many syncs it answered. */
  served = 0;

  constructor(participant: Participant, family: 'session' | 'playback') {
    this.#participant = participant;
    this.#family = family;
  }

  async open(records: readonly T[]): Promise<void> {
    for (const record of records) this.#records.set(record.id, this.#next(record));
    await this.#participant.serveSync([this.#family], async (): Promise<Snapshot | ErrorBody> => {
      await this.#held;
      if (this.refuse) return errorBody('unavailable', {detail: 'the stand-in owner is not serving'});
      this.served += 1;
      return {revision: this.#revision, states: [...this.#records.values()].map(record => this.#draft(record))};
    });
  }

  hold(): void {
    this.#held = new Promise(resolve => { this.#release = resolve; });
  }

  release(): void {
    this.#release();
    this.#held = undefined;
  }

  records(): T[] {
    return [...this.#records.values()];
  }

  /** Publishes the record's new state at a new revision. */
  async set(record: T): Promise<void> {
    const next = this.#next(record);
    this.#records.set(next.id, next);
    await this.#participant.publish(`bunny.state.${this.#family}.${next.id}`, {kind: 'state', ...this.#draft(next)});
  }

  #next(record: T): T {
    this.#revision += 1;
    return {...record, revision: this.#revision};
  }

  #draft(record: T): {type: string; subject: string; dataschema: string; data: T} {
    return this.#family === 'session' ?
      {type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record} :
      {type: 'org.bunny.playback.updated', subject: record.id, dataschema: PLAYBACK_SCHEMA, data: record};
  }
}

/** Whether a message is a Tidbyt device record. */
export const isDevice = (message: Message): boolean => message.dataschema === DEVICE_SCHEMA;

export type HostOptions = {
  /** The core's sessions at start. `absent` hosts no core, so the first sync of the sessions is refused. */
  sessions?: readonly SessionRecord[] | 'absent';
  /** The playback record at start, or `absent` for no playback owner. Defaults to none playing. */
  playback?: PlaybackState | 'absent';
  /** The module's section. Defaults to the simulated section with the API key's file. */
  section?: unknown;
  cloud?: SimulatedCloudOptions;
  module?: Omit<TidbytModuleOptions, 'transport'>;
  /** How many messages one subscription queue holds, so a test can overflow a copy. */
  maxQueued?: number;
  /** Runs before the module starts, such as to queue the cloud's answers. */
  before?: (cloud: SimulatedCloud) => void;
  /** Holds the core's first sync until `core.release()`; `host` then returns before the module's start has finished. */
  holdCore?: boolean;
};

export type Hosted = {
  harness: ModuleHarness;
  clock: ReturnType<typeof manualClock>;
  cloud: SimulatedCloud;
  core: StandIn<SessionRecord> | undefined;
  playback: StandIn<PlaybackState> | undefined;
  bus: InProcessBus;
  published: Message[];
  spans: RecordedSpans;
  /** The device records published so far, in order. */
  devices: () => DeviceRecord[];
  device: () => DeviceRecord;
  /** Every instance's log records, in order. */
  logs: () => HarnessRecord[];
  /** Moves the manual clock in steps of at most `stepMs`, letting each step's work settle. */
  advance: (ms: number, stepMs?: number) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  /** Every published message that breaks profile 2.0, and every failure of a module instance's timer, worker or stop. */
  problems: () => string[];
  stateDir: string;
  instances: ModuleHarness[];
  /** The first instance's start. */
  started: Promise<void>;
};

/** The module's section with the API key's file, as the runtime reads it. */
export const SECTION = {...SIMULATED_SECTION, nowPlaying: {...SIMULATED_SECTION.nowPlaying}, secrets: {token: '/nowhere/tidbyt-token'}};

/** The section without the now-playing tile, for tests of the status tile alone. */
export const STATUS_ONLY = (({nowPlaying: _nowPlaying, ...rest}) => rest)(SECTION);

/** Hosts the Tidbyt module with the simulated cloud on a manual clock, with stand-in owners for its two copies. */
export async function host(context: TestContext, options: HostOptions = {}): Promise<Hosted> {
  const clock = manualClock();
  const cloud = new SimulatedCloud({now: clock.now, ...options.cloud});
  const thrown: unknown[] = [];
  const spans = new RecordedSpans();
  const bus = new InProcessBus({
    now: clock.now, scheduler: clock.scheduler, spans, ...(options.maxQueued === undefined ? {} : {maxQueued: options.maxQueued}),
    onError: (error, {source}) => { if (source === 'bunny/modules/tidbyt') thrown.push(error); },
  });
  const stateDir = await mkdtemp(join(tmpdir(), 'tidbyt-module-'));
  const watcher = bus.connect('bunny/parts/watcher');
  const published: Message[] = [];
  await watcher.subscribe('bunny.*.*.*', message => { published.push(message); });
  let core: StandIn<SessionRecord> | undefined;
  if (options.sessions !== 'absent') {
    core = new StandIn<SessionRecord>(bus.connect('bunny/core'), 'session');
    await core.open(options.sessions ?? []);
  }
  let owner: StandIn<PlaybackState> | undefined;
  if (options.playback !== 'absent') {
    owner = new StandIn<PlaybackState>(bus.connect('bunny/modules/playback'), 'playback');
    await owner.open([options.playback ?? playback('stopped')]);
  }
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  // A worker answers in real time while a test moves the manual clock fast, so renders get a deadline no test reaches.
  const build = (): ModuleHarness => new ModuleHarness(createTidbytModule({transport: cloud.fetch, renderTimeoutMs: RENDER_TIMEOUT_MS, ...options.module}), {
    bus, stateDir, clock: {now: clock.now}, scheduler: clock.scheduler, spans, section: options.section ?? SECTION, secrets: {token: SIMULATED_API_KEY},
  });
  const instances: ModuleHarness[] = [];
  /**
   * Lets what is due run, and waits in real time for a render in progress, so the manual clock never races a worker
   * thread. A worker that never answers is left after a while.
   */
  const settled = async (): Promise<void> => {
    await flush();
    const deadline = performance.now() + 2000;
    while (hosted.harness.runningWorkers() > 0 && performance.now() < deadline) await new Promise(resolve => { setTimeout(resolve, 2); });
    await flush();
  };
  const hosted: Hosted = {
    harness: build(), clock, cloud, core, playback: owner, bus, published, spans, stateDir, instances, started: Promise.resolve(),
    devices: () => published.filter(isDevice).map(message => message.data as DeviceRecord),
    device: () => {
      const last = hosted.devices().at(-1);
      if (last === undefined) throw new Error('no device record was published');
      return last;
    },
    logs: () => instances.flatMap(instance => instance.logs),
    advance: async (ms, stepMs = 100) => {
      await settled();
      for (let moved = 0; moved < ms; moved += stepMs) {
        clock.advance(Math.min(stepMs, ms - moved));
        await settled();
      }
    },
    start: async () => {
      hosted.harness = build();
      instances.push(hosted.harness);
      await hosted.harness.start();
      await flush();
    },
    stop: () => hosted.harness.stop(),
    restart: async () => {
      await hosted.harness.stop();
      await hosted.start();
    },
    problems: () => {
      const invalid = published.flatMap(message => {
        const result = validator.validate(message);
        return result.ok ? [] : [`${message.type}: ${result.error.code} ${result.error.detail ?? ''}`];
      });
      return [...invalid, ...thrown.map(error => `a handler threw ${String(error)}`), ...instances.flatMap(instance => instance.failures.map(String))];
    },
  };
  instances.push(hosted.harness);
  options.before?.(cloud);
  context.after(async () => {
    await hosted.harness.stop();
    await watcher.close();
    await rm(stateDir, {recursive: true, force: true});
  });
  if (options.holdCore === true) core?.hold();
  hosted.started = hosted.harness.start();
  if (options.holdCore !== true) await hosted.started;
  await flush();
  return hosted;
}

/** The pushes the cloud accepted for one installation, and the frame it shows. */
export const shown = (hosted: Hosted, installation: string): {pushes: number; picture: string[]; pushedAtMs: number[]} =>
  hosted.cloud.state().installations[installation] ?? {pushes: 0, picture: [], pushedAtMs: []};

/** The calls the cloud heard, as `<method> <installation or list>`. */
export const calls = (hosted: Hosted): string[] =>
  hosted.cloud.state().calls.map(call => `${call.method} ${call.installation ?? (call.method === 'GET' ? 'list' : 'default')}`);

/**
 * The module's log records of one event, as `<level> <fields>` with the fields that tell them apart. Records of the
 * playback copy, which a host without a playback owner always has, are left out unless `feeds` is set.
 */
export const records = (hosted: Hosted, event: string, feeds = false): string[] => hosted.logs().filter(entry =>
  entry.event === event && (feeds || entry.fields['bunny.participant'] !== 'bunny/modules/playback')).map(entry => {
  const {fields} = entry;
  const parts = ['bunny.operation', 'bunny.operation.id', 'bunny.code', 'bunny.participant', 'bunny.attempt_count'].flatMap(key =>
    fields[key] === undefined ? [] : [String(fields[key])]);
  return [entry.level, ...parts].join(' ');
});
