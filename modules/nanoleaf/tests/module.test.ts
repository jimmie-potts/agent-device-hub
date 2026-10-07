// The Nanoleaf runtime module (Hub #844): the port hosted as the runtime hosts it, following the core's synced sessions,
// answering commands with replies and outcomes, publishing each controller's state, and turning device failures into
// outcomes and an unavailable device (policy A). Each test runs on a manual clock against a simulated Lines controller.
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import type {CommandDraft, RequestResult} from '@jimmie-potts/sdk';
import {checkModuleRecord} from '@jimmie-potts/sdk/testing';
import {connectState} from '../src/database.js';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {LINES_ADDRESS, NANOLEAF_FAMILIES, PANELS_ADDRESS, SessionFeed, sharedConfig, SIMULATED_TRIANGLES} from '../src/index.js';
import {PRESETS} from '../src/effects.js';
import {identityKey} from '../src/shared-input.js';
import {deviceCommand, ModuleWorld, moduleCommand, NANOLEAF_OWNER, publishedSchema, QUALIFIED, READ_FAMILIES, SECTION, UNQUALIFIED, type WallState} from './module-support.js';
import {query, suite, temporary, test} from './support.js';

suite('the Nanoleaf module follows the core\'s sessions', () => {
  test('a working session takes a Line, shown on the wall and on the device', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => world.wall()?.tasks.some(task => task.status === 'working' && task.element !== null) === true, 5000, 'the task on a Line');
    await world.until(() => world.writes().some(write => write.endpoint === '/effects' && write.animType === 'custom'), 5000, 'an indicator write');
    const record = world.device_();
    assert.equal(record?.availability, 'available');
    world.verify();
  });

  test('a sync after an overflow is a fresh start: turns missed in the gap replay no comet or wave', async context => {
    // The module's sync subscription keeps at most 8 messages; a burst beyond that drops some, and the SDK syncs again
    // without a failure, so only the completed sync tells the module that the copy starts fresh.
    const world = await ModuleWorld.open(context, {maxQueued: 8});
    await world.core.set('alpha');
    await world.start();
    await world.until(() => shown(world, 'working'), 5000, 'alpha on a Line');
    await world.advance(3000);
    const before = world.writes().length;
    await world.core.burst(Array.from({length: 10}, (_, index) => `gamma-${String(index)}`), 'alpha');
    await world.until(() => world.query("SELECT 1 FROM activity WHERE status='unread'").length === 1, 5000, 'the resync took alpha\'s finished turn');
    await world.advance(5000);
    assert.ok(world.syncRestarts.includes('bunny/modules/nanoleaf'), 'the overflow restarted the module\'s copy, with no failure');
    assert.equal(world.logs().filter(record => record.event === 'operation.failed' && record.fields['bunny.operation'] === 'feed').length, 0);
    assert.deepEqual(world.query('SELECT 1 FROM comets'), [], 'no comet for the turn that ended in the gap');
    assert.deepEqual(world.writes().slice(before).filter(write => write.endpoint === '/effects' && write.loop === false), [],
      'no wave for the sessions that started in the gap, and no comet');
    world.verifyMessages();
  });
});

suite('the device record', () => {
  test('carries the power the device reported', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => world.device_()?.observed.status === 'known', 10_000, 'an observation');
    const record = world.device_();
    assert.ok(record?.observed.status === 'known');
    assert.deepEqual(record.observed.power, {status: 'known', value: true});
    world.device.setPower(LINES_ADDRESS, false);
    await world.until(() => {
      const observed = world.device_()?.observed;
      return observed?.status === 'known' && observed.power.status === 'known' && !observed.power.value;
    }, 10_000, 'the power the device reports');
    // A device's own report is an observation; a desired value and a transport acknowledgment are not.
    assert.deepEqual(world.device_()?.desired.power, {status: 'unknown'});
    world.verify();
  });

  test('a moment is refused with unsupported-capability', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const {key, draft} = deviceCommand('moment-play', {momentId: 'm1', mood: 'calm', durationMs: 1000, priorityClass: 'event', coversStatus: false,
      startAtMs: world.clock.now(), toleranceMs: 100});
    const result = await world.request(key, {...draft, type: 'org.bunny.moment.play.requested', dataschema: 'https://bunny.invalid/events/moment-play/2.0'});
    assert.equal(result.status, 'rejected');
    assert.equal(result.status === 'rejected' && result.error.error.code, 'unsupported-capability');
    world.verify();
  });
});

