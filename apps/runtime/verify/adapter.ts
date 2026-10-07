// The run adapter of the runtime's scenario catalog (Hub #920, tier 2): the catalog's `Harness` over a disposable run.
// The scenario's parts are remote parts, each with its run-generated grant, connected to the run's SDK edge; the
// simulated devices, the run's controls, its log records and what its bus published come from the run's harness API.
// Time is real. The catalog's reads are synchronous, so the adapter keeps a copy of the run's state, refreshed on every
// wait and after every action, and the harness API's flush makes that copy current. `disconnect` has the runtime's edge
// end the part's stream, and the same remote part reconnects on its own, as in the in-memory harness; its timers wait
// until the next wait, as the in-memory harness's wait until virtual time moves, so it stays away for the steps between.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SimulatedSpeakers} from '@jimmie-potts/playback';
import {connectRemote, type CommandDraft, type Participant, type Scheduler} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE, HEALTH_PATH, type LogRecord, type ModuleHealth, type RuntimeHealth} from '../src/index.js';
import {ROLES, type DeviceStates, type Generational, type Harness, type Role, type Seed, type Simulation} from '../tests/scenarios/catalog.js';
import {Reader, answerOf, describe, follow, scenarioValidator, sourceOf} from '../tests/scenarios/parts.js';
import {HARNESS_PATH, type HarnessState} from './protocol.js';
import {stateDirOf} from './seed.js';

/** Where a run adapter finds the run: its runtime's URL, its harness endpoint and its data directory. */
export type RunTarget = {url: string; harness: string; dataDir: string; seed: Seed};
export interface RunHarness extends Harness {
  /** What went wrong outside the steps: messages that break profile 2.0, and errors a part reported. */
  problems(): readonly string[];
  close(): Promise<void>;
}

/** How long a remote part whose stream was lost waits before it reconnects. */
const RECONNECT_MS = 50;
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/**
 * A remote part's scheduler on real timers, which the adapter can hold: a callback scheduled while it is held, such as
 * the reconnect after a dropped stream, starts its delay only once it is released.
 */
class HeldScheduler implements Scheduler {
  #held = false;
  readonly #waiting = new Set<{delayMs: number; callback: () => void; cancel?: () => void}>();

