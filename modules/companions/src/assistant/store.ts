import {Messages} from '../knowledge/messages.js';
import {advanceRevision, initializeRevision} from '../revision.js';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {AssistantProfile, AssistantStatus, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';

export const GRAPH_VERSION = 'synthetic-1';
export const LIMITS = Object.freeze({modelCalls: 4, toolCalls: 2, questions: 2, activeMs: 120_000, modelMs: 30_000,
  toolMs: 5000, controlMs: 5000, inputBytes: 4096, toolBytes: 8192, stateBytes: 32768, pageBytes: 65536, units: 8192, callUnits: 2048});
export type Question = {id: string; text: string; answer: string | null};
export type Task = {version: 1; graphVersion: string; id: string; conversationId: string; profile: AssistantProfile; prompt: string;
  status: AssistantStatus; runId: string | null; generation: number; question: Question | null; code: ErrorCode | null;
  modelCalls: number; toolCalls: number; questions: number; activeMs: number; reservedUnits: number; nextOrdinal: number;
  traceparent: string | null};
export type Call = {version: 1; id: string; taskId: string; runId: string; ordinal: number; kind: 'model' | 'tool';
  status: 'admitted' | 'succeeded' | 'uncertain'; result: string | null; units: number | null; reservedUnits: number;
  reservedMs: number; elapsedMs: number | null; traceparent: string};
export type Run = {version: 1; id: string; taskId: string; startedAtMs: number; endedAtMs: number | null;
  status: AssistantStatus; traceparent: string; previousTraceparent: string | null};
export type StagedInput = {action: 'start' | 'answer'; profile: AssistantProfile; text: string; expectedRevision: number; taskId?: string; questionId?: string};
export type Stage = {ref: string; requestId: string; input: StagedInput; expires: number};
export type ConversationMessage = {seq: number; taskId: string; role: 'owner' | 'assistant' | 'tool'; text: string; atMs: number};
export type ConversationPage = {version: 1; conversationId: string | null; messages: ConversationMessage[]; currentTask: {taskId: string; question: Question | null} | null; next: number | null};
type RecordRow = {record: string};
const parsed = <T>(row: RecordRow | undefined): T | undefined => row === undefined ? undefined : JSON.parse(row.record) as T;
export const terminal = (status: AssistantStatus): boolean => ['succeeded', 'failed', 'cancelled'].includes(status);

/** All writes are synchronous and are called inside the owning outbox's transaction when they change task state. */
export class AssistantStore {
  readonly messages: Messages;
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, enabled INTEGER NOT NULL);
      INSERT OR IGNORE INTO assistant_meta VALUES (1,0,0);
      CREATE TABLE IF NOT EXISTS assistant_conversations (profile TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS assistant_tasks (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, profile TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation_id TEXT NOT NULL, task_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, at_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_inputs (ref TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assistant_controls (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS assistant_message_page ON assistant_messages(conversation_id,seq);
      CREATE INDEX IF NOT EXISTS assistant_task_calls ON assistant_calls(task_id);`);
    initializeRevision(database, this.meta().revision);
    this.messages = new Messages(database);
  }
  meta(): {revision: number; enabled: boolean} {
    const row = this.database.prepare('SELECT revision,enabled FROM assistant_meta WHERE id=1').get() as {revision: number; enabled: number};
    return {revision: row.revision, enabled: row.enabled === 1};
  }
  bump(): void {this.database.prepare('UPDATE assistant_meta SET revision=? WHERE id=1').run(advanceRevision(this.database));}
  enable(enabled: boolean): void {this.database.prepare('UPDATE assistant_meta SET enabled=? WHERE id=1').run(enabled ? 1 : 0);}
  task(id: string): Task | undefined {return parsed<Task>(this.database.prepare('SELECT record FROM assistant_tasks WHERE id=?').get(id) as RecordRow | undefined);}
  latest(): Task[] {return this.database.prepare('SELECT record FROM assistant_tasks WHERE seq IN (SELECT MAX(seq) FROM assistant_tasks GROUP BY profile) ORDER BY seq').all().map(row => JSON.parse(row.record as string) as Task);}
  unfinished(): Task | undefined {return parsed<Task>(this.database.prepare("SELECT record FROM assistant_tasks WHERE status NOT IN ('succeeded','failed','cancelled') LIMIT 1").get() as RecordRow | undefined);}
  save(task: Task): void {this.database.prepare('INSERT INTO assistant_tasks(id,profile,status,record) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record=excluded.record').run(task.id, task.profile, task.status, JSON.stringify(task));}
  conversation(profile: AssistantProfile): string | undefined {return (this.database.prepare('SELECT id FROM assistant_conversations WHERE profile=?').get(profile) as {id: string} | undefined)?.id;}
  newTask(profile: AssistantProfile, prompt: string): Task {
    const conversationId = this.conversation(profile) ?? randomUUID();
    this.database.prepare('INSERT OR IGNORE INTO assistant_conversations VALUES (?,?)').run(profile, conversationId);
    return {version: 1, graphVersion: GRAPH_VERSION, id: randomUUID(), conversationId, profile, prompt, status: 'paused', runId: null,
      generation: 0, question: null, code: null, modelCalls: 0, toolCalls: 0, questions: 0, activeMs: 0, reservedUnits: 0, nextOrdinal: 0, traceparent: null};
  }
  message(task: Task, id: string, role: ConversationMessage['role'], text: string, atMs: number): void {
    if (this.messages.removal(id) !== undefined) return;
    this.database.prepare('INSERT OR IGNORE INTO assistant_messages(id,conversation_id,task_id,role,text,at_ms) VALUES (?,?,?,?,?,?)').run(id, task.conversationId, task.id, role, text, atMs);
    this.messages.capture(task, id, role, text, atMs);
  }
  call(id: string): Call | undefined {return parsed<Call>(this.database.prepare('SELECT record FROM assistant_calls WHERE id=?').get(id) as RecordRow | undefined);}
  calls(taskId: string): Call[] {return this.database.prepare('SELECT record FROM assistant_calls WHERE task_id=?').all(taskId).map(row => JSON.parse(row.record as string) as Call);}
  saveCall(call: Call): void {this.database.prepare('INSERT INTO assistant_calls VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(call.id, call.taskId, JSON.stringify(call));}
  run(id: string): Run | undefined {return parsed<Run>(this.database.prepare('SELECT record FROM assistant_runs WHERE id=?').get(id) as RecordRow | undefined);}
  saveRun(run: Run): void {this.database.prepare('INSERT INTO assistant_runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(run.id, run.taskId, JSON.stringify(run));}
  stage(stage: Stage): void {this.database.prepare('INSERT INTO assistant_inputs VALUES (?,?,?)').run(stage.ref, stage.requestId, JSON.stringify(stage));}
  input(ref: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM assistant_inputs WHERE ref=?').get(ref) as RecordRow | undefined);}
  inputFor(requestId: string): Stage | undefined {return parsed<Stage>(this.database.prepare('SELECT record FROM assistant_inputs WHERE request_id=?').get(requestId) as RecordRow | undefined);}
  discard(ref: string): void {this.database.prepare('DELETE FROM assistant_inputs WHERE ref=?').run(ref);}
  expireStages(now: number): void {this.database.prepare("DELETE FROM assistant_inputs WHERE json_extract(record,'$.expires')<=?").run(now);}
  stagedCount(): number {return (this.database.prepare('SELECT COUNT(*) AS count FROM assistant_inputs').get() as {count: number}).count;}
  receipt(requestId: string): string | undefined {return (this.database.prepare('SELECT fingerprint FROM assistant_controls WHERE request_id=?').get(requestId) as {fingerprint: string} | undefined)?.fingerprint;}
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
    const rows = this.database.prepare('SELECT seq,task_id AS taskId,role,text,at_ms AS atMs FROM assistant_messages WHERE conversation_id=? AND seq>? ORDER BY seq LIMIT 17').all(id, after) as ConversationMessage[];
    for (const row of rows.slice(0, 16)) {
      const candidate = {...page, messages: [...page.messages, row], next: row.seq};
      if (Buffer.byteLength(JSON.stringify(candidate)) > LIMITS.pageBytes) break;
      page.messages.push(row);
    }
    if (rows.length > page.messages.length) page.next = page.messages.at(-1)?.seq ?? after;
    return page;
  }
}
