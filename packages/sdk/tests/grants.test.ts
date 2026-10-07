// What the remote edge lets each part do, and how it keeps a stalled reader from pinning memory (Hub #835): a grant's
// calls and routing-key patterns, the source a part declares, the commands it has sent until their expiry, and the
// heartbeat and stall limit of each stream. The remote transport's other behavior is in remote.test.ts.
import assert from 'node:assert/strict';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from '../src/envelope.js';
import {
  InProcessBus, REMOTE_PATH, REMOTE_SCHEMA, RemoteEdge, SOURCE_HEADER, SdkError, connectRemote, type Command,
} from '../src/index.js';
import {
  MODE_SCHEMA, SESSION_FAMILY, blob, checked, flush, it, manualClock, modeSet, session, setMode, turnEnded, until, validator, type Mode, type Session,
} from './support.js';
import {startEdge, type Edge, type EdgeSetup, type Source} from './transports.js';

const TRACE = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const codeOf = (error: unknown): string => error instanceof SdkError ? error.body.error.code : `threw ${String(error)}`;
const tokenOf = (edge: Edge, source: Source): string => edge.tokens.get(source) ?? '';

async function withEdge(options: EdgeSetup, body: (edge: Edge) => Promise<void>): Promise<void> {
  const edge = await startEdge(options);
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
}

/** A raw call to the edge, as a remote part that does not use the client would make it. */
async function call(edge: Edge, path: string, body: unknown, token: string, headers: Record<string, string> = {}): Promise<{status: number; body: unknown}> {
  const response = await fetch(`${edge.url}${REMOTE_PATH}/${path}`, {
    method: 'POST', body: JSON.stringify(body), headers: {'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers},
  });
  return {status: response.status, body: await response.json() as unknown};
}

/** A command message from `source` for `subject`, built as a raw HTTP client would build it. */
function command(source: string, requestId: string, timeoutMs = 10_000, subject = 'wall', sentAtMs = Date.now()): Command<Mode> {
  return buildMessage<Mode & {requestId: string}>(source, 'command', {
    type: 'org.bunny.mode.set.requested', subject, dataschema: MODE_SCHEMA, data: {mode: 'work', requestId},
  }, TRACE, sentAtMs, sentAtMs + timeoutMs);
}

// The hook may only publish its own observations; the reader may only read; the panel may command only one device.
const GRANTED: EdgeSetup = {permissions: {
  'bunny/rogue': {calls: ['publish'], keys: ['bunny.event.test-turn.*']},
  'bunny/second': {calls: ['subscribe', 'sync'], keys: ['bunny.state.*.*', 'bunny.event.*.*']},
  'bunny/wall': {calls: ['request', 'subscribe'], keys: ['bunny.cmd.mode.wall', 'bunny.state.test-session.*']},
}};

it('a grant may make only the calls it lists, on the routing keys its patterns cover, and is refused as forbidden otherwise', () => withEdge(GRANTED, async edge => {
  const owner = checked(edge.bus.connect('bunny/core'));
  await owner.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  await owner.serveSync([SESSION_FAMILY, 'test-blob'], () => ({revision: 1, states: [session('s1', 1)]}));

  // The hook connects, since a stream carries only what its other calls opened, and publishes its observation.
  const hook = await edge.connect('bunny/rogue');
  await hook.publish('bunny.event.test-turn.s1', turnEnded('s1'));
  await assert.rejects(hook.publish(`bunny.state.${SESSION_FAMILY}.s1`, session('s1', 2)), (error: unknown) => codeOf(error) === 'forbidden', 'a key outside its patterns');
  const commanded = await hook.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000});
  assert.equal(commanded.status === 'rejected' && commanded.error.error.code, 'forbidden', 'a hook grant may not request a command');
  await assert.rejects(hook.subscribe('bunny.event.test-turn.*', () => {}), (error: unknown) => codeOf(error) === 'forbidden', 'nor subscribe');
  // A sync subscribes to its families' states first, which the hook may not do either.
  await assert.rejects(hook.sync([SESSION_FAMILY], () => {}, {timeoutMs: 1000}), (error: unknown) => codeOf(error) === 'forbidden', 'nor sync');

  // The reader reads everything, and may change nothing.
  const reader = await edge.connect('bunny/second');
  const synced = await reader.sync([SESSION_FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  if (synced.status === 'synced') await synced.copy.close();
  await assert.rejects(reader.publish('bunny.event.test-turn.s1', turnEnded('s1')), (error: unknown) => codeOf(error) === 'forbidden');
  await assert.rejects(reader.respond('bunny.cmd.mode.*', () => ({status: 'accepted'})), (error: unknown) => codeOf(error) === 'forbidden');
  await assert.rejects(reader.serveSync(['test-turn'], () => ({revision: 0, states: []})), (error: unknown) => codeOf(error) === 'forbidden');

  // The panel commands the one device its pattern names, and subscribes only within its state pattern.
  const panel = await edge.connect('bunny/wall');
  assert.equal((await panel.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000})).status, 'accepted');
  const other = await panel.request('bunny.cmd.mode.desk', setMode('work'), {timeoutMs: 1000});
  assert.equal(other.status === 'rejected' && other.error.error.code, 'forbidden', 'another device\'s key');
  await panel.subscribe(`bunny.state.${SESSION_FAMILY}.s1`, () => {});
  await assert.rejects(panel.subscribe('bunny.state.*.*', () => {}), (error: unknown) => codeOf(error) === 'forbidden', 'a pattern wider than its grant');
  await assert.rejects(panel.sync(['test-blob'], () => {}, {timeoutMs: 1000}), (error: unknown) => codeOf(error) === 'forbidden', 'a family outside its patterns');
  // A raw sync request, without the client's subscriptions first, is refused as a call its grant does not list.
  const sentAtMs = Date.now();
  const request = buildMessage('bunny/wall', 'sync-request', {
    type: 'org.bunny.sync.requested', subject: SESSION_FAMILY, dataschema: 'https://bunny.invalid/events/sync-request/2.0',
    data: {requestId: 'sync-raw', families: [SESSION_FAMILY]},
  }, TRACE, sentAtMs, sentAtMs + 5000);
  const raw = await call(edge, 'sync', {schema: REMOTE_SCHEMA, request}, tokenOf(edge, 'bunny/wall'));
  assert.deepEqual([raw.status, (raw.body as ErrorBody).error.code], [403, 'forbidden']);

  // Each refusal is the edge's own, recorded as a warning with the part's source, before anything reached the bus.
  const refusals = edge.diagnostics.filter(record => record.event === 'edge.refused');
  assert.ok(refusals.length >= 8);
  assert.ok(refusals.every(record => record.code === 'forbidden' && record.level === 'warn' && record.source !== undefined));
  assert.equal(edge.diagnostics.some(record => record.event === 'command.admitted' && record.source === 'bunny/rogue'), false, 'the hook\'s command never reached the bus');
}));

