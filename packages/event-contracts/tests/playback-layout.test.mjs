import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const assignments = () => [{playback: 'shared-music', rooms: ['studio', 'kitchen']}];
const envelope = (command = false) => ({specversion: '1.0', bunnyprofile: '2.0', id: 'playback-layout-test', source: 'bunny/core',
  type: command ? 'org.bunny.playback-layout.set.requested' : 'org.bunny.playback-layout.updated', subject: 'playback',
  time: '2026-10-17T12:00:00.000Z', kind: command ? 'command' : 'state', datacontenttype: 'application/json',
  dataschema: `https://bunny.invalid/events/${command ? 'playback-layout-set' : 'playback-layout'}/2.0`,
  traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  ...(command ? {expiresat: '2026-10-17T12:00:10.000Z'} : {}),
  data: command ? {requestId: 'playback-layout-test', expectedRevision: 0, assignments: assignments()} : {id: 'playback', revision: 1, assignments: assignments()}});
const validator = () => {const value = new MessageValidator();registerCoreFamilies(value);return value;};

test('playback layout registers bounded state and revision-guarded replacement without device effects', () => {
  const v = validator();
  for (const command of [false, true]) {
    const message = envelope(command), before = structuredClone(message);
    assert.equal(v.validate(message).ok, true);assert.deepEqual(message, before);
  }
});

test('playback layout rejects duplicate targets, duplicate rooms, private fields and invalid bounds', () => {
  const v = validator();
  for (const mutate of [
    data => {data.assignments.push(assignments()[0]);},
    data => {data.assignments[0].rooms.push('studio');},
    data => {data.assignments[0].playback = '../speaker';},
    data => {data.assignments[0].rooms = Array.from({length: 33}, (_, i) => `r-${i}`);},
    data => {data.assignments = Array.from({length: 65}, (_, i) => ({playback: `p-${i}`, rooms: []}));},
    data => {data.assignments[0].address = '192.0.2.1';},
    data => {data.assignments[0].roomName = 'Private room';},
    data => {delete data.expectedRevision;},
  ]) {
    const message = envelope(true);mutate(message.data);assert.equal(v.validate(message).ok, false, String(mutate));
  }
  const state = envelope();state.source = 'bunny/modules/playback';assert.equal(v.validate(state).ok, false);
  const wrong = envelope();wrong.subject = 'other';assert.equal(v.validate(wrong).ok, false);
});
