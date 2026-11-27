import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as immediate} from 'node:timers/promises';
import {InProcessBus} from '@jimmie-potts/sdk';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {RemoteParticipant, SyncChange, SyncHandler, SyncOptions, SyncedCopy} from '@jimmie-potts/sdk/remote';
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
  let closes = 0, commands = 0;
  const participant = {sync: (families: readonly string[], handler: (change: SyncChange<RuntimeRecord>) => void, options: {owner: string}) => {
    const key = `${options.owner}:${families[0] ?? ''}`; syncs.push(key); handlers.set(key, handler);
    const copy = {states: () => [], close: () => { closes++; return Promise.resolve(); }} as unknown as SyncedCopy<RuntimeRecord>;
    return Promise.resolve({status: 'synced', copy, message: {id: key}});
  }, request: () => { commands++; }} as unknown as RemoteParticipant;
  let state: RuntimeData | undefined;
  const feeds = new RuntimeFeeds({after: () => () => {}}, value => { state = value; }, () => { assert.fail('the session must stay alive'); });
  await feeds.start(participant);
  assert.deepEqual(syncs, ['bunny/core:operation', 'bunny/core:mode', 'bunny/modules/wall:device', 'bunny/modules/sign:device']);
  assert.equal(state?.copies.every(copy => copy.synced), true);
  feeds.hear({event: 'remote.disconnected', level: 'warn'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  const wallCopy = handlers.get('bunny/modules/wall:device');
  const completed = {type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>} as const;
  wallCopy?.(completed);
  assert.equal(state?.copies.every(copy => !copy.synced), true, 'an in-flight completion during disconnect does not restore freshness');
  feeds.hear({event: 'remote.reconnected', level: 'info'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  wallCopy?.({type: 'removed', entity: {family: 'device', id: 'retired'}});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  wallCopy?.(completed);
  assert.deepEqual(state?.copies.map(copy => [copy.owner, copy.synced]), [['bunny/core', false], ['bunny/core', false], ['bunny/modules/wall', true], ['bunny/modules/sign', false]]);
  assert.deepEqual([syncs.length, closes, commands], [4, 0, 0], 'reconnect uses the existing copies and sends no command');
  feeds.close();
});

void test('a real SDK overflow replaces one device owner while the other stays usable', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [
      {name: 'wall', state: 'running', serves: ['device'], pages: []},
      {name: 'sign', state: 'running', serves: ['device'], pages: []},
    ],
  } : {schema: 'authority/2.0', scope: 'control'})));
  const wallSource = 'bunny/modules/wall', signSource = 'bunny/modules/sign';
  const events: string[] = [], commands: string[] = [];
  const errors: unknown[] = [];
  const bus = new InProcessBus({onDiagnostic: diagnostic => {
    if (diagnostic.event === 'sync.restarted') {
      events.push(diagnostic.event);
      feeds.hear(diagnostic);
    }
    if (diagnostic.event.startsWith('command.')) commands.push(diagnostic.event);
  }, onError: error => { errors.push(error); }});
  const wall = bus.connect(wallSource), sign = bus.connect(signSource), browser = bus.connect('bunny/parts/dashboard');
  const counters = {
    [wallSource]: {subscriptions: 0, reads: 0, closes: 0},
    [signSource]: {subscriptions: 0, reads: 0, closes: 0},
  };
  const device = (id: string, revision: number) => ({
    subject: id, type: 'org.bunny.device.updated', dataschema: 'https://bunny.invalid/events/device/2.0', data: {id, revision},
  });
  let releaseHandler = (): void => {}, releaseSnapshot = (): void => {};
  const handlerGate = new Promise<void>(resolve => { releaseHandler = resolve; });
  const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  await wall.serveSync(['device'], async () => {
    if (++counters[wallSource].reads === 1) return {revision: 1, states: [device('wall', 1), device('retired', 1)]};
    await snapshotGate;
    return {revision: 4, states: [device('wall', 4)]};
  });
  await sign.serveSync(['device'], () => {
    counters[signSource].reads++;
    return {revision: 1, states: [device('sign', 1)]};
  });
  let state: RuntimeData | undefined;
  const freshness = (owner: string) => state?.copies.find(copy => copy.owner === owner)?.synced;
  const changes: [string, boolean | undefined][] = [];
  const feeds = new RuntimeFeeds({after: () => () => {}}, value => { state = value; }, () => { assert.fail('the session must stay alive'); });
  context.after(async () => {
    releaseHandler();
    releaseSnapshot();
    feeds.close();
    await Promise.all([browser.close(), wall.close(), sign.close()]);
  });
  const participant = {...browser, sync: async <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => {
    const {owner} = options;
    assert.ok(owner === wallSource || owner === signSource);
    assert.deepEqual(families, ['device']);
    const counts = counters[owner];
    counts.subscriptions++;
    const result = await browser.sync<T>(families, async change => {
      await handler(change);
      if (owner !== wallSource) return;
      if (change.type === 'updated' && 'revision' in change.message.data && change.message.data.revision === 2) await handlerGate;
      if (counts.reads > 1) changes.push([change.type, freshness(owner)]);
    }, {...options, maxBuffered: 1});
    if (result.status === 'rejected') return result;
    const {copy} = result;
    return {...result, copy: {
      get: copy.get.bind(copy), states: copy.states.bind(copy), close: () => { counts.closes++; return copy.close(); },
    }};
  }} as unknown as RemoteParticipant;
  await feeds.start(participant);
  assert.deepEqual(counters, {
    [wallSource]: {subscriptions: 1, reads: 1, closes: 0}, [signSource]: {subscriptions: 1, reads: 1, closes: 0},
  });
  assert.deepEqual([freshness(wallSource), freshness(signSource)], [true, true]);

  // While the wall handler is held, one more live message fills its copy's buffer and the next overflows it.
  for (const revision of [2, 3, 4]) {
    await wall.publish('bunny.state.device.wall', {kind: 'state', ...device('wall', revision)});
    await immediate();
  }
  assert.deepEqual(events, ['sync.restarted']);
  assert.deepEqual([freshness(wallSource), freshness(signSource)], [false, true], 'the family diagnostic must leave the other owner current');
  releaseHandler();
  await immediate();
  assert.deepEqual(counters, {
    [wallSource]: {subscriptions: 1, reads: 2, closes: 0}, [signSource]: {subscriptions: 1, reads: 1, closes: 0},
  }, 'the SDK makes the only replacement read using the existing subscription');

  await sign.publish('bunny.state.device.sign', {kind: 'state', ...device('sign', 2)});
  await immediate();
  assert.deepEqual(state?.copies.find(copy => copy.owner === signSource)?.records, [{id: 'sign', revision: 2}]);
  assert.deepEqual([freshness(wallSource), freshness(signSource)], [false, true]);
  releaseSnapshot();
  await immediate();
  assert.deepEqual(changes, [['updated', false], ['removed', false], ['synced', true]], 'only completion can make the wall current');
  assert.deepEqual(state?.copies.map(copy => copy.records), [[{id: 'wall', revision: 4}], [{id: 'sign', revision: 2}]]);
  assert.deepEqual(counters, {
    [wallSource]: {subscriptions: 1, reads: 2, closes: 0}, [signSource]: {subscriptions: 1, reads: 1, closes: 0},
  });
  assert.deepEqual(commands, []);
  assert.deepEqual(errors, []);
});

