// The run adapter of the runtime's scenario catalog (Hub #920, tier 2): the catalog's `Harness` over a disposable run.
// The scenario's parts are remote parts, each with its run-generated grant, connected to the run's SDK edge; the
// simulated devices, the run's controls, its log records and what its bus published come from the run's harness API.
// Time is real, unless the run is on virtual time (Hub #1710): then `now` is the run's virtual time and `wait` advances
// it through the harness API, and the parts run on a manual clock that moves with it. The catalog's reads are
// synchronous, so the adapter keeps a copy of the run's state, refreshed on every wait and after every action, and the
// harness API's flush makes that copy current. `disconnect` has the runtime's edge
// end the part's stream, and the same remote part reconnects on its own, as in the in-memory harness; its timers wait
// until the next wait, as the in-memory harness's wait until virtual time moves, so it stays away for the steps between.
// What it reports goes into a capture's proof, so a failure is named by its registry code, its type or the adapter's own
// fixed text, never by an exception's message (ADR 0012, "Safe errors"; Hub #954).
import {readFile} from 'node:fs/promises';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {connectRemote, type CommandDraft, type Diagnostic, type Participant, type Scheduler} from '@jimmie-potts/sdk';
import {HEALTH_PATH, type LogRecord, type ModuleHealth, type RuntimeHealth} from '../src/index.js';
import {
  ROLES, StepFailure, failureOf, type DeviceStates, type GatewayAnswer, type GatewayCall, type Generational, type Harness, type HookPayload, type HookRun, type Role, type Seed,
  type Simulation,
} from '../tests/scenarios/framework.js';
import {
  GatewayClient, Reader, actionAnswerOf, actionCall, answerOf, follow, runHookScript, scenarioValidator, sourceOf, type ReaderMark,
} from '../tests/scenarios/parts.js';
import {manualClock} from '../tests/scenarios/virtual-time.js';
import {HARNESS_PATH, type ClockState, type HarnessState} from './protocol.js';
import {partTokensOf, producerOf} from './seed.js';

/**
 * Where a run adapter finds the run: its runtime's URL, its harness endpoint and its data directory. `resyncWithinMs`
 * bounds how long a restart waits for the reader to come back (`RESYNC_WITHIN_MS` unless given).
 */
export type RunTarget = {url: string; harness: string; dataDir: string; seed: Seed; resyncWithinMs?: number};
export interface RunHarness extends Harness {
  /** Which clock the run is on (Hub #1710), which a capture's proof records. */
  readonly clock: 'virtual' | 'real';
  /** What went wrong outside the steps: messages that break profile 2.0, and errors a part reported. */
  problems(): readonly string[];
  close(): Promise<void>;
}

/** A failure of the adapter's own, with fixed text from the code that raised it, which a step's detail keeps. */
export class RunFailure extends StepFailure {}

/**
 * How the adapter names a failure in a step's answer or its problems, which the proof keeps: as a step does, by its own
 * fixed text, an SDK refusal's registry code or the exception's type, never by the exception's text.
 */
export {failureOf};

/** How long a remote part whose stream was lost waits before it reconnects. */
const RECONNECT_MS = 50;
/** How long the supervisor holds the runtime stopped while a hook runs against it (Hub #926). */
const STOPPED_HOLD_MS = 4000;
/**
 * How long a restart waits for the reader to be back in sync (Hub #1697). The reader's reconnect backoff is at most 5 s
 * between attempts, so this leaves room for a slow start and the resync after it.
 */
export const RESYNC_WITHIN_MS = 15_000;
/** How often a restart looks again whether the reader is back in sync. */
const RESYNC_POLL_MS = 25;
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });

/** Real timers, which a remote part's scheduler uses on the real clock. */
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/**
 * A remote part's scheduler on real timers, or on the parts' manual clock in a run on virtual time, which the adapter
 * can hold: a callback scheduled while it is held, such as the reconnect after a dropped stream, starts its delay only
 * once it is released.
 */
class HeldScheduler implements Scheduler {
  #held = false;
  readonly #waiting = new Set<{delayMs: number; callback: () => void; cancel?: () => void}>();
  readonly #base: Scheduler;

