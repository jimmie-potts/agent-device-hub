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

// Hub #2028: one worker with a slot per companion. `coding-endpoint/2.2` declares the slots, `coding-work/2.1` tags a
// start with the companion that asked, and `coding-state/2.2` lists every active run and every hand-off waiting for a
// slot. The earlier versions are unchanged and refuse the new members.
const at = (name, version, data) => ({...family(name), dataschema: `https://bunny.invalid/events/${name}/${version}`, data});

test('an enable in 2.2 declares how many runs the worker holds, with or without readiness; a disable never does, and 2.1 refuses it', () => {
  valid(fixtures.valid['coding-endpoint-slots']);
  valid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'enable', slots: 3}));
  valid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'enable'}));
  valid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'disable'}));
  for (const slots of [0, 9, 1.5, '3']) invalid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'enable', slots}));
  invalid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'disable', slots: 3}));
  invalid(at('coding-endpoint', '2.2', {requestId: 'r-1', action: 'disable', readiness: readiness()}));
  invalid(v21('coding-endpoint', {requestId: 'r-1', action: 'enable', slots: 3}));
});

test('a start in work 2.1 names the asking companion; a cancel does not, and 2.0 refuses the member', () => {
  const tagged = fixtures.valid['coding-work-companion'];
  valid(tagged);
  for (const companion of ['bunny', 'reachy', 'microduck']) valid({...tagged, data: {...tagged.data, companion}});
  const {companion: _companion, ...untagged} = tagged.data;
  invalid({...tagged, data: untagged});
  invalid({...tagged, data: {...tagged.data, companion: 'codex'}});
  valid(at('coding-work', '2.1', {requestId: 'c-1', operationId: 'op', action: 'cancel'}));
  invalid(at('coding-work', '2.1', {requestId: 'c-1', operationId: 'op', action: 'cancel', companion: 'bunny'}));
  invalid(withData('coding-work', tagged.data));
  valid(withData('coding-work', untagged));
});

test('the coding state 2.2 lists every run and waiting hand-off once, one run per companion, with active as the oldest run', () => {
  const slots = fixtures.valid['coding-state-slots'];
  valid(slots);
  const data = structuredClone(slots.data);
  valid({...slots, data: {...data, endpointId: null, availability: 'off', active: null, readiness: null, slots: null, runs: [], waiting: []}});
  // An old worker declares no slots; the state still lists its one run.
  valid({...slots, data: {...data, slots: null, runs: data.runs.slice(0, 1)}});
  const run = data.runs[0];
  for (const changed of [
    {runs: [run, {...data.runs[1], companion: 'bunny'}]},
    {waiting: [{operationId: run.operationId, taskId: 'task-bunny-3', companion: 'bunny'}]},
    {active: {operationId: data.runs[1].operationId, taskId: data.runs[1].taskId, status: 'dispatching'}},
    {active: null},
    {runs: [{...run, status: 'uncertain'}]},
    {runs: [{...run, companion: 'codex'}]},
    {waiting: [{...data.waiting[0], brief: 'private'}]},
    {slots: 0},
  ]) invalid({...slots, data: {...data, ...changed}});
  const {runs: _runs, ...withoutRuns} = data;
  invalid({...slots, data: withoutRuns});
  invalid(v21('coding-state', data));
  valid(v21('coding-state', {id: data.id, revision: data.revision, endpointId: data.endpointId, availability: data.availability, active: data.active, readiness: null}));
});

test('additive worker versions carry harness readiness, selection and early native identity', () => {
  const {tool: _tool, ...health} = readiness();
  const capabilities = {steering: 'unsupported', resume: 'saved-session', review: true};
  const harnesses = [{...health, harness: 'codex', capabilities}, {...health, harness: 'fixture-adapter', capabilities}];
  const enabled = {...family('coding-endpoint-slots').data, harnesses};
  valid(at('coding-endpoint', '2.3', enabled));
  invalid(at('coding-endpoint', '2.2', enabled));
  invalid(at('coding-endpoint', '2.3', {...enabled, harnesses: [harnesses[0], harnesses[0]]}));
  invalid(at('coding-endpoint', '2.3', {requestId: 'disable-fixture', action: 'disable', harnesses}));
  const state = {...family('coding-state-slots').data, harnesses};
  valid(at('coding-state', '2.3', state));
  invalid(at('coding-state', '2.2', state));
  for (const name of ['coding-dispatch', 'coding-run', 'coding-work']) {
    const data = {...family(name === 'coding-work' ? 'coding-work-companion' : name).data, harness: 'codex'};
    valid(at(name, name === 'coding-work' ? '2.2' : '2.1', data));
    invalid(at(name, name === 'coding-work' ? '2.1' : '2.0', data));
  }
  const progress = {operationId: 'op-1', status: 'started', harness: 'codex', sessionId: 'native-id'};
  valid(at('coding-progress', '2.2', progress));
  invalid(at('coding-progress', '2.1', progress));
  invalid(at('coding-progress', '2.2', {...progress, sessionId: '/absolute/path'}));
});

