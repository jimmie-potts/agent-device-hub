// The core's `operation` family (Hub #922): each tracked action's latest state, published from the tracker's own change,
// in that change's transaction, and served through sync, so a display shows an action requested, accepted and completed.
// A scripted gadget plays the device. The family keeps the latest records only, removing the oldest settled one, never a
// pending one, and every message it publishes follows profile 2.0 and the core families.
import assert from 'node:assert/strict';
import type {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {MessageValidator, errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {operationEntityId, registerCoreFamilies, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, type Participant, type Sdk} from '@jimmie-potts/sdk';
import {DEADLINES, MAX_OPERATION_RECORDS, createCoreModule, type ActionAnswer, type CoreModule, type Runtime} from '../src/index.js';
import {Gadget, setGadget} from './fixtures/gadget.js';
import {fillDisk} from './fixtures/disk.js';
import {contextOf, fixture, flush, it, manualClock, run, stateDir, waitFor} from './support.js';

const OPERATOR = 'bunny/parts/operator';
const validator = new MessageValidator();
registerCoreFamilies(validator);

type World = {
  runtime: Runtime; core: CoreModule; gadget: Gadget; reader: Pick<Participant, 'sync'>;
  /** Every `operation` message the reader heard, states and removals, in order. */
  heard: Message[];
  dispatch: (requestId: string) => Promise<ActionAnswer>;
  clock: ReturnType<typeof manualClock> | undefined;
  database: DatabaseSync;
};

/** The core and the gadget, and a reader that hears every `operation` message; on a manual clock when asked. */
async function world(context: TestContext, options: {
  gadget?: Gadget; dir?: string; manual?: boolean; limit?: number;
  failOutcome?: {enabled: boolean}; publication?: {deferred: boolean};
  beforePublish?: (database: DatabaseSync) => void;
} = {}): Promise<World> {
  let database: DatabaseSync | undefined;
  const core = createCoreModule({
    ...options.limit === undefined ? {} : {operationLimit: options.limit},
    beforePublish: () => { if (database !== undefined) options.beforePublish?.(database); },
    parts: [{
      open: db => { database = db; },
      tracked: change => {
        if (options.failOutcome?.enabled === true && change.outcome !== undefined) throw new Error('the test part refused the outcome');
      },
    }],
  });
  // Refuse publication after the real tracker/part/outbox transaction commits. A restart must send only stored state.
  if (options.publication !== undefined) {
    const start = core.start.bind(core);
    core.start = moduleContext => {
      const sdk = moduleContext.sdk;
      const publishing: Sdk = {
        source: sdk.source,
        publish: (key, draft, sendOptions) => sdk.publish(key, draft, sendOptions),
        publishMessage: (key, message) => options.publication?.deferred === true && key.startsWith('bunny.state.operation.')
          ? Promise.reject(new SdkError(errorBody('unavailable'))) : sdk.publishMessage(key, message),
        subscribe: (pattern, handler, subscribeOptions) => sdk.subscribe(pattern, handler, subscribeOptions),
        request: (key, draft, requestOptions) => sdk.request(key, draft, requestOptions),
        respond: (pattern, responder) => sdk.respond(pattern, responder),
        sync: (families, handler, syncOptions) => sdk.sync(families, handler, syncOptions),
        serveSync: (families, provider) => sdk.serveSync(families, provider),
      };
      return start({...moduleContext, sdk: publishing});
    };
  }
  const gadget = options.gadget ?? new Gadget();
  const clock = options.manual === true ? manualClock(Date.now()) : undefined;
  const heard: Message[] = [];
  // A module that reads as a display would: it hears every operation message, and syncs the family.
  const watcher = fixture('watcher', async moduleContext => {
    await moduleContext.sdk.subscribe('bunny.state.operation.*', message => { heard.push(message); });
  });
  const {runtime} = await run(context, {
    modules: [core, gadget.module(), watcher], ...(options.dir === undefined ? {} : {stateDir: options.dir}),
    ...(clock === undefined ? {} : {clock: {now: clock.now}, scheduler: clock.scheduler}),
  });
  const reader = contextOf(watcher).sdk;
  assert.ok(database);
  return {
    runtime, core, gadget, reader, heard, clock, database,
    dispatch: requestId => core.actions.dispatch({...setGadget(50), requestedBy: OPERATOR, requestId}),
  };
}

/** The latest record the reader heard for a request. */
const latest = (w: World, requestId: string): OperationRecord | undefined =>
  w.heard.filter(message => message.kind === 'state').map(message => message.data as OperationRecord).filter(record => record.requestId === requestId).at(-1);
/** The statuses the reader heard for a request, in order, with each result. */
const statuses = (w: World, requestId: string): string[] => w.heard.filter(message => message.kind === 'state')
  .map(message => message.data as OperationRecord).filter(record => record.requestId === requestId).map(record => `${record.status}${record.result === undefined ? '' : ` ${record.result}`}`);
async function advance(w: World, ms: number): Promise<void> {
  assert.ok(w.clock);
  w.clock.advance(ms);
  for (let turn = 0; turn < 5; turn += 1) await flush();
}
const assertValid = (messages: readonly Message[]): void => {
  for (const message of messages) {
    const checked = validator.validate(message, {nowMs: Date.parse(message.time)});
    assert.equal(checked.ok, true, `${message.type}: ${JSON.stringify(checked.ok ? '' : checked.error)}`);
  }
};

/** A reader reconnects by syncing current records, without replaying an action. */
async function records(w: World): Promise<OperationRecord[]> {
  const synced = await w.reader.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000});
  assert.equal(synced.status, 'synced');
  if (synced.status !== 'synced') return [];
  const held = synced.copy.states().map(state => state.data);
  assertValid(synced.copy.states());
  await synced.copy.close();
  return held;
}