it('an edge refuses grants whose calls or key patterns it cannot read, without naming the token', () => {
  const bus = new InProcessBus();
  const grant = (permissions: object) => () => new RemoteEdge({bus, validator, grants: [{source: 'bunny/hook', token: 'tok_SYNTHETIC835_grant', ...permissions}]});
  assert.throws(grant({calls: ['publish', 'stream']}), (error: unknown) => codeOf(error) === 'invalid-request' && !String((error as Error).message).includes('tok_'));
  assert.throws(grant({keys: ['bunny.event.lifecycle']}), (error: unknown) => codeOf(error) === 'invalid-request');
  assert.throws(grant({keys: 'bunny.event.*.*'}), (error: unknown) => codeOf(error) === 'invalid-request');
  assert.throws(grant({excluded: ['bunny.*.lamp-1']}), (error: unknown) => codeOf(error) === 'invalid-request', 'a malformed exclusion');
  assert.throws(grant({publishes: ['Lifecycle']}), (error: unknown) => codeOf(error) === 'invalid-request', 'a malformed family');
  assert.doesNotThrow(grant({calls: [], keys: []}), 'a grant may allow nothing');
});

it('a token used under another declared source is refused at connect, before it opens anything', () => withEdge({}, async edge => {
  const refused = await connectRemote({url: edge.url, source: 'bunny/wall', token: tokenOf(edge, 'bunny/core')}).then(
    async remote => { await remote.close(); return 'connected'; },
    (error: unknown) => codeOf(error),
  );
  assert.equal(refused, 'forbidden');
  const raw = await call(edge, 'publish', {}, tokenOf(edge, 'bunny/core'), {[SOURCE_HEADER]: 'bunny/wall'});
  assert.deepEqual([raw.status, (raw.body as ErrorBody).error.code], [403, 'forbidden']);
  assert.equal(edge.diagnostics.some(record => record.event === 'edge.connected'), false, 'no stream opened');
  // The part that declares its own source connects.
  const remote = await connectRemote({url: edge.url, source: 'bunny/core', token: tokenOf(edge, 'bunny/core')});
  await remote.close();
}));

