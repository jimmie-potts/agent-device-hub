// Module pages repeat a refused read of their own copy with the shell's backoff (Hub #1540). Each page's copy follower
// runs against synthetic reads and a manual clock: no real sleeps, no browser and no unrouted request.
import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as flush} from 'node:timers/promises';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {ArtRecord} from '@jimmie-potts/event-contracts/v2/art-state';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {CopyRead, Scheduler, SyncedCopy, SyncHandler, SyncResult} from '@jimmie-potts/sdk/remote';
import {deviceRecord} from '../../tests/fixtures/device.ts';
import {followTidbyt, type TidbytView} from '../../../../modules/tidbyt/dist/src/frontend/records.js';
import {followPixooCatalog} from '../../../../modules/pixoo/dist/src/frontend/index.js';
import {followArt} from '../../../../modules/art/dist/src/frontend/hooks.js';
import {followReachy} from '../../../../modules/companions/dist/src/frontend/reachy-feed.js';
import {followCatalog, type Catalog as WallCatalog} from '../../../../modules/nanoleaf/dist/src/frontend/catalog-feed.js';
import {followMicroDuck, type MicroDuckView} from '../../../../modules/microduck/dist/src/frontend/state-feed.js';
import type {MicroDuckState} from '../../../../modules/microduck/dist/src/contracts.js';

/** A manual scheduler: each pending delay waits until the test fires it. */
function clock() {
  const timers: {delayMs: number; run: () => void; cancelled: boolean}[] = [];
  const scheduler: Scheduler = {after: (delayMs, run) => {
    const timer = {delayMs, run, cancelled: false}; timers.push(timer);
    return () => { timer.cancelled = true; };
  }};
  return {
    scheduler,
    pending: () => timers.filter(timer => !timer.cancelled).map(timer => timer.delayMs),
    fire: async () => {
      const timer = timers.find(item => !item.cancelled); assert.ok(timer, 'a read is scheduled without the user acting');
      timer.cancelled = true; timer.run(); await flush();
    },
  };
}

/** Each call is a new read through the shell with its own copy, which holds `record` once answered. */
function reads<T>(record: T) {
  const all: {changed: SyncHandler<T>; closed: number; resolve: (result: SyncResult<T>) => void}[] = [];
  const read: CopyRead<T> = changed => new Promise(resolve => { all.push({changed, closed: 0, resolve}); });
  const last = () => { const entry = all.at(-1); assert.ok(entry, 'a read was made'); return entry; };
  return {
    read, all,
    answer: async () => {
      const entry = last();
      // Only `data` is read from a held state message.
      const states = [{data: record} as unknown as Message<T>];
      const copy: SyncedCopy<T> = {states: () => states, get: () => states[0], close: () => { entry.closed++; return Promise.resolve(); }};
      entry.resolve({status: 'synced', copy, message: {} as never}); await flush();
    },
    refuse: async (code: ErrorCode) => { last().resolve({status: 'rejected', requestId: 'synthetic', error: errorBody(code)}); await flush(); },
    fail: async (code: ErrorCode) => { await last().changed({type: 'failed', error: errorBody(code)}); await flush(); },
  };
}

/** What every page must show: current evidence, or a refused read that is stale or unavailable, not current. */
type Probe = {live: () => boolean; refused: () => boolean};
type Page = {name: string; start: (scheduler: Scheduler) => {stop: () => void; probe: Probe; owner: ReturnType<typeof reads<unknown>>}};
const page = <T>(name: string, record: T, start: (read: CopyRead<T>, scheduler: Scheduler) => {stop: () => void; probe: Probe}): Page => ({
  name, start: scheduler => {
    const owner = reads(record);
    return {...start(owner.read, scheduler), owner: owner as unknown as ReturnType<typeof reads<unknown>>};
  },
});
// The followers read only these fields of a synthetic record.
const art = {id: 'art', revision: 1} as unknown as ArtRecord;
const reachy = {id: 'reachy', revision: 1} as unknown as CompanionState;
const duck = {id: 'microduck', revision: 1} as unknown as MicroDuckState;

