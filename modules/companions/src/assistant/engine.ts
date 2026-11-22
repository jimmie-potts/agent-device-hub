import {SHOW_SAVE_WINDOW_MS} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {createHash, randomUUID} from 'node:crypto';
import {Annotation, Command as Resume, END, StateGraph, interrupt} from '@langchain/langgraph';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {ASSISTANT_LEGACY_TOOL_LIMIT, ASSISTANT_WEMO_OWNER, type AssistantControl, type AssistantDeviceOwner, type AssistantDispatch, type AssistantInput, type AssistantProfile, type AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {SPOKEN_REPLY_TTL_MS, type SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {fullDisk, startSpan, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type ModuleStagedUpload, type ModuleUploadRequest, type Outbox, type Reply, type RequestResult, type Span, type Subscription, type TraceContext, recordLog, type LogEvent, Outcome} from '@jimmie-potts/sdk';
import {CheckpointCapacityError, SqliteCheckpointSaver} from './checkpointer.js';
import {AssistantStore, GRAPH_VERSION, LIMITS, terminal, unresolved, type Appended, type Call, type Question, type StagedInput, type Task} from './store.js';
import type {Proposal} from './history-contract.js';
import {contextBytes, ProviderFault, textBytes, type ModelProvider, type PromptContext, type ToolCall, type TurnInput, type TurnReply} from './provider.js';
import {inputBound, SpendLedger, type PriceTable, type SpendView, type TokenUsage} from './spend.js';
import {PROFILES} from '../knowledge/model.js';
import type {ActivePreference} from '../preferences/model.js';
import {ConversationActions} from './catalog-actions.js';
import {catalogCommand, catalogTool, isCatalogTool} from './catalog-tools.js';
import {SyntheticProvider} from './synthetic.js';
import {changesOf, observationDraft, observationOf} from './sessions.js';
import {chooseDevice, deviceLabel, deviceProposal, deviceProposalText, readDevices} from './devices.js';
import {ASK_OWNER, BRIEF_BYTES, DELEGATE_CODING, definition, deviceToolOwner, FIXTURE_TEXT, MODES, permittedTools, READ_FIXTURE, READ_SESSIONS, REPOSITORY, SET_MODE, SET_LIFX_POWER, SET_LIFX_BRIGHTNESS, SET_WEMO_POWER, summarizeSessions, type CoreCopy} from './tools.js';

export type {ModelProvider, TurnInput, TurnReply, TranscriptItem} from './provider.js';
/** Sends one approved command through the core's tracked dispatcher; the module binds it to its own participant. */
export type Dispatch = (data: AssistantDispatch, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult>;
/**
 * What the module gives the engine (Hub #46, #507): the `bunny` profile's provider (synthetic without one), the
 * allowlisted tool names, the synced copy of the core for reads and proposals, the dispatch path for approved commands,
 * and the owner's currently active explicit preferences, read at each model call (none without the seam).
 */
export type AssistantOptions = {
  provider?: ModelProvider;
  tools?: readonly string[];
  core?: () => CoreCopy;
  dispatch?: Dispatch;
  devices?: (owner: AssistantDeviceOwner) => readonly DeviceRecord[] | undefined;
  readDevice?: (owner: AssistantDeviceOwner, name: unknown, signal: AbortSignal, parent: TraceContext) => Promise<string | undefined>;
  available?: () => boolean;
  preferences?: () => readonly ActivePreference[];
  /** Offers a saved assistant message to the speech coordinator, once per key: the message that ended a turn, or a replay the owner asked for (Hub #500). */
  speak?: (reply: SpokenReply, key: string, parent: TraceContext) => void;
  /** Whether a coding worker can take a task now, and the revision a delegation proposal binds to (Hub #502). */
  coding?: () => {available: boolean; endpointId: string | null; revision: number};
  /** Hands an approved delegation to the core's tracked dispatcher; the worker's result comes back through `deliver`. */
  delegate?: Delegate;
  /** The owner cancelled a task whose delegation is still running; the module asks the worker to stop. */
  onCancelled?: (taskId: string) => void;
  /** The private section's prices per model for the spend ledger (Hub #2024); a paid turn or call of an unpriced model is refused. */
  prices?: PriceTable;
  /** The time zone whose local day and month the spend limits use: the runtime host's own unless a test names one. */
  timeZone?: string;
};
/** An approved delegation as the module dispatches it, bound to the coding state revision the proposal saw. */
export type Delegation = {requestId: string; taskId: string; repository: string; brief: string; expectedRevision: number};
export type Delegate = (data: Delegation, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult>;
/** An engine refusal; `detail` is fixed text for the owner, such as the spend limit a new turn met. */
class Fault extends Error {constructor(readonly code: ErrorCode, readonly detail?: string) {super(code);}}
/** What one call answered: its text, its reported usage total, and a paid provider's usage by price class. */
type Answer = {text: string; units: number | null; usage?: TokenUsage | null};
/** What a call may use: the units it reserves, their name in a limit message, and a paid model call's spend reservation. */
type Budget = {units: number; unit: string; spend?: {model: string; inputUnits: number; outputUnits: number}};
function fail(code: ErrorCode): never {throw new Fault(code);}
const codeOf = (error: unknown): ErrorCode => error instanceof Fault || error instanceof ProviderFault ? error.code : fullDisk(error) || error instanceof CheckpointCapacityError ? 'capacity' : 'internal';
const profiles: readonly AssistantProfile[] = ['bunny', 'reachy', 'microduck'];
const profile = (value: unknown): value is AssistantProfile => typeof value === 'string' && profiles.includes(value as AssistantProfile);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const assistantStateDraft = (data: AssistantState) => ({kind: 'state' as const, type: 'org.bunny.assistant-state.updated', subject: 'assistant', dataschema: `https://bunny.invalid/events/assistant-state/${data.tools.length > ASSISTANT_LEGACY_TOOL_LIMIT ? '2.1' : '2.0'}`, data});
export const INSTRUCTIONS = 'Answer the owner briefly and truthfully from the evidence the tools return.';
export const CONTEXT_TOO_LARGE = `The owner's active preferences exceed the ${String(LIMITS.contextBytes / 1024)} KiB prompt bound; stop using some on the Preferences page and start again.`;
export const DECLINED = 'The owner declined the proposal; nothing was changed.';
export const REFUSED = 'The model declined this request.';
type Next = 'ask' | 'tool' | 'approve' | 'await' | 'turn' | 'end';
const shape = Annotation.Root({taskId: Annotation<string>, step: Annotation<number>, next: Annotation<Next>, decision: Annotation<string>, result: Annotation<string>});
type GraphState = typeof shape.State;
type Active = {taskId: string; runId: string; generation: number; controller: AbortController; span: Span; accountedAt: number; deadline?: Cancel; work: Promise<void>};
type Replied = TurnReply;
const parseReply = (text: string): Replied => {
  const value: unknown = JSON.parse(text);
  if (!object(value) || !Array.isArray(value.calls) || !['end', 'tool', 'refusal', 'truncated'].includes(String(value.stop))) fail('internal');
  return value as Replied;
};

/** The graph and all external waits belong to one companions activation. Startup only reads saved state. */
export class AssistantEngine {
  readonly store: AssistantStore;
  /**
   * The shared spend ledger (Hub #2024). Task model calls reserve and settle here in their receipt's transaction; a
   * conversation-level call uses the same `reserve` and `settle` (see spend.ts), so every paid call counts once.
   */
  readonly spend: SpendLedger;
  readonly #validator = coreValidator();
  readonly #subscriptions: Subscription[] = [];
  readonly #graph;
  #active: Active | undefined;
  #closed = false;
  #recoveryUnavailable = false;
  readonly #synthetic = new SyntheticProvider();
  readonly #allowed: readonly string[];
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly options: AssistantOptions = {}) {
    this.store = new AssistantStore(context.database());
    this.spend = new SpendLedger(context.database(), options.prices ?? {}, () => context.clock.now(), options.timeZone);
    this.#allowed = [...(options.tools ?? [])];
    this.#graph = new StateGraph(shape)
      .addNode('turn', state => this.#turn(state))
      .addNode('ask', state => this.#ask(state))
      .addNode('answered', state => this.#answered(state))
      .addNode('tool', state => this.#tool(state))
      .addNode('approve', state => this.#approve(state))
      .addNode('act', state => this.#act(state))
      .addNode('await', state => this.#await(state))
      .addNode('delivered', state => this.#delivered(state))
      .addEdge('__start__', 'turn')
      .addConditionalEdges('turn', state => state.next, {ask: 'ask', tool: 'tool', approve: 'approve', end: END})
      .addEdge('ask', 'answered').addEdge('answered', 'turn').addEdge('tool', 'turn').addEdge('approve', 'act')
      // An approved delegation waits for the worker's word before the next turn; every other act goes straight back to the model.
      .addConditionalEdges('act', state => state.next === 'await' ? 'await' : 'turn', {await: 'await', turn: 'turn'})
      .addEdge('await', 'delivered').addEdge('delivered', 'turn')
      .compile({checkpointer: new SqliteCheckpointSaver(context.database())});
  }
  available(): boolean {
    // LangChain can install global content exporters from environment flags. This slice never opts into them.
    const tracing = ['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_VERBOSE'];
    return !this.#closed && !this.#recoveryUnavailable && !this.context.signal.aborted && this.options.available?.() !== false &&
      tracing.every(key => !['true', '1'].includes(process.env[key]?.toLowerCase() ?? ''));
  }
  /** The `bunny` profile's provider, or the synthetic one; Reachy and MicroDuck always use the synthetic provider. */
  provider(profile: AssistantProfile = 'bunny'): ModelProvider {return profile === 'bunny' ? this.options.provider ?? this.#synthetic : this.#synthetic;}
  inspect(): AssistantState {
    const provider = this.provider();
    return {id: 'assistant', ...this.store.meta(), available: this.available(), provider: provider.name, model: provider.model, tools: [...this.#allowed],
      tasks: this.store.latest().map(task => this.store.summary(task))};
  }
  async start(): Promise<void> {
    const task = this.store.unfinished();
    if (task !== undefined) {
      try {
        if (task.graphVersion !== GRAPH_VERSION || !this.available()) await this.#recoverUnavailable(task.id);
        else await this.#reconcile(task.id, true);
      } catch {
        this.#recoveryUnavailable = true;
        try {await this.#recoverUnavailable(task.id);} catch { /* A failed write cannot claim a saved transition. */ }
      }
    }
    this.#subscriptions.push(await this.context.sdk.respond<AssistantControl>('bunny.cmd.assistant-control.assistant', command => this.#control(command)));
    this.#subscriptions.push(await this.context.sdk.respond<AssistantInput>('bunny.cmd.assistant-input.assistant', command => this.#input(command)));
  }
  async stop(): Promise<void> {
    this.#closed = true;
    const active = this.#active;
    active?.controller.abort();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
    await active?.work;
  }
  #task(id: string): Task {return this.store.task(id) ?? fail('not-found');}
  #publish(add: AddMessage, parent?: TraceContext): void {
    this.store.bump(); add('bunny.state.assistant-state.assistant', assistantStateDraft(this.inspect()), parent === undefined ? {} : {parent});
    this.#report(add, parent);
  }
  /**
   * Reports each conversation's change to the shared session model in the same transaction (Hub #505): the lifecycle
   * observations that move its session from what it last reported to its latest task's projection now, at the
   * conversation's next ordering sequences. Only the latest task of a profile, and the turn it last reported when that
   * is an earlier task, can change, so only those are compared.
   */
  #report(add: AddMessage, parent?: TraceContext): void {
    for (const task of this.store.latest()) {
      const reported = this.store.report(task.conversationId), turn = reported.projection?.turn;
      const changes = changesOf(reported, turn === undefined || turn === task.id ? undefined : this.store.task(turn), task);
      if (changes === undefined) continue;
      let sequence = reported.sequence;
      for (const change of changes.events) {
        sequence += 1;
        const {key, draft} = observationDraft(observationOf(task, change, sequence, this.context.clock.now()));
        add(key, draft, parent === undefined ? {} : {parent});
      }
      this.store.saveReport(task.conversationId, {sequence, projection: changes.projection});
    }
  }
  #change(id: string, change: (task: Task) => void, parent?: TraceContext): Promise<void> {
    return this.outbox.transaction(add => {const task = this.#task(id); change(task); this.store.save(task); this.#publish(add, parent);});
  }
  #check(command: Command<object>): ErrorCode | undefined {
    if (this.#closed || this.context.signal.aborted) return 'unavailable';
    if (command.source !== 'bunny/core') return 'forbidden';
    if (command.subject !== 'assistant') return 'not-found';
    if (this.context.clock.now() - Date.parse(command.time) >= LIMITS.controlMs) return 'expired';
    const result = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    return result.ok ? undefined : result.error.code;
  }
  #revision(revision: number): void {if (revision !== this.store.meta().revision) fail('revision-conflict');}
  /**
   * Offers one durable assistant message to be spoken through the companions speech endpoint. Text over the browser driver's
   * bound stays on the page unspoken rather than cut; the coordinator decides availability, Quiet and one-at-a-time.
   */
  #speak(taskId: string, messageId: string, text: string, parent: TraceContext, key = messageId): void {
    if (this.options.speak === undefined || this.#closed || this.context.signal.aborted || text.trim() === '' || text.length > LIMITS.spokenChars) return;
    try {this.options.speak({taskId, messageId, text, validUntilMs: this.context.clock.now() + SPOKEN_REPLY_TTL_MS}, key, parent);}
    catch { /* Speech is an output of the saved message, never a condition of it. */ }
  }
  #ready(): void {if (!this.store.meta().enabled || !this.available()) fail('unavailable');}
  #activate(task: Task, parent: TraceContext): void {
    this.#ready();
    if (this.#active !== undefined) fail('capacity');
    if (task.graphVersion !== GRAPH_VERSION || task.version !== 1) fail('unavailable');
    if (unresolved(this.store.calls(task.id))) fail('uncertain-result');
    if (task.activeMs >= LIMITS.activeMs || task.reservedUnits >= LIMITS.units) fail('capacity');
    const runId = randomUUID();
    this.store.saveRun({version: 1, id: runId, taskId: task.id, startedAtMs: this.context.clock.now(), endedAtMs: null,
      status: 'running', traceparent: parent.traceparent, previousTraceparent: task.traceparent});
    task.runId = runId; task.generation += 1; task.status = 'running'; task.code = null;
  }
  async #admit<T extends {requestId: string}>(command: Command<T>, fingerprint: string, apply: () => string | undefined): Promise<Reply> {
    const refused = this.#check(command); if (refused !== undefined) return errorBody(refused);
    try {
      let launch: string | undefined;
      const reply = await this.outbox.transaction(add => {
        const previous = this.store.receipt(command.data.requestId);
        if (previous !== undefined) {if (previous !== fingerprint) fail('duplicate-conflict'); return {status: 'accepted'} as const;}
        launch = apply(); this.store.remember(command.data.requestId, fingerprint); this.#publish(add, command);
        add(`bunny.event.${command.dataschema.includes('assistant-input') ? 'assistant-input' : 'assistant-control'}.assistant`, {
          kind: 'outcome', type: command.type.replace(/\.requested$/, '.completed'), subject: 'assistant', dataschema: 'https://bunny.invalid/events/outcome/2.0',
          data: {requestId: command.data.requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
        return {status: 'accepted'} as const;
      });
      if (launch !== undefined && !this.#closed && !this.context.signal.aborted) this.#launch(launch);
      return reply;
    } catch (error) {return errorBody(codeOf(error), {detail: error instanceof Fault && error.detail !== undefined ? error.detail : 'The assistant control was not saved.'});}
  }
  #control(command: Command<AssistantControl>): Promise<Reply> {
    let spoken: {id: string; text: string} | undefined, delegated = false;
    return this.#admit(command, digest(command.data), () => {
      const data = command.data; this.#revision(data.expectedRevision);
      if (data.action !== 'speak' && data.messageId !== undefined) fail('invalid-request');
      if (data.action === 'enable' || data.action === 'disable') {
        if (data.taskId !== undefined) fail('invalid-request');
        if (data.action === 'enable' && !this.available()) fail('unavailable');
        if (data.action === 'disable' && this.store.unfinished() !== undefined) fail('invalid-state');
        this.store.enable(data.action === 'enable'); return undefined;
      }
      if (data.action === 'speak') {
        // A replay reads the saved message; finished tasks qualify, so an old answer can be heard again, and only assistant text is spoken.
        const message = this.store.savedMessage(data.taskId ?? fail('invalid-request'), data.messageId ?? fail('invalid-request')) ?? fail('not-found');
        if (message.role !== 'assistant') fail('invalid-request');
        spoken = message; return undefined;
      }
      const task = this.#task(data.taskId ?? fail('invalid-request'));
      if (terminal(task.status)) fail('invalid-state');
      if (data.action === 'cancel') {
        delegated = task.question?.kind === 'delegation' && task.question.answer === null;
        task.status = 'cancelled'; task.generation += 1; task.code = null; this.store.save(task);
        return undefined;
      }
      if (!['paused', 'uncertain', 'waiting'].includes(task.status) || (task.question !== null && task.question.answer === null)) fail('invalid-state');
      this.#activate(task, command); this.store.save(task); return task.id;
    }).then(reply => {
      const active = this.#active;
      if (command.data.action === 'cancel' && !('error' in reply) && active !== undefined && active.taskId === command.data.taskId) active.controller.abort();
      if (command.data.action === 'cancel' && !('error' in reply) && delegated && command.data.taskId !== undefined) {try {this.options.onCancelled?.(command.data.taskId);} catch { /* the worker's own report settles it */ }}
      if (spoken !== undefined && !('error' in reply) && command.data.taskId !== undefined) this.#speak(command.data.taskId, spoken.id, spoken.text, command, `${spoken.id}:${command.data.requestId}`);
      return reply;
    });
  }
  stage(request: ModuleUploadRequest): ModuleStagedUpload | ErrorBody {
    if (request.target !== 'assistant' || request.name !== 'input.json' || request.signal.aborted || request.bytes.byteLength > LIMITS.stageBytes) return errorBody('invalid-request');
    try {
      this.#ready();
      const value: unknown = JSON.parse(Buffer.from(request.bytes).toString('utf8'));
      if (!object(value) || Object.keys(value).some(key => !['action', 'profile', 'text', 'expectedRevision', 'taskId', 'questionId'].includes(key)) ||
        !profile(value.profile) || !['start', 'answer'].includes(String(value.action)) || typeof value.text !== 'string' || value.text.trim() === '' || textBytes(value.text) > LIMITS.inputBytes ||
        typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) fail('invalid-request');
      if (value.action === 'start' ? value.taskId !== undefined || value.questionId !== undefined : typeof value.taskId !== 'string' || typeof value.questionId !== 'string') fail('invalid-request');
      const input = value as StagedInput;
      this.store.expireStages(this.context.clock.now());
      const previous = this.store.inputFor(request.requestId);
      if (previous !== undefined && digest(previous.input) !== digest(input)) fail('duplicate-conflict');
      if (previous === undefined && this.store.stagedCount() >= 8) fail('capacity');
      const staged = previous ?? {ref: randomUUID(), requestId: request.requestId, input, expires: this.context.clock.now() + LIMITS.controlMs};
      if (previous === undefined) this.store.stage(staged);
      return {data: {inputRef: staged.ref}, finish: reply => {
        if ('error' in reply && reply.error.code !== 'uncertain-result') this.store.discard(staged.ref);
      }};
    } catch (error) {return errorBody(error instanceof SyntaxError ? 'invalid-request' : codeOf(error));}
  }
  #input(command: Command<AssistantInput>): Promise<Reply> {
    return this.#admit(command, digest(command.data), () => {
      this.#ready();
      const staged = this.store.input(command.data.inputRef) ?? fail('invalid-request');
      if (staged.requestId !== command.data.requestId) fail('invalid-request');
      if (staged.expires <= this.context.clock.now()) fail('expired');
      const input = staged.input; this.#revision(input.expectedRevision);
      let task: Task;
      if (input.action === 'start') {
        if (this.store.unfinished() !== undefined || this.#active !== undefined) fail('capacity');
        // A new turn of a paid profile is refused, its reply naming why, when its model has no price or what remains of a
        // spend limit is below the smallest first call, so it is not admitted only to fail there; synthetic turns cost nothing.
        const paid = this.provider(input.profile), reached = paid.name === 'synthetic' ? undefined : this.spend.reached(paid.model);
        if (reached !== undefined) throw new Fault('capacity', reached);
        task = this.store.newTask(input.profile, input.text);
        this.store.message(task, `${task.id}-prompt`, 'owner', input.text, this.context.clock.now());
      } else {
        task = this.#task(input.taskId ?? fail('invalid-request'));
        if (!['waiting', 'paused'].includes(task.status) || task.profile !== input.profile || task.question === null || task.question.id !== input.questionId || task.question.answer !== null) fail('invalid-state');
        // An approval is answered only by the two literal decisions, so free text can neither apply nor dismiss a proposal; a delegation is answered by the worker alone.
        if (task.question.kind === 'delegation') fail('invalid-state');
        if (task.question.kind === 'approval' && !['approve', 'decline'].includes(input.text)) fail('invalid-request');
        task.question.answer = input.text;
        this.store.message(task, `${task.question.id}-answer`, 'owner', input.text, this.context.clock.now());
      }
      this.#activate(task, command); this.store.save(task); this.store.discard(staged.ref); return task.id;
    });
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref === 'spend') {
      // The shared spend of today and this month (Hub #2024): amounts and counts only, no prompt, model text or call identity.
      if (request?.signal.aborted === true || Object.keys(request?.query ?? {}).length > 0) return errorBody('invalid-request');
      try {
        const provider = this.provider();
        const view: SpendView = {...this.spend.totals(), paid: provider.name === 'synthetic' ? null : {model: provider.model, minimumMicros: this.spend.minimum(provider.model) ?? null}};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(view))};
      } catch {return errorBody('unavailable');}
    }
    if (ref !== 'conversation') return undefined;
    const query = request?.query ?? {}, selected = query.profile;
    if (request?.signal.aborted === true || !profile(selected)) return errorBody('invalid-request');
    try {
      if (query.view === 'recent') {
        if (Object.keys(query).some(key => !['profile', 'view', 'before'].includes(key))) return errorBody('invalid-request');
        const page = this.store.recentPage(selected, query.before);
        return typeof page === 'string' ? errorBody(page) : {type: 'application/json', bytes: Buffer.from(JSON.stringify(page))};
      }
      const after = query.after === undefined ? 0 : Number(query.after);
      if (Object.keys(query).some(key => !['profile', 'after'].includes(key)) || !Number.isSafeInteger(after) || after < 0) return errorBody('invalid-request');
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.store.page(selected, after)))};
    } catch {return errorBody('unavailable');}
  }
  #config(taskId: string) {return {configurable: {thread_id: taskId}, durability: 'sync' as const, recursionLimit: 4 * LIMITS.modelCalls + 4, callbacks: []};}
  #finishRecoveredRun(task: Task): void {
    const run = task.runId === null ? undefined : this.store.run(task.runId);
    if (run !== undefined && run.endedAtMs === null) {run.status = task.status; run.endedAtMs = this.context.clock.now(); this.store.saveRun(run);}
  }
  #recoverUnavailable(taskId: string): Promise<void> {
    const traceparent = this.#task(taskId).traceparent;
    return this.#change(taskId, task => {
      const unknown = unresolved(this.store.calls(taskId));
      task.status = unknown ? 'uncertain' : 'paused'; task.code = unknown ? 'uncertain-result' : 'unavailable';
      this.#finishRecoveredRun(task);
    }, traceparent === null ? undefined : {traceparent});
  }
  async #reconcile(taskId: string, startup: boolean, active?: Active): Promise<void> {
    const snapshot = await this.#graph.getState(this.#config(taskId));
    const values = snapshot.values as Partial<GraphState>;
    const traceparent = this.#task(taskId).traceparent;
    let result: string | undefined;
    const publication = this.#change(taskId, task => {
      if (terminal(task.status)) return;
      if (unresolved(this.store.calls(taskId))) {task.status = 'uncertain'; task.code = 'uncertain-result';}
      else if (snapshot.next.length === 0 && typeof values.result === 'string') {
        task.status = 'succeeded'; task.code = null; this.store.message(task, `${task.id}-result`, 'assistant', values.result, this.context.clock.now()); result = values.result;
      } else if (snapshot.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0)) {
        // The turn that decided to ask saved the question before the interrupt; an interrupt without one is not evidence of a saved question.
        if (task.question === null) {task.status = 'uncertain'; task.code = 'uncertain-result';}
        else {task.status = task.question.answer === null ? 'waiting' : 'paused'; task.code = null;}
      } else {task.status = 'paused'; task.code = null;}
      if (active !== undefined) this.#settle(task, active);
      if (startup) this.#finishRecoveredRun(task);
    }, active?.span.context ?? (traceparent === null ? undefined : {traceparent}));
    if (active !== undefined && this.#task(taskId).status !== 'running' && this.#active === active) this.#active = undefined;
    await publication;
    // Only a result this run just produced is offered; startup reconciliation never speaks an answer the owner did not just ask for.
    if (active !== undefined && result !== undefined) this.#speak(taskId, `${taskId}-result`, result, active.span.context);
  }
  #settle(task: Task, active: Active): void {
    task.activeMs += Math.max(0, this.context.clock.now() - active.accountedAt); active.accountedAt = this.context.clock.now();
    const run = this.store.run(active.runId);
    if (run !== undefined) {run.status = task.status; run.endedAtMs = this.context.clock.now(); this.store.saveRun(run);}
  }
  #launch(taskId: string): void {
    if (this.#active !== undefined) return;
    const task = this.#task(taskId); if (task.runId === null || task.status !== 'running') return;
    const run = this.store.run(task.runId); if (run === undefined) return;
    const span = startSpan(this.context.trace, 'bunny.assistant.run', {parent: {traceparent: run.traceparent},
      ...(run.previousTraceparent === null ? {} : {links: [{traceparent: run.previousTraceparent}]}), attributes: {'bunny.assistant.task_id': task.id, 'bunny.assistant.run_id': run.id}});
    const active: Active = {taskId, runId: run.id, generation: task.generation, controller: new AbortController(), span, accountedAt: this.context.clock.now(), work: Promise.resolve()};
    this.#active = active;
    active.deadline = this.context.scheduler.after(Math.max(0, LIMITS.activeMs - task.activeMs), () => {active.controller.abort();});
    active.work = this.#execute(active);
  }
  #fence(active: Active): Task {
    const task = this.#task(active.taskId);
    if (this.#closed || this.context.signal.aborted || active.controller.signal.aborted || task.generation !== active.generation || task.status !== 'running') fail('cancelled');
    if (!this.available()) fail('unavailable');
    return task;
  }
  async #execute(active: Active): Promise<void> {
    const abort = () => {active.controller.abort();}; this.context.signal.addEventListener('abort', abort, {once: true});
    this.#log('assistant.run.started', active);
    try {
      await this.outbox.transaction(() => {const run = this.store.run(active.runId), task = this.#fence(active);
        if (run !== undefined) {run.traceparent = active.span.context.traceparent; this.store.saveRun(run);}
        task.traceparent = active.span.context.traceparent; this.store.save(task);});
      const task = this.#fence(active), config = {...this.#config(task.id), signal: active.controller.signal};
      const snapshot = await this.#graph.getState(config); this.#fence(active);
      const interrupted = snapshot.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0);
      const input = interrupted && task.question?.answer !== null && task.question?.answer !== undefined
        ? new Resume<unknown, Partial<GraphState>, 'turn' | 'ask' | 'answered' | 'tool' | 'approve' | 'act' | '__start__'>({resume: task.question.answer})
        : snapshot.createdAt === undefined ? {taskId: task.id, step: 0, next: 'end' as const, decision: '', result: ''} : null;
      await this.#graph.invoke(input, config); this.#fence(active);
      await this.#reconcile(task.id, false, active);
    } catch (error) {
      const code = codeOf(error);
      try {await this.#change(active.taskId, task => {
        if (terminal(task.status)) {this.#settle(task, active); return;}
        const unknown = unresolved(this.store.calls(task.id));
        task.status = unknown ? 'uncertain' : code === 'cancelled' ? 'paused' : 'failed';
        task.code = unknown ? 'uncertain-result' : code; this.#settle(task, active);
      }, active.span.context);} catch { /* Failed durability is not reported as saved; startup reconciles checkpoints and receipts. */ }
    } finally {
      active.deadline?.();
      this.#log('assistant.run.settled', active); active.span.end(this.#task(active.taskId).code === null ? 'unset' : 'error'); this.context.signal.removeEventListener('abort', abort);
      if (this.#active === active) this.#active = undefined;
    }
  }
  #activeFor(taskId: string): Active {
    const active = this.#active; if (active === undefined || active.taskId !== taskId) return fail('invalid-state');
    this.#fence(active); return active;
  }
  /** Appends the item a call produced, once: a re-run node finds the item by the call's effect id and leaves it. */
  #append(taskId: string, item: Appended, parent: TraceContext, also?: (task: Task) => void): Promise<void> {
    return this.#change(taskId, task => {
      if (task.transcript.some(existing => 'effect' in existing && existing.effect === item.effect)) return;
      task.transcript.push(item); also?.(task);
      if (textBytes(JSON.stringify(task.transcript)) > LIMITS.stateBytes) fail('capacity');
    }, parent);
  }
  #core(): CoreCopy {return this.options.core?.() ?? {sessions: [], mode: undefined, synced: false};}
  /** The prompt context at this call: the profile's curated persona and the owner's active preferences as they are now. */
  #context(profile: AssistantProfile): PromptContext {
    const persona = PROFILES.find(value => value.id === profile) ?? fail('internal');
    return {persona: {name: persona.name, character: persona.character}, preferences: (this.options.preferences?.() ?? []).map(entry => ({title: entry.title, text: entry.text}))};
  }
  async #turn(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic', task.profile === 'bunny'), copy = this.#core();
    const id = `${state.taskId}-step-${String(state.step)}`;
    const context = this.#context(task.profile);
    // Over the bound the call is refused before any usage is reserved or a request leaves: the owner reads why, nothing is truncated.
    if (contextBytes(context) > LIMITS.contextBytes) {
      await this.#change(state.taskId, current => {this.store.message(current, `${id}-context`, 'assistant', CONTEXT_TOO_LARGE, this.context.clock.now());}, active.span.context);
      this.#speak(state.taskId, `${id}-context`, CONTEXT_TOO_LARGE, active.span.context);
      fail('capacity');
    }
    const request: TurnInput = {instructions: INSTRUCTIONS, context, transcript: task.transcript, tools,
      mode: copy.mode === undefined ? null : {mode: copy.mode.mode, revision: copy.mode.revision}};
    // The call reserves what this request could use: its bytes bound its input tokens, and the output bound its answer's.
    const inputUnits = inputBound(request), paid = provider.name !== 'synthetic';
    const text = await this.#call(state.taskId, state.step, 'model', signal => provider.turn(request, signal)
      .then(reply => ({text: JSON.stringify(reply), units: reply.units, usage: reply.usage ?? null})), undefined,
    {units: inputUnits + LIMITS.outputUnits, unit: paid ? 'tokens' : 'synthetic units',
      ...(paid ? {spend: {model: provider.model, inputUnits, outputUnits: LIMITS.outputUnits}} : {})});
    const reply = parseReply(text), call = reply.calls[0];
    let next: Next = 'end', result = '';
    // The final text is what the owner reads; it keeps the result bound even though a reply with the model's own blocks may be larger.
    if (reply.text !== null && textBytes(reply.text) > LIMITS.toolBytes) fail('capacity');
    if (reply.stop === 'refusal') {
      let refused = false;
      await this.#append(state.taskId, {role: 'assistant', text: reply.text, calls: [], effect: id}, active.span.context,
        current => {this.store.message(current, `${id}-refusal`, 'assistant', REFUSED, this.context.clock.now()); refused = true;});
      if (refused) this.#speak(state.taskId, `${id}-refusal`, REFUSED, active.span.context);
      fail('forbidden');
    }
    if (reply.stop === 'truncated') {
      await this.#append(state.taskId, {role: 'assistant', text: reply.text, calls: [], effect: id}, active.span.context);
      fail('capacity');
    }
    if (call === undefined) result = reply.text ?? '';
    else {
      const tool = definition(call.name), permitted = tools.some(permittedTool => permittedTool.name === call.name);
      next = tool === undefined || !permitted ? 'tool' : tool.effect === 'question' ? 'ask' : tool.effect === 'command' ? 'approve' : 'tool';
    }
    let question: Question | undefined;
    const command = call === undefined ? undefined : catalogCommand(call.name);
    if (next === 'approve' && command !== undefined && call !== undefined) {
      const selected = command === 'art-request' && this.store.hasArtReply(task.id)
        ? {code: 'invalid-state'} : await this.#catalog().propose(command, call, active.span.context);
      const id = `${state.taskId}-q${String(this.#task(state.taskId).questions + 1)}`;
      if ('code' in selected) result = `refused: ${selected.code}`;
      else if ('question' in selected) question = {id, kind: 'clarification', text: selected.question, answer: null, call: call.id, proposal: null};
      else question = {id, kind: 'approval', text: selected.text, answer: null, call: call.id, proposal: selected.proposal};
    } else if ((next === 'ask' || next === 'approve') && call !== undefined) {
      question = this.#question(state.taskId, call, copy);
    }
    // A command the module cannot bind to a synced Hub-mode revision, or whose value is not a mode, is refused to the model in the tool node.
    if (next === 'approve' && question === undefined) next = 'tool';
    if (question?.kind === 'clarification') next = 'ask';
    const item: Appended = {role: 'assistant', text: reply.text, calls: call === undefined ? [] : [call], effect: id, ...(reply.blocks === undefined ? {} : {blocks: reply.blocks})};
    let asked = false, limited = false;
    try {
      await this.#append(state.taskId, item, active.span.context, current => {
        if (question === undefined) return;
        if (current.questions >= LIMITS.questions) {limited = true; fail('capacity');}
        current.questions += 1; current.question = question;
        this.store.message(current, question.id, 'assistant', question.text, this.context.clock.now()); asked = true;
      });
    } catch (error) {
      if (limited) await this.#limitReached(state.taskId, `${id}-limit`, `This turn reached its limit of ${String(LIMITS.questions)} questions.`, active);
      throw error;
    }
    if (asked && question !== undefined) this.#speak(state.taskId, question.id, question.text, active.span.context);
    return {step: state.step + 1, next, result};
  }
  #catalog(): ConversationActions {return this.#catalogActions ??= new ConversationActions(this.context, this.#allowed);}
  #catalogActions: ConversationActions | undefined;
  /** The question a call asks, or undefined when the command cannot be proposed. */
  #question(taskId: string, call: ToolCall, copy: CoreCopy): Question | undefined {
    const id = `${taskId}-q${String(this.#task(taskId).questions + 1)}`;
    if (call.name === ASK_OWNER) {
      const text = typeof call.input.text === 'string' && call.input.text.trim() !== '' ? call.input.text : 'What should the assistant do next?';
      return {id, text: text.slice(0, 1024), answer: null, kind: 'clarification', call: call.id, proposal: null};
    }
    if (call.name === DELEGATE_CODING) {
      const {repository, brief} = call.input;
      if (typeof repository !== 'string' || !REPOSITORY.test(repository) || repository.length > 64 || typeof brief !== 'string' || brief.trim() === '' || textBytes(brief) > BRIEF_BYTES) return undefined;
      const coding = this.options.coding?.();
      if (coding === undefined || !coding.available || coding.endpointId === null) return undefined;
      const proposal: Proposal = {family: 'coding-dispatch', target: 'assistant', data: {repository, brief: brief.trim()}, expectedRevision: coding.revision};
      return {id, text: `Delegate to the coding worker in ${repository}: ${proposal.data.brief}`.slice(0, 1024), answer: null, kind: 'approval', call: call.id, proposal};
    }
    const owner = deviceToolOwner(call.name);
    if (owner !== undefined) {
      const selected = chooseDevice(this.options.devices?.(owner), call.input.device);
      if ('matches' in selected) {
        const names = selected.matches.slice(0, 4).map(device => device.id).join(', ');
        return {id, text: `Which ${owner === ASSISTANT_WEMO_OWNER ? "plug" : "light"} do you mean? Matching device IDs: ${names}.`, answer: null, kind: 'clarification', call: call.id, proposal: null};
      }
      if ('code' in selected) return undefined;
      const result = deviceProposal(call, selected.device);
      if ('code' in result) return undefined;
      return {id, text: deviceProposalText(result.proposal, deviceLabel(selected.device)), answer: null, kind: 'approval', call: call.id, proposal: result.proposal};
    }
    const mode = MODES.find(value => value === call.input.mode);
    if (mode === undefined || copy.mode === undefined || !copy.synced) return undefined;
    const proposal: Proposal = {family: 'mode-set', target: 'hub', data: {mode}, expectedRevision: copy.mode.revision};
    return {id, text: `Set the Hub mode to ${proposal.data.mode}?`, answer: null, kind: 'approval', call: call.id, proposal};
  }
  /** Why a command call was refused instead of proposed. */
  #proposalRefusal(call: ToolCall): string {
    const copy = this.#core();
    if (call.name === DELEGATE_CODING) {
      const {repository, brief} = call.input;
      if (typeof repository !== 'string' || !REPOSITORY.test(repository) || typeof brief !== 'string' || brief.trim() === '' || textBytes(brief) > BRIEF_BYTES) return 'The repository name or the brief is not usable: name an allowlisted repository and write a brief under 4 KiB; nothing was proposed.';
      return 'No coding worker is connected right now, so nothing was proposed; the owner can start the worker on their computer.';
    }
    const owner = deviceToolOwner(call.name);
    if (owner !== undefined) {
      const selected = chooseDevice(this.options.devices?.(owner), call.input.device);
      if ('matches' in selected) return 'Multiple devices match. Ask the owner for an exact device ID.';
      const result = 'code' in selected ? selected : deviceProposal(call, selected.device);
      return 'code' in result ? `refused: ${result.code}; no ${owner === ASSISTANT_WEMO_OWNER ? 'plug' : 'light'} change was proposed.` : 'This tool is not permitted.';
    }
    if (MODES.find(value => value === call.input.mode) === undefined) return 'The requested mode is not work, free or quiet; nothing was proposed.';
    if (copy.mode === undefined || !copy.synced) return 'The Hub mode is not synced with the core right now, so a proposal cannot be bound to its revision; nothing was proposed.';
    return 'This tool is not permitted.';
  }
  #ask(state: GraphState): Partial<GraphState> {
    const task = this.#task(state.taskId), question = task.question ?? fail('invalid-state');
    const answer = interrupt<{id: string; text: string}, string>({id: question.id, text: question.text});
    return {decision: answer};
  }
  /** The owner's answer becomes the question tool's result, once, so the next turn sees it. */
  async #answered(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const question = task.question ?? fail('invalid-state');
    const last = task.transcript.at(-1);
    const name = last?.role === 'assistant' ? last.calls.find(call => call.id === question.call)?.name ?? ASK_OWNER : ASK_OWNER;
    await this.#append(state.taskId, {role: 'tool', call: question.call, name, result: state.decision, ok: true, effect: `${question.id}-answer`}, active.span.context);
    return {step: state.step};
  }
  #approve(state: GraphState): Partial<GraphState> {
    const task = this.#task(state.taskId), question = task.question ?? fail('invalid-state');
    const decision = interrupt<{id: string; text: string}, string>({id: question.id, text: question.text});
    return {decision};
  }
  async #tool(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const last = [...task.transcript].reverse().find(item => item.role === 'assistant');
    const call = last?.role === 'assistant' ? last.calls[0] : undefined;
    if (call === undefined) fail('invalid-state');
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic', task.profile === 'bunny');
    const tool = definition(call.name), permitted = tools.some(permittedTool => permittedTool.name === call.name);
    const id = `${state.taskId}-step-${String(state.step)}`;
    if (tool === undefined || !permitted || (tool.effect !== 'read' && tool.effect !== 'draft')) {
      const reason = tool !== undefined && permitted && tool.effect === 'command' ? catalogCommand(call.name) === undefined ? this.#proposalRefusal(call) : state.result : 'This tool is not permitted.';
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result: reason, ok: false, effect: `${id}-refused`}, active.span.context,
        current => {this.store.message(current, `${id}-refused`, 'tool', reason, this.context.clock.now());});
      return {step: state.step};
    }
    const owner = deviceToolOwner(call.name);
    const result = await this.#call(state.taskId, state.step, 'tool', async (signal, parent) => {
      const now = this.context.clock.now();
      if (owner !== undefined) {
        const name = call.input.device;
        const read = await this.options.readDevice?.(owner, name, signal, parent);
        return {text: read ?? readDevices(this.options.devices?.(owner), name, now, owner), units: 0};
      }
      if (isCatalogTool(call.name)) return {text: await this.#catalog().read(call, parent) ?? fail('invalid-state'), units: 0};
      const text = call.name === READ_FIXTURE ? FIXTURE_TEXT : call.name === READ_SESSIONS ? summarizeSessions(this.#core(), now) : fail('invalid-state');
      return {text, units: 0};
    });
    await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result, ok: true, effect: id}, active.span.context);
    return {step: state.step + 1};
  }
  async #act(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const question = task.question ?? fail('invalid-state'), proposal = question.proposal ?? fail('invalid-state');
    const id = `${state.taskId}-step-${String(state.step)}`, name = proposal.family === 'mode-set' ? SET_MODE : proposal.family === 'coding-dispatch' ? DELEGATE_CODING :
      proposal.family === 'catalog-action' ? catalogTool(proposal.command) : 'owner' in proposal ? SET_WEMO_POWER : proposal.family === 'power-set' ? SET_LIFX_POWER : SET_LIFX_BRIGHTNESS;
    const refuse = async (suffix: string, text: string): Promise<Partial<GraphState>> => {
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: question.call, name, result: text, ok: false, effect: `${id}-${suffix}`}, active.span.context,
        current => {this.store.message(current, `${id}-${suffix}`, 'tool', text, this.context.clock.now());});
      return {step: state.step, next: 'turn'};
    };
    if (state.decision !== 'approve') return refuse('declined', DECLINED);
    if (!permittedTools(this.#allowed, this.provider(task.profile).name === 'synthetic', task.profile === 'bunny').some(tool => tool.name === name)) return refuse('refused', 'This tool is not permitted.');
    const settle = (answer: RequestResult, accepted: string): {text: string; units: number} => {
      // The dispatcher's own uncertainty reaches the module as a rejection carrying `uncertain-result`; the fate is unknown either way.
      if (answer.status === 'uncertain' || (answer.status === 'rejected' && answer.error.error.code === 'uncertain-result')) throw new Fault('uncertain-result');
      if (answer.status === 'accepted') return {text: accepted, units: 0};
      const code = answer.error.error.code;
      return {text: proposal.family === 'mode-set' && code === 'revision-conflict'
        ? 'refused: revision-conflict: the Hub mode changed since this was proposed; nothing was changed. Read the mode again before proposing another change.'
        : `refused: ${code}`, units: 0};
    };
    let result: string, delegation: Question | undefined;
    if (proposal.family !== 'coding-dispatch') {
      const dispatch = this.options.dispatch;
      if (dispatch === undefined) return refuse('refused', 'This tool is not permitted.');
      const data: AssistantDispatch = proposal.family === 'mode-set'
        ? {requestId: id, family: proposal.family, target: proposal.target, data: {mode: proposal.data.mode, expectedRevision: proposal.expectedRevision}}
        : {requestId: id, ...proposal};
      const artDescription = proposal.family === 'catalog-action' && proposal.command === 'art-request' &&
        typeof proposal.data.description === 'string' ? proposal.data.description : undefined;
      const receipt = proposal.family === 'mode-set'
        ? `accepted: the core accepted mode-set ${proposal.data.mode} as operation ${id}; its outcome is tracked separately`
        : proposal.family === 'catalog-action' && proposal.command === 'art-request'
          ? 'accepted: the art service queued this request. The Conversation attachment will show the actual result.'
          : `accepted: ${proposal.family === 'catalog-action' ? proposal.command : proposal.family} on ${proposal.target} as operation ${id}; its outcome is tracked separately`;
      result = await this.#call(state.taskId, state.step, 'tool', async (signal, parent) => {
        const admitByMs = this.context.clock.now() + SHOW_SAVE_WINDOW_MS;
        if (proposal.family === 'catalog-action') {
          const refused = this.#catalog().beforeDispatch(proposal, id, admitByMs);
          if (refused !== undefined) return {text: `refused: ${refused}`, units: 0};
        }
        const answer = await dispatch(data.family === 'catalog-action' && data.command === 'nanoleaf-show-save'
          ? {...data, admitByMs} : data, parent, signal);
        if (proposal.family === 'catalog-action' && answer.status === 'rejected' && answer.error.error.code !== 'uncertain-result') {
          this.#catalog().rejected(proposal, id);
        }
        return settle(answer, receipt);
      }, artDescription === undefined ? undefined : current => {
        this.store.artReply(current, id, artDescription, this.context.clock.now());
      });
    } else {
      const delegate = this.options.delegate;
      if (delegate === undefined) return refuse('refused', 'This tool is not permitted.');
      // The task waits on the delegation before the hand-off leaves, so a worker's word that comes back faster than this
      // step finds its question. The worker's word answers it as the owner's answer would a question; it counts no question.
      const pending: Question = {id: `${state.taskId}-delegation-${String(state.step)}`, text: `Delegated to the coding worker in ${proposal.data.repository}: ${proposal.data.brief}`.slice(0, 1024),
        answer: null, kind: 'delegation', call: question.call, proposal: null};
      delegation = pending;
      await this.#change(state.taskId, current => {if (current.question?.id !== pending.id) current.question = pending;}, active.span.context);
      result = await this.#call(state.taskId, state.step, 'tool', signal => delegate({requestId: id, taskId: state.taskId, repository: proposal.data.repository, brief: proposal.data.brief,
        expectedRevision: proposal.expectedRevision}, active.span.context, signal)
        .then(answer => settle(answer, `accepted: the coding worker was handed the task as operation ${id}; its structured result arrives as this tool's later result`)));
    }
    const accepted = result.startsWith('accepted');
    await this.#append(state.taskId, {role: 'tool', call: question.call, name, result, ok: accepted, effect: id}, active.span.context, current => {
      if (delegation === undefined) return;
      // The conversation says "delegated" only once the core accepted the hand-off; a refused one has no worker's word to wait for, so the answered approval stands again.
      if (accepted) this.store.message(current, delegation.id, 'assistant', delegation.text, this.context.clock.now());
      else if (current.question?.kind === 'delegation') current.question = question;
    });
    return {step: state.step + 1, next: proposal.family === 'coding-dispatch' && accepted ? 'await' : 'turn'};
  }
  #await(state: GraphState): Partial<GraphState> {
    const task = this.#task(state.taskId), question = task.question ?? fail('invalid-state');
    if (question.kind !== 'delegation') fail('invalid-state');
    // A word that arrived while the hand-off was still being recorded is taken up here, without waiting.
    if (question.answer !== null) return {decision: question.answer};
    const decision = interrupt<{id: string; text: string}, string>({id: question.id, text: question.text});
    return {decision};
  }
  /** The worker's final word becomes the delegation tool's result, once, so the next turn reports it. */
  async #delivered(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const question = task.question ?? fail('invalid-state');
    await this.#append(state.taskId, {role: 'tool', call: question.call, name: DELEGATE_CODING, result: state.decision, ok: state.decision.startsWith('completed'), effect: `${question.id}-result`}, active.span.context,
      current => {this.store.message(current, `${question.id}-result`, 'tool', state.decision, this.context.clock.now());});
    return {step: state.step, next: 'turn'};
  }
  /**
   * Delivers the worker's final word to the task waiting on its delegation and resumes it. A task the engine cannot run
   * now keeps the answer and waits for the owner's resume; a task that is not waiting on a delegation ignores it.
   */
  async deliver(taskId: string, text: string, parent: TraceContext): Promise<void> {
    let launch = false;
    await this.outbox.transaction(add => {
      const task = this.store.task(taskId);
      if (task === undefined || terminal(task.status)) return;
      const question = task.question;
      if (question === null || question.kind !== 'delegation' || question.answer !== null) return;
      question.answer = text.slice(0, LIMITS.toolBytes);
      if (['waiting', 'paused'].includes(task.status) && this.store.meta().enabled && this.available() && this.#active === undefined && !this.#closed) {this.#activate(task, parent); launch = true;}
      this.store.save(task); this.#publish(add, parent);
    });
    if (launch && !this.#closed && !this.context.signal.aborted) this.#launch(taskId);
  }
  /** Saves the message that names the limit a turn reached and offers it to speech, as the prompt-context bound does. */
  async #limitReached(taskId: string, messageId: string, text: string, active: Active): Promise<void> {
    try {
      await this.#change(taskId, current => {this.store.message(current, messageId, 'assistant', text, this.context.clock.now());}, active.span.context);
      this.#speak(taskId, messageId, text, active.span.context);
    } catch { /* The capacity outcome stands without its message when the message cannot be saved. */ }
  }
  /** The per-turn limit the next call would pass, as the message naming it, or undefined while every bound has room. */
  #limitOf(task: Task, kind: 'model' | 'tool', timeout: number, budget: Budget): string | undefined {
    if (kind === 'model' ? task.modelCalls >= LIMITS.modelCalls : task.toolCalls >= LIMITS.toolCalls) {
      return `This turn reached its limit of ${String(kind === 'model' ? LIMITS.modelCalls : LIMITS.toolCalls)} ${kind} calls.`;
    }
    if (task.activeMs + timeout > LIMITS.activeMs) return `This turn reached its limit of ${String(LIMITS.activeMs / 60_000)} minutes of active time.`;
    if (task.reservedUnits + budget.units > LIMITS.units) return `This turn reached its limit of ${LIMITS.units.toLocaleString('en-US')} ${budget.unit}: the next model call could pass it.`;
    return undefined;
  }
  /**
   * One call with its receipt. Before anything is sent, one transaction checks the turn's limits, counts the call, reserves
   * its time and units and, for a paid model call, its spend; a limit refuses the call with `capacity` and a conversation
   * message naming it. The answer's reported usage replaces the reservations; unreported usage keeps them.
   */
  async #call(taskId: string, ordinal: number, kind: 'model' | 'tool', operation: (signal: AbortSignal, parent: TraceContext) => Promise<Answer>,
    reserve?: (task: Task) => void, budget: Budget = {units: 0, unit: 'units'}): Promise<string> {
    const active = this.#activeFor(taskId);
    const id = `${taskId}-step-${String(ordinal)}`, saved = this.store.call(id);
    if (saved !== undefined) {
      if (saved.status !== 'succeeded' || saved.result === null) fail('uncertain-result');
      await this.#change(taskId, task => {this.#fence(active); task.nextOrdinal = Math.max(task.nextOrdinal, ordinal + 1);}, active.span.context);
      this.#fence(active); return saved.result;
    }
    const timeout = kind === 'model' ? LIMITS.modelMs : LIMITS.toolMs, units = budget.units;
    // A model reply carries the provider's own blocks for replay, so it may be larger than a tool result.
    const bound = kind === 'model' ? LIMITS.replyBytes : LIMITS.toolBytes;
    const span = startSpan(this.context.trace, kind === 'model' ? 'bunny.assistant.model' : 'bunny.assistant.tool', {parent: active.span.context,
      attributes: {'bunny.assistant.task_id': taskId, 'bunny.assistant.run_id': active.runId, 'bunny.assistant.effect_id': id}});
    const call: Call = {version: 1, id, taskId, runId: active.runId, ordinal, kind, status: 'admitted', result: null, units: null,
      reservedUnits: units, reservedMs: timeout, elapsedMs: null, traceparent: span.context.traceparent};
    const started = this.context.clock.now(); let replied = false, limit: string | undefined, answer: Answer | undefined;
    try {
      await this.#change(taskId, task => {
        this.#fence(active);
        task.activeMs += Math.max(0, started - active.accountedAt);
        if (task.nextOrdinal !== ordinal) fail('capacity');
        limit = this.#limitOf(task, kind, timeout, budget);
        if (limit === undefined && budget.spend !== undefined) limit = this.spend.reserve({id, purpose: 'task', owner: taskId, ...budget.spend});
        if (limit !== undefined) fail('capacity');
        if (kind === 'model') task.modelCalls += 1; else task.toolCalls += 1;
        task.activeMs += timeout; task.reservedUnits += units; this.store.saveCall(call);
        reserve?.(task);
      }, span.context);
      this.#fence(active);
      const reply = await this.#wait(active, timeout, bound, () => Promise.resolve().then(() => operation(active.controller.signal, span.context)), call);
      replied = true; answer = reply; this.#fence(active);
      if (typeof reply.text !== 'string' || textBytes(reply.text) > bound || (reply.units !== null && (!Number.isSafeInteger(reply.units) || reply.units < 0 || reply.units > units))) fail('capacity');
      const elapsed = Math.min(timeout, Math.max(0, this.context.clock.now() - started)); active.accountedAt = this.context.clock.now();
      await this.#change(taskId, task => {
        this.#fence(active); call.status = 'succeeded'; call.result = reply.text; call.units = reply.units; call.elapsedMs = elapsed;
        this.store.saveCall(call); task.activeMs -= timeout - elapsed;
        if (reply.units !== null) task.reservedUnits -= units - reply.units;
        this.spend.settle(id, reply.usage ?? null);
        task.nextOrdinal = ordinal + 1;
        if (kind === 'tool') this.store.message(task, id, 'tool', reply.text, this.context.clock.now());
      }, span.context);
      this.#fence(active); return reply.text;
    } catch (error) {
      active.accountedAt = this.context.clock.now();
      const admitted = this.store.call(id);
      // A definitive answer, such as a refusal, an error status or an oversized reply, settles the call; a lost answer, a
      // deadline or a cancellation leaves its fate unknown. Usage an answer reported is spent whatever became of the answer.
      const definitive = replied ? !(error instanceof Fault && error.code === 'cancelled') : error instanceof ProviderFault && !error.uncertain && error.code !== 'cancelled';
      if (admitted !== undefined && admitted.status === 'admitted') {
        try {await this.outbox.transaction(() => {
          admitted.status = definitive ? 'failed' : 'uncertain'; if (definitive) admitted.code = codeOf(error); this.store.saveCall(admitted);
          this.spend.settle(id, answer?.usage ?? null);
        });} catch { /* Admission remains evidence of unknown fate. */ }
      }
      if (limit !== undefined) await this.#limitReached(taskId, `${id}-limit`, limit, active);
      throw error;
    } finally {this.#log('assistant.call.settled', active, id); const receipt = this.store.call(id); span.end(receipt !== undefined && receipt.status !== 'succeeded' ? 'error' : 'unset');}
  }
  async #wait(active: Active, timeout: number, bound: number, operation: () => Promise<Answer>, call: Call): Promise<Answer> {
    let cancel: Cancel | undefined, stopped: (() => void) | undefined, settled = false;
    const deadline = new Promise<Answer>((_resolve, reject) => {
      stopped = () => {settled = true; reject(new Fault('cancelled'));};
      active.controller.signal.addEventListener('abort', stopped, {once: true});
      cancel = this.context.scheduler.after(timeout, () => {settled = true; reject(new Fault('uncertain-result')); active.controller.abort();});
    });
    try {
      this.#fence(active);
      const pending = operation().then(reply => {
        if (settled && !this.#closed && !this.context.signal.aborted && this.context.database().isOpen) {
          const evidence = typeof reply.text === 'string' && textBytes(reply.text) <= bound &&
            (reply.units === null || Number.isSafeInteger(reply.units) && reply.units >= 0 && reply.units <= call.reservedUnits);
          // Evidence only: no budget refund, task transition or graph continuation after the wait ended. Reported usage is
          // what the late call spent, so it replaces the call's spend reservation.
          void this.outbox.transaction(() => {
            const saved = this.store.call(call.id);
            if (evidence && saved !== undefined) {saved.result = reply.text; saved.units = reply.units; saved.status = 'succeeded'; this.store.saveCall(saved);}
            this.spend.settle(call.id, reply.usage ?? null);
          }).catch(() => {});
        }
        return reply;
      });
      return await Promise.race([pending, deadline]);
    } finally {settled = true; cancel?.(); if (stopped !== undefined) active.controller.signal.removeEventListener('abort', stopped);}
  }
  #log(event: LogEvent, active: Active, effectId?: string): void {
    try {
      const task = this.#task(active.taskId), call = effectId === undefined ? undefined : this.store.call(effectId);
      const code = call === undefined || call.status === 'succeeded' ? task.code : call.status === 'failed' ? call.code ?? task.code : 'uncertain-result';
      const outcome = event === 'assistant.run.started' ? 'accepted' : call !== undefined ? call.status === 'succeeded' ? Outcome.succeeded : call.status === 'failed' ? Outcome.failed : Outcome.uncertain
        : ['waiting', 'paused', 'running'].includes(task.status) ? 'partial' : task.status;
      recordLog(this.context.log, event, {'bunny.assistant.task_id': active.taskId, 'bunny.assistant.run_id': active.runId,
        'bunny.outcome': outcome, ...(effectId === undefined ? {} : {'bunny.assistant.effect_id': effectId}),
        ...(code === null ? {} : {'bunny.code': code})}, active.span.context);
    } catch { /* Diagnostics do not decide task outcomes. */ }
  }
}
