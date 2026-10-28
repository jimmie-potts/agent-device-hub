// One prepared message sent to an edge's publish call without a stream (Hub #926), as a short-lived remote part such as
// an agent hook sends it. The call is bounded as a whole. An edge refusal, or an edge that was never reached, proves the
// message was not published; a call that reached the edge and then lost its answer may have published it.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getCACertificates, setDefaultCACertificates} from 'node:tls';
import type {Duplex} from 'node:stream';
import {createServer as createListener, type AddressInfo, type Socket} from 'node:net';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {MAX_TIMEOUT_MS, REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER, SdkError, prepareMessage, publishOnce} from '../src/index.js';
import {SESSION_FAMILY, TRACEPARENT, assertValid, it, session, trace, turnEnded, until} from './support.js';
import {startEdge, type Edge} from './transports.js';

const KEY = `bunny.state.${SESSION_FAMILY}.s1`;
const TRACE = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

async function withHttps(body: (url: string, calls: string[], certificate: string, respond: (status: number, body: string, location?: string) => void, connections: () => number) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sdk-tls-'));
  const keyFile = join(directory, 'key.pem'), certificateFile = join(directory, 'certificate.pem');
  const originalTrust = getCACertificates('default');
  const calls: string[] = [];
  let answer = {status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'}), location: ''};
  const sockets = new Set<Duplex>();
  let connections = 0;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certificateFile,
      '-subj', '/CN=synthetic-hook', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], {stdio: 'ignore'});
    const certificate = await readFile(certificateFile, 'utf8');
    const server = createHttpsServer({key: await readFile(keyFile), cert: certificate}, (request, response) => {
      let text = '';
      request.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).once('end', () => {
        calls.push(text);
        if (answer.status !== 0) response.writeHead(answer.status, {'content-type': 'application/json', ...(answer.location !== '' ? {location: answer.location} : {})}).end(answer.body);
      });
    });
    server.on('connection', socket => { connections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      assert.ok(address !== null && typeof address !== 'string');
      await body(`https://127.0.0.1:${address.port}`, calls, certificate, (status, text, location = '') => { answer = {status, body: text, location}; }, () => connections);
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    }
  } finally {
    setDefaultCACertificates(originalTrust);
    await rm(directory, {recursive: true, force: true});
  }
}

it('HTTPS verifies trust before publishing and never follows a redirect or retries a lost answer', () => withHttps(async (url, calls, certificate, respond, connections) => {
  const message = prepareMessage('bunny/core', session('s1', 1));
  const send = (timeoutMs = 2000) => publishOnce({url, source: 'bunny/core', token: 'tok_SYNTHETIC566', timeoutMs}, KEY, message);
  const untrusted = await send();
  assert.equal(untrusted.status, 'rejected');
  if (untrusted.status === 'rejected') assert.equal(untrusted.error.error.code, 'unavailable');
  assert.equal(calls.length, 0, 'an untrusted peer receives no credential or publication');
  setDefaultCACertificates([...getCACertificates('default'), certificate]);
  const beforeWrongName = connections();
  const wrongName = await publishOnce({url: url.replace('127.0.0.1', 'localhost'), source: 'bunny/core', token: 'tok_SYNTHETIC566', timeoutMs: 2000}, KEY, message);
  assert.equal(wrongName.status, 'rejected');
  if (wrongName.status === 'rejected') assert.equal(wrongName.error.error.code, 'unavailable');
  assert.ok(connections() > beforeWrongName, 'the wrong-name case reaches the same TLS listener');
  assert.equal(calls.length, 0, 'a trusted certificate for another hostname receives no publication');
  assert.deepEqual(await send(), {status: 'published'});
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0] ?? '{}'), {schema: REMOTE_SCHEMA, key: KEY, message});
  await withServer(() => ({status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'})}), async (destination, redirected) => {
    respond(302, '', destination);
    const result = await send();
    assert.equal(result.status, 'uncertain');
    assert.equal(calls.length, 2);
    assert.equal(redirected.length, 0, 'HTTPS never downgrades or forwards credentials');
  });
  respond(0, '');
  const result = await send(150);
  assert.equal(result.status, 'uncertain');
  if (result.status === 'uncertain') assert.equal(result.error.error.code, 'uncertain-result');
  assert.equal(calls.length, 3, 'one attempt per invocation, including the lost answer');
}));

