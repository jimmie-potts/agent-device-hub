// The Devices menu's model (Hub #1889, #1950): a projection of the hardware inventory, with no reads or commands of its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import {DEVICE_MENU_COLUMNS, deviceMenu, menuStep, openGroup, type DeviceMenuCategory} from '../src/device-menu.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';
import {routeHash} from '../src/routes.ts';
import {hardwareRuntime} from './hardware-fixture.ts';

const runtime = hardwareRuntime;
const lines = (menu: DeviceMenuCategory[][]): string[][] => menu.map(column => column.flatMap(group => [group.category.toUpperCase(), ...group.modules.flatMap(module => [
  ...(module.heading || module.expandable ? [`${module.expandable ? '> ' : ''}${module.label}${module.note === '' ? '' : ` · ${module.note}`}`] : []),
  ...module.items.map(item => `${module.heading || module.expandable ? '  ' : ''}${item.label} -> ${routeHash(item.route)}`)])]));

void test('the menu lists the configured hardware in two columns, with each lighting brand over its overview and lights', () => {
  const before = JSON.stringify(runtime);
  assert.deepEqual(lines(deviceMenu(runtime)), [[
    'DISPLAYS', 'Pixoo -> #/component/pixoo-1', 'Tidbyt · stale', '  Tidbyt -> #/component/tidbyt',
  ], [
    'LIGHTING', '> LIFX', '  Pendant 1 -> #/component/pendant-1', '  Shelf strip -> #/component/strip', '  LIFX overview -> #/lights/lifx',
    '> Nanoleaf', '  Lines -> #/component/wall', '  Panels -> #/component/nl22', '  Nanoleaf overview -> #/lights/nanoleaf',
    'APPLIANCES', 'Wemo', '  Desk Plug -> #/component/desk-plug', '  Shelf plug -> #/component/shelf-plug', 'MicroDuck -> #/module/microduck/controls',
  ]], 'Pixoo and Tidbyt have one entry each, and no companion, art, Wispr or Music page is listed');
  assert.equal(JSON.stringify(runtime), before, 'the projection does not change the runtime copies');
  assert.deepEqual(DEVICE_MENU_COLUMNS, [['Displays'], ['Lighting', 'Appliances']], 'the prototype\'s columns');
});

void test('a module that is not running is named with its state and offers no item', () => {
  const stopped = deviceMenu({...runtime, modules: runtime.modules?.map(module => module.name === 'lifx' || module.name === 'pixoo' ? {...module, state: 'stopped'} : module)});
  assert.deepEqual(stopped[1]?.[0]?.modules[0], {id: 'lifx', label: 'LIFX', note: 'stopped', heading: true, expandable: false, items: []}, 'a stopped brand keeps its place, cannot be expanded and has no link');
  assert.deepEqual(stopped[0]?.[0]?.modules[0], {id: 'pixoo', label: 'Pixoo', note: 'stopped', heading: true, expandable: false, items: []});
});

void test('a running module with stale observations keeps its items and says so', () => {
  const stale = deviceMenu(runtime)[0]?.find(group => group.category === 'Displays')?.modules[1];
  assert.deepEqual(stale, {id: 'tidbyt', label: 'Tidbyt', note: 'stale', heading: true, expandable: false, items: [{label: 'Tidbyt', route: {kind: 'component', id: 'tidbyt'}}]});
  const brand = deviceMenu({...runtime, copies: runtime.copies.map(copy => copy.owner === 'bunny/modules/lifx' ? {...copy, synced: false} : copy)})[1]?.[0]?.modules[0];
  assert.deepEqual([brand?.note, brand?.expandable, brand?.items.length], ['stale', true, 3], 'a brand with stale observations still expands to its lights');
});

void test('the brand that holds the open page starts expanded', () => {
  const menu = deviceMenu(runtime);
  assert.equal(openGroup(menu, {kind: 'component', id: 'nl22'}), 'nanoleaf');
  assert.equal(openGroup(menu, {kind: 'lighting-brand', brand: 'lifx'}), 'lifx');
  assert.equal(openGroup(menu, {kind: 'component', id: 'pixoo-1'}), undefined, 'a page outside the brands opens none');
  assert.equal(openGroup(menu, {kind: 'module', module: 'nanoleaf', page: 'wall'}), undefined, 'a brand\'s task page is not one of its entries');
});

void test('a category with nothing to show is left out, and so is a column', () => {
  const only: RuntimeData = {control: true, catalogFailed: false, copies: [], modules: [{name: 'wemo', state: 'running', serves: ['device'], pages: []}]};
  assert.deepEqual(lines(deviceMenu({...only, copies: [{owner: 'bunny/modules/wemo', family: 'device', synced: true, records: [{id: 'desk-plug', kind: 'wemo'}]}] as unknown as RuntimeData['copies']})),
    [['APPLIANCES', 'Wemo -> #/component/desk-plug']], 'a module with one device is that device, under the module\'s name');
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
