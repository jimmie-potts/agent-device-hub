import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {LightingDecision} from './lighting-execution.js';
import type {LightingClarification} from './lighting-control.js';
import type {SupervisorIdentity} from './provider.js';
import type {DisclosedField} from './sharing.js';
import type {ModelControlProof} from './model-control.js';
import type {BoundControl} from './control-intent.js';
import type {DeviceHistoryBinding} from './device-history.js';
import type {CodingChoice, CodingDestinationChoice, CodingRequirements} from '../coding/routing.js';
import type {MessageCodingInput, OpenNativeClientInput, StopCodingInput} from './history-contract.js';
import type {Confirmation} from './confirmation.js';
import type {ActionEvidence, ApprovedAction} from './closing-reply.js';
import {Messages} from '../knowledge/messages.js';
import {advanceRevision, initializeRevision} from '../revision.js';
import {randomUUID} from 'node:crypto';
import {gzipSync, gunzipSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import {isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {AssistantProfile, AssistantStatus, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';

import type {TranscriptItem} from './provider.js';
import {RECENT_MESSAGES, type RecentMessage} from './context.js';
import {HISTORY_ROWS, historyCursor, readHistoryCursor, type ConversationMessage, type RecentConversationPage, type SavedQuestion, type CodingPreference} from './history-contract.js';
import {projectionOf, waitsOnOwner, type Reported} from './sessions.js';
import {MessageQueue} from './queue.js';

/**
 * The conversation graph of Hub #46. `conversation-2` (Hub #2031) adds the model node's edge back to itself, which a
 * steer that reaches the task while it was about to finish takes for one more model call. Its nodes, state and
 * checkpoints are those of `conversation-1`, so a task saved under `conversation-1` is upgraded at the first start of
 * this release (see `upgradeGraph`). Tasks saved by the fixed synthetic graph (`synthetic-1`) stay readable and refuse resume.
 */
export const GRAPH_VERSION = 'conversation-2';
export const RESPONSES_GRAPH_VERSION = 'responses-1';
/** The graph version before Hub #2031, whose unfinished tasks the start upgrades to `GRAPH_VERSION`. */
export const PREVIOUS_GRAPH_VERSION = 'conversation-1';
import {LIMITS} from './limits.js';
export {LIMITS} from './limits.js';
/** Submission time is private task metadata for delayed owner messages. */
type SavedTranscriptItem = (Extract<TranscriptItem, {role: 'owner'}> & {submittedAtMs?: number})
  | Exclude<TranscriptItem, {role: 'owner'}>;
type ConversationQuestion = SavedQuestion & {call: string; codingChoice?: CodingChoice; codingDestination?: CodingDestinationChoice; codingRequirements?: CodingRequirements};
export type Question = ConversationQuestion & {
  modeClarification?: {requestId: string; requestRevision: number; modeRevision: number};
  deviceReadClarification?: {requestId: string};
};
export type Task = {version: 1; graphVersion: string; tracksApprovals?: true; id: string; conversationId: string; profile: AssistantProfile; prompt: string;
  /** Only the private Conversation page renders this receipt, after a fresh exact Jobs lookup. */
  localJobStatus?: {question: string; visible?: {jobId: string; operationId: string; status: string}};
  control?: BoundControl;
  supervisor?: SupervisorIdentity;
  codingPreference?: CodingPreference;
  clarificationDevices?: readonly string[];
  lightingClarification?: LightingClarification;
  lightingDecision?: LightingDecision;
  historyScope?: DeviceHistoryBinding;
  ownerInputStart?: string;
  /** Legacy Messages task's bound history query. */
  claudeHistory?: DeviceHistoryBinding & {replayFrom: number; ordinaryFrom?: number};
  status: AssistantStatus; runId: string | null; generation: number; question: Question | null; code: ErrorCode | null;
  modelCalls: number; toolCalls: number; questions: number; activeMs: number; reservedUnits: number; nextOrdinal: number;
  traceparent: string | null; transcript: SavedTranscriptItem[];
  /**
   * The conversation's last saved message sequence when the task started (Hub #2029): the recent conversation section of
   * each of its calls holds the conversation's messages up to it, so the section stays fixed for the task. A task saved
   * before this field has no recent conversation.
   */
  contextThrough?: number};
export type ContextSourceVersion = {id: string; revision: number};
export type SavedDeviceLookup = {source: ContextSourceVersion; match?: {
  owner: string; id: string; configurationRevision: number; generation: DeviceRecord['generation']; ownerQualified?: true;
}; ambiguous?: true};
export type SavedDisclosureProof = {
  fields: readonly DisclosedField[]; sources: readonly string[]; legacy: boolean; complete: boolean; model: boolean;
};
export type HistoryCompaction = {
  id: string; taskId: string; conversationId: string; provider: SupervisorIdentity; sources: readonly ContextSourceVersion[];
  status: 'admitted' | 'succeeded' | 'failed' | 'uncertain'; text: string | null; stopCode?: ErrorCode;
};
export type HostedHistoryMessage = Pick<RecentMessage, 'id' | 'role' | 'text'> & {taskId: string; revision: number};
export type Call = {version: 1; id: string; taskId: string; runId: string; ordinal: number; kind: 'model' | 'tool'; action?: ApprovedAction;
  directBrightness?: true;
  modelControlProof?: ModelControlProof;
  lightingControlProof?: ModelControlProof;
  lightingReadTarget?: string;
  lightingReadModelCallId?: string;
  deviceLookup?: SavedDeviceLookup;
  privateDraftId?: string;
  wemoFacts?: readonly {id: string; revision: string}[];
  namedDeviceRead?: {owner: string; id: string; configurationRevision?: number; generation?: DeviceRecord['generation']};
  historySources?: readonly ContextSourceVersion[];
  inputVersions?: readonly {field: DisclosedField; version: string}[];
  codingApproval?: {destination: 'coding-worker'; repository: string; briefDigest: string};
  status: 'admitted' | 'succeeded' | 'uncertain' | 'failed'; code?: ErrorCode; disclosures?: readonly DisclosedField[]; incompleteDisclosures?: true;
  result: string | null; units: number | null; reservedUnits: number;
  reservedMs: number; elapsedMs: number | null; traceparent: string;
  /**
   * A model call whose answer was saved while the task held an unread steer (Hub #2031): the steer reached the task
   * before its last call returned, so a final answer is superseded and the task makes one more call.
   */
  steered?: true};
export type Run = {version: 1; id: string; taskId: string; startedAtMs: number; endedAtMs: number | null;
  status: AssistantStatus; traceparent: string; previousTraceparent: string | null};
/**
 * A staged message or answer, or New conversation for the profile (Hub #2029), which carries no text: `text` is empty. A
 * `queue` input saves the message in the conversation's queue, and `edit-queued` replaces the text of the queued
 * message `queuedId` (Hub #2030). A `steer` input (Hub #2031) steers the running task `taskId`, the turn the page
 * expects; with `questionId` it also settles that pending question: Skip question and send for a clarification,
 * Decline with message for an approval.
 */
export type StagedInput = {action: 'start' | 'answer' | 'new-conversation' | 'queue' | 'edit-queued' | 'steer'; profile: AssistantProfile; text: string; expectedRevision: number; provider?: SupervisorIdentity['provider'];
  taskId?: string; questionId?: string; queuedId?: string; harness?: CodingChoice; destination?: CodingDestinationChoice; requirements?: CodingRequirements};
/** One of a profile's conversations as the page lists it (Hub #2029); `current` marks the one new messages go to. */
export type ConversationSummary = {conversationId: string; current: boolean; messages: number; firstAtMs: number | null; lastAtMs: number | null};
export type Stage = {ref: string; requestId: string; input: StagedInput | StopCodingInput | MessageCodingInput | OpenNativeClientInput; expires: number};
export type ConversationPage = {version: 1; conversationId: string | null; messages: ConversationMessage[]; currentTask: {taskId: string; question: ConversationQuestion | null} | null; next: number | null};
/** The transcript item appended for a call, found again by its effect id so a re-run node appends it once. */
export type Appended = SavedTranscriptItem & {effect: string};
type RecordRow = {record: string};
export type MessageSource = Pick<ConversationMessage, 'id' | 'role' | 'taskId'> & {follows?: string | null};
type MessageVisibility = {
  shows(message: MessageSource): boolean;
  privateText?(message: MessageSource): string | undefined;
  attachment(requestId: string): boolean;
  task(taskId: string): boolean;
};
type MessageRow = Omit<ConversationMessage, 'attachment' | 'follows' | 'codingRefusal'> & {follows: string | null} & {artRequestId: string | null; artDescription: string | null; artTargets: string | null;
  artStatus: Call['status'] | null; artResult: string | null};
const messagesWithAttachments = `SELECT msg.seq,msg.id,msg.task_id AS taskId,msg.role,msg.text,msg.at_ms AS atMs,msg.follows,
  art.request_id AS artRequestId,art.description AS artDescription,intent.targets AS artTargets,json_extract(call.record, '$.status') AS artStatus,
  json_extract(call.record, '$.result') AS artResult
  FROM assistant_messages msg LEFT JOIN assistant_art_attachments art ON art.message_id=msg.id
  LEFT JOIN assistant_art_intents intent ON intent.request_id=art.request_id
  LEFT JOIN assistant_calls call ON call.id=art.request_id`;
function messageOf({artRequestId, artDescription, artTargets, artStatus, artResult, follows, ...row}: MessageRow): ConversationMessage {
  const message = follows === null ? row : {...row, follows};
  if (artRequestId === null || artDescription === null) return message;
  const receipt = {kind: 'artwork' as const, requestId: artRequestId, description: artDescription,
    ...(artTargets === null ? {} : {showTargets: JSON.parse(artTargets) as string[]})};
  // A local receipt write can fail after the Art owner admitted the job.
  // Only an actual dispatch refusal proves that the job was not admitted.
  const refusal = artStatus === 'succeeded' && artResult?.startsWith('refused: ') === true ? artResult.slice(9) : undefined;
  if (isErrorCode(refusal)) return {...message, attachment: {...receipt, admission: 'refused', code: refusal}};
  const admission = artStatus === 'succeeded' && artResult?.startsWith('accepted: ') === true ? 'accepted'
    : artStatus === 'admitted' ? 'pending' : 'uncertain';
  return {...message, attachment: {...receipt, admission}};
}
const parsed = <T>(row: RecordRow | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
export const terminal = (status: AssistantStatus): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
/** Whether a call's fate is unknown: admitted with no answer, or answered after its wait ended. A failed call is settled. */
export const unresolved = (calls: readonly Call[]): boolean => calls.some(call => call.status === 'admitted' || call.status === 'uncertain');

/** All writes are synchronous and are called inside the owning outbox's transaction when they change task state. */
export class AssistantStore {
  readonly messages: Messages;
  /** Each conversation's message queue (Hub #2030), whose changes the assistant's revisions record. */
  readonly queue: MessageQueue;
  constructor(readonly database: DatabaseSync) {
    const reported = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_reports'").get() !== undefined;
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO assistant_meta VALUES (1,0,0);
      CREATE TABLE IF NOT EXISTS assistant_conversations (profile TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS assistant_tasks (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, profile TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, at_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_inputs (ref TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_controls (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_art_attachments (message_id TEXT PRIMARY KEY REFERENCES assistant_messages(id) ON DELETE CASCADE, request_id TEXT NOT NULL UNIQUE, description TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS assistant_art_intents (request_id TEXT PRIMARY KEY REFERENCES assistant_art_attachments(request_id) ON DELETE CASCADE, targets TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS assistant_confirmations (request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, record TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_confirmations_task ON assistant_confirmations(task_id);
      CREATE INDEX IF NOT EXISTS assistant_message_page ON assistant_messages(conversation_id,seq);
      CREATE INDEX IF NOT EXISTS assistant_task_calls ON assistant_calls(task_id);
      CREATE TABLE IF NOT EXISTS assistant_history_compactions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_history_compactions_conversation ON assistant_history_compactions(conversation_id);
      CREATE TABLE IF NOT EXISTS assistant_disclosure_proofs (
        task_id TEXT NOT NULL, through_call INTEGER NOT NULL, proof BLOB NOT NULL, PRIMARY KEY(task_id,through_call)) STRICT;`);
    if (!database.prepare("SELECT 1 FROM pragma_table_info('assistant_messages') WHERE name='follows'").get()) {
      database.exec('ALTER TABLE assistant_messages ADD COLUMN follows TEXT');
    }
    // The release that reports conversations to the shared session model (Hub #505) starts from what each conversation's
    // latest task is now and reports only its next change: a baseline row per conversation, at sequence zero, that reports
    // nothing. A task that waits on its owner gets no baseline projection instead, so its first report, at the startup's
    // reconciliation, states it whole and it shows on the devices at once. The table and its baseline commit together, so
    // a start that stops part way leaves neither.
    if (!reported) {
      database.exec('SAVEPOINT assistant_reports_baseline');
      try {
        database.exec('CREATE TABLE assistant_reports (conversation_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, projection TEXT)');
        const baseline = database.prepare('INSERT INTO assistant_reports VALUES (?,0,?)');
        for (const task of this.latest()) {
          const projection = waitsOnOwner(task) ? undefined : projectionOf(task);
          baseline.run(task.conversationId, projection === undefined ? null : JSON.stringify(projection));
        }
        database.exec('RELEASE assistant_reports_baseline');
      } catch (error) {
        // SQLite may already have rolled the whole transaction back, as on a full disk; the original error is what counts.
        if (database.isTransaction) database.exec('ROLLBACK TO assistant_reports_baseline; RELEASE assistant_reports_baseline');
        throw error;
      }
    }
    initializeRevision(database, this.meta().revision);
    // Each conversation's last change, as the assistant revision that published it (Hub #2027): a conversation's command is
    // stale only when its own conversation changed after the revision it names. The engine's start raises every row with
    // `restarted`.
    database.exec('CREATE TABLE IF NOT EXISTS assistant_conversation_changes (conversation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL) STRICT');
    // Each companion's context switches (Hub #2029): whether its context holds the owner's knowledge notes. No row is off.
    database.exec('CREATE TABLE IF NOT EXISTS assistant_context_settings (profile TEXT PRIMARY KEY, knowledge INTEGER NOT NULL CHECK(knowledge IN (0,1))) STRICT');
    this.messages = new Messages(database);
    this.queue = new MessageQueue(database);
  }
  /** Conversations whose tasks changed in the open transaction; the next `bump` records them at its revision. */
  readonly #changed = new Set<string>();
  meta(): {revision: number; enabled: boolean} {
    const row = this.database.prepare('SELECT revision,enabled FROM assistant_meta WHERE id=1').get() as {revision: number; enabled: number};
    return {revision: row.revision, enabled: row.enabled === 1};
  }
  bump(): void {
    const revision = advanceRevision(this.database);
    this.database.prepare('UPDATE assistant_meta SET revision=? WHERE id=1').run(revision);
    const record = this.database.prepare('INSERT INTO assistant_conversation_changes VALUES (?,?) ON CONFLICT(conversation_id) DO UPDATE SET revision=excluded.revision');
    for (const conversationId of this.#changed) record.run(conversationId, revision);
    this.#changed.clear();
    this.queue.record(revision);
  }
  /** Counts a change of the conversation other than a task's, such as the owner's rename, at the next `bump`. */
  touch(conversationId: string): void {this.#changed.add(conversationId);}
  /**
   * Counts every saved conversation, a profile's or a companion exchange without one (Hub #2056), as changed at the current
   * revision, once per start: a command naming an older revision is refused, whatever rows an earlier release left; one
   * naming the revision at start depends on its conversation's changes.
   */
  restarted(): void {
    this.database.prepare(`INSERT INTO assistant_conversation_changes SELECT id,(SELECT revision FROM assistant_meta WHERE id=1)
      FROM (SELECT id FROM assistant_conversations UNION SELECT id FROM companion_conversations) WHERE true
      ON CONFLICT(conversation_id) DO UPDATE SET revision=MAX(revision,excluded.revision)`).run();
    this.queue.restarted(this.meta().revision);
  }
  /** The assistant revision of the conversation's last change, or 0 before its first. */
  changedAt(conversationId: string): number {
    return (this.database.prepare('SELECT revision FROM assistant_conversation_changes WHERE conversation_id=?').get(conversationId) as {revision: number} | undefined)?.revision ?? 0;
  }
  enable(enabled: boolean): void {this.database.prepare('UPDATE assistant_meta SET enabled=? WHERE id=1').run(enabled ? 1 : 0);}
  task(id: string): Task | undefined {return parsed<Task>(this.database.prepare('SELECT record FROM assistant_tasks WHERE id=?').get(id) as RecordRow | undefined);}
  /**
   * Each profile's latest task in its current conversation. After New conversation (Hub #2029) a profile has none until
   * its first message there: the earlier conversation's tasks have all finished, since New conversation is refused while
   * one is unfinished, so none of them can change what a conversation reports.
   */
  latest(): Task[] {
    const current = this.currentConversations();
    return this.database.prepare('SELECT record FROM assistant_tasks WHERE seq IN (SELECT MAX(seq) FROM assistant_tasks GROUP BY profile) ORDER BY seq').all()
      .map(row => JSON.parse(row.record as string) as Task).filter(task => current.has(task.conversationId));
  }
  /** Every conversation's unfinished task, oldest first: each conversation has at most one (Hub #2027). */
  unfinished(): Task[] {return this.database.prepare("SELECT record FROM assistant_tasks WHERE status NOT IN ('succeeded','failed','cancelled') ORDER BY seq").all().map(row => JSON.parse(row.record as string) as Task);}
  /**
   * Upgrades each unfinished task saved under the graph before Hub #2031 to the current one, at a start and before its
   * reconciliation: the current graph has the same nodes, state and checkpoints and only adds the model node's edge back
   * to itself, so the task's saved checkpoint continues unchanged. A finished task keeps the version it ran under.
   * Returns how many were upgraded.
   */
  upgradeGraph(): number {
    return Number(this.database.prepare(`UPDATE assistant_tasks SET record=json_set(record,'$.graphVersion',?)
      WHERE status NOT IN ('succeeded','failed','cancelled') AND json_extract(record,'$.graphVersion')=?`).run(GRAPH_VERSION, PREVIOUS_GRAPH_VERSION).changes);
  }
  /** The conversation's unfinished task, if it has one. */
  unfinishedIn(conversationId: string): Task | undefined {return this.unfinished().find(task => task.conversationId === conversationId);}
  /** Saves a task; `changed` false keeps a bookkeeping write, such as a run's trace, from counting as a change of its conversation. */
  save(task: Task, changed = true): void {
    if (changed) this.#changed.add(task.conversationId);
    this.database.prepare('INSERT INTO assistant_tasks(id,profile,status,record) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record').run(task.id, task.profile, task.status, JSON.stringify(task));
  }
  conversation(profile: AssistantProfile): string | undefined {return (this.database.prepare('SELECT id FROM assistant_conversations WHERE profile=?').get(profile) as {id: string} | undefined)?.id;}
  /** The profile's conversation ID, saved on first use: a task or a rename (Hub #2025) opens it. */
  ensureConversation(profile: AssistantProfile): string {
    const conversationId = this.conversation(profile) ?? randomUUID();
    this.database.prepare('INSERT OR IGNORE INTO assistant_conversations VALUES (?,?)').run(profile, conversationId);
    return conversationId;
  }
  /**
   * New conversation (Hub #2029): the profile's current conversation becomes a fresh one, with its own ID and so its own
   * session, title, running slot and change row. The earlier one keeps its messages, title and session report and stays
   * readable by its ID; both are listed among the profile's conversations. The caller refuses it while a task is unfinished.
   */
  newConversation(profile: AssistantProfile): {previous: string | undefined; conversationId: string} {
    const previous = this.conversation(profile), conversationId = randomUUID();
    if (previous !== undefined) this.messages.ensure(previous, [profile], profile);
    this.database.prepare('INSERT INTO assistant_conversations VALUES (?,?) ON CONFLICT(profile) DO UPDATE SET id=excluded.id').run(profile, conversationId);
    this.messages.ensure(conversationId, [profile], profile);
    return {previous, conversationId};
  }
  /** Whether a saved conversation is one of the profile's own: its current one, or an earlier one New conversation replaced. */
  owns(profile: AssistantProfile, conversationId: string): boolean {
    return this.conversation(profile) === conversationId || this.messages.conversation(conversationId)?.profile === profile;
  }
  /** The conversation's last saved message sequence, or 0 before its first message. */
  lastSequence(conversationId: string): number {
    return (this.database.prepare('SELECT MAX(seq) AS seq FROM assistant_messages WHERE conversation_id=?').get(conversationId) as {seq: number | null}).seq ?? 0;
  }
  newTask(profile: AssistantProfile, prompt: string, supervisor?: SupervisorIdentity, submittedAtMs?: number): Task {
    const conversationId = this.ensureConversation(profile);
    return {version: 1, graphVersion: supervisor?.provider === 'openai' ? RESPONSES_GRAPH_VERSION : GRAPH_VERSION,
      ...(supervisor === undefined ? {} : {supervisor}), tracksApprovals: true, id: randomUUID(), conversationId, profile, prompt, status: 'paused', runId: null,
      generation: 0, question: null, code: null, modelCalls: 0, toolCalls: 0, questions: 0, activeMs: 0, reservedUnits: 0, nextOrdinal: 0, traceparent: null,
      transcript: [{role: 'owner', text: prompt, ...(submittedAtMs === undefined ? {} : {submittedAtMs})}], contextThrough: this.lastSequence(conversationId)};
  }
  /**
   * The recent conversation a task's context may hold (Hub #2029): the conversation's saved owner messages, replies and
   * tool results up to `through`, the sequence saved when the task started, so none of the task's own; the newest
   * `RECENT_MESSAGES` of them oldest first, and how many there are in all. Only this one conversation is read, so no other
   * conversation can enter, and only the messages the profile may read in it, as the history page reads them, so a crafted
   * archive's message between other companions cannot either. A removed message is no longer saved, and a correction's
   * meaning is the saved text. Three kinds of saved row stay out:
   * - an imported message, which stays historical until the owner selects it for a copied context;
   * - a tool result of a task whose owner message, its opening message or an answer, the owner removed (the task's reply
   *   stays unless the owner removes it too);
   * - a row without a companion record other than a tool result.
   * A tool result names its tool from its task's saved transcript when that still holds it; an artwork attachment keeps
   * its request identity.
   */
  recentContext(profile: AssistantProfile, conversationId: string, through: number, permits?: (message: MessageSource) => boolean, latestOwnerOnly = false): {messages: RecentMessage[]; total: number} {
    const bound = this.messages.conversation(conversationId)?.profile === profile ? 1 : 0;
    const filter = `msg.conversation_id=? AND msg.seq<=?
      AND (CASE WHEN msg.record IS NULL THEN msg.role='tool' ELSE json_extract(msg.record,'$.speakerId')=?
        OR EXISTS (SELECT 1 FROM json_each(msg.record,'$.recipientIds') WHERE value=?)
        OR (json_type(msg.record,'$.recipientIds')='null' AND ?=1) END)
      AND COALESCE(json_extract(msg.record,'$.provenance.imported'),0)=0
      AND NOT (msg.role='tool' AND EXISTS (SELECT 1 FROM companion_removals removed
        WHERE removed.id=msg.task_id || '-prompt' OR (removed.id LIKE msg.task_id || '-q%' AND removed.id LIKE '%-answer')))`;
    const params = [conversationId, through, profile, profile, bound];
    const limit = latestOwnerOnly ? 1 : RECENT_MESSAGES;
    let total: number;
    let rows: MessageRow[];
    if (permits === undefined) {
      total = (this.database.prepare(`SELECT COUNT(*) AS count FROM assistant_messages msg WHERE ${filter}`).get(...params) as {count: number}).count;
      rows = (this.database.prepare(`${messagesWithAttachments} WHERE ${filter} ORDER BY msg.seq DESC LIMIT ?`).all(...params, limit) as MessageRow[]).reverse();
    } else {
      const selected = latestOwnerOnly ? "AND msg.role='owner' ORDER BY msg.seq DESC LIMIT 1" : 'ORDER BY msg.seq DESC';
      const eligible = (this.database.prepare(`SELECT msg.id, msg.role, msg.task_id AS taskId, msg.follows FROM assistant_messages msg WHERE ${filter} ${selected}`)
        .all(...params) as MessageSource[]).filter(permits);
      total = eligible.length;
      const ids = eligible.slice(0, limit).map(row => row.id);
      rows = (this.database.prepare(`${messagesWithAttachments} WHERE msg.id IN (${ids.map(() => '?').join(',')}) ORDER BY msg.seq`).all(...ids) as MessageRow[]);
    }
    const tools = new Map<string, Map<string, string>>();
    const toolOf = (owner: string, id: string): string | undefined => {
      let names = tools.get(owner);
      if (names === undefined) {
        names = new Map();
        for (const item of this.task(owner)?.transcript ?? []) if (item.role === 'tool' && 'effect' in item && typeof item.effect === 'string') names.set(item.effect, item.name);
        tools.set(owner, names);
      }
      return names.get(id);
    };
    const messages = rows.map(row => {
      const saved = messageOf(row), tool = saved.role === 'tool' ? toolOf(saved.taskId, saved.id) : undefined;
      return {id: saved.id, role: saved.role, text: saved.text, ...(tool === undefined ? {} : {tool}),
        ...(saved.attachment === undefined ? {} : {attachment: {kind: saved.attachment.kind, requestId: saved.attachment.requestId, description: saved.attachment.description}})};
    });
    return {messages, total};
  }
  /** Earlier owner and final assistant messages in their stored sequence, with no message-count ceiling. */
  hostedHistory(profile: AssistantProfile, conversationId: string, through: number): Iterable<HostedHistoryMessage> {
    if (this.messages.conversation(conversationId)?.profile !== profile) return [];
    return this.database.prepare(`SELECT id,role,text,task_id AS taskId,COALESCE(json_extract(record,'$.revision'),0) AS revision
      FROM assistant_messages WHERE conversation_id=? AND seq<=?
      AND ((role='tool' AND record IS NULL) OR (record IS NOT NULL
        AND (role='owner' OR (role='assistant' AND id=task_id || '-result'))
        AND json_extract(record,'$.provenance.imported')=0 AND json_extract(record,'$.meaning.kind')='literal'
        AND (json_extract(record,'$.speakerId')=? OR EXISTS (SELECT 1 FROM json_each(record,'$.recipientIds') WHERE value=?)
          OR json_type(record,'$.recipientIds')='null')))
      AND NOT EXISTS (SELECT 1 FROM companion_removals WHERE id=assistant_messages.id) ORDER BY seq`)
      .iterate(conversationId, through, profile, profile) as Iterable<HostedHistoryMessage>;
  }
  /** Use append order, not the completion order of earlier tasks. */
  ownerExchangesNewestFirst(conversationId: string, through: number): Iterable<{id: string; taskId: string}> {
    return this.database.prepare(`SELECT id,task_id AS taskId FROM assistant_messages
      WHERE conversation_id=? AND seq<=? AND role='owner'
      AND json_extract(record,'$.speakerId')='owner' AND json_extract(record,'$.provenance.imported')=0
      ORDER BY seq DESC`).iterate(conversationId, through) as Iterable<{id: string; taskId: string}>;
  }
  historySourceRevision(id: string): number | undefined {
    const row = this.database.prepare(`SELECT COALESCE(json_extract(record,'$.revision'),0) AS revision
      FROM assistant_messages WHERE id=? AND NOT EXISTS (SELECT 1 FROM companion_removals WHERE id=assistant_messages.id)`)
      .get(id) as {revision: number} | undefined;
    return row?.revision;
  }
  lastHistoryCompaction(conversationId: string): HistoryCompaction | undefined {
    return parsed<HistoryCompaction>(this.database.prepare(`SELECT record FROM assistant_history_compactions WHERE conversation_id=?
      AND json_extract(record,'$.status')='succeeded' ORDER BY rowid DESC LIMIT 1`).get(conversationId) as RecordRow | undefined);
  }
  taskHistoryCompaction(taskId: string): HistoryCompaction | undefined {
    return parsed<HistoryCompaction>(this.database.prepare('SELECT record FROM assistant_history_compactions WHERE task_id=?').get(taskId) as RecordRow | undefined);
  }
  hasHistoryCompaction(id: string, taskId: string): boolean {
    return this.database.prepare('SELECT 1 FROM assistant_history_compactions WHERE id=? OR task_id=?').get(id, taskId) !== undefined;
  }
  saveHistoryCompaction(value: HistoryCompaction): void {
    this.database.prepare(`INSERT INTO assistant_history_compactions VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record=excluded.record`).run(value.id, value.taskId, value.conversationId, JSON.stringify(value));
  }
  /** Whether the owner turned on knowledge notes for the companion's context (Hub #2029); off until the owner does. */
  knowledgeEnabled(profile: AssistantProfile): boolean {
    return (this.database.prepare('SELECT knowledge FROM assistant_context_settings WHERE profile=?').get(profile) as {knowledge: number} | undefined)?.knowledge === 1;
  }
  setKnowledge(profile: AssistantProfile, enabled: boolean): void {
    this.database.prepare('INSERT INTO assistant_context_settings VALUES (?,?) ON CONFLICT(profile) DO UPDATE SET knowledge=excluded.knowledge').run(profile, enabled ? 1 : 0);
  }
  /**
   * The profile's conversations, 16 a page (Hub #2029): the current one first, then each earlier one by its last message,
   * newest first, and one without messages last. A later page continues after `after`, the keyset cursor `<last>:<row>`
   * of the previous page's last earlier conversation (its last message time, or -1 without one, and its row), so a
   * conversation that changes between reads never repeats or hides an unchanged one. `older` is the next page's cursor.
   */
  conversations(profile: AssistantProfile, after?: {last: number; row: number}, visibility?: {
    conversation(id: string): boolean;
    message(message: MessageSource): boolean;
  }): {conversations: ConversationSummary[]; older: string | null} {
    const current = this.conversation(profile) ?? null;
    if (visibility !== undefined) {
      const conversations = (this.database.prepare("SELECT rowid AS row,id FROM companion_conversations WHERE json_extract(record,'$.profile')=?")
        .all(profile) as {row: number; id: string}[]).filter(({id}) => visibility.conversation(id)).map(({id, row}) => {
        const messages = (this.database.prepare('SELECT id,role,task_id AS taskId,at_ms AS atMs,follows FROM assistant_messages WHERE conversation_id=? ORDER BY at_ms')
          .all(id) as (MessageSource & {atMs: number})[]).filter(message => visibility.message(message));
        const lastAtMs = messages.at(-1)?.atMs ?? null;
        return {row, last: lastAtMs ?? -1, summary: {conversationId: id, current: id === current, messages: messages.length,
          firstAtMs: messages[0]?.atMs ?? null, lastAtMs}};
      });
      const first = after === undefined ? conversations.find(row => row.summary.current) : undefined;
      const ordered = conversations.filter(row => !row.summary.current &&
        (after === undefined || row.last < after.last || row.last === after.last && row.row < after.row))
        .sort((a, b) => a.last === b.last ? b.row - a.row : b.last - a.last);
      const size = first === undefined ? 16 : 15, page = ordered.slice(0, size), end = page.at(-1);
      return {conversations: [...(first === undefined ? [] : [first.summary]), ...page.map(row => row.summary)],
        older: ordered.length > size && end !== undefined ? `${String(end.last)}:${String(end.row)}` : null};
    }
    const rows = this.database.prepare(`SELECT c.rowid AS row,c.id AS id,COUNT(m.seq) AS messages,MIN(m.at_ms) AS firstAtMs,MAX(m.at_ms) AS lastAtMs,
        COALESCE(MAX(m.at_ms),-1) AS last
      FROM companion_conversations c LEFT JOIN assistant_messages m ON m.conversation_id=c.id
      WHERE json_extract(c.record,'$.profile')=? AND c.id IS NOT ? GROUP BY c.rowid
      HAVING ?=1 OR last<? OR (last=? AND c.rowid<?)
      ORDER BY last DESC, c.rowid DESC LIMIT 17`)
      .all(profile, current, after === undefined ? 1 : 0, after?.last ?? 0, after?.last ?? 0, after?.row ?? 0) as
      {row: number; id: string; messages: number; firstAtMs: number | null; lastAtMs: number | null; last: number}[];
    const first = after === undefined && current !== null ? [this.#summary(current)] : [];
    const room = 16 - first.length, page = rows.slice(0, room), end = page.at(-1);
    const conversations = [...first, ...page.map(({id, messages, firstAtMs, lastAtMs}) => ({conversationId: id, current: false, messages, firstAtMs, lastAtMs}))];
    return {conversations, older: rows.length > room && end !== undefined ? `${String(end.last)}:${String(end.row)}` : null};
  }
  /** The current conversation's list entry, with no messages before its first one has saved its record. */
  #summary(conversationId: string): ConversationSummary {
    const row = this.database.prepare('SELECT COUNT(*) AS messages,MIN(at_ms) AS firstAtMs,MAX(at_ms) AS lastAtMs FROM assistant_messages WHERE conversation_id=?')
      .get(conversationId) as {messages: number; firstAtMs: number | null; lastAtMs: number | null};
    return {conversationId, current: true, ...row};
  }
  /** The conversations that are a profile's current one, for an export that lists each profile's current one last. */
  currentConversations(): Set<string> {
    return new Set((this.database.prepare('SELECT id FROM assistant_conversations').all() as {id: string}[]).map(row => row.id));
  }
  message(task: Task, id: string, role: ConversationMessage['role'], text: string, atMs: number, follows?: string): void {
    if (this.messages.removal(id) !== undefined) return;
    this.database.prepare('INSERT OR IGNORE INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms,follows) VALUES (?,?,?,?,?,?,?)').run(id, task.conversationId, task.id, role, text, atMs, follows ?? null);
    this.messages.capture(task, id, role, text, atMs);
  }
  artReply(task: Task, requestId: string, description: string, atMs: number, showTargets?: readonly string[]): void {
    const id = `${task.id}-artwork`;
    this.message(task, id, 'assistant', 'Artwork for this conversation.', atMs);
    this.database.prepare('INSERT OR IGNORE INTO assistant_art_attachments SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM assistant_messages WHERE id=?)')
      .run(id, requestId, description, id);
    if (showTargets !== undefined && showTargets.length > 0) this.database.prepare('INSERT OR IGNORE INTO assistant_art_intents SELECT ?,? WHERE EXISTS (SELECT 1 FROM assistant_art_attachments WHERE request_id=?)')
      .run(requestId, JSON.stringify(showTargets), requestId);
  }
  hasArtReply(taskId: string): boolean {
    return this.database.prepare('SELECT 1 FROM assistant_art_attachments WHERE message_id=?').get(`${taskId}-artwork`) !== undefined;
  }
  /**
   * The conversation's latest saved owner and assistant messages, oldest first: what a title prompt may read (Hub #2025).
   * A failed turn's closing reply (Hub #2042) is the engine's own status text about the turn, not what the conversation is
   * about, so it is left out and can never become a title.
   */
  titleMessages(conversationId: string, limit = 8, permits?: (message: MessageSource) => boolean): {role: 'owner' | 'assistant'; text: string}[] {
    const query = "SELECT id,role,text,task_id AS taskId,follows FROM assistant_messages WHERE conversation_id=? AND role IN ('owner','assistant') AND id NOT IN (task_id || '-private-question', task_id || '-private-status') AND id NOT LIKE task_id || '-closing-%' AND id NOT LIKE task_id || '-step-%-job-%' AND (follows IS NULL OR follows NOT LIKE task_id || '-step-%-job') ORDER BY seq DESC";
    const rows = (permits === undefined ? this.database.prepare(query + ' LIMIT ?').all(conversationId, limit)
      : this.database.prepare(query).all(conversationId)) as (MessageSource & {role: 'owner' | 'assistant'; text: string})[];
    return (permits === undefined ? rows : rows.filter(permits).slice(0, limit)).reverse().map(({role, text}) => ({role, text}));
  }
  messageSource(id: string): MessageSource | undefined {
    return this.database.prepare('SELECT id,role,task_id AS taskId,follows FROM assistant_messages WHERE id=?')
      .get(id) as MessageSource | undefined;
  }
  /** One saved message of the task, by its id, for the owner to hear again (Hub #500). */
  savedMessage(taskId: string, id: string): (Pick<ConversationMessage, 'id' | 'role' | 'text'> & {follows: string | null}) | undefined {
    return this.database.prepare('SELECT id,role,text,follows FROM assistant_messages WHERE id=? AND task_id=?').get(id, taskId) as
      (Pick<ConversationMessage, 'id' | 'role' | 'text'> & {follows: string | null}) | undefined;
  }
  call(id: string): Call | undefined {return parsed<Call>(this.database.prepare('SELECT record FROM assistant_calls WHERE id=?').get(id) as RecordRow | undefined);}
  ownsAction(conversationId: string, requestId: string): boolean {
    const call = this.call(requestId);
    return call?.action !== undefined && this.task(call.taskId)?.conversationId === conversationId;
  }
  calls(taskId: string): Call[] {return this.database.prepare('SELECT record FROM assistant_calls WHERE task_id=?').all(taskId).map(row => JSON.parse(row.record as string) as Call);}
  saveCall(call: Call): void {this.database.prepare('INSERT INTO assistant_calls VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(call.id, call.taskId, JSON.stringify(call));}
  hasDisclosureProof(taskId: string, through: number): boolean {
    return this.database.prepare('SELECT 1 FROM assistant_disclosure_proofs WHERE task_id=? AND through_call=?').get(taskId, through) !== undefined;
  }
  disclosureProof(taskId: string, through: number): SavedDisclosureProof | undefined {
    const row = this.database.prepare('SELECT proof FROM assistant_disclosure_proofs WHERE task_id=? AND through_call=?')
      .get(taskId, through) as {proof: Uint8Array} | undefined;
    return row === undefined ? undefined : JSON.parse(gunzipSync(row.proof).toString()) as SavedDisclosureProof;
  }
  saveDisclosureProof(taskId: string, through: number, proof: SavedDisclosureProof): void {
    this.database.prepare('INSERT OR IGNORE INTO assistant_disclosure_proofs VALUES (?,?,?)')
      .run(taskId, through, gzipSync(JSON.stringify(proof), {level: 1}));
  }
  confirmation(requestId: string): Confirmation | undefined {
    return parsed<Confirmation>(this.database.prepare('SELECT record FROM assistant_confirmations WHERE request_id=?').get(requestId) as RecordRow | undefined);
  }
  confirmations(taskId?: string): Confirmation[] {
    const rows = taskId === undefined ? this.database.prepare('SELECT record FROM assistant_confirmations').all()
      : this.database.prepare('SELECT record FROM assistant_confirmations WHERE task_id=? ORDER BY rowid').all(taskId);
    return rows.map(row => JSON.parse(row.record as string) as Confirmation);
  }
  saveConfirmation(watch: Confirmation): void {
    this.database.prepare('INSERT INTO assistant_confirmations VALUES (?,?,?) ON CONFLICT(request_id) DO UPDATE SET record=excluded.record')
      .run(watch.requestId, watch.taskId, JSON.stringify(watch));
  }
  dropConfirmation(requestId: string): void {
    this.database.prepare('DELETE FROM assistant_confirmations WHERE request_id=?').run(requestId);
  }
  observeAction(taskId: string, evidence: ActionEvidence): void {
    const call = this.call(evidence.requestId);
    if (call?.action === undefined || call.taskId !== taskId) return;
    if (call.result?.startsWith('refused: ') === true) return;
    if (evidence.source === 'phase') {
      const phases = call.action.phases ??= [];
      const previous = phases.find(phase => phase.phaseId === evidence.phaseId);
      if (previous === undefined) phases.push({phaseId: evidence.phaseId, revision: evidence.revision, text: evidence.text});
      else if (evidence.revision > previous.revision) {
        previous.revision = evidence.revision;
        previous.text = evidence.text;
      } else return;
    } else if (evidence.source === 'operation') {
      const previous = call.action.observed;
      if (previous?.source === 'effect' || previous?.source === 'operation' && previous.revision >= evidence.revision) return;
      call.action.observed = {source: 'operation', revision: evidence.revision, text: evidence.text};
    } else {
      call.action.observed = {source: 'effect', text: evidence.text};
    }
    this.saveCall(call);
  }
  run(id: string): Run | undefined {return parsed<Run>(this.database.prepare('SELECT record FROM assistant_runs WHERE id=?').get(id) as RecordRow | undefined);}
  saveRun(run: Run): void {this.database.prepare('INSERT INTO assistant_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(run.id, run.taskId, JSON.stringify(run));}
  stage(stage: Stage): void {this.database.prepare('INSERT INTO assistant_inputs VALUES (?,?,?)').run(stage.ref, stage.requestId, JSON.stringify(stage));}
  input(ref: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM assistant_inputs WHERE ref=?').get(ref) as RecordRow | undefined);}
  inputFor(requestId: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM assistant_inputs WHERE request_id=?').get(requestId) as RecordRow | undefined);}
  discard(ref: string): void {this.database.prepare('DELETE FROM assistant_inputs WHERE ref=?').run(ref);}
  expireStages(now: number): void {this.database.prepare("DELETE FROM assistant_inputs WHERE json_extract(record,'$.expires')<=?").run(now);}
  stagedCount(): number {return (this.database.prepare('SELECT COUNT(*) AS count FROM assistant_inputs').get() as {count: number}).count;}
  receipt(requestId: string): string | undefined {return (this.database.prepare('SELECT fingerprint FROM assistant_controls WHERE request_id=?').get(requestId) as {fingerprint: string} | undefined)?.fingerprint;}
  /** What a conversation last reported and its last ordering sequence (Hub #505); nothing before its first report. */
  report(conversationId: string): Reported {
    const row = this.database.prepare('SELECT sequence,projection FROM assistant_reports WHERE conversation_id=?').get(conversationId) as {sequence: number; projection: string | null} | undefined;
    return {sequence: row?.sequence ?? 0, projection: row?.projection === null || row?.projection === undefined ? undefined : JSON.parse(row.projection) as Reported['projection']};
  }
  saveReport(conversationId: string, reported: Reported): void {
    this.database.prepare('INSERT INTO assistant_reports VALUES (?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET sequence=excluded.sequence,projection=excluded.projection')
      .run(conversationId, reported.sequence, reported.projection === undefined ? null : JSON.stringify(reported.projection));
  }
  remember(requestId: string, fingerprint: string): void {this.database.prepare('INSERT INTO assistant_controls VALUES (?,?)').run(requestId, fingerprint);}
  summary(task: Task): AssistantTaskSummary {
    const calls = this.calls(task.id).filter(call => call.kind === 'model');
    return {taskId: task.id, conversationId: task.conversationId, profile: task.profile, status: task.status, runId: task.runId,
      questionId: task.question?.id ?? null, hasAnswer: task.question?.answer !== null && task.question !== null,
      code: task.code, modelCalls: task.modelCalls, toolCalls: task.toolCalls, questions: task.questions, activeMs: task.activeMs,
      reservedUnits: task.reservedUnits, usageUnits: calls.some(call => call.units === null) ? null : calls.reduce((sum, call) => sum + (call.units ?? 0), 0)};
  }
  #visibleRows(conversationId: string, condition: 'seq>?' | 'seq<?', position: number, order: 'ASC' | 'DESC',
    size: number, visibility?: MessageVisibility): MessageRow[] {
    const filter = `WHERE conversation_id=? AND ${condition}`;
    if (visibility === undefined) return this.database.prepare(`${messagesWithAttachments} ${filter} ORDER BY seq ${order} LIMIT ?`).all(conversationId, position, size) as MessageRow[];
    // Finish each SELECT before evaluating visibility, which may save disclosure proof.
    const select = this.database.prepare(`SELECT seq,id,role,task_id AS taskId,follows FROM assistant_messages ${filter} ORDER BY seq ${order} LIMIT ?`);
    const ids: string[] = [];
    let cursor = position;
    while (ids.length < size) {
      const candidates = select.all(conversationId, cursor, size) as (MessageSource & {seq: number})[];
      for (const candidate of candidates) {
        cursor = candidate.seq;
        if (visibility.shows(candidate)) ids.push(candidate.id);
        if (ids.length === size) break;
      }
      if (candidates.length < size) break;
    }
    if (ids.length === 0) return [];
    return this.database.prepare(`${messagesWithAttachments} WHERE msg.id IN (${ids.map(() => '?').join(',')}) ORDER BY seq ${order}`).all(...ids) as MessageRow[];
  }
  #visibleMessage(row: MessageRow, visibility?: MessageVisibility): ConversationMessage {
    if (visibility === undefined) return messageOf(row);
    const followed = row.follows === null ? undefined : this.messageSource(row.follows);
    const follows = followed !== undefined && visibility.shows(followed) ? row.follows : null;
    const visible = row.artRequestId !== null && !visibility.attachment(row.artRequestId)
      ? {...row, artRequestId: null, artDescription: null} : row;
    const message = messageOf({...visible, text: visibility.privateText?.(row) ?? visible.text, follows});
    return message.role === 'tool' && message.text.startsWith('refused: ') && this.call(message.id)?.codingApproval !== undefined
      ? {...message, codingRefusal: true} : message;
  }
  #visibleQuestion(task: Task, visibility?: MessageVisibility): ConversationQuestion | null {
    const question = task.question;
    if (question === null || visibility?.shows({id: question.id, role: 'assistant', taskId: task.id}) === false) return null;
    const answerRole = question.kind === 'delegation' ? 'tool' : 'owner';
    const answerId = `${question.id}-${answerRole === 'tool' ? 'result' : 'answer'}`;
    const {modeClarification: _modeClarification, ...visible} = question;
    return visibility?.shows({id: answerId, role: answerRole, taskId: task.id}) === false ? {...visible, answer: null} : visible;
  }
  page(profile: AssistantProfile, after: number, visibility?: MessageVisibility): ConversationPage {
    const id = this.conversation(profile);
    const page: ConversationPage = {version: 1, conversationId: id ?? null, messages: [], currentTask: null, next: null};
    if (id === undefined) return page;
    const task = this.latest().find(task => task.profile === profile);
    if (task !== undefined && after === 0 && visibility?.task(task.id) !== false) {
      page.currentTask = {taskId: task.id, question: this.#visibleQuestion(task, visibility)};
    }
    const rows = this.#visibleRows(id, 'seq>?', after, 'ASC', 17, visibility);
    for (const item of rows.slice(0, 16)) {
      const row = this.#visibleMessage(item, visibility);
      const candidate = {...page, messages: [...page.messages, row], next: row.seq};
      if (Buffer.byteLength(JSON.stringify(candidate)) > LIMITS.pageBytes) break;
      page.messages.push(row);
    }
    if (rows.length > page.messages.length) page.next = page.messages.at(-1)?.seq ?? after;
    return page;
  }
  /**
   * The recent view of the profile's current conversation, or of an earlier one by its ID (Hub #2029), which has no
   * current task. An ID that is not one of the profile's conversations is not found.
   */
  recentPage(profile: AssistantProfile, before: string | undefined, requested?: string, visibility?: MessageVisibility): RecentConversationPage | 'invalid-request' | 'capacity' | 'not-found' {
    const current = this.conversation(profile) ?? null;
    if (requested !== undefined && !this.owns(profile, requested)) return 'not-found';
    const conversationId = requested ?? current;
    const page: RecentConversationPage = {version: 2, profile, conversationId, currentTask: null, messages: [], older: null};
    const cursor = before === undefined ? undefined : readHistoryCursor(before, profile);
    if (before !== undefined && (cursor === undefined || cursor.conversationId !== conversationId)) return 'invalid-request';
    if (conversationId === null) return page;
    if (cursor === undefined && conversationId === current) {
      const task = parsed<Task>(this.database.prepare('SELECT record FROM assistant_tasks WHERE profile=? ORDER BY seq DESC LIMIT 1').get(profile) as RecordRow | undefined);
      if (task !== undefined && task.conversationId === conversationId && visibility?.task(task.id) !== false) {
        const question = this.#visibleQuestion(task, visibility);
        page.currentTask = {taskId: task.id, question: question === null ? null : {
          id: question.id, text: question.text, answer: question.answer, kind: question.kind, proposal: question.proposal,
        }};
      }
    }
    const rows = this.#visibleRows(conversationId, 'seq<?', cursor?.seq ?? Number.MAX_SAFE_INTEGER, 'DESC', HISTORY_ROWS + 1, visibility);
    for (const item of rows.slice(0, HISTORY_ROWS)) {
      const row = this.#visibleMessage(item, visibility);
      const older = page.messages.length + 1 < rows.length ? historyCursor({profile, conversationId, seq: row.seq}) : null;
      const messages = [row, ...page.messages];
      if (Buffer.byteLength(JSON.stringify({...page, messages, older})) > LIMITS.pageBytes) break;
      page.messages = messages;
      page.older = older;
    }
    if ((rows.length > 0 && page.messages.length === 0) || Buffer.byteLength(JSON.stringify(page)) > LIMITS.pageBytes) return 'capacity';
    return page;
  }

}
