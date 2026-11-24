// Companion metadata (Hub #2054): session/3.2 and lifecycle/2.4 carry the companions of a native conversation session,
// each a stable ID and a display name, apart from its title. Everything here is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {coreFamilies, coreValidator, sessionEntityId} from '../dist/v2/families.js';
import {registerFamilies} from '../dist/v2/registry.js';
import {
  buildSession, READABLE_SESSION_SCHEMAS, readSession, SESSION_31_SCHEMA, SESSION_SCHEMA, sessionSchemaOf,
} from '../dist/v2/session.js';
import {NATIVE_SOURCE} from '../dist/v2/sources.js';

const BASE = 'https://bunny.invalid/events/';
const TIME = '2026-11-23T12:00:00.000Z', AT = Date.parse(TIME);
const SESSION_32_SCHEMA = `${BASE}session/3.2`;
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const known = id => ({status: 'known', id});
const schemaOf = id => coreFamilies.find(family => family.dataschema === `${BASE}${id}`)?.schema;
const {producer, ...nativeSource} = NATIVE_SOURCE;
const native = {...nativeSource, sessionId: 'synthetic-conversation'};
const claude = {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId: 'synthetic-claude'};
const REACHY = [{id: 'reachy', name: 'Reachy'}];
// The Apartment room (Hub #2032) as a later story would report it: every companion of the room, each once.
const APARTMENT = [{id: 'bunny', name: 'B.U.N.N.Y.'}, {id: 'reachy', name: 'Reachy'}, {id: 'microduck', name: 'MicroDuck'}];
const strip = message => JSON.parse(JSON.stringify(message));
const valid = message => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;
const detail = message => {
  const result = coreValidator().validate(message, {nowMs: Date.parse(message.time)});
  return result.ok ? undefined : result.error.detail;
};

/** A session record built as the core builds it, in the version `sessionSchemaOf` selects unless another is named. */
function record(overrides = {}, dataschema) {
  const who = overrides.identity ?? native;
  const data = buildSession({
    id: sessionEntityId(who), revision: 4, generation: 2, identity: who, parent: {status: 'top-level'}, turn: known('task-1'),
    work: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: who.provider === 'bunny' ? {status: 'known', authority: 'companions', epoch: who.sessionId, sequence: 3} : {status: 'unknown'},
    observedAtMs: AT - 1000, lastEvidenceAtMs: AT - 1000, children: {working: 0, unconfirmed: 0},
    title: {value: '#2054 Companion metadata', source: 'provider'}, companions: REACHY, ...overrides,
  });
  return strip({specversion: '1.0', bunnyprofile: '2.0', id: `record-${data.revision}`, source: 'bunny/core', type: 'org.bunny.session.updated', subject: data.id,
    time: TIME, kind: 'state', datacontenttype: 'application/json', dataschema: dataschema ?? sessionSchemaOf(data), traceparent: TRACE, data});
}
/** A native lifecycle observation as the companions module publishes it, in lifecycle/2.4 unless another is named. */
function observation(data = {}, {dataschema = `${BASE}lifecycle/2.4`, identity = native, source = producer} = {}) {
  return strip({specversion: '1.0', bunnyprofile: '2.0', id: 'observation-1', source, type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(identity),
    time: TIME, kind: 'occurrence', datacontenttype: 'application/json', dataschema, traceparent: TRACE,
    data: {identity, turn: known('task-1'), parent: {status: 'top-level'}, nativeEventId: '3', event: {kind: 'turn-started'}, observedAtMs: AT,
      ordering: identity.provider === 'bunny' ? {status: 'known', authority: identity.sourceId, epoch: identity.sessionId, sequence: 3} : {status: 'unknown'},
      title: {value: 'Reachy', source: 'provider'}, companions: REACHY, ...data}});
}
/** A native title as display metadata, which never carries the companions. */
function titled(data = {}, dataschema = `${BASE}lifecycle/2.4`) {
  return observation({turn: {status: 'unknown'}, event: {kind: 'metadata-observed'}, ordering: {status: 'unknown'}, nativeEventId: undefined,
    title: {value: '#2054 Companion metadata', source: 'user'}, companions: undefined, ...data}, {dataschema});
}

