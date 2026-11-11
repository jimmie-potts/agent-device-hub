// Hub #920: the run adapter's disconnect keeps the catalog's Harness contract. The runtime's edge ends the part's stream,
// and the same remote part reconnects; its timers wait for the next wait, as the in-memory harness's wait for virtual
// time to move, so the part stays away however long the steps in between take.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {test} from 'node:test';
import {act, runScenario, scenario, type Harness} from '../../tests/scenarios/catalog.js';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {RunFailure, connectRun, failureOf} from '../adapter.js';
import {scenarioProof} from '../plugin.js';
import {sourceOf} from '../../tests/scenarios/parts.js';
import {base, startRun} from './support.js';

void test('a dropped part stays away until the next wait, then the same part reconnects and resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const reader = h.sdk('reader');
  assert.equal(h.reader.syncs('session'), 1);

  await h.disconnect('reader');
  await sleep(500);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session')], [0, 1], 'it is still away after real time passed');
  for (let waited = 0; h.reader.syncs('session') < 2 && waited < 50; waited += 1) await h.wait(100);
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], [1, 2, 2], 'it reconnected and synced each copy again');
  assert.equal(h.sdk('reader'), reader, 'the same remote part');
  assert.deepEqual(h.problems(), []);
});

/**
 * Makes the reader's calls to the edge (`subscribe` or `sync`) take `slow` first, while the returned `armed` flag is set,
 * and puts back the real `fetch` when the test ends. The remote client calls the global `fetch`, so this holds back
 * exactly the reader's re-registration and resync after a restart, and nothing of the adapter's own.
 */
function readerCalls(context: {after: (fn: () => void) => void}, call: 'subscribe' | 'sync', slow: () => Promise<void>): {armed: boolean} {
  const real = globalThis.fetch, state = {armed: false};
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const source = (init?.headers as Record<string, string> | undefined)?.['bunny-source'];
    if (state.armed && init?.method === 'POST' && source === sourceOf('reader') && url.endsWith(`/${call}`)) await slow();
    return real(input, init);
  };
  context.after(() => { globalThis.fetch = real; });
  return state;
}

// Hub #1697: a restart resolves only once the reader is back in sync with the new runtime, so the next step, such as a
// second restart, never stops the runtime while the reader is still coming back.
void test('a restart resolves only once the reader has resynced with the new runtime', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed});
  context.after(() => h.close());
  const before = [h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')];
  const slowed = readerCalls(context, 'subscribe', () => sleep(500));
  slowed.armed = true;
  const started = Date.now();
  await h.restart();
  slowed.armed = false;
  assert.deepEqual([h.reader.gaps(), h.reader.syncs('session'), h.reader.syncs('lamp')], before.map(count => count + 1),
    'the reader heard of the gap and synced each copy again before the restart resolved');
  assert.ok(Date.now() - started >= 500, 'the restart waited for the reader\'s slowed re-registration');
  assert.equal(h.generation(), 2);
  assert.deepEqual(h.problems(), []);
});

void test('a restart fails within its bound, naming what did not come back, when the reader never resyncs', {timeout: 60_000}, async context => {
  const seed = scenario('reconnect-and-sync')?.seed;
  assert.ok(seed);
  const run = await startRun(context, await base(context), 'reconnect-and-sync');
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed, resyncWithinMs: 1000});
  context.after(() => h.close());
  // Each resync is refused at the connection, as when the runtime is gone, so each copy stops for good.
  const refused = readerCalls(context, 'sync', () => Promise.reject(new TypeError('fetch failed')));
  refused.armed = true;
  const started = Date.now();
  await assert.rejects(h.restart(), (error: unknown) => {
    assert.ok(error instanceof RunFailure);
    assert.equal(error.message, 'the reader did not resync within 1000 ms of the restart: its copy of session,inbox-item did not sync again; its copy of lamp did not sync again');
    return true;
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1000 && elapsed < 10_000, `the restart gave up at its bound, after ${elapsed} ms`);
  assert.deepEqual(h.problems().filter(problem => problem.includes('stopped')), [
    'the reader\'s copy of session,inbox-item stopped: unavailable', 'the reader\'s copy of lamp stopped: unavailable',
  ], 'the stopped copies are still reported as problems');
});

// What the adapter reports goes into a capture's proof, so it names a failure by its own fixed text, a refusal's registry
// code or the exception's type, never by an exception's message (ADR 0012, "Safe errors"; Hub #954).
void test('the adapter names a failure by its own text, a refusal\'s registry code or the exception\'s type, never an exception\'s message', () => {
  const secret = 'tok_SYNTHETIC954';
  assert.equal(failureOf(new RunFailure('state answered 503')), 'state answered 503');
  assert.equal(failureOf(new SdkError(errorBody('unavailable', {detail: `no owner for ${secret}`}))), 'SdkError unavailable');
  assert.equal(failureOf(new TypeError(`fetch failed for ${secret}`)), 'TypeError');
  assert.equal(failureOf(secret), 'string');
});

// What a scenario's capture step keeps: the result it attaches and the reason its expectation gives (Hub #954).
void test('a scenario\'s proof and its failed expectation never quote an exception a step or a part threw', async () => {
  const secret = 'tok_SYNTHETIC954';
  const h = {tier: 'run', transport: 'remote', wait: () => Promise.resolve()} as unknown as Harness;
  const result = await runScenario({id: 'control-proof', title: 'negative control', seed: {modules: [], follows: []}, steps: [
    act('read a body that is not JSON', () => { JSON.parse(secret); }),
  ]}, h);
  const proof = scenarioProof(result, [`bunny/parts/reader on stream: ${failureOf(new TypeError(`fetch failed for ${secret}`))}`]);
  assert.equal(proof.failure, 'read a body that is not JSON: threw SyntaxError');
  assert.match(proof.attachment, /"detail": "threw SyntaxError"/);
  assert.match(proof.attachment, /bunny\/parts\/reader on stream: TypeError/);
  assert.equal(`${proof.attachment}${proof.failure ?? ''}`.includes(secret), false, 'neither the attachment nor the expectation quotes the exception');
});
