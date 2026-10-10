import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SdkError} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {ArtworkController, type ArtworkPresentation, type ArtworkDiagnostic} from '../src/artwork.js';
import {artworkFailure, createArtworkFetch, type ArtworkFetch, type ArtworkResult} from '../src/artwork-fetch.js';
import type {ArtworkThumbnail} from '../src/artwork-decode.js';

const ENDPOINT = 'http://127.0.0.1:10000/sony';
const thumbnail: ArtworkThumbnail = {mediaType: 'image/png', width: 1, height: 1, base64: 'c3ludGhldGlj'};
const flush = async (): Promise<void> => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
function setup(decode?: (bytes: Uint8Array, signal: AbortSignal) => Promise<ArtworkResult<ArtworkThumbnail>>, fetch?: ArtworkFetch) {
  let now = 0, generations = 0, fetches = 0, changes = 0;
  const tasks: {at: number; callback: () => void; cancelled: boolean}[] = [];
  const scheduler = {after(ms: number, callback: () => void) {
    const task = {at: now + ms, callback, cancelled: false}; tasks.push(task);
    return () => { task.cancelled = true; };
  }};
  const signal = new AbortController();
  let fetchResult: ArtworkResult<Uint8Array> = {ok: true, value: new Uint8Array([1])};
  const diagnostics: ArtworkDiagnostic[] = [];
  const controller = new ArtworkController({scheduler, signal: signal.signal, generation: () => `00000000-0000-4000-8000-${String(++generations).padStart(12, '0')}`,
    fetch: (candidate, endpoint, abort) => { fetches++; return fetch?.(candidate, endpoint, abort) ?? Promise.resolve(fetchResult); },
    decode: decode ?? (() => Promise.resolve({ok: true, value: thumbnail})), onChange: () => { changes++; },
    onDiagnostic: record => { diagnostics.push(record); }});
  const view = (extra: Partial<ArtworkPresentation> = {}, title = 'A'): ArtworkPresentation => ({index: 0, kind: 'sony', endpoint: ENDPOINT,
    availability: 'available', observation: {status: 'playing', title, thumbnailUrl: `${ENDPOINT}/image`}, ...extra});
  return {controller, signal, view, diagnostics, fetches: () => fetches, changes: () => changes,
    failFetch: () => { fetchResult = artworkFailure('unavailable', true); },
    hardFetch: () => { fetchResult = artworkFailure('capacity'); },
    advance: async (ms: number) => {
      const target = now + ms;
      for (;;) {
        const next = tasks.filter(task => !task.cancelled && task.at <= target).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        now = next.at; next.cancelled = true; next.callback(); await flush();
      }
      now = target; await flush();
    }};
}

void test('duplicate polls and pause/freshness retain acquired artwork and generation', async () => {
  const run = setup(); run.controller.update(run.view()); await flush();
  const ready = run.controller.snapshot(); assert.equal(ready?.status, 'ready');
  run.controller.update(run.view({availability: 'stale', observation: {status: 'paused', title: 'A', thumbnailUrl: `${ENDPOINT}/image`}}));
  await flush(); assert.deepEqual(run.controller.snapshot(), ready); assert.equal(run.fetches(), 1); assert.equal(run.changes(), 1);
});

void test('absent candidate then later candidate retains generation', async () => {
  const run = setup(); run.controller.update(run.view({observation: {status: 'playing', title: 'A'}}));
  const generation = run.controller.snapshot()?.generation;
  run.controller.update(run.view()); await flush();
  assert.equal(run.controller.snapshot()?.generation, generation); assert.equal(run.controller.snapshot()?.status, 'ready');
});

void test('late Sony completion cannot cross identical-metadata Sonos handoff', async () => {
  let release: ((value: ArtworkResult<ArtworkThumbnail>) => void) | undefined;
  const run = setup(async () => new Promise(resolve => { release = resolve; }));
  run.controller.update(run.view()); await flush(); const generation = run.controller.snapshot()?.generation;
  run.controller.update(run.view({index: 1, kind: 'sonos'}));
  assert.equal(run.controller.snapshot()?.status, 'unsupported'); assert.notEqual(run.controller.snapshot()?.generation, generation);
  assert.ok(release); release({ok: true, value: thumbnail}); await flush();
  assert.equal(run.controller.snapshot()?.status, 'unsupported'); assert.equal(run.changes(), 0);
});

