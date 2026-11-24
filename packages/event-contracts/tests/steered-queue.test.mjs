// Steering a companion's running task (Hub #2031): steers a stopped or closed turn never read go back to the head of its
// conversation's queue even past the queue's limit of 8, so assistant-state/2.3 allows a queue of up to 16 messages.
// Everything here is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {coreFamilies, coreValidator} from '../dist/v2/families.js';

const BASE = 'https://bunny.invalid/events/';
const TIME = '2026-11-24T12:00:00.000Z';
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const schemaOf = id => coreFamilies.find(family => family.dataschema === `${BASE}${id}`)?.schema;
const valid = message => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;
const task = {taskId: 'task-1', conversationId: 'conversation-1', profile: 'bunny', status: 'cancelled', runId: 'run-1', questionId: null, hasAnswer: false,
  code: null, modelCalls: 1, toolCalls: 0, questions: 0, activeMs: 10, reservedUnits: 100, usageUnits: null};
const queue = (messages, extra = {}) => ({conversationId: 'conversation-1', profile: 'bunny', messages, held: 'stop', code: null, ...extra});
function state(queues, dataschema = `${BASE}assistant-state/2.3`, data = {}) {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'state-1', source: 'bunny/modules/companions', type: 'org.bunny.assistant-state.updated', subject: 'assistant', time: TIME,
    kind: 'state', datacontenttype: 'application/json', dataschema, traceparent: TRACE,
    data: {id: 'assistant', revision: 7, enabled: true, available: true, provider: 'synthetic', model: 'synthetic', tools: ['read_fixture'], tasks: [task], queues, ...data}};
}

test('assistant-state/2.3 allows a queue of up to 16 messages, which 2.2 refuses past 8', () => {
  for (const messages of [1, 8, 9, 16]) assert.equal(valid(state([queue(messages)])), true, `${String(messages)} in 2.3`);
  assert.equal(valid(state([queue(17)])), false, 'at most 16');
  assert.equal(valid(state([queue(0)])), false, 'an empty queue is not listed');
  assert.equal(valid(state([queue(9)], `${BASE}assistant-state/2.2`)), false, 'negative control: 2.2 stays at 8');
  assert.equal(valid(state([queue(8)], `${BASE}assistant-state/2.2`)), true);
  assert.equal(valid(state([])), false, 'a state without a waiting queue keeps its earlier version');
  assert.equal(valid(state([queue(9, {text: 'Synthetic steer text'})])), false, 'no text');
  assert.equal(valid(state([queue(9, {held: 'paused'})])), false, 'the 2.2 holds');
  assert.equal(valid(state([queue(9)], undefined, {tools: Array.from({length: 64}, (_, index) => `tool_${String(index)}`)})), true, 'the 2.1 tool bound holds');
});

test('assistant-state/2.3 keeps every other 2.2 member as it is', () => {
  const next = schemaOf('assistant-state/2.3'), previous = schemaOf('assistant-state/2.2');
  assert.deepEqual(next.required, previous.required);
  assert.deepEqual(Object.keys(next.properties), Object.keys(previous.properties));
  for (const key of Object.keys(previous.properties).filter(key => key !== 'queues')) assert.equal(next.properties[key].$ref, `${BASE}assistant-state/2.2#/properties/${key}`, key);
  const items = next.properties.queues.items, earlier = previous.properties.queues.items;
  assert.deepEqual(items.required, earlier.required);
  assert.deepEqual([next.properties.queues.minItems, next.properties.queues.maxItems], [previous.properties.queues.minItems, previous.properties.queues.maxItems]);
  assert.deepEqual(items.properties.messages, {...earlier.properties.messages, maximum: 16});
});
