// The module on a real bus and private SQLite store, with a synthetic collector part: replay of physical use, freshness,
// restart, full disk, the threshold command and the reads (#615 AC1, AC2, AC4, AC5, AC6). Nothing here touches a radio.
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CompletedOutcome} from '@jimmie-potts/event-contracts/v2/devices';
import {VOLCANO_OBSERVATION_SCHEMA, VOLCANO_OBSERVATION_TYPE, volcanoObservationKey} from '@jimmie-potts/event-contracts/v2/families';
import {STALE_MS} from '../src/facts.js';
import type {Session} from '../src/sessions.js';
import {BUTTON_PUMP, FEED, FEED_ID, HEATING, IDLE, Rig, SELF_PUMP, reading, settle} from './support.js';

async function rig(t: TestContext): Promise<Rig> {
  const opened = await Rig.open();
  t.after(() => opened.close());
  return opened;
}
type Sessions = {gapMinutes: number; preview: boolean; sessions: Session[]; next: string | null};
const MIN = 60_000;

/** A fixture replay of the owner's physical buttons: HEAT, setpoint, both pump runs, off. No command is sent anywhere. */
async function physicalUse(world: Rig): Promise<number> {
  await world.send({reading: reading({status1: IDLE})});
  const startedAt = world.clock.now() + 5000;
  await world.after(5000, {reading: reading({status1: HEATING, currentDeciC: 410})});
  await world.after(5000, {reading: reading({status1: HEATING, currentDeciC: 500, targetDeciC: 1900})});
  await world.after(5000, {reading: reading({status1: SELF_PUMP, currentDeciC: 1900, targetDeciC: 1900})});
  await world.after(1000, {reading: reading({status1: HEATING, currentDeciC: 1900, targetDeciC: 1900})});
  await world.after(4000, {reading: reading({status1: BUTTON_PUMP, currentDeciC: 1890, targetDeciC: 1900})});
  await world.after(3000, {reading: reading({status1: HEATING, currentDeciC: 1885, targetDeciC: 1900, heatingMinutes: 6})});
  await world.after(2000, {reading: reading({status1: IDLE, currentDeciC: 1880, targetDeciC: 1900, heatingMinutes: 6})});
  return startedAt;
}

void test('a replay of physical-button use is recorded and returned by the read routes, with no command sent', async t => {
  const world = await rig(t);
  const startedAt = await physicalUse(world);
  assert.equal((await world.status()).heater, 'off');
  const facts = await world.facts();
  assert.deepEqual(facts.filter(fact => fact.kind === 'pump').map(fact => [fact.on, fact.status1]), [[true, SELF_PUMP], [false, HEATING], [true, BUTTON_PUMP], [false, HEATING]]);
  assert.ok(facts.every(fact => typeof fact.observedAtMs === 'number' && typeof fact.receivedAtMs === 'number'));
  const {sessions} = await world.read<Sessions>('sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.startAtMs, startedAt);
  assert.equal(sessions[0]?.pumpRuns, 2);
  assert.equal(sessions[0]?.observedHeatingMs, 20_000);
  assert.deepEqual(world.host.sent.filter(entry => entry.call === 'request'), [], 'the module sends no command');
  assert.deepEqual(world.host.failures, []);
});

void test('the observed state reads fresh with its times, and a feed stale for 15 s reads unavailable, never off', async t => {
  const world = await rig(t);
  assert.equal(world.devices.at(-1)?.availability, 'unavailable', 'no collector yet');
  assert.equal(world.devices.at(-1)?.kind, 'volcano');
  await world.send({reading: reading({status1: HEATING})});
  const live = await world.status();
  assert.deepEqual([live.availability, live.link, live.heater, live.observedAtMs, live.displayFahrenheit], ['available', 'connected', 'on', world.clock.now(), true]);
  assert.equal(world.devices.at(-1)?.availability, 'available');
  world.clock.advance(STALE_MS - 1);
  await settle();
  assert.equal((await world.status()).availability, 'available');
  world.clock.advance(1);
  await settle();
  const staleStatus = await world.status();
  assert.deepEqual([staleStatus.availability, staleStatus.link, staleStatus.heater, staleStatus.currentDeciC], ['unavailable', 'stale', 'unknown', null]);
  assert.deepEqual([world.statuses.at(-1)?.availability, world.statuses.at(-1)?.heater], ['unavailable', 'unknown'], 'and consumers hear it');
  assert.equal(world.devices.at(-1)?.availability, 'unavailable');
  assert.notEqual((await world.status()).heater, 'off');
  assert.equal((await world.facts()).filter(fact => fact.kind === 'heater' && fact.on === false).length, 0);
  await world.after(MIN, {reading: reading({status1: HEATING})});
  assert.equal((await world.status()).availability, 'available');
  assert.equal((await world.facts()).filter(fact => fact.kind === 'gap').length, 1, 'the absence is an unobserved gap');
});

void test('a link that is not connected reads unavailable with the heater unknown', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: HEATING})});
  for (const link of ['disconnected', 'unavailable', 'identity-mismatch'] as const) {
    await world.after(1000, {link, reading: null});
    const status = await world.status();
    assert.deepEqual([status.availability, status.link, status.heater, status.pump], ['unavailable', link, 'unknown', 'unknown']);
  }
});

