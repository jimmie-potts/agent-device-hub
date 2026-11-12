// History keeps changes and records repeated readings as spans (#1772, design #1768): a reading whose only differences
// are declared bookkeeping members writes no row and updates its entity's open span; a change writes one row with the
// span it closes; a polled family that falls silent for longer than the gap gets one gap row when readings resume; a
// removal closes an open span first. Also the polling declaration's checks at start, the previous release's writes on a
// store this release migrated, and the readers that rows feed. Synthetic stores only, in memory or in a temporary
// directory; every instant is given explicitly or comes from the store's manual clock, and nothing waits on real time.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {bookkeeping, familyOfSchema, leafMutations} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import {openModuleDatabaseFile, type ModuleRegistration} from '@jimmie-potts/sdk';
import {DEFAULT_HISTORY_RULES, History, MIN_GAP_MS, gapOf, type ChangeEvent, type HistoryRules} from '../src/core/history.js';
import {MAX_POLLING_MS, historyRules, modulePolling, registrations, shippedList} from '../src/index.js';
import {World} from './fixtures/store-world.js';
import {RECORDS} from './fixtures/module-state-records.js';
import {POLLING} from './fixtures/polling-classification.js';
import {it, stateDir} from './support.js';

const WEMO = 'bunny/modules/wemo';
const T0 = 1_800_000_000_000;
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
let next = 0;

/** A state message as a module publishes it. */
function state(data: Record<string, unknown>, options: {source?: string; dataschema?: string; type?: string; id?: string} = {}): Message<unknown> {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id: options.id ?? `state-${++next}`, source: options.source ?? WEMO, type: options.type ?? 'org.bunny.device.updated',
    subject: typeof data.id === 'string' ? data.id : 'entity', time: new Date(T0).toISOString(), kind: 'state', datacontenttype: 'application/json',
    dataschema: options.dataschema ?? `${SCHEMA_BASE}device/2.4`, traceparent: TRACE, data,
  };
}

/** A Wemo plug's device record at `revision`, read at `atMs`, with its power. */
const plug = (revision: number, atMs: number, power = true): Record<string, unknown> => ({
  id: 'desk-lamp', revision, kind: 'wemo', availability: 'available', configurationRevision: 1, generation: {epoch: 'wemo', sequence: 1},
  desired: {power: {status: 'known', value: power}, brightness: {status: 'unknown'}, mode: {status: 'unknown'}},
  observed: {status: 'known', observedAtMs: atMs, power: {status: 'known', value: power}, brightness: {status: 'unknown'}},
  pending: 0, pendingKinds: [], lastOutcome: {status: 'unknown'}, lastTransmission: {status: 'unknown'}, externalControl: {status: 'unknown'},
});

