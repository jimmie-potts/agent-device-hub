// The core as runtime tests and runs host it (Hub #831): the real core, `createCoreModule` from src/core, owning the
// agent sessions, tracking every action it dispatches and taking every outcome, with its real history and outcome
// acknowledgment (#782). Stand-in parts play what other stories own, each until its owner lands, and derive their rows
// from the real tracker's changes through the core's extension point, `CorePart`, in the tracker's own transactions:
// - a readable copy of the tracked actions' results, until #923's history read API: a `stand-in-history` entry for
//   each outcome the tracker took for an action, and for each result an action reached without one (a refusal, an
//   expiry or an uncertain end), so a reader in another process can see what history recorded;
// - the inbox, until #923: a failed or uncertain action as one `inbox-item` operation;
// The core serves their families through its sync, and their changes go out through the core's outbox.
import {createHash} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import type {InboxItem} from '@jimmie-potts/event-contracts/v2/families';
import type {StateDraft} from '@jimmie-potts/sdk';
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreModule, type CoreOptions, type CorePart} from '../../src/index.js';

const BASE = 'https://bunny.invalid/events/';
export const HISTORY_SCHEMA = `${BASE}stand-in-history/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});

/**
 * One result history recorded for a tracked action, as the `stand-in-history` family carries it until #923's history
 * read API: an outcome the tracker took, by its `source`, or a result the action reached without one, by the core.
 */
export type HistoryEntry = {
  id: string; revision: number; source: string; requestId: string; command: string; target: string;
  result: 'succeeded' | 'failed' | 'uncertain'; evidence: 'transmitted' | 'observed' | 'none'; takenAtMs: number;
};

/** The stand-in history's payload schema, by `dataschema`, for validators. */
export const historySchemas: Readonly<Record<string, object>> = {
  [HISTORY_SCHEMA]: {
    type: 'object', additionalProperties: false,
    required: ['id', 'revision', 'source', 'requestId', 'command', 'target', 'result', 'evidence', 'takenAtMs'],
    properties: {
      id: block('id'), revision: block('revision'), source: {type: 'string', pattern: '^bunny(/[a-z0-9][a-z0-9-]*)+$', maxLength: 256},
      requestId: block('requestId'), command: {type: 'string', minLength: 1, maxLength: 256}, target: {type: 'string', minLength: 1, maxLength: 256},
      result: {enum: ['succeeded', 'failed', 'uncertain']}, evidence: {enum: ['transmitted', 'observed', 'none']}, takenAtMs: block('instantMs'),
    },
  },
};

/**
 * The consumers the fixture core records acknowledgments for: the shipped ones, and the scenario catalog's panel, a
 * remote part (`bunny/parts/panel`) that acknowledges for itself.
 */
export const FIXTURE_CONSUMERS = [...DEFAULT_CONSUMERS, {id: 'panel', clearOnNewTurn: false}] as const;

const FAMILIES = {
  'inbox-item': {type: 'org.bunny.inbox-item.updated', dataschema: `${BASE}inbox-item/2.0`},
  'stand-in-history': {type: 'org.bunny.stand-in-history.updated', dataschema: HISTORY_SCHEMA},
} as const;
type Family = keyof typeof FAMILIES;
type Entity = {id: string; revision: number};
const isFamily = (family: string): family is Family => Object.hasOwn(FAMILIES, family);
const draftOf = (family: Family, record: Entity): StateDraft =>
  ({type: FAMILIES[family].type, subject: record.id, dataschema: FAMILIES[family].dataschema, data: record});
/** An entity ID that is also a routing key token, whatever the source and ID it names. */
const keyed = (...parts: string[]): string => createHash('sha256').update(parts.join(' '), 'utf8').digest('hex').slice(0, 32);

/** The remaining stand-in parts: history and inbox operation items, in the core store. */
export function standInParts(): CorePart {
  let statements: {write: StatementSync; records: StatementSync} | undefined;
  return {
    families: Object.keys(FAMILIES),
    open(database: DatabaseSync) {
      database.exec('CREATE TABLE IF NOT EXISTS stand_in_records (family TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (family, id)) STRICT');
      statements = {
        write: database.prepare('INSERT INTO stand_in_records VALUES (?, ?, ?) ON CONFLICT (family, id) DO UPDATE SET record = excluded.record'),
        records: database.prepare('SELECT family, record FROM stand_in_records ORDER BY family, id'),
      };
    },
    states(families) {
      const states: StateDraft[] = [];
      for (const row of (statements?.records.all() ?? []) as {family: string; record: string}[]) {
        if (isFamily(row.family) && families.includes(row.family)) states.push(draftOf(row.family, JSON.parse(row.record) as Entity));
      }
      return states;
    },
    tracked({operation, previous, outcome}, tx) {
      const save = (family: Family, record: Entity): void => {
        statements?.write.run(family, record.id, JSON.stringify(record));
        tx.add(`bunny.state.${family}.${record.id}`, {kind: 'state', ...draftOf(family, record)});
      };
      const {requestId, command, target, result} = operation;
      const revision = tx.revision();
      const entry = (source: string, id: string, settled: HistoryEntry['result'], evidence: HistoryEntry['evidence']): void => {
        const record: HistoryEntry = {id: keyed(source, id), revision, source, requestId, command, target, result: settled, evidence, takenAtMs: tx.atMs};
        save('stand-in-history', record);
      };
      if (outcome !== undefined) entry(outcome.source, outcome.id, outcome.data.result, outcome.data.evidence);
      else if (result !== undefined && result !== 'conflict' && result !== previous?.result) entry('bunny/core', `${requestId}.${operation.status}`, result, operation.evidence ?? 'none');
      // One inbox item per failed or uncertain action. A later result never removes it: a person handles it (#923).
      if (result === 'failed' || result === 'uncertain') {
        const {evidence, error} = operation;
        const item: InboxItem = {
          id: keyed('operation', requestId), revision, createdAtMs: tx.atMs, dismissedBy: [],
          item: {kind: 'operation', requestId, command, target, result, ...(evidence === undefined ? {} : {evidence}), ...(error === undefined ? {} : {error})},
        };
        save('inbox-item', item);
      }
    },
  };
}

export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish'>;

/** The real core with the stand-in parts and the fixture consumers. */
export function createCoreModule({beforePublish}: FixtureCoreOptions = {}): CoreModule {
  return createRealCore({parts: [standInParts()], consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish})});
}
