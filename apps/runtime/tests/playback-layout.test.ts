import assert from 'node:assert/strict';
import type {PlaybackLayoutRecord, PlaybackPlacement, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import type {Action} from '../src/core/tracker.js';
import {contextOf, edgeConfig, fixture, it, run, stateDir} from './support.js';

const placements = (): PlaybackPlacement[] => [{playback: 'shared-music', rooms: ['studio', 'kitchen']}];
const action = (requestId: string, expectedRevision: number, assignments = placements()): Action => ({key: 'bunny.cmd.playback-layout-set.playback', requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.playback-layout.set.requested', subject: 'playback', dataschema: 'https://bunny.invalid/events/playback-layout-set/2.0', data: {expectedRevision, assignments}}});

it('music placement is guarded core metadata and survives restart without playback effects', async context => {
  let refuseCompletion = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {
    if (refuseCompletion && operation.family === 'playback-layout-set' && outcome !== undefined) throw new Error('synthetic-placement-commit-refusal');
  }}]}), watcher = fixture('placement-watcher'), dir = await stateDir(context), files = await edgeConfig(context, []);
  const {runtime} = await run(context, {modules: [core, watcher], configFile: files.config, stateDir: dir});
  const read = async (source = watcher): Promise<PlaybackLayoutRecord> => {
    const result = await contextOf(source).sdk.sync<PlaybackLayoutRecord>(['playback-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
    assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('placement-sync-refused');
    const current = result.copy.states()[0]?.data;await result.copy.close();assert.ok(current);return current;
  };
  const initial = await read();assert.deepEqual(initial.assignments, []);
  const raw = await contextOf(watcher).sdk.request('bunny.cmd.playback-layout-set.playback', action('raw-placement', 0).draft, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
  const ordinary = await core.actions.dispatch(action('ordinary-placement', 0));assert.ok('error' in ordinary);assert.equal(ordinary.error.code, 'forbidden');
  assert.deepEqual(await core.operatorActions.dispatch(action('saved-placement', initial.revision)), {status: 'accepted', requestId: 'saved-placement'});
  const saved = await read();assert.deepEqual(saved.assignments, placements());assert.ok(saved.revision > initial.revision);
  const conflict = await core.operatorActions.dispatch(action('stale-placement', initial.revision, []));
  assert.ok('error' in conflict);assert.equal(conflict.error.code, 'revision-conflict');assert.deepEqual(await read(), saved);
  assert.deepEqual(await core.operatorActions.dispatch(action('saved-placement', initial.revision)), {status: 'accepted', requestId: 'saved-placement'});assert.deepEqual(await read(), saved);
  refuseCompletion = true;
  const unsaved = await core.operatorActions.dispatch(action('unsaved-placement', saved.revision, []));assert.ok('error' in unsaved);assert.deepEqual(await read(), saved);refuseCompletion = false;
  const invalid = await core.operatorActions.dispatch(action('invalid-placement', saved.revision, [{playback: 'shared-music', rooms: ['studio', 'studio']}]));assert.ok('error' in invalid);assert.deepEqual(await read(), saved);
  const operations = await contextOf(watcher).sdk.sync<OperationRecord>(['operation'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(operations.status, 'synced');if (operations.status === 'synced'){
    const records = operations.copy.states().map(message => message.data);assert.ok(records.every(record => record.family === 'playback-layout-set'));assert.equal(records.find(record => record.requestId === 'saved-placement')?.result, 'succeeded');await operations.copy.close();
  }
  await runtime.stop();const restarted = createCoreModule(), next = fixture('placement-after-restart');
  await run(context, {modules: [restarted, next], configFile: files.config, stateDir: dir});assert.deepEqual(await read(next), saved);
});

it('authenticated placement saves require a browser session and preserve trace context', async context => {
  const core = createCoreModule(), files = await edgeConfig(context, [], {browserAccess: 'trusted-loopback'});
  const {runtime, logs} = await run(context, {modules: [core], configFile: files.config, edge: {schemas: {}}});
  const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const headers = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json', traceparent};
  const payload = JSON.stringify({target: 'playback', requestId: 'browser-placement', data: {expectedRevision: 0, assignments: placements()}});
  const unauthorized = await fetch(new URL('/api/v2/commands/playback-layout-set', runtime.url), {method: 'POST', headers, body: payload});
  assert.equal(unauthorized.status, 401); await unauthorized.body?.cancel();
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers, body: '{}'});
  assert.equal(signed.status, 200); const cookie = signed.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie !== undefined); await signed.body?.cancel();
  const answer = await fetch(new URL('/api/v2/commands/playback-layout-set', runtime.url), {method: 'POST', headers: {...headers, cookie}, body: payload});
  assert.equal(answer.status, 200); await answer.body?.cancel();
  assert.ok(logs.some(record => record.trace_id === '4bf92f3577b34da6a3ce929d0e0e4736'), 'the operator request retains its incoming trace');
});

// The command expires after admission but before the transaction starts.
import {DatabaseSync} from 'node:sqlite';
import type {Command, Responder, Sdk} from '@jimmie-potts/sdk';
import type {PlaybackLayoutSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle} from '../src/core/core.js';
import type {CoreTransaction} from '../src/core/store.js';
import {PlaybackLayoutPart} from '../src/core/playback-layout.js';

it('placement expiry is checked at the transaction boundary without a saved metadata effect', async () => {
  const db = new DatabaseSync(':memory:'); let responder: Responder<PlaybackLayoutSetRequest> | undefined; let completed = 0, ended = 0;
  const part = new PlaybackLayoutPart({admit: () => true, complete: () => {completed++; return () => {};}, end: () => {ended++;}});
  const now = Date.now();
  const command: Command<PlaybackLayoutSetRequest> = {specversion: '1.0', bunnyprofile: '2.0', id: 'expiring-placement', source: 'bunny/core',
    type: 'org.bunny.playback-layout.set.requested', subject: 'playback', time: new Date(now).toISOString(), expiresat: new Date(now + 1000).toISOString(),
    kind: 'command', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/playback-layout-set/2.0',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', data: {requestId: 'expiring-placement', expectedRevision: 0, assignments: placements()}};
  try {
    part.open(db);
    const sdk = {respond: (_pattern: string, receive: Responder<PlaybackLayoutSetRequest>) => {responder = receive; return Promise.resolve();}} as unknown as Sdk;
    const core = {sdk, ready: Promise.resolve(), transaction: (work: (tx: CoreTransaction) => unknown) => Promise.resolve(work({atMs: now + 2000} as CoreTransaction))} as CoreHandle;
    await part.start(core); assert.ok(responder);
    const reply = await responder(command); assert.ok('error' in reply); assert.equal(reply.error.code, 'expired');
    assert.deepEqual((part.states(['playback-layout'])[0]?.data as PlaybackLayoutRecord).assignments, []);
    assert.equal(completed, 0); assert.equal(ended, 1);
  } finally {db.close();}
});
