import assert from 'node:assert/strict';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {RemoteParticipant, SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {RuntimeFeeds, awaitsRecords, copiesState, type RuntimeData, type RuntimeRecord} from '../src/runtime-feeds.ts';

void test('lighting, geometry and presence follow only their declared owner on the existing participant', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [
      {name: 'core', state: 'running', serves: ['lighting-layout', 'playback-layout'], pages: []},
      {name: 'lifx', state: 'running', serves: ['device', 'lifx-light'], pages: []},
      {name: 'nanoleaf', state: 'running', serves: ['device', 'nanoleaf-wall'], pages: []},
      {name: 'presence-pro', state: 'running', serves: ['presence-observation'], pages: []},
      {name: 'other', state: 'running', serves: ['lighting-layout', 'playback-layout', 'lifx-light', 'nanoleaf-wall', 'presence-observation'], pages: []},
    ],
  } : {schema: 'authority/2.0', scope: 'control'})));
  const calls: string[] = [];
  const participant = {sync: (families: readonly string[], _handler: unknown, options: {owner: string}) => {
    calls.push(`${options.owner}:${families[0] ?? ''}`);
    return Promise.resolve({status: 'synced', copy: {states: () => [], close: () => Promise.resolve()}});
  }} as unknown as RemoteParticipant;
  const feeds = new RuntimeFeeds({after: () => () => {}}, () => {}, () => {});
  await feeds.start(participant);
  assert.deepEqual(calls, ['bunny/core:lighting-layout', 'bunny/core:playback-layout', 'bunny/modules/lifx:device', 'bunny/modules/lifx:lifx-light', 'bunny/modules/nanoleaf:device', 'bunny/modules/nanoleaf:nanoleaf-wall', 'bunny/modules/presence-pro:presence-observation']);
  await feeds.refresh();assert.equal(calls.length, 14);feeds.close();
});
void test('named owners coexist; a gap keeps copies stale until their own replacement arrives, without commands', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [
      {name: 'core', state: 'running', serves: ['session', 'operation', 'mode'], pages: []},
      {name: 'wall', state: 'running', serves: ['device'], pages: []}, {name: 'sign', state: 'failed', serves: ['device'], pages: []},
    ],
  } : {schema: 'authority/2.0', scope: 'control'})));
  const syncs: string[] = [];
  const handlers = new Map<string, (change: SyncChange<RuntimeRecord>) => void>();
  const participant = {sync: (families: readonly string[], handler: (change: SyncChange<RuntimeRecord>) => void, options: {owner: string}) => {
    const key = `${options.owner}:${families[0] ?? ''}`; syncs.push(key); handlers.set(key, handler);
    const copy = {states: () => [], close: () => Promise.resolve()} as unknown as SyncedCopy<RuntimeRecord>;
    return Promise.resolve({status: 'synced', copy, message: {id: key}});
  }} as unknown as RemoteParticipant;
  let state: RuntimeData | undefined;
  const feeds = new RuntimeFeeds({after: () => () => {}}, value => { state = value; }, () => { assert.fail('the session must stay alive'); });
  await feeds.start(participant);
  assert.deepEqual(syncs, ['bunny/core:operation', 'bunny/core:mode', 'bunny/modules/wall:device', 'bunny/modules/sign:device']);
  assert.equal(state?.copies.every(copy => copy.synced), true);
  feeds.hear({event: 'remote.disconnected', level: 'warn'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  feeds.hear({event: 'remote.reconnected', level: 'info'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  handlers.get('bunny/modules/wall:device')?.({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  assert.deepEqual(state?.copies.map(copy => [copy.owner, copy.synced]), [['bunny/core', false], ['bunny/core', false], ['bunny/modules/wall', true], ['bunny/modules/sign', false]]);
  assert.equal(syncs.length, 4, 'the page never requests a command or replays one');
  feeds.close();
});

void test('explicit placement refresh reports its own required sync results, never a later retry or a missing copy', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [{name: 'core', state: 'running', serves: ['lighting-layout', 'playback-layout'], pages: []}],
  } : {schema: 'authority/2.0', scope: 'control'})));
  let refuse = false;
  const retry: (() => void)[] = [];
  const participant = {sync: (families: readonly string[]) => Promise.resolve(refuse && families[0] === 'playback-layout'
    ? {status: 'rejected', error: {error: {code: 'unavailable'}}}
    : {status: 'synced', copy: {states: () => [], close: () => Promise.resolve()}})} as unknown as RemoteParticipant;
  const feeds = new RuntimeFeeds({after: (_delay, action) => {retry.push(action); return () => {}; }}, () => {}, () => {});
  const required = [{owner: 'bunny/core', family: 'lighting-layout'}, {owner: 'bunny/core', family: 'playback-layout'}] as const;
  await feeds.start(participant);
  assert.equal(await feeds.refresh(required), true);
  refuse = true;
  const failed = await feeds.refresh(required);
  assert.equal(failed, false);
  refuse = false;
  retry[0]?.();
  await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(failed, false, 'automatic recovery cannot change the explicit attempt result');
  assert.equal(await feeds.refresh([{owner: 'bunny/core', family: 'device'}]), false, 'an absent required copy cannot count as success');
  feeds.close();
  assert.equal(await feeds.refresh(required), false);
});