const mode = (world: ModuleWorld, value: string, requestId: string): Promise<RequestResult> => {
  const {key, draft} = deviceCommand('device-mode-set', {requestId, mode: value});
  return world.request(key, draft);
};
const outcomeOf = async (world: ModuleWorld, requestId: string): Promise<{result: string; evidence: string; error?: {code: string}}> => {
  await world.until(() => world.outcomes(requestId).length > 0, 10_000, `the outcome of ${requestId}`);
  const [outcome, ...more] = world.outcomes(requestId);
  assert.equal(more.length, 0, `one outcome for ${requestId}`);
  assert.ok(outcome !== undefined);
  return outcome.data;
};
const animation = (requestId: string, value: object): {key: string; draft: CommandDraft<object>} =>
  moduleCommand(NANOLEAF_FAMILIES.animationPlay.family, NANOLEAF_FAMILIES.animationPlay.type, {requestId, animation: value});

suite('Work, Quiet and Free', () => {
  test('each mode command is answered, applied to the device and completed through the outbox', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => world.writes().some(write => write.animType === 'custom'), 5000, 'the task shown');

    assert.equal((await mode(world, 'quiet', 'mode-quiet')).status, 'accepted');
    // A mode is the module's own state: the command completes as it commits, and the wall follows.
    assert.deepEqual(await outcomeOf(world, 'mode-quiet'), {requestId: 'mode-quiet', result: 'succeeded', evidence: 'observed'});
    // Quiet shows the agent status steadily, at the Quiet level.
    await world.until(() => world.writes().some(write => write.endpoint === '/state' && write.brightness === 10), 5000, 'the Quiet level');
    assert.deepEqual(world.device_()?.desired.mode, {status: 'known', value: 'quiet'});

    const before = world.writes().length;
    assert.equal((await mode(world, 'free', 'mode-free')).status, 'accepted');
    assert.equal((await outcomeOf(world, 'mode-free')).evidence, 'observed');
    // Free hands the wall back: the remembered scene plays again, and no indicator is drawn.
    await world.until(() => world.device.state().devices[LINES_ADDRESS]?.select === 'Beach Waves', 5000, 'the scene restored');
    const freeWrites = world.writes().slice(before);
    await world.advance(5000);
    assert.deepEqual(world.writes().slice(before + freeWrites.length).filter(write => write.endpoint === '/effects'), [], 'no writes in Free');

    assert.equal((await mode(world, 'work', 'mode-work')).status, 'accepted');
    assert.equal((await outcomeOf(world, 'mode-work')).evidence, 'observed');
    await world.until(() => world.writes().at(-1)?.endpoint === '/state' && world.device.state().devices[LINES_ADDRESS]?.effect === 'custom', 5000,
      'the indicators again');
    assert.deepEqual(world.device_()?.desired.mode, {status: 'known', value: 'work'});
    world.verify();
  });

  test('a mode the device does not advertise is refused before anything changes', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const result = await mode(world, 'monitor', 'mode-monitor');
    assert.equal(result.status === 'rejected' && result.error.error.code, 'unsupported-capability');
    assert.deepEqual(world.device_()?.desired.mode, {status: 'known', value: 'work'});
    assert.deepEqual(world.outcomes('mode-monitor'), []);
    world.verify();
  });
});

