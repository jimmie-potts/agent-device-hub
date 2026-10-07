// The LIFX module's behavior (Hub #928): commands answered with an outcome through the outbox, policy A for unreachable
// bulbs, the store before the reply, restarts that report and never resend, the unqualified Beam, the writer lease and
// the on-demand read. Every test runs on a manual clock with simulated bulbs, and checks every message against profile
// 2.0 with the core, device and LIFX families.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {afterEach} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import type {LifxLight} from '../src/index.js';
import {createLifxModule, PACKET, PROBE_FIRST_MS, READ_INTERVAL_MS, SimulatedLifx} from '../src/index.js';
import {acquireLease} from '../src/lease.js';
import {BEAM, command, flush, it, PENDANT, SECTION, shownColor, World} from './support.js';

const worlds: World[] = [];
async function open(options: Parameters<typeof World.open>[0] = {}): Promise<World> {
  const world = await World.open(options);
  worlds.push(world);
  return world;
}
afterEach(async () => {
  for (const world of worlds.splice(0)) {
    assert.deepEqual(world.invalid, [], 'every message followed profile 2.0');
    assert.deepEqual(world.errors, [], 'no handler of the module failed');
    assert.deepEqual(world.hosted.flatMap(harness => harness.failures), [], 'no timer of the module failed, and its stop finished');
    const seen = JSON.stringify([world.published, world.hosted.flatMap(harness => harness.logs), world.spans.spans]);
    assert.ok(!seen.includes('192.0.2.'), 'no message, record or span carries a bulb\'s address');
    await world.close();
  }
});

const writes = (world: World, address: string): number => world.packets(address, PACKET.setPower) + world.packets(address, PACKET.setColor);
const outcome = (world: World, requestId: string): Record<string, unknown> | undefined => world.outcomes(requestId).at(-1)?.data;
const accepted = (result: {status: string}): void => { assert.equal(result.status, 'accepted'); };

it('a qualified bulb is reached once, read-only, after start and its records follow; the Beam is listed with no controls and never reached', async () => {
  const world = await open();
  await world.clock.advance(1);
  const pendant = world.device(PENDANT.id);
  assert.equal(pendant?.availability, 'available');
  assert.deepEqual(pendant.capabilities.modes, {supported: true, values: ['work', 'quiet', 'free']});
  assert.equal(pendant.observed.status, 'known');
  assert.deepEqual(pendant.desired.mode, {status: 'known', value: 'free'}, 'a bulb with no stored mode starts free');
  assert.deepEqual(world.records<LifxLight>('lifx-light', PENDANT.id).at(-1)?.capabilities, {color: {supported: true}, temperature: {supported: true, minimum: 1500, maximum: 9000}});
  assert.equal(world.packets(PENDANT.address, PACKET.lightGet), 1, 'one LightGet');
  assert.equal(writes(world, PENDANT.address), 0, 'starting writes nothing');

  const sync = await world.operator.sync(['device', 'lifx-light'], () => {}, {timeoutMs: 5000});
  assert.equal(sync.status, 'synced');
  if (sync.status !== 'synced') return;
  const beam = sync.copy.states().find(state => state.subject === BEAM.id && state.dataschema.endsWith('/device/2.0'))?.data as DeviceRecord | undefined;
  assert.ok(beam);
  assert.equal(beam.availability, 'unknown', 'never reached, so its availability is unknown');
  assert.ok(Object.values(beam.capabilities).every(capability => !capability.supported), 'no controls');
  await sync.copy.close();
  for (const sent of [command.power(BEAM.id, true), command.brightness(BEAM.id, 10), command.mode(BEAM.id, 'work'), command.color(BEAM.id, 120, 100), command.temperature(BEAM.id, 2700)]) {
    const result = await world.send(sent);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'unsupported-capability', sent.key);
  }
  await world.clock.advance(PROBE_FIRST_MS * 4);
  assert.equal(world.packets(BEAM.address), 0, 'the Beam got no packet at all');
  assert.ok(!JSON.stringify(world.published).includes(PENDANT.address) && !JSON.stringify(world.hosted.flatMap(h => h.logs)).includes(PENDANT.address),
    'no message or record carries a bulb\'s address');
});

