// A stand-in for the core in runtime tests (Hub #882, #846), until #831 and #782 replace it. It plays the core's parts
// that the scenario catalog needs:
// - the session owner: it commits each hook's `lifecycle` observation to the session record in its own SQLite file;
// - history and the inbox: it records every outcome as a `stand-in-history` entry, and a failed or uncertain one as an
//   `inbox-item` operation, then acknowledges the outcome with the kit's stand-in acknowledgment;
// - the mode's owner.
// It takes every occurrence and outcome once by (source, id), across restarts. Its changes commit in one transaction
// with what it took and go out through its outbox afterwards, and it serves all four families through sync. Each
// message it takes or drops is logged, so a test in another process can count them.
import {createHash} from 'node:crypto';
import {compareDelivery, type ErrorDetail, type Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId, type InboxItem, type KnownId, type LifecycleObservation, type Mode, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {Outbox, type AddMessage, type BunnyModule, type StateDraft} from '@jimmie-potts/sdk';
import {standInAck} from '@jimmie-potts/sdk/testing';
import {modeState} from './lamp.js';

const BASE = 'https://bunny.invalid/events/';
export const HISTORY_SCHEMA = `${BASE}stand-in-history/2.0`;
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});

/** One outcome the stand-in core recorded, as its `stand-in-history` family carries it until #782's history. */
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

const FAMILIES = {
  session: {type: 'org.bunny.session.updated', dataschema: `${BASE}session/2.0`},
  'inbox-item': {type: 'org.bunny.inbox-item.updated', dataschema: `${BASE}inbox-item/2.0`},
  'stand-in-history': {type: 'org.bunny.stand-in-history.updated', dataschema: HISTORY_SCHEMA},
} as const;
type Family = keyof typeof FAMILIES;
type Entity = {id: string; revision: number};
type Outcome = {requestId: string; result: HistoryEntry['result']; evidence: HistoryEntry['evidence']; error?: ErrorDetail};
const isFamily = (family: string): family is Family => Object.hasOwn(FAMILIES, family);
const draftOf = (family: Family, record: Entity): StateDraft =>
  ({type: FAMILIES[family].type, subject: record.id, dataschema: FAMILIES[family].dataschema, data: record});
/** An entity ID that is also a routing key token, whatever the source and ID it names. */
const keyed = (...parts: string[]): string => createHash('sha256').update(parts.join(' '), 'utf8').digest('hex').slice(0, 32);
const same = (a: KnownId, b: KnownId): boolean => a.status === 'known' && b.status === 'known' && a.id === b.id;

/** The session record after one hook observation, as #831's owner will derive it, kept to what the catalog needs. */
function reduce(prior: SessionRecord | undefined, observation: LifecycleObservation, revision: number): SessionRecord {
  const {event, identity, parent, turn, ordering, observedAtMs} = observation;
  let attention = prior?.attention ?? [];
  if (event.kind === 'attention-approval' || event.kind === 'attention-input') {
    const raised = event.attention;
    attention = [...attention.filter(item => !same(item.id, raised)), {id: raised, kind: event.kind === 'attention-approval' ? 'approval' : 'input', turn}];
  } else if (event.kind === 'attention-resolved') {
    const resolved = event.attention;
    attention = attention.filter(item => !same(item.id, resolved));
  }
  return {
    id: sessionEntityId(identity), revision, generation: prior?.generation ?? revision, identity, parent, turn,
    activity: prior?.activity ?? 'idle', attention, notices: [], read: prior?.read ?? 'unknown', unavailable: [], ordering,
    observedAtMs, lastEvidenceAtMs: observedAtMs, freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0},
  };
}

export type CoreOptions = {
  /** The mode it serves. Defaults to `work`. */
  mode?: Mode;
};

