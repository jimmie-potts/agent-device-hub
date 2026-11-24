// The conversation message queue (Hub #2030): messages the owner saves while a companion works, started one at a time
// as new tasks of the same conversation. The queue is the module's own domain state beside the checkpointer, never a
// stored command (ADR 0012): the input command that queues a message completes once the message is saved.
//
// Adapted from two projects; THIRD-PARTY-NOTICES.md holds their licenses and notices.
// - OpenAI Codex, `codex-rs/state/queue_migrations/0001_queued_items.sql` at a0436d69 (Apache-2.0): the queued item
//   table, one row per message with its thread, ordinal and times, modified to key a message by the request ID that
//   queued it and to keep its text instead of a payload.
// - OpenAI Codex, `codex-rs/ext/queue/src/service.rs` `dispatch_if_idle` and `on_thread_idle` at a0436d69 (Apache-2.0):
//   the head starts only while its thread is idle and an interrupt leaves the queue waiting, modified so that the start
//   and the removal commit together and a hold is saved with its reason.
// - T3 Code, `packages/contracts/src/orchestrationV2.ts` at b4277089 (MIT): `queueHeld`, `queue.resume` and the
//   `queued-run.edit`, `queued-run.cancel` and `queued-run.reorder` commands, whose `beforeRunId` (null for the end)
//   names where a message moves.
//
// The same store keeps each running task's unread steers (Hub #2031): messages the owner sent to steer the task, saved
// at once and taken into the task's own transcript at its next model call. A steer the task never read goes back to the
// head of its conversation's queue when the turn closes or is stopped, so no steer is dropped. This follows Codex's
// pending input (`codex-rs/core/src/session/turn.rs` and `codex-rs/core/src/tasks/mod.rs` at a0436d69, Apache-2.0),
// modified to keep each steer as a durable row instead of in memory.
import type {DatabaseSync} from 'node:sqlite';
import type {AssistantProfile, AssistantQueueHold} from '@jimmie-potts/event-contracts/v2/assistant';
import {LIMITS} from './limits.js';
import {isErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {QueueDocument, QueueHold} from './queue-contract.js';
export type {QueueDocument, QueueHold} from './queue-contract.js';

/** One waiting message: its ID is the request ID of the input command that queued it, so a repeat cannot queue it twice. */
export type QueuedMessage = {id: string; conversationId: string; profile: AssistantProfile; text: string; queuedAtMs: number; updatedAtMs: number;
  /** The queuing command's trace, which the run of the message's task starts from. */
  traceparent: string};
type MessageRow = {id: string; conversationId: string; profile: AssistantProfile; text: string; queuedAtMs: number; updatedAtMs: number; traceparent: string};
const COLUMNS = 'id,conversation_id AS conversationId,profile,text,queued_at_ms AS queuedAtMs,updated_at_ms AS updatedAtMs,traceparent';
/**
 * One unread steer of a running task (Hub #2031). Its ID is the request ID of the input command that sent it, as a
 * queued message's is, so a repeat cannot save it twice and the queued message it may become keeps the same ID.
 */
export type Steer = {id: string; taskId: string; conversationId: string; profile: AssistantProfile; text: string; savedAtMs: number;
  /** The steering command's trace, which a queued start of the steer follows. */
  traceparent: string};
const STEER_COLUMNS = 'id,task_id AS taskId,conversation_id AS conversationId,profile,text,saved_at_ms AS savedAtMs,traceparent';

/** All writes are synchronous and run inside the owning outbox's transaction, beside the task change they belong with. */
export class MessageQueue {
  constructor(readonly database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_queued_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, profile TEXT NOT NULL,
        position INTEGER NOT NULL, text TEXT NOT NULL, queued_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, traceparent TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_queue_order ON assistant_queued_messages(conversation_id,position);
      CREATE TABLE IF NOT EXISTS assistant_queues (conversation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL,
        held TEXT CHECK(held IS NULL OR held IN ('stop','restart','refused')), code TEXT, detail TEXT,
        pending INTEGER NOT NULL DEFAULT 0 CHECK(pending IN (0,1))) STRICT;
      CREATE TABLE IF NOT EXISTS assistant_steers (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, conversation_id TEXT NOT NULL, profile TEXT NOT NULL,
        position INTEGER NOT NULL, text TEXT NOT NULL, saved_at_ms INTEGER NOT NULL, traceparent TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS assistant_steer_order ON assistant_steers(task_id,position);`);
  }
  /**
   * Counts the conversation's queue as changed in the open transaction; the assistant's next revision records it. The
   * mark is a row in that transaction, so a transaction that rolls back leaves no mark behind.
   */
  touch(conversationId: string): void {
    this.database.prepare('INSERT INTO assistant_queues(conversation_id,revision,pending) VALUES (?,0,1) ON CONFLICT(conversation_id) DO UPDATE SET pending=1').run(conversationId);
  }
  /** The conversation's waiting messages, first to start first. */
  messages(conversationId: string): QueuedMessage[] {
    return this.database.prepare(`SELECT ${COLUMNS} FROM assistant_queued_messages WHERE conversation_id=? ORDER BY position`).all(conversationId) as MessageRow[];
  }
  message(id: string): QueuedMessage | undefined {
    return this.database.prepare(`SELECT ${COLUMNS} FROM assistant_queued_messages WHERE id=?`).get(id) as MessageRow | undefined;
  }
  count(conversationId: string): number {
    return (this.database.prepare('SELECT COUNT(*) AS count FROM assistant_queued_messages WHERE conversation_id=?').get(conversationId) as {count: number}).count;
  }
  /** Why the queue is held, or null while its next message may start. A queue is held only while it holds a message. */
  hold(conversationId: string): QueueHold | null {
    const row = this.database.prepare('SELECT held,code,detail FROM assistant_queues WHERE conversation_id=?').get(conversationId) as
      {held: AssistantQueueHold | null; code: string | null; detail: string | null} | undefined;
    if (row === undefined || row.held === null) return null;
    return {reason: row.held, code: isErrorCode(row.code) ? row.code : null, detail: row.detail};
  }
  /** The assistant revision of the queue's last change, or 0 before its first. */
  changedAt(conversationId: string): number {
    return (this.database.prepare('SELECT revision FROM assistant_queues WHERE conversation_id=?').get(conversationId) as {revision: number} | undefined)?.revision ?? 0;
  }
  /** Saves a message at the end of the conversation's queue; the caller has checked the queue has room. */
  add(message: QueuedMessage): void {
    const last = (this.database.prepare('SELECT MAX(position) AS position FROM assistant_queued_messages WHERE conversation_id=?').get(message.conversationId) as {position: number | null}).position ?? 0;
    this.database.prepare('INSERT INTO assistant_queued_messages VALUES (?,?,?,?,?,?,?,?)')
      .run(message.id, message.conversationId, message.profile, last + 1, message.text, message.queuedAtMs, message.updatedAtMs, message.traceparent);
    this.touch(message.conversationId);
  }
  /**
   * Whether the conversation's queue has room for one more message: it holds fewer than its limit. A queue that returned
   * steers took past the limit has none until it is below the limit again (Hub #2031).
   */
  room(conversationId: string): boolean {return this.count(conversationId) < LIMITS.queuedMessages;}
  /** The task's unread steers, oldest first. */
  steers(taskId: string): Steer[] {
    return this.database.prepare(`SELECT ${STEER_COLUMNS} FROM assistant_steers WHERE task_id=? ORDER BY position`).all(taskId) as Steer[];
  }
  steer(id: string): Steer | undefined {return this.database.prepare(`SELECT ${STEER_COLUMNS} FROM assistant_steers WHERE id=?`).get(id) as Steer | undefined;}
  /** How many unread steers the conversation's task holds. */
  steerCount(conversationId: string): number {
    return (this.database.prepare('SELECT COUNT(*) AS count FROM assistant_steers WHERE conversation_id=?').get(conversationId) as {count: number}).count;
  }
  /**
   * Whether the conversation's task can take one more steer: it holds fewer than its limit of unread steers, and the
   * queue they may return to and the steers together hold fewer than the queue's bound.
   */
  steerRoom(conversationId: string): boolean {
    const steers = this.steerCount(conversationId);
    return steers < LIMITS.steers && this.count(conversationId) + steers < LIMITS.queueBound;
  }
  /** The tasks that hold unread steers, oldest first. */
  steerTasks(): {taskId: string; conversationId: string}[] {
    return this.database.prepare('SELECT task_id AS taskId,conversation_id AS conversationId FROM assistant_steers GROUP BY task_id ORDER BY MIN(rowid)').all() as {taskId: string; conversationId: string}[];
  }
  /** Saves an unread steer after the task's others; the caller has checked there is room. */
  addSteer(steer: Steer): void {
    const last = (this.database.prepare('SELECT MAX(position) AS position FROM assistant_steers WHERE task_id=?').get(steer.taskId) as {position: number | null}).position ?? 0;
    this.database.prepare('INSERT INTO assistant_steers VALUES (?,?,?,?,?,?,?,?)')
      .run(steer.id, steer.taskId, steer.conversationId, steer.profile, last + 1, steer.text, steer.savedAtMs, steer.traceparent);
    this.touch(steer.conversationId);
  }
  /** Removes a steer the task read: it is in the task's transcript now. */
  delivered(id: string): void {
    const steer = this.steer(id); if (steer === undefined) return;
    this.database.prepare('DELETE FROM assistant_steers WHERE id=?').run(id);
    this.touch(steer.conversationId);
  }
  /**
   * Returns the task's unread steers to the head of its conversation's queue, in the order they were sent and before the
   * messages already queued, as the next messages to start (Hub #2031). They may take the queue past its limit, up to
   * its bound: nothing the owner wrote is dropped. Returns how many came back.
   */
  returnSteers(taskId: string, atMs: number): number {
    const steers = this.steers(taskId);
    this.prepend(steers.map(steer => ({id: steer.id, conversationId: steer.conversationId, profile: steer.profile, text: steer.text, queuedAtMs: steer.savedAtMs,
      updatedAtMs: atMs, traceparent: steer.traceparent})));
    this.database.prepare('DELETE FROM assistant_steers WHERE task_id=?').run(taskId);
    return steers.length;
  }
  /**
   * Saves messages of one conversation at the head of its queue, in their order and before the messages already queued:
   * steers that become the next messages to start (Hub #2031). The caller has checked the queue's bound.
   */
  prepend(messages: readonly QueuedMessage[]): void {
    const first = messages[0];
    if (first === undefined) return;
    const head = (this.database.prepare('SELECT MIN(position) AS position FROM assistant_queued_messages WHERE conversation_id=?').get(first.conversationId) as {position: number | null}).position ?? 1;
    const insert = this.database.prepare('INSERT INTO assistant_queued_messages VALUES (?,?,?,?,?,?,?,?)');
    messages.forEach((message, index) => {insert.run(message.id, message.conversationId, message.profile, head - messages.length + index, message.text, message.queuedAtMs, message.updatedAtMs, message.traceparent);});
    this.touch(first.conversationId);
  }
  edit(id: string, text: string, atMs: number): void {
    const message = this.message(id); if (message === undefined) return;
    this.database.prepare('UPDATE assistant_queued_messages SET text=?,updated_at_ms=? WHERE id=?').run(text, atMs, id);
    this.touch(message.conversationId);
  }
  /** Removes a message: the owner withdrew it, or its task started. A queue left empty is no longer held. */
  remove(id: string): void {
    const message = this.message(id); if (message === undefined) return;
    this.database.prepare('DELETE FROM assistant_queued_messages WHERE id=?').run(id);
    if (this.count(message.conversationId) === 0) this.setHold(message.conversationId, null);
    this.touch(message.conversationId);
  }
  /** Moves a message just before another of its conversation, or to the end when `before` is null. */
  move(id: string, before: string | null): void {
    const message = this.message(id); if (message === undefined) return;
    const order = this.messages(message.conversationId).map(entry => entry.id).filter(entry => entry !== id);
    const at = before === null ? order.length : order.indexOf(before);
    order.splice(at < 0 ? order.length : at, 0, id);
    const update = this.database.prepare('UPDATE assistant_queued_messages SET position=? WHERE id=?');
    order.forEach((entry, index) => {update.run(index + 1, entry);});
    this.touch(message.conversationId);
  }
  /** Holds the queue for a reason, or releases it with null. */
  setHold(conversationId: string, hold: QueueHold | null): void {
    this.database.prepare(`INSERT INTO assistant_queues(conversation_id,revision,held,code,detail,pending) VALUES (?,0,?,?,?,1)
      ON CONFLICT(conversation_id) DO UPDATE SET held=excluded.held,code=excluded.code,detail=excluded.detail,pending=1`)
      .run(conversationId, hold?.reason ?? null, hold?.code ?? null, hold?.detail ?? null);
  }
  /** Records the queues changed in this transaction at the assistant revision that publishes them. */
  record(revision: number): void {
    this.database.prepare('UPDATE assistant_queues SET revision=?,pending=0 WHERE pending=1').run(revision);
  }
  /**
   * At each start: every saved conversation's queue, a profile's current one, an earlier one or a companion exchange,
   * counts as changed at the current revision, as #2027 raises the conversations' change rows, so a command that names
   * an earlier revision is refused. Every queue that still holds messages and was free is held until the owner starts it
   * (owner decision 6); a start starts no work. A queue held here changed at the start, so the next revision records it.
   */
  restarted(revision: number): void {
    this.database.prepare(`INSERT INTO assistant_queues(conversation_id,revision) SELECT id,? FROM (SELECT id FROM assistant_conversations
      UNION SELECT id FROM companion_conversations UNION SELECT conversation_id FROM assistant_queued_messages) WHERE true
      ON CONFLICT(conversation_id) DO UPDATE SET revision=MAX(revision,excluded.revision)`).run(revision);
    const held = this.database.prepare(`SELECT DISTINCT m.conversation_id AS conversationId FROM assistant_queued_messages m
      JOIN assistant_queues q ON q.conversation_id=m.conversation_id WHERE q.held IS NULL`).all() as {conversationId: string}[];
    for (const {conversationId} of held) this.setHold(conversationId, {reason: 'restart', code: null, detail: null});
  }
  /**
   * After the start's reconciliation: a queue counts as changed whenever its conversation changed at the start, such as
   * by a reconciled task, so a Queue naming a revision read before the start is refused exactly when a Send is.
   */
  aligned(): void {
    this.database.prepare(`UPDATE assistant_queues SET revision=MAX(revision,(SELECT c.revision FROM assistant_conversation_changes c
      WHERE c.conversation_id=assistant_queues.conversation_id)) WHERE EXISTS (SELECT 1 FROM assistant_conversation_changes c
      WHERE c.conversation_id=assistant_queues.conversation_id)`).run();
  }
  /** Whether a queue changed since the last recorded revision, such as one the start held. */
  changed(): boolean {return this.database.prepare('SELECT 1 FROM assistant_queues WHERE pending=1 LIMIT 1').get() !== undefined;}
  /**
   * The page's read of one conversation's queue, with the assistant revision it was read at, which the page's commands
   * on what it shows name.
   */
  document(profile: AssistantProfile, conversationId: string | undefined, revision: number, current = true): QueueDocument {
    if (conversationId === undefined) return {version: 1, profile, conversationId: null, revision, current, held: null, messages: [], steers: []};
    const steers = this.database.prepare(`SELECT id,text,saved_at_ms AS savedAtMs FROM assistant_steers WHERE conversation_id=? ORDER BY position`).all(conversationId) as QueueDocument['steers'];
    return {version: 1, profile, conversationId, revision, current, held: this.hold(conversationId),
      messages: this.messages(conversationId).map(({id, text, queuedAtMs, updatedAtMs}) => ({id, text, queuedAtMs, updatedAtMs})), steers};
  }
}
