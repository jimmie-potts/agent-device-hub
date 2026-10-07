// The Nanoleaf module's faults and recoveries (Hub #844 review): a command that expires unsent holds nothing, a hold
// after an uncertain write is its own state, a device that answers with an HTTP error is reached and ends the command
// with its code, a worker that a store failure stops starts again, a read failure while publishing never fails the
// module, commands expire without a worker, and an idle wall publishes nothing new. Each test runs on a manual clock
// against a simulated Lines controller.
import assert from 'node:assert/strict';
import {readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import type {CommandDraft} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans} from '@jimmie-potts/sdk/testing';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, OBSERVE_MAX_MS, OBSERVE_MS, RESTART_MAX_MS, SYNTHETIC_TOKEN, TRANSMISSION_MS} from '../src/index.js';
import {identityKey} from '../src/shared-input.js';
import {nextTransmission, type ShownTransmission, type Transmission} from '../src/module/views.js';
import {deviceCommand, ModuleWorld, moduleCommand, type WallState} from './module-support.js';
import {suite, test} from './support.js';

type Ended = {requestId: string; result: string; evidence: string; error?: {code: string; retryable: boolean; requestId: string}};

const outcomeOf = async (world: ModuleWorld, requestId: string, withinMs = 10_000): Promise<Ended> => {
  await world.until(() => world.outcomes(requestId).length > 0, withinMs, `the outcome of ${requestId}`);
  const [outcome, ...more] = world.outcomes(requestId);
  assert.equal(more.length, 0, `one outcome for ${requestId}`);
  assert.ok(outcome !== undefined);
  return outcome.data as Ended;
};
const failed = (requestId: string, evidence: string, code: string, retryable = false): Ended =>
  ({requestId, result: 'failed', evidence, error: {code, retryable, requestId}});
const shownOnLines = (world: ModuleWorld): number => world.wall()?.tasks.filter(task => task.element !== null).length ?? 0;
const availability = (world: ModuleWorld): string | undefined => world.device_()?.availability;
const transmission = (world: ModuleWorld): {transmittedAtMs: number; requestId?: string} | undefined => {
  const shown = world.device_()?.lastTransmission;
  return shown?.status === 'known' ? shown : undefined;
};
const deviceRecords = (world: ModuleWorld): number =>
  world.seen.filter(message => message.kind === 'state' && message.dataschema === 'https://bunny.invalid/events/device/2.0').length;
const logged = (world: ModuleWorld, event: string, fields: Record<string, unknown>): number =>
  world.logs().filter(record => record.event === event && Object.entries(fields).every(([key, value]) => record.fields[key] === value)).length;
const mode = (requestId: string, value: string): {key: string; draft: CommandDraft<object>} => deviceCommand('device-mode-set', {requestId, mode: value});
const brightness = (requestId: string, percent: number): {key: string; draft: CommandDraft<object>} => deviceCommand('brightness-set', {requestId, percent});

/** A world whose wall shows alpha on a Line, its wave over. */
async function showing(context: Parameters<typeof ModuleWorld.open>[0], options: Parameters<typeof ModuleWorld.open>[1] = {}): Promise<ModuleWorld> {
  const world = await ModuleWorld.open(context, options);
  await world.core.set('alpha');
  await world.start();
  await world.until(() => shownOnLines(world) === 1 && availability(world) === 'available', 5000, 'alpha on a Line');
  await world.advance(3000);
  return world;
}

