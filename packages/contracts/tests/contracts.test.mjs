import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, evaluate } from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/controller-v1.json', import.meta.url)));
assert.equal(corpus.format, 1);
const ids = new Set();
for (const item of [...corpus.schemaCases, ...corpus.semanticCases]) {
  assert(!ids.has(item.id), `duplicate fixture ${item.id}`);
  ids.add(item.id);
}
for (const item of corpus.schemaCases) {
  test(`schema: ${item.id}`, () => assert.equal(validate(item.definition, item.value), item.valid));
}
for (const item of corpus.semanticCases) {
  test(`semantic: ${item.id}`, () => {
    const original = structuredClone(item.input);
    const actual = evaluate(item.input);
    assert.deepEqual(actual, item.expected);
    assert.deepEqual(item.input, original, 'reference evaluation must not mutate owner state');
    for (const result of actual.results ?? [actual]) {
      if (result.receipt) {
        assert(validate(result.receipt.apiVersion === '1.1' ? 'receiptV1_1' : 'receipt', result.receipt), 'produced receipt must conform');
      }
    }
    if (item.input.operation === 'moment') {
      assert(validate('momentState', { current: actual.device.current, last: actual.device.last }), 'moment state must conform');
    }
    if (item.input.operation === 'downgrade') assert(validate('snapshot', actual.snapshot), '1.0 view must conform');
  });
}