it('a mode command is accepted after it is stored, then completed, and sends nothing to the bulb', async () => {
  const world = await open();
  await world.clock.advance(1);
  const before = world.network.state().packets.length;
  const result = await world.send(command.mode(PENDANT.id, 'quiet'), {requestId: 'req-mode'});
  accepted(result);
  await world.clock.advance(1);
  assert.deepEqual(outcome(world, 'req-mode'), {requestId: 'req-mode', result: 'succeeded', evidence: 'transmitted'});
  const outcomes = world.outcomes('req-mode');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.type, 'org.bunny.device-mode.set.completed');
  // Accepted, the record showed the command pending; completed, it shows the mode and nothing pending.
  const records = world.records<DeviceRecord>('device', PENDANT.id);
  assert.ok(records.some(record => record.pending === 1 && record.pendingKinds.includes('device-mode-set')), 'pending while it ran');
  assert.deepEqual(records.at(-1)?.desired.mode, {status: 'known', value: 'quiet'});
  assert.equal(records.at(-1)?.pending, 0);
  assert.equal(world.network.state().packets.length, before, 'a mode change sends nothing to the bulb');
  // The mode survives a restart, kept in the module's own database.
  await world.restart();
  await world.clock.advance(1);
  assert.deepEqual(world.device(PENDANT.id)?.desired.mode, {status: 'known', value: 'quiet'});
  const refused = await world.send(command.mode(PENDANT.id, 'party'));
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unsupported-capability', 'a mode the bulb does not advertise');
});

it('power, brightness, color and temperature complete with transmitted evidence and keep the fields they do not change', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.change(PENDANT.address, {power: true, color: {hue: 0, saturation: 0, brightness: 65535, kelvin: 4000}});
  accepted(await world.send(command.color(PENDANT.id, 120, 100), {requestId: 'req-color'}));
  await world.clock.advance(1);
  assert.deepEqual(shownColor(world.network, PENDANT.address), {hue: 120, saturation: 100, brightness: 100, kelvin: 4000, power: true});
  accepted(await world.send(command.temperature(PENDANT.id, 2700), {requestId: 'req-kelvin'}));
  accepted(await world.send(command.brightness(PENDANT.id, 40), {requestId: 'req-brightness'}));
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-power'}));
  await world.clock.advance(1);
  assert.deepEqual(shownColor(world.network, PENDANT.address), {hue: 120, saturation: 100, brightness: 40, kelvin: 2700, power: false});
  for (const requestId of ['req-color', 'req-kelvin', 'req-brightness', 'req-power']) {
    assert.deepEqual(outcome(world, requestId), {requestId, result: 'succeeded', evidence: 'transmitted'}, requestId);
  }
  assert.deepEqual(world.outcomes().map(message => message.type), [
    'org.bunny.lifx-color.set.completed', 'org.bunny.lifx-temperature.set.completed', 'org.bunny.brightness.set.completed', 'org.bunny.power.set.completed',
  ]);
  const record = world.device(PENDANT.id);
  assert.deepEqual(record?.desired.power, {status: 'known', value: false});
  assert.deepEqual(record?.desired.brightness, {status: 'known', value: 40});
  assert.equal(record?.lastTransmission.status === 'known' && record.lastTransmission.requestId, 'req-power');
  assert.equal(record?.configurationRevision, 4, 'each accepted command moves the configuration revision');
  assert.deepEqual(world.records<LifxLight>('lifx-light', PENDANT.id).at(-1)?.observed, {
    status: 'known', observedAtMs: world.clock.now() - 1, hue: 120, saturation: 100, brightness: 100, kelvin: 2700,
  }, 'the last reading, before the brightness write');
});

it('a write the bulb never acknowledges is uncertain, reported once and never sent again; the command\'s deadline bounds the retries', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-lost'}));
  await world.clock.advance(5000);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 2, 'the first attempt and its one retry, within the command');
  assert.deepEqual(outcome(world, 'req-lost'), {requestId: 'req-lost', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false, detail: 'the write went out and the bulb did not acknowledge it'}});
  await world.clock.advance(10 * 60_000);
  await world.restart();
  await world.clock.advance(60_000);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 2, 'nothing sends it again, not even a restart');
  assert.equal(world.outcomes('req-lost').length, 1, 'reported once: the core acknowledged it');
  // A command whose deadline passes during its first attempt gets no retry.
  accepted(await world.send(command.power(PENDANT.id, true), {requestId: 'req-short', timeoutMs: 300}));
  await world.clock.advance(5000);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 3, 'one attempt, no retry past the command\'s deadline');
  assert.equal(outcome(world, 'req-short')?.result, 'uncertain');
});

