// The module's source boundary (#615 AC3): it imports only the SDK, the contracts and its schema checker, and nothing in it
// can reach a device, a radio or a host path.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(SOURCE).filter(name => name.endsWith('.ts')).map(name => [name, readFileSync(join(SOURCE, name), 'utf8')]);

test('the module imports only the SDK, the contracts, Ajv and Node crypto', () => {
  const allowed = /^(?:@jimmie-potts\/(?:sdk|event-contracts)(?:\/.*)?|ajv\/dist\/2020\.js|node:crypto|node:sqlite|\.\/.*)$/u;
  for (const [name, text] of files) {
    for (const match of text.matchAll(/from '([^']+)'/gu)) assert.match(match[1], allowed, `${name} imports ${match[1]}`);
  }
});

test('the module names no Bluetooth library, characteristic write or heater control', () => {
  for (const [name, text] of files) {
    for (const forbidden of [/noble/iu, /bleak/iu, /writeAsync/iu, /\.write\(/u, /setHeater|setPump|setTarget/u]) assert.equal(forbidden.test(text), false, `${name}: ${forbidden}`);
  }
});

test('the store has no statement that removes or rewrites a fact', () => {
  const store = files.find(([name]) => name === 'store.ts')?.[1] ?? '';
  assert.equal(/DELETE|DROP|UPDATE volcano_facts|REPLACE/u.test(store), false);
});
