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
//
// History keeps changes, and repeated readings as spans (#1772, ADR 0012's amendment of 2026-11-12). A state whose
// record holds the same state as the record of its entity's last row, as `sameState` decides with the family's
// bookkeeping members (#1771), is a confirmation: it writes no row and updates the entity's open span in
// `core_history_span`, beside the log. A state that differs writes a change row against the last row's record, with
// the span it closes. For a family a module publishes on a poll, a confirmation after a silence longer than the gap
// writes one gap row. The span table is never part of the log: `after` reads rows only, and rows are never updated.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {compareDelivery, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {bookkeeping as contractBookkeeping, sameState, type Bookkeeping} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import {OUTCOME_RECORDED_TYPE} from '@jimmie-potts/sdk';
import type {ActionKind, Evidence, OperationResult, OperationStatus} from './operations.js';

/** What a history row records. */
export type HistoryKind = 'change' | 'removal' | 'occurrence' | 'outcome' | 'operation';

/**
 * A stretch of readings of one entity that held the same state: from the reading that wrote its row, or from an
 * unknown start (`sinceAtMs` null) when a release without spans wrote the entity's rows before it, to its last
 * confirmation, with the number of readings history took in it.
 */
export type HistorySpan = {sinceAtMs: number | null; lastConfirmedAtMs: number; confirmations: number};

/**
 * A compact change event: one state message as what changed since the record of its entity's last row. `previous` is
 * that record's revision, or null when history held none, as for a new entity, whose every member is then `changed`.
 * `changed` holds each top-level member whose value differs, with its new value, bookkeeping values included, and
 * `removed` each member the new record no longer has. The entity's `id` and `revision` are not members here.
 *
 * `span` is the stretch of confirmations the row closes, when history took more readings in it than the row that
 * opened it. `gapMs` marks a gap row: a confirmation of a polled family that came this long after the last one.
 * `closedBy: 'removal'` marks the row that closes an open span just before its entity's removal row; it changes no
 * member, and its `revision` is the last row's, equal to `previous`.
 */
export type ChangeEvent = {family: string; id: string; revision: number; previous: number | null; changed: Record<string, unknown>; removed: string[];
  span?: HistorySpan; gapMs?: number; closedBy?: 'removal'};

/**
 * What history needs to know of the families it keeps: each family's bookkeeping members (#1771), and, by source, the
 * families that source publishes on a poll with their polling interval in milliseconds (#1772).
 */
export type HistoryRules = {readonly bookkeeping: Bookkeeping; readonly polling: Readonly<Record<string, Readonly<Record<string, number>>>>};

/** The contracts package's bookkeeping members and no polled family: the core's own families publish on events. */
export const DEFAULT_HISTORY_RULES: HistoryRules = Object.freeze({bookkeeping: contractBookkeeping, polling: Object.freeze({})});
/** The shortest silence that makes a gap, whatever the polling interval (#1768, decision 4). */
export const MIN_GAP_MS = 120_000;
/** A gap is a silence longer than this many polling intervals (#1768, decision 4). */
export const GAP_INTERVALS = 4;

/** The silence after which a confirmation of `family` from `source` writes a gap row, or undefined when it has no gap rule. */
export function gapOf(rules: HistoryRules, source: string, family: string): number | undefined {
  const polled = Object.hasOwn(rules.polling, source) ? rules.polling[source] : undefined;
  const interval = polled !== undefined && Object.hasOwn(polled, family) ? polled[family] : undefined;
  return interval === undefined ? undefined : Math.max(MIN_GAP_MS, GAP_INTERVALS * interval);
}