it('a command whose deadline passes while it waits for its bulb ends failed with expired, and never reaches the bulb', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-ahead'}));
  accepted(await world.send(command.power(PENDANT.id, true), {requestId: 'req-late', timeoutMs: 300}));
  accepted(await world.send(command.mode(PENDANT.id, 'work'), {requestId: 'req-mode-late', timeoutMs: 300}));
  await world.clock.advance(5000);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 2, 'the first command and its retry, nothing for the late one');
  for (const requestId of ['req-late', 'req-mode-late']) {
    assert.deepEqual(outcome(world, requestId), {
      requestId, result: 'failed', evidence: 'none', error: {code: 'expired', retryable: false, detail: 'the command\'s deadline passed before it reached the bulb'},
    }, requestId);
  }
  assert.deepEqual(world.device(PENDANT.id)?.desired.mode, {status: 'known', value: 'free'}, 'the expired mode change changed nothing');
});

it('a command to a bulb that does not answer its read fails with no evidence, and the bulb shows unavailable', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.color(PENDANT.id, 200, 50), {requestId: 'req-color'}));
  await world.clock.advance(5000);
  assert.deepEqual(outcome(world, 'req-color'), {requestId: 'req-color', result: 'failed', evidence: 'none', error: {code: 'unavailable', retryable: true, detail: 'the bulb did not answer'}});
  assert.equal(world.packets(PENDANT.address, PACKET.setColor), 0, 'no write without a reading');
  assert.equal(world.device(PENDANT.id)?.availability, 'unavailable');
});

it('an outcome stored before a crash goes out once at the next start, and the command never runs again', async () => {
  let crash = true;
  const world = await open({beforePublish: message => {
    if (crash && message.kind === 'outcome') {
      crash = false;
      throw new Error('the runtime crashed');
    }
  }});
  await world.clock.advance(1);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-crash'}));
  await world.clock.advance(1);
  assert.equal(world.outcomes('req-crash').length, 0, 'the crash kept the stored outcome from going out');
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 1);
  await world.restart();
  await world.clock.advance(1);
  assert.equal(world.outcomes('req-crash').length, 1, 'reported at the next start');
  assert.equal(world.logs('outcome.published').filter(entry => entry.fields['bunny.request.id'] === 'req-crash').length, 1, 'its publication recorded once');
  await world.restart();
  await world.clock.advance(1);
  assert.equal(world.outcomes('req-crash').length, 1, 'once: the core acknowledged it, so the outbox forgot it');
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 1, 'the command never ran again');
});

it('a command a stop cut short is reported at the next start: uncertain when its write may have begun, failed when it never did', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, true), {requestId: 'req-flight'}));
  accepted(await world.send(command.color(PENDANT.id, 10, 10), {requestId: 'req-queued'}));
  // The power write is in flight and the color command waits behind it when the module stops.
  await world.restart();
  await world.clock.advance(1);
  assert.equal(outcome(world, 'req-flight')?.result, 'uncertain', 'the write was under way');
  assert.deepEqual(outcome(world, 'req-queued'), {requestId: 'req-queued', result: 'failed', evidence: 'none', error: {code: 'cancelled', retryable: false, detail: 'the module stopped before the command reached the bulb'}});
  assert.equal(world.outcomes('req-flight').length, 1);
  assert.equal(world.outcomes('req-queued').length, 1);
  assert.equal(world.packets(PENDANT.address, PACKET.lightGet) - 2, 0, 'the queued color command never read the bulb');
});

