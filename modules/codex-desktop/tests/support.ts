// What the Codex Desktop module's tests share (Hub #926): a manual clock, the module hosted in the kit's `ModuleHarness`
// on its own bus with a simulated marker, and a stand-in core that serves sessions and, when asked, takes each read
// observation as the core's reducer would, at a new revision, or refuses the next few as a core whose store failed would.
// Every message the bus carries is checked against profile 2.0 with the core families.
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type Identity, type LifecycleObservation, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type Cancel, type Participant, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCodexDesktopModule, SimulatedMarker, type MarkerTransport} from '../src/index.js';

export const START_MS = Date.parse('2026-10-07T12:00:00.000Z');
/** The module's section: the Codex home is a synthetic path, which only a real reader would read. */
export const SECTION = {home: '/home/owner/.codex', hostId: 'host', sourceId: 'desktop'};
const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';

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

export type SessionShape = {
  provider?: Identity['provider']; client?: Identity['client']; hostId?: string; sourceId?: string;
  /** The session's parent: a known one makes it a subagent. */
  parent?: SessionRecord['parent'];
  activity?: SessionRecord['activity'];
  read?: SessionRecord['read'];
  /** When its last lifecycle evidence came. */
  lastEvidenceAtMs?: number;
};

export const identityOf = (sessionId: string, shape: SessionShape = {}): Identity => ({
  provider: shape.provider ?? 'codex', client: shape.client ?? 'desktop', hostId: shape.hostId ?? SECTION.hostId, sourceId: shape.sourceId ?? SECTION.sourceId, sessionId,
});

/** A valid `session/2.0` record for one session with a finished turn, at `revision`. */
export function sessionRecord(sessionId: string, revision: number, atMs: number, shape: SessionShape = {}): SessionRecord {
  const identity = identityOf(sessionId, shape);
  const evidenceAtMs = shape.lastEvidenceAtMs ?? atMs;
  return {
    id: sessionEntityId(identity), revision, generation: 1, identity, parent: shape.parent ?? {status: 'top-level'}, turn: {status: 'known', id: 'turn-1'},
    activity: shape.activity ?? 'idle', attention: [], notices: [], read: shape.read ?? 'unknown', unavailable: [], ordering: {status: 'unknown'},
    observedAtMs: evidenceAtMs, lastEvidenceAtMs: evidenceAtMs, freshness: atMs - evidenceAtMs >= 300_000 ? 'uncertain' : 'current', restartUncertain: false,
    children: {active: 0, uncertain: 0},
  };
}

export type WorldOptions = {
  transport?: MarkerTransport;
  section?: unknown;
  /** Whether the stand-in core takes each read observation into its record, as the core's reducer would. Defaults to true. */
  reduce?: boolean;
};

/** The Codex Desktop module on its own bus, with a simulated marker and a stand-in core, on a manual clock. */
export class World {
  readonly clock = manualClock();
  readonly bus: InProcessBus;
  readonly marker = new SimulatedMarker();
  /** Every message published on the bus, in order. */
  readonly published: Message[] = [];
  /** Messages that broke profile 2.0, and where. */
  readonly invalid: string[] = [];
  readonly errors: unknown[] = [];
  /** The stand-in core's sessions, by entity ID. */
  readonly sessions = new Map<string, SessionRecord>();
  readonly #validator = new MessageValidator();
  readonly #options: WorldOptions;
  readonly dir: string;
  readonly hosted: ModuleHarness[] = [];
  #revision = 0;
  #core: Participant | undefined;
  /** How many more read observations the stand-in core refuses, leaving the record as it was. */
  #refusing = 0;

  private constructor(dir: string, options: WorldOptions) {
    this.dir = dir;
    this.#options = options;
    registerCoreFamilies(this.#validator);
    this.bus = new InProcessBus({now: this.clock.now, scheduler: this.clock.scheduler, onError: error => { this.errors.push(error); }});
  }

  static async open(options: WorldOptions = {}): Promise<World> {
    const world = new World(await mkdtemp(join(tmpdir(), 'codex-desktop-module-')), options);
    const watcher = world.bus.connect('bunny/test/watcher');
    await watcher.subscribe('bunny.*.*.*', message => {
      const result = world.#validator.validate(message);
      if (!result.ok) world.invalid.push(`${message.type}: ${result.error.code} ${result.error.detail ?? ''}`);
      world.published.push(message);
    });
    await world.#serveCore();
    await world.start();
    return world;
  }

  get harness(): ModuleHarness {
    const current = this.hosted.at(-1);
    if (current === undefined) throw new Error('no module started');
    return current;
  }

  async start(): Promise<void> {
    const harness = new ModuleHarness(createCodexDesktopModule({transport: this.#options.transport ?? this.marker}), {
      bus: this.bus, stateDir: this.dir, clock: {now: this.clock.now}, scheduler: this.clock.scheduler, section: this.#options.section ?? SECTION,
    });
    this.hosted.push(harness);
    await harness.start();
    await flush();
  }

  /** Publishes a session's record from the stand-in core at a new revision. */
  async session(sessionId: string, shape: SessionShape = {}): Promise<SessionRecord> {
    this.#revision += 1;
    return this.#put(sessionRecord(sessionId, this.#revision, this.clock.now(), shape));
  }

  /** Has the stand-in core refuse the next `count` read observations, as the core does while its store fails. */
  refuseNext(count: number): void {
    this.#refusing = count;
  }

  /** The record of one session, as the stand-in core holds it now. */
  record(sessionId: string, shape: SessionShape = {}): SessionRecord | undefined {
    return this.sessions.get(sessionEntityId(identityOf(sessionId, shape)));
  }

  /** The read observations the module published, oldest first, as `<session ID> <state>`. */
  evidence(): string[] {
    return this.published.filter(message => message.type === 'org.bunny.lifecycle.observed').map(message => {
      const {identity, event} = message.data as unknown as LifecycleObservation;
      return `${identity.sessionId} ${event.kind === 'read-observed' ? event.state : event.kind}`;
    });
  }

  /** The module's log records of `event`, from every instance this world hosted. */
  logs(event: string): ModuleHarness['logs'] {
    return this.hosted.flatMap(harness => harness.logs).filter(entry => entry.event === event);
  }

  async close(): Promise<void> {
    for (const harness of this.hosted) await harness.stop();
    await this.#core?.close();
    await rm(this.dir, {recursive: true, force: true});
  }

  async #put(record: SessionRecord): Promise<SessionRecord> {
    this.sessions.set(record.id, record);
    await this.#core?.publish(`bunny.state.session.${record.id}`, {kind: 'state', type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record});
    await flush();
    return record;
  }

  /** The stand-in core: it serves the sessions and, unless told not to, takes each read observation into its record. */
  async #serveCore(): Promise<void> {
    const core = this.bus.connect('bunny/core');
    this.#core = core;
    await core.serveSync(['session'], () => ({
      revision: this.#revision,
      states: [...this.sessions.values()].map(record => ({type: 'org.bunny.session.updated', subject: record.id, dataschema: SESSION_SCHEMA, data: record})),
    }));
    await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', async message => {
      if (this.#options.reduce === false || message.data.event.kind !== 'read-observed') return;
      if (this.#refusing > 0) {
        this.#refusing -= 1;
        return;
      }
      const record = this.sessions.get(message.subject);
      if (record === undefined) return;
      this.#revision += 1;
      await this.#put({...record, revision: this.#revision, read: message.data.event.state});
    });
  }
}
