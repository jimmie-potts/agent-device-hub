// Operator notice override on the real serialized core owner, using only synthetic SQLite state.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type Command, type Participant, type Responder, type Sdk} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule, type CoreHandle, type CoreOptions} from '../src/index.js';
import type {Action} from '../src/core/tracker.js';
import {CHILD, IDENTITY, SESSION_ID, observation, sessionStarted, turnStarted, turnEnded} from './fixtures/agents.js';
import {CoreStore} from '../src/core/store.js';
import {it, manualClock, stateDir} from './support.js';

const clearAction = (noticeId: string | null, expectedRevision: number, requestId = 'req-clear'): Action => ({
  key: `bunny.cmd.notice-clear.${SESSION_ID}`, requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.notice.clear.requested', subject: SESSION_ID, dataschema: 'https://bunny.invalid/events/notice-clear/2.0',
    data: {noticeId, expectedRevision}},
});
async function notices(context: TestContext, options: CoreOptions = {}, controls: {
  sdk?: (participant: Participant) => Sdk; database?: (db: DatabaseSync) => DatabaseSync; dir?: string; seed?: boolean;
} = {}): Promise<{
  module: ReturnType<typeof createCoreModule>; harness: ModuleHarness; handle: CoreHandle; hook: Participant;
  record: () => Promise<SessionRecord>;
  db: DatabaseSync; clock: ReturnType<typeof manualClock>; dir: string; commands: Command<object>[]; messages: Message[];
}> {
  const clock = manualClock(), bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  const participant = bus.connect('bunny/core');
  let handle: CoreHandle | undefined;
  let db: DatabaseSync | undefined;
  const commands: Command<object>[] = [], messages: Message[] = [];
  await participant.subscribe('bunny.*.*.*', message => { messages.push(message); });
  const sdk = controls.sdk?.(participant) ?? participant;
  const trackedSdk: Sdk = {...sdk, respond: <T extends object>(pattern: string, responder: Responder<T>) => sdk.respond<T>(pattern, command => {
    if (pattern === 'bunny.cmd.notice-clear.*') commands.push(command);
    return responder(command);
  })};
  const module = createCoreModule({...options, parts: [...options.parts ?? [], {start: core => { handle = core; return Promise.resolve(); }}]});
  // The kit normally assigns bunny/modules/core; the runtime assigns the reserved bunny/core source.
  const hosted = {...module, start: (ctx: Parameters<typeof module.start>[0]) => {
    db = ctx.database();
    return module.start({...ctx, sdk: trackedSdk, database: () => controls.database?.(db as DatabaseSync) ?? db as DatabaseSync});
  },
    stop: async () => { await participant.close(); await module.stop?.(); }};
  const dir = controls.dir ?? await stateDir(context);
  const harness = new ModuleHarness(hosted, {bus, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  context.after(() => harness.stop());
  await harness.start();
  assert.ok(handle);
  assert.ok(db);
  const hook = bus.connect('bunny/parts/hook');
  context.after(() => hook.close());
  const record = async (): Promise<SessionRecord> => {
    const result = await hook.sync<SessionRecord>(['session'], () => {}, {timeoutMs: 5000});
    assert.equal(result.status, 'synced');
    if (result.status !== 'synced') throw new Error('the core did not sync');
    const held = result.copy.states().find(state => state.subject === SESSION_ID)?.data;
    await result.copy.close();
    assert.ok(held);
    return held;
  };
  if (controls.seed !== false) {
    const observed = observation(sessionStarted, clock.now());
    await hook.publish(observed.key, observed.draft);
  }
  // A sync joins the core's queue after its lifecycle delivery.
  await record();
  return {module, harness, handle, hook, record, db, clock, dir, commands, messages};
}

it('one operator override acknowledges every consumer and completes in the same session transaction', async context => {
  const world = await notices(context, {consumers: [{id: 'dashboard', clearOnNewTurn: false}, {id: 'nanoleaf', clearOnNewTurn: true}, {id: 'pixoo', clearOnNewTurn: true}, {id: 'another', clearOnNewTurn: false}]});
  const observed = observation(turnEnded, world.clock.now());
  await world.hook.publish(observed.key, observed.draft);
  const before = await world.record(), notice = before.notices.at(-1);
  assert.ok(notice);
  assert.deepEqual(await world.module.operatorActions.dispatch(clearAction(notice.id, before.revision)), {status: 'accepted', requestId: 'req-clear'});
  const after = await world.record();
  assert.deepEqual(after.notices.at(-1)?.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo', 'another']);
  assert.deepEqual([after.read, after.lastEvidenceAtMs, after.activity], [before.read, before.lastEvidenceAtMs, before.activity]);
  const operation = world.handle.operation('req-clear');
  assert.deepEqual([operation?.status, operation?.result, operation?.evidence, operation?.outcomes.length], ['completed', 'succeeded', 'observed', 1]);
  const outcome = world.db.prepare("SELECT revision FROM core_history WHERE request_id = 'req-clear' AND type = 'org.bunny.notice.clear.completed'").get();
  assert.equal(outcome?.revision, after.revision, 'session acknowledgment and outcome share the committed revision');
  assert.equal(world.commands.length, 1);
});

it('ordinary dispatch and direct SDK callers cannot claim operator authority', async context => {
  const world = await notices(context), before = await world.record(), action = clearAction(null, before.revision);
  assert.equal((await world.module.actions.dispatch(action) as {error: {code: string}}).error.code, 'forbidden');
  const direct = await world.hook.request(action.key, action.draft, {requestId: 'req-forged', timeoutMs: 5000});
  assert.equal(direct.status, 'rejected');
  assert.equal(direct.error.error.code, 'forbidden');
  assert.deepEqual(await world.record(), before);
  assert.equal(world.handle.operation('req-clear'), undefined);
});

it('no notice and an already acknowledged notice complete without changing the session, and duplicate IDs never resend', async context => {
  const world = await notices(context), before = await world.record();
  const empty = clearAction(null, before.revision, 'req-empty');
  assert.deepEqual(await world.module.operatorActions.dispatch(empty), {status: 'accepted', requestId: 'req-empty'});
  assert.deepEqual(await world.record(), before);
  const observed = observation(turnEnded, world.clock.now()); await world.hook.publish(observed.key, observed.draft);
  const ended = await world.record(), id = ended.notices.at(-1)?.id; assert.ok(id !== undefined);
  const action = clearAction(id, ended.revision);
  await world.module.operatorActions.dispatch(action);
  const after = await world.record();
  await world.module.operatorActions.dispatch(clearAction(id, after.revision, 'req-same'));
  assert.deepEqual(await world.record(), after);
  assert.deepEqual(await world.module.operatorActions.dispatch(action), {status: 'accepted', requestId: 'req-clear'});
  assert.equal(world.commands.length, 3, 'empty, clear and same notice; the duplicate sent nothing');
  for (const requestId of ['req-empty', 'req-clear', 'req-same']) assert.equal(world.handle.operation(requestId)?.outcomes.length, 1);
});

it('unknown sessions and stale selected notices are refused before acknowledgment', async context => {
  const world = await notices(context);
  let observed = observation(turnEnded, world.clock.now()); await world.hook.publish(observed.key, observed.draft);
  const old = await world.record(), oldId = old.notices.at(-1)?.id; assert.ok(oldId !== undefined);
  world.clock.advance(1);
  observed = observation(turnStarted, world.clock.now(), {turn: 'turn-new'}); await world.hook.publish(observed.key, observed.draft);
  observed = observation(turnEnded, world.clock.now(), {turn: 'turn-new'}); await world.hook.publish(observed.key, observed.draft);
  const before = await world.record();
  for (const [id, revision, requestId] of [[oldId, old.revision, 'req-old-revision'], [oldId, before.revision, 'req-old-notice'], [null, before.revision, 'req-empty-stale']] as const) {
    const answer = await world.module.operatorActions.dispatch(clearAction(id, revision, requestId));
    assert.equal((answer as {error: {code: string}}).error.code, 'revision-conflict');
    assert.deepEqual(world.handle.operation(requestId)?.outcomes, []);
  }
  const target = 'f'.repeat(64), missing = clearAction(null, before.revision, 'req-missing');
  const answer = await world.module.operatorActions.dispatch({...missing, key: `bunny.cmd.notice-clear.${target}`, draft: {...missing.draft, subject: target}});
  assert.equal((answer as {error: {code: string}}).error.code, 'not-found');
  assert.deepEqual(await world.record(), before);
});

it('a failed participating projection rolls back every acknowledgment and completion together', async context => {
  const world = await notices(context, {parts: [{tracked: ({outcome}) => {if (outcome !== undefined) throw new Error('synthetic projection failure');}}]});
  const observed = observation(turnEnded, world.clock.now()); await world.hook.publish(observed.key, observed.draft);
  const before = await world.record(), id = before.notices.at(-1)?.id; assert.ok(id !== undefined);
  const answer = await world.module.operatorActions.dispatch(clearAction(id, before.revision));
  assert.equal((answer as {error: {code: string}}).error.code, 'internal');
  assert.deepEqual(await world.record(), before);
  assert.deepEqual(world.handle.operation('req-clear')?.outcomes, []);
  assert.equal(world.db.prepare("SELECT count(*) AS count FROM core_history WHERE type = 'org.bunny.notice.clear.completed'").get()?.count, 0);
});

it('owner maintenance between admission and save refuses the override at save time', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const world = await notices(context);
  let observed = observation(sessionStarted, world.clock.now(), {identity: CHILD, parent: {status: 'known', identity: IDENTITY}});
  await world.hook.publish(observed.key, observed.draft); await world.record();
  world.clock.advance(86_399_999);
  observed = observation(turnStarted, world.clock.now(), {turn: 'turn-fresh'}); await world.hook.publish(observed.key, observed.draft);
  observed = observation(turnEnded, world.clock.now(), {turn: 'turn-fresh'}); await world.hook.publish(observed.key, observed.draft);
  const before = await world.record(), id = before.notices.at(-1)?.id; assert.ok(id !== undefined);
  const records = Object.getOwnPropertyDescriptor(CoreStore.prototype, 'records')?.value as (this: CoreStore) => SessionRecord[];
  let intervene = true;
  context.mock.method(CoreStore.prototype, 'records', function (this: CoreStore): SessionRecord[] {
    const held = records.call(this);
    if (intervene) {intervene = false; world.clock.advance(2); context.mock.timers.tick(2);}
    return held;
  });
  const answer = await world.module.operatorActions.dispatch(clearAction(id, before.revision));
  assert.equal((answer as {error: {code: string}}).error.code, 'revision-conflict');
  const after = await world.record();
  assert.equal(after.children.uncertain, 0, 'real owner maintenance expired the child');
  assert.deepEqual(after.notices.at(-1)?.acknowledgedBy, []);
  assert.deepEqual(world.handle.operation('req-clear')?.outcomes, []);
});

it('committed acknowledgments survive restart and the recorded request is never resent', async context => {
  const first = await notices(context);
  const observed = observation(turnEnded, first.clock.now()); await first.hook.publish(observed.key, observed.draft);
  const before = await first.record(), id = before.notices.at(-1)?.id; assert.ok(id !== undefined);
  const action = clearAction(id, before.revision);
  await first.module.operatorActions.dispatch(action); await first.harness.stop();
  const second = await notices(context, {}, {dir: first.dir, seed: false});
  assert.deepEqual((await second.record()).notices.at(-1)?.acknowledgedBy, ['dashboard', 'nanoleaf', 'pixoo']);
  assert.deepEqual(await second.module.operatorActions.dispatch(action), {status: 'accepted', requestId: 'req-clear'});
  assert.equal(second.commands.length, 0);
  assert.equal(second.handle.operation('req-clear')?.outcomes.length, 1);
});
