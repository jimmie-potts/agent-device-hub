// One prepared message sent to an edge's publish call without a stream (Hub #926), as a short-lived remote part such as
// an agent hook sends it. The call is bounded as a whole. An edge refusal, or an edge that was never reached, proves the
// message was not published; a call that reached the edge and then lost its answer may have published it.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {MAX_TIMEOUT_MS, REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER, SdkError, prepareMessage, publishOnce} from '../src/index.js';
import {SESSION_FAMILY, TRACEPARENT, assertValid, it, session, trace, turnEnded, until} from './support.js';
import {startEdge, type Edge} from './transports.js';

const KEY = `bunny.state.${SESSION_FAMILY}.s1`;
const TRACE = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

async function withEdge(body: (edge: Edge) => Promise<void>, setup: Parameters<typeof startEdge>[0] = {}): Promise<void> {
  const edge = await startEdge(setup);
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
}

/** A loopback server for the cases no edge produces: it records each call and answers as `answer` says, or never. */
async function withServer(answer: ((request: IncomingMessage, body: string) => {status: number; body: string} | undefined), body: (url: string, calls: {headers: IncomingMessage['headers']; url: string; body: string}[]) => Promise<void>): Promise<void> {
  const calls: {headers: IncomingMessage['headers']; url: string; body: string}[] = [];
  const server: Server = createServer((request, response) => {
    let text = '';
    request.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
    request.once('end', () => {
      calls.push({headers: request.headers, url: request.url ?? '', body: text});
      const given = answer(request, text);
      if (given !== undefined) response.writeHead(given.status, {'content-type': 'application/json'}).end(given.body);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
}

/** A loopback port that nothing listens on: listened on, then closed. */
async function closedPort(): Promise<string> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const {port} = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return `http://127.0.0.1:${port}`;
}

it('a prepared message is published through the edge in one call, with no stream, and keeps its id, time and trace', () => withEdge(async edge => {
  const seen: Message[] = [];
  await edge.bus.connect('bunny/wall').subscribe(`bunny.state.${SESSION_FAMILY}.*`, message => { seen.push(message); });
  const message = prepareMessage('bunny/core', session('s1', 1));
  assertValid(message);
  const result = await publishOnce({url: edge.url, source: 'bunny/core', token: edge.tokens.get('bunny/core') ?? '', timeoutMs: 2000}, KEY, message);
  assert.deepEqual(result, {status: 'published'});
  await until(() => seen.length === 1, 'the published message');
  assert.deepEqual(seen[0], message, 'the edge injected the message unchanged');
  assert.equal(edge.received('publish'), 1);
  assert.equal(edge.received('stream'), 0, 'no stream was opened');
}));

it('prepareMessage starts a new sampled trace, or continues the parent\'s', () => {
  const fresh = prepareMessage('bunny/core', session('s1', 1), {now: () => Date.parse('2026-10-07T10:00:00.000Z')});
  assert.match(fresh.traceparent, TRACEPARENT);
  assert.equal(trace(fresh.traceparent).flags, '01');
  assert.equal(fresh.time, '2026-10-07T10:00:00.000Z');
  assert.equal(fresh.source, 'bunny/core');
  const child = prepareMessage('bunny/core', turnEnded('s1'), {parent: TRACE});
  assert.equal(trace(child.traceparent).traceId, trace(TRACE.traceparent).traceId);
  assert.notEqual(trace(child.traceparent).spanId, trace(TRACE.traceparent).spanId);
  assertValid(fresh);
  assertValid(child);
});

it('an edge\'s refusal comes back rejected, with its registry body and the message\'s trace, and nothing is published', () => withEdge(async edge => {
  const seen: Message[] = [];
  await edge.bus.connect('bunny/second').subscribe('bunny.*.*.*', message => { seen.push(message); });
  const message = prepareMessage('bunny/core', session('s1', 1));
  const {traceId} = trace(message.traceparent);
  const options = {url: edge.url, source: 'bunny/core', token: edge.tokens.get('bunny/core') ?? '', timeoutMs: 2000};
  assert.deepEqual(await publishOnce({...options, token: 'not-a-granted-token'}, KEY, message), {
    status: 'rejected', error: errorBody('unauthenticated', {traceId, detail: 'the token is not granted'}),
  });
  // A message from another source than the token's.
  const foreign = await publishOnce({...options, source: 'bunny/wall', token: edge.tokens.get('bunny/wall') ?? ''}, KEY, message);
  assert.equal(foreign.status, 'rejected');
  assert.equal(foreign.status === 'rejected' ? foreign.error.error.code : '', 'forbidden');
  // Outside the grant: the wall may publish only test-turn occurrences.
  const wall = prepareMessage('bunny/wall', session('s1', 1));
  const outside = await publishOnce({...options, source: 'bunny/wall', token: edge.tokens.get('bunny/wall') ?? ''}, KEY, wall);
  assert.equal(outside.status === 'rejected' ? outside.error.error.code : outside.status, 'forbidden');
  // A message the profile refuses.
  const broken = {...message, data: {id: 's1'}} as unknown as Message;
  const invalid = await publishOnce(options, KEY, broken);
  assert.equal(invalid.status === 'rejected' ? invalid.error.error.code : invalid.status, 'invalid-message');
  await new Promise(resolve => { setTimeout(resolve, 20); });
  assert.deepEqual(seen, [], 'nothing was published');
}, {permissions: {'bunny/wall': {calls: ['publish'], keys: ['bunny.event.test-turn.*'], publishes: ['test-turn']}}}));

it('an edge that cannot be reached is rejected as unavailable at once: nothing was sent', async () => {
  const url = await closedPort();
  const started = performance.now();
  const result = await publishOnce({url, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 2000}, KEY, prepareMessage('bunny/core', session('s1', 1)));
  assert.equal(result.status, 'rejected');
  assert.equal(result.status === 'rejected' ? result.error.error.code : '', 'unavailable');
  assert.ok(performance.now() - started < 1000, 'a refused connection settles at once');
});

it('an edge that takes the call and never answers is uncertain at the deadline: the message may have been published', () => withServer(() => undefined, async (url, calls) => {
  const message = prepareMessage('bunny/core', session('s1', 1));
  const started = performance.now();
  const result = await publishOnce({url, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 300}, KEY, message);
  const elapsed = performance.now() - started;
  assert.deepEqual(result, {
    status: 'uncertain', error: errorBody('uncertain-result', {traceId: trace(message.traceparent).traceId, detail: 'the edge did not answer within 300 ms; the message may have been published'}),
  });
  assert.ok(elapsed >= 290 && elapsed < 1000, `settled at the deadline, after ${Math.round(elapsed)} ms`);
  assert.equal(calls.length, 1);
}));

it('an edge that fails, or answers with something other than its answer, leaves the publication uncertain', async () => {
  const cases: [string, {status: number; body: string}][] = [
    ['internal', {status: 500, body: JSON.stringify(errorBody('internal', {detail: 'the edge failed'}))}],
    ['uncertain-result', {status: 500, body: JSON.stringify(errorBody('uncertain-result', {detail: 'the edge failed after it sent the command'}))}],
    ['an unregistered code', {status: 400, body: JSON.stringify({error: {code: 'oops', retryable: false}})}],
    ['a flag that disagrees with the registry', {status: 503, body: JSON.stringify({error: {code: 'unavailable', retryable: false}})}],
    ['not JSON', {status: 502, body: '<html>bad gateway</html>'}],
    ['a 200 that is not published', {status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'queued'})}],
    ['a 200 that is not JSON', {status: 200, body: 'ok'}],
  ];
  for (const [name, answer] of cases) {
    await withServer(() => answer, async url => {
      const result = await publishOnce({url, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 2000}, KEY, prepareMessage('bunny/core', session('s1', 1)));
      assert.equal(result.status, 'uncertain', name);
      assert.equal(result.status === 'uncertain' ? result.error.error.code : '', 'uncertain-result', name);
    });
  }
});

it('an answer larger than an edge ever sends is not read past its bound, and leaves the publication uncertain', () => withServer(
  () => ({status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'published', pad: 'x'.repeat(64 * 1024)})}),
  async url => {
    const result = await publishOnce({url, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 2000}, KEY, prepareMessage('bunny/core', session('s1', 1)));
    assert.equal(result.status, 'uncertain');
  },
));

