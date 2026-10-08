// Tracked operator labels on the real core owner, with synthetic SQLite state and no listener.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {sessionTitle, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, childOf, noSpans, type Command, type Participant, type Reply, type Responder, type Sdk} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule, type CoreHandle, type CoreOptions} from '../src/index.js';
import {Tracker, type Action, type CompletedOutcome} from '../src/core/tracker.js';
import {CHILD, IDENTITY, SESSION_ID, observation, sessionStarted, turnStarted} from './fixtures/agents.js';
import {fillDisk} from './fixtures/disk.js';
import {CoreStore} from '../src/core/store.js';
import {World} from './fixtures/store-world.js';
import {flush, it, manualClock, stateDir} from './support.js';

const labelAction = (label: string | null, expectedRevision: number, requestId = 'req-label'): Action => ({
  key: `bunny.cmd.session-label-set.${SESSION_ID}`, requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.session-label.set.requested', subject: SESSION_ID, dataschema: 'https://bunny.invalid/events/session-label-set/2.0',
    data: {label, expectedRevision}},
});

async function labels(context: TestContext, options: CoreOptions = {}, controls: {
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
    if (pattern === 'bunny.cmd.session-label-set.*') commands.push(command);
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

it('an operator label completes through the tracker and the synced user label is its evidence', async context => {
  const world = await labels(context);
  const before = await world.record();
  assert.notEqual(world.module.operatorActions, undefined, 'the runtime has a dedicated operator dispatcher');
  const answer = await world.module.operatorActions.dispatch(labelAction('Review 🐰', before.revision));
  assert.deepEqual(answer, {status: 'accepted', requestId: 'req-label'});
  const after = await world.record();
  assert.deepEqual(after.label, {value: 'Review 🐰', origin: 'user'});
  assert.ok(after.revision > before.revision);
  const operation = world.handle.operation('req-label');
  assert.equal(operation?.status, 'completed');
  assert.equal(operation?.result, 'succeeded');
  assert.equal(operation?.evidence, 'observed');
  assert.equal(operation?.outcomes.length, 1);
});

it('clear and same-user-label actions complete without inventing a session revision', async context => {
  const world = await labels(context);
  const empty = await world.record();
  await world.module.operatorActions.dispatch(labelAction(null, empty.revision, 'req-empty'));
  assert.equal((await world.record()).revision, empty.revision);
  await world.module.operatorActions.dispatch(labelAction('Named', empty.revision, 'req-set'));
  const named = await world.record();
  await world.module.operatorActions.dispatch(labelAction('Named', named.revision, 'req-same'));
  assert.equal((await world.record()).revision, named.revision);
  await world.module.operatorActions.dispatch(labelAction(null, named.revision, 'req-clear'));
  assert.equal((await world.record()).label, undefined);
  for (const id of ['req-empty', 'req-set', 'req-same', 'req-clear']) assert.equal(world.handle.operation(id)?.status, 'completed', id);
});

it('setting an equal agent label changes its provenance and later provider metadata cannot replace the user label', async context => {
  const world = await labels(context);
  const initial = observation(turnStarted, world.clock.now(), {title: {value: 'Provider title', source: 'provider'}});
  initial.draft.data.label = {value: 'Suggested', origin: 'agent'};
  await world.hook.publish(initial.key, initial.draft);
  const suggested = await world.record();
  assert.deepEqual(suggested.label, {value: 'Suggested', origin: 'agent'});
  await world.module.operatorActions.dispatch(labelAction('Suggested', suggested.revision, 'req-provenance'));
  const user = await world.record();
  assert.deepEqual(user.label, {value: 'Suggested', origin: 'user'});
  assert.ok(user.revision > suggested.revision);
  world.clock.advance(1);
  const next = observation(turnStarted, world.clock.now(), {turn: 'turn-next', title: {value: 'New provider title', source: 'provider'}});
  next.draft.data.label = {value: 'Other suggestion', origin: 'agent'};
  await world.hook.publish(next.key, next.draft);
  const held = await world.record();
  assert.deepEqual(held.label, {value: 'Suggested', origin: 'user'});
  await world.module.operatorActions.dispatch(labelAction(null, held.revision, 'req-fallback'));
  assert.equal(sessionTitle(await world.record()), 'New provider title');
});

it('ordinary dispatch and SDK callers cannot turn claimed audit attribution into operator authority', async context => {
  const world = await labels(context);
  const before = await world.record(), action = labelAction('Forbidden', before.revision);
  assert.equal((await world.module.actions.dispatch(action) as {error: {code: string}}).error.code, 'forbidden');
  assert.equal((await world.handle.dispatch({...action, requestedBy: 'bunny/core'}) as {error: {code: string}}).error.code, 'forbidden');
  assert.equal(world.handle.operation('req-label'), undefined, 'ordinary refusal records no sent action');
  const raw = await world.hook.request(action.key, action.draft, {requestId: 'req-forged', timeoutMs: 5000});
  assert.equal(raw.status, 'rejected');
  assert.equal(raw.error.error.code, 'forbidden');
  assert.deepEqual(await world.record(), before);
});

it('stale revisions and unknown sessions are typed refusals with no successful outcome', async context => {
  const world = await labels(context);
  const before = await world.record();
  const stale = await world.module.operatorActions.dispatch(labelAction('Stale', before.revision - 1, 'req-stale'));
  assert.equal((stale as {error: {code: string}}).error.code, 'revision-conflict');
  const unknown = labelAction('Missing', before.revision, 'req-missing');
  const target = 'f'.repeat(64);
  const missing = await world.module.operatorActions.dispatch({...unknown, key: `bunny.cmd.session-label-set.${target}`, draft: {...unknown.draft, subject: target}});
  assert.equal((missing as {error: {code: string}}).error.code, 'not-found');
  assert.deepEqual(await world.record(), before);
  for (const id of ['req-stale', 'req-missing']) {
    assert.equal(world.handle.operation(id)?.status, 'rejected');
    assert.deepEqual(world.handle.operation(id)?.outcomes, []);
  }
});

it('payload capture and concurrent same-ID dispatch retain one immutable admission and one command', async context => {
  const world = await labels(context);
  const action = labelAction('Original', (await world.record()).revision);
  const first = world.module.operatorActions.dispatch(action);
  const second = world.module.operatorActions.dispatch(action);
  (action.draft.data as {label: string}).label = 'Mutated';
  assert.deepEqual(await first, {status: 'accepted', requestId: 'req-label'});
  const duplicate = await second;
  assert.equal('error' in duplicate ? duplicate.error.code : duplicate.status, 'uncertain-result');
  assert.equal((await world.record()).label?.value, 'Original');
  assert.equal(world.commands.length, 1);
  const again = await world.module.operatorActions.dispatch(labelAction('Original', (action.draft.data as {expectedRevision: number}).expectedRevision));
  assert.deepEqual(again, {status: 'accepted', requestId: 'req-label'});
  assert.equal(world.commands.length, 1);
});

it('an admitted responder binds the actual command ID and refuses copied facts on another command', async context => {
  let forged: Reply | undefined;
  const world = await labels(context, {}, {sdk: participant => ({...participant,
    respond: <T extends object>(pattern: string, responder: Responder<T>) => participant.respond<T>(pattern, async command => {
      if (pattern !== 'bunny.cmd.session-label-set.*') return responder(command);
      const admitted = responder(command);
      forged = await responder({...command, id: 'different-command-id'});
      return admitted;
    }),
  })});
  await world.module.operatorActions.dispatch(labelAction('Bound', (await world.record()).revision));
  assert.equal((forged as {error: {code: string}}).error.code, 'forbidden');
  assert.equal((await world.record()).label?.value, 'Bound');
  assert.equal(world.handle.operation('req-label')?.outcomes.length, 1);
});

it('a tracked hook failure rolls the label, outcome, history and participating rows back together', async context => {
  let fail = true;
  const world = await labels(context, {parts: [{
    open: db => { db.exec('CREATE TABLE label_projection (request_id TEXT PRIMARY KEY)'); },
    tracked: ({operation, outcome}, tx) => {
      if (outcome === undefined) return;
      tx.database.prepare('INSERT INTO label_projection VALUES (?)').run(operation.requestId);
      if (fail) throw new Error('synthetic projection failure');
    },
  }]});
  const before = await world.record();
  const history = world.db.prepare('SELECT * FROM core_history').all();
  const refused = await world.module.operatorActions.dispatch(labelAction('Rollback', before.revision));
  assert.equal((refused as {error: {code: string}}).error.code, 'internal');
  assert.deepEqual(await world.record(), before);
  assert.deepEqual(world.db.prepare('SELECT * FROM label_projection').all(), []);
  assert.deepEqual(world.handle.operation('req-label')?.outcomes, []);
  assert.equal(world.db.prepare("SELECT count(*) AS count FROM core_history WHERE type = 'org.bunny.session-label.set.completed'").get()?.count, 0);
  assert.ok(world.db.prepare('SELECT * FROM core_history').all().length >= history.length, 'sent/refused history remains separate from the rolled-back save');
  fail = false;
  assert.equal('error' in await world.module.operatorActions.dispatch(labelAction('Recovered', before.revision, 'req-recover')), false);
  assert.equal((await world.record()).label?.value, 'Recovered');
});

it('a label survives restart and repeating its request ID never sends a command again', async context => {
  const first = await labels(context);
  const revision = (await first.record()).revision;
  await first.module.operatorActions.dispatch(labelAction('Persisted', revision));
  await first.harness.stop();
  const second = await labels(context, {}, {dir: first.dir, seed: false});
  assert.equal((await second.record()).label?.value, 'Persisted');
  assert.deepEqual(await second.module.operatorActions.dispatch(labelAction('Persisted', revision)), {status: 'accepted', requestId: 'req-label'});
  assert.equal(second.commands.length, 0);
  assert.equal(second.handle.operation('req-label')?.status, 'completed');
});

it('owner maintenance queued after the read guard changes the parent revision and refuses the label atomically', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const world = await labels(context);
  const child = observation(sessionStarted, world.clock.now(), {identity: CHILD, parent: {status: 'known', identity: IDENTITY}});
  await world.hook.publish(child.key, child.draft);
  await world.record();
  world.clock.advance(86_399_999);
  const fresh = observation(turnStarted, world.clock.now(), {turn: 'turn-fresh'});
  await world.hook.publish(fresh.key, fresh.draft);
  const before = await world.record();
  assert.equal(before.children.uncertain, 1);
  const records = Object.getOwnPropertyDescriptor(CoreStore.prototype, 'records')?.value as (this: CoreStore) => SessionRecord[];
  let intervene = true;
  context.mock.method(CoreStore.prototype, 'records', function (this: CoreStore): SessionRecord[] {
    const held = records.call(this);
    if (intervene) {
      intervene = false;
      world.clock.advance(2);
      // The owner's real maintenance timer queues before setLabel; the core's mutation queue is already occupied.
      context.mock.timers.tick(2);
    }
    return held;
  });
  const answer = await world.module.operatorActions.dispatch(labelAction('Must conflict', before.revision));
  assert.equal((answer as {error: {code: string}}).error.code, 'revision-conflict');
  const after = await world.record();
  assert.equal(after.children.uncertain, 0, 'the actual owner maintenance expired the child');
  assert.ok(after.revision > before.revision);
  assert.equal(after.label, undefined);
  assert.deepEqual(world.handle.operation('req-label')?.outcomes, []);
});

it('a running responder can complete after its SDK deadline without losing its admitted context', async context => {
  const preceding: string[] = [];
  const world = await labels(context, {parts: [{tracked: ({previous, outcome}) => {
    if (outcome !== undefined && previous !== undefined) preceding.push(previous.status);
  }}]});
  const before = await world.record();
  const records = Object.getOwnPropertyDescriptor(CoreStore.prototype, 'records')?.value as (this: CoreStore) => SessionRecord[];
  let delay = true;
  context.mock.method(CoreStore.prototype, 'records', function (this: CoreStore): SessionRecord[] {
    const held = records.call(this);
    if (delay) { delay = false; world.clock.advance(5001); }
    return held;
  });
  const answer = await world.module.operatorActions.dispatch(labelAction('Late', before.revision));
  assert.equal((answer as {error: {code: string}}).error.code, 'uncertain-result');
  const after = await world.record();
  assert.equal(after.label?.value, 'Late');
  assert.deepEqual(preceding, ['uncertain']);
  assert.equal(world.handle.operation('req-label')?.status, 'completed');
  assert.equal(world.commands.length, 1);
});

it('a command that missed admission before SDK settlement cannot consume its expired waiting context', async context => {
  let deliver: (() => Promise<Reply>) | undefined;
  const world = await labels(context, {}, {sdk: participant => ({...participant,
    respond: <T extends object>(pattern: string, responder: Responder<T>) => participant.respond<T>(pattern, command => {
      if (pattern !== 'bunny.cmd.session-label-set.*') return responder(command);
      return new Promise<Reply>(resolve => {
        deliver = async () => { const answer = await responder(command); resolve(answer); return answer; };
      });
    }),
  })});
  const before = await world.record();
  const pending = world.module.operatorActions.dispatch(labelAction('Expired admission', before.revision));
  while (deliver === undefined) await flush();
  world.clock.advance(5001);
  assert.equal((await pending as {error: {code: string}}).error.code, 'uncertain-result');
  assert.equal((await deliver() as {error: {code: string}}).error.code, 'forbidden');
  assert.equal((await world.record()).label, undefined);
  assert.deepEqual(world.handle.operation('req-label')?.outcomes, []);
});

it('a full owner-save transaction rolls back label and outcome after the sent action was recorded', async context => {
  let db: DatabaseSync | undefined;
  const world = await labels(context, {}, {database: selected => { db = selected; return selected; }, sdk: participant => ({...participant,
    respond: <T extends object>(pattern: string, responder: Responder<T>) => participant.respond<T>(pattern, command => {
      if (pattern === 'bunny.cmd.session-label-set.*') { assert.ok(db); fillDisk(db); }
      return responder(command);
    }),
  })});
  const before = await world.record();
  const answer = await world.module.operatorActions.dispatch(labelAction('Capacity boundary', before.revision));
  assert.equal((answer as {error: {code: string}}).error.code, 'capacity');
  assert.equal((await world.record()).label, undefined);
  assert.deepEqual(world.handle.operation('req-label')?.outcomes, []);
  world.db.exec('PRAGMA max_page_count = 1073741823');
});

it('committed label and completion survive refused publication and restart without command resend', async context => {
  let refuse = false;
  const first = await labels(context, {}, {sdk: participant => ({...participant,
    publishMessage: (key, message) => refuse && message.type.includes('session-label.set.completed')
      ? Promise.reject(new Error('synthetic publication failure')) : participant.publishMessage(key, message),
  })});
  const before = await first.record();
  refuse = true;
  assert.deepEqual(await first.module.operatorActions.dispatch(labelAction('Committed', before.revision)), {status: 'accepted', requestId: 'req-label'});
  await flush();
  assert.equal(first.handle.operation('req-label')?.status, 'completed');
  assert.equal((await first.record()).label?.value, 'Committed');
  assert.ok(first.db.prepare('SELECT count(*) AS count FROM bunny_outbox').get()?.count as number > 0);
  await first.harness.stop();
  const second = await labels(context, {}, {dir: first.dir, seed: false});
  assert.equal((await second.record()).label?.value, 'Committed');
  assert.equal(second.handle.operation('req-label')?.status, 'completed');
  assert.equal(second.commands.length, 0);
  const outcomes = second.messages.filter(message => message.type === 'org.bunny.session-label.set.completed');
  assert.ok(outcomes.length >= 1);
  assert.equal(new Set(outcomes.map(message => message.id)).size, 1, 'outbox retries preserve the committed message identity');
  assert.equal(second.db.prepare("SELECT count(*) AS count FROM core_history WHERE type = 'org.bunny.session-label.set.completed'").get()?.count, 1);
});

it('the transaction refuses another command ID or an invalid core outcome before saving any label or completion', async context => {
  for (const fault of ['command-id', 'outcome'] as const) {
    const world = await World.open(context);
    await world.observe(sessionStarted);
    const bus = new InProcessBus({now: world.clock.now, scheduler: world.clock.scheduler}), sdk = bus.connect('bunny/core');
    const tracker = new Tracker({store: world.store, sdk, clock: {now: world.clock.now}, scheduler: world.clock.scheduler,
      log: {debug: () => {}, info: () => {}, warn: () => {}, error: () => {}}, trace: {...noSpans, span: childOf}, ready: Promise.resolve()});
    tracker.open(world.db);
    context.after(async () => { await sdk.close(); await tracker.stop(); });
    const record = world.store.records()[0];
    assert.ok(record);
    const before = world.rows('SELECT * FROM state');
    await sdk.respond<{requestId: string; label: string; expectedRevision: number}>('bunny.cmd.session-label-set.*', async command => {
      assert.equal(tracker.admitOperator(command), true);
      assert.ok(world.owner);
      const result = await world.store.during({message: command, kind: 'label', entity: SESSION_ID},
        () => { assert.ok(world.owner); return world.owner.setLabel(IDENTITY, 'Rejected transaction'); },
        (_change, tx) => tracker.completeCore(tx, fault === 'command-id' ? {...command, id: 'not-the-admitted-command'} : command,
          {result: 'succeeded', evidence: fault === 'outcome' ? 'invalid-evidence' : 'observed'} as Omit<CompletedOutcome, 'requestId'>));
      tracker.endOperator(command);
      assert.deepEqual(result, {ok: false, code: 'storage-failed'});
      return errorBody('internal', {detail: 'the synthetic transaction was refused'});
    });
    const answer = await tracker.dispatchOperator(labelAction('Rejected transaction', record.revision, `req-${fault}`));
    assert.equal((answer as {error: {code: string}}).error.code, 'internal');
    assert.deepEqual(world.rows('SELECT * FROM state'), before);
    assert.equal(world.store.records()[0]?.label, undefined);
    assert.deepEqual(tracker.operation(`req-${fault}`)?.outcomes, []);
    assert.equal(world.db.prepare("SELECT count(*) AS count FROM core_history WHERE type = 'org.bunny.session-label.set.completed'").get()?.count, 0);
  }
});
