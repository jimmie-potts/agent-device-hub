// The core's `operation` family (Hub #922): the latest state of each action the tracker follows (#782), including
// tracked core-local metadata changes, so a display can show it requested, accepted and completed by
// syncing one family. It is a core part (`CorePart`): each record is written and published from the tracker's own
// change, in that change's transaction, and the core serves the family through its sync at its revision. The tracker's
// row stays the authority; a record is its copy, never a command and never sent again. The family keeps the latest
// records only: each tracked change removes the oldest settled records with reason `retired` while the family exceeds
// `MAX_OPERATION_RECORDS`. Pending actions are preserved even above the limit; settlement restores the bound. The inbox (#923)
// points at an operation by its request ID.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {operationEntityId, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {StateDraft} from '@jimmie-potts/sdk';
import {REMOVAL_SCHEMA} from './mapping.js';
import {pending, type Operation} from './operations.js';
import type {CoreTransaction, Deriver} from './store.js';
import type {OperationChange} from './tracker.js';

export const OPERATION_FAMILY = 'operation';
export const OPERATION_SCHEMA = 'https://bunny.invalid/events/operation/2.0';
/** How many operation records the family keeps: enough for every display's recent actions, few enough for one sync. */
export const MAX_OPERATION_RECORDS = 256;

const key = (id: string): string => `bunny.state.${OPERATION_FAMILY}.${id}`;
const draftOf = (record: OperationRecord): StateDraft =>
  ({type: 'org.bunny.operation.updated', subject: record.id, dataschema: OPERATION_SCHEMA, data: record});

/** A tracker row as its `operation` record at `revision`: its identity, status and result, never its command's payload. */
export function operationRecord(operation: Operation, revision: number): OperationRecord {
  const {requestId, kind, family, command, target, requestedBy, status, result, evidence, error, reply, sentAtMs, updatedAtMs, deadlineAtMs} = operation;
  return {
    id: operationEntityId(requestId), revision, requestId, kind, family, command, target, requestedBy, status,
    ...(result === undefined ? {} : {result}), ...(evidence === undefined ? {} : {evidence}), ...(error === undefined ? {} : {error}),
    ...(reply === undefined ? {} : {reply}), sentAtMs, updatedAtMs, deadlineAtMs,
  };
}

type Statements = {save: StatementSync; all: StatementSync; count: StatementSync; oldest: StatementSync; remove: StatementSync};

/** The `operation` family as a core part: its table in the core store, its sync states and its rows from each tracked change. */
export class OperationRecords {
  readonly families = [OPERATION_FAMILY] as const;
  #statements: Statements | undefined;
  readonly #limit: number;
  readonly #publications = new WeakMap<CoreTransaction, Map<string, Parameters<CoreTransaction['add']>>>();

  constructor(limit = MAX_OPERATION_RECORDS) {
    this.#limit = limit;
  }

  /** Creates the table, once the core holds its store. */
  readonly open = (database: DatabaseSync): void => {
    database.exec(`CREATE TABLE IF NOT EXISTS operation_records (
      id TEXT PRIMARY KEY, sent_at_ms INTEGER NOT NULL, pending INTEGER NOT NULL, record TEXT NOT NULL) STRICT`);
    this.#statements = {
      save: database.prepare(`INSERT INTO operation_records VALUES (?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET pending = excluded.pending, record = excluded.record`),
      all: database.prepare('SELECT record FROM operation_records ORDER BY sent_at_ms, id'),
      count: database.prepare('SELECT count(*) AS count FROM operation_records'),
      oldest: database.prepare('SELECT id FROM operation_records WHERE pending = 0 ORDER BY sent_at_ms, id LIMIT ?'),
      remove: database.prepare('DELETE FROM operation_records WHERE id = ?'),
    };
  };

  /** The records a sync of the family serves, oldest first. */
  readonly states = (families: readonly string[]): StateDraft[] => {
    if (!families.includes(OPERATION_FAMILY) || this.#statements === undefined) return [];
    return (this.#statements.all.all() as {record: string}[]).map(row => draftOf(JSON.parse(row.record) as OperationRecord));
  };

  /**
   * Each tracked change writes its record in the transaction and stages publication. The derive hook adds only the
   * final state or removal per entity to the outbox: a live copy ignores a second state at the same revision.
   * The oldest settled records are removed while more than the bound exist. Pending records always stay.
   */
  readonly tracked = ({operation, outcome}: OperationChange, tx: CoreTransaction): void => {
    const statements = this.#statements;
    if (statements === undefined) return;
    const record = operationRecord(operation, tx.revision());
    const parent = outcome ?? {traceparent: operation.traceparent};
    let publications = this.#publications.get(tx);
    if (publications === undefined) {
      publications = new Map();
      this.#publications.set(tx, publications);
    }
    statements.save.run(record.id, record.sentAtMs, pending(operation) ? 1 : 0, JSON.stringify(record));
    publications.set(record.id, [key(record.id), {kind: 'state', ...draftOf(record)}, {parent}]);
    const {count} = statements.count.get() as {count: number};
    if (count <= this.#limit) return;
    for (const {id} of statements.oldest.all(count - this.#limit) as {id: string}[]) {
      statements.remove.run(id);
      publications.set(id, [key(id), {
        kind: 'removal', type: 'org.bunny.operation.removed', subject: id, dataschema: REMOVAL_SCHEMA,
        data: {entity: {family: OPERATION_FAMILY, id}, revision: tx.revision(), reason: 'retired'},
      }, {parent}]);
    }
  };

  /** Publishes the final projection in the same transaction as its rows and the tracker's complete history. */
  readonly derive: Deriver = (_change, tx) => {
    const publications = this.#publications.get(tx);
    if (publications === undefined) return;
    for (const args of publications.values()) tx.add(...args);
    this.#publications.delete(tx);
  };
}