test('uncapped coding declarations and bounded state previews leave earlier schema layouts intact', () => {
  const declaration = {requestId: 'uncapped', action: 'enable', capacity: 'uncapped'};
  valid(at('coding-endpoint', '2.4', declaration));
  invalid(at('coding-endpoint', '2.4', {...declaration, slots: 3}));
  invalid(at('coding-endpoint', '2.2', declaration));
  const old = fixtures.valid['coding-state-slots'].data;
  const runs = Array.from({length: 8}, (_, index) => ({
    ...old.runs[0], operationId: index === 0 ? old.runs[0].operationId : `independent-${index}`,
    setup: 'waiting', harness: 'claude-code', sessionId: 'observed-session',
  }));
  const state = {...old, slots: null, capacity: 'uncapped', runs, counts: {runs: 12, waiting: old.waiting.length}};
  valid(at('coding-state', '2.4', state));
  invalid(at('coding-state', '2.4', {...state, slots: 3}));
  invalid(at('coding-state', '2.4', {...state, counts: {runs: 7, waiting: old.waiting.length}}));
  invalid(at('coding-state', '2.2', state));
});

test('bounded setup transitions and a spawn failure retain attempt and harness identity', () => {
  for (const setup of ['waiting', 'running', 'ready']) valid(at('coding-progress', '2.3', {
    operationId: 'independent', status: 'started', setup, harness: 'codex', sessionId: 'observed-session',
  }));
  invalid(at('coding-progress', '2.3', {operationId: 'independent', status: 'started'}));
  invalid(at('coding-progress', '2.1', {operationId: 'independent', status: 'started', setup: 'ready'}));
  valid(at('coding-progress', '2.3', {operationId: 'independent', status: 'failed', reason: 'spawn', result: null}));
});


test('a tracked run can carry the selected uncapped connection without changing the public dispatch', () => {
  const selectionId = '01234567-89ab-4cde-8fab-0123456789ab';
  const data = {...family('coding-run').data, harness: 'codex'};
  valid(at('coding-run', '2.2', {...data, selectionId}));
  invalid(at('coding-run', '2.2', data));
  invalid(at('coding-run', '2.2', {...data, selectionId: 'worker-logical-name'}));
  invalid(at('coding-run', '2.1', {...data, selectionId}));
  invalid(at('coding-dispatch', '2.1', {...data, selectionId}));
});


test('a continuation carries only a prior attempt and an opaque stopped-writer proof', () => {
  const token = '01234567-89ab-4cde-8fab-0123456789ab';
  const continuation = {fromOperationId: 'partially-done', token};
  const dispatch = {...family('coding-dispatch').data, harness: 'codex', continuation};
  valid(at('coding-dispatch', '2.2', dispatch));
  invalid(at('coding-dispatch', '2.1', dispatch));
  valid(at('coding-run', '2.3', {...dispatch, selectionId: token}));
  const work = {...family('coding-work').data, companion: 'bunny', harness: 'codex', continuation};
  valid(at('coding-work', '2.3', work));
  invalid(at('coding-work', '2.3', {...work, continuation: {...continuation, path: '/private/worktree'}}));
  const cancelled = {operationId: 'partially-done', status: 'cancelled', reason: 'cancelled', handoffToken: token, result: result()};
  valid(at('coding-progress', '2.4', cancelled));
  invalid(at('coding-progress', '2.4', {...cancelled, status: 'uncertain', reason: 'lost'}));
  invalid(at('coding-progress', '2.4', {...cancelled, result: {...cancelled.result, head: null}}));
});