suite('expiry and holds', () => {
  test('while the wall does not answer, a mode command completes as observed and a device write expires; neither holds the wall', async context => {
    const world = await showing(context);
    world.device.offline();
    await world.until(() => availability(world) === 'unavailable', 10_000, 'the wall unavailable');
    // A mode is the module's own state: it commits at once, whether or not the wall answers.
    const {key, draft} = mode('quiet-offline', 'quiet');
    assert.equal((await world.request(key, draft, 15_000)).status, 'accepted');
    assert.deepEqual(world.outcomes('quiet-offline').map(message => message.data), [{requestId: 'quiet-offline', result: 'succeeded', evidence: 'observed'}],
      'the mode command completed as its mode committed');
    assert.deepEqual(world.device_()?.desired.mode, {status: 'known', value: 'quiet'});
    // A device write still waits for the wall, and fails at its deadline.
    const late = brightness('brightness-late', 30);
    assert.equal((await world.request(late.key, late.draft, 15_000)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'brightness-late', 20_000), failed('brightness-late', 'none', 'expired'));
    await world.until(() => world.device_()?.desired.brightness.status === 'unknown', 1000, 'the failed write took its desired brightness with it');
    await world.advance(25_000);
    world.device.online();
    await world.until(() => availability(world) === 'available', 40_000, 'the wall available once it answers');
    assert.equal(world.wall()?.held, false, 'an unsent write proves no effect, so it holds nothing');
    assert.deepEqual(world.query("SELECT value FROM meta WHERE key LIKE 'controller_hold_revision%'"), []);
    // The wall follows the module's mode once it answers, at Quiet's own level: the expired brightness never applies.
    await world.until(() => world.device.state().devices[LINES_ADDRESS]?.brightness === 10, 10_000, 'the Quiet level');
    await world.core.set('beta');
    await world.until(() => shownOnLines(world) === 2, 10_000, 'a new session on a Line without another mode command');
    assert.equal(logged(world, 'operation.failed', {'bunny.code': 'uncertain-result'}), 0, 'no hold was logged');
    world.verify();
  });

  test('a hold after an uncertain write is the device\'s own state, degraded rather than unavailable, logged once each way', async context => {
    const world = await showing(context);
    world.device.loseNextAnswer('/state');
    const {key, draft} = brightness('lost', 20);
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'lost')).result, 'uncertain');
    await world.until(() => world.wall()?.held === true, 2000, 'the wall view shows the hold');
    await world.advance(20_000);
    assert.equal(availability(world), 'degraded', 'the device answers its polls, and the module withholds its writes');
    assert.equal(logged(world, 'operation.failed', {'bunny.code': 'uncertain-result', 'bunny.write.possible': true}), 1, 'the hold is logged once');
    const {key: workKey, draft: workDraft} = mode('release', 'work');
    assert.equal((await world.request(workKey, workDraft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'release')).evidence, 'observed');
    await world.until(() => world.wall()?.held === false && availability(world) === 'available', 5000, 'the hold released');
    assert.equal(logged(world, 'operation.completed', {'bunny.operation': 'status', 'bunny.outcome': 'current'}), 1, 'the release is logged once');
    for (const record of world.logs()) assert.equal(checkModuleRecord('nanoleaf', record), undefined, record.event);
    world.verify();
  });

  test('a write out at a restart holds the device: held and degraded, with no failed pass', async context => {
    const world = await showing(context);
    // The write reaches the wall, and the module restarts before its answer comes.
    world.device.loseNextAnswer('/state');
    const {key, draft} = brightness('out', 20);
    assert.equal((await world.request(key, draft)).status, 'accepted');
    await world.until(() => world.device.state().devices[LINES_ADDRESS]?.brightness === 20, 500, 'the write out');
    await world.restart();
    assert.equal((await outcomeOf(world, 'out')).result, 'uncertain');
    await world.until(() => world.wall()?.held === true && availability(world) === 'degraded', 10_000, 'the hold shown');
    assert.deepEqual(world.query("SELECT value FROM meta WHERE key LIKE 'control_error%'"), [], 'only the hold makes the device degraded');
    world.verify();
  });

  test('a command no worker checks still fails expired at its deadline', async context => {
    const world = await ModuleWorld.open(context);
    // Another instance holds the device's lock, so the module's worker ends at once and cannot start again.
    const release = world.lockDevice();
    await world.start();
    await world.until(() => logged(world, 'operation.failed', {'bunny.reason': 'busy'}) > 0, 5000, 'the worker ended locked');
    const {key, draft} = deviceCommand('power-set', {requestId: 'unchecked', on: false});
    assert.equal((await world.request(key, draft, 3000)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'unchecked', 5000), failed('unchecked', 'none', 'expired'));
    assert.deepEqual(world.writes().filter(write => write.on === false), [], 'it never reached the wall');
    release();
    world.verifyMessages();
  });

  test('a worker that ended starts again for an accepted command, before its own restart is due', async context => {
    const world = await ModuleWorld.open(context);
    const release = world.lockDevice();
    await world.start();
    await world.until(() => logged(world, 'operation.failed', {'bunny.reason': 'busy'}) > 0 && world.wall()?.source === 'shared', 5000,
      'the worker ended locked, and shared input selected');
    // The restarts 1, 3 and 7 s later find the lock held too; the next one is 8 s after the last.
    await world.advance(8000);
    release();
    const asked = world.clock.now();
    const {key, draft} = deviceCommand('power-set', {requestId: 'restarts', on: false});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    await world.until(() => world.writes().some(write => write.on === false), 1000, 'the write, from a worker the command started');
    assert.ok(world.clock.now() - asked < 1000);
    assert.deepEqual(await outcomeOf(world, 'restarts'), {requestId: 'restarts', result: 'succeeded', evidence: 'transmitted'});
    world.verifyMessages();
  });
});

