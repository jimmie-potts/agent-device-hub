// Pure HTTP-boundary probes for the dashboard (Hub #922): real gateway/access code, no listener or runtime process.
import assert from 'node:assert/strict';
import type {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {InProcessBus, childOf, edgeValidator, traceFields, type Scheduler} from '@jimmie-potts/sdk';
import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import {sessionCookie} from '../src/gateway/access.js';
import {Gateway} from '../src/gateway/gateway.js';
import type {ModuleHost} from '../src/host.js';
import {LogWriter, type LogRecord} from '../src/log.js';

const ORIGIN = 'http://127.0.0.1:0';
const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
type Answer = {status: number; headers: Record<string, string>; body: string};

async function boundary(context: TestContext): Promise<{gateway: Gateway; spans: RecordedSpans; logs: LogRecord[]}> {
  const clock = {now: () => 1_700_000_000_000};
  const scheduler: Scheduler = {after: () => () => {}};
  const logs: LogRecord[] = [];
  const writer = new LogWriter(record => { logs.push(record); }, 'debug', clock);
  const spans = new RecordedSpans();
  const options = {
    bus: new InProcessBus({scheduler}), host: {modules: () => []} as unknown as ModuleHost, validator: edgeValidator(),
    families: new Set<string>(), credentials: [], clock, scheduler, log: writer.logger('bunny.runtime'), redactions: writer.redactions,
    stateDir: '/home/jimmie/.local/scratch/827d/unused', trace: spans,
    edge: {credentials: 'unused', browserAccess: 'trusted-loopback' as const, launcher: false, mcp: false, editorLinks: {}, placeLinks: {}},
  };
  const gateway = new Gateway(options);
  // With MCP and the launcher off, start only attaches the in-memory participant and names its origin.
  await gateway.start(ORIGIN, ['127.0.0.1:0']);
  context.after(() => gateway.close());
  return {gateway, spans, logs};
}

function call(gateway: Gateway, path: string, options: {method?: string; headers?: IncomingHttpHeaders; body?: object} = {}): Promise<Answer> {
  const request = Object.assign(Readable.from(options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]), {
    url: path, method: options.method ?? 'GET',
    headers: {host: '127.0.0.1:0', origin: ORIGIN, 'bunny-request': '1', 'content-type': 'application/json', ...options.headers},
  }) as unknown as IncomingMessage;
  return new Promise(resolve => {
    const response = {
      headersSent: false, destroyed: false,
      writeHead: (status: number, headers: Record<string, string>) => ({end: (body: string) => { resolve({status, headers, body}); }}),
    } as unknown as ServerResponse;
    gateway.handle(request, response);
  });
}

const cookieOf = (answer: Answer): string => (answer.headers['set-cookie'] ?? '').split(';')[0] ?? '';

void test('all five dashboard handoffs continue the authenticated caller trace and finish their server spans', async context => {
  const {gateway, spans} = await boundary(context);
  const parents = Array.from({length: 5}, () => childOf(PARENT));
  const signed = await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {}, headers: {...parents[0]}});
  const launched = await call(gateway, '/api/v2/browser/launch', {
    method: 'POST', body: {code: gateway.access.issueLaunch()}, headers: {...parents[1], cookie: cookieOf(signed)},
  });
  const cookie = cookieOf(launched);
  const authority = await call(gateway, '/api/v2/authority?scope=read', {headers: {...parents[2], cookie}});
  const links = await call(gateway, '/api/v2/links', {headers: {...parents[3], cookie}});
  const logout = await call(gateway, '/api/v2/browser/logout', {method: 'POST', body: {}, headers: {...parents[4], cookie}});
  assert.deepEqual([signed, launched, authority, links, logout].map(answer => answer.status), [200, 200, 200, 200, 200]);
  assert.equal(gateway.access.counts().sessions, 0, 'replacement and logout semantics remain intact');
  assert.equal(spans.spans.length, 5, 'every accepted HTTP handoff is recorded');
  assert.deepEqual(spans.spans.map(span => span.parentSpanId), parents.map(parent => traceFields(parent)?.spanId));
  assert.ok(spans.spans.every(span => span.traceId === traceFields(PARENT)?.traceId && span.kind === 'server' && span.endedAtMs !== undefined));
  assert.deepEqual(spans.spans.map(span => span.attributes['http.route']), [
    '/api/v2/browser/session', '/api/v2/browser/launch', '/api/v2/authority', '/api/v2/links', '/api/v2/browser/logout',
  ]);
  assert.deepEqual(spans.spans.map(span => span.name), [
    'bunny.command.request', 'bunny.command.request', 'bunny.feed.read', 'bunny.feed.read', 'bunny.command.request',
  ]);
});

