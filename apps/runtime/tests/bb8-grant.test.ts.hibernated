import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseCredentials} from '../src/credentials.js';
import {edgePermissions, principalOf} from '../src/gateway/access.js';
void test('configured BB-8 helper role is source-bound and cannot carry ordinary scopes', () => {
  const credential = {id: 'bb8-helper', source: 'bunny/parts/bb8-windows', digest: '1'.repeat(64), scopes: [], role: 'bb8-link', robotId: 'bb8'};
  const [parsed] = parseCredentials({schema: 'edge-credentials/1.0', credentials: [credential]});
  assert.ok(parsed);
  const grant = edgePermissions(principalOf(parsed));
  assert.deepEqual(grant.calls, ['respond', 'serve', 'publish', 'subscribe']);
  assert.ok(grant.keys?.includes('bunny.cmd.bb8-link-execute.bb8') === true);
  assert.ok(grant.calls?.includes('request') !== true && grant.calls?.includes('sync') !== true);
  assert.ok(grant.keys?.includes('bunny.state.session.*') !== true);
  for (const bad of [{...credential, source: 'bunny/parts/reader'}, {...credential, scopes: ['control']}, {...credential, robotId: 'bad.target'}, {...credential, role: undefined}]) assert.throws(() => parseCredentials({schema: 'edge-credentials/1.0', credentials: [bad]}));
});