it('the call carries the source and the message\'s trace in its headers, and the token only in authorization', () => withServer(
  () => ({status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'})}),
  async (url, calls) => {
    const token = 'tok_SYNTHETIC926_header_check';
    const message = prepareMessage('bunny/core', session('s1', 1));
    assert.deepEqual(await publishOnce({url: `${url}/`, source: 'bunny/core', token, timeoutMs: 2000}, KEY, message), {status: 'published'});
    const [call] = calls;
    assert.ok(call);
    assert.equal(call.url, `${REMOTE_PATH}/publish`);
    assert.equal(call.headers.authorization, `Bearer ${token}`);
    assert.equal(call.headers[SOURCE_HEADER], 'bunny/core');
    assert.equal(call.headers.traceparent, message.traceparent);
    assert.equal(call.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(call.body), {schema: REMOTE_SCHEMA, key: KEY, message});
    assert.equal(call.body.includes(token), false, 'the token is not in the body');
  },
));

it('a malformed call is refused before anything is sent', async () => {
  const message = prepareMessage('bunny/core', session('s1', 1));
  await withServer(() => ({status: 200, body: '{}'}), async (url, calls) => {
    for (const timeoutMs of [0, -1, 1.5, MAX_TIMEOUT_MS + 1, Number.NaN]) {
      await assert.rejects(publishOnce({url, source: 'bunny/core', token: 't', timeoutMs}, KEY, message), refused('invalid-request'), String(timeoutMs));
    }
    await assert.rejects(publishOnce({url: 'https://127.0.0.1:1', source: 'bunny/core', token: 't', timeoutMs: 100}, KEY, message), refused('invalid-request'), 'https');
    await assert.rejects(publishOnce({url: 'not a url', source: 'bunny/core', token: 't', timeoutMs: 100}, KEY, message), refused('invalid-request'), 'no URL');
    assert.equal(calls.length, 0);
  });
});
