// The history read's open spans (#1773, design #1768): a page of history carries, for each entity with a change row in
// it, the span the entity's next row would close, from a keyed lookup per entity; the fact log never carries them; the
// HTTP read adds them as an optional member of `history/2.0`, and a page with none answers exactly as before; the MCP
// tool `core_history` keeps its rows-only answer and its published output schema. Synthetic in-memory stores; every
// instant is given explicitly and nothing waits on real time.
import assert from 'node:assert/strict';
import type {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {SCHEMA_BASE, type Message} from '@jimmie-potts/event-contracts/v2';
import {bookkeeping} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import {InProcessBus, edgeValidator, type ModuleTool, type Scheduler} from '@jimmie-potts/sdk';
import {History, historyFilter, MIN_GAP_MS, type HistoryFilter, type HistoryPage, type HistoryRules} from '../src/core/history.js';
import {historyTool} from '../src/core/read-tools.js';
import {sessionCookie} from '../src/gateway/access.js';
import {Gateway} from '../src/gateway/gateway.js';
import type {ModuleHost} from '../src/host.js';
import {LogWriter} from '../src/log.js';

const WEMO = 'bunny/modules/wemo';
const T0 = 1_800_000_000_000;
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const RULES: HistoryRules = {bookkeeping, polling: {[WEMO]: {device: 5000}}};
let next = 0;

function state(data: Record<string, unknown>): Message<unknown> {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id: `state-${++next}`, source: WEMO, type: 'org.bunny.device.updated', subject: String(data.id),
    time: new Date(T0).toISOString(), kind: 'state', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}device/2.4`, traceparent: TRACE, data,
  };
}
/** A Wemo plug's device record at `revision`, read at `atMs`; only `observedAtMs` moves between readings of one state. */
const plug = (id: string, revision: number, atMs: number, power = true): Record<string, unknown> => ({
  id, revision, kind: 'wemo', availability: 'available', configurationRevision: 1, generation: {epoch: 'wemo', sequence: 1},
  desired: {power: {status: 'known', value: power}, brightness: {status: 'unknown'}, mode: {status: 'unknown'}},
  observed: {status: 'known', observedAtMs: atMs, power: {status: 'known', value: power}, brightness: {status: 'unknown'}},
  pending: 0, pendingKinds: [], lastOutcome: {status: 'unknown'}, lastTransmission: {status: 'unknown'}, externalControl: {status: 'unknown'},
});
const removal = (id: string, revision: number): Message<unknown> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `removal-${++next}`, source: WEMO, type: 'org.bunny.device.removed', subject: id, time: new Date(T0).toISOString(),
  kind: 'removal', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}removal/2.0`, traceparent: TRACE, data: {entity: {family: 'device', id}, revision},
});
const occurrence = (): Message<unknown> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: `occurrence-${++next}`, source: 'bunny/core', type: 'org.bunny.turn.ended', subject: 'synthetic-session',
  time: new Date(T0).toISOString(), kind: 'occurrence', datacontenttype: 'application/json', dataschema: `${SCHEMA_BASE}turn/2.0`, traceparent: TRACE, data: {session: 'synthetic-session'},
});

/**
 * History on a new in-memory store whose span lookups are counted, and a writer that takes one message at its own
 * instant. The count is of executions of the read's keyed statement, the one that joins the span and latest tables.
 */
function open(context: TestContext): {database: DatabaseSync; history: History; take: (message: Message<unknown>, atMs: number) => void; lookups: () => number} {
  const database = new DatabaseSync(':memory:');
  context.after(() => { if (database.isOpen) database.close(); });
  let lookups = 0;
  const counted = new Proxy(database, {get(target, property) {
    if (property === 'prepare') {
      return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes('JOIN core_history_latest')) return statement;
        return new Proxy(statement, {get(inner, name) {
          if (name === 'get') return (...values: (string | number)[]) => { lookups++; return inner.get(...values); };
          const value: unknown = Reflect.get(inner, name);
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inner) : value;
        }});
      };
    }
    const value: unknown = Reflect.get(target, property);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  }});
  const history = new History(counted, RULES);
  let revision = 0;
  return {database, history, take: (message, atMs) => { history.write([{kind: 'message', message}], atMs, ++revision); }, lookups: () => lookups};
}

