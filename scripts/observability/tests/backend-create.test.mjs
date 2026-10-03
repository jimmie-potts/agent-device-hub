import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendPlan } from '../backend-plan.mjs';
import { backendCreateRequests, assertPinnedImage } from '../backend-create.mjs';
const plan = backendPlan({ runId: 'create-001', ownerToken: '12345678-1234-4123-8123-123456789012',
  configDirectory: '/workspace/.local/scratch/create-001/config',
  ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });

test('Engine requests preserve the frozen resource and privacy limits without arbitrary overrides', () => {
  const requests = backendCreateRequests(plan), c = requests.container.body;
  assert.deepEqual(requests.network.body, { Name: plan.networkName, Driver: 'bridge', Internal: false,
    Attachable: false, Ingress: false, Labels: plan.labels });
  assert.deepEqual(requests.volume.body, { Name: plan.volumeName, Driver: 'local', Labels: plan.labels });
  assert.equal(c.Image, plan.image);
  assert.equal(c.StopTimeout, 20);
  assert.equal(c.HostConfig.NetworkMode, plan.networkName);
  assert.equal(c.HostConfig.Memory, 4294967296);
  assert.equal(c.HostConfig.MemorySwap, 4294967296);
  assert.equal(c.HostConfig.NanoCpus, 2000000000);
  assert.deepEqual(c.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(c.HostConfig.SecurityOpt, ['no-new-privileges']);
  assert.deepEqual(c.HostConfig.RestartPolicy, { Name: 'no' });
  assert.equal(c.HostConfig.AutoRemove, false);
  assert.equal(c.HostConfig.Mounts.length, 3);
  assert.equal(c.HostConfig.Mounts.filter(m => m.Type === 'bind' && m.ReadOnly).length, 2);
  assert.ok(Object.values(c.HostConfig.PortBindings).every(v => v.length === 1 && v[0].HostIp === '127.0.0.1'));
  assert.deepEqual(c.Env, plan.containerArgs.filter((_, i, all) => all[i - 1] === '--env'));
  for (const patch of [{ image: 'other:latest' }, { containerArgs: [] }, { limits: {} },
    { containerName: 'foreign' }, { ports: { ...plan.ports, otlp: 80 } }]) {
    assert.throws(() => backendCreateRequests({ ...plan, ...patch }));
  }
});

test('image readiness requires the pinned digest, platform, safe ID and full unpacked size', () => {
  const inspect = { Id: 'sha256:' + 'a'.repeat(64), Os: 'linux', Architecture: 'amd64',
    Size: 2 * 1024 ** 3, RepoDigests: ['grafana/otel-lgtm@' + plan.image.split('@')[1]] };
  assert.deepEqual(assertPinnedImage(inspect, plan), { imageId: inspect.Id, imageBytes: inspect.Size });
  for (const patch of [{ Size: plan.limits.imageBytes + 1 }, { Size: undefined }, { Size: -1 },
    { Architecture: 'arm64' }, { Os: 'windows' }, { RepoDigests: [] }, { Id: 'not-an-id' }]) {
    assert.throws(() => assertPinnedImage({ ...inspect, ...patch }, plan), /image/);
  }
});
