import {createHash, randomUUID} from 'node:crypto';
import {Annotation, Command as Resume, END, StateGraph, interrupt} from '@langchain/langgraph';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {AssistantControl, AssistantDispatch, AssistantInput, AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {fullDisk, startSpan, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type ModuleStagedUpload, type ModuleUploadRequest, type Outbox, type Reply, type RequestResult, type Span, type Subscription, type TraceContext, recordLog, type LogEvent, Outcome} from '@jimmie-potts/sdk';
import {CheckpointCapacityError, SqliteCheckpointSaver} from './checkpointer.js';
import {AssistantStore, GRAPH_VERSION, LIMITS, terminal, unresolved, type Appended, type Call, type Proposal, type Question, type StagedInput, type Task} from './store.js';
import {ProviderFault, textBytes, type ModelProvider, type ToolCall, type TurnReply} from './provider.js';
import {SyntheticProvider} from './synthetic.js';
import {ASK_OWNER, definition, FIXTURE_TEXT, MODES, permittedTools, READ_FIXTURE, READ_SESSIONS, SET_MODE, summarizeSessions, type CoreCopy} from './tools.js';

export type {ModelProvider, TurnInput, TurnReply, TranscriptItem} from './provider.js';
/** Sends one approved command through the core's tracked dispatcher; the module binds it to its own participant. */
export type Dispatch = (data: AssistantDispatch, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult>;
/**
 * What the module gives the engine (Hub #46): the `bunny` profile's provider (synthetic without one), the allowlisted
 * tool names, the synced copy of the core for reads and proposals, and the dispatch path for approved commands.
 */
export type AssistantOptions = {
  provider?: ModelProvider;
  tools?: readonly string[];
  core?: () => CoreCopy;
  dispatch?: Dispatch;
  available?: () => boolean;
};
class Fault extends Error {constructor(readonly code: ErrorCode) {super(code);}}
function fail(code: ErrorCode): never {throw new Fault(code);}
const codeOf = (error: unknown): ErrorCode => error instanceof Fault || error instanceof ProviderFault ? error.code : fullDisk(error) || error instanceof CheckpointCapacityError ? 'capacity' : 'internal';
const profiles: readonly AssistantProfile[] = ['bunny', 'reachy', 'microduck'];
const profile = (value: unknown): value is AssistantProfile => typeof value === 'string' && profiles.includes(value as AssistantProfile);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const assistantStateDraft = (data: AssistantState) => ({kind: 'state' as const, type: 'org.bunny.assistant-state.updated', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-state/2.0', data});
export const INSTRUCTIONS = 'Answer the owner briefly and truthfully from the evidence the tools return.';
export const DECLINED = 'The owner declined the proposal; nothing was changed.';
export const REFUSED = 'The model declined this request.';
type Next = 'ask' | 'tool' | 'approve' | 'end';
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
  readonly #validator = new MessageValidator();
  readonly #subscriptions: Subscription[] = [];
  readonly #graph;
  #active: Active | undefined;
  #closed = false;
  #recoveryUnavailable = false;
  readonly #synthetic = new SyntheticProvider();
  readonly #allowed: readonly string[];
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly options: AssistantOptions = {}) {
    this.store = new AssistantStore(context.database()); registerCoreFamilies(this.#validator);
    this.#allowed = [...(options.tools ?? [])];
    this.#graph = new StateGraph(shape)
      .addNode('turn', state => this.#turn(state))
      .addNode('ask', state => this.#ask(state))
      .addNode('answered', state => this.#answered(state))
      .addNode('tool', state => this.#tool(state))
      .addNode('approve', state => this.#approve(state))
      .addNode('act', state => this.#act(state))
      .addEdge('__start__', 'turn')
      .addConditionalEdges('turn', state => state.next, {ask: 'ask', tool: 'tool', approve: 'approve', end: END})
      .addEdge('ask', 'answered').addEdge('answered', 'turn').addEdge('tool', 'turn').addEdge('approve', 'act').addEdge('act', 'turn')
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
    } catch (error) {return errorBody(codeOf(error), {detail: 'The assistant control was not saved.'});}
  }
  #control(command: Command<AssistantControl>): Promise<Reply> {
    return this.#admit(command, digest(command.data), () => {
      const data = command.data; this.#revision(data.expectedRevision);
      if (data.action === 'enable' || data.action === 'disable') {
        if (data.taskId !== undefined) fail('invalid-request');
        if (data.action === 'enable' && !this.available()) fail('unavailable');
        if (data.action === 'disable' && this.store.unfinished() !== undefined) fail('invalid-state');
        this.store.enable(data.action === 'enable'); return undefined;
      }
      const task = this.#task(data.taskId ?? fail('invalid-request'));
      if (terminal(task.status)) fail('invalid-state');
      if (data.action === 'cancel') {
        task.status = 'cancelled'; task.generation += 1; task.code = null; this.store.save(task);
        return undefined;
      }
      if (!['paused', 'uncertain', 'waiting'].includes(task.status) || (task.question !== null && task.question.answer === null)) fail('invalid-state');
      this.#activate(task, command); this.store.save(task); return task.id;
    }).then(reply => {
      const active = this.#active;
      if (command.data.action === 'cancel' && !('error' in reply) && active !== undefined && active.taskId === command.data.taskId) active.controller.abort();
      return reply;
    });
  }
  stage(request: ModuleUploadRequest): ModuleStagedUpload | ErrorBody {
    if (request.target !== 'assistant' || request.name !== 'input.json' || request.signal.aborted || request.bytes.byteLength > 25_600) return errorBody('invalid-request');
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
        task = this.store.newTask(input.profile, input.text);
        this.store.message(task, `${task.id}-prompt`, 'owner', input.text, this.context.clock.now());
      } else {
        task = this.#task(input.taskId ?? fail('invalid-request'));
        if (!['waiting', 'paused'].includes(task.status) || task.profile !== input.profile || task.question === null || task.question.id !== input.questionId || task.question.answer !== null) fail('invalid-state');
        // An approval is answered only by the two literal decisions, so free text can neither apply nor dismiss a proposal.
        if (task.question.kind === 'approval' && !['approve', 'decline'].includes(input.text)) fail('invalid-request');
        task.question.answer = input.text;
        this.store.message(task, `${task.question.id}-answer`, 'owner', input.text, this.context.clock.now());
      }
      this.#activate(task, command); this.store.save(task); this.store.discard(staged.ref); return task.id;
    });
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref !== 'conversation') return undefined;
    const query = request?.query ?? {}, selected = query.profile, after = query.after === undefined ? 0 : Number(query.after);
    if (request?.signal.aborted === true || !profile(selected) || Object.keys(query).some(key => !['profile', 'after'].includes(key)) || !Number.isSafeInteger(after) || after < 0) return errorBody('invalid-request');
    try {return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.store.page(selected, after)))};}
    catch {return errorBody('unavailable');}
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
    const publication = this.#change(taskId, task => {
      if (terminal(task.status)) return;
      if (unresolved(this.store.calls(taskId))) {task.status = 'uncertain'; task.code = 'uncertain-result';}
      else if (snapshot.next.length === 0 && typeof values.result === 'string') {
        task.status = 'succeeded'; task.code = null; this.store.message(task, `${task.id}-result`, 'assistant', values.result, this.context.clock.now());
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
  async #turn(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic'), copy = this.#core();
    const id = `${state.taskId}-step-${String(state.step)}`;
    const text = await this.#call(state.taskId, state.step, 'model', signal => provider.turn({instructions: INSTRUCTIONS, transcript: task.transcript, tools,
      mode: copy.mode === undefined ? null : {mode: copy.mode.mode, revision: copy.mode.revision}}, signal).then(reply => ({text: JSON.stringify(reply), units: reply.units})));
    const reply = parseReply(text), call = reply.calls[0];
    let next: Next = 'end', result = '';
    // The final text is what the owner reads; it keeps the result bound even though a reply with the model's own blocks may be larger.
    if (reply.text !== null && textBytes(reply.text) > LIMITS.toolBytes) fail('capacity');
    if (reply.stop === 'refusal') {
      await this.#append(state.taskId, {role: 'assistant', text: reply.text, calls: [], effect: id}, active.span.context,
        current => {this.store.message(current, `${id}-refusal`, 'assistant', REFUSED, this.context.clock.now());});
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
    const question = (next === 'ask' || next === 'approve') && call !== undefined ? this.#question(state.taskId, call, copy) : undefined;
    // A command the module cannot bind to a synced Hub-mode revision, or whose value is not a mode, is refused to the model in the tool node.
    if (next === 'approve' && question === undefined) next = 'tool';
    const item: Appended = {role: 'assistant', text: reply.text, calls: call === undefined ? [] : [call], effect: id, ...(reply.blocks === undefined ? {} : {blocks: reply.blocks})};
    await this.#append(state.taskId, item, active.span.context, current => {
      if (question === undefined) return;
      if (current.questions >= LIMITS.questions) fail('capacity');
      current.questions += 1; current.question = question;
      this.store.message(current, question.id, 'assistant', question.text, this.context.clock.now());
    });
    return {step: state.step + 1, next, result};
  }
  /** The question a call asks, or undefined for a command that cannot be proposed: an unknown mode value or no synced Hub-mode revision to bind it to. */
  #question(taskId: string, call: ToolCall, copy: CoreCopy): Question | undefined {
    const id = `${taskId}-q${String(this.#task(taskId).questions + 1)}`;
    if (call.name === ASK_OWNER) {
      const text = typeof call.input.text === 'string' && call.input.text.trim() !== '' ? call.input.text : 'What should the assistant do next?';
      return {id, text: text.slice(0, 1024), answer: null, kind: 'clarification', call: call.id, proposal: null};
    }
    const mode = MODES.find(value => value === call.input.mode);
    if (mode === undefined || copy.mode === undefined || !copy.synced) return undefined;
    const proposal: Proposal = {family: 'mode-set', target: 'hub', data: {mode}, expectedRevision: copy.mode.revision};
    return {id, text: `Set the Hub mode to ${proposal.data.mode}?`, answer: null, kind: 'approval', call: call.id, proposal};
  }
  /** Why a command call was refused instead of proposed. */
  #proposalRefusal(call: ToolCall): string {
    const copy = this.#core();
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
    await this.#append(state.taskId, {role: 'tool', call: question.call, name: ASK_OWNER, result: state.decision, ok: true, effect: `${question.id}-answer`}, active.span.context);
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
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic');
    const tool = definition(call.name), permitted = tools.some(permittedTool => permittedTool.name === call.name);
    const id = `${state.taskId}-step-${String(state.step)}`;
    if (tool === undefined || !permitted || tool.effect !== 'read') {
      const reason = tool !== undefined && permitted && tool.effect === 'command' ? this.#proposalRefusal(call) : 'This tool is not permitted.';
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result: reason, ok: false, effect: `${id}-refused`}, active.span.context,
        current => {this.store.message(current, `${id}-refused`, 'tool', reason, this.context.clock.now());});
      return {step: state.step};
    }
    const result = await this.#call(state.taskId, state.step, 'tool', () => Promise.resolve({text: call.name === READ_FIXTURE ? FIXTURE_TEXT : call.name === READ_SESSIONS ? summarizeSessions(this.#core(), this.context.clock.now()) : fail('invalid-state'), units: 0}));
    await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result, ok: true, effect: id}, active.span.context);
    return {step: state.step + 1};
  }
  async #act(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const question = task.question ?? fail('invalid-state'), proposal = question.proposal ?? fail('invalid-state');
    const id = `${state.taskId}-step-${String(state.step)}`;
    if (state.decision !== 'approve') {
      await this.#append(state.taskId, {role: 'tool', call: question.call, name: SET_MODE, result: DECLINED, ok: false, effect: `${id}-declined`}, active.span.context,
        current => {this.store.message(current, `${id}-declined`, 'tool', DECLINED, this.context.clock.now());});
      return {step: state.step};
    }
    const permitted = this.#allowed.includes(SET_MODE), dispatch = this.options.dispatch;
    if (!permitted || dispatch === undefined) {
      await this.#append(state.taskId, {role: 'tool', call: question.call, name: SET_MODE, result: 'This tool is not permitted.', ok: false, effect: `${id}-refused`}, active.span.context,
        current => {this.store.message(current, `${id}-refused`, 'tool', 'This tool is not permitted.', this.context.clock.now());});
      return {step: state.step};
    }
    const result = await this.#call(state.taskId, state.step, 'tool', signal => dispatch({requestId: id, family: proposal.family, target: proposal.target,
      data: {mode: proposal.data.mode, expectedRevision: proposal.expectedRevision}}, active.span.context, signal).then(answer => {
      // The dispatcher's own uncertainty reaches the module as a rejection carrying `uncertain-result`; the fate is unknown either way.
      if (answer.status === 'uncertain' || (answer.status === 'rejected' && answer.error.error.code === 'uncertain-result')) throw new Fault('uncertain-result');
      const text = answer.status === 'accepted' ? `accepted: the core accepted mode-set ${proposal.data.mode} as operation ${id}; its outcome is tracked separately`
        : `refused: ${answer.error.error.code}`;
      return {text, units: 0};
    }));
    await this.#append(state.taskId, {role: 'tool', call: question.call, name: SET_MODE, result, ok: result.startsWith('accepted'), effect: id}, active.span.context);
    return {step: state.step + 1};
  }
  async #call(taskId: string, ordinal: number, kind: 'model' | 'tool', operation: (signal: AbortSignal) => Promise<{text: string; units: number | null}>): Promise<string> {
    const active = this.#activeFor(taskId);
    const id = `${taskId}-step-${String(ordinal)}`, saved = this.store.call(id);
    if (saved !== undefined) {
      if (saved.status !== 'succeeded' || saved.result === null) fail('uncertain-result');
      await this.#change(taskId, task => {this.#fence(active); task.nextOrdinal = Math.max(task.nextOrdinal, ordinal + 1);}, active.span.context);
      this.#fence(active); return saved.result;
    }
    const timeout = kind === 'model' ? LIMITS.modelMs : LIMITS.toolMs, units = kind === 'model' ? LIMITS.callUnits : 0;
    // A model reply carries the provider's own blocks for replay, so it may be larger than a tool result.
    const bound = kind === 'model' ? LIMITS.replyBytes : LIMITS.toolBytes;
    const span = startSpan(this.context.trace, kind === 'model' ? 'bunny.assistant.model' : 'bunny.assistant.tool', {parent: active.span.context,
      attributes: {'bunny.assistant.task_id': taskId, 'bunny.assistant.run_id': active.runId, 'bunny.assistant.effect_id': id}});
    const call: Call = {version: 1, id, taskId, runId: active.runId, ordinal, kind, status: 'admitted', result: null, units: null,
      reservedUnits: units, reservedMs: timeout, elapsedMs: null, traceparent: span.context.traceparent};
    const started = this.context.clock.now(); let replied = false;
    try {
      await this.#change(taskId, task => {
        this.#fence(active);
        task.activeMs += Math.max(0, started - active.accountedAt);
        if (task.nextOrdinal !== ordinal || task.activeMs + timeout > LIMITS.activeMs || task.reservedUnits + units > LIMITS.units ||
          (kind === 'model' ? task.modelCalls >= LIMITS.modelCalls : task.toolCalls >= LIMITS.toolCalls)) fail('capacity');
        if (kind === 'model') task.modelCalls += 1; else task.toolCalls += 1;
        task.activeMs += timeout; task.reservedUnits += units; this.store.saveCall(call);
      }, span.context);
      this.#fence(active);
      const reply = await this.#wait(active, timeout, bound, () => Promise.resolve().then(() => operation(active.controller.signal)), call);
      replied = true; this.#fence(active);
      if (typeof reply.text !== 'string' || textBytes(reply.text) > bound || (reply.units !== null && (!Number.isSafeInteger(reply.units) || reply.units < 0 || reply.units > units))) fail('capacity');
      const elapsed = Math.min(timeout, Math.max(0, this.context.clock.now() - started)); active.accountedAt = this.context.clock.now();
      await this.#change(taskId, task => {
        this.#fence(active); call.status = 'succeeded'; call.result = reply.text; call.units = reply.units; call.elapsedMs = elapsed;
        this.store.saveCall(call); task.activeMs -= timeout - elapsed;
        if (reply.units !== null) task.reservedUnits -= units - reply.units;
        task.nextOrdinal = ordinal + 1;
        if (kind === 'tool') this.store.message(task, id, 'tool', reply.text, this.context.clock.now());
      }, span.context);
      this.#fence(active); return reply.text;
    } catch (error) {
      active.accountedAt = this.context.clock.now();
      const admitted = this.store.call(id);
      // A definitive answer, such as a refusal, an error status or an oversized reply, settles the call; a lost answer, a
      // deadline or a cancellation leaves its fate unknown.
      const definitive = replied ? !(error instanceof Fault && error.code === 'cancelled') : error instanceof ProviderFault && !error.uncertain && error.code !== 'cancelled';
      if (admitted !== undefined && admitted.status === 'admitted') {
        try {await this.outbox.transaction(() => {admitted.status = definitive ? 'failed' : 'uncertain'; if (definitive) admitted.code = codeOf(error); this.store.saveCall(admitted);});} catch { /* Admission remains evidence of unknown fate. */ }
      }
      throw error;
    } finally {this.#log('assistant.call.settled', active, id); const receipt = this.store.call(id); span.end(receipt !== undefined && receipt.status !== 'succeeded' ? 'error' : 'unset');}
  }
  async #wait(active: Active, timeout: number, bound: number, operation: () => Promise<{text: string; units: number | null}>, call: Call): Promise<{text: string; units: number | null}> {
    let cancel: Cancel | undefined, stopped: (() => void) | undefined, settled = false;
    const deadline = new Promise<{text: string; units: number | null}>((_resolve, reject) => {
      stopped = () => {settled = true; reject(new Fault('cancelled'));};
      active.controller.signal.addEventListener('abort', stopped, {once: true});
      cancel = this.context.scheduler.after(timeout, () => {settled = true; reject(new Fault('uncertain-result')); active.controller.abort();});
    });
    try {
      this.#fence(active);
      const pending = operation().then(reply => {
        if (settled && !this.#closed && !this.context.signal.aborted && this.context.database().isOpen && typeof reply.text === 'string' && textBytes(reply.text) <= bound &&
          (reply.units === null || Number.isSafeInteger(reply.units) && reply.units >= 0 && reply.units <= call.reservedUnits)) {
          // Evidence only: no budget refund, task transition or graph continuation after the wait ended.
          void this.outbox.transaction(() => {const saved = this.store.call(call.id); if (saved !== undefined) {saved.result = reply.text; saved.units = reply.units; saved.status = 'succeeded'; this.store.saveCall(saved);}}).catch(() => {});
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
