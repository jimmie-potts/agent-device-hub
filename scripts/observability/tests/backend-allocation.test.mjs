import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { backendCreateRequests } from '../backend-create.mjs';
import { allocateBackend } from '../backend-allocation.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'al-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, '.local');
  const { plan } = await prepareBackendDirectory(directory, { runId: 'allocation-001',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const created = [], states = {}, ids = { network: 'a'.repeat(64), container: 'b'.repeat(64), volume: plan.volumeName };
  const image = { Id: 'sha256:' + 'c'.repeat(64), Size: 2 * 1024 ** 3, Os: 'linux', Architecture: 'amd64',
    RepoDigests: ['grafana/otel-lgtm@' + plan.image.split('@')[1]] };
  const backend = {
    async inspectImage() { return image; },
    async inspectPlanned(kind) { return states[kind] ?? null; },
    async create(kind) {
      const intent = JSON.parse(await readFile(join(directory, 'allocation', `${kind}-intent.json`), 'utf8'));
      assert.equal(intent.action, 'create'); assert.equal(intent.kind, kind);
      created.push(kind);
      if (kind === 'network') states[kind] = { Id: ids.network, Name: plan.networkName, Created: '2026-10-02T00:00:00Z',
        Labels: plan.labels, Driver: 'bridge', Scope: 'local', Internal: true, Attachable: false, Ingress: false, Containers: {}, Options: {} };
      if (kind === 'volume') states[kind] = { Name: plan.volumeName, CreatedAt: '2026-10-02T00:00:00Z', Driver: 'local',
        Scope: 'local', Mountpoint: '/docker/owned/_data', Labels: plan.labels, Options: null };
      if (kind === 'container') {
        const config = backendCreateRequests(plan).container.body;
        states[kind] = { Id: ids.container, Name: '/' + plan.containerName, Image: image.Id,
          Config: config, HostConfig: config.HostConfig, State: { Running: false },
          Mounts: config.HostConfig.Mounts.map(m => ({ ...m, Name: m.Type === 'volume' ? m.Source : undefined,
            Destination: m.Target, RW: !m.ReadOnly })) };
      }
      return { id: ids[kind], warningCount: 0 };
    },
    async inspect(kind) { return states[kind]; },
    async start() { assert.fail('allocation must not start workload before readiness gates'); },
  };
  return { directory, plan, backend, created, states, image, hostProbe: async () => ({ ready: true }) };
}

test('allocation saves each intent before creation and verifies stopped resources into a durable receipt', async t => {
  const f = await fixture(t), receipt = await allocateBackend(f);
  assert.deepEqual(f.created, ['network', 'volume', 'container']);
  assert.equal(receipt.stage, 'allocated-stopped');
  assert.equal(receipt.qualification, 'unexecuted');
  assert.equal(receipt.containerId, f.states.container.Id);
  assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'allocation', 'receipt.json'), 'utf8')), receipt);
  await assert.rejects(allocateBackend(f));
  assert.equal(f.created.length, 3, 'existing attempt cannot repeat creation');
});

test('host capacity, image cap and existing resources each prevent every creation', async t => {
  for (const change of [f => { f.hostProbe = async () => ({ ready: false }); },
    f => { f.image.Size = 11 * 1024 ** 3; }, f => { f.states.volume = { Name: 'other' }; }]) {
    const f = await fixture(t); change(f);
    await assert.rejects(allocateBackend(f)); assert.deepEqual(f.created, []);
  }
});

test('ambiguous creation preserves its intent and cannot be rerun in the same attempt', async t => {
  const f = await fixture(t), create = f.backend.create;
  f.backend.create = async kind => { await create(kind); throw new Error('lost response'); };
  await assert.rejects(allocateBackend(f), /lost response/);
  assert.deepEqual(f.created, ['network']);
  assert.equal(JSON.parse(await readFile(join(f.directory, 'allocation', 'network-intent.json'))).kind, 'network');
  await assert.rejects(allocateBackend(f));
  assert.deepEqual(f.created, ['network']);
});

test('warnings and ownership mismatch preserve returned identity and stop dependent allocation', async t => {
  for (const mode of ['warning', 'foreign']) {
    const f = await fixture(t), create = f.backend.create;
    f.backend.create = async kind => {
      const result = await create(kind);
      if (mode === 'warning') result.warningCount = 1;
      else f.states[kind].Labels = {};
      return result;
    };
    await assert.rejects(allocateBackend(f));
    assert.deepEqual(f.created, ['network']);
    assert.equal(JSON.parse(await readFile(join(f.directory, 'allocation', 'network-returned.json'))).id, 'a'.repeat(64));
  }
});

test('network replacement between allocations prevents creation of a dependent container', async t => {
  const f = await fixture(t), inspect = f.backend.inspect;
  f.backend.inspect = async (kind, ...args) => {
    const result = await inspect(kind, ...args);
    if (kind === 'volume') f.states.network.Id = 'd'.repeat(64);
    return result;
  };
  await assert.rejects(allocateBackend(f), /network/);
  assert.deepEqual(f.created, ['network', 'volume']);
});