suite('animations and favorites', () => {
  test('play is refused outside Free, since Work and Quiet present agent status', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => world.query('SELECT 1 FROM control_scenes').length > 0, 5000, 'the layout and scenes read');
    for (const value of ['work', 'quiet'] as const) {
      if (value === 'quiet') await outcomeOf(world, (await mode(world, 'quiet', 'to-quiet'), 'to-quiet'));
      const {key, draft} = animation(`play-${value}`, {preset: 'ocean'});
      const result = await world.request(key, draft);
      assert.equal(result.status === 'rejected' && result.error.error.code, 'unsupported-capability', value);
      assert.deepEqual(world.outcomes(`play-${value}`), [], 'a refusal has no outcome');
    }
    await outcomeOf(world, (await mode(world, 'free', 'to-free'), 'to-free'));
    const {key, draft} = animation('play-free', {preset: 'ocean'});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'play-free'), {requestId: 'play-free', result: 'succeeded', evidence: 'transmitted'});
    world.verify();
  });

  test('each served family syncs alone from the module, and the module runs on', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => world.device_()?.availability === 'available', 5000, 'the wall available');
    const reader = world.bus.connect('bunny/parts/reader');
    for (const family of READ_FAMILIES) {
      const synced = reader.sync([family], () => {}, {timeoutMs: 5000, owner: NANOLEAF_OWNER});
      let result: Awaited<typeof synced> | undefined;
      void synced.then(value => { result = value; });
      await world.until(() => result !== undefined, 5000, `the sync of ${family}`);
      assert.equal(result?.status, 'synced', family);
      if (result?.status === 'synced') {
        assert.deepEqual([...new Set(result.copy.states().map(state => state.dataschema))], [publishedSchema(family)], family);
        await result.copy.close();
      }
    }
    await reader.close();
    // The runtime fails a module whose sync handler throws or answers outside the request; the bus reports it here.
    assert.deepEqual(world.errors, [], 'no handler of the module failed');
    const {key, draft} = deviceCommand('device-mode-set', {requestId: 'after-syncs', mode: 'quiet'});
    assert.equal((await world.request(key, draft)).status, 'accepted', 'the module still answers');
    world.verify();
  });

  test('favorites and preset names stay out of the read state, and a sync writes nothing', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const save = moduleCommand(NANOLEAF_FAMILIES.favoriteEdit.family, NANOLEAF_FAMILIES.favoriteEdit.type,
      {requestId: 'save-1', edit: {kind: 'save', name: 'PRIVATE_FAVORITE_NAME', animation: {preset: 'campfire'}}});
    assert.equal((await world.request(save.key, save.draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'save-1')).result, 'succeeded');
    await world.until(() => (world.state<{favorites: {name: string}[]}>('nanoleaf-animations', 'wall')?.favorites.length ?? 0) === 1, 1000,
      'the favorite in the animation options');
    const options = world.state<{presets: {id: string}[]}>('nanoleaf-animations', 'wall');
    assert.deepEqual(options?.presets.map(preset => preset.id), Object.keys(PRESETS), 'the module advertises its own presets');
    const read = JSON.stringify([world.device_(), world.wall()]);
    for (const name of ['PRIVATE_FAVORITE_NAME', ...Object.keys(PRESETS)]) assert.equal(read.includes(name), false, `the read state holds no ${name}`);

    const dump = (): string => JSON.stringify(world.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(([table]) =>
      [table, world.query(`SELECT * FROM "${String(table)}"`)]));
    await world.advance(100);
    world.device.hold();
    const before = dump();
    const reader = world.bus.connect('bunny/parts/reader');
    const synced = reader.sync(READ_FAMILIES, () => {}, {timeoutMs: 5000, owner: NANOLEAF_OWNER});
    let result: Awaited<typeof synced> | undefined;
    void synced.then(value => { result = value; });
    await world.until(() => result !== undefined, 5000, 'the sync');
    assert.equal(result?.status, 'synced');
    assert.equal(dump(), before, 'serving a sync changed no row');
    if (result?.status === 'synced') {
      const states = result.copy.states();
      assert.deepEqual(states.map(state => state.dataschema.split('/').at(-2)).sort(), ['device', 'nanoleaf-animations', 'nanoleaf-wall']);
      await result.copy.close();
    }
    world.device.release();
    await reader.close();
    world.verify();
  });
});

const shown = (world: ModuleWorld, status: string): boolean => world.wall()?.tasks.some(task => task.status === status && task.element !== null) === true;
const power = (requestId: string, on: boolean): {key: string; draft: CommandDraft<object>} => deviceCommand('power-set', {requestId, on});

suite('comets and waves', () => {
  test('a new task radiates once, then pulses on its Line; its finished turn plays one comet', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => world.wall()?.source === 'shared' && world.query('SELECT 1 FROM control_scenes').length > 0, 5000,
      'shared input selected and the device read');
    const before = world.writes().length;
    await world.core.set('alpha');
    await world.until(() => shown(world, 'working'), 5000, 'the task on a Line');
    await world.advance(3000);
    const effects = world.writes().slice(before).filter(write => write.endpoint === '/effects');
    // The outward wave is a pulse that does not loop; the task's own pulse loops once it has crossed the wall.
    const wave = effects.findIndex(write => write.animType === 'custom' && write.loop === false);
    assert.ok(wave >= 0, 'an outward wave');
    assert.ok(effects.slice(wave).some(write => write.loop === true), 'then a local loop');

    const finished = world.writes().length;
    await world.core.finish('alpha');
    await world.until(() => world.query('SELECT 1 FROM comets WHERE started IS NOT NULL').length > 0, 5000, 'the comet started');
    await world.until(() => world.query('SELECT 1 FROM comets').length === 0, 5000, 'the comet ended');
    await world.advance(2000);
    const after = world.writes().slice(finished).filter(write => write.endpoint === '/effects');
    assert.ok(after.some(write => write.loop === false), 'the comet');
    assert.equal(after.at(-1)?.loop, true, 'then the unread task pulses again');
    assert.ok(shown(world, 'unread'));
    world.verify();
  });
});

