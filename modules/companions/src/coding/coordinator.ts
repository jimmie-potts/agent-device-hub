import type {ActionEvidence} from '../assistant/closing-reply.js';
// One coding worker endpoint with one slot per companion (Hub #502, #2028). The core's tracked dispatcher hands the
// module a `coding-run`; the module saves responsibility, sends one `coding-work` start to the worker's connection-bound
// endpoint and reports the tracked outcome when the worker reports it started. The worker's later progress settles the
// responsibility and reaches the task through the engine as the delegation's answer; nothing is resent, and a lost
// worker or a restart leaves each of its operations uncertain rather than restarting it. An approved hand-off whose
// companion's slot is busy waits, durably and first in first out, and is dispatched once when that slot frees.
import {errorBody, isErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {CODING_WORKER_SLOTS, CODING_WORKER_SOURCE, DEFAULT_CODING_BOUNDS, type CodingCompanion, type CodingEndpointControl, type CodingLost, type CodingProgress, type CodingResult, type CodingRun,
  type CodingRunEntry, type CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {Outcome, fullDisk, recordLog, type AddMessage, type Cancel, type Command, type ModuleContext, type Outbox, type Reply, type RequestResult, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {advanceRevision} from '../revision.js';
import {CodingStore, type CodingJob, type CodingResponsibility, type CodingWaitingRecord} from './store.js';

/** The module publishes `coding-state/2.2`, which adds the worker's slots, every active run and the waiting hand-offs (Hub #2028). */
export const codingStateDraft = (data: CodingState) => ({kind: 'state' as const, type: 'org.bunny.coding-state.updated', subject: 'coding',
  dataschema: 'https://bunny.invalid/events/coding-state/2.2', data: {...data, readiness: data.readiness ?? null, slots: data.slots ?? null, runs: data.runs ?? [], waiting: data.waiting ?? []}});
/**
 * Delivers the worker's final word to the task that waits for it; the engine turns it into the delegation tool's result.
 * `startup` marks the settlement, at start, of responsibility still pending at the last stop.
 */
export type Delivery = (taskId: string, text: string, parent: TraceContext, evidence: ActionEvidence, startup: boolean) => Promise<void>;
/** An approved hand-off as the engine gives it: the task, the companion whose slot it needs and the endpoint revision the proposal saw. */
export type HandOff = {requestId: string; taskId: string; conversationId?: string; companion: CodingCompanion; repository: string; brief: string; expectedRevision: number};
/** The core's answer for a hand-off sent now, or `waiting` for one held until its companion's slot frees. */
export type HandOffAnswer = RequestResult | {status: 'waiting'; requestId: string} | {status: 'queued'; requestId: string; jobId: string};
/**
 * What the coordinator asks the engine (Hub #2028): the companion a task belongs to, so a run is tagged with the
 * companion that asked; whether a task still waits on this delegation, so a waiting hand-off whose task was cancelled
 * or ended, even while the coordinator was stopped, is dropped unsent; and the news that a waiting hand-off was sent.
 */
export type CodingSeams = {
  jobQueued?: (job: CodingJob, add: AddMessage, parent: TraceContext) => void;
  jobUpdate?: (job: CodingJob, kind: 'sent' | 'stop-unconfirmed' | 'result', text: string, parent: TraceContext, startup: boolean) => Promise<void>;
  companionOf?: (taskId: string) => CodingCompanion | undefined;
  awaits?: (taskId: string) => boolean;
  sent?: (taskId: string, parent: TraceContext) => void;
};
type Phase = CodingRunEntry['status'];
type Active = CodingResponsibility & {companion: CodingCompanion; phase: Phase; wallClockMs: number; cancel: Cancel; settling: boolean};
const noop = (): void => {};
/**
 * How long the worker may take to report it started once it accepted the work; the tracked outcome is uncertain after
 * that. Under the tracker's thirty-second device budget for `coding-run`, so the outcome lands before the tracker expires it.
 */
export const START_MS = 20_000;
/** Grace after the dispatch's wall clock before an unanswered run is given up as uncertain. */
export const GRACE_MS = 120_000;
/**
 * The worker reports a run started before its git setup, which takes turns per repository (Hub #2028): one setup is
 * bounded by the worker's own git deadlines (fetch 120 s, rev-parse and worktree add 60 s each), and a run may wait for
 * every other slot's setup before its own. That time is added to the grace, so queued setup never spends it.
 */
export const SETUP_MS = 240_000 * CODING_WORKER_SLOTS;
/** At most this many approved hand-offs wait for a slot at once; a further one is refused with `capacity`. */
export const WAITING_LIMIT = 32;
/** How long the module waits for the core's answer to a hand-off it dispatches. */
export const DISPATCH_MS = 29_000;
const short = (sha: string | null): string => sha === null ? 'unknown' : sha.slice(0, 8);

/** The worker's structured result as bounded text for the model and the owner: facts the worker observed, never a path or a prompt. */
export function describeResult(status: 'completed' | 'failed' | 'cancelled' | 'uncertain', result: CodingResult | null | undefined, reason?: string): string {
  const head = status === 'completed' ? `completed (${result?.outcome ?? 'unknown'})` : `${status}${reason === undefined ? '' : ` (${reason})`}`;
  if (result === null || result === undefined) return `${head}: the worker returned no structured result.`;
  const lines = [`${head}: ${result.summary}`,
    `repository ${result.repository}; base ${short(result.base)}; head ${short(result.head)}; changed files: ${result.changedFiles.length === 0 ? 'none' : result.changedFiles.slice(0, 40).join(', ')}${result.changedFiles.length > 40 ? ` (+${String(result.changedFiles.length - 40)} more)` : ''}`,
    `checks: ${result.checks.length === 0 ? 'none run' : result.checks.map(check => `${check.name} ${check.status}${check.detail === undefined ? '' : ` (${check.detail})`}`).join('; ')}`,
    `findings: ${result.findings.length === 0 ? 'none' : result.findings.join('; ')}`,
    `limitations: ${result.limitations.length === 0 ? 'none stated' : result.limitations.join('; ')}`,
    `usage: ${result.usage === null ? 'unknown' : `${result.usage.turns === null ? 'unknown' : String(result.usage.turns)} turns, ${result.usage.costUsd === null ? 'unknown cost' : `$${result.usage.costUsd.toFixed(2)}`}, ${result.usage.durationMs === null ? 'unknown duration' : `${String(Math.round(result.usage.durationMs / 1000))} s`}`}`];
  // A usage limit says which window and when it resets, or that the tool did not say; nothing is retried at the reset.
  if (result.limit !== undefined) lines.push(`usage limit: ${result.limit.window ?? 'window unknown'}, resets ${result.limit.resetsAtMs === null ? 'at an unknown time' : new Date(result.limit.resetsAtMs).toISOString()}`);
  let text = lines.join('\n');
  // The task's serialized state is bounded at 32 KiB; a result that fits in 3,500 characters leaves room for the turn that reports it.
  if (text.length > 3500) text = `${text.slice(0, 3500)}\n(result text truncated)`;
  return text;
}

export class CodingCoordinator {
  readonly #store: CodingStore;
  readonly #validator = coreValidator();
  readonly #subscriptions: Subscription[] = [];
  #state: Pick<CodingState, 'revision' | 'endpointId' | 'availability' | 'readiness' | 'slots'> = {revision: 0, endpointId: null, availability: 'off', readiness: null, slots: null};
  #bound = 0;
  /** Every operation the worker holds, by operation ID, in the order they were accepted. */
  readonly #active = new Map<string, Active>();
  /** Each slot's hand-off on its way through the core, so a second one never leaves for the same slot. */
  readonly #reserved = new Map<string, string>();
  /** Tasks cancelled while their hand-off was on its way from the queue: its arrival is refused, so nothing runs. */
  readonly #cancelled = new Set<string>();
  #closed = false;
  #starting = false;
  readonly #seams: CodingSeams;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly deliver: Delivery, seams: CodingSeams = {}) {
    this.#seams = seams;
    this.#store = new CodingStore(context.database());
  }
  jobForAttempt(operationId: string): CodingJob | undefined {return this.#store.job(operationId);}
  /** Whether a hand-off was accepted as a run, so one that waited is known to have been sent. */
  accepted(operationId: string): boolean {
    try {return this.#active.has(operationId) || this.#store.accepted(operationId);} catch {return false;}
  }
  inspect(): CodingState {
    const runs = [...this.#active.values()].map(active => ({operationId: active.operationId, taskId: active.taskId, companion: active.companion, status: active.phase}));
    const first = runs[0];
    let waiting: CodingState['waiting'] = [];
    try {waiting = this.#store.waiting().map(record => ({operationId: record.operationId, taskId: record.taskId, companion: record.companion}));} catch (error) {this.#storageFailure(error);}
    return structuredClone({id: 'coding', ...this.#state, active: first === undefined ? null : {operationId: first.operationId, taskId: first.taskId, status: first.status}, runs, waiting});
  }
  /**
   * The slot a companion's run uses: its own when the worker declared one per companion, else the one slot an older
   * worker that declares none holds for every companion.
   */
  #slotOf(companion: CodingCompanion): string {return (this.#state.slots ?? 1) >= CODING_WORKER_SLOTS ? companion : 'shared';}
  #busy(slot: string): boolean {
    return this.#reserved.has(slot) || [...this.#active.values()].some(active => this.#slotOf(active.companion) === slot)
      || this.#active.size + this.#reserved.size >= (this.#state.slots ?? 1);
  }
  #connected(): boolean {return this.#state.availability === 'available' && this.#state.endpointId !== null && !this.#closed && !this.context.signal.aborted;}
  /**
   * What a proposal binds to: whether a worker is connected now and the state revision of the last change to the
   * endpoint or its availability (Hub #2028). Runs starting and ending leave it, so another companion's run never
   * refuses an approval; a readiness report leaves it too.
   */
  endpoint(): {available: boolean; endpointId: string | null; revision: number} {
    return {available: this.#connected(), endpointId: this.#state.endpointId, revision: this.#bound};
  }
  async start(): Promise<void> {
    this.#starting = true;
    // Responsibility that was pending at the last stop is uncertain now: the worker may have run, nothing is resent, and the task hears so.
    for (const record of this.#store.records('pending')) {
      await this.#settle(record, 'uncertain', undefined, 'lost', record.started ? undefined : {result: Outcome.uncertain}, true);
    }
    // A hand-off whose dispatch had left without its acceptance recorded may have reached the core: its fate is unknown
    // and it is never sent again. One that never left keeps its place and is sent when its slot frees.
    for (const record of this.#store.waiting().filter(waiting => waiting.sending)) await this.#endWait(record, 'uncertain', 'lost', true);
    await this.#deliverJobUpdates(undefined, true);
    this.#starting = false;
    this.#subscriptions.push(await this.context.sdk.respond<CodingEndpointControl>('bunny.cmd.coding-endpoint.*', command => this.#control(command)));
    this.#subscriptions.push(await this.context.sdk.respond<CodingRun>('bunny.cmd.coding-run.assistant', command => this.#accept(command)));
    this.#subscriptions.push(await this.context.sdk.subscribe<CodingProgress>('bunny.event.coding-progress.*', message => this.#progress(message), {onOverflow: () => {this.#lost();}}));
    this.#subscriptions.push(await this.context.sdk.subscribe<CodingLost>('bunny.event.coding-lost.*', message => {
      if (message.source === 'bunny/runtime/gateway' && this.#validator.validate(message).ok && message.data.id === this.#state.endpointId) this.#lost();
    }, {onOverflow: () => {this.#lost();}}));
    this.#changed();
  }
  async stop(): Promise<void> {
    this.#closed = true;
    for (const active of this.#active.values()) active.cancel();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
  }
  /**
   * Takes an approved hand-off (Hub #2028). With no worker connected, or a proposal bound to an endpoint that has since
   * changed, it is refused and nothing is sent. A free slot sends it now through the core's tracked dispatcher and
   * answers with the core's answer; a busy one, or one with a line, keeps it waiting in order and answers `waiting`.
   */
  async handOff(data: HandOff, parent: TraceContext): Promise<HandOffAnswer> {
    const refused = (code: 'unavailable' | 'revision-conflict' | 'capacity' | 'internal', detail: string): HandOffAnswer => ({status: Outcome.rejected, requestId: data.requestId, error: errorBody(code, {detail})});
    if (data.conversationId !== undefined) {
      const {requestId: operationId, conversationId, taskId, companion, repository, brief} = data;
      const jobId = `${operationId}-job`;
      try {
        const existing = this.#store.job(operationId);
        if (existing !== undefined && (existing.conversationId !== conversationId || existing.taskId !== taskId ||
          existing.repository !== repository || existing.brief !== brief)) return refused('revision-conflict', 'the request ID names another coding job');
        if (existing === undefined) {
          if (!this.#connected()) return refused('unavailable', 'no coding worker is connected');
          if (this.#bound !== data.expectedRevision) return refused('revision-conflict', 'the coding worker changed since the proposal');
          if (this.#store.waiting().length >= WAITING_LIMIT) return refused('capacity', 'too many coding hand-offs are waiting');
          await this.outbox.transaction(add => {
            const job = {jobId, operationId, conversationId, taskId, repository, brief};
            this.#store.create(job);
            this.#store.wait({operationId, taskId, companion, repository, brief, traceparent: parent.traceparent});
            this.#seams.jobQueued?.(job, add, parent);
          });
          this.#changed();
          this.#drain();
        }
      } catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'the coding job could not be saved');}
      return {status: 'queued', requestId: operationId, jobId};
    }
    if (!this.#connected()) return refused('unavailable', 'no coding worker is connected');
    if (this.#bound !== data.expectedRevision) return refused('revision-conflict', 'the coding worker changed since the proposal');
    const slot = this.#slotOf(data.companion);
    let waiting: CodingWaitingRecord[];
    try {waiting = this.#store.waiting();} catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'coding hand-offs could not be read');}
    if (waiting.some(record => record.operationId === data.requestId)) return {status: 'waiting', requestId: data.requestId};
    if (!this.#busy(slot) && !waiting.some(record => this.#slotOf(record.companion) === slot)) {
      this.#reserved.set(slot, data.requestId);
      try {return await this.#dispatch(data, parent);}
      finally {if (this.#reserved.get(slot) === data.requestId) this.#reserved.delete(slot); this.#drain();}
    }
    if (waiting.length >= WAITING_LIMIT) return refused('capacity', 'too many coding hand-offs are waiting');
    try {this.#store.wait({operationId: data.requestId, taskId: data.taskId, companion: data.companion, repository: data.repository, brief: data.brief, traceparent: parent.traceparent});}
    catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'the coding hand-off could not be saved');}
    this.#changed();
    return {status: 'waiting', requestId: data.requestId};
  }
  #dispatch(data: Omit<HandOff, 'expectedRevision' | 'companion'>, parent: TraceContext): Promise<RequestResult> {
    const endpointId = this.#state.endpointId;
    if (endpointId === null) return Promise.resolve({status: Outcome.rejected, requestId: data.requestId, error: errorBody('unavailable', {detail: 'no coding worker is connected'})});
    return this.context.sdk.request('bunny.cmd.coding-dispatch.assistant', {type: 'org.bunny.coding.dispatch.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-dispatch/2.0',
      data: {requestId: data.requestId, endpointId, taskId: data.taskId, repository: data.repository, brief: data.brief, bounds: DEFAULT_CODING_BOUNDS}},
    {timeoutMs: DISPATCH_MS, requestId: data.requestId, parent});
  }
  /** Sends the oldest waiting hand-off of each free slot, once; one whose slot is still busy keeps its place. */
  #drain(): void {
    if (!this.#connected() || this.#starting) return;
    let waiting: CodingWaitingRecord[];
    try {waiting = this.#store.waiting();} catch (error) {this.#storageFailure(error); return;}
    let dropped = false;
    // A slot whose oldest hand-off could not be checked sends nothing else this pass, so its line keeps its order.
    const held = new Set<string>();
    for (const record of waiting) {
      const slot = this.#slotOf(record.companion);
      if (record.sending || held.has(slot) || this.#busy(slot)) continue;
      // A task cancelled or ended while its hand-off waited, even while this coordinator was stopped, sends nothing. A
      // task whose state could not be read keeps its hand-off waiting, ahead of the rest of its slot's line.
      let awaits: boolean | undefined;
      try {awaits = this.#store.job(record.operationId) !== undefined || this.#awaits(record.taskId);}
      catch (error) {this.#storageFailure(error, record);}
      if (awaits === undefined) {held.add(slot); continue;}
      if (!awaits) {
        try {this.#store.unwait(record.operationId); dropped = true;} catch (error) {this.#storageFailure(error, record);}
        continue;
      }
      try {this.#store.sending(record.operationId);} catch (error) {this.#storageFailure(error); return;}
      this.#reserved.set(slot, record.operationId);
      void this.#sendWaiting(record, slot);
    }
    if (dropped) this.#changed();
  }
  #awaits(taskId: string): boolean | undefined {
    try {return this.#seams.awaits?.(taskId) ?? true;} catch (error) {this.#storageFailure(error); return undefined;}
  }
  async #sendWaiting(record: CodingWaitingRecord, slot: string): Promise<void> {
    let answer: RequestResult;
    try {answer = await this.#dispatch({requestId: record.operationId, taskId: record.taskId, repository: record.repository, brief: record.brief}, {traceparent: record.traceparent});}
    catch {answer = {status: Outcome.uncertain, requestId: record.operationId, error: errorBody('uncertain-result')};}
    if (this.#reserved.get(slot) === record.operationId) this.#reserved.delete(slot);
    // An answer lost to the module's own stop is left to the next start, which finds the hand-off's fate unknown.
    if (this.#closed || this.context.signal.aborted) return;
    // An accepted dispatch is a run now: its acceptance ended the wait. Any other answer ends the wait without a run.
    // An accepted dispatch is a run now, and so is one whose answer was lost after the module accepted its run: the run's
    // own progress settles it. The task's conversation now says the hand-off was sent.
    if (answer.status === 'accepted' || this.#store.accepted(record.operationId)) {
      try {
        if (this.#store.job(record.operationId) === undefined) this.#seams.sent?.(record.taskId, record);
        else if (!this.#store.resultSaved(record.operationId)) {
          this.#store.update({...record, kind: 'sent', text: 'The core accepted the worker dispatch. The worker start is a separate observation.'});
          await this.#deliverJobUpdates(record.operationId);
        }
      } catch (error) {this.#storageFailure(error, record);}
      this.#drain(); return;
    }
    const code = answer.error.error.code, uncertain = answer.status === Outcome.uncertain || code === 'uncertain-result';
    if (!uncertain && code === 'invalid-state' && this.#store.stopRequested(record.operationId)) {
      await this.#endWait(record, 'cancelled', 'stopped before worker start');
      this.#drain(); return;
    }
    await this.#endWait(record, uncertain ? 'uncertain' : 'failed', uncertain ? 'lost' : `refused: ${code}`);
    this.#drain();
  }
  /** Ends a hand-off's wait without a run and tells its task, unless the owner cancelled it. */
  async #endWait(record: CodingWaitingRecord, status: 'cancelled' | 'failed' | 'uncertain', reason: string, startup = false): Promise<void> {
    const text = describeResult(status, undefined, reason);
    if (this.#store.job(record.operationId) !== undefined) {
      try {
        await this.outbox.transaction(() => {
          this.#store.unwait(record.operationId);
          this.#store.update({...record, kind: 'result', text});
        });
        this.#changed();
        await this.#deliverJobUpdates(record.operationId, startup);
      } catch (error) {this.#storageFailure(error, record);}
      return;
    }
    try {this.#store.unwait(record.operationId);} catch (error) {this.#storageFailure(error, record);}
    const cancelled = this.#cancelled.delete(record.taskId);
    this.#changed();
    if (cancelled) return;
    try {await this.deliver(record.taskId, text, {traceparent: record.traceparent},
      {requestId: record.operationId, source: 'effect', text: status === 'uncertain' ? 'the coding worker outcome is unknown' : 'the coding hand-off was refused'}, startup);}
    catch (error) {this.#storageFailure(error, record);}
  }
  async #deliverJobUpdates(operationId?: string, startup = false): Promise<void> {
    if (this.#seams.jobUpdate === undefined) return;
    for (const update of this.#store.undelivered(operationId)) {
      const job = this.#store.job(update.operationId);
      if (job === undefined) continue;
      try {
        await this.#seams.jobUpdate(job, update.kind, update.text, update, startup);
        this.#store.delivered(update);
      } catch (error) {this.#storageFailure(error, update);}
    }
  }
  /** Records stop intent inside the caller's transaction; the returned work can run after commit. */
  prepareStop(jobId: string, operationId: string): {code: 'unavailable' | 'not-found' | 'invalid-state'} | {committed: () => Promise<void>} {
    if (this.#closed || this.context.signal.aborted) return {code: 'unavailable'};
    const job = this.#store.job(operationId);
    if (job === undefined || job.jobId !== jobId) return {code: 'not-found'};
    if (this.#store.resultSaved(operationId)) return {code: 'invalid-state'};
    const waiting = this.#store.waiting().find(record => record.operationId === operationId);
    const active = this.#active.get(operationId);
    if (waiting === undefined && (active === undefined || active.settling)) return {code: 'invalid-state'};
    if (!this.#store.requestStop(operationId)) return {committed: () => Promise.resolve()};
    if (waiting !== undefined && !waiting.sending) {
      this.#store.unwait(operationId);
      this.#store.update({...waiting, kind: 'result', text: 'Cancelled before dispatch. The worker was never sent a start.'});
      return {committed: async () => {
        this.#changed();
        this.#drain();
        await this.#deliverJobUpdates(operationId);
      }};
    }
    return {committed: () => {
      if (active !== undefined && this.#active.get(operationId) === active && !active.settling && !this.#closed) {
        active.phase = 'cancelling'; this.#changed();
        return this.#stopAttempt(active);
      }
      return Promise.resolve();
    }};
  }
  async stopJob(jobId: string, operationId: string): Promise<Reply> {
    try {
      const stop = await this.outbox.transaction(() => this.prepareStop(jobId, operationId));
      if ('code' in stop) return errorBody(stop.code);
      void stop.committed().catch(error => {this.#storageFailure(error);});
      return {status: 'accepted'};
    } catch (error) {
      this.#storageFailure(error);
      return errorBody(fullDisk(error) ? 'capacity' : 'internal');
    }
  }
  async #stopAttempt(active: Active): Promise<void> {
    let confirmed = false;
    try {
      const answer = await this.#workerStop(active);
      confirmed = answer.status === 'accepted';
    } catch { /* An unanswered worker request provides no observation. */ }
    if (this.#active.get(active.operationId) !== active || active.settling || this.#closed) return;
    try {
      this.#store.update({...active, kind: 'stop-unconfirmed', text: confirmed ? 'The worker accepted the stop request. The stop itself is unconfirmed.'
          : 'The worker did not confirm receipt of the stop request. Its stop is unconfirmed.'});
      await this.#deliverJobUpdates(active.operationId);
    } catch (error) {this.#storageFailure(error, active);}
  }
  #workerStop(active: Active): Promise<RequestResult> {
    return this.context.sdk.request(`bunny.cmd.coding-work.${active.endpointId}`, {type: 'org.bunny.coding.work.requested', subject: active.endpointId,
      dataschema: 'https://bunny.invalid/events/coding-work/2.0', data: {requestId: `${active.operationId}-cancel`, operationId: active.operationId, action: 'cancel'}},
    {timeoutMs: 5000, parent: active});
  }
  /**
   * The owner cancelled the task. A hand-off still waiting is removed and nothing is sent; one on its way from the queue is
   * refused when it arrives; a running one is asked to stop, and the worker's cancelled report settles it.
   */
  cancel(taskId: string): void {
    if (this.#closed) return;
    let waiting: CodingWaitingRecord[] = [];
    try {waiting = this.#store.waiting().filter(record => record.taskId === taskId && this.#store.job(record.operationId) === undefined);} catch (error) {this.#storageFailure(error);}
    for (const record of waiting) {
      if (record.sending) {this.#cancelled.add(taskId); continue;}
      try {this.#store.unwait(record.operationId);} catch (error) {this.#storageFailure(error, record);}
    }
    if (waiting.length > 0) this.#changed();
    const active = [...this.#active.values()].find(entry => entry.taskId === taskId && this.#store.job(entry.operationId) === undefined);
    if (active === undefined || active.settling) return;
    active.phase = 'cancelling'; this.#changed();
    void this.#workerStop(active).catch(() => {});
  }
  #control(command: Command<CodingEndpointControl>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== CODING_WORKER_SOURCE) return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    if (command.data.action === 'enable') {
      if (this.#state.endpointId !== null && this.#state.endpointId !== command.subject) return errorBody('invalid-state', {detail: 'another coding worker endpoint is selected'});
      // An enable from the selected endpoint is accepted again; one that carries readiness (2.1) replaces the recorded one.
      const readiness = command.data.readiness ?? null, slots = command.data.slots ?? null;
      const selected = this.#state.availability === 'available' && this.#state.endpointId === command.subject;
      if (!selected || JSON.stringify(readiness) !== JSON.stringify(this.#state.readiness ?? null) || slots !== this.#state.slots) {
        // The slots are the endpoint's own: an enable from the selected endpoint keeps them unless it declares others.
        this.#state.endpointId = command.subject; this.#state.availability = 'available'; this.#state.readiness = readiness;
        if (!selected || command.data.slots !== undefined) this.#state.slots = slots;
        // A readiness report from the selected worker is published but does not move what a pending proposal is bound to.
        this.#changed(!selected);
        this.#drain();
      }
      return {status: 'accepted'};
    }
    if (this.#state.endpointId !== command.subject) return errorBody('forbidden');
    this.#unselect('off');
    return {status: 'accepted'};
  }
  /** The selected endpoint is gone: each of its runs ends uncertain on its own; waiting hand-offs keep their places. */
  #unselect(availability: 'off' | 'unavailable'): void {
    this.#state.availability = availability; this.#state.endpointId = null; this.#state.readiness = null; this.#state.slots = null;
    for (const active of [...this.#active.values()]) if (!active.settling) void this.#settle(active, 'uncertain', undefined, 'lost', active.started ? undefined : {result: Outcome.uncertain});
    this.#changed(true);
  }
  #accept(command: Command<CodingRun>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/core') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    const data = command.data;
    if (this.#active.has(data.requestId)) return {status: 'accepted'};
    try {
      if (this.#store.accepted(data.requestId) || this.#store.resultSaved(data.requestId)) return errorBody('invalid-state', {detail: 'the coding attempt has already settled'});
      if (this.#store.stopRequested(data.requestId)) return errorBody('invalid-state', {detail: 'the job was stopped before the worker start'});
      const job = this.#store.job(data.requestId);
      if (job !== undefined && (job.taskId !== data.taskId || job.repository !== data.repository || job.brief !== data.brief)) {
        return errorBody('revision-conflict', {detail: 'the dispatch does not match the approved job'});
      }
    } catch (error) {this.#storageFailure(error, command); return errorBody('internal');}
    if (!this.#connected() || this.#state.endpointId !== data.endpointId) return errorBody('unavailable', {detail: 'no coding worker endpoint is available for this dispatch'});
    // The wait's end, which follows this refusal, forgets the cancel and tells the cancelled task nothing.
    if (this.#cancelled.has(data.taskId)) {
      try {this.#store.unwait(data.requestId);} catch (error) {this.#storageFailure(error);}
      this.#changed();
      return errorBody('invalid-state', {detail: 'the task was cancelled before its hand-off started'});
    }
    const companion = this.#seams.companionOf?.(data.taskId);
    if (companion === undefined) return errorBody('not-found', {detail: 'the dispatch names no companion task'});
    const slot = this.#slotOf(companion), reserved = this.#reserved.get(slot);
    if (reserved !== data.requestId && this.#busy(slot)) return errorBody('capacity', {detail: 'that companion\'s coding slot is busy'});
    const active: Active = {operationId: data.requestId, taskId: data.taskId, endpointId: data.endpointId, traceparent: command.traceparent, started: false, status: 'pending',
      companion, phase: 'dispatching', wallClockMs: data.bounds.wallClockMs, cancel: noop, settling: false};
    try {this.#store.accept(active);}
    catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'coding responsibility could not be saved'});}
    if (reserved === data.requestId) this.#reserved.delete(slot);
    this.#active.set(active.operationId, active); this.#changed();
    active.cancel = this.context.scheduler.after(START_MS, () => {void this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});});
    // Ownership is durable before this handler returns; the work command does not hold the admission reply open.
    queueMicrotask(() => {void this.#start(active, data);});
    return {status: 'accepted'};
  }
  async #start(active: Active, data: CodingRun): Promise<void> {
    if (this.#active.get(active.operationId) !== active || active.settling || this.#closed) return;
    // A worker that declared slots (2.2) hears which companion asked; an older one gets the 2.0 start it knows.
    const tagged = this.#state.slots !== null;
    try {
      if (this.#store.stopRequested(active.operationId)) {
        await this.#settle(active, 'cancelled', undefined, 'stopped before worker start', {result: Outcome.failed, code: 'cancelled'});
        return;
      }
      const result = await this.context.sdk.request(`bunny.cmd.coding-work.${active.endpointId}`, {type: 'org.bunny.coding.work.requested', subject: active.endpointId,
        dataschema: `https://bunny.invalid/events/coding-work/${tagged ? '2.1' : '2.0'}`,
        data: {requestId: active.operationId, operationId: active.operationId, action: 'start', taskId: data.taskId, ...(tagged ? {companion: active.companion} : {}), repository: data.repository, brief: data.brief, bounds: data.bounds}},
      {requestId: active.operationId, timeoutMs: 5000, parent: active});
      if (this.#active.get(active.operationId) !== active || active.settling) return;
      if (result.status === Outcome.uncertain) await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});
      else if (result.status === Outcome.rejected) await this.#settle(active, 'failed', undefined, 'refused', {result: Outcome.failed, code: result.error.error.code});
    } catch {await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});}
  }
  async #progress(message: Message<CodingProgress>): Promise<void> {
    if (this.#closed || message.source !== CODING_WORKER_SOURCE || !this.#validator.validate(message).ok) return;
    const active = this.#active.get(message.data.operationId);
    if (active === undefined || message.subject !== active.endpointId || active.settling) return;
    const progress = message.data;
    if (progress.status === 'started') {
      if (active.started) return;
      active.started = true; active.cancel(); active.status = 'pending';
      try {this.#store.started(active.operationId);} catch (error) {this.#storageFailure(error, active); await this.#settle(active, 'uncertain', undefined, 'lost'); return;}
      // The tracked effect is "handed to the worker": observed, because the worker said so. The run's end is the task's business.
      try {await this.#outcome(active, {result: Outcome.succeeded}, 'observed');} catch (error) {this.#storageFailure(error, active);}
      if (active.phase === 'dispatching') active.phase = 'started';
      this.#changed();
      active.cancel = this.context.scheduler.after(active.wallClockMs + GRACE_MS + SETUP_MS, () => {void this.#settle(active, 'uncertain', undefined, 'timeout');});
      return;
    }
    if (!active.started) {await this.#settle(active, 'uncertain', progress.status === 'completed' ? progress.result : progress.result ?? undefined, 'lost', {result: Outcome.uncertain}); return;}
    if (progress.status === 'completed') await this.#settle(active, 'completed', progress.result);
    else await this.#settle(active, progress.status, progress.result ?? undefined, progress.reason);
  }
  #lost(): void {
    if (this.#closed) return;
    this.#unselect('unavailable');
  }
  /**
   * Ends an operation once: records the status, reports the tracked outcome when the worker never reported a start, and
   * delivers the worker's word to the task. A delivery that fails leaves the task to the owner's resume. The freed slot
   * then takes its oldest waiting hand-off.
   */
  async #settle(record: CodingResponsibility | Active, status: 'completed' | 'failed' | 'cancelled' | 'uncertain', result?: CodingResult | null, reason?: string,
    outcome?: {result: 'succeeded' | 'failed' | 'uncertain'; code?: string}, startup = false): Promise<void> {
    const active = 'settling' in record ? record : undefined;
    if (active !== undefined) {if (active.settling || this.#active.get(active.operationId) !== active) return; active.settling = true; active.cancel();}
    const text = describeResult(status, result, reason);
    // Keep the first terminal observation while the transaction is unavailable. Retrying only local persistence
    // leaves the operation fenced and never sends another worker command.
    let retryMs = 1000;
    const persist = async (): Promise<void> => {
      if (this.#closed || this.context.signal.aborted) return;
      let job: CodingJob | undefined;
      try {
        job = this.#store.job(record.operationId);
        await this.outbox.transaction(add => {
          this.#store.settle(record.operationId, status);
          if (job !== undefined) this.#store.update({...record, kind: 'result', text});
          if (outcome !== undefined) this.#addOutcome(add, record, outcome, record.started ? 'observed' : 'none');
        });
      } catch (error) {
        if (retryMs === 1000) this.#storageFailure(error, record);
        if (active !== undefined && !this.#closed && !this.context.signal.aborted) {
          active.cancel = this.context.scheduler.after(retryMs, () => {void persist();});
          retryMs = Math.min(retryMs * 2, 30_000);
        }
        return;
      }
      if (active !== undefined) {this.#active.delete(active.operationId); this.#changed();}
      try {
        if (job !== undefined) await this.#deliverJobUpdates(record.operationId, startup);
        else await this.deliver(record.taskId, text, record,
          {requestId: record.operationId, source: 'effect', text: status === 'uncertain' ? 'the coding worker outcome is unknown' : `the coding worker reported that the task ${status}`}, startup);
      } catch (error) {this.#storageFailure(error, record);}
      if (active !== undefined) this.#drain();
    };
    await persist();
  }
  #outcome(record: CodingResponsibility, outcome: {result: 'succeeded' | 'failed' | 'uncertain'; code?: string}, evidence: 'observed' | 'none'): Promise<void> {
    return this.outbox.transaction(add => {this.#addOutcome(add, record, outcome, evidence);});
  }
  #addOutcome(add: AddMessage, record: CodingResponsibility, outcome: {result: 'succeeded' | 'failed' | 'uncertain'; code?: string}, evidence: 'observed' | 'none'): void {
    const code = outcome.result === Outcome.uncertain ? 'uncertain-result' : isErrorCode(outcome.code) ? outcome.code : 'unavailable';
    add('bunny.event.coding-run.assistant', {kind: 'outcome', type: 'org.bunny.coding.run.completed', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/outcome/2.0', data: {requestId: record.operationId, result: outcome.result, evidence,
        ...(outcome.result === Outcome.succeeded ? {} : {error: errorBody(code).error})}}, {parent: record});
  }
  #storageFailure(error: unknown, parent?: TraceContext): void {
    recordLog(this.context.log, 'message.received', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.uncertain, 'bunny.code': fullDisk(error) ? 'capacity' : 'internal'}, parent);
  }
  #changed(binding = false): void {
    if (this.#closed || this.context.signal.aborted) return;
    try {this.#state.revision = advanceRevision(this.context.database());}
    catch (error) {this.#storageFailure(error); return;}
    if (binding) this.#bound = this.#state.revision;
    void this.context.sdk.publish('bunny.state.coding-state.coding', codingStateDraft(this.inspect())).catch(() => {
      recordLog(this.context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'unavailable'});
    });
  }
}
