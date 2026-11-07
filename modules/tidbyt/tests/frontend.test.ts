// Deterministic browser-copy lifetime cases, supplemented by the real-owner browser journey.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate as flush} from 'node:timers/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {SyncCompleted, SyncHandler, SyncResult} from '@jimmie-potts/sdk/remote';
import {NO_CONTROLS} from '../src/module.js';
import {followTidbyt, type TidbytView} from '../src/frontend/records.js';
import {TidbytCard} from '../src/frontend/card.js';

const record = (): DeviceRecord => ({id: 'tidbyt', revision: 1, kind: 'tidbyt', availability: 'available', configurationRevision: 1,
  generation: {epoch: 'synthetic', sequence: 1}, capabilities: NO_CONTROLS,
  desired: {power: {status: 'unknown'}, brightness: {status: 'unknown'}, mode: {status: 'unknown'}}, observed: {status: 'unknown'},
  pending: 0, pendingKinds: [], lastOutcome: {status: 'unknown'}, lastTransmission: {status: 'unknown'}, externalControl: {status: 'unknown'}});
const message = <T>(data: T): Message<T> => ({specversion: '1.0', bunnyprofile: '2.0', id: '00000000-0000-4000-8000-000000000001', source: 'bunny/modules/tidbyt',
  type: 'org.bunny.device.updated', subject: 'tidbyt', time: '2026-10-17T12:00:00.000Z', kind: 'state', datacontenttype: 'application/json',
  dataschema: 'https://bunny.invalid/events/device/2.0', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data});
const completed = (devices: DeviceRecord[] = []): Message<SyncCompleted> => ({...message({requestId: 'synthetic-sync', revision: 1, members: devices.map(device => ({family: 'device', id: device.id}))}), kind: 'sync-completed', type: 'org.bunny.sync.completed', dataschema: 'https://bunny.invalid/events/sync-completed/2.0'});
function fixture(initial: DeviceRecord[] = []) {
  let changed: SyncHandler<DeviceRecord> = () => {};
  let resolve: (result: SyncResult<DeviceRecord>) => void = () => {};
  let closed = 0, calls = 0, states = initial.map(message);
  const pending = new Promise<SyncResult<DeviceRecord>>(settle => { resolve = settle; });
  return {
    sync: (handler: SyncHandler<DeviceRecord>) => { calls++; changed = handler; return pending; },
    change: async (change: Parameters<SyncHandler<DeviceRecord>>[0]) => {
      if (change.type === 'updated') states = [...states.filter(item => item.data.id !== change.entity.id), change.message];
      else if (change.type === 'removed') states = states.filter(item => item.data.id !== change.entity.id);
      await changed(change);
    },
    replace: (next: DeviceRecord[]) => { states = next.map(message); },
    answer: () => { resolve({status: 'synced', message: completed(states.map(item => item.data)), copy: {states: () => states, get: entity => states.find(item => item.data.id === entity.id), close: () => { closed++; return Promise.resolve(); }}}); },
    refuse: (code: Parameters<typeof errorBody>[0] = 'forbidden') => { resolve({status: 'rejected', requestId: 'synthetic-sync', error: errorBody(code)}); },
    counts: () => ({closed, calls}),
  };
}

void test('replacement commits complete membership and live removals remove the card record', async () => {
  const owner = fixture(), views: TidbytView[] = [];
  const stop = followTidbyt(owner.sync, record(), view => { views.push(view); });
  assert.equal(views.at(-1)?.live, false); assert.equal(views.at(-1)?.device?.id, 'tidbyt');
  await owner.change({type: 'synced', message: completed()});
  assert.equal(views.at(-1)?.live, false, 'initial completion alone cannot promote retained membership');
  owner.answer(); await flush();
  assert.equal(views.at(-1)?.live, true); assert.equal(views.at(-1)?.device, undefined, 'empty replacement drops the saved record');
  await owner.change({type: 'updated', entity: {family: 'device', id: 'tidbyt'}, message: message(record())});
  assert.equal(views.at(-1)?.device?.id, 'tidbyt');
  await owner.change({type: 'removed', entity: {family: 'device', id: 'tidbyt'}});
  assert.equal(views.at(-1)?.device, undefined);
  owner.replace([record()]); await owner.change({type: 'synced', message: completed([record()])});
  assert.equal(views.at(-1)?.device?.id, 'tidbyt');
  stop(); assert.deepEqual(owner.counts(), {closed: 1, calls: 1});
});