it('a command a raw client sends again after its first forward settled is refused as duplicate-conflict, and the responder runs it once', () =>
  withEdge({}, async edge => {
    const runs: string[] = [];
    const responder = checked(await edge.connect('bunny/wall'));
    await responder.respond<Mode>('bunny.cmd.mode.*', received => { runs.push(received.data.requestId); return {status: 'accepted'}; });
    const sent = command('bunny/core', 'req-once');
    const send = (): Promise<{status: number; body: unknown}> => call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: sent}, tokenOf(edge, 'bunny/core'));
    const first = await send();
    assert.equal(first.status, 200);
    assert.equal((first.body as {result: {status: string}}).result.status, 'accepted', 'the first forward settled');
    const again = await send();
    assert.equal(again.status, 409);
    assert.deepEqual(again.body, errorBody('duplicate-conflict', {detail: 'this command was sent already; a command is never sent twice'}));
    await flush();
    assert.deepEqual(runs, ['req-once'], 'the responder ran the command once');
    // A new command, even with the same request ID, is a new message, and goes through.
    const fresh = await call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: command('bunny/core', 'req-once')}, tokenOf(edge, 'bunny/core'));
    assert.equal(fresh.status, 200);
    assert.deepEqual(runs, ['req-once', 'req-once']);
    const refusal = edge.diagnostics.find(record => record.event === 'edge.refused' && record.code === 'duplicate-conflict');
    assert.deepEqual(refusal, {event: 'edge.refused', level: 'warn', route: 'request', code: 'duplicate-conflict', source: 'bunny/core'});
  }));

it('a command refused before it reached the bus is not remembered, so the same message may be sent once it is valid', () => withEdge(
  {permissions: {'bunny/core': {calls: ['request'], keys: ['bunny.cmd.mode.wall']}}}, async edge => {
    await checked(edge.bus.connect('bunny/wall')).respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
    const sent = command('bunny/core', 'req-key');
    const outside = await call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.desk', command: sent}, tokenOf(edge, 'bunny/core'));
    assert.equal(outside.status, 403);
    const inside = await call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: sent}, tokenOf(edge, 'bunny/core'));
    assert.equal(inside.status, 200, 'the refusal had no effect, so the command is still new');
  }));

it('a command whose subject is not the last token of its key is refused as invalid-message on every transport, and no responder runs it', () =>
  withEdge({permissions: {'bunny/core': {calls: ['request'], keys: ['bunny.cmd.mode.wall']}}}, async edge => {
    const runs: string[] = [];
    await checked(edge.bus.connect('bunny/wall')).respond<Mode>('bunny.cmd.mode.*', received => { runs.push(received.subject); return {status: 'accepted'}; });
    // In process: a module that names another entity than its key's.
    const local = edge.bus.connect('bunny/second');
    await assert.rejects(local.request('bunny.cmd.mode.wall', setMode('work', 'desk'), {timeoutMs: 1000}), (error: unknown) => codeOf(error) === 'invalid-message');
    // Remotely: a raw client whose grant covers the wall's key, sending a command for the desk on it.
    const raw = await call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: command('bunny/core', 'req-desk', 10_000, 'desk')}, tokenOf(edge, 'bunny/core'));
    assert.deepEqual([raw.status, (raw.body as ErrorBody).error.code], [400, 'invalid-message']);
    // The SDK's own client is refused the same way.
    const remote = await edge.connect('bunny/core');
    const result = await remote.request('bunny.cmd.mode.wall', setMode('work', 'desk'), {timeoutMs: 1000});
    assert.equal(result.status === 'rejected' && result.error.error.code, 'invalid-message');
    await flush();
    assert.deepEqual(runs, [], 'no responder ran a misrouted command');
    assert.equal(edge.diagnostics.some(record => record.event === 'command.admitted'), false, 'nothing reached a queue');
    // The same command for the wall goes through.
    assert.equal((await remote.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 1000})).status, 'accepted');
    assert.deepEqual(runs, ['wall']);
  }));

