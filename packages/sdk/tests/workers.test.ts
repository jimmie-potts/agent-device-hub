// A module's bounded worker calls (Hub #919): one request and one reply in a new worker thread, with a deadline on the
// runtime's scheduler, ended when the module stops. A call refused before its worker starts had no effect; once the
// worker has the request, every ending but its reply is `uncertain-result` (ADR 0012). A failed call never carries what
// the worker threw.
import assert from 'node:assert/strict';
import type {Worker} from 'node:worker_threads';
import {MAX_TIMEOUT_MS, MAX_WORKER_CALLS, SdkError, WorkerCalls} from '../src/index.js';
import {it, manualClock, until} from './support.js';

const WORKER = new URL('./fixtures/call-worker.js', import.meta.url);
type Answer = {text: string; env: string | null};

/** Worker calls on a manual scheduler, with the workers they started and whether each has exited. */
function calls(): {calls: WorkerCalls; module: AbortController; clock: ReturnType<typeof manualClock>; workers: Worker[]; running: () => number} {
  const clock = manualClock();
  const module = new AbortController();
  const workers: Worker[] = [];
  const exited = new Set<Worker>();
  const track = (worker: Worker): void => {
    workers.push(worker);
    worker.once('exit', () => { exited.add(worker); });
  };
  return {calls: new WorkerCalls({scheduler: clock.scheduler, signal: module.signal, track}), module, clock, workers, running: () => workers.length - exited.size};
}

const code = (expected: string) => (error: unknown): boolean => {
  assert.ok(error instanceof SdkError, String(error));
  assert.equal(error.body.error.code, expected);
  assert.equal(error.message.includes('tok_SYNTHETIC919'), false, 'the error never quotes what the worker threw');
  return true;
};

it('a worker call resolves with the worker\'s one reply, and the worker ends', async () => {
  const {calls: workers, clock, running} = calls();
  const answer = await workers.call<Answer>(WORKER, {act: 'answer', text: 'hello'}, {timeoutMs: 5000});
  assert.equal(answer.text, 'HELLO');
  await until(() => running() === 0, 'the worker to end');
  assert.equal(clock.pending(), 0, 'its deadline is cancelled');
});

it('a worker call that outlasts its deadline rejects as uncertain at the deadline, and its worker is terminated', async () => {
  const {calls: workers, clock, running} = calls();
  const call = workers.call(WORKER, {act: 'silent'}, {timeoutMs: 2000});
  let settled = false;
  void call.catch(() => {}).finally(() => { settled = true; });
  await until(() => running() === 1, 'the worker to start');
  clock.advance(1999);
  await new Promise(resolve => { setTimeout(resolve, 50); });
  assert.equal(settled, false, 'the call waits until its deadline on the runtime\'s scheduler');
  clock.advance(1);
  await assert.rejects(call, code('uncertain-result'));
  await until(() => running() === 0, 'the worker to be terminated');
});

it('stopping the module ends its worker calls as uncertain, since each worker had its request, and terminates their workers', async () => {
  const {calls: workers, module, clock, running} = calls();
  const call = workers.call(WORKER, {act: 'silent'}, {timeoutMs: 60_000});
  await until(() => running() === 1, 'the worker to start');
  module.abort();
  await assert.rejects(call, code('uncertain-result'));
  await until(() => running() === 0, 'the worker to be terminated');
  assert.equal(clock.pending(), 0, 'its deadline is cancelled');
  await assert.rejects(workers.call(WORKER, {act: 'answer'}, {timeoutMs: 1000}), code('invalid-state'), 'a stopped module starts no call');
  assert.equal(running(), 0);
});

it('a call whose own signal aborts after its worker started is uncertain, and one aborted before is cancelled with no worker', async () => {
  const {calls: workers, workers: started, running} = calls();
  const controller = new AbortController();
  const call = workers.call(WORKER, {act: 'silent'}, {timeoutMs: 60_000, signal: controller.signal});
  await until(() => running() === 1, 'the worker to start');
  controller.abort();
  await assert.rejects(call, code('uncertain-result'), 'cancellation is not undo: the worker had the request');
  await until(() => running() === 0, 'the worker to be terminated');
  const aborted = AbortSignal.abort();
  await assert.rejects(workers.call(WORKER, {act: 'answer'}, {timeoutMs: 1000, signal: aborted}), code('cancelled'), 'an aborted signal starts no worker');
  assert.equal(started.length, 1, 'no second worker started');
});

it('a worker that throws, whose reply cannot be read, or that ends without a reply leaves only its call uncertain', async () => {
  const {calls: workers, workers: started, running} = calls();
  const thrown = await workers.call(WORKER, {act: 'throw'}, {timeoutMs: 5000}).catch((error: unknown) => error);
  assert.ok(code('uncertain-result')(thrown));
  assert.ok(thrown instanceof SdkError && thrown.cause instanceof Error, 'what the worker threw stays in memory as the cause');
  await assert.rejects(workers.call(WORKER, {act: 'end'}, {timeoutMs: 5000}), code('uncertain-result'));
  // Node reports a reply it cannot deserialize as `messageerror` on the worker; the call hears it as the worker would send it.
  const unreadable = workers.call(WORKER, {act: 'silent'}, {timeoutMs: 60_000});
  await until(() => running() === 1, 'the worker to start');
  started.at(-1)?.emit('messageerror', new Error('the reply could not be deserialized'));
  await assert.rejects(unreadable, code('uncertain-result'));
  await until(() => running() === 0, 'every worker to end');
});

it('a module has at most MAX_WORKER_CALLS calls running, and a malformed deadline is refused', async () => {
  const {calls: workers, module, running} = calls();
  const held = Array.from({length: MAX_WORKER_CALLS}, () => workers.call(WORKER, {act: 'silent'}, {timeoutMs: 60_000}));
  await assert.rejects(workers.call(WORKER, {act: 'answer'}, {timeoutMs: 1000}), code('capacity'));
  for (const timeoutMs of [0, -1, 1.5, MAX_TIMEOUT_MS + 1, Number.NaN]) {
    await assert.rejects(workers.call(WORKER, {act: 'answer'}, {timeoutMs}), code('invalid-request'), String(timeoutMs));
  }
  module.abort();
  for (const call of held) await assert.rejects(call, code('uncertain-result'));
  await until(() => running() === 0, 'every worker to be terminated');
});

it('a worker that cannot start is refused as internal, with no worker and no effect', async () => {
  const {calls: workers, workers: started} = calls();
  // A worker's file must be a file: URL; any other is refused before a thread exists.
  await assert.rejects(workers.call(new URL('https://bunny.invalid/worker.js'), {act: 'answer'}, {timeoutMs: 1000}), code('internal'));
  assert.equal(started.length, 0);
});
