import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backendPlan } from '../backend-plan.mjs';
import { networkReceipt, volumeReceipt } from '../backend-resources.mjs';
import { hostTreeIdentity } from '../host-storage.mjs';
import { createResourceCallbacks } from '../resource-callbacks.mjs';
import { startResourceWatchdog } from '../resource-watchdog.mjs';
const GiB = 1024 ** 3;

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'rc-')), root = join(parent, '.local'); await mkdir(root);
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(join(root, 'synthetic-state'), 'test');
  const plan = backendPlan({ runId: 'callbacks', ownerToken: '12345678-1234-4123-8123-123456789012',
    configDirectory: join(root, 'config'), ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const states = {
    network: { Id: 'a'.repeat(64), Name: plan.networkName, Created: '2026-10-02T00:00:00Z', Driver: 'bridge', Scope: 'local',
      Internal: true, Attachable: false, Ingress: false, Labels: plan.labels, Containers: {}, Options: {} },
    volume: { Name: plan.volumeName, CreatedAt: '2026-10-02T00:00:00Z', Driver: 'local', Scope: 'local',
      Labels: plan.labels, Mountpoint: '/docker/owned/_data', Options: {} },
    container: { Id: 'b'.repeat(64), Name: '/' + plan.containerName, Image: 'sha256:' + 'c'.repeat(64),
      Config: { Image: plan.image, Labels: plan.labels }, State: { Running: true } },
  };
  const receipt = { containerId: states.container.Id, imageId: states.container.Image,
    network: networkReceipt(states.network, plan), volume: volumeReceipt(states.volume, plan) };
  const calls = [];
  const backend = {
    async inspect(kind) { calls.push('inspect:' + kind); return states[kind]; },
    async sampleStack(_plan, _receipt, options) { assert.ok(options.timeoutMs > 0); calls.push('stack');
      return { cgroupMemoryBytes: GiB }; },
    async sampleStorage(_plan, _receipt, options) { calls.push('storage'); assert.ok(options.hostRunBytes >= 4);
      return { runDataBytes: options.hostRunBytes + 1000, minimumAvailableBytes: 3 * GiB, oomKilled: false }; },
    async stop() { calls.push('stop'); states.container.State.Running = false; },
  };
  const hostRoots = [await hostTreeIdentity(root)];
  const hostProbe = async () => ({ availableMemoryBytes: 9 * GiB, availableDiskBytes: 4 * GiB });
  return { plan, receipt, backend, hostRoots, hostProbe, states, calls };
}

test('callbacks combine actual host-file counts and pinned backend measurements under one deadline', async t => {
  const f = await fixture(t), callbacks = createResourceCallbacks(f);
  const sample = await callbacks.sample({ timeoutMs: 1000 });
  assert.ok(sample.runDataBytes >= 1004); assert.equal(sample.cgroupMemoryBytes, GiB);
  assert.equal(sample.hostAvailableMemoryBytes, 9 * GiB);
  assert.equal(sample.minimumAvailableBytes, 3 * GiB);
  assert.deepEqual(f.calls, ['inspect:network', 'inspect:volume', 'stack', 'storage']);
});

test('foreign volume and cancellation prevent backend probe execution', async t => {
  const f = await fixture(t), callbacks = createResourceCallbacks(f);
  f.states.volume.Labels = {};
  await assert.rejects(callbacks.sample({ timeoutMs: 1000 }), /volume/);
  assert.equal(f.calls.includes('storage'), false);
  f.calls.length = 0;
  await assert.rejects(callbacks.sample({ signal: AbortSignal.abort(), timeoutMs: 1000 }), /aborted/);
  assert.deepEqual(f.calls, []);
});

test('stop uses exact ownership and confirms fresh stopped state, with no force or retry', async t => {
  const f = await fixture(t), callbacks = createResourceCallbacks(f);
  assert.deepEqual(await callbacks.stopOwned({ timeoutMs: 1000 }), { confirmed: true, state: 'stopped' });
  assert.deepEqual(f.calls, ['inspect:container', 'stop', 'inspect:container']);
  f.states.container.Id = 'd'.repeat(64); f.calls.length = 0;
  await assert.rejects(callbacks.stopOwned({ timeoutMs: 1000 }), /ownership/);
  assert.deepEqual(f.calls, ['inspect:container']);
});

test('stop refusal stays unconfirmed; missing host metrics stay null', async t => {
  const f = await fixture(t); f.backend.stop = async () => {};
  f.hostProbe = async () => ({ availableMemoryBytes: null, availableDiskBytes: null });
  const callbacks = createResourceCallbacks(f);
  assert.deepEqual(await callbacks.stopOwned({ timeoutMs: 1000 }), { confirmed: false, state: 'running' });
  const sample = await callbacks.sample({ timeoutMs: 1000 });
  assert.equal(sample.hostAvailableMemoryBytes, null); assert.equal(sample.minimumAvailableBytes, null);
});

test('watchdog wired to resource callbacks stops the recorded backend on a measured cap breach', async t => {
  const f = await fixture(t);
  f.backend.sampleStorage = async () => ({ runDataBytes: 3 * GiB, minimumAvailableBytes: 3 * GiB });
  const records = [];
  const watchdog = startResourceWatchdog({ ...createResourceCallbacks(f), record: async value => records.push(value) });
  assert.equal(await watchdog.ready, false);
  const result = await watchdog.done;
  assert.equal(result.reason, 'run-data-cap'); assert.equal(result.stopConfirmed, true);
  assert.equal(f.calls.filter(call => call === 'stop').length, 1);
  assert.equal(records[0].values.runDataBytes, 3 * GiB);
  assert.equal(f.states.container.State.Running, false);
});