it('a part publishes only messages whose subject is its key\'s last token, of the families its grant names', () => withEdge(
  {permissions: {'bunny/rogue': {calls: ['publish'], keys: ['bunny.event.*.*'], publishes: ['test-turn']}}}, async edge => {
    const heard: string[] = [];
    await checked(edge.bus.connect('bunny/second')).subscribe('bunny.event.*.*', message => { heard.push(message.type); });
    const hook = await edge.connect('bunny/rogue');
    await assert.rejects(hook.publish('bunny.event.test-turn.s1', turnEnded('s2')), (error: unknown) => codeOf(error) === 'invalid-message', 'another entity than its key\'s');
    // An outcome on an event key its patterns cover, which its grant does not let it publish.
    await assert.rejects(hook.publish('bunny.event.test-turn.wall', modeSet('req-forged')), (error: unknown) => codeOf(error) === 'forbidden', 'a family it may not publish');
    await flush();
    assert.deepEqual(heard, [], 'no subscriber heard either');
    await hook.publish('bunny.event.test-turn.s1', turnEnded('s1'));
    await until(() => heard.length === 1, 'its own observation');
    assert.deepEqual(heard, ['org.bunny.turn.ended']);
  }));

it('a grant\'s exclusions leave a device\'s messages and records out of what the part receives, and refuse its keys', () => withEdge(
  {permissions: {'bunny/second': {calls: ['subscribe', 'sync', 'request'], keys: ['bunny.state.*.*', 'bunny.event.*.*', 'bunny.cmd.mode.*'], excluded: ['bunny.*.*.s2']}}},
  async edge => {
    const owner = checked(edge.bus.connect('bunny/core'));
    let revision = 1;
    await owner.serveSync([SESSION_FAMILY], () => ({revision, states: [session('s1', revision), session('s2', revision)]}));
    await checked(edge.bus.connect('bunny/wall')).respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
    const reader = await edge.connect('bunny/second');
    const copy = await reader.sync<Session>([SESSION_FAMILY], () => {}, {timeoutMs: 5000});
    assert.equal(copy.status, 'synced');
    if (copy.status !== 'synced') return;
    assert.deepEqual(copy.copy.states().map(state => state.data.id), ['s1'], 'the sync answer leaves s2 out');
    assert.deepEqual(copy.message.data.members.map(member => member.id), ['s1'], 'and its membership');
    const heard: string[] = [];
    await reader.subscribe(`bunny.state.${SESSION_FAMILY}.*`, (message, key) => { heard.push(`${String(key)} ${message.subject}`); });
    revision = 2;
    await owner.publish(`bunny.state.${SESSION_FAMILY}.s2`, session('s2', 2));
    await owner.publish(`bunny.state.${SESSION_FAMILY}.s1`, session('s1', 2));
    await until(() => heard.length === 1 && copy.copy.states()[0]?.data.revision === 2, 's1\'s change');
    await flush();
    assert.deepEqual(heard, [`bunny.state.${SESSION_FAMILY}.s1 s1`], 'the subscription hears s1 alone, with its key');
    assert.deepEqual(copy.copy.states().map(state => `${state.data.id}@${state.data.revision}`), ['s1@2'], 'and so does the copy');
    assert.equal(edge.errors.some(({scope}) => scope.source === 'bunny/second'), false, 'what it may not see was never queued, so nothing dropped');
    const refused = await reader.request('bunny.cmd.mode.s2', setMode('work', 's2'), {timeoutMs: 1000});
    assert.equal(refused.status === 'rejected' && refused.error.error.code, 'forbidden', 'an excluded key may not be requested');
    assert.equal((await reader.request('bunny.cmd.mode.s1', setMode('work', 's1'), {timeoutMs: 1000})).status, 'accepted');
    await copy.copy.close();
  }));

