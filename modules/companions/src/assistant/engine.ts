import {createHash, randomUUID} from 'node:crypto';
import {Annotation, Command as Resume, END, START, StateGraph, interrupt} from '@langchain/langgraph';
import {MessageValidator, errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {AssistantControl, AssistantInput, AssistantProfile, AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {fullDisk, startSpan, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type ModuleStagedUpload, type ModuleUploadRequest, type Outbox, type Reply, type Span, type Subscription, type TraceContext} from '@jimmie-potts/sdk';
import {CheckpointCapacityError, SqliteCheckpointSaver} from './checkpointer.js';
import {AssistantStore, GRAPH_VERSION, LIMITS, terminal, type Call, type StagedInput, type Task} from './store.js';

export type ModelReply = {text: string; units: number | null};
/** One text function, not coding-worker dispatch or a provider registry. Only the fake implementation ships. */
export type AssistantOptions = {
  model?: (step: 'interpret' | 'compose', text: string, signal: AbortSignal) => Promise<ModelReply>;
  tool?: (signal: AbortSignal) => Promise<string>;
  available?: () => boolean;
};
class Fault extends Error {constructor(readonly code: ErrorCode) {super(code);}}
function fail(code: ErrorCode): never {throw new Fault(code);}
const codeOf = (error: unknown): ErrorCode => error instanceof Fault ? error.code : fullDisk(error) || error instanceof CheckpointCapacityError ? 'capacity' : 'internal';
const profiles: readonly AssistantProfile[] = ['bunny', 'reachy', 'microduck'];
const profile = (value: unknown): value is AssistantProfile => typeof value === 'string' && profiles.includes(value as AssistantProfile);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const textBytes = (value: string): number => Buffer.byteLength(value, 'utf8');
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const assistantStateDraft = (data: AssistantState) => ({kind: 'state' as const, type: 'org.bunny.assistant-state.updated', subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-state/2.0', data});
const shape = Annotation.Root({taskId: Annotation<string>, interpretation: Annotation<string>, answer: Annotation<string>, fixture: Annotation<string>, result: Annotation<string>});
type GraphState = typeof shape.State;
type Active = {taskId: string; runId: string; generation: number; controller: AbortController; span: Span; accountedAt: number; deadline?: Cancel; work: Promise<void>};

/** The graph and all external waits belong to one companions activation. Startup only reads saved state. */
export class AssistantEngine {
  readonly store: AssistantStore;
  readonly #validator = new MessageValidator();
  readonly #subscriptions: Subscription[] = [];
  readonly #graph;
  #active: Active | undefined;
  #closed = false;
  #recoveryUnavailable = false;
  readonly #model: NonNullable<AssistantOptions['model']>;
  readonly #tool: NonNullable<AssistantOptions['tool']>;
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly options: AssistantOptions = {}) {
    this.store = new AssistantStore(context.database()); registerCoreFamilies(this.#validator);
    this.#model = options.model ?? ((_step, text) => Promise.resolve({text: `Synthetic result: ${text}`, units: Math.ceil(textBytes(text) / 4)}));
    this.#tool = options.tool ?? (() => Promise.resolve('Read-only fixture: blue is the selected synthetic sample.'));
    this.#graph = new StateGraph(shape)
      .addNode('interpret', async state => ({interpretation: await this.#call(state.taskId, 0, 'model', 'interpret', this.#task(state.taskId).prompt)}))
      .addNode('clarify', state => ({answer: interrupt<{id: string; text: string}, string>({id: `${state.taskId}-q1`, text: 'Which detail should the synthetic result emphasize?'})}))
      .addNode('read', async state => ({fixture: await this.#call(state.taskId, 1, 'tool', 'compose', '')}))
      .addNode('compose', async state => ({result: await this.#call(state.taskId, 2, 'model', 'compose', `${state.answer}\n${state.fixture}`)}))
      .addEdge(START, 'interpret').addEdge('interpret', 'clarify').addEdge('clarify', 'read').addEdge('read', 'compose').addEdge('compose', END)
      .compile({checkpointer: new SqliteCheckpointSaver(context.database())});
  }
  available(): boolean {
    // LangChain can install global content exporters from environment flags. This slice never opts into them.
    const tracing = ['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_VERBOSE'];
    return !this.#closed && !this.#recoveryUnavailable && !this.context.signal.aborted && this.options.available?.() !== false &&
      tracing.every(key => !['true', '1'].includes(process.env[key]?.toLowerCase() ?? ''));
  }
  inspect(): AssistantState {return {id: 'assistant', ...this.store.meta(), available: this.available(), tasks: this.store.latest().map(task => this.store.summary(task))};}
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
    if (this.store.calls(task.id).some(call => call.status !== 'succeeded')) fail('uncertain-result');
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
          data: {requestId: command.data.requestId, result: 'succeeded', evidence: 'observed'}}, {parent: command});
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
  #config(taskId: string) {return {configurable: {thread_id: taskId}, durability: 'sync' as const, recursionLimit: 12, callbacks: []};}
  #finishRecoveredRun(task: Task): void {
    const run = task.runId === null ? undefined : this.store.run(task.runId);
    if (run !== undefined && run.endedAtMs === null) {run.status = task.status; run.endedAtMs = this.context.clock.now(); this.store.saveRun(run);}
  }
  #recoverUnavailable(taskId: string): Promise<void> {
    const traceparent = this.#task(taskId).traceparent;
    return this.#change(taskId, task => {
      const unresolved = this.store.calls(taskId).some(call => call.status !== 'succeeded');
      task.status = unresolved ? 'uncertain' : 'paused'; task.code = unresolved ? 'uncertain-result' : 'unavailable';
      this.#finishRecoveredRun(task);
    }, traceparent === null ? undefined : {traceparent});
  }
  async #reconcile(taskId: string, startup: boolean, active?: Active): Promise<void> {
    const snapshot = await this.#graph.getState(this.#config(taskId));
    const values = snapshot.values as Partial<GraphState>;
    const traceparent = this.#task(taskId).traceparent;
    const publication = this.#change(taskId, task => {
      if (terminal(task.status)) return;
      const unresolved = this.store.calls(taskId).some(call => call.status !== 'succeeded');
      if (unresolved) {task.status = 'uncertain'; task.code = 'uncertain-result';}
      else if (snapshot.next.length === 0 && typeof values.result === 'string') {
        task.status = 'succeeded'; task.code = null; this.store.message(task, `${task.id}-result`, 'assistant', values.result, this.context.clock.now());
      } else if (snapshot.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0)) {
        if (task.question === null) {
          if (task.questions >= LIMITS.questions) fail('capacity');
          task.questions += 1; task.question = {id: `${task.id}-q1`, text: 'Which detail should the synthetic result emphasize?', answer: null};
          this.store.message(task, task.question.id, 'assistant', task.question.text, this.context.clock.now());
        }
        task.status = task.question.answer === null ? 'waiting' : 'paused'; task.code = null;
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
        ? new Resume<unknown, Partial<GraphState>, 'interpret' | 'compose' | '__start__' | 'clarify' | 'read'>({resume: task.question.answer}) : snapshot.createdAt === undefined ? {taskId: task.id} : null;
      await this.#graph.invoke(input, config); this.#fence(active);
      await this.#reconcile(task.id, false, active);
    } catch (error) {
      const code = codeOf(error);
      try {await this.#change(active.taskId, task => {
        if (terminal(task.status)) {this.#settle(task, active); return;}
        const unknown = this.store.calls(task.id).some(call => call.status !== 'succeeded');
        task.status = unknown ? 'uncertain' : code === 'cancelled' ? 'paused' : 'failed';
        task.code = unknown ? 'uncertain-result' : code; this.#settle(task, active);
      }, active.span.context);} catch { /* Failed durability is not reported as saved; startup reconciles checkpoints and receipts. */ }
    } finally {
      active.deadline?.();
      this.#log('assistant.run.settled', active); active.span.end(this.#task(active.taskId).code === null ? 'unset' : 'error'); this.context.signal.removeEventListener('abort', abort);
      if (this.#active === active) this.#active = undefined;
    }
  }
  async #call(taskId: string, ordinal: number, kind: 'model' | 'tool', step: 'interpret' | 'compose', text: string): Promise<string> {
    const active = this.#active; if (active === undefined || active.taskId !== taskId) return fail('invalid-state');
    this.#fence(active);
    const id = `${taskId}-step-${String(ordinal)}`, saved = this.store.call(id);
    if (saved !== undefined) {
      if (saved.status !== 'succeeded' || saved.result === null) fail('uncertain-result');
      await this.#change(taskId, task => {this.#fence(active); task.nextOrdinal = Math.max(task.nextOrdinal, ordinal + 1);}, active.span.context);
      this.#fence(active); return saved.result;
    }
    const timeout = kind === 'model' ? LIMITS.modelMs : LIMITS.toolMs, units = kind === 'model' ? LIMITS.callUnits : 0;
    const span = startSpan(this.context.trace, kind === 'model' ? 'bunny.assistant.model' : 'bunny.assistant.tool', {parent: active.span.context,
      attributes: {'bunny.assistant.task_id': taskId, 'bunny.assistant.run_id': active.runId, 'bunny.assistant.effect_id': id}});
    const call: Call = {version: 1, id, taskId, runId: active.runId, ordinal, kind, status: 'admitted', result: null, units: null,
      reservedUnits: units, reservedMs: timeout, elapsedMs: null, traceparent: span.context.traceparent};
    const started = this.context.clock.now();
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
      const reply = await this.#wait(active, timeout, () => kind === 'model' ? this.#model(step, text, active.controller.signal) : this.#tool(active.controller.signal).then(text => ({text, units: 0})), call);
      this.#fence(active);
      if (typeof reply.text !== 'string' || textBytes(reply.text) > LIMITS.toolBytes || (reply.units !== null && (!Number.isSafeInteger(reply.units) || reply.units < 0 || reply.units > units))) fail('capacity');
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
      if (admitted !== undefined && admitted.status === 'admitted') {
        try {await this.outbox.transaction(() => {admitted.status = 'uncertain'; this.store.saveCall(admitted);});} catch { /* Admission remains evidence of unknown fate. */ }
      }
      throw error;
    } finally {this.#log('assistant.call.settled', active, id); const receipt = this.store.call(id); span.end(receipt !== undefined && receipt.status !== 'succeeded' ? 'error' : 'unset');}
  }
  async #wait(active: Active, timeout: number, operation: () => Promise<ModelReply>, call: Call): Promise<ModelReply> {
    let cancel: Cancel | undefined, stopped: (() => void) | undefined, settled = false;
    const deadline = new Promise<ModelReply>((_resolve, reject) => {
      stopped = () => {settled = true; reject(new Fault('cancelled'));};
      active.controller.signal.addEventListener('abort', stopped, {once: true});
      cancel = this.context.scheduler.after(timeout, () => {settled = true; reject(new Fault('uncertain-result')); active.controller.abort();});
    });
    try {
      this.#fence(active);
      const pending = operation().then(reply => {
        if (settled && !this.#closed && !this.context.signal.aborted && this.context.database().isOpen && typeof reply.text === 'string' && textBytes(reply.text) <= LIMITS.toolBytes &&
          (reply.units === null || Number.isSafeInteger(reply.units) && reply.units >= 0 && reply.units <= call.reservedUnits)) {
          // Evidence only: no budget refund, task transition or graph continuation after the wait ended.
          void this.outbox.transaction(() => {const saved = this.store.call(call.id); if (saved !== undefined) {saved.result = reply.text; saved.units = reply.units; saved.status = 'succeeded'; this.store.saveCall(saved);}}).catch(() => {});
        }
        return reply;
      });
      return await Promise.race([pending, deadline]);
    } finally {settled = true; cancel?.(); if (stopped !== undefined) active.controller.signal.removeEventListener('abort', stopped);}
  }
  #log(event: string, active: Active, effectId?: string): void {
    try {
      const task = this.#task(active.taskId), call = effectId === undefined ? undefined : this.store.call(effectId);
      const code = call !== undefined && call.status !== 'succeeded' ? 'uncertain-result' : task.code;
      const outcome = event === 'assistant.run.started' ? 'accepted' : call !== undefined ? call.status === 'succeeded' ? 'succeeded' : 'uncertain'
        : ['waiting', 'paused', 'running'].includes(task.status) ? 'partial' : task.status;
      const level = code === 'internal' ? 'error' : code === null || code === 'cancelled' ? 'info' : 'warn';
      this.context.log[level](event, {'bunny.assistant.task_id': active.taskId, 'bunny.assistant.run_id': active.runId,
        'bunny.outcome': outcome, ...(effectId === undefined ? {} : {'bunny.assistant.effect_id': effectId}),
        ...(code === null ? {} : {'bunny.code': code})}, active.span.context);
    } catch { /* Diagnostics do not decide task outcomes. */ }
  }
}