const removal = (family: string, id: string, revision: number, source = WEMO): Message<unknown> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `removal-${++next}`, source, type: `org.bunny.${family}.removed`, subject: id, time: new Date(T0).toISOString(),
  kind: 'removal', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}removal/2.0`, traceparent: TRACE, data: {entity: {family, id}, revision},
});

/** The rules the shipped list gives history, with Wemo's 5 s poll. */
const RULES: HistoryRules = {bookkeeping, polling: {[WEMO]: {device: 5000}, 'bunny/modules/roborock': {device: 60_000}}};

type Row = {seq: number; atMs: number; kind: string; messageId: string | null; type: string; record: ChangeEvent & Record<string, unknown>};
const rowsOf = (history: History): Row[] => history.read().map(row => ({seq: row.seq, atMs: row.atMs, kind: row.kind, messageId: row.messageId, type: row.type,
  record: row.record as ChangeEvent & Record<string, unknown>}));
const spanOf = (database: DatabaseSync, id = 'desk-lamp', source = WEMO): Record<string, unknown> | undefined => {
  const row = database.prepare('SELECT * FROM core_history_span WHERE source = ? AND id = ?').get(source, id);
  return row === undefined ? undefined : {...row};
};
const count = (database: DatabaseSync, table: string): number => (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n: number}).n;

/** History on a new in-memory store, and a writer that takes one message at a time at its own instant. */
function open(context: {after: (fn: () => void) => void}, rules: HistoryRules = RULES): {database: DatabaseSync; history: History; take: (message: Message<unknown>, atMs: number) => void} {
  const database = new DatabaseSync(':memory:');
  context.after(() => { if (database.isOpen) database.close(); });
  const history = new History(database, rules);
  let revision = 0;
  return {database, history, take: (message, atMs) => { history.write([{kind: 'message', message}], atMs, ++revision); }};
}

it('repeated Wemo readings write one row, and the span counts them with their last confirmation', context => {
  const {database, history, take} = open(context);
  const first = state(plug(1, T0));
  take(first, T0);
  for (let index = 1; index < 10; index++) take(state(plug(1 + index, T0 + 5000 * index)), T0 + 5000 * index);
  const rows = rowsOf(history);
  assert.equal(rows.length, 1, 'only the first reading wrote a row');
  assert.equal(rows[0]?.messageId, first.id);
  assert.equal(rows[0]?.record.span, undefined, 'a first row closes no span');
  const span = spanOf(database);
  assert.equal(span?.since_at_ms, T0);
  assert.equal(span?.confirmed_at_ms, T0 + 45_000);
  assert.equal(span?.confirmations, 10, 'the row\'s own reading and nine confirmations');
  assert.equal(span?.seen_revision, 10);
  assert.equal(span?.seen_type, 'org.bunny.device.updated');
  assert.deepEqual({...database.prepare('SELECT revision FROM core_history_latest').get()}, {revision: 1}, 'the latest table holds the record of the last row');
});

it('a power change writes one row with every member that differs from the last row, the moved reading time included, and the span it closes', context => {
  const {database, history, take} = open(context);
  take(state(plug(1, T0)), T0);
  for (let index = 1; index < 10; index++) take(state(plug(1 + index, T0 + 5000 * index)), T0 + 5000 * index);
  const off = state(plug(11, T0 + 50_000, false));
  take(off, T0 + 50_000);
  const rows = rowsOf(history);
  assert.equal(rows.length, 2);
  const change = rows[1]?.record;
  assert.equal(rows[1]?.messageId, off.id);
  assert.deepEqual(change?.changed, {desired: (off.data as Record<string, unknown>).desired, observed: (off.data as Record<string, unknown>).observed});
  assert.deepEqual(change?.removed, []);
  assert.equal(change?.previous, 1, 'against the last row\'s revision');
  assert.equal(change?.revision, 11);
  assert.deepEqual(change?.span, {sinceAtMs: T0, lastConfirmedAtMs: T0 + 45_000, confirmations: 10});
  assert.equal(change?.gapMs, undefined);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations}, {since: T0 + 50_000, confirmations: 1}, 'a new span opens');
});

it('a silence longer than the gap writes one gap row when readings resume; a shorter one writes none', context => {
  const {history, take} = open(context);
  take(state(plug(1, T0)), T0);
  take(state(plug(2, T0 + 5000)), T0 + 5000);
  // Exactly the gap: no row.
  take(state(plug(3, T0 + 5000 + MIN_GAP_MS)), T0 + 5000 + MIN_GAP_MS);
  assert.equal(rowsOf(history).length, 1);
  // One millisecond past it.
  const resumed = state(plug(4, T0 + 5001 + 2 * MIN_GAP_MS));
  take(resumed, T0 + 5001 + 2 * MIN_GAP_MS);
  const rows = rowsOf(history);
  assert.equal(rows.length, 2, 'one gap row');
  assert.equal(rows[1]?.messageId, resumed.id);
  assert.equal(rows[1]?.record.gapMs, MIN_GAP_MS + 1);
  assert.deepEqual(rows[1]?.record.span, {sinceAtMs: T0, lastConfirmedAtMs: T0 + 5000 + MIN_GAP_MS, confirmations: 3});
  assert.deepEqual(rows[1]?.record.changed, {observed: (resumed.data as Record<string, unknown>).observed}, 'the moved reading time');
  take(state(plug(5, T0 + 10_001 + 2 * MIN_GAP_MS)), T0 + 10_001 + 2 * MIN_GAP_MS);
  assert.equal(rowsOf(history).length, 2, 'readings after the gap row confirm it');
});

it('the gap is four polling intervals with a two-minute minimum, and a family published on events has no gap rule', context => {
  assert.equal(gapOf(RULES, WEMO, 'device'), MIN_GAP_MS);
  assert.equal(gapOf(RULES, 'bunny/modules/roborock', 'device'), 240_000);
  assert.equal(gapOf(RULES, 'bunny/modules/nanoleaf', 'device'), undefined);
  assert.equal(gapOf(RULES, WEMO, 'power-limit'), undefined);
  assert.equal(gapOf(DEFAULT_HISTORY_RULES, WEMO, 'device'), undefined, 'the core\'s own families publish on events');
  const {history, take} = open(context);
  const vacuum = (revision: number, atMs: number): Message<unknown> => state({...plug(revision, atMs), id: 'vacuum'}, {source: 'bunny/modules/roborock'});
  take(vacuum(1, T0), T0);
  take(vacuum(2, T0 + 240_000), T0 + 240_000);
  assert.equal(rowsOf(history).length, 1, 'four minutes is not a gap for a 60 s poll');
  take(vacuum(3, T0 + 480_001), T0 + 480_001);
  assert.equal(rowsOf(history).at(-1)?.record.gapMs, 240_001);
  // The same family from a module that publishes on events: an hour of silence is no gap.
  const nanoleaf = (revision: number, atMs: number): Message<unknown> => state({...plug(revision, atMs), id: 'wall'}, {source: 'bunny/modules/nanoleaf'});
  take(nanoleaf(1, T0), T0);
  take(nanoleaf(2, T0 + 3_600_000), T0 + 3_600_000);
  assert.equal(rowsOf(history).filter(row => row.record.id === 'wall').length, 1);
});

it('a removal closes an open span with one row first, and a late state at the removal\'s revision adds nothing', context => {
  const {database, history, take} = open(context);
  take(state(plug(1, T0)), T0);
  const last = state(plug(2, T0 + 5000));
  take(last, T0 + 5000);
  const removed = removal('device', 'desk-lamp', 3);
  take(removed, T0 + 9000);
  const rows = rowsOf(history);
  assert.deepEqual(rows.map(row => row.kind), ['change', 'change', 'removal']);
  // The closing row claims nothing newer than its values: the last row's revision, and no message ID.
  assert.deepEqual(rows[1]?.record, {family: 'device', id: 'desk-lamp', revision: 1, previous: 1, changed: {}, removed: [],
    span: {sinceAtMs: T0, lastConfirmedAtMs: T0 + 5000, confirmations: 2}, closedBy: 'removal'});
  assert.equal(rows[1]?.messageId, null);
  assert.equal(rows[1]?.type, 'org.bunny.device.updated', 'the last confirmation\'s type');
  assert.deepEqual(rows[2]?.record, removed, 'the removal is kept whole');
  assert.equal(spanOf(database), undefined, 'the span is gone');
  take(last, T0 + 9500);
  assert.equal(rowsOf(history).length, 3, 'the last confirmation sent again after the removal is stale against the tombstone');
  take(state(plug(3, T0 + 10_000)), T0 + 10_000);
  assert.equal(rowsOf(history).length, 3, 'a late state at the removal\'s revision brings nothing back');
  assert.equal(history.received(removed), 'duplicate', 'the removal\'s duplicate check is unchanged');
  assert.equal(history.received({...removed, data: {entity: {family: 'device', id: 'desk-lamp'}, revision: 9}}), 'conflict');
  take(state(plug(4, T0 + 11_000)), T0 + 11_000);
  assert.equal(rowsOf(history).at(-1)?.record.previous, null, 'a new entity under the same ID starts afresh');
  // A removal right after a row, with no confirmation since, needs no closing row.
  take(removal('device', 'desk-lamp', 5), T0 + 12_000);
  assert.deepEqual(rowsOf(history).slice(-2).map(row => row.kind), ['change', 'removal']);
});

it('stale, out-of-order and resent states add nothing', context => {
  const {database, history, take} = open(context);
  take(state(plug(5, T0)), T0);
  const confirmation = state(plug(7, T0 + 5000));
  take(confirmation, T0 + 5000);
  const before = spanOf(database);
  take(state(plug(4, T0 + 6000, false)), T0 + 6000);
  take(state(plug(6, T0 + 7000, false)), T0 + 7000);
  take(confirmation, T0 + 8000);
  take(state(plug(7, T0 + 9000), {id: confirmation.id}), T0 + 9000);
  assert.equal(rowsOf(history).length, 1, 'below the last row, below the last confirmation, and the same message again');
  assert.deepEqual(spanOf(database), before, 'the span counted the confirmation once');
  // The same revision under a new message ID is another reading.
  take(state(plug(7, T0 + 10_000)), T0 + 10_000);
  assert.equal(spanOf(database)?.confirmations, 3);
});

it('the span survives a store close and reopen, and a restart longer than the gap shows as a gap row', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  let database = openModuleDatabaseFile(file);
  context.after(() => { if (database.isOpen) database.close(); });
  let history = new History(database, RULES);
  history.write([{kind: 'message', message: state(plug(1, T0))}], T0, 1);
  history.write([{kind: 'message', message: state(plug(2, T0 + 5000))}], T0 + 5000, 2);
  const span = spanOf(database);
  database.close();
  database = openModuleDatabaseFile(file);
  history = new History(database, RULES);
  assert.deepEqual(spanOf(database), span, 'the span is as it was');
  history.write([{kind: 'message', message: state(plug(3, T0 + 10_000))}], T0 + 10_000, 3);
  assert.equal(spanOf(database)?.confirmations, 3, 'and goes on counting');
  database.close();
  database = openModuleDatabaseFile(file);
  history = new History(database, RULES);
  history.write([{kind: 'message', message: state(plug(4, T0 + 10_000 + 10 * 60_000))}], T0 + 10_000 + 10 * 60_000, 4);
  const rows = rowsOf(history);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]?.record.gapMs, 10 * 60_000, 'ten minutes stopped shows as a gap row');
  database.close();
});

it('a record rebuilt from rows equals the published record at each row\'s instant', context => {
  const {history, take} = open(context);
  const published = new Map<string, Record<string, unknown>>(), byRevision = new Map<number, Record<string, unknown>>();
  const send = (data: Record<string, unknown>, atMs: number): void => {
    const message = state(data);
    published.set(message.id, data);
    byRevision.set(data.revision as number, data);
    take(message, atMs);
  };
  let at = T0;
  for (let revision = 1; revision <= 40; revision++) {
    at += revision % 13 === 0 ? 5 * 60_000 : 5000;
    const record = plug(revision, at, Math.floor(revision / 7) % 2 === 0);
    if (revision % 11 === 0) delete record.externalControl;
    if (revision % 17 === 0) record.held = {requestId: `hold-${revision}`};
    send(record, at);
  }
  const painted = (revision: number, atMs: number): Record<string, unknown> =>
    ({...plug(revision, atMs), lastTransmission: {status: 'known', requestId: 'r-1', transmittedAtMs: atMs, operationIds: []}});
  send(painted(41, at + 1000), at + 1000);
  // Two confirmations, then a removal: its closing row must not claim the confirmations' revision.
  send(painted(42, at + 6000), at + 6000);
  send(painted(43, at + 11_000), at + 11_000);
  take(removal('device', 'desk-lamp', 50), at + 12_000);
  let rebuilt: Record<string, unknown> = {};
  const rows = rowsOf(history);
  assert.ok(rows.some(row => row.record.gapMs !== undefined) && rows.some(row => row.record.span !== undefined), 'gap rows and spans are covered');
  assert.ok(rows.some(row => row.record.closedBy === 'removal'), 'a closing row is covered');
  for (const row of rows.filter(entry => entry.kind === 'change')) {
    const {changed, removed, id, revision} = row.record;
    rebuilt = {...rebuilt, ...changed};
    for (const name of removed) delete rebuilt[name];
    assert.deepEqual({id, revision, ...rebuilt}, row.messageId === null ? byRevision.get(revision) : published.get(row.messageId), `row ${row.seq}`);
    if (row.messageId !== null) assert.equal(published.get(row.messageId)?.revision, revision);
  }
});

it('a power-limit record whose only change is its reading and update times writes no row; a status change writes one', async context => {
  const world = await World.open(context);
  const families = JSON.parse(readFileSync(new URL('../../fixtures/v2/families.json', import.meta.resolve('@jimmie-potts/event-contracts/v2')), 'utf8')) as
    {valid: Record<string, Message<Record<string, unknown>>>};
  const base = families.valid['power-limit'] as Message<Record<string, unknown>>;
  const limit = (revision: number, atMs: number, status = 'disabled'): Message<unknown> =>
    ({...base, id: `limit-${++next}`, data: {...base.data, revision, status, observedAtMs: atMs, updatedAtMs: atMs + 3}});
  const changes = (): number => world.store.history.read({kind: 'change'}).length;
  await world.store.transaction(tx => { tx.record(limit(1, T0)); });
  for (let index = 1; index <= 5; index++) await world.store.transaction(tx => { tx.record(limit(1 + index, T0 + 5000 * index)); });
  assert.equal(changes(), 1);
  await world.store.transaction(tx => { tx.record(limit(7, T0 + 30_000, 'idle')); });
  assert.equal(changes(), 2);
});

it('through the core store\'s intake, every leaf that is not bookkeeping changed alone writes a row, and a bookkeeping value alone writes none', async context => {
  const rules = historyRules(registrations);
  const world = await World.open(context, {watch: {history: rules}});
  const read = (name: string): Record<string, Message<Record<string, unknown>>> =>
    (JSON.parse(readFileSync(new URL(`../../fixtures/v2/${name}`, import.meta.resolve('@jimmie-potts/event-contracts/v2')), 'utf8')) as {valid: Record<string, Message<Record<string, unknown>>>}).valid;
  const fixtures: [string, Message<Record<string, unknown>>][] = [...Object.entries({...read('families.json'), ...read('devices.json')}).filter(([, message]) => message.kind === 'state'),
    ...Object.entries(RECORDS).map(([name, {type, data}]) => [name, state(data, {dataschema: `${SCHEMA_BASE}${name}`, type, source: 'bunny/modules/fixture'})] as [string, Message<Record<string, unknown>>])];
  const covered = new Set<string>();
  let entity = 0;
  for (const [name, fixture] of fixtures) {
    const family = familyOfSchema(fixture.dataschema) as string, pointers = rules.bookkeeping[family] ?? [];
    covered.add(family);
    // Each fixture under its own entity, so its readings never meet another fixture's.
    const id = `entity-${++entity}`;
    let revision = 0;
    const message = (data: Record<string, unknown>): Message<unknown> => ({...fixture, id: `leaf-${++next}`, subject: id, data: {...data, id, revision: ++revision}});
    const written = (data: Record<string, unknown>): Promise<number> => world.store.transaction(tx => {
      const before = world.store.history.read({kind: 'change'}).length;
      tx.record(message(data));
      return before;
    }).then(before => world.store.history.read({kind: 'change'}).length - before);
    // A record with no member but its ID and revision writes no row, as before #1772.
    const members = Object.keys(fixture.data).filter(key => key !== 'id' && key !== 'revision').length;
    assert.equal(await written(fixture.data), members === 0 ? 0 : 1, `${name}: the first record`);
    // A bookkeeping value moved alone, in every declared member present: a confirmation.
    const moved = structuredClone(fixture.data);
    let movedAny = false;
    for (const pointer of pointers) {
      const path = pointer.slice(1).split('/'), last = path.pop() as string;
      const parent = path.reduce<unknown>((node, token) => (node as Record<string, unknown> | undefined)?.[token], moved) as Record<string, unknown> | undefined;
      if (parent !== undefined && typeof parent[last] === 'number') { parent[last] += 1; movedAny = true; }
    }
    if (movedAny) assert.equal(await written(moved), 0, `${name}: a bookkeeping value alone writes no row`);
    for (const mutation of leafMutations(fixture.data, pointers)) {
      // Back to the fixture first, then the one change: each is one row.
      await written(fixture.data);
      assert.equal(await written(mutation.record as Record<string, unknown>), 1, `${name} ${mutation.pointer} ${mutation.change}`);
    }
  }
  for (const family of ['device', 'power-limit', 'playback', 'lifx-light', 'roborock-vacuum', 'pixoo-display', 'session']) assert.ok(covered.has(family), family);
});

it('a confirmation rolled back with its intake group leaves the span as it was', async context => {
  const world = await World.open(context);
  await world.store.transaction(tx => { tx.record(state(plug(1, T0))); });
  await world.store.transaction(tx => { tx.record(state(plug(2, T0 + 5000))); });
  const before = spanOf(world.db);
  await assert.rejects(world.store.transaction(tx => { tx.record(state(plug(3, T0 + 10_000))); throw new Error('the group fails'); }));
  assert.deepEqual(spanOf(world.db), before);
  assert.equal(world.store.history.read().length, 1);
});

it('the fact log stays gapless and never returns span content; the duplicate check is unchanged', context => {
  const {database, history, take} = open(context);
  for (let index = 0; index < 30; index++) take(state(plug(1 + index, T0 + 5000 * index, index < 20)), T0 + 5000 * index);
  take(removal('device', 'desk-lamp', 40), T0 + 200_000);
  const facts = history.after(history.origin, 0);
  assert.deepEqual(facts.map(row => row.originSeq), facts.map((_, index) => index + 1));
  assert.equal(facts.length, count(database, 'core_history'));
  assert.ok(facts.every(row => !Object.hasOwn(row, 'confirmations') && !Object.hasOwn(row, 'seen_revision')), 'rows only');
  const outcome = {specversion: '1.0', bunnyprofile: '2.0', id: 'outcome-1', source: WEMO, type: 'org.bunny.power.set.completed', subject: 'desk-lamp',
    time: new Date(T0).toISOString(), kind: 'outcome', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}outcome/2.0`,
    data: {requestId: 'request-1', result: 'succeeded'}} as Message<unknown>;
  assert.equal(history.received(outcome), 'new');
  take(outcome, T0 + 300_000);
  assert.equal(history.received(outcome), 'duplicate');
  assert.equal(history.received({...outcome, data: {requestId: 'request-1', result: 'failed'}}), 'conflict');
});