void test('repeated snapshots publish nothing new and never duplicate a fact or accumulated time', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: HEATING})});
  const facts = world.factRows(), published = world.statuses.length;
  for (let beat = 0; beat < 5; beat += 1) await world.after(5000, {reading: reading({status1: HEATING, status2: beat % 2 === 0 ? 0x2200 : 0x0200})});
  assert.equal(world.factRows(), facts, 'heartbeats and the flipping bit add nothing');
  assert.equal(world.statuses.length, published, 'and publish nothing');
  const again = {collectorEpoch: world.epoch, sequence: world.sequence};
  const before = world.factRows();
  await world.collector.publish(volcanoObservationKey(FEED), {kind: 'occurrence', type: VOLCANO_OBSERVATION_TYPE, subject: FEED_ID, dataschema: VOLCANO_OBSERVATION_SCHEMA,
    data: {feed: FEED, observedAtMs: world.clock.now() + 1, ...again, link: 'connected', reading: reading({status1: IDLE})}});
  await settle();
  assert.equal(world.factRows(), before, 'an exact (epoch, sequence) repeat is dropped');
  await world.after(1000, {observedAtMs: world.clock.now() - 60_000, reading: reading({status1: IDLE})});
  assert.equal(world.factRows(), before, 'a delayed snapshot is dropped');
  assert.equal((await world.status()).heater, 'on');
  const {sessions} = await world.read<Sessions>('sessions');
  assert.equal(sessions[0]?.observedHeatingMs, 25_000);
});

void test('history survives a restart, which adds no fact, and a restarted module waits for a fresh snapshot', async t => {
  const world = await rig(t);
  const startedAt = await physicalUse(world);
  const facts = await world.facts();
  const before = await world.read<Sessions>('sessions');
  await world.restart();
  assert.deepEqual(await world.facts(), facts, 'facts are as they were');
  assert.deepEqual((await world.read<Sessions>('sessions')).sessions, before.sessions);
  assert.equal((await world.status()).availability, 'unavailable', 'a store proves nothing about now');
  await world.after(1000, {reading: reading({status1: IDLE, currentDeciC: 1880, targetDeciC: 1900, heatingMinutes: 6})});
  assert.equal((await world.status()).availability, 'available');
  assert.deepEqual((await world.facts()).filter(fact => !facts.some(other => other.seq === fact.seq)).map(fact => fact.kind), [], 'the same device state adds nothing after a restart');
  assert.equal((await world.read<Sessions>('sessions')).sessions[0]?.startAtMs, startedAt);
});

void test('a heater kept on across a restart remains one stretch', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  await world.after(5000, {reading: reading({status1: HEATING})});
  await world.restart();
  await world.after(5000, {reading: reading({status1: HEATING})});
  await world.after(5000, {reading: reading({status1: IDLE})});
  const {sessions} = await world.read<Sessions>('sessions');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.stretches.length, 1);
  assert.equal(sessions[0]?.observedHeatingMs, 10_000);
});

void test('a restart between store commit and publication sends the stored messages once more and repeats no fact', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  world.publicationsLost = true;
  await world.after(5000, {reading: reading({status1: HEATING})});
  assert.notEqual(world.statuses.at(-1)?.heater, 'on', 'committed but not yet published');
  const facts = world.factRows();
  world.publicationsLost = false;
  await world.restart();
  assert.ok(world.statuses.some(status => status.heater === 'on'), 'the outbox republishes what was committed');
  assert.equal(world.factRows(), facts);
  await world.after(1000, {reading: reading({status1: HEATING})});
  assert.equal(world.factRows(), facts, 'and the next snapshot finds its transition already stored');
});

