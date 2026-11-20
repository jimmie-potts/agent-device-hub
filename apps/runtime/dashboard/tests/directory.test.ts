// The hardware inventory (Hub #1950): configured hardware only, by category, with each brand's lights under it.
import assert from 'node:assert/strict';
import test from 'node:test';
import {directoryEntries, hardwareModule, type DirectoryEntry} from '../src/directory.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {routeHash} from '../src/routes.ts';
import {hardwareRuntime} from './hardware-fixture.ts';

const lines = (entries: readonly DirectoryEntry[]): string[] => entries.map(entry => `${entry.category} ${entry.label} <${entry.status}${entry.available ? '' : ', off'}>${entry.state === 'running' ? '' : ` [${entry.state}]`}: ${
  [...entry.overview === undefined ? [] : [entry.overview], ...entry.links].map(link => `${link.label} ${routeHash(link.route)}`).join(', ')}`);

void test('the inventory lists hardware only, each device once, with each light under its brand and task pages left inside', () => {
  const before = JSON.stringify(hardwareRuntime);
  assert.deepEqual(lines(directoryEntries(hardwareRuntime)), [
    'Lighting LIFX <2 lights>: LIFX overview #/lights/lifx, Pendant 1 #/component/pendant-1, Shelf strip #/component/strip',
    'Lighting Nanoleaf <2 lights>: Nanoleaf overview #/lights/nanoleaf, Lines #/component/wall, Panels #/component/nl22',
    'Displays Pixoo <Status unknown, off>: Pixoo 1 #/component/pixoo-1',
    'Displays Tidbyt <Stale, off>: Tidbyt #/component/tidbyt',
    'Appliances Wemo <2 devices>: Desk Plug #/component/desk-plug, Shelf plug #/component/shelf-plug',
    'Appliances MicroDuck <>: MicroDuck robot #/module/microduck/controls',
  ], 'companions, art, Wispr, Music and the core are not hardware; a module with no device records offers its first page');
  assert.equal(JSON.stringify(hardwareRuntime), before, 'the projection does not change the runtime copies');
});

void test('a hardware module that is down keeps its place and its state, and an unknown module that is not hardware is left out', () => {
  const runtime: RuntimeData = {control: false, catalogFailed: false, copies: [], modules: [
    {name: 'new-module', state: 'refused', serves: [], pages: [{id: 'status', title: 'New status', path: '/modules/new-module/status', presentation: 'passive'}]},
    {name: 'pixoo', state: 'failed', serves: [], pages: []},
    {name: 'gadget', state: 'running', serves: ['device'], pages: []},
  ]};
  assert.deepEqual(directoryEntries(runtime), [
    {id: 'pixoo', label: 'Pixoo', category: 'Displays', state: 'failed', stale: false, links: [], status: 'Failed', available: false},
  ], 'a running module with no devices and no pages has nothing to list');
  assert.deepEqual(directoryEntries({...runtime, modules: undefined, catalogFailed: true}), [], 'no inferred catalog fallback');
});

void test('a lighting brand keeps its overview while its lights have no records', () => {
  const runtime: RuntimeData = {control: true, catalogFailed: false, copies: [], modules: [{name: 'nanoleaf', state: 'running', serves: ['device'],
    pages: [{id: 'wall', title: 'Wall', path: '/modules/nanoleaf/wall', presentation: 'react'}]}]};
  assert.deepEqual(lines(directoryEntries(runtime)), ['Lighting Nanoleaf <0 lights>: Nanoleaf overview #/lights/nanoleaf'], 'the overview stands in for the lights, and the task page stays inside it');
});

void test('the shell asks which modules are hardware to place their pages', () => {
  const hardware = hardwareModule(hardwareRuntime);
  assert.deepEqual(['pixoo', 'nanoleaf', 'microduck', 'art', 'wispr', 'companions', 'not-listed'].map(hardware), [true, true, true, false, false, false, true],
    'a module the catalog does not list stays under Devices until it is known');
});