suite('a device that answers with an HTTP error', () => {
  test('a refused write fails with transmitted evidence and the mapped code, is the last transmission, holds nothing, and leaves the device available', async context => {
    const world = await showing(context);
    world.device.refuseNext('/state', 400);
    const sent = world.clock.now();
    const bad = brightness('refused-400', 20);
    assert.equal((await world.request(bad.key, bad.draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'refused-400'), failed('refused-400', 'transmitted', 'invalid-request'));
    // The device's answer shows the write reached it: a transmitted send, whatever the device made of it.
    await world.until(() => {
      const shown = world.device_()?.lastTransmission;
      return shown?.status === 'known' && shown.requestId === 'refused-400' && shown.transmittedAtMs >= sent;
    }, 200, 'the refused write as the last transmission, at once');
    const next = brightness('after-400', 30);
    assert.equal((await world.request(next.key, next.draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'after-400'), {requestId: 'after-400', result: 'succeeded', evidence: 'transmitted'});
    assert.equal(world.device.state().devices[LINES_ADDRESS]?.brightness, 30, 'nothing held the device');
    assert.equal(world.wall()?.held, false);
    assert.equal(availability(world), 'available');
    world.verify();
  });

  test('a scene the wall no longer has fails not-found with transmitted evidence', async context => {
    const world = await showing(context);
    const free = mode('to-free', 'free');
    assert.equal((await world.request(free.key, free.draft)).status, 'accepted');
    await outcomeOf(world, 'to-free');
    // The mode command completes as Free commits; the wall is handed over once the worker applies it.
    await world.until(() => world.wall()?.modePending === false, 5000, 'the Free handoff applied');
    const record = world.device_();
    const sceneId = record?.capabilities.scenes.supported === true ? record.capabilities.scenes.sceneIds[1] : undefined;
    assert.ok(sceneId !== undefined, 'the wall listed its second scene');
    // The scene is deleted in the Nanoleaf app; in Free the module does not read the list again before the write.
    world.device.removeScene(LINES_ADDRESS, 'Northern Lights');
    const {key, draft} = deviceCommand('scene-activate', {requestId: 'deleted-scene', sceneId});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'deleted-scene'), failed('deleted-scene', 'transmitted', 'not-found'));
    assert.equal(world.wall()?.held, false);
    await world.advance(6000);
    assert.equal(availability(world), 'available');
    world.verify();
  });

  test('a 401 is the device refusing the module\'s token: the write fails unauthenticated, and a revoked token shows degraded, logged once each way', async context => {
    const world = await showing(context);
    world.device.refuseNext('/state', 401);
    const off = deviceCommand('power-set', {requestId: 'refused-401', on: false});
    assert.equal((await world.request(off.key, off.draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'refused-401'), failed('refused-401', 'transmitted', 'unauthenticated'));
    assert.equal(world.wall()?.held, false);
    // The owner paired the wall again elsewhere: it answers every request, with 401.
    world.device.setToken('tok_REPAIRED');
    await world.advance(30_000);
    assert.equal(availability(world), 'degraded', 'the wall answers, and refuses the module');
    world.device.setToken(SYNTHETIC_TOKEN);
    await world.until(() => availability(world) === 'available', 40_000, 'the wall takes the token again');
    assert.equal(logged(world, 'operation.failed', {'bunny.code': 'unauthenticated'}), 2, 'one record for the refused write\'s run and one for the revoked token');
    assert.equal(logged(world, 'device.unavailable', {}), 0, 'an answering device is never unavailable');
    for (const record of world.logs()) assert.equal(checkModuleRecord('nanoleaf', record), undefined, record.event);
    // The worker's passes fail on the refusals too; the link's record is the one record of the outage.
    world.verify();
  });
});

suite('store failures', () => {
  test('a worker that a store failure stopped starts again with backoff, and the device shows degraded meanwhile', async context => {
    const world = await showing(context);
    const release = world.refuseStore('writes');
    await world.until(() => logged(world, 'operation.failed', {'bunny.reason': 'busy'}) > 0, 10_000, 'the worker ended unrecorded');
    await world.until(() => availability(world) === 'degraded', 5000, 'the device degraded while no worker presents it');
    assert.equal(world.wall()?.failing, true);
    release();
    await world.core.set('beta');
    await world.until(() => shownOnLines(world) === 2, 40_000, 'the new session on a Line, from a worker started again');
    await world.until(() => availability(world) === 'available' && world.wall()?.failing === false, 10_000, 'the device available again');
    assert.equal(logged(world, 'operation.failed', {'bunny.reason': 'busy'}), 1, 'the stopped worker is logged once');
    world.verifyMessages();
  });

  test('a store outage logs each run once: the failed pass and the stopped worker, then each recovery, never one in between', async context => {
    const world = await showing(context);
    const release = world.refuseStore('writes');
    await world.until(() => logged(world, 'operation.failed', {'bunny.reason': 'busy'}) > 0, 10_000, 'the worker ended');
    // The wall still answers its polls while the store is busy; no recovery counts until a worker presents it again.
    await world.advance(3000);
    release();
    await world.advance(40_000);
    const status = world.logs().filter(record => record.level !== 'debug' && record.fields['bunny.operation'] === 'status'
      && (record.event === 'operation.failed' || record.event === 'operation.completed')).map(record => record.event);
    assert.deepEqual(status, ['operation.failed', 'operation.failed', 'operation.completed', 'operation.completed'],
      'the failed pass and the stopped worker, then their recoveries');
    world.verifyMessages();
  });

  test('commands during a worker outage leave one pending restart, not a chain each', async context => {
    const world = await ModuleWorld.open(context);
    const release = world.lockDevice();
    await world.start();
    const ends = (): number => logged(world, 'operation.failed', {'bunny.reason': 'busy'});
    await world.until(() => ends() > 0, 5000, 'the worker ended locked');
    // Each accepted command starts the worker, which the lock ends at once.
    for (let index = 0; index < 10; index += 1) {
      const {key, draft} = deviceCommand('power-set', {requestId: `outage-${String(index)}`, on: index % 2 === 0});
      assert.equal((await world.request(key, draft, 60_000)).status, 'accepted');
    }
    assert.ok(ends() > 10, `each command started the worker: ${ends()} ends`);
    // Once its wait is the longest, one restart starts the worker once per RESTART_MAX_MS; a restart left waiting by each
    // command's start would start it about ten times as often.
    await world.advance(2 * RESTART_MAX_MS);
    const before = ends();
    await world.advance(4 * RESTART_MAX_MS);
    const restarted = ends() - before;
    assert.ok(restarted >= 3 && restarted <= 5, `${restarted} starts in ${4 * RESTART_MAX_MS} ms`);
    // Each end after the first of the run is logged at DEBUG.
    assert.equal(world.logs().filter(record => record.level !== 'debug' && record.fields['bunny.reason'] === 'busy').length, 1, 'the stopped worker is logged once');
    release();
    world.verifyMessages();
  });

  test('a publication the store refused is published within a second of the store reading again, while the wall\'s poll is idle', async context => {
    const world = await showing(context);
    const release = world.refuseStore('everything');
    world.device.setPower(LINES_ADDRESS, false);
    await world.until(() => logged(world, 'operation.failed', {'bunny.operation': 'snapshot'}) === 1, 10_000, 'the publication refused');
    await world.advance(17_000);
    // Just after a poll, the next one is five seconds away and no worker runs, so only the retry publishes.
    const reads = world.device.state().devices[LINES_ADDRESS]?.reads ?? 0;
    await world.until(() => (world.device.state().devices[LINES_ADDRESS]?.reads ?? 0) > reads, 6000, 'a poll');
    await world.advance(50);
    release();
    await world.until(() => {
      const observed = world.device_()?.observed;
      return observed?.status === 'known' && observed.power.status === 'known' && !observed.power.value;
    }, 1500, 'the record published by the retry');
    world.verifyMessages();
  });

  test('a read failure while publishing is logged once and tried again, and never fails the module', async context => {
    const world = await showing(context);
    const release = world.refuseStore('everything');
    world.device.setPower(LINES_ADDRESS, false);
    await world.advance(15_000);
    assert.deepEqual(world.harness.failures, [], 'no timer failed the module');
    assert.equal(logged(world, 'operation.failed', {'bunny.operation': 'snapshot'}), 1, 'the failed publication is logged once');
    release();
    await world.until(() => {
      const observed = world.device_()?.observed;
      return observed?.status === 'known' && observed.power.status === 'known' && !observed.power.value;
    }, 40_000, 'the record published once the store reads');
    assert.equal(logged(world, 'operation.completed', {'bunny.operation': 'snapshot'}), 1, 'the recovery is logged once');
    world.verifyMessages();
  });
});

suite('publication', () => {
  test('an idle wall publishes nothing new over many polls', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => availability(world) === 'available' && world.device_()?.observed.status === 'known', 10_000, 'the wall observed');
    // The start's paints are published within the transmission interval; after that the wall is idle.
    await world.advance(2 * TRANSMISSION_MS);
    const before = deviceRecords(world);
    const observedAt = world.device_()?.observed;
    await world.advance(60_000);
    assert.equal(deviceRecords(world), before, 'a poll that changed nothing published nothing');
    assert.deepEqual(world.device_()?.observed, observedAt, 'the record keeps the reading it published');
    world.verify();
  });

  test('the last transmission includes the module\'s own paints, each shown within the interval and a poll and changed at most once per interval, and a command write at once', async context => {
    const world = await showing(context);
    await world.advance(2 * TRANSMISSION_MS);
    const settled = world.device_()?.lastTransmission;
    assert.ok(settled?.status === 'known' && settled.requestId === undefined, 'the start\'s paints are the last transmission, for no command');
    const before = deviceRecords(world);
    const asked = world.clock.now();
    // When the record first showed each transmission, on the world's clock, as the world moves one 7 ms step at a time.
    const shownAt = new Map<number, number>();
    const watch = async (ms: number): Promise<void> => {
      for (const end = world.clock.now() + ms; world.clock.now() < end;) {
        await world.advance(7);
        const shown = world.device_()?.lastTransmission;
        if (shown?.status === 'known' && shown.transmittedAtMs >= asked && !shownAt.has(shown.transmittedAtMs)) shownAt.set(shown.transmittedAtMs, world.clock.now());
      }
    };
    // A new session's wave is several paints in a few seconds.
    await world.core.set('beta');
    await watch(4 * TRANSMISSION_MS);
    const paints = world.writes().filter(write => write.atMs >= asked);
    assert.ok(paints.length > 2, `the wave painted ${paints.length} times`);
    // Each paint is in the record, that paint or a later one, once the interval has passed and a request has settled,
    // which the poll bounds.
    for (const paint of paints) {
      const shown = Math.min(...[...shownAt].filter(([atMs]) => atMs >= paint.atMs).map(([, at]) => at));
      assert.ok(shown - paint.atMs <= TRANSMISSION_MS + OBSERVE_MS, `a paint ${paint.atMs - asked} ms in was shown ${shown - paint.atMs} ms later`);
    }
    // The record changed at most once per interval while the wall painted, and so was published far less often than it painted.
    const changes = [...shownAt.values()].sort((a, b) => a - b);
    for (const [index, at] of changes.entries()) {
      if (index > 0) assert.ok(at - (changes[index - 1] ?? 0) >= TRANSMISSION_MS, `the record changed ${at - (changes[index - 1] ?? 0)} ms after the one before`);
    }
    const records = deviceRecords(world) - before;
    assert.ok(records < paints.length, `${paints.length} paints, ${records} records`);
    assert.deepEqual(world.device_()?.lastTransmission, {status: 'known', transmittedAtMs: Math.max(...paints.map(paint => paint.atMs)), operationIds: []},
      'the record ends on the newest paint, for no command');
    // A command write is its own transmission, published with the command's outcome.
    const {key, draft} = deviceCommand('power-set', {requestId: 'written', on: false});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    await outcomeOf(world, 'written');
    await world.until(() => world.device_()?.lastTransmission.status === 'known' && (world.device_()?.lastTransmission as {requestId?: string}).requestId === 'written',
      200, 'the command write in the record at once');
    world.verify();
  });

  test('once the wall answers again after an outage, its status is read within one normal poll, not at the end of the backoff', async context => {
    const world = await showing(context);
    world.device.offline();
    await world.until(() => availability(world) === 'unavailable', 10_000, 'the wall unavailable');
    // The status reads back off to their longest wait while the wall does not answer. The wall answers again just after
    // that wait began, so the next read would be almost a whole backoff away.
    await world.until(() => Math.max(...world.clock.dueTimes()) - world.clock.now() > OBSERVE_MAX_MS - 100, 3 * OBSERVE_MAX_MS, 'the longest backoff begun');
    world.device.online();
    const quiet = mode('quiet-back', 'quiet');
    assert.equal((await world.request(quiet.key, quiet.draft)).status, 'accepted');
    await world.until(() => world.device.state().devices[LINES_ADDRESS]?.brightness === 10, 10_000, 'the wall at the Quiet level');
    // The wall answered the worker's requests, so the next status read comes within one normal poll.
    await world.until(() => {
      const observed = world.device_()?.observed;
      return observed?.status === 'known' && observed.brightness.status === 'known' && observed.brightness.value === 10;
    }, OBSERVE_MS + 100, 'the Quiet level read back');
    world.verify();
  });

  test('outcomes that sent nothing keep the last transmission and its request ID, and polls after the interval change nothing', async context => {
    const world = await showing(context);
    const record = await world.core.finish('alpha');
    await world.until(() => world.wall()?.tasks.some(task => task.status === 'unread') === true, 5000, 'the finished turn on the wall');
    await world.advance(5000);
    // Switched off once the finished turn is painted, the wall's display stays as it is, so the module paints nothing more.
    const off = deviceCommand('power-set', {requestId: 'written', on: false});
    assert.equal((await world.request(off.key, off.draft)).status, 'accepted');
    await outcomeOf(world, 'written');
    await world.until(() => transmission(world)?.requestId === 'written', 200, 'the power write in the record');
    await world.advance(2 * TRANSMISSION_MS);
    const written = world.device_()?.lastTransmission;
    assert.equal(transmission(world)?.requestId, 'written');
    const writes = world.writes().length;
    // An acknowledgment and a saved favorite each complete, writing nothing.
    const ack = moduleCommand(NANOLEAF_FAMILIES.acknowledge.family, NANOLEAF_FAMILIES.acknowledge.type,
      {requestId: 'ack', task: identityKey(record.identity), noticeId: record.notices[0]?.id ?? ''});
    const save = moduleCommand(NANOLEAF_FAMILIES.favoriteEdit.family, NANOLEAF_FAMILIES.favoriteEdit.type,
      {requestId: 'save', edit: {kind: 'save', name: 'Evening', animation: {preset: 'ocean'}}});
    for (const {key, draft} of [ack, save]) assert.equal((await world.request(key, draft)).status, 'accepted');
    for (const requestId of ['ack', 'save']) assert.equal((await outcomeOf(world, requestId)).result, 'succeeded', requestId);
    // The polls after the interval rebuild the record and change nothing in it.
    await world.advance(TRANSMISSION_MS + 2 * OBSERVE_MS);
    assert.equal(world.writes().length, writes, 'nothing reached the wall after the power write');
    assert.deepEqual(world.device_()?.lastTransmission, written, 'the power write is still the last transmission, with its request ID');
    const before = deviceRecords(world);
    await world.advance(2 * OBSERVE_MS);
    assert.equal(deviceRecords(world), before, 'polls long after the interval republish nothing');
    // While the wall does not answer, a mode command completes as its mode commits and a write expires: neither sent
    // anything, and the timed-out polls after the interval change nothing.
    world.device.offline();
    await world.until(() => availability(world) === 'unavailable', 10_000, 'the wall unavailable');
    const quiet = mode('quiet', 'quiet');
    const late = brightness('late', 30);
    for (const {key, draft} of [quiet, late]) assert.equal((await world.request(key, draft, 3000)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'quiet'), {requestId: 'quiet', result: 'succeeded', evidence: 'observed'});
    assert.deepEqual(await outcomeOf(world, 'late'), failed('late', 'none', 'expired'));
    await world.advance(TRANSMISSION_MS + OBSERVE_MS);
    assert.equal(world.writes().length, writes, 'nothing reached the wall');
    assert.deepEqual(world.device_()?.lastTransmission, written, 'the power write is still the last transmission after the mode command and the expiry');
    world.verify();
  });

  test('a restart keeps the last transmission, though the commands it ends report outcomes', async context => {
    const world = await showing(context);
    const off = deviceCommand('power-set', {requestId: 'written', on: false});
    assert.equal((await world.request(off.key, off.draft)).status, 'accepted');
    await outcomeOf(world, 'written');
    await world.until(() => transmission(world)?.requestId === 'written', 200, 'the power write in the record');
    const written = world.device_()?.lastTransmission;
    // A command waits for a wall that stopped answering; the restart ends it, reporting an outcome that sent nothing.
    world.device.offline();
    await world.until(() => availability(world) === 'unavailable', 10_000, 'the wall unavailable');
    const waiting = brightness('waiting', 30);
    assert.equal((await world.request(waiting.key, waiting.draft, 60_000)).status, 'accepted');
    const seen = world.seen.length;
    await world.restart();
    assert.deepEqual(await outcomeOf(world, 'waiting'), failed('waiting', 'none', 'cancelled'));
    await world.until(() => world.seen.slice(seen).some(message => message.dataschema.endsWith('/device/2.0')), 5000, 'the record after the restart');
    await world.advance(TRANSMISSION_MS);
    assert.deepEqual(world.device_()?.lastTransmission, written, 'the record still shows the power write after the restart');
    world.verifyMessages();
  });

  test('the record shows the last write: a command\'s at once, the module\'s paints at most once per interval, and nothing else changes it', () => {
    const paint = (atMs: number): Transmission => ({atMs});
    const written = (atMs: number, requestId: string): Transmission => ({atMs, requestId});
    const next = (shown: ShownTransmission | undefined, latest: Transmission | undefined, commandWritten: boolean, nowMs: number):
      ReturnType<typeof nextTransmission> => nextTransmission(shown, latest, commandWritten, nowMs, TRANSMISSION_MS);
    // No write is known yet; the first one known, saved before a restart or made in this run, is shown at once.
    assert.deepEqual(next(undefined, undefined, false, 100), {transmission: undefined, chosen: false});
    assert.deepEqual(next(undefined, written(10, 'saved'), false, 100), {transmission: written(10, 'saved'), chosen: true});
    const shown = {transmission: paint(200), chosenAtMs: 200};
    // Nothing written since, as after a poll: nothing changes.
    assert.deepEqual(next(shown, paint(200), false, 4000), {transmission: paint(200), chosen: false});
    // A later paint inside the interval waits for its end, when the newest paint is shown.
    assert.deepEqual(next(shown, paint(1200), false, 1300), {transmission: paint(200), chosen: false});
    assert.deepEqual(next(shown, paint(4900), false, 200 + TRANSMISSION_MS), {transmission: paint(4900), chosen: true});
    // A command's write is shown at once, inside the interval too, with its request ID, also in the shown paint's
    // millisecond; so is a paint that followed it before the record was built.
    assert.deepEqual(next(shown, written(1500, 'power'), true, 1501), {transmission: written(1500, 'power'), chosen: true});
    assert.deepEqual(next(shown, written(200, 'power'), true, 300), {transmission: written(200, 'power'), chosen: true});
    assert.deepEqual(next(shown, paint(1503), true, 1504), {transmission: paint(1503), chosen: true});
    // After a shown command write, a mode command, an expiry or an acknowledgment writes nothing, so the last write stays
    // as it was: the record keeps the request ID and chooses nothing new, after the interval too, as a poll then finds.
    const command = {transmission: written(1500, 'power'), chosenAtMs: 1501};
    assert.deepEqual(next(command, written(1500, 'power'), false, 1501 + TRANSMISSION_MS + 500), {transmission: written(1500, 'power'), chosen: false});
  });

  test('a device request for a command records a device-call span in the command\'s trace', async context => {
    const spans = new RecordedSpans();
    const world = await showing(context, {spans});
    const {key, draft} = deviceCommand('power-set', {requestId: 'traced', on: false});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    await outcomeOf(world, 'traced');
    const outcome = world.outcomes('traced')[0];
    const calls = spans.named('bunny.device.call').filter(span => span.attributes['bunny.request.id'] === 'traced');
    assert.equal(calls.length, 1, 'one span for the one write');
    assert.equal(calls[0]?.traceId, outcome?.traceparent?.split('-')[1], 'in the command\'s trace');
    assert.equal(calls[0]?.kind, 'client');
    assert.equal(calls[0]?.status, 'unset');
    assert.equal(calls[0]?.attributes['bunny.device.id'], 'wall');
    assert.equal(calls[0]?.attributes['bunny.operation'], 'power');
    world.verify();
  });

  test('the module\'s lock files and their journals are private', async context => {
    const world = await showing(context);
    const folder = join(world.stateDir, 'nanoleaf');
    const files = readdirSync(folder);
    assert.ok(files.includes('notification-lock.sqlite') && files.includes('layout-lock.sqlite'), files.join(', '));
    for (const file of files) assert.equal(statSync(join(folder, file)).mode & 0o077, 0, `${file} is private`);
    world.verify();
  });
});

