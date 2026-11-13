import {SdkError, childOf, traceFields, type Clock, type Scheduler, type TraceContext} from '@jimmie-potts/sdk';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {createHash} from 'node:crypto';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {Backoff} from './backoff.js';
import {
  parseSettingsCheckpoint, projectSettingsMembers, removableSettingsFamily, settingsFactId, settingsInteger,
  settingsObject, validSettingsMembers, SETTINGS_FAMILIES, SETTINGS_SCAN_LIMIT, SETTINGS_SNAPSHOT_LIMIT, SETTINGS_UNSEALED_FACTS,
  type SettingsFact, type SettingsFamily, type SettingsPage, type SettingsRecord, type SettingsSnapshot,
} from './settings-contract.js';
import {SettingsContinuityError, settingsFailure, type SettingsPeer} from './settings-peer.js';

type Entity = {family: SettingsFamily; id: string};
export type SettingsTombstone = Entity & {value: null};
export type SettingsProgress = {
  origin: string;
  checkpoint: string;
  generation: string;
  completedCheckpoint: string | null;
  completedAtMs: number | null;
  sourceAtMs: number | null;
};
export type SettingsReceipt = {progress: SettingsProgress; projection?: readonly (SettingsRecord | SettingsTombstone)[]};
export type SettingsReceiverContext = {signal: AbortSignal; trace: TraceContext};
export type SettingsReceiver = {
  current(options: {projection?: true}, context: SettingsReceiverContext): Promise<SettingsReceipt | null>;
  replace(snapshot: SettingsSnapshot, expected: SettingsProgress | null, context: SettingsReceiverContext): Promise<SettingsReceipt>;
  apply(slice: {origin: string; expected: SettingsProgress; next: string; facts: readonly SettingsFact[]; terminal: boolean},
    context: SettingsReceiverContext): Promise<SettingsReceipt>;
};

type Options = {
  signal: AbortSignal;
  clock: Clock;
  scheduler: Scheduler;
  receiver: SettingsReceiver;
  openPeer: (signal: AbortSignal) => Promise<SettingsPeer>;
  expectedOrigin?: string;
  /** Recovery of a known unlogged older writer reasserts this choice after interruption. */
  replaceOnStart?: boolean;
  protectedValue?: (value: object) => boolean;
  failed: (code: ErrorCode, trace: TraceContext, count: number) => void;
  trace?: (parent?: TraceContext) => TraceContext;
};

type Comparison = object | null;
type Observation = {revision: number; order: number; projection: string};
type Work = {
  signal: AbortSignal;
  observations: Map<string, Observation>;
  comparisons: Map<string, string>;
  complete: boolean;
  order: number;
  busy: boolean;
  dirty: boolean;
  parent: TraceContext | undefined;
  wake: () => void;
};

const keyOf = ({family, id}: Entity): string => `${family}/${id}`;
const empty = (): void => {};
const invalid = (): SdkError => settingsFailure('invalid-message');
const sequence = (token: string): number => {
  const position = parseSettingsCheckpoint(token);
  if (position === undefined) throw invalid();
  return position.seq;
};

