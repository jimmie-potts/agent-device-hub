// Wispr's HTTP delivery boundary: real authentication and gateway, synthetic content, no listener or source files.
import assert from 'node:assert/strict';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {test, type TestContext} from 'node:test';
import {InProcessBus, edgeValidator, traceFields, type Scheduler} from '@jimmie-potts/sdk';
import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import {tokenDigest} from '../src/credentials.js';
import {Gateway} from '../src/gateway/gateway.js';
import type {ModuleHost} from '../src/host.js';
import {LogWriter, type LogRecord} from '../src/log.js';

const tokens = ['synthetic-wispr-reader-one', 'synthetic-wispr-reader-two', 'synthetic-wispr-control-only'] as const;
const credentials = tokens.map((token, index) => ({id: `client-${index}`, source: `bunny/parts/client-${index}`,
  digest: tokenDigest(token), scopes: index === 2 ? ['control'] as const : ['read'] as const}));
const parent = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
type Answer = {status: number; headers: Record<string, string>; body: string};
type Caller = {token?: string; cookie?: string};

async function boundary(context: TestContext) {
  const clock = {now: () => 1_700_000_000_000}, scheduler: Scheduler = {after: () => () => {}};
  const logs: LogRecord[] = [], writer = new LogWriter(record => {logs.push(record);}, 'debug', clock), spans = new RecordedSpans();
  let exposed = false, epoch = 0, reads = 0, afterRead: (() => void) | undefined;
  let gate: Promise<void> | undefined, release = (): void => {}, reading = (): void => {};
  const wispr = {
    browserExposed: () => exposed,
    deliveryGuard: () => {const captured = epoch; return () => captured === epoch;},
    read: async (ref: string) => {
      reads++; reading(); await gate;
      if (ref === 'export') return {type: 'text/csv; charset=utf-8', bytes: Buffer.from('words\n120\n')};
      return {type: 'application/json', bytes: Buffer.from('{"schema":"wispr-analytics/2.0","data":{"words":120}}')};
    },
  };
  const manifest = {name: 'wispr', apiVersion: '1.3', content: wispr.read,
    pages: [{id: 'analytics', title: 'Wispr', presentation: 'react'}]};
  const host = {modules: () => [{name: 'wispr', manifest, admitted: true, state: 'running'}],
    invoke: async <T>(_name: string, work: () => T | Promise<T>): Promise<T> => {
      const answer = await work(); afterRead?.(); return answer;
    }} as unknown as ModuleHost;
  const options = {bus: new InProcessBus({scheduler}), host, validator: edgeValidator(), families: new Set<string>(),
    credentials, clock, scheduler, log: writer.logger('bunny.runtime'), redactions: writer.redactions,
    stateDir: '/unused-wispr-boundary', trace: spans, wispr,
    edge: {credentials: 'unused', launcher: false, mcp: false, editorLinks: {}, placeLinks: {}}};
  const gateway = new Gateway(options);
  await gateway.start('http://127.0.0.1:0', ['127.0.0.1:0']);
  context.after(async () => {release(); await gateway.close();});
  const call = (path: string, caller: Caller = {token: tokens[0]}): Promise<Answer> => {
    const request = Object.assign(Readable.from([]), {url: path, method: 'GET',
      headers: {host: '127.0.0.1:0', ...parent, ...(caller.token === undefined ? {} : {authorization: `Bearer ${caller.token}`}),
        ...(caller.cookie === undefined ? {} : {cookie: caller.cookie})},
    }) as unknown as IncomingMessage;
    return new Promise(resolve => gateway.handle(request, {headersSent: false, destroyed: false,
      writeHead: (status: number, headers: Record<string, string>) => ({end: (body: string | Uint8Array) => {
        resolve({status, headers, body: typeof body === 'string' ? body : Buffer.from(body).toString()});
      }}),
    } as unknown as ServerResponse));
  };
  return {gateway, call, logs, spans, reads: () => reads, expose: (value: boolean) => {exposed = value; epoch++;},
    retire: () => {epoch++;}, afterRead: (action: () => void) => {afterRead = action;},
    hold: () => {gate = new Promise(resolve => {release = resolve;}); return new Promise<void>(resolve => {reading = resolve;});},
    release: () => {release();}, browser: () => ({cookie: `bunny-session=${gateway.access.openSession()}`}),
  };
}

