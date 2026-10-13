import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NativeAdapter} from '../src/native.js';
import {FakeGatt} from './fake.js';
void test('native access is lazy and requires live writer ownership and a non-aborted admitted operation', async () => {
  let launches = 0, ownsWriter = false;
  const adapter = new NativeAdapter({targetAddress: '00:11:22:33:44:55', adapterAddress: '00:11:22:33:44:66', logDirectory: 'synthetic-private-log', ownsWriter: () => ownsWriter, launch: () => {launches++; return Promise.resolve(new FakeGatt());}});
  assert.equal(launches, 0);
  await assert.rejects(adapter.open(new AbortController().signal)); assert.equal(launches, 0);
  ownsWriter = true; const aborted = new AbortController(); aborted.abort();
  await assert.rejects(adapter.open(aborted.signal)); assert.equal(launches, 0);
  const gatt = await adapter.open(new AbortController().signal); assert.equal(launches, 1); await gatt.close();
});
