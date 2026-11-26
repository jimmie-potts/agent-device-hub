import type {OpenNativeClientInput} from '../assistant/history-contract.js';
import type {ContinueCodingControl} from '@jimmie-potts/event-contracts/v2/assistant';
import {chooseCodingHarness, codingHarness, selectCodingWorker, type CodingCandidate, type CodingChoice, type CodingDestinationChoice, type CodingRequirements, type CodingResource} from './routing.js';
import {createHash, randomUUID} from 'node:crypto';
import type {ActionEvidence} from '../assistant/closing-reply.js';
// One coding worker endpoint with one slot per companion (Hub #502, #2028). The core's tracked dispatcher hands the
// module a `coding-run`; the module saves responsibility, sends one `coding-work` start to the worker's connection-bound
// endpoint and reports the tracked outcome when the worker reports it started. The worker's later progress settles the
// responsibility and reaches the task through the engine as the delegation's answer; nothing is resent, and a lost
// worker or a restart leaves each of its operations uncertain rather than restarting it. An approved hand-off whose
// companion's slot is busy waits, durably and first in first out, and is dispatched once when that slot frees.
import {errorBody, isErrorCode, type ErrorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {continuationChecks, CODING_SETUP_WAIT_MS, CODING_SETUP_WORK_MS, CODING_WORKER_SLOTS, codingDestinationForSource, DEFAULT_CODING_BOUNDS, type CodingDestination, type CodingWorkerDeclaration, type CodingAttemptContext, type CodingCompanion, type CodingEndpointControl, type CodingHarnessId, type CodingLost, type CodingNativeClient, type CodingWorkerProgress, type CodingResult, type CodingRun,
  type CodingRunEntry, type CodingSetup, type CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import {Outcome, fullDisk, recordLog, type AddMessage, type Cancel, type Command, type ModuleContext, type Outbox, type Reply, type RequestResult, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {advanceRevision} from '../revision.js';
import {CODING_JOB_PAGE_SIZE, type CodingAttemptEntry, type CodingAttemptResult, type CodingJobDetail, type CodingJobEntry, type CodingJobPage, type JobNativeClient, type NativeObservation} from './job-page.js';
import {CodingStore, type AttemptDestination, type CodingAttempt, type CodingJob, type CodingResponsibility, type CodingWaitingRecord} from './store.js';

/** Workers offering adapter selection add harness declarations and active session attribution in 2.3. */
export const codingStateDraft = (data: CodingState) => ({kind: 'state' as const, type: 'org.bunny.coding-state.updated', subject: 'coding',
  dataschema: `https://bunny.invalid/events/coding-state/${data.workers !== undefined ? '2.5' : data.counts !== undefined ? '2.4' : data.harnesses === undefined && data.runs?.some(run => run.harness !== undefined || run.sessionId !== undefined) !== true ? '2.2' : '2.3'}`, data: {...data, readiness: data.readiness ?? null, slots: data.slots ?? null, runs: data.runs ?? [], waiting: data.waiting ?? []}});
/**
 * Delivers the worker's final word to the task that waits for it; the engine turns it into the delegation tool's result.
 * `startup` marks the settlement, at start, of responsibility still pending at the last stop.
 */
export type Delivery = (taskId: string, text: string, parent: TraceContext, evidence: ActionEvidence, startup: boolean) => Promise<void>;
/** An approved hand-off as the engine gives it: the task, the companion whose slot it needs and the endpoint revision the proposal saw. */
export type HandOff = {requestId: string; taskId: string; conversationId?: string; companion: CodingCompanion; repository: string; brief: string; expectedRevision: number; choice?: CodingChoice; destination?: CodingDestinationChoice; requirements?: CodingRequirements};
/** The core's answer for a hand-off sent now, or `waiting` for one held until its companion's slot frees. */
export type CodingBrief = Pick<HandOff, 'requestId' | 'taskId' | 'repository' | 'brief'>;
export type HandOffAnswer = RequestResult | {status: 'waiting'; requestId: string} | {status: 'queued'; requestId: string; jobId: string};
/**
 * What the coordinator asks the engine (Hub #2028): the companion a task belongs to, so a run is tagged with the
 * companion that asked; whether a task still waits on this delegation, so a waiting hand-off whose task was cancelled
 * or ended, even while the coordinator was stopped, is dropped unsent; and the news that a waiting hand-off was sent.
 */
export type CodingBriefRefusal = 'unverified-supervisor' | 'grant-denied';
export type CodingSeams = {
  briefRefusal?: (brief: CodingBrief) => CodingBriefRefusal | undefined;
  jobQueued?: (job: CodingJob, add: AddMessage, parent: TraceContext) => void;
  jobUpdate?: (job: CodingJob, kind: 'sent' | 'stop-unconfirmed' | 'result', text: string, parent: TraceContext, startup: boolean) => Promise<void>;
  companionOf?: (taskId: string) => CodingCompanion | undefined;
  jobVisible?: (job: Pick<CodingJob, 'jobId' | 'taskId' | 'conversationId' | 'operationId' | 'repository'>, companion: CodingCompanion) => boolean;
  legacyOperationVisible?: (operation: Pick<CodingRunEntry, 'operationId' | 'taskId' | 'companion'>) => boolean;
  jobBriefVisible?: (job: CodingJob, companion: CodingCompanion) => boolean;
  allowMessage?: (job: CodingJob, companion: CodingCompanion, destination?: CodingDestination) => boolean;
  allowDestination?: (brief: CodingBrief, destination: CodingDestination) => boolean;
  allowResource?: (brief: CodingBrief, resource: CodingResource, destination: CodingDestination) => boolean;
  awaits?: (taskId: string) => boolean;
  sent?: (taskId: string, operationId: string, parent: TraceContext) => void | Promise<void>;
};
type Phase = CodingRunEntry['status'];
type Active = CodingResponsibility & {worker: Worker;companion: CodingCompanion; phase: Phase; wallClockMs: number; cancel: Cancel; settling: boolean; uncapped: boolean; deliveryStarted?: true; setup?: CodingSetup; harness?: CodingHarnessId; sessionId?: string; stopEvidence?: string};
type Worker = Pick<CodingState, 'readiness' | 'slots' | 'capacity' | 'harnesses' | 'selectionId'> & {
  destination: CodingDestination; endpointId: string; receivedAt: number; declaration?: CodingWorkerDeclaration;
  delivery?: StartDelivery; reply?: Promise<void>;
};
type StartDelivery = {endpointId: string; record: CodingWaitingRecord; discarded?: true; workerReply?: Promise<void>};
const noop = (): void => {};
function privateDisplayText(value: string): string | undefined {
  // Shared job facts carry no absolute paths or unbounded worker output.
  return /(?:^|[\s"'(`=:])(?:[A-Za-z]:[\\/]|\\\\|~?\/)[^\s]/u.test(value) ? undefined : value.slice(0, 240);
}
function attemptResult(result: CodingResult): CodingAttemptResult {
  const limitations = result.limitations.flatMap(line => {
    const allowed = privateDisplayText(line);
    return allowed === undefined ? [] : [allowed];
  }).slice(0, 12);
  return {outcome: result.outcome, base: result.base, head: result.head, usage: result.usage, limitations,
    changedFiles: result.changedFiles.filter(path => /^(?![-/]|[A-Za-z]:)(?:[^\\/]+\/)*[^\\/]+$/u.test(path) && !path.split('/').some(part => part === '.' || part === '..')),
    checks: continuationChecks(result.checks),
    ...(result.outcome === 'waiting-for-owner' ? {pendingDecision: privateDisplayText(result.findings[0] ?? '') ?? ''} : {})};
}
const UNVERIFIED_SUPERVISOR = 'The original supervisor or coding approval could not be verified. This coding job did not start. Create a new job to authorize it.';
const DISCONNECTED_BEFORE_START = 'worker became unavailable before start was sent';
const STOP_UNCONFIRMED = "A stop was requested. The worker's stop is unconfirmed.";
const STORAGE_RETRY_MS = 1000;
const MAX_STORAGE_RETRY_MS = 30_000;
const waitWriteKey = (operationId: string): string => `wait:${operationId}`;
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
const words = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function matchesJob(job: CodingJob, target: string, brief: string): boolean {
  if (target === job.jobId || target === job.operationId) return true;
  const term = words(target);
  return term !== '' && (term === words(job.repository) || ` ${words(brief)} `.includes(` ${term} `));
}
const short = (sha: string | null): string => sha === null ? 'unknown' : sha.slice(0, 8);

/** The worker's structured result as bounded text for the model and the owner: facts the worker observed, never a path or a prompt. */
export function describeResult(status: 'completed' | 'failed' | 'cancelled' | 'uncertain', result: CodingResult | null | undefined, reason?: string): string {
  const head = status === 'completed' ? `completed (${result?.outcome ?? 'unknown'})` : `${status}${reason === undefined ? '' : ` (${reason})`}`;
  if (reason === DISCONNECTED_BEFORE_START) return `${head}. The job did not start.`;
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
  readonly #native = new Map<string, {selectionId: string | undefined; view: JobNativeClient}>();
  #state: Pick<CodingState, 'revision' | 'endpointId' | 'availability' | 'readiness' | 'slots' | 'capacity' | 'harnesses' | 'selectionId'> = {revision: 0, endpointId: null, availability: 'off', readiness: null, slots: null};
  #bound = 0;
  /** Every operation the worker holds, by operation ID, in the order they were accepted. */
  readonly #active = new Map<string, Active>();
  /** Each slot's hand-off on its way through the core, so a second one never leaves for the same slot. */
  readonly #reserved = new Map<string, string>();
  /** One uncapped delivery awaits both the core response and the worker's acknowledgement. Running jobs do not hold it. */
  readonly #workers = new Map<CodingDestination, Worker>();
  /** Tasks cancelled while their hand-off was on its way from the queue: its arrival is refused, so nothing runs. */
  readonly #cancelled = new Set<string>();
  readonly #observationWrites = new Map<string, Cancel>();
  readonly #delivering = new Set<string>();
  #deliveryRetry: Cancel | undefined;
  #deliveryRetryMs = STORAGE_RETRY_MS;
  #closed = false;
  #starting = false;
  readonly #seams: CodingSeams;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly deliver: Delivery, seams: CodingSeams = {}) {
    this.#seams = seams;
    this.#store = new CodingStore(context.database());
  }
  #primary(): Worker | undefined {return this.#workers.get('mac') ?? this.#workers.values().next().value;}
  #workerFor(attempt: CodingAttempt | undefined): Worker | undefined {
    const binding = attempt?.binding;
    const worker = this.#workers.get(binding?.actual ?? 'mac');
    if (binding?.endpointId !== undefined && (worker?.endpointId !== binding.endpointId || worker.selectionId !== binding.selectionId)) return undefined;
    return worker;
  }
  #byEndpoint(endpointId: string): Worker | undefined {
    return [...this.#workers.values()].find(worker => worker.endpointId === endpointId);
  }
  #allowed(brief: CodingBrief, destination: CodingDestination): boolean {
    if (this.#seams.allowDestination === undefined) return destination === 'mac';
    const attempt = this.#store.attempt(brief.requestId);
    const requestId = attempt?.continuation === undefined ? brief.requestId : this.#store.jobRead(brief.requestId)?.originalOperationId;
    return requestId !== undefined && this.#seams.allowDestination({...brief, requestId}, destination);
  }
  #route(data: CodingBrief, choice: CodingChoice, destination: CodingDestinationChoice, requirements?: CodingRequirements, candidates = [...this.#workers.values()]) {
    const workers: CodingCandidate[] = candidates.map(worker => ({destination: worker.destination, endpointId: worker.endpointId, receivedAt: worker.receivedAt,
      ...(worker.selectionId === undefined ? {} : {selectionId: worker.selectionId}), ...(worker.declaration === undefined ? {} : {declaration: worker.declaration}),
      ...(worker.harnesses == null ? {} : {harnesses: worker.harnesses}), legacyDefault: worker.harnesses == null,
      running: [...this.#active.values()].filter(active => active.worker === worker).length}));
    return selectCodingWorker(workers, {repository: data.repository, choice, destination, now: this.context.clock.now(), ...(requirements === undefined ? {} : {requirements}),
      allowed: dest => this.#allowed(data, dest), resourceAllowed: (resource, dest) => this.#seams.allowResource?.(data, resource, dest) === true});
  }
  jobForAttempt(operationId: string): CodingJob | undefined {return this.#store.job(operationId);}
  jobRead(...args: Parameters<CodingStore['jobRead']>): ReturnType<CodingStore['jobRead']> {return this.#store.jobRead(...args);}
  /** Whether a hand-off was accepted as a run, so one that waited is known to have been sent. */
  accepted(operationId: string): boolean {
    try {return this.#active.has(operationId) || this.#store.accepted(operationId);} catch {return false;}
  }
  jobs(after = '', includeEnded = false, jobId?: string, target?: string): CodingJobPage {
    const jobs: CodingJobEntry[] = [];
    let cursor = after;
    for (;;) {
      const rows = this.#store.jobs({after: cursor, includeEnded, limit: CODING_JOB_PAGE_SIZE + 1, ...(jobId === undefined ? {} : {jobId})});
      for (const job of rows) {
        const active = this.#active.get(job.operationId);
        const companion = active?.companion ?? job.companion ?? this.#seams.companionOf?.(job.taskId);
        if (companion === undefined || this.#seams.jobVisible?.(job, companion) === false) continue;
        const original = this.#store.job(job.operationId);
        const canReadBrief = original !== undefined && this.#seams.jobBriefVisible?.(original, companion) !== false;
        const brief = canReadBrief ? original.brief : '';
        if (target !== undefined && (original === undefined || !matchesJob(original, target, brief))) continue;
        if (jobs.length === CODING_JOB_PAGE_SIZE) return {version: 1, jobs, next: jobs.at(-1)?.jobId ?? null};
        const label = privateDisplayText(brief.split(/\r?\n/u, 1)[0] ?? '')?.slice(0, 128) ?? '';
        const status = active?.phase ?? job.status;
        const attempt = this.#store.attempt(job.operationId);
        const {nativeObservation, ...context} = attempt?.context ?? {};
        const nativeView = attempt === undefined ? undefined : this.#nativeView(attempt.operationId, nativeObservation);
        const nativeClient = nativeView !== undefined && original !== undefined && this.#canUseCodingBrief(original, companion) ? nativeView : undefined;
        jobs.push({...job, companion, status, ...(attempt?.binding === undefined ? {} : {requestedHarness: attempt.choice, requestedDestination: attempt.binding.requested, selectedDestination: attempt.binding.actual, ...(this.#store.workerStarted(attempt.operationId) ? {actualDestination: attempt.binding.actual} : {}), selectionReason: attempt.selectionReason}), ...(label === '' ? {} : {label}), ...(nativeClient === undefined ? {} : {nativeClient}),
          ...(attempt?.harness == null ? {} : {harness: attempt.harness}), steering: this.#steering(active), messages: this.#store.messages(job.jobId).filter(message =>
            this.#seams.jobVisible?.({...job, operationId: message.operationId}, companion) !== false),
          ...context, ...(attempt?.sessionId == null ? {} : {sessionId: attempt.sessionId}), ...(active === undefined ? {} : this.#runContext(active))});
      }
      if (rows.length < CODING_JOB_PAGE_SIZE + 1) return {version: 1, jobs, next: null};
      cursor = rows.at(-1)?.jobId ?? cursor;
    }
  }
  #nativeView(operationId: string, saved?: NativeObservation): JobNativeClient | undefined {
    const native = this.#native.get(operationId);
    const attempt = this.#store.attempt(operationId);
    if (attempt?.binding !== undefined && attempt.binding.actual !== 'mac') return undefined;
    const worker = this.#workerFor(attempt);
    if (native !== undefined && worker !== undefined && this.#connected() && native.selectionId === worker.selectionId) return native.view;
    const last = native?.view ?? saved;
    if (last === undefined) return undefined;
    return {clients: last.clients, state: last.state === 'available' ? 'offline' : last.state === 'terminal-closed' ? 'terminal-closed' : 'uncertain', observedAtMs: last.observedAtMs};
  }
  #continuation(attempt: CodingAttempt | undefined): CodingJobDetail['continuation'] {
    const worker = this.#workerFor(attempt);
    if (worker === undefined || attempt === undefined || attempt.handoffToken === undefined || attempt.selectionId === undefined ||
      attempt.selectionId !== worker.selectionId || !codingHarness(attempt.harness) ||
      attempt.result?.head == null || attempt.result.changedFiles.length === 0 ||
      (attempt.status === 'completed' && attempt.result.outcome === 'tested-candidate') || !this.#connected() || worker.capacity !== 'uncapped') return null;
    const client = this.#nativeView(attempt.operationId, attempt.context?.nativeObservation);
    if (client !== undefined && client.state !== 'available') return null;
    const harness = attempt.harness === 'claude-code' ? 'codex' : 'claude-code';
    const choice = chooseCodingHarness(harness, worker.harnesses ?? [], this.context.clock.now());
    if (choice.harness === undefined) return null;
    return {fromOperationId: attempt.operationId, harness, head: attempt.result.head, changedFiles: attempt.result.changedFiles};
  }
  #canUseCodingBrief(job: CodingJob, companion: CodingCompanion): boolean {
    const brief = {...job, requestId: job.operationId};
    return this.#allowed(brief, this.#store.attempt(job.operationId)?.binding?.actual ?? 'mac') && this.#seams.jobBriefVisible?.(job, companion) !== false && this.#briefRefusal(brief) === undefined;
  }
  jobDetail(jobId: string): CodingJobDetail | undefined {
    const job = this.#store.jobById(jobId);
    if (job === undefined) return undefined;
    const saved = this.#store.attempts(jobId);
    const last = saved.at(-1);
    const companion = last?.companion ?? this.#seams.companionOf?.(job.taskId);
    const visible = (operationId: string, owner = companion): boolean => owner !== undefined &&
      this.#seams.jobVisible?.({...job, operationId}, owner) !== false;
    const current = last?.operationId ?? job.operationId;
    if (!visible(current)) return undefined;
    const attempts: CodingAttemptEntry[] = saved.filter(attempt => visible(attempt.operationId, attempt.companion))
      .map(({operationId, companion: owner, choice, harness, sessionId, status, selectionReason, result, context, binding}) => {
        const active = this.#active.get(operationId);
        const {nativeObservation, ...attemptContext} = context ?? {};
        const nativeVisible = nativeObservation !== undefined && this.#canUseCodingBrief({...job, operationId}, owner);
        return {operationId, harness, ...(binding === undefined ? {} : {requestedHarness: choice, requestedDestination: binding.requested, selectedDestination: binding.actual, ...(this.#store.workerStarted(operationId) ? {actualDestination: binding.actual} : {})}), sessionId: active?.sessionId ?? sessionId, status: active?.phase ?? status, selectionReason, result,
          ...(context === undefined ? {} : {context: {...attemptContext, ...(nativeVisible ? {nativeObservation} : {})}})};
      });
    if (saved.length === 0) {
      const active = this.#active.get(job.operationId);
      attempts.push({operationId: job.operationId, harness: codingHarness(active?.harness) ? active.harness : null, sessionId: active?.sessionId ?? null,
        status: active?.phase ?? this.#store.terminalStatus(job.operationId) ?? (this.#store.resultSaved(job.operationId) ? 'uncertain' : 'queued'),
        selectionReason: 'Legacy worker selection.', result: null});
    }
    const latest = last, candidate = this.#continuation(latest);
    const briefDenied = candidate !== null && (companion === undefined || !this.#canUseCodingBrief({...job, operationId: current}, companion));
    const continuation = briefDenied ? null : candidate;
    const activeOperationId = this.#store.resultSaved(current) ? null : current;
    const continuationReason = continuation !== null || activeOperationId !== null || latest === undefined ? undefined :
      briefDenied ? 'Coding brief sharing is not permitted.' :
      latest.status === 'uncertain' ? 'The previous writer may still be active.' :
      latest.status === 'completed' && latest.result?.outcome === 'tested-candidate' ? 'The previous attempt completed without a partial result.' :
      'Continuation requires a stopped, confined writer, an unchanged checkout and an eligible subscription in the other harness. Cross-host checkout transfer is unsupported.';
    return {version: 1, jobId, choice: saved[0]?.choice ?? 'auto', ...(saved[0]?.binding === undefined ? {} : {requestedDestination: saved[0].binding.requested}), activeOperationId, attempts, continuation,
      ...(continuationReason === undefined ? {} : {continuationReason})};
  }
  /** Called inside the assistant admission transaction. Dispatch starts only after commit. */
  prepareContinuation(data: ContinueCodingControl, parent: TraceContext): {committed: () => void} | {code: 'not-found' | 'invalid-state' | 'unavailable' | 'forbidden'; detail: string} {
    const job = this.#store.job(data.operationId);
    if (job?.jobId !== data.jobId) return {code: 'not-found', detail: 'No such coding job attempt.'};
    const attempt = this.#store.attempts(job.jobId).at(-1);
    if (attempt !== undefined && this.#seams.jobVisible?.(job, attempt.companion) === false) return {code: 'not-found', detail: 'No such coding job attempt.'};
    if (attempt?.operationId !== data.operationId || !this.#store.resultSaved(data.operationId)) return {code: 'invalid-state', detail: 'The source attempt is not the latest terminal attempt.'};
    const next = this.#continuation(attempt);
    if (next === null || attempt.handoffToken === undefined) return {code: 'unavailable', detail: 'A verified stopped writer, worktree and eligible second harness are required.'};
    if (next.harness !== data.harness) return {code: 'invalid-state', detail: 'Choose the other harness to continue.'};
    if (!this.#canUseCodingBrief(job, attempt.companion)) return {code: 'forbidden', detail: 'Coding brief sharing is not permitted.'};
    const operationId = randomUUID();
    this.#store.createAttempt({jobId: job.jobId, operationId, companion: attempt.companion, choice: data.harness, harness: data.harness,
      selectionReason: `Explicit continuation of ${data.operationId}.`, ...(attempt.binding === undefined ? {} : {binding: {...attempt.binding, requested: attempt.binding.actual}}), continuation: {fromOperationId: data.operationId, token: attempt.handoffToken}});
    this.#store.wait({operationId, taskId: job.taskId, companion: attempt.companion, repository: job.repository, brief: job.brief, traceparent: parent.traceparent});
    return {committed: () => {this.#changed(); this.#drain();}};
  }
  #runContext(active: Active): Pick<CodingRunEntry, 'setup' | 'harness' | 'sessionId'> {
    return {...(active.setup === undefined ? {} : {setup: active.setup}), ...(active.harness === undefined ? {} : {harness: active.harness}),
      ...(active.sessionId === undefined ? {} : {sessionId: active.sessionId})};
  }
  #operationVisible(operation: Pick<CodingRunEntry, 'operationId' | 'taskId' | 'companion'>): boolean {
    const job = this.#store.job(operation.operationId);
    return job === undefined ? this.#seams.legacyOperationVisible?.(operation) === true
      : job.taskId === operation.taskId && this.#seams.jobVisible?.(job, operation.companion) !== false;
  }
  inspect(): CodingState {
    let runs: CodingRunEntry[] = [], runCount = 0;
    let waiting: CodingState['waiting'] = [], waitingCount = 0;
    try {
      const visibleRuns = [...this.#active.values()].filter(active => this.#operationVisible(active));
      runCount = visibleRuns.length;
      runs = visibleRuns.slice(0, 8).map(active => ({operationId: active.operationId, taskId: active.taskId,
        companion: active.companion, status: active.phase, ...this.#runContext(active)}));
      const visibleWaits = this.#store.waiting().filter(wait => this.#operationVisible(wait));
      waitingCount = visibleWaits.length;
      waiting = visibleWaits.slice(0, WAITING_LIMIT).map(({operationId, taskId, companion}) => ({operationId, taskId, companion}));
    } catch (error) {this.#storageFailure(error);}
    const first = runs[0];
    const roster = [...this.#workers.values()].some(worker => worker.declaration !== undefined);
    const paged = roster || this.#uncapped() || waitingCount > WAITING_LIMIT || runCount > 8 || runs.some(run => run.setup !== undefined) ||
      new Set(runs.map(run => run.companion)).size !== runs.length;
    return structuredClone({id: 'coding', ...this.#state, ...(roster ? {workers: [...this.#workers.values()].flatMap(worker => worker.selectionId === undefined ? [] :
      [{destination: worker.destination, endpointId: worker.endpointId, selectionId: worker.selectionId}])} : {}), active: first === undefined ? null : {operationId: first.operationId, taskId: first.taskId, status: first.status}, runs, waiting,
      ...(paged ? {capacity: this.#state.capacity ?? null, counts: {runs: runCount, waiting: waitingCount}} : {})});
  }
  #uncapped(): boolean {return this.#state.capacity === 'uncapped';}
  /**
   * The slot a companion's run uses: its own when the worker declared one per companion, else the one slot an older
   * worker that declares none holds for every companion.
   */
  #slotOf(companion: CodingCompanion, worker = this.#workers.get('mac')): string {
    return (worker?.slots ?? 1) >= CODING_WORKER_SLOTS ? companion : 'shared';
  }
  #busy(slot: string, worker = this.#workers.get('mac')): boolean {
    const active = [...this.#active.values()].filter(run => run.worker === worker);
    return worker?.capacity !== 'uncapped' && (this.#reserved.has(slot) || active.some(run => this.#slotOf(run.companion, worker) === slot)
      || active.length + this.#reserved.size >= (worker?.slots ?? 1));
  }
  #connected(): boolean {return this.#workers.size > 0 && !this.#closed && !this.context.signal.aborted;}
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
    this.#store.recoverDeliveries();
    this.#store.recoverMessages();
    // Responsibility that was pending at the last stop is uncertain now: the worker may have run, nothing is resent, and the task hears so.
    for (const record of this.#store.records('pending')) {
      if (record.sent === false && !record.started) await this.#settle(record, 'failed', undefined, DISCONNECTED_BEFORE_START, {result: Outcome.failed, code: 'unavailable'}, true);
      else await this.#settle(record, 'uncertain', undefined, 'lost', record.started ? undefined : {result: Outcome.uncertain}, true);
    }
    // A hand-off whose dispatch had left without its acceptance recorded may have reached the core: its fate is unknown
    // and it is never sent again. One that never left keeps its place and is sent when its slot frees.
    for (const record of this.#store.waiting()) {
      if (record.sending) await this.#endWait(record);
      else if (this.#store.attempt(record.operationId)?.binding?.endpointId !== undefined) {
        await this.#endWait(record, {status: Outcome.rejected, requestId: record.operationId, error: errorBody('unavailable')}, true);
      }
    }
    await this.#deliverObservations();
    this.#starting = false;
    this.#subscriptions.push(await this.context.sdk.respond<CodingEndpointControl>('bunny.cmd.coding-endpoint.*', command => this.#control(command)));
    this.#subscriptions.push(await this.context.sdk.respond<CodingRun>('bunny.cmd.coding-run.assistant', command => this.#accept(command)));
    this.#subscriptions.push(await this.context.sdk.subscribe<CodingWorkerProgress>('bunny.event.coding-progress.*', message => this.#progress(message), {onOverflow: () => {this.#lost();}}));
    this.#subscriptions.push(await this.context.sdk.subscribe<CodingLost>('bunny.event.coding-lost.*', message => {
      if (message.source === 'bunny/runtime/gateway' && this.#validator.validate(message).ok) {
        const worker = this.#byEndpoint(message.data.id);
        if (worker !== undefined) this.#unselect(worker, 'unavailable');
      }
    }, {onOverflow: () => {this.#lost();}}));
    this.#changed();
  }
  async stop(): Promise<void> {
    this.#closed = true;
    for (const active of this.#active.values()) active.cancel();
    for (const cancel of this.#observationWrites.values()) cancel();
    this.#observationWrites.clear();
    this.#deliveryRetry?.();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
  }
  /**
   * Takes an approved hand-off (Hub #2028). With no worker connected, or a proposal bound to an endpoint that has since
   * changed, it is refused and nothing is sent. A free slot sends it now through the core's tracked dispatcher and
   * answers with the core's answer; a busy one, or one with a line, keeps it waiting in order and answers `waiting`.
   */
  async handOff(data: HandOff, parent: TraceContext): Promise<HandOffAnswer> {
    const refused = (code: 'unavailable' | 'revision-conflict' | 'capacity' | 'internal' | 'forbidden', detail: string): HandOffAnswer => ({status: Outcome.rejected, requestId: data.requestId, error: errorBody(code, {detail})});
    const brief = this.#briefRefusal(data);
    if (brief !== undefined) return {status: Outcome.rejected, requestId: data.requestId, error: brief};
    if (data.conversationId !== undefined) {
      const {requestId: operationId, conversationId, taskId, companion, repository, brief} = data;
      const jobId = `${operationId}-job`;
      try {
        const existing = this.#store.job(operationId);
        const previous = this.#store.attempt(operationId);
        if (existing !== undefined && ((data.choice !== undefined && this.#store.attempt(operationId)?.choice !== data.choice) || (previous?.binding?.requested ?? 'auto') !== (data.destination ?? 'auto') || JSON.stringify(previous?.binding?.requirements) !== JSON.stringify(data.requirements) || existing.conversationId !== conversationId || existing.taskId !== taskId ||
          existing.repository !== repository || existing.brief !== brief)) return refused('revision-conflict', 'the request ID names another coding job');
        if (existing === undefined) {
          if (!this.#connected()) return refused('unavailable', 'no coding worker is connected');
          if (this.#bound !== data.expectedRevision) return refused('revision-conflict', 'the coding worker changed since the proposal');
          const choice = data.choice ?? 'auto';
          const requested = data.destination ?? 'auto';
          const mac = this.#workers.get('mac');
          const implicitLegacy = data.choice === undefined && data.destination === undefined && data.requirements === undefined &&
            this.#workers.size === 1 && mac !== undefined && mac.declaration === undefined && mac.capacity !== 'uncapped';
          const route = implicitLegacy && this.#allowed(data, 'mac') ? {worker: mac, harness: undefined, revision: undefined, forbidden: false, reason: 'The default Claude Code worker was selected.'}
            : this.#route(data, choice, requested, data.requirements);
          if (route.worker === undefined) return refused(route.forbidden === true ? 'forbidden' : 'unavailable', route.reason);
          const worker = this.#workers.get(route.worker.destination);
          if (worker === undefined) return refused('unavailable', DISCONNECTED_BEFORE_START);
          if (worker.declaration !== undefined && (worker.selectionId === undefined || route.revision === undefined)) return refused('unavailable', 'The worker revision or connection identity is unavailable.');
          const binding: AttemptDestination = {requested, actual: worker.destination,
            ...(data.requirements === undefined ? {} : {requirements: data.requirements}),
            ...(route.revision === undefined || worker.selectionId === undefined ? {} : {endpointId: worker.endpointId, selectionId: worker.selectionId, revision: route.revision})};
          if (worker.capacity !== 'uncapped' && this.#store.waitingCount(worker.destination) >= WAITING_LIMIT) return refused('capacity', 'too many coding hand-offs are waiting');
          await this.outbox.transaction(add => {
            const job = {jobId, operationId, conversationId, taskId, repository, brief};
            this.#store.create(job);
            this.#store.createAttempt({jobId, operationId, choice, companion, harness: route.harness ?? null, selectionReason: route.reason, binding});
            this.#store.wait({operationId, taskId, companion, repository, brief, traceparent: parent.traceparent});
            this.#seams.jobQueued?.(job, add, parent);
          });
          this.#changed();
          this.#drain();
        }
      } catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'the coding job could not be saved');}
      return {status: 'queued', requestId: operationId, jobId};
    }
    const legacyWorker = this.#workers.get('mac');
    if (!this.#connected() || legacyWorker === undefined) return refused('unavailable', 'no authorized default Mac coding worker is connected');
    if (this.#bound !== data.expectedRevision) return refused('revision-conflict', 'the coding worker changed since the proposal');
    const slot = this.#slotOf(data.companion);
    let waiting: CodingWaitingRecord[];
    try {waiting = this.#store.waiting();} catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'coding hand-offs could not be read');}
    if (waiting.some(record => record.operationId === data.requestId)) return {status: 'waiting', requestId: data.requestId};
    if (!this.#uncapped() && !this.#busy(slot) && !waiting.some(record => this.#slotOf(record.companion) === slot)) {
      this.#reserved.set(slot, data.requestId);
      try {return await this.#dispatch(data, parent);}
      finally {if (this.#reserved.get(slot) === data.requestId) this.#reserved.delete(slot); this.#drain();}
    }
    if (!this.#uncapped() && this.#store.waitingCount(legacyWorker.destination) >= WAITING_LIMIT) return refused('capacity', 'too many coding hand-offs are waiting');
    try {this.#store.wait({operationId: data.requestId, taskId: data.taskId, companion: data.companion, repository: data.repository, brief: data.brief, traceparent: parent.traceparent});}
    catch (error) {return refused(fullDisk(error) ? 'capacity' : 'internal', 'the coding hand-off could not be saved');}
    this.#changed();
    if (this.#uncapped()) this.#drain();
    return {status: 'waiting', requestId: data.requestId};
  }
  #briefRefusal(brief: CodingBrief): ErrorBody | undefined {
    const attempt = this.#store.attempt(brief.requestId);
    const approval = attempt?.continuation === undefined ? brief.requestId : this.#store.jobRead(brief.requestId)?.originalOperationId;
    const refusal = approval === undefined ? 'unverified-supervisor' : this.#seams.briefRefusal?.({...brief, requestId: approval});
    return refusal === 'unverified-supervisor' ? errorBody('unavailable', {detail: UNVERIFIED_SUPERVISOR})
      : refusal === 'grant-denied' ? errorBody('forbidden', {detail: 'coding brief sharing is not permitted'}) : undefined;
  }
  #boundRefusal(data: CodingBrief, attempt: CodingAttempt | undefined, worker: Worker): ErrorBody | undefined {
    if (this.#workers.get(worker.destination) !== worker) return errorBody('unavailable', {detail: DISCONNECTED_BEFORE_START});
    if (!this.#allowed(data, worker.destination)) return errorBody('forbidden', {detail: 'Coding brief sharing permission was revoked before start.'});
    const binding = attempt?.binding;
    if (binding?.revision === undefined || attempt === undefined) return undefined;
    const approved = {...binding.requirements, revision: binding.revision};
    const checked = this.#route(data, attempt.harness ?? attempt.choice, binding.actual, approved, [worker]);
    if (checked.worker === undefined || worker.selectionId !== binding.selectionId) return errorBody('unavailable', {detail: checked.reason});
    return undefined;
  }
  #matchesJob(data: CodingBrief): boolean {
    const job = this.#store.job(data.requestId);
    if (job === undefined) return true;
    const saved = this.#store.jobRead(data.requestId);
    return saved !== undefined && saved.jobId === `${saved.originalOperationId}-job` &&
      job.taskId === data.taskId && job.repository === data.repository && job.brief === data.brief;
  }
  #dispatch(data: Omit<HandOff, 'expectedRevision'>, parent: TraceContext): Promise<RequestResult> {
    const attempt = this.#store.attempt(data.requestId);
    const worker = this.#workerFor(attempt);
    if (!this.#matchesJob(data)) return Promise.resolve({status: Outcome.rejected, requestId: data.requestId,
      error: errorBody('revision-conflict', {detail: 'the dispatch does not match the approved job'})});
    const brief = this.#briefRefusal(data);
    if (brief !== undefined) return Promise.resolve({status: Outcome.rejected, requestId: data.requestId, error: brief});
    if (worker === undefined) return Promise.resolve({status: Outcome.rejected, requestId: data.requestId, error: errorBody('unavailable', {detail: 'no coding worker is connected'})});
    const {endpointId} = worker;
    const continuation = attempt?.continuation;
    let harness = attempt?.harness ?? undefined;
    const refusal = this.#boundRefusal(data, attempt, worker);
    if (refusal !== undefined) return Promise.resolve({status: Outcome.rejected, requestId: data.requestId, error: refusal});
    if (worker.declaration === undefined && attempt !== undefined && harness !== undefined) {
      const route = chooseCodingHarness(attempt.choice, worker.harnesses ?? [], this.context.clock.now());
      if (continuation === undefined) this.#store.routeAttempt(data.requestId, route.harness, route.reason);
      if (route.harness === undefined || (continuation !== undefined && this.#continuation(this.#store.attempt(continuation.fromOperationId)) === null)) {
        return Promise.resolve({status: Outcome.rejected, requestId: data.requestId, error: errorBody('unavailable', {detail: route.harness === undefined ? route.reason : 'The verified handoff is no longer available.'})});
      }
      harness = route.harness;
    }
    return this.context.sdk.request('bunny.cmd.coding-dispatch.assistant', {type: 'org.bunny.coding.dispatch.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/coding-dispatch/${continuation !== undefined ? '2.2' : harness !== undefined ? '2.1' : '2.0'}`,
      data: {requestId: data.requestId, endpointId, taskId: data.taskId, repository: data.repository, brief: data.brief, bounds: DEFAULT_CODING_BOUNDS,
        ...(harness === undefined ? {} : {harness}), ...(continuation === undefined ? {} : {continuation})}},
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
      if (record.sending || this.#observationWrites.has(waitWriteKey(record.operationId))) continue;
      const attempt = this.#store.attempt(record.operationId);
      const worker = this.#workerFor(attempt);
      if (worker === undefined) {
        if (attempt?.binding?.endpointId !== undefined) void this.#endWait(record, {status: Outcome.rejected, requestId: record.operationId, error: errorBody('unavailable')}, true);
        continue;
      }
      const {endpointId} = worker, uncapped = worker.capacity === 'uncapped';
      const slot = uncapped ? record.operationId : this.#slotOf(record.companion, worker);
      if (worker.delivery !== undefined || held.has(slot) || this.#busy(slot, worker)) continue;
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
      if (uncapped) {
        const delivery: StartDelivery = {endpointId, record};
        worker.delivery = delivery;
        void this.#sendWaiting(record, slot, delivery);
        continue;
      }
      this.#reserved.set(slot, record.operationId);
      void this.#sendWaiting(record, slot);
    }
    if (dropped) this.#changed();
  }
  #awaits(taskId: string): boolean | undefined {
    try {return this.#seams.awaits?.(taskId) ?? true;} catch (error) {this.#storageFailure(error); return undefined;}
  }
  async #sendWaiting(record: CodingWaitingRecord, slot: string, delivery?: StartDelivery): Promise<void> {
    try {
      let answer: RequestResult;
      try {answer = await this.#dispatch({requestId: record.operationId, taskId: record.taskId, companion: record.companion, repository: record.repository, brief: record.brief}, {traceparent: record.traceparent});}
      catch {answer = {status: Outcome.uncertain, requestId: record.operationId, error: errorBody('uncertain-result')};}
      if (delivery === undefined && this.#reserved.get(slot) === record.operationId) this.#reserved.delete(slot);
      // A dispatch whose reply was lost may have recorded responsibility. In that case the run owns its own result.
      if (delivery?.discarded !== true && !this.#closed && !this.context.signal.aborted) await this.#endWait(record, answer);
    } finally {
      // Core admission starts the worker request asynchronously. Do not release an uncapped delivery on the core reply alone.
      try {await delivery?.workerReply;}
      finally {
        if (delivery !== undefined) {
          const worker = this.#byEndpoint(delivery.endpointId);
          if (worker?.delivery === delivery) delete worker.delivery;
        }
        this.#drain();
      }
    }
  }
  /** Reconciles a dispatch reply with durable responsibility, or closes an interrupted wait at startup. */
  async #endWait(record: CodingWaitingRecord, answer?: RequestResult, disconnectedBeforeStart = false): Promise<void> {
    const startup = answer === undefined;
    await this.#persistObservation(waitWriteKey(record.operationId), record, () => this.outbox.transaction(() => {
      const {operationId} = record;
      const job = this.#store.job(operationId);
      if (answer !== undefined && (answer.status === 'accepted' || this.#store.accepted(operationId))) {
        this.#saveSent(record, record.traceparent);
        return false;
      }
      const code = answer?.error.error.code;
      const unverifiedSupervisor = code === 'unavailable' && answer?.error.error.detail === UNVERIFIED_SUPERVISOR;
      const uncertain = answer === undefined || answer.status === Outcome.uncertain || code === 'uncertain-result';
      const stopped = !uncertain && (code === 'invalid-state' || disconnectedBeforeStart) && this.#store.stopRequested(operationId);
      const text = describeResult(uncertain ? 'uncertain' : stopped ? 'cancelled' : 'failed', undefined,
        uncertain ? 'lost' : stopped ? 'stopped before worker start' : disconnectedBeforeStart ? DISCONNECTED_BEFORE_START : unverifiedSupervisor ? UNVERIFIED_SUPERVISOR : `refused: ${code}`);
      const refusalDetail = !uncertain && !stopped && !disconnectedBeforeStart && !unverifiedSupervisor &&
        answer?.status === Outcome.rejected ? answer.error.error.detail : undefined;
      this.#store.unwait(operationId);
      this.#store.observeAttempt(operationId, uncertain ? 'uncertain' : stopped ? 'cancelled' : 'failed');
      if (job !== undefined || !this.#cancelled.has(record.taskId)) this.#store.update({...record, kind: 'result', text: refusalDetail === undefined ? text : `${text} ${refusalDetail}`, startup,
        ...(job === undefined ? {legacyEvidence: uncertain ? 'the coding worker outcome is unknown'
          : disconnectedBeforeStart ? DISCONNECTED_BEFORE_START : unverifiedSupervisor ? UNVERIFIED_SUPERVISOR : 'the coding hand-off was refused'} : {})});
      return true;
    }), async ended => {
      if (ended) {this.#cancelled.delete(record.taskId); this.#changed();}
      try {await this.#deliverObservations(record.operationId);}
      finally {this.#drain();}
    });
  }
  #saveSent(record: Pick<CodingResponsibility, 'operationId' | 'taskId'>, traceparent: string | undefined, startup = false): void {
    if (traceparent === undefined || this.#store.observationSaved(record.operationId, 'sent')) return;
    const reason = this.#store.attempt(record.operationId)?.selectionReason;
    this.#store.update({...record, traceparent, kind: 'sent', startup,
      text: `The core accepted the worker dispatch. The worker start is a separate observation.${reason === undefined ? '' : ` ${reason}`}`});
  }
  #saveStop(record: CodingResponsibility, text: string, startup = false): void {
    if (this.#store.observationSaved(record.operationId, 'stop-unconfirmed')) return;
    this.#store.update({...record, kind: 'stop-unconfirmed', text, startup});
  }
  async #deliverObservations(operationId?: string): Promise<void> {
    if (this.#closed || this.context.signal.aborted) return;
    try {
      const operations = operationId === undefined ? new Set(this.#store.undelivered().map(update => update.operationId)) : [operationId];
      for (const id of operations) {
        if (this.#delivering.has(id)) continue;
        this.#delivering.add(id);
        let parent: TraceContext | undefined;
        try {
          while (!this.#closed && !this.context.signal.aborted) {
            const update = this.#store.undelivered(id)[0];
            if (update === undefined) break;
            parent = update;
            const job = this.#store.job(id);
            if (job !== undefined) await this.#seams.jobUpdate?.(job, update.kind, update.text, update, update.startup === true);
            else if (update.kind === 'sent') await this.#seams.sent?.(update.taskId, id, update);
            else if (update.kind === 'result' && update.legacyEvidence !== undefined) await this.deliver(update.taskId, update.text, update,
              {requestId: id, source: 'effect', text: update.legacyEvidence}, update.startup === true);
            if (!this.#closed && !this.context.signal.aborted) this.#store.delivered(update);
          }
        } catch (error) {this.#scheduleDelivery(error, parent);}
        finally {this.#delivering.delete(id);}
      }
    } catch (error) {this.#scheduleDelivery(error);}
    if (operationId === undefined && this.#deliveryRetry === undefined) this.#deliveryRetryMs = STORAGE_RETRY_MS;
  }
  #scheduleDelivery(error: unknown, parent?: TraceContext): void {
    if (this.#closed || this.context.signal.aborted || this.#deliveryRetry !== undefined) return;
    const delay = this.#deliveryRetryMs;
    if (delay === STORAGE_RETRY_MS) this.#storageFailure(error, parent);
    this.#deliveryRetryMs = Math.min(delay * 2, MAX_STORAGE_RETRY_MS);
    this.#deliveryRetry = this.context.scheduler.after(delay, () => {
      this.#deliveryRetry = undefined;
      void this.#deliverObservations();
    });
  }
  #steering(active: Active | undefined): NonNullable<CodingJobEntry['steering']> {
    if (!this.#connected() || active === undefined || active.phase !== 'started' || active.settling || this.#workers.get(active.worker.destination) !== active.worker) return 'unavailable';
    const capability = active.worker.harnesses?.find(entry => entry.harness === active.harness)?.capabilities.steering;
    return capability !== 'live' ? 'unsupported' : active.sessionId === undefined ? 'unavailable' : 'live';
  }
  prepareNativeClient(input: OpenNativeClientInput & {requestId: string}, parent: TraceContext):
    {code: ErrorCode} | {committed: () => Promise<void>} {
    const {action, jobId, operationId, requestId} = input;
    const job = this.#store.job(operationId), attempt = this.#store.attempt(operationId);
    if (job?.jobId !== jobId || attempt === undefined || this.#seams.jobVisible?.(job, attempt.companion) === false) return {code: 'not-found'};
    if (!this.#canUseCodingBrief(job, attempt.companion)) return {code: 'forbidden'};
    if (this.#store.attempts(jobId).at(-1)?.operationId !== operationId || !this.#store.resultSaved(operationId)) return {code: 'invalid-state'};
    if (attempt.binding !== undefined && attempt.binding.actual !== 'mac') return {code: 'unsupported-capability'};
    const worker = this.#workerFor(attempt), endpointId = worker?.endpointId, offer = this.#native.get(operationId);
    if (worker === undefined || endpointId === undefined || offer === undefined || this.#nativeView(operationId)?.state !== 'available') return {code: 'unavailable'};
    const client = action === 'open-claude-desktop' ? 'claude-desktop' : 'terminal';
    if (!offer.view.clients.includes(client)) return {code: 'unsupported-capability'};
    const current = () => this.#connected() && this.#workers.get(worker.destination) === worker && worker.selectionId === offer.selectionId &&
      this.#store.attempts(jobId).at(-1)?.operationId === operationId;
    const visible = () => this.#seams.jobVisible?.(job, attempt.companion) !== false && this.#canUseCodingBrief(job, attempt.companion);
    const draft = {type: 'org.bunny.coding.work.requested', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-work/2.5'};
    return {committed: async () => {
      if (!current() || !visible() || this.#native.get(operationId) !== offer || offer.view.state !== 'available') return;
      const opening = {...offer, view: {...offer.view, state: 'opening'} as const};
      this.#native.set(operationId, opening);
      this.#changed();
      let launchSent = false;
      let refusal: ErrorCode | undefined;
      try {
        const prepared = await this.context.sdk.request(`bunny.cmd.coding-work.${endpointId}`, {
          ...draft, data: {requestId, operationId, action: 'prepare-native-client', client},
        }, {requestId, timeoutMs: 25_000, parent});
        if (prepared.status !== 'accepted') refusal = prepared.error.error.code;
        else if (!current() || this.#native.get(operationId) !== opening) refusal = 'unavailable';
        else if (!visible()) refusal = 'forbidden';
        else {
          const launchId = randomUUID();
          launchSent = true;
          const answer = await this.context.sdk.request(`bunny.cmd.coding-work.${endpointId}`, {
            ...draft, data: {requestId: launchId, operationId, action, intentId: requestId},
          }, {requestId: launchId, timeoutMs: 12_000, parent});
          if (answer.status !== 'accepted') refusal = answer.error.error.code;
        }
      } catch {refusal = 'uncertain-result';}
      if (this.#native.get(operationId) !== opening) return;
      const state = launchSent && (refusal === undefined || refusal === 'uncertain-result') ? 'uncertain' : 'available';
      this.#native.set(operationId, {...offer, view: {...offer.view, state, ...(refusal === undefined ? {} : {refusal})}});
      this.#changed();
    }};
  }
  prepareMessage(input: {jobId: string; operationId: string; requestId: string; text: string}, parent: TraceContext):
    {code: ErrorCode} | {committed: () => Promise<void>} {
    const {jobId, operationId, requestId, text} = input;
    const job = this.#store.job(operationId);
    if (job === undefined || job.jobId !== jobId) return {code: 'not-found'};
    const active = this.#active.get(operationId);
    const companion = active?.companion ?? this.#seams.companionOf?.(job.taskId);
    if (companion !== undefined && this.#seams.jobVisible?.(job, companion) === false) return {code: 'not-found'};
    const current = this.#store.attempts(jobId).at(-1)?.operationId ?? job.operationId;
    if (current !== operationId || this.#store.resultSaved(operationId) || this.#store.stopRequested(operationId)) return {code: 'revision-conflict'};
    const steering = this.#steering(active);
    if (steering === 'unsupported') return {code: 'unsupported-capability'};
    if (steering !== 'live' || active === undefined || active.sessionId === undefined) return {code: 'unavailable'};
    if (this.#seams.allowMessage?.(job, active.companion, active.worker.destination) === false) return {code: 'forbidden'};
    const sessionId = active.sessionId, endpointId = active.endpointId;
    const fingerprint = createHash('sha256').update(text).digest('hex');
    const admitted = this.#store.rememberMessage({requestId, jobId, operationId, endpointId, sessionId, fingerprint, recordedAtMs: this.context.clock.now()});
    if (admitted === 'conflict') return {code: 'duplicate-conflict'};
    if (admitted === 'existing') return {committed: () => Promise.resolve()};
    return {committed: async () => {
      this.#changed();
      let status: 'accepted' | 'refused' | 'uncertain' = 'refused';
      let code: ErrorCode | undefined = 'unavailable';
      if (this.#active.get(operationId) === active && this.#steering(active) === 'live' &&
          active.sessionId === sessionId && !this.#store.stopRequested(operationId) && this.#seams.allowMessage?.(job, active.companion, active.worker.destination) !== false) {
        try {
          const answer = await this.context.sdk.request(`bunny.cmd.coding-work.${endpointId}`, {
            type: 'org.bunny.coding.work.requested', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-work/2.4',
            data: {requestId, operationId, action: 'message', text},
          }, {requestId, timeoutMs: 5000, parent});
          if (answer.status === 'accepted') {status = 'accepted'; code = undefined;}
          else if (answer.status === 'uncertain' || answer.error.error.code === 'uncertain-result') {status = 'uncertain'; code = 'uncertain-result';}
          else code = answer.error.error.code;
        } catch {status = 'uncertain'; code = 'uncertain-result';}
      }
      await this.#persistObservation(`message:${requestId}`, parent, () => this.outbox.transaction(() =>
        this.#store.resolveMessage(requestId, status, code)), changed => Promise.resolve(changed ? this.#changed() : undefined));
    }};
  }
  /** Records stop intent inside the caller's transaction; the returned work can run after commit. */
  prepareStop(jobId: string, operationId: string): {code: 'unavailable' | 'not-found' | 'invalid-state' | 'revision-conflict'} | {committed: () => Promise<void>} {
    if (this.#closed || this.context.signal.aborted) return {code: 'unavailable'};
    const job = this.#store.job(operationId);
    if (job === undefined || job.jobId !== jobId) return {code: 'not-found'};
    const companion = this.#seams.companionOf?.(job.taskId);
    if (companion !== undefined && this.#seams.jobVisible?.(job, companion) === false) return {code: 'not-found'};
    const current = this.#store.attempts(jobId).at(-1)?.operationId ?? job.operationId;
    if (current !== operationId) return {code: 'revision-conflict'};
    if (this.#store.resultSaved(operationId)) return {code: 'invalid-state'};
    const waiting = this.#store.waitingFor(operationId);
    const active = this.#active.get(operationId);
    if ((waiting === undefined && (active === undefined || active.settling)) || (waiting !== undefined && this.#observationWrites.has(waitWriteKey(operationId)))) return {code: 'invalid-state'};
    if (!this.#store.requestStop(operationId)) return {committed: () => Promise.resolve()};
    if (waiting !== undefined && !waiting.sending) {
      this.#store.unwait(operationId);
      this.#store.observeAttempt(operationId, 'cancelled');
      this.#store.update({...waiting, kind: 'result', text: 'Cancelled before dispatch. The worker was never sent a start.'});
      return {committed: async () => {
        this.#changed();
        this.#drain();
        await this.#deliverObservations(operationId);
      }};
    }
    return {committed: () => {
      if (active !== undefined && this.#active.get(operationId) === active && !active.settling && !this.#closed) {
        active.phase = 'cancelling'; this.#changed();
        if (!active.uncapped || active.deliveryStarted === true) return this.#stopAttempt(active);
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
    if (this.#closed || this.context.signal.aborted) return;
    const text = confirmed ? 'The worker accepted the stop request. The stop itself is unconfirmed.'
      : 'The worker did not confirm receipt of the stop request. Its stop is unconfirmed.';
    active.stopEvidence = text;
    await this.#persistObservation(`stop:${active.operationId}`, active, () => this.outbox.transaction(() => {
      if (this.#store.resultSaved(active.operationId)) return;
      this.#saveSent(active, this.#store.acceptedWait(active.operationId));
      this.#saveStop(active, text);
    }), () => this.#deliverObservations(active.operationId));
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
    if (!active.uncapped || active.deliveryStarted === true) void this.#workerStop(active).catch(() => {});
  }
  #control(command: Command<CodingEndpointControl>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    const destination = codingDestinationForSource(command.source);
    if (destination === undefined) return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    const previous = this.#workers.get(destination);
    if (command.data.action === 'disable') {
      if (previous === undefined || previous.endpointId !== command.subject) return errorBody('forbidden');
      this.#unselect(previous, 'off');
      return {status: 'accepted'};
    }
    const {worker: declaration, harnesses, capacity} = command.data;
    if (previous === undefined && this.#workers.size >= 32) return errorBody('capacity', {detail: 'the coding worker roster is full'});
    if ((destination !== 'mac' || previous?.declaration !== undefined) && declaration === undefined) return errorBody('invalid-state', {detail: 'this worker requires a current destination declaration'});
    if (previous !== undefined && previous.endpointId !== command.subject) return errorBody('invalid-state', {detail: 'another coding worker endpoint is selected'});
    if (this.#byEndpoint(command.subject)?.destination !== undefined && this.#byEndpoint(command.subject)?.destination !== destination) return errorBody('forbidden');
    const worker: Worker = previous ?? {destination, endpointId: command.subject, receivedAt: this.context.clock.now()};
    const readiness = command.data.readiness ?? null;
    const slots = command.data.slots ?? (capacity === 'uncapped' ? null : worker.slots ?? null);
    const changed = previous === undefined || worker.capacity !== capacity || worker.slots !== slots ||
      JSON.stringify([worker.readiness, worker.harnesses, worker.declaration]) !== JSON.stringify([readiness, harnesses, declaration]);
    worker.receivedAt = this.context.clock.now();
    if (changed) {
      worker.readiness = readiness; worker.slots = slots;
      if (declaration === undefined) delete worker.declaration; else worker.declaration = declaration;
      if (capacity === undefined) {delete worker.capacity; delete worker.selectionId;}
      else {worker.capacity = capacity; worker.selectionId ??= randomUUID();}
      if (harnesses === undefined) delete worker.harnesses; else worker.harnesses = harnesses;
      this.#workers.set(destination, worker);
      this.#syncState('available');
      this.#changed(previous === undefined);
    }
    this.#drain();
    return {status: 'accepted'};
  }
  #syncState(offline: 'available' | 'off' | 'unavailable'): void {
    const primary = this.#primary();
    this.#state = {revision: this.#state.revision, availability: primary === undefined ? offline : 'available',
      endpointId: primary?.endpointId ?? null, readiness: primary?.readiness ?? null, slots: primary?.slots ?? null,
      ...(primary?.capacity === undefined ? {} : {capacity: primary.capacity}), ...(primary?.selectionId === undefined ? {} : {selectionId: primary.selectionId}),
      ...(primary?.harnesses == null ? {} : {harnesses: primary.harnesses})};
  }
  #unselect(worker: Worker, availability: 'off' | 'unavailable'): void {
    const delivery = worker.delivery;
    this.#workers.delete(worker.destination);
    this.#syncState(availability);
    for (const waiting of this.#store.waiting()) {
      const binding = this.#store.attempt(waiting.operationId)?.binding;
      if (!waiting.sending && binding?.endpointId === worker.endpointId && binding.selectionId === worker.selectionId) {
        void this.#endWait(waiting, {status: Outcome.rejected, requestId: waiting.operationId, error: errorBody('unavailable')}, true);
      }
    }
    if (delivery !== undefined) {
      delivery.discarded = true;
      const {record} = delivery;
      if (!this.#active.has(record.operationId)) {
        void this.#endWait(record, {status: Outcome.rejected, requestId: record.operationId, error: errorBody('unavailable')}, true);
      }
    }
    for (const active of this.#active.values()) {
      if (active.worker !== worker || active.settling) continue;
      if (active.uncapped && active.deliveryStarted !== true) {
        const cancelled = active.phase === 'cancelling';
        void this.#settle(active, cancelled ? 'cancelled' : 'failed', undefined, cancelled ? 'stopped before worker start' : DISCONNECTED_BEFORE_START,
          {result: Outcome.failed, code: cancelled ? 'cancelled' : 'unavailable'});
      } else {
        void this.#settle(active, 'uncertain', undefined, 'lost', active.started ? undefined : {result: Outcome.uncertain});
      }
    }
    this.#changed(true);
  }
  #accept(command: Command<CodingRun>): Reply {
    if (this.#closed || this.context.signal.aborted) return errorBody('unavailable');
    if (command.source !== 'bunny/core') return errorBody('forbidden');
    const checked = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    if (!checked.ok) return {error: checked.error};
    const data = command.data;
    const repeated = this.#active.get(data.requestId);
    if (repeated !== undefined) return repeated.endpointId === data.endpointId && (data.selectionId === undefined || data.selectionId === repeated.worker.selectionId) &&
      this.#matchesJob(data) && (data.harness === undefined || data.harness === repeated.harness) ? {status: 'accepted'} : errorBody('duplicate-conflict');
    let approvedCompanion: CodingCompanion | undefined;
    try {
      if (this.#observationWrites.has(waitWriteKey(data.requestId)) || this.#store.accepted(data.requestId) || this.#store.resultSaved(data.requestId)) return errorBody('invalid-state', {detail: 'the coding attempt has already settled'});
      if (this.#store.stopRequested(data.requestId)) return errorBody('invalid-state', {detail: 'the job was stopped before the worker start'});
      approvedCompanion = this.#store.waitingFor(data.requestId)?.companion;
      const attempt = this.#store.attempt(data.requestId);
      if (data.continuation !== undefined && attempt === undefined) return errorBody('invalid-state', {detail: 'the continuation has no durable approval'});
      if (attempt !== undefined && ((attempt.harness ?? undefined) !== data.harness ||
        attempt.continuation?.fromOperationId !== data.continuation?.fromOperationId ||
        attempt.continuation?.token !== data.continuation?.token)) return errorBody('revision-conflict', {detail: 'the dispatch does not match the approved attempt'});
      if (!this.#matchesJob(data)) {
        return errorBody('revision-conflict', {detail: 'the dispatch does not match the approved job'});
      }
    } catch (error) {this.#storageFailure(error, command); return errorBody('internal');}
    const savedAttempt = this.#store.attempt(data.requestId);
    const worker = this.#workerFor(savedAttempt);
    if (!this.#connected() || worker === undefined || worker.endpointId !== data.endpointId) return errorBody('unavailable', {detail: 'no coding worker endpoint is available for this dispatch'});
    if (worker.declaration !== undefined && (savedAttempt?.binding === undefined || savedAttempt.binding.selectionId !== worker.selectionId)) return errorBody('forbidden');
    if (data.harness !== undefined && worker.harnesses?.some(entry => entry.harness === data.harness) !== true) {
      return errorBody('unsupported-capability', {detail: 'the selected coding worker did not declare this harness'});
    }
    const delivery = worker.delivery?.record.operationId === data.requestId ? worker.delivery : undefined;
    if (data.selectionId !== undefined ? data.selectionId !== worker.selectionId : worker.capacity === 'uncapped' && delivery === undefined) {
      return errorBody('unavailable', {detail: 'the worker selection changed before the start was sent'});
    }
    // The wait's end, which follows this refusal, forgets the cancel and tells the cancelled task nothing.
    if (this.#cancelled.has(data.taskId)) {
      try {this.#store.unwait(data.requestId);} catch (error) {this.#storageFailure(error);}
      this.#changed();
      return errorBody('invalid-state', {detail: 'the task was cancelled before its hand-off started'});
    }
    const companion = approvedCompanion ?? this.#seams.companionOf?.(data.taskId);
    if (companion === undefined) return errorBody('not-found', {detail: 'the dispatch names no companion task'});
    const brief = this.#briefRefusal(data);
    if (brief !== undefined) return brief;
    const slot = worker.capacity === 'uncapped' ? data.requestId : this.#slotOf(companion, worker), reserved = this.#reserved.get(slot);
    if (reserved !== data.requestId && this.#busy(slot, worker)) return errorBody('capacity', {detail: 'that companion\'s coding slot is busy'});
    const active: Active = {worker, operationId: data.requestId, taskId: data.taskId, endpointId: data.endpointId, traceparent: command.traceparent, started: false, status: 'pending',
      companion, phase: 'dispatching', wallClockMs: data.bounds.wallClockMs, cancel: noop, settling: false, uncapped: worker.capacity === 'uncapped',
      ...(data.harness === undefined ? {} : {harness: data.harness})};
    try {
      const binding = savedAttempt?.binding;
      this.#store.accept(active, binding === undefined || binding.endpointId !== undefined ? undefined :
        {...binding, endpointId: worker.endpointId, ...(worker.selectionId === undefined ? {} : {selectionId: worker.selectionId})});
    }
    catch (error) {return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'coding responsibility could not be saved'});}
    if (reserved === data.requestId) this.#reserved.delete(slot);
    this.#active.set(active.operationId, active); this.#changed();
    // Tracked dispatch admission remains asynchronous. All uncapped starts share the endpoint's acknowledgement queue.
    const workerReply = (active.uncapped ? worker.reply ?? Promise.resolve() : Promise.resolve()).then(() => this.#start(active, data));
    if (active.uncapped) {
      worker.reply = workerReply;
      void workerReply.finally(() => {if (worker.reply === workerReply) delete worker.reply;});
    }
    if (delivery !== undefined) delivery.workerReply = workerReply;
    return {status: 'accepted'};
  }
  async #start(active: Active, data: CodingRun): Promise<void> {
    if (this.#active.get(active.operationId) !== active || active.settling || this.#closed || this.context.signal.aborted) return;
    // A worker that declared slots (2.2) hears which companion asked; an older one gets the 2.0 start it knows.
    const tagged = active.uncapped || active.worker.slots != null || data.harness !== undefined;
    try {
      const brief = this.#briefRefusal(data);
      if (brief !== undefined) {
        const reason = brief.error.code === 'unavailable' ? UNVERIFIED_SUPERVISOR : 'coding brief sharing was revoked';
        await this.#settle(active, 'failed', undefined, reason, {result: Outcome.failed, code: brief.error.code});
        return;
      }
      if (this.#store.stopRequested(active.operationId) || (active.uncapped && active.phase === 'cancelling')) {
        await this.#settle(active, 'cancelled', undefined, 'stopped before worker start', {result: Outcome.failed, code: 'cancelled'});
        return;
      }
      const attempt = this.#store.attempt(active.operationId);
      const routeRefusal = this.#boundRefusal(data, attempt, active.worker);
      if (routeRefusal !== undefined) {
        await this.#settle(active, 'failed', undefined, routeRefusal.error.detail ?? DISCONNECTED_BEFORE_START, {result: Outcome.failed, code: routeRefusal.error.code});
        return;
      }
      const revision = data.continuation === undefined ? attempt?.binding?.revision : undefined;
      this.#store.markSending(active.operationId);
      active.deliveryStarted = true;
      active.cancel = this.context.scheduler.after(START_MS, () => {void this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});});
      const result = await this.context.sdk.request(`bunny.cmd.coding-work.${active.endpointId}`, {type: 'org.bunny.coding.work.requested', subject: active.endpointId,
        dataschema: `https://bunny.invalid/events/coding-work/${revision !== undefined ? '2.6' : data.continuation !== undefined ? '2.3' : data.harness !== undefined ? '2.2' : tagged ? '2.1' : '2.0'}`,
        data: {requestId: active.operationId, operationId: active.operationId, action: 'start', taskId: data.taskId, ...(revision === undefined ? {} : {revision}), ...(tagged ? {companion: active.companion} : {}), repository: data.repository, brief: data.brief, bounds: data.bounds, ...(data.harness === undefined ? {} : {harness: data.harness}), ...(data.continuation === undefined ? {} : {continuation: data.continuation})}},
      {requestId: active.operationId, timeoutMs: 5000, parent: active});
      if (this.#active.get(active.operationId) !== active || active.settling) return;
      if (result.status === Outcome.uncertain) await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});
      else if (result.status === Outcome.rejected) await this.#settle(active, 'failed', undefined, 'refused', {result: Outcome.failed, code: result.error.error.code});
    } catch {await this.#settle(active, 'uncertain', undefined, 'lost', {result: Outcome.uncertain});}
  }
  async #progress(message: Message<CodingWorkerProgress>): Promise<void> {
    const worker = this.#byEndpoint(message.subject);
    if (this.#closed || worker === undefined || codingDestinationForSource(message.source) !== worker.destination || !this.#validator.validate(message).ok) return;
    if (message.data.status === 'native-client') {await this.#observeNative({...message, data: message.data}); return;}
    if (message.data.status === 'message-observed') {
      const {operationId, messageId, sessionId} = message.data;
      if (!this.#connected()) return;
      await this.#persistObservation(`observed:${messageId}`, message, () => this.outbox.transaction(() =>
        this.#store.observeMessage(messageId, operationId, message.subject, sessionId)), changed => Promise.resolve(changed ? this.#changed() : undefined));
      return;
    }
    const active = this.#active.get(message.data.operationId);
    if (active === undefined || worker !== active.worker || active.settling) return;
    if (active.uncapped && active.deliveryStarted !== true) return;
    if (message.data.status === 'attempt-context') {
      const {worktreeRef, branch, model} = message.data;
      const context: Omit<CodingAttemptContext, 'status' | 'operationId'> = {
        ...(worktreeRef === undefined ? {} : {worktreeRef}), ...(branch === undefined ? {} : {branch}), ...(model === undefined ? {} : {model})};
      await this.#persistObservation(`attempt-context:${message.id}`, message, () => this.outbox.transaction(() =>
        this.#store.observeAttemptContext(active.operationId, context)), changed => Promise.resolve(changed ? this.#changed() : undefined));
      return;
    }
    const progress = message.data;
    if (active.harness !== undefined && progress.harness !== active.harness) return;
    if (progress.harness !== undefined && (progress.harness !== (active.harness ?? 'claude-code') ||
      !((active.uncapped && worker.harnesses === undefined && progress.harness === 'claude-code') ||
        worker.harnesses?.some(entry => entry.harness === progress.harness) === true))) return;
    if (progress.harness !== undefined) active.harness = progress.harness;
    const freshSession = active.sessionId === undefined && progress.sessionId !== undefined;
    if (freshSession && progress.sessionId !== undefined) active.sessionId = progress.sessionId;
    if (progress.status === 'started') {
      if (active.started) {
        if (freshSession) {
          try {this.#store.observeAttempt(active.operationId, 'started', active.sessionId);}
          catch (error) {this.#storageFailure(error, active);}
        }
        const moved = this.#observeSetup(active, progress.setup);
        if (moved || freshSession) this.#changed();
        return;
      }
      active.started = true; active.cancel(); active.status = 'pending';
      try {this.#store.started(active.operationId); this.#store.observeAttempt(active.operationId, 'started', active.sessionId, undefined, undefined, undefined, codingHarness(active.harness) ? active.harness : undefined);} catch (error) {this.#storageFailure(error, active); await this.#settle(active, 'uncertain', undefined, 'lost'); return;}
      // The tracked effect is "handed to the worker": observed, because the worker said so. The run's end is the task's business.
      try {await this.#outcome(active, {result: Outcome.succeeded}, 'observed');} catch (error) {this.#storageFailure(error, active);}
      if (active.settling || this.#closed || this.context.signal.aborted) return;
      if (active.phase === 'dispatching') active.phase = 'started';
      if (active.uncapped) {
        if (active.setup === undefined && !this.#observeSetup(active, progress.setup)) this.#armProgress(active, CODING_SETUP_WAIT_MS);
      } else this.#armProgress(active, active.wallClockMs + GRACE_MS + SETUP_MS);
      this.#changed();
      return;
    }
    const binding = this.#store.attempt(active.operationId)?.binding;
    if (binding?.revision !== undefined && progress.result != null &&
      (progress.result.repository !== this.#store.job(active.operationId)?.repository ||
       ((progress.status === 'completed' || progress.result.base !== null) && progress.result.base !== binding.revision))) {
      await this.#settle(active, 'uncertain', undefined, 'the worker result did not match the approved repository revision');
      return;
    }
    if (!active.started) {await this.#settle(active, 'uncertain', progress.status === 'completed' ? progress.result : progress.result ?? undefined, 'lost', {result: Outcome.uncertain}); return;}
    if (progress.status === 'completed') await this.#settle(active, 'completed', progress.result, undefined, undefined, false, progress.handoffToken);
    else await this.#settle(active, progress.status, progress.result ?? undefined, progress.reason, undefined, false, progress.status === 'uncertain' ? undefined : progress.handoffToken);
  }
  async #observeNative(message: Message<CodingNativeClient>): Promise<void> {
    const {operationId, clients, state, observedAtMs} = message.data;
    const attempt = this.#store.attempt(operationId), worker = this.#workerFor(attempt);
    if (worker?.destination !== 'mac' || worker.endpointId !== message.subject || !this.#store.startSent(operationId) || !this.#connected() ||
      (this.#active.get(operationId)?.worker !== worker && (attempt?.binding?.selectionId === undefined || attempt.binding.selectionId !== worker.selectionId))) return;
    const selectionId = worker.selectionId, view: NativeObservation = {clients, state, observedAtMs};
    await this.#persistObservation(`native-client:${message.id}`, message, () => this.outbox.transaction(() => {
      const attempt = this.#store.attempt(operationId);
      if (attempt === undefined || (attempt.context?.nativeObservation?.observedAtMs ?? 0) > observedAtMs) return false;
      return this.#store.observeAttemptContext(operationId, {nativeObservation: view});
    }), changed => {
      if (changed && this.#workers.get(worker.destination) === worker && worker.selectionId === selectionId) {
        this.#native.set(operationId, {selectionId, view});
        this.#changed();
      }
      return Promise.resolve();
    });
  }
  #observeSetup(active: Active, setup: CodingSetup | undefined): boolean {
    if (!active.uncapped || setup === undefined || active.setup === 'ready' ||
      (active.setup === 'running' && setup !== 'ready')) return false;
    const changed = active.setup !== setup;
    active.setup = setup;
    this.#armProgress(active, setup === 'waiting' ? CODING_SETUP_WAIT_MS :
      setup === 'running' ? CODING_SETUP_WORK_MS : active.wallClockMs + GRACE_MS);
    return changed;
  }
  #armProgress(active: Active, timeoutMs: number): void {
    active.cancel();
    active.cancel = this.context.scheduler.after(timeoutMs, () => {void this.#settle(active, 'uncertain', undefined, 'timeout');});
  }
  #lost(): void {
    if (this.#closed) return;
    for (const worker of [...this.#workers.values()]) this.#unselect(worker, 'unavailable');
  }
  /**
   * Ends an operation once: records the status, reports the tracked outcome when the worker never reported a start, and
   * delivers the worker's word to the task. A delivery that fails leaves the task to the owner's resume. The freed slot
   * then takes its oldest waiting hand-off.
   */
  async #settle(record: CodingResponsibility | Active, status: 'completed' | 'failed' | 'cancelled' | 'uncertain', result?: CodingResult | null, reason?: string,
    outcome?: {result: 'succeeded' | 'failed' | 'uncertain'; code?: string}, startup = false, handoffToken?: string): Promise<void> {
    const active = 'settling' in record ? record : undefined;
    if (active !== undefined) {if (active.settling || this.#active.get(active.operationId) !== active) return; active.settling = true; active.cancel();}
    const text = describeResult(status, result, reason);
    const handoffSelection = handoffToken === undefined ? undefined : active?.worker.selectionId;
    await this.#persistObservation(`run:${record.operationId}`, record, () => this.outbox.transaction(add => {
      const job = this.#store.job(record.operationId);
      // Acceptance survives the queue removal, even if its conversation observation could not be inserted.
      const knownUnsent = reason === DISCONNECTED_BEFORE_START || reason === UNVERIFIED_SUPERVISOR || reason === 'stopped before worker start';
      if (!knownUnsent) this.#saveSent(record, this.#store.acceptedWait(record.operationId), startup);
      if (job !== undefined && !knownUnsent && this.#store.stopRequested(record.operationId)) {
        this.#saveStop(record, active?.stopEvidence ?? STOP_UNCONFIRMED, startup);
      }
      this.#store.settle(record.operationId, status);
      this.#store.observeAttempt(record.operationId, status, active?.sessionId, result == null ? undefined : attemptResult(result),
        handoffToken, handoffSelection, codingHarness(active?.harness) ? active.harness : undefined);
      this.#store.update({...record, kind: 'result', text, startup,
        ...(job === undefined ? {legacyEvidence: knownUnsent ? reason : status === 'uncertain' ? 'the coding worker outcome is unknown' : `the coding worker reported that the task ${status}`} : {})});
      if (outcome !== undefined) this.#addOutcome(add, record, outcome, record.started ? 'observed' : 'none');
    }), async () => {
      if (active !== undefined) {this.#active.delete(active.operationId); this.#changed();}
      try {await this.#deliverObservations(record.operationId);}
      finally {if (active !== undefined) this.#drain();}
    });
  }
  /** Retains the first observation across local write failures. Only the local transaction is retried. */
  async #persistObservation<T>(key: string, record: TraceContext, write: () => Promise<T>, committed: (value: T) => Promise<void>): Promise<void> {
    if (this.#closed || this.context.signal.aborted || this.#observationWrites.has(key)) return;
    this.#observationWrites.set(key, noop);
    let delay = STORAGE_RETRY_MS;
    const persist = async (): Promise<void> => {
      if (this.#closed || this.context.signal.aborted) return;
      let value: T;
      try {value = await write();}
      catch (error) {
        if (delay === STORAGE_RETRY_MS) this.#storageFailure(error, record);
        if (!this.#closed && !this.context.signal.aborted) {
          this.#observationWrites.set(key, this.context.scheduler.after(delay, () => {void persist();}));
          delay = Math.min(delay * 2, MAX_STORAGE_RETRY_MS);
        }
        return;
      }
      this.#observationWrites.delete(key);
      if (this.#closed || this.context.signal.aborted) return;
      try {await committed(value);} catch (error) {this.#storageFailure(error, record);}
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
