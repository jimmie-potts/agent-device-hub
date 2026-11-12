// The bookkeeping members of this package's state families (Hub #1771): every state family is classified, every
// pointer names a single-value member of every version's schema, the members that are never bookkeeping are refused,
// and every other leaf of each family's fixtures still counts as a change.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  NEVER_BOOKKEEPING, SETTINGS_FAMILIES, bookkeeping, bookkeepingProblem, contractFamilies, contractSchemas, familyOfSchema, isContractFamily,
  leafMutations, sameState, withoutBookkeeping,
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
  assert.equal(bookkeepingProblem('device', ['/observed'], device), '/observed names a member that holds other members');
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
  assert.equal(bookkeepingProblem('lamp-glow', ['/wrapped'], [schema], refs), '/wrapped names a member that holds other members');
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
    assert.ok(mutations.every(({pointer}) => !pointers.some(skip => pointer === skip || pointer.startsWith(`${skip}/`))), name);
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
  assert.equal(sameState(limit, {...limit, observedAtMs: 5, updatedAtMs: limit.updatedAtMs + 1}, bookkeeping['power-limit']), true);
  assert.equal(sameState(limit, {...limit, status: 'armed'}, bookkeeping['power-limit']), false);
  assert.deepEqual(withoutBookkeeping({observed: {status: 'unknown'}}, ['/observed/observedAtMs', '/absent/atMs']), {observed: {status: 'unknown'}});
});

test('the leaf mutations reach array items and empty containers, and leave the record they read alone', () => {
  const record = {id: 'a', revision: 1, list: [1, 'b', true, null], empty: {}, none: [], nested: {atMs: 3, keep: 4}};
  const before = structuredClone(record);
  const mutations = leafMutations(record, ['/nested/atMs']);
  assert.deepEqual(mutations.map(({pointer}) => pointer), ['/list/0', '/list/1', '/list/2', '/list/3', '/empty', '/none', '/nested/keep']);
  assert.deepEqual(record, before);
  assert.deepEqual(mutations[0].record.list, [2, 'b', true, null]);
  for (const {record: changed} of mutations) assert.equal(sameState(record, changed, ['/nested/atMs']), false);
});