suite('restarts, holds and offline devices', () => {
  test('a restart replays nothing: no comet, no wave and no command', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => shown(world, 'working'), 5000, 'the task on a Line');
    await world.advance(3000);
    // The device stops answering, so the finished turn's comet and an accepted command wait.
    world.device.offline();
    await world.core.finish('alpha');
    await world.advance(100);
    const {key, draft} = power('power-off', false);
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.ok(world.query('SELECT 1 FROM comets').length > 0, 'a comet waits');
    // The core is not there to sync from at the restart either, so the module starts from its own rows alone.
    await world.core.close();
    await world.restart();
    world.device.online();
    const restarted = world.clock.now();
    await world.until(() => world.writes().some(write => write.atMs >= restarted && write.endpoint === '/effects'), 10_000, 'the task shown again');
    await world.advance(5000);
    assert.deepEqual(await outcomeOf(world, 'power-off'), {requestId: 'power-off', result: 'failed', evidence: 'none',
      error: {code: 'cancelled', retryable: false, requestId: 'power-off'}}, 'the queued command ended at the restart and never ran');
    const after = world.writes().filter(write => write.atMs >= restarted);
    assert.ok(after.length > 0, 'the device shows the task after the restart');
    assert.deepEqual(after.filter(write => write.on === false), [], 'the command was never sent');
    assert.deepEqual(after.filter(write => write.endpoint === '/effects' && write.loop === false), [], 'no comet or wave replayed');
    assert.deepEqual(world.logs().filter(record => record.event === 'operation.failed').map(record => record.fields),
      [{'bunny.operation': 'feed', 'bunny.code': 'unavailable'}], 'the missing sync is logged once');
    world.verify();
  });

  test('a restart ends an acknowledgment whose request may have reached the core uncertain, and cancels queued machine edits', async context => {
    const world = await cometRunning(context);
    // Alpha's finished turn, whose comet runs now, is shown unread.
    const record = [...world.core.sessions.values()][0];
    assert.ok(record !== undefined);
    world.core.holdAcknowledgments = true;
    const ack = moduleCommand(NANOLEAF_FAMILIES.acknowledge.family, NANOLEAF_FAMILIES.acknowledge.type,
      {requestId: 'ack-held', task: identityKey(record.identity), noticeId: record.notices[0]?.id ?? ''});
    assert.equal((await world.request(ack.key, ack.draft)).status, 'accepted');
    await world.until(() => world.core.acknowledgments.length === 1, 1000, 'the core took the request');
    const machine = machineEdit('machine-waiting', revision(world), {kind: 'settings', settings: {coverage: 'status'}});
    assert.equal((await world.request(machine.key, machine.draft)).status, 'accepted');
    assert.ok(cometRuns(world), 'the machine edit waits for the comet');
    await world.restart();
    assert.deepEqual(await outcomeOf(world, 'ack-held'), {requestId: 'ack-held', result: 'uncertain', evidence: 'none',
      error: {code: 'uncertain-result', retryable: false, requestId: 'ack-held'}}, 'the core may have recorded it');
    assert.deepEqual(await outcomeOf(world, 'machine-waiting'), {requestId: 'machine-waiting', result: 'failed', evidence: 'none',
      error: {code: 'cancelled', retryable: false, requestId: 'machine-waiting'}}, 'a queued edit never ran');
    world.core.releaseAcknowledgments();
    await world.advance(3000);
    assert.equal(coverage(world), 'whole', 'the cancelled edit never applies');
    assert.equal(world.outcomes('ack-held').length, 1);
    world.verify();
  });

  test('an uncertain write is held, never retried, until an explicit choice', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => shown(world, 'working'), 5000, 'the task on a Line');
    await world.advance(3000);
    world.device.loseNextAnswer('/state');
    const {key, draft} = deviceCommand('brightness-set', {requestId: 'brightness-uncertain', percent: 20});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'brightness-uncertain'), {requestId: 'brightness-uncertain', result: 'uncertain', evidence: 'none',
      error: {code: 'uncertain-result', retryable: false, requestId: 'brightness-uncertain'}});
    const held = world.writes().length;
    // A new task would be drawn at once on a device that is not held.
    await world.core.set('beta');
    await world.advance(10_000);
    assert.deepEqual(world.writes().slice(held), [], 'the device is held: nothing is written, the uncertain write included');
    assert.equal(world.writes().filter(write => write.brightness === 20 && write.on === undefined).length, 1, 'the write went out once');
    // A fresh choice releases the hold.
    assert.equal((await mode(world, 'work', 'explicit-work')).status, 'accepted');
    await outcomeOf(world, 'explicit-work');
    await world.until(() => world.writes().length > held, 5000, 'writes after the explicit choice');
    world.verify();
  });

  test('an offline wall at start: the module runs, the device is unavailable, and the outage logs once each way', async context => {
    const world = await ModuleWorld.open(context, {online: false});
    await world.core.set('alpha');
    const started = performance.now();
    await world.harness.start();
    assert.ok(performance.now() - started < 1000, 'start reaches no device');
    await world.until(() => world.device_()?.availability === 'unavailable', 5000, 'the device unavailable');
    // Commands are still answered while the device is away: a palette edit needs no device.
    const {key, draft} = moduleCommand(NANOLEAF_FAMILIES.wallEdit.family, NANOLEAF_FAMILIES.wallEdit.type,
      {requestId: 'offline-palette', edit: {kind: 'settings', settings: {palette: {working: '#00e5ff'}}}});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'offline-palette')).result, 'succeeded');
    await world.advance(120_000);
    const warnings = world.logs().filter(record => record.event === 'device.unavailable' && record.level === 'warn');
    assert.equal(warnings.length, 1, 'one degradation, not a warning per poll');
    world.device.online();
    await world.until(() => world.device_()?.availability === 'available', 40_000, 'the device available again');
    await world.until(() => shown(world, 'working'), 10_000, 'the task shown once the device answers');
    const recoveries = world.logs().filter(record => record.event === 'device.available');
    assert.equal(recoveries.length, 1, 'one recovery');
    assert.equal(recoveries[0]?.level, 'info');
    for (const record of world.logs()) assert.equal(checkModuleRecord('nanoleaf', record), undefined, record.event);
    world.verify();
  });
});

