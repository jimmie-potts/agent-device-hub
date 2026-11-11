// The core's history (Hub #782, ADR 0012 "Inbox and history"): private rows in the core store, with no time limit. It
// keeps every removal, occurrence and outcome whole, a compact change event for each state change (what changed, not
// the whole record: owner decision, 2026-10-07), and each step of every tracked action. Each row is written in the
// transaction that commits what it records. Viewing history triggers nothing and nothing is published from it; its
// read API with filters is Hub #923's. It also drops a duplicate by `(source, id)`, durably, since every whole message
// it keeps is one row: an outbox sends an unacknowledged outcome again after every restart, and a crash can send a
// module's last messages twice.
//
// History is also a fact log (#1740, owner decisions on #1729): each row names its origin, the installation that wrote
// it, and its place in that origin's order, `origin_seq`, counting from 1 with no gaps. The origin is a random UUID the
// store creates once and keeps in `core_origin`; it is never derived from a host, user, address or path. A reader asks
// for one origin's rows after a sequence it holds, a bounded page at a time, and keeps its own cursor: the core keeps
// no reader's position. The duplicate check looks only at the local origin's rows, so a fact another origin also holds
// never hides the local copy. The message envelope does not carry the origin.
import {randomUUID} from 'node:crypto';
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
/**
 * Messages history never keeps: a hook's raw observation, which the core reduces into the changes it keeps, a collector's
 * Desktop snapshot, which the Codex Desktop module reduces into observations (Hub #567), a Volcano snapshot and Volcano
 * status, whose usage the Volcano module alone keeps (Hub #615), and the acknowledgments. The Volcano device record stays:
 * it says only whether the device is available, so its rows follow availability and never its temperature.
 */
const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';
const DESKTOP_METADATA_TYPE = 'org.bunny.desktop-metadata.observed';
const VOLCANO_OBSERVATION_TYPE = 'org.bunny.volcano-observation.observed';
const VOLCANO_STATUS_TYPE = 'org.bunny.volcano-status.updated';

/** The family a state's `dataschema` names, or undefined. */
export const familyOf = (dataschema: string): string | undefined => {
  if (!dataschema.startsWith(SCHEMA_BASE)) return undefined;
  const rest = dataschema.slice(SCHEMA_BASE.length);
  const family = rest.slice(0, rest.lastIndexOf('/'));
  return family === '' ? undefined : family;
};

/** Whether history keeps `message`: every state, removal, occurrence and outcome but a raw observation, a Desktop or Volcano snapshot, Volcano status and an acknowledgment. */
export const kept = (message: Pick<Message<unknown>, 'kind' | 'type'>): boolean =>
  ['state', 'removal', 'occurrence', 'outcome'].includes(message.kind) && message.type !== LIFECYCLE_TYPE && message.type !== DESKTOP_METADATA_TYPE && message.type !== VOLCANO_OBSERVATION_TYPE && message.type !== VOLCANO_STATUS_TYPE && message.type !== OUTCOME_RECORDED_TYPE;

export type HistoryFilter = {fromAtMs?: number; toAtMs?: number; kind?: HistoryKind; source?: string; session?: string; limit?: number};
export type HistoryRow = {seq: number; atMs: number; revision: number; kind: HistoryKind; source: string; messageId: string | null;
  type: string; subject: string; requestId: string | null; record: Record<string, unknown>};
/** A history row as the fact log reads it: a history row with its origin and its place in that origin's order. */
export type FactRow = HistoryRow & {origin: string; originSeq: number};
/** At most this many rows one read after a sequence returns. */
export const MAX_FACTS = 500;
export const HISTORY_FILTER_SCHEMA = {type: 'object' as const, additionalProperties: false, properties: {
  fromAtMs: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER}, toAtMs: {type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER},
  kind: {enum: ['change', 'removal', 'occurrence', 'outcome', 'operation']},
  source: {type: 'string', pattern: '^bunny(/[a-z0-9][a-z0-9-]*)+$', maxLength: 256},
  session: {type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$'},
  limit: {type: 'integer', minimum: 1, maximum: 500},
}};
export function historyFilter(value: Record<string, unknown>): HistoryFilter | undefined {
  if (Object.keys(value).some(key => !Object.hasOwn(HISTORY_FILTER_SCHEMA.properties, key))) return undefined;
  const {fromAtMs, toAtMs, kind, source, session, limit} = value;
  if ([fromAtMs, toAtMs].some(at => at !== undefined && (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0)) ||
    (kind !== undefined && (typeof kind !== 'string' || !['change', 'removal', 'occurrence', 'outcome', 'operation'].includes(kind))) ||
    (source !== undefined && (typeof source !== 'string' || source.length > 256 || !/^bunny(?:\/[a-z0-9][a-z0-9-]*)+$/.test(source))) ||
    (session !== undefined && (typeof session !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(session))) ||
    (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)) ||
    (typeof fromAtMs === 'number' && typeof toAtMs === 'number' && fromAtMs > toAtMs)) return undefined;
  return value;
}