it('an outcome the store could not keep is reported at the next start: uncertain once its write began, and never sent again', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-lost-row'}));
  await flush();
  // The write is out and unanswered when the disk fills, so the outcome cannot be stored.
  const db = world.db;
  assert.ok(db);
  db.exec('PRAGMA page_size = 512; VACUUM');
  const pages = (db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  db.exec(`PRAGMA max_page_count = ${pages}`);
  await world.clock.advance(5000);
  assert.equal(world.outcomes('req-lost-row').length, 0, 'not stored, so not published');
  assert.equal(world.device(PENDANT.id)?.pending ?? 1, 1, 'the module\'s records still hold it pending');
  db.exec('PRAGMA max_page_count = 1073741823');
  await world.restart();
  await world.clock.advance(1);
  assert.deepEqual(outcome(world, 'req-lost-row'), {
    requestId: 'req-lost-row', result: 'uncertain', evidence: 'none',
    error: {code: 'uncertain-result', retryable: false, detail: 'the runtime stopped while the write was under way'},
  });
  await world.restart();
  await world.clock.advance(60_000);
  assert.equal(world.outcomes('req-lost-row').length, 1, 'reported once');
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 2, 'the write and its one retry, never again');
});

it('after a crash, a command still waiting for its bulb is reported failed with cancelled, and one whose write went out uncertain', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-flight'}));
  accepted(await world.send(command.color(PENDANT.id, 10, 10), {requestId: 'req-waiting'}));
  // The runtime dies here, while the power write waits for its answer and the color command waits behind it.
  const after = await open({dir: await world.crashCopy(), network: world.network});
  await after.clock.advance(1);
  assert.deepEqual(outcome(after, 'req-flight'), {
    requestId: 'req-flight', result: 'uncertain', evidence: 'none',
    error: {code: 'uncertain-result', retryable: false, detail: 'the runtime stopped while the write was under way'},
  });
  assert.deepEqual(outcome(after, 'req-waiting'), {
    requestId: 'req-waiting', result: 'failed', evidence: 'none',
    error: {code: 'cancelled', retryable: false, detail: 'the runtime stopped before the command reached the bulb'},
  });
});

it('a second instance on the same state directory leaves the live instance\'s commands to it', async () => {
  const world = await open();
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-live'}));
  // A second instance starts on the same state directory, on a bus of its own, while the write is in flight.
  const bus = new InProcessBus({now: world.clock.now, scheduler: world.clock.scheduler});
  const seen: Message[] = [];
  const watcher = bus.connect('bunny/test/second');
  await watcher.subscribe('bunny.*.*.*', message => { seen.push(message); });
  const second = new ModuleHarness(createLifxModule({transport: world.network}), {
    bus, stateDir: world.dir, clock: {now: world.clock.now}, scheduler: world.clock.scheduler, section: SECTION,
  });
  await second.start();
  await world.clock.advance(1);
  assert.deepEqual(seen.filter(message => message.kind === 'outcome').map(message => message.data), [], 'the second instance reported none of the live one\'s commands');
  await second.stop();
  await watcher.close();
  await world.clock.advance(5000);
  assert.equal(world.outcomes('req-live').length, 1, 'the live instance reports its own command, once');
  assert.equal(outcome(world, 'req-live')?.result, 'uncertain');
  assert.deepEqual(second.failures, []);
});

it('a store that cannot record the work before its write fails the command with no effect', async () => {
  const world = await open();
  await world.clock.advance(1);
  const db = world.db;
  assert.ok(db);
  // The store refuses only the mark that the work began, as a full or failing disk could.
  db.exec(`CREATE TRIGGER refuse_started BEFORE UPDATE OF state ON lifx_requests WHEN NEW.state = 'started'
    BEGIN SELECT RAISE(ABORT, 'refused'); END`);
  const writes = world.packets(PENDANT.address, PACKET.setPower);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-unrecorded'}));
  await world.clock.advance(1);
  assert.deepEqual(outcome(world, 'req-unrecorded'), {
    requestId: 'req-unrecorded', result: 'failed', evidence: 'none',
    error: {code: 'internal', retryable: false, detail: 'the module could not record the work before it began'},
  });
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), writes, 'nothing reached the bulb');
  assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'storage').length, 1);
});

