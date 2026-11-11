import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schema, validate } from '../dist/index.js';
import { validateInstallReceipt } from '../dist/install-receipt.js';

// Schemas compile on first use, not at import (Hub #1686). Compile each one here so a malformed schema still fails:
// a compile error throws out of these calls.
test('every controller definition and the install receipt schema compile', () => {
  const definitions = Object.keys(schema.$defs);
  assert.ok(definitions.length > 0);
  for (const definition of definitions) assert.equal(typeof validate(definition, null), 'boolean', definition);
  assert.equal(validateInstallReceipt({}), false);
});