it('an action\'s record goes sent, accepted, then completed with its evidence, from the tracker\'s row, and a sync serves the latest', async context => {
  const w = await world(context);
  assert.deepEqual(await w.dispatch('req-on'), {status: 'accepted', requestId: 'req-on'});
  await waitFor(() => latest(w, 'req-on')?.status === 'completed', 5000, 'the completed record');
  assert.deepEqual(statuses(w, 'req-on'), ['sent', 'accepted', 'completed succeeded'], 'requested, accepted and completed, each its own record');
  const record = latest(w, 'req-on');
  assert.deepEqual(record, {
    id: operationEntityId('req-on'), revision: record?.revision, requestId: 'req-on', kind: 'device', family: 'gadget-set',
    command: 'org.bunny.gadget.set.requested', target: 'g1', requestedBy: OPERATOR, status: 'completed', result: 'succeeded', evidence: 'observed',
    reply: 'accepted', sentAtMs: record?.sentAtMs, updatedAtMs: record?.updatedAtMs, deadlineAtMs: (record?.sentAtMs ?? 0) + DEADLINES.device.outcomeMs,
  }, 'the tracker\'s row, without the command\'s payload');
  const revisions = w.heard.map(message => (message.data as OperationRecord).revision);
  assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b), 'each change at a higher revision');
  assert.ok(w.heard.every(message => message.source === 'bunny/core' && message.subject === operationEntityId('req-on')));
  // A pending record carried no result: an accepted reply is never a result.
  const accepted = w.heard.map(message => message.data as OperationRecord).find(item => item.status === 'accepted');
  assert.deepEqual([accepted?.result, accepted?.evidence], [undefined, undefined]);
  // A sync of the family alone serves the latest record at the core's revision.
  const synced = await w.reader.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000});
  assert.equal(synced.status, 'synced');
  if (synced.status === 'synced') {
    assert.deepEqual(synced.copy.states().map(state => state.data), [record]);
    assert.ok(synced.message.data.revision >= (record?.revision ?? Infinity));
    assertValid(synced.copy.states());
    await synced.copy.close();
  }
  assertValid(w.heard);
});