it('one source at its quota of remembered commands is refused with capacity, and another source still gets through', () => withEdge(
  {commandMemory: {perSource: 2}}, async edge => {
    await checked(edge.bus.connect('bunny/second')).respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
    const send = (source: 'bunny/core' | 'bunny/wall', requestId: string): Promise<{status: number; body: unknown}> =>
      call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: command(source, requestId)}, tokenOf(edge, source));
    assert.equal((await send('bunny/core', 'req-1')).status, 200);
    assert.equal((await send('bunny/core', 'req-2')).status, 200);
    const full = await send('bunny/core', 'req-3');
    assert.deepEqual([full.status, (full.body as ErrorBody).error.code, (full.body as ErrorBody).error.retryable], [429, 'capacity', true]);
    assert.equal((await send('bunny/wall', 'req-other')).status, 200, 'another part is not locked out');
  }));

it('a command the bus refused before any responder had it is forgotten, and a settled one is remembered at most rememberMs', async () => {
  let now = Date.now();
  await withEdge({now: () => now, commandMemory: {rememberMs: 1000}}, async edge => {
    const sent = command('bunny/core', 'req-later', 60_000, 'wall', now);
    const send = (): Promise<{status: number; body: unknown}> => call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: sent}, tokenOf(edge, 'bunny/core'));
    const nobody = await send();
    assert.equal((nobody.body as {result: {error: ErrorBody}}).result.error.error.code, 'unavailable', 'no responder yet');
    const runs: string[] = [];
    await checked(edge.bus.connect('bunny/wall')).respond<Mode>('bunny.cmd.mode.*', received => { runs.push(received.data.requestId); return {status: 'accepted'}; });
    assert.equal(((await send()).body as {result: {status: string}}).result.status, 'accepted', 'the refused command was forgotten, so it may go again');
    assert.equal((await send()).status, 409, 'the one a responder ran is remembered');
    now += 999;
    assert.equal((await send()).status, 409);
    now += 1;
    assert.equal(((await send()).body as {result: {status: string}}).result.status, 'accepted', 'past rememberMs it is forgotten, though it has not expired');
    assert.deepEqual(runs, ['req-later', 'req-later']);
  });
});

it('the edge\'s refusals never quote what the caller sent, and every answer forbids sniffing', () => withEdge(
  {permissions: {'bunny/core': {calls: ['request', 'subscribe'], keys: ['bunny.cmd.mode.wall', 'bunny.state.*.*']}}}, async edge => {
    const marker = 'quoted-marker';
    const token = tokenOf(edge, 'bunny/core');
    const answers = [
      await fetch(`${edge.url}${REMOTE_PATH}/${marker}`, {method: 'POST', headers: {authorization: `Bearer ${token}`}}),
      await fetch(`${edge.url}${REMOTE_PATH}/request`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
        body: JSON.stringify({schema: REMOTE_SCHEMA, key: `bunny.cmd.mode.${marker}`, command: command('bunny/core', 'req-marker', 10_000, marker)})}),
      await fetch(`${edge.url}${REMOTE_PATH}/request`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
        body: JSON.stringify({schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command: command('bunny/wall', marker)})}),
    ];
    for (const answer of answers) {
      assert.equal(answer.headers.get('x-content-type-options'), 'nosniff');
      const text = await answer.text();
      assert.equal(text.includes(marker) || text.includes('bunny/wall'), false, text);
    }
    assert.deepEqual(answers.map(answer => answer.status), [404, 403, 403]);
  }));

