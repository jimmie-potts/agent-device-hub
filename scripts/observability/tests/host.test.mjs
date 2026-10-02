import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('host streams one correlated Hub-to-worker command through Pino and OTel with no duplicate log path', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [new URL('./fixtures/host.mjs', import.meta.url).pathname],
    { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /combined host verified/);
});

test('host rejects inherited OTel settings before SDK startup without exposing their values', () => {
  const env = { ...process.env, OTEL_EXPORTER_OTLP_HEADERS: 'secret=SYNTHETIC_SECRET' }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [new URL('./fixtures/host.mjs', import.meta.url).pathname, 'environment'],
    { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /environment refused/);
  assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_SECRET'), false);
});

test('stalled log and trace sinks preserve the same Hub command and account shutdown loss', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [new URL('./fixtures/host.mjs', import.meta.url).pathname, 'unavailable'],
    { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /unavailable host preserved command/);
});
