import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendPlan } from '../backend-plan.mjs';
import { networkReceipt, volumeReceipt, assertOwnedNetwork, assertOwnedVolume } from '../backend-resources.mjs';

const plan = backendPlan({ runId: 'resources-001', ownerToken: '12345678-1234-4123-8123-123456789012',
  configDirectory: '/workspace/.local/scratch/resources-001/config',
  ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
const network = () => ({ Id: 'a'.repeat(64), Name: plan.networkName, Created: '2026-10-02T00:00:00Z',
  Driver: 'bridge', Scope: 'local', Internal: false, Attachable: false, Ingress: false,
  Labels: { ...plan.labels }, Containers: {}, Options: {} });
const volume = () => ({ Name: plan.volumeName, CreatedAt: '2026-10-02T00:00:00Z', Driver: 'local',
  Scope: 'local', Labels: { ...plan.labels }, Options: null, Mountpoint: '/var/lib/docker/volumes/owned/_data' });

test('network receipt rejects foreign endpoints and replacement even with copied labels', () => {
  const initial = network(), receipt = networkReceipt(initial, plan);
  assert.equal(assertOwnedNetwork(initial, plan, receipt), true);
  const containerId = 'b'.repeat(64);
  const attached = { ...initial, Containers: { [containerId]: { Name: plan.containerName } } };
  assert.equal(assertOwnedNetwork(attached, plan, receipt, containerId), true);
  assert.throws(() => assertOwnedNetwork(attached, plan, receipt), /network/);
  for (const patch of [{ Id: 'c'.repeat(64) }, { Created: '2026-10-03T00:00:00Z' },
    { Internal: true }, { Driver: 'overlay' }, { Scope: 'swarm' }, { Attachable: true },
    { Ingress: true }, { Options: { 'com.docker.network.bridge.name': 'foreign' } },
    { Labels: {} }, { Containers: null }, { Name: 'foreign' }]) {
    assert.throws(() => assertOwnedNetwork({ ...initial, ...patch }, plan, receipt), /network/);
  }
  assert.throws(() => networkReceipt(attached, plan), /network/, 'creation must be empty');
});

test('volume receipt preserves creation identity and refuses driver options or substituted storage', () => {
  const initial = volume(), receipt = volumeReceipt(initial, plan);
  assert.equal(assertOwnedVolume(initial, plan, receipt), true);
  assert.equal(assertOwnedVolume({ ...initial, Options: {} }, plan, receipt), true);
  for (const patch of [{ CreatedAt: '2026-10-03T00:00:00Z' }, { Mountpoint: '/foreign' },
    { Driver: 'nfs' }, { Scope: 'global' }, { Labels: {} }, { Name: 'foreign' },
    { Options: { device: '/host', type: 'none', o: 'bind' } }, { CreatedAt: undefined }]) {
    assert.throws(() => assertOwnedVolume({ ...initial, ...patch }, plan, receipt), /volume/);
  }
  assert.throws(() => volumeReceipt({ ...initial, Options: { device: '/host' } }, plan), /volume/);
  assert.throws(() => assertOwnedVolume(initial, plan, { ...receipt, extra: true }), /volume/);
});

test('Docker 29 default IP options are accepted without allowing expanded network configuration', () => {
  const value = { ...network(), EnableIPv4: true, EnableIPv6: false,
    Options: { 'com.docker.network.enable_ipv4': 'true', 'com.docker.network.enable_ipv6': 'false' } };
  assert.equal(networkReceipt(value, plan).networkId, value.Id);
  for (const patch of [{ Options: { 'com.docker.network.enable_ipv6': 'true' } },
    { Options: { 'com.docker.network.enable_ipv4': 'false' } }, { EnableIPv6: true },
    { Options: { ...value.Options, 'com.docker.network.bridge.name': 'foreign' } }]) {
    assert.throws(() => networkReceipt({ ...value, ...patch }, plan), /network/);
  }
});
