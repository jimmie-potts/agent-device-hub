// The native assistant source in the core (Hub #505): its source binding at the core's intake and at the gateway, the
// version each record and occurrence is published in, no companion opportunity for a native conversation, and native
// conversations under the session limit, and a conversation's companions (Hub #2054). A native session is a profile's
// conversation and each turn one task in it.
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
const TITLES = `${BASE}lifecycle/2.3`;
const COMPANIONS = `${BASE}lifecycle/2.4`;
const REACHY = [{id: 'reachy', name: 'Reachy'}];
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
  // lifecycle/2.3 carries a native conversation's title (Hub #2025): the same binding holds.
  assert.equal(at(conversation('c'), 'bunny/modules/companions', TITLES, {kind: 'metadata-observed'}), undefined);
  assert.equal(at(conversation('c'), 'bunny/modules/codex-desktop', TITLES, {kind: 'metadata-observed'}), 'forbidden');
  assert.equal(at(claude('c'), 'bunny/parts/hook', TITLES), 'forbidden', 'no hook sends lifecycle/2.3');
  assert.equal(edge(TITLES)?.error.code, 'forbidden', 'nor does an edge credential');
  // lifecycle/2.4 carries a native conversation's companions (Hub #2054): the same binding holds.
  assert.equal(at(conversation('c'), 'bunny/modules/companions', COMPANIONS), undefined);
  assert.equal(at(claude('c'), 'bunny/parts/hook', COMPANIONS), 'forbidden', 'no hook sends lifecycle/2.4');
  assert.equal(at(conversation('c'), 'bunny/modules/codex-desktop', COMPANIONS, {kind: 'metadata-observed'}), 'forbidden');
  assert.equal(edge(COMPANIONS)?.error.code, 'forbidden', 'nor does an edge credential');
});

/** A native conversation's title as display metadata, in lifecycle/2.3. */
const titleObservation = (identity: Identity, value: string, source: 'provider' | 'user', atMs: number): LifecycleObservation =>
  ({identity, turn: {status: 'unknown'}, parent: {status: 'top-level'}, event: {kind: 'metadata-observed'}, observedAtMs: atMs, ordering: {status: 'unknown'}, title: {value, source}});

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

it('the companions module titles its conversation\'s session with display metadata at once, which no other producer may send for it', async context => {
  const w = await nativeRun(context);
  const now = Date.now(), entity = sessionEntityId(conversation('synthetic-titled'));
  const records = () => w.seen.filter(message => message.source === 'bunny/core' && message.type === 'org.bunny.session.updated' && message.subject === entity)
    .map(message => message.data as {title?: unknown; lastEvidenceAtMs: number; dataschema?: string});
  const early = await publish(w.companions, titleObservation(conversation('synthetic-titled'), '#2025 Early title', 'provider', now), TITLES);
  await w.until(() => refusal(w.logs, early.id) !== undefined || w.logs.some(record => record.attributes['bunny.message.id'] === early.id));
  assert.equal(records().length, 0, 'a title establishes no session');
  await publish(w.companions, {...observation(conversation('synthetic-titled'), 'task-1', {kind: 'turn-started'}, 1, now), title: {value: 'B.U.N.N.Y.', source: 'provider'}});
  await w.until(() => records().length === 1);
  await publish(w.companions, titleObservation(conversation('synthetic-titled'), '#2025 Conversation titles', 'provider', now + 5), TITLES);
  await w.until(() => records().length === 2);
  assert.deepEqual(records()[1]?.title, {value: '#2025 Conversation titles', source: 'provider'});
  assert.equal(records()[1]?.lastEvidenceAtMs, records()[0]?.lastEvidenceAtMs, 'a title is no lifecycle evidence, so it keeps no expiring session');
  await publish(w.companions, titleObservation(conversation('synthetic-titled'), 'Kitchen plans', 'user', now + 9), TITLES);
  await w.until(() => records().length === 3);
  assert.deepEqual(records()[2]?.title, {value: 'Kitchen plans', source: 'user'}, 'the owner\'s rename');
  // The hook and Codex Desktop may not title a native conversation.
  const forged = await publish(w.hook, titleObservation(conversation('synthetic-titled'), 'Forged', 'user', now + 10), TITLES);
  await w.until(() => refusal(w.logs, forged.id) !== undefined);
  assert.equal(refusal(w.logs, forged.id), 'forbidden');
  assert.equal(records().length, 3);
});