/** A schema without its `$id`, its description and the members at the pointers, which a newer version adds. */
function without(schema, pointers) {
  const copy = structuredClone(schema);
  delete copy.$id; delete copy.description;
  for (const pointer of pointers) {
    const tokens = pointer.split('/').slice(1), last = tokens.pop();
    const parent = tokens.reduce((node, token) => node[token], copy);
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
  }
  return copy;
}

test('session/3.2 is session/3.1 with an optional list of companions that only a native session carries', () => {
  const next = schemaOf('session/3.2');
  assert.ok(next, 'session/3.2 is registered');
  assert.deepEqual(next.properties.companions, {$ref: '#/$defs/companions'});
  assert.equal(next.required.includes('companions'), false, 'the field is optional');
  assert.deepEqual(next.$defs.companions, {
    description: next.$defs.companions.description, type: 'array', minItems: 1, maxItems: 8, items: {$ref: '#/$defs/companion'},
  });
  assert.deepEqual(next.$defs.companion.required, ['id', 'name']);
  const added = next.allOf.at(-1);
  assert.deepEqual(added, {$ref: '#/$defs/companionsOnlyNative'});
  assert.deepEqual(without(next, ['/properties/companions', '/$defs/companions', '/$defs/companion', '/$defs/companionsOnlyNative', '/allOf/2']),
    without(schemaOf('session/3.1'), []), 'nothing else changes');
});

test('lifecycle/2.4 is lifecycle/2.3 with the companions on a native lifecycle observation, never on metadata', () => {
  const next = schemaOf('lifecycle/2.4');
  assert.ok(next, 'lifecycle/2.4 is registered');
  assert.deepEqual(next.properties.companions, {$ref: `${BASE}session/3.2#/$defs/companions`});
  assert.deepEqual(next.allOf.at(-2), {$ref: `${BASE}session/3.2#/$defs/companionsOnlyNative`});
  assert.deepEqual(next.allOf.at(-1).if.properties.event.properties.kind, {const: 'metadata-observed'});
  assert.deepEqual(next.allOf.at(-1).then, {properties: {companions: false}});
  const lastIndex = next.allOf.length - 1;
  assert.deepEqual(without(next, ['/properties/companions', `/allOf/${String(lastIndex)}`, `/allOf/${String(lastIndex - 1)}`]),
    without(schemaOf('lifecycle/2.3'), []), 'nothing else changes');
});

test('a native session record carries its companions in session/3.2 only, and a hook session never does', () => {
  const reachy = record();
  assert.deepEqual(reachy.data.companions, REACHY, 'the record builder keeps the companions');
  assert.equal(reachy.dataschema, SESSION_32_SCHEMA);
  assert.equal(valid(reachy), true);
  assert.equal(valid(record({}, SESSION_31_SCHEMA)), false, 'session/3.1 cannot express it');
  assert.equal(valid(record({companions: APARTMENT})), true, 'several companions, each once');
  const many = Array.from({length: 8}, (_, index) => ({id: `companion-${String(index)}`, name: `Companion ${String(index)}`}));
  assert.equal(valid(record({companions: many})), true, 'at most eight');
  assert.equal(valid(record({companions: [...many, {id: 'companion-9', name: 'One too many'}]})), false);
  assert.equal(valid(record({companions: []})), false, 'an empty list says nothing: leave the field out');
  assert.equal(detail(record({companions: [REACHY[0], {id: 'reachy', name: 'Reachy again'}]})), 'payload /companions duplicate id');
  assert.equal(valid(record({companions: [{id: 'Reachy', name: 'Reachy'}]})), false, 'the ID is a routing ID');
  assert.equal(valid(record({companions: [{id: 'r'.repeat(65), name: 'Reachy'}]})), false, 'of at most 64 characters');
  assert.equal(valid(record({companions: [{id: 'reachy', name: '🐰'.repeat(40)}]})), true, 'a name of 40 Unicode scalar values');
  assert.equal(valid(record({companions: [{id: 'reachy', name: '🐰'.repeat(41)}]})), false, 'and no more');
  assert.equal(valid(record({companions: [{id: 'reachy', name: ''}]})), false);
  assert.equal(valid(record({companions: [{id: 'reachy', name: 'token: synthetic-secret-value'}]})), false, 'display text without a credential');
  assert.equal(valid(record({companions: [{id: 'reachy', name: 'two\nlines'}]})), false);
  assert.equal(valid(record({companions: [{id: 'reachy', name: 'Reachy', model: 'synthetic'}]})), false, 'nothing undeclared');
  const hook = record({identity: claude, companions: undefined});
  assert.equal(hook.dataschema, SESSION_SCHEMA, 'a hook record stays session/3.0');
  const posing = record({identity: claude}, SESSION_32_SCHEMA);
  assert.equal(valid(posing), false, 'a Claude or Codex session carries no companion');
  assert.equal(record({companions: undefined}).dataschema, SESSION_31_SCHEMA, 'a native record without companions stays session/3.1');
  assert.deepEqual(record({}, SESSION_32_SCHEMA).data, reachy.data);
  assert.equal(valid(record({companions: undefined}, SESSION_32_SCHEMA)), true, 'session/3.2 reads every 3.1 record');
});

