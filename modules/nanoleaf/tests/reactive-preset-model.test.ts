import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {SyncedCopy, SyncCompleted, SyncHandler, SyncResult} from '@jimmie-potts/sdk/remote';
import type {ReactiveCatalog} from '../src/music-preset-data.js';
import {canSaveReactive, followReactivePresets, type ReactiveCatalogView} from '../src/frontend/reactive-preset-model.js';
import {test} from './support.js';

const common = {specversion: '1.0', bunnyprofile: '2.0', source: 'bunny/modules/nanoleaf', time: '2026-11-05T00:00:00.000Z',
  datacontenttype: 'application/json', traceparent: '00-11111111111111111111111111111111-1111111111111111-01'} as const;
const state: Message<ReactiveCatalog> = {...common, id: 'state', kind: 'state', type: 'org.bunny.nanoleaf-reactive-presets.updated', subject: 'reactive-presets',
  dataschema: 'https://bunny.invalid/events/nanoleaf-reactive-presets/2.0', data: {id: 'reactive-presets', revision: 2, presets: []}};
const completed: Message<SyncCompleted> = {...common, id: 'sync', kind: 'reply', type: 'org.bunny.sync.completed', subject: 'sync',
  dataschema: 'https://bunny.invalid/events/sync/2.0', data: {requestId: 'sync', revision: 2, members: [{family: 'nanoleaf-reactive-presets', id: 'reactive-presets'}]}};

test('a delayed initial sync result cannot make a restarted catalog live', async () => {
  let handler: SyncHandler<ReactiveCatalog> | undefined, restart: (() => void) | undefined, resolve: ((result: SyncResult<ReactiveCatalog>) => void) | undefined;
  const opening = new Promise<SyncResult<ReactiveCatalog>>(done => {resolve = done;});
  const views: ReactiveCatalogView[] = [];
  let closed = 0;
  const copy: SyncedCopy<ReactiveCatalog> = {states: () => [state], get: () => state, close: () => {closed++; return Promise.resolve();}};
  const close = followReactivePresets((changed, options) => {handler = changed; restart = options.onRestarted; return opening;}, view => {views.push(view);});
  assert.ok(handler !== undefined && restart !== undefined && resolve !== undefined);
  await handler({type: 'synced', message: completed});
  restart();
  resolve({status: 'synced', copy, message: completed});
  await opening; await Promise.resolve();
  assert.equal(views.at(-1)?.live, false);
  await handler({type: 'synced', message: completed});
  assert.equal(views.at(-1)?.live, true);
  close(); await Promise.resolve(); assert.equal(closed, 1);
});

test('closing before initial completion closes the late copy without publishing it', async () => {
  let resolve: ((result: SyncResult<ReactiveCatalog>) => void) | undefined;
  const opening = new Promise<SyncResult<ReactiveCatalog>>(done => {resolve = done;});
  const views: ReactiveCatalogView[] = []; let closed = 0;
  const copy: SyncedCopy<ReactiveCatalog> = {states: () => [state], get: () => state, close: () => {closed++; return Promise.resolve();}};
  const close = followReactivePresets(() => opening, view => {views.push(view);});
  close(); assert.ok(resolve !== undefined); resolve({status: 'synced', copy, message: completed});
  await opening; await Promise.resolve();
  assert.equal(closed, 1); assert.equal(views.length, 1); assert.equal(views[0]?.live, false);
});

test('save admission needs every current authority and refuses lock, capacity or an unchanged saved draft', () => {
  const allowed = {control: true, connected: true, catalogLive: true, operationsLive: true, locked: false, sending: false, valid: true, full: false, unchanged: false};
  assert.equal(canSaveReactive(allowed), true);
  for (const key of ['control', 'connected', 'catalogLive', 'operationsLive', 'valid'] as const) assert.equal(canSaveReactive({...allowed, [key]: false}), false);
  for (const key of ['locked', 'sending', 'full', 'unchanged'] as const) assert.equal(canSaveReactive({...allowed, [key]: true}), false);
});
