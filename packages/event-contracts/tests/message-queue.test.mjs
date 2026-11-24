// The conversation message queue (Hub #2030): assistant-control/2.2 adds the queue's withdraw, reorder and resume-queue
// actions, and assistant-state/2.2 adds each current conversation's queue summary without text. Everything here is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {coreFamilies, coreValidator} from '../dist/v2/families.js';

const BASE = 'https://bunny.invalid/events/';
const TIME = '2026-11-24T12:00:00.000Z', AT = Date.parse(TIME);
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const schemaOf = id => coreFamilies.find(family => family.dataschema === `${BASE}${id}`)?.schema;
const valid = message => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;
function control(data, dataschema = `${BASE}assistant-control/2.2`) {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'control-1', source: 'bunny/core', type: 'org.bunny.assistant.control.requested', subject: 'assistant', time: TIME,
    kind: 'command', datacontenttype: 'application/json', dataschema, traceparent: TRACE, expiresat: new Date(AT + 30_000).toISOString(),
    data: {requestId: 'queue-control-1', expectedRevision: 3, ...data}};
}
const task = {taskId: 'task-1', conversationId: 'conversation-1', profile: 'bunny', status: 'running', runId: 'run-1', questionId: null, hasAnswer: false,
  code: null, modelCalls: 1, toolCalls: 0, questions: 0, activeMs: 10, reservedUnits: 100, usageUnits: null};
function state(data = {}, dataschema = `${BASE}assistant-state/2.2`) {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'state-1', source: 'bunny/modules/companions', type: 'org.bunny.assistant-state.updated', subject: 'assistant', time: TIME,
    kind: 'state', datacontenttype: 'application/json', dataschema, traceparent: TRACE,
    data: {id: 'assistant', revision: 7, enabled: true, available: true, provider: 'synthetic', model: 'synthetic', tools: ['read_fixture'], tasks: [task],
      queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 2, held: null, code: null}], ...data}};
}

test('assistant-control/2.2 adds withdraw and reorder, which name a profile and a queued message, and resume-queue, which names a profile', () => {
  assert.equal(valid(control({action: 'withdraw', profile: 'bunny', queuedId: 'queued-1'})), true);
  assert.equal(valid(control({action: 'reorder', profile: 'reachy', queuedId: 'queued-2', beforeId: 'queued-1'})), true);
  assert.equal(valid(control({action: 'reorder', profile: 'reachy', queuedId: 'queued-2', beforeId: null})), true, 'null moves it to the end');
  assert.equal(valid(control({action: 'resume-queue', profile: 'microduck'})), true);
  assert.equal(valid(control({action: 'reorder', profile: 'bunny', queuedId: 'queued-2'})), false, 'a reorder names where it goes');
  assert.equal(valid(control({action: 'withdraw', profile: 'bunny', queuedId: 'queued-1', beforeId: null})), false, 'only a reorder names a position');
  assert.equal(valid(control({action: 'withdraw', queuedId: 'queued-1'})), false, 'a withdraw names its profile');
  assert.equal(valid(control({action: 'withdraw', profile: 'bunny'})), false, 'and its queued message');
  assert.equal(valid(control({action: 'withdraw', profile: 'bunny', queuedId: 'queued 1'})), false, 'a queued message is a request ID');
  assert.equal(valid(control({action: 'withdraw', profile: 'bunny', queuedId: 'queued-1', taskId: 'task-1'})), false, 'and no task');
  assert.equal(valid(control({action: 'resume-queue'})), false, 'resume-queue names its profile');
  assert.equal(valid(control({action: 'resume-queue', profile: 'bunny', queuedId: 'queued-1'})), false, 'and no queued message');
  assert.equal(valid(control({action: 'resume-queue', profile: 'bunny', taskId: 'task-1'})), false, 'nor a task');
  assert.equal(valid(control({action: 'cancel', taskId: 'task-1', queuedId: 'queued-1'})), false, 'the other actions name no queued message');
  assert.equal(valid(control({action: 'cancel', taskId: 'task-1', profile: 'bunny'})), false, 'nor a profile');
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: 'Queued title', queuedId: 'queued-1'})), false);
  // The earlier actions are unchanged in 2.2, and the queue's actions are new to it.
  for (const data of [{action: 'enable'}, {action: 'cancel', taskId: 'task-1'}, {action: 'resume', taskId: 'task-1'},
    {action: 'speak', taskId: 'task-1', messageId: 'message-1'}, {action: 'rename', profile: 'bunny', title: '#2030 Message queue'}]) {
    assert.equal(valid(control(data)), true, `${data.action} in 2.2`);
    assert.equal(valid(control(data, `${BASE}assistant-control/2.1`)), true, `${data.action} in 2.1`);
  }
  for (const data of [{action: 'withdraw', profile: 'bunny', queuedId: 'queued-1'}, {action: 'resume-queue', profile: 'bunny'}]) {
    assert.equal(valid(control(data, `${BASE}assistant-control/2.1`)), false, `assistant-control/2.1 has no ${data.action}`);
  }
});

test('assistant-control/2.2 keeps every 2.1 member as it is', () => {
  const next = schemaOf('assistant-control/2.2'), previous = schemaOf('assistant-control/2.1');
  assert.deepEqual(next.required, previous.required);
  assert.deepEqual(next.properties.action.enum, [...previous.properties.action.enum, 'withdraw', 'reorder', 'resume-queue']);
  for (const key of ['taskId', 'messageId', 'profile', 'title']) assert.equal(next.properties[key].$ref, `${BASE}assistant-control/2.1#/properties/${key}`);
});

test('assistant-state/2.2 carries each held or waiting queue by count, hold and code, and no message text', () => {
  assert.equal(valid(state()), true);
  assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 1, held: 'refused', code: 'capacity'}]})), true);
  for (const held of ['stop', 'restart']) assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 8, held, code: null}]})), true, held);
  assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 9, held: null, code: null}]})), false, 'at most eight messages');
  assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 0, held: null, code: null}]})), false, 'an empty queue is not listed');
  assert.equal(valid(state({queues: []})), false, 'a state without a waiting queue keeps its earlier version');
  assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 1, held: 'paused', code: null}]})), false);
  assert.equal(valid(state({queues: [{conversationId: 'conversation-1', profile: 'bunny', messages: 1, held: null, code: null, text: 'Synthetic queued text'}]})), false, 'no text');
  const {queues: _queues, ...earlier} = state().data;
  assert.equal(valid({...state(), data: earlier}), false, '2.2 lists its queues');
  assert.equal(valid(state({}, `${BASE}assistant-state/2.1`)), false, '2.1 has no queues');
  assert.equal(valid({...state({}, `${BASE}assistant-state/2.1`), data: earlier}), true);
  assert.equal(valid(state({tools: Array.from({length: 64}, (_, index) => `tool_${String(index)}`)})), true, 'the 2.1 tool bound holds');
});