void test('missing, malformed, duplicate and all-zero parents start roots without changing a valid read', async context => {
  const {gateway, spans} = await boundary(context);
  const cookie = sessionCookie(gateway.access.openSession());
  for (const traceparent of [undefined, 'bad', ['bad', PARENT.traceparent], `00-${'0'.repeat(32)}-b7ad6b7169203331-01`, `00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`]) {
    assert.equal((await call(gateway, '/api/v2/authority?scope=read', {headers: {cookie, traceparent}})).status, 200);
  }
  assert.equal(spans.spans.length, 5);
  assert.ok(spans.spans.every(span => span.parentSpanId === undefined && span.traceId !== traceFields(PARENT)?.traceId));
});

void test('untrusted or invalid calls cannot adopt a parent, and unrelated routes remain outside this change', async context => {
  const {gateway, spans} = await boundary(context);
  const cookie = sessionCookie(gateway.access.openSession());
  const trusted = {...PARENT, cookie};
  const refused = [
    await call(gateway, '/api/v2/authority?scope=read', {headers: PARENT}),
    await call(gateway, '/api/v2/links', {headers: {...trusted, origin: 'http://other.invalid'}}),
    await call(gateway, '/api/v2/authority?scope=read&unexpected=1', {headers: trusted}),
    await call(gateway, '/api/v2/links?unexpected=1', {headers: trusted}),
    await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {}, headers: {...PARENT, origin: 'http://other.invalid'}}),
    await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {}, headers: {...PARENT, 'bunny-request': undefined}}),
    await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {extra: true}, headers: PARENT}),
    await call(gateway, '/api/v2/browser/launch', {method: 'POST', body: {code: 'invalid'}, headers: PARENT}),
  ];
  assert.deepEqual(refused.map(answer => answer.status), [401, 403, 400, 400, 403, 403, 400, 401]);
  assert.equal(spans.spans.length, 0, 'no caller context is adopted before authentication, ownership and input checks');
  assert.equal((await call(gateway, '/api/v2/modules', {headers: trusted})).status, 200);
  assert.equal(spans.spans.length, 0, 'only the five dashboard handoffs are changed');
  assert.equal((await call(gateway, '/api/v2/browser/logout', {method: 'POST', body: {}, headers: PARENT})).status, 200);
  assert.equal(spans.spans.length, 1, 'an unauthenticated logout remains harmless');
  assert.equal(spans.spans[0]?.parentSpanId, undefined, 'it does not trust the incoming context');
});

void test('a failure after admission ends its span and correlates the fixed refusal without exposing error text', async context => {
  const {gateway, spans, logs} = await boundary(context);
  context.mock.method(gateway.access, 'openSession', () => { throw new Error('synthetic-private-context'); });
  const answer = await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {}, headers: PARENT});
  assert.equal(answer.status, 500);
  const span = spans.spans[0];
  const refusal = logs.find(record => record.event_name === 'runtime.edge.refused');
  assert.ok(span && refusal);
  assert.equal(span.status, 'error');
  assert.equal(span.parentSpanId, traceFields(PARENT)?.spanId);
  assert.equal(refusal.trace_id, span.traceId);
  assert.equal(refusal.span_id, span.spanId);
  assert.equal(JSON.stringify([answer, logs, spans.spans]).includes('synthetic-private-context'), false);
});
