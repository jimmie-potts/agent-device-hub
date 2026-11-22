// The native assistant source in the core (Hub #505): its source binding at the core's intake and at the gateway, the
// version each record and occurrence is published in, no companion opportunity for a native conversation, and native
// conversations under the session limit. A native session is a profile's conversation and each turn one task in it.
// Every conversation, task, session and host here is synthetic. The runtime tests wait for messages and
// records, never for time; the store tests run on the manual clock.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {sessionEntityId, type Identity, type LifecycleEvent, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {Sdk} from '@jimmie-potts/sdk';
import {createCoreModule, type LogRecord} from '../src/index.js';
import {nativeBinding} from '../src/core/core.js';
import {checkNativeIdentity} from '../src/gateway/producer-admission.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {contextOf, fixture, it, manualClock, run} from './support.js';

const BASE = 'https://bunny.invalid/events/';
const NATIVE = `${BASE}lifecycle/2.2`;
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const conversation = (sessionId: string): Identity => ({provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', sessionId});
const claude = (sessionId: string): Identity => ({provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId});

/** One observation on a known turn; a native one carries its conversation's ordering. */
function observation(identity: Identity, turn: string, event: LifecycleEvent, sequence: number, atMs: number): LifecycleObservation {
  return {identity, turn: {status: 'known', id: turn}, parent: identity.provider === 'bunny' ? {status: 'top-level'} : {status: 'unknown'}, event, observedAtMs: atMs,
    ordering: identity.provider === 'bunny' ? {status: 'known', authority: 'companions', epoch: identity.sessionId, sequence} : {status: 'unknown'},
    ...(identity.provider === 'bunny' ? {nativeEventId: String(sequence)} : {})};
}
const draft = (data: LifecycleObservation, dataschema: string) =>
  ({kind: 'occurrence' as const, type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(data.identity), dataschema, data});

it('only the companions module names the native source, it names no other, only it sends lifecycle/2.2, and a native session never ends by a runtime end', () => {
  const at = (identity: Identity, source: string, dataschema = NATIVE, event: LifecycleEvent = {kind: 'turn-started'}) =>
    nativeBinding({source, dataschema, data: observation(identity, 'task-1', event, 1, 0)});
  assert.equal(at(conversation('c'), 'bunny/modules/companions'), undefined);
  assert.equal(at(conversation('c'), 'bunny/parts/hook'), 'forbidden');
  assert.equal(at(claude('c'), 'bunny/modules/companions', `${BASE}lifecycle/2.0`), 'forbidden');
  assert.equal(at(claude('c'), 'bunny/parts/hook', NATIVE), 'forbidden', 'no hook sends the native inputs');
  assert.equal(at(claude('c'), 'bunny/parts/hook', `${BASE}lifecycle/2.0`), undefined);
  assert.equal(at(conversation('c'), 'bunny/modules/companions', NATIVE, {kind: 'runtime-ended'}), 'invalid-request');
  const edge = (dataschema: string) => checkNativeIdentity({specversion: '1.0', bunnyprofile: '2.0', id: 'm', source: 'bunny/parts/hub-0', type: 'org.bunny.lifecycle.observed',
    subject: 's', time: new Date(0).toISOString(), kind: 'occurrence', datacontenttype: 'application/json', dataschema, traceparent: TRACE, data: {}});
  assert.equal(edge(NATIVE)?.error.code, 'forbidden', 'the gateway refuses every lifecycle/2.2 from an edge credential');
  assert.equal(edge(`${BASE}lifecycle/2.0`), undefined);
});

/** A runtime with the core, a module that plays the companions producer, a hook, and a watcher of every message and record. */
async function nativeRun(context: TestContext) {
  const seen: Message[] = [], logs: LogRecord[] = [];
  const waiters: {done: () => boolean; resolve: () => void}[] = [];
  const notify = (): void => { for (const waiter of waiters.filter(item => item.done())) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(); } };
  const watcher = fixture('watcher', async ({sdk}) => { await sdk.subscribe('bunny.*.*.*', message => { seen.push(message); notify(); }); });
  const companions = fixture('companions'), hook = fixture('hook');
  await run(context, {modules: [createCoreModule(), watcher, companions, hook], log: record => { logs.push(record); notify(); }});
  return {
    seen, logs, companions: contextOf(companions).sdk, hook: contextOf(hook).sdk,
    /** Resolves once `done` holds, checked at every message and record. */
    until: (done: () => boolean): Promise<void> => done() ? Promise.resolve() : new Promise(resolve => { waiters.push({done, resolve}); }),
  };
}
const publish = (sdk: Sdk, data: LifecycleObservation, dataschema = NATIVE) => sdk.publish(`bunny.event.lifecycle.${sessionEntityId(data.identity)}`, draft(data, dataschema));
const refusal = (logs: readonly LogRecord[], id: string): unknown => logs.find(record => record.event_name === 'message.received' && record.attributes['bunny.message.id'] === id)?.attributes['bunny.code'];

it('the core publishes a native conversation as session/3.1 with 2.1 occurrences and no companion opportunity, and refuses an impersonating producer', async context => {
  const w = await nativeRun(context);
  const now = Date.now(), entity = sessionEntityId(conversation('synthetic-conversation'));
  const of = (type: string, subject: string) => w.seen.filter(message => message.source === 'bunny/core' && message.type === type && message.subject === subject);
  await publish(w.companions, observation(conversation('synthetic-conversation'), 'task-1', {kind: 'turn-started'}, 1, now));
  await publish(w.companions, observation(conversation('synthetic-conversation'), 'task-1', {kind: 'attention-input', attention: {status: 'known', id: 'q1'}}, 2, now));
  await w.until(() => of('org.bunny.attention.raised', entity).length === 1);
  assert.deepEqual(of('org.bunny.session.updated', entity).map(message => message.dataschema), [`${BASE}session/3.1`, `${BASE}session/3.1`]);
  assert.equal(of('org.bunny.attention.raised', entity)[0]?.dataschema, `${BASE}attention-raised/2.1`);
  // A Claude approval after it raises its own opportunity; the bus would have carried a native one first.
  const hookSession = sessionEntityId(claude('synthetic-claude'));
  await publish(w.hook, observation(claude('synthetic-claude'), 'p1', {kind: 'turn-started'}, 0, now), `${BASE}lifecycle/2.0`);
  await publish(w.hook, observation(claude('synthetic-claude'), 'p1', {kind: 'attention-approval', attention: {status: 'known', id: 'a1'}}, 0, now), `${BASE}lifecycle/2.0`);
  await w.until(() => w.seen.some(message => message.type === 'org.bunny.companion-opportunity.raised'));
  const opportunities = w.seen.filter(message => message.type === 'org.bunny.companion-opportunity.raised').map(message => (message.data as {session: string}).session);
  assert.deepEqual(opportunities, [hookSession], 'only the hook session raised an opportunity');
  assert.ok(of('org.bunny.session.updated', hookSession).every(message => message.dataschema === `${BASE}session/3.0`), 'a hook session stays session/3.0');
  assert.ok(of('org.bunny.attention.raised', hookSession).every(message => message.dataschema === `${BASE}attention-raised/2.0`));
  // The owner cancels the task: its turn ends with its result, its question cleared as ended, its notice acknowledged for every consumer.
  await publish(w.companions, observation(conversation('synthetic-conversation'), 'task-1', {kind: 'turn-ended', result: 'cancelled'}, 3, now));
  await w.until(() => of('org.bunny.turn.ended', entity).length === 1);
  assert.equal(of('org.bunny.turn.ended', entity)[0]?.dataschema, `${BASE}turn-ended/2.1`);
  assert.deepEqual((of('org.bunny.attention.cleared', entity)[0]?.data as {cause: string}).cause, 'turn-ended');
  const last = of('org.bunny.session.updated', entity).at(-1)?.data as {status: unknown; outcome: {notices: {acknowledgedBy: string[]; result?: string}[]}};
  assert.deepEqual(last.status, {class: 'finished', detail: 'cancelled'});
  assert.deepEqual(last.outcome.notices.map(notice => [notice.result, [...notice.acknowledgedBy].sort()]), [['cancelled', ['dashboard', 'nanoleaf', 'pixoo']]]);
  // Impersonation: a hook naming the native source, the companions module naming Claude, and a native runtime end.
  const forged = await publish(w.hook, observation(conversation('synthetic-conversation-2'), 'task-1', {kind: 'turn-started'}, 1, now));
  const borrowed = await publish(w.companions, observation(claude('synthetic-claude-2'), 'p1', {kind: 'turn-started'}, 0, now), `${BASE}lifecycle/2.0`);
  const ended = await publish(w.companions, observation(conversation('synthetic-conversation'), 'task-1', {kind: 'runtime-ended'}, 4, now));
  await w.until(() => [forged, borrowed, ended].every(message => refusal(w.logs, message.id) !== undefined));
  assert.deepEqual([forged, borrowed, ended].map(message => refusal(w.logs, message.id)), ['forbidden', 'forbidden', 'invalid-request']);
  for (const id of [sessionEntityId(conversation('synthetic-conversation-2')), sessionEntityId(claude('synthetic-claude-2'))]) {
    assert.equal(w.seen.some(message => message.source === 'bunny/core' && message.subject === id), false, 'a refused observation creates nothing');
  }
  assert.equal(w.seen.some(message => message.type === 'org.bunny.session.removed' && message.subject === entity), false, 'the conversation is not ended');
});

const DAY = 86_400_000, START = 1_000_000_000_000;
const quiet = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
const nativeMessage = (data: LifecycleObservation, atMs: number): Message<LifecycleObservation> =>
  ({...lifecycleMessage(data, atMs), source: 'bunny/modules/companions', dataschema: NATIVE});

it('native conversations share the session limit: a new one displaces a finished child, the next is refused, and it appears at its next change', async context => {
  const world = await World.open(context, {clock: manualClock(START), wrap: quiet});
  const take = async (data: LifecycleObservation): Promise<string> => {
    const result = await world.take(data.identity.provider === 'bunny' ? nativeMessage(data, world.clock.now()) : lifecycleMessage(data, world.clock.now()));
    return result.ok ? result.outcome : result.code;
  };
  const at = (): number => world.clock.now();
  // One root with a finished child, then Claude roots to the limit.
  await take(observation(claude('synthetic-root'), 'p1', {kind: 'turn-started'}, 0, at()));
  const child: LifecycleObservation = {...observation(claude('synthetic-child'), 'c1', {kind: 'session-started'}, 0, at()), parent: {status: 'known', identity: claude('synthetic-root')}};
  assert.equal(await take(child), 'applied');
  assert.equal(await take({...child, event: {kind: 'turn-ended'}}), 'applied');
  for (let index = 2; index < 128; index++) {
    world.clock.advance(1);
    await take(observation(claude(`synthetic-root-${String(index)}`), 'p1', {kind: 'turn-started'}, 0, at()));
  }
  assert.equal(world.store.records().length, 128);
  world.clock.advance(1);
  assert.equal(await take(observation(conversation('synthetic-conversation-a'), 'task-1', {kind: 'turn-started'}, 1, at())), 'applied', 'a native conversation displaces the finished child');
  assert.equal(world.store.records().some(record => record.identity.sessionId === 'synthetic-child'), false);
  assert.equal(await take(observation(conversation('synthetic-conversation-b'), 'task-1', {kind: 'turn-started'}, 1, at())), 'capacity', 'the next is refused');
  assert.equal(await take(observation(claude('synthetic-late-root'), 'p1', {kind: 'turn-started'}, 0, at())), 'capacity', 'as is a Claude root');
  assert.equal(world.store.records().filter(record => record.parent.status !== 'known').length, 128, 'no root is displaced');
  // A day later the Claude roots expire; the refused conversation appears at its next change, from that change alone.
  world.clock.advance(DAY);
  await world.store.refresh();
  await take(observation(conversation('synthetic-conversation-a'), 'task-1', {kind: 'turn-waiting'}, 2, at()));
  assert.equal(await take(observation(conversation('synthetic-conversation-b'), 'task-1', {kind: 'attention-input', attention: {status: 'known', id: 'q1'}}, 2, at())), 'applied');
  const shown = world.store.records().find(record => record.identity.sessionId === 'synthetic-conversation-b');
  assert.deepEqual(shown?.status, {class: 'needs-owner', detail: 'input'});
});
