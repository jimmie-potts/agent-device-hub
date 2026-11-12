// The bookkeeping members of this package's state families (Hub #1771): every state family is classified, every
// pointer names a single-value member of every version's schema, the members that are never bookkeeping are refused,
// and every other leaf of each family's fixtures still counts as a change.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  NEVER_BOOKKEEPING, SETTINGS_FAMILIES, bookkeeping, bookkeepingProblem, contractFamilies, contractSchemas, familyOfSchema, isContractFamily,
  BOOKKEEPING_VALUE, leafMutations, sameState, withoutBookkeeping,
} from '../dist/v2/bookkeeping.js';

const read = name => JSON.parse(readFileSync(new URL(`../fixtures/v2/${name}`, import.meta.url), 'utf8'));
const fixtures = {...read('families.json').valid, ...read('devices.json').valid};
const versionsOf = family => contractFamilies.filter(entry => entry.family === family).map(({schema}) => schema);

/** The families whose classification is missing or names no state family of this package, given the families and the map. */
function unclassified(families, map) {
  const names = new Set(families.filter(({kind}) => kind === 'state').map(({family}) => family));
  return {missing: [...names].filter(name => !Object.hasOwn(map, name)).sort(), extra: Object.keys(map).filter(name => !names.has(name)).sort()};
}

test('every state family of the package is classified, and nothing else is', () => {
  assert.deepEqual(unclassified(contractFamilies, bookkeeping), {missing: [], extra: []});
  assert.ok(Object.isFrozen(bookkeeping) && Object.values(bookkeeping).every(Object.isFrozen));
});

test('a new state family, or a version of one with no classification, fails the check', () => {
  const added = [...contractFamilies, {family: 'lamp-glow', kind: 'state', dataschema: 'https://bunny.invalid/events/lamp-glow/2.0', schema: {}}];
  assert.deepEqual(unclassified(added, bookkeeping), {missing: ['lamp-glow'], extra: []});
  const withoutDevice = Object.fromEntries(Object.entries(bookkeeping).filter(([family]) => family !== 'device'));
  assert.deepEqual(unclassified(contractFamilies, withoutDevice).missing, ['device']);
  assert.deepEqual(unclassified(contractFamilies, {...bookkeeping, 'mode-set': []}).extra, ['mode-set']);
});

test('the declared members, as decided on #1768', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(bookkeeping).filter(([, pointers]) => pointers.length > 0)), {
    'device': ['/observed/observedAtMs', '/lastTransmission/transmittedAtMs', '/externalControl/observedAtMs'],
    'power-limit': ['/observedAtMs', '/updatedAtMs'],
    'playback': ['/observedAtMs'],
  });
  assert.deepEqual(bookkeeping.session, [], 'agent session times stay rows (decision 6)');
});

test('every declared pointer names a single-value member of every version of its family', () => {
  for (const [family, pointers] of Object.entries(bookkeeping)) {
    assert.ok(versionsOf(family).length > 0, family);
    assert.equal(bookkeepingProblem(family, pointers, versionsOf(family)), undefined, family);
  }
  assert.equal(familyOfSchema('https://bunny.invalid/events/device/2.4'), 'device');
  assert.equal(familyOfSchema('https://example.invalid/device/2.4'), undefined);
  assert.ok(isContractFamily('device') && isContractFamily('art') && isContractFamily('power-set'));
  assert.equal(isContractFamily('pixoo-display'), false);
});