void test('a full disk refuses before accepting: nothing half-stored, reads still work, and recording resumes', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  const database = world.host.moduleDatabase();
  assert.ok(database !== undefined);
  const facts = world.factRows();
  const realPrepare = database.prepare.bind(database);
  const full = Object.assign(new Error('synthetic full disk'), {errcode: 13});
  (database as unknown as {prepare: (sql: string) => unknown}).prepare = (sql: string) => {
    if (/^INSERT INTO volcano_(facts|requests)/.test(sql)) throw full;
    return realPrepare(sql);
  };
  await world.after(5000, {reading: reading({status1: HEATING})});
  assert.equal(world.factRows(), facts, 'no fact without its continuity');
  assert.equal((await world.status()).recording, 'refused');
  assert.ok(world.host.logs.some(entry => entry.event === 'operation.failed' && entry.fields['bunny.code'] === 'capacity'));
  const answer = await world.gap({gapMinutes: 20}, 'full-disk-gap');
  assert.equal(answer.status, 'rejected');
  assert.equal(answer.status === 'rejected' && answer.error.error.code, 'capacity', 'a threshold is refused before it is accepted');
  assert.equal((await world.status()).gapMinutes, 15);
  assert.equal(world.outcomes.length, 0);
  (database as unknown as {prepare: unknown}).prepare = realPrepare;
  await world.after(5000, {reading: reading({status1: HEATING})});
  assert.equal((await world.status()).recording, 'ok');
  assert.equal((await world.status()).heater, 'on');
  assert.deepEqual(world.host.failures, []);
});

void test('while the disk is full a stale feed still reads unavailable to consumers', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: HEATING})});
  const database = world.host.moduleDatabase();
  assert.ok(database !== undefined);
  const realPrepare = database.prepare.bind(database);
  (database as unknown as {prepare: (sql: string) => unknown}).prepare = (sql: string) => {
    if (/^INSERT INTO volcano_(facts|meta)/.test(sql)) throw Object.assign(new Error('synthetic full disk'), {errcode: 13});
    return realPrepare(sql);
  };
  world.clock.advance(STALE_MS);
  await settle();
  assert.equal(world.statuses.at(-1)?.availability, 'unavailable');
  assert.equal(world.devices.at(-1)?.availability, 'unavailable');
  (database as unknown as {prepare: unknown}).prepare = realPrepare;
  world.clock.advance(STALE_MS);
  await settle();
  assert.equal((await world.facts()).some(fact => fact.kind === 'link' && fact.state === 'stale'), true, 'the marker is stored once it can be');
  assert.deepEqual(world.host.failures, []);
});

void test('a snapshot from another producer shape, feed or kind is refused and logged once', async t => {
  const world = await rig(t);
  const before = world.factRows();
  await world.send({reading: reading({status1: HEATING})}, world.bus.connect('bunny/modules/other'));
  await world.send({reading: reading({status1: HEATING})}, world.collector, {...FEED, hostId: 'other-host'});
  assert.equal(world.factRows(), before);
  const refused = world.host.logs.filter(entry => entry.event === 'message.received' && entry.fields['bunny.outcome'] === 'rejected');
  assert.equal(refused.length, 1);
  assert.equal(refused[0]?.fields['bunny.code'], 'forbidden');
});

void test('logs carry no usage, serial or identifier', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: HEATING})});
  await world.after(1000, {link: 'identity-mismatch', reading: null});
  await world.after(1000, {reading: reading({status1: HEATING, heatingHours: 3, heatingMinutes: 0})});
  await world.after(5000, {reading: reading({status1: HEATING, heatingHours: 1, heatingMinutes: 0})});
  // A record's trace is read only for its context, so the fields are all a record carries.
  const text = JSON.stringify(world.host.logs.map(({event, fields}) => ({event, fields})));
  for (const value of ['host-a', 'volcano-a', FEED_ID, 'storz-bickel', 'status1', 'currentDeciC', 'targetDeciC', 'heatingHours', 'heatingMinutes', 'observedAtMs']) assert.equal(text.includes(value), false, value);
  const keys = new Set(world.host.logs.flatMap(entry => Object.keys(entry.fields)));
  assert.ok([...keys].every(key => key.startsWith('bunny.')), [...keys].join());
  assert.ok([...keys].every(key => !['bunny.value', 'bunny.detail'].includes(key)));
});

