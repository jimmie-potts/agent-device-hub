// What only the remote transport has (Hub #883): authentication, validation at the edge, reconnects, a slow remote
// consumer and the 256 KiB cap on a sync answer. The shared behavior is in conformance.test.ts.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {MAX_DETAIL, errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {buildMessage} from '../src/envelope.js';
import {InProcessBus, REMOTE_PATH, REMOTE_SCHEMA, RemoteEdge, SdkError, type Command, type Overflow, type Reply, type RequestResult, type Scheduler, type SyncChange} from '../src/index.js';
import {MODE_SCHEMA, SESSION_FAMILY, blob, checked, deferred, flush, it, session, setMode, turnEnded, until, validator, type Mode, type Session} from './support.js';
import {startEdge, type Edge, type EdgeSetup} from './transports.js';

const FAMILY = SESSION_FAMILY;
const TRACE = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const refused = (code: string) => (error: unknown): boolean => error instanceof SdkError && error.body.error.code === code;

async function withEdge(options: EdgeSetup, body: (edge: Edge) => Promise<void>): Promise<void> {
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

it('an exception inside the edge reaches the remote part and the edge\'s log only as fixed text, never its message', () => withEdge({}, async edge => {
  const SECRET = 'tok_SYNTHETIC123';
  // The owner's state cannot be serialized: the edge's own size check throws while it encodes the answer.
  const poisoned = {id: 's1', revision: 1, toJSON: (): never => { throw new Error(`the vault refused ${SECRET}`); }};
  await edge.bus.connect('bunny/core').serveSync([FAMILY], () => ({revision: 1, states: [{...session('s1', 1), data: poisoned}]}));
  const consumer = await edge.connect('bunny/wall');
  const synced = await consumer.sync<Session>([FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'rejected');
  if (synced.status !== 'rejected') return;
  assert.deepEqual(synced.error, errorBody('internal', {detail: 'the edge failed', requestId: synced.requestId, traceId: synced.error.error.traceId ?? ''}));
  const sentAtMs = Date.now();
  const request = buildMessage('bunny/wall', 'sync-request', {
    type: 'org.bunny.sync.requested', subject: FAMILY, dataschema: 'https://bunny.invalid/events/sync-request/2.0',
    data: {requestId: 'sync-raw', families: [FAMILY]},
  }, TRACE, sentAtMs, sentAtMs + 5000);
  const raw = await call(edge, 'sync', {schema: REMOTE_SCHEMA, request}, tokenOf(edge, 'bunny/wall'));
  assert.deepEqual(raw, {status: 500, body: errorBody('internal', {detail: 'the edge failed'})}, 'the response carries fixed text');
  const refusals = edge.logs.filter(record => record.event === 'edge.refused');
  assert.deepEqual(refusals, [1, 2].map(() => ({event: 'edge.refused', route: 'sync', code: 'internal', source: 'bunny/wall', detail: 'the edge failed'})));
  const evidence = JSON.stringify({synced, raw, logs: edge.logs, errors: edge.errors.map(({error}) => error instanceof SdkError ? error.body : String(error))});
  assert.equal(evidence.includes(SECRET), false, 'the exception\'s message stays in memory');
}));

const codeOf = (result: {status: string; error?: {error: {code: string}}}): string => result.error?.error.code ?? result.status;
const detailOf = (result: RequestResult): string | undefined => result.status === 'accepted' ? undefined : result.error.error.detail;
const reconnects = (edge: Edge, source: string): number => edge.logs.filter(record => record.event === 'edge.connected' && record.source === source).length;

/** A scheduler that holds every callback until the test runs it. */
function manual(): Scheduler & {pending: {delayMs: number; run: () => void}[]} {
  const pending: {delayMs: number; run: () => void}[] = [];
  return {pending, after: (delayMs, run) => {
    const entry = {delayMs, run};
    pending.push(entry);
    return () => {
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
    };
  }};
}

/** A raw stream for `source`, and its connection id, as a remote part that does not use the client would open it. */
async function rawStream(edge: Edge, source: 'bunny/core' | 'bunny/wall'): Promise<{connection: string; cancel: () => Promise<void>}> {
  const stream = await fetch(`${edge.url}${REMOTE_PATH}/stream`, {headers: {authorization: `Bearer ${tokenOf(edge, source)}`}});
  assert.ok(stream.body);
  const reader = stream.body.getReader();
  const {value} = await reader.read();
  const ready = JSON.parse(/data: (.*)/.exec(new TextDecoder().decode(value))?.[1] ?? '{}') as {connection?: string};
  const {connection} = ready;
  if (connection === undefined) return assert.fail('the stream opens with its connection');
  return {connection, cancel: () => reader.cancel()};
}

it('a dropped stream never answers a command its remote handler holds: the deadline makes it uncertain-result', () => withEdge({}, async edge => {
  const requester = checked(edge.bus.connect('bunny/core'));
  const responder = checked(await edge.connect('bunny/wall'));
  const holding = deferred<Reply>();
  const got: string[] = [];
  await responder.respond<Mode>('bunny.cmd.mode.*', command => { got.push(command.data.mode); return holding.promise; });
  const pending = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 600});
  try {
    await until(() => got.length === 1, 'the command at the remote handler');
    edge.edge.disconnect('bunny/wall');
    const result = await pending;
    assert.equal(codeOf(result), 'uncertain-result', 'the handler may have run it, so retrying is not safe');
  } finally {
    holding.resolve({status: 'accepted'});
  }
}));

