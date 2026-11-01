import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {sessionEntityId, type Identity} from '@jimmie-potts/event-contracts/v2/families';
import {READ_RECEIPT_SCHEMA, type ReadReceiptObservation} from '@jimmie-potts/event-contracts/v2/read-receipts';
import {prepareMessage} from '@jimmie-potts/sdk';
import {codexReceiptSource, receiptQualification} from '../src/read-receipts/qualification.js';
import {World} from './fixtures/store-world.js';
import {turnEnded, turnStarted} from './fixtures/agents.js';
import {it} from './support.js';

const identity: Identity = {provider: 'codex', client: 'local', hostId: 'synthetic-mac', sourceId: 'codex-hooks', sessionId: 'synthetic-session'};

async function setup(context: TestContext) {
  const world = await World.open(context);
  await world.observe(turnStarted, {identity});
  await world.observe(turnEnded, {identity});
  const before = world.store.records().find(record => record.id === sessionEntityId(identity));
  assert.ok(before?.turn.status === 'known');
  const turn = before.turn;
  const notice = before.notices.find(item => item.kind === 'turn-ended' && item.turn.status === 'known' && item.turn.id === turn.id);
  assert.ok(notice);
  const data: ReadReceiptObservation = {identity, turn: before.turn, parent: {status: 'unknown'},
    observedAtMs: world.clock.now(), ordering: {status: 'unknown'}, event: {
      kind: 'read-receipt-observed', generation: before.generation, noticeId: notice.id,
      receipt: {kind: 'provider-client', client: 'desktop', seenRevision: 'seen-one', acceptedRevision: 'accepted-one'},
    }};
  const message = prepareMessage(codexReceiptSource(identity), {kind: 'occurrence', type: 'org.bunny.lifecycle.observed',
    subject: before.id, dataschema: READ_RECEIPT_SCHEMA, data}, {now: () => world.clock.now()});
  const qualification = receiptQualification(message); assert.ok(qualification);
  return {world, before: structuredClone(before), message, qualification};
}

it('a qualified Codex receipt commits only read provenance for its exact completed target', async context => {
  const {world, before, message, qualification} = await setup(context);
  assert.equal(await world.store.readReceipt(message, qualification), true);
  await world.store.drain();
  const after = world.store.records()[0]; assert.ok(after);
  assert.equal(after.read, 'read');
  assert.deepEqual(after.identity, identity);
  assert.deepEqual(after.readReceipt?.receipt, message.data.event.receipt);
  assert.deepEqual(after.notices, before.notices);
  assert.deepEqual(after.attention, before.attention);
  assert.equal(after.lastEvidenceAtMs, before.lastEvidenceAtMs);
  assert.equal(after.observedAtMs, before.observedAtMs);
  assert.equal(world.store.received(message), 'duplicate');
});

it('duplicate accepted Codex provenance and an older target cannot make another read transition', async context => {
  const {world, message, qualification} = await setup(context);
  assert.equal(await world.store.readReceipt(message, qualification), true);
  await world.store.drain();
  const read = structuredClone(world.store.records());
  assert.equal(await world.store.readReceipt({...message, id: 'another-delivery-id'}, qualification), false);
  assert.deepEqual(world.store.records(), read);
  await world.crashAndRestart();
  assert.equal(world.store.records()[0]?.read, 'read');
  assert.equal(world.store.received(message), 'duplicate');
  assert.equal(await world.store.readReceipt(message, qualification), false);
  await world.observe(turnStarted, {identity, turn: 'new-turn'});
  await world.observe(turnEnded, {identity, turn: 'new-turn'});
  const newer = structuredClone(world.store.records());
  assert.equal(await world.store.readReceipt(message, qualification), false);
  assert.deepEqual(world.store.records(), newer);
  assert.equal(newer[0]?.read, 'unknown');
});

it('a Codex request with no revision change or a stale generation never marks read', async context => {
  const {world, message, qualification} = await setup(context);
  const before = structuredClone(world.store.records());
  assert.ok(message.data.event.receipt.kind === 'provider-client');
  const unchanged = {...message, data: {...message.data, event: {...message.data.event,
    receipt: {...message.data.event.receipt, acceptedRevision: message.data.event.receipt.seenRevision}}}};
  assert.equal(await world.store.readReceipt(unchanged, qualification), false);
  const stale = {...message, data: {...message.data, event: {...message.data.event, generation: message.data.event.generation + 1}}};
  assert.equal(await world.store.readReceipt(stale, qualification), false);
  assert.deepEqual(world.store.records(), before);
});

it('a failed Codex receipt commit changes neither state nor publication', async context => {
  const {world, message, qualification} = await setup(context);
  const before = world.snapshot(), records = structuredClone(world.store.records()), published = world.published.length;
  world.db.exec("CREATE TEMP TRIGGER deny_codex_receipt BEFORE INSERT ON core_records BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
  await assert.rejects(world.store.readReceipt(message, qualification));
  assert.deepEqual(world.snapshot(), before);
  assert.deepEqual(world.store.records(), records);
  assert.equal(world.published.length, published);
  world.db.exec('DROP TRIGGER deny_codex_receipt');
  assert.equal(await world.store.readReceipt(message, qualification), true);
});