it('a command that arrives while the module stops is refused unavailable', async () => {
  const world = await open();
  await world.clock.advance(1);
  const stopping = world.harness.stop();
  const refused = await world.send(command.power(PENDANT.id, false), {requestId: 'req-stopping'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unavailable');
  await stopping;
  assert.equal(world.outcomes('req-stopping').length, 0);
});

it('a store that cannot write refuses the command before it is accepted, with no effect', async () => {
  const world = await open();
  await world.clock.advance(1);
  const db = world.db;
  assert.ok(db);
  // A full disk, through SQLite's own full-disk path: no page may be added.
  db.exec('PRAGMA page_size = 512; VACUUM');
  const pages = (db.prepare('PRAGMA page_count').get() as {page_count: number}).page_count;
  db.exec(`PRAGMA max_page_count = ${pages}`);
  const before = world.network.state().packets.length;
  const refused = await world.send(command.power(PENDANT.id, false), {requestId: 'req-full'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'capacity');
  await world.clock.advance(5000);
  assert.equal(world.network.state().packets.length, before, 'nothing reached the bulb');
  assert.equal(world.outcomes('req-full').length, 0, 'a refusal has no outcome');
  assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'storage').length, 1, 'one record for the full store');
  db.exec('PRAGMA max_page_count = 1073741823');
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-room'}));
  await world.clock.advance(1);
  assert.equal(outcome(world, 'req-room')?.result, 'succeeded');
  assert.equal(world.logs('operation.completed').filter(entry => entry.fields['bunny.operation'] === 'storage').length, 1, 'and one for its recovery');
});

it('a bulb unreachable at start: the module runs, the bulb shows unavailable, and the outage logs one degradation and one recovery', async () => {
  const world = await open({network: new SimulatedLifx({online: false})});
  assert.equal(world.harness.failures.length, 0);
  await world.clock.advance(1100);
  assert.equal(world.device(PENDANT.id)?.availability, 'unavailable');
  await world.clock.advance(30 * 60_000);
  const probes = world.packets(PENDANT.address, PACKET.lightGet);
  assert.ok(probes >= 8 && probes <= 20, `reads again with a doubling wait, capped: ${probes} LightGets in 30 minutes`);
  assert.equal(writes(world, PENDANT.address), 0);
  const unavailable = world.logs('device.unavailable');
  assert.equal(unavailable.filter(entry => entry.level === 'warn').length, 1, 'one degradation at WARN');
  assert.ok(unavailable.filter(entry => entry.level === 'debug').length <= 30, 'later failures summarized at DEBUG, at most once a minute');
  const states = world.records<DeviceRecord>('device', PENDANT.id).length;
  world.network.online(PENDANT.address);
  await world.clock.advance(5 * 60_000);
  assert.equal(world.device(PENDANT.id)?.availability, 'available');
  const available = world.logs('device.available');
  assert.equal(available.length, 1, 'one recovery');
  assert.equal(available[0]?.level, 'info');
  assert.ok(Number(available[0]?.fields['bunny.attempt_count']) >= probes / 2);
  assert.equal(world.records<DeviceRecord>('device', PENDANT.id).length, states + 1, 'polling published no record that changed nothing, then one for the recovery');
});

it('a repeated request is accepted with no second effect; the same requestId with another command is a conflict', async () => {
  const world = await open();
  await world.clock.advance(1);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-1'}));
  await world.clock.advance(1);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-1'}));
  await world.clock.advance(1);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 1, 'switched once');
  assert.equal(world.outcomes('req-1').length, 1, 'one outcome');
  const conflict = await world.send(command.power(PENDANT.id, true), {requestId: 'req-1'});
  assert.equal(conflict.status === 'rejected' && conflict.error.error.code, 'duplicate-conflict');
});

it('a stale configuration revision or generation is refused before any change', async () => {
  const world = await open();
  await world.clock.advance(1);
  const record = world.device(PENDANT.id);
  assert.ok(record);
  const fresh = {expectedConfigurationRevision: record.configurationRevision, expectedGeneration: record.generation};
  accepted(await world.send(command.power(PENDANT.id, false, fresh), {requestId: 'req-fresh'}));
  await world.clock.advance(1);
  for (const guards of [fresh, {expectedGeneration: {epoch: 'another-start', sequence: 0}}]) {
    const stale = await world.send(command.power(PENDANT.id, true, guards));
    assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
  }
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 1);
  const malformed = await world.send({...command.power(PENDANT.id, true), draft: {...command.power(PENDANT.id, true).draft, data: {on: 'yes'}}});
  assert.equal(malformed.status === 'rejected' && malformed.error.error.code, 'invalid-message');
  const elsewhere = await world.send({...command.power(PENDANT.id, true), draft: {...command.power(PENDANT.id, true).draft, subject: BEAM.id}});
  assert.equal(elsewhere.status === 'rejected' && elsewhere.error.error.code, 'invalid-request', 'a subject that is not the key\'s bulb');
});