  constructor(base: Scheduler) {
    this.#base = base;
  }

  after(delayMs: number, callback: () => void): () => void {
    if (!this.#held) return this.#base.after(delayMs, callback);
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
      entry.cancel = this.#base.after(entry.delayMs, entry.callback);
    }
  }
}

/** The parts' run-generated tokens, by role, and the agent hooks' producer token (Hub #926). */
export type PartTokens = Record<Role, string> & {producer: string};
/** The parts' run-generated tokens from the run's private token file. They are never printed. */
export async function readPartTokens(dataDir: string): Promise<PartTokens> {
  return JSON.parse(await readFile(partTokensOf(dataDir), 'utf8')) as PartTokens;
}

/** The parts' tokens by source. They are never printed. */
export async function readGrants(dataDir: string): Promise<Map<string, string>> {
  const tokens = await readPartTokens(dataDir);
  return new Map(ROLES.map(role => [sourceOf(role), tokens[role]]));
}

type Part = {role: Role; participant: Participant | undefined; closed: boolean; scheduler: HeldScheduler};

/**
 * A run on virtual time, as the adapter follows it (Hub #1710). The parts' manual clock is the adapter's own time; the
 * run's time trails it by `owed`, which a wait adds while no timer is due and nothing is in flight anywhere, and which is
 * sent to the run before anything else reaches it. `runNext` is when the run's next timer is due, and `quiet` whether
 * the last advance found nothing in flight and changed nothing the adapter can read.
 */
type Virtual = {clock: ReturnType<typeof manualClock>; owed: number; runNext: number | undefined; quiet: boolean};

