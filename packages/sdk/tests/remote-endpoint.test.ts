import assert from 'node:assert/strict';
import {SdkError, REMOTE_PATH, REMOTE_SCHEMA, type EdgePermissions, type Reply, type Command} from '../src/index.js';
import {buildMessage} from '../src/envelope.js';
import {EventStreamParser} from '../src/remote-protocol.js';
import {it, session, setMode, turnEnded, until, deferred, manualClock, type Mode} from './support.js';
import {startEdge, type Edge} from './transports.js';

const permissions: EdgePermissions = {calls: ['subscribe'], keys: ['bunny.state.*.*'], publishes: [],
  endpoint: {respond: ['test-mode'], publish: ['test-session'], request: ['test-mode']}};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;
const trace = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};

async function rawStream(edge: Edge): Promise<{connection: string; endpoint: string; cancel(): Promise<void>}> {
  const response = await fetch(`${edge.url}${REMOTE_PATH}/stream`, {headers: {authorization: `Bearer ${edge.tokens.get('bunny/wall') ?? ''}`}});
  assert.equal(response.status, 200); assert.ok(response.body);
  const reader = response.body.getReader(), parser = new EventStreamParser(), decoder = new TextDecoder();
  for (;;) {
    const {value, done} = await reader.read(); assert.equal(done, false);
    for (const frame of parser.push(decoder.decode(value, {stream: true}))) {
      if (frame.event !== 'ready') continue;
      const ready: unknown = JSON.parse(frame.data);
      assert.ok(typeof ready === 'object' && ready !== null && 'connection' in ready && 'endpointCapability' in ready);
      assert.equal(typeof ready.connection, 'string'); assert.equal(typeof ready.endpointCapability, 'string');
      if (typeof ready.connection !== 'string' || typeof ready.endpointCapability !== 'string') throw new Error('invalid ready frame');
      return {connection: ready.connection, endpoint: ready.endpointCapability, cancel: () => reader.cancel()};
    }
  }
}

