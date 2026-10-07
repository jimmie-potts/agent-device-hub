// Automatic agent status (Hub #928). Converted from controllers/lifx/tests/status-publisher.test.mjs at main 483d3a93:
// the same mapping, caps, transition, stale-input, offline-bulb and mode cases, now fed by the module's synced copy of
// the core's sessions instead of the Hub's status feed, on a manual clock. The feed's own cases (SSE notices, the
// 30-second poll, authentication) have no counterpart: a sync replaces them, and the SDK's tests cover it. The
// collector's state has no 2.0 home (MAPPING.md, "Agent status"); an owner that cannot serve is a sync that fails.
import assert from 'node:assert/strict';
import {afterEach} from 'node:test';
import {STATUS_COLORS} from '@jimmie-potts/event-contracts/v2/status';
import {SdkError} from '@jimmie-potts/sdk';
import {PACKET, SimulatedLifx} from '../src/index.js';
import {flush, it, PENDANT, shownColor, World} from './support.js';

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
    assert.deepEqual(world.hosted.flatMap(harness => harness.failures), [], 'no timer of the module failed');
    const seen = JSON.stringify([world.published, world.hosted.flatMap(harness => harness.logs), world.spans.spans]);
    assert.ok(!seen.includes('192.0.2.'), 'no message, record or span carries a bulb\'s address');
    await world.close();
  }
});

const ONE = {bulbs: [PENDANT]};
const paints = (world: World, address: string = PENDANT.address): number => world.packets(address, PACKET.setColor);
/** The hue in degrees a status color has, as the module paints it. */
function hueOf([r, g, b]: readonly [number, number, number]): number {
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  const hue = delta === 0 ? 0 : max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return Math.round(hue < 0 ? hue + 360 : hue);
}

it('mapping: attention, working and done paint the shared status color at the brightness cap', async () => {
  for (const shown of ['attention', 'working', 'done'] as const) {
    const world = await open({section: ONE});
    await world.session('s', shown);
    await world.mode(PENDANT.id, 'work');
    assert.equal(paints(world), 1, shown);
    const color = shownColor(world.network, PENDANT.address);
    assert.equal(color?.brightness, 50, 'the default 50% brightness cap');
    assert.ok(Math.abs((color?.hue ?? -10) - hueOf(STATUS_COLORS[shown])) <= 1, `${shown} paints its shared status color`);
    assert.notEqual(color?.saturation, 0, 'a saturated color, not white');
  }
});

it('idle paints warm white 2700 K at zero saturation, at the brightness cap', async () => {
  const world = await open({section: ONE});
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  assert.deepEqual(shownColor(world.network, PENDANT.address), {hue: 0, saturation: 0, brightness: 50, kelvin: 2700, power: true});
  // A paint the module makes itself serves no request, yet it is a transmission the record shows (#918).
  const sent = world.device(PENDANT.id)?.lastTransmission;
  assert.deepEqual(sent?.status === 'known' && {requestId: sent.requestId, operationIds: sent.operationIds}, {requestId: undefined, operationIds: ['status']});
});

it('Quiet paints attention at the quiet cap and nothing else; leaving attention writes nothing', async () => {
  const world = await open({section: {bulbs: [{...PENDANT, status: {brightnessCapPercent: 50, quietCapPercent: 15}}]}});
  await world.mode(PENDANT.id, 'quiet');
  assert.equal(paints(world), 0, 'nothing to paint in Quiet while nothing needs attention');
  await world.session('s', 'attention');
  await world.clock.advance(1);
  assert.equal(paints(world), 1, 'Quiet paints attention');
  assert.equal(shownColor(world.network, PENDANT.address)?.brightness, 15, 'at the quiet cap, not the brightness cap');
  await world.session('w', 'working');
  await world.clock.advance(1);
  assert.equal(paints(world), 1, 'still attention overall: no new transition');
  await world.session('s', 'idle');
  await world.clock.advance(1);
  assert.equal(paints(world), 1, 'leaving attention writes nothing in Quiet');
});