it('a full disk changes no tracker, operation projection, history or outbox row and sends no command', async context => {
  const w = await world(context);
  await w.dispatch('req-before-full');
  await waitFor(() => latest(w, 'req-before-full')?.status === 'completed', 5000, 'the baseline');
  await waitFor(() => w.database.prepare('SELECT 1 FROM bunny_outbox').get() === undefined, 5000, 'publication drained');
  const tables = ['core_operations', 'operation_records', 'core_history', 'bunny_outbox', 'core_revision'];
  const snapshot = (): unknown => tables.map(table => w.database.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot(), heard = w.heard.length;
  fillDisk(w.database);
  const answer = await w.dispatch('req-disk-full');
  assert.equal('error' in answer && answer.error.code, 'unavailable');
  assert.equal('error' in answer && answer.error.detail, 'storage-full');
  assert.deepEqual(snapshot(), before, 'the refused transaction kept every row unchanged');
  assert.equal(w.heard.length, heard, 'nothing was published');
  assert.equal(w.gadget.commands.length, 1, 'nothing reached the device');
  w.database.exec('PRAGMA max_page_count = 1073741823');
  assert.deepEqual((await records(w)).map(record => record.requestId), ['req-before-full']);
});

it('a later part failure rolls back the operation projection with the tracker, history and acknowledgment', async context => {
  const failOutcome = {enabled: true};
  const w = await world(context, {failOutcome});
  w.gadget.script({outcome: 'none'});
  await w.dispatch('req-atomic');
  const before = await records(w), heard = w.heard.length;
  const outcome = await w.gadget.report('req-atomic', {result: 'succeeded', evidence: 'observed'});
  await waitFor(() => w.runtime.health().modules.find(module => module.name === 'core')?.state === 'running', 5000, 'the core stays running');
  for (let turn = 0; turn < 5; turn += 1) await flush();
  assert.deepEqual(await records(w), before, 'the part had updated its projection before the later part threw, but the transaction rolled it back');
  assert.equal(w.heard.length, heard, 'no uncommitted state went out');
  const held = w.database.prepare('SELECT status FROM core_operations WHERE request_id = ?').get('req-atomic') as {status: string};
  assert.equal(held.status, 'accepted');
  assert.equal(w.database.prepare('SELECT 1 FROM core_history WHERE source = ? AND message_id = ?').get(outcome.source, outcome.id), undefined);
  assert.equal(w.gadget.acknowledged.includes(outcome.id), false);
  assert.equal(w.database.prepare('SELECT 1 FROM bunny_outbox').get(), undefined);
  failOutcome.enabled = false;
  await w.gadget.forge(outcome, outcome.data);
  await waitFor(() => latest(w, 'req-atomic')?.status === 'completed', 5000, 'the same outcome commits after recovery');
  await waitFor(() => w.gadget.acknowledged.includes(outcome.id), 5000, 'acknowledged after commit');
  assert.equal(w.gadget.commands.length, 1);
  assertValid(w.heard);
});

it('committed operation messages survive a refused publication and restart with their identity, time and trace, without another command', async context => {
  const dir = await stateDir(context), gadget = new Gadget();
  const committed: string[] = [];
  const first = await world(context, {dir, gadget, publication: {deferred: true}, beforePublish: database => {
    const tracked = database.prepare('SELECT status FROM core_operations WHERE request_id = ?').get('req-unpublished') as {status: string} | undefined;
    if (tracked === undefined) return;
    const projection = database.prepare('SELECT record FROM operation_records WHERE id = ?').get(operationEntityId('req-unpublished')) as {record: string};
    assert.equal((JSON.parse(projection.record) as OperationRecord).status, tracked.status, 'the committed tracker and projection agree before publication');
    assert.ok(database.prepare('SELECT 1 FROM bunny_outbox').get(), 'publication messages are durable already');
    if (tracked.status === 'sent') assert.equal(gadget.commands.length, 0, 'sent intent commits before any device command');
    committed.push(tracked.status);
  }});
  await first.dispatch('req-unpublished');
  await waitFor(() => {
    const row = first.database.prepare('SELECT status FROM core_operations WHERE request_id = ?').get('req-unpublished') as {status: string};
    return row.status === 'completed';
  }, 5000, 'the tracker committed completion');
  assert.equal(first.heard.length, 0, 'committed is not published');
  const held = await records(first);
  assert.equal(held[0]?.status, 'completed', 'sync reads the committed projection');
  const stored = (first.database.prepare('SELECT message FROM bunny_outbox ORDER BY seq').all() as {message: string}[])
    .map(row => JSON.parse(row.message) as Message).filter(message => message.dataschema.endsWith('/operation/2.0'));
  assert.equal(stored.length, 3);
  assert.deepEqual(committed, ['sent', 'accepted', 'completed']);
  await first.runtime.stop();
  const second = await world(context, {dir, gadget});
  await waitFor(() => stored.every(message => second.heard.some(heard => heard.id === message.id)), 5000, 'the stored messages republished');
  for (const message of stored) assert.deepEqual(second.heard.find(heard => heard.id === message.id), message, 'stored id, time, data and trace remain unchanged');
  assert.deepEqual(await records(second), held);
  assert.equal(gadget.commands.length, 1, 'restart never resends the command');
  await waitFor(() => second.database.prepare('SELECT 1 FROM bunny_outbox').get() === undefined, 5000, 'publication drained');
  assertValid(second.heard);
});

it('a refusal and a deadline each settle the record as the tracker does, and a late outcome completes an uncertain one', async context => {
  const w = await world(context, {manual: true});
  w.gadget.script({reply: 'not-found'}, {outcome: 'none'});
  await w.dispatch('req-refused');
  await waitFor(() => latest(w, 'req-refused')?.status === 'rejected', 5000, 'the refused record');
  assert.deepEqual([latest(w, 'req-refused')?.result, latest(w, 'req-refused')?.evidence, latest(w, 'req-refused')?.error?.code, latest(w, 'req-refused')?.reply],
    ['failed', 'none', 'not-found', 'not-found'], 'a refusal proves no effect');
  await w.dispatch('req-quiet');
  await advance(w, DEADLINES.device.outcomeMs);
  await waitFor(() => latest(w, 'req-quiet')?.status === 'uncertain', 5000, 'uncertain at the deadline');
  assert.deepEqual([latest(w, 'req-quiet')?.result, latest(w, 'req-quiet')?.error?.code], ['uncertain', 'uncertain-result']);
  await w.gadget.report('req-quiet', {result: 'succeeded', evidence: 'transmitted'});
  await waitFor(() => latest(w, 'req-quiet')?.status === 'completed', 5000, 'the late outcome');
  assert.deepEqual(statuses(w, 'req-quiet'), ['sent', 'accepted', 'uncertain uncertain', 'completed succeeded']);
  assert.equal(latest(w, 'req-quiet')?.evidence, 'transmitted', 'a transmission, not an observation: the page never calls it a physical result');
  assert.equal(w.gadget.commands.length, 2, 'nothing was sent again');
  assertValid(w.heard);
});

it('the family keeps the latest records: the oldest settled one is removed as retired, and a pending one never is', async context => {
  const w = await world(context, {limit: 2});
  // Accepted with no outcome yet: pending until its deadline, which this test never reaches.
  w.gadget.script({outcome: 'none'});
  assert.deepEqual(await w.dispatch('req-held'), {status: 'accepted', requestId: 'req-held'});
  for (const requestId of ['req-1', 'req-2', 'req-3']) {
    await w.dispatch(requestId);
    await waitFor(() => latest(w, requestId)?.status === 'completed', 5000, requestId);
  }
  const removals = (): string[] => w.heard.filter(message => message.kind === 'removal').map(message => (message.data as {entity: {id: string}; reason: string}))
    .map(removal => `${removal.entity.id === operationEntityId('req-1') ? 'req-1' : removal.entity.id === operationEntityId('req-2') ? 'req-2' : 'other'} ${removal.reason}`);
  await waitFor(() => removals().length === 2, 5000, 'two removals');
  assert.deepEqual(removals(), ['req-1 retired', 'req-2 retired'], 'the oldest settled ones, never the pending one');
  const synced = await w.reader.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000});
  assert.equal(synced.status, 'synced');
  if (synced.status === 'synced') {
    assert.deepEqual(synced.copy.states().map(state => state.data.requestId), ['req-held', 'req-3'], 'the pending one stays though it is the oldest');
    await synced.copy.close();
  }
  assertValid(w.heard);
  assert.ok(MAX_OPERATION_RECORDS >= 64, 'the shipped bound keeps a display\'s recent actions');
});

