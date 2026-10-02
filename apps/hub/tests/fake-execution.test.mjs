import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ControllerClient } from '../dist/controllers.js';
import { startFakeController } from './fake-controller.mjs';

function command(fake, percent = 42) {
  const s = fake.snapshot10();
  return { apiVersion: '1.0', controllerId: s.identity.controllerId, deviceId: s.identity.deviceId,
    requestId: s.nextRequestId, expectedConfigurationRevision: s.configurationRevision,
    expectedGeneration: s.generation, command: { kind: 'brightness.set', percent } };
}
async function fixture(t, execution = {}, timeoutMs = 2000) {
  const fake = await startFakeController({ execution });
  const client = new ControllerClient(fake.config(), timeoutMs);
  t.after(async () => { client.close(); await fake.close(); });
  return { fake, client };
}

test('queued admission and replay cause no effect until explicit fake execution', async t => {
  const { fake, client } = await fixture(t);
  const request = command(fake);
  assert.equal((await client.command(request)).body.outcome, 'queued');
  assert.equal((await client.command(request)).body.outcome, 'queued');
  assert.equal(fake.executionState().effects, 0);
  assert.equal(fake.executionState().queued, 1);
  const [executed] = fake.executeQueued();
  assert.deepEqual(executed.requestId, request.requestId);
  assert.equal(executed.receipt.outcome, 'sent');
  assert.deepEqual(executed.receipt.completedOperations, ['brightness']);
  assert.equal(fake.executionState().effects, 1);
  assert.equal(fake.executionState().brightness, 42);
  assert.equal((await client.command(request)).body.outcome, 'sent');
  assert.deepEqual(fake.executeQueued(), []);
  assert.equal(fake.executionState().effects, 1);
});

test('capacity rejection reserves no ticket and queue drain permits that same request', async t => {
  const { fake, client } = await fixture(t, { capacity: 1 });
  await client.command(command(fake));
  const next = command(fake, 43);
  await assert.rejects(client.command(next), error => error.code === 'capacity');
  assert.deepEqual(fake.snapshot10().nextRequestId, next.requestId);
  assert.equal(fake.executionState().queued, 1);
  fake.executeQueued();
  assert.equal((await client.command(next)).body.outcome, 'queued');
  fake.executeQueued();
  assert.equal(fake.executionState().effects, 2);
});

test('rejected native admission schedules no execution', async t => {
  const { fake, client } = await fixture(t);
  const request = command(fake); request.expectedConfigurationRevision++;
  assert.equal((await client.command(request)).body.outcome, 'failed');
  assert.equal(fake.executionState().queued, 0);
  assert.deepEqual(fake.executeQueued(), []);
  assert.equal(fake.executionState().effects, 0);
});

test('timeout after admission remains uncertain while the independent oracle proves one effect', async t => {
  const { fake, client } = await fixture(t, {}, 100);
  const request = command(fake);
  fake.answerNext({ mode: 'timeout' });
  await assert.rejects(client.command(request), error => error.code === 'uncertain-result');
  assert.equal(fake.executionState().queued, 1);
  fake.executeQueued();
  assert.equal(fake.executionState().effects, 1);
  assert.equal(fake.commands.length, 1, 'the client never retried');
  assert.equal((await client.command(request)).body.outcome, 'sent');
  assert.equal(fake.executionState().effects, 1, 'explicit replay is not another effect');
});

test('concurrent duplicate HTTP submissions reserve one queue entry', async t => {
  const { fake } = await fixture(t);
  const request = command(fake), config = fake.config();
  const submit = () => fetch(fake.endpoint + '/commands', { method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' }, body: JSON.stringify(request) });
  const responses = await Promise.all([submit(), submit()]);
  assert.ok(responses.every(response => response.ok));
  await Promise.all(responses.map(response => response.json()));
  assert.equal(fake.executionState().queued, 1);
  fake.executeQueued();
  assert.equal(fake.executionState().effects, 1);
});

test('automatic synthetic execution preserves exactly one effect across replay', async t => {
  const { fake, client } = await fixture(t, { autoDrain: true });
  const request = command(fake, 33);
  assert.equal((await client.command(request)).body.outcome, 'queued');
  await new Promise(setImmediate);
  assert.equal(fake.executionState().effects, 1);
  assert.equal((await client.command(request)).body.outcome, 'sent');
  assert.equal(fake.executionState().effects, 1);
});

test('restart cancels queued work and cannot execute an old epoch afterward', async t => {
  const { fake, client } = await fixture(t);
  await client.command(command(fake));
  fake.restart({ epoch: 'runtime-2' });
  assert.deepEqual(fake.executeQueued(), []);
  assert.equal(fake.executionState().cancelled, 1);
  assert.equal(fake.executionState().effects, 0);
  assert.equal(fake.takeExecutions()[0].outcome, 'cancelled');
  await client.command(command(fake));
  fake.executeQueued();
  assert.equal(fake.executionState().effects, 1);
});

test('longer workloads retain bounded history and explicitly count missing oracle evidence', async t => {
  const { fake, client } = await fixture(t);
  for (let i = 0; i < 270; i++) {
    await client.command(command(fake, i % 101));
    fake.executeQueued();
  }
  const state = fake.executionState();
  assert.equal(state.effects, 270);
  assert.equal(state.history, 256);
  assert.equal(state.historyDropped, 14);
  assert.equal(state.retainedReceipts, 256);
  assert.equal(fake.commands.length, 256);
  assert.ok(fake.requests.length <= 256);
  assert.equal(fake.takeExecutions().length, 256);
  assert.equal(fake.executionState().history, 0);
  assert.equal(fake.executionState().historyDropped, 14, 'draining cannot erase loss evidence');
});

test('invalid execution options are rejected before listening', async () => {
  for (const execution of [null, [], { capacity: 0 }, { capacity: 33 }, { autoDrain: 'yes' }, { unknown: true }]) {
    await assert.rejects(async () => {
      const unexpected = await startFakeController({ execution });
      await unexpected.close(); // A red assertion must not leave a listening fixture.
    }, /invalid/);
  }
});
