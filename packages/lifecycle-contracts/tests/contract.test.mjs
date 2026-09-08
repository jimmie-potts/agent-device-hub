import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validateEvent, deduplicationKey} from '../dist/index.js';

const event = {
  apiVersion: '1.0',
  identity: {provider:'codex', client:'cli', hostId:'host-a', sourceId:'source-a', sessionId:'session-a'},
  turn: {status:'known', id:'turn-a'},
  parent: {status:'unknown'},
  event: {kind:'turn.started'},
  observedAtMs: 1000,
  ordering: {status:'unknown'},
};

test('valid lifecycle metadata is admitted without private payload fields', () => {
  const result = validateEvent(event);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, event);
  assert.notEqual(result.value, event);
  const invalid = validateEvent({...event, prompt:'PRIVATE-CANARY'});
  assert.deepEqual(invalid, {ok:false, code:'invalid-event'});
  assert.ok(!JSON.stringify(invalid).includes('PRIVATE-CANARY'));
});

const corpus = JSON.parse(readFileSync(new URL('../fixtures/lifecycle-v1.json',import.meta.url),'utf8'));
assert.equal(new Set(corpus.cases.map(c=>c.id)).size,corpus.cases.length);
for (const fixture of corpus.cases) test(fixture.id, () => {
  const result = validateEvent(fixture.input);
  assert.equal(result.ok, fixture.valid);
  assert.deepEqual(deduplicationKey(fixture.input), fixture.valid ? fixture.deduplication : null);
  if (fixture.valid) assert.deepEqual(result.value, fixture.input);
  else assert.deepEqual(result,{ok:false,code:'invalid-event'});
});

test('non-JSON, cyclic and excessive structures fail without exposing exceptions', () => {
  const cyclic = {...event}; cyclic.parent = cyclic;
  const getter = {...event}; Object.defineProperty(getter,'prompt',{enumerable:true,get(){throw new Error('PRIVATE-CANARY');}});
  for (const input of [cyclic,getter,null,[],NaN,Infinity,new Date(),{...event,observedAtMs:NaN},{...event,label:{origin:'user',value:'\ud800'}},Object.assign({...event},{[Symbol('private')]:1})]) {
    assert.deepEqual(validateEvent(input),{ok:false,code:'invalid-event'});
  }
});

test('native and fallback keys preserve scope and retry identity without inventing order', () => {
  const fallback = deduplicationKey(event);
  assert.equal(fallback.kind, 'content');
  assert.deepEqual(deduplicationKey(Object.fromEntries(Object.entries(event).reverse())), fallback);
  const native = deduplicationKey({...event, eventId:'event-a'});
  assert.equal(native.kind, 'native');
  assert.notDeepEqual(native, deduplicationKey({...event,eventId:'event-a',identity:{...event.identity,sessionId:'session-b'}}));
  assert.notDeepEqual(native, deduplicationKey({...event,eventId:'event-a',turn:{status:'known',id:'turn-b'}}));
  assert.deepEqual(deduplicationKey({...event,prompt:'PRIVATE-CANARY'}), null);
});
