import assert from 'node:assert/strict';
import test from 'node:test';
import {directoryEntries} from '../src/directory.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';

void test('unknown and refused modules keep their declared pages without assuming a device or control', () => {
  const runtime: RuntimeData = {control: false, catalogFailed: false, copies: [], modules: [
    {name: 'new-module', state: 'refused', serves: [], pages: [{id: 'status', title: 'New status', path: '/modules/new-module/status', presentation: 'passive'}]},
    {name: 'missing-device', state: 'failed', serves: ['device'], pages: []},
  ]};
  const before = JSON.stringify(runtime);
  assert.deepEqual(directoryEntries(runtime), [
    {id: 'new-module', label: 'new-module', category: 'Other', state: 'refused', stale: false,
      links: [{label: 'New status', route: {kind: 'module', module: 'new-module', page: 'status'}}]},
    {id: 'missing-device', label: 'missing-device', category: 'Other', state: 'failed', stale: false, links: []},
  ]);
  assert.equal(JSON.stringify(runtime), before, 'projection does not mutate its owner copies');
  assert.deepEqual(directoryEntries({...runtime, modules: undefined, catalogFailed: true}), [], 'no inferred catalog fallback');
});

void test('the lighting brand and Audio pages are declared once within the catalog, and core pages remain reachable', () => {
  const runtime: RuntimeData = {control: true, catalogFailed: false, copies: [], modules: [
    {name: 'lifx', state: 'running', serves: ['device'], pages: []},
    {name: 'playback', state: 'running', serves: ['playback'], pages: []},
    {name: 'core', state: 'running', serves: [], pages: [{id: 'extra', title: 'Core extra', path: '/modules/core/extra', presentation: 'passive'}]},
  ]};
  const entries = directoryEntries(runtime);
  assert.deepEqual(entries.map(entry => entry.category), ['Lighting', 'Audio', 'Other']);
  assert.deepEqual(entries[0]?.links, [{label: 'LIFX', route: {kind: 'lighting-brand', brand: 'lifx'}}]);
  assert.deepEqual(entries[1]?.links, [{label: 'Audio', route: {kind: 'audio'}}]);
  assert.deepEqual(entries[2]?.links[0]?.route, {kind: 'module', module: 'core', page: 'extra'});
});
