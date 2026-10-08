import assert from 'node:assert/strict';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {RemoteParticipant, SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {RuntimeFeeds, type RuntimeData, type RuntimeRecord} from '../src/runtime-feeds.ts';
void test('named owners coexist; a gap keeps copies stale until their own replacement arrives, without commands', async context => {
  context.mock.method(globalThis, 'fetch', (path: string) => Promise.resolve(Response.json(path.includes('/modules') ? {
    schema: 'module-list/2.0', modules: [
      {name: 'core', state: 'running', serves: ['session', 'operation'], pages: []},
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
  assert.deepEqual(syncs, ['bunny/core:operation', 'bunny/modules/wall:device', 'bunny/modules/sign:device']);
  assert.equal(state?.copies.every(copy => copy.synced), true);
  feeds.hear({event: 'remote.disconnected', level: 'warn'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  feeds.hear({event: 'remote.reconnected', level: 'info'});
  assert.equal(state?.copies.every(copy => !copy.synced), true);
  handlers.get('bunny/modules/wall:device')?.({type: 'synced', message: {} as Message<{requestId: string; revision: number; members: []}>});
  assert.deepEqual(state?.copies.map(copy => [copy.owner, copy.synced]), [['bunny/core', false], ['bunny/modules/wall', true], ['bunny/modules/sign', false]]);
  assert.equal(syncs.length, 3, 'the page never requests a command or replays one');
  feeds.close();
});
