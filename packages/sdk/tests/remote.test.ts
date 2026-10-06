// What only the remote transport has (Hub #883): authentication, validation at the edge, reconnects, a slow remote
// consumer and the 256 KiB cap on a sync answer. The shared behavior is in conformance.test.ts.
import assert from 'node:assert/strict';
import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from '../src/envelope.js';
import {REMOTE_PATH, REMOTE_SCHEMA, SdkError, type Overflow, type Reply, type SyncChange} from '../src/index.js';
import {SESSION_FAMILY, blob, checked, deferred, flush, it, session, setMode, turnEnded, until, type Session} from './support.js';
import {startEdge, type Edge} from './transports.js';

const FAMILY = SESSION_FAMILY;
const TRACE = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

async function withEdge(options: {maxQueued?: number}, body: (edge: Edge) => Promise<void>): Promise<void> {
  const edge = await startEdge(options);
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
}

/** A raw call to the edge, as a remote part that does not use the client would make it. */
async function call(edge: Edge, path: string, body: unknown, token?: string): Promise<{status: number; body: unknown}> {
  const response = await fetch(`${edge.url}${REMOTE_PATH}/${path}`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {'content-type': 'application/json', ...(token === undefined ? {} : {authorization: `Bearer ${token}`})},
  });
  return {status: response.status, body: await response.json() as unknown};
}

const tokenOf = (edge: Edge, source: 'bunny/core' | 'bunny/wall'): string => edge.tokens.get(source) ?? '';

it('a remote part needs its own token, and no token ever appears in a message, log or error', () => withEdge({}, async edge => {
  const message = buildMessage('bunny/core', 'state', session('s1', 1), TRACE, Date.now());
  const publish = {schema: REMOTE_SCHEMA, key: `bunny.state.${FAMILY}.s1`, message};
  const missing = await call(edge, 'publish', publish);
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, errorBody('unauthenticated', {detail: 'a bearer token is required'}));
  const wrong = await call(edge, 'publish', publish, 'not-a-granted-token');
  assert.equal(wrong.status, 401);
  assert.equal((wrong.body as ErrorBody).error.code, 'unauthenticated');
  const stream = await fetch(`${edge.url}${REMOTE_PATH}/stream`, {headers: {authorization: 'Bearer not-a-granted-token'}});
  assert.equal(stream.status, 401);
  await stream.body?.cancel();
  // A granted token acts only as its own source.
  const foreign = await call(edge, 'publish', publish, tokenOf(edge, 'bunny/wall'));
  assert.equal(foreign.status, 403);
  assert.equal((foreign.body as ErrorBody).error.code, 'forbidden');
  const accepted = await call(edge, 'publish', publish, tokenOf(edge, 'bunny/core'));
  assert.equal(accepted.status, 200);

  const core = checked(await edge.connect('bunny/core'));
  const wall = checked(await edge.connect('bunny/wall'));
  const seen: Message[] = [];
  await wall.subscribe(`bunny.state.${FAMILY}.*`, received => { seen.push(received); });
  const sent = await core.publish(`bunny.state.${FAMILY}.s2`, session('s2', 1));
  await assert.rejects(wall.publishMessage(`bunny.state.${FAMILY}.s2`, sent), refused('forbidden'));
  await until(() => seen.length === 1, 'the message');
  const evidence = JSON.stringify({logs: edge.logs, errors: edge.errors.map(({error}) => error instanceof SdkError ? error.body : String(error)), seen, missing, wrong, foreign});
  for (const token of edge.tokens.values()) assert.equal(evidence.includes(token), false, 'a token leaked');
  assert.ok(edge.logs.some(record => record.code === 'forbidden'), 'refusals are logged');
}));

