import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupBackend } from '../backend-cleanup.mjs';
import { backendPlan } from '../backend-plan.mjs';
import { networkReceipt, volumeReceipt } from '../backend-resources.mjs';

function fixture() {
  const plan = backendPlan({ runId: 'cleanup-001', ownerToken: '12345678-1234-4123-8123-123456789012',
    configDirectory: '/workspace/.local/scratch/cleanup-001/config',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const containerId = 'a'.repeat(64), imageId = 'sha256:' + 'b'.repeat(64);
  const state = {
    container: { Id: containerId, Name: '/' + plan.containerName, Image: imageId,
      Config: { Image: plan.image, Labels: plan.labels }, State: { Running: true } },
    network: { Id: 'c'.repeat(64), Name: plan.networkName, Created: '2026-10-02T00:00:00Z',
      Driver: 'bridge', Scope: 'local', Internal: true, Attachable: false, Ingress: false,
      Labels: plan.labels, Containers: {}, Options: {} },
    volume: { Name: plan.volumeName, CreatedAt: '2026-10-02T00:00:00Z', Driver: 'local',
      Scope: 'local', Labels: plan.labels, Options: {}, Mountpoint: '/docker/owned/_data' },
  };
  const receipt = { containerId, imageId, network: networkReceipt(state.network, plan),
    volume: volumeReceipt(state.volume, plan) };
  state.network.Containers[containerId] = { Name: plan.containerName };
  const effects = [], events = [];
  const backend = {
    async inspect(kind) { return structuredClone(state[kind]); },
    async stop(id) { effects.push(['stop', id]); state.container.State.Running = false; },
    async remove(kind, id) { effects.push(['remove', kind, id]); state[kind] = null;
      if (kind === 'container') state.network.Containers = {}; },
  };
  return { plan, receipt, state, effects, events, backend, record: async event => events.push(event), evidenceSaved: true };
}

test('cleanup checks all ownership first, removes only owned resources and verifies absence', async () => {
  const f = fixture();
  const result = await cleanupBackend(f);
  assert.equal(result.complete, true);
  assert.deepEqual(f.effects, [['stop', f.receipt.containerId], ['remove', 'container', f.receipt.containerId],
    ['remove', 'network', f.receipt.network.networkId], ['remove', 'volume', f.plan.volumeName]]);
  assert.equal(f.events.filter(x => x.phase === 'intent').length, 4);
  assert.equal(f.events.at(-1).phase, 'complete');
  await cleanupBackend(f);
  assert.equal(f.effects.length, 4, 'interrupted/repeated cleanup does not recreate or repeat removals');
});

test('foreign resource, missing saved evidence or failed durable intent prevents mutation', async () => {
  for (const configure of [f => { f.state.volume.Labels = {}; },
    f => { f.state.network.Containers['d'.repeat(64)] = { Name: 'other-owner' }; },
    f => { f.evidenceSaved = false; }, f => { f.record = async () => { throw new Error('disk full'); }; }]) {
    const f = fixture(); configure(f);
    await assert.rejects(cleanupBackend(f));
    assert.deepEqual(f.effects, []);
  }
});

test('fresh readback detects replacement after stop and refuses deletion', async () => {
  const f = fixture(), stop = f.backend.stop;
  f.backend.stop = async id => { await stop(id); f.state.container.Id = 'e'.repeat(64); };
  await assert.rejects(cleanupBackend(f), /ownership/);
  assert.deepEqual(f.effects, [['stop', f.receipt.containerId]]);
});

test('deadline aborts a hung adapter and leaves further mutations untouched', async () => {
  const f = fixture(); let aborted = false;
  f.backend.stop = async (_id, { signal }) => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true });
  });
  await assert.rejects(cleanupBackend({ ...f, timeoutMs: 20 }), /deadline/);
  assert.equal(aborted, true);
  assert.deepEqual(f.effects, []);
});

test('ambiguous removal is retained as incomplete and the next cleanup uses fresh state', async () => {
  const f = fixture(), remove = f.backend.remove;
  f.backend.remove = async (kind, id) => {
    await remove(kind, id);
    if (kind === 'container') throw new Error('lost command result');
  };
  await assert.rejects(cleanupBackend(f), /lost command result/);
  assert.equal(f.events.some(event => event.phase === 'complete'), false);
  assert.ok(f.state.network); assert.ok(f.state.volume);
  f.backend.remove = remove;
  assert.equal((await cleanupBackend(f)).complete, true);
  assert.equal(f.effects.filter(effect => effect[1] === 'container').length, 1);
});

test('inspect failure never counts as absence or authorizes further cleanup', async () => {
  const f = fixture();
  f.backend.inspect = async () => { throw new Error('daemon unreachable'); };
  await assert.rejects(cleanupBackend(f), /daemon unreachable/);
  assert.deepEqual(f.effects, []);
  assert.deepEqual(f.events, []);
});
