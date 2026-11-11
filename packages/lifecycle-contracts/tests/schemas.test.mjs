import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../dist/index.js';
import '../dist/v1.2.js';
import {compileAll} from '../dist/compile-on-first-use.js';

// Validators compile on first use, not at import (Hub #1686). Compile each one here so a malformed schema still fails.
test('every lifecycle schema compiles', () => {
  assert.equal(compileAll(), 3);
});