it('the records outlive a restart, and a pending action\'s record turns uncertain at its deadline after it', async context => {
  const dir = await stateDir(context);
  const gadget = new Gadget();
  gadget.script({}, {outcome: 'none'});
  const first = await world(context, {gadget, dir});
  await first.dispatch('req-done');
  await waitFor(() => latest(first, 'req-done')?.status === 'completed', 5000, 'the first action');
  await first.dispatch('req-pending');
  await waitFor(() => latest(first, 'req-pending')?.status === 'accepted', 5000, 'the pending action');
  await first.runtime.stop();
  const second = await world(context, {gadget, dir, manual: true});
  const synced = await second.reader.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000});
  assert.equal(synced.status, 'synced');
  if (synced.status === 'synced') {
    assert.deepEqual(synced.copy.states().map(state => `${state.data.requestId} ${state.data.status}`), ['req-done completed', 'req-pending accepted']);
    await synced.copy.close();
  }
  await advance(second, DEADLINES.device.outcomeMs);
  await waitFor(() => latest(second, 'req-pending')?.status === 'uncertain', 5000, 'uncertain after the restart');
  assert.equal(gadget.commands.length, 2, 'never sent again');
  assertValid(second.heard);
});

it('settlement prunes excess pending records without a new dispatch, and a late retired outcome stays within the bound', async context => {
  const w = await world(context, {limit: 2, manual: true});
  w.gadget.script({outcome: 'none'}, {outcome: 'none'}, {outcome: 'none'});
  for (const id of ['req-old', 'req-middle', 'req-new']) {
    await w.dispatch(id);
    await advance(w, 1);
  }
  assert.equal((await records(w)).length, 3, 'all pending actions survive, even above the bound');
  assert.equal(w.heard.filter(message => message.kind === 'removal').length, 0);
  const first = await w.gadget.report('req-old', {result: 'succeeded', evidence: 'observed'});
  await waitFor(() => latest(w, 'req-old')?.status === 'completed', 5000, 'the oldest action settles');
  assert.deepEqual((await records(w)).map(record => record.requestId), ['req-middle', 'req-new'], 'settlement restores the bound');
  for (const id of ['req-middle', 'req-new']) {
    await w.gadget.report(id, {result: 'succeeded', evidence: 'observed'});
    await waitFor(() => latest(w, id)?.status === 'completed', 5000, id);
  }
  const late = await w.gadget.report('req-old', {result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true}});
  await waitFor(() => latest(w, 'req-old')?.status === 'conflict', 5000, 'a late conflicting outcome');
  assert.deepEqual((await records(w)).map(record => record.requestId), ['req-middle', 'req-new'], 'an old retired projection cannot displace recent records');
  const retirement = w.heard.filter(message => message.kind === 'removal' && message.subject === operationEntityId('req-old'));
  assert.equal(retirement.length, 2, 'the late update retires its projection again');
  assert.equal(retirement[0]?.traceparent.slice(3, 35), first.traceparent.slice(3, 35), 'retirement joins the settling outcome\'s trace');
  assert.equal(w.database.prepare('SELECT count(*) AS count FROM core_operations').get()?.count, 3, 'projection retirement preserves every tracker row');
  assert.equal(w.database.prepare('SELECT status FROM core_operations WHERE request_id = ?').get('req-old')?.status, 'conflict');
  for (const outcome of [first, late]) {
    assert.ok(w.database.prepare('SELECT 1 FROM core_history WHERE source = ? AND message_id = ?').get(outcome.source, outcome.id), 'retirement preserves both outcomes in history');
  }
  assert.equal(w.gadget.commands.length, 3, 'late outcomes and syncs send no command');
  assertValid(w.heard);
});