void test('a late copy is closed after unmount without updating the removed view', async () => {
  const owner = fixture([record()]), views: TidbytView[] = [];
  const stop = followTidbyt(owner.sync, undefined, view => { views.push(view); });
  stop(); const before = views.length; owner.answer(); await flush();
  await owner.change({type: 'updated', entity: {family: 'device', id: 'tidbyt'}, message: message(record())});
  assert.equal(views.length, before); assert.deepEqual(owner.counts(), {closed: 1, calls: 1});
});

void test('failed sync stays stale, preserves the registry code and retry is a new read', async () => {
  const owner = fixture([record()]), views: TidbytView[] = [];
  const stop = followTidbyt(owner.sync, undefined, view => { views.push(view); });
  owner.answer(); await flush(); await owner.change({type: 'failed', error: errorBody('forbidden')});
  assert.equal(views.at(-1)?.live, false); assert.equal(views.at(-1)?.error, 'forbidden');
  await owner.change({type: 'synced', message: completed()}); assert.equal(views.at(-1)?.live, false);
  stop(); const retry = fixture(); const end = followTidbyt(retry.sync, views.at(-1)?.device, view => { views.push(view); });
  retry.refuse(); await flush(); assert.equal(views.at(-1)?.device?.id, 'tidbyt'); assert.equal(views.at(-1)?.error, 'forbidden'); end();
  assert.deepEqual(owner.counts(), {closed: 1, calls: 1}); assert.equal(retry.counts().calls, 1);
});

/** A manual scheduler: each pending delay waits until the test fires it. */
function clock() {
  const timers: {delayMs: number; run: () => void; cancelled: boolean}[] = [];
  return {
    scheduler: {after: (delayMs: number, run: () => void) => {
      const timer = {delayMs, run, cancelled: false}; timers.push(timer);
      return () => { timer.cancelled = true; };
    }},
    pending: () => timers.filter(timer => !timer.cancelled).map(timer => timer.delayMs),
    fire: async () => {
      const timer = timers.find(item => !item.cancelled); assert.ok(timer, 'a retry is scheduled');
      timer.cancelled = true; timer.run(); await flush();
    },
  };
}

/** Each read is a new fixture, as each call opens a new copy through the shell. */
function reads() {
  const all: ReturnType<typeof fixture>[] = [];
  return {sync: (handler: SyncHandler<DeviceRecord>) => { const next = fixture([record()]); all.push(next); return next.sync(handler); }, all};
}

void test('a refused read is repeated without Retry after 1 s, doubling to 30 s, until a complete snapshot is current', async () => {
  const owner = reads(), time = clock(), views: TidbytView[] = [];
  const stop = followTidbyt(owner.sync, record(), view => { views.push(view); }, time.scheduler);
  const delays: number[] = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    owner.all.at(-1)?.refuse('unavailable'); await flush();
    assert.equal(views.at(-1)?.live, false); assert.equal(views.at(-1)?.error, 'unavailable');
    assert.equal(views.at(-1)?.device?.id, 'tidbyt', 'saved evidence stays, marked stale');
    delays.push(...time.pending()); await time.fire();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  owner.all.at(-1)?.answer(); await flush();
  assert.equal(views.at(-1)?.live, true); assert.equal(views.at(-1)?.error, undefined);
  assert.deepEqual(time.pending(), [], 'a following copy schedules nothing');
  assert.equal(owner.all.length, 8);
  stop(); assert.deepEqual(owner.all.at(-1)?.counts(), {closed: 1, calls: 1});
});

