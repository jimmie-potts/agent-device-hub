import {statusQuestion, type CodingJobEntry} from '../coding/job-page.js';
import {CLOUD_DISABLED, codingChoice, codingDestinationChoice, isCloudChoice, type CodingChoice, type CodingRequirements} from '../coding/routing.js';
import type {CodingDestination} from '@jimmie-potts/event-contracts/v2/coding';
import {catalogRoute, SHOW_SAVE_WINDOW_MS} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Annotation, Command as Resume, END, GraphRecursionError, StateGraph, interrupt} from '@langchain/langgraph';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {ASSISTANT_LEGACY_TOOL_LIMIT, ASSISTANT_LIGHT_OWNER, ASSISTANT_WEMO_OWNER, type AssistantControl, type AssistantDeviceOwner, type AssistantDispatch, type AssistantInput, type AssistantProfile, type AssistantProvider, type AssistantQueueSummary, type AssistantState, type ContinueCodingControl} from '@jimmie-potts/event-contracts/v2/assistant';
import {SPOKEN_REPLY_TTL_MS, type SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {fullDisk, startSpan, type AddMessage, type Cancel, type Command, type ModuleContent, type ModuleContentRequest,
  type ModuleContext, type ModuleStagedUpload, type ModuleUploadRequest, type Outbox, type Reply, type RequestResult, type Span, type Subscription, type TraceContext, recordLog, type LogEvent, Outcome} from '@jimmie-potts/sdk';
import {codingUpdateMessageId, type CodingJob, type CodingJobRead, type CodingUpdateKind} from '../coding/store.js';
import type {CodingBrief, CodingBriefRefusal, CodingCoordinator, HandOffAnswer} from '../coding/coordinator.js';
import {actionDescription, closingReply, type ActionEvidence} from './closing-reply.js';
import {CONFIRMATION_LIFETIME_MS, IN_TURN_CONFIRMATION_MS, confirmationTarget, confirmationText, followConfirmation, pending, type Confirmation} from './confirmation.js';
import {CheckpointCapacityError, SqliteCheckpointSaver} from './checkpointer.js';
import {AssistantStore, GRAPH_VERSION, LIMITS, RESPONSES_GRAPH_VERSION, terminal, unresolved, type Appended, type Call, type MessageSource, type Question, type Stage, type StagedInput, type Task, type HostedHistoryMessage, type ContextSourceVersion, type HistoryCompaction} from './store.js';
import {hasSavedDisclosureProof, savedDisclosureProof, saveFinalDisclosureProofs} from './disclosure-proof.js';
import type {ContextPreview, ConversationList, Proposal} from './history-contract.js';
import {steerMessageId, supersededReplyId} from './queue-contract.js';
import {ProviderFault, hostedInputCapacity, hostedInputUnits, textBytes, type ModelProvider, type SupervisorIdentity, type PromptContext, type ToolCall, type TurnInput, type TurnReply} from './provider.js';
import {accessFor, canRevokeFields, codingShareDestination, recordedSupervisorField, supervisorFields, type DisclosedField, type FieldAccess, type Share, type ShareQuery} from './sharing.js';
import {authorizesControl, authorizesHubMode, brightnessSubject, containsControlValue, literalDeviceId, missingBrightness, missingMode, namedControlTargets, normalizedControlText, powerSubject, type BoundControl, type SceneReceipt} from './control-intent.js';
import {CONTROL_INSTRUCTIONS, controlReferenceIds, controlReferenceSnapshot, exactControlIds, modelControlProof, resolveModelControl, type ControlSource, type ModelControlProof, type ModelControlScope} from './model-control.js';
import {planWemoPower, resolveWemoControl, wemoControlReference} from './wemo-control.js';
import {buildContext, sectionOf, type ContextEntry, type RecentMessage} from './context.js';
import {fitConversationHistory, type HostedWindow} from './conversation-window.js';
import {buildConversationCompactionInput, COMPACTION_OUTPUT_TOKENS, readConversationCompactionReply} from './conversation-compaction.js';
import {BUILT_IN_PRICES_AS_OF, inputBound, SpendLedger, type PriceTable, type SpendView, type TokenUsage} from './spend.js';
import {PROFILES, spokenAloud} from '../knowledge/model.js';
import type {ActivePreference} from '../preferences/model.js';
import {chooseBrightnessSubject, ConversationActions, deviceClarification, type CatalogAdmission, type CatalogIdentityRead, type RetainedArtworkRead} from './catalog-actions.js';
import {deviceHistoryQuery} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {catalogExactTargets, catalogExcluded, catalogHistoryNames, catalogQuoteNames, catalogReferenceConflict, catalogSelections, catalogSelectionText, catalogSelectorSelected, isCatalogSelectorKind, readCatalogReferences} from './catalog-grounding.js';
import {catalogCommand, catalogTool, catalogToolReferenceRoles, catalogToolWithReferences, draftMutation, isCatalogTool, modelCatalogCommand, modelCatalogTool, READ_DEVICE_HISTORY, READ_DEVICES, READ_HUB_GUIDE} from './catalog-tools.js';
import {DeviceHistoryPages, deviceHistoryGuide, requestedHistory, sameHistoryQuery, type DeviceHistoryRead, type DeviceHistoryBinding} from './device-history.js';
import {SyntheticProvider} from './synthetic.js';
import {changesOf, observationDraft, observationOf, titleObservationOf} from './sessions.js';
import {ConversationTitles, ownerTitle, type TitleEvent, type TitleProvider} from './titles.js';
import {describePowerLimit, followPowerLimits, localInstant} from './power-limits.js';
import {chooseDevice, deviceLabel, deviceProposal, deviceProposalText, readDevices, type DeviceReadDisplay} from './devices.js';
import {bindCodingRequirements, codingOS, codingRequirements, ownerCodingRoute} from './coding-request.js';
import {ASK_OWNER, BRIEF_BYTES, DELEGATE_CODING, definition, deviceToolOwner, FIXTURE_TEXT, MODES, permittedTools, READ_FIXTURE, READ_SESSIONS, READ_WEMO, REPOSITORY, SET_MODE, SET_LIFX_POWER, SET_LIFX_BRIGHTNESS, SET_WEMO_POWER, WEMO_TARGETS, summarizeSessions, type CoreCopy} from './tools.js';

export type {ModelProvider, TurnInput, TurnReply, TranscriptItem} from './provider.js';
/** Sends one approved command through the core's tracked dispatcher; the module binds it to its own participant. */
export type Dispatch = (data: AssistantDispatch, parent: TraceContext, signal: AbortSignal) => Promise<RequestResult>;
/**
 * What the module gives the engine (Hub #46, #507): the configured provider, which every profile uses (Hub #2026), or
 * the synthetic one without it, the allowlisted tool names, the synced copy of the core for reads and proposals, the dispatch path for approved commands,
 * and the owner's currently active explicit preferences, read at each model call (none without the seam).
 */
export type AssistantOptions = {
  deviceHistory?: DeviceHistoryRead;
  historyTimeZone?: string;
  share?: Share;
  provider?: ModelProvider;
  alternateProvider?: ModelProvider;
  retainedArtwork?: RetainedArtworkRead;
  readCatalogIdentity?: CatalogIdentityRead;
  tools?: readonly string[];
  core?: () => CoreCopy;
  dispatch?: Dispatch;
  devices?: (owner: AssistantDeviceOwner) => readonly DeviceRecord[] | undefined;
  readDevice?: (owner: AssistantDeviceOwner, name: unknown, signal: AbortSignal, parent: TraceContext, display: DeviceReadDisplay) => Promise<string | undefined>;
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
  coding?: (profile: AssistantProfile) => ReturnType<CodingCoordinator['endpoint']>;
  codingRequirements?: (ownerRequest: string) => CodingRequirements | undefined;
  /** Hands an approved delegation to the core's tracked dispatcher; the worker's result comes back through `deliver`. */
  delegate?: Delegate;
  backgroundCoding?: boolean;
  codingJob?: (operationId: string) => CodingJob | undefined;
  codingJobRead?: CodingCoordinator['jobRead'];
  readJobStatus?: (jobId: string) => CodingJobEntry | undefined;
  stopCodingJob?: CodingCoordinator['prepareStop'];
  messageCodingJob?: CodingCoordinator['prepareMessage'];
  openNativeClient?: CodingCoordinator['prepareNativeClient'];
  continueCodingJob?: CodingCoordinator['prepareContinuation'];
  /**
   * Whether the module already sent a hand-off that answered `waiting` (Hub #2028), so a hand-off sent before its waiting
   * line is saved reads "Delegated to ..." at once.
   */
  handedOff?: (requestId: string) => boolean;
  /** Cancels a delegation on a saved pre-background graph. Background jobs have their own stop operation. */
  onCancelled?: (taskId: string) => void;
  /** The private section's prices per model for the spend ledger (Hub #2024); they override the built-in table (Hub #2047). */
  prices?: PriceTable;
  /** The local monthly spend guard in millionths of a dollar (Hub #2102): the section's `assistant.monthlyLimit`, else $150. */
  monthlyLimitMicros?: number;
  /** The time zone whose local day and month the spend limits use: the runtime host's own unless a test names one. */
  timeZone?: string;
  /**
   * The configured title provider (Hub #2025), which titles every profile's conversations (Hub #2026). Without one, as
   * on the synthetic provider, no profile makes a title call and each keeps its persona name.
   */
  titleProvider?: TitleProvider;
  openAITitleProvider?: TitleProvider;
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
export type Delegation = {requestId: string; taskId: string; conversationId: string; companion: AssistantProfile; repository: string; brief: string; expectedRevision: number; choice?: CodingChoice};
/** The core's answer for a hand-off sent now, or `waiting` when the companion's slot is busy and it waits for it (Hub #2028). */
export type Delegate = (data: Delegation, parent: TraceContext, signal: AbortSignal) => Promise<HandOffAnswer>;
/** An engine refusal; `closingReason` is fixed text for the owner, such as the spend limit a new turn met. */
class Fault extends Error {constructor(readonly code: ErrorCode, readonly closingReason?: string) {super(code);}}
/** What one call answered: its text, its reported usage total, and a paid provider's usage by price class. */
const BRIGHTNESS_REQUEST_UNAVAILABLE = 'refused: the original brightness request is no longer available.';
const BRIGHTNESS_ANSWER_UNAVAILABLE = 'refused: the owner’s exact brightness clarification is no longer available.';
const BRIGHTNESS_DETAILS_UNAVAILABLE = 'The request finished. Details are unavailable.';
const BRIGHTNESS_NOT_SENT = 'The brightness request is no longer available. No command was sent.';
const stoppedBeforeBrightness = (text: string | null): boolean =>
  text === BRIGHTNESS_REQUEST_UNAVAILABLE || text === BRIGHTNESS_ANSWER_UNAVAILABLE;

type Answer = {text: string; units: number | null; usage?: TokenUsage | null; historySources?: Call['historySources']; inputVersions?: Call['inputVersions']; evidence?: ActionEvidence[]; confirmations?: readonly Confirmation[];
  disclosures?: readonly DisclosedField[]; incompleteDisclosures?: true; wemoFacts?: Call['wemoFacts']; privateDraftId?: string};
/** What a call may use: the units it reserves, their name in a limit message, and a paid model call's spend reservation. */
type Budget = {units: number; unit: string; spend?: {model: string; inputUnits: number; outputUnits: number; pricing?: NonNullable<SupervisorIdentity['pricing']>}};
function fail(code: ErrorCode): never {throw new Fault(code);}

function conversationMessageId(taskId: string, item: TurnInput['transcript'][number]): string | undefined {
  if ('effect' in item && typeof item.effect === 'string') {
    return item.role === 'owner' && item.effect.startsWith('steer-') ? steerMessageId(taskId, item.effect.slice(6)) : item.effect;
  }
  return item.role === 'owner' ? `${taskId}-prompt` : undefined;
}

const privateJobMessage = ({id, taskId}: MessageSource): boolean =>
  id === `${taskId}-private-status` || id === `${taskId}-private-question`;

const MAX_DISCLOSED_FIELDS = 512;
type DisclosureLedger = {fields: DisclosedField[]; incompleteDisclosures?: true};
function recordDisclosures(access: FieldAccess, ledger: DisclosureLedger): FieldAccess {
  return (source, field, record) => {
    if (!access(source, field, record)) return false;
    if (!ledger.fields.some(item => item.source === source && item.field === field && item.record === record)) {
      if (ledger.fields.length === MAX_DISCLOSED_FIELDS) ledger.incompleteDisclosures = true;
      else ledger.fields.push({source, field, ...(record === undefined ? {} : {record})});
    }
    return true;
  };
}
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
const CODING_JOB_ID = /^[A-Za-z0-9_.-]{1,154}-job$/u;
const QUEUED_ID = /^[A-Za-z0-9_.-]{1,128}$/u;
const ATTEMPT_UPDATE_ID = /^([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})-(sent|stop-unconfirmed|result)$/u;
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
  dataschema: `https://bunny.invalid/events/assistant-state/${data.providers !== undefined ? '2.4' : data.queues?.some(queue => queue.messages > LIMITS.queuedMessages) === true ? '2.3'
    : data.queues !== undefined ? '2.2' : data.tools.length > ASSISTANT_LEGACY_TOOL_LIMIT ? '2.1' : '2.0'}`, data});
export const INSTRUCTIONS = 'Answer the owner briefly and truthfully from the evidence the tools return.';
const controlInstructions = (tools: TurnInput['tools']): string => tools.some(tool => tool.name === SET_WEMO_POWER || tool.name === SET_MODE || modelCatalogTool(tool.name))
  ? `${INSTRUCTIONS} ${CONTROL_INSTRUCTIONS}` : INSTRUCTIONS;
/** The start of the tool result for a hand-off that waits for its companion's busy slot (Hub #2028). */
export const WAITING_RECEIPT = 'accepted: the coding worker is busy, so this hand-off waits for';
/** How a waiting hand-off is worded in the conversation until it is sent; "Delegated to ..." replaces it then. */
export const WAITING_PREFIX = 'Waiting to delegate';
const jobReceipt = (job: CodingJob): string => `accepted: Coding job ${job.jobId} was queued for ${job.repository}. Updates will appear in this conversation.`;

function deviceRequestSubject(text: string): string | undefined {
  // Only the opening clause can select a read target. Its full subject must resolve locally.
  const [opening = '', remainder] = text.trim().split(/(?<=[.!?;,])(?:\s+|$)|[\r\n]+/u, 2);
  const affirmative = normalizedControlText(opening).replace(/ only$/u, '');
  const timerSubject = /^(?:is|was) (?:the )?timer for (?:the )?(.+?) (?:on|off|active|armed)$/u.exec(affirmative)?.[1]
    ?? /^(?:is|was) (?:the )?timer (?:on|off|active|armed) for (?:the )?(.+)$/u.exec(affirmative)?.[1];
  const readSubject = timerSubject
    ?? /^(?:please )?(?:what (?:is|was) (?:the )?(?:(?:currently )?reported |current )?(?:status|state|brightness|power) of|(?:show|check|read) (?:me )?(?:the )?(?:status|state|brightness|power) (?:of|for)) (?:the )?(.+)$/u.exec(affirmative)?.[1]
    ?? /^(?:please )?(?:show|check|read) (?:me )?(?:the )?(?:currently )?(?:reported )?(?:status|state|brightness|power) (?:of|for) (?:the )?(.+)$/u.exec(affirmative)?.[1]
    ?? /^(?:please )?(?:show|check|read) (?:me )?(?:the )?(.+?) (?:status|state|brightness|power)$/u.exec(affirmative)?.[1]
    ?? /^(?:please )?(?:(?:list|show|check|read) (?:the )?(.+)|(?:is|was|are|were) (?:the )?(.+?) (?:on|off|available))$/u.exec(affirmative)?.slice(1).find(value => value !== undefined);
  const subject = readSubject ?? powerSubject(text);
  if (subject === undefined || remainder !== undefined && deviceGroup(subject) !== undefined) return undefined;
  const id = exactControlIds(opening).find(id => literalDeviceId(`id:${id}`) === id && normalizedControlText(`id:${id}`) === subject);
  return id === undefined ? subject : `id:${id}`;
}

function matchesCatalogSubject(subject: string | undefined, id: string): boolean {
  return subject !== undefined && (literalDeviceId(subject) === id || subject === normalizedControlText(id));
}

