import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as contracts from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/install-receipt-v1.json', import.meta.url)));
assert.equal(corpus.format, 1);
assert(corpus.cases.length > 0, 'receipt corpus must not be empty');
assert.equal(new Set(corpus.cases.map(item => item.id)).size, corpus.cases.length);
for (const item of corpus.cases) {
  test(`install receipt: ${item.id}`, () => {
    assert.equal(typeof contracts.validateInstallReceipt, 'function', 'install receipt validator must be exported');
    const original = structuredClone(item.value);
    assert.equal(contracts.validateInstallReceipt(item.value), item.valid);
    assert.deepEqual(item.value, original);
  });
}
