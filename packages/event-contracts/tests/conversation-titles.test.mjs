// Conversation titles (Hub #2025): lifecycle/2.3 lets the native producer carry a conversation's title as display
// metadata, and assistant-control/2.1 adds the owner's rename. Everything here is synthetic.
import assert from 'node:assert/strict';
import test from 'node:test';
import {coreFamilies, coreValidator, sessionEntityId} from '../dist/v2/families.js';
import {NATIVE_SOURCE} from '../dist/v2/sources.js';

const BASE = 'https://bunny.invalid/events/';
const TIME = '2026-11-22T12:00:00.000Z', AT = Date.parse(TIME);
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const schemaOf = id => coreFamilies.find(family => family.dataschema === `${BASE}${id}`)?.schema;
const {producer, ...nativeSource} = NATIVE_SOURCE;
const native = {...nativeSource, sessionId: 'synthetic-conversation'};
const desktop = {provider: 'codex', client: 'desktop', hostId: 'synthetic-host', sourceId: 'codex-desktop', sessionId: 'synthetic-thread'};
const valid = message => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;

/** A title observation as the companions module sends it: display metadata with no turn, ordering or lifecycle evidence. */
function titled(data = {}, {dataschema = `${BASE}lifecycle/2.3`, identity = native, source = producer} = {}) {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'title-1', source, type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(identity), time: TIME,
    kind: 'occurrence', datacontenttype: 'application/json', dataschema, traceparent: TRACE,
    data: {identity, turn: {status: 'unknown'}, parent: {status: 'top-level'}, event: {kind: 'metadata-observed'}, observedAtMs: AT, ordering: {status: 'unknown'},
      title: {value: '#1896 Session tracking', source: 'provider'}, ...data}};
}
function control(data, dataschema = `${BASE}assistant-control/2.1`) {
  return {specversion: '1.0', bunnyprofile: '2.0', id: 'control-1', source: 'bunny/core', type: 'org.bunny.assistant.control.requested', subject: 'assistant', time: TIME,
    kind: 'command', datacontenttype: 'application/json', dataschema, traceparent: TRACE, expiresat: new Date(AT + 30_000).toISOString(),
    data: {requestId: 'rename-1', expectedRevision: 3, ...data}};
}

test('lifecycle/2.3 is lifecycle/2.2 with metadata from the native source as well, which carries a title and no archived state', () => {
  const next = structuredClone(schemaOf('lifecycle/2.3')), previous = structuredClone(schemaOf('lifecycle/2.2'));
  for (const schema of [next, previous]) {delete schema.$id; delete schema.description;}
  const added = next.allOf.pop();
  assert.deepEqual(added.if.properties.identity.properties.provider, {const: 'bunny'});
  assert.deepEqual(added.then.required, ['title']);
  assert.deepEqual(next.allOf[2].then.properties.identity.anyOf.map(identity => identity.properties.provider.const), ['codex', 'bunny']);
  next.allOf[2].then.properties.identity = previous.allOf[2].then.properties.identity;
  assert.deepEqual(next, previous, 'nothing else changes');
});

test('the native producer carries a title in lifecycle/2.3 only, as metadata with no turn, ordering or archived state', () => {
  assert.equal(valid(titled()), true);
  assert.equal(valid(titled({title: {value: 'Renamed by the owner', source: 'user'}})), true);
  assert.equal(valid(titled({}, {dataschema: `${BASE}lifecycle/2.2`})), false, 'lifecycle/2.2 keeps metadata to Codex Desktop');
  const {title: _title, ...untitled} = titled().data;
  assert.equal(valid({...titled(), data: untitled}), false, 'a native metadata observation carries a title');
  assert.equal(valid(titled({event: {kind: 'metadata-observed', archived: false}})), false, 'and no archived state');
  assert.equal(valid(titled({ordering: {status: 'known', authority: 'companions', epoch: 'synthetic-conversation', sequence: 4}})), false, 'nor an ordering sequence');
  assert.equal(valid(titled({turn: {status: 'known', id: 'task-1'}})), false, 'nor a turn');
  assert.equal(valid(titled({title: {value: 'token: synthetic-secret-value', source: 'provider'}})), false, 'a title is display text without a credential');
  assert.equal(valid(titled({title: {value: 'line\nbreak', source: 'provider'}})), false);
  // Codex Desktop's metadata is unchanged in 2.3.
  assert.equal(valid(titled({event: {kind: 'metadata-observed', archived: true}}, {identity: desktop, source: 'bunny/modules/codex-desktop'})), true);
  assert.equal(valid(titled({}, {identity: {...desktop, client: 'cli'}, source: 'bunny/modules/codex-desktop'})), false);
});

test('assistant-control/2.1 adds a rename that names a profile and a display-text title, and the other actions carry neither', () => {
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: '#1896 Session tracking'})), true);
  assert.equal(valid(control({action: 'rename', profile: 'reachy', title: '🐰'.repeat(80)})), true);
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: '🐰'.repeat(81)})), false, 'at most 80 characters');
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: ''})), false);
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: 'password=synthetic-secret'})), false, 'no recognizable credential');
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: 'two\nlines'})), false, 'no control character');
  assert.equal(valid(control({action: 'rename', title: 'No profile'})), false);
  assert.equal(valid(control({action: 'rename', profile: 'bunny'})), false);
  assert.equal(valid(control({action: 'rename', profile: 'someone', title: 'Unknown profile'})), false);
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: 'With a task', taskId: 'task-1'})), false);
  assert.equal(valid(control({action: 'enable', profile: 'bunny'})), false, 'only a rename names a profile');
  assert.equal(valid(control({action: 'cancel', taskId: 'task-1', title: 'Stray title'})), false);
  for (const data of [{action: 'enable'}, {action: 'cancel', taskId: 'task-1'}, {action: 'speak', taskId: 'task-1', messageId: 'message-1'}]) {
    assert.equal(valid(control(data)), true, `${data.action} in 2.1`);
    assert.equal(valid(control(data, `${BASE}assistant-control/2.0`)), true, `${data.action} in 2.0`);
  }
  assert.equal(valid(control({action: 'rename', profile: 'bunny', title: 'Too new'}, `${BASE}assistant-control/2.0`)), false, 'assistant-control/2.0 has no rename');
});
