import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareBackendDirectory } from '../backend-files.mjs';
import { backendCreateRequests } from '../backend-create.mjs';
import { allocateBackend } from '../backend-allocation.mjs';
import { registerHostRoots } from '../host-roots.mjs';
import { withReadyBackend } from '../backend-session.mjs';
const GiB = 1024 ** 3;
async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'bs-')), local = join(parent, '.local'); await mkdir(local);
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(local, 'run'), stateParent = join(local, 'state'); await mkdir(stateParent);
  const { plan } = await prepareBackendDirectory(directory, { runId: 'session',
    ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
  const states = {}, calls = [], ids = { network: 'a'.repeat(64), container: 'b'.repeat(64), volume: plan.volumeName };
  const image = { Id: 'sha256:' + 'c'.repeat(64), Size: GiB, Os: 'linux', Architecture: 'amd64',
    RepoDigests: ['grafana/otel-lgtm@' + plan.image.split('@')[1]] };
  const backend = {
    async inspectImage() { return image; }, async inspectPlanned(kind) { return states[kind] ?? null; },
    async create(kind) {
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
    async inspect(kind) { return structuredClone(states[kind]); },
    async start() { assert.equal(JSON.parse(await readFile(join(directory, 'startup-intent.json'))).action, 'start');
      calls.push('start'); states.container.State.Running = true; },
    async stop() { calls.push('stop'); states.container.State.Running = false; },
    async sampleStack() { return { cgroupMemoryBytes: GiB, oomKilled: false }; },
    async sampleStorage(_p, _r, options) { return { runDataBytes: options.hostRunBytes, minimumAvailableBytes: 4 * GiB }; },
  };
  const hostProbe = async () => ({ ready: true, availableMemoryBytes: 16 * GiB, availableDiskBytes: 10 * GiB });
  await allocateBackend({ directory, backend, hostProbe }); await registerHostRoots(directory, stateParent);
  return { directory, backend, monitorBackend: { ...backend }, hostProbe, states, calls,
    healthProbe: async () => ({ ready: true, services: [] }) };
}

test('session requires saved resource readiness before action and retains stop/monitor evidence', async t => {
  const f = await fixture(t); let actionCalls = 0;
  const result = await withReadyBackend({ ...f, action: async ({ signal }) => { assert.equal(signal.aborted, false); actionCalls++; } });
  assert.equal(actionCalls, 1); assert.equal(result.ready, true); assert.equal(result.actionComplete, true);
  assert.equal(result.stopConfirmed, true); assert.equal(result.qualification, 'unexecuted');
  assert.equal(result.monitor.evidenceSaved, true); assert.deepEqual(f.calls, ['start', 'stop']);
  assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'startup-result.json'))), result);
  await assert.rejects(withReadyBackend(f), /EEXIST/); assert.deepEqual(f.calls, ['start', 'stop']);
});

test('health deadline prevents action and stops only the owned backend', async t => {
  const f = await fixture(t); f.healthProbe = async () => ({ ready: false, services: [] });
  const result = await withReadyBackend({ ...f, readinessTimeoutMs: 30, action: () => assert.fail('not ready') });
  assert.equal(result.ready, false); assert.equal(result.failure, 'readiness-failed');
  assert.equal(result.stopConfirmed, true); assert.deepEqual(f.calls, ['start', 'stop']);
});

test('resource cap prevents action and watchdog stop is not repeated', async t => {
  const f = await fixture(t);
  f.monitorBackend.sampleStorage = async () => ({ runDataBytes: 3 * GiB, minimumAvailableBytes: 4 * GiB });
  const result = await withReadyBackend({ ...f, action: () => assert.fail('cap breached') });
  assert.equal(result.actionComplete, false); assert.equal(result.monitor.reason, 'run-data-cap');
  assert.equal(result.stopConfirmed, true); assert.deepEqual(f.calls, ['start', 'stop']);
});

test('ambiguous start is not retried and a fresh owned stop establishes final state', async t => {
  const f = await fixture(t), start = f.backend.start;
  f.backend.start = async () => { await start(); throw new Error('SYNTHETIC_SECRET'); };
  const result = await withReadyBackend(f);
  assert.equal(result.failure, 'start-unconfirmed'); assert.equal(result.stopConfirmed, true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false); assert.deepEqual(f.calls, ['start', 'stop']);
});

test('changed ownership before startup prevents starting or stopping another container', async t => {
  const f = await fixture(t); f.states.container.Id = 'd'.repeat(64);
  await assert.rejects(withReadyBackend(f), /ownership/); assert.deepEqual(f.calls, []);
});

test('action failure and deadline are retained without repeating action or claiming completion', async t => {
  for (const mode of ['throw', 'timeout']) {
    const f = await fixture(t); let count = 0;
    const result = await withReadyBackend({ ...f, actionTimeoutMs: 20, action: async ({ signal }) => {
      count++; if (mode === 'throw') throw new Error('SYNTHETIC_SECRET');
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    } });
    assert.equal(count, 1); assert.equal(result.actionComplete, false); assert.equal(result.failure, 'action-failed');
    assert.equal(result.stopConfirmed, true); assert.deepEqual(f.calls, ['start', 'stop']);
  }
});

test('a later resource failure aborts in-flight action and cannot become successful completion', async t => {
  const f = await fixture(t); let actionEntered = false;
  f.monitorBackend.sampleStorage = async (_p, _r, options) => ({
    runDataBytes: actionEntered ? 3 * GiB : options.hostRunBytes, minimumAvailableBytes: 4 * GiB });
  const result = await withReadyBackend({ ...f, action: async ({ signal }) => {
    actionEntered = true;
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  } });
  assert.equal(actionEntered, true); assert.equal(result.failure, 'resource-monitor-failed');
  assert.equal(result.monitor.reason, 'run-data-cap'); assert.equal(result.stopConfirmed, true);
  assert.deepEqual(f.calls, ['start', 'stop']);
});

test('normal stop failure remains unconfirmed and is never retried', async t => {
  const f = await fixture(t);
  f.monitorBackend.stop = async () => { f.calls.push('stop-refused'); throw new Error('private detail'); };
  const result = await withReadyBackend(f);
  assert.equal(result.failure, 'stop-unconfirmed'); assert.equal(result.stopConfirmed, false);
  assert.deepEqual(f.calls, ['start', 'stop-refused']);
});
