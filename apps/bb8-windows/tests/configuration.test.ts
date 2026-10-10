import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseWindowsConfig} from '../src/configuration.js';
import {resolve} from 'node:path';
const selected = {schema: 'bb8-windows/1.0', robotId: 'bb8', model: 'original-bb8', configurationRevision: 0, adapterAddress: '00:11:22:33:44:66', targetAddress: '00:11:22:33:44:55', gatewayUrl: 'http://127.0.0.1:1', tokenFile: resolve('synthetic-private-token'), stateDirectory: resolve('synthetic-private-receipts'), clockErrorMs: 100, clockQualifiedUntilMs: 0};
void test('private enrollment rejects public hosts, credentials in URLs, arbitrary options and unqualified models without quoting input', () => {
  assert.equal(parseWindowsConfig(selected).robotId, 'bb8');
  for (const bad of [{...selected, model: 'bolt'}, {...selected, gatewayUrl: 'http://example.org'}, {...selected, gatewayUrl: 'http://private-token@localhost'}, {...selected, targetAddress: 'guessed'}, {...selected, clockErrorMs: NaN}, {...selected, clockErrorMs: 1001}, {...selected, clockQualifiedUntilMs: Infinity}, {...selected, tokenFile: 'relative'}, {...selected, scan: true}]) {
    assert.throws(() => parseWindowsConfig(bad), error => error instanceof Error && !error.message.includes('private-token') && !error.message.includes('example.org'));
  }
});