it('a reply sent on the new connection after a dropped stream reaches the requester', () => withEdge({}, async edge => {
  const requester = checked(edge.bus.connect('bunny/core'));
  const responder = checked(await edge.connect('bunny/wall'));
  const holding = deferred<Reply>();
  const got: string[] = [];
  await responder.respond<Mode>('bunny.cmd.mode.*', command => { got.push(command.data.mode); return holding.promise; });
  const pending = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 10_000});
  try {
    await until(() => got.length === 1, 'the command at the remote handler');
    edge.edge.disconnect('bunny/wall');
    await until(() => reconnects(edge, 'bunny/wall') === 2, 'the reconnect');
  } finally {
    holding.resolve({status: 'accepted'});
  }
  assert.equal((await pending).status, 'accepted');
}));

it('a remote requester takes the edge\'s answer at its deadline, and settles on its own only if the edge stays silent', () => withEdge({}, async edge => {
  const requester = await edge.connect('bunny/core');
  const answer = deferred<Reply>();
  await checked(edge.bus.connect('bunny/wall')).respond('bunny.cmd.mode.*', () => answer.promise);
  try {
    // The edge answers at the deadline, well inside the requester's grace.
    const startedAt = Date.now();
    const held = await requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 300});
    assert.equal(codeOf(held), 'uncertain-result');
    assert.equal(detailOf(held), 'no reply within 300 ms', 'the bus\'s own answer, from the edge');
    assert.ok(Date.now() - startedAt < 1000, 'before the requester\'s grace ran out');

    // An edge that stays silent: the requester's scheduler runs its deadline plus grace before the edge's deadline.
    const scheduler = manual();
    const patient = await edge.connect('bunny/second', {scheduler});
    const silent = patient.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 60_000});
    await until(() => scheduler.pending.some(entry => entry.delayMs === 61_000), 'the deadline plus grace on the scheduler');
    for (const entry of [...scheduler.pending]) if (entry.delayMs === 61_000) entry.run();
    const result = await silent;
    assert.equal(codeOf(result), 'uncertain-result');
    assert.equal(detailOf(result), 'the edge did not answer within 61000 ms');
  } finally {
    answer.resolve({status: 'accepted'});
  }
}));

