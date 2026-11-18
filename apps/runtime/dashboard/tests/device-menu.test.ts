// The Devices menu's model (Hub #1889): a projection of the Devices directory, with no reads or commands of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import {DEVICE_MENU_COLUMNS, deviceMenu, menuStep, type DeviceMenuCategory} from '../src/device-menu.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {routeHash} from '../src/routes.ts';

const runtime: RuntimeData = {control: true, catalogFailed: false, modules: [
  {name: 'lifx', state: 'running', serves: ['device'], pages: []},
  {name: 'nanoleaf', state: 'running', serves: ['device'], pages: [{id: 'wall', title: 'Wall', path: '/modules/nanoleaf/wall', presentation: 'react'}]},
  {name: 'tidbyt', state: 'running', serves: ['device'], pages: []},
  {name: 'playback', state: 'running', serves: ['playback'], pages: []},
  {name: 'speaker', state: 'running', serves: ['playback'], pages: []},
  {name: 'companions', state: 'running', serves: [], pages: [
    {id: 'assistant', title: 'Conversation', path: '/modules/companions/assistant', presentation: 'react'},
    {id: 'preferences', title: 'Preferences', path: '/modules/companions/preferences', presentation: 'react'},
  ]},
  {name: 'wispr', state: 'failed', serves: [], pages: [{id: 'analytics', title: 'Analytics', path: '/modules/wispr/analytics', presentation: 'react'}]},
  {name: 'roborock', state: 'running', serves: ['device'], pages: []},
], copies: [
  {owner: 'bunny/modules/tidbyt', family: 'device', synced: false, records: [{id: 'tidbyt', kind: 'tidbyt', label: 'Tidbyt'}]},
  {owner: 'bunny/modules/roborock', family: 'device', synced: true, records: [{id: 'vacuum', kind: 'roborock', label: 'Downstairs vacuum'}]},
] as unknown as RuntimeData['copies']};
const lines = (menu: DeviceMenuCategory[][]): string[][] => menu.map(column => column.flatMap(group => [group.category.toUpperCase(), ...group.modules.flatMap(module => [
  ...(module.heading ? [`${module.label}${module.note === '' ? '' : ` · ${module.note}`}`] : []), ...module.items.map(item => `${module.heading ? '  ' : ''}${item.label} -> ${routeHash(item.route)}`)])]));

void test('the menu lists every page the directory lists, in two columns, with each address once', () => {
  const before = JSON.stringify(runtime);
  assert.deepEqual(lines(deviceMenu(runtime)), [[
    'LIGHTING', 'LIFX -> #/lights/lifx', 'Nanoleaf', '  Overview -> #/lights/nanoleaf', '  Wall -> #/module/nanoleaf/wall',
    'DISPLAYS', 'Tidbyt · stale', '  Overview -> #/component/tidbyt',
    'AUDIO', 'Music -> #/audio',
  ], [
    'OTHER', 'Companions', '  Conversation -> #/module/companions/assistant', '  Preferences -> #/module/companions/preferences',
    'Wispr · failed', 'Roborock -> #/component/vacuum',
  ]]);
  assert.equal(JSON.stringify(runtime), before, 'the projection does not change the runtime copies');
  assert.deepEqual(DEVICE_MENU_COLUMNS, [['Lighting', 'Displays', 'Audio'], ['Other']]);
});

void test('a module that is not running is named with its state and offers no page', () => {
  const failed = deviceMenu(runtime)[1]?.[0]?.modules.find(module => module.id === 'wispr');
  assert.deepEqual(failed, {id: 'wispr', label: 'Wispr', note: 'failed', heading: true, items: []});
  const stopped = deviceMenu({...runtime, modules: runtime.modules?.map(module => module.name === 'lifx' ? {...module, state: 'stopped'} : module)});
  assert.deepEqual(stopped[0]?.[0]?.modules[0], {id: 'lifx', label: 'LIFX', note: 'stopped', heading: true, items: []}, 'a stopped module keeps its place and loses its link');
});

void test('a running module with stale observations keeps its pages and says so', () => {
  const stale = deviceMenu(runtime)[0]?.find(group => group.category === 'Displays')?.modules[0];
  assert.deepEqual(stale, {id: 'tidbyt', label: 'Tidbyt', note: 'stale', heading: true, items: [{label: 'Overview', route: {kind: 'component', id: 'tidbyt'}}]});
});

void test('a category with nothing to show is left out, and so is a column', () => {
  const only: RuntimeData = {control: true, catalogFailed: false, copies: [], modules: [{name: 'wispr', state: 'running', serves: [],
    pages: [{id: 'analytics', title: 'Analytics', path: '/modules/wispr/analytics', presentation: 'react'}]}]};
  assert.deepEqual(lines(deviceMenu(only)), [['OTHER', 'Wispr -> #/module/wispr/analytics']], 'a module with one page is that page, under the module\'s name');
  assert.deepEqual(deviceMenu({...only, modules: undefined}), [], 'nothing is listed until the catalog is read');
  assert.deepEqual(deviceMenu({...only, modules: undefined, catalogFailed: true}), [], 'a failed catalog invents no page');
});

void test('the arrow keys step through the items and wrap, and Home and End go to the ends', () => {
  assert.equal(menuStep('ArrowDown', 0, 3), 1);
  assert.equal(menuStep('ArrowDown', 2, 3), 0, 'down from the last item wraps to the first');
  assert.equal(menuStep('ArrowUp', 0, 3), 2, 'up from the first item wraps to the last');
  assert.equal(menuStep('ArrowUp', 2, 3), 1);
  assert.equal(menuStep('ArrowDown', -1, 3), 0, 'with focus on no item, down starts at the first');
  assert.equal(menuStep('ArrowUp', -1, 3), 2, 'and up starts at the last');
  assert.equal(menuStep('Home', 2, 3), 0);
  assert.equal(menuStep('End', 0, 3), 2);
  assert.equal(menuStep('ArrowRight', 0, 3), undefined, 'other keys are not the menu\'s');
  assert.equal(menuStep('ArrowDown', -1, 0), undefined, 'an empty menu has nowhere to go');
});