suite('notice acknowledgment', () => {
  test('the wall acknowledges a finished turn it shows, for the Nanoleaf consumer', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    const record = await world.core.finish('alpha');
    await world.until(() => shown(world, 'unread'), 5000, 'the finished turn shown');
    const notice = record.notices[0]?.id ?? '';
    const {key, draft} = moduleCommand(NANOLEAF_FAMILIES.acknowledge.family, NANOLEAF_FAMILIES.acknowledge.type,
      {requestId: 'ack-1', task: identityKey(record.identity), noticeId: notice});
    assert.equal((await world.request(key, draft)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'ack-1'), {requestId: 'ack-1', result: 'succeeded', evidence: 'transmitted'});
    assert.deepEqual(world.core.acknowledgments.map(message => [message.subject, message.data]), [[record.id, {consumerId: 'nanoleaf', noticeId: notice,
      requestId: (world.core.acknowledgments[0]?.data as {requestId?: string}).requestId}]]);
    world.verify();
  });

  test('an acknowledgment for a skipped session is refused without sending a request', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    const record = await world.core.finish('beta', 't1', {...UNQUALIFIED, sessionId: 'beta'});
    await world.advance(2000);
    const {key, draft} = moduleCommand(NANOLEAF_FAMILIES.acknowledge.family, NANOLEAF_FAMILIES.acknowledge.type,
      {requestId: 'ack-skipped', task: identityKey(record.identity), noticeId: record.notices[0]?.id ?? ''});
    const result = await world.request(key, draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'not-found');
    await world.advance(1000);
    assert.deepEqual(world.core.acknowledgments, [], 'the core got no request');
    world.verify();
  });
});

const machineEdit = (requestId: string, expected: number, edit: object): {key: string; draft: CommandDraft<object>} =>
  moduleCommand(NANOLEAF_FAMILIES.machineEdit.family, NANOLEAF_FAMILIES.machineEdit.type, {requestId, expectedConfigurationRevision: expected, edit});