test('each member that is never bookkeeping is refused, at the top, nested, and as the parent of a declared member', () => {
  const device = versionsOf('device');
  for (const name of NEVER_BOOKKEEPING) {
    for (const pointer of [`/${name}`, `/observed/${name}`, `/${name}/observedAtMs`]) {
      assert.equal(bookkeepingProblem('device', [pointer], device), `${pointer} names ${name}, which is never bookkeeping`, pointer);
    }
  }
  // The issue's list, as written: availability, generation, configuration revision, holds and below, observed power,
  // brightness and status, desired, pending, outcomes, the transmission's request and operations, and power-limit
  // settings and status; and the replay's showing, freshness and failing.
  for (const pointer of ['/availability', '/generation', '/configurationRevision', '/held', '/held/heldAtMs', '/held/requestId', '/observed/power',
    '/observed/brightness', '/observed/status', '/desired', '/desired/power', '/pending', '/pendingKinds', '/lastOutcome',
    '/lastTransmission/requestId', '/lastTransmission/operationIds']) {
    assert.match(bookkeepingProblem('device', [pointer], device) ?? '', /never bookkeeping/, pointer);
  }
  for (const pointer of ['/status', '/enabled', '/durationMs', '/settingsRevision', '/startedAtMs', '/deadlineMs', '/lastAttempt']) {
    assert.match(bookkeepingProblem('power-limit', [pointer], versionsOf('power-limit')) ?? '', /never bookkeeping/, pointer);
  }
  assert.match(bookkeepingProblem('session', ['/freshness'], versionsOf('session')) ?? '', /never bookkeeping/);
  assert.match(bookkeepingProblem('pixoo-display', ['/showing'], [{type: 'object', properties: {showing: {type: 'string'}}}]) ?? '', /never bookkeeping/);
  assert.match(bookkeepingProblem('nanoleaf-wall', ['/failing'], [{type: 'object', properties: {failing: {type: 'boolean'}}}]) ?? '', /never bookkeeping/);
});

test('a settings family declares no bookkeeping member', () => {
  for (const family of ['mode', 'lighting-layout', 'playback-layout', 'home-layout', 'art-schedule', 'preference-state']) {
    assert.ok(SETTINGS_FAMILIES.includes(family));
    assert.deepEqual(bookkeeping[family], []);
  }
  assert.equal(bookkeepingProblem('mode', ['/selectedAtMs'], versionsOf('mode')), 'mode is a settings family, which has no bookkeeping members');
  assert.equal(bookkeepingProblem('mode', [], versionsOf('mode')), undefined);
});

test('a pointer to a member the schema does not declare, or to one that holds members, is refused', () => {
  const device = versionsOf('device');
  assert.equal(bookkeepingProblem('device', ['/observed/readAtMs'], device), '/observed/readAtMs is not a member the schema declares');
  assert.equal(bookkeepingProblem('device', ['/lastSeenAtMs'], device), '/lastSeenAtMs is not a member the schema declares');
  assert.equal(bookkeepingProblem('device', ['/observed'], device), '/observed names a member that may hold the type "object", not only a number');
  assert.equal(bookkeepingProblem('device', ['/capabilities/modes/values/0'], device), '/capabilities/modes/values/0 names an array position');
  for (const pointer of ['observedAtMs', '/', '/observed//observedAtMs', '/observed/~0', '']) {
    assert.equal(bookkeepingProblem('device', [pointer], device), `${pointer} is not a JSON pointer to an object member`, pointer);
  }
  assert.equal(bookkeepingProblem('device', ['/observed/observedAtMs', '/observed/observedAtMs'], device), '/observed/observedAtMs is declared twice');
  // A member only a later version declares is refused for the family: `held` aside, every version must declare it.
  assert.match(bookkeepingProblem('device', ['/capabilities/moments/art/stageVersion'], device) ?? '', /not a member the schema declares/);
  assert.equal(bookkeepingProblem('device', [], []), 'device has no schema');
});

test('members are found through $ref, allOf, oneOf and anyOf, in the same document and in another', () => {
  const refs = {...contractSchemas(), 'https://bunny.invalid/events/other/2.0': {$defs: {reading: {type: 'object', properties: {readAtMs: {type: 'integer'}}}}}};
  const schema = {
    type: 'object',
    $defs: {stamp: {type: 'object', properties: {stampAtMs: {$ref: 'https://bunny.invalid/events/blocks/2.0#/$defs/instantMs'}}}},
    properties: {
      local: {$ref: '#/$defs/stamp'},
      remote: {$ref: 'https://bunny.invalid/events/other/2.0#/$defs/reading'},
      either: {oneOf: [{$ref: 'https://bunny.invalid/events/blocks/2.0#/$defs/unknown'}, {type: 'object', properties: {status: {const: 'known'}, atMs: {type: 'integer'}}}]},
      maybe: {anyOf: [{type: 'null'}, {type: 'object', properties: {atMs: {type: 'integer'}}}]},
      both: {allOf: [{type: 'object', properties: {atMs: {type: 'integer'}}}]},
      wrapped: {oneOf: [{type: 'object', properties: {value: {type: 'integer'}}}]},
    },
  };
  for (const pointer of ['/local/stampAtMs', '/remote/readAtMs', '/either/atMs', '/maybe/atMs', '/both/atMs', '/wrapped/value']) {
    assert.equal(bookkeepingProblem('lamp-glow', [pointer], [schema], refs), undefined, pointer);
  }
  assert.equal(bookkeepingProblem('lamp-glow', ['/wrapped'], [schema], refs), '/wrapped names a member that may hold the type "object", not only a number');
  assert.equal(bookkeepingProblem('lamp-glow', ['/maybe/sinceMs'], [schema], refs), '/maybe/sinceMs is not a member the schema declares');
  assert.equal(bookkeepingProblem('lamp-glow', ['/gone/atMs'], [{properties: {gone: {$ref: 'https://bunny.invalid/events/missing/2.0'}}}], refs),
    '/gone/atMs meets a schema reference that does not resolve or nests too deeply');
});

