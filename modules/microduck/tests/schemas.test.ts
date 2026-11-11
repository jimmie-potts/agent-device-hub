import assert from 'node:assert/strict';
import {test} from 'node:test';
import '../src/configuration.js';
import '../src/families.js';
import '../src/protocol.js';
import '../src/registration.js';
import '../src/store.js';
import '../src/transport.js';
import '../src/witness.js';
import {compileAll} from '../src/compile-on-first-use.js';

// Validators compile on first use, not at import (Hub #1686). Compile each one here so a malformed schema still fails.
void test('every MicroDuck schema compiles', () => {
  assert.equal(compileAll(), 8);
});