it('the edge refuses an invalid, oversized or unknown message with the error body', () => withEdge({}, async edge => {
  const core = await edge.connect('bunny/core');
  const key = `bunny.state.${FAMILY}.s1`;
  const invalid = buildMessage('bunny/core', 'state', {...session('s1', 1), data: {id: 's1', revision: -1}}, TRACE, Date.now());
  await assert.rejects(core.publishMessage(key, invalid), refused('invalid-message'));
  await assert.rejects(core.publish('bunny.state.test-blob.b1', blob('b1', 1, 300_000)), refused('too-large'));
  const unknown = buildMessage('bunny/core', 'state', {...session('s1', 1), dataschema: 'https://bunny.invalid/events/no-such-family/2.0'}, TRACE, Date.now());
  await assert.rejects(core.publishMessage(key, unknown), refused('unknown-schema'));
  const huge = await call(edge, 'publish', 'x'.repeat(2 * 1024 * 1024), tokenOf(edge, 'bunny/core'));
  assert.equal(huge.status, 413);
  assert.equal((huge.body as ErrorBody).error.code, 'too-large');
  const garbled = await call(edge, 'publish', '{not json', tokenOf(edge, 'bunny/core'));
  assert.equal(garbled.status, 400);
  assert.equal((garbled.body as ErrorBody).error.code, 'invalid-request');
  // A blob under the cap passes.
  await core.publish('bunny.state.test-blob.b2', blob('b2', 1, 100_000));
}));

it('an edge refuses a sync request that arrives past its expiry with expired', () => withEdge({}, async edge => {
  const sentAtMs = Date.now() - 2000;
  const request = buildMessage('bunny/core', 'sync-request', {
    type: 'org.bunny.sync.requested', subject: FAMILY, dataschema: 'https://bunny.invalid/events/sync-request/2.0',
    data: {requestId: 'sync-late', families: [FAMILY]},
  }, TRACE, sentAtMs, sentAtMs + 1000);
  const answer = await call(edge, 'sync', {schema: REMOTE_SCHEMA, request}, tokenOf(edge, 'bunny/core'));
  assert.equal(answer.status, 400);
  assert.equal((answer.body as ErrorBody).error.code, 'expired');
}));

it('a reconnect resyncs the copy and tells every subscription of the gap, with no replay', () => withEdge({}, async edge => {
  const owner = checked(edge.bus.connect('bunny/core'));
  const sessions = new Map<string, number>([['s1', 1], ['s2', 2]]);
  let revision = 2;
  await owner.serveSync([FAMILY], () => ({revision, states: [...sessions].map(([id, at]) => session(id, at))}));
  const consumer = checked(await edge.connect('bunny/wall'));
  const events: string[] = [];
  const gaps: Overflow[] = [];
  await consumer.subscribe(`bunny.event.${FAMILY}.*`, message => { events.push(message.type); }, {onOverflow: gap => { gaps.push(gap); }});
  const changes: string[] = [];
  const show = (change: SyncChange<Session>): string => change.type === 'removed' ? `removed ${change.entity.id}`
    : change.type === 'updated' ? `updated ${change.entity.id}@${change.message.data.revision}` : change.type === 'synced' ? `synced @${change.message.data.revision}` : 'failed';
  const result = await consumer.sync<Session>([FAMILY], change => { changes.push(show(change)); }, {timeoutMs: 5000});
  assert.equal(result.status, 'synced');
  if (result.status !== 'synced') return;

  // The stream drops. While the remote part is away, s1 changes, s2 is removed and a turn ends.
  edge.edge.disconnect('bunny/wall');
  sessions.set('s1', 3);
  sessions.delete('s2');
  revision = 4;
  await owner.publish(`bunny.state.${FAMILY}.s1`, session('s1', 3));
  await owner.publish(`bunny.event.${FAMILY}.s1`, turnEnded('s1'));
  await until(() => changes.includes('synced @4'), 'the resync');
  assert.deepEqual(changes, ['updated s1@1', 'updated s2@2', 'synced @2', 'updated s1@3', 'removed s2', 'synced @4']);
  assert.deepEqual(gaps, [{}], 'the gap after a reconnect has no count');
  assert.deepEqual(events, [], 'the turn that ended while away is not replayed');
  await owner.publish(`bunny.event.${FAMILY}.s1`, turnEnded('s1'));
  await until(() => events.length === 1, 'a live occurrence after the reconnect');
}));

