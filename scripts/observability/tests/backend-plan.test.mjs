import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendPlan, assertOwnedBackend, assertBackendIsolation, assertPublishedPorts, LGTM_IMAGE } from '../backend-plan.mjs';
const input = () => ({ runId: 'pilot-001', ownerToken: '12345678-1234-4123-8123-123456789012',
  configDirectory: '/workspace/.local/scratch/pilot-001/config',
  ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });

test('backend plan pins resources, isolated network and loopback listeners without ambient env', () => {
  const plan = backendPlan(input());
  assert.equal(plan.image, LGTM_IMAGE);
  assert.equal(plan.networkArgs.includes('--internal'), false);
  assert.equal(plan.version, '1.2');
  assert.ok(plan.containerArgs.includes('4294967296'));
  assert.ok(plan.containerArgs.includes('--cap-drop=ALL'));
  assert.ok(plan.containerArgs.includes('--security-opt=no-new-privileges'));
  assert.ok(plan.containerArgs.includes('ENABLE_OBI=false'));
  const bindings = plan.containerArgs.filter((value, index, all) => all[index - 1] === '--publish');
  assert.equal(bindings.length, 5); assert.ok(bindings.every(value => value.startsWith('127.0.0.1:')));
  assert.equal(plan.containerArgs.at(-1), LGTM_IMAGE);
  assert.equal(plan.containerArgs.includes('--privileged'), false);
  assert.equal(plan.containerArgs.includes('--rm'), false, 'retain stopped resources until evidence and owned cleanup');
  assert.ok(plan.containerArgs.includes('--pull=never'));
  assert.equal(plan.containerArgs[plan.containerArgs.indexOf('--log-driver') + 1], 'none');
});

test('unsafe paths, duplicate or privileged ports, ambiguous identities and extra overrides are refused', () => {
  for (const change of [{ runId: '../other' }, { ownerToken: 'not-owned' }, { configDirectory: '/etc' },
    { configDirectory: '/workspace/.local/a,readonly=false' }, { configDirectory: '/workspace/.local/../secrets' },
    { ports: { ...input().ports, otlp: 43000 } }, { ports: { ...input().ports, otlp: 80 } },
    { image: 'untrusted:latest' }, { ports: { ...input().ports, extra: 44000 } }]) {
    assert.throws(() => backendPlan({ ...input(), ...change }));
  }
});

test('cleanup ownership requires the exact recorded container id, name, image and all run labels', () => {
  const plan = backendPlan(input()), receipt = { containerId: 'a'.repeat(64), imageId: 'sha256:' + 'b'.repeat(64) };
  const inspect = { Id: receipt.containerId, Name: '/' + plan.containerName, Image: receipt.imageId,
    Config: { Image: LGTM_IMAGE, Labels: plan.labels } };
  assert.equal(assertOwnedBackend(inspect, plan, receipt), true);
  for (const change of [{ Id: 'c'.repeat(64) }, { Name: '/somebody-else' }, { Image: 'sha256:' + 'd'.repeat(64) },
    { Config: { Image: LGTM_IMAGE, Labels: { ...plan.labels, 'bunny.observability.owner': 'other' } } }]) {
    assert.throws(() => assertOwnedBackend({ ...inspect, ...change }, plan, receipt), /ownership/);
  }
});

test('resource and listener readback refuses any missing or expanded isolation setting', () => {
  const plan = backendPlan(input());
  const inspect = { HostConfig: { NetworkMode: plan.networkName, Privileged: false, PidMode: '', IpcMode: 'private',
    Memory: 4294967296, MemorySwap: 4294967296, NanoCpus: 2000000000,
    CapAdd: null, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Devices: [], PublishAllPorts: false,
    LogConfig: { Type: 'none', Config: {} },
    PortBindings: Object.fromEntries(Object.entries({ grafana: 3000, otlp: 4318, loki: 3100, tempo: 3200, health: 13133 })
      .map(([name, port]) => [port + '/tcp', [{ HostIp: '127.0.0.1', HostPort: String(plan.ports[name]) }]])) },
    Mounts: [{ Type: 'volume', Name: plan.volumeName, Destination: '/data', RW: true },
      ...['otelcol-config.yaml', 'loki-config.yaml'].map(name => ({ Type: 'bind', Source: input().configDirectory + '/' + name,
        Destination: '/otel-lgtm/' + name, RW: false }))] };
  assert.equal(assertBackendIsolation(inspect, plan), true);
  for (const field of [{ Memory: 0 }, { NanoCpus: 0 }, { Privileged: true }, { PidMode: 'host' },
    { IpcMode: 'host' }, { CapAdd: ['NET_ADMIN'] }, { PublishAllPorts: true }, { NetworkMode: 'bridge' },
    { SecurityOpt: [] }, { Devices: [{}] }, { PortBindings: {} }, { LogConfig: { Type: 'local' } }]) {
    assert.throws(() => assertBackendIsolation({ ...inspect, HostConfig: { ...inspect.HostConfig, ...field } }, plan), /isolation/);
  }
  assert.throws(() => assertBackendIsolation({ ...inspect, Mounts: [...inspect.Mounts, { Destination: '/host' }] }, plan), /isolation/);
});


test('running backend requires actual loopback mappings, not only requested bindings', () => {
  const plan = backendPlan(input());
  const ports = Object.fromEntries(Object.entries({ grafana: 3000, otlp: 4318, loki: 3100, tempo: 3200, health: 13133 })
    .map(([name, port]) => [port + '/tcp', [{ HostIp: '127.0.0.1', HostPort: String(plan.ports[name]) }]]));
  assert.equal(assertPublishedPorts({ NetworkSettings: { Ports: ports } }, plan), true);
  for (const changed of [undefined, {}, { ...ports, '3000/tcp': [] },
    { ...ports, '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '43000' }] },
    { ...ports, '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '44000' }] }]) {
    assert.throws(() => assertPublishedPorts({ NetworkSettings: { Ports: changed } }, plan), /published/);
  }
});

test('pinned pilot cannot replace bundled datasource plugins with unpinned startup downloads', () => {
  const plan = backendPlan(input());
  const env = plan.containerArgs.filter((_, index, all) => all[index - 1] === '--env');
  assert.ok(env.includes('GF_PLUGINS_PREINSTALL_DISABLED=true'));
  assert.ok(env.includes('GF_PLUGINS_PREINSTALL_AUTO_UPDATE=false'));
});