it('retirement orders equal send times by stable operation ID', async context => {
  const w = await world(context, {limit: 2, manual: true});
  for (const id of ['req-tie-a', 'req-tie-b']) {
    await w.dispatch(id);
    await waitFor(() => latest(w, id)?.status === 'completed', 5000, id);
  }
  const settled = (await records(w)).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(settled[0]?.sentAtMs, settled[1]?.sentAtMs, 'both actions have the same send time');
  w.gadget.script({outcome: 'none'});
  await w.dispatch('req-tie-held');
  const removal = w.heard.find(message => message.kind === 'removal');
  assert.ok(removal);
  assert.equal(removal.subject, settled[0]?.id, 'the lower stable ID is retired first');
  assert.deepEqual(new Set((await records(w)).map(record => record.requestId)), new Set([settled[1]?.requestId, 'req-tie-held']));
  assertValid(w.heard);
});

it('operation states retain the action trace, and a separately traced late outcome supplies its own causal trace', async context => {
  const w = await world(context);
  await w.dispatch('req-trace');
  await waitFor(() => latest(w, 'req-trace')?.status === 'completed', 5000, 'the completed action');
  const command = w.gadget.commands[0];
  assert.ok(command);
  const states = w.heard.filter(message => message.kind === 'state');
  assert.equal(states.length, 3);
  assert.ok(states.every(message => message.traceparent.slice(3, 35) === command.traceparent.slice(3, 35)), 'sent, accepted and completed continue the action\'s trace');
  const late = await w.gadget.report('req-trace', {result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true}});
  await waitFor(() => latest(w, 'req-trace')?.status === 'conflict', 5000, 'the late outcome');
  assert.equal(w.heard.at(-1)?.traceparent.slice(3, 35), late.traceparent.slice(3, 35), 'the state follows the incoming outcome, rather than starting a root');
  assert.equal(w.gadget.commands.length, 1);
  assertValid(w.heard);
});

