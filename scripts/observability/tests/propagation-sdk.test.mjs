import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('Node 24 HTTP and fetch propagate only to owned origins with isolated concurrent traces', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [new URL('./fixtures/propagation-sdk.mjs', import.meta.url).pathname],
    { env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /propagation verified/);
});

test('actual authenticated Hub command routes preserve OTel parentage and isolated correlation', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [new URL('./fixtures/hub-sdk.mjs', import.meta.url).pathname],
    { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /Hub SDK context verified/);
});