  after(delayMs: number, callback: () => void): () => void {
    if (!this.#held) {
      const timer = setTimeout(callback, delayMs);
      return () => { clearTimeout(timer); };
    }
    const entry: {delayMs: number; callback: () => void; cancel?: () => void} = {delayMs, callback};
    this.#waiting.add(entry);
    return () => { if (!this.#waiting.delete(entry)) entry.cancel?.(); };
  }

  hold(): void {
    this.#held = true;
  }

  release(): void {
    this.#held = false;
    for (const entry of [...this.#waiting]) {
      this.#waiting.delete(entry);
      const timer = setTimeout(entry.callback, entry.delayMs);
      entry.cancel = () => { clearTimeout(timer); };
    }
  }
}

/** The run's grants, by source, from the state directory. They are never printed. */
export async function readGrants(dataDir: string): Promise<Map<string, string>> {
  const document = JSON.parse(await readFile(join(stateDirOf(dataDir), EDGE_GRANTS_FILE), 'utf8')) as {grants: {source: string; token: string}[]};
  return new Map(document.grants.map(({source, token}) => [source, token]));
}

type Part = {role: Role; participant: Participant | undefined; closed: boolean; scheduler: HeldScheduler};

class Run implements RunHarness {
  readonly tier = 'run';
  readonly transport = 'remote';
  readonly reader: Reader;
  readonly #target: RunTarget;
  readonly #grants: Map<string, string>;
  readonly #parts: ReadonlyMap<Role, Part>;
  readonly #validator = scenarioValidator();
  readonly #answers = new Map<string, string>();
  readonly #problems: string[] = [];
  /** Parts whose stream was dropped; their timers wait until the next wait. */
  readonly #held: Part[] = [];
  /** The runtime's origin: the run's URL names its health page. */
  readonly #origin: string;
  #state: HarnessState = {
    generation: 0, devices: {
      lamp: {power: {}, indicator: 'idle', held: false, calls: []}, chime: {rings: []}, sign: {online: false, shown: {}, attempts: 0, refused: 0},
      playback: new SimulatedSpeakers().state(),
    },
    logs: [], published: [],
  };
  /** Actions run one after another in the order the scenario calls them. */
  #actions: Promise<unknown> = Promise.resolve();
  /** Refreshes run one after another, so two never append the same records. */
  #refreshing: Promise<void> = Promise.resolve();

  constructor(target: RunTarget, grants: Map<string, string>) {
    this.#target = target;
    this.#grants = grants;
    this.#origin = new URL(target.url).origin;
    this.reader = new Reader(target.seed.follows);
    this.#parts = new Map(ROLES.map(role => [role, {role, participant: undefined, closed: false, scheduler: new HeldScheduler()}]));
  }

  async open(): Promise<void> {
    await this.#refresh();
    for (const part of this.#parts.values()) await this.#connect(part);
  }

  now(): number {
    return Date.now();
  }

  generation(): number {
    return this.#state.generation;
  }

  sdk(role: Role): Participant {
    const {participant} = this.#part(role);
    if (participant === undefined) throw new Error(`the ${role} is not connected`);
    return participant;
  }

  send(role: Role, label: string, {key, draft}: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string> {
    this.#answers.set(label, 'pending');
    // The request starts in its turn among the actions; its answer may come long after the next action began.
    const started = this.#act(() => Promise.resolve({request: this.sdk(role).request(key, draft, options)}));
    return started.then(({request}) => request).then(answerOf, (error: unknown) => `threw ${describe(error)}`).then(async answer => {
      // What the run published before the answer is in the copy before the scenario reads it.
      await this.#refresh();
      this.#answers.set(label, answer);
      return answer;
    });
  }

  answer(label: string): string {
    return this.#answers.get(label) ?? 'unsent';
  }

  devices(): DeviceStates {
    return this.#state.devices;
  }

  simulate(simulation: Simulation): void {
    void this.#act(() => this.#post('simulate', simulation));
  }

  async health(): Promise<readonly ModuleHealth[]> {
    await this.#actions;
    const response = await fetch(new URL(HEALTH_PATH, this.#origin));
    if (!response.ok) throw new Error(`health answered ${response.status}`);
    return (await response.json() as RuntimeHealth).modules;
  }

  logs(): readonly Generational<{record: LogRecord}>[] {
    return this.#state.logs;
  }

  published(): readonly Generational<{message: Message}>[] {
    return this.#state.published;
  }

  async wait(ms: number): Promise<void> {
    await this.#actions;
    for (const part of this.#held.splice(0)) part.scheduler.release();
    await sleep(ms);
    await this.#refresh();
  }

  /** The runtime's edge ends the part's stream; the same remote part reconnects once the next wait releases its timers. */
  disconnect(role: Role): Promise<void> {
    return this.#act(async () => {
      await this.#refresh();
      const part = this.#part(role);
      part.scheduler.hold();
      this.#held.push(part);
      await this.#post('disconnect', {source: sourceOf(role)});
    });
  }

  closePart(role: Role): Promise<void> {
    return this.#act(async () => {
      const part = this.#part(role);
      part.closed = true;
      await this.#retire(part);
    });
  }

  armCrash(): void {
    void this.#act(() => this.#post('arm-crash'));
  }

  loseAcknowledgment(): void {
    void this.#act(() => this.#post('lose-acknowledgment'));
  }

  async restart(): Promise<void> {
    await this.#act(() => this.#post('restart'));
    await this.#refresh();
  }

  problems(): readonly string[] {
    return this.#problems;
  }

  async close(): Promise<void> {
    await this.#actions.catch(() => {});
    for (const part of this.#parts.values()) {
      part.closed = true;
      part.scheduler.release();
      await this.#retire(part);
    }
  }

  #act<T>(action: () => Promise<T>): Promise<T> {
    const done = this.#actions.then(action);
    this.#actions = done.catch((error: unknown) => { this.#problems.push(`an action failed: ${describe(error)}`); });
    return done;
  }

  async #post(route: string, body: object = {}): Promise<void> {
    const response = await fetch(new URL(`${HARNESS_PATH}/${route}`, this.#target.harness), {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  }

  /** Brings the copy of the run's state up to date: the harness flushes the runtime before it answers. */
  #refresh(): Promise<void> {
    const refreshed = this.#refreshing.then(() => this.#fetchState());
    this.#refreshing = refreshed.catch(() => {});
    return refreshed;
  }

  async #fetchState(): Promise<void> {
    const url = new URL(`${HARNESS_PATH}/state`, this.#target.harness);
    url.searchParams.set('logs', String(this.#state.logs.length));
    url.searchParams.set('published', String(this.#state.published.length));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`state answered ${response.status}`);
    const state = await response.json() as HarnessState;
    for (const {message} of state.published) this.#check(message, 'a published message');
    this.#state = {...state, logs: [...this.#state.logs, ...state.logs], published: [...this.#state.published, ...state.published]};
  }

  async #connect(part: Part): Promise<void> {
    if (part.closed) return;
    const source = sourceOf(part.role);
    const token = this.#grants.get(source);
    if (token === undefined) throw new Error(`the run has no grant for ${source}`);
    part.participant = await connectRemote({
      url: this.#origin, source, token, reconnectDelayMs: RECONNECT_MS, scheduler: part.scheduler,
      onError: (error, scope) => {
        // While a runtime restarts, a remote part's reconnects meet a closed port or an edge still starting.
        if (scope.pattern !== 'stream') this.#problems.push(`${scope.source} on ${scope.pattern}: ${describe(error)}`);
      },
    });
    if (part.role === 'reader') {
      await follow(part.participant, this.reader, this.#target.seed.follows, {
        check: (message, where) => { this.#check(message, where); }, problem: text => { this.#problems.push(text); },
      });
    }
  }

  async #retire(part: Part): Promise<void> {
    const {participant} = part;
    part.participant = undefined;
    if (part.role === 'reader') this.reader.copies = [];
    await participant?.close();
  }

  #part(role: Role): Part {
    const part = this.#parts.get(role);
    if (part === undefined) throw new Error(`no part ${role}`);
    return part;
  }

  #check(message: unknown, where: string): void {
    const result = this.#validator.validate(message);
    if (!result.ok) this.#problems.push(`${where}: ${result.error.code} ${result.error.detail ?? ''}`);
  }
}

/** Connects the scenario's parts to a run, each with its grant, and syncs the reader's copies. */
export async function connectRun(target: RunTarget): Promise<RunHarness> {
  const run = new Run(target, await readGrants(target.dataDir));
  try {
    await run.open();
  } catch (error) {
    await run.close();
    throw error;
  }
  return run;
}