it('transitions only: a repeated or newer record of the same shown status sends no write', async () => {
  const world = await open({section: ONE});
  await world.session('s', 'working');
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1, 'entering Work paints the current status once');
  await world.session('s', 'working');
  await world.session('s', 'working', record => ({...record, turn: {status: 'known', id: 'turn-2'}}));
  await world.clock.advance(60_000);
  assert.equal(paints(world), 1, 'new evidence of the same status sends no write');
  await world.session('s', 'done');
  await world.clock.advance(1);
  assert.equal(paints(world), 2, 'a real transition paints');
  await world.session('s', 'done');
  await world.clock.advance(1);
  assert.equal(paints(world), 2);
});

it('transitions only: a change in the LIFX app stays through reads until the next transition', async () => {
  const world = await open({section: ONE});
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  world.network.change(PENDANT.address, {color: {hue: 0, saturation: 65535, brightness: 65535, kelvin: 3500}});
  const sync = await world.operator.sync(['device', 'lifx-light'], () => {}, {timeoutMs: 5000});
  if (sync.status === 'synced') await sync.copy.close();
  await world.clock.advance(31_000);
  assert.equal(paints(world), 1, 'a read never triggers a write');
  assert.equal(shownColor(world.network, PENDANT.address)?.saturation, 100, 'the app\'s color stays');
  await world.session('s', 'working');
  await world.clock.advance(1);
  assert.equal(paints(world), 2, 'the transition paints, over what the app left');
});

it('stale input: while the core\'s sessions are not synced the status is unknown and paints nothing; once synced it paints the current status', async () => {
  const world = await open({section: ONE, core: false});
  await world.mode(PENDANT.id, 'work');
  await world.clock.advance(30_000);
  assert.equal(paints(world), 0, 'an unknown status paints nothing, even in Work');
  assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'feed').length, 1, 'one record for the lost feed');
  await world.serveCore();
  await world.session('s', 'attention');
  await world.clock.advance(70_000);
  assert.equal(paints(world), 1, 'once synced, the current status paints');
  assert.ok(Math.abs((shownColor(world.network, PENDANT.address)?.hue ?? -10) - hueOf(STATUS_COLORS.attention)) <= 1);
  assert.equal(world.logs('operation.completed').filter(entry => entry.fields['bunny.operation'] === 'feed').length, 1, 'and one for its recovery');
});

it('a session copy that ends after it synced leaves the status unknown: a mode change paints nothing from the stale sessions', async () => {
  const world = await open({section: ONE, maxQueued: 4});
  await world.session('s', 'attention');
  await world.clock.advance(1);
  // The core can no longer serve, and a burst of records overflows the module's queue: its copy asks again and ends.
  world.refuseSync = true;
  world.flood('s', 'attention', 12);
  await flush();
  assert.equal(world.logs('operation.failed').filter(entry => entry.fields['bunny.operation'] === 'feed').length, 1, 'one record for the lost feed');
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 0, 'the copy ended, so the status is unknown and nothing paints, whatever the last sessions said');
  world.refuseSync = false;
  await world.clock.advance(5000);
  assert.equal(paints(world), 1, 'once it syncs again, the current status paints');
  // The burst dropped deliveries on the bus by design; nothing else failed.
  assert.ok(world.errors.every(error => error instanceof SdkError && error.body.error.code === 'capacity'));
  world.errors.splice(0);
});

it('uncertain freshness: a finished turn idle past five minutes still paints done until acknowledged (#439)', async () => {
  const world = await open({section: ONE});
  await world.clock.advance(6 * 60_000);
  await world.session('s', 'done', record => ({...record, lastEvidenceAtMs: world.clock.now() - 6 * 60_000, observedAtMs: world.clock.now() - 6 * 60_000, freshness: 'uncertain'}));
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  assert.ok(Math.abs((shownColor(world.network, PENDANT.address)?.hue ?? -10) - hueOf(STATUS_COLORS.done)) <= 1, 'done paints green');
  // Any consumer's acknowledgment retires done, as today: the module passes no acknowledging consumers.
  await world.session('s', 'done', record => ({...record, notices: record.notices.map(notice => ({...notice, acknowledgedBy: ['pixoo']}))}));
  await world.clock.advance(1);
  assert.equal(paints(world), 2);
  assert.equal(shownColor(world.network, PENDANT.address)?.kelvin, 2700, 'idle once acknowledged');
});

