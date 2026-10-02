import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotV1_0 } from '../../../apps/hub/tests/fake-controller.mjs';
import { createBrightnessOperation } from '../workload-operation.mjs';

const snapshot = snapshotV1_0();
const ready = () => ({ url: 'http://127.0.0.1:43210', token: 's'.repeat(43), request: {
  apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
  requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
  expectedGeneration: snapshot.generation, command: { kind: 'brightness.set', percent: 42 },
} });

test('one attempt per ordinal advances tickets independently of omitted schedule slots', async () => {
  const requests = [], initial = ready();
  const operation = createBrightnessOperation(initial, { fetchImpl: async (url, options) => {
    requests.push({ url, ...options }); return new Response('{}', { status: 409 });
  } });
  const first = await operation({ ordinal: 0, slot: 0 });
  await assert.rejects(operation({ ordinal: 0, slot: 1 }), /ordinal/);
  const second = await operation({ ordinal: 1, slot: 4 });
  assert.equal(requests.length, 2); assert.equal(first.validReceipt, false); assert.equal(second.status, 409);
  assert.equal(JSON.parse(requests[1].body).requestId.sequence, snapshot.nextRequestId.sequence + 1);
  assert.equal(JSON.parse(requests[1].body).expectedConfigurationRevision, snapshot.configurationRevision + 1);
  assert.notEqual(first.traceId, second.traceId);
  assert.match(requests[0].headers.traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  assert.equal(requests[0].headers.baggage,'private=SYNTHETIC_PRIVATE_CANARY');
  assert.equal(requests[0].headers['x-pilot-private'],'SYNTHETIC_PRIVATE_CANARY');
  assert.equal(requests[0].redirect, 'error');
  assert.deepEqual(initial, ready());
});

test('failed HTTP attempts are never replayed and private or oversized bodies cannot enter evidence', async () => {
  let calls = 0;
  const operation = createBrightnessOperation(ready(), { fetchImpl: async () => {
    calls++; if (calls === 1) throw new Error('SYNTHETIC_PRIVATE_CANARY');
    return new Response('SYNTHETIC_PRIVATE_CANARY'.repeat(1000), { status: 500 });
  } });
  await assert.rejects(operation({ ordinal: 0 }));
  await assert.rejects(operation({ ordinal: 0 }), /ordinal/);
  const result = await operation({ ordinal: 1 });
  assert.equal(calls, 2); assert.equal(result.validReceipt, false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_CANARY'), false);
  assert.throws(() => createBrightnessOperation({ ...ready(), url: 'http://example.com' }), /invalid/);
});
