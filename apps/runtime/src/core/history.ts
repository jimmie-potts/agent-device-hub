// The core's history (Hub #782, ADR 0012 "Inbox and history"): private rows in the core store, with no time limit. It
// keeps every removal, occurrence and outcome whole, a compact change event for each state change (what changed, not
// the whole record: owner decision, 2026-10-07), and each step of every tracked action. Each row is written in the
// transaction that commits what it records. History is the core's own record, never a feed: viewing it triggers
// nothing, nothing is replayed from it, and its read API with filters is Hub #923's. It also drops a duplicate by
// `(source, id)`, durably, since every whole message it keeps is one row: an outbox sends an unacknowledged outcome
// again after every restart, and a crash can send a module's last messages twice.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {compareDelivery, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {OUTCOME_RECORDED_TYPE} from '@jimmie-potts/sdk';
import type {ActionKind, Evidence, OperationResult, OperationStatus} from './operations.js';

/** What a history row records. */
export type HistoryKind = 'change' | 'removal' | 'occurrence' | 'outcome' | 'operation';

/**
 * A compact change event: one state message as what changed since the previous record of its entity that history
 * holds. `previous` is that record's revision, or null when history held none, as for a new entity, whose every member
 * is then `changed`. `changed` holds each top-level member whose value differs, with its new value, and `removed` each
 * member the new record no longer has. The entity's `id` and `revision` are not members here.
 */
export type ChangeEvent = {family: string; id: string; revision: number; previous: number | null; changed: Record<string, unknown>; removed: string[]};

/** One step of a tracked action, as history keeps it. */
export type OperationStep = {
  /** What happened: the action was sent, its owner replied, an outcome arrived, or its deadline passed. */
  event: 'sent' | 'reply' | 'outcome' | 'deadline';
  requestId: string;
  kind: ActionKind;
  command: string;
  target: string;
  requestedBy: string;
  /** The operation's status after this step. */
  status: OperationStatus;
  /** The owner's reply, `accepted` or a refusal's code, once known. */
  reply?: string;
  result?: OperationResult;
  evidence?: Evidence;
  error?: ErrorDetail;
  /** The outcome this step took, by `(source, id)`, when an outcome caused it. */
  outcome?: {source: string; id: string};
};

/** What one transaction keeps in history, in the order it happened. */
export type HistoryEntry = {kind: 'message'; message: Message<unknown>} | {kind: 'operation'; step: OperationStep};

/** At most this many refused messages are kept for diagnosis; the oldest goes first. */
export const MAX_REFUSED = 1000;
const SCHEMA_BASE = 'https://bunny.invalid/events/';
/** Messages history never keeps: a hook's raw observation, which the core reduces into the changes it keeps, and the acknowledgments. */
const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';

/** The family a state's `dataschema` names, or undefined. */
export const familyOf = (dataschema: string): string | undefined => {
  if (!dataschema.startsWith(SCHEMA_BASE)) return undefined;
  const rest = dataschema.slice(SCHEMA_BASE.length);
  const family = rest.slice(0, rest.lastIndexOf('/'));
  return family === '' ? undefined : family;
};

/** Whether history keeps `message`: every state, removal, occurrence and outcome but a raw observation and an acknowledgment. */
export const kept = (message: Pick<Message<unknown>, 'kind' | 'type'>): boolean =>
  ['state', 'removal', 'occurrence', 'outcome'].includes(message.kind) && message.type !== LIFECYCLE_TYPE && message.type !== OUTCOME_RECORDED_TYPE;