it('the edge rebuilds a remote refusal in the shared error body, cutting its detail and dropping extra fields', () => withEdge({}, async edge => {
  const local = checked(edge.bus.connect('bunny/core'));
  const remote = await edge.connect('bunny/wall');
  const wild = {error: {code: 'invalid-state', retryable: false, detail: 'x'.repeat(5000), note: 'not in the error block'}} as unknown as ErrorBody;
  await remote.respond('bunny.cmd.mode.*', () => wild);
  const refusal = await local.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 5000, requestId: 'req-wild'});
  assert.equal(refusal.status, 'rejected');
  if (refusal.status !== 'rejected' || refusal.reply === undefined) return assert.fail('a refusal in a reply');
  const traceId = refusal.error.error.traceId ?? '';
  assert.deepEqual(refusal.error, errorBody('invalid-state', {detail: 'x'.repeat(MAX_DETAIL), requestId: 'req-wild', traceId}));
  await remote.serveSync([FAMILY], () => wild);
  const synced = await local.sync([FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'rejected');
  if (synced.status !== 'rejected') return;
  assert.deepEqual(synced.error, errorBody('invalid-state', {detail: 'x'.repeat(MAX_DETAIL), requestId: synced.requestId, traceId: synced.error.error.traceId ?? ''}));
}));

it('a token acts only on its own source\'s connection: close, reply and answer on another\'s are forbidden', () => withEdge({}, async edge => {
  const core = await rawStream(edge, 'bunny/core');
  try {
    const calls: [string, object][] = [
      ['close', {id: 'any'}],
      ['reply', {responder: 'any', command: 'msg-1', requestId: 'req-1', reply: {status: 'accepted'}}],
      ['answer', {server: 'any', request: 'msg-1', requestId: 'req-1', answer: {revision: 0, states: []}}],
    ];
    for (const [call, body] of calls) {
      const answer = await (async () => {
        const response = await fetch(`${edge.url}${REMOTE_PATH}/${call}`, {method: 'POST', headers: {authorization: `Bearer ${tokenOf(edge, 'bunny/wall')}`},
          body: JSON.stringify({schema: REMOTE_SCHEMA, connection: core.connection, ...body})});
        return {status: response.status, body: await response.json() as ErrorBody};
      })();
      assert.equal(answer.status, 403, call);
      assert.equal(answer.body.error.code, 'forbidden', call);
    }
  } finally {
    await core.cancel();
  }
}));

it('after reconnects, a remote responder and a remote sync owner still serve', () => withEdge({}, async edge => {
  const local = checked(edge.bus.connect('bunny/core'));
  const remote = checked(await edge.connect('bunny/wall'));
  await remote.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  await remote.serveSync([FAMILY], () => ({revision: 1, states: [session('s1', 1)]}));
  for (const count of [2, 3]) {
    edge.edge.disconnect('bunny/wall');
    await until(() => reconnects(edge, 'bunny/wall') === count, `reconnect ${count - 1}`);
  }
  // The re-registration races the last reconnect's log line, so wait until the responder is back.
  let accepted = false;
  for (let attempt = 0; attempt < 50 && !accepted; attempt += 1) {
    accepted = (await local.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 2000})).status === 'accepted';
    if (!accepted) await flush();
  }
  assert.ok(accepted, 'the responder serves again');
  assert.equal((await local.sync([FAMILY], () => {}, {timeoutMs: 2000})).status, 'synced');
}));

it('a remote responder ignores a command that reaches it past its expiry', () => withEdge({}, async edge => {
  // The responder's clock is ten minutes ahead, so every command it receives looks expired.
  const remote = await edge.connect('bunny/wall', {now: () => Date.now() + 600_000});
  const handled: string[] = [];
  await remote.respond<Mode>('bunny.cmd.mode.*', command => { handled.push(command.data.mode); return {status: 'accepted'}; });
  const result = await checked(edge.bus.connect('bunny/core')).request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 300});
  assert.equal(codeOf(result), 'uncertain-result');
  assert.deepEqual(handled, [], 'the handler never saw it');
}));

