import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {encodeRpc} from '../src/transport/rpc.js';

void test('the final encoder permits the exact observational RPC and fixed local parameters', () => {
  const bytes = encodeRpc('get_status', 'local', [], 42, 1_700_000_000);
  const outer: unknown = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(outer, {dps: {'101': JSON.stringify({id: 42, method: 'get_status', params: []})}, t: 1_700_000_000});
});

void test('the final encoder refuses commands, discovery, photos, map switches, routes and parameters', () => {
  const refused = (method: string, route: 'local' | 'mqtt', params: readonly unknown[]): void => {
    assert.throws(() => encodeRpc(method, route, params, 42, 1_700_000_000),
      (error: unknown) => error instanceof SdkError && error.body.error.code === 'forbidden');
  };
  for (const method of ['app_start', 'app_pause', 'app_stop', 'app_charge', 'load_multi_map', 'get_photo', 'discover', 'get_prop', 'app_get_init_status', 'anything']) {
    refused(method, 'local', []);
    refused(method, 'mqtt', []);
  }
  refused('get_status', 'mqtt', []);
  refused('get_map_v1', 'local', []);
  refused('get_status', 'local', ['app_start']);
  refused('get_clean_record', 'local', [-1]);
  refused('get_clean_record', 'local', [1, 2]);
});

void test('all five local reads and the secured MQTT map use the fixed allowlist', () => {
  for (const [method, params] of [
    ['get_status', []], ['get_consumable', []], ['get_clean_summary', []],
    ['get_clean_record', [1700000000]], ['get_room_mapping', []],
  ] as const) {
    const result = JSON.parse(encodeRpc(method, 'local', params, 42, 1700000000).toString()) as {dps: {'101': string}};
    assert.deepEqual(JSON.parse(result.dps['101']) as unknown, {id: 42, method, params});
  }
  const security = {endpoint: 'YWJjZGVm', nonce: Buffer.alloc(16, 0xab)};
  const result = JSON.parse(encodeRpc('get_map_v1', 'mqtt', [], 42, 1700000000, security).toString()) as {dps: {'101': string}};
  assert.deepEqual(JSON.parse(result.dps['101']) as unknown, {id: 42, method: 'get_map_v1', params: [], security: {endpoint: security.endpoint, nonce: 'AB'.repeat(16)}});
  assert.throws(() => encodeRpc('get_map_v1', 'mqtt', [], 42, 1700000000, {...security, endpoint: `${security.endpoint}\n`}), (error: unknown) => error instanceof SdkError && error.body.error.code === 'forbidden');
});