void test('a page carries the open span of each entity with a change row in it, one keyed lookup per entity, and nothing else', context => {
  const {history, take, lookups} = open(context);
  // The lamp: a row, then 59 confirmations. The fan: a change after a span, then 2 confirmations. The heater: one row only.
  take(state(plug('lamp', 1, T0)), T0);
  for (let index = 1; index < 60; index++) take(state(plug('lamp', 1 + index, T0 + 5000 * index)), T0 + 5000 * index);
  take(state(plug('fan', 1, T0)), T0);
  take(state(plug('fan', 2, T0 + 5000)), T0 + 5000);
  take(state(plug('fan', 3, T0 + 10_000, false)), T0 + 10_000);
  take(state(plug('fan', 4, T0 + 15_000, false)), T0 + 15_000);
  take(state(plug('fan', 5, T0 + 20_000, false)), T0 + 20_000);
  take(state(plug('heater', 1, T0)), T0);
  take(occurrence(), T0 + 1);
  const before = lookups();
  const page = history.page();
  assert.equal(lookups() - before, 3, 'one lookup per distinct entity with a change row, though the fan has two');
  assert.deepEqual(page.rows, history.read(), 'the rows are the read\'s, unchanged');
  assert.deepEqual(page.open, [
    {source: WEMO, family: 'device', id: 'lamp', revision: 1, sinceAtMs: T0, lastConfirmedAtMs: T0 + 295_000, confirmations: 60},
    {source: WEMO, family: 'device', id: 'fan', revision: 3, sinceAtMs: T0 + 10_000, lastConfirmedAtMs: T0 + 20_000, confirmations: 3},
  ], 'the heater\'s span holds only its row\'s reading, so it is no open span, as it would close none');
  // A page with each entity's first row only still gets each entity's open span: the reader decides which row it
  // continues. A page holding none of the fan's rows asks nothing about the fan.
  const first = history.page(historyFilter({toAtMs: T0}) as HistoryFilter);
  assert.deepEqual(first.open?.map(span => span.id), ['lamp', 'fan']);
  const asked = lookups();
  const quiet = history.page(historyFilter({fromAtMs: T0 + 1, toAtMs: T0 + 9000}) as HistoryFilter);
  assert.equal(quiet.rows.length, 1, 'only the occurrence');
  assert.equal(quiet.open, undefined);
  assert.equal(lookups(), asked, 'a page without change rows asks nothing');
});

void test('a page without change rows, or whose entities hold no open span, has no open member and makes no lookup for other rows', context => {
  const {history, take, lookups} = open(context);
  take(state(plug('lamp', 1, T0)), T0);
  take(state(plug('lamp', 2, T0 + 5000)), T0 + 5000);
  take(occurrence(), T0 + 6000);
  const before = lookups();
  const page = history.page({kind: 'occurrence'});
  assert.equal(lookups(), before, 'an occurrence asks for no span');
  assert.deepEqual(Object.keys(page), ['rows']);
  assert.deepEqual(Object.keys(history.page({kind: 'change', toAtMs: T0 - 1})), ['rows'], 'an empty page');
  const single = open(context);
  single.take(state(plug('heater', 1, T0)), T0);
  assert.deepEqual(Object.keys(single.history.page()), ['rows'], 'a span with only its row\'s reading');
});

void test('an unknown start, a backward clock and a removal read as history holds them; after() never carries a span', context => {
  const {database, history, take} = open(context);
  take(state(plug('lamp', 1, T0)), T0);
  take(state(plug('lamp', 2, T0 + 5000)), T0 + 5000);
  // A release without spans took a reading of the lamp at another revision: the stored span is stale and is not served.
  database.prepare('UPDATE core_history_latest SET revision = 3 WHERE id = ?').run('lamp');
  assert.equal(history.page().open, undefined, 'the write path would reset this span, so no reader sees it');
  take(state(plug('lamp', 4, T0 + 10_000)), T0 + 10_000);
  assert.deepEqual(history.page().open, [{source: WEMO, family: 'device', id: 'lamp', revision: 3, sinceAtMs: null, lastConfirmedAtMs: T0 + 10_000, confirmations: 1}]);
  // The clock steps back: the confirmation keeps its earlier instant.
  take(state(plug('fan', 1, T0 + 60_000)), T0 + 60_000);
  take(state(plug('fan', 2, T0 + 30_000)), T0 + 30_000);
  assert.deepEqual(history.page().open?.find(span => span.id === 'fan'), {source: WEMO, family: 'device', id: 'fan', revision: 1, sinceAtMs: T0 + 60_000, lastConfirmedAtMs: T0 + 30_000, confirmations: 2});
  // A removal closes the span with a row and drops it.
  take(removal('fan', 9), T0 + 90_000);
  assert.equal(history.page().open?.find(span => span.id === 'fan'), undefined);
  const facts = history.after(history.origin, 0);
  assert.ok(facts.every(row => !Object.hasOwn(row, 'open')), 'the fact log reads rows only');
  assert.deepEqual(Object.keys(facts[0] ?? {}).sort(), ['atMs', 'kind', 'messageId', 'origin', 'originSeq', 'record', 'requestId', 'revision', 'seq', 'source', 'subject', 'type']);
  assert.ok(history.page().rows.some(row => row.record.closedBy === 'removal'));
  // A gap row: the lamp falls silent past the gap and resumes; its new open span starts at the gap row.
  take(state(plug('lamp', 5, T0 + 20_000 + 2 * MIN_GAP_MS)), T0 + 20_000 + 2 * MIN_GAP_MS);
  take(state(plug('lamp', 6, T0 + 25_000 + 2 * MIN_GAP_MS)), T0 + 25_000 + 2 * MIN_GAP_MS);
  const gap = history.read({kind: 'change'}).at(-1);
  assert.equal(typeof gap?.record.gapMs, 'number');
  assert.deepEqual(history.page().open?.find(span => span.id === 'lamp'), {source: WEMO, family: 'device', id: 'lamp', revision: 5, sinceAtMs: gap?.atMs, lastConfirmedAtMs: T0 + 25_000 + 2 * MIN_GAP_MS, confirmations: 2});
});