/** History's statements exactly as the release before #1772 prepares and runs them (history.ts at 5566afbc). */
const PREVIOUS = {
  migrate: `CREATE TABLE IF NOT EXISTS core_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, revision INTEGER NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, message_id TEXT, type TEXT NOT NULL, subject TEXT NOT NULL, request_id TEXT, record TEXT NOT NULL,
      origin TEXT, origin_seq INTEGER) STRICT;
    CREATE INDEX IF NOT EXISTS core_history_request ON core_history (request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS core_history_latest (source TEXT NOT NULL, family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
      record TEXT NOT NULL, PRIMARY KEY (source, family, id)) STRICT;
    CREATE TABLE IF NOT EXISTS core_refused (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, source TEXT NOT NULL, message_id TEXT NOT NULL,
      message TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS core_origin (only INTEGER PRIMARY KEY CHECK (only = 1), origin TEXT NOT NULL) STRICT`,
  origin: 'INSERT INTO core_origin VALUES (1, ?) ON CONFLICT (only) DO NOTHING',
  indexes: `DROP INDEX IF EXISTS core_history_message;
    CREATE UNIQUE INDEX IF NOT EXISTS core_history_origin ON core_history (origin, origin_seq);
    CREATE UNIQUE INDEX IF NOT EXISTS core_history_origin_message ON core_history (origin, source, message_id) WHERE message_id IS NOT NULL`,
  insert: `INSERT INTO core_history (at_ms, revision, kind, source, message_id, type, subject, request_id, record, origin, origin_seq)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(origin_seq), 0) + 1 FROM core_history WHERE origin = ?))`,
  seen: 'SELECT 1 FROM core_history WHERE origin = ? AND source = ? AND message_id = ?',
  latest: 'SELECT revision, record FROM core_history_latest WHERE source = ? AND family = ? AND id = ?',
  setLatest: `INSERT INTO core_history_latest VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (source, family, id) DO UPDATE SET revision = excluded.revision, record = excluded.record`,
};

