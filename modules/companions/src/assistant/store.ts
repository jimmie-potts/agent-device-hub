import type {SentArtworkDestination} from './catalog-actions.js';
import type {Confirmation} from './confirmation.js';
import type {ActionEvidence, ApprovedAction} from './closing-reply.js';
import {Messages} from '../knowledge/messages.js';
import {advanceRevision, initializeRevision} from '../revision.js';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {AssistantProfile, AssistantStatus, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';

import type {TranscriptItem} from './provider.js';
import {HISTORY_ROWS, historyCursor, readHistoryCursor, type ConversationMessage, type RecentConversationPage, type SavedQuestion} from './history-contract.js';
import {projectionOf, waitsOnOwner, type Reported} from './sessions.js';

/** The conversation graph of Hub #46. Tasks saved by the fixed synthetic graph (`synthetic-1`) stay readable and refuse resume. */
export const GRAPH_VERSION = 'conversation-1';
import {LIMITS} from './limits.js';
export {LIMITS} from './limits.js';
export type Question = SavedQuestion & {call: string};
export type Task = {version: 1; graphVersion: string; tracksApprovals?: true; id: string; conversationId: string; profile: AssistantProfile; prompt: string;
  status: AssistantStatus; runId: string | null; generation: number; question: Question | null; code: ErrorCode | null;
  modelCalls: number; toolCalls: number; questions: number; activeMs: number; reservedUnits: number; nextOrdinal: number;
  traceparent: string | null; transcript: TranscriptItem[]; attachmentRequestId?: string; attachmentDestination?: SentArtworkDestination};
export type Call = {version: 1; id: string; taskId: string; runId: string; ordinal: number; kind: 'model' | 'tool'; action?: ApprovedAction;
  status: 'admitted' | 'succeeded' | 'uncertain' | 'failed'; code?: ErrorCode; result: string | null; units: number | null; reservedUnits: number;
  reservedMs: number; elapsedMs: number | null; traceparent: string; attachmentSaved?: boolean};
export type Run = {version: 1; id: string; taskId: string; startedAtMs: number; endedAtMs: number | null;
  status: AssistantStatus; traceparent: string; previousTraceparent: string | null};
export type StagedInput = {action: 'start' | 'answer'; profile: AssistantProfile; text: string; expectedRevision: number; taskId?: string; questionId?: string; attachmentRequestId?: string};
export type Stage = {ref: string; requestId: string; input: StagedInput; expires: number};
export type ConversationPage = {version: 1; conversationId: string | null; messages: ConversationMessage[]; currentTask: {taskId: string; question: Question | null} | null; next: number | null};
/** The transcript item appended for a call, found again by its effect id so a re-run node appends it once. */
export type Appended = TranscriptItem & {effect: string};
type RecordRow = {record: string};
type MessageRow = Omit<ConversationMessage, 'attachment' | 'follows' | 'playbackUncertain'> & {follows: string | null} & {artRequestId: string | null; artDescription: string | null; artTargets: string | null;
  artStatus: Call['status'] | null; artResult: string | null; attachmentSaved: number | null; playbackUncertain: number};
const messagesWithAttachments = `SELECT msg.seq,msg.id,msg.task_id AS taskId,msg.role,msg.text,msg.at_ms AS atMs,msg.follows,
  art.request_id AS artRequestId,art.description AS artDescription,intent.targets AS artTargets,json_extract(call.record, '$.status') AS artStatus,
  json_extract(call.record, '$.result') AS artResult,json_extract(call.record, '$.attachmentSaved') AS attachmentSaved,
  EXISTS (SELECT 1 FROM assistant_confirmations c WHERE c.task_id=msg.task_id AND json_extract(c.record, '$.follows')=msg.id
    AND json_extract(c.record, '$.artwork') IS NOT NULL AND json_extract(c.record, '$.uncertain')=1) AS playbackUncertain
  FROM assistant_messages msg LEFT JOIN assistant_art_attachments art ON art.message_id=msg.id
  LEFT JOIN assistant_art_intents intent ON intent.request_id=art.request_id
  LEFT JOIN assistant_calls call ON call.id=CASE WHEN msg.role='owner' THEN msg.task_id||'-step-0' ELSE art.request_id END`;
function messageOf({artRequestId, artDescription, artTargets, artStatus, artResult, attachmentSaved, follows, playbackUncertain, ...row}: MessageRow): ConversationMessage {
  const message: ConversationMessage = {...row, ...(follows === null ? {} : {follows}),
    ...(playbackUncertain === 1 ? {playbackUncertain: true} : {})};
  if (artRequestId === null || artDescription === null) return message;
  const receipt = {kind: 'artwork' as const, requestId: artRequestId, description: artDescription,
    ...(artTargets === null ? {} : {showTargets: JSON.parse(artTargets) as string[]})};
  // A local receipt write can fail after the Art owner admitted the job.
  // Only an actual dispatch refusal proves that the job was not admitted.
  const refusal = artStatus === 'succeeded' && artResult?.startsWith('refused: ') === true ? artResult.slice(9) : undefined;
  if (attachmentSaved === 1) return {...message, attachment: {...receipt, admission: 'accepted'}};
  if (attachmentSaved === 0) return {...message, attachment: {...receipt, admission: 'refused'}};
  if (isErrorCode(refusal)) return {...message, attachment: {...receipt, admission: 'refused', code: refusal}};
  const admission = artStatus === 'succeeded' && artResult?.startsWith('accepted: ') === true ? 'accepted'
    : artStatus === 'admitted' || row.role === 'owner' && artStatus === null ? 'pending' : 'uncertain';
  return {...message, attachment: {...receipt, admission}};
}
const parsed = <T>(row: RecordRow | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
export const terminal = (status: AssistantStatus): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);
/** Whether a call's fate is unknown: admitted with no answer, or answered after its wait ended. A failed call is settled. */
export const unresolved = (calls: readonly Call[]): boolean => calls.some(call => call.status === 'admitted' || call.status === 'uncertain');

/** All writes are synchronous and are called inside the owning outbox's transaction when they change task state. */
export class AssistantStore {
  readonly messages: Messages;
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
      CREATE INDEX IF NOT EXISTS assistant_task_calls ON assistant_calls(task_id);`);
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
    this.messages = new Messages(database);
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
  }
  /** Counts a change of the conversation other than a task's, such as the owner's rename, at the next `bump`. */
  touch(conversationId: string): void {this.#changed.add(conversationId);}
  /**
   * Counts every saved conversation as changed at the current revision, once per start: a command naming an older revision
   * is refused, whatever rows an earlier release left; one naming the revision at start depends on its conversation's changes.
   */
  restarted(): void {
    this.database.prepare(`INSERT INTO assistant_conversation_changes SELECT id,(SELECT revision FROM assistant_meta WHERE id=1) FROM assistant_conversations WHERE true
      ON CONFLICT(conversation_id) DO UPDATE SET revision=MAX(revision,excluded.revision)`).run();
  }
  /** The assistant revision of the conversation's last change, or 0 before its first. */
  changedAt(conversationId: string): number {
    return (this.database.prepare('SELECT revision FROM assistant_conversation_changes WHERE conversation_id=?').get(conversationId) as {revision: number} | undefined)?.revision ?? 0;
  }
  enable(enabled: boolean): void {this.database.prepare('UPDATE assistant_meta SET enabled=? WHERE id=1').run(enabled ? 1 : 0);}
  task(id: string): Task | undefined {return parsed<Task>(this.database.prepare('SELECT record FROM assistant_tasks WHERE id=?').get(id) as RecordRow | undefined);}
  latest(): Task[] {return this.database.prepare('SELECT record FROM assistant_tasks WHERE seq IN (SELECT MAX(seq) FROM assistant_tasks GROUP BY profile) ORDER BY seq').all().map(row => JSON.parse(row.record as string) as Task);}
  /** Every conversation's unfinished task, oldest first: each conversation has at most one (Hub #2027). */
  unfinished(): Task[] {return this.database.prepare("SELECT record FROM assistant_tasks WHERE status NOT IN ('succeeded','failed','cancelled') ORDER BY seq").all().map(row => JSON.parse(row.record as string) as Task);}
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
  newTask(profile: AssistantProfile, prompt: string): Task {
    const conversationId = this.ensureConversation(profile);
    return {version: 1, graphVersion: GRAPH_VERSION, tracksApprovals: true, id: randomUUID(), conversationId, profile, prompt, status: 'paused', runId: null,
      generation: 0, question: null, code: null, modelCalls: 0, toolCalls: 0, questions: 0, activeMs: 0, reservedUnits: 0, nextOrdinal: 0, traceparent: null,
      transcript: [{role: 'owner', text: prompt}]};
  }
  message(task: Task, id: string, role: ConversationMessage['role'], text: string, atMs: number, follows?: string): void {
    if (this.messages.removal(id) !== undefined) return;
    this.database.prepare('INSERT OR IGNORE INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms,follows) VALUES (?,?,?,?,?,?,?)').run(id, task.conversationId, task.id, role, text, atMs, follows ?? null);
    this.messages.capture(task, id, role, text, atMs);
  }
  ownerAttachment(task: Task, requestId: string, atMs: number): boolean {
    const id = `${task.id}-prompt`;
    this.message(task, id, 'owner', task.prompt, atMs);
    return this.database.prepare('INSERT OR IGNORE INTO assistant_art_attachments VALUES (?,?,?)')
      .run(id, requestId, 'Attached artwork').changes === 1;
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
  titleMessages(conversationId: string, limit = 8): {role: 'owner' | 'assistant'; text: string}[] {
    return (this.database.prepare("SELECT role,text FROM assistant_messages WHERE conversation_id=? AND role IN ('owner','assistant') AND id NOT LIKE task_id || '-closing-%' ORDER BY seq DESC LIMIT ?")
      .all(conversationId, limit) as {role: 'owner' | 'assistant'; text: string}[]).reverse();
  }
  /** One saved message of the task, by its id, for the owner to hear again (Hub #500). */
  savedMessage(taskId: string, id: string): Pick<ConversationMessage, 'id' | 'role' | 'text'> | undefined {
    return this.database.prepare('SELECT id,role,text FROM assistant_messages WHERE id=? AND task_id=?').get(id, taskId) as Pick<ConversationMessage, 'id' | 'role' | 'text'> | undefined;
  }
  call(id: string): Call | undefined {return parsed<Call>(this.database.prepare('SELECT record FROM assistant_calls WHERE id=?').get(id) as RecordRow | undefined);}
  calls(taskId: string): Call[] {return this.database.prepare('SELECT record FROM assistant_calls WHERE task_id=?').all(taskId).map(row => JSON.parse(row.record as string) as Call);}
  saveCall(call: Call): void {this.database.prepare('INSERT INTO assistant_calls VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(call.id, call.taskId, JSON.stringify(call));}
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
  page(profile: AssistantProfile, after: number): ConversationPage {
    const id = this.conversation(profile);
    const page: ConversationPage = {version: 1, conversationId: id ?? null, messages: [], currentTask: null, next: null};
    if (id === undefined) return page;
    const task = this.latest().find(task => task.profile === profile);
    if (task !== undefined && after === 0) page.currentTask = {taskId: task.id, question: task.question};
    const rows = this.database.prepare(`${messagesWithAttachments} WHERE conversation_id=? AND seq>? ORDER BY seq LIMIT 17`).all(id, after) as MessageRow[];
    for (const item of rows.slice(0, 16)) {
      const row = messageOf(item);
      const candidate = {...page, messages: [...page.messages, row], next: row.seq};
      if (Buffer.byteLength(JSON.stringify(candidate)) > LIMITS.pageBytes) break;
      page.messages.push(row);
    }
    if (rows.length > page.messages.length) page.next = page.messages.at(-1)?.seq ?? after;
    return page;
  }
  recentPage(profile: AssistantProfile, before: string | undefined): RecentConversationPage | 'invalid-request' | 'capacity' {
    const conversationId = this.conversation(profile) ?? null;
    const page: RecentConversationPage = {version: 2, profile, conversationId, currentTask: null, messages: [], older: null};
    const cursor = before === undefined ? undefined : readHistoryCursor(before, profile);
    if (before !== undefined && (cursor === undefined || cursor.conversationId !== conversationId)) return 'invalid-request';
    if (conversationId === null) return page;
    if (cursor === undefined) {
      const task = parsed<Task>(this.database.prepare('SELECT record FROM assistant_tasks WHERE profile=? ORDER BY seq DESC LIMIT 1').get(profile) as RecordRow | undefined);
      if (task !== undefined && task.conversationId === conversationId) {
        const question = task.question;
        page.currentTask = {taskId: task.id, question: question === null ? null : {
          id: question.id, text: question.text, answer: question.answer, kind: question.kind, proposal: question.proposal,
        }};
      }
    }
    const columns = messagesWithAttachments;
    const rows = (cursor === undefined
      ? this.database.prepare(`${columns} WHERE conversation_id=? ORDER BY seq DESC LIMIT ?`).all(conversationId, HISTORY_ROWS + 1)
      : this.database.prepare(`${columns} WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT ?`).all(conversationId, cursor.seq, HISTORY_ROWS + 1)) as MessageRow[];
    for (const item of rows.slice(0, HISTORY_ROWS)) {
      const row = messageOf(item);
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
