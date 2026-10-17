import assert from 'node:assert/strict';
import test from 'node:test';
import {device} from './devices.test.ts';
import {cardsFor, groupCards, ungroupCard, lightCapabilities, prepareLighting, lightingDevices, emptyLightingLayout} from '../src/lighting.ts';
import type {LightingDevice} from '../src/lighting.ts';
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
