// The core as runtime tests and runs host it (Hub #831): the real core, `createCoreModule` from src/core, owning the
// agent sessions, with stand-in parts for what other stories own, each until its owner lands:
// - history, until #782: it records every outcome as a `stand-in-history` entry, then acknowledges the outcome with the
//   kit's stand-in acknowledgment;
// - the inbox, until #923: it records a failed or uncertain outcome as an `inbox-item` operation;
// - the mode's owner, until #695.
// The parts join through the core's extension point, `CorePart`: they take every occurrence and outcome other than a
// hook's lifecycle observation once by (source, id), across restarts, in the core store's transactions, and go out
// through the core's outbox. The core serves their families through its sync. Each message they take or drop is logged,
// so a test in another process can count them.
import {createHash} from 'node:crypto';
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {InboxItem, Mode} from '@jimmie-potts/event-contracts/v2/families';
import type {BunnyModule, StateDraft} from '@jimmie-potts/sdk';
import {standInAck} from '@jimmie-potts/sdk/testing';
import {DEFAULT_CONSUMERS, createCoreModule as createRealCore, type CoreOptions, type CorePart} from '../../src/index.js';
import {modeState} from './lamp.js';

const BASE = 'https://bunny.invalid/events/';
export const HISTORY_SCHEMA = `${BASE}stand-in-history/2.0`;
const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});

/** One outcome the stand-in history recorded, as its `stand-in-history` family carries it until #782's history. */
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
type Outcome = {requestId: string; result: HistoryEntry['result']; evidence: HistoryEntry['evidence']; error?: ErrorDetail};
const isFamily = (family: string): family is Family => Object.hasOwn(FAMILIES, family);
/** How the core took a message, as its `message.received` record's outcome: once, as a duplicate, or not, as a conflict. */
const TAKEN = {new: 'accepted', duplicate: 'duplicate', conflict: 'rejected'} as const;
const draftOf = (family: Family, record: Entity): StateDraft =>
  ({type: FAMILIES[family].type, subject: record.id, dataschema: FAMILIES[family].dataschema, data: record});
/** An entity ID that is also a routing key token, whatever the source and ID it names. */
const keyed = (...parts: string[]): string => createHash('sha256').update(parts.join(' '), 'utf8').digest('hex').slice(0, 32);

/** The stand-in parts: history, the inbox's operation items and the mode, in the core store. */
export function standInParts(mode: Mode = 'work'): CorePart {
  let statements: {write: StatementSync; records: StatementSync} | undefined;
  // The mode never changes here, so its record carries revision 0, which every sync's revision covers.
  const draft = modeState(mode);
  const modeRecord: StateDraft = {...draft, data: {...draft.data, revision: 0}};
  return {
    families: ['mode', ...Object.keys(FAMILIES)],
    open(database: DatabaseSync) {
      database.exec('CREATE TABLE IF NOT EXISTS stand_in_records (family TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (family, id)) STRICT');
      statements = {
        write: database.prepare('INSERT INTO stand_in_records VALUES (?, ?, ?) ON CONFLICT (family, id) DO UPDATE SET record = excluded.record'),
        records: database.prepare('SELECT family, record FROM stand_in_records ORDER BY family, id'),
      };
    },
    states(families) {
      const states: StateDraft[] = families.includes('mode') ? [modeRecord] : [];
      for (const row of (statements?.records.all() ?? []) as {family: string; record: string}[]) {
        if (isFamily(row.family) && families.includes(row.family)) states.push(draftOf(row.family, JSON.parse(row.record) as Entity));
      }
      return states;
    },
    start(core) {
      return core.sdk.subscribe('bunny.event.*.*', async message => {
        // The core itself takes the hooks' lifecycle observations.
        if (message.source === core.sdk.source || message.type === LIFECYCLE_TYPE) return;
        await core.ready;
        const verdict = core.received(message);
        const requestId = (message.data as {requestId?: unknown}).requestId;
        core.log.info('message.received', {
          'bunny.participant': message.source, 'bunny.message.id': message.id, 'bunny.message.kind': message.kind, 'bunny.outcome': TAKEN[verdict],
          // A conflict is `duplicate-conflict` in the registry; its registered reason is `duplicate`, as in the edge's records.
          ...(verdict === 'conflict' ? {'bunny.reason': 'duplicate'} : {}), ...(typeof requestId === 'string' ? {'bunny.request.id': requestId} : {}),
        });
        if (verdict === 'conflict' || (verdict === 'duplicate' && message.kind !== 'outcome')) return;
        await core.transaction(tx => {
          const save = (family: Family, record: Entity): void => {
            statements?.write.run(family, record.id, JSON.stringify(record));
            tx.add(`bunny.state.${family}.${record.id}`, {kind: 'state', ...draftOf(family, record)});
          };
          if (verdict === 'new') {
            tx.take(message);
            if (message.kind === 'outcome') {
              const {requestId: request, result, evidence, error} = message.data as Outcome;
              const command = message.type.replace(/\.completed$/, '.requested');
              const revision = tx.revision();
              const entry: HistoryEntry = {
                id: keyed(message.source, message.id), revision, source: message.source, requestId: request, command, target: message.subject,
                result, evidence, takenAtMs: tx.atMs,
              };
              save('stand-in-history', entry);
              if (result !== 'succeeded') {
                const item: InboxItem = {
                  id: keyed(message.source, request), revision, createdAtMs: tx.atMs, dismissedBy: [],
                  item: {kind: 'operation', requestId: request, command, target: message.subject, result, evidence, ...(error === undefined ? {} : {error})},
                };
                save('inbox-item', item);
              }
            }
          }
          // An outcome is acknowledged after it commits, and again for a duplicate, so a lost acknowledgment recovers.
          if (message.kind === 'outcome') {
            const {key, draft: ack} = standInAck(message);
            tx.add(key, ack, {parent: message});
          }
        });
      });
    },
  };
}

export type FixtureCoreOptions = Pick<CoreOptions, 'beforePublish'> & {
  /** The mode the stand-in serves. Defaults to `work`. */
  mode?: Mode;
};

/** The real core with the stand-in parts and the fixture consumers. */
export function createCoreModule({mode = 'work', beforePublish}: FixtureCoreOptions = {}): BunnyModule {
  return createRealCore({parts: [standInParts(mode)], consumers: FIXTURE_CONSUMERS, ...(beforePublish === undefined ? {} : {beforePublish})});
}