/** An entity's open span as `core_history_span` holds it. */
type SpanRow = {rowRevision: number | null; seenRevision: number; seenMessageId: string; seenType: string; sinceAtMs: number | null; confirmedAtMs: number | null;
  confirmations: number};

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
  readonly #rules: HistoryRules;
  readonly #statements: {
    insert: StatementSync; stored: StatementSync; seen: StatementSync; latest: StatementSync; setLatest: StatementSync;
    refuse: StatementSync; trimRefused: StatementSync; after: StatementSync; span: StatementSync; setSpan: StatementSync; dropSpan: StatementSync;
  };

  /** This installation's origin: a random UUID, created once and kept in the core store. */
  readonly origin: string;

  /**
   * Opens history on the core store's database, in one transaction: creates its tables on a new store, creates the
   * store's origin once, and gives every row that has none, as every row of a store written before #1740 has none, this
   * origin and the next sequence in the order the rows were written. A store already in that state changes nothing.
   * `rules` names each family's bookkeeping members and the polled families; by default, the contracts package's
   * members and no polled family.
   */
  constructor(database: DatabaseSync, rules: HistoryRules = DEFAULT_HISTORY_RULES) {
    this.#database = database;
    this.#rules = rules;
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
      span: database.prepare(`SELECT row_revision AS rowRevision, seen_revision AS seenRevision, seen_message_id AS seenMessageId, seen_type AS seenType, since_at_ms AS sinceAtMs,
        confirmed_at_ms AS confirmedAtMs, confirmations FROM core_history_span WHERE source = ? AND family = ? AND id = ?`),
      setSpan: database.prepare(`INSERT INTO core_history_span (source, family, id, row_revision, seen_revision, seen_message_id, seen_type, since_at_ms, confirmed_at_ms,
        confirmations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (source, family, id) DO UPDATE SET row_revision = excluded.row_revision,
        seen_revision = excluded.seen_revision,
        seen_message_id = excluded.seen_message_id, seen_type = excluded.seen_type, since_at_ms = excluded.since_at_ms, confirmed_at_ms = excluded.confirmed_at_ms,
        confirmations = excluded.confirmations`),
      dropSpan: database.prepare('DELETE FROM core_history_span WHERE source = ? AND family = ? AND id = ?'),
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
      // brings nothing back, and a new entity under the same ID starts afresh. An open span is closed by a row first.
      const {entity, revision: removedAt} = message.data as {entity?: {family?: unknown; id?: unknown}; revision?: unknown};
      if (typeof entity?.family === 'string' && typeof entity.id === 'string') {
        this.#closeBeforeRemoval(message, entity.family, entity.id, atMs, revision);
        this.#statements.setLatest.run(message.source, entity.family, entity.id, typeof removedAt === 'number' ? removedAt : 0, 'null');
        this.#statements.dropSpan.run(message.source, entity.family, entity.id);
      }
    }
    const {requestId} = message.data as {requestId?: unknown};
    this.#insert(atMs, revision, message.kind, message.source, message.id, message.type, message.subject,
      message.kind === 'outcome' && typeof requestId === 'string' ? requestId : null, JSON.stringify(message));
  }

  /** The record of the entity's last row and its revision, null for a tombstone, or undefined when history holds none. */
  #latest(source: string, family: string, id: string): {revision: number; record: Record<string, unknown> | null} | undefined {
    const row = this.#statements.latest.get(source, family, id) as {revision: number; record: string} | undefined;
    return row === undefined ? undefined : {revision: row.revision, record: JSON.parse(row.record) as Record<string, unknown> | null};
  }

  /**
   * The entity's open span, given the revision of its last row: the stored one while it was written against that row,
   * or, when a release without spans wrote `core_history_latest` since, as a previous release run on this store does,
   * a span reset to an unknown start with no confirmation yet. The span row keeps the revision of the entity's last row
   * it was written against (`row_revision`); this release moves `core_history_latest` only with the span, so a
   * different revision there means another release took a reading of the entity at a revision other than the span's row.
   */
  #span(source: string, family: string, id: string, lastRow: number): SpanRow {
    const stored = this.#statements.span.get(source, family, id) as SpanRow | undefined;
    if (stored !== undefined && stored.rowRevision === lastRow && stored.seenRevision >= lastRow) return stored;
    return {rowRevision: lastRow, seenRevision: lastRow, seenMessageId: '', seenType: '', sinceAtMs: null, confirmedAtMs: null, confirmations: 0};
  }

  /** The stretch a row closes, when history took more readings in it than the row that opened it, or undefined. */
  static #closes(span: SpanRow): HistorySpan | undefined {
    if (span.confirmedAtMs === null || span.confirmations <= (span.sinceAtMs === null ? 0 : 1)) return undefined;
    return {sinceAtMs: span.sinceAtMs, lastConfirmedAtMs: span.confirmedAtMs, confirmations: span.confirmations};
  }

  /**
   * Before a removal: when its entity's open span holds confirmations beyond its own row, one change row closes it. The
   * row changes no member, so it claims nothing newer than its values: it carries the last row's revision (equal to
   * `previous`) and no message ID, the last confirmation's type, and the confirmation's instant and count in `span`.
   */
  #closeBeforeRemoval(removal: Message<unknown>, family: string, id: string, atMs: number, revision: number): void {
    const latest = this.#latest(removal.source, family, id);
    if (latest === undefined || latest.record === null) return;
    const span = this.#span(removal.source, family, id, latest.revision);
    const closes = History.#closes(span);
    if (closes === undefined) return;
    const event: ChangeEvent = {family, id, revision: latest.revision, previous: latest.revision, changed: {}, removed: [], span: closes, closedBy: 'removal'};
    this.#insert(atMs, revision, 'change', removal.source, null, span.seenType, removal.subject, null, JSON.stringify(event));
  }

  /**
   * A state message against the record of its entity's last row: nothing when it is stale, out of order or a resend of
   * the last confirmation; a confirmation of the open span when it holds the same state; a gap row when that
   * confirmation of a polled family comes after a silence longer than the gap; and otherwise a change row.
   */
  #change(message: Message<unknown>, atMs: number, revision: number): void {
    const family = familyOf(message.dataschema);
    const record = message.data as Record<string, unknown> | null;
    if (family === undefined || typeof record !== 'object' || record === null || Array.isArray(record)) return;
    const id = typeof record.id === 'string' ? record.id : message.subject;
    const entityRevision = typeof record.revision === 'number' ? record.revision : 0;
    const latest = this.#latest(message.source, family, id);
    // A state older than the record of the entity's last row, or at or below the revision that removed its entity, is stale.
    if (latest !== undefined && (entityRevision < latest.revision || (latest.record === null && entityRevision <= latest.revision))) return;
    const held = latest?.record ?? null;
    const span = latest === undefined || held === null ? undefined : this.#span(message.source, family, id, latest.revision);
    // Older than the last confirmation: nothing new.
    if (span !== undefined && span.confirmedAtMs !== null && entityRevision < span.seenRevision) return;
    const same = held !== null && span !== undefined && sameState(held, record, this.#rules.bookkeeping[family] ?? []);
    // That confirmation sent again: nothing new. A message under its ID whose state differs is not a resend, and is a change.
    if (same && span?.confirmedAtMs !== null && message.id === span?.seenMessageId) return;
    if (same && span !== undefined) {
      const gap = gapOf(this.#rules, message.source, family);
      // Each confirmation keeps its own instant, and a negative silence, after the clock stepped back, is no gap. So an
      // outage after a backward step still shows; a clock that steps back and then forward by more than the gap writes
      // one gap row for a silence that did not happen (review of PR #1790: keeping the later instant hid real outages).
      const silence = span.confirmedAtMs === null ? undefined : atMs - span.confirmedAtMs;
      if (gap === undefined || silence === undefined || silence <= gap) {
        this.#statements.setSpan.run(message.source, family, id, span.rowRevision, entityRevision, message.id, message.type, span.sinceAtMs, atMs,
          span.confirmations + 1);
        return;
      }
      this.#row(message, family, id, record, latest, span, atMs, revision, silence);
      return;
    }
    this.#row(message, family, id, record, latest, span, atMs, revision);
  }

  /**
   * One change row for `record` against the record of the entity's last row, carrying the span it closes and, for a
   * gap row, the silence; the record becomes the last row's, and a new span opens with this reading.
   */
  #row(message: Message<unknown>, family: string, id: string, record: Record<string, unknown>, latest: {revision: number; record: Record<string, unknown> | null} | undefined,
    span: SpanRow | undefined, atMs: number, revision: number, gapMs?: number): void {
    const entityRevision = typeof record.revision === 'number' ? record.revision : 0;
    const held = latest?.record ?? null;
    const before = held ?? {};
    const members = (value: Record<string, unknown>): string[] => Object.keys(value).filter(name => name !== 'id' && name !== 'revision');
    const changed: Record<string, unknown> = {};
    for (const name of members(record)) if (JSON.stringify(record[name]) !== JSON.stringify(before[name])) changed[name] = record[name];
    const removed = members(before).filter(name => !Object.hasOwn(record, name));
    this.#statements.setLatest.run(message.source, family, id, entityRevision, JSON.stringify(record));
    this.#statements.setSpan.run(message.source, family, id, entityRevision, entityRevision, message.id, message.type, atMs, atMs, 1);
    if (Object.keys(changed).length === 0 && removed.length === 0 && gapMs === undefined) return;
    const closes = span === undefined ? undefined : History.#closes(span);
    const event: ChangeEvent = {family, id, revision: entityRevision, previous: held === null ? null : latest?.revision ?? null, changed, removed,
      ...(closes === undefined ? {} : {span: closes}), ...(gapMs === undefined ? {} : {gapMs})};
    this.#insert(atMs, revision, 'change', message.source, message.id, message.type, message.subject, null, JSON.stringify(event));
  }
}

/**
 * Creates history's tables and the store's origin, and brings a store written before #1740 up to the fact log: adds
 * `origin` and `origin_seq`, then gives each row without an origin this origin and the next sequence, in `seq` order,
 * which is the order rows were written. Only rows after this origin's last row are looked at, so a store already
 * migrated costs one index lookup. The old `(source, message_id)` index gives way to one per origin. The span table
 * (#1772) is created empty when missing: it adds no column to another table and reads no row. Runs inside the caller's
 * transaction and returns the origin.
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
    CREATE TABLE IF NOT EXISTS core_origin (only INTEGER PRIMARY KEY CHECK (only = 1), origin TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS core_history_span (source TEXT NOT NULL, family TEXT NOT NULL, id TEXT NOT NULL, row_revision INTEGER, seen_revision INTEGER NOT NULL,
      seen_message_id TEXT NOT NULL, seen_type TEXT NOT NULL, since_at_ms INTEGER, confirmed_at_ms INTEGER NOT NULL, confirmations INTEGER NOT NULL,
      PRIMARY KEY (source, family, id)) STRICT`);
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