it('a full queue refuses a command with capacity, and nothing it refused runs', async () => {
  const world = await open({section: {bulbs: [PENDANT], maxPending: 1}});
  await world.clock.advance(1);
  world.network.offline(PENDANT.address);
  accepted(await world.send(command.power(PENDANT.id, false), {requestId: 'req-busy'}));
  const full = await world.send(command.power(PENDANT.id, true), {requestId: 'req-full'});
  assert.equal(full.status === 'rejected' && full.error.error.code, 'capacity');
  await world.clock.advance(5000);
  assert.equal(world.packets(PENDANT.address, PACKET.setPower), 2, 'only the accepted command and its retry');
});

it('a bulb whose writer lease another holder has is unavailable and refuses commands, while the module runs', async () => {
  const world = await open({section: {bulbs: [{...PENDANT, address: '192.0.2.50'}]}});
  await world.harness.stop();
  const taken = acquireLease(join(world.dir, 'lifx', 'leases'), '192.0.2.50');
  assert.equal(taken.status, 'held', 'the test holds the bulb\'s lease');
  if (taken.status !== 'held') return;
  try {
    await world.start();
    await world.clock.advance(60_000);
    const result = await world.send(command.power(PENDANT.id, false));
    assert.equal(result.status === 'rejected' && result.error.error.code, 'unavailable');
    assert.equal(world.packets('192.0.2.50'), 0, 'never reached');
    assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.reason'] === 'busy').length, 1);
    const sync = await world.operator.sync(['device'], () => {}, {timeoutMs: 5000});
    assert.equal(sync.status === 'synced' && (sync.copy.states()[0]?.data as DeviceRecord).availability, 'unavailable');
    if (sync.status === 'synced') await sync.copy.close();
  } finally {
    taken.lease.release();
  }
  await world.restart();
  await world.clock.advance(1);
  assert.equal(world.device(PENDANT.id)?.availability, 'available', 'once released, the next start takes the lease');
});

it('reading the records starts at most one on-demand LightGet per bulb every 30 s, and none while nothing reads them', async () => {
  const world = await open();
  await world.clock.advance(1);
  const read = async (): Promise<void> => {
    const sync = await world.operator.sync(['device', 'lifx-light'], () => {}, {timeoutMs: 5000});
    if (sync.status === 'synced') await sync.copy.close();
    await flush();
  };
  const reads = (): number => world.packets(PENDANT.address, PACKET.lightGet);
  assert.equal(reads(), 1, 'the read after start');
  await world.clock.advance(READ_INTERVAL_MS - 2);
  await read();
  assert.equal(reads(), 1, 'the reading is fresh');
  await world.clock.advance(1);
  await read();
  await read();
  await world.clock.advance(1);
  assert.equal(reads(), 2, 'one read for a stale reading, however often it is read');
  await world.clock.advance(10 * READ_INTERVAL_MS);
  assert.equal(reads(), 2, 'nothing reads the bulb while nothing reads its records');
  await read();
  await world.clock.advance(1);
  assert.equal(reads(), 3);
  assert.equal(world.packets(BEAM.address), 0, 'never the unqualified bulb');
});

it('the module records each device call as a span in its command\'s trace, and gives the bulb no trace context', async () => {
  const world = await open();
  await world.clock.advance(1);
  const result = await world.send(command.power(PENDANT.id, false), {requestId: 'req-span'});
  accepted(result);
  await world.clock.advance(1);
  const request = world.spans.named('bunny.command.request').find(span => span.attributes['bunny.request.id'] === 'req-span');
  const call = world.spans.named('bunny.device.call').find(span => span.attributes['bunny.request.id'] === 'req-span');
  assert.ok(request && call);
  assert.equal(call.traceId, request.traceId, 'the device call is in the command\'s trace');
  assert.equal(call.attributes['bunny.module'], 'lifx');
  assert.equal(world.logs('command.executing').filter(entry => entry.fields['bunny.request.id'] === 'req-span').length, 1);
});
