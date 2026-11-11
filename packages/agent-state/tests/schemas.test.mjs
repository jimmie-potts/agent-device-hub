import test from 'node:test';
import assert from 'node:assert/strict';
import '../dist/validation.js';
import '../dist/host-session-snapshot.js';
import {compileAll} from '../dist/compile-on-first-use.js';

// Validators compile on first use, not at import (Hub #1686). Compile each one here so a malformed schema still fails.
test('every agent-state schema compiles', () => {
  assert.equal(compileAll(), 7);
});
