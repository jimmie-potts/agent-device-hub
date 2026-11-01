import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule, ModuleContext} from '@jimmie-potts/sdk';
import {createCoreModule} from '../src/core/core.js';
import {AutomationError} from '../src/core/automation.js';
import {deviceRecord, deviceState} from './fixtures/device.js';
import {edgeConfig, flush, it, manualClock, run} from './support.js';

for (const refused of [false, true]) it(`automation follows several device owners beside a playback-only owner; refusal=${refused}`, async context => {
  const clock = manualClock(1700000000000), core = createCoreModule();
  let refusing = refused;
  const owners = ['test-light', 'test-plug'].map(name => {
    const record = deviceRecord(`${name}-1`, 1, name, 'available');
    record.capabilities.power = {supported: true};
    let sdk: ModuleContext['sdk'] | undefined, syncs = 0;
    const module: BunnyModule = {
      manifest: {name, apiVersion: '1.2', configure: section => ({config: section, devices: [record.id]})},
      start: async given => {
        sdk = given.sdk;
        await sdk.serveSync(['device'], () => {
          syncs++;
          return name === 'test-plug' && refusing
            ? errorBody('unavailable', {detail: 'synthetic owner refusal'})
            : {revision: record.revision, states: [deviceState(record)]};
        });
      },
      stop: () => {},
    };
    return {module, record, syncs: () => syncs, remove: async () => {
      assert.ok(sdk);
      record.revision++;
      await sdk.publish(`bunny.state.device.${record.id}`, {kind: 'removal', type: 'org.bunny.device.removed',
        subject: record.id, dataschema: 'https://bunny.invalid/events/removal/2.0',
        data: {entity: {family: 'device', id: record.id}, revision: record.revision, reason: 'retired'}});
    }};
  });
  const playback: BunnyModule = {
    manifest: {name: 'test-playback', apiVersion: '1.2', configure: section => ({config: section, devices: ['speaker']})},
    start: async given => {await given.sdk.serveSync(['playback'], () => ({revision: 0, states: []}));},
    stop: () => {},
  };
  const files = await edgeConfig(context, [], {modules: {'test-light': {}, 'test-plug': {}, 'test-playback': {}}});
  const {runtime, logs} = await run(context, {modules: [core, ...owners.map(owner => owner.module), playback],
    configFile: files.config, clock: {now: clock.now}, scheduler: clock.scheduler});
  await flush();
  assert.ok(runtime.health().modules.every(module => module.state === 'running'));
  assert.deepEqual(owners.map(owner => owner.syncs()), [1, 1], 'each device owner supplies its own initial snapshot');
  const refusals = () => logs.filter(record => record.event_name === 'runtime.sync.refused' &&
    record.attributes['bunny.participant'] === 'bunny/core' && record.attributes['bunny.pattern'] === 'sync device');
  assert.equal(refusals().length, refused ? 1 : 0, 'only a real device owner refusal is recorded');
  if (refused) {
    assert.equal(refusals()[0]?.attributes['bunny.code'], 'unavailable');
    refusing = false;
    clock.advance(1000); await flush();
    assert.deepEqual(owners.map(owner => owner.syncs()), [1, 2], 'only the refused device owner retries');
  }
  const routines = core.automation.routines; assert.ok(routines);
  for (const owner of owners) {
    const routine = routines.create({name: owner.record.id, days: [1], time: '17:00',
      actions: [{target: owner.record.id, family: 'power-set', data: {on: true}}]});
    assert.equal(routine.enabled, false, 'the copied device is eligible without dispatching a command');
    await owner.remove();
  }
  await flush();
  for (const owner of owners) assert.throws(() => routines.create({name: 'Removed device', days: [1], time: '17:00',
    actions: [{target: owner.record.id, family: 'power-set', data: {on: true}}]}),
  (error: unknown) => error instanceof AutomationError && error.code === 'unknown-target', 'the live removal reaches its own copy');
  assert.throws(() => routines.create({name: 'Playback is separate', days: [1], time: '17:00',
    actions: [{target: 'speaker', family: 'power-set', data: {on: true}}]}),
  (error: unknown) => error instanceof AutomationError && error.code === 'unknown-target');
  clock.advance(60000); await flush();
  assert.equal(refusals().length, refused ? 1 : 0, 'there is no steady refusal from the playback-only owner');
  assert.deepEqual(owners.map(owner => owner.syncs()), [1, refused ? 2 : 1], 'healthy copies follow live updates without polling');
});
