// The coding worker's credential role (Hub #502): bound to its source, no scopes, one endpoint grant and nothing else.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CODING_WORKER_SOURCE} from '@jimmie-potts/event-contracts/v2/coding';
import {parseCredentials, tokenDigest} from '../src/credentials.js';
import {edgePermissions, principalOf} from '../src/gateway/access.js';

const digest = tokenDigest('synthetic-token');
const document = (credentials: unknown[]) => ({schema: 'edge-credentials/1.0', credentials});

void test('a coding-worker credential needs its source and no scopes, and its source needs the role', () => {
  const [credential] = parseCredentials(document([{id: 'coding-worker', source: CODING_WORKER_SOURCE, digest, scopes: [], role: 'coding-worker'}]));
  assert.deepEqual(credential, {id: 'coding-worker', source: CODING_WORKER_SOURCE, digest, scopes: [], role: 'coding-worker'});
  for (const bad of [{id: 'w', source: 'bunny/parts/other', digest, scopes: [], role: 'coding-worker'}, {id: 'w', source: CODING_WORKER_SOURCE, digest, scopes: ['ingest'], role: 'coding-worker'},
    {id: 'w', source: CODING_WORKER_SOURCE, digest, scopes: [], role: 'coding-worker', robotId: 'x'}, {id: 'w', source: CODING_WORKER_SOURCE, digest, scopes: ['read']}]) {
    assert.throws(() => parseCredentials(document([bad])), /invalid coding-worker role|requires the coding-worker role/);
  }
});

void test('the role grants exactly the worker endpoint families and no ordinary call, key or publication', () => {
  const [credential] = parseCredentials(document([{id: 'coding-worker', source: CODING_WORKER_SOURCE, digest, scopes: [], role: 'coding-worker'}]));
  assert.ok(credential);
  const permissions = edgePermissions(principalOf(credential));
  assert.deepEqual(permissions.calls, []); assert.deepEqual(permissions.keys, []); assert.deepEqual(permissions.publishes, []);
  assert.deepEqual(permissions.endpoint, {respond: ['coding-work'], publish: ['coding-progress'], request: ['coding-endpoint']});
  const [ordinary] = parseCredentials(document([{id: 'reader', source: 'bunny/parts/reader', digest, scopes: ['read', 'control']}]));
  assert.ok(ordinary); assert.equal(edgePermissions(principalOf(ordinary)).endpoint, undefined);
});
