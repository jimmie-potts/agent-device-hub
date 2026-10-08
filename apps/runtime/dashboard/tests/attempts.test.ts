import assert from 'node:assert/strict';
import test from 'node:test';
import {rememberAttempt} from '../src/attempts.ts';
void test('reload protection keeps unresolved device identities and never serializes values or credentials', () => {
  let saved = '[{"target":"other","family":"power-set","requestId":"older"}]';
  const attempt = {target: 'wall', family: 'power-set', requestId: 'new', data: {on: true}, token: 'synthetic excluded field'};
  assert.equal(rememberAttempt(attempt, {getItem: () => saved, setItem: (_key, value) => { saved = value; }}), true);
  assert.deepEqual(JSON.parse(saved), [{target: 'other', family: 'power-set', requestId: 'older'}, {target: 'wall', family: 'power-set', requestId: 'new'}]);
});
void test('storage refusal prevents retaining an attempt; the caller must not send it', () => {
  assert.equal(rememberAttempt({target: 'wall', family: 'power-set', requestId: 'new'}, {getItem: () => null, setItem: () => { throw new Error('synthetic storage refusal'); }}), false);
});