test('every leaf that is not bookkeeping, changed alone, is a change in every state fixture of the package', () => {
  const covered = new Set();
  for (const [name, message] of Object.entries(fixtures)) {
    if (message.kind !== 'state') continue;
    const family = familyOfSchema(message.dataschema), pointers = bookkeeping[family];
    assert.ok(pointers !== undefined, `${name}: ${family} is classified`);
    covered.add(family);
    const mutations = leafMutations(message.data, pointers);
    for (const {pointer, record} of mutations) assert.equal(sameState(message.data, record, pointers), false, `${name} ${pointer}`);
    const values = mutations.filter(({change}) => change === 'value');
    assert.ok(values.every(({pointer}) => !pointers.some(skip => pointer === skip || pointer.startsWith(`${skip}/`))), name);
    assert.ok(mutations.filter(({change}) => change !== 'value').every(({pointer}) => pointers.includes(pointer)), name);
    assert.ok(mutations.every(({pointer}) => pointer !== '/id' && pointer !== '/revision'), name);
  }
  for (const family of ['device', 'power-limit', 'playback']) assert.ok(covered.has(family), `${family} has a fixture`);
});

test('a record whose only changes are bookkeeping members, its id or its revision holds the same state', () => {
  const device = fixtures['device-nanoleaf'].data;
  assert.equal(device.observed.status, 'known');
  const moved = structuredClone(device);
  moved.revision += 1;
  moved.observed.observedAtMs += 30_000;
  moved.externalControl.observedAtMs += 30_000;
  moved.lastTransmission.transmittedAtMs += 30_000;
  assert.equal(sameState(device, moved, bookkeeping.device), true);
  const unknown = structuredClone(fixtures['device-pixoo-art'].data);
  const sent = {...unknown, lastTransmission: {status: 'known', transmittedAtMs: 1, operationIds: ['status']}};
  assert.equal(sameState(unknown, sent, bookkeeping.device), false, 'a transmission that was unknown is a change');
  const painted = structuredClone(moved);
  painted.lastTransmission.transmittedAtMs += 10_000;
  assert.equal(sameState(moved, painted, bookkeeping.device), true);
  painted.lastTransmission.operationIds = ['media'];
  assert.equal(sameState(moved, painted, bookkeeping.device), false);
  const reordered = Object.fromEntries(Object.entries(device).reverse());
  assert.equal(sameState(device, reordered, []), true);
  const limit = fixtures['power-limit'].data;
  assert.equal(limit.observedAtMs, null);
  assert.equal(sameState(limit, {...limit, updatedAtMs: limit.updatedAtMs + 1}, bookkeeping['power-limit']), true);
  assert.equal(sameState(limit, {...limit, observedAtMs: 5}, bookkeeping['power-limit']), false, 'a first reading is a change');
  const read = {...limit, observedAtMs: 5};
  assert.equal(sameState(read, {...read, observedAtMs: 9, updatedAtMs: limit.updatedAtMs + 1}, bookkeeping['power-limit']), true);
  assert.equal(sameState(limit, {...limit, status: 'armed'}, bookkeeping['power-limit']), false);
  assert.deepEqual(withoutBookkeeping({observed: {status: 'unknown'}}, ['/observed/observedAtMs', '/absent/atMs']), {observed: {status: 'unknown'}});
});

