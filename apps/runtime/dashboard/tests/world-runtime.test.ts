import assert from 'node:assert/strict';
import test from 'node:test';
import {INSTALLED_PORTS, WORLD_LIMIT_MS, startWorldRuntime, worldDeadline} from './world-runtime.ts';

void test('an allowed runtime is returned without stopping or retrying it', async () => {
  let starts = 0;
  let stops = 0;
  const runtime = {url: 'http://127.0.0.1:42000', stop: () => {stops++; return Promise.resolve();}};
  const actual = await startWorldRuntime(() => {starts++; return Promise.resolve(runtime);});
  assert.equal(actual, runtime);
  assert.equal(starts, 1);
  assert.equal(stops, 0);
});

for (const port of INSTALLED_PORTS) {
  void test(`a disallowed candidate on ${port} is stopped before selecting an allowed runtime`, async () => {
    let starts = 0;
    let stopped = false;
    const allowed = {url: 'http://127.0.0.1:42000', stop: () => Promise.resolve()};
    const actual = await startWorldRuntime(() => {
      starts++;
      if (starts === 1) return Promise.resolve({url: `http://127.0.0.1:${port}`, stop: async () => {
        await Promise.resolve();
        stopped = true;
      }});
      assert.equal(stopped, true, 'cleanup finishes before the next candidate starts');
      return Promise.resolve(allowed);
    });
    assert.equal(actual, allowed);
    assert.equal(starts, 2);
    assert.equal(stopped, true);
  });
}

void test('allocation exhaustion stops every rejected runtime and fails within ten attempts', async () => {
  let starts = 0;
  let stops = 0;
  await assert.rejects(startWorldRuntime(() => {
    starts++;
    assert.ok(starts <= 10, 'allocation must be bounded');
    assert.equal(stops, starts - 1, 'each previous candidate was released');
    return Promise.resolve({url: 'http://127.0.0.1:41231', stop: () => {stops++; return Promise.resolve();}});
  }), /could not allocate a dashboard runtime outside installed-service ports after 10 attempts/);
  assert.equal(starts, 10);
  assert.equal(stops, 10);
});

void test('a startup failure propagates without retrying', async () => {
  let starts = 0;
  const failure = new Error('synthetic startup failed');
  await assert.rejects(startWorldRuntime(() => {starts++; return Promise.reject(failure);}), error => error === failure);
  assert.equal(starts, 1);
});

void test('a rejected candidate cleanup failure propagates without starting another runtime', async () => {
  let starts = 0;
  const failure = new Error('synthetic cleanup failed');
  await assert.rejects(startWorldRuntime(() => {
    starts++;
    return Promise.resolve({url: 'http://127.0.0.1:41231', stop: () => Promise.reject(failure)});
  }), error => error === failure);
  assert.equal(starts, 1);
});

void test('a world not closed within its limit ends the run, naming the journey and its phase (#1919)', () => {
  const timers: {run: () => void; ms: number; cancelled: boolean}[] = [];
  const timer = {after: (run: () => void, ms: number) => {const entry = {run, ms, cancelled: false}; timers.push(entry); return entry;},
    cancel: (entry: unknown) => {(entry as {cancelled: boolean}).cancelled = true;}};
  const failures: string[] = [];
  const stuck = worldDeadline('devices-menu.browser.ts:9', {timer, fail: message => {failures.push(message);}});
  assert.equal(timers[0]?.ms, WORLD_LIMIT_MS);
  stuck.phase('running'); stuck.phase('closing');
  timers[0]?.run();
  assert.deepEqual(failures, ['The world for devices-menu.browser.ts:9 was not closed within 25 minutes; it was closing.']);
  let step = 'prepare';
  const running = worldDeadline(() => `Home shapes / ${step}`, {timer, fail: message => {failures.push(message);}});
  running.phase('running'); step = 'tiles'; timers[1]?.run();
  assert.equal(failures.at(-1), 'The world for Home shapes / tiles was not closed within 25 minutes; it was running.');
  const closed = worldDeadline('shell.browser.ts:11', {timer, limitMs: 60_000, fail: message => {failures.push(message);}});
  closed.clear();
  assert.deepEqual([timers[2]?.ms, timers[2]?.cancelled], [60_000, true], 'a closed world cancels its deadline');
});