export class History {
  readonly #statements: {
    insert: StatementSync; stored: StatementSync; seen: StatementSync; latest: StatementSync; setLatest: StatementSync;
    refuse: StatementSync; trimRefused: StatementSync;
  };

  constructor(database: DatabaseSync) {
    database.exec(`CREATE TABLE IF NOT EXISTS core_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, revision INTEGER NOT NULL,
        kind TEXT NOT NULL, source TEXT NOT NULL, message_id TEXT, type TEXT NOT NULL, subject TEXT NOT NULL, request_id TEXT, record TEXT NOT NULL) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS core_history_message ON core_history (source, message_id) WHERE message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS core_history_request ON core_history (request_id) WHERE request_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS core_history_latest (source TEXT NOT NULL, family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
        record TEXT NOT NULL, PRIMARY KEY (source, family, id)) STRICT;
      CREATE TABLE IF NOT EXISTS core_refused (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, source TEXT NOT NULL, message_id TEXT NOT NULL,
        message TEXT NOT NULL) STRICT`);
    this.#statements = {
      insert: database.prepare('INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      stored: database.prepare('SELECT record FROM core_history WHERE source = ? AND message_id = ? AND kind != \'change\''),
      seen: database.prepare('SELECT 1 FROM core_history WHERE source = ? AND message_id = ?'),
      latest: database.prepare('SELECT revision, record FROM core_history_latest WHERE source = ? AND family = ? AND id = ?'),
      setLatest: database.prepare(`INSERT INTO core_history_latest VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (source, family, id) DO UPDATE SET revision = excluded.revision, record = excluded.record`),
      refuse: database.prepare('INSERT INTO core_refused (at_ms, source, message_id, message) VALUES (?, ?, ?, ?)'),
      trimRefused: database.prepare('DELETE FROM core_refused WHERE seq <= (SELECT MAX(seq) FROM core_refused) - ?'),
    };
  }

  /**
   * How history took a removal, occurrence or outcome with this `(source, id)` before: `new`, an exact `duplicate`, or
   * a `conflict`, the same `(source, id)` with other content.
   */
  received(message: Message<unknown>): ReturnType<typeof compareDelivery> {
    const row = this.#statements.stored.get(message.source, message.id) as {record: string} | undefined;
    return compareDelivery(row === undefined ? undefined : JSON.parse(row.record) as Message<unknown>, message);
  }

  /** Keeps a message refused as `duplicate-conflict` for diagnosis, apart from history, with the latest `MAX_REFUSED`. */
  refuse(message: Message<unknown>, atMs: number): void {
    this.#statements.refuse.run(atMs, message.source, message.id, JSON.stringify(message));
    this.#statements.trimRefused.run(MAX_REFUSED);
  }

  /** Writes one transaction's entries, in order, inside that transaction. */
  write(entries: readonly HistoryEntry[], atMs: number, revision: number): void {
    for (const entry of entries) {
      if (entry.kind === 'operation') this.#operation(entry.step, atMs, revision);
      else this.#message(entry.message, atMs, revision);
    }
  }

  #operation(step: OperationStep, atMs: number, revision: number): void {
    this.#statements.insert.run(atMs, revision, 'operation', step.requestedBy, null, step.command, step.target, step.requestId, JSON.stringify(step));
  }

  #message(message: Message<unknown>, atMs: number, revision: number): void {
    // A message history already holds, as a crash's resend, adds nothing.
    if (!kept(message) || this.#statements.seen.get(message.source, message.id) !== undefined) return;
    if (message.kind === 'state') {
      this.#change(message, atMs, revision);
      return;
    }
    if (message.kind === 'removal') {
      // The entity's previous record becomes a tombstone at the removal's revision, so a late state at or below it
      // brings nothing back, and a new entity under the same ID starts afresh.
      const {entity, revision: removedAt} = message.data as {entity?: {family?: unknown; id?: unknown}; revision?: unknown};
      if (typeof entity?.family === 'string' && typeof entity.id === 'string') {
        this.#statements.setLatest.run(message.source, entity.family, entity.id, typeof removedAt === 'number' ? removedAt : 0, 'null');
      }
    }
    const {requestId} = message.data as {requestId?: unknown};
    this.#statements.insert.run(atMs, revision, message.kind, message.source, message.id, message.type, message.subject,
      message.kind === 'outcome' && typeof requestId === 'string' ? requestId : null, JSON.stringify(message));
  }

  /**
   * A state message as a compact change event against the entity's previous record, or nothing when the record is
   * stale or changed nothing.
   */
  #change(message: Message<unknown>, atMs: number, revision: number): void {
    const family = familyOf(message.dataschema);
    const record = message.data as Record<string, unknown> | null;
    if (family === undefined || typeof record !== 'object' || record === null || Array.isArray(record)) return;
    const id = typeof record.id === 'string' ? record.id : message.subject;
    const entityRevision = typeof record.revision === 'number' ? record.revision : 0;
    const latest = this.#statements.latest.get(message.source, family, id) as {revision: number; record: string} | undefined;
    const held = latest === undefined ? null : JSON.parse(latest.record) as Record<string, unknown> | null;
    // A state older than the record history holds, or at or below the revision that removed its entity, is stale.
    if (latest !== undefined && (entityRevision < latest.revision || (held === null && entityRevision <= latest.revision))) return;
    const before = held ?? {};
    const members = (value: Record<string, unknown>): string[] => Object.keys(value).filter(name => name !== 'id' && name !== 'revision');
    const changed: Record<string, unknown> = {};
    for (const name of members(record)) if (JSON.stringify(record[name]) !== JSON.stringify(before[name])) changed[name] = record[name];
    const removed = members(before).filter(name => !Object.hasOwn(record, name));
    this.#statements.setLatest.run(message.source, family, id, entityRevision, JSON.stringify(record));
    if (Object.keys(changed).length === 0 && removed.length === 0) return;
    const event: ChangeEvent = {family, id, revision: entityRevision, previous: held === null ? null : latest?.revision ?? null, changed, removed};
    this.#statements.insert.run(atMs, revision, 'change', message.source, message.id, message.type, message.subject, null, JSON.stringify(event));
  }
}