it('a slow remote consumer lags only itself, and is told of what it lost', () => withEdge({maxQueued: 4}, async edge => {
  const token = tokenOf(edge, 'bunny/wall');
  const stream = await fetch(`${edge.url}${REMOTE_PATH}/stream`, {headers: {authorization: `Bearer ${token}`}});
  assert.equal(stream.status, 200);
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const {value, done} = await reader.read();
    assert.equal(done, false, 'the stream opens with its ready event');
    text += decoder.decode(value, {stream: true});
  }
  const ready = JSON.parse(/data: (.*)/.exec(text)?.[1] ?? '{}') as {connection?: string};
  const subscribed = await call(edge, 'subscribe', {schema: REMOTE_SCHEMA, connection: ready.connection, id: 'slow', pattern: 'bunny.state.test-blob.*'}, token);
  assert.equal(subscribed.status, 200);
  // The remote part stops reading. Everyone else keeps up.
  const fast: number[] = [];
  await checked(edge.bus.connect('bunny/second')).subscribe<{revision: number}>('bunny.state.test-blob.*', message => { fast.push(message.data.revision); });
  const sender = checked(edge.bus.connect('bunny/core'));
  // The bus's queues hold 4 messages, so the fast subscriber gets a turn after each publish; the publisher never
  // waits for the slow socket.
  for (let revision = 1; revision <= 150; revision += 1) {
    await sender.publish('bunny.state.test-blob.b1', blob('b1', revision, 100_000));
    await flush();
  }
  assert.equal(fast.length, 150, 'every message for the fast subscriber');
  await until(() => edge.errors.some(({scope}) => scope.source === 'bunny/wall'), 'a dropped delivery for the slow one');
  // Reading again, the slow consumer is told of its loss.
  let overflow: {subscription?: string; dropped?: number} | undefined;
  while (overflow === undefined) {
    const {value, done} = await reader.read();
    assert.equal(done, false, 'the stream stays open');
    text += decoder.decode(value, {stream: true});
    const found = /event: overflow\ndata: (.*)\n/.exec(text);
    if (found?.[1] !== undefined) overflow = JSON.parse(found[1]) as {subscription?: string; dropped?: number};
  }
  assert.equal(overflow.subscription, 'slow');
  assert.ok((overflow.dropped ?? 0) > 0);
  await reader.cancel();
}));

it('a sync answer over 256 KiB is refused at the edge as too-large, and the copy fails with that code', () => withEdge({}, async edge => {
  const owner = checked(edge.bus.connect('bunny/core'));
  let size = 2;
  const id = (index: number): string => `s${index}`.padEnd(128, 'x');
  await owner.serveSync([FAMILY], () => ({revision: size, states: Array.from({length: size}, (_, index) => session(id(index), index + 1))}));
  const consumer = await edge.connect('bunny/wall');
  const changes: string[] = [];
  const result = await consumer.sync<Session>([FAMILY], change => { changes.push(change.type === 'failed' ? `failed ${change.error.error.code}` : change.type); }, {timeoutMs: 5000});
  assert.equal(result.status, 'synced');
  // The owner grows past what one sync.completed may carry at a remote edge; a reconnect makes the copy sync again.
  size = 2000;
  edge.edge.disconnect('bunny/wall');
  await until(() => changes.includes('failed too-large'), 'the failed sync');
  assert.ok(edge.logs.some(record => record.route === 'sync' && record.code === 'too-large'), 'the edge logs it');
  const first = await consumer.sync<Session>([FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(first.status === 'rejected' ? first.error.error.code : first.status, 'too-large', 'a first sync is refused the same way');
}));

it('a remote requester\'s deadlines run on its injected scheduler', () => withEdge({}, async edge => {
  const pending: {delayMs: number; run: () => void}[] = [];
  const scheduler = {after: (delayMs: number, run: () => void) => {
    const entry = {delayMs, run};
    pending.push(entry);
    return () => { pending.splice(pending.indexOf(entry), 1); };
  }};
  const requester = await edge.connect('bunny/core', {scheduler});
  const responder = await edge.connect('bunny/wall');
  const answer = deferred<Reply>();
  await responder.respond('bunny.cmd.mode.*', () => answer.promise);
  try {
    const result = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
    await until(() => pending.some(entry => entry.delayMs === 60_000), 'the deadline on the scheduler');
    // The deadline fires when the scheduler says so, not after a minute.
    for (const entry of [...pending]) if (entry.delayMs === 60_000) entry.run();
    assert.equal((await result).status, 'uncertain');
  } finally {
    answer.resolve({status: 'accepted'});
  }
}));