it('the core keeps a conversation\'s companions on its session/3.2 record, and a title or rename never changes them', async context => {
  const w = await nativeRun(context);
  const now = Date.now(), entity = sessionEntityId(conversation('synthetic-companion'));
  const records = () => w.seen.filter(message => message.source === 'bunny/core' && message.type === 'org.bunny.session.updated' && message.subject === entity);
  await publish(w.companions, {...observation(conversation('synthetic-companion'), 'task-1', {kind: 'turn-started'}, 1, now), title: {value: 'Reachy', source: 'provider'},
    companions: REACHY}, COMPANIONS);
  await w.until(() => records().length === 1);
  assert.equal(records()[0]?.dataschema, `${BASE}session/3.2`);
  assert.deepEqual((records()[0]?.data as {companions?: unknown}).companions, REACHY);
  await publish(w.companions, titleObservation(conversation('synthetic-companion'), '#2054 Companion metadata', 'provider', now + 5), TITLES);
  await publish(w.companions, titleObservation(conversation('synthetic-companion'), 'Renamed by the owner', 'user', now + 9), TITLES);
  await w.until(() => records().length === 3);
  for (const record of records().slice(1)) {
    assert.equal(record.dataschema, `${BASE}session/3.2`);
    assert.deepEqual((record.data as {companions?: unknown}).companions, REACHY, 'a generated title or a rename leaves the companions');
  }
  assert.deepEqual(records().map(record => (record.data as {title?: {value: string}}).title?.value), ['Reachy', '#2054 Companion metadata', 'Renamed by the owner'],
    'no title names the companion unless it is the persona fallback');
  // An observation the module sent before this release, in lifecycle/2.2 and without companions, keeps them too.
  await publish(w.companions, {...observation(conversation('synthetic-companion'), 'task-1', {kind: 'turn-ended', result: 'succeeded'}, 2, now + 10),
    title: {value: 'Renamed by the owner', source: 'user'}});
  await w.until(() => records().length === 4);
  assert.deepEqual((records()[3]?.data as {companions?: unknown}).companions, REACHY);
  // A hook session carries none and stays session/3.0.
  const hookSession = sessionEntityId(claude('synthetic-claude-companion'));
  await publish(w.hook, observation(claude('synthetic-claude-companion'), 'p1', {kind: 'turn-started'}, 0, now), `${BASE}lifecycle/2.0`);
  await w.until(() => w.seen.some(message => message.type === 'org.bunny.session.updated' && message.subject === hookSession));
  const hook = w.seen.find(message => message.type === 'org.bunny.session.updated' && message.subject === hookSession);
  assert.equal(hook?.dataschema, `${BASE}session/3.0`);
  assert.equal((hook?.data as {companions?: unknown}).companions, undefined);
});

const DAY = 86_400_000, START = 1_000_000_000_000;
const quiet = (db: DatabaseSync): DatabaseSync => { db.exec('PRAGMA synchronous = OFF'); return db; };
const nativeMessage = (data: LifecycleObservation, atMs: number): Message<LifecycleObservation> =>
  ({...lifecycleMessage(data, atMs), source: 'bunny/modules/companions', dataschema: NATIVE});

it('a stored conversation keeps its companions across a restart, and the latest observation that names them wins', async context => {
  const world = await World.open(context, {clock: manualClock(START), wrap: quiet});
  const identity = conversation('synthetic-stored-companion');
  const take = (data: LifecycleObservation) => world.take({...nativeMessage(data, world.clock.now()), dataschema: COMPANIONS});
  const shown = () => world.store.records().find(record => record.identity.sessionId === identity.sessionId);
  assert.equal((await take({...observation(identity, 'task-1', {kind: 'turn-started'}, 1, world.clock.now()), companions: REACHY})).ok, true);
  assert.deepEqual(shown()?.companions, REACHY);
  await world.crashAndRestart();
  assert.deepEqual(shown()?.companions, REACHY, 'the store keeps them');
  world.clock.advance(1);
  const apartment = [{id: 'bunny', name: 'B.U.N.N.Y.'}, {id: 'reachy', name: 'Reachy'}, {id: 'microduck', name: 'MicroDuck'}];
  await take({...observation(identity, 'task-1', {kind: 'turn-waiting'}, 2, world.clock.now()), companions: apartment});
  assert.deepEqual(shown()?.companions, apartment);
  world.clock.advance(1);
  await take(observation(identity, 'task-1', {kind: 'activity-observed'}, 3, world.clock.now()));
  assert.deepEqual(shown()?.companions, apartment, 'an observation without companions leaves them');
  const published = world.since(0).filter(message => message.type === 'org.bunny.session.updated');
  assert.ok(published.length > 0 && published.every(message => message.dataschema === `${BASE}session/3.2`));
});

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
