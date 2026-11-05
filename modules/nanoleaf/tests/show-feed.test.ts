import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {SyncedCopy, SyncCompleted, SyncHandler, SyncResult} from '@jimmie-potts/sdk/remote';
import type {ShowCatalog} from '../src/music-show-data.js';
import {followShows, type CatalogView} from '../src/frontend/show-feed.js';
import {test} from './support.js';

const common = {specversion: '1.0', bunnyprofile: '2.0', source: 'bunny/modules/nanoleaf', time: '2026-11-05T00:00:00.000Z',
  datacontenttype: 'application/json', traceparent: '00-11111111111111111111111111111111-1111111111111111-01'} as const;
const state: Message<ShowCatalog> = {...common, id: 'state', kind: 'state', type: 'org.bunny.nanoleaf-shows.updated', subject: 'shows',
  dataschema: 'https://bunny.invalid/events/nanoleaf-shows/2.0', data: {id: 'shows', revision: 2, shows: []}};
const completed: Message<SyncCompleted> = {...common, id: 'sync', kind: 'reply', type: 'org.bunny.sync.completed', subject: 'sync',
  dataschema: 'https://bunny.invalid/events/sync/2.0', data: {requestId: 'sync', revision: 2, members: [{family: 'nanoleaf-shows', id: 'shows'}]}};

test('a delayed initial sync result cannot make a restarted catalog live', async () => {
  let handler: SyncHandler<ShowCatalog> | undefined, restart: (() => void) | undefined, resolve: ((result: SyncResult<ShowCatalog>) => void) | undefined;
  const opening = new Promise<SyncResult<ShowCatalog>>(done => {resolve = done;});
  const views: CatalogView[] = [];
  let closed = 0;
  const copy: SyncedCopy<ShowCatalog> = {states: () => [state], get: () => state, close: () => {closed++; return Promise.resolve();}};
  const close = followShows((changed, options) => {handler = changed; restart = options.onRestarted; return opening;}, view => {views.push(view);});
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
  let resolve: ((result: SyncResult<ShowCatalog>) => void) | undefined;
  const opening = new Promise<SyncResult<ShowCatalog>>(done => {resolve = done;});
  const views: CatalogView[] = []; let closed = 0;
  const copy: SyncedCopy<ShowCatalog> = {states: () => [state], get: () => state, close: () => {closed++; return Promise.resolve();}};
  const close = followShows(() => opening, view => {views.push(view);});
  close(); assert.ok(resolve !== undefined); resolve({status: 'synced', copy, message: completed});
  await opening; await Promise.resolve();
  assert.equal(closed, 1); assert.equal(views.length, 1); assert.equal(views[0]?.live, false);
});