void test('the threshold is stored with its outcome once, and regroups history without rewriting a fact', async t => {
  const world = await rig(t);
  await world.send({reading: reading({status1: IDLE})});
  await world.after(5000, {reading: reading({status1: HEATING})});
  await world.after(10 * MIN, {reading: reading({status1: HEATING, heatingMinutes: 15})});
  await world.after(5000, {reading: reading({status1: IDLE, heatingMinutes: 15})});
  await world.after(5000, {reading: reading({status1: IDLE, heatingMinutes: 15})});
  for (let beat = 0; beat < 240; beat += 1) await world.after(5000, {reading: reading({status1: IDLE, heatingMinutes: 15})});
  await world.after(5000, {reading: reading({status1: HEATING, heatingMinutes: 15})});
  await world.after(5000, {reading: reading({status1: IDLE, heatingMinutes: 15})});
  const facts = await world.facts();
  assert.equal((await world.read<Sessions>('sessions')).sessions.length, 2, '20 minutes apart under the 15 minute default');
  const preview = await world.read<Sessions>('sessions', {gapMinutes: '30'});
  assert.deepEqual([preview.preview, preview.gapMinutes, preview.sessions.length], [true, 30, 1]);
  assert.equal((await world.status()).gapMinutes, 15, 'a preview changes nothing');

  const answer = await world.gap({gapMinutes: 30, expectedConfigurationRevision: 0}, 'gap-30');
  assert.equal(answer.status, 'accepted');
  await settle();
  assert.equal(world.outcomes.length, 1);
  const outcome = world.outcomes[0] as Message<CompletedOutcome>;
  assert.equal(outcome.kind, 'outcome');
  assert.deepEqual([outcome.data.requestId, outcome.data.result, outcome.data.evidence], ['gap-30', 'succeeded', 'observed']);
  assert.equal((await world.status()).gapMinutes, 30);
  assert.equal((await world.status()).configurationRevision, 1);
  assert.equal((await world.read<Sessions>('sessions')).sessions.length, 1, 'regrouped');
  assert.deepEqual(await world.facts(), facts, 'no fact changed');

  assert.equal((await world.gap({gapMinutes: 30, expectedConfigurationRevision: 0}, 'gap-30')).status, 'accepted', 'an exact repeat is accepted');
  await settle();
  assert.equal(world.outcomes.length, 1, 'and reports nothing twice');
  const conflict = await world.gap({gapMinutes: 45}, 'gap-30');
  assert.equal(conflict.status === 'rejected' && conflict.error.error.code, 'duplicate-conflict');
  const stale = await world.gap({gapMinutes: 45, expectedConfigurationRevision: 0}, 'gap-stale');
  assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
  await world.restart();
  assert.equal((await world.status()).gapMinutes, 30, 'the threshold survives a restart');
  assert.equal((await world.gap({gapMinutes: 30, expectedConfigurationRevision: 0}, 'gap-30')).status, 'accepted', 'as does its idempotency');
});

void test('an out-of-range threshold fails with a registered code and changes nothing; a malformed one is refused', async t => {
  const world = await rig(t);
  for (const [requestId, gapMinutes] of [['gap-0', 0], ['gap-241', 241]] as const) {
    assert.equal((await world.gap({gapMinutes}, requestId)).status, 'accepted');
    await settle();
    const outcome = world.outcomes.at(-1) as Message<CompletedOutcome>;
    assert.deepEqual([outcome.data.requestId, outcome.data.result, outcome.data.evidence, outcome.data.error?.code], [requestId, 'failed', 'none', 'invalid-request']);
  }
  assert.equal((await world.status()).gapMinutes, 15);
  assert.equal((await world.status()).configurationRevision, 0);
  const malformed = await world.gap({gapMinutes: 1.5}, 'gap-fraction');
  assert.equal(malformed.status === 'rejected' && malformed.error.error.code, 'invalid-message');
  for (const gapMinutes of [1, 240]) assert.equal((await world.gap({gapMinutes}, `gap-${String(gapMinutes)}`)).status, 'accepted', 'the bounds are inside');
  await settle();
  assert.equal((await world.status()).gapMinutes, 240);
});

void test('a threshold command that expired while it waited changes nothing', async t => {
  const world = await rig(t);
  const answer = world.gap({gapMinutes: 45}, 'gap-late', 100);
  world.clock.advance(101);
  const replied = await answer;
  assert.notEqual(replied.status, 'accepted');
  assert.equal((await world.status()).gapMinutes, 15);
});