/** How many event-loop turns the adapter gives the parts' streams after each advance of the run, as the in-memory harness gives real I/O. */
const TURNS = 4;
const turns = async (): Promise<void> => {
  for (let turn = 0; turn < TURNS; turn += 1) await new Promise(resolve => { setImmediate(resolve); });
};
class Run implements RunHarness {
  readonly tier = 'run';
  readonly transport = 'remote';
  readonly reader: Reader;
  readonly #target: RunTarget;
  readonly #grants: Map<string, string>;
  /** The parts, which `open` creates once it knows the run's clock. */
  #parts: ReadonlyMap<Role, Part>;
  readonly #validator = scenarioValidator();
  readonly #answers = new Map<string, string>();
  readonly #problems: string[] = [];
  /** Parts whose stream was dropped; their timers wait until the next wait. */
  readonly #held: Part[] = [];
  /** The runtime's origin: the run's URL names its health page. */
  readonly #origin: string;
  /** The run's state, which `open` reads before any step: until then, the fixture modules' devices only, as they start. */
  #state: HarnessState = {
    generation: 0, devices: {
      lamp: {power: {}, indicator: 'idle', held: false, calls: []}, chime: {rings: []}, sign: {online: false, shown: {}, attempts: 0, refused: 0},
    },
    logs: [], published: [],
  };
  /** Actions run one after another in the order the scenario calls them. */
  #actions: Promise<unknown> = Promise.resolve();
  /** Refreshes run one after another, so two never append the same records. */
  #refreshing: Promise<boolean> = Promise.resolve(false);
  /** The run's virtual time, or undefined on the real clock, which `open` learns from the harness API. */
  #virtual: Virtual | undefined;
  /** Calls to the run that are still waiting for their answer, such as a request whose reply comes later. */
  #inFlight = 0;
  /** On virtual time, the parts whose stream is lost until they reconnect, which they do over real I/O. */
  readonly #away = new Set<Role>();

  readonly #client: GatewayClient;

  constructor(target: RunTarget, tokens: PartTokens) {
    this.#target = target;
    this.#grants = new Map(ROLES.map(role => [sourceOf(role), tokens[role]]));
    this.#origin = new URL(target.url).origin;
    this.#client = new GatewayClient(() => this.#origin, tokens, tokens.producer);
    this.reader = new Reader(target.seed.follows);
    this.#parts = new Map();
  }

  async open(): Promise<void> {
    const clock = await fetch(new URL(`${HARNESS_PATH}/clock`, this.#target.harness));
    if (clock.status === 200) {
      const state = await clock.json() as ClockState;
      this.#virtual = {clock: manualClock(state.nowMs), owed: 0, runNext: state.nextDueMs ?? undefined, quiet: false};
    } else {
      await clock.body?.cancel();
      if (clock.status !== 409) throw new RunFailure(`clock answered ${clock.status}`);
    }
    const base = this.#virtual?.clock.scheduler ?? timers;
    this.#parts = new Map(ROLES.map(role => [role, {role, participant: undefined, closed: false, scheduler: new HeldScheduler(base)}]));
    await this.#refresh();
    for (const part of this.#parts.values()) await this.#connect(part);
  }

  /** Which clock the run is on, which a capture's proof records. */
  get clock(): 'virtual' | 'real' {
    return this.#virtual === undefined ? 'real' : 'virtual';
  }

  now(): number {
    return this.#virtual?.clock.now() ?? Date.now();
  }

  generation(): number {
    return this.#state.generation;
  }

  sdk(role: Role): Participant {
    const participant = this.#connected(role);
    return this.#virtual === undefined ? participant : this.#caughtUp(participant);
  }

  #connected(role: Role): Participant {
    const {participant} = this.#part(role);
    if (participant === undefined) throw new RunFailure(`the ${role} is not connected`);
    return participant;
  }

  send(role: Role, label: string, {key, draft}: {key: string; draft: CommandDraft<object>}, options: {timeoutMs: number; requestId: string}): Promise<string> {
    this.#answers.set(label, 'pending');
    // The request starts in its turn among the actions; its answer may come long after the next action began.
    const started = this.#act(() => Promise.resolve({request: this.#tracked(this.#connected(role).request(key, draft, options))}));
    return started.then(({request}) => request).then(answerOf, (error: unknown) => `threw ${failureOf(error)}`).then(async answer => {
      // What the run published before the answer is in the copy before the scenario reads it.
      await this.#refresh();
      this.#answers.set(label, answer);
      return answer;
    });
  }

  dispatch(role: Role, label: string, command: {key: string; draft: CommandDraft<object>}, requestId: string): Promise<string> {
    this.#answers.set(label, 'pending');
    // The action starts in its turn among the actions; its answer may come long after the next action began. An HTTP
    // call whose connection a crash ended is `lost`: its fate is the tracker's to know.
    const started = this.#act(() => Promise.resolve({call: this.#tracked(this.#client.call(actionCall(role, command, requestId)))}));
    return started.then(({call}) => call).then(actionAnswerOf, () => 'lost').then(async answer => {
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
    await this.#catchUp();
    const response = await fetch(new URL(HEALTH_PATH, this.#origin));
    if (!response.ok) throw new RunFailure(`health answered ${response.status}`);
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
    if (this.#virtual !== undefined) return this.#advance(this.#virtual, ms);
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

  /**
   * Restarts the runtime and resolves once the reader is back in sync with the new one (Hub #1697): its stream open
   * again, its subscriptions registered again and each copy caught up. Otherwise a next restart could stop the runtime
   * while the reader is still coming back, and a copy whose resync that refuses stops for good.
   */
  async restart(): Promise<void> {
    const mark = await this.#act(async () => {
      const before = this.#readerMark();
      await this.#post('restart');
      return before;
    });
    // The restart ended the browser's session with the runtime that opened it.
    this.#client.forget();
    await this.#refresh();
    await this.#resynced(mark);
  }

  async gateway(call: GatewayCall): Promise<GatewayAnswer> {
    await this.#actions;
    await this.#catchUp();
    const answer = await this.#tracked(this.#client.call(call));
    // What the call made the runtime log or publish is in the copy before the scenario reads it.
    await this.#refresh();
    return answer;
  }

  /**
   * Runs the hook script against the run's runtime, with the producer file the supervisor wrote. While it runs
   * `stopped`, the supervisor holds the runtime stopped: the adapter asks for a restart that waits before it starts the
   * runtime again, and runs the hook once the runtime's port refuses connections. On virtual time the restart's hold
   * passes at once, so the restart also waits for the adapter's release, which it sends once the hook has run (Hub #1711).
   */
  async hook(payload: HookPayload, {runtime = 'running'}: {runtime?: 'running' | 'stopped'} = {}): Promise<HookRun> {
    await this.#actions;
    await this.#catchUp();
    const producer = producerOf(this.#target.dataDir);
    if (runtime === 'running') {
      const ran = await runHookScript(producer, payload);
      await this.#refresh();
      return ran;
    }
    const v = this.#virtual;
    const restarted = this.#post('restart', {holdMs: STOPPED_HOLD_MS, ...(v === undefined ? {} : {untilReleased: true})});
    // Until the restart's answer, the run's refresh would wait on the stopped runtime; a failed restart fails the hook.
    restarted.catch(() => {});
    const deadline = Date.now() + STOPPED_HOLD_MS;
    while (await fetch(new URL(HEALTH_PATH, this.#origin)).then(() => true, () => false)) {
      if (Date.now() > deadline) throw new RunFailure('the runtime did not stop');
      await sleep(25);
    }
    let ran: HookRun;
    try {
      ran = await runHookScript(producer, payload);
    } finally {
      if (v !== undefined) await this.#post('release');
    }
    await restarted;
    // On virtual time the hold moved the run's time on; the parts' clock follows it, which fires their timers due by then.
    if (v !== undefined) await this.#followRun(v);
    // The restart ended the browser's session with the runtime that opened it.
    this.#client.forget();
    await this.#refresh();
    return ran;
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
    const done = this.#actions.then(async () => {
      await this.#catchUp();
      return action();
    });
    this.#actions = done.catch((error: unknown) => { this.#problems.push(`an action failed: ${failureOf(error)}`); });
    return done;
  }

  async #post(route: string, body: object = {}): Promise<void> {
    const response = await fetch(new URL(`${HARNESS_PATH}/${route}`, this.#target.harness), {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
    });
    if (!response.ok) throw new RunFailure(`${route} answered ${response.status}`);
  }

  /**
   * Brings the copy of the run's state up to date: the harness flushes the runtime before it answers. Resolves with
   * whether anything the scenario can read changed.
   */
  #refresh(): Promise<boolean> {
    const refreshed = this.#refreshing.then(() => this.#fetchState());
    this.#refreshing = refreshed.catch(() => false);
    return refreshed;
  }

  /**
   * Lets `ms` of virtual time pass (Hub #1710), split at the parts' own timers, which fire once the run has reached
   * them. A piece in which no timer of the run or the parts is due, after an advance that found nothing in flight and
   * changed nothing, and with no call waiting for its answer, passes without a call to the run: it is owed, and sent with
   * the next advance or before anything else reaches the run. Every other piece is one advance, then a few turns of the
   * event loop for the parts' streams, then a refresh.
   */
  async #advance(v: Virtual, ms: number, local = true): Promise<void> {
    const target = v.clock.now() + ms;
    while (v.clock.now() < target) {
      const due = v.clock.next();
      const end = due === undefined || due === Number.POSITIVE_INFINITY ? target : Number.isFinite(due) ? Math.max(v.clock.now(), Math.min(target, due)) : v.clock.now();
      const step = end - v.clock.now();
      const idle = local && v.quiet && this.#inFlight === 0 && this.#away.size === 0 && (due === undefined || due > end) && (v.runNext === undefined || end < v.runNext);
      if (idle) {
        v.owed += step;
        v.clock.advance(step);
        continue;
      }
      await this.#advanceRun(v, v.owed + step);
      v.clock.advance(step);
      await turns();
      const changed = await this.#refresh();
      // A part's timer that fired, such as a reconnect, starts work the run's answer could not see.
      v.quiet &&= !changed && (due === undefined || due > end);
    }
  }

  /** Moves the run's virtual time on by `ms` and takes what its answer says. Time the run did not reach stays owed. */
  async #advanceRun(v: Virtual, ms: number): Promise<void> {
    const before = v.clock.now() - v.owed;
    const response = await fetch(new URL(`${HARNESS_PATH}/clock/advance`, this.#target.harness), {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ms}),
    });
    if (!response.ok) throw new RunFailure(`clock/advance answered ${response.status}`);
    const state = await response.json() as ClockState;
    const reached = state.nowMs - before;
    v.owed = Math.max(0, v.owed + (ms - v.owed) - reached);
    v.runNext = state.nextDueMs ?? undefined;
    v.quiet = !state.busy && reached === ms;
  }

  /** Moves the parts' clock to the run's time after the run moved without the adapter, as a restart's hold moves it. */
  async #followRun(v: Virtual): Promise<void> {
    const response = await fetch(new URL(`${HARNESS_PATH}/clock`, this.#target.harness));
    if (!response.ok) throw new RunFailure(`clock answered ${response.status}`);
    const state = await response.json() as ClockState;
    const ahead = state.nowMs - (v.clock.now() - v.owed);
    if (ahead > 0) v.clock.advance(ahead);
    v.runNext = state.nextDueMs ?? undefined;
    v.quiet = false;
  }

  /** On virtual time, sends the run the time it is owed, so that what reaches it next happens at the adapter's time. */
  async #catchUp(): Promise<void> {
    const v = this.#virtual;
    if (v === undefined) return;
    while (v.owed > 0) await this.#advanceRun(v, v.owed);
    // What reaches the run next may change it without a timer.
    v.quiet = false;
  }

  /** Counts `call` as waiting for its answer until it settles, so that no wait passes without the run meanwhile. */
  #tracked<T>(call: Promise<T>): Promise<T> {
    this.#inFlight += 1;
    if (this.#virtual !== undefined) this.#virtual.quiet = false;
    return call.finally(() => {
      this.#inFlight -= 1;
      if (this.#virtual !== undefined) this.#virtual.quiet = false;
    });
  }

  /** Each part's wrapper, so that on virtual time `sdk` answers the same object for the same part, as on the real clock. */
  readonly #wrapped = new WeakMap<Participant, Participant>();

  /** The participant, each of whose calls first sends the run the time it is owed, on virtual time. */
  #caughtUp(participant: Participant): Participant {
    const known = this.#wrapped.get(participant);
    if (known !== undefined) return known;
    const wrapped = new Proxy(participant, {get: (target, property) => {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]): Promise<unknown> => {
        await this.#catchUp();
        return this.#tracked(Promise.resolve((value as (...args: unknown[]) => unknown).apply(target, args)));
      };
    }});
    this.#wrapped.set(participant, wrapped);
    return wrapped;
  }

  async #fetchState(): Promise<boolean> {
    const url = new URL(`${HARNESS_PATH}/state`, this.#target.harness);
    url.searchParams.set('logs', String(this.#state.logs.length));
    url.searchParams.set('published', String(this.#state.published.length));
    const response = await fetch(url);
    if (!response.ok) throw new RunFailure(`state answered ${response.status}`);
    const state = await response.json() as HarnessState;
    for (const {message} of state.published) this.#check(message, 'a published message');
    // Only the devices of the scenario's own modules count: another simulated device may report a reading of its own,
    // such as a sensor clock, at every refresh.
    const changed = state.logs.length > 0 || state.published.length > 0 || state.generation !== this.#state.generation
      || this.#seeded(state.devices) !== this.#seeded(this.#state.devices);
    this.#state = {...state, logs: [...this.#state.logs, ...state.logs], published: [...this.#state.published, ...state.published]};
    return changed;
  }

  /** The states of the devices of the scenario's own modules, as one text to compare. */
  #seeded(devices: DeviceStates): string {
    const modules: readonly string[] = this.#target.seed.modules;
    return JSON.stringify(Object.entries(devices).filter(([name]) => modules.includes(name)));
  }

  async #connect(part: Part): Promise<void> {
    if (part.closed) return;
    const source = sourceOf(part.role);
    const token = this.#grants.get(source);
    if (token === undefined) throw new RunFailure(`the run has no grant for ${source}`);
    part.participant = await connectRemote({
      url: this.#origin, source, token, reconnectDelayMs: RECONNECT_MS, scheduler: part.scheduler,
      // On virtual time the parts stamp their messages and judge expiry on the adapter's virtual time.
      ...(this.#virtual === undefined ? {} : {now: this.#virtual.clock.now, onDiagnostic: (diagnostic: Diagnostic) => { this.#heard(part.role, diagnostic); }}),
      onError: (error, scope) => {
        // While a runtime restarts, a remote part's reconnects meet a closed port or an edge still starting.
        if (scope.pattern !== 'stream') this.#problems.push(`${scope.source} on ${scope.pattern}: ${failureOf(error)}`);
      },
    });
    if (part.role === 'reader') {
      await follow(part.participant, this.reader, this.#target.seed.follows, {
        check: (message, where) => { this.#check(message, where); }, problem: text => { this.#problems.push(text); },
      });
    }
  }

  /** On virtual time, follows whether a part's stream is lost, so that no wait passes while it reconnects. */
  #heard(role: Role, {event}: Diagnostic): void {
    if (event === 'remote.disconnected') this.#away.add(role);
    if (event === 'remote.reconnected') this.#away.delete(role);
    if (this.#virtual !== undefined) this.#virtual.quiet = false;
  }

  async #retire(part: Part): Promise<void> {
    const {participant} = part;
    part.participant = undefined;
    if (part.role === 'reader') this.reader.copies = [];
    await participant?.close();
  }

  /**
   * Where the reader stands before a restart, or undefined when a restart has no reader to wait for: one that the
   * scenario disconnected comes back at its next wait, as `disconnect` says, and a closed one never does.
   *
   * Precondition: the reader is in sync when the restart is asked for. A reader still coming back from an earlier loss,
   * such as a crash or a disconnect that a wait released, would hear that loss's gap notice and resync after this mark,
   * and they would end the wait although it lost its stream again. Every scenario checks the reader's resync after such
   * a loss before it restarts, and each restart here waits for its own. Telling the two apart needs the remote client's
   * connection events, a wider change than #1697 needs.
   */
  #readerMark(): ReaderMark | undefined {
    const part = this.#part('reader');
    if (part.closed || part.participant === undefined || this.#held.includes(part)) return undefined;
    return this.reader.mark();
  }

  /** Waits until the reader has resynced since `mark`, within the run's bound; past it, names what did not come back. */
  async #resynced(mark: ReaderMark | undefined): Promise<void> {
    if (mark === undefined) return;
    const withinMs = this.#target.resyncWithinMs ?? RESYNC_WITHIN_MS;
    // On virtual time the reader's reconnect backoff runs on the parts' clock, so the run advances for up to the bound;
    // its reconnect is also real I/O, so the wait ends only once the bound has passed in real time too (Hub #1711).
    const v = this.#virtual;
    const deadline = this.now() + withinMs, realDeadline = Date.now() + withinMs;
    for (;;) {
      const missing = this.reader.behind(mark);
      if (missing.length === 0) return;
      const virtualPassed = this.now() >= deadline;
      if (virtualPassed && Date.now() >= realDeadline) throw new RunFailure(`the reader did not resync within ${withinMs} ms of the restart: ${missing.join('; ')}`);
      if (v === undefined || virtualPassed) await sleep(RESYNC_POLL_MS);
      // While the reader is behind, every piece reaches the run, so its reconnect over real I/O gets real time.
      else await this.#advance(v, RESYNC_POLL_MS, false);
    }
  }

  #part(role: Role): Part {
    const part = this.#parts.get(role);
    if (part === undefined) throw new RunFailure(`no part ${role}`);
    return part;
  }

  #check(message: unknown, where: string): void {
    const result = this.#validator.validate(message);
    if (!result.ok) this.#problems.push(`${where}: ${result.error.code} ${result.error.detail ?? ''}`);
  }
}

/** Connects the scenario's parts to a run, each with its grant, and syncs the reader's copies. */
export async function connectRun(target: RunTarget): Promise<RunHarness> {
  const run = new Run(target, await readPartTokens(target.dataDir));
  try {
    await run.open();
  } catch (error) {
    await run.close();
    throw error;
  }
  return run;
}
