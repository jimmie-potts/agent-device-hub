import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../src/core/art-schedule-model.js';
import '../src/core/art-schedule-store.js';
import {compileAll} from '../src/core/compile-on-first-use.js';

// The core's validators compile on first use, not at import (Hub #1686). Compile each one here so a malformed schema
// still fails.
void test('every core schema compiled on first use compiles', () => {
  assert.equal(compileAll(), 3);
});