async function call(edge: Edge, route: string, body: object): Promise<{status: number; body: unknown}> {
  const response = await fetch(`${edge.url}${REMOTE_PATH}/${route}`, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${edge.tokens.get('bunny/wall') ?? ''}`},
    body: JSON.stringify({schema: REMOTE_SCHEMA, ...body}),
  });
  return {status: response.status, body: await response.json() as unknown};
}

it('a tab cannot register another stream\'s endpoint identity or reuse a retired identity', async () => {
  const edge = await startEdge({authenticate: () => ({source: 'bunny/wall', id: 'shared-browser', ...permissions})});
  const first = await rawStream(edge), second = await rawStream(edge);
  try {
    const id = `${first.connection}-1`, pattern = `bunny.cmd.test-mode.${id}`;
    assert.equal((await call(edge, 'respond', {...first, id, pattern})).status, 200);
    assert.equal((await call(edge, 'close', {...first, id})).status, 200);
    assert.equal((await call(edge, 'respond', {...second, id, pattern})).status, 403);
    assert.equal((await call(edge, 'respond', {...first, id, pattern})).status, 403);
  } finally {await first.cancel(); await second.cancel(); await edge.close();}
});

it('raw endpoint calls require the current capability, own routing identity and declared payload family', async () => {
  const retired: {source: string; id: string}[] = [], published: unknown[] = [];
  const edge = await startEdge({authenticate: () => ({source: 'bunny/wall', id: 'shared-browser', ...permissions}),
    onEndpointClosed: endpoint => {retired.push(endpoint);}});
  const first = await rawStream(edge), second = await rawStream(edge);
  const id = `${first.connection}-1`, other = `${second.connection}-1`, pattern = `bunny.cmd.test-mode.${id}`;
  try {
    await edge.bus.connect('bunny/core').subscribe('bunny.state.test-session.*', message => {published.push(message);});
    const attempts: unknown[] = [];
    for (const binding of [{connection: first.connection}, {...first, endpoint: second.endpoint}, {...second, endpoint: first.endpoint}]) {
      const result = await call(edge, 'respond', {...binding, id, pattern});
      assert.equal(result.status, 403); attempts.push(result);
    }
    assert.equal((await call(edge, 'respond', {...first, id, pattern: 'bunny.cmd.test-mode.*'})).status, 403);
    assert.equal((await call(edge, 'respond', {...first, id, pattern: `bunny.cmd.test-session.${id}`})).status, 403);
    assert.equal((await call(edge, 'respond', {...first, id, pattern})).status, 200);
    assert.equal((await call(edge, 'respond', {...second, id: other, pattern: `bunny.cmd.test-mode.${other}`})).status, 200);
    const message = buildMessage('bunny/wall', 'state', session(id, 1), trace, Date.now());
    const publication = {key: `bunny.state.test-session.${id}`, message};
    for (const binding of [{connection: first.connection}, {...first, endpoint: second.endpoint}, second]) {
      const result = await call(edge, 'publish', {...binding, ...publication});
      assert.equal(result.status, 403); attempts.push(result);
    }
    const wrongFamily = buildMessage('bunny/wall', 'occurrence', turnEnded(id), trace, Date.now());
    assert.equal((await call(edge, 'publish', {...first, ...publication, message: wrongFamily})).status, 403);
    assert.equal((await call(edge, 'publish', {...first, ...publication})).status, 200);
    assert.equal((await call(edge, 'close', {connection: first.connection, id})).status, 403);
    assert.equal((await call(edge, 'close', {...second, id})).status, 403);
    assert.equal((await call(edge, 'close', {...first, id})).status, 200);
    assert.equal((await call(edge, 'publish', {...first, ...publication})).status, 403);
    assert.deepEqual(retired, [{source: 'bunny/wall', id}]);
    await until(() => published.length === 1, 'only the authorized receipt');
    const evidence = JSON.stringify({published, retired, diagnostics: edge.diagnostics, attempts});
    assert.equal(evidence.includes(first.endpoint), false); assert.equal(evidence.includes(second.endpoint), false);
    await second.cancel(); await until(() => retired.length === 2, 'stream loss retirement');
    assert.equal((await call(edge, 'close', {...second, id: other})).status, 404);
  } finally {await first.cancel(); await second.cancel(); await edge.close();}
});

it('closing during a running handler retires its command as uncertain and discards the late reply', async () => {
  const edge = await startEdge({permissions: {'bunny/wall': permissions}}), held = deferred<Reply>();
  try {
    const page = await edge.connect('bunny/wall'), core = edge.bus.connect('bunny/core');
    let started = false, closed = false;
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: () => {started = true; return held.promise;}, onClosed: () => {closed = true;}});
    const pending = core.request(`bunny.cmd.test-mode.${endpoint.id}`, {...setMode('work'), subject: endpoint.id}, {timeoutMs: 5000});
    await until(() => started, 'running endpoint handler');
    const closing = endpoint.close(); assert.equal(closed, true);
    assert.equal((await pending).status, 'uncertain');
    held.resolve({status: 'accepted'}); await closing;
    assert.equal(edge.received('reply'), 0);
    const fresh = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})});
    assert.equal((await core.request(`bunny.cmd.test-mode.${fresh.id}`, {...setMode('work'), subject: fresh.id}, {timeoutMs: 500})).status, 'accepted');
    await fresh.close();
  } finally {held.resolve({status: 'accepted'}); await edge.close();}
});

it('an ordinary responder on another stream cannot forge an endpoint reply', async () => {
  const edge = await startEdge({authenticate: () => ({source: 'bunny/wall', id: 'shared-browser', ...permissions, calls: ['respond']})});
  const held = deferred<Reply>(), arrived = deferred<Command<object>>();
  const other = await rawStream(edge);
  try {
    const page = await edge.connect('bunny/wall'), core = edge.bus.connect('bunny/core');
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: command => {arrived.resolve(command); return held.promise;}});
    const pending = core.request(`bunny.cmd.test-mode.${endpoint.id}`, {...setMode('work'), subject: endpoint.id}, {timeoutMs: 5000});
    const command = await arrived.promise;
    try {
      const forged = await call(edge, 'reply', {connection: other.connection, responder: endpoint.id, command: command.id,
        requestId: command.data.requestId, reply: {status: 'accepted'}});
      assert.equal(forged.status, 403);
    } finally {held.resolve({status: 'accepted'}); await pending; await endpoint.close();}
  } finally {await other.cancel(); await edge.close();}
});

it('closing an endpoint withdraws its queued raw request before another handler can act', async () => {
  const edge = await startEdge({permissions: {'bunny/wall': {...permissions,
    endpoint: {respond: ['test-output'], publish: [], request: ['test-mode']}}}});
  const stream = await rawStream(edge), held = deferred<Reply>(), seen: string[] = [];
  const id = `${stream.connection}-1`, core = edge.bus.connect('bunny/core');
  let queued: Promise<unknown> | undefined;
  try {
    await core.respond('bunny.cmd.test-mode.*', command => {seen.push(command.subject); return held.promise;});
    const first = core.request('bunny.cmd.test-mode.busy', setMode('work', 'busy'), {timeoutMs: 5000});
    await until(() => seen.length === 1, 'occupied control handler');
    assert.equal((await call(edge, 'respond', {...stream, id, pattern: `bunny.cmd.test-output.${id}`})).status, 200);
    const now = Date.now();
    const command = buildMessage('bunny/wall', 'command', {...setMode('quiet', id), data: {mode: 'quiet', requestId: crypto.randomUUID()}}, trace, now, now + 5000);
    queued = call(edge, 'request', {...stream, key: `bunny.cmd.test-mode.${id}`, command});
    await until(() => edge.received('request') === 1, 'raw endpoint request queued');
    assert.equal((await call(edge, 'close', {...stream, id})).status, 200);
    held.resolve({status: 'accepted'}); await first; await queued;
    assert.deepEqual(seen, ['busy']);
  } finally {held.resolve({status: 'accepted'}); await queued; await stream.cancel(); await edge.close();}
});

it('an explicit endpoint alone receives commands and publishes through its narrowly granted families', async () => {
  const edge = await startEdge({permissions: {'bunny/wall': permissions}});
  try {
    const page = await edge.connect('bunny/wall'), core = edge.bus.connect('bunny/core');
    const commands: string[] = [];
    const endpoint = await page.openEndpoint<Mode>({family: 'test-mode', respond: command => {
      commands.push(command.subject); return {status: 'accepted'};
    }});
    const received = await core.request(`bunny.cmd.test-mode.${endpoint.id}`, {...setMode('work'), subject: endpoint.id}, {timeoutMs: 500});
    assert.equal(received.status, 'accepted'); assert.deepEqual(commands, [endpoint.id]);
    const published = await endpoint.publish('test-session', session(endpoint.id, 1));
    assert.equal(published.subject, endpoint.id); assert.equal(published.source, 'bunny/wall');
    assert.equal((await endpoint.request('test-mode', setMode('quiet'), {timeoutMs: 500})).status, 'accepted');
    await assert.rejects(page.respond('bunny.cmd.test-mode.*', () => ({status: 'accepted'})), refused('forbidden'));
    await assert.rejects(page.publish(`bunny.state.test-session.${endpoint.id}`, session(endpoint.id, 2)), refused('forbidden'));
    await assert.rejects(endpoint.publish('other-family', session(endpoint.id, 3)), refused('forbidden'));
    assert.equal((await endpoint.request('other-family', setMode('quiet'), {timeoutMs: 500})).status, 'rejected');
    await endpoint.close();
  } finally {await edge.close();}
});

it('disconnect retires the endpoint immediately and reconnect restores no handler or availability', async () => {
  const edge = await startEdge({permissions: {'bunny/wall': permissions}});
  try {
    const page = await edge.connect('bunny/wall'); let closed = 0, commands = 0;
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: () => {commands += 1; return {status: 'accepted'};}, onClosed: () => {closed += 1;}});
    edge.edge.disconnect('bunny/wall');
    await until(() => closed === 1, 'endpoint closure');
    await until(() => edge.diagnostics.some(item => item.event === 'remote.reconnected'), 'ordinary transport recovery');
    await assert.rejects(endpoint.publish('test-session', session(endpoint.id, 1)), refused('unavailable'));
    const core = edge.bus.connect('bunny/core');
    assert.equal((await core.request(`bunny.cmd.test-mode.${endpoint.id}`, {...setMode('work'), subject: endpoint.id}, {timeoutMs: 500})).status, 'rejected');
    assert.equal(commands, 0); assert.equal(closed, 1);
    const fresh = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})});
    assert.notEqual(fresh.id, endpoint.id); await fresh.close();
  } finally {await edge.close();}
});

it('closing an endpoint drops it before waiting for a handler and makes a fresh explicit endpoint distinct', async () => {
  const edge = await startEdge({permissions: {'bunny/wall': permissions}});
  try {
    const page = await edge.connect('bunny/wall'); let closed = 0;
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'}), onClosed: () => {closed += 1;}});
    await assert.rejects(page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})}), refused('invalid-state'));
    await endpoint.close(); await endpoint.close(); assert.equal(closed, 1);
    await assert.rejects(endpoint.publish('test-session', session(endpoint.id, 1)), refused('unavailable'));
    const fresh = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})});
    assert.notEqual(fresh.id, endpoint.id); await fresh.close();
  } finally {await edge.close();}
});

it('a client without an explicit endpoint grant cannot open one', async () => {
  const edge = await startEdge();
  try {
    const page = await edge.connect('bunny/wall');
    await assert.rejects(page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})}), refused('forbidden'));
  } finally {await edge.close();}
});

it('endpoint registration lost before its acknowledgment cannot reappear after reconnect', async () => {
  const held = deferred<void>();
  let arrived = false;
  const edge = await startEdge({permissions: {'bunny/wall': permissions}, before: (route, nth) => {
    if (route !== 'respond' || nth !== 1) return undefined;
    arrived = true; return held.promise;
  }});
  try {
    const page = await edge.connect('bunny/wall'); let closed = 0;
    const opening = page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'}), onClosed: () => {closed += 1;}});
    const rejected = assert.rejects(opening, refused('unavailable'));
    await until(() => arrived, 'registration reached edge');
    edge.edge.disconnect('bunny/wall'); await until(() => closed === 1, 'pending endpoint retired'); held.resolve();
    await rejected;
    await until(() => edge.diagnostics.some(item => item.event === 'remote.reconnected'), 'reconnect');
    const fresh = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})}); await fresh.close();
  } finally {held.resolve(); await edge.close();}
});

it('an endpoint registration without acknowledgment ends at its deadline', async () => {
  const held = deferred<void>(), clock = manualClock(); let arrived = false, closed = false;
  const edge = await startEdge({permissions: {'bunny/wall': permissions}, before: route => {
    if (route !== 'respond') return undefined;
    arrived = true; return held.promise;
  }});
  try {
    const page = await edge.connect('bunny/wall', {scheduler: clock.scheduler});
    const opening = page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'}), onClosed: () => {closed = true;}});
    const rejected = assert.rejects(opening, refused('unavailable'));
    await until(() => arrived, 'registration waiting for acknowledgment');
    clock.advance(5000);
    await until(() => closed, 'bounded registration retirement'); await rejected;
  } finally {held.resolve(); await edge.close();}
});

it('an interrupted endpoint publication rejects with the shared SDK error', async () => {
  const held = deferred<void>(); let arrived = false;
  const edge = await startEdge({permissions: {'bunny/wall': permissions}, before: route => {
    if (route !== 'publish') return undefined;
    arrived = true; return held.promise;
  }});
  try {
    const page = await edge.connect('bunny/wall');
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})});
    const rejected = assert.rejects(endpoint.publish('test-session', session(endpoint.id, 1)), refused('unavailable'));
    await until(() => arrived, 'receipt submission'); await endpoint.close(); await rejected;
  } finally {held.resolve(); await edge.close();}
});


it('an unanswered endpoint publication retires within five seconds while its stream remains healthy', async () => {
  const held = deferred<void>(), clock = manualClock(); let arrived = 0, closed = false, settled = false;
  const edge = await startEdge({permissions: {'bunny/wall': permissions}, before: route => {
    if (route !== 'publish') return undefined;
    arrived += 1; return held.promise;
  }});
  try {
    const page = await edge.connect('bunny/wall', {scheduler: clock.scheduler});
    const endpoint = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'}), onClosed: () => {closed = true;}});
    const rejected = assert.rejects(endpoint.publish('test-session', session(endpoint.id, 1)), refused('unavailable')).then(() => {settled = true;});
    await until(() => arrived === 1, 'receipt waiting for acknowledgment');
    clock.advance(4999); assert.equal(closed, false); assert.equal(settled, false);
    clock.advance(1); await until(() => closed && settled, 'bounded publication retirement'); await rejected;
    assert.equal(arrived, 1, 'a lost receipt is never republished');
    assert.equal(edge.diagnostics.some(item => item.event === 'remote.disconnected'), false, 'the receipt deadline does not require a lost stream');
    const fresh = await page.openEndpoint({family: 'test-mode', respond: () => ({status: 'accepted'})});
    assert.notEqual(fresh.id, endpoint.id); await fresh.close();
  } finally {held.resolve(); await edge.close();}
});