function deviceGroup(subject: string | undefined): AssistantDeviceOwner | undefined {
  if (/^(?:all (?:wemo )?plugs|wemo plugs)$/u.test(subject ?? '')) return ASSISTANT_WEMO_OWNER;
  if (/^(?:all (?:lifx )?lights|lifx lights)$/u.test(subject ?? '')) return ASSISTANT_LIGHT_OWNER;
  return undefined;
}

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
type Next = 'ask' | 'tool' | 'approve' | 'act' | 'await' | 'turn' | 'end';
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
  readonly #history = new DeviceHistoryPages(() => this.options.deviceHistory);
  readonly #historyTimeZone: string;
  readonly #subscriptions: Subscription[] = [];
  readonly #graph;
  readonly #deviceDisplay: DeviceReadDisplay;
  #powerLimits: ReturnType<typeof followPowerLimits> | undefined;
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
    this.spend = new SpendLedger(context.database(), options.prices ?? {}, () => context.clock.now(), options.timeZone, options.monthlyLimitMicros, options.provider?.name === 'openai' || options.alternateProvider?.name === 'openai');
    this.#historyTimeZone = options.historyTimeZone ?? this.spend.timeZone;
    this.titles = new ConversationTitles(context.database(), {outbox, spend: this.spend, now: () => context.clock.now(), after: (ms, callback) => context.scheduler.after(ms, callback),
      provider: () => options.syntheticTitleProvider,
      previousTitle: (conversationId, profile, title) => {
        const fields = this.#fields(profile, 'title', 'synthetic');
        return fields('conversation', 'label', conversationId) && (title?.source !== 'generated' || !canRevokeFields(options.share)) ? title : null;
      },
      messages: conversationId => {
        const profile = this.store.messages.conversation(conversationId)?.profile;
        if (profile == null) return [];
        const fields = this.#fields(profile, 'title', 'synthetic');
        return fields('conversation', 'text', conversationId) ? this.store.titleMessages(conversationId, 8, message =>
          fields('conversation', 'text', message.id) && this.store.task(message.taskId)?.supervisor?.provider !== 'openai' && (message.role === 'owner' ||
            this.#jobMessageAllowed(message, fields) &&
            this.#replayable(message.taskId, fields) && this.#replayable(message.taskId, this.#modelFields(profile)))) : [];
      }, reported: conversationId => this.store.report(conversationId).sequence > 0,
      metadata: (conversationId, title, observedAtMs) => observationDraft(titleObservationOf(conversationId, title, observedAtMs))});
    this.#allowed = [...(options.tools ?? [])];
    const instant = localInstant(this.spend.timeZone);
    this.#deviceDisplay = {instant, powerLimit: (id, nowMs) => describePowerLimit(this.#powerLimits?.forPlug(id), nowMs, instant)};
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
      .addConditionalEdges('turn', state => state.next, {ask: 'ask', tool: 'tool', approve: 'approve', act: 'act', turn: 'turn', end: END})
      .addEdge('ask', 'answered').addEdge('answered', 'turn').addEdge('tool', 'turn').addEdge('approve', 'act')
      // An approved delegation waits for the worker's word before the next turn; every other act goes straight back to the model.
      .addConditionalEdges('act', state => state.next === 'await' || state.next === 'end' ? state.next : 'turn', {await: 'await', turn: 'turn', end: END})
      .addEdge('await', 'delivered').addConditionalEdges('delivered', state => state.next, {turn: 'turn', end: END})
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
  #providerFor(profile: AssistantProfile, selected?: AssistantProvider): ModelProvider {
    const primary = this.provider(profile);
    const provider = selected === undefined || selected === primary.name ? primary : this.options.alternateProvider;
    if (provider !== undefined && provider.available !== false && (selected === undefined || selected === provider.name)) return provider;
    return fail('unavailable');
  }
  #identity(provider: ModelProvider): SupervisorIdentity {
    const {name, model, variant = ''} = provider;
    const pricing = name === 'synthetic' ? undefined : this.spend.pricing(model, name);
    if (name !== 'synthetic' && pricing === undefined) fail('unavailable');
    return {provider: name, model, variant, ...(pricing === undefined ? {} : {pricing})};
  }
  #pinnedProvider(profile: AssistantProfile, pin: SupervisorIdentity | undefined): ModelProvider {
    if (pin === undefined) return fail('unavailable');
    const provider = this.#providerFor(profile, pin.provider);
    if (provider.model !== pin.model || (provider.variant ?? '') !== pin.variant) return fail('unavailable');
    return provider;
  }
  #taskProvider(task: Task): ModelProvider {
    const expected = task.supervisor?.provider === 'openai' ? RESPONSES_GRAPH_VERSION : GRAPH_VERSION;
    if (task.graphVersion !== expected) return fail('unavailable');
    return this.#pinnedProvider(task.profile, task.supervisor);
  }
  #canUseTaskProvider(task: Task): boolean {
    try {this.#taskProvider(task); return true;} catch (error) {
      if (error instanceof Fault && error.code === 'unavailable') return false;
      throw error;
    }
  }
  inspect(): AssistantState {
    const provider = this.provider();
    const queues = this.#queues();
    const alternate = this.options.alternateProvider;
    const providers = alternate === undefined ? [provider] : [provider, alternate];
    const tasks = this.store.latest().filter(task => this.#publicRead(task.profile).task(task.conversationId, task.id));
    const versioned = providers.some(item => item.name === 'openai') || tasks.some(task => task.supervisor?.provider === 'openai');
    return {id: 'assistant', ...this.store.meta(), available: this.available() && providers.some(item => item.available !== false), provider: provider.name, model: provider.model, tools: [...this.#allowed],
      ...(versioned ? {providers: providers.filter(item => item.available !== false).map(item => ({provider: item.name, model: item.model}))} : {}),
      tasks: tasks.map(task => {
        const summary = this.store.summary(task), pin = task.supervisor;
        return versioned && pin !== undefined ? {...summary, supervisor: {provider: pin.provider, model: pin.model}} : summary;
      }), ...(queues.length === 0 ? {} : {queues})};
  }
  /** An assistant-state draft waiting to publish can outlive the read grants that allowed its contents. */
  matchesPublicState(data: object): boolean {return isDeepStrictEqual(data, this.inspect());}
  #publicRead(profile: AssistantProfile) {
    const discover = this.#fields(profile, 'discovery', 'private-conversation');
    const read = this.#fields(profile, 'read', 'private-conversation');
    return {discover, read, task: (conversationId: string, taskId: string) =>
      discover('conversation', 'index', conversationId) && read('conversation', 'text', conversationId)
      && discover('conversation', 'index', taskId) && read('conversation', 'details', taskId) && read('conversation', 'status', taskId)};
  }
  /** Each profile's current conversation whose queue holds messages (Hub #2030): how many, and whether and why it is held. */
  #queues(): AssistantQueueSummary[] {
    return profiles.flatMap(owner => {
      const conversationId = this.store.conversation(owner);
      if (conversationId === undefined) return [];
      const {discover, read} = this.#publicRead(owner);
      if (!discover('conversation', 'index', conversationId)) return [];
      const stored = this.store.queue.messages(conversationId);
      const messages = stored.filter(message => discover('conversation', 'index', message.id) && read('conversation', 'text', message.id)).length;
      if (messages === 0) return [];
      const hold = messages === stored.length && read('conversation', 'details', conversationId) ? this.store.queue.hold(conversationId) : null;
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
          const wemoReceipt = this.store.confirmations(task.id).some(watch => watch.dispatchState !== undefined);
          if (!wemoReceipt && this.#brightnessReceipt(task) === undefined && (!this.available() || !this.#canUseTaskProvider(task))) await this.#recoverUnavailable(task.id);
          else await this.#reconcile(task.id, true);
        } catch (error) {
          this.#unrecovered.add(task.conversationId);
          try {await this.#recoverUnavailable(task.id, closingReasonOf(error), true);} catch { /* A failed write cannot claim a saved transition. */ }
        }
      }
      // Unread steers of a task that already finished, which only a return to an earlier release that ignores them can
      // leave, go back to the head of their queue and wait there held, as a start's reconciliation returns them (Hub #2031).
      const left = this.store.queue.steerTasks().filter(entry => {const owner = this.store.task(entry.taskId); return owner === undefined || terminal(owner.status);});
      if (left.length > 0) {
        await this.outbox.transaction(() => {
          for (const entry of left) {
            this.store.queue.returnSteers(entry.taskId, this.context.clock.now(), this.store.task(entry.taskId)?.supervisor);
            if (this.store.queue.hold(entry.conversationId) === null) this.store.queue.setHold(entry.conversationId, {reason: 'restart', code: null, detail: null});
          }
        });
      }
      const unpinnedQueues = profiles.map(profile => this.store.conversation(profile)).filter((id): id is string => {
        if (id === undefined || this.store.queue.hold(id) !== null) return false;
        const head = this.store.queue.messages(id)[0];
        return head !== undefined && head.supervisor === undefined;
      });
      if (unpinnedQueues.length > 0) {
        await this.outbox.transaction(() => {
          for (const conversationId of unpinnedQueues) {
            this.store.queue.setHold(conversationId, {reason: 'refused', code: 'unavailable', detail: 'This queued message has no saved supervisor.'});
          }
        });
      }
      // A queue counts as changed wherever its conversation changed at the start (Hub #2030), and a queue the start held
      // changed at the start: a revision records it, so a queue command read before is stale.
      this.store.queue.aligned();
      if (this.store.queue.changed() || canRevokeFields(this.options.share)) {
        await this.outbox.transaction(add => {this.#publish(add);});
      }
    } finally {this.#starting = false;}
    if (this.#allowed.includes(READ_WEMO) || this.#allowed.includes(READ_DEVICES)) this.#powerLimits = followPowerLimits(this.context);
    for (const watch of this.store.confirmations()) void this.#followConfirmation(watch);
    this.#subscriptions.push(await this.context.sdk.respond<AssistantControl | ContinueCodingControl>('bunny.cmd.assistant-control.assistant', command =>
      command.data.action === 'continue-coding-job' ? this.#continueCoding({...command, data: command.data}) : this.#control({...command, data: command.data})));
    this.#subscriptions.push(await this.context.sdk.respond<AssistantInput>('bunny.cmd.assistant-input.assistant', command => this.#input(command)));
  }
  async stop(): Promise<void> {
    this.#closed = true;
    this.#powerLimits?.stop();
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
      if (finished !== undefined) {
        for (const watch of this.store.confirmations(finished.id)) {
          if (watch.dispatchState !== undefined) void this.#followConfirmation(watch);
        }
        this.#checkTitle(finished, {kind: 'task', result: finished.status as 'succeeded' | 'failed' | 'cancelled'});
      }
      if (next !== undefined && !this.#closed && !this.context.signal.aborted) this.#launch(next);
    });
  }
  /**
   * Asks the title model to check a conversation's title after a task finished or a major event (Hub #2075), beside the
   * task and after the commit that recorded the event; the check never delays, fails or rolls back the task.
   */
  #checkTitle(task: Pick<Task, 'conversationId' | 'profile' | 'id'>, event: TitleEvent, allowed?: () => boolean): void {
    if (this.#closed || this.#starting || this.context.signal.aborted) return;
    const saved = this.store.task(task.id);
    if (saved?.supervisor === undefined) return;
    if (saved.supervisor.provider === 'synthetic') {
      if (this.options.syntheticTitleProvider !== undefined) void this.titles.check(task.conversationId, task.profile, event, undefined, allowed);
      return;
    }
    const openai = saved.supervisor.provider === 'openai';
    const provider = openai ? this.options.openAITitleProvider : this.options.titleProvider;
    if (provider === undefined || openai && provider.model !== saved.supervisor.model) return;
    if (provider.name === 'synthetic') return;
    const pricing = openai ? saved.supervisor.pricing : this.spend.pricing(provider.model, provider.name);
    if (pricing === undefined) return;
    const messages = () => {
      const current = this.store.task(task.id);
      if (current === undefined) return [];
      const {request, requestId, recent, fields} = this.#supervisorScope(current, 'title');
      if (!fields('conversation', 'request', requestId)) return [];
      return [...recent.filter(message => fields('conversation', 'excerpt', message.id)).map(message => ({role: 'owner' as const, text: message.text})),
        {role: 'owner' as const, text: request}];
    };
    void this.titles.check(task.conversationId, task.profile, event, {provider, pricing, messages, firstTitleOnly: openai}, allowed);

  }
  /**
   * Returns the task's unread steers to the head of its conversation's queue in the open transaction (Hub #2031), when
   * its turn closes or is stopped. Steers a start's reconciliation returns wait in a held queue: a start starts no work.
   */
  #returnSteers(task: Task): void {
    if (this.store.queue.returnSteers(task.id, this.context.clock.now(), task.supervisor) === 0) return;
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
  #confirmationReply(taskId: string, messageId: string, reply: string, selected?: (watch: Confirmation) => boolean): string {
    const all = this.store.confirmations(taskId);
    const watches = selected === undefined ? all : all.filter(selected);
    const updates: string[] = [];
    for (const watch of watches) {
      const update = confirmationText(watch);
      if (watch.result !== undefined || watch.dispatchState === 'reserved') {
        for (const earlier of [pending(watch), pending({...watch, sent: true})]) {
          if (earlier !== update) reply = reply.replace(earlier, update);
        }
        this.store.dropConfirmation(watch.requestId);
      } else this.store.saveConfirmation({...watch, follows: watch.follows ?? messageId});
      if (!reply.includes(update)) updates.push(update);
    }
    const operations = new Set(watches.filter(watch => watch.dispatchState !== undefined).map(watch => watch.questionId));
    const skipped = new Set([...operations].flatMap(id => this.store.call(id)?.action?.control?.contextTargets ?? []));
    for (const target of skipped) {
      const text = `${target}: No power command was sent.`;
      if (!reply.includes(text)) updates.push(text);
    }
    return [reply, ...updates].filter(Boolean).join('\n\n');
  }

  #followConfirmation(watch: Confirmation): Promise<void> {
    if (this.#closed || watch.result !== undefined || watch.dispatchState === 'reserved') return Promise.resolve();
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
          const receipt = this.store.call(current.requestId);
          if (this.store.savedMessage(task.id, current.follows) !== undefined &&
              (receipt?.directBrightness !== true || this.#canReadBrightnessReceipt(task, receipt))) {
            this.store.message(task, `${current.requestId}-confirmation`, 'assistant', confirmationText(current, evidence.result), this.context.clock.now(), current.follows);
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

  async #waitForConfirmations(watches: readonly Confirmation[], ms: number, signal: AbortSignal): Promise<void> {
    const following = Promise.all(watches.map(watch => this.#followConfirmation(watch)));
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
  canSpeak(taskId: string, messageId: string): boolean {
    const task = this.store.task(taskId);
    const message = this.store.savedMessage(taskId, messageId);
    if (task === undefined || task.localJobStatus !== undefined || message?.role !== 'assistant' || !spokenAloud(task.profile)) return false;
    const read = this.#fields(task.profile, 'read', 'private-conversation'), speech = this.#fields(task.profile, 'read', 'conversation-speech');
    const allowed: FieldAccess = (source, field, record) => read(source, field, record) && speech(source, field, record);
    const receipt = this.#brightnessMessage({...message, taskId});
    if (receipt !== undefined && (!this.#canReadBrightnessReceipt(task, receipt.call) ||
        !speech('operations', 'details', receipt.call.id))) return false;
    return allowed('conversation', 'text', task.conversationId) && allowed('conversation', 'text', messageId) &&
      this.#jobMessageAllowed({...message, taskId}, allowed) && this.#savedDisclosureAllowed(taskId, allowed);
  }
  /**
   * Offers one durable assistant message to be spoken through the companions speech endpoint. Text over the browser driver's
   * bound stays on the page unspoken rather than cut; the coordinator decides availability, Quiet and one-at-a-time.
   */
  #speak(taskId: string, messageId: string, text: string, parent: TraceContext, key = messageId): void {
    if (this.options.speak === undefined || this.#closed || this.context.signal.aborted || text.trim() === '' || text.length > LIMITS.spokenChars) return;
    try {
      const task = this.#task(taskId);
      if (!this.canSpeak(taskId, messageId)) return;
      this.options.speak({taskId, messageId, text, validUntilMs: this.context.clock.now() + SPOKEN_REPLY_TTL_MS}, key, parent, task.conversationId);
    }
    catch { /* Speech is an output of the saved message, never a condition of it. */ }
  }
  #ready(): void {if (!this.store.meta().enabled || !this.available()) fail('unavailable');}
  #activate(task: Task, parent: TraceContext, settling = false): void {
    this.#ready();
    if (this.#unrecovered.has(task.conversationId)) fail('unavailable');
    if (settling ? this.#busy(task.conversationId) : this.#active.has(task.conversationId)) fail('capacity');
    if (task.version !== 1) fail('unavailable');
    this.#taskProvider(task);
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
    const question = statusQuestion(head.text);
    if (question !== undefined && this.store.meta().enabled && !this.#unrecovered.has(conversationId)) {
      this.#localJobStatus(head.profile, head.text, question, head.supervisor);
      this.store.queue.remove(head.id);
      return this.#dispatch(conversationId);
    }
    const refusal = this.#startRefusal(head.profile, conversationId, head.supervisor);
    if (refusal !== undefined) {
      if (refuse) throw refusal;
      this.store.queue.setHold(conversationId, {reason: 'refused', code: refusal.code, detail: refusal.closingReason ?? null});
      return undefined;
    }
    const pin = head.supervisor ?? fail('unavailable');
    const task = this.store.newTask(head.profile, head.text, pin, head.updatedAtMs);
    this.store.message(task, `${task.id}-prompt`, 'owner', head.text, this.context.clock.now());
    this.#activate(task, {traceparent: head.traceparent}, true);
    this.store.save(task);
    this.store.queue.remove(head.id);
    return task.id;
  }
  /** Why the conversation's next message cannot start now, checked before anything is written, or undefined when it can. */
  #startRefusal(owner: AssistantProfile, conversationId: string, pin?: SupervisorIdentity): Fault | undefined {
    if (!this.store.meta().enabled || !this.available() || this.#unrecovered.has(conversationId)) return new Fault('unavailable');
    if (this.store.conversation(owner) !== conversationId) return new Fault('invalid-state');
    if (pin === undefined) return new Fault('unavailable', 'This queued message has no saved supervisor.');
    // A paid profile's message meets the spend limits as a new message does; synthetic turns cost nothing.
    let paid: ModelProvider;
    try {paid = this.#pinnedProvider(owner, pin);} catch {return new Fault('unavailable');}
    const reached = paid.name === 'synthetic' ? undefined : this.spend.reached(paid.model, pin?.pricing);
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
  #continueCoding(command: Command<ContinueCodingControl>): Promise<Reply> {
    let committed: (() => void) | undefined;
    return this.#admit(command, digest(command.data), () => {
      const continuation = this.options.continueCodingJob?.(command.data, command) ?? fail('unavailable');
      if ('code' in continuation) throw new Fault(continuation.code, continuation.detail);
      committed = continuation.committed;
      return undefined;
    }).then(reply => {
      if (!('error' in reply)) committed?.();
      return reply;
    });
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
        if (!this.canSpeak(data.taskId ?? fail('invalid-request'), message.id)) fail('forbidden');
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
        const watches = this.store.confirmations(task.id);
        for (const watch of watches) {
          if (watch.dispatchState === undefined && watch.follows === undefined) this.store.dropConfirmation(watch.requestId);
        }
        const messageId = `${task.id}-closing-${String(task.generation)}`;
        const receipt = this.#confirmationReply(task.id, messageId, '', watch => watch.dispatchState !== undefined);
        if (receipt !== '') this.store.message(task, messageId, 'assistant', receipt, this.context.clock.now());
        return undefined;
      }
      if (!['paused', 'uncertain', 'waiting'].includes(task.status) || (task.question !== null && task.question.answer === null)) fail('invalid-state');
      this.#activate(task, command); this.store.save(task); return task.id;
    }).then(reply => {
      if (renamed !== undefined && !('error' in reply)) this.titles.drop(renamed);
      const active = [...this.#active.values()].find(run => run.taskId === command.data.taskId);
      if (command.data.action === 'cancel' && !('error' in reply) && active !== undefined) active.controller.abort();
      // A cancelled task has finished, so the title model checks the conversation's title (Hub #2075).
      if (cancelled !== undefined && !('error' in reply)) {
        for (const watch of this.store.confirmations(cancelled.id)) {
          if (watch.dispatchState !== undefined) void this.#followConfirmation(watch);
        }
        this.#checkTitle(cancelled, {kind: 'task', result: 'cancelled'});
      }
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
      const jobAction = object(value) && (value.action === 'stop-coding-job' || value.action === 'message-coding-job' || value.action === 'open-native-terminal' || value.action === 'open-claude-desktop');
      if (jobAction) {
        const messaging = value.action === 'message-coding-job';
        const keys = messaging ? ['action', 'jobId', 'operationId', 'text'] : ['action', 'jobId', 'operationId'];
        if (Object.keys(value).some(key => !keys.includes(key)) || typeof value.jobId !== 'string' || !CODING_JOB_ID.test(value.jobId) ||
          typeof value.operationId !== 'string' || !QUEUED_ID.test(value.operationId) || messaging &&
          (typeof value.text !== 'string' || value.text.trim() === '' || textBytes(value.text) > 4096)) fail('invalid-request');
      }
      // Editing a queued message (Hub #2030) runs no work either, so it is admitted while conversation is off.
      if (!fresh && !jobAction && !(object(value) && value.action === 'edit-queued')) this.#ready();
      if (fresh && (Object.keys(value).some(key => !['action', 'profile', 'expectedRevision'].includes(key)) || !profile(value.profile) ||
        typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) fail('invalid-request');
      if (!fresh && !jobAction && (!object(value) || Object.keys(value).some(key => !['action', 'profile', 'text', 'expectedRevision', 'taskId', 'questionId', 'queuedId', 'harness', 'destination', 'requirements', 'provider'].includes(key)) ||
        !profile(value.profile) || !['start', 'answer', 'queue', 'edit-queued', 'steer'].includes(String(value.action)) || typeof value.text !== 'string' || value.text.trim() === '' || textBytes(value.text) > LIMITS.inputBytes ||
        typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) fail('invalid-request');
      // A steer names the turn it expects (Hub #2031), and with a question the one it skips or declines.
      if (!fresh && !jobAction && (value.action === 'answer' ? typeof value.taskId !== 'string' || typeof value.questionId !== 'string' || value.queuedId !== undefined
        : value.action === 'steer' ? typeof value.taskId !== 'string' || !(value.questionId === undefined || typeof value.questionId === 'string') || value.queuedId !== undefined
          : value.action === 'edit-queued' ? value.taskId !== undefined || value.questionId !== undefined || typeof value.queuedId !== 'string' || !QUEUED_ID.test(value.queuedId)
            : value.taskId !== undefined || value.questionId !== undefined || value.queuedId !== undefined)) fail('invalid-request');
      if (object(value) && (value.harness !== undefined || value.destination !== undefined || value.requirements !== undefined)) {
        if (value.action !== 'start' && (value.action !== 'answer' || value.text !== 'approve')) fail('invalid-request');
        if (value.harness !== undefined && !codingChoice(value.harness)) fail('invalid-request');
        if (value.destination !== undefined && !codingDestinationChoice(value.destination)) fail('invalid-request');
        if (value.requirements !== undefined && !codingRequirements(value.requirements)) fail('invalid-request');
      }
      if (!fresh && !jobAction && value.provider !== undefined && (!['start', 'queue'].includes(String(value.action)) ||
        (value.provider !== 'anthropic' && value.provider !== 'openai'))) fail('invalid-request');
      const input = (fresh ? {...value, text: ''} : value) as Stage['input'];
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
  #localJobStatus(profile: AssistantProfile, text: string, jobId: string | null, supervisor?: SupervisorIdentity): void {
    const now = this.context.clock.now();
    const task = this.store.newTask(profile, 'Private owner question.', supervisor);
    const job = jobId === null ? undefined : this.options.readJobStatus?.(jobId);
    const visible = job !== undefined && job.jobId === jobId && job.companion === profile && job.conversationId === task.conversationId
      ? {jobId: job.jobId, operationId: job.operationId, status: job.status} : undefined;
    task.localJobStatus = {question: text, ...(visible === undefined ? {} : {visible})};
    task.status = 'succeeded';
    // Shared message records, including knowledge exports and provider context, contain no job reference or result.
    this.store.message(task, `${task.id}-private-question`, 'owner', task.prompt, now);
    this.store.message(task, `${task.id}-private-status`, 'assistant', 'Private owner reply.', now);
    this.store.save(task);
  }
  #privateJobText(profile: AssistantProfile, conversationId: string | undefined, message: MessageSource): string | undefined {
    if (!privateJobMessage(message)) return undefined;
    const task = this.store.task(message.taskId), receipt = task?.localJobStatus, saved = receipt?.visible;
    if (task?.profile !== profile || task.conversationId !== conversationId || receipt === undefined ||
        !this.#publicRead(profile).task(conversationId, task.id)) return undefined;
    const unavailable = message.role === 'owner' ? undefined : 'No readable coding job with that ID was found in this conversation.';
    if (saved === undefined) return message.role === 'assistant' && statusQuestion(receipt.question) === null
      ? 'Ask about one coding job by its full ID in a separate status question.' : unavailable;
    const current = this.options.readJobStatus?.(saved.jobId);
    if (current?.jobId !== saved.jobId || current.companion !== profile || current.conversationId !== conversationId) return unavailable;
    if (current.operationId !== saved.operationId && !this.canReadCodingJob(profile, {...current, operationId: saved.operationId})) return unavailable;
    if (message.role === 'owner') return receipt.question;
    if (current.operationId !== saved.operationId) return 'The current attempt changed after this question. Ask again for its status.';
    return `Coding job ${saved.jobId}, attempt ${saved.operationId}, had reported status “${saved.status}” when you asked.`;
  }
  #input(command: Command<AssistantInput>): Promise<Reply> {
    let titled: {id: string; conversationId: string; profile: AssistantProfile; event: TitleEvent} | undefined;
    let jobCommitted: (() => Promise<void>) | undefined;
    return this.#admit(command, digest(command.data), () => {
      const staged = this.store.input(command.data.inputRef) ?? fail('invalid-request');
      if (staged.requestId !== command.data.requestId) fail('invalid-request');
      if (staged.expires <= this.context.clock.now()) fail('expired');
      const input = staged.input, now = this.context.clock.now();
      if (input.action === 'open-native-terminal' || input.action === 'open-claude-desktop') {
        const action = this.options.openNativeClient?.({...input, requestId: command.data.requestId}, command) ?? fail('unavailable');
        if ('code' in action) fail(action.code);
        jobCommitted = action.committed;
        this.store.discard(staged.ref);
        return undefined;
      }
      if (input.action === 'message-coding-job') {
        const message = this.options.messageCodingJob?.({...input, requestId: command.data.requestId}, command) ?? fail('unavailable');
        if ('code' in message) fail(message.code);
        jobCommitted = message.committed;
        this.store.discard(staged.ref);
        return undefined;
      }
      if (input.action === 'stop-coding-job') {
        const stop = this.options.stopCodingJob?.(input.jobId, input.operationId) ?? fail('unavailable');
        if ('code' in stop) fail(stop.code);
        jobCommitted = stop.committed;
        this.store.discard(staged.ref);
        return undefined;
      }
      if (input.action !== 'new-conversation' && input.action !== 'edit-queued') this.#ready();
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
        this.store.queue.add({id: command.data.requestId, conversationId, profile: input.profile, text: input.text, queuedAtMs: now, updatedAtMs: now, traceparent: command.traceparent,
          supervisor: this.#identity(this.#providerFor(input.profile, input.provider))});
        // A queue with nothing to wait behind starts its message at once.
        return this.#dispatch(conversationId);
      }
      if (input.action === 'answer' && statusQuestion(input.text) !== undefined) fail('invalid-request');
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
        const question = statusQuestion(input.text);
        if (question !== undefined) {
          this.#localJobStatus(input.profile, input.text, question, this.#identity(this.#providerFor(input.profile, input.provider)));
          this.store.discard(staged.ref);
          return undefined;
        }
        // A new turn of a paid profile is refused, its reply naming why, when what remains of the daily limit or the month's
        // estimate is below the smallest first call, so it is not admitted only to fail there; synthetic turns cost nothing.
        const paid = this.#providerFor(input.profile, input.provider), pin = this.#identity(paid);
        const reached = paid.name === 'synthetic' ? undefined : this.spend.reached(paid.model, pin.pricing);
        if (reached !== undefined) throw new Fault('capacity', reached);
        task = this.store.newTask(input.profile, input.text, pin);
        if (input.harness !== undefined || input.destination !== undefined || input.requirements !== undefined) {
          task.codingPreference = {harness: input.harness ?? 'auto', destination: input.destination ?? 'auto',
            ...(input.requirements === undefined ? {} : {requirements: input.requirements})};
        }
        this.store.message(task, `${task.id}-prompt`, 'owner', input.text, this.context.clock.now());
        // The first message of an untitled conversation earns it a model-written title (Hub #2025, #2075).
        if (this.titles.started(task.conversationId)) titled = {id: task.id, conversationId: task.conversationId, profile: task.profile, event: {kind: 'message'}};
      } else {
        task = this.#task(input.taskId ?? fail('invalid-request'));
        if (!['waiting', 'paused'].includes(task.status) || task.profile !== input.profile || task.question === null || task.question.id !== input.questionId || task.question.answer !== null) fail('invalid-state');
        // An approval is answered only by the two literal decisions, so free text can neither apply nor dismiss a proposal; a delegation is answered by the worker alone.
        if (task.question.kind === 'delegation') fail('invalid-state');
        if (task.question.kind === 'approval' && !['approve', 'decline'].includes(input.text)) fail('invalid-request');
        if (input.harness !== undefined || input.destination !== undefined || input.requirements !== undefined) {
          if (task.question.proposal?.family !== 'coding-dispatch') fail('invalid-request');
          if (input.harness !== undefined) task.question.codingChoice = input.harness;
          if (input.destination !== undefined) task.question.codingDestination = input.destination;
          if (input.requirements !== undefined) task.question.codingRequirements = input.requirements;
        }
        task.question.answer = input.text;
        this.store.message(task, `${task.question.id}-answer`, 'owner', input.text, this.context.clock.now());
        // An answered approval is a major event for the conversation's title (Hub #2075), named by its tool and decision.
        if (task.question.kind === 'approval' && task.question.proposal !== null) {
          titled = {id: task.id, conversationId: task.conversationId, profile: task.profile,
            event: {kind: 'approval', tool: proposalTool(task.question.proposal), decision: input.text === 'approve' ? 'approved' : 'declined'}};
        }
      }
      this.#activate(task, command); this.store.save(task); this.store.discard(staged.ref); return task.id;
    }).then(reply => {
      // The title check runs beside the task, after its admission committed; it never delays, fails or rolls back the task.
      if (!('error' in reply)) {
        if (titled !== undefined) this.#checkTitle(titled, titled.event);
        if (jobCommitted !== undefined) void jobCommitted().catch(() => {
          recordLog(this.context.log, 'message.received', {'bunny.operation': 'storage', 'bunny.outcome': Outcome.uncertain, 'bunny.code': 'internal'}, command);
        });
      }
      return reply;
    });
  }
  /**
   * Steers the conversation's unfinished task with a new message (Hub #2031), in the input's transaction. The steer names
   * the turn it expects, as Codex's `expected_turn_id`. A steer that reaches that turn after it ended, while it is still
   * the conversation's latest turn, arrived after its last model call, so it becomes the next queued message, as one the
   * turn's close returned does, and starts at once unless the queue is held; after Stop it holds the queue, as the steers
   * Stop returned do. A steer aimed at any other turn, one a newer
   * turn followed or another conversation's, is stale: it is refused with `invalid-state`, and nothing retries it. Its text is saved at once and taken into the task's own
   * transcript just before its next model call; it never bumps the task's generation, so the running call goes on.
   * During an approval, or when fewer than two model calls remain in the turn's limits, the text is queued instead. With
   * `questionId`, Skip question and send answers a clarification with `SKIPPED`, and Decline with message declines an
   * approval, then steers the task, which resumes in the same commit. A steer runs no title check; a declined approval
   * is still the title's major event.
   */
  #steer(input: StagedInput, command: Command<AssistantInput>, now: number): {launch: string | undefined; titled?: {id: string; conversationId: string; profile: AssistantProfile; event: TitleEvent}} {
    // The expected turn, not the conversation's revision, decides whether a steer is stale: the running task's own steps
    // move that revision. A revision the assistant has not reached is still refused.
    if (input.expectedRevision > this.store.meta().revision) fail('revision-conflict');
    const conversationId = this.store.conversation(input.profile), task = input.taskId === undefined ? undefined : this.store.task(input.taskId);
    if (task === undefined || conversationId === undefined || task.conversationId !== conversationId || task.profile !== input.profile) fail('invalid-state');
    if (this.#unrecovered.has(conversationId)) fail('unavailable');
    if (terminal(task.status)) {
      if (input.questionId !== undefined || this.store.latest().find(entry => entry.conversationId === conversationId)?.id !== task.id) fail('invalid-state');
      if (this.store.queue.count(conversationId) >= LIMITS.queueBound) throw new Fault('capacity', QUEUE_FULL);
      this.store.queue.prepend([{id: command.data.requestId, conversationId, profile: task.profile, text: input.text, queuedAtMs: now, updatedAtMs: now, traceparent: command.traceparent,
        ...(task.supervisor === undefined ? {} : {supervisor: task.supervisor})}]);
      // After Stop it waits in the held queue, as the steers Stop returned do, so Stop never ends in new work.
      if (task.status === 'cancelled' && this.store.queue.hold(conversationId) === null) this.store.queue.setHold(conversationId, {reason: 'stop', code: null, detail: null});
      return {launch: this.#dispatch(conversationId)};
    }
    const asked = task.question !== null && task.question.answer === null ? task.question : null;
    // The text becomes a queued message, keyed as a steer is by this request ID: it waits for the task to end.
    const queued = (): void => {
      if (!this.store.queue.room(conversationId)) throw new Fault('capacity', QUEUE_FULL);
      this.store.queue.add({id: command.data.requestId, conversationId, profile: task.profile, text: input.text, queuedAtMs: now, updatedAtMs: now, traceparent: command.traceparent,
        ...(task.supervisor === undefined ? {} : {supervisor: task.supervisor})});
    };
    const steered = (): void => {
      if (this.#remainingCalls(task) < 2) {queued(); return;}
      if (!this.store.queue.steerRoom(conversationId)) throw new Fault('capacity', STEERS_FULL);
      this.store.queue.addSteer({id: command.data.requestId, taskId: task.id, conversationId, profile: task.profile, text: input.text, savedAtMs: now, traceparent: command.traceparent});
    };
    if (statusQuestion(input.text) !== undefined) {
      if (input.questionId !== undefined) fail('invalid-request');
      queued();
      return {launch: undefined};
    }
    if (input.questionId !== undefined) {
      // A delegation is answered by the worker alone, so only a clarification or an approval can be set aside.
      if (asked === null || asked.id !== input.questionId || asked.kind === 'delegation' || !['waiting', 'paused'].includes(task.status)) fail('invalid-state');
      let titled: {id: string; conversationId: string; profile: AssistantProfile; event: TitleEvent} | undefined;
      if (asked.kind === 'approval') {
        asked.answer = 'decline';
        this.store.message(task, `${asked.id}-answer`, 'owner', 'decline', now);
        if (asked.proposal !== null) titled = {id: task.id, conversationId, profile: task.profile, event: {kind: 'approval', tool: proposalTool(asked.proposal), decision: 'declined'}};
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
  canReadLegacyCodingOperation(profile: AssistantProfile, taskId: string, operationId: string): boolean {
    const task = this.store.task(taskId), question = task?.question;
    if (task?.profile !== profile || question?.kind !== 'delegation' || !this.#matchesDelegation(taskId, question.id, operationId)) return false;
    const fields = this.#publicRead(profile);
    return fields.task(task.conversationId, taskId) && fields.discover('coding', 'index', operationId) &&
      fields.read('coding', 'details', operationId) && fields.read('coding', 'status', operationId);
  }
  canReadCodingJobBrief(profile: AssistantProfile, job: CodingJob): boolean {
    return this.canReadCodingJob(profile, job) && this.#publicRead(profile).read('coding', 'brief', job.repository);
  }
  canMessageCodingJob(profile: AssistantProfile, job: CodingJob, execution: CodingDestination = 'mac'): boolean {
    const destination = this.#fields(profile, 'brief', codingShareDestination(execution));
    return this.canReadCodingJob(profile, job) && destination('coding', 'repository', job.repository) &&
      destination('coding', 'brief', job.repository);
  }
  content(ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
    if (ref === 'spend') {
      // The shared spend of today and this month (Hub #2024): amounts and counts only, no prompt, model text or call identity.
      if (request?.signal.aborted === true || Object.keys(request?.query ?? {}).length > 0) return errorBody('invalid-request');
      try {
        const provider = this.provider();
        const view: SpendView = {...this.spend.totals(), paid: provider.name === 'synthetic' ? null
          : {model: provider.model, minimumMicros: this.spend.minimum(provider.model, this.spend.pricing(provider.model, provider.name)), prices: this.spend.source(provider.model, provider.name), pricesAsOf: provider.name === 'openai' ? '2026-11-24' : BUILT_IN_PRICES_AS_OF}};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(view))};
      } catch {return errorBody('unavailable');}
    }
    if (ref === 'assistant-context') {
      // The context preview (Hub #2029): the builder's own sections, exactly as the next call would send them.
      const query = request?.query ?? {};
      if (request?.signal.aborted === true || Object.keys(query).some(key => key !== 'profile') || !profile(query.profile)) return errorBody('invalid-request');
      try {
        const recipient = this.#fields(query.profile, 'read', 'private-conversation');
        if (!recipient('conversation', 'details')) return errorBody('forbidden');
        const {context, basis} = this.previewContext(query.profile, recipient);
        const pinned = basis.kind === 'task' ? this.store.task(basis.taskId)?.supervisor : undefined;
        const provider = pinned === undefined ? this.provider(query.profile) : {name: pinned.provider, model: pinned.model};
        const conflicts = this.options.share?.conflicts ?? 0;
        const document: ContextPreview = {schema: 'assistant-context/1.0', revision: this.store.meta().revision, profile: query.profile, conversationId: context.conversationId,
          provider: provider.name, model: provider.model, basis, sections: context.sections, ...(conflicts > 0 ? {sharingConflictCount: conflicts} : {})};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(document))};
      } catch {return errorBody('unavailable');}
    }
    if (ref !== 'conversation') return undefined;
    const query = request?.query ?? {}, selected = query.profile;
    if (request?.signal.aborted === true || !profile(selected)) return errorBody('invalid-request');
    try {
      const {discover, read, task} = this.#publicRead(selected);
      const fields = query.view === 'list' ? discover : read;
      const savedDisclosures = new Map<string, boolean>();
      const canReadSaved = (taskId: string) => {
        let allowed = savedDisclosures.get(taskId);
        if (allowed === undefined) {
          allowed = this.#savedDisclosureAllowed(taskId, read);
          savedDisclosures.set(taskId, allowed);
        }
        return allowed;
      };
      const conversationId = query.conversationId ?? this.store.conversation(selected);
      if (!fields('conversation', query.view === 'list' ? 'index' : 'text', query.view === 'list' ? undefined : conversationId)) return errorBody('forbidden');
      if (query.view === 'list') {
        // The profile's conversations (Hub #2029), the current one first, then the rest newest first, each with its title as
        // its session shows it. `after` is the keyset cursor of a later page, `<last message time or -1>:<row>`.
        const cursor = query.after === undefined ? undefined : /^(-1|\d{1,15}):(\d{1,15})$/.exec(query.after);
        if (Object.keys(query).some(key => !['profile', 'view', 'after'].includes(key)) || cursor === null) return errorBody('invalid-request');
        const listed = this.store.conversations(selected, cursor === undefined ? undefined : {last: Number(cursor[1]), row: Number(cursor[2])}, {
          conversation: id => fields('conversation', 'index', id),
          message: message => read('conversation', 'text', message.id) &&
            (message.role === 'owner' || this.#jobMessageAllowed(message, read) && canReadSaved(message.taskId)),
        });
        const document: ConversationList = {version: 1, profile: selected, older: listed.older,
          conversations: listed.conversations.map(value => {
            const id = value.conversationId;
            const allowLabel = discover('conversation', 'label', id) && read('conversation', 'label', id);
            return {...value, title: this.titles.published(id, selected, {allowLabel, allowGenerated: !canRevokeFields(this.options.share)})};
          })};
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify(document))};
      }
      if (query.view === 'queue') {
        // The current conversation's queue (Hub #2030): the waiting messages in order, with their text, the hold and the
        // revision read. With a conversation ID, an earlier conversation's messages a release before this one left there.
        if (Object.keys(query).some(key => !['profile', 'view', 'conversationId'].includes(key)) ||
          (query.conversationId !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(query.conversationId))) return errorBody('invalid-request');
        const current = this.store.conversation(selected), requested = query.conversationId ?? current;
        if (requested !== undefined && requested !== current && !this.store.owns(selected, requested)) return errorBody('not-found');
        const queue = this.store.queue.document(selected, requested, this.store.meta().revision, requested === current);
        const visible = (message: {id: string}) => discover('conversation', 'index', message.id) && fields('conversation', 'text', message.id);
        const messages = queue.messages.filter(visible), steers = queue.steers.filter(visible);
        const held = messages.length === queue.messages.length && steers.length === queue.steers.length &&
          fields('conversation', 'details', requested) ? queue.held : null;
        return {type: 'application/json', bytes: Buffer.from(JSON.stringify({...queue, held, messages, steers}))};
      }
      const visibility = {
        privateText: (message: MessageSource) => {
          const receipt = this.#brightnessMessage(message);
          return receipt !== undefined && !stoppedBeforeBrightness(receipt.call.result) && !this.#canReadBrightnessReceipt(receipt.task, receipt.call)
            ? BRIGHTNESS_DETAILS_UNAVAILABLE : this.#privateJobText(selected, conversationId, message);
        },
        shows: (message: MessageSource) => fields('conversation', 'text', message.id) &&
          (this.#privateDraftVisible(message, fields) ?? (message.role === 'owner' || this.#brightnessMessage(message) !== undefined ||
            this.#jobMessageAllowed(message, fields) && canReadSaved(message.taskId))),
        attachment: (requestId: string) => fields('artwork', 'attachment', requestId),
        task: (taskId: string) => conversationId !== undefined && task(conversationId, taskId),
      };
      if (query.view === 'recent') {
        if (Object.keys(query).some(key => !['profile', 'view', 'before', 'conversationId'].includes(key)) ||
          (query.conversationId !== undefined && !/^[A-Za-z0-9-]{1,128}$/.test(query.conversationId))) return errorBody('invalid-request');
        const page = this.store.recentPage(selected, query.before, query.conversationId, visibility);
        return typeof page === 'string' ? errorBody(page) : {type: 'application/json', bytes: Buffer.from(JSON.stringify(page))};
      }
      const after = query.after === undefined ? 0 : Number(query.after);
      if (Object.keys(query).some(key => !['profile', 'after'].includes(key)) || !Number.isSafeInteger(after) || after < 0) return errorBody('invalid-request');
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify(this.store.page(selected, after, visibility)))};
    } catch {return errorBody('unavailable');}
  }
  #config(taskId: string) {return {configurable: {thread_id: taskId}, durability: 'sync' as const, recursionLimit: 4 * LIMITS.modelCalls + 4, callbacks: []};}
  #privateDraftVisible(message: MessageSource, read: FieldAccess): boolean | undefined {
    if (message.role !== 'tool' || !message.id.startsWith(`${message.taskId}-step-`)) return undefined;
    const match = /^(.+-step-\d+)-draft-(show-[a-z0-9-]+)$/u.exec(message.id);
    if (match?.[1] === undefined || match[2] === undefined) return undefined;
    const receipt = this.store.call(match[1]);
    return receipt?.taskId === message.taskId && receipt.kind === 'tool' && read('shows', 'details', match[2]);
  }

  #brightnessReceipt(task: Task): Call | undefined {
    return this.store.calls(task.id).filter(call => call.directBrightness === true && call.status === 'succeeded' &&
      (call.result?.startsWith('accepted: ') === true || stoppedBeforeBrightness(call.result))).at(-1);
  }

  #brightnessMessage(message: MessageSource): {task: Task; call: Call} | undefined {
    if (message.role !== 'assistant' || message.id !== `${message.taskId}-result` && !message.id.endsWith('-confirmation')) return undefined;
    const task = this.store.task(message.taskId);
    if (task === undefined) return undefined;
    const call = message.id === `${task.id}-result` ? this.#brightnessReceipt(task) : this.store.call(message.id.slice(0, -'-confirmation'.length));
    return call?.directBrightness === true && call.taskId === task.id ? {task, call} : undefined;
  }

  #canReadControlSource(task: Task, messageId: string): boolean {
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    return read('conversation', 'text', task.conversationId) && read('conversation', 'text', messageId) &&
      this.store.messages.removal(messageId) === undefined && this.store.savedMessage(task.id, messageId)?.role === 'owner';
  }

  #canReadBrightnessReceipt(task: Task, call: Call): boolean {
    const control = call.action?.control;
    if (control === undefined) return false;
    const target = control.proposal.target;
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    const scope = this.#supervisorScope(task, 'supervisor', target).fields;
    return read('operations', 'details', call.id) && control.ownerMessageIds.every(id => this.#canReadControlSource(task, id)) &&
      scope('devices', 'label', target) && scope('devices', 'status', target);
  }

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
    const snapshot = this.#brightnessReceipt(this.#task(taskId)) === undefined ? await this.#graph.getState(this.#config(taskId)) : undefined;
    const values = snapshot?.values as Partial<GraphState> | undefined;
    const traceparent = this.#task(taskId).traceparent;
    let result: string | undefined;
    const publication = this.#change(taskId, task => {
      if (terminal(task.status)) return;
      if (startup) this.#restoreCodingReceipts(task);
      const brightness = this.#brightnessReceipt(task);
      // Only close a dispatch whose own checkpoint was interrupted after settlement. Older watches can outlive a steer.
      const wemoReceipt = startup && snapshot?.next.length === 1 && snapshot.next[0] === 'act' &&
        this.store.queue.steers(task.id).length === 0 && values?.step !== undefined &&
        this.store.confirmations(task.id).some(watch => watch.dispatchState !== undefined &&
          watch.questionId === `${task.id}-step-${String(values.step)}`);
      if (unresolved(this.store.calls(taskId))) {task.status = 'uncertain'; task.code = 'uncertain-result';}
      else if (brightness !== undefined) {
        task.status = 'succeeded'; task.code = null;
        const messageId = `${task.id}-result`;
        if (stoppedBeforeBrightness(brightness.result)) {
          result = BRIGHTNESS_NOT_SENT;
        } else if (!this.#canReadBrightnessReceipt(task, brightness)) {
          this.store.dropConfirmation(brightness.id);
          result = BRIGHTNESS_DETAILS_UNAVAILABLE;
        } else {
          const confirmation = this.#confirmationReply(task.id, messageId, '', watch => watch.requestId === brightness.id);
          result = confirmation === '' ? 'The brightness request was accepted. Its effect is unconfirmed.' : confirmation;
        }
        this.store.message(task, messageId, 'assistant', result, this.context.clock.now());
      } else if (wemoReceipt || snapshot?.next.length === 0 && typeof values?.result === 'string') {
        task.status = 'succeeded'; task.code = null;
        const messageId = `${task.id}-result`;
        result = this.#confirmationReply(task.id, messageId, wemoReceipt ? '' : values?.result ?? '');
        this.store.message(task, messageId, 'assistant', result, this.context.clock.now());
      } else if (snapshot?.tasks.some(pending => (pending.interrupts?.length ?? 0) > 0) === true) {
        // The turn that decided to ask saved the question before the interrupt; an interrupt without one is not evidence of a saved question.
        if (task.question === null) {task.status = 'uncertain'; task.code = 'uncertain-result';}
        else {task.status = task.question.answer === null ? 'waiting' : 'paused'; task.code = null;}
      } else {task.status = 'paused'; task.code = null;}
      if (result !== undefined && task.supervisor !== undefined && task.supervisor.provider !== 'synthetic') {
        saveFinalDisclosureProofs(this.store, task);
      }
      if (active !== undefined) this.#settle(task, active);
      if (startup) this.#finishRecoveredRun(task);
    }, active?.span.context ?? (traceparent === null ? undefined : {traceparent}));
    if (active !== undefined && this.#task(taskId).status !== 'running') this.#release(active);
    await publication;
    // Only a result this run just produced is offered; startup reconciliation never speaks an answer the owner did not just ask for.
    if (active !== undefined && result !== undefined) this.#speak(taskId, `${taskId}-result`, result, active.span.context);
  }
  #restoreCodingReceipts(task: Task): void {
    if (this.options.codingJob === undefined) return;
    for (const call of this.store.calls(task.id)) {
      if (call.kind !== 'tool' || (call.status !== 'admitted' && call.status !== 'uncertain')) continue;
      const job = this.options.codingJob(call.id);
      if (job === undefined || job.taskId !== task.id || job.conversationId !== task.conversationId) continue;
      const text = jobReceipt(job);
      this.store.saveCall({...call, status: 'succeeded', result: text, units: 0});
      task.nextOrdinal = Math.max(task.nextOrdinal, call.ordinal + 1);
      this.store.message(task, call.id, 'tool', text, this.context.clock.now());
      this.store.message(task, job.jobId, 'assistant', text.slice('accepted: '.length), this.context.clock.now());
    }
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
        if (this.#brightnessReceipt(this.#task(active.taskId)) !== undefined) {
          await this.#reconcile(active.taskId, false, active);
          return;
        }
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
  #fields(companion: AssistantProfile, purpose: ShareQuery['purpose'], destination: ShareQuery['destination'] | 'openai' = this.provider(companion).name): FieldAccess {
    if (destination === 'openai') return () => false;
    return accessFor(this.options.share, {caller: destination === 'private-conversation' || destination === 'conversation-speech' || purpose === 'brief' ? 'owner' : 'companion',
      companion, purpose, destination});
  }
  codingBriefRefusal({requestId, taskId, repository, brief}: CodingBrief, destination: CodingDestination | null = 'mac'): CodingBriefRefusal | undefined {
    const task = this.store.task(taskId);
    const receipt = this.store.call(requestId);
    const approval = receipt?.codingApproval;
    if (task === undefined || receipt?.taskId !== taskId || receipt.id !== requestId || receipt.kind !== 'tool' ||
      !Number.isSafeInteger(receipt.ordinal) || receipt.ordinal < 0 || requestId !== `${taskId}-step-${String(receipt.ordinal)}` || receipt.action === undefined ||
      approval?.destination !== 'coding-worker' || approval.repository !== repository || approval.briefDigest !== digest(brief)) {
      return 'unverified-supervisor';
    }
    return this.#codingInputsRefusal(task, repository, receipt.ordinal, destination);
  }
  #codingInputsRefusal(task: Task, repository: string, before: number, execution: CodingDestination | null): CodingBriefRefusal | undefined {
    const pin = task.supervisor;
    if (pin === undefined || pin.provider !== 'openai' && pin.provider !== 'anthropic' && pin.provider !== 'synthetic' ||
      task.graphVersion !== (pin.provider === 'openai' ? RESPONSES_GRAPH_VERSION : GRAPH_VERSION)) return 'unverified-supervisor';
    const destination = execution === null ? null : codingShareDestination(execution);
    const target = destination === null ? undefined : this.#fields(task.profile, 'brief', destination);
    if (target !== undefined && (!target('coding', 'repository', repository) || !target('coding', 'brief', repository))) return 'grant-denied';
    const share = this.options.share;
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    const discovery = this.#fields(task.profile, 'discovery', 'private-conversation');
    const model = pin.provider === 'synthetic' ? this.#modelFields(task.profile, pin.provider) : this.#supervisorScope(task, 'supervisor', undefined, this.#hostedHistory(task)).fields;
    const prompt = this.#supervisorPromptFields(task.profile);
    // Earlier call disclosures were selected for the pinned supervisor when those calls were made.
    const inputs: FieldAccess = (source, field, record) => {
      const localField = source === 'conversation' && (field === 'request' || field === 'excerpt') ? 'text' : field;
      const destinationAllows = destination === null || (destination === 'coding-worker'
        ? (share?.allowsDerived?.({caller: 'owner', companion: task.profile, purpose: 'brief', destination, source, field,
          ...(record === undefined ? {} : {record})}) ?? (share === undefined || share.revokesFields === false || target?.(source, field, record) === true))
        : target?.(source, field, record) === true);
      return destinationAllows && (localField === 'index' ? discovery : read)(source, localField, record) &&
        (source !== 'conversation' || record === undefined || this.store.messages.removal(record) === undefined) &&
        (pin.provider !== 'synthetic' && (source === 'knowledge' || source === 'preferences') ? prompt(source, field, record) : model(source, field, record));
    };
    const localOptionsAllowed = task.clarificationDevices?.every(id => discovery('devices', 'index', id) && read('devices', 'label', id) &&
      (execution === null || execution === 'mac' || target?.('devices', 'label', id) === true)) ?? true;
    return localOptionsAllowed && this.#callDisclosuresAllowed(task.id, inputs, call => call.ordinal < before,
      execution === null || execution === 'mac' ? !canRevokeFields(share) : false) ? undefined : 'grant-denied';
  }
  #historyDevices() {
    return ([ASSISTANT_LIGHT_OWNER, ASSISTANT_WEMO_OWNER] as const).flatMap(owner =>
      (this.options.devices?.(owner) ?? []).map(device => ({owner, device})));
  }
  #historyBinding(task: Task, configured?: readonly {owner: AssistantDeviceOwner; device: DeviceRecord}[]): DeviceHistoryBinding | undefined {
    const latest = task.transcript.filter(item => item.role === 'owner').at(-1);
    const requestId = latest === undefined ? `${task.id}-prompt` : conversationMessageId(task.id, latest) ?? fail('invalid-state');
    const saved = this.store.messages.get(requestId);
    const requestedAt = latest?.submittedAtMs ?? saved?.createdAtMs ?? this.context.clock.now();
    const request = requestedHistory(latest?.text ?? task.prompt, requestedAt, this.#historyTimeZone);
    if (request === undefined) return undefined;
    const local = this.#fields(task.profile, 'read', 'private-conversation');
    if (saved?.speakerId !== 'owner' || saved.conversationId !== task.conversationId ||
      this.store.messages.removal(requestId) !== undefined || !local('conversation', 'text', requestId)) {
      return {requestId, history: undefined};
    }
    const matches = (configured ?? this.#historyDevices()).filter(({device}) =>
      [device.id, deviceLabel(device)].some(value => normalizedControlText(value) === request.subject));
    const selected = matches.length === 1 ? matches[0] : undefined;
    const query = selected === undefined || request.interval === undefined ? undefined : deviceHistoryQuery({source: selected.owner, target: selected.device.id, ...request.interval});
    if (query === undefined) return {requestId, history: undefined};
    const base = {query, yesterday: request.yesterday};
    return {requestId, history: request.kind === 'timestamps' ? {...base, kind: request.kind, power: request.power} : {...base, kind: request.kind}};
  }
  #toolsFor(task: Task): ReturnType<typeof permittedTools> {
    const provider = this.#taskProvider(task);
    const tools = permittedTools(this.#allowed, provider.name === 'synthetic');
    if (provider.name === 'synthetic') return tools;
    const scope = this.#supervisorScope(task);
    if (scope.history !== undefined) return tools.filter(tool => tool.name === READ_DEVICE_HISTORY).map(tool => ({...tool,
      description: scope.history?.history?.kind === 'timestamps'
        ? 'Read observed power times for the device and interval requested by the owner. Send empty source, target and period and zero for both timestamps. Start with an empty cursor and use the returned cursor for the second page.'
        : 'Summarize the exact device and historical interval in the owner request. Send empty source, target, period and cursor, and zero for both timestamps.'}));
    return tools.filter(tool => tool.name !== READ_DEVICE_HISTORY && tool.name !== READ_SESSIONS).map(catalogToolWithReferences);
  }
  #supervisorScope(task: Task, purpose: 'supervisor' | 'title' = 'supervisor', boundDevice?: string | readonly string[],
    hostedHistory: ReadonlyMap<string, HostedHistoryMessage> = new Map()) {
    const latest = task.transcript.filter(item => item.role === 'owner').at(-1);
    const marker = task.ownerInputStart;
    const batchStart = marker === undefined ? -1 : task.transcript.findIndex(item => item.role === 'owner' && 'effect' in item && item.effect === marker);
    const start = latest === undefined ? 0 : batchStart < 0 ? task.transcript.lastIndexOf(latest) : batchStart;
    const transcript = task.transcript.slice(start);
    const ownerInputs = new Set(transcript.flatMap(item => {
      const id = item.role === 'owner' ? conversationMessageId(task.id, item) : undefined;
      return id === undefined ? [] : [id];
    }));
    const effects = new Set(transcript.flatMap(item => 'effect' in item && typeof item.effect === 'string' ? [item.effect] : []));
    const request = latest?.text ?? task.prompt;
    const requestId = latest === undefined ? `${task.id}-prompt` : conversationMessageId(task.id, latest) ?? fail('invalid-state');
    const devices = new Set<string>(typeof boundDevice === 'string' ? [boundDevice] : boundDevice);
    if (purpose === 'supervisor' && task.question?.kind === 'clarification' &&
      transcript.some(item => item.role === 'assistant' && item.calls.some(call => call.name === SET_WEMO_POWER && call.id === task.question?.call))) {
      for (const id of task.clarificationDevices ?? []) devices.add(id);
    }
    // Results of an admitted model control remain scoped to that turn's guarded targets.
    const control = task.control;
    if (control?.modelCallId !== undefined && this.store.call(control.requestId)?.action?.control?.modelCallId === control.modelCallId &&
      control.ownerMessageIds[0] === requestId) {
      for (const target of [control.proposal, ...(control.additional ?? [])]) devices.add(target.target);
    }
    const local = this.#fields(task.profile, 'read', 'private-conversation');
    const discover = this.#fields(task.profile, 'discovery', 'private-conversation');
    const messages = new Map<string, {conversationId: string}>();
    const configured = purpose === 'supervisor' ? this.#historyDevices() : [];
    if (purpose === 'supervisor') for (const id of this.#disclosedWemoTargets(task, effects)) devices.add(id);
    const history = purpose === 'supervisor' ? this.#historyBinding(task, configured) : undefined;
    if (history?.history !== undefined) devices.add(history.history.query.target);

    const canReadMessage = (id: string) => (hostedHistory.has(id) || this.store.messages.get(id)?.conversationId === task.conversationId) &&
      this.store.messages.removal(id) === undefined && local('conversation', 'text', task.conversationId) && local('conversation', 'text', id);
    const access = supervisorFields(this.options.share, {companion: task.profile, requestId, ownerInputs, conversationId: task.conversationId, messages, devices, purpose,
      ...(history?.history === undefined ? {} : {requestedHistory: new Set([history.history.query.target])}),
      ...(history?.history?.kind !== 'timestamps' ? {} : {requestedHistoryDetails: new Set([history.history.query.target])})});
    const allowsExcerpt = (id: string): boolean => canReadMessage(id) &&
      recordedSupervisorField(this.options.share, task.profile, purpose, 'conversation', 'excerpt', task.conversationId) &&
      recordedSupervisorField(this.options.share, task.profile, purpose, 'conversation', 'excerpt', id);
    const previous = task.transcript.slice(0, start).filter(item => item.role === 'owner').at(-1);
    const previousId = previous === undefined ? undefined : conversationMessageId(task.id, previous);
    const saved = task.contextThrough === undefined || history !== undefined ? [] : this.store.recentContext(task.profile, task.conversationId,
      task.contextThrough, message => message.role === 'owner' && !privateJobMessage(message) && allowsExcerpt(message.id), purpose === 'supervisor').messages;
    const earlier: RecentMessage[] = previous !== undefined ? previousId !== undefined && allowsExcerpt(previousId)
      ? [{id: previousId, role: 'owner' as const, text: previous.text}] : [] : saved.slice(-4);
    const words = normalizedControlText(request);
    const refers = /\b(?:it|that|those|both|former|latter|first one|second one|earlier|previous|same|again|last request|last message)\b/u.test(words) ||
      /^(?:and |(?:what|how) about )/u.test(words);
    const brightnessTarget = purpose === 'supervisor' ? brightnessSubject(request) : undefined;
    const subject = brightnessTarget ?? (purpose === 'supervisor' ? deviceRequestSubject(request) : undefined);
    const group = brightnessTarget === undefined ? deviceGroup(subject) : undefined;
    const named = (name: string | undefined, device: DeviceRecord): boolean => {
      const literal = name === undefined ? undefined : literalDeviceId(name);
      return literal === undefined ? [device.id, deviceLabel(device)].some(value => normalizedControlText(value) === name) : device.id === literal;
    };
    const exact = configured.filter(({device}) => named(subject, device));
    const mentioned = (text: string) => {
      const words = normalizedControlText(text);
      if (/\b(?:except|rather than|instead of|not|don t|without|leave)\b/u.test(words)) return [];
      const explicit = text.match(/(?:^|\s)id:([a-z0-9-]{1,128})(?=\s|[?!.;,]|$)/gu) ?? [];
      return configured.flatMap(entry => {
        const label = deviceLabel(entry.device);
        const commonLabel = configured.filter(other => named(normalizedControlText(label), other.device)).length !== 1;
        const position = explicit.some(value => value.trim() === `id:${entry.device.id}`) ? words.indexOf(`id ${normalizedControlText(entry.device.id)}`)
          : !commonLabel && containsControlValue(text, label) ? words.indexOf(normalizedControlText(label)) : -1;
        return position < 0 ? [] : [{...entry, position}];
      }).sort((a, b) => a.position - b.position);
    };
    const malformedSelector = exactControlIds(request).some(id => literalDeviceId(`id:${id}`) !== id);
    const matching = exact.length === 1 ? exact : exact.length > 1 ? []
      : subject === undefined || /\band\b/u.test(subject) ? mentioned(request) : [];
    const explicit = group === undefined ? matching : configured.filter(({owner}) => owner === group);
    const visibleEarlier = earlier.filter(message => mentioned(message.text).every(({device}) =>
      discover('devices', 'index', device.id) && local('devices', 'label', device.id) &&
      recordedSupervisorField(this.options.share, task.profile, 'supervisor', 'devices', 'index', device.id) &&
      recordedSupervisorField(this.options.share, task.profile, 'supervisor', 'devices', 'label', device.id)));
    const previousOwner = visibleEarlier.at(-1);
    const references = refers && explicit.length === 0 && exact.length === 0 ? mentioned(previousOwner?.text ?? '') : [];
    const ordinal = /\b(?:first|former)\b/u.test(words) ? 0 : /\b(?:second|latter)\b/u.test(words) ? 1 : undefined;
    const referred = ordinal !== undefined ? references.slice(ordinal, ordinal + 1)
      : references.length === 1 || /\b(?:both|those)\b/u.test(words) ? references : [];
    const selected = malformedSelector ? [] : [...explicit, ...referred];
    for (const {device} of selected) devices.add(device.id);
    if (purpose === 'supervisor' && /\bmode\b/u.test(words)) devices.add('hub');
    // Earlier owner text can resolve a reference in the current command. The
    // chronological model background is selected independently.
    const recent = purpose === 'title' || refers ? visibleEarlier : [];
    const selectedDevice = (owner: AssistantDeviceOwner, id: string) => selected.some(entry => entry.owner === owner && entry.device.id === id);
    const catalogSubject = malformedSelector || group !== undefined || exact.length > 1 ? undefined
      : subject !== undefined && (!refers || references.length === 0) ? subject
        : selected.length === 1 && selected[0] !== undefined ? `id:${selected[0].device.id}` : undefined;
    const priorCatalogIds = new Set(this.store.calls(task.id).filter(call => effects.has(call.id) && call.kind === 'tool' && call.action === undefined)
      .flatMap(call => call.disclosures?.flatMap(field => field.source === 'devices' && field.record !== undefined ? [field.record] : []) ?? [])
      .filter(id => !devices.has(id)));
    if (catalogSubject !== undefined) for (const id of priorCatalogIds) devices.add(id);
    const resolvedCatalogDevice = (id: string) => devices.add(id);
    for (const id of hostedHistory.keys()) messages.set(id, {conversationId: task.conversationId});
    for (const message of recent) messages.set(message.id, {conversationId: task.conversationId});
    for (const item of transcript) {
      const id = item.role === 'tool' ? conversationMessageId(task.id, item) : undefined;
      if (id?.endsWith('-answer') === true && canReadMessage(id)) messages.set(id, {conversationId: task.conversationId});
    }
    const fields: FieldAccess = (source, field, record) => {
      if (source === 'conversation' && (record === undefined || !canReadMessage(record))) return false;
      if (source === 'devices') {
        if (record === undefined || !local(source, field, record) || field === 'index' && !discover(source, field, record)) return false;
        if ((field === 'summary' || field === 'details') && (!local(source, 'status', record) || !local(source, 'details', record))) return false;
        if (matchesCatalogSubject(catalogSubject, record)) devices.add(record);
      }
      return access(source, field, record);
    };
    return {request, requestId, ownerInputs, recent, fields, transcript, effects, catalogSubject, priorCatalogIds, resolvedCatalogDevice,
      brightnessTarget: brightnessTarget === undefined ? undefined : catalogSubject ?? brightnessTarget, selectedDevice, history};
  }
  #hostedHistory(task: Pick<Task, 'profile' | 'conversationId' | 'contextThrough'>): Map<string, HostedHistoryMessage> {
    const messages = new Map<string, HostedHistoryMessage>();
    if (task.contextThrough === undefined) return messages;
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    const discovery = this.#fields(task.profile, 'discovery', 'private-conversation');
    const prompt = this.#supervisorPromptFields(task.profile);
    const permitted = (source: ShareQuery['source'], field: ShareQuery['field'], id: string) =>
      recordedSupervisorField(this.options.share, task.profile, 'supervisor', source, field, id);
    if (!read('conversation', 'text', task.conversationId) || !permitted('conversation', 'excerpt', task.conversationId)) return messages;
    const access: FieldAccess = (source, field, id) => {
      if (source === 'knowledge' || source === 'preferences') return prompt(source, field, id);
      if (id === undefined || !permitted(source, field, id)) return false;
      if (source === 'conversation') return messages.has(id) && permitted(source, field, task.conversationId);
      if (source !== 'devices' || field === 'details' || !read(source, field, id)) return false;
      if (field === 'summary' && (!read(source, 'details', id) || !read(source, 'status', id))) return false;
      return field !== 'index' || discovery(source, field, id);
    };
    for (const message of this.store.hostedHistory(task.profile, task.conversationId, task.contextThrough)) {
      if (privateJobMessage(message) || !read('conversation', 'text', message.id) || !permitted('conversation', 'excerpt', message.id)) continue;
      if (message.role === 'owner') {messages.set(message.id, message); continue;}
      const origin = this.store.task(message.taskId);
      if (origin === undefined || origin.profile !== task.profile || origin.conversationId !== task.conversationId ||
        origin.status !== 'succeeded' || origin.supervisor === undefined || origin.supervisor.provider === 'synthetic') continue;
      if (origin.clarificationDevices?.some(id => !access('devices', 'index', id) || !access('devices', 'label', id)) === true) continue;
      const calls = this.store.calls(origin.id);
      if (!calls.some(call => call.kind === 'model' && call.status === 'succeeded')) continue;
      const unchangedLegacyInput = (call: Call) => call.inputVersions !== undefined || call.disclosures?.every(field =>
        field.source !== 'knowledge' && field.source !== 'preferences' &&
        (field.source !== 'conversation' || field.record !== undefined && messages.get(field.record)?.revision === 1)) === true;
      if (message.role === 'tool') {
        const source = calls.find(call => call.id === message.id && call.kind === 'tool' && call.status === 'succeeded');
        const item = origin.transcript.find(item => item.role === 'tool' && 'effect' in item && item.effect === message.id);
        if (source === undefined || item?.role !== 'tool' || !read('conversation', 'details', message.id) ||
          !(item.name === READ_DEVICES || item.name === READ_DEVICE_HISTORY || item.name === WEMO_TARGETS || deviceToolOwner(item.name) !== undefined) ||
          source.action !== undefined || source.result !== message.text || source.disclosures?.some(field => field.source === 'devices') !== true ||
          source.disclosures.some(field => field.source !== 'devices' || field.field === 'details')) continue;
        if (hasSavedDisclosureProof(this.store, origin.id, calls, source.ordinal) &&
          calls.filter(call => call.ordinal <= source.ordinal).every(call => this.#callAllowed(call, access, false, messages) && unchangedLegacyInput(call))) {
          messages.set(message.id, message);
        }
      } else if (hasSavedDisclosureProof(this.store, origin.id, calls) &&
        calls.every(call => this.#callAllowed(call, access, false, messages) && unchangedLegacyInput(call))) messages.set(message.id, message);
    }
    return messages;
  }
  #disclosureVersion({source, field, record}: DisclosedField): string | undefined {
    if (record === undefined) return undefined;
    if (source === 'conversation') {
      const message = this.store.messages.get(record);
      return message === undefined ? undefined : String(message.revision);
    }
    if (source === 'knowledge' || source === 'preferences') {
      const entries = source === 'knowledge' ? this.options.knowledge?.() : this.options.preferences?.();
      const entry = entries?.find(value => value.title === record);
      return entry === undefined ? undefined : digest(field === 'label' ? entry.title : entry.text);
    }
    return undefined;
  }
  #historySourcesAllowed(sources: readonly ContextSourceVersion[], eligible: ReadonlyMap<string, HostedHistoryMessage>): boolean {
    return sources.every(({id, revision}) => eligible.get(id)?.revision === revision);
  }
  #supervisorPromptFields(profile: AssistantProfile): FieldAccess {
    const allowed = this.#fields(profile, 'prompt', 'external-model');
    const local = this.#fields(profile, 'read', 'private-conversation');
    return (source, field, record) => {
      if (!local(source, field, record) || !allowed(source, field, record)) return false;
      if (source === 'knowledge') return this.store.knowledgeEnabled(profile) &&
        (this.options.knowledge?.() ?? []).some(entry => entry.title === record);
      return source === 'preferences' && (this.options.preferences?.() ?? []).some(entry => entry.title === record);
    };
  }
  #supervisorContext(profile: AssistantProfile, capture?: FieldAccess): PromptContext {
    const persona = PROFILES.find(value => value.id === profile) ?? fail('internal');
    const allowed = this.#supervisorPromptFields(profile);
    const included = (source: 'knowledge' | 'preferences', entries: readonly ContextEntry[]) =>
      entries.filter(entry => allowed(source, 'label', entry.title) && allowed(source, 'text', entry.title));
    const knowledge = included('knowledge', this.options.knowledge?.() ?? []);
    const preferences = included('preferences', this.options.preferences?.() ?? []);
    const context = buildContext({profile, persona: {name: persona.name, character: persona.character},
      knowledge: {enabled: knowledge.length > 0, entries: knowledge}, preferences,
      recent: {conversationId: null, messages: [], total: 0}});
    if (capture !== undefined) {
      for (const [source, entries] of [['knowledge', knowledge], ['preferences', preferences]] as const) {
        for (const entry of entries.slice(0, sectionOf(context, source).included)) {
          if (!capture(source, 'label', entry.title) || !capture(source, 'text', entry.title)) fail('forbidden');
        }
      }

    }
    return context;
  }
  #usableCompaction(conversationId: string, messages: readonly HostedHistoryMessage[]): HistoryCompaction | undefined {
    const saved = this.store.lastHistoryCompaction(conversationId);
    return saved?.text != null && saved.sources.every(({id, revision}, index) => {
      const row = messages[index];
      return row?.id === id && row.revision === revision;
    }) ? saved : undefined;
  }
  #fitHostedHistory(task: Pick<Task, 'conversationId' | 'reservedUnits' | 'supervisor'>, provider: ModelProvider, input: TurnInput,
    messages: readonly HostedHistoryMessage[]): HostedWindow {
    const budget = hostedInputCapacity(provider);
    const totals = this.spend.available();
    const pricing = task.supervisor?.pricing;
    return fitConversationHistory(input, messages, this.#usableCompaction(task.conversationId, messages), budget, candidate => {
      if (hostedInputUnits(provider, candidate) > budget) return false;
      const units = provider.inputUnits?.(candidate) ?? inputBound(candidate);
      return task.reservedUnits + units + LIMITS.outputUnits <= LIMITS.units &&
        this.spend.fits({model: provider.model, inputUnits: units, outputUnits: LIMITS.outputUnits,
          ...(pricing === undefined ? {} : {pricing})}, totals);
    });
  }
  #hostedPreview(task: Pick<Task, 'profile' | 'conversationId' | 'contextThrough' | 'reservedUnits' | 'supervisor'>, provider: ModelProvider,
    transcript: TurnInput['transcript'] = [], tools: TurnInput['tools'] = []): HostedWindow {
    const context = this.#supervisorContext(task.profile);
    return this.#fitHostedHistory(task, provider, {instructions: INSTRUCTIONS, context, transcript, tools, mode: null},
      [...this.#hostedHistory(task).values()]);
  }
  #hostedBase(task: Task, transcript: TurnInput['transcript'], context: PromptContext, tools: TurnInput['tools'],
    access: FieldAccess, deviceMode: CoreCopy['mode']): TurnInput {
    const visible = transcript.map(item => {
      if (item.role === 'owner' && 'submittedAtMs' in item) {
        const {submittedAtMs: _, ...message} = item;
        return message;
      }
      if (item.role !== 'tool') return item;
      const record = conversationMessageId(task.id, item);
      return record !== undefined && record.endsWith('-answer') && !access('conversation', 'excerpt', record)
        ? {...item, result: 'The owner’s answer is private.'} : item;
    });
    const mode = deviceMode !== undefined && access('devices', 'status', 'hub')
      ? {mode: deviceMode.mode, revision: deviceMode.revision} : null;
    return {instructions: controlInstructions(tools), context, transcript: visible, tools, mode};
  }
  async #prepareHistoryCompaction(task: Task, provider: ModelProvider, active: Active, protect: (release: () => void) => void): Promise<void> {
    const pin = task.supervisor;
    if (pin === undefined || !this.#canUseTaskProvider(task)) return;
    const attempt = this.store.taskHistoryCompaction(task.id);
    if (attempt?.stopCode !== undefined) throw new ProviderFault(attempt.stopCode);
    if (attempt !== undefined) return;
    if (this.store.queue.steers(task.id).length > 0) return;
    const eligible = this.#hostedHistory(task), messages = [...eligible.values()];
    const scope = this.#supervisorScope(task, 'supervisor', undefined, eligible);
    const auxiliary = this.#supervisorPromptFields(task.profile);
    const access: FieldAccess = (source, field, record) =>
      (source === 'knowledge' || source === 'preferences' ? auxiliary : scope.fields)(source, field, record);
    if (messages.length === 0 || !access('conversation', 'request', scope.requestId) ||
      [...scope.ownerInputs].some(owner => !access('conversation', 'request', owner)) ||
      scope.transcript.some(item => item.role === 'assistant') && !this.#replayable(task.id, access, scope.effects)) return;
    const base = this.#hostedBase(task, scope.transcript, this.#supervisorContext(task.profile, access), this.#toolsFor(task), access, this.#currentHostedMode());
    if (hostedInputUnits(provider, base) > hostedInputCapacity(provider)) return;
    const fitted = this.#fitHostedHistory(task, provider, base, messages);
    if (fitted.omitted === 0) return;
    const prior = this.#usableCompaction(task.conversationId, messages);
    const prefix = prior?.sources.length ?? 0;
    const capacity = hostedInputCapacity(provider);
    const baseUnits = hostedInputUnits(provider, base);
    const historyRoom = Math.max(0, capacity - baseUnits);
    const target = fitConversationHistory(base, messages, prior, capacity, candidate =>
      hostedInputUnits(provider, candidate) <= baseUnits + Math.floor(historyRoom * 0.6)).omitted;
    // Leave the newest complete exchange verbatim even when both calls are small.
    const newestTask = messages.at(-1)?.taskId;
    const oldestOfNewest = messages.findIndex(message => message.taskId === newestTask);
    const cutoff = Math.min(oldestOfNewest, prefix + Math.max(target, fitted.omitted));
    if (cutoff <= prefix) return;
    const totals = this.spend.available();
    const compactionSpend = {day: {...totals.day, limitMicros: totals.day.spentMicros + Math.floor((totals.day.limitMicros - totals.day.spentMicros) / 10)},
      month: {...totals.month, limitMicros: totals.month.spentMicros + Math.floor((totals.month.limitMicros - totals.month.spentMicros) / 10)}, version: totals.version};
    const pricing = pin.pricing === undefined ? {} : {pricing: pin.pricing};
    const budgetTokens = Math.min(COMPACTION_OUTPUT_TOKENS, Math.floor(historyRoom / 4));
    const previous = prior?.text == null ? [] : [{id: prior.id, role: 'assistant' as const, text: prior.text}];
    const build = (end: number) => {
      const input = buildConversationCompactionInput({profile: task.profile, conversationId: task.conversationId,
        messages: [...previous, ...messages.slice(prefix, end)], budgetTokens, inputTokens: capacity,
        measureInput: value => hostedInputUnits(provider, value)});
      if (input === null) return undefined;
      const units = provider.inputUnits?.(input) ?? inputBound(input);
      const spend = {model: provider.model, inputUnits: units, outputUnits: COMPACTION_OUTPUT_TOKENS, ...pricing};
      return this.spend.fits(spend, compactionSpend) ? {input, spend} : undefined;
    };
    const boundaries = [prefix, ...messages.slice(prefix, cutoff).flatMap((message, index) => {
      const after = prefix + index + 1;
      return messages[after]?.taskId === message.taskId ? [] : [after];
    })];
    let lower = 0, upper = boundaries.length - 1;
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (build(boundaries[middle] ?? prefix) === undefined) upper = middle - 1;
      else lower = middle;
    }
    // An old exchange can itself be wider than the compactor's input window.
    const boundary = boundaries[lower] === prefix && build(prefix + 1) !== undefined ? prefix + 1 : boundaries[lower] ?? prefix;
    if (boundary <= prefix) return;
    const planned = build(boundary);
    if (planned === undefined) return;
    const sources = messages.slice(0, boundary).map(({id, revision}) => ({id, revision}));
    const record: HistoryCompaction = {id: digest([task.conversationId, prior?.id ?? null, sources]), taskId: task.id,
      conversationId: task.conversationId, provider: pin, sources, status: 'admitted', text: null};
    let admitted = false;
    await this.outbox.transaction(() => {
      this.#fence(active);
      if (this.store.hasHistoryCompaction(record.id, task.id)) return;
      const release = this.spend.holdForOptional({
        model: provider.model, inputUnits: provider.inputUnits?.(base) ?? inputBound(base), outputUnits: LIMITS.outputUnits, ...pricing
      }, {id: record.id, purpose: 'conversation', owner: task.conversationId, ...planned.spend});
      if (release === undefined) return;
      protect(release);
      this.store.saveHistoryCompaction(record);
      admitted = true;
    });
    if (!admitted) return;
    const parent = startSpan(this.context.trace, 'bunny.assistant.model', {parent: active.span.context,
      attributes: {'bunny.assistant.task_id': task.id, 'bunny.assistant.run_id': active.runId, 'bunny.assistant.effect_id': record.id}});
    const controller = new AbortController();
    const stop = () => {controller.abort();};
    active.controller.signal.addEventListener('abort', stop, {once: true});
    const cancel = this.context.scheduler.after(45_000, stop);
    let usage: TokenUsage | null = null, sent = false, stopTurn: ProviderFault | undefined;
    try {
      this.#fence(active);
      const current = this.#task(task.id);
      const permitted = this.#hostedHistory(current);
      const scope = this.#supervisorScope(current, 'supervisor', undefined, permitted);
      if (this.store.queue.steers(task.id).length > 0 || !scope.fields('conversation', 'request', scope.requestId) ||
        [...scope.ownerInputs].some(owner => !scope.fields('conversation', 'request', owner)) || !this.#historySourcesAllowed(sources, permitted)) {
        record.status = 'failed';
      } else {
        const interrupted = new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => {reject(new ProviderFault('cancelled', true));}, {once: true});
        });
        sent = true;
        const reply = await Promise.race([provider.turn(planned.input, controller.signal), interrupted]);
        usage = reply.usage ?? null;
        record.text = readConversationCompactionReply(reply, budgetTokens);
        record.status = record.text === null ? 'failed' : 'succeeded';
      }
    } catch (error) {
      record.status = sent && (!(error instanceof ProviderFault) || error.uncertain) ? 'uncertain' : 'failed';
      if (error instanceof ProviderFault && !error.uncertain && error.sizeLimit === undefined &&
        (error.code === 'capacity' || error.code === 'forbidden' || error.code === 'unauthenticated')) {
        stopTurn = error; record.stopCode = error.code;
      }
    } finally {
      cancel();
      active.controller.signal.removeEventListener('abort', stop);
      parent.end(record.status === 'succeeded' ? 'unset' : 'error');
    }
    if (this.#closed || !this.context.database().isOpen) return;
    await this.outbox.transaction(() => {
      if (record.status === 'succeeded' && !this.#historySourcesAllowed(sources, this.#hostedHistory(this.#task(task.id)))) {
        record.status = 'failed'; record.text = null;
      }
      this.store.saveHistoryCompaction(record);
      this.spend.settle(record.id, sent ? usage : {input: 0, output: 0, cacheRead: 0, cacheWrite: 0});
    });
    if (stopTurn !== undefined) throw stopTurn;
  }
  #taskFields(task: Task): FieldAccess {
    return this.#taskProvider(task).name === 'synthetic' ? this.#modelFields(task.profile, 'synthetic') : this.#supervisorScope(task).fields;
  }
  #modelFields(companion: AssistantProfile, destination = this.provider(companion).name): FieldAccess {
    const prompt = this.#fields(companion, 'prompt', destination), read = this.#fields(companion, 'read', destination), discover = this.#fields(companion, 'discovery', destination);
    return (source, field, record) => prompt(source, field, record) && (field === 'index' ? discover : read)(source, field, record);
  }
  #codingJobAllowed(job: CodingJobRead, access: FieldAccess): boolean {
    return access('conversation', 'details', job.taskId) && access('coding', 'repository', job.repository) &&
      access('coding', 'details', job.jobId) && access('coding', 'details', job.originalOperationId) &&
      (job.operationId === job.originalOperationId || access('coding', 'details', job.operationId));
  }
  canReadCodingJob(profile: AssistantProfile, job: Pick<CodingJob, 'jobId' | 'taskId' | 'conversationId' | 'operationId' | 'repository'>): boolean {
    const task = this.store.task(job.taskId), origin = this.options.codingJobRead?.(job.operationId);
    if (task?.profile !== profile || task.conversationId !== job.conversationId || origin?.jobId !== job.jobId ||
      origin.taskId !== job.taskId || origin.conversationId !== job.conversationId || origin.repository !== job.repository) return false;
    const fields = this.#publicRead(profile);
    return fields.task(job.conversationId, job.taskId) && fields.discover('coding', 'index', job.jobId) &&
      this.#codingJobAllowed(origin, fields.read) && fields.read('coding', 'status', job.operationId);
  }
  #jobMessageAllowed(message: MessageSource, access: FieldAccess): boolean {
    const legacy = /^(.+-step-\d+)(-job)?(?:-(sent|stop-unconfirmed|result))?$/u.exec(message.id);
    const updateId = ATTEMPT_UPDATE_ID.exec(message.id);
    // A normal Conversation reply uses its own task ID and the same result suffix.
    const continuation = updateId?.[1] === message.taskId ? null : updateId;
    const operationId = legacy?.[1] ?? continuation?.[1];
    const follows = message.follows ?? ((legacy?.[3] !== undefined || continuation !== null) && message.follows === undefined
      ? this.store.savedMessage(message.taskId, message.id)?.follows : undefined);
    const followsJob = /-step-\d+-job$/u.test(follows ?? '');
    const jobMessage = followsJob || legacy?.[2] !== undefined || continuation !== null;
    const acceptsOldRecords = !canRevokeFields(this.options.share);
    if (operationId === undefined) return !jobMessage;
    if (!jobMessage && message.role !== 'tool') return true;

    const kind = legacy?.[3] ?? continuation?.[2];
    const update = (kind === 'sent' || kind === 'stop-unconfirmed' || kind === 'result') && follows != null ? {jobId: follows, kind} as const : undefined;
    // A legacy update can predate its durable delivery record. A continuation always needs both the saved link
    // and the update owned by its attempt.
    const read = this.options.codingJobRead;
    const job = continuation !== null ? update === undefined ? undefined : read?.(operationId, update) : read?.(operationId);
    if (job === undefined) return continuation === null && (!jobMessage || acceptsOldRecords);
    if (job.taskId !== message.taskId || this.store.task(message.taskId)?.conversationId !== job.conversationId) return false;
    if (update !== undefined && (update.jobId !== job.jobId || codingUpdateMessageId(job, update.kind) !== message.id)) return false;
    return this.#codingJobAllowed(job, access);
  }
  #savedDisclosureAllowed(taskId: string, access: FieldAccess): boolean {
    const acceptsOldRecords = !canRevokeFields(this.options.share);
    const task = this.store.task(taskId);
    if (task === undefined) return this.store.calls(taskId).every(call =>
      (call.historySources?.length ?? 0) === 0 && this.#recordedFieldsAllowed(call, access, acceptsOldRecords));
    const proof = savedDisclosureProof(this.store, task);
    return proof.complete && (!proof.legacy || acceptsOldRecords) &&
      proof.fields.every(field => this.#disclosureAllowed(field, access));
  }
  #replayable(taskId: string, access: FieldAccess, effects?: ReadonlySet<string>): boolean {
    if (this.store.task(taskId)?.clarificationDevices?.some(id => !access('devices', 'index', id) || !access('devices', 'label', id)) === true) return false;
    return this.#callDisclosuresAllowed(taskId, access, call => effects?.has(call.id) !== false, effects === undefined && !canRevokeFields(this.options.share));
  }
  #callDisclosuresAllowed(taskId: string, access: FieldAccess, relevant: (call: Call) => boolean,
    acceptsOldRecords = !canRevokeFields(this.options.share)): boolean {
    return this.store.calls(taskId).every(call => !relevant(call) || this.#callAllowed(call, access, acceptsOldRecords));
  }
  #callAllowed(call: Call, access: FieldAccess, acceptsOldRecords: boolean,
    history?: ReadonlyMap<string, HostedHistoryMessage>): boolean {
    const historyRevision = (id: string) => history === undefined ? this.store.historySourceRevision(id) : history.get(id)?.revision;
    const control = call.action?.control;
    const catalog = control?.modelCallId !== undefined && (control.proposal.family === 'mode-set' ||
      control.proposal.family === 'catalog-action' && modelCatalogCommand(control.proposal.command)) ? control.proposal : undefined;
    if (call.privateDraftId !== undefined || catalog !== undefined) {
      const task = this.store.task(call.taskId);
      if (task === undefined ||
        call.privateDraftId !== undefined && !this.#fields(task.profile, 'read', 'private-conversation')('shows', 'details', call.privateDraftId) ||
        catalog !== undefined && !this.#catalogFieldsPermitted(task, catalog)) return false;
    }
    return this.#recordedFieldsAllowed(call, access, acceptsOldRecords) &&
      (call.historySources?.every(({id, revision}) => access('conversation', 'excerpt', id) && historyRevision(id) === revision) ?? true) &&
      (call.inputVersions?.every(({field, version}) => field.source === 'conversation' && field.record !== undefined && history !== undefined
        ? String(historyRevision(field.record)) === version : this.#disclosureVersion(field) === version) ?? true);
  }
  #recordedFieldsAllowed(call: Call, access: FieldAccess, acceptsOldRecords: boolean): boolean {
    return call.incompleteDisclosures !== true &&
      (call.disclosures === undefined ? call.status !== 'succeeded' || acceptsOldRecords : call.disclosures.every(field => this.#disclosureAllowed(field, access)));
  }
  #disclosureAllowed({source, field, record}: DisclosedField, access: FieldAccess): boolean {
    if (!access(source, field, record)) return false;
    if (source !== 'conversation' || field !== 'text' || record === undefined) return true;
    const operationId = ATTEMPT_UPDATE_ID.exec(record)?.[1];
    if (operationId === undefined) return true;
    const message = this.store.messageSource(record);
    // A model reply can carry facts from a saved attempt. Its own ledger must still resolve that source.
    return message === undefined ? this.store.task(operationId) !== undefined
      : message.role === 'owner' || this.#jobMessageAllowed(message, access);
  }
  #currentHostedMode(): CoreCopy['mode'] {
    const copy = this.#core();
    return copy.synced ? copy.mode : undefined;
  }
  #core(): CoreCopy {return this.options.core?.() ?? {sessions: [], mode: undefined, synced: false};}
  /**
   * The prompt context at this call (Hub #2029): the builder's sections for the task's companion, from the records as they
   * are now, with the recent conversation held to the messages saved before the task started. A task saved before that
   * boundary existed has no recent conversation.
   */
  #context(task: Pick<Task, 'profile' | 'conversationId' | 'contextThrough' | 'supervisor'>, recipient?: FieldAccess,
    capture?: {prompt: FieldAccess; model: FieldAccess}): PromptContext {
    const persona = PROFILES.find(value => value.id === task.profile) ?? fail('internal');
    const destination = task.supervisor?.provider;
    const providerFields = this.#fields(task.profile, 'prompt', destination), toolFields = this.#modelFields(task.profile, destination);
    const fields: FieldAccess = (source, field, record) => providerFields(source, field, record) && recipient?.(source, field, record) !== false;
    const modelFields: FieldAccess = (source, field, record) => toolFields(source, field, record) && recipient?.(source, field, record) !== false;
    const permits = (message: MessageSource, prompt: FieldAccess, model: FieldAccess): boolean =>
      !privateJobMessage(message) && prompt('conversation', 'text', message.id) &&
      (message.role === 'owner' || this.store.task(message.taskId)?.supervisor?.provider !== 'openai' &&
        model('conversation', 'text', message.id) && this.#jobMessageAllowed(message, model) && this.#replayable(message.taskId, model)) &&
      (message.role !== 'tool' || prompt('conversation', 'details', message.id));
    const recent = task.contextThrough === undefined || !fields('conversation', 'text', task.conversationId)
      ? {messages: [], total: 0} : this.store.recentContext(task.profile, task.conversationId, task.contextThrough, message => permits(message, fields, modelFields));
    const recentMessages = recent.messages.map((message): RecentMessage => {
      if (message.attachment === undefined || fields('artwork', 'attachment', message.attachment.requestId)) return message;
      const {attachment: _, ...text} = message;
      return text;
    });
    const eligibleEntry = (access: FieldAccess, source: 'knowledge' | 'preferences', entry: ContextEntry) =>
      access(source, 'label', entry.title) && access(source, 'text', entry.title);
    const knowledge = {enabled: this.store.knowledgeEnabled(task.profile) && fields('knowledge', 'text'),
      entries: (this.options.knowledge?.() ?? []).filter(entry => eligibleEntry(fields, 'knowledge', entry))};
    const preferences = (this.options.preferences?.() ?? []).filter(entry => eligibleEntry(fields, 'preferences', entry));
    const context = buildContext({profile: task.profile, persona: {name: persona.name, character: persona.character}, knowledge, preferences,
      recent: {conversationId: task.conversationId, messages: recentMessages, total: recent.total}});
    if (capture === undefined) return context;
    const model: FieldAccess = (source, field, record) => capture.model(source, field, record) && capture.prompt(source, field, record);
    // The builder keeps a bounded suffix. Record its sources after filtering and fitting, so an excluded message
    // cannot cause a later permission check to refuse an otherwise permitted turn.
    for (const message of recentMessages.slice(recentMessages.length - sectionOf(context, 'recent').included)) {
      const source = this.store.messageSource(message.id) ?? fail('invalid-state');
      if (!permits(source, capture.prompt, model)) fail('forbidden');
      if (message.attachment !== undefined && !capture.prompt('artwork', 'attachment', message.attachment.requestId)) fail('forbidden');
    }
    if (knowledge.enabled) capture.prompt('knowledge', 'text');
    for (const entry of knowledge.entries.slice(0, sectionOf(context, 'knowledge').included)) eligibleEntry(capture.prompt, 'knowledge', entry);
    for (const entry of preferences.slice(0, sectionOf(context, 'preferences').included)) eligibleEntry(capture.prompt, 'preferences', entry);
    return context;
  }
  /**
   * What the builder would send for the profile now (Hub #2029), for the page's context preview: the next call of the
   * current conversation's unfinished task, or else of a new message's task in it.
   */
  previewContext(profile: AssistantProfile, recipient?: FieldAccess): {context: PromptContext; basis: {kind: 'task'; taskId: string} | {kind: 'next-message'}} {
    const conversationId = this.store.conversation(profile);
    const unfinished = conversationId === undefined ? undefined : this.store.unfinishedIn(conversationId);
    if (unfinished !== undefined) {
      const context = unfinished.supervisor?.provider === 'anthropic' || unfinished.supervisor?.provider === 'openai'
        ? this.#hostedPreview(unfinished, this.#taskProvider(unfinished), this.#supervisorScope(unfinished).transcript, this.#toolsFor(unfinished)).input.context
        : this.#context(unfinished, recipient);
      return {context: {...context, conversationId: unfinished.conversationId}, basis: {kind: 'task', taskId: unfinished.id}};
    }
    const provider = this.provider(profile);
    if (provider.name !== 'synthetic') {
      const context = conversationId === undefined ? this.#supervisorContext(profile)
        : this.#hostedPreview({profile, conversationId, contextThrough: this.store.lastSequence(conversationId), reservedUnits: 0}, provider).input.context;
      return {context: {...context, conversationId: conversationId ?? null}, basis: {kind: 'next-message'}};
    }
    const context = conversationId === undefined ? {...this.#context({profile, conversationId: '', contextThrough: 0}, recipient), conversationId: null}
      : this.#context({profile, conversationId, contextThrough: this.store.lastSequence(conversationId)}, recipient);
    return {context, basis: {kind: 'next-message'}};
  }
  async #turn(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const provider = this.#taskProvider(task);
    let proposalCopy = this.#core();
    let tools = this.#toolsFor(task);
    const id = `${state.taskId}-step-${String(state.step)}`;
    // Each section keeps to its own budget and states what it left out, so the context is bounded without a refusal.
    const paid = provider.name !== 'synthetic';
    let releaseSpend: (() => void) | undefined;
    if (paid && this.store.call(id) === undefined) {
      try {await this.#prepareHistoryCompaction(task, provider, active, release => {releaseSpend = release;});}
      catch (error) {releaseSpend?.(); throw error;}
    }
    const ledger: DisclosureLedger = {fields: []}, modelLedger: DisclosureLedger = {fields: []};
    const promptFields = this.#fields(task.profile, 'prompt', provider.name);
    const fields = recordDisclosures(promptFields, ledger);
    const modelFields = this.#taskFields(task);
    const modelAccess = recordDisclosures(modelFields, modelLedger);
    if (!paid && !fields('conversation', 'text', task.conversationId)) throw new Fault('forbidden', 'This conversation is not shared with the configured model.');
    let request: TurnInput | undefined;
    let includesReplay = false;
    let history: DeviceHistoryBinding | undefined;
    let historySources: readonly ContextSourceVersion[] = [];
    let inputVersions: NonNullable<Call['inputVersions']> = [];
    let controlScope: ModelControlScope | undefined;
    // The task's unread steers are taken into its transcript in the call's own admission (Hub #2031), after the last
    // call's tool results, and the request is built from that transcript: a limit that refuses the call leaves them
    // unread, and a replayed node whose call was admitted takes none again.
    const text = await this.#call(state.taskId, state.step, 'model', async (signal, parent) => {
      let current = this.#task(task.id);
      let eligible = paid ? this.#hostedHistory(current) : new Map<string, HostedHistoryMessage>();
      let scope = paid ? this.#supervisorScope(current, 'supervisor', undefined, eligible) : undefined;
      if (includesReplay && scope !== undefined && scope.catalogSubject !== undefined && scope.priorCatalogIds.size > 0) {
        const subject = scope.catalogSubject;
        const currentDevices = await this.#catalog().deviceSubjectMatches(subject, parent);
        this.#fence(active);
        current = this.#task(task.id);
        eligible = this.#hostedHistory(current);
        scope = this.#supervisorScope(current, 'supervisor', undefined, eligible);
        if (scope.catalogSubject !== subject || currentDevices.length !== 1 || currentDevices[0] === undefined ||
          !scope.priorCatalogIds.has(currentDevices[0].device.id) || scope.priorCatalogIds.size !== 1) throw new ProviderFault('forbidden');
      }
      const auxiliary = this.#supervisorPromptFields(current.profile);
      const allow: FieldAccess = (source, field, record) => scope === undefined ? promptFields(source, field, record)
        : (source === 'knowledge' || source === 'preferences' ? auxiliary : scope.fields)(source, field, record);
      if (paid && this.store.queue.steers(task.id).length > 0 || history?.history !== undefined && (scope?.history?.history === undefined || !sameHistoryQuery(history.history.query, scope.history.history.query)) ||
        !this.#historySourcesAllowed(historySources, eligible) ||
        inputVersions.some(({field, version}) => this.#disclosureVersion(field) !== version) ||
        ledger.fields.some(field => !this.#disclosureAllowed(field, allow)) ||
        modelLedger.fields.some(field => !modelFields(field.source, field.field, field.record)) ||
        includesReplay && !this.#replayable(task.id, scope === undefined ? modelFields : allow, scope?.effects) ||
        (ledger.incompleteDisclosures === true || modelLedger.incompleteDisclosures === true) && canRevokeFields(this.options.share)) {
        throw new ProviderFault('forbidden', false, undefined, 'Sharing changed before the configured model could receive this turn.');
      }
      const outbound = request ?? fail('internal');
      if (paid && outbound.mode !== null) {
        const mode = this.#currentHostedMode();
        if (mode?.revision !== outbound.mode.revision || mode.mode !== outbound.mode.mode) {
          throw new ProviderFault('unavailable', false, undefined, 'The Hub mode changed before the model request was sent.');
        }
      }
      return provider.turn(outbound, signal)
        .then((reply): Answer => ({text: JSON.stringify(reply), units: reply.units, usage: reply.usage ?? null, disclosures: ledger.fields,
          ...(paid ? {historySources, inputVersions} : {}),
          ...(ledger.incompleteDisclosures === true ? {incompleteDisclosures: true} : {})}));
    }, (_current, saved) => {
      if (controlScope !== undefined) saved.modelControlProof = modelControlProof(controlScope);
    }, current => {
      releaseSpend?.();
      this.#drain(current);
      tools = this.#toolsFor(current);
      if (paid) {
        proposalCopy = this.#core();
        const eligible = this.#hostedHistory(current);
        const scope = this.#supervisorScope(current, 'supervisor', undefined, eligible);
        const auxiliary = this.#supervisorPromptFields(current.profile);
        const scopedAccess: FieldAccess = (source, field, record) =>
          (source === 'knowledge' || source === 'preferences' ? auxiliary : scope.fields)(source, field, record);
        const access = recordDisclosures(scopedAccess, ledger);
        if (!access('conversation', 'request', scope.requestId) || [...scope.ownerInputs].some(owner => !access('conversation', 'request', owner))) {
          throw new Fault('forbidden', 'This request is private under the configured model sharing policy.');
        }
        const context = this.#supervisorContext(current.profile, access);
        const pinned = current.historyScope ?? current.claudeHistory;
        if (scope.history !== undefined && pinned?.requestId !== scope.requestId) current.historyScope = scope.history;
        history = scope.history;
        const boundHistory = (current.historyScope ?? current.claudeHistory)?.history;
        if (history?.history !== undefined && (boundHistory === undefined || !sameHistoryQuery(history.history.query, boundHistory.query))) fail('forbidden');
        includesReplay = scope.transcript.some(item => item.role === 'assistant');
        if (includesReplay && !this.#replayable(current.id, scopedAccess, scope.effects)) {
          throw new Fault('forbidden', 'Earlier task data can no longer be replayed to this supervisor.');
        }
        const base = this.#hostedBase(current, scope.transcript, context, tools, access, proposalCopy.synced ? proposalCopy.mode : undefined);
        if (hostedInputUnits(provider, base) > hostedInputCapacity(provider)) {
          throw new Fault('capacity', 'The current turn exceeds the model’s working input limit. The model request was not sent.');
        }
        const fitted = this.#fitHostedHistory(current, provider, base, [...eligible.values()]);
        historySources = fitted.sources;
        if (tools.some(tool => tool.name === SET_WEMO_POWER || tool.name === SET_MODE || modelCatalogTool(tool.name))) {
          controlScope = this.#modelControlScope(current, fitted.sources, eligible);
        }
        inputVersions = ledger.fields.flatMap(field => {
          const version = this.#disclosureVersion(field);
          return version === undefined ? [] : [{field, version}];
        });
        request = fitted.input;
      } else {
        const replayFields: FieldAccess = (source, field, record) => modelAccess(source, field, record) && fields(source, field, record);
        const visible = (item: TurnInput['transcript'][number], prompt: FieldAccess, model: FieldAccess) => {
          const id = conversationMessageId(current.id, item);
          return prompt('conversation', 'text', id) && (id === undefined || item.role === 'owner' ||
            model('conversation', 'text', id) && this.#jobMessageAllowed({id, taskId: current.id, role: item.role}, model));
        };
        const allows = (item: TurnInput['transcript'][number]) => visible(item, promptFields, modelFields);
        const latest = current.transcript.filter(item => item.role === 'owner').at(-1);
        if (latest !== undefined && !allows(latest)) throw new Fault('forbidden', 'This message is not shared with the configured model.');
        includesReplay = this.#replayable(current.id, modelFields) && current.transcript.every(allows);
        const transcript = includesReplay ? current.transcript : current.transcript.filter(item => item.role === 'owner' && allows(item));
        for (const item of transcript) if (!visible(item, fields, replayFields)) fail('forbidden');
        const mode = proposalCopy.mode;
        const context = this.#context(current, undefined, {prompt: fields, model: modelAccess});
        if (tools.some(tool => tool.name === SET_WEMO_POWER || tool.name === SET_MODE || modelCatalogTool(tool.name))) {
          const history = ledger.fields.flatMap(field => field.source !== 'conversation' || field.field !== 'text' || field.record === undefined
            ? [] : [{id: field.record, revision: this.store.messages.get(field.record)?.revision ?? 0}]);
          controlScope = this.#modelControlScope(current, history);
        }
        request = {instructions: controlInstructions(tools), context, transcript, tools,
          mode: mode === undefined || !fields('devices', 'status', 'hub') ? null : {mode: mode.mode, revision: mode.revision}};
      }
      if (!paid) request = {...request, transcript: request.transcript.map(item => {
        if (item.role !== 'owner' || !('submittedAtMs' in item)) return item;
        const {submittedAtMs: _, ...message} = item;
        return message;
      })};
      // The call reserves what this request could use: its bytes bound its input tokens, and the output bound its answer's.
      const inputUnits = provider.inputUnits?.(request) ?? inputBound(request);
      return {units: inputUnits + LIMITS.outputUnits, unit: paid ? 'tokens' : 'synthetic units',
        ...(paid ? {spend: {model: provider.model, inputUnits, outputUnits: LIMITS.outputUnits, ...(current.supervisor?.pricing === undefined ? {} : {pricing: current.supervisor.pricing})}} : {})};
    }).finally(() => {releaseSpend?.();});
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
    let targets: readonly (readonly string[])[] | undefined;
    let knownTargets: readonly (readonly string[])[] | undefined;
    let draftRevision: number | undefined;
    let sceneReceipt: SceneReceipt | undefined;
    const clarificationDevices = new Set<string>();
    const currentTask = this.#task(state.taskId);
    const clarificationAccess = paid ? this.#supervisorScope(currentTask).fields : modelFields;
    const discover = this.#fields(task.profile, 'discovery', 'private-conversation'), read = this.#fields(task.profile, 'read', 'private-conversation');
    const canNameDevice = (id: string, access = clarificationAccess): boolean => {
      const allowed = discover('devices', 'index', id) && read('devices', 'index', id) && read('devices', 'label', id)
        && access('devices', 'index', id) && access('devices', 'label', id);
      if (allowed) clarificationDevices.add(id);
      return allowed;
    };
    const noOwnerRequest = 'refused: this control needs a clear current owner request naming the action, target and setting.';
    let direct: BoundControl | undefined;
    const command = call === undefined ? undefined : catalogCommand(call.name);
    const interpreted = command !== undefined && modelCatalogCommand(command);
    const brightnessTarget = paid && next === 'approve' && (command === 'brightness-set' || call?.name === SET_LIFX_BRIGHTNESS)
      ? this.#supervisorScope(currentTask).brightnessTarget : undefined;
    const brightnessMatches = brightnessTarget === undefined ? [] : await this.#catalog().deviceSubjectMatches(brightnessTarget, active.span.context);
    const brightnessAnswer = this.#controlClarification(currentTask)?.answer ?? undefined;
    const savedControl = task.control?.requestId === `${task.id}-step-${String(state.step + 1)}` ? task.control : undefined;
    if (savedControl !== undefined) {
      direct = savedControl;
      next = 'act';
    } else if (call !== undefined && brightnessMatches.length > 1 && chooseBrightnessSubject(brightnessMatches, brightnessAnswer) === undefined) {
      const id = `${state.taskId}-q${String(currentTask.questions + 1)}`;
      question = {id, kind: 'clarification', text: deviceClarification('device', brightnessMatches.map(({device}) => device.id), canNameDevice),
        answer: null, call: call.id, proposal: null};
    } else if (next === 'approve' && call?.name === SET_WEMO_POWER) {
      const bound = this.#bindWemoControl(currentTask, call, id, state.step + 1);
      if (typeof bound === 'string') {
        result = bound;
        next = 'tool';
      } else if (bound.kind === 'clarify') {
        const questionId = `${state.taskId}-q${String(currentTask.questions + 1)}`;
        const access = paid ? this.#supervisorScope(currentTask, 'supervisor', bound.targets).fields : modelFields;
        const text = bound.exactIds === true ? 'Which plugs should I control? Give each exact ID in the form id:<device-id>.'
          : deviceClarification('plug', bound.targets, target => canNameDevice(target, access));
        question = {id: questionId, kind: 'clarification', text, answer: null, call: call.id, proposal: null};
      } else {
        direct = bound.control;
        next = 'act';
      }
    } else if (next === 'approve' && command !== undefined && call !== undefined) {
      const admission = interpreted ? this.#catalogAdmission(currentTask.id, id, call) : undefined;
      const selected = command === 'art-request' && this.store.hasArtReply(task.id) || admission?.current() === false
        ? {code: 'invalid-state'} : await this.#catalog().propose(command, call, active.span.context, canNameDevice, admission);
      const questionId = `${state.taskId}-q${String(this.#task(state.taskId).questions + 1)}`;
      if ('code' in selected) result = `refused: ${selected.code}`;
      else if ('question' in selected) {
        if (interpreted && this.#controlClarification(currentTask)?.answer != null) result = 'refused: the target is still unclear.';
        else question = {id: questionId, kind: 'clarification', text: selected.question, answer: null, call: call.id, proposal: null};
      }
      else {
        question = {id: questionId, kind: 'approval', text: selected.text, answer: null, call: call.id, proposal: selected.proposal};
        targets = selected.targets;
        knownTargets = selected.knownTargets;
        draftRevision = selected.draftRevision;
        sceneReceipt = selected.sceneReceipt;
        if (!interpreted) {
          const instruction = task.transcript.filter(item => item.role === 'owner').at(-1)?.text ?? task.prompt;
          const matches = namedControlTargets(selected.proposal, instruction, knownTargets ?? []);
          if (matches.length > 1 && this.#controlClarification(task)?.answer == null) {
            const text = deviceClarification('device', matches.flatMap(([id]) => id === undefined ? [] : [id]), canNameDevice);
            question = {id: questionId, kind: 'clarification', text, answer: null, call: call.id, proposal: null};
          }
        }
      }
    } else if ((next === 'ask' || next === 'approve') && call !== undefined) {
      question = this.#question(state.taskId, call, proposalCopy, canNameDevice, id);
    }
    const proposal = question?.proposal;
    if (call !== undefined && question !== undefined && proposal != null && proposal.family !== 'coding-dispatch' && command !== 'art-request') {
      if (interpreted || call.name === SET_MODE) {
        const bound = this.#bindCatalogControl(currentTask, proposal, call, id, state.step + 1, question.text, knownTargets, draftRevision, sceneReceipt);
        if ('code' in bound) {
          result = `refused: ${bound.code}`;
          if (proposal.family === 'mode-set' && bound.code === 'revision-conflict') {
            result = 'refused: revision-conflict: the Hub mode changed after the request was resolved. No change was sent.';
          }
          if (proposal.family === 'mode-set' && bound.code === 'invalid-state') result = noOwnerRequest;
        }
        else if ('clarify' in bound) {
          if (this.#controlClarification(currentTask)?.answer == null) {
            const access = paid ? this.#supervisorScope(currentTask, 'supervisor', bound.clarify).fields : modelFields;
            question = {...question, kind: 'clarification', proposal: null,
              text: deviceClarification(command === 'art-show' ? 'display' : 'device', bound.clarify, target => canNameDevice(target, access))};
          } else result = 'refused: the target is still unclear.';
        } else direct = bound;
      } else {
        direct = this.#bindControl(task, proposal, call, question.text, state.step + 1, targets, knownTargets);
      }
      next = direct === undefined ? 'tool' : 'act';
      if (direct === undefined && result === '') result = noOwnerRequest;
      if (question.kind !== 'clarification') question = undefined;
    }
    // A command the module cannot bind to a synced Hub-mode revision, or whose value is not a mode, is refused to the model in the tool node.
    if (next === 'approve' && question === undefined) next = 'tool';
    if (question?.kind === 'clarification') next = 'ask';
    // The superseded answer is saved and never spoken; only the turn's final reply is (Hub #2031).
    const forced = next === 'end' && steered;
    const item: Appended = {role: 'assistant', text: reply.text, calls: call === undefined ? [] : [call], effect: id, ...(reply.blocks === undefined ? {} : {blocks: reply.blocks})};
    let asked = false;
    await this.#append(state.taskId, item, active.span.context, current => {
      if (forced && reply.text !== null && reply.text.trim() !== '') this.store.message(current, supersededReplyId(id), 'assistant', reply.text, this.context.clock.now());
      if (direct !== undefined) current.control = direct;
      if (question === undefined) return;
      if (current.questions >= LIMITS.questions) throw new Fault('capacity', `This turn reached its limit of ${String(LIMITS.questions)} questions.`);
      current.questions += 1; current.question = question;
      if (clarificationDevices.size > 0) current.clarificationDevices = [...new Set([...(current.clarificationDevices ?? []), ...clarificationDevices])];
      this.store.message(current, question.id, 'assistant', question.text, this.context.clock.now()); asked = true;
    });
    if (asked && question !== undefined) this.#speak(state.taskId, question.id, question.text, active.span.context);
    return forced ? {step: state.step + 1, next: 'turn', result: ''} : {step: state.step + 1, next, result};
  }
  /**
   * Takes the task's unread steers into its transcript, oldest first, as the owner's text after whatever the last call
   * produced, and saves each in the conversation where the model read it (Hub #2031). Idempotent: a steer already in the
   * transcript is not added again. Runs in a model call's admission transaction. Adapted from Codex's pending-input
   * drain in `run_turn` (`codex-rs/core/src/session/turn.rs` at a0436d69, Apache-2.0; see THIRD-PARTY-NOTICES.md).
   */
  #drain(task: Task): void {
    const steers = this.store.queue.steers(task.id);
    if (steers[0] !== undefined) task.ownerInputStart = `steer-${steers[0].id}`;
    for (const steer of steers) {
      const effect = `steer-${steer.id}`;
      const item: Appended = {role: 'owner', text: steer.text, effect, submittedAtMs: steer.savedAtMs};
      if (!task.transcript.some(existing => 'effect' in existing && existing.effect === effect)) task.transcript.push(item);
      this.store.message(task, steerMessageId(task.id, steer.id), 'owner', steer.text, this.context.clock.now());
      this.store.queue.delivered(steer.id);
    }
    if (textBytes(JSON.stringify(task.transcript)) > LIMITS.stateBytes) throw new Fault('capacity', 'This turn reached its working transcript limit.');
  }
  #catalog(): ConversationActions {return this.#catalogActions ??= new ConversationActions(this.context, this.#allowed, this.#deviceDisplay, this.options.retainedArtwork, this.options.readCatalogIdentity);}
  #catalogActions: ConversationActions | undefined;
  /** The question a call asks, or undefined when the command cannot be proposed. */
  #question(taskId: string, call: ToolCall, copy: CoreCopy, canNameDevice: (id: string) => boolean, modelCallId: string): Question | undefined {
    const id = `${taskId}-q${String(this.#task(taskId).questions + 1)}`;
    if (call.name === ASK_OWNER) {
      const text = typeof call.input.text === 'string' && call.input.text.trim() !== '' ? call.input.text : 'What should the assistant do next?';
      return {id, text: text.slice(0, 1024), answer: null, kind: 'clarification', call: call.id, proposal: null};
    }
    if (call.name === DELEGATE_CODING) {
      const {repository, brief, harness, destination, os} = call.input;
      if (typeof repository !== 'string' || !REPOSITORY.test(repository) || repository.length > 64 || typeof brief !== 'string' || brief.trim() === '' || textBytes(brief) > BRIEF_BYTES) return undefined;
      // A busy slot still proposes: an approved hand-off waits for it (Hub #2028). Only a missing worker refuses.
      const task = this.#task(taskId);
      const coding = this.options.coding?.(task.profile);
      if (coding === undefined || !coding.available || coding.endpointId === null) return undefined;
      if (harness !== undefined && !codingChoice(harness) || destination !== undefined && !codingDestinationChoice(destination) ||
        os !== undefined && !codingOS(os) || Object.keys(call.input).some(key => !['repository', 'brief', 'harness', 'destination', 'os'].includes(key))) return undefined;
      const preference = task.codingPreference;
      const ownerRoute = ownerCodingRoute(task.prompt);
      const choice = preference?.harness ?? ownerRoute.harness ?? harness;
      const execution = preference?.destination ?? ownerRoute.destination ?? destination;
      const requirements = bindCodingRequirements(preference?.requirements ?? (os === undefined ? undefined : {os}), this.options.codingRequirements?.(task.prompt));
      const proposal: Proposal = {family: 'coding-dispatch', target: 'assistant', expectedRevision: coding.revision,
        data: {repository, brief: brief.trim(), ...(choice === undefined ? {} : {harness: choice}),
          ...(execution === undefined ? {} : {destination: execution}), ...(requirements === undefined ? {} : {requirements})}};
      return {id, text: `Delegate to the coding worker in ${repository}: ${proposal.data.brief}`.slice(0, 1024), answer: null, kind: 'approval', call: call.id, proposal};
    }
    const owner = deviceToolOwner(call.name);
    if (owner === ASSISTANT_LIGHT_OWNER) {
      const devices = this.options.devices?.(owner);
      const task = this.#task(taskId);
      const instruction = task.transcript.filter(item => item.role === 'owner').at(-1)?.text ?? task.prompt;
      const answer = task.question?.kind === 'clarification' ? task.question.answer : null;
      if (call.name === SET_LIFX_BRIGHTNESS && answer === null && missingBrightness(instruction)) {
        return {id, text: 'What brightness percentage do you want?', answer: null, kind: 'clarification', call: call.id, proposal: null};
      }
      const subject = powerSubject(instruction);
      const addressed = subject !== undefined && answer === null ? devices?.filter(device =>
        subject === normalizedControlText(device.id) || subject === normalizedControlText(deviceLabel(device))) : undefined;
      const selected = addressed !== undefined && addressed.length > 1 ? {matches: addressed} : chooseDevice(devices, call.input.device, call.name === SET_LIFX_BRIGHTNESS);
      if ('matches' in selected) {
        const text = deviceClarification('light', selected.matches.map(device => device.id), canNameDevice);
        return {id, text, answer: null, kind: 'clarification', call: call.id, proposal: null};
      }
      if ('code' in selected) return undefined;
      const result = deviceProposal(call, selected.device);
      if ('code' in result) return undefined;
      return {id, text: deviceProposalText(result.proposal, deviceLabel(selected.device)), answer: null, kind: 'approval', call: call.id, proposal: result.proposal};
    }
    const mode = MODES.find(value => value === call.input.mode);
    const scope = call.name === SET_MODE ? this.#currentModelControl(this.#task(taskId), modelCallId) : undefined;
    if ((mode !== undefined || call.input.mode === 'clarify') && scope !== undefined && scope.answer === undefined &&
        scope.modeRevision !== null && this.store.call(modelCallId)?.modelControlProof?.modeRevision === scope.modeRevision &&
        scope.exactTargets.every(target => target === 'hub') && missingMode(scope.request.text)) {
      return {id, text: 'Which mode should I switch the Hub to: work, free, or quiet?', answer: null, kind: 'clarification', call: call.id, proposal: null,
        modeClarification: {requestId: scope.request.id, requestRevision: scope.request.revision, modeRevision: scope.modeRevision}};
    }
    if (mode === undefined || copy.mode === undefined || !copy.synced) return undefined;
    const proposal: Proposal = {family: 'mode-set', target: 'hub', data: {mode}, expectedRevision: copy.mode.revision};
    return {id, text: `Set the Hub mode to ${proposal.data.mode}?`, answer: null, kind: 'approval', call: call.id, proposal};
  }
  #controlClarification(task: Task): Question | undefined {
    const latest = task.transcript.filter(item => item.role === 'owner').at(-1);
    const afterInstruction = task.transcript.slice(latest === undefined ? 0 : task.transcript.lastIndexOf(latest) + 1);
    return task.question?.kind === 'clarification' && afterInstruction.some(item =>
      item.role === 'tool' && 'effect' in item && item.effect === `${task.question?.id}-answer`) ? task.question : undefined;
  }
  #disclosedWemoTargets(task: Task, effects?: ReadonlySet<string>): string[] {
    const configured = this.options.devices?.(ASSISTANT_WEMO_OWNER) ?? [];
    return task.transcript.flatMap(item => {
      if (item.role !== 'tool' || item.name !== WEMO_TARGETS && item.name !== READ_WEMO ||
          !('effect' in item) || typeof item.effect !== 'string' || effects?.has(item.effect) === false) return [];
      const call = this.store.call(item.effect);
      if (call?.status !== 'succeeded' || call.result !== item.result) return [];
      return call.wemoFacts?.flatMap(fact => {
        const device = configured.find(candidate => candidate.id === fact.id);
        return device !== undefined && controlReferenceSnapshot(wemoControlReference(device, true)) === fact.revision ? [fact.id] : [];
      }) ?? [];
    });
  }
  #modelControlScope(task: Task, historySources: readonly ContextSourceVersion[] = [],
    eligibleHistory?: ReadonlyMap<string, HostedHistoryMessage>): ModelControlScope {
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    const discover = this.#fields(task.profile, 'discovery', 'private-conversation');
    const hosted = this.#taskProvider(task).name !== 'synthetic';
    const fields = this.#modelFields(task.profile);
    const permitted = (source: ShareQuery['source'], field: ShareQuery['field'], id: string) => hosted
      ? recordedSupervisorField(this.options.share, task.profile, 'supervisor', source, field, id) : fields(source, field, id);
    const savedSource = (id: string, field: 'request' | 'excerpt', ownerOnly = true): ControlSource | undefined => {
      const message = this.store.messages.get(id);
      if (message === undefined || ownerOnly && message.speakerId !== 'owner' || message.conversationId !== task.conversationId ||
        this.store.messages.removal(id) !== undefined || !read('conversation', 'text', task.conversationId) || !read('conversation', 'text', id) ||
        !permitted('conversation', hosted ? field : 'text', task.conversationId) || !permitted('conversation', hosted ? field : 'text', id)) return undefined;
      if (message.speakerId !== 'owner' && (message.taskId === null ||
        !this.#replayable(message.taskId, fields) || !this.#savedDisclosureAllowed(message.taskId, read))) return undefined;
      return message.meaning.kind === 'literal' ? {id, revision: message.revision, text: message.meaning.text} : undefined;
    };
    const inputs = task.transcript.filter(item => item.role === 'owner');
    const newest = inputs.at(-1);
    const requestId = newest === undefined ? `${task.id}-prompt` : conversationMessageId(task.id, newest) ?? fail('invalid-state');
    const saved = savedSource(requestId, 'request');
    const question = this.#controlClarification(task);
    const savedAnswer = question?.answer == null ? undefined : savedSource(`${question.id}-answer`, 'excerpt');
    const answer = savedAnswer?.text === question?.answer ? savedAnswer : undefined;
    const request = saved !== undefined && saved.text === (newest?.text ?? task.prompt) &&
      (question?.answer == null || answer !== undefined) ? saved : {id: requestId, revision: 0, text: ''};
    const history = hosted ? eligibleHistory ?? this.#hostedHistory(task) : undefined;
    const references = (this.options.devices?.(ASSISTANT_WEMO_OWNER) ?? []).map(device => wemoControlReference(device,
      discover('devices', 'index', device.id) && (['index', 'label', 'status'] as const).every(field =>
        read('devices', field, device.id) && permitted('devices', field, device.id))));
    const related = new Set(this.#disclosedWemoTargets(task, hosted ? this.#supervisorScope(task).effects : undefined));
    for (const text of [request.text, answer?.text ?? '']) for (const id of controlReferenceIds(references, text)) related.add(id);
    const usedHistory = historySources.filter(source => {
      const message = hosted ? history?.get(source.id) : savedSource(source.id, 'excerpt', false);
      if (message?.revision !== source.revision) return false;
      const ids = controlReferenceIds(references, message.text);
      for (const id of ids) related.add(id);
      return ids.length > 0;
    });
    const exactTargets = exactControlIds(`${request.text} ${answer?.text ?? ''}`);
    const core = this.#core();
    const modeRevision = core.synced ? core.mode?.revision ?? null : null;
    return {request, modeRevision, ...(answer === undefined ? {} : {answer}), history: usedHistory, exactTargets,
      references: references.map(reference => ({...reference, eligible: related.has(reference.id)}))};
  }
  #bindWemoControl(task: Task, call: ToolCall, modelCallId: string, step: number):
    string | {kind: 'clarify'; targets: readonly string[]; exactIds?: true} | {kind: 'bound'; control: BoundControl} {
    const saved = this.store.call(modelCallId)?.modelControlProof;
    if (saved === undefined || saved.request.revision === 0 || this.store.queue.steers(task.id).length > 0) return 'refused: invalid-state';
    const scope = this.#modelControlScope(task, saved.history);
    if (!this.#sameControlSources(saved, scope) || saved.modeRevision !== scope.modeRevision) return 'refused: revision-conflict';
    if (!isDeepStrictEqual(saved.references, modelControlProof(scope).references)) return 'refused: revision-conflict';
    const ownerMessageIds = scope.answer === undefined ? [scope.request.id] : [scope.request.id, scope.answer.id];
    if (this.store.calls(task.id).some(receipt => receipt.action?.control?.ownerMessageIds[0] === scope.request.id &&
      proposalTool(receipt.action.control.proposal) === SET_WEMO_POWER)) return 'refused: this request already has Wemo receipts.';
    const result = resolveWemoControl(scope, call.input);
    if (result.kind === 'refused') return `refused: ${result.code}`;
    if (result.kind === 'clarify') return this.#controlClarification(task)?.answer != null
      ? 'refused: the plug selection is still unclear.' : result;
    const devices = this.options.devices?.(ASSISTANT_WEMO_OWNER) ?? [];
    const selected = result.targets.map(id => devices.find(device => device.id === id) ?? fail('invalid-state'));
    const [proposal, ...additional] = selected.map(device => planWemoPower(device, result.settings));
    if (proposal === undefined) return 'refused: invalid-request';
    const first = selected[0];
    const text = additional.length === 0 && first !== undefined ? deviceProposalText(proposal, deviceLabel(first))
      : `Turn ${result.settings ? 'on' : 'off'} the selected Wemo plugs?`;
    return {kind: 'bound', control: {requestId: `${task.id}-step-${String(step)}`, ownerMessageIds, proposal, additional, modelCallId, text, call: call.id,
      ...(result.contextTargets.length === 0 ? {} : {contextTargets: result.contextTargets})}};
  }
  #sameControlSources(saved: ModelControlProof, current: ModelControlScope): boolean {
    return saved.request.id === current.request.id && saved.request.revision === current.request.revision &&
      saved.answer?.id === current.answer?.id && saved.answer?.revision === current.answer?.revision &&
      isDeepStrictEqual(saved.history, current.history);
  }
  #wemoTargetRefusal(task: Task, control: BoundControl, proposal: Proposal): ErrorCode | undefined {
    const saved = control.modelCallId === undefined ? undefined : this.store.call(control.modelCallId)?.modelControlProof;
    if (saved === undefined) return 'invalid-state';
    const scope = this.#modelControlScope(task, saved.history);
    if (!this.#sameControlSources(saved, scope)) return 'forbidden';
    if (saved.modeRevision !== scope.modeRevision) return 'revision-conflict';
    const original = saved.references.find(reference => reference.id === proposal.target);
    const current = scope.references.find(reference => reference.id === proposal.target);
    if (current?.allowed !== true) return 'forbidden';
    if (original?.snapshot !== controlReferenceSnapshot(current)) return 'revision-conflict';
    const device = this.options.devices?.(ASSISTANT_WEMO_OWNER)?.find(device => device.id === proposal.target);
    if (device?.availability !== 'available' || device.held !== undefined) return 'unavailable';
    if (!device.capabilities.power.supported) return 'unsupported-capability';
    if (this.store.queue.steers(task.id).length > 0) return 'cancelled';
    return undefined;
  }
  #currentModelControl(task: Task, modelCallId: string): ModelControlScope | undefined {
    const model = this.store.call(modelCallId);
    const saved = model?.modelControlProof;
    if (model?.taskId !== task.id || model.kind !== 'model' || model.status !== 'succeeded' || saved === undefined || saved.request.revision === 0 ||
        this.store.queue.steers(task.id).length > 0) return undefined;
    const scope = this.#modelControlScope(task, saved.history);
    if (!this.#sameControlSources(saved, scope)) return undefined;
    if (!this.#historySourcesAllowed(model.historySources ?? [], this.#hostedHistory(task)) ||
      model.inputVersions?.some(({field, version}) => this.#disclosureVersion(field) !== version) === true) return undefined;
    return scope;
  }

  #catalogReferenceTexts(task: Task, scope: ModelControlScope, modelCallId: string, ownerOnly = false): readonly string[] {
    const history = this.#hostedHistory(task);
    const prior = (this.store.call(modelCallId)?.historySources ?? []).flatMap(({id}) => {
      const message = history.get(id);
      return message !== undefined && (!ownerOnly || message.role === 'owner') ? [message.text] : [];
    });
    return [scope.request.text, scope.answer?.text ?? '', ...prior];
  }

  #catalogPriorCalls(task: Task, modelCallId: string): readonly Call[] {
    const history = this.#hostedHistory(task);
    const sources = new Set((this.store.call(modelCallId)?.historySources ?? []).map(({id}) => id));
    const ownerMessages = [...history.values()].filter(message => message.role === 'owner' && sources.has(message.id));
    const taskIds = [...new Set(ownerMessages.map(message => message.taskId))].reverse();
    const savedOwnerIds = new Set(ownerMessages.map(message => message.id));
    return taskIds.flatMap(id => this.store.calls(id).slice().reverse().filter(call =>
      call.kind === 'tool' && call.result?.startsWith('refused: ') !== true &&
      call.action?.control !== undefined && call.action.control.ownerMessageIds.every(ownerId => savedOwnerIds.has(ownerId))));
  }

  #lastActivatedScene(taskId: string, modelCallId: string, deviceId: string, parent: TraceContext): Promise<SceneReceipt | undefined> {
    return this.#catalog().lastActivatedScene(deviceId, () => {
      const task = this.#task(taskId);
      if (this.#currentModelControl(task, modelCallId) === undefined) return [];
      const read = this.#fields(task.profile, 'read', 'private-conversation');
      return this.#catalogPriorCalls(task, modelCallId).flatMap(prior => {
        const proposal = prior.action?.control?.proposal;
        if (proposal?.family !== 'catalog-action' || proposal.command !== 'scene-activate' || proposal.target !== deviceId ||
          typeof proposal.data.sceneId !== 'string' || !this.#catalogFieldsPermitted(task, proposal)) return [];
        return [{requestId: prior.id, sceneId: proposal.data.sceneId, permitted: read('operations', 'details', prior.id)}];
      });
    }, parent);
  }

  #catalogAdmission(taskId: string, modelCallId: string, call: ToolCall): CatalogAdmission {
    const current = () => {
      const task = this.#task(taskId);
      const scope = this.#currentModelControl(task, modelCallId);
      const definition = this.#toolsFor(task).find(item => item.name === call.name);
      if (scope === undefined || definition === undefined) return undefined;
      // Playlist mutations can cite every item in a legacy-sized argument.
      const maximum = call.name === catalogTool('pixoo-playlist-change') ? 256 : undefined;
      const refs = readCatalogReferences(call.input.references, scope, maximum);
      if (refs === undefined && definition.input.required.includes('references')) return undefined;
      const roles = catalogToolReferenceRoles(call.name);
      if (refs?.some(ref => !roles.includes(ref.role)) === true) return undefined;
      return {task, scope: refs === undefined ? scope : {...scope, exactTargets: catalogExactTargets(scope, refs)}, refs};
    };
    const visible: CatalogAdmission['visible'] = (source, id) => {
      const active = current();
      if (active === undefined) return false;
      const {task} = active;
      const read = this.#fields(task.profile, 'read', 'private-conversation');
      if (source !== 'devices') return read(source, 'details', id);
      const discover = this.#fields(task.profile, 'discovery', 'private-conversation');
      const hosted = this.#taskProvider(task).name !== 'synthetic';
      return discover(source, 'index', id) && (['index', 'label', 'status'] as const).every(field =>
        read(source, field, id) && (!hosted || recordedSupervisorField(this.options.share, task.profile, 'supervisor', source, field, id)));
    };
    return {
      current: () => current() !== undefined,
      covers: ids => current()?.scope.exactTargets.every(id => id !== '' && ids.includes(id)) === true,
      ownerText: () => {
        const active = current();
        if (active === undefined) return {text: '', explicitIds: []};
        const {scope, refs} = active;
        return {text: refs === undefined ? `${scope.request.text} ${scope.answer?.text ?? ''}`
          : `${catalogSelectionText(scope, refs, 'request')} ${catalogSelectionText(scope, refs, 'answer')}`, explicitIds: scope.exactTargets};
      },
      selector: (kind, selector, contextIds) => {
        const active = current();
        if (active === undefined) return false;
        if (active.refs !== undefined) {
          const id = literalDeviceId(selector) ?? selector;
          if (catalogExcluded(active.refs, kind, id)) return false;
          const selected = catalogSelections(active.refs, kind);
          if (selected.length > 0 && selected.every(ref => ref.kind === 'named')) {
            const plural = call.name === catalogTool('pixoo-playlist-change') && (kind === 'playlist-item' || kind === 'rendition');
            return (plural || selected.length === 1) && selected.some(ref => catalogQuoteNames(ref.quote, id));
          }
          const ref = selected[0];
          if (selected.length !== 1 || ref?.kind !== 'prior') return false;
          const prior = this.#catalogReferenceTexts(active.task, active.scope, modelCallId, true).slice(2);
          if (!isCatalogSelectorKind(kind)) return prior.some(text => containsControlValue(text, selector));
          return catalogHistoryNames(kind, selector, prior);
        }
        return !isCatalogSelectorKind(kind) || catalogSelectorSelected(kind, selector, active.scope,
          this.#catalogReferenceTexts(active.task, active.scope, modelCallId, true).slice(2), contextIds);
      },
      hasSelection: role => catalogSelections(current()?.refs ?? [], role).length > 0,
      excludedNames: role => current()?.refs?.filter(ref => ref.role === role && ref.disposition === 'exclude').map(ref => ref.quote) ?? [],
      excluded: (role, id, label) => {
        const refs = current()?.refs;
        return refs !== undefined && catalogExcluded(refs, role, id, label);
      },
      visible,
      attachedArtwork: (requestId, artworkIds, displays) => {
        const active = current();
        if (active === undefined) return false;
        const {task, scope, refs} = active, through = task.contextThrough;
        if (through === undefined || refs !== undefined &&
          !catalogSelections(refs, 'artwork').some(ref => ref.kind === 'prior')) return false;
        const displayIds = displays.filter(id => !artworkIds.includes(id));
        if (scope.exactTargets.some(id => !displayIds.includes(id)) ||
          artworkIds.some(id => catalogSelectorSelected('artwork', id, scope, [], displayIds))) return false;
        const call = this.store.call(modelCallId);
        const disclosed = call?.disclosures?.filter(field => field.source === 'artwork' && field.field === 'attachment');
        if (disclosed?.length !== 1 || disclosed[0]?.record !== requestId) return false;
        const read = this.#fields(task.profile, 'read', 'private-conversation');
        const model = this.#fields(task.profile, 'prompt', this.#taskProvider(task).name);
        if (!read('conversation', 'text', task.conversationId) || !read('artwork', 'attachment', requestId) ||
          !model('artwork', 'attachment', requestId)) return false;
        return this.store.recentContext(task.profile, task.conversationId, through, message =>
          read('conversation', 'text', message.id) && model('conversation', 'text', message.id))
          .messages.some(message => message.attachment?.requestId === requestId);
      },
      lastActivatedScene: async (deviceId, parent) => {
        const active = current();
        if (active?.refs === undefined) return undefined;
        const {task, refs} = active;
        const [selection, ...others] = catalogSelections(refs, 'scene');
        if (selection?.kind !== 'last-activated' || others.length > 0) return undefined;
        const receipt = await this.#lastActivatedScene(task.id, modelCallId, deviceId, parent);
        return receipt !== undefined && !catalogExcluded(refs, 'scene', receipt.sceneId) ? receipt : null;
      },
      target: (id, source, alternatives, implicit = false, nested = []) => {
        const active = current();
        if (active === undefined || !visible(source, id)) return 'forbidden';
        const {task, scope, refs} = active;
        const texts = this.#catalogReferenceTexts(task, scope, modelCallId, true);
        const references = alternatives.map(target => ({...target, binding: '', allowed: visible(source, target.id), eligible: false}));
        const excluded = (candidate: (typeof references)[number]) =>
          refs !== undefined && catalogExcluded(refs, source === 'shows' ? 'draft' : 'primary', candidate.id, candidate.label, candidate.owner);
        if (references.some(candidate => candidate.id === id && excluded(candidate))) return 'not-found';
        const addressed = new Set((refs === undefined ? [scope.request.text, scope.answer?.text ?? '']
          : [catalogSelectionText(scope, refs, 'request'), catalogSelectionText(scope, refs, 'answer')])
          .flatMap(text => controlReferenceIds(references, text)));
        const exact = scope.exactTargets.filter(value => !nested.includes(value) || references.some(reference => reference.id === value));
        if (exact.some(value => !references.some(reference => reference.id === value))) return 'not-found';
        if (refs !== undefined) {
          const primary = catalogSelections(refs, source === 'shows' ? 'draft' : 'primary');
          if (primary.length === 0) return implicit && alternatives.length === 1 && exact.length === 0 && source === 'status'
            ? undefined : 'not-found';
          if (primary.length !== 1 || primary[0] === undefined) return 'invalid-state';
          const ref = primary[0];
          if (ref.kind === 'named') {
            const matches = references.filter(candidate => candidate.allowed && !excluded(candidate) &&
              catalogQuoteNames(ref.quote, candidate.id, candidate.label, candidate.owner));
            if (matches.length > 1) return 'invalid-state';
            if (matches[0]?.id !== id && !(implicit && source === 'playback' && alternatives.length === 1 &&
              ['music', 'playback'].some(label => catalogQuoteNames(ref.quote, label)))) return 'not-found';
            if (exact.some(value => value !== id)) return 'not-found';
            const body = catalogSelectionText(scope, refs, ref.source);
            return references.some(candidate => candidate.id !== id && candidate.allowed && !excluded(candidate) &&
              catalogReferenceConflict(body, ref.quote, candidate.id, candidate.label)) ? 'not-found' : undefined;
          }
          if (addressed.size > 0 || exact.length > 0) return 'not-found';
          const [latest] = texts.slice(2).reverse().map(text => controlReferenceIds(references, text)).filter(ids => ids.length > 0);
          if (latest !== undefined) return latest.length === 1 && latest[0] === id ? undefined : 'not-found';
          const prior = this.#catalogPriorCalls(task, modelCallId).find(call => call.action?.control?.proposal.family === 'catalog-action' &&
            call.action.control.proposal.command === 'playback-control' && call.status === 'succeeded' &&
            call.result?.startsWith('accepted: ') === true);
          return source === 'playback' && prior?.action?.control?.proposal.target === id ? undefined : 'not-found';
        }
        if (implicit && alternatives.length === 1 && exact.length === 0 && addressed.size === 0) return undefined;
        const eligible = new Set(texts.flatMap(text => controlReferenceIds(references, text)));
        const selected = resolveModelControl({...scope, exactTargets: exact,
          references: references.map(reference => ({...reference, eligible: eligible.has(reference.id)}))},
        {requestId: scope.request.id, selection: {kind: 'references', targets: [id], contextTargets: []}, settings: null}, false, 1);
        return selected.kind === 'refused' ? selected.code : selected.kind === 'clarify' ? 'invalid-state' : undefined;
      },
    };
  }

  #catalogDeviceSelection(task: Task, scope: ModelControlScope, targets: readonly string[],
    knownTargets: readonly (readonly string[])[], modelCallId: string) {
    const read = this.#fields(task.profile, 'read', 'private-conversation');
    const discover = this.#fields(task.profile, 'discovery', 'private-conversation');
    const hosted = this.#taskProvider(task).name !== 'synthetic';
    const external = (field: 'index' | 'label' | 'status', id: string) =>
      !hosted || recordedSupervisorField(this.options.share, task.profile, 'supervisor', 'devices', field, id);
    const references = knownTargets.flatMap(([id, label]) => id === undefined ? [] : [{
      id, label: label ?? id, binding: '', eligible: true,
      allowed: discover('devices', 'index', id) && (['index', 'label', 'status'] as const).every(field =>
        read('devices', field, id) && external(field, id)),
    }]);
    const related = new Set(this.#catalogReferenceTexts(task, scope, modelCallId).flatMap(text => controlReferenceIds(references, text)));
    const result = resolveModelControl({...scope, references: references.map(reference => ({...reference, eligible: related.has(reference.id)}))},
      {requestId: scope.request.id, selection: {kind: 'references', targets, contextTargets: []}, settings: null}, false, 3);
    return result;
  }

  #catalogFieldsPermitted(task: Task, proposal: BoundControl['proposal']): boolean {
    const local = this.#fields(task.profile, 'read', 'private-conversation');
    if (proposal.family === 'mode-set') return local('devices', 'status', 'hub');
    if (proposal.family !== 'catalog-action') return false;
    const {binding, command, data} = proposal;
    const device = (id: string): boolean => {
      const discover = this.#fields(task.profile, 'discovery', 'private-conversation');
      const hosted = this.#taskProvider(task).name !== 'synthetic';
      return discover('devices', 'index', id) && (['index', 'label', 'status'] as const).every(field =>
        local('devices', field, id) && (!hosted || recordedSupervisorField(this.options.share, task.profile, 'supervisor', 'devices', field, id)));
    };
    if (command === 'music-lighting-control' && data.action === 'start-show' &&
        (typeof data.showId !== 'string' || !local('shows', 'details', data.showId))) return false;
    if (binding.kind === 'device' || command === 'mode-override-set' || command === 'music-lighting-control') return device(proposal.target);
    if (command === 'art-show' || command === 'art-catalog-edit') {
      return typeof data.artworkId === 'string' && local('artwork', 'details', data.artworkId) &&
        (command === 'art-catalog-edit' || Array.isArray(data.targets) && data.targets.every(target =>
          typeof target === 'string' && (target === 'browser' || device(target))));
    }
    if (command === 'nanoleaf-show-save') return typeof data.showId === 'string' && local('shows', 'details', data.showId);
    if (command === 'playback-control') return local('playback', 'details', proposal.target);
    const route = catalogRoute(command);
    return local(route.binding === 'record' && route.record === 'session' ? 'sessions' : 'status', 'details', proposal.target);
  }

  #bindCatalogControl(task: Task, proposal: BoundControl['proposal'], call: ToolCall, modelCallId: string, step: number, text: string,
    knownTargets: readonly (readonly string[])[] | undefined, draftRevision?: number, sceneReceipt?: SceneReceipt): BoundControl | {code: ErrorCode} | {clarify: readonly string[]} {
    const scope = this.#currentModelControl(task, modelCallId);
    if (scope === undefined) return {code: 'invalid-state'};
    if (proposal.family === 'mode-set') {
      if (scope.exactTargets.some(id => id !== 'hub')) return {code: 'not-found'};
      if (this.store.call(modelCallId)?.modelControlProof?.modeRevision !== proposal.expectedRevision) return {code: 'revision-conflict'};
    }
    if (!this.#catalogFieldsPermitted(task, proposal)) return {code: 'forbidden'};
    if (proposal.family === 'mode-set') {
      const ownerText = scope.answer?.text ?? scope.request.text;
      if (!authorizesHubMode(ownerText, '', proposal.data.mode)) {
        const question = this.#controlClarification(task);
        const binding = question?.modeClarification;
        if (scope.answer === undefined || binding?.requestId !== scope.request.id || binding.requestRevision !== scope.request.revision ||
            !authorizesHubMode(scope.request.text, scope.answer.text, proposal.data.mode)) return {code: 'invalid-state'};
        if (binding.modeRevision !== proposal.expectedRevision) return {code: 'revision-conflict'};
      }
    }
    if (proposal.family === 'catalog-action' && proposal.command === 'art-catalog-edit' && proposal.data.action === 'delete') {
      const id = proposal.data.artworkId;
      const tokens = `${scope.request.text} ${scope.answer?.text ?? ''}`.split(/[^a-zA-Z0-9_.-]+/u);
      if (typeof id !== 'string' || !tokens.some(token => token === id || token === `${id}.`)) return {code: 'not-found'};
    }
    if (this.store.calls(task.id).some(receipt => receipt.action?.control?.ownerMessageIds[0] === scope.request.id &&
      proposalTool(receipt.action.control.proposal) === call.name && receipt.action.control.proposal.target === proposal.target)) {
      return {code: 'duplicate-conflict'};
    }
    if (proposal.family === 'catalog-action') {
      const artTargets = proposal.command === 'art-show' && Array.isArray(proposal.data.targets)
        ? proposal.data.targets.filter((target): target is string => typeof target === 'string') : [];
      const physical = artTargets.filter(target => target !== 'browser');
      if (artTargets.length > 0 && this.#taskProvider(task).name !== 'synthetic') {
        const refs = readCatalogReferences(call.input.references, scope);
        const primary = refs === undefined ? [] : catalogSelections(refs, 'primary');
        const destinations = [...(knownTargets ?? []), ['browser', 'dashboard']];
        const selected = new Set<string>();
        for (const ref of primary) {
          if (ref.kind !== 'named') return {code: 'not-found'};
          const matches = destinations.filter(([id, label]) => id !== undefined &&
            !catalogExcluded(refs ?? [], 'primary', id, label) && catalogQuoteNames(ref.quote, id, label));
          if (matches.length !== 1 || matches[0]?.[0] === undefined) return {code: 'not-found'};
          selected.add(matches[0][0]);
        }
        const exact = refs === undefined ? scope.exactTargets : catalogExactTargets(scope, refs);
        if (selected.size !== artTargets.length || artTargets.some(target => !selected.has(target)) ||
          exact.some(target => target !== proposal.data.artworkId && !selected.has(target))) return {code: 'not-found'};
      }
      if (artTargets.includes('browser') && !['browser', 'dashboard'].some(label =>
        [scope.request.text, scope.answer?.text ?? ''].some(text => containsControlValue(text, label)))) return {code: 'invalid-request'};
      if (physical.length > 0 && this.#taskProvider(task).name === 'synthetic') {
        const targets = scope.exactTargets.filter(id => id !== proposal.data.artworkId);
        const selected = this.#catalogDeviceSelection(task, {...scope, exactTargets: targets}, physical, knownTargets ?? [], modelCallId);
        if (selected.kind === 'refused') return {code: selected.code};
        if (selected.kind === 'clarify') return {clarify: selected.targets};
      }
    }
    const ownerMessageIds = scope.answer === undefined ? [scope.request.id] : [scope.request.id, scope.answer.id];
    return {requestId: `${task.id}-step-${String(step)}`, ownerMessageIds, proposal, text, call: call.id, modelCallId,
      ...(draftRevision === undefined ? {} : {draftRevision}), ...(sceneReceipt === undefined ? {} : {sceneReceipt})};
  }

  #bindControl(task: Task, proposal: BoundControl['proposal'], call: ToolCall, text: string, ordinal: number,
    targets: readonly (readonly string[])[] | undefined, knownTargets: readonly (readonly string[])[] = []): BoundControl | undefined {
    if (this.store.queue.steers(task.id).length > 0) return undefined;
    const inputs = task.transcript.filter(item => item.role === 'owner');
    const latest = inputs.at(-1);
    const instruction = latest?.text ?? task.prompt;
    const sourceId = latest === undefined ? `${task.id}-prompt` : conversationMessageId(task.id, latest) ?? `${task.id}-prompt`;
    const clarification = this.#controlClarification(task);
    const answer = clarification?.answer ?? '';
    const ownerMessageIds = clarification !== undefined && clarification.answer !== null ? [sourceId, `${clarification.id}-answer`] : [sourceId];
    if (this.store.calls(task.id).some(receipt => {
      const control = receipt.action?.control;
      return control?.ownerMessageIds.join() === ownerMessageIds.join() &&
        control.proposal.target === proposal.target;
    })) return undefined;
    const hosted = this.#taskProvider(task).name !== 'synthetic';
    const recent = hosted ? this.#supervisorScope(task).recent
      : task.contextThrough === undefined ? [] : this.store.recentContext(task.profile, task.conversationId, task.contextThrough).messages;
    const preceding = (hosted ? undefined : inputs.at(-2)?.text) ?? recent.filter(message => message.role === 'owner').at(-1)?.text ?? '';
    const owner = deviceToolOwner(call.name);
    if (targets === undefined && owner !== undefined) {
      const devices = this.options.devices?.(owner);
      knownTargets = devices?.map(device => [device.id, deviceLabel(device)]) ?? [];
      const selected = chooseDevice(devices, proposal.target);
      targets = 'device' in selected ? [[selected.device.id, deviceLabel(selected.device)]] : [[proposal.target]];
    }
    if (targets === undefined && proposal.family === 'catalog-action') {
      targets = [[proposal.target]];
    }
    if (!authorizesControl(proposal, instruction, answer, targets ?? [], preceding, knownTargets)) return undefined;
    return {requestId: `${task.id}-step-${String(ordinal)}`, ownerMessageIds, proposal, text, call: call.id};
  }
  /** Why a command call was refused instead of proposed. */
  #proposalRefusal(call: ToolCall, task: Task): string {
    const copy = this.#core();
    if (call.name === SET_WEMO_POWER) return 'refused: the Wemo call needs a current typed proposal.';
    if (call.name === DELEGATE_CODING) {
      const {repository, brief, harness, destination, os} = call.input;
      if (typeof repository !== 'string' || !REPOSITORY.test(repository) || repository.length > 64 || typeof brief !== 'string' ||
        brief.trim() === '' || textBytes(brief) > BRIEF_BYTES) return 'Name an allowlisted repository and write a brief under 4 KiB.';
      if (harness !== undefined && !codingChoice(harness) || destination !== undefined && !codingDestinationChoice(destination) ||
        os !== undefined && !codingOS(os) || Object.keys(call.input).some(key => !['repository', 'brief', 'harness', 'destination', 'os'].includes(key))) {
        return 'The coding proposal has an invalid harness, destination or requirement.';
      }
      const execution = task.codingPreference?.destination ?? ownerCodingRoute(task.prompt).destination ?? destination;
      if (codingDestinationChoice(execution) && isCloudChoice(execution)) {
        const coding = this.options.coding?.(task.profile);
        return coding?.cloudDisabled === true ? CLOUD_DISABLED : 'No eligible cloud worker is connected right now.';
      }
      return 'No coding worker is connected right now, so nothing was proposed; the owner can start the worker on their computer.';
    }
    const owner = deviceToolOwner(call.name);
    if (owner !== undefined) {
      const selected = chooseDevice(this.options.devices?.(owner), call.input.device, call.name === SET_LIFX_BRIGHTNESS);
      if ('matches' in selected) return 'Multiple devices match. Ask the owner for an exact device ID.';
      const result = 'code' in selected ? selected : deviceProposal(call, selected.device);
      return 'code' in result ? `refused: ${result.code}; no light change was proposed.` : 'This tool is not permitted.';
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
    const provider = this.#taskProvider(task), tools = this.#toolsFor(task);
    const tool = definition(call.name), permitted = tools.some(permittedTool => permittedTool.name === call.name);
    const id = `${state.taskId}-step-${String(state.step)}`;
    if (tool === undefined || !permitted || (tool.effect !== 'read' && tool.effect !== 'draft')) {
      const reason = tool !== undefined && permitted && tool.effect === 'command'
        ? state.result === '' ? this.#proposalRefusal(call, task) : state.result : 'This tool is not permitted.';
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result: reason, ok: false, effect: `${id}-refused`}, active.span.context,
        current => {this.store.message(current, `${id}-refused`, 'tool', reason, this.context.clock.now());});
      return {step: state.step};
    }
    const owner = deviceToolOwner(call.name);
    const result = await this.#call(state.taskId, state.step, 'tool', async (signal, parent) => {
      const now = this.context.clock.now();
      const scope = provider.name === 'synthetic' ? undefined : this.#supervisorScope(this.#task(task.id));
      const modelFields = scope?.fields ?? this.#taskFields(task);
      const ledger: DisclosureLedger = {fields: []};
      if (scope !== undefined && !modelFields('conversation', 'request', scope.requestId)) throw new ProviderFault('forbidden');
      const access = recordDisclosures(modelFields, ledger);
      let text: string;
      let wemoFactsFrom: readonly DeviceRecord[] | undefined;
      if (call.name === READ_HUB_GUIDE) {
        text = deviceHistoryGuide(new Set(tools.map(tool => tool.name)));
      } else if (call.name === READ_DEVICE_HISTORY) {
        if (scope === undefined) {
          const owner = task.transcript.filter(item => item.role === 'owner').at(-1);
          const requestId = owner === undefined ? `${task.id}-prompt` : conversationMessageId(task.id, owner);
          const request = requestId === undefined ? undefined : this.store.messages.get(requestId);
          text = this.#history.read(call.input, {taskId: task.id, destination: provider.name, now,
            requestedAtMs: owner?.submittedAtMs ?? request?.createdAtMs ?? now, timeZone: this.#historyTimeZone}, access);
        } else {
          const pinned = task.historyScope ?? task.claudeHistory;
          const expected = pinned?.requestId === scope.requestId ? pinned.history : undefined;
          const requested = scope.history?.history;
          if (expected !== undefined && (requested === undefined || !sameHistoryQuery(expected.query, requested.query))) throw new ProviderFault('forbidden');
          if (expected?.kind === 'timestamps' && requested?.kind === 'timestamps' && expected.power === requested.power) {
            const pagesRead = scope.transcript.filter(item => item.role === 'tool' && item.name === READ_DEVICE_HISTORY && item.result.startsWith('{')).length;
            text = this.#history.read(call.input, {taskId: task.id, destination: provider.name, now, requestedAtMs: now,
              timeZone: this.#historyTimeZone, bound: {requestId: scope.requestId, history: requested}, pagesRead}, access);
          } else {
            text = this.#history.summary(call.input, expected === undefined ? undefined : requested, access);
          }
        }
      } else if (call.name === WEMO_TARGETS) {
        const devices = this.options.devices?.(ASSISTANT_WEMO_OWNER);
        const ownerScope = scope === undefined ? undefined : this.#modelControlScope(task);
        const exact = ownerScope?.exactTargets ?? [];
        const names = ownerScope === undefined || exact.length > 0 ? []
          : controlReferenceIds(ownerScope.references, ownerScope.answer?.text ?? ownerScope.request.text);
        const matched = exact.length > 0 ? devices?.filter(device => exact.includes(device.id) && literalDeviceId(`id:${device.id}`) === device.id)
          : names.length > 0 ? devices?.filter(device => names.includes(device.id)) : devices;
        const candidates = exact.length > 0 && matched?.length !== exact.length ? [] : matched;
        const records = candidates?.filter(device => {
          scope?.resolvedCatalogDevice(device.id);
          return access('devices', 'index', device.id) && access('devices', 'label', device.id);
        });
        wemoFactsFrom = records;
        text = readDevices(records, '', now, ASSISTANT_WEMO_OWNER);
      } else if (owner !== undefined) {
        const name = call.input.device;
        const records = this.options.devices?.(owner)?.filter(device => (scope === undefined || scope.selectedDevice(owner, device.id)) &&
          access('devices', 'index', device.id) && access('devices', 'label', device.id) &&
          (name === '' || access('devices', 'status', device.id) && (scope !== undefined || access('devices', 'details', device.id))));
        if (owner === ASSISTANT_WEMO_OWNER) wemoFactsFrom = records;
        const selected = chooseDevice(records, name, true);
        const fresh = 'device' in selected ? await this.options.readDevice?.(owner, selected.device.id, signal, parent, this.#deviceDisplay) : undefined;
        text = fresh ?? readDevices(records, 'device' in selected && typeof name === 'string' ? selected.device.id : name, now, owner, this.#deviceDisplay);
      } else if (draftMutation(call.name)) {
        const modelCall = last !== undefined && 'effect' in last && typeof last.effect === 'string' ? last.effect : undefined;
        const controlScope = modelCall === undefined ? undefined : this.#currentModelControl(this.#task(task.id), modelCall);
        if (modelCall === undefined || controlScope === undefined) return {text: 'refused: invalid-state', units: 0, disclosures: []};
        const owner = task.transcript.filter(item => item.role === 'owner').at(-1);
        const latestOwner = owner === undefined ? -1 : task.transcript.lastIndexOf(owner);
        if (task.transcript.slice(latestOwner + 1).some(item => item.role === 'tool' && item.name === call.name)) {
          return {text: 'refused: duplicate-conflict', units: 0, disclosures: []};
        }
        this.#fence(active);
        const privateRead = this.#fields(task.profile, 'read', 'private-conversation');
        const admission = this.#catalogAdmission(task.id, modelCall, call);
        return this.outbox.transaction(() => {
          this.#fence(active);
          if (!admission.current()) return {text: 'refused: invalid-state', units: 0, disclosures: []};
          const result = this.#catalog().mutateDraft(call, privateRead, admission);
          if ('code' in result) return {text: `refused: ${result.code}`, units: 0, disclosures: [],
            ...(result.draftId === undefined ? {} : {privateDraftId: result.draftId})};
          if (provider.name === 'synthetic') return {text: result.text, units: 0, disclosures: []};
          this.store.message(task, `${id}-draft-${result.draftId}`, 'tool', result.text, this.context.clock.now());
          return {text: 'accepted: the private draft was updated.', units: 0, disclosures: [], privateDraftId: result.draftId};
        });
      } else if (isCatalogTool(call.name)) {
        const evidence: ActionEvidence[] = [];
        text = await this.#catalog().read(call, parent, item => evidence.push(item), access,
          id => typeof id === 'string' && this.store.ownsAction(task.conversationId, id), scope === undefined ? undefined : {subject: scope.catalogSubject, brightnessControl: scope.brightnessTarget !== undefined, resolve: scope.resolvedCatalogDevice}) ?? fail('invalid-state');
        return {text, units: 0, evidence, disclosures: ledger.fields, ...(ledger.incompleteDisclosures === true ? {incompleteDisclosures: true} : {})};
      } else {
        text = call.name === READ_FIXTURE ? FIXTURE_TEXT : call.name === READ_SESSIONS ? summarizeSessions(this.#core(), now, access) : fail('invalid-state');
      }
      const answer: Answer = {text, units: 0, disclosures: ledger.fields};
      if (call.name === WEMO_TARGETS || call.name === READ_WEMO) {
        const disclosed = new Set(ledger.fields.flatMap(field => field.source === 'devices' && field.field === 'label' ? [field.record] : []));
        answer.wemoFacts = (wemoFactsFrom ?? []).flatMap(device => disclosed.has(device.id) && text.includes(`(${device.id})`)
          ? [{id: device.id, revision: controlReferenceSnapshot(wemoControlReference(device, true))}] : []);
      }
      if (ledger.incompleteDisclosures === true) answer.incompleteDisclosures = true;
      return answer;
    });
    await this.#append(state.taskId, {role: 'tool', call: call.id, name: call.name, result, ok: true, effect: id}, active.span.context);
    return {step: state.step + 1};
  }
  async #act(state: GraphState): Promise<Partial<GraphState>> {
    const active = this.#activeFor(state.taskId), task = this.#task(state.taskId);
    const id = `${state.taskId}-step-${String(state.step)}`;
    const direct = task.control?.requestId === id ? task.control : undefined;
    const question = direct === undefined ? task.question ?? fail('invalid-state')
      : {id, call: direct.call, proposal: direct.proposal, text: direct.text, kind: 'approval' as const, answer: null};
    const proposal = question.proposal ?? fail('invalid-state'), name = proposalTool(proposal);
    const hosted = this.#taskProvider(task).name !== 'synthetic';
    const refuse = async (suffix: string, text: string): Promise<Partial<GraphState>> => {
      // A refusal is a tool result the owner can read too; it reserves no call and sends nothing.
      await this.#append(state.taskId, {role: 'tool', call: question.call, name, result: text, ok: false, effect: `${id}-${suffix}`}, active.span.context,
        current => {this.store.message(current, `${id}-${suffix}`, 'tool', text, this.context.clock.now());});
      return {step: state.step, next: 'turn'};
    };
    if (direct === undefined && state.decision !== 'approve') return refuse('declined', DECLINED);
    if (direct !== undefined && this.store.call(id) === undefined && this.store.queue.steers(task.id).length > 0) {
      return refuse('superseded', 'The owner sent new input before dispatch. The earlier control request was not sent.');
    }
    if (!this.#toolsFor(task).some(tool => tool.name === name)) return refuse('refused', 'This tool is not permitted.');
    const artRequest = proposal.family === 'catalog-action' && proposal.command === 'art-request';
    let scopedBrightness: {subject: string; owner: string; access: FieldAccess; requestId: string; answerId?: string} | undefined;
    if (hosted && proposal.family !== 'coding-dispatch') {
      const boundDevice = direct === undefined ? undefined : [proposal.target, ...(direct.additional ?? []).map(item => item.target)];
      const scope = this.#supervisorScope(task, 'supervisor', boundDevice);
      if (scope.brightnessTarget !== undefined && direct !== undefined &&
        (proposal.family === 'brightness-set' || proposal.family === 'catalog-action' && proposal.command === 'brightness-set')) {
        const [requestId, answerId] = direct.ownerMessageIds;
        if (requestId !== scope.requestId) return refuse('refused', 'The original brightness request is no longer available.');
        scopedBrightness = {subject: scope.brightnessTarget, access: scope.fields, requestId,
          owner: proposal.family === 'brightness-set' ? ASSISTANT_LIGHT_OWNER : proposal.binding.owner,
          ...(answerId === undefined ? {} : {answerId})};
      }
      const access = scope.fields;
      if (!access('conversation', 'request', scope.requestId)) return refuse('refused', 'The owner request is private under the configured model sharing policy.');
      if (direct?.modelCallId === undefined && !artRequest && [proposal, ...(direct?.additional ?? [])].some(item => !access('devices', 'label', item.target) || !access('devices', 'status', item.target))) {
        return refuse('refused', 'The requested device is outside the allowed scope.');
      }
    }
    const group = direct?.additional === undefined ? undefined
      : [proposal, ...direct.additional].flatMap((item, index) => {
        if (item.family !== 'power-set' || !('owner' in item)) return [];
        const single = direct.additional?.length === 0;
        const target = confirmationTarget(item, single ? direct.text : '');
        const requestId = single ? id : `${id}-group-${String(index)}`;
        return target === undefined ? [] : [{target, item, command: {requestId, ...item}}];
      });
    if (group !== undefined && (group.length !== 1 + (direct?.additional?.length ?? 0) || group.length > 2 ||
        new Set(group.map(({command}) => command.target)).size !== group.length)) {
      return refuse('refused', 'The Wemo target set is invalid. No power command was sent.');
    }
    const settle = (answer: RequestResult, accepted: string): {text: string; units: number} => {
      // The dispatcher's own uncertainty reaches the module as a rejection carrying `uncertain-result`; the fate is unknown either way.
      if (answer.status === 'uncertain' || (answer.status === 'rejected' && answer.error.error.code === 'uncertain-result')) throw new Fault('uncertain-result');
      if (answer.status === 'accepted') return {text: hosted ? 'accepted: the command entered the tracked dispatcher. Its outcome is pending.' : accepted, units: 0};
      const code = answer.error.error.code;
      return {text: proposal.family === 'mode-set' && code === 'revision-conflict'
        ? 'refused: revision-conflict: the Hub mode changed after the request was resolved. No change was sent.'
        : `refused: ${code}${proposal.family === 'coding-dispatch' && answer.error.error.detail !== undefined ? ` — ${answer.error.error.detail}` : ''}`, units: 0};
    };
    let result: string, delegation: Question | undefined, job: CodingJob | undefined;
    const startedAtMs = this.context.clock.now();
    const target = confirmationTarget(proposal, question.text);
    const action = {questionId: question.id, description: actionDescription(proposal, question.text), ...(direct === undefined ? {} : {control: direct})};
    if (proposal.family !== 'coding-dispatch') {
      const dispatch = this.options.dispatch;
      if (dispatch === undefined) return refuse('refused', 'This tool is not permitted.');
      const data: AssistantDispatch = proposal.family === 'mode-set'
        ? {requestId: id, family: proposal.family, target: proposal.target, data: {mode: proposal.data.mode, expectedRevision: proposal.expectedRevision}}
        : {requestId: id, ...proposal};
      const artDescription = artRequest &&
        typeof proposal.data.description === 'string' ? proposal.data.description : undefined;
      const receipt = proposal.family === 'mode-set'
        ? `accepted: the core accepted mode-set ${proposal.data.mode} as operation ${id}; its outcome is tracked separately`
        : proposal.family === 'catalog-action' && proposal.command === 'art-request'
          ? 'accepted: the art service queued this request. The Conversation attachment will show the actual result.'
          : `accepted: ${proposal.family === 'catalog-action' ? proposal.command : proposal.family} on ${proposal.target} as operation ${id}; its outcome is tracked separately`;
      const confirmationOf = (selected: NonNullable<typeof target>, requestId: string, parent: TraceContext): Confirmation => {
        const acceptedAtMs = this.context.clock.now();
        return {...selected, requestId, taskId: task.id, questionId: question.id,
          acceptedAtMs, expiresAtMs: acceptedAtMs + CONFIRMATION_LIFETIME_MS, traceparent: parent.traceparent};
      };
      result = await this.#call(state.taskId, state.step, 'tool', async (signal, parent) => {
        if (hosted && artRequest) {
          const current = this.#task(task.id);
          const scope = this.#supervisorScope(current, 'supervisor', undefined, this.#hostedHistory(current));
          const prompt = this.#supervisorPromptFields(task.profile);
          const input: FieldAccess = (source, field, record) =>
            (source === 'knowledge' || source === 'preferences' ? prompt : scope.fields)(source, field, record);
          if (!input('conversation', 'request', scope.requestId) || !this.#replayable(task.id, input, scope.effects)) {
            return {text: 'refused: the approved artwork prompt is no longer available.', units: 0, disclosures: []};
          }
        }
        if (scopedBrightness !== undefined) {
          const {subject, owner, access, requestId, answerId} = scopedBrightness;
          const matches = await this.#catalog().deviceSubjectMatches(subject, parent);
          this.#fence(active);
          if (!this.#canReadControlSource(task, requestId) || !access('conversation', 'request', requestId)) {
            return {text: BRIGHTNESS_REQUEST_UNAVAILABLE, units: 0};
          }
          const answer = answerId === undefined ? undefined : this.store.savedMessage(task.id, answerId);
          if (answerId !== undefined && (!this.#canReadControlSource(task, answerId) || !access('conversation', 'excerpt', answerId))) {
            return {text: BRIGHTNESS_ANSWER_UNAVAILABLE, units: 0};
          }
          const match = chooseBrightnessSubject(matches, answer?.text);
          if (match?.owner !== owner || match.device.id !== proposal.target ||
            !access('devices', 'label', proposal.target) || !access('devices', 'status', proposal.target) ||
            this.store.queue.steers(task.id).length > 0) {
            return {text: 'refused: the requested brightness target is no longer clear and permitted.', units: 0};
          }
        }
        if (group === undefined && direct?.modelCallId !== undefined &&
          (this.#currentModelControl(this.#task(task.id), direct.modelCallId) === undefined || !this.#catalogFieldsPermitted(task, direct.proposal))) {
          return {text: 'refused: the bound owner request is no longer current.', units: 0, disclosures: []};
        }
        if (direct?.sceneReceipt !== undefined && direct.modelCallId !== undefined) {
          const receipt = await this.#lastActivatedScene(task.id, direct.modelCallId, proposal.target, parent);
          this.#fence(active);
          if (!isDeepStrictEqual(receipt, direct.sceneReceipt) || !this.#catalogFieldsPermitted(this.#task(task.id), proposal)) {
            return {text: 'refused: Which saved scene would you like to activate on this light?', units: 0, disclosures: []};
          }
        }
        const admitByMs = this.context.clock.now() + SHOW_SAVE_WINDOW_MS;
        if (proposal.family === 'catalog-action') {
          const refused = this.#catalog().beforeDispatch(proposal, id, admitByMs, direct?.draftRevision);
          if (refused !== undefined) return {text: `refused: ${refused}`, units: 0};
        }
        if (group !== undefined) {
          for (const {command, item} of group) {
            const {requestId} = command;
            const watch = await this.outbox.transaction(() => {
              this.#fence(active);
              const current = this.store.confirmation(requestId);
              if (current?.dispatchState !== 'reserved') return undefined;
              if (this.store.queue.steers(task.id).length > 0) {
                this.store.saveConfirmation({...current, result: 'New owner input arrived. No power command was sent.'});
                return undefined;
              }
              const sending = {...current, dispatchState: 'sending' as const};
              this.store.saveConfirmation(sending);
              return sending;
            });
            if (watch === undefined) continue;
            this.#fence(active);
            let reply: RequestResult | {status: 'uncertain'} | undefined;
            const before = direct?.modelCallId === undefined ? undefined : this.#wemoTargetRefusal(this.#task(task.id), direct, item);
            if (this.store.queue.steers(task.id).length === 0 && before === undefined) {
              try {reply = await dispatch(command, parent, signal);}
              catch {reply = {status: 'uncertain'};}
            }
            const settled = await this.outbox.transaction(() => {
              const current = this.store.confirmation(requestId);
              if (current === undefined || current.follows !== undefined || current.result !== undefined) return current;
              if (this.store.queue.steers(task.id).length > 0 && reply === undefined) {
                current.result = 'New owner input arrived. No power command was sent.';
              } else if (before !== undefined) current.result = `The power request was refused: ${before}.`;
              else if (reply === undefined) current.result = 'No power command was sent.';
              else if (reply.status === 'accepted') current.dispatchState = 'accepted';
              else if (reply.status === 'rejected' && reply.error.error.code !== 'uncertain-result') {
                current.result = reply.error.error.code === 'expired' ? 'The power request expired.'
                  : `The power request was refused (${reply.error.error.code}).`;
              }
              this.store.saveConfirmation(current);
              return current;
            });
            if (settled !== undefined) void this.#followConfirmation(settled);
          }
          const receipts = this.store.confirmations(task.id).filter(watch => watch.questionId === question.id);
          const text = receipts.length === 1 && receipts[0]?.dispatchState === 'accepted' ? receipt
            : receipts.map(watch => confirmationText(watch)).join('\n');
          return {text, units: 0};
        }
        const answer = await dispatch(data.family === 'catalog-action' && data.command === 'nanoleaf-show-save'
          ? {...data, admitByMs} : data, parent, signal);
        if (proposal.family === 'catalog-action' && answer.status === 'rejected' && answer.error.error.code !== 'uncertain-result') {
          this.#catalog().rejected(proposal, id);
        }
        const settled = settle(answer, receipt);
        if (answer.status !== 'accepted' || target === undefined) return settled;
        return {...settled, confirmations: [confirmationOf(target, id, parent)]};
      }, (current, call) => {
        call.action = action;
        for (const {target, command} of group ?? []) {
          this.store.saveConfirmation({...confirmationOf(target, command.requestId, {traceparent: call.traceparent}),
            dispatchState: 'reserved', ...(group?.length === 1 ? {} : {grouped: true})});
        }
        if (scopedBrightness !== undefined) call.directBrightness = true;
        const targets = [proposal, ...(direct?.additional ?? [])];
        call.disclosures = hosted && (artRequest || direct?.modelCallId !== undefined && group === undefined) ? [] : [...(hosted ? [] : [{source: 'operations', field: 'details', record: id} satisfies DisclosedField]), ...targets.flatMap<DisclosedField>(item => [
          {source: 'devices', field: 'label', record: item.target}, {source: 'devices', field: 'status', record: item.target},
          ...(item.family === 'catalog-action' && item.command === 'art-show' && typeof item.data.artworkId === 'string'
            ? [{source: 'artwork', field: 'details', record: item.data.artworkId} satisfies DisclosedField] : []),
        ])];
        if (artDescription === undefined) return;
        const displays = proposal.family === 'catalog-action' ? proposal.data.showTargets : undefined;
        this.store.artReply(current, id, artDescription, this.context.clock.now(), Array.isArray(displays) && displays.every((v): v is string => typeof v === 'string') ? displays : undefined);
      });
    } else {
      if (this.#codingInputsRefusal(task, proposal.data.repository, state.step, this.options.backgroundCoding === true ? null : 'mac') !== undefined) return refuse('refused', 'Coding brief sharing is not permitted.');
      const delegate = this.options.delegate;
      if (delegate === undefined) return refuse('refused', 'This tool is not permitted.');
      // The task waits on the delegation before the hand-off leaves, so a worker's word that comes back faster than this
      // step finds its question. The worker's word answers it as the owner's answer would a question; it counts no question.
      const pending: Question = {id: `${state.taskId}-delegation-${String(state.step)}`, text: `Delegated to the coding worker in ${proposal.data.repository}: ${proposal.data.brief}`.slice(0, 1024),
        answer: null, kind: 'delegation', call: question.call, proposal: null};
      delegation = pending;
      // A hand-off whose companion's slot is busy waits for it; it was approved and is sent once when the slot frees.
      const companion = PROFILES.find(entry => entry.id === task.profile)?.name ?? task.profile;
      const choice = question.codingChoice ?? proposal.data.harness;
      const destination = question.codingDestination ?? proposal.data.destination;
      const requirements = bindCodingRequirements(question.codingRequirements,
        bindCodingRequirements(proposal.data.requirements, this.options.codingRequirements?.(task.prompt)));
      result = await this.#call(state.taskId, state.step, 'tool', signal => delegate({requestId: id, taskId: state.taskId, conversationId: task.conversationId,
        companion: task.profile, repository: proposal.data.repository, brief: proposal.data.brief,
        expectedRevision: proposal.expectedRevision, ...(choice === undefined ? {} : {choice}),
        ...(destination === undefined ? {} : {destination}), ...(requirements === undefined ? {} : {requirements})}, active.span.context, signal)
        .then(answer => {
          if (answer.status === 'queued') {
            job = {jobId: answer.jobId, operationId: answer.requestId, taskId: task.id, conversationId: task.conversationId, repository: proposal.data.repository, brief: proposal.data.brief};
            return {text: jobReceipt(job), units: 0};
          }
          return answer.status === 'waiting'
            ? {text: `${WAITING_RECEIPT} ${companion}'s slot as operation ${id}; it is sent when that slot frees, and its structured result arrives as this tool's later result`, units: 0}
            : settle(answer, `accepted: the coding worker was handed the task as operation ${id}; its structured result arrives as this tool's later result`);
        }), (current, call) => {
          if (this.options.backgroundCoding !== true) current.question = pending;
          call.action = action;
          call.codingApproval = {destination: 'coding-worker', repository: proposal.data.repository, briefDigest: digest(proposal.data.brief)};
          call.disclosures = [{source: 'coding', field: 'repository', record: proposal.data.repository}, {source: 'coding', field: 'brief', record: proposal.data.repository}];
        });
      if (job === undefined && result.startsWith('accepted: Coding job ')) {
        job = {jobId: `${id}-job`, operationId: id, taskId: task.id, conversationId: task.conversationId, repository: proposal.data.repository, brief: proposal.data.brief};
      }

    }
    const accepted = group === undefined ? result.startsWith('accepted') :
      group.some(({command}) => this.store.confirmation(command.requestId)?.dispatchState === 'accepted');
    const requestIds = group === undefined ? [id] : group.map(({command}) => command.requestId);
    const confirmations = requestIds.flatMap(requestId => this.store.confirmation(requestId) ?? []);
    if (confirmations.length > 0) {
      const remaining = Math.min(IN_TURN_CONFIRMATION_MS, LIMITS.toolMs - (this.context.clock.now() - startedAtMs));
      await this.#waitForConfirmations(confirmations, remaining, active.controller.signal);
      this.#fence(active);
      const recorded = confirmations.map(watch => this.store.confirmation(watch.requestId) ?? watch);
      if (group !== undefined) result = recorded.map(watch => confirmationText(watch)).join('\n');
      else if (recorded[0] !== undefined) {
        const [watch] = recorded;
        if (hosted) {
          result = watch.result === undefined ? 'The command was accepted. Its effect is unconfirmed.' :
            watch.result.startsWith('applied') ? 'The applied effect was confirmed.' : 'The command has a result. Its effect is unconfirmed.';
        } else result = watch.result ?? pending(watch);
      }
    }
    if (scopedBrightness !== undefined && (accepted || stoppedBeforeBrightness(result))) {
      return {step: state.step + 1, next: 'end', result: ''};
    }
    let handedOff = false;
    // A hand-off waiting for its companion's busy slot has not been sent: the conversation says it waits, and says
    // "delegated" once the coordinator reports it sent (Hub #2028).
    await this.#append(state.taskId, {role: 'tool', call: question.call, name, result, ok: accepted, effect: id}, active.span.context, current => {
      if (job !== undefined) {
        this.store.message(current, job.jobId, 'assistant', jobReceipt(job).slice('accepted: '.length), this.context.clock.now());
        handedOff = true;
        return;
      }
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
    if (group !== undefined) return this.store.queue.steers(task.id).length > 0
      ? {step: state.step + 1, next: 'turn', result: ''} : {step: state.step + 1, next: 'end', result: ''};
    if (this.#taskProvider(task).name !== 'synthetic' && job !== undefined && this.store.queue.steers(task.id).length === 0) {
      return {step: state.step + 1, next: 'end', result: 'The coding job will post updates in this conversation.'};
    }
    return {step: state.step + 1, next: proposal.family === 'coding-dispatch' && accepted && job === undefined ? 'await' : 'turn'};
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
    if (this.#taskProvider(task).name !== 'synthetic') return {step: state.step, next: 'end', result: 'The coding worker returned its result in this conversation.'};
    return {step: state.step, next: 'turn'};
  }
  /**
   * A hand-off that waited for its companion's slot was sent (Hub #2028): the delegation now reads as delegated, and the
   * conversation says so once. A task that no longer waits on that hand-off is left as it is.
   */
  async handOffSent(taskId: string, operationId: string, parent: TraceContext): Promise<void> {
    await this.outbox.transaction(add => {
      const task = this.store.task(taskId), question = task?.question;
      if (task === undefined || terminal(task.status) || question === null || question === undefined || question.kind !== 'delegation' || question.answer !== null
        || !question.text.startsWith(WAITING_PREFIX) || !this.#matchesDelegation(taskId, question.id, operationId)) return;
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
  #matchesDelegation(taskId: string, questionId: string, operationId: string): boolean {
    const prefix = `${taskId}-step-`;
    return operationId.startsWith(prefix) && questionId === `${taskId}-delegation-${operationId.slice(prefix.length)}`;
  }
  async deliver(taskId: string, text: string, parent: TraceContext, evidence: ActionEvidence, startup = false): Promise<void> {
    let launch = false, delivered: Task | undefined;
    await this.outbox.transaction(add => {
      const task = this.store.task(taskId);
      if (task === undefined || terminal(task.status)) return;
      const question = task.question;
      if (question === null || question.kind !== 'delegation' || question.answer !== null || !this.#matchesDelegation(taskId, question.id, evidence.requestId)) return;
      this.store.observeAction(taskId, evidence);
      question.answer = text.slice(0, LIMITS.toolBytes); delivered = task;
      if (startup && task.status === 'waiting') task.status = 'paused';
      if (!startup && this.#canUseTaskProvider(task) && ['waiting', 'paused'].includes(task.status) && this.store.meta().enabled && this.available() && !this.#active.has(task.conversationId) && !this.#unrecovered.has(task.conversationId) && !this.#closed) {this.#activate(task, parent); launch = true;}
      this.store.save(task); this.#publish(add, parent);
    });
    if (launch && !this.#closed && !this.context.signal.aborted) this.#launch(taskId);
    // The hand-off's result is a major event for the title (Hub #2075): its outcome word goes to the check, its text does not.
    if (delivered !== undefined && !startup) this.#checkTitle(delivered, {kind: 'hand-off-result', outcome: handOffOutcome(text)});
  }
  codingJobQueued(job: CodingJob, add: AddMessage, parent: TraceContext): void {
    const task = this.#task(job.taskId);
    if (task.conversationId !== job.conversationId || terminal(task.status)) fail('invalid-state');
    this.store.message(task, job.jobId, 'assistant', jobReceipt(job).slice('accepted: '.length), this.context.clock.now());
    this.store.touch(task.conversationId);
    this.#publish(add, parent);
  }
  /** Appends a job observation to the approved exchange, even after the owner starts another conversation. */
  async codingJobUpdate(job: CodingJob, kind: CodingUpdateKind, text: string, parent: TraceContext, startup: boolean): Promise<void> {
    let delivered: Task | undefined;
    const id = codingUpdateMessageId(job, kind);
    await this.outbox.transaction(add => {
      const task = this.store.task(job.taskId);
      if (task === undefined || task.conversationId !== job.conversationId) return;
      if (this.store.savedMessage(task.id, id) !== undefined) return;
      this.store.message(task, job.jobId, 'assistant', jobReceipt(job).slice('accepted: '.length), this.context.clock.now());
      this.store.message(task, id, 'assistant', `Coding job ${job.jobId}: ${text}`, this.context.clock.now(), job.jobId);
      this.store.touch(task.conversationId);

      this.#publish(add, parent);
      delivered = task;
    });
    if (delivered !== undefined && kind === 'result' && !startup) {
      const profile = delivered.profile;
      this.#checkTitle(delivered, {kind: 'hand-off-result', outcome: handOffOutcome(text)}, () => {
        const fields = this.#fields(profile, 'title', 'synthetic');
        return fields('conversation', 'text', job.conversationId) && fields('conversation', 'text', id) &&
          this.#jobMessageAllowed({id, role: 'assistant', taskId: job.taskId}, fields);
      });
    }
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
        if (reply.disclosures !== undefined) call.disclosures = reply.disclosures;
        if (reply.historySources !== undefined) call.historySources = reply.historySources;
        if (reply.inputVersions !== undefined) call.inputVersions = reply.inputVersions;
        if (reply.wemoFacts !== undefined) call.wemoFacts = reply.wemoFacts;
        if (reply.privateDraftId !== undefined) call.privateDraftId = reply.privateDraftId;
        if (reply.incompleteDisclosures === true) call.incompleteDisclosures = true;
        this.store.saveCall(call); task.activeMs -= timeout - elapsed;
        for (const confirmation of reply.confirmations ?? []) this.store.saveConfirmation(confirmation);
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
            if (evidence && saved !== undefined) {
              saved.result = reply.text; saved.units = reply.units; saved.status = 'succeeded';
              if (reply.disclosures !== undefined) saved.disclosures = reply.disclosures;
              if (reply.historySources !== undefined) saved.historySources = reply.historySources;
              if (reply.inputVersions !== undefined) saved.inputVersions = reply.inputVersions;
              if (reply.incompleteDisclosures === true) saved.incompleteDisclosures = true;
              this.store.saveCall(saved);
            }
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
