// The names the navigation gives devices (Hub #1950): a published name, then a Nanoleaf kind, then the stable ID read as words.
import assert from 'node:assert/strict';
import test from 'node:test';
import {deviceName, nameOf, namedDevices, readableId} from '../src/device-names.ts';
import type {RuntimeData} from '../src/runtime-feeds.ts';

void test('a stable ID reads as words', () => {
  assert.equal(readableId('pendant-1'), 'Pendant 1');
  assert.equal(readableId('desk_lamp.left'), 'Desk Lamp Left');
  assert.equal(readableId('beam'), 'Beam');
  assert.equal(readableId('nl22'), 'NL22', 'a short model name is written in capitals');
  assert.equal(readableId('a19-hall'), 'A19 Hall');
  assert.equal(readableId('--'), '--', 'an ID with no words is shown as it is');
});

void test('a published name comes first, then the observed Nanoleaf kind, then the ID', () => {
  assert.equal(deviceName({id: 'pendant-1', label: 'Hall pendant'}), 'Hall pendant');
  assert.equal(deviceName({id: 'pendant-1', label: '  '}), 'Pendant 1', 'a blank label is no name');
  assert.equal(deviceName({id: 'wall'}, {kind: 'lines'}), 'Lines');
  assert.equal(deviceName({id: 'nl22'}, {kind: 'panels'}), 'Panels');
  assert.equal(deviceName({id: 'wall', label: 'Studio wall'}, {kind: 'lines'}), 'Studio wall', 'a published name wins over the kind');
});

void test('two devices that would share a name are told apart by their IDs', () => {
  const runtime = {copies: [
    {owner: 'bunny/modules/nanoleaf', family: 'device', synced: true, records: [{id: 'left', kind: 'nanoleaf'}, {id: 'right', kind: 'nanoleaf'}, {id: 'nl22', kind: 'nanoleaf'}, {id: 'left', kind: 'nanoleaf'}]},
    {owner: 'bunny/modules/nanoleaf', family: 'nanoleaf-wall', synced: false, records: [{id: 'left', kind: 'lines'}, {id: 'right', kind: 'lines'}, {id: 'nl22', kind: 'panels'}]},
    {owner: 'bunny/modules/lifx', family: 'device', synced: true, records: [{id: 'lamp', kind: 'lifx'}]},
  ]} as unknown as Pick<RuntimeData, 'copies'>;
  assert.deepEqual(namedDevices(runtime, 'bunny/modules/nanoleaf').map(device => `${device.record.id}=${device.name}`), ['left=Lines (Left)', 'right=Lines (Right)', 'nl22=Panels'],
    'each device once, in record order, with stale wall records still naming the kind');
  assert.deepEqual(namedDevices(runtime, 'bunny/modules/lifx').map(device => device.name), ['Lamp'], 'another owner\'s walls name nothing');
});

void test('a device page is named as the navigation names it', () => {
  const runtime = {copies: [
    {owner: 'bunny/modules/nanoleaf', family: 'device', synced: true, records: [{id: 'wall', kind: 'nanoleaf'}]},
    {owner: 'bunny/modules/nanoleaf', family: 'nanoleaf-wall', synced: true, records: [{id: 'wall', kind: 'lines'}]},
  ]} as unknown as Pick<RuntimeData, 'copies'>;
  assert.equal(nameOf(runtime, 'wall'), 'Lines');
  assert.equal(nameOf(runtime, 'not-held'), 'Not Held', 'an ID no record holds is read as words');
});
