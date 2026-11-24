// The native assistant source's contract versions (Hub #505): session/3.1, lifecycle/2.2 and the 2.1 attention and turn
// occurrences, the status rule that names a finished task's result, the version each record and occurrence is published
// in, and what a session reader of the previous release does with a native record. Everything here is synthetic.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {coreFamilies, coreValidator, sessionEntityId} from '../dist/v2/families.js';
import {registerFamilies} from '../dist/v2/registry.js';
import {
  buildSession, forConsumer, knownDetail, occurrenceSchemaOf, READABLE_SESSION_SCHEMAS, readSession, SESSION_31_SCHEMA, SESSION_SCHEMA, sessionSchemaOf,
  sessionState, statusOf,
} from '../dist/v2/session.js';
import {NATIVE_SOURCE} from '../dist/v2/sources.js';

const BASE = 'https://bunny.invalid/events/';
const TIME = '2026-11-21T12:00:00.000Z', AT = Date.parse(TIME);
const hash = text => createHash('sha256').update(text).digest('hex');
const known = id => ({status: 'known', id});
const schemaOf = id => coreFamilies.find(family => family.dataschema === `${BASE}${id}`)?.schema;
const {producer: _producer, ...nativeSource} = NATIVE_SOURCE;
const native = (sessionId = 'synthetic-conversation') => ({...nativeSource, sessionId});
const claude = {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId: 'synthetic-claude'};
const notice = (result, acknowledgedBy = []) => ({id: hash(`notice-${String(result)}`), kind: 'turn-ended', turn: known('task-1'), acknowledgedBy,
  ...(result === undefined ? {} : {result})});
const CONSUMERS = ['dashboard', 'nanoleaf', 'pixoo'];

/** A record built from facts, as the core publishes it, in the version `sessionSchemaOf` selects unless another is named. */
function record(overrides = {}, dataschema) {
  const who = overrides.identity ?? native();
  const data = buildSession({
    id: sessionEntityId(who), revision: 4, generation: 2, identity: who, parent: {status: 'top-level'}, turn: known('task-1'),
    work: 'idle', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: who.provider === 'bunny' ? {status: 'known', authority: 'companions', epoch: who.sessionId, sequence: 3} : {status: 'unknown'},
    observedAtMs: AT - 1000, lastEvidenceAtMs: AT - 1000, children: {working: 0, unconfirmed: 0}, title: {value: 'B.U.N.N.Y.', source: 'provider'}, ...overrides,
  });
  return {
    specversion: '1.0', bunnyprofile: '2.0', id: `record-${data.revision}`, source: 'bunny/core', type: 'org.bunny.session.updated', subject: data.id,
    time: TIME, kind: 'state', datacontenttype: 'application/json', dataschema: dataschema ?? sessionSchemaOf(data),
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
  };
}
/** A lifecycle observation of a native conversation's task, as the companions module publishes it. */
function observation(event, {dataschema = `${BASE}lifecycle/2.2`, identity = native(), source = NATIVE_SOURCE.producer} = {}) {
  return {
    specversion: '1.0', bunnyprofile: '2.0', id: 'observation-1', source, type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(identity),
    time: TIME, kind: 'occurrence', datacontenttype: 'application/json', dataschema, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    data: {identity, turn: known('task-1'), parent: {status: 'top-level'}, nativeEventId: '3', event, observedAtMs: AT,
      ordering: {status: 'known', authority: identity.sourceId, epoch: identity.sessionId, sequence: 3}},
  };
}
const valid = message => coreValidator().validate(message).ok;

/** A schema with the members a newer version adds taken out, and its `$id` and description, for comparison with its predecessor. */
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

test('session/3.1 is session/3.0 apart from its identity, the notice result and the occurrence definition', () => {
  const next = without(schemaOf('session/3.1'), ['/$defs/identity', '/$defs/notice/properties/result', '/$defs/result', '/$defs/occurrence']);
  const previous = without(schemaOf('session/3.0'), ['/$defs/identity']);
  assert.deepEqual(next, previous);
  assert.deepEqual(schemaOf('session/3.1').$defs.result.enum, ['succeeded', 'failed', 'cancelled']);
  const occurrence = structuredClone(schemaOf('session/2.0').$defs.occurrence);
  delete occurrence.description;
  const widened = structuredClone(schemaOf('session/3.1').$defs.occurrence);
  delete widened.description;
  assert.deepEqual(widened, occurrence, 'the 2.1 occurrences carry what 2.0 carries');
});

