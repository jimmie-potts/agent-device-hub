import assert from 'node:assert/strict';
import type {LightingLayout, LightingLayoutRecord, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import type {Action} from '../src/core/tracker.js';
import {contextOf, edgeConfig, fixture, it, run, stateDir, waitFor} from './support.js';

const composition = (): LightingLayout => ({rooms: [{id: 'studio', name: 'Studio'}], assignments: [{device: 'lamp-a', room: 'studio'}],
  groups: [{id: 'pair', name: 'Pair', scope: 'home', devices: ['lamp-a', 'lamp-b']}], home: [{kind: 'room', id: 'studio'}, {kind: 'group', id: 'pair'}]});
const action = (requestId: string, expectedRevision: number, layout = composition()): Action => ({key: 'bunny.cmd.lighting-layout-set.lighting', requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.lighting-layout.set.requested', subject: 'lighting', dataschema: 'https://bunny.invalid/events/lighting-layout-set/2.0', data: {expectedRevision, layout}}});

it('lighting composition is core-owned, guarded, atomic and durable without dispatching any device effect', async context => {
  let refuseCompletion = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {
    if (refuseCompletion && operation.family === 'lighting-layout-set' && outcome !== undefined) throw new Error('synthetic-layout-commit-refusal');
  }}]}), watcher = fixture('layout-watcher'), dir = await stateDir(context), files = await edgeConfig(context, []);
  const {runtime} = await run(context, {modules: [core, watcher], configFile: files.config, stateDir: dir});
  const read = async (source = watcher): Promise<LightingLayoutRecord> => {
    const result = await contextOf(source).sdk.sync<LightingLayoutRecord>(['lighting-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
    assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('layout-sync-refused');
    const current = result.copy.states()[0]?.data;await result.copy.close();assert.ok(current);return current;
  };
  const initial = await read();assert.deepEqual(initial.layout, {rooms: [], assignments: [], groups: [], home: null});
  const raw = await contextOf(watcher).sdk.request('bunny.cmd.lighting-layout-set.lighting', action('raw-layout', 0).draft, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
  const ordinary = await core.actions.dispatch(action('ordinary-layout', 0));assert.ok('error' in ordinary);assert.equal(ordinary.error.code, 'forbidden');
  assert.deepEqual(await core.operatorActions.dispatch(action('saved-layout', initial.revision)), {status: 'accepted', requestId: 'saved-layout'});
  const saved = await read();assert.deepEqual(saved.layout, composition());assert.ok(saved.revision > initial.revision);
  const conflict = await core.operatorActions.dispatch(action('stale-layout', initial.revision, {...composition(), rooms: [{id: 'studio', name: 'Changed'}]}));
  assert.ok('error' in conflict);assert.equal(conflict.error.code, 'revision-conflict');assert.deepEqual((await read()).layout, composition());
  assert.deepEqual(await core.operatorActions.dispatch(action('saved-layout', initial.revision)), {status: 'accepted', requestId: 'saved-layout'});assert.equal((await read()).revision, saved.revision);
  refuseCompletion = true;
  const unsaved = await core.operatorActions.dispatch(action('unsaved-layout', saved.revision, {...composition(), rooms: [{id: 'studio', name: 'Not committed'}]}));
  assert.ok('error' in unsaved);assert.deepEqual(await read(), saved);refuseCompletion = false;
  const invalid = await core.operatorActions.dispatch(action('invalid-layout', saved.revision, {...composition(), assignments: [{device: 'lamp-a', room: 'missing'}]}));
  assert.ok('error' in invalid);assert.deepEqual(await read(), saved);
  const operations = await contextOf(watcher).sdk.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(operations.status, 'synced');if (operations.status === 'synced'){
    const records = operations.copy.states().map(message => message.data);assert.ok(records.every(record => record.family === 'lighting-layout-set'));assert.equal(records.find(record => record.requestId === 'saved-layout')?.result, 'succeeded');await operations.copy.close();
  }
  await runtime.stop();const restarted = createCoreModule(), next = fixture('layout-after-restart');
  await run(context, {modules: [restarted, next], configFile: files.config, stateDir: dir});
  assert.deepEqual((await read(next)).layout, composition());assert.equal((await read(next)).revision, saved.revision);
});

it('authenticated lighting metadata follows the existing gateway and cannot bypass control admission', async context => {
  const core = createCoreModule(), files = await edgeConfig(context, [], {browserAccess: 'trusted-loopback'});
  const {runtime} = await run(context, {modules: [core], configFile: files.config, edge: {schemas: {}}});
  const headers = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json', traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'};
  const payload = JSON.stringify({target: 'lighting', requestId: 'browser-layout', data: {expectedRevision: 0, layout: composition()}});
  const unauthorized = await fetch(new URL('/api/v2/commands/lighting-layout-set', runtime.url), {method: 'POST', headers, body: payload});assert.equal(unauthorized.status, 401, await unauthorized.text());
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers, body: '{}'});assert.equal(signed.status, 200);
  const cookie = signed.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie !== undefined);await signed.body?.cancel();
  const answer = await fetch(new URL('/api/v2/commands/lighting-layout-set', runtime.url), {method: 'POST', headers: {...headers, cookie}, body: payload});assert.equal(answer.status, 200);await answer.body?.cancel();
  await waitFor(async () => {
    const records = await fetch(new URL('/api/v2/families/lighting-layout', runtime.url), {headers: {cookie}});await records.body?.cancel();return records.status === 200;
  });
});
