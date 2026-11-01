// One coding worker endpoint, one operation at a time (Hub #502). The core's tracked dispatcher hands the module a
// `coding-run`; the module saves responsibility, sends one `coding-work` start to the worker's connection-bound
// endpoint and reports the tracked outcome when the worker reports it started. The worker's later progress settles the
// responsibility and reaches the task through the engine as the delegation's answer; nothing is resent, and a lost
// worker or a restart leaves the operation uncertain rather than restarting it.
import {MessageValidator, errorBody, isErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {CODING_WORKER_SOURCE, type CodingEndpointControl, type CodingLost, type CodingProgress, type CodingResult, type CodingRun, type CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {Outcome, fullDisk, recordLog, type AddMessage, type Cancel, type Command, type ModuleContext, type Outbox, type Reply, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {advanceRevision} from '../revision.js';
import {CodingStore, type CodingResponsibility} from './store.js';

export const codingStateDraft = (data: CodingState) => ({kind: 'state' as const, type: 'org.bunny.coding-state.updated', subject: 'coding',
  dataschema: 'https://bunny.invalid/events/coding-state/2.0', data});
/** Delivers the worker's final word to the task that waits for it; the engine turns it into the delegation tool's result. */
export type Delivery = (taskId: string, text: string, parent: TraceContext) => Promise<void>;
type Active = CodingResponsibility & {wallClockMs: number; cancel: Cancel; settling: boolean};
const noop = (): void => {};
/**
 * How long the worker may take to report it started once it accepted the work; the tracked outcome is uncertain after
 * that. Under the tracker's thirty-second device budget for `coding-run`, so the outcome lands before the tracker expires it.
 */
export const START_MS = 20_000;
/** Grace after the dispatch's wall clock before an unanswered run is given up as uncertain. */
export const GRACE_MS = 120_000;
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
  let text = lines.join('\n');
  // The task's serialized state is bounded at 32 KiB; a result that fits in 3,500 characters leaves room for the turn that reports it.
  if (text.length > 3500) text = `${text.slice(0, 3500)}\n(result text truncated)`;
  return text;
}

export class CodingCoordinator {
  readonly #store: CodingStore;
  readonly #validator = new MessageValidator();
  readonly #subscriptions: Subscription[] = [];
  #state: CodingState = {id: 'coding', revision: 0, endpointId: null, availability: 'off', active: null};
  #active: Active | undefined;
  #closed = false;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly deliver: Delivery) {
    this.#store = new CodingStore(context.database()); registerCoreFamilies(this.#validator);
  }
  inspect(): CodingState {return structuredClone(this.#state);}
  /** What a proposal binds to: whether a worker is available now and the revision that changes when that changes. */
  endpoint(): {available: boolean; endpointId: string | null; revision: number} {
    return {available: this.#state.availability === 'available' && this.#active === undefined && !this.#closed && !this.context.signal.aborted, endpointId: this.#state.endpointId, revision: this.#state.revision};
  }
  async start(): Promise<void> {
    // Responsibility that was pending at the last stop is uncertain now: the worker may have run, nothing is resent, and the task hears so.
    for (const record of this.#store.records('pending')) {
      await this.#settle(record, 'uncertain', undefined, 'lost', record.started ? undefined : {result: Outcome.uncertain});
    }
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
    this.#active?.cancel();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
  }
  /** The owner cancelled the task: ask the worker to stop; its cancelled report settles the operation. */
  cancel(taskId: string): void {
    const active = this.#active;
    if (active === undefined || active.taskId !== taskId || this.#closed || active.settling) return;
    if (this.#state.active !== null) {this.#state.active = {...this.#state.active, status: 'cancelling'}; this.#changed();}
    void this.context.sdk.request(`bunny.cmd.coding-work.${active.endpointId}`, {type: 'org.bunny.coding.work.requested', subject: active.endpointId,
      dataschema: 'https://bunny.invalid/events/coding-work/2.0', data: {requestId: `${active.operationId}-cancel`, operationId: active.operationId, action: 'cancel'}},
    {timeoutMs: 5000, parent: active}).catch(() => {});
  }
  #control(command: Command<CodingEndpointControl>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== CODING_WORKER_SOURCE) return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    if (command.data.action === 'enable') {
      if (this.#state.endpointId !== null && this.#state.endpointId !== command.subject) return errorBody('invalid-state', {detail: 'another coding worker endpoint is selected'});
      if (this.#state.availability !== 'available' || this.#state.endpointId !== command.subject) {this.#state.endpointId = command.subject; this.#state.availability = 'available'; this.#changed();}
      return {status: 'accepted'};
    }
    if (this.#state.endpointId !== command.subject) return errorBody('forbidden');
    this.#state.availability = 'off'; this.#state.endpointId = null;
    const active = this.#active;
    if (active !== undefined && !active.settling) void this.#settle(active, 'uncertain', undefined, 'lost');
    this.#changed();
    return {status: 'accepted'};
  }
  #accept(command: Command<CodingRun>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/core') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    const data = command.data;
    if (this.#active !== undefined) return this.#active.operationId === data.requestId ? {status: 'accepted'} : errorBody('capacity', {detail: 'the coding worker already runs one task'});
    if (this.#state.availability !== 'available' || this.#state.endpointId !== data.endpointId) return errorBody('unavailable', {detail: 'no coding worker endpoint is available for this dispatch'});
    const active: Active = {operationId: data.requestId, taskId: data.taskId, endpointId: data.endpointId, traceparent: command.traceparent, started: false, status: 'pending',
      wallClockMs: data.bounds.wallClockMs, cancel: noop, settling: false};
    try {this.#store.accept(active);}
    catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'coding responsibility could not be saved'});}
    this.#active = active; this.#state.active = {operationId: active.operationId, taskId: active.taskId, status: 'dispatching'}; this.#changed();
    active.cancel = this.context.scheduler.after(START_MS, () => {void this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});});
    // Ownership is durable before this handler returns; the work command does not hold the admission reply open.
    queueMicrotask(() => {void this.#send(active, data);});
    return {status: 'accepted'};
  }
  async #send(active: Active, data: CodingRun): Promise<void> {
    if (this.#active !== active || active.settling) return;
    try {
      const result = await this.context.sdk.request(`bunny.cmd.coding-work.${active.endpointId}`, {type: 'org.bunny.coding.work.requested', subject: active.endpointId,
        dataschema: 'https://bunny.invalid/events/coding-work/2.0',
        data: {requestId: active.operationId, operationId: active.operationId, action: 'start', taskId: data.taskId, repository: data.repository, brief: data.brief, bounds: data.bounds}},
      {requestId: active.operationId, timeoutMs: 5000, parent: active});
      if (this.#active !== active || active.settling) return;
      if (result.status === Outcome.uncertain) await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});
      else if (result.status === Outcome.rejected) await this.#settle(active, 'failed', undefined, 'refused', {result: Outcome.failed, code: result.error.error.code});
    } catch {await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});}
  }
  async #progress(message: Message<CodingProgress>): Promise<void> {
    const active = this.#active;
    if (this.#closed || active === undefined || message.source !== CODING_WORKER_SOURCE || message.subject !== active.endpointId
      || !this.#validator.validate(message).ok || message.data.operationId !== active.operationId || active.settling) return;
    const progress = message.data;
    if (progress.status === 'started') {
      if (active.started) return;
      active.started = true; active.cancel(); active.status = 'pending';
      try {this.#store.started(active.operationId);} catch (error) {this.#storageFailure(error, active); await this.#settle(active, 'uncertain', undefined, 'lost'); return;}
      // The tracked effect is "handed to the worker": observed, because the worker said so. The run's end is the task's business.
      try {await this.#outcome(active, {result: Outcome.succeeded}, 'observed');} catch (error) {this.#storageFailure(error, active);}
      this.#state.active = {operationId: active.operationId, taskId: active.taskId, status: 'started'}; this.#changed();
      active.cancel = this.context.scheduler.after(active.wallClockMs + GRACE_MS, () => {void this.#settle(active, 'uncertain', undefined, 'timeout');});
      return;
    }
    if (!active.started) {await this.#settle(active, 'uncertain', progress.status === 'completed' ? progress.result : progress.result ?? undefined, 'lost', {result: Outcome.uncertain}); return;}
    if (progress.status === 'completed') await this.#settle(active, 'completed', progress.result);
    else await this.#settle(active, progress.status, progress.result ?? undefined, progress.reason);
  }
  #lost(): void {
    if (this.#closed) return;
    this.#state.availability = 'unavailable'; this.#state.endpointId = null;
    const active = this.#active;
    if (active !== undefined && !active.settling) void this.#settle(active, 'uncertain', undefined, 'lost', active.started ? undefined : {result: Outcome.uncertain});
    this.#changed();
  }
  /**
   * Ends an operation once: records the status, reports the tracked outcome when the worker never reported a start, and
   * delivers the worker's word to the task. A delivery that fails leaves the task to the owner's resume.
   */
  async #settle(record: CodingResponsibility | Active, status: 'completed' | 'failed' | 'cancelled' | 'uncertain', result?: CodingResult | null, reason?: string,
    outcome?: {result: 'succeeded' | 'failed' | 'uncertain'; code?: string}): Promise<void> {
    const active = 'settling' in record ? record : undefined;
    if (active !== undefined) {if (active.settling || this.#active !== active) return; active.settling = true; active.cancel();}
    try {
      await this.outbox.transaction(add => {
        this.#store.settle(record.operationId, status);
        if (outcome !== undefined) this.#addOutcome(add, record, outcome, record.started ? 'observed' : 'none');
      });
    } catch (error) {this.#storageFailure(error, record);}
    if (active !== undefined) {this.#active = undefined; this.#state.active = null; this.#changed();}
    try {await this.deliver(record.taskId, describeResult(status, result, reason), {traceparent: record.traceparent});}
    catch (error) {this.#storageFailure(error, record);}
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
  #changed(): void {
    if (this.#closed || this.context.signal.aborted) return;
    try {this.#state.revision = advanceRevision(this.context.database());}
    catch (error) {this.#storageFailure(error, this.#active); return;}
    void this.context.sdk.publish('bunny.state.coding-state.coding', codingStateDraft(this.inspect())).catch(() => {
      recordLog(this.context.log, 'message.received', {'bunny.operation': 'status', 'bunny.outcome': Outcome.rejected, 'bunny.code': 'unavailable'});
    });
  }
}