const wallEdit = (requestId: string, edit: object): {key: string; draft: CommandDraft<object>} =>
  moduleCommand(NANOLEAF_FAMILIES.wallEdit.family, NANOLEAF_FAMILIES.wallEdit.type, {requestId, edit});
const revision = (world: ModuleWorld): number => Number(world.query("SELECT configuration_revision FROM nanoleaf_devices WHERE device='wall'")[0]?.[0]);
const cometRuns = (world: ModuleWorld): boolean => world.query('SELECT 1 FROM comets WHERE started IS NOT NULL').length > 0;
const coverage = (world: ModuleWorld): unknown => world.query("SELECT coverage FROM map_settings WHERE device='wall'")[0]?.[0];

/** A task on a Line whose finished turn's comet is running now, on the Lines in Work. */
async function cometRunning(context: TestContext): Promise<ModuleWorld> {
  const world = await ModuleWorld.open(context);
  await world.core.set('alpha');
  await world.start();
  await world.until(() => shown(world, 'working'), 5000, 'the task on a Line');
  await world.advance(3000);
  await world.core.finish('alpha');
  await world.until(() => cometRuns(world), 5000, 'the comet running');
  return world;
}

// Wall-editor ownership (ADR 0007; #26 slice 3b hand-off): machine edits keep the wall editor's choices, through the
// device's configuration revision. Each rule's test fails without its check (PORTING.md lists the negative controls).
suite('wall-editor ownership', () => {
  test('rule 1: a machine edit is refused while a wall edit is pending on the device', async context => {
    const world = await cometRunning(context);
    // A style change would move the running comet, so it waits as the pending wall edit.
    const wall = wallEdit('wall-style', {kind: 'settings', settings: {style: 'project'}});
    assert.equal((await world.request(wall.key, wall.draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'wall-style')).result, 'succeeded');
    await world.until(() => world.wall()?.pendingEdit === true, 100, 'the wall edit pending');
    const machine = machineEdit('machine-coverage', revision(world), {kind: 'settings', settings: {coverage: 'status'}});
    const result = await world.request(machine.key, machine.draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'revision-conflict');
    assert.match(result.status === 'rejected' ? result.error.error.detail ?? '' : '', /wall edit is pending/);
    assert.deepEqual(world.query('SELECT 1 FROM nanoleaf_machine_edits'), [], 'nothing waits');
    await world.until(() => !cometRuns(world) && world.wall()?.pendingEdit === false, 5000, 'the wall edit applied after the comet');
    assert.equal(world.wall()?.settings.style, 'project');
    assert.equal(coverage(world), 'whole', 'the machine edit never applied');
    world.verify();
  });

  test('rule 2: a queued machine edit fails when a later wall, mode or association edit lands first', async context => {
    const later: [string, (world: ModuleWorld) => {key: string; draft: CommandDraft<object>}][] = [
      ['a wall edit', () => wallEdit('wall-rotation', {kind: 'settings', settings: {rotation: 90}})],
      ['a mode command', () => deviceCommand('device-mode-set', {requestId: 'mode-quiet', mode: 'quiet'})],
      ['an association edit', world => wallEdit('wall-task', {kind: 'task-project', task: world.wall()?.tasks[0]?.id ?? '', project: null})],
    ];
    for (const [name, landing] of later) {
      const world = await cometRunning(context);
      const machine = machineEdit('machine-coverage', revision(world), {kind: 'settings', settings: {coverage: 'status'}});
      assert.equal((await world.request(machine.key, machine.draft)).status, 'accepted', name);
      const {key, draft} = landing(world);
      assert.equal((await world.request(key, draft)).status, 'accepted', name);
      assert.deepEqual(await outcomeOf(world, 'machine-coverage'), {requestId: 'machine-coverage', result: 'failed', evidence: 'none',
        error: {code: 'revision-conflict', retryable: false, requestId: 'machine-coverage'}}, name);
      assert.equal(coverage(world), 'whole', `${name}: the newer choice is never overwritten`);
      world.verify();
    }
  });

  test('rule 3: a machine edit waits for the comet to end, then applies', async context => {
    const world = await cometRunning(context);
    const before = revision(world);
    const machine = machineEdit('machine-coverage', before, {kind: 'settings', settings: {coverage: 'status'}});
    assert.equal((await world.request(machine.key, machine.draft)).status, 'accepted');
    await world.advance(200);
    assert.ok(cometRuns(world), 'the comet still runs');
    assert.deepEqual(world.outcomes('machine-coverage'), [], 'the edit waits while the comet runs');
    assert.equal(coverage(world), 'whole');
    assert.deepEqual(await outcomeOf(world, 'machine-coverage'), {requestId: 'machine-coverage', result: 'succeeded', evidence: 'observed'});
    assert.ok(!cometRuns(world), 'it applied once the comet ended');
    assert.equal(coverage(world), 'status');
    assert.ok(revision(world) > before, 'an applied edit moves the revision');
    world.verify();
  });

  test('a machine edit still waiting at its expiry fails expired and never applies', async context => {
    const world = await cometRunning(context);
    const {key, draft} = machineEdit('machine-late', revision(world), {kind: 'settings', settings: {coverage: 'status'}});
    assert.equal((await world.request(key, draft, 500)).status, 'accepted');
    assert.deepEqual(await outcomeOf(world, 'machine-late'), {requestId: 'machine-late', result: 'failed', evidence: 'none',
      error: {code: 'expired', retryable: false, requestId: 'machine-late'}});
    await world.until(() => !cometRuns(world), 5000, 'the comet ended');
    await world.advance(1000);
    assert.equal(coverage(world), 'whole', 'the expired edit never applies');
    world.verify();
  });

  test('a new selection of shared input moves the configuration revision', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => shown(world, 'working') && world.wall()?.layout === 'saved', 5000, 'alpha on a Line');
    const read = revision(world);
    await world.restart({...SECTION, qualifiedSources: [QUALIFIED, UNQUALIFIED]});
    await world.until(() => world.wall()?.source === 'shared', 5000, 'shared input selected again');
    assert.ok(revision(world) > read, 'the selection is a fresh start of the device\'s configuration');
    const machine = machineEdit('machine-before-selection', read, {kind: 'settings', settings: {coverage: 'status'}});
    const result = await world.request(machine.key, machine.draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'revision-conflict');
    world.verify();
  });

  test('a stale configuration revision is refused before anything changes', async context => {
    const world = await ModuleWorld.open(context);
    await world.start();
    await world.until(() => world.wall()?.layout === 'saved', 5000, 'the layout saved');
    const machine = machineEdit('machine-stale', revision(world) + 1, {kind: 'settings', settings: {coverage: 'status'}});
    const result = await world.request(machine.key, machine.draft);
    assert.equal(result.status === 'rejected' && result.error.error.code, 'revision-conflict');
    assert.equal(coverage(world), 'whole');
    world.verify();
  });
});