void test('SDK replacement refusal keeps copy-scoped backoff and terminal session behavior', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [{name: 'wall', state: 'running', serves: ['device'], pages: []}],
  } : {schema: 'authority/2.0', scope: 'control'})));
  const attempts: {changed: SyncHandler<RuntimeRecord>; restarted: () => void}[] = [];
  const retries: {delay: number; run: () => void}[] = [];
  let closes = 0, commands = 0, ended = 0, rejectRead = false;
  const participant = {
    sync: (_families: readonly string[], changed: SyncHandler<RuntimeRecord>, options: SyncOptions) => {
      assert.ok(options.onRestarted);
      attempts.push({changed, restarted: options.onRestarted});
      if (rejectRead) return Promise.resolve({status: 'rejected', requestId: 'refused', error: errorBody('unavailable')});
      return Promise.resolve({status: 'synced', copy: {states: () => [], close: () => { closes++; return Promise.resolve(); }}});
    },
    request: () => { commands++; },
  } as unknown as RemoteParticipant;
  let state: RuntimeData | undefined;
  const feeds = new RuntimeFeeds({after: (delay, run) => { retries.push({delay, run}); return () => {}; }}, value => { state = value; }, () => { ended++; });
  context.after(() => feeds.close());
  await feeds.start(participant);
  const first = attempts[0];
  assert.ok(first);
  first.restarted();
  await first.changed({type: 'failed', error: errorBody('unavailable')});
  assert.deepEqual([state?.copies[0]?.synced, state?.copies[0]?.refused, ended], [false, 'unavailable', 0]);
  const refusedState = state;
  await first.changed({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  assert.equal(state, refusedState, 'a copy the SDK stopped on refusal cannot restore freshness');
  assert.deepEqual([attempts.length, closes, commands], [1, 0, 0], 'refusal waits for the scheduled read');

  rejectRead = true;
  assert.deepEqual(retries.map(retry => retry.delay), [1000]);
  retries[0]?.run();
  await immediate();
  assert.deepEqual(retries.map(retry => retry.delay), [1000, 2000]);
  assert.deepEqual([attempts.length, closes, commands], [2, 1, 0]);
  rejectRead = false;
  retries[1]?.run();
  await immediate();
  assert.deepEqual([state?.copies[0]?.synced, state?.copies[0]?.refused], [true, undefined]);
  const current = attempts[2];
  assert.ok(current);
  current.restarted();
  await current.changed({type: 'failed', error: errorBody('forbidden')});
  assert.deepEqual([state?.copies[0]?.synced, ended, retries.length], [false, 1, 2]);
  assert.deepEqual([attempts.length, closes, commands], [3, 1, 0], 'terminal refusal ends the session without another request');
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
  const restarts: (() => void)[] = [];
  let syncs = 0, closes = 0, commands = 0;
  const participant = {sync: (_families: readonly string[], handler: (change: SyncChange<RuntimeRecord>) => void, options: SyncOptions) => {
    assert.ok(options.onRestarted);
    restarts.push(options.onRestarted);
    handlers.push(handler);
    const first = syncs++ < 2;
    return Promise.resolve({status: 'synced', copy: {states: () => [], close: () => { closes++; return first ? closing : Promise.resolve(); }}});
  }, request: () => { commands++; }} as unknown as RemoteParticipant;
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
  const refreshedState = state;
  restarts[0]?.();
  assert.equal(state, refreshedState, 'the replaced copy cannot make its replacement stale');
  assert.deepEqual([syncs, closes, commands], [4, 2, 0], 'one replacement read and close per requested copy');
  feeds.close();
  handlers[2]?.({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  restarts[2]?.();
  assert.equal(state, refreshedState, 'callbacks from a closed copy cannot reach the page');
  assert.deepEqual([syncs, closes, commands], [4, 4, 0]);
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