test('the shared read function reads session/3.2 and keeps the companions apart from the title and the label', () => {
  assert.deepEqual(READABLE_SESSION_SCHEMAS, [SESSION_SCHEMA, SESSION_31_SCHEMA, SESSION_32_SCHEMA]);
  const view = readSession(record({label: {value: 'Explicit label', origin: 'user'}}));
  assert.deepEqual(view.companions, REACHY);
  assert.deepEqual([view.label.value, view.title.value], ['Explicit label', '#2054 Companion metadata'], 'no companion name in the title or label');
  assert.deepEqual(readSession(record({companions: APARTMENT})).companions.map(companion => companion.id), ['bunny', 'reachy', 'microduck']);
});

test('the native producer sends companions on lifecycle observations in lifecycle/2.4, and never on title metadata', () => {
  assert.equal(valid(observation()), true);
  assert.equal(valid(observation({companions: APARTMENT})), true);
  assert.equal(valid(observation({companions: undefined})), true, 'the field is optional');
  for (const version of ['2.2', '2.3']) assert.equal(valid(observation({}, {dataschema: `${BASE}lifecycle/${version}`})), false, `lifecycle/${version} has no companions`);
  assert.equal(detail(observation({companions: [REACHY[0], REACHY[0]]})), 'payload /companions duplicate id');
  assert.equal(valid(observation({companions: []})), false);
  assert.equal(valid(observation({}, {identity: claude, source: 'bunny/parts/hook'})), false, 'a hook observation carries no companion');
  assert.equal(valid(titled()), true, 'title metadata stays valid in 2.4');
  assert.equal(valid(titled({}, `${BASE}lifecycle/2.3`)), true, 'and in 2.3');
  assert.equal(valid(titled({companions: REACHY})), false, 'a title never carries the companions');
  // Every other 2.3 input stays valid in 2.4.
  for (const event of [{kind: 'turn-waiting'}, {kind: 'turn-uncertain'}, {kind: 'turn-ended', result: 'failed'}, {kind: 'attention-approval', attention: known('task-q1')}]) {
    assert.equal(valid(observation({event})), true, JSON.stringify(event));
  }
});

test('a session reader of the previous release still reads every hook and companionless native record and skips one with companions', () => {
  const previous = new MessageValidator();
  registerFamilies(previous, coreFamilies.filter(family => ![`${BASE}session/3.2`, `${BASE}lifecycle/2.4`].includes(family.dataschema)));
  const readPrevious = message => {
    const result = previous.validate(message);
    return result.ok && [SESSION_SCHEMA, SESSION_31_SCHEMA].includes(result.value.dataschema) ? result.value.data : undefined;
  };
  const hook = record({identity: claude, companions: undefined});
  assert.deepEqual(readPrevious(hook), hook.data);
  const companionless = record({companions: undefined});
  assert.deepEqual(readPrevious(companionless), companionless.data);
  assert.equal(readPrevious(record()), undefined);
});