void test('every read-scoped credential can read Wispr while browser exposure remains a separate default-off gate', async context => {
  const w = await boundary(context), path = '/modules/wispr/content/summary';
  for (const token of tokens.slice(0, 2)) assert.equal((await w.call(path, {token})).status, 200);
  for (const [caller, status] of [[{}, 401], [{token: 'synthetic-unknown'}, 401], [{token: tokens[2]}, 403]] as const)
    assert.equal((await w.call(path, caller)).status, status);
  const browser = w.browser(), count = w.reads();
  assert.equal((await w.call(path, browser)).status, 403); assert.equal(w.reads(), count, 'exposure refusal precedes reading');
  assert.equal((await w.call('/modules/wispr/analytics', browser)).status, 403);
  const catalog = JSON.parse((await w.call('/api/v2/modules', browser)).body) as {modules: {name: string; pages: unknown[]}[]};
  assert.deepEqual(catalog.modules.find(module => module.name === 'wispr')?.pages, []);
  w.expose(true); assert.equal((await w.call(path, browser)).status, 200);
  const shown = JSON.parse((await w.call('/api/v2/modules', browser)).body) as typeof catalog;
  assert.equal(shown.modules.find(module => module.name === 'wispr')?.pages.length, 1);
});

void test('a pending Wispr read is refused after same-ID credential rotation, with a correlated safe refusal', async context => {
  const w = await boundary(context), entered = w.hold(), pending = w.call('/modules/wispr/content/summary');
  assert.equal(await Promise.race([entered.then(() => 'reading'), pending.then(answer => answer.status)]), 'reading');
  w.gateway.access.replace(credentials.map((credential, index) => index === 0 ? {...credential, digest: tokenDigest('synthetic-rotated-wispr')} : credential));
  w.release(); const answer = await pending;
  assert.equal(answer.status, 401); assert.equal(answer.body.includes('120'), false);
  const refusal = w.logs.find(record => record.attributes['bunny.code'] === 'unauthenticated');
  assert.ok(refusal); assert.equal(refusal.trace_id, traceFields(parent)?.traceId);
  assert.equal(refusal.attributes['http.route'], '/modules/:module/content/:ref');
  for (const token of [...tokens, 'synthetic-rotated-wispr']) assert.equal(JSON.stringify([answer, w.logs, w.spans.spans]).includes(token), false);
});

void test('privacy opt-out after resolved content still prevents HTTP delivery, including browser exposure loss', async context => {
  const machine = await boundary(context); machine.afterRead(machine.retire);
  const retired = await machine.call('/modules/wispr/content/language');
  assert.equal(retired.status, 503); assert.equal(retired.body.includes('120'), false);
  const browser = await boundary(context); browser.expose(true); const caller = browser.browser();
  browser.afterRead(() => {browser.expose(false);});
  const hidden = await browser.call('/modules/wispr/content/summary', caller);
  assert.equal(hidden.status, 403); assert.equal(hidden.body.includes('120'), false);
});

void test('Wispr CSV is a bounded inert download with a fixed filename and the same read gate', async context => {
  const w = await boundary(context), answer = await w.call('/modules/wispr/content/export?format=csv');
  assert.equal(answer.status, 200); assert.equal(answer.body, 'words\n120\n');
  assert.equal(answer.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(answer.headers['content-disposition'], 'attachment; filename="wispr-analytics.csv"');
  assert.equal(answer.headers['cache-control'], 'no-store'); assert.equal(answer.headers['x-content-type-options'], 'nosniff');
  assert.equal((await w.call('/modules/wispr/content/export?format=csv', w.browser())).status, 403);
});