/** The release before #1772 on `database`: its start, and its state intake, which writes the latest table on every reading. */
function previousRelease(database: DatabaseSync): (message: Message<unknown>, atMs: number) => void {
  database.exec(PREVIOUS.migrate);
  database.prepare(PREVIOUS.origin).run(randomUUID());
  const {origin} = database.prepare('SELECT origin FROM core_origin WHERE only = 1').get() as {origin: string};
  database.exec(PREVIOUS.indexes);
  const insert = database.prepare(PREVIOUS.insert), seen = database.prepare(PREVIOUS.seen), latest = database.prepare(PREVIOUS.latest), setLatest = database.prepare(PREVIOUS.setLatest);
  return (message, atMs) => {
    if (seen.get(origin, message.source, message.id) !== undefined) return;
    const record = message.data as Record<string, unknown>, id = record.id as string, entityRevision = record.revision as number, family = familyOfSchema(message.dataschema) as string;
    const held = latest.get(message.source, family, id) as {revision: number; record: string} | undefined;
    const before = held === undefined ? null : JSON.parse(held.record) as Record<string, unknown> | null;
    if (held !== undefined && (entityRevision < held.revision || (before === null && entityRevision <= held.revision))) return;
    const members = (value: Record<string, unknown>): string[] => Object.keys(value).filter(name => name !== 'id' && name !== 'revision');
    const changed: Record<string, unknown> = {};
    for (const name of members(record)) if (JSON.stringify(record[name]) !== JSON.stringify((before ?? {})[name])) changed[name] = record[name];
    const removed = members(before ?? {}).filter(name => !Object.hasOwn(record, name));
    setLatest.run(message.source, family, id, entityRevision, JSON.stringify(record));
    if (Object.keys(changed).length === 0 && removed.length === 0) return;
    insert.run(atMs, 1, 'change', message.source, message.id, message.type, message.subject, null,
      JSON.stringify({family, id, revision: entityRevision, previous: before === null ? null : held?.revision ?? null, changed, removed}), origin, origin);
  };
}

