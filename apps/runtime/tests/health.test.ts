// The runtime starts with zero modules and serves health; its state stays private and outside every Git checkout.
import assert from 'node:assert/strict';
import {chmod, mkdir, stat, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {HEALTH_PATH, startRuntime} from '../src/index.js';
import {health, it, run, stateDir} from './support.js';

it('starts with zero modules and serves health on a loopback port', async context => {
  const {runtime, logs} = await run(context, {modules: []});
  const url = new URL(runtime.url);
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(Number(url.port) > 0, 'port 0 picks a free port');

  const {status, body} = await health(runtime.url);
  assert.equal(status, 200);
  assert.equal(body.schema, 'runtime-health/1.0');
  assert.equal(body.status, 'ok');
  assert.equal(body.moduleApiVersion, MODULE_API_VERSION);
  assert.deepEqual(body.modules, []);
  assert.ok(Number.isSafeInteger(body.startedAtMs));
  assert.ok(body.uptimeMs >= 0);
  for (const [name, value] of Object.entries(body.memory)) assert.ok(Number.isSafeInteger(value) && value > 0, name);
  assert.deepEqual(runtime.health().modules, []);
  assert.ok(logs.some(record => record.event_name === 'runtime.started' && record.scope.name === 'bunny.runtime'));
});

it('answers every other route with not-found in the shared error body', async context => {
  const {runtime} = await run(context, {modules: []});
  for (const [method, path] of [['GET', '/'], ['POST', HEALTH_PATH], ['GET', `${HEALTH_PATH}?verbose=1`], ['GET', '/api/runtime/v2/health']]) {
    const response = await fetch(new URL(path ?? '', runtime.url), {method: method ?? 'GET'});
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.deepEqual(await response.json(), {error: {code: 'not-found', retryable: false, detail: 'no such route'}});
  }
});

it('stopping the runtime closes its health server, and stopping again is harmless', async context => {
  const {runtime} = await run(context, {modules: []});
  await runtime.stop();
  await assert.rejects(fetch(new URL(HEALTH_PATH, runtime.url)));
  await runtime.stop();
});

it('creates a missing state directory private to its owner', async context => {
  const dir = join(await stateDir(context), 'nested', 'runtime');
  await run(context, {modules: [], stateDir: dir});
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
});

it('refuses a state directory inside a Git checkout, open to others, relative or reached through a link', async context => {
  const base = await stateDir(context);
  const refuse = async (dir: string, pattern: RegExp): Promise<void> => {
    await assert.rejects(startRuntime({modules: [], port: 0, stateDir: dir, log: () => {}}), pattern, dir);
  };
  const checkout = join(base, 'checkout');
  await mkdir(join(checkout, '.git'), {recursive: true});
  await refuse(join(checkout, 'state'), /inside a Git checkout/);
  const worktree = join(base, 'worktree');
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), 'gitdir: /elsewhere\n');
  await refuse(join(worktree, 'nested', 'state'), /inside a Git checkout/);

  const shared = join(base, 'shared');
  await mkdir(shared);
  await chmod(shared, 0o750);
  await refuse(shared, /private to its owner/);
  await refuse('relative/state', /absolute path/);
  const real = join(base, 'real');
  await mkdir(real, {mode: 0o700});
  await symlink(real, join(base, 'link'));
  await refuse(join(base, 'link'), /through a link/);
});