it('the edge refuses a command or a sync request that arrives past its expiry with expired', () => withEdge({}, async edge => {
  const sentAtMs = Date.now() - 2000;
  const command = buildMessage<Mode & {requestId: string}>('bunny/core', 'command', {
    type: 'org.bunny.mode.set.requested', subject: 'wall', dataschema: MODE_SCHEMA, data: {mode: 'work', requestId: 'req-late'},
  }, TRACE, sentAtMs, sentAtMs + 1000) as Command<Mode>;
  const late = await call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command}, tokenOf(edge, 'bunny/core'));
  assert.equal(late.status, 400);
  assert.equal((late.body as ErrorBody).error.code, 'expired');
}));

it('an edge refuses a sync request whose subject does not name its families', () => withEdge({}, async edge => {
  const sentAtMs = Date.now();
  const request = buildMessage('bunny/core', 'sync-request', {
    type: 'org.bunny.sync.requested', subject: 'core', dataschema: 'https://bunny.invalid/events/sync-request/2.0',
    data: {requestId: 'sync-core', families: [FAMILY]},
  }, TRACE, sentAtMs, sentAtMs + 5000);
  const answer = await call(edge, 'sync', {schema: REMOTE_SCHEMA, request}, tokenOf(edge, 'bunny/core'));
  assert.equal(answer.status, 400);
  assert.equal((answer.body as ErrorBody).error.code, 'invalid-message');
}));

it('a call that meets a lost stream is refused as retryable unavailable and leaves nothing behind', () => withEdge({}, async edge => {
  const remote = await edge.connect('bunny/wall');
  // The edge drops the stream; in the same turn, before the client can notice, the client registers a responder.
  edge.edge.disconnect('bunny/wall');
  const lost = await remote.respond('bunny.cmd.mode.*', () => ({status: 'accepted'})).then(() => undefined, (error: unknown) => error);
  assert.ok(lost instanceof SdkError, 'the call on the lost connection is refused');
  assert.equal(lost.body.error.code, 'unavailable');
  assert.equal(lost.body.error.retryable, true);
  await until(() => reconnects(edge, 'bunny/wall') === 2, 'the reconnect');
  // Nothing of the refused call holds the key: registering again works.
  await remote.respond('bunny.cmd.mode.*', () => ({status: 'accepted'}));
  assert.equal((await checked(edge.bus.connect('bunny/core')).request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 2000})).status, 'accepted');
}));

it('an edge expired refusal of a remote part\'s own sync request is unavailable to it, since a sync only reads', () => withEdge({}, async edge => {
  await checked(edge.bus.connect('bunny/core')).serveSync([FAMILY], () => ({revision: 0, states: []}));
  // The remote part's clock is ten minutes behind, so the edge finds its sync request expired.
  const remote = await edge.connect('bunny/wall', {now: () => Date.now() - 600_000});
  const result = await remote.sync([FAMILY], () => {}, {timeoutMs: 5000});
  assert.equal(result.status, 'rejected');
  if (result.status !== 'rejected') return;
  assert.equal(result.error.error.code, 'unavailable');
  assert.equal(result.error.error.retryable, true);
}));

it('an edge refuses grants with a repeated token or a malformed source, without naming the token', () => {
  const secret = 'a-token-that-must-not-leak';
  for (const grants of [[{source: 'bunny/core', token: secret}, {source: 'bunny/wall', token: secret}], [{source: 'core', token: secret}]]) {
    assert.throws(() => new RemoteEdge({bus: new InProcessBus(), validator, grants}), (error: unknown) => error instanceof SdkError
      && error.body.error.code === 'invalid-request' && !JSON.stringify(error.body).includes(secret) && !String(error).includes(secret));
  }
});

it('closing a remote participant cancels its reconnect backoff', () => withEdge({}, async edge => {
  const scheduler = manual();
  const remote = await edge.connect('bunny/wall', {scheduler});
  edge.edge.disconnect('bunny/wall');
  await until(() => scheduler.pending.length > 0, 'the backoff on the scheduler');
  await remote.close();
  assert.deepEqual(scheduler.pending, [], 'nothing is left on the scheduler');
}));