test('lifecycle/2.2 is lifecycle/2.0 with the widened identity and the common inputs, and the 2.1 occurrences are their 2.0 forms', () => {
  const retarget = schema => JSON.parse(JSON.stringify(schema).replaceAll(`${BASE}session/3.1#`, `${BASE}session/2.0#`));
  const next = retarget(without(schemaOf('lifecycle/2.2'), ['/properties/event/oneOf/1']));
  next.properties.event.oneOf[0].properties.kind.enum = next.properties.event.oneOf[0].properties.kind.enum.filter(kind => !['turn-waiting', 'turn-uncertain'].includes(kind));
  assert.deepEqual(next, without(schemaOf('lifecycle/2.0'), []));
  for (const family of ['attention-raised', 'attention-cleared', 'turn-ended']) {
    assert.deepEqual(retarget(without(schemaOf(`${family}/2.1`), [])), without(schemaOf(`${family}/2.0`), []), family);
  }
});

test('only session/3.1 names the native source or a notice result, and it pins the native host and source', () => {
  for (const overrides of [{}, {notices: [notice('failed')]}]) {
    assert.equal(valid(record(overrides)), true);
    assert.equal(record(overrides).dataschema, SESSION_31_SCHEMA);
    assert.equal(valid(record(overrides, SESSION_SCHEMA)), false, 'session/3.0 cannot express it');
  }
  assert.equal(valid(record({identity: {...native(), hostId: 'synthetic-host'}})), false);
  const hook = record({identity: claude, title: undefined, notices: [notice(undefined)]});
  assert.equal(hook.dataschema, SESSION_SCHEMA, 'a hook record stays session/3.0');
  assert.equal(valid(hook), true);
  assert.equal(valid({...hook, dataschema: SESSION_31_SCHEMA}), true, 'and is a valid session/3.1 record too');
  assert.deepEqual(READABLE_SESSION_SCHEMAS.slice(0, 2), [SESSION_SCHEMA, SESSION_31_SCHEMA], 'session/3.2 follows (Hub #2054)');
  assert.deepEqual(readSession(record()), record().data);
});

test('the occurrences of a native session are 2.1, every other one 2.0, and a session end is always 2.0', () => {
  for (const family of ['attention-raised', 'attention-cleared', 'turn-ended']) {
    assert.equal(occurrenceSchemaOf(family, native()), `${BASE}${family}/2.1`);
    assert.equal(occurrenceSchemaOf(family, claude), `${BASE}${family}/2.0`);
  }
  assert.equal(occurrenceSchemaOf('session-ended', native()), `${BASE}session-ended/2.0`);
  const raised = {
    specversion: '1.0', bunnyprofile: '2.0', id: 'raised-1', source: 'bunny/core', type: 'org.bunny.attention.raised', subject: sessionEntityId(native()),
    time: TIME, kind: 'occurrence', datacontenttype: 'application/json', dataschema: `${BASE}attention-raised/2.1`, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    data: {session: sessionEntityId(native()), identity: native(), turn: known('task-1'), observedAtMs: AT, ordering: {status: 'known', authority: 'companions', epoch: 'synthetic-conversation', sequence: 2},
      revision: 5, attention: {id: known('task-q1'), kind: 'input', turn: known('task-1')}},
  };
  assert.equal(valid(raised), true);
  assert.equal(valid({...raised, dataschema: `${BASE}attention-raised/2.0`}), false);
});

