import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {InProcessBus, type Draft, type Sdk, type SyncedCopy} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCoreModule} from '../src/core/core.js';
import {World, lifecycleMessage} from './fixtures/store-world.js';
import {CLAUDE_RECEIPT_FEED, receiptQualification, receiptSource} from '../src/read-receipts/qualification.js';
import {CHILD, IDENTITY, observation, sessionStarted, turnEnded, turnStarted} from './fixtures/agents.js';
import {flush, it, stateDir, waitFor} from './support.js';

const SOURCE = receiptSource(IDENTITY);
const ID = sessionEntityId(IDENTITY);

async function setup(context: TestContext) {
  const bus = new InProcessBus();
  const harness = new ModuleHarness(createCoreModule(), {bus, stateDir: await stateDir(context)});
  await harness.start();
  context.after(() => harness.stop());
  const hook = bus.connect('bunny/parts/hook'), reader = bus.connect(SOURCE);
  context.after(async () => {await hook.close(); await reader.close();});
  const synced = await reader.sync<Session30Record>(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced');
  assert.ok(synced.status === 'synced');
  const record = () => current(synced.copy);
  const emit = async (event: typeof turnStarted, turn = 'turn-1') => {
    const {key, draft} = observation(event, Date.now(), {turn});
    const sent = await hook.publish(key, draft);
    await waitFor(() => harness.logs.some(row => row.event === 'message.received' && row.fields['bunny.message.id'] === sent.id));
    await flush();
  };
  await emit(turnStarted);
  await emit(turnEnded);
  return {harness, hook, reader, record, emit};
}

function current(copy: SyncedCopy<Session30Record>): Session30Record {
  const record = copy.states().find(state => state.data.id === ID)?.data;
  assert.ok(record);
  return record;
}

function draftFor(record: Session30Record): Draft<ReadReceiptObservation> {
  assert.ok(record.turn.status === 'known');
  const turn = record.turn;
  const notice = record.outcome.notices.find(item => item.turn.status === 'known' && item.turn.id === turn.id);
  assert.ok(notice);
  return {kind: 'occurrence', type: 'org.bunny.lifecycle.observed', subject: record.id, dataschema: READ_RECEIPT_SCHEMA,
    data: {identity: record.identity, turn, parent: {status: 'unknown'}, observedAtMs: Date.now(), ordering: {status: 'unknown'},
      event: {kind: 'read-receipt-observed', generation: record.generation, noticeId: notice.id,
        receipt: {kind: 'owned-ui', viewRevision: `session-${record.revision}`}}}};
}

async function send(sdk: Sdk, harness: ModuleHarness, draft: Draft<ReadReceiptObservation>) {
  const message = await sdk.publish(`bunny.event.lifecycle.${draft.subject}`, draft);
  await waitFor(() => harness.logs.some(row => row.event === 'message.received' && row.fields['bunny.message.id'] === message.id));
  await flush();
  return message;
}

it('the Claude receipt feed and source stay the persisted enrollment literals across client versions (Hub #2122)', () => {
  // Changing either would derive a new source and orphan every enrolled read credential.
  assert.equal(CLAUDE_RECEIPT_FEED, 'claude-terminal-read-2.1.292');
  assert.equal(SOURCE, 'bunny/parts/claude-read-fda025c78e2a4a90d04c2b24b9f7129a');
});

it('a qualified explicit Claude action clears only the displayed finished result', async context => {
  const world = await setup(context), before = structuredClone(world.record());
  await send(world.reader, world.harness, draftFor(before));
  const after = world.record();
  assert.equal(after.outcome.read, 'read');
  assert.ok(after.revision > before.revision);
  assert.deepEqual(after.identity, before.identity);
  assert.deepEqual(after.outcome.notices, before.outcome.notices, 'read is not consumer acknowledgment');
  assert.deepEqual(after.work, before.work, 'read is not work evidence');
  assert.deepEqual(after.attention, before.attention);
  assert.equal(after.lastEvidenceAtMs, before.lastEvidenceAtMs);
  assert.equal(after.observedAtMs, before.observedAtMs);
});

it('a replay and an older pane cannot clear a new turn, and an ordinary hook cannot qualify itself', async context => {
  const world = await setup(context), old = draftFor(world.record());
  await send(world.hook, world.harness, old);
  assert.equal(world.record().outcome.read, 'unknown');
  await send(world.reader, world.harness, old);
  const readRevision = world.record().revision;
  await send(world.reader, world.harness, old);
  assert.equal(world.record().revision, readRevision);
  await world.emit(turnStarted, 'turn-2');
  await world.emit(turnEnded, 'turn-2');
  const fresh = structuredClone(world.record());
  assert.equal(fresh.outcome.read, 'unknown');
  assert.equal(fresh.outcome.readReceipt, undefined);
  await send(world.reader, world.harness, old);
  assert.deepEqual(world.record(), fresh);
  await send(world.reader, world.harness, draftFor(fresh));
  assert.equal(world.record().outcome.read, 'read');
});

async function stored(context: TestContext) {
  const world = await World.open(context);
  await world.observe(turnStarted);
  await world.observe(turnEnded);
  const record = world.store.records()[0]; assert.ok(record);
  const draft = draftFor(record);
  const message = {...lifecycleMessage(observation(turnEnded, world.clock.now()).draft.data, world.clock.now()),
    ...draft, source: SOURCE, data: {...draft.data, observedAtMs: world.clock.now()}};
  const qualification = receiptQualification(message); assert.ok(qualification);
  return {world, message, qualification};
}

it('a committed receipt survives restart, while an old view revision remains unusable', async context => {
  const {world, message, qualification} = await stored(context);
  assert.equal(await world.store.readReceipt(message, qualification), true);
  await world.store.drain();
  const read = world.store.records()[0]; assert.ok(read);
  await world.crashAndRestart();
  const restarted = world.store.records()[0]; assert.ok(restarted);
  assert.equal(restarted.outcome.read, 'read');
  assert.deepEqual(restarted.outcome.readReceipt, read.outcome.readReceipt);
  // #1865 step 8: the finished session had no running work for the restart to leave unconfirmed, so it is not republished.
  assert.deepEqual(restarted.work.reasons, []);
  assert.equal(restarted.revision, read.revision);
  assert.equal(restarted.lastEvidenceAtMs, read.lastEvidenceAtMs);
  assert.equal(await world.store.readReceipt(message, qualification), false);
  world.since(0);
});

/** A receipt for the record's finished turn as it stands now. */
function receiptFor(world: World, record: Session30Record) {
  const draft = draftFor(record);
  const message = {...lifecycleMessage(observation(turnEnded, world.clock.now()).draft.data, world.clock.now()),
    ...draft, source: SOURCE, data: {...draft.data, observedAtMs: world.clock.now()}};
  const qualification = receiptQualification(message); assert.ok(qualification);
  return {message, qualification};
}

it('a receipt that is the first change after a failed start transaction is judged against the record as it stands (#1865)', async context => {
  let failing = false;
  const world = await World.open(context, {derivers: [() => { if (failing) throw Object.assign(new Error('database or disk is full'), {errcode: 13}); }]});
  await world.observe(turnStarted);
  await world.observe(turnEnded);
  // The finished target's subagent still runs: the start transaction marks the child's work unconfirmed, which changes
  // the target's children and so its record.
  await world.observe(sessionStarted, {identity: CHILD, parent: {status: 'known', identity: IDENTITY}, turn: 'child-turn'});
  world.clock.advance(1000);
  failing = true;
  await assert.rejects(world.crashAndRestart(), 'the start transaction cannot commit');
  failing = false;
  const shown = world.store.records().find(record => record.id === ID); assert.ok(shown);
  const stale = receiptFor(world, shown);
  // The start commits first and republishes the target, so a view of the record before it no longer matches.
  assert.equal(await world.store.readReceipt(stale.message, stale.qualification), false);
  assert.equal(world.store.takeFailure(), undefined, 'no storage failure');
  const current = world.store.records().find(record => record.id === ID); assert.ok(current);
  assert.ok(current.revision > shown.revision);
  assert.deepEqual(world.store.records().find(record => record.id === sessionEntityId(CHILD))?.work.reasons, ['restart']);
  assert.deepEqual(current.relationships.children, {working: 0, unconfirmed: 1});
  const fresh = receiptFor(world, current);
  assert.equal(await world.store.readReceipt(fresh.message, fresh.qualification), true);
});

it('a failed receipt commit leaves every owner table and publication unchanged', async context => {
  const {world, message, qualification} = await stored(context);
  const before = world.snapshot(), records = world.store.records(), published = world.published.length;
  world.db.exec("CREATE TEMP TRIGGER deny_receipt BEFORE INSERT ON core_records BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  await assert.rejects(world.store.readReceipt(message, qualification));
  assert.deepEqual(world.snapshot(), before);
  assert.deepEqual(world.store.records(), records);
  assert.equal(world.published.length, published);
  world.db.exec('DROP TRIGGER deny_receipt');
  assert.equal(await world.store.readReceipt(message, qualification), true);
  await world.store.drain();
  assert.equal(world.store.records()[0]?.outcome.read, 'read');
});

it('an admitted later native unread revokes earlier receipt provenance and rejects its replay', async context => {
  const world = await World.open(context);
  const identity = {...IDENTITY, provider: 'codex', client: 'desktop'} as const;
  await world.observe(turnStarted, {identity});
  await world.observe(turnEnded, {identity});
  const record = world.store.records()[0]; assert.ok(record);
  const draft = draftFor(record);
  const message = {...lifecycleMessage(observation(turnEnded, world.clock.now(), {identity}).draft.data, world.clock.now()),
    ...draft, source: 'bunny/parts/synthetic-qualified-ui', data: {...draft.data, observedAtMs: world.clock.now()}};
  // This tests the store's qualified transition. Production still refuses Codex qualification.
  const qualification = {source: message.source, feed: identity, kind: 'owned-ui'} as const;
  assert.equal(receiptQualification(message), undefined);
  assert.equal(await world.store.readReceipt(message, qualification), true);
  await world.observe({kind: 'read-observed', state: 'unread'}, {identity});
  const unread = structuredClone(world.store.records());
  assert.equal(unread[0]?.outcome.read, 'unread');
  assert.equal(unread[0]?.outcome.readReceipt, undefined);
  assert.equal(await world.store.readReceipt(message, qualification), false);
  assert.deepEqual(world.store.records(), unread);
});