void test('candidate replacement rejects old result within same generation and admits only newest work', async () => {
  const held: ((value: ArtworkResult<ArtworkThumbnail>) => void)[] = [];
  const run = setup(async () => new Promise(resolve => { held.push(resolve); }));
  run.controller.update(run.view()); await flush(); const generation = run.controller.snapshot()?.generation;
  for (const suffix of ['B', 'C', 'D']) run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: `${ENDPOINT}/${suffix}`}}));
  assert.equal(run.fetches(), 1); assert.equal(held.length, 1);
  held[0]?.({ok: true, value: thumbnail}); await flush();
  assert.equal(run.controller.snapshot()?.status, 'missing'); assert.equal(run.controller.snapshot()?.generation, generation);
  assert.equal(run.fetches(), 2); assert.equal(held.length, 2);
  held[1]?.({ok: true, value: thumbnail}); await flush(); assert.equal(run.controller.snapshot()?.status, 'ready');
});

void test('transient retry is spaced 2s/4s and capped at three; hard failure is not retried', async () => {
  const run = setup(); run.failFetch(); run.controller.update(run.view()); await flush();
  assert.equal(run.fetches(), 1); await run.advance(1999); assert.equal(run.fetches(), 1);
  await run.advance(1); assert.equal(run.fetches(), 2); await run.advance(3999); assert.equal(run.fetches(), 2);
  await run.advance(1); assert.equal(run.fetches(), 3); await run.advance(30_000); run.controller.update(run.view()); await flush(); assert.equal(run.fetches(), 3);
  const hard = setup(); hard.hardFetch(); hard.controller.update(hard.view()); await flush(); await hard.advance(30_000); assert.equal(hard.fetches(), 1);
});

void test('stop, unavailable and restart cannot restore pending image', async () => {
  let release: ((value: ArtworkResult<ArtworkThumbnail>) => void) | undefined;
  const run = setup(async () => new Promise(resolve => { release = resolve; }));
  run.controller.update(run.view()); await flush();
  run.controller.update(run.view({availability: 'unavailable'})); assert.equal(run.controller.snapshot(), undefined);
  run.signal.abort(); assert.ok(release); release({ok: true, value: thumbnail}); await flush(); assert.equal(run.changes(), 0);
  const restarted = setup(); restarted.controller.update(restarted.view()); await flush(); assert.equal(restarted.controller.snapshot()?.status, 'ready');
});

void test('decoder deadline aborts its signal while metadata-driven state can still change', async () => {
  let decoderSignal: AbortSignal | undefined;
  const run = setup(async (_bytes, signal) => { decoderSignal = signal; return new Promise(() => {}); });
  run.controller.update(run.view()); await flush(); assert.ok(decoderSignal);
  await run.advance(2000); assert.equal(decoderSignal.aborted, true);
  run.controller.update(run.view({observation: {status: 'stopped'}})); assert.equal(run.controller.snapshot(), undefined);
});

for (const code of ['capacity', 'internal', 'uncertain-result'] as const) {
  void test(`typed worker ${code} refuses without another receiver acquisition`, async () => {
    const run = setup(() => Promise.reject(new SdkError(errorBody(code, {detail: 'synthetic private worker detail'}))));
    run.controller.update(run.view()); await flush(); await run.advance(30_000);
    assert.equal(run.fetches(), 1);
    assert.equal(run.controller.snapshot()?.status, 'missing');
    assert.deepEqual(run.diagnostics, [{kind: 'failure', code, attempts: 1}, {kind: 'exhausted', code, attempts: 1}]);
  });
}

for (const operation of ['fetch', 'stream'] as const) {
  void test(`${operation} deadline aborts at 2000ms and cancels a stalled response body`, async () => {
    let fetchSignal: AbortSignal | undefined;
    let cancelled = false;
    const streamed = createArtworkFetch(() => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { cancelled = true; },
    }))));
    const run = setup(undefined, (candidate, endpoint, signal) => {
      fetchSignal = signal;
      return operation === 'fetch' ? new Promise(() => {}) : streamed(candidate, endpoint, signal);
    });
    run.controller.update(run.view()); await flush(); assert.ok(fetchSignal);
    await run.advance(1999); assert.equal(fetchSignal.aborted, false);
    await run.advance(1); assert.equal(fetchSignal.aborted, true);
    if (operation === 'stream') assert.equal(cancelled, true);
    assert.equal(run.controller.snapshot()?.status, 'missing');
    assert.equal(run.fetches(), 1, 'retry waits another 2 seconds');
    assert.deepEqual(run.diagnostics, [{kind: 'failure', code: 'unavailable', attempts: 1}, {kind: 'retry', code: 'unavailable', attempts: 1}]);
    run.signal.abort(); await flush(); await run.advance(30_000);
    assert.equal(run.fetches(), 1);
  });
}
