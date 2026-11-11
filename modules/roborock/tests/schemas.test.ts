import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRun, validateRuns, validateSamples, validateStatus } from '../src/families.js';

// The read-document validators compile on first use, not at import (Hub #1686). Calling each one compiles it, so a
// malformed schema still fails here: a compile error throws out of the call.
void test('every Roborock read-document schema compiles', () => {
    for (const validate of [validateStatus, validateRuns, validateRun, validateSamples]) assert.equal(validate({}), false);
});