suite('configuration and the event loop', () => {
  test('a new configuration pauses shared input, and the wiring selects it again as a fresh start', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.core.set('beta', {identity: {...UNQUALIFIED, sessionId: 'beta'}});
    await world.start();
    await world.until(() => shown(world, 'working'), 5000, 'alpha shown');
    assert.equal(world.wall()?.tasks.length, 1, 'beta\'s source is not qualified, so it is skipped');
    const first = world.logs().filter(record => record.event === 'feed.changed').map(record => record.fields['bunny.generation']);
    assert.equal(first.length, 1);
    await world.advance(3000);
    await world.restart({...SECTION, qualifiedSources: [QUALIFIED, UNQUALIFIED]});
    const restarted = world.clock.now();
    await world.until(() => world.wall()?.source === 'shared' && world.wall()?.tasks.length === 2, 5000, 'both sources shown after selection');
    const selections = world.logs().filter(record => record.event === 'feed.changed').map(record => Number(record.fields['bunny.generation']));
    assert.equal(selections.length, 2, 'the new configuration was selected again once');
    assert.ok((selections[1] ?? 0) > Number(first[0]) + 1, 'the configuration paused shared input, and the selection started it again');
    await world.advance(5000);
    assert.deepEqual(world.writes().filter(write => write.atMs >= restarted && write.endpoint === '/effects' && write.loop === false), [],
      'a fresh start replays no wave or comet');
    world.verify();
  });

  test('a mode command and an edit are answered while the worker waits on the device', async context => {
    const world = await ModuleWorld.open(context);
    await world.core.set('alpha');
    await world.start();
    await world.until(() => shown(world, 'working'), 5000, 'the task on a Line');
    world.device.hold();
    await world.until(() => world.device.state().held > 0, 5000, 'a request the device holds');
    const started = world.clock.now();
    const quiet = deviceCommand('device-mode-set', {requestId: 'held-mode', mode: 'quiet'});
    const edit = wallEdit('held-edit', {kind: 'settings', settings: {palette: {working: '#00e5ff'}}});
    assert.equal((await world.request(quiet.key, quiet.draft)).status, 'accepted');
    assert.equal((await world.request(edit.key, edit.draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'held-edit')).result, 'succeeded');
    assert.deepEqual(await outcomeOf(world, 'held-mode'), {requestId: 'held-mode', result: 'succeeded', evidence: 'observed'});
    assert.ok(world.clock.now() - started < 100, 'both were answered and completed at once, without waiting for the device');
    assert.ok(world.device.state().held > 0, 'the device still holds the worker\'s request');
    world.device.release();
    await world.until(() => world.device.state().devices[LINES_ADDRESS]?.brightness === 10, 5000, 'the wall follows Quiet once it answers');
    world.verify();
  });
});

