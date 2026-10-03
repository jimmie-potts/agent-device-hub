import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backendPlan } from '../backend-plan.mjs';
import { normalizeVerifiedMounts } from '../backend-mounts.mjs';
const plan = backendPlan({ runId: 'mounts', ownerToken: '12345678-1234-4123-8123-123456789012',
  configDirectory: '/workspace/.local/mounts/config', ports: { grafana: 43000, otlp: 43001, loki: 43002, tempo: 43003, health: 43004 } });
const source = '/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Ubuntu/' + 'a'.repeat(64);

test('Desktop translated bind source requires matching local file identity; raw inspection remains intact', async () => {
  const original = { Mounts: [{ Type: 'bind', Destination: '/otel-lgtm/otelcol-config.yaml', Source: source, RW: false }] }, paths = [];
  const normalized = await normalizeVerifiedMounts(original, plan, async path => { paths.push(path); return { dev: 1, ino: 2, size: 100 }; });
  assert.equal(normalized.Mounts[0].Source, plan.configDirectory + '/otelcol-config.yaml');
  assert.equal(original.Mounts[0].Source, source);
  assert.deepEqual(paths, [plan.configDirectory + '/otelcol-config.yaml', source.replace('/run/desktop/mnt/host/wsl/', '/mnt/wsl/')]);
});

test('different files and arbitrary translated paths are refused, not adopted by prefix alone', async () => {
  const original = { Mounts: [{ Type: 'bind', Destination: '/otel-lgtm/otelcol-config.yaml', Source: source, RW: false }] };
  let n = 0;
  await assert.rejects(normalizeVerifiedMounts(original, plan, async () => ({ dev: 1, ino: ++n, size: 100 })), /identity/);
  const changed = structuredClone(original); changed.Mounts[0].Source = '/etc/passwd';
  await assert.rejects(normalizeVerifiedMounts(changed, plan, () => assert.fail('unknown path must not be read')), /source/);
});