test('the leaf mutations reach array items and empty containers, and leave the record they read alone', () => {
  const record = {id: 'a', revision: 1, list: [1, 'b', true, null], empty: {}, none: [], nested: {atMs: 3, keep: 4}};
  const before = structuredClone(record);
  const mutations = leafMutations(record, ['/nested/atMs']);
  assert.deepEqual(mutations.map(({pointer, change}) => `${pointer} ${change}`),
    ['/list/0 value', '/list/1 value', '/list/2 value', '/list/3 value', '/empty value', '/none value', '/nested/atMs null', '/nested/atMs removed', '/nested/keep value']);
  assert.deepEqual(record, before);
  assert.deepEqual(mutations[0].record.list, [2, 'b', true, null]);
  for (const {record: changed} of mutations) assert.equal(sameState(record, changed, ['/nested/atMs']), false);
});

// Code scanning alert 24 (js/prototype-polluting-assignment): a pointer through `__proto__`, `constructor` or
// `prototype` must never reach `Object.prototype` or `Object`, whoever calls the helpers.
const UNSAFE = ['/__proto__/x', '/constructor/prototype/x', '/prototype/x', '/__proto__', '/constructor'];
const shapeOf = target => Object.getOwnPropertyNames(target).sort().join(',');

test('a pointer through __proto__, constructor or prototype removes nothing and leaves the prototypes alone', () => {
  const sentinel = 'gh1771Sentinel';
  Object.defineProperty(Object.prototype, 'x', {value: sentinel, configurable: true, writable: true});
  try {
    const before = shapeOf(Object.prototype), beforeObject = shapeOf(Object);
    const record = {id: 'a', revision: 1, x: 1, nested: {x: 2}};
    assert.deepEqual(withoutBookkeeping(record, UNSAFE), record);
    assert.equal(sameState(record, {...record, x: 5}, UNSAFE), false);
    assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, 'x')?.value, sentinel, 'Object.prototype keeps its member');
    assert.equal(shapeOf(Object.prototype), before);
    assert.equal(shapeOf(Object), beforeObject);
    assert.equal(typeof Object.prototype.constructor, 'function');
  } finally {
    delete Object.prototype.x;
  }
});

test('a declaration through __proto__, constructor or prototype is refused', () => {
  const schema = {type: 'object', properties: {x: {type: 'integer'}}};
  for (const pointer of UNSAFE) {
    assert.match(bookkeepingProblem('lamp-glow', [pointer], [schema]) ?? '', /, which no pointer may name$/, pointer);
  }
});

test('a record parsed from JSON with an own __proto__ member is compared and mutated as data', () => {
  const before = shapeOf(Object.prototype);
  const record = JSON.parse('{"id":"a","revision":1,"__proto__":{"polluted":1},"atMs":3}');
  assert.ok(Object.hasOwn(record, '__proto__'));
  assert.deepEqual(Object.entries(withoutBookkeeping(record, ['/atMs'])).map(([key]) => key), ['id', 'revision', '__proto__', 'atMs']);
  assert.equal(withoutBookkeeping(record, ['/atMs']).atMs, BOOKKEEPING_VALUE);
  const mutations = leafMutations(record, ['/atMs']);
  assert.deepEqual(mutations.map(({pointer, change}) => `${pointer} ${change}`), ['/__proto__/polluted value', '/atMs null', '/atMs removed']);
  assert.equal(Object.getOwnPropertyDescriptor(mutations[0].record, '__proto__')?.value.polluted, 2);
  assert.equal(sameState(record, mutations[0].record, ['/atMs']), false);
  assert.equal(({}).polluted, undefined);
  assert.equal(shapeOf(Object.prototype), before);
});

