import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2/families.json', import.meta.url), 'utf8'));
const validator = new MessageValidator(); registerCoreFamilies(validator);
const family = name => structuredClone(fixtures.valid[name]);
const withData = (name, data) => ({...family(name), data});
const valid = value => assert.equal(validator.validate(value).ok, true, JSON.stringify(validator.validate(value)));
const invalid = value => assert.equal(validator.validate(value).ok, false, JSON.stringify(value));
const result = () => structuredClone(fixtures.valid['coding-progress'].data.result);

test('coding families are registered profile-2.0 messages with closed payloads', () => {
  for (const name of ['coding-endpoint', 'coding-dispatch', 'coding-run', 'coding-work', 'coding-progress', 'coding-lost', 'coding-state']) {
    valid(family(name));
    invalid(withData(name, {...family(name).data, token: 'unrequested-private-field'}));
    invalid({...family(name), type: 'org.bunny.other.requested'});
  }
  invalid({...family('coding-dispatch'), subject: 'hub'});
  invalid({...family('coding-lost'), subject: 'other-endpoint'});
  invalid({...family('coding-state'), subject: 'reachy'});
});

test('a dispatch names an allowlisted repository, a brief and bounds inside the accepted ranges', () => {
  const data = family('coding-dispatch').data;
  for (const changed of [{repository: 'Agent Device Hub'}, {repository: '../escape'}, {brief: ''}, {brief: 'x'.repeat(4097)},
    {bounds: {...data.bounds, wallClockMs: 1000}}, {bounds: {...data.bounds, maxTurns: 0}}, {bounds: {...data.bounds, budgetUsd: 51}}, {bounds: {wallClockMs: 60000, maxTurns: 1}}]) {
    invalid(withData('coding-dispatch', {...data, ...changed}));
  }
  valid(withData('coding-run', data));
});

test('work carries the start or a cancel, and progress distinguishes started, completed and the terminal reasons', () => {
  valid(withData('coding-work', {requestId: 'cancel-request', operationId: 'coding-dispatch-test', action: 'cancel'}));
  invalid(withData('coding-work', {requestId: 'cancel-request', operationId: 'coding-dispatch-test', action: 'cancel', brief: 'extra'}));
  invalid(withData('coding-work', {...family('coding-work').data, brief: ' '}));
  valid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'started'}));
  for (const reason of ['refused', 'repository', 'worktree', 'exit', 'timeout', 'budget', 'cancelled', 'lost', 'invalid-output']) {
    valid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'failed', reason}));
  }
  valid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'uncertain', reason: 'lost', result: null}));
  invalid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'failed', reason: 'because'}));
  invalid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'completed'}));
  invalid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'completed', result: {...result(), summary: ' '}}));
});

test('a result keeps git facts, bounded checks and findings, and unknown usage stays unknown', () => {
  const base = result();
  valid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'completed', result: {...base, base: null, head: null, sessionId: null, usage: null}}));
  valid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'completed', result: {...base, usage: {turns: null, costUsd: null, durationMs: null}}}));
  for (const changed of [{outcome: 'done'}, {head: 'abc'}, {changedFiles: Array.from({length: 201}, (_, i) => `f${i}`)}, {checks: [{name: 'tests', status: 'green'}]},
    {usage: {turns: 1}}, {worktree: '/private/path'}, {findings: ['x'.repeat(1025)]}]) {
    invalid(withData('coding-progress', {operationId: 'coding-dispatch-test', status: 'completed', result: {...base, ...changed}}));
  }
});

test('the coding state names one endpoint and at most one active operation', () => {
  const data = family('coding-state').data;
  valid(withData('coding-state', {...data, endpointId: null, availability: 'off'}));
  valid(withData('coding-state', {...data, active: {operationId: 'coding-dispatch-test', taskId: 'task-1', status: 'started'}}));
  invalid(withData('coding-state', {...data, availability: 'busy'}));
  invalid(withData('coding-state', {...data, active: {operationId: 'coding-dispatch-test', taskId: 'task-1', status: 'done'}}));
});
