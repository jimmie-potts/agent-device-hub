// The core's `operation` family (Hub #922): each tracked action's latest state, published from the tracker's own change,
// in that change's transaction, and served through sync, so a display shows an action requested, accepted and completed.
// A scripted gadget plays the device. The family keeps the latest records only, removing the oldest settled one, never a
// pending one, and every message it publishes follows profile 2.0 and the core families.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {MessageValidator, type Message} from '@jimmie-potts/event-contracts/v2';
import {operationEntityId, registerCoreFamilies, type OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {Participant} from '@jimmie-potts/sdk';
import {DEADLINES, MAX_OPERATION_RECORDS, createCoreModule, type ActionAnswer, type CoreModule, type Runtime} from '../src/index.js';
import {Gadget, setGadget} from './fixtures/gadget.js';
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
};

/** The core and the gadget, and a reader that hears every `operation` message; on a manual clock when asked. */
async function world(context: TestContext, options: {gadget?: Gadget; dir?: string; manual?: boolean; limit?: number} = {}): Promise<World> {
  const core = createCoreModule(options.limit === undefined ? {} : {operationLimit: options.limit});
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
  return {
    runtime, core, gadget, reader, heard, clock,
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