test('lifecycle/2.2 carries the common inputs, and only it names the native source', () => {
  for (const event of [{kind: 'turn-started'}, {kind: 'activity-observed'}, {kind: 'turn-waiting'}, {kind: 'turn-uncertain'}, {kind: 'turn-interrupted'},
    {kind: 'turn-ended', result: 'succeeded'}, {kind: 'turn-ended', result: 'cancelled'}, {kind: 'turn-ended'},
    {kind: 'attention-input', attention: known('task-q1')}, {kind: 'attention-approval', attention: known('task-q2')}, {kind: 'attention-resolved', attention: known('task-q1')}]) {
    assert.equal(valid(observation(event)), true, JSON.stringify(event));
  }
  assert.equal(valid(observation({kind: 'turn-ended', result: 'paused'})), false);
  assert.equal(valid(observation({kind: 'turn-waiting'}, {dataschema: `${BASE}lifecycle/2.0`})), false, 'lifecycle/2.0 names no native source');
  assert.equal(valid(observation({kind: 'turn-started'}, {dataschema: `${BASE}lifecycle/2.0`, identity: claude})), true);
  assert.equal(valid(observation({kind: 'turn-waiting'}, {dataschema: `${BASE}lifecycle/2.0`, identity: claude})), false, 'lifecycle/2.0 has no new input');
});

test('a finished task names its result, never success without one, and an owner cancel leaves no reader unread', () => {
  const outcome = notices => ({notices, read: 'unknown', confidence: 'confirmed', evidenceAtMs: AT});
  const claims = notices => ({turn: known('task-1'), work: {state: 'idle', confidence: 'confirmed', evidenceAtMs: AT, reasons: []},
    attention: {items: [], confidence: 'confirmed', evidenceAtMs: AT}, outcome: outcome(notices),
    relationships: {children: {working: 0, unconfirmed: 0}, confidence: 'confirmed'}, unavailable: []});
  for (const result of ['succeeded', 'failed', 'cancelled']) {
    assert.deepEqual(statusOf(claims([notice(result)])), {class: 'finished', detail: result});
    assert.equal(knownDetail({class: 'finished', detail: result}), true);
  }
  assert.deepEqual(statusOf(claims([notice(undefined)])), {class: 'finished', detail: 'turn-ended'});
  // The last counting notice that has a result names it.
  assert.deepEqual(statusOf(claims([notice('failed'), {...notice(undefined), id: hash('later')}])), {class: 'finished', detail: 'failed'});
  const failed = readSession(record({notices: [notice('failed')]}));
  const cancelled = readSession(record({notices: [notice('cancelled', CONSUMERS)]}));
  assert.equal(sessionState(failed), 'done', 'a failure stays unread until it is acknowledged');
  for (const policy of [{}, {read: true}, {acknowledgingConsumers: ['nanoleaf'], read: true}, {acknowledgingConsumers: ['pixoo']}]) {
    assert.equal(forConsumer(failed, policy).status.class, 'finished', JSON.stringify(policy));
    assert.deepEqual(forConsumer(cancelled, policy).status, {class: 'quiet', detail: 'acknowledged'}, JSON.stringify(policy));
  }
  assert.equal(cancelled.status.detail, 'cancelled', 'the hub still records the result');
  assert.equal(sessionState(cancelled), undefined);
});

test('a session reader of the previous release reads every hook record as before and skips a native record', () => {
  // The previous release registered every core family but the native source's versions, and read session/3.0 only.
  // lifecycle/2.3 (Hub #2025) came later still and refers to session/3.1, and session/3.2 and lifecycle/2.4 (Hub #2054) later again.
  const NEW = ['session/3.1', 'session/3.2', 'lifecycle/2.2', 'lifecycle/2.3', 'lifecycle/2.4', 'attention-raised/2.1', 'attention-cleared/2.1', 'turn-ended/2.1']
    .map(id => `${BASE}${id}`);
  const previous = new MessageValidator();
  registerFamilies(previous, coreFamilies.filter(family => !NEW.includes(family.dataschema)));
  const readPrevious = message => {
    const result = previous.validate(message);
    return result.ok && result.value.dataschema === SESSION_SCHEMA ? result.value.data : undefined;
  };
  const hook = record({identity: claude, title: undefined, notices: [notice(undefined)]});
  assert.deepEqual(readPrevious(hook), hook.data);
  assert.equal(readPrevious(record()), undefined);
  assert.equal(readPrevious(record({notices: [notice('succeeded')]})), undefined);
  assert.equal(previous.validate(record()).ok, false, 'its validator does not know session/3.1');
});