void test('a copy that fails while connected is read again, its backoff restarts after success and unmount cancels it', async () => {
  const owner = reads(), time = clock(), views: TidbytView[] = [];
  const stop = followTidbyt(owner.sync, undefined, view => { views.push(view); }, time.scheduler);
  owner.all[0]?.answer(); await flush(); assert.equal(views.at(-1)?.live, true);
  await owner.all[0]?.change({type: 'failed', error: errorBody('unavailable')});
  assert.equal(views.at(-1)?.live, false); assert.equal(views.at(-1)?.error, 'unavailable');
  assert.deepEqual(owner.all[0]?.counts(), {closed: 1, calls: 1}, 'the failed copy is released');
  await owner.all[0]?.change({type: 'synced', message: completed([record()])}); assert.equal(views.at(-1)?.live, false, 'a failed copy cannot become current');
  assert.deepEqual(time.pending(), [1000]); await time.fire();
  owner.all[1]?.refuse('capacity'); await flush(); assert.deepEqual(time.pending(), [2000]); await time.fire();
  owner.all[2]?.answer(); await flush(); assert.equal(views.at(-1)?.live, true); assert.equal(views.at(-1)?.device?.id, 'tidbyt');
  await owner.all[2]?.change({type: 'failed', error: errorBody('unavailable')});
  assert.deepEqual(time.pending(), [1000], 'success restarts the backoff');
  stop(); assert.deepEqual(time.pending(), [], 'unmount cancels the pending read');
  assert.equal(owner.all.length, 3);
});

void test('a thrown read is repeated, while a refusal that cannot clear waits for Retry records', async () => {
  const time = clock(), views: TidbytView[] = [];
  let calls = 0;
  const stop = followTidbyt(() => { calls++; return Promise.reject(new TypeError('the request could not be built')); }, record(), view => { views.push(view); }, time.scheduler);
  await flush(); assert.equal(views.at(-1)?.error, 'unavailable'); assert.deepEqual(time.pending(), [1000]);
  await time.fire(); assert.equal(calls, 2); stop();
  const refused = reads(), held = clock();
  const end = followTidbyt(refused.sync, record(), view => { views.push(view); }, held.scheduler);
  refused.all[0]?.refuse('forbidden'); await flush();
  assert.equal(views.at(-1)?.error, 'forbidden'); assert.deepEqual(held.pending(), []); end();
  assert.equal(refused.all.length, 1);
});

void test('the read-only card distinguishes unknown transmission, cloud acceptance and stale evidence', () => {
  const show = (device: DeviceRecord, live: boolean, connected: boolean): string => renderToStaticMarkup(React.createElement(TidbytCard, {view: {device, live, pending: false, error: undefined}, connected, retry: () => { throw new Error('render cannot retry'); }}));
  const unknown = show(record(), true, true); assert.match(unknown, /No transmission recorded/); assert.match(unknown, /Illustration/);
  const accepted = show({...record(), availability: 'unavailable', lastTransmission: {status: 'known', transmittedAtMs: Date.parse('2026-10-17T12:00:00Z'), operationIds: ['push']}}, true, true);
  assert.match(accepted, /Cloud availability/); assert.match(accepted, /unavailable/); assert.match(accepted, /Push accepted/); assert.match(accepted, /2026-10-17T12:00:00.000Z/); assert.match(accepted, /Physical display unobserved/);
  assert.match(show(record(), true, false), /Saved cloud evidence · stale/);
  assert.doesNotMatch(accepted, /type="range"|Screen on|Play playlist/);
});

void test('a selected Tronbyt server\'s record names the server, and the card stays read-only with the panel unobserved', () => {
  const server: DeviceRecord = {...record(), capabilities: {...record().capabilities, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: true, values: ['rotation']}},
    lastTransmission: {status: 'known', transmittedAtMs: Date.parse('2026-11-03T12:00:00Z'), operationIds: ['push']}};
  const show = (live: boolean, connected: boolean): string => renderToStaticMarkup(React.createElement(TidbytCard, {view: {device: server, live, pending: false, error: undefined}, connected, retry: () => {}}));
  const current = show(true, true);
  for (const label of [/Current server evidence/, /Server availability/, /Latest server acceptance/, /Rotation is managed on the Tronbyt server/, /Physical display unobserved/, /Read only/]) assert.match(current, label);
  assert.doesNotMatch(current, /[Cc]loud|Tidbyt app/);
  assert.match(show(true, false), /Saved server evidence · stale/);
  assert.doesNotMatch(current, /type="range"|Screen on|Play playlist/);
});
