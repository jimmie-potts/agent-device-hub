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

// Hub #1743: version 2.1 adds the worker's readiness to an enable and to the coding state, and the usage-limit and
// waiting-for-owner outcomes to progress. Version 2.0 is unchanged and refuses all of them.
const v21 = (name, data) => ({...family(name), dataschema: `https://bunny.invalid/events/${name}/2.1`, data});
const readiness = () => structuredClone(fixtures.valid['coding-endpoint-readiness'].data.readiness);

test('an enable in 2.1 may carry readiness, where unknown stays unknown; a disable never does, and 2.0 refuses it', () => {
  valid(fixtures.valid['coding-endpoint-readiness']);
  valid(v21('coding-endpoint', {requestId: 'r-1', action: 'enable'}));
  valid(v21('coding-endpoint', {requestId: 'r-1', action: 'enable', readiness: {...readiness(), installed: 'no', version: null, signedIn: 'unknown', plan: null, limits: null, limitsObservedAtMs: null}}));
  valid(v21('coding-endpoint', {requestId: 'r-1', action: 'enable', readiness: {...readiness(), signedIn: 'no', limits: [{window: 'five-hour', status: 'rejected', resetsAtMs: null, utilization: null}]}}));
  invalid(v21('coding-endpoint', {requestId: 'r-1', action: 'disable', readiness: readiness()}));
  invalid(withData('coding-endpoint', {requestId: 'r-1', action: 'enable', readiness: readiness()}));
  for (const changed of [{signedIn: 'maybe'}, {plan: 'Max Plan'}, {version: '/Users/someone/claude'}, {limits: [{window: 'seven_day', status: 'allowed', resetsAtMs: 1, utilization: 0}]},
    {limits: [{window: 'seven-day', status: 'allowed_warning', resetsAtMs: 1, utilization: 0}]}, {email: 'someone@example.com'}, {tool: 'codex'}, {checkedAtMs: -1}]) {
    invalid(v21('coding-endpoint', {requestId: 'r-1', action: 'enable', readiness: {...readiness(), ...changed}}));
  }
});

test('the coding state 2.1 carries the selected worker readiness or null; 2.0 refuses the member', () => {
  valid(fixtures.valid['coding-state-readiness']);
  const data = family('coding-state').data;
  valid(v21('coding-state', {...data, readiness: null}));
  invalid(v21('coding-state', data));
  invalid(withData('coding-state', {...data, readiness: null}));
});

test('progress 2.1 adds usage-limit, which carries the reported limit or unknown, and waiting-for-owner; 2.0 refuses both', () => {
  valid(fixtures.valid['coding-progress-usage-limit']);
  const limited = structuredClone(fixtures.valid['coding-progress-usage-limit'].data);
  valid(v21('coding-progress', {...limited, result: {...limited.result, limit: {window: null, resetsAtMs: null}}}));
  valid(v21('coding-progress', {operationId: 'op', status: 'completed', result: {...result(), outcome: 'waiting-for-owner', findings: ['Question: which file?']}}));
  valid(v21('coding-progress', fixtures.valid['coding-progress'].data));
  // A limit only with usage-limit, usage-limit only as a failure with that reason, and that reason only with that outcome.
  const {limit: _limit, ...withoutLimit} = limited.result;
  invalid(v21('coding-progress', {...limited, result: {...limited.result, outcome: 'failed'}}));
  invalid(v21('coding-progress', {...limited, result: withoutLimit}));
  invalid(v21('coding-progress', {operationId: 'op', status: 'completed', result: limited.result}));
  invalid(v21('coding-progress', {operationId: 'op', status: 'failed', reason: 'usage-limit'}));
  invalid(v21('coding-progress', {...limited, result: {...limited.result, limit: {window: 'five-hour', resetsAtMs: 'soon'}}}));
  invalid(withData('coding-progress', limited));
  invalid(withData('coding-progress', {operationId: 'op', status: 'completed', result: {...result(), outcome: 'waiting-for-owner'}}));
});