it('the previous release starts and writes on a store this release migrated, and coming forward again resets the stale span', async context => {
  const file = join(await stateDir(context), 'core.sqlite');
  let database = openModuleDatabaseFile(file);
  context.after(() => { if (database.isOpen) database.close(); });
  let history = new History(database, RULES);
  history.write([{kind: 'message', message: state(plug(1, T0))}], T0, 1);
  for (let index = 1; index <= 3; index++) history.write([{kind: 'message', message: state(plug(1 + index, T0 + 5000 * index))}], T0 + 5000 * index, 1 + index);
  const span = spanOf(database);
  database.close();

  // The previous release: its start and its positional insert into the latest table work on the migrated store.
  database = openModuleDatabaseFile(file);
  const previous = previousRelease(database);
  for (let index = 4; index <= 6; index++) previous(state(plug(1 + index, T0 + 5000 * index)), T0 + 5000 * index);
  assert.deepEqual(rowsOf(new History(database, RULES)).map(row => row.record.revision), [1, 5, 6, 7], 'it writes a row per reading, as it always did');
  assert.deepEqual(spanOf(database), span, 'and never touches the span table');
  assert.deepEqual(database.prepare('PRAGMA integrity_check').all().map(row => ({...row})), [{integrity_check: 'ok'}]);
  database.close();

  // This release again: the span the previous release left behind is reset to an unknown start.
  database = openModuleDatabaseFile(file);
  history = new History(database, RULES);
  history.write([{kind: 'message', message: state(plug(8, T0 + 35_000))}], T0 + 35_000, 8);
  history.write([{kind: 'message', message: state(plug(9, T0 + 40_000))}], T0 + 40_000, 9);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations}, {since: null, confirmations: 2});
  history.write([{kind: 'message', message: state(plug(10, T0 + 45_000, false))}], T0 + 45_000, 10);
  const rows = rowsOf(history);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[4]?.record.span, {sinceAtMs: null, lastConfirmedAtMs: T0 + 40_000, confirmations: 2});
  assert.equal(rows[4]?.record.previous, 7, 'against the previous release\'s last row');
  assert.deepEqual(rowsOf(history).map(row => row.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(history.after(history.origin, 0).map(row => row.originSeq), [1, 2, 3, 4, 5], 'one gapless order across both releases');
  database.close();
});