/** Opens a raw stream and returns its connection id and the response, whose reading the caller controls. */
async function rawStream(edge: Edge, token: string): Promise<{connection: string; response: IncomingMessage; text: () => string}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${edge.url}${REMOTE_PATH}/stream`, {headers: {authorization: `Bearer ${token}`}}, response => {
      let text = '';
      const onData = (chunk: Buffer): void => {
        text += chunk.toString('utf8');
        const ready = /event: ready\ndata: (.*)\n\n/.exec(text);
        if (ready?.[1] === undefined) return;
        response.off('data', onData);
        // From here on the caller decides whether anything reads the stream.
        response.pause();
        const {connection} = JSON.parse(ready[1]) as {connection: string};
        resolve({connection, response, text: () => text});
      };
      response.on('data', onData);
    });
    request.once('error', reject);
    request.end();
  });
}

it('an open stream gets a heartbeat when nothing else flows', async () => {
  const clock = manualClock();
  await withEdge({liveness: clock.scheduler, heartbeatMs: 1000}, async edge => {
    const {response} = await rawStream(edge, tokenOf(edge, 'bunny/wall'));
    let received = '';
    response.on('data', (chunk: Buffer) => { received += chunk.toString('utf8'); });
    response.resume();
    clock.advance(999);
    await flush();
    assert.equal(received, '');
    clock.advance(1);
    await until(() => received === ': heartbeat\n\n', 'the first heartbeat');
    clock.advance(1000);
    await until(() => received === ': heartbeat\n\n: heartbeat\n\n', 'the second heartbeat');
    response.destroy();
  });
});

it('a stream whose reader stopped is ended at the stall limit, which frees its queued messages', async () => {
  const clock = manualClock();
  await withEdge({liveness: clock.scheduler, stallMs: 5000, heartbeatMs: 3_600_000, maxQueued: 8}, async edge => {
    const token = tokenOf(edge, 'bunny/wall');
    const {connection, response} = await rawStream(edge, token);
    const subscribed = await call(edge, 'subscribe', {schema: REMOTE_SCHEMA, connection, id: 'slow', pattern: 'bunny.state.test-blob.*'}, token);
    assert.equal(subscribed.status, 200);
    // The reader never reads again. The publisher fills the socket, then the subscription's queue.
    const sender = checked(edge.bus.connect('bunny/core'));
    for (let revision = 1; revision <= 60; revision += 1) {
      await sender.publish('bunny.state.test-blob.b1', blob('b1', revision, 100_000));
      await flush();
    }
    await until(() => edge.errors.some(({scope}) => scope.source === 'bunny/wall'), 'the full queue');
    assert.equal(edge.diagnostics.some(record => record.event === 'edge.disconnected'), false, 'a full socket alone ends nothing');
    clock.advance(5000);
    await until(() => edge.diagnostics.some(record => record.event === 'edge.disconnected'), 'the stalled stream ended');
    assert.deepEqual(edge.diagnostics.find(record => record.event === 'edge.disconnected'),
      {event: 'edge.disconnected', level: 'warn', route: 'stream', source: 'bunny/wall', code: 'capacity'});
    // The subscription is gone: what is published now waits nowhere for the stalled reader.
    const dropsBefore = edge.errors.length;
    await sender.publish('bunny.state.test-blob.b1', blob('b1', 61, 100_000));
    await flush();
    assert.equal(edge.errors.length, dropsBefore, 'no queue holds messages for the reader any more');
    response.destroy();
  });
});

it('a client whose stream stays silent past its idle limit reconnects, and its copy syncs again with nothing replayed', async () => {
  const clock = manualClock();
  // The edge sends no heartbeat in this test, as when the runtime's host slept with the stream open.
  await withEdge({heartbeatMs: 3_600_000}, async edge => {
    const owner = checked(edge.bus.connect('bunny/core'));
    let revision = 1;
    await owner.serveSync([SESSION_FAMILY], () => ({revision, states: [session('s1', revision)]}));
    const remote = checked(await edge.connect('bunny/wall', {liveness: clock.scheduler, idleMs: 2000}));
    const changes: string[] = [];
    const synced = await remote.sync<Session>([SESSION_FAMILY], change => { changes.push(change.type); }, {timeoutMs: 5000});
    assert.equal(synced.status, 'synced');
    revision = 2;
    clock.advance(2000);
    // The client ends the silent stream, reconnects after its backoff, and the copy syncs at the owner's new revision.
    await until(() => edge.diagnostics.some(record => record.event === 'remote.disconnected'), 'the client gave up on the silent stream');
    await until(() => synced.status === 'synced' && synced.copy.states()[0]?.data.revision === 2, 'the resync');
    assert.equal(changes.filter(type => type === 'synced').length, 2, 'the copy synced twice');
    if (synced.status === 'synced') await synced.copy.close();
  });
});

