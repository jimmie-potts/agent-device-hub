import assert from 'node:assert/strict';
import test from 'node:test';
import {device} from './devices.test.ts';
import {cardsFor, groupCards, groupPower, ungroupCard, lightCapabilities, prepareLighting, lightingDevices, emptyLightingLayout} from '../src/lighting.ts';
import type {LightingDevice, PlugDevice} from '../src/lighting.ts';
const lamp = (id: string): LightingDevice => ({record: {...device, id, kind: 'lifx'}, owner: 'bunny/modules/lifx', live: true});
void test('a room resolves current assignments and keeps missing references visible', () => {
  const layout = {...emptyLightingLayout(), rooms: [{id: 'studio', name: 'Studio'}], assignments: [{device: 'a', room: 'studio'}, {device: 'missing', room: 'studio'}], home: [{kind: 'room' as const, id: 'studio'}]};
  const cards = cardsFor('home', layout, [lamp('a')]);
  assert.deepEqual(cards[0]?.members, ['a', 'missing']);
  const first = cards[0];
  assert.match(lightCapabilities(first.members, [lamp('a')], true, true).blocked ?? '', /unavailable/);
  assert.equal(cardsFor('room-studio', {...layout, assignments: []}, [lamp('a')])[0]?.members.length, 0);
});
void test('grouping is scoped metadata, rejects cross-brand membership and ungroup restores selections', () => {
  const devices = [lamp('a'), lamp('b'), {...lamp('c'), owner: 'bunny/modules/nanoleaf', record: {...device, id: 'c'}}];
  const initial = emptyLightingLayout();
  const grouped = groupCards(initial, 'home', {kind: 'device', id: 'a'}, {kind: 'device', id: 'b'}, devices, 'pair');
  assert.equal(typeof grouped, 'object');
  if (typeof grouped === 'string') return;
  assert.equal(initial.groups.length, 0);
  assert.deepEqual(cardsFor('home', grouped, devices).map(card => card.members), [['a', 'b'], ['c']]);
  assert.deepEqual(cardsFor('brand-lifx', grouped, devices).map(card => card.members), [['a'], ['b']]);
  assert.equal(typeof groupCards(initial, 'brand-lifx', {kind: 'device', id: 'a'}, {kind: 'device', id: 'c'}, devices, 'bad'), 'string');
  assert.deepEqual(cardsFor('home', ungroupCard(grouped, 'pair'), devices).map(card => card.members), [['a'], ['b'], ['c']]);
});
void test('all members must be writable and support an action before any guarded request is prepared', () => {
  const devices = [lamp('a'), lamp('b')];
  let next = 0;
  const result = prepareLighting(['a', 'b'], devices, {family: 'power-set', data: {on: false}}, true, true, new Set(), () => `r${++next}`);
  assert.equal(typeof result, 'object');
  if (typeof result === 'string') return;
  assert.deepEqual(result.map(action => [action.target, action.requestId, ('expectedConfigurationRevision' in action.data ? action.data.expectedConfigurationRevision : undefined)]), [['a', 'r1', 3], ['b', 'r2', 3]]);
  assert.equal(typeof prepareLighting(['a', 'b'], devices, {family: 'power-set', data: {on: false}}, true, true, new Set(['b']), () => 'never'), 'string');
  assert.equal(typeof prepareLighting(['a', 'missing'], devices, {family: 'power-set', data: {on: false}}, true, true, new Set(), () => 'never'), 'string');
  assert.equal(typeof prepareLighting(['a'], devices, {family: 'power-set', data: {on: false}}, true, false, new Set(), () => 'never'), 'string');
  assert.equal(lightCapabilities(['a', 'b'], [lamp('a'), {...lamp('b'), live: false}], true, true).power, false);
});
void test('LIFX color and temperature require their owner copy and preserve per-device guards', () => {
  const a = lamp('a');
  const color = {id: 'a', revision: 5, capabilities: {color: {supported: true}, temperature: {supported: true, minimum: 1500, maximum: 9000}}, observed: {status: 'unknown'}} as const;
  const known = {...a, color, colorLive: true};
  assert.equal(lightCapabilities(['a'], [known], true, true).color, true);
  const action = prepareLighting(['a'], [known], {family: 'lifx-color-set', data: {hue: 120, saturation: 70}}, true, true, new Set(), () => 'color');
  assert.equal(typeof action, 'object');
  if (typeof action !== 'string') assert.deepEqual(action[0]?.data, {hue: 120, saturation: 70, expectedConfigurationRevision: 3, expectedGeneration: a.record.generation});
  assert.equal(typeof prepareLighting(['a'], [a], {family: 'lifx-color-set', data: {hue: 120, saturation: 70}}, true, true, new Set(), () => 'never'), 'string');
  assert.equal(typeof prepareLighting(['a'], [known], {family: 'lifx-temperature-set', data: {kelvin: 9001}}, true, true, new Set(), () => 'never'), 'string');
});
void test('module lighting copies never attach to another owner or duplicate device identity', () => {
  const records = lightingDevices([{owner: 'bunny/modules/lifx', family: 'device', synced: true, records: [lamp('a').record]}, {owner: 'bunny/modules/other', family: 'lifx-light', synced: true, records: [{id: 'a'} as never]}], true);
  assert.equal(records[0]?.color, undefined);
  assert.equal(lightCapabilities(['a'], [...records, ...records], true, true).power, false);
});
void test('native scene groups intersect IDs and never switch status-owned modes implicitly', () => {
  const a = lamp('a'), b = {...lamp('b'), record: {...device, id: 'b'}};
  assert.deepEqual(lightCapabilities(['a', 'b'], [a, b], true, true).scenes, []);
  const free = {...b, record: {...b.record, desired: {...b.record.desired, mode: {status: 'known' as const, value: 'free'}}}};
  assert.deepEqual(lightCapabilities(['a', 'b'], [a, free], true, true).scenes, ['rain']);
  assert.deepEqual(lightCapabilities(['a', 'b'], [{...a, record: {...a.record, capabilities: {...a.record.capabilities, scenes: {supported: true, sceneIds: ['other']}}}}, free], true, true).scenes, []);
});
void test('regrouping selected individuals retires overlapping hidden Home membership only', () => {
  const devices = [lamp('a'), lamp('b'), lamp('c'), lamp('d')];
  const layout = {...emptyLightingLayout(), groups: [
    {id: 'hidden', name: 'Hidden', scope: 'home', devices: ['a', 'b', 'c']},
    {id: 'brand', name: 'Brand', scope: 'brand-lifx', devices: ['a', 'b']},
  ], home: [{kind: 'device' as const, id: 'a'}, {kind: 'device' as const, id: 'd'}]};
  const next = groupCards(layout, 'home', {kind: 'device', id: 'a'}, {kind: 'device', id: 'd'}, devices, 'new');
  assert.notEqual(typeof next, 'string'); if (typeof next === 'string') return;
  assert.deepEqual(next.groups.find(group => group.id === 'hidden')?.devices, ['b', 'c']);
  assert.deepEqual(next.groups.find(group => group.id === 'brand')?.devices, ['a', 'b']);
  const selected = {...next, home: [{kind: 'device' as const, id: 'b'}, {kind: 'device' as const, id: 'c'}]};
  const pair = groupCards(selected, 'home', {kind: 'device', id: 'b'}, {kind: 'device', id: 'c'}, devices, 'pair');
  assert.notEqual(typeof pair, 'string'); if (typeof pair === 'string') return;
  assert.equal(pair.groups.some(group => group.id === 'hidden'), false);
  assert.equal(new Set(pair.groups.filter(group => group.scope === 'home').flatMap(group => group.devices)).size,
    pair.groups.filter(group => group.scope === 'home').flatMap(group => group.devices).length);
});
void test('persisted brand groups require current brand membership before rendering or preparing shared commands', () => {
  const devices = [lamp('a'), {...lamp('b'), owner: 'bunny/modules/nanoleaf', record: {...device, id: 'b'}}];
  const layout = {...emptyLightingLayout(), groups: [{id: 'changed', name: 'Changed', scope: 'brand-lifx', devices: ['a', 'b']}]};
  const card = cardsFor('brand-lifx', layout, devices)[0]; assert.ok(card !== undefined);
  assert.equal(card.brand, 'lifx');
  assert.equal(lightCapabilities(card.members, devices, true, true, new Set(), card.brand).power, false);
  assert.equal(typeof prepareLighting(card.members, devices, {family: 'power-set', data: {on: false}}, true, true, new Set(), () => 'must-not-send', card.brand), 'string');
  assert.equal(typeof prepareLighting(card.members, devices, {family: 'power-set', data: {on: false}}, true, true, new Set(), () => 'home-allowed'), 'object', 'Home and rooms still allow cross-brand control');
});