export class History {
  readonly #database: DatabaseSync;
  readonly #statements: {
    insert: StatementSync; stored: StatementSync; seen: StatementSync; latest: StatementSync; setLatest: StatementSync;
    refuse: StatementSync; trimRefused: StatementSync; after: StatementSync;
  };

  /** This installation's origin: a random UUID, created once and kept in the core store. */
  readonly origin: string;

  /**
   * Opens history on the core store's database, in one transaction: creates its tables on a new store, creates the
   * store's origin once, and gives every row that has none, as every row of a store written before #1740 has none, this
   * origin and the next sequence in the order the rows were written. A store already in that state changes nothing.
   */
  constructor(database: DatabaseSync) {
    this.#database = database;
    database.exec('BEGIN IMMEDIATE');
    try {
      this.origin = migrate(database);
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
    this.#statements = {
      insert: database.prepare(`INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record, origin, origin_seq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(origin_seq), 0) + 1 FROM core_history WHERE origin = ?))`),
      stored: database.prepare('SELECT record FROM core_history WHERE origin = ? AND source = ? AND message_id = ? AND kind != \'change\''),
      seen: database.prepare('SELECT 1 FROM core_history WHERE origin = ? AND source = ? AND message_id = ?'),
      latest: database.prepare('SELECT revision, record FROM core_history_latest WHERE source = ? AND family = ? AND id = ?'),
      setLatest: database.prepare(`INSERT INTO core_history_latest VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (source, family, id) DO UPDATE SET revision = excluded.revision, record = excluded.record`),
      refuse: database.prepare('INSERT INTO core_refused (at_ms, source, message_id, message) VALUES (?, ?, ?, ?)'),
      trimRefused: database.prepare('DELETE FROM core_refused WHERE seq <= (SELECT MAX(seq) FROM core_refused) - ?'),
      after: database.prepare(`SELECT seq, at_ms AS atMs, revision, kind, source, message_id AS messageId, type, subject, request_id AS requestId,
        record, origin, origin_seq AS originSeq FROM core_history WHERE origin = ? AND origin_seq > ? ORDER BY origin_seq LIMIT ?`),
    };
  }

  /**
   * The rows of `origin` after its sequence `afterSeq`, oldest first, at most `limit` of them. The reader keeps its own
   * cursor, the last `originSeq` it read; the core stores none. An origin history does not hold returns nothing. Reading
   * writes nothing and publishes nothing.
   */
  after(origin: string, afterSeq: number, limit = MAX_FACTS): FactRow[] {
    if (typeof origin !== 'string' || !Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FACTS) {
      throw new RangeError(`a read after a sequence needs an origin, a sequence of 0 or more and a limit from 1 to ${MAX_FACTS}`);
    }
    const rows = this.#statements.after.all(origin, afterSeq, limit) as (Omit<FactRow, 'record'> & {record: string})[];
    return rows.map(row => ({...row, record: JSON.parse(row.record) as Record<string, unknown>}));
  }

  /** Read committed history only. Inclusive filters combine, optionally selecting the latest rows by seq; returns oldest first and publishes nothing. */
  read(filter: HistoryFilter = {}): HistoryRow[] {
    const where: string[] = [], values: (string | number)[] = [];
    const add = (sql: string, value: string | number | undefined): void => { if (value !== undefined) { where.push(sql); values.push(value); } };
    add('at_ms >= ?', filter.fromAtMs); add('at_ms <= ?', filter.toAtMs); add('kind = ?', filter.kind); add('source = ?', filter.source);
    if (filter.session !== undefined) {
      where.push("(subject = ? OR json_extract(record, '$.data.session') = ? OR json_extract(record, '$.session') = ?)");
      values.push(filter.session, filter.session, filter.session);
    }
    if (filter.limit !== undefined) values.push(filter.limit);
    const rows = this.#database.prepare(`SELECT seq, at_ms AS atMs, revision, kind, source, message_id AS messageId,
      type, subject, request_id AS requestId, record FROM core_history ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY seq${filter.limit === undefined ? '' : ' DESC LIMIT ?'}`).all(...values) as (Omit<HistoryRow, 'record'> & {record: string})[];
    if (filter.limit !== undefined) rows.reverse();
    return rows.map(row => ({...row, record: JSON.parse(row.record) as Record<string, unknown>}));
  }

  /**
   * How history took a removal, occurrence or outcome with this `(source, id)` before, among this origin's rows only:
   * `new`, an exact `duplicate`, or a `conflict`, the same `(source, id)` with other content.
   */
  received(message: Message<unknown>): ReturnType<typeof compareDelivery> {
    const row = this.#statements.stored.get(this.origin, message.source, message.id) as {record: string} | undefined;
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

  /** One row of this origin, at the next place in its order. */
  #insert(atMs: number, revision: number, kind: string, source: string, messageId: string | null, type: string, subject: string,
    requestId: string | null, record: string): void {
    this.#statements.insert.run(atMs, revision, kind, source, messageId, type, subject, requestId, record, this.origin, this.origin);
  }

  #operation(step: OperationStep, atMs: number, revision: number): void {
    this.#insert(atMs, revision, 'operation', step.requestedBy, null, step.command, step.target, step.requestId, JSON.stringify(step));
  }

  #message(message: Message<unknown>, atMs: number, revision: number): void {
    // A message this origin's history already holds, as a crash's resend, adds nothing.
    if (!kept(message) || this.#statements.seen.get(this.origin, message.source, message.id) !== undefined) return;
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
    this.#insert(atMs, revision, message.kind, message.source, message.id, message.type, message.subject,
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
    this.#insert(atMs, revision, 'change', message.source, message.id, message.type, message.subject, null, JSON.stringify(event));
  }
}

/**
 * Creates history's tables and the store's origin, and brings a store written before #1740 up to the fact log: adds
 * `origin` and `origin_seq`, then gives each row without an origin this origin and the next sequence, in `seq` order,
 * which is the order rows were written. Only rows after this origin's last row are looked at, so a store already
 * migrated costs one index lookup. The old `(source, message_id)` index gives way to one per origin. Runs inside the
 * caller's transaction and returns the origin.
 */
function migrate(database: DatabaseSync): string {
  database.exec(`CREATE TABLE IF NOT EXISTS core_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, revision INTEGER NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, message_id TEXT, type TEXT NOT NULL, subject TEXT NOT NULL, request_id TEXT, record TEXT NOT NULL,
      origin TEXT, origin_seq INTEGER) STRICT;
    CREATE INDEX IF NOT EXISTS core_history_request ON core_history (request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS core_history_latest (source TEXT NOT NULL, family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
      record TEXT NOT NULL, PRIMARY KEY (source, family, id)) STRICT;
    CREATE TABLE IF NOT EXISTS core_refused (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, source TEXT NOT NULL, message_id TEXT NOT NULL,
      message TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS core_origin (only INTEGER PRIMARY KEY CHECK (only = 1), origin TEXT NOT NULL) STRICT`);
  database.prepare('INSERT INTO core_origin VALUES (1, ?) ON CONFLICT (only) DO NOTHING').run(randomUUID());
  const {origin} = database.prepare('SELECT origin FROM core_origin WHERE only = 1').get() as {origin: string};
  // A store written before #1740 lacks the columns; they are added as the store's parts add theirs (music-lighting.ts).
  const columns = (database.prepare('PRAGMA table_info(core_history)').all() as {name: string}[]).map(column => column.name);
  if (!columns.includes('origin')) database.exec('ALTER TABLE core_history ADD COLUMN origin TEXT');
  if (!columns.includes('origin_seq')) database.exec('ALTER TABLE core_history ADD COLUMN origin_seq INTEGER');
  // Every row without an origin is this origin's: before #1740 every row was, and a release before it, run again on this
  // store, writes rows without one. They follow this origin's last row.
  const last = database.prepare('SELECT seq, origin_seq AS originSeq FROM core_history WHERE origin = ? ORDER BY origin_seq DESC LIMIT 1').get(origin) as
    {seq: number; originSeq: number} | undefined;
  database.prepare(`UPDATE core_history SET origin = ?, origin_seq = numbered.next
    FROM (SELECT seq, ? + ROW_NUMBER() OVER (ORDER BY seq) AS next FROM core_history WHERE seq > ? AND origin IS NULL) AS numbered
    WHERE core_history.seq = numbered.seq`).run(origin, last?.originSeq ?? 0, last?.seq ?? 0);
  database.exec(`DROP INDEX IF EXISTS core_history_message;
    CREATE UNIQUE INDEX IF NOT EXISTS core_history_origin ON core_history (origin, origin_seq);
    CREATE UNIQUE INDEX IF NOT EXISTS core_history_origin_message ON core_history (origin, source, message_id) WHERE message_id IS NOT NULL`);
  return origin;
}
