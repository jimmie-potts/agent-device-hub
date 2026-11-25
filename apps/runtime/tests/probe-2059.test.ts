// PROBE for #2059, do not merge: fails on purpose so that the Runtime unit tests job uploads a JUnit file naming it.
import assert from 'node:assert/strict';
import test from 'node:test';

void test('PROBE #2059 fails on purpose to prove the JUnit upload', () => {
  assert.equal(1 + 1, 3, 'PROBE #2059, do not merge: deliberate failure');
});