it('offline bulb: one bulb failing never blocks the other, and its failed paint is not repeated while the status stands', async () => {
  const desk = {...PENDANT, id: 'desk', address: '192.0.2.42'};
  const world = await open({section: {bulbs: [PENDANT, desk]}});
  await world.clock.advance(1);
  world.network.offline(desk.address);
  await world.mode(PENDANT.id, 'work');
  await world.mode(desk.id, 'work');
  await world.clock.advance(5000);
  assert.equal(paints(world), 1);
  assert.equal(paints(world, desk.address), 2, 'the desk\'s paint was tried: once, with its one retry');
  await world.session('s', 'idle');
  await world.clock.advance(5000);
  assert.equal(paints(world, desk.address), 2, 'not repeated on an unchanged status');
  world.network.online(desk.address);
  await world.session('s', 'working');
  await world.clock.advance(5000);
  assert.equal(paints(world), 2);
  assert.equal(paints(world, desk.address), 3, 'a real transition paints both again');
});

it('modes: a bulb with no stored mode starts Free, which never paints; Work paints the current status once on entry', async () => {
  const world = await open({section: ONE});
  await world.session('s', 'attention');
  await world.clock.advance(1);
  assert.equal(paints(world), 0, 'Free never paints');
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1, 'entering Work paints the current status once');
  await world.mode(PENDANT.id, 'free');
  assert.equal(paints(world), 1, 'entering Free paints nothing');
  await world.session('s', 'done');
  await world.clock.advance(1);
  assert.equal(paints(world), 1, 'a transition in Free paints nothing');
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 2, 'returning to Work paints the current status once more');
});

it('a restart paints nothing while the status stands, and paints once when it changed meanwhile', async () => {
  const world = await open({section: ONE});
  await world.session('s', 'working');
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  await world.restart();
  await world.clock.advance(60_000);
  assert.equal(paints(world) + world.packets(PENDANT.address, PACKET.setPower), 1, 'the restart wrote nothing to the bulb');
  await world.harness.stop();
  await world.session('s', 'attention');
  await world.start();
  await world.clock.advance(1);
  assert.equal(paints(world), 2, 'the status changed while the module was stopped, so it paints once');
});

it('painting never changes power, and an unqualified bulb with status caps is never painted', async () => {
  const beam = {id: 'beam', address: '192.0.2.41', vendor: 1, product: 38, firmwareMajor: 3, firmwareMinor: 70, status: {brightnessCapPercent: 50, quietCapPercent: 20}};
  const world = await open({section: {bulbs: [PENDANT, beam]}});
  await world.clock.advance(1);
  world.network.change(PENDANT.address, {power: false});
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  assert.equal(shownColor(world.network, PENDANT.address)?.power, false, 'a paint leaves the bulb off');
  await world.session('s', 'attention');
  await world.clock.advance(1);
  assert.equal(world.packets(beam.address), 0, 'the unqualified bulb is never reached');
});

it('a paint that finds the bulb\'s queue full is a failed attempt, never repeated', async () => {
  const world = await open({section: {bulbs: [PENDANT], maxPending: 1}, network: new SimulatedLifx()});
  await world.mode(PENDANT.id, 'work');
  assert.equal(paints(world), 1);
  world.network.offline(PENDANT.address);
  const held = await world.send({key: `bunny.cmd.power-set.${PENDANT.id}`, draft: {type: 'org.bunny.power.set.requested', subject: PENDANT.id, dataschema: 'https://bunny.invalid/events/power-set/2.0', data: {on: true}}});
  assert.equal(held.status, 'accepted');
  await world.session('s', 'attention');
  await flush();
  world.network.online(PENDANT.address);
  await world.clock.advance(60_000);
  assert.equal(paints(world), 1, 'the paint found the queue full and was not sent, then or later');
});
