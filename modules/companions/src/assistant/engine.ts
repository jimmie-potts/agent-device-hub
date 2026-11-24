import {SHOW_SAVE_WINDOW_MS} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {createHash, randomUUID} from 'node:crypto';
import {Annotation, Command as Resume, END, GraphRecursionError, StateGraph, interrupt} from '@langchain/langgraph';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {ASSISTANT_LEGACY_TOOL_LIMIT, ASSISTANT_WEMO_OWNER, type AssistantControl, type AssistantDeviceOwner, type AssistantDispatch, type AssistantInput, type AssistantProfile, type AssistantQueueSummary, type AssistantState} from '@jimmie-potts/event-contracts/v2/assistant';
import {SPOKEN_REPLY_TTL_MS, type SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {fullDisk, startSpan, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type ModuleStagedUpload, type ModuleUploadRequest, type Outbox, type Reply, type RequestResult, type Span, type Subscription, type TraceContext, recordLog, type LogEvent, Outcome} from '@jimmie-potts/sdk';
import {actionDescription, closingReply, type ActionEvidence} from './closing-reply.js';
import {CONFIRMATION_LIFETIME_MS, IN_TURN_CONFIRMATION_MS, confirmationTarget, followConfirmation, pending, type Confirmation} from './confirmation.js';
import {CheckpointCapacityError, SqliteCheckpointSaver} from './checkpointer.js';
import {AssistantStore, GRAPH_VERSION, LIMITS, terminal, unresolved, type Appended, type Call, type Question, type StagedInput, type Task} from './store.js';
import type {ContextPreview, ConversationList, Proposal} from './history-contract.js';
import {ProviderFault, textBytes, type ModelProvider, type PromptContext, type ToolCall, type TurnInput, type TurnReply} from './provider.js';
import {buildContext, type ContextEntry} from './context.js';
import {BUILT_IN_PRICES_AS_OF, inputBound, SpendLedger, type PriceTable, type SpendView, type TokenUsage} from './spend.js';
import {PROFILES, spokenAloud} from '../knowledge/model.js';
import type {ActivePreference} from '../preferences/model.js';
import {ConversationActions, type RetainedArtworkRead} from './catalog-actions.js';
import {catalogCommand, catalogTool, isCatalogTool} from './catalog-tools.js';
import {SyntheticProvider} from './synthetic.js';
import {changesOf, observationDraft, observationOf, titleObservationOf} from './sessions.js';
import {ConversationTitles, ownerTitle, type TitleEvent, type TitleProvider} from './titles.js';
import {chooseDevice, deviceLabel, deviceProposal, deviceProposalText, readDevices} from './devices.js';
import {ASK_OWNER, BRIEF_BYTES, DELEGATE_CODING, definition, deviceToolOwner, FIXTURE_TEXT, MODES, permittedTools, READ_FIXTURE, READ_SESSIONS, REPOSITORY, SET_MODE, SET_LIFX_POWER, SET_LIFX_BRIGHTNESS, SET_WEMO_POWER, summarizeSessions, type CoreCopy} from './tools.js';

export type {ModelProvider, TurnInput, TurnReply, TranscriptItem} from './provider.js';
/** Sends one approved command through the core's tracked dispatcher; the module binds it to its own participant. */
export type Dispatch = (data: AssistantDispatch, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult>;
/**
 * What the module gives the engine (Hub #46, #507): the configured provider, which every profile uses (Hub #2026), or
 * the synthetic one without it, the allowlisted tool names, the synced copy of the core for reads and proposals, the dispatch path for approved commands,
 * and the owner's currently active explicit preferences, read at each model call (none without the seam).
 */
export type AssistantOptions = {
  provider?: ModelProvider;
  retainedArtwork?: RetainedArtworkRead;
  tools?: readonly string[];
  core?: () => CoreCopy;
  dispatch?: Dispatch;
  devices?: (owner: AssistantDeviceOwner) => readonly DeviceRecord[] | undefined;
  readDevice?: (owner: AssistantDeviceOwner, name: unknown, signal: AbortSignal, parent: TraceContext) => Promise<string | undefined>;
  available?: () => boolean;
  preferences?: () => readonly ActivePreference[];
  /** The owner's active knowledge notes, read at each model call; a companion's context holds them once the owner turns them on for it (Hub #2029). */
  knowledge?: () => readonly ContextEntry[];
  /**
   * Offers a saved assistant message to the speech coordinator, once per key: the message that ended a turn, or a replay
   * the owner asked for (Hub #500). `line` is the message's conversation, which keeps one waiting reply (Hub #2027).
   */
  speak?: (reply: SpokenReply, key: string, parent: TraceContext, line: string) => void;
  /**
   * Whether a coding worker is connected and the revision a delegation proposal binds to (Hub #502), which moves only
   * when the worker's endpoint does (Hub #2028). The profile names the companion whose slot the hand-off would use.
   */
  coding?: (profile: AssistantProfile) => {available: boolean; endpointId: string | null; revision: number};
  /** Hands an approved delegation to the core's tracked dispatcher; the worker's result comes back through `deliver`. */
  delegate?: Delegate;
  /**
   * Whether the module already sent a hand-off that answered `waiting` (Hub #2028), so a hand-off sent before its waiting
   * line is saved reads "Delegated to ..." at once.
   */
  handedOff?: (requestId: string) => boolean;
  /** The owner cancelled a task whose delegation is still running; the module asks the worker to stop. */
  onCancelled?: (taskId: string) => void;
  /** The private section's prices per model for the spend ledger (Hub #2024); they override the built-in table (Hub #2047). */
  prices?: PriceTable;
  /** The time zone whose local day and month the spend limits use: the runtime host's own unless a test names one. */
  timeZone?: string;
  /**
   * The configured title provider (Hub #2025), which titles every profile's conversations (Hub #2026). Without one, as
   * on the synthetic provider, no profile makes a title call and each keeps its persona name.
   */
  titleProvider?: TitleProvider;
  /** A test's or harness's title provider for every profile that has none, such as the fixed `SyntheticTitleProvider`. */
  syntheticTitleProvider?: TitleProvider;
  /**
   * A test's or harness's model provider for one profile, in place of `provider`. The private section never sets it:
   * every profile uses the configured provider, or the labelled synthetic one without it.
   */
  profileProviders?: Partial<Readonly<Record<AssistantProfile, ModelProvider>>>;
};
/**
 * An approved delegation as the module dispatches it, bound to the coding worker revision the proposal saw and tagged
 * with the companion whose slot it needs (Hub #2028).
 */
export type Delegation = {requestId: string; taskId: string; companion: AssistantProfile; repository: string; brief: string; expectedRevision: number};
/** The core's answer for a hand-off sent now, or `waiting` when the companion's slot is busy and it waits for it (Hub #2028). */
export type Delegate = (data: Delegation, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult | {status: 'waiting'; requestId: string}>;
/** An engine refusal; `closingReason` is fixed text for the owner, such as the spend limit a new turn met. */
class Fault extends Error {constructor(readonly code: ErrorCode, readonly closingReason?: string) {super(code);}}
/** What one call answered: its text, its reported usage total, and a paid provider's usage by price class. */
type Answer = {text: string; units: number | null; usage?: TokenUsage | null; evidence?: ActionEvidence[]; confirmation?: Confirmation};
/** What a call may use: the units it reserves, their name in a limit message, and a paid model call's spend reservation. */
type Budget = {units: number; unit: string; spend?: {model: string; inputUnits: number; outputUnits: number}};
function fail(code: ErrorCode): never {throw new Fault(code);}
const codeOf = (error: unknown): ErrorCode => error instanceof Fault || error instanceof ProviderFault ? error.code : fullDisk(error) || error instanceof CheckpointCapacityError ? 'capacity' : 'internal';
function closingReasonOf(error: unknown): string | undefined {
  if (error instanceof Fault) return error.closingReason;
  if (error instanceof CheckpointCapacityError) return 'The saved turn state exceeded its size limit.';
  if (error instanceof GraphRecursionError) return 'This turn reached its step limit.';
  if (fullDisk(error)) return 'There was no space left to save the turn.';
  if (error instanceof ProviderFault) {
    if (error.closingReason !== undefined) return error.closingReason;
    if (error.sizeLimit === 'request') return 'The provider rejected the request because it was too large.';
    if (error.sizeLimit === 'response') return 'The provider response exceeded its size limit.';
    if (error.code === 'too-large') return 'The provider reported a size limit.';
    if (error.code === 'invalid-message') return 'The provider returned an invalid response.';
    if (error.code === 'invalid-request') return 'The provider rejected the request as invalid.';
    if (error.code === 'forbidden') return 'The provider refused access to this request.';
    if (error.code === 'not-found') return 'The provider could not find the requested resource.';
  }
  return undefined;
}
const profiles: readonly AssistantProfile[] = ['bunny', 'reachy', 'microduck'];
const profile = (value: unknown): value is AssistantProfile => typeof value === 'string' && profiles.includes(value as AssistantProfile);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A queued message's ID: the request ID that queued it, as the blocks define one. */
const QUEUED_ID = /^[A-Za-z0-9_.-]{1,128}$/u;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** The tool an approved proposal runs, by its tool identifier. */
const proposalTool = (proposal: Proposal): string => proposal.family === 'mode-set' ? SET_MODE : proposal.family === 'coding-dispatch' ? DELEGATE_CODING :
  proposal.family === 'catalog-action' ? catalogTool(proposal.command) : 'owner' in proposal ? SET_WEMO_POWER : proposal.family === 'power-set' ? SET_LIFX_POWER : SET_LIFX_BRIGHTNESS;
/** A coding hand-off's outcome as the first word of the worker's final word names it (see `describeResult`), never its text. */
const handOffOutcome = (text: string): 'completed' | 'failed' | 'cancelled' | 'uncertain' | 'unknown' => {
  const word = /^[a-z]+/u.exec(text)?.[0];
  return word === 'completed' || word === 'failed' || word === 'cancelled' || word === 'uncertain' ? word : 'unknown';
};
/**
 * The state's version: 2.3 while a queue holds more messages than its limit, which only steers a stopped turn returned
 * can do (Hub #2031), 2.2 while a conversation's queue holds messages (Hub #2030), else 2.1 for the full tool list, else 2.0.
 */
export const assistantStateDraft = (data: AssistantState) => ({kind: 'state' as const, type: 'org.bunny.assistant-state.updated', subject: 'assistant',
  dataschema: `https://bunny.invalid/events/assistant-state/${data.queues?.some(queue => queue.messages > LIMITS.queuedMessages) === true ? '2.3'
    : data.queues !== undefined ? '2.2' : data.tools.length > ASSISTANT_LEGACY_TOOL_LIMIT ? '2.1' : '2.0'}`, data});
export const INSTRUCTIONS = 'Answer the owner briefly and truthfully from the evidence the tools return.';
/** The start of the tool result for a hand-off that waits for its companion's busy slot (Hub #2028). */
export const WAITING_RECEIPT = 'accepted: the coding worker is busy, so this hand-off waits for';
/** How a waiting hand-off is worded in the conversation until it is sent; "Delegated to ..." replaces it then. */
export const WAITING_PREFIX = 'Waiting to delegate';
const waitingText = (delegated: string): string => `${WAITING_PREFIX}${delegated.slice('Delegated'.length)}`.slice(0, 1024);
export const DECLINED = 'The owner declined the proposal; nothing was changed.';
export const REFUSED = 'The model declined this request.';
/** Why a Speak request is refused for a profile whose audio is not speech, as MicroDuck's is quacks only (Hub #2026). */
export const UNSPOKEN = 'This companion\'s audio is not speech, so its text is its intended meaning and is never read aloud.';
/** What a conversation reads when its saved progress could not be restored at a start (Hub #2027); once per failed start. */
export const RECOVERY_FAILED = 'This conversation\'s saved progress couldn\'t be restored when B.U.N.N.Y. started. You can cancel the task, but new messages here can\'t be sent until B.U.N.N.Y. restarts, which tries the recovery again.';
/**
 * Why a message is not queued when its conversation's queue is full (Hub #2030). Steers a stopped turn returned may take
 * the queue past its limit (Hub #2031), and a new message waits until it is below the limit again.
 */
export const QUEUE_FULL = `This conversation's queue holds its limit of ${String(LIMITS.queuedMessages)} messages or more. Withdraw one or wait for one to start.`;
/** Why a steer is refused when its task holds as many unread steers as it may, or they and the queue fill its bound (Hub #2031). */
export const STEERS_FULL = 'This task holds as many unread messages as it can take now. Wait for it to read them at its next step, or withdraw a queued message.';
/** The tool result a clarification the owner skipped answers with (Hub #2031): the owner's new message follows it. */
export const SKIPPED = 'The owner skipped this question and sent a new message instead; it follows.';
type Next = 'ask' | 'tool' | 'approve' | 'await' | 'turn' | 'end';
const shape = Annotation.Root({taskId: Annotation<string>, step: Annotation<number>, next: Annotation<Next>, decision: Annotation<string>, result: Annotation<string>});
type GraphState = typeof shape.State;
type Active = {taskId: string; conversationId: string; runId: string; generation: number; controller: AbortController; span: Span; accountedAt: number; deadline?: Cancel; stopReason?: string; work: Promise<void>};
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
  readonly titles: ConversationTitles;
  readonly #validator = coreValidator();
  readonly #subscriptions: Subscription[] = [];
  readonly #graph;
  /**
   * Each conversation's running task (Hub #2027): one graph invocation per conversation, all on the module's one
   * connection. Keyed by conversation, not by profile, so another conversation can join without a new slot.
   */
  readonly #active = new Map<string, Active>();
  /**
   * A conversation's task started while its previous run still settles, such as a queued message that started in the
   * commit that ended the task before it (Hub #2030): it launches once that run lets go of the conversation's slot.
   */
  readonly #deferred = new Map<string, string>();
  #closed = false;
  readonly #confirmationWatches = new Map<string, Promise<void>>();
  readonly #confirmationsStopped = new AbortController();
  /**
   * Conversations whose startup recovery failed (Hub #2027). Each stays unavailable until the next start, so no run,
   * answer or new task proceeds on state the engine could not read; other conversations keep working.
   */
  readonly #unrecovered = new Set<string>();
  /** While startup reconciles saved tasks: a task it finds finished starts no title check, as a start starts no work. */
  #starting = false;
  readonly #synthetic = new SyntheticProvider();
  readonly #allowed: readonly string[];
  constructor(readonly context: ModuleContext, readonly outbox: Outbox, readonly options: AssistantOptions = {}) {
    this.store = new AssistantStore(context.database());
    this.spend = new SpendLedger(context.database(), options.prices ?? {}, () => context.clock.now(), options.timeZone);
    this.titles = new ConversationTitles(context.database(), {outbox, spend: this.spend, now: () => context.clock.now(), after: (ms, callback) => context.scheduler.after(ms, callback),
      provider: () => options.titleProvider ?? options.syntheticTitleProvider,
      messages: conversationId => this.store.titleMessages(conversationId), reported: conversationId => this.store.report(conversationId).sequence > 0,
      metadata: (conversationId, title, observedAtMs) => observationDraft(titleObservationOf(conversationId, title, observedAtMs))});
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
      // A steer that reached the task while its model was about to finish takes the model node once more (Hub #2031).
      .addConditionalEdges('turn', state => state.next, {ask: 'ask', tool: 'tool', approve: 'approve', turn: 'turn', end: END})
      .addEdge('ask', 'answered').addEdge('answered', 'turn').addEdge('tool', 'turn').addEdge('approve', 'act')
      // An approved delegation waits for the worker's word before the next turn; every other act goes straight back to the model.
      .addConditionalEdges('act', state => state.next === 'await' ? 'await' : 'turn', {await: 'await', turn: 'turn'})
      .addEdge('await', 'delivered').addEdge('delivered', 'turn')
      .compile({checkpointer: new SqliteCheckpointSaver(context.database())});
  }
  available(): boolean {
    // LangChain can install global content exporters from environment flags. This slice never opts into them.
    const tracing = ['LANGCHAIN_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_VERBOSE'];
    return !this.#closed && !this.context.signal.aborted && this.options.available?.() !== false &&
      tracing.every(key => !['true', '1'].includes(process.env[key]?.toLowerCase() ?? ''));
  }
  /**
   * The provider a profile's turns use (Hub #2026): a harness's provider for the profile, else the configured one, which
   * serves B.U.N.N.Y., Reachy and MicroDuck alike with each one's curated persona, else the labelled synthetic one.
   */
  provider(profile: AssistantProfile = 'bunny'): ModelProvider {
    return this.options.profileProviders?.[profile] ?? this.options.provider ?? this.#synthetic;
  }
  inspect(): AssistantState {
    const provider = this.provider();
    const queues = this.#queues();
    return {id: 'assistant', ...this.store.meta(), available: this.available(), provider: provider.name, model: provider.model, tools: [...this.#allowed],
      tasks: this.store.latest().map(task => this.store.summary(task)), ...(queues.length === 0 ? {} : {queues})};
  }
  /** Each profile's current conversation whose queue holds messages (Hub #2030): how many, and whether and why it is held. */
  #queues(): AssistantQueueSummary[] {
    return profiles.flatMap(owner => {
      const conversationId = this.store.conversation(owner), messages = conversationId === undefined ? 0 : this.store.queue.count(conversationId);
      if (conversationId === undefined || messages === 0) return [];
      const hold = this.store.queue.hold(conversationId);
      return [{conversationId, profile: owner, messages, held: hold?.reason ?? null, code: hold?.code ?? null}];
    });
  }
  async start(): Promise<void> {
    // Each conversation's unfinished task is reconciled on its own and none is run. A failed recovery makes only its own
    // conversation unavailable until the next start, and that conversation says so.
    this.store.restarted();
    // A task saved under the graph before Hub #2031 continues under this one: the graph only gained an edge.
    this.store.upgradeGraph();
    this.#starting = true;
    try {
      for (const task of this.store.unfinished()) {
        try {
          if (task.graphVersion !== GRAPH_VERSION || !this.available()) await this.#recoverUnavailable(task.id);
          else await this.#reconcile(task.id, true);
        } catch (error) {
          this.#unrecovered.add(task.conversationId);
          try {await this.#recoverUnavailable(task.id, closingReasonOf(error), true);} catch { /* A failed write cannot claim a saved transition. */ }
        }
      }
      // A queue counts as changed wherever its conversation changed at the start (Hub #2030), and a queue the start held
      // changed at the start: a revision records it, so a queue command read before is stale.
      this.store.queue.aligned();
      if (this.store.queue.changed()) await this.outbox.transaction(add => {this.#publish(add);});
    } finally {this.#starting = false;}
    for (const watch of this.store.confirmations()) void this.#followConfirmation(watch);
    this.#subscriptions.push(await this.context.sdk.respond<AssistantControl>('bunny.cmd.assistant-control.assistant', command => this.#control(command)));
    this.#subscriptions.push(await this.context.sdk.respond<AssistantInput>('bunny.cmd.assistant-input.assistant', command => this.#input(command)));
  }
  async stop(): Promise<void> {
    this.#closed = true;
    this.#confirmationsStopped.abort();
    const active = [...this.#active.values()];
    for (const run of active) run.controller.abort();
    await this.titles.stop();
    await Promise.all(this.#subscriptions.map(subscription => subscription.close()));
    await Promise.all(active.map(run => run.work));
    await Promise.all(this.#confirmationWatches.values());
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
      const title = this.titles.published(task.conversationId, task.profile);
      for (const change of changes.events) {
        sequence += 1;
        const {key, draft} = observationDraft(observationOf(task, change, sequence, this.context.clock.now(), title));
        add(key, draft, parent === undefined ? {} : {parent});
      }
      this.store.saveReport(task.conversationId, {sequence, projection: changes.projection});
      this.titles.touched(task.conversationId);
    }
  }
  #change(id: string, change: (task: Task) => void, parent?: TraceContext, reason?: string): Promise<void> {
    let finished: Task | undefined, next: string | undefined;
    return this.outbox.transaction(add => {
      const task = this.#task(id), previous = task.status;
      change(task);
      if (previous !== task.status && (task.status === 'failed' || task.status === 'uncertain')) {
        const messageId = `${task.id}-closing-${String(task.generation)}`;
        const reply = this.#confirmationReply(task.id, messageId, closingReply(task, this.store.calls(id), reason));
        this.store.message(task, messageId, 'assistant', reply, this.context.clock.now());
      }
      this.store.save(task);
      // A task that ended starts the next queued message of its conversation in the same commit (Hub #2030), so the
      // session report states this turn's end before the next turn's start. Stop, a cancel, never ends a task here.
      // Steers the task never read go back to the head of the queue first (Hub #2031): the close decides, in this commit,
      // that a steer that reached the task after its last model call starts as the next queued message.
      if (!terminal(previous) && terminal(task.status)) {finished = task; this.#returnSteers(task); next = this.#dispatch(task.conversationId);}
      this.#publish(add, parent);
    }).then(() => {
      // A finished task asks the title model to check the conversation's title (Hub #2075), once its result is saved. The
      // queued message that started after it starts no check of its own.
      if (finished !== undefined) this.#checkTitle(finished, {kind: 'task', result: finished.status as 'succeeded' | 'failed' | 'cancelled'});
      if (next !== undefined && !this.#closed && !this.context.signal.aborted) this.#launch(next);
    });
  }
  /**
   * Asks the title model to check a conversation's title after a task finished or a major event (Hub #2075), beside the
   * task and after the commit that recorded the event; the check never delays, fails or rolls back the task.
   */
  #checkTitle(task: Pick<Task, 'conversationId' | 'profile'>, event: TitleEvent): void {
    if (!this.#closed && !this.#starting && !this.context.signal.aborted) void this.titles.check(task.conversationId, task.profile, event);
  }
  /**
   * Returns the task's unread steers to the head of its conversation's queue in the open transaction (Hub #2031), when
   * its turn closes or is stopped. Steers a start's reconciliation returns wait in a held queue: a start starts no work.
   */
  #returnSteers(task: Task): void {
    if (this.store.queue.returnSteers(task.id, this.context.clock.now()) === 0) return;
    if (this.#starting && this.store.queue.hold(task.conversationId) === null) this.store.queue.setHold(task.conversationId, {reason: 'restart', code: null, detail: null});
  }
  /**
   * How many more model calls the turn's limits leave room for (Hub #2031): its count of model calls, its active time at
   * a model call's deadline and its usage units at the least a call reserves, framing and output units.
   */
  #remainingCalls(task: Task): number {
    const calls = LIMITS.modelCalls - task.modelCalls, time = Math.floor((LIMITS.activeMs - task.activeMs) / LIMITS.modelMs);
    const units = Math.floor((LIMITS.units - task.reservedUnits) / (LIMITS.overheadUnits + LIMITS.outputUnits));
    return Math.max(0, Math.min(calls, time, units));
  }
  /** Records which result was visible when the reply committed, in the same transaction. */
  #confirmationReply(taskId: string, messageId: string, reply: string): string {
    const watches = this.store.confirmations(taskId);
    const updates: string[] = [];
    for (const watch of watches) {
      const update = watch.result ?? pending(watch);
      if (watch.result !== undefined) {
        for (const earlier of [pending(watch), pending({...watch, sent: true})]) {
          if (earlier !== update) reply = reply.replace(earlier, update);
        }
        this.store.dropConfirmation(watch.requestId);
      } else this.store.saveConfirmation({...watch, follows: watch.follows ?? messageId});
      if (!reply.includes(update)) updates.push(update);
    }
    return [reply, ...updates].filter(Boolean).join('\n\n');
  }

  #followConfirmation(watch: Confirmation): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const existing = this.#confirmationWatches.get(watch.requestId);
    if (existing !== undefined) return existing;
    const signal = this.#confirmationsStopped.signal;
    const run = followConfirmation(this.context, watch, signal, async evidence => {
      if (signal.aborted) return true;
      const known = this.store.confirmation(watch.requestId);
      if (known === undefined || known.result !== undefined) return true;
      if (evidence.result === undefined && (evidence.sent !== true || known.sent === true)) return false;
      await this.outbox.transaction(add => {
        const current = this.store.confirmation(watch.requestId);
        if (current === undefined || current.result !== undefined) return;
        if (evidence.result !== undefined && current.follows !== undefined) {
          const task = this.#task(current.taskId);
          if (this.store.savedMessage(task.id, current.follows) !== undefined) {
            this.store.message(task, `${current.requestId}-confirmation`, 'assistant', evidence.result, this.context.clock.now(), current.follows);
            this.store.touch(task.conversationId);
            this.#publish(add, {traceparent: current.traceparent});
          }
          this.store.dropConfirmation(current.requestId);
        } else this.store.saveConfirmation({...current, ...evidence});
      });
      return evidence.result !== undefined;
    }).catch(() => {
      // Leave the saved receipt for the next activation if the store cannot commit the observation.
    }).finally(() => {this.#confirmationWatches.delete(watch.requestId);});
    this.#confirmationWatches.set(watch.requestId, run);
    return run;
  }

  async #waitForConfirmation(watch: Confirmation, ms: number, signal: AbortSignal): Promise<void> {
    const following = this.#followConfirmation(watch);
    if (ms <= 0 || signal.aborted) return;
    let cancel: Cancel | undefined;
    let abort: (() => void) | undefined;
    try {
      await Promise.race([following, new Promise<void>(resolve => {
        cancel = this.context.scheduler.after(ms, resolve);
        abort = resolve;
        signal.addEventListener('abort', abort, {once: true});
      })]);
    } finally {
      cancel?.();
      if (abort !== undefined) signal.removeEventListener('abort', abort);
    }
  }

  #check(command: Command<object>): ErrorCode | undefined {
    if (this.#closed || this.context.signal.aborted) return 'unavailable';
    if (command.source !== 'bunny/core') return 'forbidden';
    if (command.subject !== 'assistant') return 'not-found';
    if (this.context.clock.now() - Date.parse(command.time) >= LIMITS.controlMs) return 'expired';
    const result = this.#validator.validate(command, {nowMs: this.context.clock.now()});
    return result.ok ? undefined : result.error.code;
  }
  /** An assistant-wide command, enable or disable, names the current assistant revision. */
  #revision(revision: number): void {if (revision !== this.store.meta().revision) fail('revision-conflict');}
  /**
   * A conversation's command is stale only when its own conversation changed after the revision it names, so another
   * conversation's step never refuses it (Hub #2027). A revision the assistant has not reached is refused too.
   */
  #conversationRevision(revision: number, conversationId: string | undefined): void {
    if (revision > this.store.meta().revision || (conversationId !== undefined && this.store.changedAt(conversationId) > revision)) fail('revision-conflict');
  }
  /**
   * A queue command, to queue, edit, withdraw, reorder or resume (Hub #2030), is stale only when the conversation's queue
   * changed after the revision it names, as the #2056 scopes are: the steps of the conversation's running task never
   * refuse it, while a message that started, moved or changed since does.
   */
  #queueRevision(revision: number, conversationId: string | undefined): void {
    if (revision > this.store.meta().revision || (conversationId !== undefined && this.store.queue.changedAt(conversationId) > revision)) fail('revision-conflict');
  }
  /**
   * Offers one durable assistant message to be spoken through the companions speech endpoint. Text over the browser driver's
   * bound stays on the page unspoken rather than cut; the coordinator decides availability, Quiet and one-at-a-time.
   */
  #speak(taskId: string, messageId: string, text: string, parent: TraceContext, key = messageId): void {
    if (this.options.speak === undefined || this.#closed || this.context.signal.aborted || text.trim() === '' || text.length > LIMITS.spokenChars) return;
    try {
      const task = this.#task(taskId);
      // A quacks-only persona's English text is its intended meaning, never spoken English (Hub #2026).
      if (!spokenAloud(task.profile)) return;
      this.options.speak({taskId, messageId, text, validUntilMs: this.context.clock.now() + SPOKEN_REPLY_TTL_MS}, key, parent, task.conversationId);
    }
    catch { /* Speech is an output of the saved message, never a condition of it. */ }
  }
  #ready(): void {if (!this.store.meta().enabled || !this.available()) fail('unavailable');}
  #activate(task: Task, parent: TraceContext, settling = false): void {
    this.#ready();
    if (this.#unrecovered.has(task.conversationId)) fail('unavailable');
    if (settling ? this.#busy(task.conversationId) : this.#active.has(task.conversationId)) fail('capacity');
    if (task.graphVersion !== GRAPH_VERSION || task.version !== 1) fail('unavailable');
    if (unresolved(this.store.calls(task.id))) fail('uncertain-result');
    if (task.activeMs >= LIMITS.activeMs || task.reservedUnits >= LIMITS.units) fail('capacity');
    const runId = randomUUID();
    this.store.saveRun({version: 1, id: runId, taskId: task.id, startedAtMs: this.context.clock.now(), endedAtMs: null,
      status: 'running', traceparent: parent.traceparent, previousTraceparent: task.traceparent});
    task.runId = runId; task.generation += 1; task.status = 'running'; task.code = null;
  }
  /** Whether the conversation's slot holds a run whose task has not ended; a run still settling an ended task does not count. */
  #busy(conversationId: string): boolean {
    const run = this.#active.get(conversationId);
    return run !== undefined && !terminal(this.store.task(run.taskId)?.status ?? 'succeeded');
  }
  /**
   * Starts the conversation's next queued message as a new task and turn in the open transaction (Hub #2030) when its
   * queue is not held and the conversation has no unfinished task, and removes it from the queue in the same commit, so
   * a crash can never leave it both started and queued. A start, the run's launch included, follows the module's own
   * rules for a new message: conversation on, the conversation recovered and room in the spend limits. A start the module
   * refuses holds the queue with the refusal's code and fixed reason, and the message stays queued; with `refuse`, the
   * owner's Resume queue or Start, the refusal is the command's and nothing changes. A start of the module starts nothing.
   * Returns the task to launch after the commit.
   */
  #dispatch(conversationId: string, refuse = false): string | undefined {
    if (this.#closed || this.#starting || this.context.signal.aborted) return undefined;
    const head = this.store.queue.messages(conversationId)[0];
    if (head === undefined || this.store.queue.hold(conversationId) !== null) return undefined;
    if (this.store.unfinishedIn(conversationId) !== undefined || this.#busy(conversationId)) return undefined;
    const refusal = this.#startRefusal(head.profile, conversationId);
    if (refusal !== undefined) {
      if (refuse) throw refusal;
      this.store.queue.setHold(conversationId, {reason: 'refused', code: refusal.code, detail: refusal.closingReason ?? null});
      return undefined;
    }
    const task = this.store.newTask(head.profile, head.text);
    this.store.message(task, `${task.id}-prompt`, 'owner', head.text, this.context.clock.now());
    this.#activate(task, {traceparent: head.traceparent}, true);
    this.store.save(task);
    this.store.queue.remove(head.id);
    return task.id;
  }
  /** Why the conversation's next message cannot start now, checked before anything is written, or undefined when it can. */
  #startRefusal(owner: AssistantProfile, conversationId: string): Fault | undefined {
    if (!this.store.meta().enabled || !this.available() || this.#unrecovered.has(conversationId)) return new Fault('unavailable');
    if (this.store.conversation(owner) !== conversationId) return new Fault('invalid-state');
    // A paid profile's message meets the spend limits as a new message does; synthetic turns cost nothing.
    const paid = this.provider(owner), reached = paid.name === 'synthetic' ? undefined : this.spend.reached(paid.model);
    return reached === undefined ? undefined : new Fault('capacity', reached);
  }
  async #admit<T extends {requestId: string}>(command: Command<T>, fingerprint: string, apply: (add: AddMessage) => string | undefined): Promise<Reply> {
    const refused = this.#check(command); if (refused !== undefined) return errorBody(refused);
    try {
      let launch: string | undefined;
      const reply = await this.outbox.transaction(add => {
        const previous = this.store.receipt(command.data.requestId);
        if (previous !== undefined) {if (previous !== fingerprint) fail('duplicate-conflict'); return {status: 'accepted'} as const;}
        launch = apply(add); this.store.remember(command.data.requestId, fingerprint); this.#publish(add, command);
        add(`bunny.event.${command.dataschema.includes('assistant-input') ? 'assistant-input' : 'assistant-control'}.assistant`, {
          kind: 'outcome', type: command.type.replace(/\.requested$/, '.completed'), subject: 'assistant', dataschema: 'https://bunny.invalid/events/outcome/2.0',
          data: {requestId: command.data.requestId, result: Outcome.succeeded, evidence: Outcome.observed}}, {parent: command});
        return {status: 'accepted'} as const;
      });
      if (launch !== undefined && !this.#closed && !this.context.signal.aborted) this.#launch(launch);
      return reply;
    } catch (error) {return errorBody(codeOf(error), {detail: error instanceof Fault && error.closingReason !== undefined ? error.closingReason : 'The assistant control was not saved.'});}
  }
  #control(command: Command<AssistantControl>): Promise<Reply> {
    let spoken: {id: string; text: string} | undefined, delegated = false, renamed: string | undefined, cancelled: Task | undefined;
    return this.#admit(command, digest(command.data), add => {
      const data = command.data, queued = data.action === 'withdraw' || data.action === 'reorder' || data.action === 'resume-queue';
      if (data.action === 'enable' || data.action === 'disable') this.#revision(data.expectedRevision);
      else if (!queued) this.#conversationRevision(data.expectedRevision, data.action === 'rename'
        ? data.profile === undefined ? undefined : this.store.conversation(data.profile)
        : data.taskId === undefined ? undefined : this.store.task(data.taskId)?.conversationId);
      if (data.action !== 'speak' && data.messageId !== undefined) fail('invalid-request');
      if (data.action !== 'reorder' && data.beforeId !== undefined) fail('invalid-request');
      if (!queued && data.queuedId !== undefined) fail('invalid-request');
      if (queued) return this.#queueControl(data);
      if (data.action === 'rename') {
        // The owner's title for a profile's conversation (Hub #2025): it replaces any generated title and drops one in flight.
        if (data.taskId !== undefined || data.profile === undefined || data.title === undefined) fail('invalid-request');
        const title = ownerTitle(data.title) ?? fail('invalid-request');
        renamed = this.store.ensureConversation(data.profile);
        this.store.touch(renamed);
        this.titles.rename(add, renamed, data.profile, title);
        return undefined;
      }
      if (data.profile !== undefined || data.title !== undefined) fail('invalid-request');
      if (data.action === 'enable' || data.action === 'disable') {
        if (data.taskId !== undefined) fail('invalid-request');
        if (data.action === 'enable' && !this.available()) fail('unavailable');
        // One switch serves every conversation, so any conversation's unfinished task refuses it (Hub #2027).
        if (data.action === 'disable' && this.store.unfinished().length > 0) fail('invalid-state');
        this.store.enable(data.action === 'enable'); return undefined;
      }
      if (data.action === 'speak') {
        // A replay reads the saved message; finished tasks qualify, so an old answer can be heard again, and only assistant text is spoken.
        const message = this.store.savedMessage(data.taskId ?? fail('invalid-request'), data.messageId ?? fail('invalid-request')) ?? fail('not-found');
        if (message.role !== 'assistant') fail('invalid-request');
        if (!spokenAloud(this.#task(data.taskId ?? fail('invalid-request')).profile)) throw new Fault('invalid-request', UNSPOKEN);
        spoken = message; return undefined;
      }
      const task = this.#task(data.taskId ?? fail('invalid-request'));
      if (terminal(task.status)) fail('invalid-state');
      if (data.action === 'cancel') {
        delegated = task.question?.kind === 'delegation' && task.question.answer === null;
        task.status = 'cancelled'; task.generation += 1; task.code = null; this.store.save(task); cancelled = task;
        // Stop returns the steers the task never read to the head of the queue, never dropping them (Hub #2031).
        this.#returnSteers(task);
        // Stop ends the task and holds the conversation's queue until the owner resumes it (Hub #2030, owner decision 5).
        if (this.store.queue.count(task.conversationId) > 0) this.store.queue.setHold(task.conversationId, {reason: 'stop', code: null, detail: null});
        for (const watch of this.store.confirmations(task.id)) {
          if (watch.follows === undefined) this.store.dropConfirmation(watch.requestId);
        }
        return undefined;
      }
      if (!['paused', 'uncertain', 'waiting'].includes(task.status) || (task.question !== null && task.question.answer === null)) fail('invalid-state');
      this.#activate(task, command); this.store.save(task); return task.id;
    }).then(reply => {
      if (renamed !== undefined && !('error' in reply)) this.titles.drop(renamed);
      const active = [...this.#active.values()].find(run => run.taskId === command.data.taskId);
      if (command.data.action === 'cancel' && !('error' in reply) && active !== undefined) active.controller.abort();
      // A cancelled task has finished, so the title model checks the conversation's title (Hub #2075).
      if (cancelled !== undefined && !('error' in reply)) this.#checkTitle(cancelled, {kind: 'task', result: 'cancelled'});
      if (command.data.action === 'cancel' && !('error' in reply) && delegated && command.data.taskId !== undefined) {try {this.options.onCancelled?.(command.data.taskId);} catch { /* the worker's own report settles it */ }}
      if (spoken !== undefined && !('error' in reply) && command.data.taskId !== undefined) this.#speak(command.data.taskId, spoken.id, spoken.text, command, `${spoken.id}:${command.data.requestId}`);
      return reply;
    });
  }
  /**
   * Withdraw, reorder and Resume queue (Hub #2030), on the queue of the profile's current conversation. Resume queue,
   * also the Start a restart asks for, releases a held queue and starts its next message now when the conversation has
   * no unfinished task; a start the module refuses refuses the command and leaves the queue held.
   */
  #queueControl(data: AssistantControl): string | undefined {
    if (data.profile === undefined || data.taskId !== undefined || data.title !== undefined) fail('invalid-request');
    const owner = data.profile, current = this.store.conversation(owner);
    if (data.action === 'resume-queue') {
      this.#queueRevision(data.expectedRevision, current);
      if (current === undefined) fail('not-found');
      if (data.queuedId !== undefined) fail('invalid-request');
      if (this.store.queue.hold(current) === null) fail('invalid-state');
      this.#ready();
      this.store.queue.setHold(current, null);
      return this.#dispatch(current, true);
    }
    const found = data.queuedId === undefined ? fail('invalid-request') : this.store.queue.message(data.queuedId);
    // A message left in an earlier conversation of the profile, by a release whose New conversation did not know the
    // queue, can only be withdrawn (see `view=queue` with a conversation ID).
    const message = found !== undefined && (found.conversationId === current || (data.action === 'withdraw' && this.store.owns(owner, found.conversationId))) ? found : undefined;
    this.#queueRevision(data.expectedRevision, message?.conversationId ?? current);
    if (message === undefined || current === undefined) fail('not-found');
    if (data.action === 'withdraw') {this.store.queue.remove(message.id); return undefined;}
    if (data.beforeId === undefined || data.beforeId === message.id) fail('invalid-request');
    if (data.beforeId !== null && this.store.queue.message(data.beforeId)?.conversationId !== current) fail('not-found');
    this.store.queue.move(message.id, data.beforeId);
    return undefined;
  }
  stage(request: ModuleUploadRequest): ModuleStagedUpload | ErrorBody {
    if (request.target !== 'assistant' || request.name !== 'input.json' || request.signal.aborted || request.bytes.byteLength > LIMITS.stageBytes) return errorBody('invalid-request');
    try {
      const value: unknown = JSON.parse(Buffer.from(request.bytes).toString('utf8'));
      // New conversation (Hub #2029) names its profile and the revision the page read, and nothing else. It runs no work,
      // so it is admitted while conversation is off, as a rename is.
      const fresh = object(value) && value.action === 'new-conversation';
      // Editing a queued message (Hub #2030) runs no work either, so it is admitted while conversation is off.
      if (!fresh && !(object(value) && value.action === 'edit-queued')) this.#ready();
      if (fresh && (Object.keys(value).some(key => !['action', 'profile', 'expectedRevision'].includes(key)) || !profile(value.profile) ||
        typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) fail('invalid-request');
      if (!fresh && (!object(value) || Object.keys(value).some(key => !['action', 'profile', 'text', 'expectedRevision', 'taskId', 'questionId', 'queuedId'].includes(key)) ||
        !profile(value.profile) || !['start', 'answer', 'queue', 'edit-queued', 'steer'].includes(String(value.action)) || typeof value.text !== 'string' || value.text.trim() === '' || textBytes(value.text) > LIMITS.inputBytes ||
        typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) fail('invalid-request');
      // A steer names the turn it expects (Hub #2031), and with a question the one it skips or declines.
      if (!fresh && (value.action === 'answer' ? typeof value.taskId !== 'string' || typeof value.questionId !== 'string' || value.queuedId !== undefined
        : value.action === 'steer' ? typeof value.taskId !== 'string' || !(value.questionId === undefined || typeof value.questionId === 'string') || value.queuedId !== undefined
          : value.action === 'edit-queued' ? value.taskId !== undefined || value.questionId !== undefined || typeof value.queuedId !== 'string' || !QUEUED_ID.test(value.queuedId)
            : value.taskId !== undefined || value.questionId !== undefined || value.queuedId !== undefined)) fail('invalid-request');
      const input = (fresh ? {...value, text: ''} : value) as StagedInput;
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
    let titled: {conversationId: string; profile: AssistantProfile; event: TitleEvent} | undefined;
    return this.#admit(command, digest(command.data), () => {
      const staged = this.store.input(command.data.inputRef) ?? fail('invalid-request');
      if (staged.input.action !== 'new-conversation' && staged.input.action !== 'edit-queued') this.#ready();
      if (staged.requestId !== command.data.requestId) fail('invalid-request');
      if (staged.expires <= this.context.clock.now()) fail('expired');
      const input = staged.input, now = this.context.clock.now();
      if (input.action === 'queue' || input.action === 'edit-queued') {
        this.#queueRevision(input.expectedRevision, this.store.conversation(input.profile));
        this.store.discard(staged.ref);
        if (input.action === 'edit-queued') {
          const message = input.queuedId === undefined ? undefined : this.store.queue.message(input.queuedId);
          if (message === undefined || message.conversationId !== this.store.conversation(input.profile)) fail('not-found');
          this.store.queue.edit(message.id, input.text, now);
          return undefined;
        }
        // Queue saves the owner's message for after the current task (Hub #2030), keyed by this request ID, so a repeat
        // queues nothing more. The command completes here: the message is the queue's state, not a stored command.
        const conversationId = this.store.ensureConversation(input.profile);
        if (this.#unrecovered.has(conversationId)) fail('unavailable');
        if (!this.store.queue.room(conversationId)) throw new Fault('capacity', QUEUE_FULL);
        this.store.queue.add({id: command.data.requestId, conversationId, profile: input.profile, text: input.text, queuedAtMs: now, updatedAtMs: now, traceparent: command.traceparent});
        // A queue with nothing to wait behind starts its message at once.
        return this.#dispatch(conversationId);
      }
      if (input.action === 'steer') {
        this.store.discard(staged.ref);
        const steered = this.#steer(input, command, now);
        if (steered.titled !== undefined) titled = steered.titled;
        return steered.launch;
      }
      this.#conversationRevision(input.expectedRevision, input.action === 'answer'
        ? input.taskId === undefined ? undefined : this.store.task(input.taskId)?.conversationId : this.store.conversation(input.profile));
      if (input.action === 'new-conversation') {
        // One unfinished task per profile (Hub #2029, owner decision): New conversation is refused while the current
        // conversation's task is unfinished, whether it runs, waits on an answer, an approval or the coding worker, is
        // paused or is uncertain. The owner finishes or cancels it first.
        const current = this.store.conversation(input.profile);
        if (current !== undefined && (this.store.unfinishedIn(current) !== undefined || this.#active.has(current))) fail('invalid-state');
        // Queued messages belong to the current conversation (Hub #2030), so New conversation waits until they start or the
        // owner withdraws them, as it waits for an unfinished task.
        if (current !== undefined && this.store.queue.count(current) > 0) fail('invalid-state');
        // An empty conversation, or none yet, has nothing to leave behind, so repeated requests cannot pile up empty ones.
        if (current === undefined || this.store.lastSequence(current) === 0) fail('invalid-state');
        const {previous, conversationId} = this.store.newConversation(input.profile);
        // Both conversations change: a command bound to the earlier one's revision is stale now, as is one naming the profile.
        if (previous !== undefined) {this.store.touch(previous); this.store.queue.touch(previous);}
        // Both queues change too (Hub #2030): a Queue naming the revision read before is stale, as a Send is.
        this.store.touch(conversationId); this.store.queue.touch(conversationId);
        this.store.discard(staged.ref);
        return undefined;
      }
      let task: Task;
      if (input.action === 'start') {
        // Each conversation runs one task at a time; another conversation's task never blocks this one (Hub #2027).
        const conversationId = this.store.conversation(input.profile);
        if (conversationId !== undefined && (this.store.unfinishedIn(conversationId) !== undefined || this.#active.has(conversationId))) fail('capacity');
        if (conversationId !== undefined && this.#unrecovered.has(conversationId)) fail('unavailable');
        // A new turn of a paid profile is refused, its reply naming why, when what remains of the daily limit or the month's
        // estimate is below the smallest first call, so it is not admitted only to fail there; synthetic turns cost nothing.
        const paid = this.provider(input.profile), reached = paid.name === 'synthetic' ? undefined : this.spend.reached(paid.model);
        if (reached !== undefined) throw new Fault('capacity', reached);
        task = this.store.newTask(input.profile, input.text);
        this.store.message(task, `${task.id}-prompt`, 'owner', input.text, this.context.clock.now());
        // The first message of an untitled conversation earns it a model-written title (Hub #2025, #2075).
        if (this.titles.started(task.conversationId)) titled = {conversationId: task.conversationId, profile: task.profile, event: {kind: 'message'}};
      } else {
        task = this.#task(input.taskId ?? fail('invalid-request'));
        if (!['waiting', 'paused'].includes(task.status) || task.profile !== input.profile || task.question === null || task.question.id !== input.questionId || task.question.answer !== null) fail('invalid-state');
        // An approval is answered only by the two literal decisions, so free text can neither apply nor dismiss a proposal; a delegation is answered by the worker alone.
        if (task.question.kind === 'delegation') fail('invalid-state');
        if (task.question.kind === 'approval' && !['approve', 'decline'].includes(input.text)) fail('invalid-request');
        task.question.answer = input.text;
        this.store.message(task, `${task.question.id}-answer`, 'owner', input.text, this.context.clock.now());
        // An answered approval is a major event for the conversation's title (Hub #2075), named by its tool and decision.
        if (task.question.kind === 'approval' && task.question.proposal !== null) {
          titled = {conversationId: task.conversationId, profile: task.profile,
            event: {kind: 'approval', tool: proposalTool(task.question.proposal), decision: input.text === 'approve' ? 'approved' : 'declined'}};
        }
      }
      this.#activate(task, command); this.store.save(task); this.store.discard(staged.ref); return task.id;
    }).then(reply => {
      // The title check runs beside the task, after its admission committed; it never delays, fails or rolls back the task.
      if (titled !== undefined && !('error' in reply)) this.#checkTitle(titled, titled.event);
      return reply;
    });
  }
  /**
   * Steers the conversation's unfinished task with a new message (Hub #2031), in the input's transaction. The steer names
   * the turn it expects, as Codex's `expected_turn_id`: a steer aimed at a turn that is not the conversation's unfinished
   * task is refused with `invalid-state`, and nothing retries it. Its text is saved at once and taken into the task's own
   * transcript just before its next model call; it never bumps the task's generation, so the running call goes on.
   * During an approval, or when fewer than two model calls remain in the turn's limits, the text is queued instead. With
   * `questionId`, Skip question and send answers a clarification with `SKIPPED`, and Decline with message declines an
   * approval, then steers the task, which resumes in the same commit. A steer runs no title check; a declined approval
   * is still the title's major event.
   */
  #steer(input: StagedInput, command: Command<AssistantInput>, now: number): {launch: string | undefined; titled?: {conversationId: string; profile: AssistantProfile; event: TitleEvent}} {
    // The expected turn, not the conversation's revision, decides whether a steer is stale: the running task's own steps
    // move that revision. A revision the assistant has not reached is still refused.
    if (input.expectedRevision > this.store.meta().revision) fail('revision-conflict');
    const conversationId = this.store.conversation(input.profile), task = input.taskId === undefined ? undefined : this.store.task(input.taskId);
    if (task === undefined || conversationId === undefined || task.conversationId !== conversationId || task.profile !== input.profile || terminal(task.status)) fail('invalid-state');
    if (this.#unrecovered.has(conversationId)) fail('unavailable');
    const asked = task.question !== null && task.question.answer === null ? task.question : null;
    // The text becomes a queued message, keyed as a steer is by this request ID: it waits for the task to end.
    const queued = (): void => {
      if (!this.store.queue.room(conversationId)) throw new Fault('capacity', QUEUE_FULL);
      this.store.queue.add({id: command.data.requestId, conversationId, profile: task.profile, text: input.text, queuedAtMs: now, updatedAtMs: now, traceparent: command.traceparent});
    };
    const steered = (): void => {
      if (this.#remainingCalls(task) < 2) {queued(); return;}
      if (!this.store.queue.steerRoom(conversationId)) throw new Fault('capacity', STEERS_FULL);
      this.store.queue.addSteer({id: command.data.requestId, taskId: task.id, conversationId, profile: task.profile, text: input.text, savedAtMs: now, traceparent: command.traceparent});
    };
    if (input.questionId !== undefined) {
      // A delegation is answered by the worker alone, so only a clarification or an approval can be set aside.
      if (asked === null || asked.id !== input.questionId || asked.kind === 'delegation' || !['waiting', 'paused'].includes(task.status)) fail('invalid-state');
      let titled: {conversationId: string; profile: AssistantProfile; event: TitleEvent} | undefined;
      if (asked.kind === 'approval') {
        asked.answer = 'decline';
        this.store.message(task, `${asked.id}-answer`, 'owner', 'decline', now);
        if (asked.proposal !== null) titled = {conversationId, profile: task.profile, event: {kind: 'approval', tool: proposalTool(asked.proposal), decision: 'declined'}};
      } else asked.answer = SKIPPED;
      steered();
      this.#activate(task, command); this.store.save(task);
      return {launch: task.id, ...(titled === undefined ? {} : {titled})};
    }
    // A paused or uncertain task makes no next call until the owner resumes it: resume or cancel it, or queue the message.
    if (!['running', 'waiting'].includes(task.status)) fail('invalid-state');
    // During an approval, free text is queued (owner decision 4); Decline with message declines and steers instead.
    if (asked?.kind === 'approval') queued(); else steered();
    return {launch: undefined};
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref === 'spend') {
      // The shared spend of today and this month (Hub #2024): amounts and counts only, no prompt, model text or call identity.
      if (request?.signal.aborted === true || Object.keys(request?.query ?? {}).length > 0) return errorBody('invalid-request');
      try {
        const provider = this.provider();
        const view: SpendView = {...this.spend.totals(), paid: provider.name === 'synthetic' ? null
          : {model: provider.model, minimumMicros: this.spend.minimum(provider.model), prices: this.spend.source(provider.model), pricesAsOf: BUILT_IN_PRICES_AS_OF}};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(view))};
      } catch {return errorBody('unavailable');}
    }
    if (ref === 'assistant-context') {
      // The context preview (Hub #2029): the builder's own sections, exactly as the next call would send them.
      const query = request?.query ?? {};
      if (request?.signal.aborted === true || Object.keys(query).some(key => key !== 'profile') || !profile(query.profile)) return errorBody('invalid-request');
      try {
        const {context, basis} = this.previewContext(query.profile), provider = this.provider(query.profile);
        const document: ContextPreview = {schema: 'assistant-context/1.0', revision: this.store.meta().revision, profile: query.profile, conversationId: context.conversationId,
          provider: provider.name, model: provider.model, basis, sections: context.sections};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(document))};
      } catch {return errorBody('unavailable');}
    }
    if (ref !== 'conversation') return undefined;
    const query = request?.query ?? {}, selected = query.profile;
    if (request?.signal.aborted === true || !profile(selected)) return errorBody('invalid-request');
    try {
      if (query.view === 'list') {
        // The profile's conversations (Hub #2029), the current one first, then the rest newest first, each with its title as
        // its session shows it. `after` is the keyset cursor of a later page, `<last message time or -1>:<row>`.
        const cursor = query.after === undefined ? undefined : /^(-1|\d{1,15}):(\d{1,15})$/.exec(query.after);
        if (Object.keys(query).some(key => !['profile', 'view', 'after'].includes(key)) || cursor === null) return errorBody('invalid-request');
        const listed = this.store.conversations(selected, cursor === undefined ? undefined : {last: Number(cursor[1]), row: Number(cursor[2])});
        const document: ConversationList = {version: 1, profile: selected, older: listed.older,
          conversations: listed.conversations.map(value => ({...value, title: this.titles.published(value.conversationId, selected)}))};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(document))};
      }
      if (query.view === 'queue') {
        // The current conversation's queue (Hub #2030): the waiting messages in order, with their text, the hold and the
        // revision read. With a conversation ID, an earlier conversation's messages a release before this one left there.
        if (Object.keys(query).some(key => !['profile', 'view', 'conversationId'].includes(key)) ||
          (query.conversationId !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(query.conversationId))) return errorBody('invalid-request');
        const current = this.store.conversation(selected), requested = query.conversationId ?? current;
        if (requested !== undefined && requested !== current && !this.store.owns(selected, requested)) return errorBody('not-found');
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.store.queue.document(selected, requested, this.store.meta().revision, requested === current)))};
      }
      if (query.view === 'recent') {
        if (Object.keys(query).some(key => !['profile', 'view', 'before', 'conversationId'].includes(key)) ||
          (query.conversationId !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(query.conversationId))) return errorBody('invalid-request');
        const page = this.store.recentPage(selected, query.before, query.conversationId);
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
  #recoverUnavailable(taskId: string, reason?: string, failed = false): Promise<void> {
    const traceparent = this.#task(taskId).traceparent;
    return this.#change(taskId, task => {
      const unknown = unresolved(this.store.calls(taskId));
      task.status = unknown ? 'uncertain' : 'paused'; task.code = unknown ? 'uncertain-result' : 'unavailable';
      this.#finishRecoveredRun(task);
      // A paused task gets no #2046 closing reply, so a failed recovery writes its own, under the closing-reply prefix that
      // keeps it out of title prompts. Each failed start writes one.
      if (failed) this.store.message(task, `${task.id}-closing-recovery-${randomUUID()}`, 'assistant', RECOVERY_FAILED, this.context.clock.now());
    }, traceparent === null ? undefined : {traceparent}, reason);
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
        task.status = 'succeeded'; task.code = null;
        const messageId = `${task.id}-result`;
        result = this.#confirmationReply(task.id, messageId, values.result);
        this.store.message(task, messageId, 'assistant', result, this.context.clock.now());
      } else if (snapshot.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0)) {
        // The turn that decided to ask saved the question before the interrupt; an interrupt without one is not evidence of a saved question.
        if (task.question === null) {task.status = 'uncertain'; task.code = 'uncertain-result';}
        else {task.status = task.question.answer === null ? 'waiting' : 'paused'; task.code = null;}
      } else {task.status = 'paused'; task.code = null;}
      if (active !== undefined) this.#settle(task, active);
      if (startup) this.#finishRecoveredRun(task);
    }, active?.span.context ?? (traceparent === null ? undefined : {traceparent}));
    if (active !== undefined && this.#task(taskId).status !== 'running') this.#release(active);
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
    const task = this.#task(taskId); if (task.runId === null || task.status !== 'running') return;
    const current = this.#active.get(task.conversationId);
    if (current !== undefined) {
      // The slot's earlier run still settles the task that ended as this one started: this run follows it.
      if (current.taskId !== taskId) this.#deferred.set(task.conversationId, taskId);
      return;
    }
    const run = this.store.run(task.runId); if (run === undefined) return;
    const span = startSpan(this.context.trace, 'bunny.assistant.run', {parent: {traceparent: run.traceparent},
      ...(run.previousTraceparent === null ? {} : {links: [{traceparent: run.previousTraceparent}]}), attributes: {'bunny.assistant.task_id': task.id, 'bunny.assistant.run_id': run.id}});
    const active: Active = {taskId, conversationId: task.conversationId, runId: run.id, generation: task.generation, controller: new AbortController(), span, accountedAt: this.context.clock.now(), work: Promise.resolve()};
    this.#active.set(task.conversationId, active);
    active.deadline = this.context.scheduler.after(Math.max(0, LIMITS.activeMs - task.activeMs), () => {
      active.stopReason = 'This turn reached its active time limit.';
      active.controller.abort();
    });
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
        task.traceparent = active.span.context.traceparent; this.store.save(task, false);});
      const task = this.#fence(active), config = {...this.#config(task.id), signal: active.controller.signal};
      const snapshot = await this.#graph.getState(config); this.#fence(active);
      const interrupted = snapshot.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0);
      const input = interrupted && task.question?.answer !== null && task.question?.answer !== undefined
        ? new Resume<unknown, Partial<GraphState>, 'turn' | 'ask' | 'answered' | 'tool' | 'approve' | 'act' | '__start__'>({resume: task.question.answer})
        : snapshot.createdAt === undefined ? {taskId: task.id, step: 0, next: 'end' as const, decision: '', result: ''} : null;
      await this.#graph.invoke(input, config); this.#fence(active);
      await this.#reconcile(task.id, false, active);
    } catch (error) {
      const code = this.#closed || this.context.signal.aborted ? 'cancelled' : codeOf(error);
      try {
        await this.#change(active.taskId, task => {
          if (terminal(task.status)) {this.#settle(task, active); return;}
          const unknown = unresolved(this.store.calls(task.id));
          task.status = unknown ? 'uncertain' : code === 'cancelled' ? 'paused' : 'failed';
          task.code = unknown ? 'uncertain-result' : code; this.#settle(task, active);
        }, active.span.context, active.stopReason ?? closingReasonOf(error));
        // Only the model's refusal had speech before failure settlement. The generated summary has no output effects.
        if (error instanceof Fault && error.closingReason === REFUSED) {
          const task = this.#task(active.taskId), id = `${task.id}-closing-${String(task.generation)}`;
          const saved = this.store.savedMessage(task.id, id);
          if (saved !== undefined) this.#speak(task.id, id, error.closingReason, active.span.context);
        }
      } catch { /* Failed durability is not reported as saved; startup reconciles checkpoints and receipts. */ }
    } finally {
      active.deadline?.();
      this.#log('assistant.run.settled', active); active.span.end(this.#task(active.taskId).code === null ? 'unset' : 'error'); this.context.signal.removeEventListener('abort', abort);
      this.#release(active);
    }
  }
  /** Frees the conversation's slot from a settled run and launches the task that started behind it, if any. */
  #release(active: Active): void {
    if (this.#active.get(active.conversationId) !== active) return;
    this.#active.delete(active.conversationId);
    const next = this.#deferred.get(active.conversationId);
    this.#deferred.delete(active.conversationId);
    if (next !== undefined && !this.#closed && !this.context.signal.aborted) this.#launch(next);
  }
  #activeFor(taskId: string): Active {
    const active = this.#active.get(this.#task(taskId).conversationId); if (active === undefined || active.taskId !== taskId) return fail('invalid-state');
    this.#fence(active); return active;
  }
  /** Appends the item a call produced, once: a re-run node finds the item by the call's effect id and leaves it. */
  #append(taskId: string, item: Appended, parent: TraceContext, also?: (task: Task) => void): Promise<void> {
    return this.#change(taskId, task => {
      if (task.transcript.some(existing => 'effect' in existing && existing.effect === item.effect)) return;
      task.transcript.push(item); also?.(task);
      if (textBytes(JSON.stringify(task.transcript)) > LIMITS.stateBytes) throw new Fault('capacity', 'This turn reached its working transcript limit.');
    }, parent);
  }
  #core(): CoreCopy {return this.options.core?.() ?? {sessions: [], mode: undefined, synced: false};}
  /**
   * The prompt context at this call (Hub #2029): the builder's sections for the task's companion, from the records as they
   * are now, with the recent conversation held to the messages saved before the task started. A task saved before that
   * boundary existed has no recent conversation.
   */
  #context(task: Pick<Task, 'profile' | 'conversationId' | 'contextThrough'>): PromptContext {
    const persona = PROFILES.find(value => value.id === task.profile) ?? fail('internal');
    const recent = task.contextThrough === undefined ? {messages: [], total: 0} : this.store.recentContext(task.profile, task.conversationId, task.contextThrough);
    return buildContext({profile: task.profile, persona: {name: persona.name, character: persona.character},
      knowledge: {enabled: this.store.knowledgeEnabled(task.profile), entries: (this.options.knowledge?.() ?? []).map(entry => ({title: entry.title, text: entry.text}))},
      preferences: (this.options.preferences?.() ?? []).map(entry => ({title: entry.title, text: entry.text})),
      recent: {conversationId: task.conversationId, ...recent}});
  }
  /**
   * What the builder would send for the profile now (Hub #2029), for the page's context preview: the next call of the
   * current conversation's unfinished task, or else of a new message's task in it.
   */
  previewContext(profile: AssistantProfile): {context: PromptContext; basis: {kind: 'task'; taskId: string} | {kind: 'next-message'}} {
    const conversationId = this.store.conversation(profile);
    const unfinished = conversationId === undefined ? undefined : this.store.unfinishedIn(conversationId);
    if (unfinished !== undefined) return {context: this.#context(unfinished), basis: {kind: 'task', taskId: unfinished.id}};
    const context = conversationId === undefined ? {...this.#context({profile, conversationId: '', contextThrough: 0}), conversationId: null}
      : this.#context({profile, conversationId, contextThrough: this.store.lastSequence(conversationId)});
    return {context, basis: {kind: 'next-message'}};
  }
  async #turn(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic', task.profile), copy = this.#core();
    const id = `${state.taskId}-step-${String(state.step)}`;
    // Each section keeps to its own budget and states what it left out, so the context is bounded without a refusal.
    const context = this.#context(task), paid = provider.name !== 'synthetic';
    let request: TurnInput | undefined;
    // The task's unread steers are taken into its transcript in the call's own admission (Hub #2031), after the last
    // call's tool results, and the request is built from that transcript: a limit that refuses the call leaves them
    // unread, and a replayed node whose call was admitted takes none again.
    const text = await this.#call(state.taskId, state.step, 'model', signal => provider.turn(request ?? fail('internal'), signal)
      .then(reply => ({text: JSON.stringify(reply), units: reply.units, usage: reply.usage ?? null})), undefined, current => {
      this.#drain(current);
      request = {instructions: INSTRUCTIONS, context, transcript: current.transcript, tools,
        mode: copy.mode === undefined ? null : {mode: copy.mode.mode, revision: copy.mode.revision}};
      // The call reserves what this request could use: its bytes bound its input tokens, and the output bound its answer's.
      const inputUnits = inputBound(request);
      return {units: inputUnits + LIMITS.outputUnits, unit: paid ? 'tokens' : 'synthetic units',
        ...(paid ? {spend: {model: provider.model, inputUnits, outputUnits: LIMITS.outputUnits}} : {})};
    });
    const reply = parseReply(text), call = reply.calls[0];
    // A steer that reached the task before this call returned supersedes a final answer: the model reads it first.
    const steered = this.store.call(id)?.steered === true;
    let next: Next = 'end', result = '';
    // The final text is what the owner reads; it keeps the result bound even though a reply with the model's own blocks may be larger.
    if (reply.text !== null && textBytes(reply.text) > LIMITS.toolBytes) throw new Fault('capacity', 'The reply exceeded the text limit.');
    if (reply.stop === 'refusal') {
      await this.#append(state.taskId, {role: 'assistant', text: reply.text, calls: [], effect: id}, active.span.context);
      throw new Fault('forbidden', REFUSED);
    }
    if (reply.stop === 'truncated') {
      await this.#append(state.taskId, {role: 'assistant', text: reply.text, calls: [], effect: id}, active.span.context);
      throw new Fault('capacity', 'The model reached its output limit.');
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
    // The superseded answer is saved and never spoken; only the turn's final reply is (Hub #2031).
    const forced = next === 'end' && steered;
    const item: Appended = {role: 'assistant', text: reply.text, calls: call === undefined ? [] : [call], effect: id, ...(reply.blocks === undefined ? {} : {blocks: reply.blocks})};
    let asked = false;
    await this.#append(state.taskId, item, active.span.context, current => {
      if (forced && reply.text !== null && reply.text.trim() !== '') this.store.message(current, `${id}-reply`, 'assistant', reply.text, this.context.clock.now());
      if (question === undefined) return;
      if (current.questions >= LIMITS.questions) throw new Fault('capacity', `This turn reached its limit of ${String(LIMITS.questions)} questions.`);
      current.questions += 1; current.question = question;
      this.store.message(current, question.id, 'assistant', question.text, this.context.clock.now()); asked = true;
    });
    if (asked && question !== undefined) this.#speak(state.taskId, question.id, question.text, active.span.context);
    return forced ? {step: state.step + 1, next: 'turn', result: ''} : {step: state.step + 1, next, result};
  }
  /**
   * Takes the task's unread steers into its transcript, oldest first, as the owner's text after whatever the last call
   * produced, and saves each in the conversation where the model read it (Hub #2031). Idempotent: a steer already in the
   * transcript is not added again. Runs in a model call's admission transaction.
   */
  #drain(task: Task): void {
    for (const steer of this.store.queue.steers(task.id)) {
      const effect = `steer-${steer.id}`;
      const item: Appended = {role: 'owner', text: steer.text, effect};
      if (!task.transcript.some(existing => 'effect' in existing && existing.effect === effect)) task.transcript.push(item);
      this.store.message(task, `${task.id}-steer-${steer.id}`, 'owner', steer.text, this.context.clock.now());
      this.store.queue.delivered(steer.id);
    }
    if (textBytes(JSON.stringify(task.transcript)) > LIMITS.stateBytes) throw new Fault('capacity', 'This turn reached its working transcript limit.');
  }
  #catalog(): ConversationActions {return this.#catalogActions ??= new ConversationActions(this.context, this.#allowed, this.options.retainedArtwork);}
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
      // A busy slot still proposes: an approved hand-off waits for it (Hub #2028). Only a missing worker refuses.
      const coding = this.options.coding?.(this.#task(taskId).profile);
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
    const provider = this.provider(task.profile), tools = permittedTools(this.#allowed, provider.name === 'synthetic', task.profile);
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
      if (isCatalogTool(call.name)) {
        const evidence: ActionEvidence[] = [];
        const text = await this.#catalog().read(call, parent, item => evidence.push(item)) ?? fail('invalid-state');
        return {text, units: 0, evidence};
      }
      const text = call.name === READ_FIXTURE ? FIXTURE_TEXT : call.name === READ_SESSIONS ? summarizeSessions(this.#core(), now) : fail('invalid-state');
      return {text, units: 0};
    });
    await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result, ok: true, effect: id}, active.span.context);
    return {step: state.step + 1};
  }
  async #act(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const question = task.question ?? fail('invalid-state'), proposal = question.proposal ?? fail('invalid-state');
    const id = `${state.taskId}-step-${String(state.step)}`, name = proposalTool(proposal);
    const refuse = async (suffix: string, text: string): Promise<Partial<GraphState>> => {
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: question.call, name, result: text, ok: false, effect: `${id}-${suffix}`}, active.span.context,
        current => {this.store.message(current, `${id}-${suffix}`, 'tool', text, this.context.clock.now());});
      return {step: state.step, next: 'turn'};
    };
    if (state.decision !== 'approve') return refuse('declined', DECLINED);
    if (!permittedTools(this.#allowed, this.provider(task.profile).name === 'synthetic', task.profile).some(tool => tool.name === name)) return refuse('refused', 'This tool is not permitted.');
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
    const startedAtMs = this.context.clock.now();
    const target = confirmationTarget(proposal, question.text);
    const action = {questionId: question.id, description: actionDescription(proposal, question.text)};
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
        const settled = settle(answer, receipt);
        if (answer.status !== 'accepted' || target === undefined) return settled;
        const acceptedAtMs = this.context.clock.now();
        return {...settled, confirmation: {...target, requestId: id, taskId: task.id, questionId: question.id,
          acceptedAtMs, expiresAtMs: acceptedAtMs + CONFIRMATION_LIFETIME_MS, traceparent: parent.traceparent}};
      }, (current, call) => {
        call.action = action;
        if (artDescription === undefined) return;
        const targets = proposal.family === 'catalog-action' ? proposal.data.showTargets : undefined;
        this.store.artReply(current, id, artDescription, this.context.clock.now(), Array.isArray(targets) && targets.every((v): v is string => typeof v === 'string') ? targets : undefined);
      });
    } else {
      const delegate = this.options.delegate;
      if (delegate === undefined) return refuse('refused', 'This tool is not permitted.');
      // The task waits on the delegation before the hand-off leaves, so a worker's word that comes back faster than this
      // step finds its question. The worker's word answers it as the owner's answer would a question; it counts no question.
      const pending: Question = {id: `${state.taskId}-delegation-${String(state.step)}`, text: `Delegated to the coding worker in ${proposal.data.repository}: ${proposal.data.brief}`.slice(0, 1024),
        answer: null, kind: 'delegation', call: question.call, proposal: null};
      delegation = pending;
      // A hand-off whose companion's slot is busy waits for it; it was approved and is sent once when the slot frees.
      const companion = PROFILES.find(entry => entry.id === task.profile)?.name ?? task.profile;
      result = await this.#call(state.taskId, state.step, 'tool', signal => delegate({requestId: id, taskId: state.taskId, companion: task.profile, repository: proposal.data.repository, brief: proposal.data.brief,
        expectedRevision: proposal.expectedRevision}, active.span.context, signal)
        .then(answer => answer.status === 'waiting'
          ? {text: `${WAITING_RECEIPT} ${companion}'s slot as operation ${id}; it is sent when that slot frees, and its structured result arrives as this tool's later result`, units: 0}
          : settle(answer, `accepted: the coding worker was handed the task as operation ${id}; its structured result arrives as this tool's later result`)), (current, call) => {current.question = pending; call.action = action;});
    }
    const accepted = result.startsWith('accepted');
    const confirmation = this.store.confirmation(id);
    if (confirmation !== undefined) {
      const remaining = Math.min(IN_TURN_CONFIRMATION_MS, LIMITS.toolMs - (this.context.clock.now() - startedAtMs));
      await this.#waitForConfirmation(confirmation, remaining, active.controller.signal);
      this.#fence(active);
      const recorded = this.store.confirmation(id) ?? confirmation;
      result = recorded.result ?? pending(recorded);
    }
    let handedOff = false;
    // A hand-off waiting for its companion's busy slot has not been sent: the conversation says it waits, and says
    // "delegated" once the coordinator reports it sent (Hub #2028).
    await this.#append(state.taskId, {role: 'tool', call: question.call, name, result, ok: accepted, effect: id}, active.span.context, current => {
      if (delegation === undefined) return;
      // Read in the transaction that saves the line: a hand-off the module sent meanwhile is already delegated.
      const waits = result.startsWith(WAITING_RECEIPT) && this.options.handedOff?.(id) !== true;
      // The conversation says "delegated" only once the core accepted the hand-off; a refused one has no worker's word to wait for, so the answered approval stands again.
      if (accepted) {
        const text = waits ? waitingText(delegation.text) : delegation.text;
        if (waits && current.question?.kind === 'delegation') current.question.text = text;
        this.store.message(current, delegation.id, 'assistant', text, this.context.clock.now()); handedOff = true;
      } else if (current.question?.kind === 'delegation') current.question = question;
    });
    // An accepted coding hand-off, and any other accepted command, which changes state, ask the title model to check the
    // conversation's title (Hub #2025, #2075), so an issue named only in a brief can lead it. The receipt is a tool result
    // and stays out of the check; the check runs beside the task and never delays it.
    if (handedOff) this.#checkTitle(task, {kind: 'hand-off'});
    else if (accepted && proposal.family !== 'coding-dispatch') this.#checkTitle(task, {kind: 'tool', tool: name});
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
   * A hand-off that waited for its companion's slot was sent (Hub #2028): the delegation now reads as delegated, and the
   * conversation says so once. A task that no longer waits on that hand-off is left as it is.
   */
  async handOffSent(taskId: string, parent: TraceContext): Promise<void> {
    await this.outbox.transaction(add => {
      const task = this.store.task(taskId), question = task?.question;
      if (task === undefined || terminal(task.status) || question === null || question === undefined || question.kind !== 'delegation' || question.answer !== null
        || !question.text.startsWith(WAITING_PREFIX)) return;
      question.text = `Delegated${question.text.slice(WAITING_PREFIX.length)}`.slice(0, 1024);
      this.store.message(task, `${question.id}-sent`, 'assistant', question.text, this.context.clock.now());
      this.store.save(task); this.#publish(add, parent);
    });
  }
  /**
   * Delivers the worker's final word to the task waiting on its delegation and resumes it. A task the engine cannot run
   * now keeps the answer and waits for the owner's resume; a task that is not waiting on a delegation ignores it.
   * `startup` marks the coordinator's settlement at start of a hand-off left pending at the last stop, which starts no
   * title check, as a start starts no work.
   */
  async deliver(taskId: string, text: string, parent: TraceContext, evidence: ActionEvidence, startup = false): Promise<void> {
    let launch = false, delivered: Task | undefined;
    await this.outbox.transaction(add => {
      const task = this.store.task(taskId);
      if (task === undefined || terminal(task.status)) return;
      const question = task.question;
      if (question === null || question.kind !== 'delegation' || question.answer !== null) return;
      this.store.observeAction(taskId, evidence);
      question.answer = text.slice(0, LIMITS.toolBytes); delivered = task;
      if (['waiting', 'paused'].includes(task.status) && this.store.meta().enabled && this.available() && !this.#active.has(task.conversationId) && !this.#unrecovered.has(task.conversationId) && !this.#closed) {this.#activate(task, parent); launch = true;}
      this.store.save(task); this.#publish(add, parent);
    });
    if (launch && !this.#closed && !this.context.signal.aborted) this.#launch(taskId);
    // The hand-off's result is a major event for the title (Hub #2075): its outcome word goes to the check, its text does not.
    if (delivered !== undefined && !startup) this.#checkTitle(delivered, {kind: 'hand-off-result', outcome: handOffOutcome(text)});
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
    reserve?: (task: Task, call: Call) => void, budget: Budget | ((task: Task) => Budget) = {units: 0, unit: 'units'}): Promise<string> {
    const active = this.#activeFor(taskId);
    const id = `${taskId}-step-${String(ordinal)}`, saved = this.store.call(id);
    if (saved !== undefined) {
      if (saved.status !== 'succeeded' || saved.result === null) fail('uncertain-result');
      await this.#change(taskId, task => {this.#fence(active); task.nextOrdinal = Math.max(task.nextOrdinal, ordinal + 1);}, active.span.context);
      this.#fence(active); return saved.result;
    }
    const timeout = kind === 'model' ? LIMITS.modelMs : LIMITS.toolMs;
    // A model reply carries the provider's own blocks for replay, so it may be larger than a tool result.
    const bound = kind === 'model' ? LIMITS.replyBytes : LIMITS.toolBytes;
    const span = startSpan(this.context.trace, kind === 'model' ? 'bunny.assistant.model' : 'bunny.assistant.tool', {parent: active.span.context,
      attributes: {'bunny.assistant.task_id': taskId, 'bunny.assistant.run_id': active.runId, 'bunny.assistant.effect_id': id}});
    const call: Call = {version: 1, id, taskId, runId: active.runId, ordinal, kind, status: 'admitted', result: null, units: null,
      reservedUnits: 0, reservedMs: timeout, elapsedMs: null, traceparent: span.context.traceparent};
    const started = this.context.clock.now(); let replied = false, answer: Answer | undefined;
    try {
      await this.#change(taskId, task => {
        this.#fence(active);
        task.activeMs += Math.max(0, started - active.accountedAt);
        if (task.nextOrdinal !== ordinal) throw new Fault('capacity', 'The next step did not match the saved turn.');
        // A model call's budget is read from the task in this transaction, once its unread steers are in the transcript.
        const reserved = typeof budget === 'function' ? budget(task) : budget;
        let limit = this.#limitOf(task, kind, timeout, reserved);
        if (limit === undefined && reserved.spend !== undefined) limit = this.spend.reserve({id, purpose: 'task', owner: taskId, ...reserved.spend});
        if (limit !== undefined) throw new Fault('capacity', limit);
        if (kind === 'model') task.modelCalls += 1; else task.toolCalls += 1;
        call.reservedUnits = reserved.units;
        task.activeMs += timeout; task.reservedUnits += reserved.units; reserve?.(task, call); this.store.saveCall(call);
      }, span.context);
      this.#fence(active);
      const reply = await this.#wait(active, timeout, bound, () => Promise.resolve().then(() => operation(active.controller.signal, span.context)), call);
      replied = true; answer = reply; this.#fence(active);
      if (typeof reply.text !== 'string') throw new Fault('capacity', `The ${kind} returned an invalid response.`);
      if (textBytes(reply.text) > bound) throw new Fault('capacity', kind === 'model' ? 'The model response exceeded its size limit.' : 'The tool result exceeded its size limit.');
      if (reply.units !== null) {
        if (!Number.isSafeInteger(reply.units) || reply.units < 0) throw new Fault('capacity', `The ${kind} reported invalid usage.`);
        if (reply.units > call.reservedUnits) throw new Fault('capacity', `The ${kind} reported usage above its per-call limit.`);
      }
      const elapsed = Math.min(timeout, Math.max(0, this.context.clock.now() - started)); active.accountedAt = this.context.clock.now();
      await this.#change(taskId, task => {
        this.#fence(active); call.status = 'succeeded'; call.result = reply.text; call.units = reply.units; call.elapsedMs = elapsed;
        // A fast worker can finish after admission and before the dispatch reply.
        const observed = call.action === undefined ? undefined : this.store.call(id)?.action?.observed;
        if (call.action !== undefined && observed !== undefined) call.action.observed = observed;
        // Whether a steer reached the task before this model call's answer was saved (Hub #2031); one after it is late.
        if (kind === 'model' && this.store.queue.steers(taskId).length > 0) call.steered = true;
        this.store.saveCall(call); task.activeMs -= timeout - elapsed;
        if (reply.confirmation !== undefined) this.store.saveConfirmation(reply.confirmation);
        for (const evidence of reply.evidence ?? []) this.store.observeAction(taskId, evidence);
        if (reply.units !== null) task.reservedUnits -= call.reservedUnits - reply.units;
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
      throw error;
    } finally {this.#log('assistant.call.settled', active, id); const receipt = this.store.call(id); span.end(receipt !== undefined && receipt.status !== 'succeeded' ? 'error' : 'unset');}
  }
  async #wait(active: Active, timeout: number, bound: number, operation: () => Promise<Answer>, call: Call): Promise<Answer> {
    let cancel: Cancel | undefined, stopped: (() => void) | undefined, settled = false;
    const deadline = new Promise<Answer>((_resolve, reject) => {
      stopped = () => {settled = true; reject(new Fault('cancelled'));};
      active.controller.signal.addEventListener('abort', stopped, {once: true});
      cancel = this.context.scheduler.after(timeout, () => {
        settled = true;
        active.stopReason ??= `The ${call.kind} call timed out. Its outcome is unconfirmed.`;
        reject(new Fault('uncertain-result'));
        active.controller.abort();
      });
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