void test('a replacement marks its copy stale before the replaced copy finishes closing, and that copy cannot restore it', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [{name: 'core', state: 'running', serves: ['lighting-layout', 'playback-layout'], pages: []}],
  } : {schema: 'authority/2.0', scope: 'control'})));
  // The first copies' close() is held, as the SDK's close waits for the edge to forget the subscription (#1535).
  let releaseClose = (): void => {};
  const closing = new Promise<void>(resolve => { releaseClose = resolve; });
  const handlers: ((change: SyncChange<RuntimeRecord>) => void)[] = [];
  let syncs = 0;
  const participant = {sync: (_families: readonly string[], handler: (change: SyncChange<RuntimeRecord>) => void) => {
    handlers.push(handler);
    const first = syncs++ < 2;
    return Promise.resolve({status: 'synced', copy: {states: () => [], close: () => first ? closing : Promise.resolve()}});
  }} as unknown as RemoteParticipant;
  let state: RuntimeData | undefined;
  const feeds = new RuntimeFeeds({after: () => () => {}}, value => { state = value; }, () => { assert.fail('the session must stay alive'); });
  await feeds.start(participant);
  assert.deepEqual(state?.copies.map(copy => copy.synced), [true, true]);
  const refreshed = feeds.refresh([{owner: 'bunny/core', family: 'lighting-layout'}, {owner: 'bunny/core', family: 'playback-layout'}]);
  assert.deepEqual(state?.copies.map(copy => copy.synced), [false, false], 'an explicit refresh leaves no replaced copy current while it closes');
  for (const handler of handlers.slice(0, 2)) handler({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  assert.deepEqual(state?.copies.map(copy => copy.synced), [false, false], 'the replaced copy cannot restore freshness');
  releaseClose();
  assert.equal(await refreshed, true);
  assert.deepEqual(state?.copies.map(copy => copy.synced), [true, true]);
  assert.equal(syncs, 4, 'one replacement read per copy, and no command');
  feeds.close();
});

