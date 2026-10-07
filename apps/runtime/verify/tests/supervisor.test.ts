// Hub #920: a runtime verification run's supervisor. Stopping it ends its runtime, both listeners and every process; a
// runtime whose supervisor dies stops itself; a crash restarts the runtime on the same port and state directory; and the
// harness API answers only local JSON requests that name its listener.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {request} from 'node:http';
import {test} from 'node:test';
import {connectRemote} from '@jimmie-potts/sdk';
import {switchLamp} from '../../tests/fixtures/lamp.js';
import {readGrants} from '../adapter.js';
import {HARNESS_PATH, type HarnessState} from '../protocol.js';
import {alive, base, listening, startRun, type Started} from './support.js';

const children = (pid: number): number[] =>
  execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], {encoding: 'utf8'}).split('\n').map(Number).filter(child => child > 0);
const portOf = (url: string): number => Number(new URL(url).port);
async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!await condition()) {
    if (performance.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise(resolve => { setTimeout(resolve, 50); });
  }
}
async function state(run: Started): Promise<HarnessState> {
  return await (await fetch(new URL(`${HARNESS_PATH}/state`, run.harness))).json() as HarnessState;
}

void test('stopping a run ends its runtime and both listeners, and leaves no process behind', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'fixtures');
  const pid = run.supervisor.pid ?? 0;
  const runtimes = children(pid);
  assert.equal(runtimes.length, 1, 'one runtime child');
  assert.ok(await listening(portOf(run.url)) && await listening(portOf(run.harness)));
  assert.deepEqual(await run.stop(), {code: 0, signal: null});
  for (const child of runtimes) assert.equal(alive(child), false, 'the runtime is gone');
  assert.equal(await listening(portOf(run.url)), false, 'the runtime\'s port is closed');
  assert.equal(await listening(portOf(run.harness)), false, 'the harness port is closed');
});

void test('a runtime whose supervisor dies stops itself', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'fixtures');
  const runtimes = children(run.supervisor.pid ?? 0);
  run.supervisor.kill('SIGKILL');
  await until(() => runtimes.every(child => !alive(child)), 'the orphaned runtime to stop');
  await until(async () => !await listening(portOf(run.url)), 'the runtime\'s port to close');
});

void test('a crash between the lamp\'s commit and its publish restarts the runtime on the same port, and its outbox republishes', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'command-tracked-outcome');
  const before = children(run.supervisor.pid ?? 0);
  const armed = await fetch(new URL(`${HARNESS_PATH}/arm-crash`, run.harness), {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
  assert.equal(armed.status, 200);
  const grants = await readGrants(run.dataDir);
  const operator = await connectRemote({url: run.url, source: 'bunny/parts/operator', token: grants.get('bunny/parts/operator') ?? '', reconnectDelayMs: 50});
  context.after(() => operator.close());
  const {key, draft} = switchLamp('lamp-1', 'on');
  const result = await operator.request(key, draft, {timeoutMs: 5000, requestId: 'req-crash'});
  assert.equal(result.status === 'uncertain' && result.error.error.code, 'uncertain-result', 'the remote requester cannot know the fate');
  await until(async () => (await state(run)).generation === 2, 'the second runtime');
  await until(async () => (await fetch(new URL('/api/runtime/v1/health', run.url)).catch(() => undefined))?.ok === true, 'health on the same port');
  const now = await state(run);
  assert.deepEqual(now.logs.filter(entry => entry.generation === 2 && entry.record.event_name === 'lamp.outbox.republished').map(entry => entry.record.attributes.count), [3]);
  assert.deepEqual(now.devices.lamp.power, {'lamp-1': 'on'}, 'the simulated lamp kept its state across the crash');
  assert.equal(before.some(child => alive(child)), false, 'the crashed runtime is gone');
  assert.equal(children(run.supervisor.pid ?? 0).length, 1, 'one runtime again');
});

/** A raw request to the harness with headers that fetch would not let a caller set. */
function raw(url: string, method: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const sent = request(url, {method, headers}, response => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    sent.on('error', reject);
    sent.end(method === 'POST' ? '{}' : undefined);
  });
}

void test('the harness answers only local JSON requests that name its listener', {timeout: 60_000}, async context => {
  const run = await startRun(context, await base(context), 'fixtures');
  const stateUrl = new URL(`${HARNESS_PATH}/state`, run.harness).href;
  assert.equal(await raw(stateUrl, 'GET', {}), 200);
  assert.equal(await raw(stateUrl, 'GET', {host: 'evil.invalid'}), 403);
  assert.equal(await raw(stateUrl, 'GET', {origin: 'http://evil.invalid'}), 403);
  assert.equal(await raw(stateUrl, 'GET', {'sec-fetch-site': 'cross-site'}), 403);
  assert.equal(await raw(new URL(`${HARNESS_PATH}/arm-crash`, run.harness).href, 'POST', {'content-type': 'text/plain'}), 415);
  assert.equal(await raw(new URL(`${HARNESS_PATH}/nothing`, run.harness).href, 'GET', {}), 404);
});
