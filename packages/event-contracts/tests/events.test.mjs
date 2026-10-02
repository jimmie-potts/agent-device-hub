import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateEvent, referenceDecision} from '../dist/index.js';
const corpus = JSON.parse(readFileSync(new URL('../fixtures/events-v1.json', import.meta.url)));
for (const c of corpus.validation) test(c.id, () => {
  const before = structuredClone(c.input);
  const result = validateEvent(c.input);
  assert.equal(result.ok, c.valid);
  assert.deepEqual(c.input, before);
  if (c.valid) assert.deepEqual(result.value, c.input);
  else assert.deepEqual(result, {ok:false,code:'invalid-event'});
});

for (const c of corpus.reference) test(c.id, () => {
  const before = structuredClone(c.input);
  assert.equal(referenceDecision(c.input), c.expected);
  assert.deepEqual(c.input, before);
});

test('nonempty unique shared corpus', () => {
  assert.equal(corpus.version, '1');
  assert(corpus.validation.length > 0 && corpus.reference.length > 0);
  const cases = [...corpus.validation, ...corpus.reference];
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
});
test('non-JSON input rejects without calling accessors or serialization hooks', () => {
  const cyclic = {}; cyclic.child = cyclic;
  for (const value of [cyclic, NaN, Infinity, 2n, [], new Date(), Object.create(null)]) assert.equal(validateEvent(value).ok, false);
  const getter = Object.defineProperty({}, 'id', {enumerable:true,get(){ throw new Error('getter invoked'); }});
  assert.deepEqual(validateEvent(getter), {ok:false,code:'invalid-event'});
  let called = false;
  assert.equal(validateEvent({toJSON(){called = true; return corpus.validation[0].input;}}).ok, false);
  assert.equal(called, false);
});
test('validation returns detached records', () => {
  const input = structuredClone(corpus.validation[0].input), result = validateEvent(input);
  assert.equal(result.ok, true);
  result.value.data.payload.ownerId = 'different';
  assert.notEqual(input.data.payload.ownerId, result.value.data.payload.ownerId);
});