void test('an overtaken replacement whose close returns last cannot detach the current copy', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [{name: 'core', state: 'running', serves: ['lighting-layout'], pages: []}],
  } : {schema: 'authority/2.0', scope: 'control'})));
  // The SDK's first close() waits for the edge to forget the subscription; a second close of that copy returns at once.
  let release = (): void => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const copies: {handler: (change: SyncChange<RuntimeRecord>) => void; closed: number}[] = [];
  const participant = {sync: (_families: readonly string[], handler: (change: SyncChange<RuntimeRecord>) => void) => {
    const entry = {handler, closed: 0}, first = copies.length === 0; copies.push(entry);
    return Promise.resolve({status: 'synced', copy: {states: () => [{data: {id: `copy-${String(copies.length)}`}}], close: () => {
      entry.closed++; return first && entry.closed === 1 ? held : Promise.resolve();
    }}});
  }} as unknown as RemoteParticipant;
  let state: RuntimeData | undefined;
  const feeds = new RuntimeFeeds({after: () => () => {}}, value => { state = value; }, () => { assert.fail('the session must stay alive'); });
  await feeds.start(participant);
  const overtaken = feeds.refresh(), latest = feeds.refresh();
  assert.equal(await latest, true);
  release();
  assert.equal(await overtaken, false, 'the overtaken attempt reports its own result');
  await new Promise(resolve => { setImmediate(resolve); });
  copies.find(entry => entry.closed === 0)?.handler({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  assert.equal(state?.copies[0]?.synced, true, 'the current copy still reaches the page');
  assert.equal(copies.filter(entry => entry.closed === 0).length, 1, 'exactly one copy stays open');
  feeds.close();
  assert.equal(copies.filter(entry => entry.closed === 0).length, 0, 'closing the feeds reaches the current copy');
});
void test('the copies state says when every followed copy has its sync, so a load\'s syncs can be waited out (#1919)', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [{name: 'lifx', state: 'running', serves: ['device', 'lifx-light'], pages: []}],
  } : {schema: 'authority/2.0', scope: 'control'})));
  const answers: (() => void)[] = [];
  const participant = {sync: () => new Promise(resolve => {
    answers.push(() => {resolve({status: 'synced', copy: {states: () => [], close: () => Promise.resolve()}});});
  })} as unknown as RemoteParticipant;
  const seen: string[] = [];
  const feeds = new RuntimeFeeds({after: () => () => {}}, state => {seen.push(copiesState(state));}, () => {});
  assert.equal(copiesState({modules: undefined, control: false, copies: [], catalogFailed: false}), 'loading', 'before the catalog is read');
  const started = feeds.start(participant);
  while (answers.length < 2) await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(seen.at(-1), 'syncing', 'both copies have asked and neither has its sync');
  answers[0]?.();
  await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(seen.at(-1), 'syncing', 'one copy still waits');
  answers[1]?.();
  await started;
  assert.equal(seen.at(-1), 'synced');
  assert.equal(copiesState({modules: undefined, control: false, copies: [], catalogFailed: true}), 'unavailable', 'the catalog could not be read');
  feeds.close();
});
void test('a page is not called missing before the catalog and the device and playback copies it depends on arrive (#1919)', () => {
  const loading: RuntimeData = {modules: undefined, control: false, copies: [], catalogFailed: false};
  const catalog: RuntimeData = {...loading, modules: [], copies: [{owner: 'bunny/modules/lifx', family: 'device', synced: false, records: []}, {owner: 'bunny/core', family: 'mode', synced: false, records: []}]};
  const synced: RuntimeData = {...catalog, copies: catalog.copies.map(copy => copy.family === 'device' ? {...copy, synced: true} : copy)};
  for (const route of [{kind: 'module', module: 'sign', page: 'preview'}, {kind: 'lighting-brand', brand: 'lifx'}] as const) {
    assert.deepEqual([awaitsRecords(route, loading), awaitsRecords(route, catalog)], [true, false], `${route.kind} waits for the catalog only`);
  }
  for (const route of [{kind: 'component', id: 'pendant-1'}, {kind: 'playback', sourceId: 'sonos'}] as const) {
    assert.deepEqual([awaitsRecords(route, loading), awaitsRecords(route, catalog), awaitsRecords(route, synced)], [true, true, false], `${route.kind} also waits for the device copies, not for others`);
  }
  const refused: RuntimeData = {...catalog, copies: catalog.copies.map(copy => copy.family === 'device' ? {...copy, refused: 'unavailable'} : copy)};
  assert.equal(awaitsRecords({kind: 'component', id: 'pendant-1'}, refused), false, 'a copy its owner refused, such as a stopped module\'s, is not waited for');
  assert.equal(awaitsRecords({kind: 'missing', hash: '#/missing-page'}, loading), false, 'an address no catalog could declare is missing at once');
  assert.equal(awaitsRecords({kind: 'component', id: 'pendant-1'}, {...loading, catalogFailed: true}), false, 'a catalog that could not be read decides nothing more');
});