// Review findings R3 and R5 on #1783: a bookkeeping member holds a number, or a number or null, in every alternative at
// any depth.
test('a member whose schema does not say it holds a number, or a number or null, is refused, in each form', () => {
  const instant = {$ref: 'https://bunny.invalid/events/blocks/2.0#/$defs/instantMs'};
  const refused = {
    'unconstrained {}': {},
    'unconstrained true': true,
    'if and then': {if: {type: 'integer'}, then: {minimum: 0}},
    'enum of objects': {enum: [{at: 1}]},
    'const of an object': {const: {at: 1}},
    'not': {not: {type: 'object'}},
    'patternProperties': {patternProperties: {'^a': {type: 'integer'}}},
    'additionalProperties': {additionalProperties: {type: 'integer'}},
    'an object type among scalars': {type: ['integer', 'object']},
    'an unconstrained branch': {oneOf: [{type: 'integer'}, {}]},
    'a time or a state': {oneOf: [instant, {enum: ['pending', 'done']}]},
    'a time or a state behind a reference': {anyOf: [{type: 'null'}, instant, {$ref: '#/$defs/state'}]},
    'an enumeration inside allOf': {oneOf: [{type: 'integer'}, {allOf: [{enum: ['pending', 'done']}]}]},
    'an enumeration behind a $ref to an allOf': {oneOf: [{type: 'integer'}, {$ref: '#/$defs/combined'}]},
    'an enumeration in a nested oneOf': {oneOf: [{type: 'integer'}, {oneOf: [{type: 'null'}, {enum: ['pending']}]}]},
    'an integer or string type': {type: ['integer', 'string']},
    'an integer or a boolean': {oneOf: [{type: 'integer'}, {type: 'boolean'}]},
    'an integer or a string': {anyOf: [{type: 'integer'}, {type: 'string'}]},
    'an enumeration alone': {enum: [0, 1, 2]},
    'a const alone': {const: 3},
    'a boolean alone': {type: 'boolean'},
    'a string alone': {type: 'string'},
    'a date-time string': {type: 'string', format: 'date-time'},
    'null alone': {type: 'null'},
    'a branch that says nothing': {oneOf: [{type: 'integer'}, {minimum: 0}]},
  };
  for (const [form, at] of Object.entries(refused)) {
    const schema = {type: 'object', $defs: {state: {const: 'pending'}, combined: {allOf: [{enum: ['a', 'b']}]}}, properties: {at}};
    assert.match(bookkeepingProblem('lamp-glow', ['/at'], [schema]) ?? '', /^\/at names a member that /, form);
  }
  const accepted = {
    'a time': instant,
    'a nullable type': {type: ['integer', 'null']},
    'a time or null (anyOf)': {anyOf: [{type: 'null'}, instant]},
    'a time or null (oneOf)': {oneOf: [instant, {const: null}]},
    'an integer': {type: 'integer'},
    'a number': {type: 'number', minimum: 0},
    'bounds in allOf': {allOf: [{type: 'integer'}, {minimum: 0}]},
    'a number or null nested': {anyOf: [{type: 'null'}, {oneOf: [instant]}]},
  };
  for (const [form, at] of Object.entries(accepted)) {
    assert.equal(bookkeepingProblem('lamp-glow', ['/at'], [{type: 'object', properties: {at}}]), undefined, form);
  }
});

// Review finding R4 on #1783: a bookkeeping member's value does not count, but whether it is present and whether it is
// null do.
function presenceCounts(record, pointer, pointers) {
  const path = pointer.slice(1).split('/'), last = path.pop();
  const parentOf = copy => path.reduce((node, token) => node[token], copy);
  const set = value => {
    const copy = structuredClone(record);
    if (value === undefined) delete parentOf(copy)[last];
    else parentOf(copy)[last] = value;
    return copy;
  };
  const value = parentOf(record)[last];
  assert.equal(typeof value, 'number', pointer);
  assert.equal(sameState(record, set(value + 7), pointers), true, `${pointer}: another value is the same state`);
  assert.equal(sameState(record, set(null), pointers), false, `${pointer}: null against a value is a change`);
  assert.equal(sameState(record, set(undefined), pointers), false, `${pointer}: absent against a value is a change`);
  assert.equal(sameState(set(null), set(undefined), pointers), false, `${pointer}: null against absent is a change`);
}

test('absent, null and a value of a bookkeeping member are three states, and two values are one', () => {
  const device = fixtures['device-nanoleaf'].data;
  for (const pointer of bookkeeping.device) presenceCounts(device, pointer, bookkeeping.device);
  const limit = {...fixtures['power-limit'].data, observedAtMs: 1_791_287_998_500};
  for (const pointer of bookkeeping['power-limit']) presenceCounts(limit, pointer, bookkeeping['power-limit']);
  presenceCounts(fixtures.playback.data, '/observedAtMs', bookkeeping.playback);
  assert.deepEqual(withoutBookkeeping({a: 1, b: null, c: {d: 2}}, ['/a', '/b', '/c/d', '/e']), {a: BOOKKEEPING_VALUE, b: null, c: {d: BOOKKEEPING_VALUE}});
});