suite('the session feed\'s generation guard', () => {
  test('a projection or failure report carrying the generation from before a new configuration changes nothing', context => {
    const directory = temporary(context);
    const db = connectState(directory);
    context.after(() => db.close());
    const options = {database: () => db, now: () => 1000, targets: ['wall'], metadata: null};
    const old = new SessionFeed(options);
    old.configure(sharedConfig([QUALIFIED]));
    assert.equal(old.project(true), 'selected');
    const stale = old.generation;
    // Another configuration lands, as a new section at a restart does, and selects shared input again.
    const current = new SessionFeed(options);
    assert.equal(current.configure(sharedConfig([QUALIFIED, UNQUALIFIED])), true);
    assert.equal(current.project(true), 'selected');
    const saved = (): unknown => ['shared_input', 'sessions', 'activity', 'comets', 'shared_stale'].map(table => query(directory, `SELECT * FROM ${table}`));
    const before = saved();
    assert.equal(old.generation, stale);
    assert.equal(old.project(false), 'stale-generation', 'a projection of the old generation is refused');
    old.failed();
    assert.deepEqual(saved(), before, 'neither changed a row');
    assert.equal(current.project(false), 'followed');
  });
});

suite('a Lines and an NL22 Light Panels controller', () => {
  test('each device has its own worker, record and map, and only the Lines take animations and machine edits', async context => {
    const world = await ModuleWorld.open(context, {
      section: {...SECTION, devices: [...SECTION.devices, {id: 'nl22', kind: 'panels', address: PANELS_ADDRESS, secret: 'token'}]},
      devices: {[LINES_ADDRESS]: 'lines', [PANELS_ADDRESS]: 'panels'},
    });
    await world.core.set('alpha');
    await world.start();
    await world.until(() => world.state<DeviceRecord>('device', 'nl22')?.availability === 'available' && world.device_()?.availability === 'available',
      5000, 'both devices available');
    await world.until(() => (world.state<WallState>('nanoleaf-wall', 'nl22')?.tasks.some(task => task.element !== null) ?? false) && shown(world, 'working'),
      5000, 'the task on both devices');
    assert.equal(world.state<{elements: unknown[]}>('nanoleaf-wall', 'nl22')?.elements.length, SIMULATED_TRIANGLES);
    const panels = deviceCommand('device-mode-set', {requestId: 'panels-quiet', mode: 'quiet'}, 'nl22');
    assert.equal((await world.request(panels.key, panels.draft)).status, 'accepted');
    assert.equal((await outcomeOf(world, 'panels-quiet')).result, 'succeeded');
    assert.deepEqual(world.state<DeviceRecord>('device', 'nl22')?.desired.mode, {status: 'known', value: 'quiet'});
    assert.deepEqual(world.device_()?.desired.mode, {status: 'known', value: 'work'}, 'the Lines keep their own mode');
    const play = moduleCommand(NANOLEAF_FAMILIES.animationPlay.family, NANOLEAF_FAMILIES.animationPlay.type, {requestId: 'panels-play',
      animation: {preset: 'ocean'}}, 'nl22');
    const played = await world.request(play.key, play.draft);
    assert.equal(played.status === 'rejected' && played.error.error.code, 'unsupported-capability');
    const edit = moduleCommand(NANOLEAF_FAMILIES.machineEdit.family, NANOLEAF_FAMILIES.machineEdit.type, {requestId: 'panels-edit',
      expectedConfigurationRevision: 0, edit: {kind: 'settings', settings: {style: 'project'}}}, 'nl22');
    const edited = await world.request(edit.key, edit.draft);
    assert.equal(edited.status === 'rejected' && edited.error.error.code, 'unsupported-capability');
    world.verify();
  });
});
