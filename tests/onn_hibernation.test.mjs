import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {registrySource, frontendSource} from '../apps/runtime/build/registry.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
test('retired ONN is absent from generated runtime and browser registrations', () => {
  assert.doesNotMatch(registrySource(root), /@jimmie-potts\/onn/);
  assert.doesNotMatch(frontendSource(root), /@jimmie-potts\/onn/);
  assert.match(registrySource(root), /@jimmie-potts\/wemo/);
  assert.match(frontendSource(root), /@jimmie-potts\/roborock\/frontend/);
});