// Hub #1933: lights and plugs group on Home. A plug member stays in the group's devices and is named in its plugs.
const WEMO = 'bunny/modules/wemo';
const plug = (id: string, rest: Partial<PlugDevice> = {}): PlugDevice => ({record: {...device, id, kind: 'wemo',
  capabilities: {...device.capabilities, brightness: {supported: false}, scenes: {supported: false}},
  observed: {status: 'known', observedAtMs: 1_000, power: {status: 'known', value: true}, brightness: {status: 'unknown'}}}, owner: WEMO, live: true, ...rest});
const plugUnit = (id: string) => ({kind: 'plug' as const, id, owner: WEMO});
void test('a light and a plug, or two plugs, group on Home with the plug members named', () => {
  const lights = [lamp('a'), lamp('b')], plugs = [plug('p1'), plug('p2')];
  const shown = [{kind: 'device' as const, id: 'a'}, {kind: 'device' as const, id: 'b'}];
  const mixed = groupCards(emptyLightingLayout(), 'home', {kind: 'device', id: 'a'}, plugUnit('p1'), lights, 'mix', shown, plugs);
  assert.equal(typeof mixed, 'object');if (typeof mixed === 'string') return;
  assert.deepEqual(mixed.groups, [{id: 'mix', name: 'Group', scope: 'home', devices: ['a', 'p1'], plugs: [{device: 'p1', owner: WEMO}]}]);
  assert.deepEqual(mixed.home, [{kind: 'group', id: 'mix'}, {kind: 'device', id: 'b'}]);
  const pair = groupCards(emptyLightingLayout(), 'home', plugUnit('p1'), plugUnit('p2'), lights, 'pair', shown, plugs);
  assert.equal(typeof pair, 'object');if (typeof pair === 'string') return;
  assert.deepEqual(pair.groups, [{id: 'pair', name: 'Plug group', scope: 'home', devices: ['p1', 'p2'], plugs: [{device: 'p1', owner: WEMO}, {device: 'p2', owner: WEMO}]}]);
  assert.deepEqual(pair.home, [...shown, {kind: 'group', id: 'pair'}]);
  // A plug joins an existing group: the group's members come first and its plugs are kept.
  const grown = groupCards(mixed, 'home', {kind: 'group', id: 'mix'}, plugUnit('p2'), lights, 'grown', [{kind: 'group', id: 'mix'}, {kind: 'device', id: 'b'}], plugs);
  assert.equal(typeof grown, 'object');if (typeof grown === 'string') return;
  assert.deepEqual(grown.groups, [{id: 'grown', name: 'Group', scope: 'home', devices: ['a', 'p1', 'p2'], plugs: [{device: 'p1', owner: WEMO}, {device: 'p2', owner: WEMO}]}]);
  // Ungrouping returns only the lights to the lighting Home selection; each plug keeps its own Home card.
  assert.deepEqual(ungroupCard(grown, 'grown').home, [{kind: 'device', id: 'a'}, {kind: 'device', id: 'b'}]);
  assert.equal(ungroupCard(grown, 'grown').groups.length, 0);
});
void test('a plug groups only on Home and only when it is shown there', () => {
  const lights = [lamp('a')], plugs = [plug('p1')];
  assert.equal(typeof groupCards(emptyLightingLayout(), 'brand-lifx', {kind: 'device', id: 'a'}, plugUnit('p1'), lights, 'x', undefined, plugs), 'string');
  assert.equal(typeof groupCards(emptyLightingLayout(), 'home', {kind: 'device', id: 'a'}, plugUnit('p9'), lights, 'x', [{kind: 'device', id: 'a'}], plugs), 'string');
  assert.equal(typeof groupCards(emptyLightingLayout(), 'home', plugUnit('p1'), plugUnit('p1'), lights, 'x', [], plugs), 'string');
});
void test('a lighting command is never built for a plug member: the card is refused whole, as in a release that knows no plugs', () => {
  const result = prepareLighting(['a', 'p1'], [lamp('a')], {family: 'power-set', data: {on: false}}, true, true, new Set(), () => 'never');
  assert.equal(typeof result, 'string');if (typeof result === 'string') assert.match(result, /unavailable/);
});
void test('All on or All off gives each member its own existing power command with its own guards', () => {
  const lights = [lamp('a'), {...lamp('b'), live: false}], plugs = [plug('p1'), plug('p2', {record: {...plug('p2').record, held: {requestId: 'old'}} as PlugDevice['record']})];
  const group = {devices: ['a', 'b', 'p1', 'p2'], plugs: [{device: 'p1', owner: WEMO}, {device: 'p2', owner: WEMO}]};
  let next = 0;
  const result = groupPower(group, lights, plugs, false, {control: true, operationsLive: true, locks: new Set(), now: 2_000}, () => `r${++next}`);
  assert.deepEqual(result.map(item => [item.target, typeof item.action === 'string' ? 'refused' : item.action.family]), [['a', 'power-set'], ['b', 'refused'], ['p1', 'power-set'], ['p2', 'refused']]);
  const sent = result[2]?.action;assert.ok(typeof sent === 'object');
  assert.deepEqual(sent, {family: 'power-set', target: 'p1', requestId: 'r2', data: {on: false, expectedConfigurationRevision: 3, expectedGeneration: device.generation}});
  for (const item of groupPower(group, lights, plugs, true, {control: false, operationsLive: true, locks: new Set(), now: 2_000}, () => 'never')) assert.equal(typeof item.action, 'string');
});
void test('grouping on Home keeps every other Home selection, rooms included (#1972 review)', () => {
  const lights = [lamp('a'), lamp('b')], plugs = [plug('p1')];
  const layout = {...emptyLightingLayout(), rooms: [{id: 'studio', name: 'Studio'}]};
  const shown = [{kind: 'device' as const, id: 'a'}, {kind: 'room' as const, id: 'studio'}, {kind: 'device' as const, id: 'b'}];
  for (const [first, second] of [[{kind: 'device', id: 'b'}, {kind: 'device', id: 'a'}], [plugUnit('p1'), {kind: 'device', id: 'b'}]] as const) {
    const next = groupCards(layout, 'home', first, second, lights, 'g', shown, plugs);
    assert.equal(typeof next, 'object');if (typeof next === 'string') return;
    assert.equal(next.home?.some(item => item.kind === 'room' && item.id === 'studio'), true, `the room stays after grouping ${first.id} with ${second.id}`);
  }
});