it('a previous release that wrote a row at the span\'s last revision resets the span too', context => {
  const {database, history, take} = open(context);
  take(state(plug(1, T0)), T0);
  take(state(plug(2, T0 + 5000)), T0 + 5000);
  // The previous release took a resend of revision 2 under another message ID, and wrote a row for it.
  previousRelease(database)(state(plug(2, T0 + 5000)), T0 + 6000);
  take(state(plug(3, T0 + 10_000)), T0 + 10_000);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations}, {since: null, confirmations: 1});
  assert.equal(rowsOf(history).length, 2);
});

it('migrating adds only the empty span table, changes no other table or schema entry, and a second open changes nothing', context => {
  const database = new DatabaseSync(':memory:');
  context.after(() => database.close());
  previousRelease(database)(state(plug(1, T0)), T0);
  const schema = (): {name: string; sql: string}[] => database.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all().map(row => ({...row}) as {name: string; sql: string});
  const tables = (): Record<string, unknown> => Object.fromEntries(['core_history', 'core_history_latest', 'core_refused', 'core_origin']
    .map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({...row}))]));
  const before = {schema: schema(), tables: tables()};
  void new History(database, RULES);
  assert.deepEqual(schema().filter(entry => entry.name !== 'core_history_span' && !entry.name.startsWith('sqlite_autoindex_core_history_span')), before.schema);
  assert.deepEqual(tables(), before.tables);
  assert.equal(count(database, 'core_history_span'), 0);
  assert.deepEqual((database.prepare('PRAGMA table_info(core_history_latest)').all() as {name: string}[]).map(column => column.name), ['source', 'family', 'id', 'revision', 'record'],
    'the latest table keeps its five columns in order');
  const migrated = schema();
  void new History(database, RULES);
  assert.deepEqual(schema(), migrated);
});