type Answer = {status: number; body: string};
async function gateway(context: TestContext, read: (filter: HistoryFilter) => HistoryPage): Promise<(path: string) => Promise<Answer>> {
  const clock = {now: () => T0};
  const scheduler: Scheduler = {after: () => () => {}};
  const writer = new LogWriter(() => {}, 'debug', clock);
  const served = new Gateway({
    bus: new InProcessBus({scheduler}), host: {modules: () => []} as unknown as ModuleHost, validator: edgeValidator(),
    families: new Set<string>(), credentials: [], clock, scheduler, log: writer.logger('bunny.runtime'), redactions: writer.redactions,
    stateDir: '/unused', history: {read},
    edge: {credentials: 'unused', browserAccess: 'trusted-loopback' as const, launcher: false, mcp: false, editorLinks: {}, placeLinks: {}},
  });
  await served.start('http://127.0.0.1:0', ['127.0.0.1:0']);
  context.after(() => served.close());
  const cookie = sessionCookie(served.access.openSession());
  return path => new Promise(resolve => {
    const headers: IncomingHttpHeaders = {host: '127.0.0.1:0', origin: 'http://127.0.0.1:0', 'bunny-request': '1', cookie};
    const request = Object.assign(Readable.from([]), {url: path, method: 'GET', headers}) as unknown as IncomingMessage;
    const response = {headersSent: false, destroyed: false, writeHead: (status: number) => ({end: (body: string) => { resolve({status, body}); }})} as unknown as ServerResponse;
    served.handle(request, response);
  });
}

void test('the HTTP read adds open as an optional member of history/2.0; a page without one answers byte for byte as before', async context => {
  const {history, take} = open(context);
  take(state(plug('lamp', 1, T0)), T0);
  take(state(plug('lamp', 2, T0 + 5000)), T0 + 5000);
  take(occurrence(), T0 + 6000);
  const call = await gateway(context, filter => history.page(filter));
  // Before #1773 the route answered JSON.stringify({schema: 'history/2.0', rows}) with the read's rows.
  const plain = await call('/api/v2/history?kind=occurrence');
  assert.equal(plain.status, 200);
  assert.equal(plain.body, JSON.stringify({schema: 'history/2.0', rows: history.read({kind: 'occurrence'})}));
  const spans = await call('/api/v2/history');
  const body = JSON.parse(spans.body) as {schema: string; rows: unknown[]; open?: unknown[]};
  assert.deepEqual(Object.keys(body), ['schema', 'rows', 'open']);
  assert.deepEqual(body.rows, history.read());
  assert.deepEqual(body.open, [{source: WEMO, family: 'device', id: 'lamp', revision: 1, sinceAtMs: T0, lastConfirmedAtMs: T0 + 5000, confirmations: 2}]);
  // An old reader that reads only `rows` sees the same rows as it did before.
  const oldReader = (text: string): unknown[] => { const {schema, rows} = JSON.parse(text) as {schema: string; rows: unknown[]}; assert.equal(schema, 'history/2.0'); return rows; };
  assert.deepEqual(oldReader(spans.body), history.read());
  // Refusals are unchanged.
  for (const query of ['?kind=unknown', '?limit=0', '?other=value']) assert.equal((await call(`/api/v2/history${query}`)).status, 400, query);
});

void test('the MCP tool core_history keeps its rows-only answer and its published output schema', () => {
  const page: HistoryPage = {rows: [], open: [{source: WEMO, family: 'device', id: 'lamp', revision: 1, sinceAtMs: T0, lastConfirmedAtMs: T0 + 5000, confirmations: 2}]};
  const tool: ModuleTool = historyTool(() => page.rows);
  // The output schema as on main. Whether `open` joins it is the owner's decision on #1773; this pins either answer.
  assert.deepEqual(tool.output, {type: 'object', additionalProperties: false, required: ['rows'], properties: {rows: {type: 'array'}}});
  assert.deepEqual(tool.read({}), {rows: []});
});