export function createCoreModule({mode = 'work'}: CoreOptions = {}): BunnyModule {
  return {
    manifest: {name: 'core', apiVersion: '1.0'},
    async start({sdk, database, clock, log}) {
      const modeRecord = modeState(mode, clock.now());
      const db = database();
      db.exec(`CREATE TABLE IF NOT EXISTS taken (source TEXT NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (source, id)) STRICT;
        CREATE TABLE IF NOT EXISTS records (family TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (family, id)) STRICT;
        CREATE TABLE IF NOT EXISTS revision (only INTEGER PRIMARY KEY CHECK (only = 1), value INTEGER NOT NULL) STRICT;
        INSERT OR IGNORE INTO revision (only, value) VALUES (1, 1)`);
      const prior = db.prepare('SELECT message FROM taken WHERE source = ? AND id = ?');
      const take = db.prepare('INSERT INTO taken (source, id, message) VALUES (?, ?, ?)');
      const read = db.prepare('SELECT record FROM records WHERE family = ? AND id = ?');
      const write = db.prepare('INSERT INTO records (family, id, record) VALUES (?, ?, ?) ON CONFLICT (family, id) DO UPDATE SET record = excluded.record');
      const records = db.prepare('SELECT family, record FROM records ORDER BY family, id');
      const current = db.prepare('SELECT value FROM revision');
      const bump = db.prepare('UPDATE revision SET value = value + 1 RETURNING value');
      const revision = (): number => (current.get() as {value: number}).value;
      const next = (): number => (bump.get() as {value: number}).value;
      const save = (add: AddMessage, family: Family, record: Entity): void => {
        write.run(family, record.id, JSON.stringify(record));
        add(`bunny.state.${family}.${record.id}`, {kind: 'state', ...draftOf(family, record)});
      };
      const outbox = new Outbox({sdk, database: db, clock});

      // Both register before this start first awaits, and the runtime runs it before the next module's start, so a
      // module that syncs from the core or resends outcomes in its start finds the core ready.
      const served = sdk.serveSync(['mode', ...Object.keys(FAMILIES)], request => {
        const {families} = request.data;
        const states: StateDraft[] = families.includes('mode') ? [modeRecord] : [];
        for (const row of records.all() as {family: string; record: string}[]) {
          if (isFamily(row.family) && families.includes(row.family)) states.push(draftOf(row.family, JSON.parse(row.record) as Entity));
        }
        return {revision: revision(), states};
      });
      const subscribed = sdk.subscribe('bunny.event.*.*', async message => {
        if (message.source === sdk.source) return;
        const row = prior.get(message.source, message.id) as {message: string} | undefined;
        const verdict = compareDelivery(row === undefined ? undefined : JSON.parse(row.message) as Message, message);
        const requestId = (message.data as {requestId?: unknown}).requestId;
        log.info(`core.message.${verdict === 'new' ? 'taken' : verdict}`, {
          source: message.source, id: message.id, kind: message.kind, ...(typeof requestId === 'string' ? {requestId} : {}),
        });
        if (verdict === 'conflict' || (verdict === 'duplicate' && message.kind !== 'outcome')) return;
        await outbox.transaction(add => {
          if (verdict === 'new') {
            take.run(message.source, message.id, JSON.stringify(message));
            if (message.type === 'org.bunny.lifecycle.observed') {
              const observation = message.data as LifecycleObservation;
              const stored = read.get('session', sessionEntityId(observation.identity)) as {record: string} | undefined;
              save(add, 'session', reduce(stored === undefined ? undefined : JSON.parse(stored.record) as SessionRecord, observation, next()));
            }
            if (message.kind === 'outcome') {
              const {requestId: request, result, evidence, error} = message.data as Outcome;
              const command = message.type.replace(/\.completed$/, '.requested');
              const at = next();
              const entry: HistoryEntry = {
                id: keyed(message.source, message.id), revision: at, source: message.source, requestId: request, command, target: message.subject,
                result, evidence, takenAtMs: clock.now(),
              };
              save(add, 'stand-in-history', entry);
              if (result !== 'succeeded') {
                const item: InboxItem = {
                  id: keyed(message.source, request), revision: at, createdAtMs: clock.now(), dismissedBy: [],
                  item: {kind: 'operation', requestId: request, command, target: message.subject, result, evidence, ...(error === undefined ? {} : {error})},
                };
                save(add, 'inbox-item', item);
              }
            }
          }
          // An outcome is acknowledged after it commits, and again for a duplicate, so a lost acknowledgment recovers.
          if (message.kind === 'outcome') {
            const {key, draft} = standInAck(message);
            add(key, draft, {parent: message});
          }
        });
      });
      await Promise.all([served, subscribed]);
      // What a crash kept from going out goes out now.
      await outbox.republish();
    },
    stop: () => {},
  };
}
