// The runtime starts with zero modules and serves health; its state stays private and outside every Git checkout.
import assert from 'node:assert/strict';
import {access, chmod, mkdir, stat, symlink, writeFile} from 'node:fs/promises';
import {get} from 'node:http';
import {dirname, join} from 'node:path';
import type {TestContext} from 'node:test';
import {MODULE_API_VERSION} from '@jimmie-potts/sdk';
import {HEALTH_PATH, startRuntime} from '../src/index.js';
import {health, it, run, stateDir, waitFor} from './support.js';

/** Fails unless `startRuntime` refuses `dir` with a message matching `pattern`. */
async function refuse(dir: string, pattern: RegExp): Promise<void> {
  await assert.rejects(startRuntime({modules: [], port: 0, stateDir: dir, log: () => {}}), pattern, dir);
}
const absent = (path: string, what: string): Promise<void> => assert.rejects(access(path), `${what}: ${path} was not created`);

/** GET health with the given headers, which fetch would not let a caller set. */
function getHealth(url: string, headers: Record<string, string>): Promise<{status: number; body: unknown}> {
  return new Promise((resolve, reject) => {
    get(new URL(HEALTH_PATH, url), {headers}, response => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).on('end', () => {
        resolve({status: response.statusCode ?? 0, body: JSON.parse(text) as unknown});
      });
    }).on('error', reject);
  });
}

async function base(context: TestContext): Promise<string> {
  return stateDir(context);
}

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
  const root = await base(context);
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, '.git'), {recursive: true});
  await refuse(join(checkout, 'state'), /inside a Git checkout/);
  const worktree = join(root, 'worktree');
  await mkdir(worktree);
  await writeFile(join(worktree, '.git'), 'gitdir: /elsewhere\n');
  await refuse(join(worktree, 'nested', 'state'), /inside a Git checkout/);
  await absent(join(worktree, 'nested'), 'inside a worktree');

  const shared = join(root, 'shared');
  await mkdir(shared);
  await chmod(shared, 0o750);
  await refuse(shared, /private to its owner/);
  await refuse('relative/state', /absolute path/);
  const real = join(root, 'real');
  await mkdir(real, {mode: 0o700});
  await symlink(real, join(root, 'link'));
  await refuse(join(root, 'link'), /through a link/);
});

it('checks the whole path before creating anything, and never creates through a link', async context => {
  const root = await base(context);
  const real = join(root, 'real');
  await mkdir(real, {mode: 0o700});
  await symlink(real, join(root, 'link'));
  await refuse(join(root, 'link', 'new', 'state'), /through a link/);
  await absent(join(real, 'new'), 'in the link\'s target');

  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, '.git'), {recursive: true});
  await mkdir(join(checkout, 'sub'));
  await symlink(join(checkout, 'sub'), join(root, 'into-checkout'));
  await refuse(join(root, 'into-checkout', 'state'), /through a link/);
  await absent(join(checkout, 'sub', 'state'), 'inside a checkout, through a link');
  await refuse(join(checkout, 'new', 'state'), /inside a Git checkout/);
  await absent(join(checkout, 'new'), 'inside a checkout');
});

it('says why it refuses a dangling link, a file and a path through a file', async context => {
  const root = await base(context);
  await symlink(join(root, 'nowhere'), join(root, 'dangling'));
  await refuse(join(root, 'dangling'), /through a link/);
  await refuse(join(root, 'dangling', 'state'), /through a link/);
  await absent(join(root, 'nowhere'), 'the dangling link\'s target');
  await writeFile(join(root, 'file'), '');
  await refuse(join(root, 'file'), /not a directory/);
  await refuse(join(root, 'file', 'state'), /not a directory/);
});

it('refuses a state directory on a Windows mount without creating anything there', async () => {
  const dir = `/mnt/bunny-runtime-test-${process.pid}/state`;
  await refuse(dir, /Windows mount/);
  await refuse('/mnt', /Windows mount/);
  await absent(dirname(dir), 'under /mnt');
});

it('answers only requests that name its loopback listener and carry no browser origin', async context => {
  const {runtime} = await run(context, {modules: []});
  const {host} = new URL(runtime.url);
  const port = new URL(runtime.url).port;
  const forbidden = {error: {code: 'forbidden', retryable: false, detail: 'health answers only local requests that name this listener'}};
  assert.equal((await getHealth(runtime.url, {host})).status, 200);
  assert.equal((await getHealth(runtime.url, {host: `localhost:${port}`})).status, 200);
  assert.equal((await getHealth(runtime.url, {host, 'sec-fetch-site': 'none'})).status, 200);
  assert.equal((await getHealth(runtime.url, {host: `LOCALHOST:${port}`})).status, 200, 'a host name is not case-sensitive');
  assert.equal((await getHealth(runtime.url, {host: `LocalHost:${port}`})).status, 200);
  for (const headers of [
    {host: `rebound.example:${port}`}, {host: '127.0.0.1'}, {host: `127.0.0.1:${Number(port) + 1}`}, {host: `localhost:${port}0`},
    {host, origin: 'http://rebound.example'}, {host, origin: runtime.url},
    {host, 'sec-fetch-site': 'cross-site'}, {host, 'sec-fetch-site': 'same-origin'},
  ]) {
    assert.deepEqual(await getHealth(runtime.url, headers), {status: 403, body: forbidden}, JSON.stringify(headers));
  }
});

it('health shows whether the event-loop lag check runs, and a watchdog that stops makes it degraded', async context => {
  const {runtime: plain} = await run(context, {modules: []});
  assert.deepEqual(plain.health().lagCheck, {status: 'off'});

  const {runtime: watched, logs: watchedLogs} = await run(context, {modules: [], lagCheck: {limitMs: 60_000}});
  assert.deepEqual(watched.health().lagCheck, {status: 'active', limitMs: 60_000});
  assert.equal(watched.health().status, 'ok');
  await watched.stop();
  assert.equal(watchedLogs.some(record => record.event_name === 'runtime.watchdog.stopped'), false, 'a stop on purpose is not a failure');

  const worker = new URL('./fixtures/exiting-worker.js', import.meta.url);
  const {runtime: broken, logs} = await run(context, {modules: [], lagCheck: {limitMs: 60_000, worker}});
  await waitFor(() => broken.health().lagCheck.status === 'stopped', 5000, 'the watchdog to stop');
  assert.deepEqual(broken.health().lagCheck, {status: 'stopped', limitMs: 60_000});
  assert.equal(broken.health().status, 'degraded');
  const stopped = logs.find(record => record.event_name === 'runtime.watchdog.stopped');
  assert.equal(stopped?.severity_text, 'ERROR');
  assert.equal(stopped.attributes['bunny.exit_code'], 0);
});
