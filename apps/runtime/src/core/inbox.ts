// Shared operation inbox (Hub #923), owned by the core store. Handling never changes device state or releases a hold.
import {randomUUID} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {MessageValidator, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {operationEntityId, registerCoreFamilies, type InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import {fullDisk, type Command, type Reply, type StateDraft} from '@jimmie-potts/sdk';
import type {CoreHandle} from './core.js';
import {REMOVAL_SCHEMA} from './mapping.js';
import type {CoreTransaction, Deriver} from './store.js';
import {OPERATOR_ACTIONS, type Action, type ActionAnswer, type OperationChange} from './tracker.js';

export const INBOX_SCHEMA = 'https://bunny.invalid/events/inbox-item/2.1';
export type InboxHandleRequest = {requestId: string; expectedRevision: number; action: 'dismiss' | 'send-again'};
const draftOf = (record: InboxItem): StateDraft => ({type: 'org.bunny.inbox-item.updated', subject: record.id, dataschema: INBOX_SCHEMA, data: record});
type Row = {record: string; handled_by: string | null};
type Statements = {all: StatementSync; get: StatementSync; save: StatementSync; handle: StatementSync};
/** Private core capability: the callback participates only in a new dispatch's initial sent transaction. */
type Resend = (action: Action, handle: (tx: CoreTransaction) => ErrorBody | undefined) => Promise<ActionAnswer>;

export class InboxRecords {
  readonly families = ['inbox-item'];
  #statements: Statements | undefined;
  readonly #resend: Resend;
  readonly #publications = new WeakMap<CoreTransaction, Map<string, InboxItem>>();
  readonly #validator = new MessageValidator();
  constructor(resend: Resend) { this.#resend = resend; registerCoreFamilies(this.#validator); }
  readonly open = (database: DatabaseSync): void => {
    database.exec(`CREATE TABLE IF NOT EXISTS inbox_records (id TEXT PRIMARY KEY, record TEXT NOT NULL,
      handled_by TEXT, handled_at_ms INTEGER, removal_revision INTEGER) STRICT`);
    this.#statements = {
      all: database.prepare('SELECT record FROM inbox_records WHERE handled_by IS NULL ORDER BY id'),
      get: database.prepare('SELECT record, handled_by FROM inbox_records WHERE id = ?'),
      save: database.prepare(`INSERT INTO inbox_records (id, record) VALUES (?, ?) ON CONFLICT(id)
        DO UPDATE SET record = excluded.record, handled_by = NULL, handled_at_ms = NULL, removal_revision = NULL`),
      handle: database.prepare('UPDATE inbox_records SET handled_by = ?, handled_at_ms = ?, removal_revision = ? WHERE id = ?'),
    };
  };
  records(): InboxItem[] { return (this.#statements?.all.all() as {record: string}[] | undefined ?? []).map(row => JSON.parse(row.record) as InboxItem); }
  readonly states = (families: readonly string[]): StateDraft[] => families.includes('inbox-item') ? this.records().map(draftOf) : [];
  readonly tracked = ({operation, previous: priorOperation}: OperationChange, tx: CoreTransaction): void => {
    if (OPERATOR_ACTIONS.includes(operation.family)) return;
    const {result, requestId, command, target, evidence, error} = operation;
    if (result === undefined) return;
    const id = operationEntityId(requestId), row = this.#statements?.get.get(id) as Row | undefined;
    if (row !== undefined && row.handled_by !== null && (result !== 'conflict' || priorOperation?.result === 'conflict')) return;
    if (row === undefined && result === 'succeeded') return;
    const previous = row === undefined ? undefined : JSON.parse(row.record) as InboxItem;
    // Keep two opposite definitive pieces of evidence, bounded regardless of how many later outcomes were retained.
    const definitive = ['succeeded', 'failed'].map(value => operation.outcomes.find(item => item.result === value)).filter(item => item !== undefined);
    const record: InboxItem = {
      id, revision: tx.revision(), createdAtMs: previous?.createdAtMs ?? tx.atMs, dismissedBy: previous?.dismissedBy ?? [],
      item: {kind: 'operation', requestId, command, target, result,
        ...(evidence === undefined ? {} : {evidence}), ...(error === undefined ? {} : {error}),
        ...(result !== 'conflict' ? {} : {outcomes: definitive as NonNullable<InboxItem['item']['outcomes']>})},
    };
    this.#statements?.save.run(id, JSON.stringify(record));
    let publications = this.#publications.get(tx);
    if (publications === undefined) { publications = new Map(); this.#publications.set(tx, publications); }
    publications.set(id, record);

  };
  readonly derive: Deriver = (_change, tx) => {
    for (const record of this.#publications.get(tx)?.values() ?? []) {
      const operation = tx.database.prepare('SELECT record FROM core_operations WHERE request_id = ?').get(record.item.requestId) as {record: string};
      const parent = JSON.parse(operation.record) as {traceparent: string};
      tx.add(`bunny.state.inbox-item.${record.id}`, {kind: 'state', ...draftOf(record)}, {parent});
    }
    this.#publications.delete(tx);
  };
  #handle(command: Command<InboxHandleRequest>, tx: CoreTransaction): ErrorBody | undefined {
    const row = this.#statements?.get.get(command.subject) as Row | undefined;
    if (row === undefined) return errorBody('not-found', {detail: 'no such inbox item'});
    if (row.handled_by !== null) return errorBody('invalid-state', {detail: 'the inbox item was already handled'});
    const record = JSON.parse(row.record) as InboxItem;
    if (record.revision !== command.data.expectedRevision) return errorBody('revision-conflict', {detail: 'the inbox item changed since it was read'});
    this.#statements?.handle.run(command.source, tx.atMs, tx.revision(), command.subject);
    tx.add(`bunny.state.inbox-item.${record.id}`, {kind: 'removal', type: 'org.bunny.inbox-item.removed', subject: record.id,
      dataschema: REMOVAL_SCHEMA, data: {entity: {family: 'inbox-item', id: record.id}, revision: tx.revision(), reason: 'deleted'}}, {parent: command});
    return undefined;
  }
  readonly start = async (core: CoreHandle): Promise<void> => {
    await core.sdk.respond<InboxHandleRequest>('bunny.cmd.inbox-handle.*', async command => {
      await core.ready;
      const checked = this.#validator.validate(command);
      if (!checked.ok) return errorBody('invalid-request', {detail: 'the inbox handling command is invalid'});
      try {
        if (command.data.action === 'dismiss') {
          const refused = await core.transaction(tx => this.#handle(command, tx));
          return refused ?? {status: 'accepted'};
        }
        const row = this.#statements?.get.get(command.subject) as Row | undefined;
        if (row === undefined) return errorBody('not-found', {detail: 'no such inbox item'});
        const record = JSON.parse(row.record) as InboxItem, operation = core.operation(record.item.requestId);
        if (operation === undefined) return errorBody('not-found', {detail: 'the inbox operation is unavailable'});
        if (operation.payload?.status === 'omitted') return errorBody('unsupported-capability', {
          detail: 'this input was not retained; enter fresh text as a new request',
        });
        const answer = await this.#resend({key: operation.key,
          draft: {type: operation.command, subject: operation.target, dataschema: operation.dataschema, data: operation.data},
          requestedBy: command.source, requestId: randomUUID(), parent: command}, tx => this.#handle(command, tx));
        return 'error' in answer ? answer : {status: 'accepted'} satisfies Reply;
      } catch (error) {
        return errorBody(fullDisk(error) ? 'capacity' : 'internal', {detail: 'the core could not commit inbox handling'});
      }
    });
  };
}