// Final review round (PR #909): a held command is never answered as a refusal, a retry keeps its own reply, and a
// gap comes before the new stream's messages.

it('closing the edge while a remote handler holds a command settles it uncertain-result, with no reply from the responder', async () => {
  const edge = await startEdge();
  const requester = checked(edge.bus.connect('bunny/core'));
  const responder = checked(await edge.connect('bunny/wall'));
  const holding = deferred<Reply>();
  const got: string[] = [];
  await responder.respond<Mode>('bunny.cmd.mode.*', command => { got.push(command.data.mode); return holding.promise; });
  const pending = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 10_000});
  try {
    await until(() => got.length === 1, 'the command at the remote handler');
    await edge.edge.close();
    const result = await pending;
    assert.equal(result.status, 'uncertain');
    assert.equal(codeOf(result), 'uncertain-result');
    assert.equal('reply' in result, false, 'the responder never replied');
  } finally {
    holding.resolve({status: 'accepted'});
    await edge.close();
  }
});

it('a forward that outlasts its command on the edge\'s own scheduler settles it uncertain-result, never as a refusal', () => {
  const scheduler = manual();
  return withEdge({scheduler}, async edge => {
    const requester = checked(edge.bus.connect('bunny/core'));
    const responder = checked(await edge.connect('bunny/wall'));
    const holding = deferred<Reply>();
    const got: string[] = [];
    await responder.respond<Mode>('bunny.cmd.mode.*', command => { got.push(command.data.mode); return holding.promise; });
    // The bus's deadline is a minute away on its own timers; the edge's scheduler runs the forward's wait now.
    const pending = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 60_000});
    try {
      await until(() => got.length === 1 && scheduler.pending.length > 0, 'the forward waiting on the edge\'s scheduler');
      for (const entry of [...scheduler.pending]) entry.run();
      const result = await pending;
      assert.equal(result.status, 'uncertain');
      assert.equal(codeOf(result), 'uncertain-result');
      assert.equal('reply' in result, false);
    } finally {
      holding.resolve({status: 'accepted'});
    }
  });
});

it('a retry that reuses a held command\'s requestId gets its own reply, not the first command\'s', () => withEdge({}, async edge => {
  const requester = checked(edge.bus.connect('bunny/core'));
  const responder = checked(await edge.connect('bunny/wall'));
  const holding = deferred<Reply>();
  const got: string[] = [];
  await responder.respond<Mode>('bunny.cmd.mode.*', command => {
    got.push(command.data.mode);
    return command.data.mode === 'work' ? holding.promise : {status: 'accepted'};
  });
  const first = requester.request('bunny.cmd.mode.wall', setMode('work'), {timeoutMs: 500, requestId: 'req-again'});
  let retry;
  try {
    await until(() => got.length === 1, 'the first command at the remote handler');
    edge.edge.disconnect('bunny/wall');
    assert.equal(codeOf(await first), 'uncertain-result');
    await until(() => reconnects(edge, 'bunny/wall') === 2, 'the reconnect');
    // The requester tries again with the same requestId. The held first command then refuses, late.
    retry = requester.request('bunny.cmd.mode.wall', setMode('quiet'), {timeoutMs: 10_000, requestId: 'req-again'});
    await flush();
  } finally {
    holding.resolve(errorBody('invalid-state', {detail: 'the first command, refused late'}));
  }
  const result = await retry;
  assert.equal(result?.status, 'accepted', 'the retry\'s own reply settles the retry');
}));

