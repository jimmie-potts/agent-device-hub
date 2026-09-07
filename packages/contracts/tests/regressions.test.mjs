import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, evaluate } from '../dist/index.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/controller-v1.json', import.meta.url)));
const admission = corpus.semanticCases.find(c => c.id === 'registered-light-power').input;
const rejection = { decision: 'invalid-request', reserved: false, nextSequence: admission.state.nextSequence, scheduled: 0 };

for (const depth of [600, 5000]) {
  test(`deep malformed request rejects without throwing at depth ${depth}`, () => {
    let extra = null;
    for (let i = 0; i < depth; i++) extra = [extra];
    const request = { ...admission.request, extra };
    // Construct its wire size without recursively serializing the hostile value.
    const bodyBytes = Buffer.byteLength(JSON.stringify(admission.request).slice(0, -1)
      + ',"extra":' + '['.repeat(depth) + 'null' + ']'.repeat(depth) + '}');
    assert(bodyBytes < admission.state.maxBodyBytes);
    assert.equal(validate('request', request), false);
    assert.deepEqual(evaluate({ ...admission, request, bodyBytes }), rejection);
  });
}

test('cyclic and nonfinite malformed requests reject without throwing', () => {
  const cycle = [];
  cycle.push(cycle);
  for (const extra of [cycle, Infinity, NaN]) {
    const request = { ...admission.request, extra };
    assert.equal(validate('request', request), false);
    assert.deepEqual(evaluate({ ...admission, request }), rejection);
  }
});
