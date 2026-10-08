// Real core store, dispatcher, native responders and operation projection, on one owned port-0 runtime at a time.
import assert from 'node:assert/strict';
import type {Mode, ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import type {Action} from '../src/core/tracker.js';
import {modeChildRequestId} from '../src/core/mode-participants.js';
import {ModeDevice} from './fixtures/mode-devices.js';
import {contextOf, edgeConfig, fixture, it, run, waitFor, manualClock, stateDir} from './support.js';

const action = (mode: Mode, requestId: string, expectedRevision?: number): Action => ({key: 'bunny.cmd.mode-set.hub', requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode, ...(expectedRevision === undefined ? {} : {expectedRevision})}}});

it('real mode admission saves once, maps independent outcomes and never replays on sync or restart', async context => {
  let failSave = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {
    if (failSave && operation.family === 'mode-set' && outcome !== undefined) throw new Error('synthetic save refused');
  }}]});
  const nano = new ModeDevice('nanoleaf', 'wall'); nano.result = 'failed';
  const pixoo = new ModeDevice('pixoo', 'pixoo-1');
  const watcher = fixture('watcher');
  const files = await edgeConfig(context, [], {modules: {nanoleaf: {}, pixoo: {}}});
  const dir = await stateDir(context);
  const {runtime} = await run(context, {modules: [core, nano.module(), pixoo.module(), watcher], configFile: files.config, stateDir: dir});
  const states = async (): Promise<ModeState[]> => {
    const result = await contextOf(watcher).sdk.sync<ModeState>(['mode'], () => {}, {timeoutMs: 2000});
    assert.equal(result.status, 'synced'); if (result.status !== 'synced') return [];
    const records = result.copy.states().map(message => message.data); await result.copy.close(); return records;
  };
  const initial = (await states())[0]; assert.equal(initial?.mode, 'free'); assert.equal(nano.commands.length + pixoo.commands.length, 0);
  const raw = await contextOf(watcher).sdk.request('bunny.cmd.mode-set.hub', action('quiet', 'raw').draft, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
  assert.deepEqual(await core.actions.dispatch(action('work', 'req-work', initial?.revision)), {status: 'accepted', requestId: 'req-work'});
  const nanoId = await modeChildRequestId('req-work', 'wall'), pixooId = await modeChildRequestId('req-work', 'pixoo-1');
  const records = async () => {
    const result = await contextOf(watcher).sdk.sync<{id: string; requestId: string; result?: string}>(['operation'], () => {}, {timeoutMs: 2000});
    assert.equal(result.status, 'synced'); if (result.status !== 'synced') return [];
    const records = result.copy.states().map(message => message.data); await result.copy.close(); return records;
  };
  await waitFor(async () => (await records()).filter(record => [nanoId, pixooId].includes(record.requestId)).every(record => record.result !== undefined) && nano.commands.length === 1 && pixoo.commands.length === 1, 5000, 'both independent outcomes');
  const outcomes = await records();
  assert.equal(outcomes.find(record => record.requestId === nanoId)?.result, 'failed');
  assert.equal(outcomes.find(record => record.requestId === pixooId)?.result, 'succeeded');
  assert.deepEqual([nano.commands[0]?.data.mode, pixoo.commands[0]?.data.mode], ['work', 'monitor']);
  assert.equal((await states())[0]?.mode, 'work');
  await core.actions.dispatch(action('work', 'req-work', initial?.revision)); await states();
  assert.equal(nano.commands.length + pixoo.commands.length, 2, 'duplicate and refresh send nothing');
  await nano.observe(); await states(); assert.equal((await states())[0]?.mode, 'work'); assert.equal(nano.commands.length + pixoo.commands.length, 2);
  failSave = true;
  const refused = await core.actions.dispatch(action('quiet', 'req-unsaved'));
  assert.ok('error' in refused); assert.equal((await states())[0]?.mode, 'work'); assert.equal(nano.commands.length + pixoo.commands.length, 2);
  failSave = false;
  await core.actions.dispatch(action('work', 'req-reapply')); await waitFor(() => nano.commands.length + pixoo.commands.length === 4, 5000, 'explicit reapplication');
  await runtime.stop();
  const restartedCore = createCoreModule(); const reader = fixture('reader');
  const restarted = await run(context, {modules: [restartedCore, nano.module(), pixoo.module(), reader], configFile: files.config, stateDir: dir});
  const restored = await contextOf(reader).sdk.sync<ModeState>(['mode'], () => {}, {timeoutMs: 2000});
  assert.equal(restored.status, 'synced');
  if (restored.status === 'synced') {assert.equal(restored.copy.states()[0]?.data.mode, 'work'); await restored.copy.close();}
  assert.equal(nano.commands.length + pixoo.commands.length, 4, 'restart preserves the selection without sending');
  await restarted.runtime.stop();
});

it('qualified failed modules remain targets; refused modules are excluded and pending actions turn uncertain without resend', async context => {
  const nano = new ModeDevice('nanoleaf', 'wall'); nano.failStart = true;
  const pixoo = new ModeDevice('pixoo', 'pixoo-1'); pixoo.result = 'none';
  let coreHandle: import('../src/core/core.js').CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const clock = manualClock(Date.now());
  const files = await edgeConfig(context, [], {modules: {nanoleaf: {}, pixoo: {}}});
  const dir = await stateDir(context);
  const first = await run(context, {modules: [core, nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  await core.actions.dispatch(action('quiet', 'req-stopped'));
  const nanoId = await modeChildRequestId('req-stopped', 'wall'), pixooId = await modeChildRequestId('req-stopped', 'pixoo-1');
  await waitFor(() => coreHandle?.operation(nanoId)?.status === 'rejected' && coreHandle?.operation(pixooId)?.status === 'accepted', 5000, 'failed target and pending target');
  assert.equal(coreHandle?.operation(nanoId)?.error?.code, 'unavailable');
  await first.runtime.stop(); clock.advance(120_000);
  const restored = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const second = await run(context, {modules: [restored, nano.module(), pixoo.module()], configFile: files.config, stateDir: dir, clock: {now: clock.now}, scheduler: clock.scheduler});
  clock.advance(0);
  await waitFor(() => coreHandle?.operation(pixooId)?.status === 'uncertain', 5000, 'restart deadline uncertainty');
  assert.equal(pixoo.commands.length, 1);
  await second.runtime.stop();
  nano.failStart = false; nano.refuse = true; const thirdCore = createCoreModule({parts: [{start: handle => {coreHandle = handle; return Promise.resolve();}}]});
  const third = await run(context, {modules: [thirdCore, nano.module(), pixoo.module()], configFile: files.config, clock: {now: clock.now}, scheduler: clock.scheduler});
  await thirdCore.actions.dispatch(action('free', 'req-refused'));
  assert.equal(coreHandle?.operation(await modeChildRequestId('req-refused', 'wall')), undefined, 'refused module is not a target');
  await waitFor(() => pixoo.commands.length === 2, 5000, 'the admitted target'); await third.runtime.stop();
});