it('TLS negotiation that never completes is bounded and has not sent an HTTP publication', async () => {
  const sockets = new Set<Socket>();
  let received = '';
  const server = createListener(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.on('data', (chunk: Buffer) => { received += chunk.toString('latin1'); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const before = performance.now();
    const result = await publishOnce({url: `https://127.0.0.1:${address.port}`, source: 'bunny/core', token: 'tok_SYNTHETIC566', timeoutMs: 150}, KEY, prepareMessage('bunny/core', session('s1', 1)));
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.equal(result.error.error.code, 'unavailable');
    assert.ok(performance.now() - before < 1000, 'DNS, TCP and TLS share the whole-call deadline');
    assert.ok(received.length > 0, 'the server observed a TLS handshake');
    assert.equal(received.includes('tok_SYNTHETIC566'), false);
    assert.equal(received.includes('POST '), false);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, 'close');
  }
});

it('a host publication check runs after ordinary admission and before any bus effect', async () => {
  const seen: string[] = [], checked: string[] = [];
  let allowed = false;
  await withEdge(async edge => {
    await edge.bus.connect('bunny/second').subscribe(KEY, message => { seen.push(message.id); });
    const message = prepareMessage('bunny/core', session('s1', 1));
    const send = () => publishOnce({url: edge.url, source: 'bunny/core', token: 'synthetic-policy-token', timeoutMs: 2000}, KEY, message);
    const refused = await send();
    assert.equal(refused.status, 'rejected');
    if (refused.status === 'rejected') assert.equal(refused.error.error.code, 'forbidden');
    assert.deepEqual(checked, [message.id]);
    assert.deepEqual(seen, [], 'the host refusal precedes publication');
    for (const body of [
      {key: KEY, message: {...message, bunnyprofile: '3.0'}},
      {key: KEY, message: {...message, source: 'bunny/wall'}},
      {key: 'bunny.event.test-turn.s1', message},
    ]) {
      const response = await fetch(edge.url + REMOTE_PATH + '/publish', {method: 'POST', headers: {authorization: 'Bearer synthetic-policy-token', 'content-type': 'application/json'},
        body: JSON.stringify({schema: REMOTE_SCHEMA, ...body})});
      assert.ok(response.status >= 400);
      await response.body?.cancel();
    }
    assert.deepEqual(checked, [message.id], 'invalid schema, forged source and wider routing never reach the host check');
    allowed = true;
    assert.deepEqual(await send(), {status: 'published'});
    await until(() => seen.length === 1, 'the accepted publication');
    assert.deepEqual(checked, [message.id, message.id]);
  }, {authenticate: request => request.headers.authorization === 'Bearer synthetic-policy-token' ? {
    source: 'bunny/core', calls: ['publish'], keys: [KEY], publishes: [SESSION_FAMILY],
    checkPublication: (message: Message) => {
      checked.push(message.id);
      return allowed ? undefined : errorBody('forbidden', {detail: 'the host refuses this publication'});
    },
  } : undefined});
});

async function withEdge(body: (edge: Edge) => Promise<void>, setup: Parameters<typeof startEdge>[0] = {}): Promise<void> {
  const edge = await startEdge(setup);
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
}

/** A loopback server for the cases no edge produces: it records each call and answers as `answer` says, or never. */
async function withServer(answer: ((request: IncomingMessage, body: string, response: ServerResponse) => {status: number; body: string} | undefined), body: (url: string, calls: {headers: IncomingMessage['headers']; url: string; body: string}[]) => Promise<void>): Promise<void> {
  const calls: {headers: IncomingMessage['headers']; url: string; body: string}[] = [];
  const server: Server = createServer((request, response) => {
    let text = '';
    request.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });
    request.once('end', () => {
      calls.push({headers: request.headers, url: request.url ?? '', body: text});
      const given = answer(request, text, response);
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
  // The credential cannot declare another source in its header, even when the message still names its own source.
  const claimed = await publishOnce({...options, source: 'bunny/wall'}, KEY, message);
  assert.equal(claimed.status === 'rejected' ? claimed.error.error.code : claimed.status, 'forbidden');
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

it('a partial answer does not extend the publication deadline, and a late success never retries the call', async () => {
  let held: ServerResponse | undefined;
  let progress: ReturnType<typeof setInterval> | undefined;
  let completion: ReturnType<typeof setTimeout> | undefined;
  let chunks = 0;
  let completed = false;
  try {
    await withServer((_request, _body, response) => {
      held = response;
      response.writeHead(200, {'content-type': 'application/json'}).write(`{"schema":"${REMOTE_SCHEMA}","status":`);
      // Keep making progress across the original deadline. An inactivity timeout would wrongly wait for this answer.
      progress = setInterval(() => { response.write(' '); chunks += 1; }, 50);
      completion = setTimeout(() => {
        completed = true;
        clearInterval(progress);
        response.end('"published"}');
      }, 1000);
      return undefined;
    }, async (url, calls) => {
      const message = prepareMessage('bunny/core', session('s1', 1));
      const timeoutMs = 300;
      const started = performance.now();
      const result = await publishOnce({url, source: 'bunny/core', token: 'tok_SYNTHETIC566', timeoutMs}, KEY, message);
      const elapsed = performance.now() - started;
      assert.deepEqual(result, {
        status: 'uncertain', error: errorBody('uncertain-result', {
          traceId: trace(message.traceparent).traceId, detail: 'the edge did not answer within 300 ms; the message may have been published',
        }),
      });
      assert.ok(elapsed >= 290 && elapsed < 750, `the whole call settled at its deadline, after ${Math.round(elapsed)} ms`);
      assert.ok(chunks >= 2, 'the synthetic edge made repeated progress before the deadline');
      assert.equal(completed, false, 'the call settled before the continuing response completed');
      assert.equal(calls.length, 1);
      assert.ok(held, 'the synthetic edge received the request and began its answer');
      clearInterval(progress);
      clearTimeout(completion);
      held.end('"published"}');
      // Watch beyond another call budget: completing the late response must not trigger a fresh publication.
      await new Promise(resolve => { setTimeout(resolve, timeoutMs + 50); });
      assert.equal(calls.length, 1, 'no automatic retry follows the uncertain result or the late response');
      assert.deepEqual(JSON.parse(calls[0]?.body ?? '{}'), {schema: REMOTE_SCHEMA, key: KEY, message});
    });
  } finally {
    clearInterval(progress);
    clearTimeout(completion);
  }
});

/** Whether `text` holds a whole HTTP request: its head and as many body bytes as its `content-length` names. */
function complete(text: string): boolean {
  const head = text.indexOf('\r\n\r\n');
  const length = /^content-length: (\d+)$/im.exec(text)?.[1];
  return head >= 0 && length !== undefined && Buffer.byteLength(text.slice(head + 4)) >= Number(length);
}

it('an edge whose connection drops after it read the call is uncertain: the message may have been published', async () => {
  // A listener that reads the whole call, then ends the connection with no answer, or resets it.
  const endings: [string, (socket: Socket) => void][] = [['ended', socket => { socket.end(); }], ['reset', socket => { socket.resetAndDestroy(); }]];
  for (const [name, end] of endings) {
    let read = '';
    const listener = createListener(socket => {
      socket.setEncoding('utf8').on('data', (chunk: string) => {
        read += chunk;
        if (complete(read)) end(socket);
      });
      socket.on('error', () => {});
    });
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    try {
      const message = prepareMessage('bunny/core', session('s1', 1));
      const started = performance.now();
      const result = await publishOnce({url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 2000}, KEY, message);
      assert.equal(result.status, 'uncertain', name);
      assert.deepEqual(result.status === 'uncertain' ? result.error.error : undefined, {
        ...errorBody('uncertain-result', {traceId: trace(message.traceparent).traceId, detail: 'the edge\'s connection ended before its answer; the message may have been published'}).error,
      }, name);
      assert.ok(performance.now() - started < 1000, `${name}: settled when the connection ended, not at the deadline`);
      assert.ok(read.includes(JSON.stringify(message.id)), `${name}: the listener read the call`);
    } finally {
      listener.close();
      await once(listener, 'close');
    }
  }
});

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
  await withServer(() => ({status: 200, body: JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'})}), async (url, calls) => {
    for (const timeoutMs of [0, -1, 1.5, MAX_TIMEOUT_MS + 1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      await assert.rejects(publishOnce({url, source: 'bunny/core', token: 't', timeoutMs}, KEY, message), refused('invalid-request'), String(timeoutMs));
    }
    for (const invalidUrl of ['http://owner:secret@127.0.0.1:1', 'https://127.0.0.1:1?secret=x', 'https://127.0.0.1:1#fragment', 'ws://127.0.0.1:1', 'ftp://127.0.0.1:1', 'file:///synthetic', 'not a url']) {
      await assert.rejects(publishOnce({url: invalidUrl, source: 'bunny/core', token: 't', timeoutMs: 100}, KEY, message), refused('invalid-request'), invalidUrl);
    }
    for (const invalidHeaders of [{token: 'tok_SYNTHETIC566\r\ninjected: value'}, {token: 'tok_SYNTHETIC566\0'}, {source: 'bunny/core\ninjected: value'}]) {
      await assert.rejects(publishOnce({url, source: 'bunny/core', token: 't', timeoutMs: 100, ...invalidHeaders}, KEY, message), refused('invalid-request'));
    }
    assert.equal(calls.length, 0);
    assert.deepEqual(await publishOnce({url, source: 'bunny/core', token: 'synthetic-token', timeoutMs: 2000}, KEY, message), {status: 'published'});
    assert.equal(calls.length, 1, 'the valid control reaches the same synthetic edge');
  });
});