it('the polling declaration of every registration matches the checked-in classification', () => {
  assert.deepEqual(Object.keys(POLLING).sort(), registrations.map(({name}) => name).sort(), 'every registered module is classified');
  const expected = Object.fromEntries(Object.entries(POLLING).filter(([, families]) => Object.keys(families).length > 0).map(([name, families]) => [`bunny/modules/${name}`, families]));
  assert.deepEqual(modulePolling(registrations), expected);
  assert.deepEqual(historyRules(registrations).polling, expected);
  const changed = registrations.map(registration => registration.name === 'wemo' ? {...registration, polling: {device: 10_000}} : registration);
  assert.notDeepEqual(modulePolling(changed), expected, 'a changed interval no longer matches the table');
});

it('the runtime refuses to start with a polling declaration for a family the module cannot publish, or an interval out of range', () => {
  const registered = (name: string, more: Partial<ModuleRegistration> = {}): ModuleRegistration => ({
    name, order: 10, shipped: true, create: () => { throw new Error('not built'); }, simulate: () => { throw new Error('not built'); }, ...more,
  });
  assert.throws(() => shippedList([registered('lamp', {polling: {'lamp-glow': 1000}})]),
    {message: 'the shipped module list cannot be assembled: lamp declares a polling interval for lamp-glow, which is not a state family it can publish'});
  assert.throws(() => shippedList([registered('lamp', {polling: {'power-set': 1000}})]), /power-set, which is not a state family it can publish/);
  for (const interval of [0, -5, 1.5, Number.NaN, MAX_POLLING_MS + 1]) {
    assert.throws(() => shippedList([registered('lamp', {polling: {device: interval}})]),
      {message: `the shipped module list cannot be assembled: lamp's polling interval for device is not a whole number of milliseconds from 1 to ${MAX_POLLING_MS}`});
  }
  const own = registered('lamp', {schemas: {[`${SCHEMA_BASE}lamp-glow/2.0`]: {type: 'object'}}, polling: {'lamp-glow': 1000, device: MAX_POLLING_MS}});
  assert.deepEqual(modulePolling([own]), {'bunny/modules/lamp': {'lamp-glow': 1000, device: MAX_POLLING_MS}});
  assert.equal(shippedList([own]).length, 2);
});