it('after a reconnect, a subscription hears of the gap before any message of the new stream', () => {
  const late = deferred<undefined>();
  // Hold the second subscription's re-registration, the fourth subscribe call, until the test releases it.
  return withEdge({before: (route, nth) => route === 'subscribe' && nth === 4 ? late.promise : undefined}, async edge => {
    const remote = await edge.connect('bunny/wall');
    const seen: string[] = [];
    await remote.subscribe(`bunny.state.${FAMILY}.*`, message => { seen.push(`message ${message.subject}`); }, {onOverflow: () => { seen.push('gap'); }});
    await remote.subscribe('bunny.state.test-blob.*', () => {});
    try {
      edge.edge.disconnect('bunny/wall');
      await until(() => edge.received('subscribe') === 3, 'the first re-registration');
      // The first subscription is live again on the new stream; the second is still being registered.
      await checked(edge.bus.connect('bunny/core')).publish(`bunny.state.${FAMILY}.s1`, session('s1', 1));
      await delay(200);
    } finally {
      late.resolve(undefined);
    }
    await until(() => seen.length === 2, 'the gap and the message');
    assert.deepEqual(seen, ['gap', 'message s1']);
  });
});

// Coverage for two paths the earlier tests left open (PR #909 Standards confirmation).

it('after a reconnect, a sync copy asks for no sync until every family is registered again', () => {
  const held = deferred<undefined>();
  // The copy's second family registers again in the fourth subscribe call; hold it.
  return withEdge({before: (route, nth) => route === 'subscribe' && nth === 4 ? held.promise : undefined}, async edge => {
    await checked(edge.bus.connect('bunny/core')).serveSync([FAMILY, 'test-blob'], () => ({revision: 1, states: [session('s1', 1)]}));
    const consumer = checked(await edge.connect('bunny/wall'));
    const result = await consumer.sync<Session>([FAMILY, 'test-blob'], () => {}, {timeoutMs: 5000});
    assert.equal(result.status, 'synced');
    const before = edge.received('sync');
    try {
      edge.edge.disconnect('bunny/wall');
      await until(() => edge.received('subscribe') === 3, 'the first family registered again');
      // The gap is queued, but held back: a sync request now could miss a message for the second family for good.
      await delay(300);
      assert.equal(edge.received('sync'), before, 'no sync request while a family is still being registered');
    } finally {
      held.resolve(undefined);
    }
    await until(() => edge.received('sync') === before + 1, 'the resync once every family is registered');
  });
});

it('a command forwarded again while its first forward still waits never reaches the responder, and is unavailable with no reply', () => withEdge({}, async edge => {
  const responder = checked(await edge.connect('bunny/wall'));
  const holding = deferred<Reply>();
  const got: string[] = [];
  await responder.respond<Mode>('bunny.cmd.mode.*', command => { got.push(command.data.mode); return holding.promise; });
  const sentAtMs = Date.now();
  const command = buildMessage<Mode & {requestId: string}>('bunny/core', 'command', {
    type: 'org.bunny.mode.set.requested', subject: 'wall', dataschema: MODE_SCHEMA, data: {mode: 'work', requestId: 'req-twice'},
  }, TRACE, sentAtMs, sentAtMs + 10_000) as Command<Mode>;
  const send = (): Promise<{status: number; body: unknown}> =>
    call(edge, 'request', {schema: REMOTE_SCHEMA, key: 'bunny.cmd.mode.wall', command}, tokenOf(edge, 'bunny/core'));
  const first = send();
  try {
    await until(() => got.length === 1, 'the first forward at the remote handler');
    // The stream drops; the first forward keeps waiting for a reply. The responder registers again.
    edge.edge.disconnect('bunny/wall');
    await until(() => reconnects(edge, 'bunny/wall') === 2, 'the reconnect');
    await until(() => edge.received('respond') === 2, 'the responder registered again');
    // The same command message again: its forward is still live, so the edge does not send it.
    const again = await send();
    assert.equal(again.status, 200);
    const result = (again.body as {result: {status: string; error: ErrorBody; reply?: unknown}}).result;
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.error.code, 'unavailable');
    assert.equal(result.error.error.retryable, true);
    assert.equal(result.reply, undefined, 'no reply message the responder never sent');
    assert.deepEqual(got, ['work'], 'the responder saw the command once');
  } finally {
    holding.resolve({status: 'accepted'});
  }
  await first;
}));