const pages: Page[] = [
  page('Tidbyt card', deviceRecord('tidbyt', 1, 'tidbyt', 'available'), (read, scheduler) => {
    let view: TidbytView | undefined;
    const stop = followTidbyt(read, deviceRecord('tidbyt', 1, 'tidbyt', 'available'), next => { view = next; }, scheduler);
    return {stop, probe: {live: () => view?.live === true, refused: () => view?.error !== undefined && view.device !== undefined}};
  }),
  page('Pixoo catalog', deviceRecord('pixoo', 1, 'pixoo', 'available'), (read, scheduler) => {
    let catalog: {live: boolean; error: string | undefined; device: unknown} | undefined;
    const records: Parameters<typeof followPixooCatalog>[1] = new Map([['device/pixoo', deviceRecord('pixoo', 1, 'pixoo', 'available')]]);
    const stop = followPixooCatalog(read, records, next => { catalog = next; }, scheduler);
    return {stop, probe: {live: () => catalog?.live === true && catalog.error === undefined, refused: () => catalog?.live === false && catalog.error !== undefined && catalog.device !== undefined}};
  }),
  page('Art records', art, (read, scheduler) => {
    let record: ArtRecord | undefined = art, live = false, error: string | undefined;
    const stop = followArt(read, {record: value => { record = value; }, live: value => { live = value; }, error: value => { error = value; }}, scheduler);
    return {stop, probe: {live: () => live && error === undefined, refused: () => !live && error !== undefined && record !== undefined}};
  }),
  page('Reachy companion', reachy, (read, scheduler) => {
    let state: CompanionState | undefined = reachy, unavailable = false, synced = false;
    const stop = followReachy(read, {
      updated: value => { state = value; unavailable = false; },
      current: value => { state = value; unavailable = false; synced = true; },
      unavailable: () => { unavailable = true; synced = false; },
      restarted: () => { synced = false; },
    }, scheduler);
    return {stop, probe: {live: () => synced && !unavailable, refused: () => unavailable && !synced && state !== undefined}};
  }),
  page('Nanoleaf wall catalog', deviceRecord('wall', 1, 'nanoleaf', 'available'), (read, scheduler) => {
    let catalog: WallCatalog | undefined;
    const stop = followCatalog(read, new Map([['device/wall', deviceRecord('wall', 1, 'nanoleaf', 'available')]]), next => { catalog = next; }, scheduler);
    return {stop, probe: {live: () => catalog?.live === true && !catalog.error, refused: () => catalog?.live === false && catalog.error && catalog.devices.length === 1}};
  }),
  page('MicroDuck state', duck, (read, scheduler) => {
    let view: MicroDuckView | undefined;
    const stop = followMicroDuck(read, next => { view = next; }, scheduler);
    // The page hides a state that is not live: "State unavailable".
    return {stop, probe: {live: () => view?.live === true && view.state !== undefined, refused: () => view?.live === false}};
  }),
];

for (const subject of pages) {
  void test(`${subject.name}: a refused read recovers once the feed returns, without Retry`, async () => {
    const time = clock();
    const {stop, probe, owner} = subject.start(time.scheduler);
    await owner.refuse('unavailable');
    assert.equal(probe.live(), false); assert.equal(probe.refused(), true, 'the refusal stays visible as stale or unavailable evidence');
    assert.deepEqual(time.pending(), [1000]);
    await time.fire(); await owner.answer();
    assert.equal(probe.live(), true, 'current again with no Retry press'); assert.equal(probe.refused(), false);
    assert.deepEqual(time.pending(), []);
    await owner.fail('capacity');
    assert.equal(probe.live(), false); assert.equal(owner.all[1]?.closed, 1, 'the failed copy is released');
    await time.fire(); await owner.answer();
    assert.equal(probe.live(), true, 'a copy that fails while connected recovers too');
    assert.equal(owner.all.length, 3, 'each repeat is one read; nothing else is sent');
    stop();
    assert.equal(owner.all[2]?.closed, 1); assert.deepEqual(time.pending(), []);
  });

  void test(`${subject.name}: a refusal that cannot clear is not read again`, async () => {
    for (const code of ['forbidden', 'invalid-request'] as const) {
      const time = clock();
      const {stop, probe, owner} = subject.start(time.scheduler);
      await owner.refuse(code);
      assert.equal(probe.refused(), true);
      assert.deepEqual(time.pending(), [], `${code} waits for Retry or a reconnect`);
      assert.equal(owner.all.length, 1);
      stop();
    }
  });

  void test(`${subject.name}: repeated refusals back off to at most 30 s`, async () => {
    const time = clock();
    const {stop, owner} = subject.start(time.scheduler);
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) { await owner.refuse('unavailable'); delays.push(...time.pending()); await time.fire(); }
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    stop(); assert.deepEqual(time.pending(), []);
  });
}