// The signal cache retains no settings values. Canonical JSON matches the owner projection's object equality.
function projectionOf(value: Comparison): string {
  const ordered = (_key: string, member: unknown): unknown => settingsObject(member)
    ? Object.fromEntries(Object.entries(member).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : member;
  return createHash('sha256').update(JSON.stringify(value, ordered)).digest('hex');
}
const absent = projectionOf(null);

/** Validate one raw scan interval and retain only its bounded, unsealed tail. */
class SettingsPass {
  after: string;
  through: string | undefined;
  #tail: SettingsFact[] = [];
  #revision: number | undefined;
  #sealedRevision: number | undefined;

  constructor(after: string) { this.after = after; }

  accept(page: SettingsPage, durable: string): SettingsFact[] {
    if (page.after !== this.after || (this.through !== undefined && this.through !== page.through)) throw invalid();
    const after = sequence(page.after), through = sequence(page.through), next = sequence(page.next);
    const sealed = page.applyThrough === null ? undefined : sequence(page.applyThrough);
    const accepted = sequence(durable);
    if (next < after || next - after !== Math.min(SETTINGS_SCAN_LIMIT, through - after) || page.done !== (next === through)
      || (page.done ? page.next !== page.through || page.applyThrough !== page.through : next === after || sealed === next)
      || (sealed !== undefined && (sealed < after || sealed < accepted || sealed > next))) throw invalid();
    const tokens = new Map<number, string>();
    for (const token of [durable, page.after, page.through, page.next, page.applyThrough]) {
      if (token === null) continue;
      const position = sequence(token);
      const previous = tokens.get(position);
      if (previous !== undefined && previous !== token) throw invalid();
      tokens.set(position, token);
    }

    let prior = after;
    for (const fact of page.facts) {
      if (fact.seq <= prior || fact.seq > next || (this.#revision !== undefined && fact.revision < this.#revision)
        || fact.revision === this.#sealedRevision) throw invalid();
      prior = fact.seq;
      this.#revision = fact.revision;
    }
    const outstanding = [...this.#tail, ...page.facts];
    const facts = sealed === undefined ? [] : outstanding.filter(fact => fact.seq <= sealed);
    this.#tail = sealed === undefined ? outstanding : outstanding.filter(fact => fact.seq > sealed);
    const sealedFact = facts.at(-1);
    if (this.#tail.length > SETTINGS_UNSEALED_FACTS || (this.#tail.length === 2 && this.#tail[0]?.revision !== this.#tail[1]?.revision)
      || (sealedFact !== undefined && this.#tail[0]?.revision === sealedFact.revision)) throw invalid();
    if (sealedFact !== undefined) this.#sealedRevision = sealedFact.revision;
    this.through = page.through;
    this.after = page.next;
    return facts;
  }
}

function observe(family: SettingsFamily, value: unknown): {key: string; revision: number; value: Comparison; trace: TraceContext} | undefined {
  if (!settingsObject(value) || value.source !== 'bunny/core' || !settingsFactId(family, value.subject)
    || !settingsObject(value.data) || !settingsInteger(value.data.revision) || typeof value.traceparent !== 'string') return undefined;
  const {kind, type, subject: id, data, traceparent} = value;
  const trace = {traceparent};
  if (traceFields(trace) === undefined || type !== `org.bunny.${family}.${kind === 'removal' ? 'removed' : 'updated'}` || !coreValidator().validate(value).ok) return undefined;
  const key = keyOf({family, id});
  if (kind === 'removal') {
    const {entity} = data;
    if (!removableSettingsFamily(family) || !settingsObject(entity) || entity.family !== family || entity.id !== id) return undefined;
    return {key, revision: data.revision as number, value: null, trace};
  }
  if (kind !== 'state' || data.id !== id) return undefined;
  const projection = projectSettingsMembers(family, data);
  if (family === 'mode') projection.overrides ??= [];
  if (!validSettingsMembers(family, id, projection, true)) return undefined;
  return {key, revision: data.revision as number, value: projection, trace};
}

function remember<T>(map: Map<string, T>, key: string, value: T): boolean {
  map.delete(key);
  map.set(key, value);
  if (map.size <= SETTINGS_SNAPSHOT_LIMIT * 2) return false;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
  return true;
}

function wait(signal: AbortSignal, arm: (wake: () => void) => () => void): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    let disarm = empty, woken = false;
    const wake = (): void => {
      if (woken) return;
      woken = true;
      signal.removeEventListener('abort', wake);
      disarm();
      resolve();
    };
    signal.addEventListener('abort', wake, {once: true});
    disarm = arm(wake);
    if (woken) disarm();
  });
}

/** One lease-bound follower. Only the receiver can certify applied settings or freshness. */
export class SettingsFollower {
  readonly #stop = new AbortController();
  readonly #task: Promise<void>;
  readonly #backoff = new Backoff(1000, 30_000);
  readonly #lastFailure = new Map<ErrorCode, {at: number; count: number}>();
  #state: 'connecting' | 'following' | 'unavailable' = 'connecting';
  #replace: boolean;

  constructor(private readonly options: Options) {
    this.#replace = options.replaceOnStart === true;
    this.#task = this.#run(AbortSignal.any([options.signal, this.#stop.signal]));
  }

  get state(): 'connecting' | 'following' | 'unavailable' { return this.#stop.signal.aborted ? 'unavailable' : this.#state; }

  stop(): Promise<void> {
    this.#stop.abort();
    return this.#task;
  }

  #report(error: unknown, trace: TraceContext): boolean {
    const refusal = error instanceof SdkError ? error.body.error : settingsFailure('unavailable').body.error;
    const {code, retryable} = refusal;
    const at = this.options.clock.now();
    this.#state = 'unavailable';
    const last = this.#lastFailure.get(code);
    if (last !== undefined && at - last.at < 60_000) {
      last.count = Math.min(last.count + 1, Number.MAX_SAFE_INTEGER - 1);
      return retryable;
    }
    const count = last === undefined ? 1 : last.count + 1;
    this.#lastFailure.set(code, {at, count: 0});
    try { this.options.failed(code, trace, count); } catch { /* Diagnostics cannot decide follower progress. */ }
    return retryable;
  }

  async #run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      const abort = new AbortController();
      const signal = AbortSignal.any([stop, abort.signal]);
      const work: Work = {signal, observations: new Map(), comparisons: new Map(), complete: false, order: 0, busy: true, dirty: true, parent: undefined, wake: empty};
      let connection: Awaited<ReturnType<SettingsPeer['connect']>> | undefined;
      let trace = this.#trace();
      try {
        const peer = await this.options.openPeer(signal);
        signal.throwIfAborted();
        connection = await peer.connect(signal, () => { abort.abort(); });
        for (const family of SETTINGS_FAMILIES) {
          signal.throwIfAborted();
          await connection.subscribe(`bunny.state.${family}.*`, message => { this.#signal(work, family, message); },
            {onOverflow: () => { this.#prompt(work); }});
        }
        let state: SettingsProgress | null | undefined;
        while (!signal.aborted) {
          await wait(signal, wake => {
            work.wake = wake;
            if (work.dirty) wake();
            return () => { work.wake = empty; };
          });
          signal.throwIfAborted();
          work.dirty = false;
          work.busy = true;
          trace = this.#trace(work.parent);
          work.parent = undefined;
          try {
            if (state === undefined || !work.complete) state = await this.#readCurrent(work, trace);
            state = await this.#catchUp(peer, work, state, trace);
            this.#state = 'following';
            this.#backoff.reset();
            this.#lastFailure.clear();
          } catch (error) {
            state = undefined;
            work.complete = false;
            work.comparisons.clear();
            if (signal.aborted || error instanceof SdkError && error.body.error.code === 'invalid-state') throw error;
            if (error instanceof SdkError && error.body.error.code === 'revision-conflict') throw settingsFailure('unavailable');
            if (error instanceof SdkError && error.body.error.retryable) throw error;
            if (this.#report(error, trace)) throw error;
          } finally {
            work.busy = false;
          }
        }
        if (!stop.aborted) throw settingsFailure('unavailable');
      } catch (error) {
        if (stop.aborted) return;
        const failure = error instanceof SdkError && error.body.error.code !== 'cancelled' ? error : settingsFailure('unavailable');
        if (!this.#report(failure, trace)) return;
      } finally {
        abort.abort();
        await connection?.close().catch(() => {});
      }
      if (stop.aborted) return;
      this.#backoff.failed(this.options.clock.now());
      await wait(stop, wake => this.options.scheduler.after(this.#backoff.next - this.options.clock.now(), wake));
    }
  }

  #trace(parent?: TraceContext): TraceContext {
    return (this.options.trace ?? childOf)(parent);
  }

  #prompt(work: Work, trace?: TraceContext): void {
    if (work.signal.aborted) return;
    work.dirty = true;
    work.parent ??= trace;
    work.wake();
  }

  #signal(work: Work, family: SettingsFamily, message: unknown): void {
    if (work.signal.aborted) return;
    const signal = observe(family, message);
    if (signal === undefined || this.options.protectedValue?.({key: signal.key, value: signal.value}) === true) return;
    const previous = work.observations.get(signal.key);
    if (previous !== undefined && previous.revision >= signal.revision) return;
    const projection = projectionOf(signal.value);
    remember(work.observations, signal.key, {revision: signal.revision, order: ++work.order, projection});
    const comparison = work.comparisons.get(signal.key) ?? (work.complete ? absent : undefined);
    if (work.busy || comparison !== projection) this.#prompt(work, signal.trace);
  }

  #comparison(work: Work, record: SettingsRecord | SettingsTombstone, since: number): void {
    const key = keyOf(record);
    const seen = work.observations.get(key);
    const projection = projectionOf(record.value);
    if (seen !== undefined && seen.order > since && seen.projection !== projection) {
      work.comparisons.delete(key);
      work.complete = false;
    } else if (remember(work.comparisons, key, projection)) {
      work.complete = false;
    }
  }

  #projection(work: Work, records: readonly (SettingsRecord | SettingsTombstone)[], since: number): void {
    work.comparisons.clear();
    work.complete = true;
    for (const record of records) this.#comparison(work, record, since);
    for (const [key, seen] of work.observations) {
      if (seen.order > since && !work.comparisons.has(key) && seen.projection !== absent) work.complete = false;
    }
  }

  async #readCurrent(work: Work, trace: TraceContext): Promise<SettingsProgress | null> {
    const since = work.order;
    const receipt = await this.options.receiver.current({projection: true}, {signal: work.signal, trace});
    work.signal.throwIfAborted();
    if (receipt?.projection !== undefined) this.#projection(work, receipt.projection, since);
    if (receipt !== null && (parseSettingsCheckpoint(receipt.progress.checkpoint)?.origin !== receipt.progress.origin
      || this.options.expectedOrigin !== undefined && this.options.expectedOrigin !== receipt.progress.origin)) throw settingsFailure('invalid-state');
    return receipt?.progress ?? null;
  }

  async #catchUp(peer: SettingsPeer, work: Work, current: SettingsProgress | null, trace: TraceContext): Promise<SettingsProgress> {
    if (this.#replace || current === null) return this.#snapshot(peer, work, current, trace);
    const pass = new SettingsPass(current.checkpoint);
    let state = current;
    for (;;) {
      const since = work.order;
      let page: SettingsPage;
      try {
        page = await peer.page({after: pass.after, ...(pass.through === undefined ? {} : {through: pass.through})}, work.signal, trace);
      } catch (error) {
        if (!(error instanceof SettingsContinuityError)) throw error;
        work.signal.throwIfAborted();
        this.#replace = true;
        // An old stream can still deliver pre-restore revisions after the replacement read.
        // Retire it and subscribe anew before taking the replacement snapshot.
        throw settingsFailure('unavailable');
      }
      work.signal.throwIfAborted();
      if (page.origin !== state.origin) throw settingsFailure('invalid-state');
      if (this.options.protectedValue?.(page) === true) throw settingsFailure('forbidden');
      const facts = pass.accept(page, state.checkpoint);
      const next = page.applyThrough;
      if (next !== null && (next !== state.checkpoint || page.done)) {
        const receipt = await this.options.receiver.apply({origin: state.origin, expected: state, next, facts, terminal: page.done},
          {signal: work.signal, trace});
        work.signal.throwIfAborted();
        if (receipt.progress.origin !== state.origin || receipt.progress.checkpoint !== next || receipt.progress.generation !== state.generation) {
          throw settingsFailure('revision-conflict');
        }
        state = receipt.progress;
        if (receipt.projection === undefined && facts.length > 0) {
          work.comparisons.clear();
          work.complete = false;
        } else {
          for (const record of receipt.projection ?? []) this.#comparison(work, record, since);
        }
      }
      if (page.done) return state;
    }
  }

  async #snapshot(peer: SettingsPeer, work: Work, current: SettingsProgress | null, trace: TraceContext): Promise<SettingsProgress> {
    this.#replace = true;
    const since = work.order;
    const snapshot = await peer.snapshot(work.signal, trace);
    work.signal.throwIfAborted();
    const origin = current?.origin ?? this.options.expectedOrigin;
    if (origin !== undefined && origin !== snapshot.origin) throw settingsFailure('invalid-state');
    if (this.options.protectedValue?.(snapshot) === true) throw settingsFailure('forbidden');
    const receipt = await this.options.receiver.replace(snapshot, current, {signal: work.signal, trace});
    work.signal.throwIfAborted();
    if (receipt.progress.origin !== snapshot.origin || receipt.progress.checkpoint !== snapshot.checkpoint) throw settingsFailure('revision-conflict');
    this.#replace = false;
    if (receipt.projection !== undefined) this.#projection(work, receipt.projection, since);
    else {
      work.comparisons.clear();
      work.complete = false;
    }
    return receipt.progress;
  }
}