suite('the wall\'s own families', () => {
  test('the animation options carry the presets, favorites and bounds a play request uses, and nothing else', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const save = moduleCommand(NANOLEAF_FAMILIES.favoriteEdit.family, NANOLEAF_FAMILIES.favoriteEdit.type,
      {requestId: 'save', edit: {kind: 'save', name: 'Evening', animation: {pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow'}}});
    assert.equal((await world.request(save.key, save.draft)).status, 'accepted');
    await outcomeOf(world, 'save');
    await world.until(() => (world.state<{favorites: unknown[]}>('nanoleaf-animations', 'wall')?.favorites.length ?? 0) === 1, 1000, 'the favorite listed');
    const options = world.state<Record<string, unknown>>('nanoleaf-animations', 'wall');
    assert.deepEqual(Object.keys(options ?? {}).sort(), ['defaults', 'directions', 'favorites', 'id', 'limits', 'mode', 'patterns', 'positionsSaved',
      'presets', 'queuedAnimation', 'rememberedSceneId', 'revision', 'speeds']);
    // A favorite is saved with the defaults filled in, as a play request then uses it.
    assert.deepEqual(options?.favorites, [{name: 'Evening', animation: {pattern: 'wave', colors: ['#0044aa', '#00aa66'], speed: 'slow', direction: 'right', loop: true}}]);
    const wall = world.wall() as (WallState & Record<string, unknown>) | undefined;
    assert.equal(JSON.stringify(wall).includes('Evening'), false, 'the wall view holds no favorite');
    world.verify();
  });

  test('a refused favorite edit says what was wrong with the favorite', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const edit = (requestId: string, value: object): {key: string; draft: CommandDraft<object>} =>
      moduleCommand(NANOLEAF_FAMILIES.favoriteEdit.family, NANOLEAF_FAMILIES.favoriteEdit.type, {requestId, edit: value});
    const save = edit('save', {kind: 'save', name: 'Evening', animation: {preset: 'ocean'}});
    assert.equal((await world.request(save.key, save.draft)).status, 'accepted');
    const repeat = edit('again', {kind: 'save', name: 'Evening', animation: {preset: 'ocean'}});
    const again = await world.request(repeat.key, repeat.draft);
    assert.equal(again.status === 'rejected' && again.error.error.code, 'revision-conflict');
    assert.match(again.status === 'rejected' ? again.error.error.detail ?? '' : '', /favorite with that name/);
    const forget = edit('missing', {kind: 'forget', name: 'Morning'});
    const missing = await world.request(forget.key, forget.draft);
    assert.equal(missing.status === 'rejected' && missing.error.error.code, 'unsupported-capability');
    assert.match(missing.status === 'rejected' ? missing.error.error.detail ?? '' : '', /no favorite has that name/);
    world.verify();
  });

  test('an animation before the Lines\' layout is saved is refused invalid-state, as a wall edit then is', async context => {
    const world = await ModuleWorld.open(context, {online: false});
    await world.start();
    const free = mode('to-free', 'free');
    assert.equal((await world.request(free.key, free.draft)).status, 'accepted');
    const play = moduleCommand(NANOLEAF_FAMILIES.animationPlay.family, NANOLEAF_FAMILIES.animationPlay.type, {requestId: 'early', animation: {preset: 'ocean'}});
    const result = await world.request(play.key, play.draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'invalid-state');
    world.verifyMessages();
  });
});
