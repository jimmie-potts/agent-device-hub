import assert from 'node:assert/strict';
import type {HomeArrangements, HomeLayoutRecord} from '@jimmie-potts/event-contracts/v2/families';
import {createCoreModule} from '../src/core/core.js';
import type {Action} from '../src/core/tracker.js';
import {contextOf, edgeConfig, fixture, it, run, stateDir, waitFor} from './support.js';

type Saved = {id: string; revision: number; version: number; layouts: object | null};
const arrangements = (): HomeArrangements => ({desktop: [{widget: 'hub-mode', size: 'medium', hidden: false}], phone: [{widget: 'inbox', size: 'small', hidden: false}]});
const action = (requestId: string, expectedRevision: number, layouts: object = arrangements()): Action => ({key: 'bunny.cmd.home-layout-set.home', requestedBy: 'bunny/parts/operator', requestId,
  draft: {type: 'org.bunny.home-layout.set.requested', subject: 'home', dataschema: 'https://bunny.invalid/events/home-layout-set/2.0', data: {expectedRevision, layouts}}});

it('Home layouts persist with guarded operator admission and no device effects', async context => {
  let refuse = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {if (refuse && operation.family === 'home-layout-set' && outcome !== undefined) throw new Error('synthetic-home-commit-refusal');}}]}), watcher = fixture('home-watcher');
  const files = await edgeConfig(context, []), dir = await stateDir(context);
  const {runtime} = await run(context, {modules: [core, watcher], configFile: files.config, stateDir: dir});
  const read = async (source = watcher): Promise<Saved> => {
    const result = await contextOf(source).sdk.sync<Saved>(['home-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
    assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('home-layout-sync-refused');
    const current = result.copy.states()[0]?.data;await result.copy.close();assert.ok(current);return current;
  };
  const initial = await read();assert.equal(initial.layouts, null);
  const raw = await contextOf(watcher).sdk.request('bunny.cmd.home-layout-set.home', action('raw-home', 0).draft, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden');
  const ordinary = await core.actions.dispatch(action('ordinary-home', 0));assert.ok('error' in ordinary);assert.equal(ordinary.error.code, 'forbidden');
  assert.deepEqual(await core.operatorActions.dispatch(action('save-home', initial.revision)), {status: 'accepted', requestId: 'save-home'});
  const saved = await read();assert.deepEqual(saved.layouts, arrangements());assert.ok(saved.revision > initial.revision);
  const stale = await core.operatorActions.dispatch(action('stale-home', 0));assert.ok('error' in stale);assert.equal(stale.error.code, 'revision-conflict');
  await core.operatorActions.dispatch(action('save-home', 0));assert.deepEqual(await read(), saved);
  refuse = true;assert.ok('error' in await core.operatorActions.dispatch(action('failed-home', saved.revision)));assert.deepEqual(await read(), saved);refuse = false;
  const duplicate = {desktop: [...arrangements().desktop, ...arrangements().desktop], phone: []};
  assert.ok('error' in await core.operatorActions.dispatch(action('invalid-home', saved.revision, duplicate)));assert.deepEqual(await read(), saved);
  const operations = await contextOf(watcher).sdk.sync<{family: string}>(['operation'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(operations.status, 'synced');if (operations.status === 'synced') {assert.ok(operations.copy.states().every(state => state.data.family === 'home-layout-set'));await operations.copy.close();}
  await runtime.stop();const next = fixture('home-after-restart');await run(context, {modules: [createCoreModule(), next], configFile: files.config, stateDir: dir});assert.deepEqual(await read(next), saved);
});

it('lighting grouping and ungrouping preserve saved Home placement in the same metadata transaction', async context => {
  let refuse = false;
  const core = createCoreModule({parts: [{tracked: ({operation, outcome}) => {if (refuse && operation.family === 'lighting-layout-set' && outcome !== undefined) throw new Error('synthetic-lighting-home-rollback');}}]}), watcher = fixture('home-light-watcher'), files = await edgeConfig(context, []);
  await run(context, {modules: [core, watcher], configFile: files.config});
  const entries = ['light:device:lamp-a', 'light:device:lamp-b'].map(widget => ({widget, size: 'medium', hidden: false}));
  await core.operatorActions.dispatch(action('home-light-setup', 0, {desktop: entries, phone: entries}));
  const layout = {rooms: [], assignments: [], groups: [{id: 'pendants', name: 'Pendants', scope: 'home', devices: ['lamp-a', 'lamp-b']}], home: [{kind: 'group', id: 'pendants'}]};
  const group: Action = {key: 'bunny.cmd.lighting-layout-set.lighting', requestedBy: 'bunny/parts/operator', requestId: 'group-home-lights',
    draft: {type: 'org.bunny.lighting-layout.set.requested', subject: 'lighting', dataschema: 'https://bunny.invalid/events/lighting-layout-set/2.0', data: {expectedRevision: 0, layout}}};
  const combined = await contextOf(watcher).sdk.sync<{id: string; layout?: {groups: {id: string}[]}; layouts?: {desktop: {widget: string}[]}}>(['home-layout', 'lighting-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(combined.status, 'synced');if (combined.status !== 'synced') throw new Error('combined-home-sync-refused');
  assert.deepEqual(await core.operatorActions.dispatch(group), {status: 'accepted', requestId: 'group-home-lights'});
  await waitFor(() => combined.copy.states().some(state => state.data.layout?.groups[0]?.id === 'pendants') && combined.copy.states().some(state => state.data.layouts?.desktop[0]?.widget === 'light:group:pendants'));
  await combined.copy.close();
  const result = await contextOf(watcher).sdk.sync<Saved>(['home-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('home-sync-refused');
  const saved = result.copy.states()[0]?.data as Saved & {layouts: {desktop: {widget: string}[]; phone: {widget: string}[]}};
  assert.deepEqual(saved.layouts.desktop.map(entry => entry.widget), ['light:group:pendants']);
  assert.deepEqual(saved.layouts.phone.map(entry => entry.widget), ['light:group:pendants']);await result.copy.close();
  const light = await contextOf(watcher).sdk.sync<{revision: number}>(['lighting-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(light.status, 'synced');if (light.status !== 'synced') throw new Error('lighting-sync-refused');
  const revision = light.copy.states()[0]?.data.revision;assert.ok(revision !== undefined);await light.copy.close();
  const ungroup: Action = {...group, requestId: 'ungroup-home-lights', draft: {...group.draft, data: {expectedRevision: revision, layout: {...layout, groups: [], home: [{kind: 'device', id: 'lamp-a'}, {kind: 'device', id: 'lamp-b'}]}}}};
  refuse = true;assert.ok('error' in await core.operatorActions.dispatch(ungroup));
  const rollback = await contextOf(watcher).sdk.sync<Saved>(['home-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(rollback.status, 'synced');if (rollback.status !== 'synced') throw new Error('home-rollback-sync-refused');assert.deepEqual(rollback.copy.states()[0]?.data, saved);await rollback.copy.close();
  refuse = false;assert.deepEqual(await core.operatorActions.dispatch({...ungroup, requestId: 'ungroup-home-retry'}), {status: 'accepted', requestId: 'ungroup-home-retry'});
  const restored = await contextOf(watcher).sdk.sync<Saved>(['home-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(restored.status, 'synced');if (restored.status !== 'synced') throw new Error('home-restored-sync-refused');
  const data = restored.copy.states()[0]?.data as Saved & {layouts: {desktop: {widget: string}[]}};
  assert.deepEqual(data.layouts.desktop.map(entry => entry.widget), entries.map(entry => entry.widget));await restored.copy.close();
});

it('grouping visible lights preserves unrelated hidden and phone placements', async context => {
  const core = createCoreModule(), watcher = fixture('home-hidden-watcher'), files = await edgeConfig(context, []);
  await run(context, {modules: [core, watcher], configFile: files.config});
  const initial = {rooms: [], assignments: [], groups: [], home: ['a', 'b', 'c'].map(id => ({kind: 'device', id}))};
  const lighting = (requestId: string, expectedRevision: number, layout: object): Action => ({key: 'bunny.cmd.lighting-layout-set.lighting', requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: 'org.bunny.lighting-layout.set.requested', subject: 'lighting', dataschema: 'https://bunny.invalid/events/lighting-layout-set/2.0', data: {expectedRevision, layout}}});
  await core.operatorActions.dispatch(lighting('hidden-initial', 0, initial));
  const entries = ['a', 'b', 'c'].map(id => ({widget: `light:device:${id}`, size: 'medium', hidden: false}));
  const layouts = {desktop: entries.map(entry => ({...entry, hidden: entry.widget.endsWith(':b')})), phone: entries};
  await core.operatorActions.dispatch(action('hidden-home', 0, layouts));
  const read = await contextOf(watcher).sdk.sync<{revision: number}>(['lighting-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(read.status, 'synced');if (read.status !== 'synced') throw new Error('lighting-hidden-sync');
  const revision = read.copy.states()[0]?.data.revision;assert.ok(revision !== undefined);await read.copy.close();
  const grouped = {...initial, groups: [{id: 'ac', name: 'AC', scope: 'home', devices: ['a', 'c']}], home: [{kind: 'group', id: 'ac'}]};
  assert.deepEqual(await core.operatorActions.dispatch(lighting('hidden-group', revision, grouped)), {status: 'accepted', requestId: 'hidden-group'});
  const saved = await contextOf(watcher).sdk.sync<HomeLayoutRecord>(['home-layout'], () => {}, {timeoutMs: 2000, owner: 'bunny/core'});
  assert.equal(saved.status, 'synced');if (saved.status !== 'synced') throw new Error('saved-hidden-sync');
  const value = saved.copy.states()[0]?.data.layouts;assert.ok(value != null);
  assert.deepEqual(value.desktop.find(entry => entry.widget === 'light:device:b'), layouts.desktop[1]);
  assert.deepEqual(value.phone.find(entry => entry.widget === 'light:device:b'), layouts.phone[1]);await saved.copy.close();
});

it('authenticated Home saves require a browser session and preserve trace context', async context => {
  const core = createCoreModule(), files = await edgeConfig(context, [], {browserAccess: 'trusted-loopback'});
  const {runtime, logs} = await run(context, {modules: [core], configFile: files.config, edge: {schemas: {}}});
  const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const headers = {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json', traceparent};
  const payload = JSON.stringify({target: 'home', requestId: 'browser-home', data: {expectedRevision: 0, layouts: arrangements()}});
  const unauthorized = await fetch(new URL('/api/v2/commands/home-layout-set', runtime.url), {method: 'POST', headers, body: payload});
  assert.equal(unauthorized.status, 401); await unauthorized.body?.cancel();
  const signed = await fetch(new URL('/api/v2/browser/session', runtime.url), {method: 'POST', headers, body: '{}'});
  assert.equal(signed.status, 200); const cookie = signed.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie !== undefined); await signed.body?.cancel();
  const answer = await fetch(new URL('/api/v2/commands/home-layout-set', runtime.url), {method: 'POST', headers: {...headers, cookie}, body: payload});
  assert.equal(answer.status, 200); await answer.body?.cancel();
  assert.ok(logs.some(record => record.trace_id === '4bf92f3577b34da6a3ce929d0e0e4736'), 'the operator request retains its incoming trace');
});

// The command expires after admission but before the transaction starts.
import {DatabaseSync} from 'node:sqlite';
import type {Command, Responder, Sdk} from '@jimmie-potts/sdk';
import type {HomeLayoutSetRequest} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle} from '../src/core/core.js';
import type {CoreTransaction} from '../src/core/store.js';
import {HomeLayoutPart} from '../src/core/home-layout.js';

it('Home expiry is checked at the transaction boundary without a saved metadata effect', async () => {
  const db = new DatabaseSync(':memory:'); let responder: Responder<HomeLayoutSetRequest> | undefined; let completed = 0, ended = 0;
  const part = new HomeLayoutPart({admit: () => true, complete: () => {completed++; return () => {};}, end: () => {ended++;}});
  const now = Date.now();
  const command: Command<HomeLayoutSetRequest> = {specversion: '1.0', bunnyprofile: '2.0', id: 'expiring-home', source: 'bunny/core',
    type: 'org.bunny.home-layout.set.requested', subject: 'home', time: new Date(now).toISOString(), expiresat: new Date(now + 1000).toISOString(),
    kind: 'command', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/home-layout-set/2.0',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', data: {requestId: 'expiring-home', expectedRevision: 0, layouts: arrangements()}};
  try {
    part.open(db);
    const sdk = {respond: (_pattern: string, receive: Responder<HomeLayoutSetRequest>) => {responder = receive; return Promise.resolve();}} as unknown as Sdk;
    const core = {sdk, ready: Promise.resolve(), transaction: (work: (tx: CoreTransaction) => unknown) => Promise.resolve(work({atMs: now + 2000} as CoreTransaction))} as CoreHandle;
    await part.start(core); assert.ok(responder);
    const reply = await responder(command); assert.ok('error' in reply); assert.equal(reply.error.code, 'expired');
    assert.deepEqual((part.states(['home-layout'])[0]?.data as HomeLayoutRecord).layouts, null);
    assert.equal(completed, 0); assert.equal(ended, 1);
  } finally {db.close();}
});
