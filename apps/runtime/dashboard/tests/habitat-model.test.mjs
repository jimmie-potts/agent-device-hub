import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/habitat/model.js';
const model=createModel();
const {roomFor} = model;

test('music never pulls a working agent away from the workshop, including all ten agents', () => {
  const agents = Array.from({length: 10}, (_,id) => ({id, state: 'working'}));
  assert.deepEqual(agents.map(a => roomFor(a, true, 'dorm')), Array(10).fill('workshop'));
});

test('idle agents follow playback; blocked and unread agents keep their own destinations', () => {
  assert.equal(roomFor({state:'idle'}, false, 'workshop'), 'dorm');
  assert.equal(roomFor({state:'idle'}, true, 'workshop'), 'music');
  assert.equal(roomFor({state:'approval'}, true, 'workshop'), 'mail');
  assert.equal(roomFor({state:'input'}, true, 'workshop'), 'mail');
  assert.equal(roomFor({state:'finished'}, true, 'workshop'), 'mail');
});

test('unknown and interrupted evidence retains a room instead of becoming idle', () => {
  assert.equal(roomFor({state:'unknown'}, true, 'workshop'), 'workshop');
  assert.equal(roomFor({state:'interrupted'}, false, 'mail'), 'mail');
});