it('a confirmation at the last row\'s revision keeps its span: the start, the count and the gap check stay', context => {
  const {history, take} = open(context);
  take(state(plug(5, T0)), T0);
  take(state(plug(5, T0 + 5000)), T0 + 5000);
  take(state(plug(6, T0 + 5000 + 10 * 60_000)), T0 + 5000 + 10 * 60_000);
  const rows = rowsOf(history);
  assert.equal(rows.length, 2, 'one gap row');
  assert.equal(rows[1]?.record.gapMs, 10 * 60_000);
  assert.deepEqual(rows[1]?.record.span, {sinceAtMs: T0, lastConfirmedAtMs: T0 + 5000, confirmations: 2}, 'with its known start');
});

it('a publisher that repeats one revision keeps one span with its start and count', context => {
  const {database, history, take} = open(context);
  for (let index = 0; index < 7; index++) take(state(plug(3, T0 + 5000 * index)), T0 + 5000 * index);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations, row: spanOf(database)?.row_revision},
    {since: T0, confirmations: 7, row: 3});
  take(state(plug(4, T0 + 35_000, false)), T0 + 35_000);
  assert.deepEqual(rowsOf(history).at(-1)?.record.span, {sinceAtMs: T0, lastConfirmedAtMs: T0 + 30_000, confirmations: 7});
});

it('a span is kept when the previous release took no reading of its entity, and reset when it took one past the span', context => {
  const {database, history, take} = open(context);
  take(state(plug(1, T0)), T0);
  take(state(plug(2, T0 + 5000)), T0 + 5000);
  // The previous release starts on the store and takes another entity's reading only.
  previousRelease(database)(state({...plug(1, T0 + 6000), id: 'shelf-lamp'}), T0 + 6000);
  take(state(plug(3, T0 + 10_000)), T0 + 10_000);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations}, {since: T0, confirmations: 3}, 'kept');
  // Now it takes a reading of this entity, past the span.
  previousRelease(database)(state(plug(4, T0 + 15_000)), T0 + 15_000);
  take(state(plug(5, T0 + 20_000)), T0 + 20_000);
  assert.deepEqual({since: spanOf(database)?.since_at_ms, confirmations: spanOf(database)?.confirmations}, {since: null, confirmations: 1}, 'reset');
  assert.equal(rowsOf(history).length, 3);
});

it('a clock that steps back neither moves the last confirmation back nor overstates the next silence', context => {
  const {database, history, take} = open(context);
  take(state(plug(1, T0)), T0);
  take(state(plug(2, T0 + 5000)), T0 + 5000);
  take(state(plug(3, T0 - 60_000)), T0 - 60_000);
  assert.equal(spanOf(database)?.confirmed_at_ms, T0 + 5000, 'the later instant stays');
  take(state(plug(4, T0 + 70_000)), T0 + 70_000);
  assert.equal(rowsOf(history).length, 1, '65 s after the last confirmation is no gap');
  take(state(plug(5, T0 + 75_000, false)), T0 + 75_000);
  const span = rowsOf(history).at(-1)?.record.span;
  assert.deepEqual(span, {sinceAtMs: T0, lastConfirmedAtMs: T0 + 70_000, confirmations: 4});
});

it('a state that reuses a message ID with another body is judged by its body, never dropped as a resend', context => {
  const {history, take} = open(context);
  take(state(plug(1, T0)), T0);
  const older = state(plug(2, T0 + 5000));
  take(older, T0 + 5000);
  const latest = state(plug(3, T0 + 10_000));
  take(latest, T0 + 10_000);
  // The last confirmation's ID with a changed state: a change row, where a genuine resend adds nothing.
  take(latest, T0 + 11_000);
  assert.equal(rowsOf(history).length, 1, 'the genuine resend adds nothing');
  take(state(plug(4, T0 + 12_000, false), {id: latest.id}), T0 + 12_000);
  assert.equal(rowsOf(history).length, 2);
  assert.equal(rowsOf(history).at(-1)?.messageId, latest.id);
  // An older confirmation's ID with a higher revision and a changed state: also a change row.
  take(state(plug(5, T0 + 13_000), {id: older.id}), T0 + 13_000);
  assert.equal(rowsOf(history).length, 3);
  // The same state under a row's own ID is dropped as before #1772: history holds that message.
  take(state(plug(6, T0 + 14_000, false), {id: older.id}), T0 + 14_000);
  assert.equal(rowsOf(history).length, 3);
});
