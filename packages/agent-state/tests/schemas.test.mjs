import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../dist/host-session-snapshot.js';

// The snapshot 1.3 schema compiles on first use, not at import (Hub #1686), and a compile error inside validateSnapshot
// would read as an ordinary refusal. Only the 1.3 schema accepts a 1.3 snapshot, so each valid one must still pass.
test('the snapshot 1.3 schema compiles and accepts every valid 1.3 snapshot', () => {
  const cases = JSON.parse(readFileSync(new URL('../fixtures/snapshots-v1.3.json', import.meta.url), 'utf8')).cases
    .filter(entry => entry.valid && entry.input.apiVersion === '1.3');
  assert.ok(cases.length > 0);
  for (const entry of cases) assert.equal(validateSnapshot(entry.input).ok, true, entry.id);
});
