import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const layout = () => ({rooms: [{id: 'studio', name: 'Studio'}], assignments: [{device: 'lamp-a', room: 'studio'}],
  groups: [{id: 'pair', name: 'Pair', scope: 'home', devices: ['lamp-a', 'lamp-b']}], home: [{kind: 'room', id: 'studio'}, {kind: 'group', id: 'pair'}]});
const envelope = (command = false) => ({specversion: '1.0', bunnyprofile: '2.0', id: 'layout-test', source: command ? 'bunny/core' : 'bunny/core',
  type: command ? 'org.bunny.lighting-layout.set.requested' : 'org.bunny.lighting-layout.updated', subject: 'lighting',
  time: '2026-10-17T12:00:00.000Z', kind: command ? 'command' : 'state', datacontenttype: 'application/json',
  dataschema: `https://bunny.invalid/events/${command ? 'lighting-layout-set' : 'lighting-layout'}/2.0`,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  ...(command ? {expiresat: '2026-10-17T12:00:10.000Z'} : {}),
  data: command ? {requestId: 'layout-test', expectedRevision: 0, layout: layout()} : {id: 'lighting', revision: 1, layout: layout()}});
const validator = () => {const value = new MessageValidator(); registerCoreFamilies(value); return value;};

test('lighting state and guarded replacement use the registered profile and contain only bounded metadata', () => {
  const v = validator();
  for (const command of [false, true]) {
    const message = envelope(command), before = structuredClone(message), result = v.validate(message);
    assert.equal(result.ok, true, JSON.stringify(result));assert.deepEqual(message, before);
  }
});

test('layout rejects invalid references, duplicate identities, overlap, stale shape and excessive bounds', () => {
  const v = validator();
  for (const mutate of [
    data => {data.layout.rooms.push({id: 'studio', name: 'Duplicate'});},
    data => {data.layout.assignments[0].room = 'missing';},
    data => {data.layout.assignments.push({device: 'lamp-a', room: 'studio'});},
    data => {data.layout.groups[0].devices = ['lamp-a', 'lamp-a'];},
    data => {data.layout.groups.push({id: 'other', name: 'Other', scope: 'home', devices: ['lamp-b', 'lamp-c']});},
    data => {data.layout.home.push({kind: 'room', id: 'missing'});},
    data => {data.layout.home.push({kind: 'device', id: 'lamp-a'});},
    data => {data.layout.home.push({kind: 'group', id: 'pair'});},
    data => {data.layout.rooms[0].name = 'line\nbreak';},
    data => {data.layout.rooms[0].name = ' ';},
    data => {data.layout.rooms[0].name = 'sk-' + 'x'.repeat(30);},
    data => {data.layout.rooms = Array.from({length: 33}, (_, i) => ({id: `r-${i}`, name: 'Room'}));},
    data => {data.layout.address = '192.0.2.10';},
    data => {delete data.expectedRevision;},
  ]) {
    const message = envelope(true);mutate(message.data);assert.equal(v.validate(message).ok, false, String(mutate));
  }
  const badSubject = envelope();badSubject.subject = 'another';assert.equal(v.validate(badSubject).ok, false);
});

test('a device can belong to different view groups while Home cannot duplicate its own targets', () => {
  const message = envelope(true);message.data.layout.groups.push({id: 'brand-pair', name: 'Brand pair', scope: 'brand-lifx', devices: ['lamp-a', 'lamp-b']});
  assert.equal(validator().validate(message).ok, true);
});
