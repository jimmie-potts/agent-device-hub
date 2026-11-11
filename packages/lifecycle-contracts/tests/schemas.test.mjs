import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validateEvent} from '../dist/v1.2.js';

// The 1.2 schema compiles on first use, not at import (Hub #1686), and a compile error inside validateEvent would read
// as an ordinary refusal. Only the 1.2 schema accepts a 1.2 envelope, so each valid one must still pass.
test('the lifecycle 1.2 schema compiles and accepts every valid 1.2 envelope', () => {
  const cases = JSON.parse(readFileSync(new URL('../fixtures/lifecycle-v1.2.json', import.meta.url), 'utf8')).cases
    .filter(entry => entry.valid && entry.input.apiVersion === '1.2');
  assert.ok(cases.length > 0);
  for (const entry of cases) assert.equal(validateEvent(entry.input).ok, true, entry.id);
});