it('a command still queued at its reply deadline publishes expired with failed result and no effect evidence', async context => {
  const w = await world(context, {manual: true});
  w.gadget.script({reply: 'hold', outcome: 'none'});
  const held = w.dispatch('req-handler'), queued = w.dispatch('req-queued');
  await waitFor(() => w.gadget.commands.length === 1 && latest(w, 'req-queued')?.status === 'sent', 5000, 'one handler and one queued command');
  await advance(w, DEADLINES.device.replyMs);
  await Promise.all([held, queued]);
  assert.deepEqual([latest(w, 'req-queued')?.status, latest(w, 'req-queued')?.result, latest(w, 'req-queued')?.evidence,
    latest(w, 'req-queued')?.error?.code, latest(w, 'req-queued')?.reply], ['expired', 'failed', 'none', 'expired', 'expired']);
  assert.equal((await records(w)).find(record => record.requestId === 'req-queued')?.status, 'expired');
  w.gadget.release();
  await flush();
  assert.equal(w.gadget.commands.length, 1, 'the expired command never reached its owner');
  assertValid(w.heard);
});

it('conflicting definitive outcomes publish conflict in both orders, and a duplicate outcome changes no record or revision', async context => {
  const w = await world(context);
  w.gadget.script({outcome: 'none'}, {outcome: 'none'});
  for (const [requestId, first, second] of [['req-success-first', 'succeeded', 'failed'], ['req-failure-first', 'failed', 'succeeded']] as const) {
    await w.dispatch(requestId);
    const report = (result: 'succeeded' | 'failed'): Promise<Message> => w.gadget.report(requestId, result === 'succeeded'
      ? {result, evidence: 'observed'} : {result, evidence: 'none', error: {code: 'unavailable', retryable: true}});
    await report(first);
    await waitFor(() => latest(w, requestId)?.status === 'completed', 5000, 'the first definitive outcome');
    const outcome = await report(second);
    await waitFor(() => latest(w, requestId)?.status === 'conflict', 5000, 'the conflicting outcome');
    assert.deepEqual([latest(w, requestId)?.result, latest(w, requestId)?.evidence], ['conflict', 'observed']);
    const before = await records(w), heard = w.heard.length;
    await w.gadget.forge(outcome, outcome.data);
    for (let turn = 0; turn < 5; turn += 1) await flush();
    assert.deepEqual(await records(w), before, 'the duplicate keeps the same latest record and revision');
    assert.equal(w.heard.length, heard, 'no second operation update');
  }
  assert.equal(w.gadget.commands.length, 2);
  assertValid(w.heard);
});
