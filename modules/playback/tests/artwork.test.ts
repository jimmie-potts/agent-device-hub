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

void test('a Sony clock query on an unchanged jacket path keeps the ready image without refetching (#1570)', async () => {
  // The HT-A9 reports one fixed jacket path and appends a millisecond clock as the whole query, so it differs on every read.
  const jacket = (clock: string): ArtworkPresentation => ({index: 0, kind: 'sony', endpoint: ENDPOINT, availability: 'available',
    observation: {status: 'playing', title: 'A', thumbnailUrl: `http://127.0.0.1:58080/jacket.jpg?${clock}`}});
  const run = setup(); run.controller.update(jacket('10000000000000000')); await flush();
  const ready = run.controller.snapshot(); assert.equal(ready?.status, 'ready');
  for (const clock of ['10000000000002031', '10000000000004062', '10000000000006093']) {
    run.controller.update(jacket(clock));
    assert.deepEqual(run.controller.snapshot(), ready);
    await flush();
  }
  assert.equal(run.fetches(), 1); assert.equal(run.changes(), 1);
  // A different jacket path is a new candidate in the same generation and is acquired; the same image publishes nothing.
  run.controller.update(run.view());
  assert.deepEqual(run.controller.snapshot(), ready);
  await flush(); assert.deepEqual(run.controller.snapshot(), ready); assert.equal(run.fetches(), 2); assert.equal(run.changes(), 1);
});

void test('a Sonos reference with a changed query remains a new candidate', async () => {
  const sonos = (query: string): ArtworkPresentation => ({index: 0, kind: 'sonos', endpoint: 'http://127.0.0.1:1400/MediaRenderer/AVTransport/Control',
    availability: 'available', observation: {status: 'playing', title: 'A', thumbnailUrl: `/getaa?${query}`}});
  const run = setup(); run.controller.update(sonos('1')); await flush(); assert.equal(run.controller.snapshot()?.status, 'ready');
  run.controller.update(sonos('2')); assert.equal(run.controller.snapshot()?.status, 'ready');
  await flush(); assert.equal(run.fetches(), 2);
});

/** Decodes the first fetched byte to one of two synthetic images, so a test controls what each candidate shows. */
const imageOf = (bytes: Uint8Array): Promise<ArtworkResult<ArtworkThumbnail>> =>
  Promise.resolve({ok: true, value: {...thumbnail, base64: bytes[0] === 2 ? 'c3ludGhldGljIGI=' : 'c3ludGhldGljIGE='}});

void test('two alternating forms of the same image publish it once, never missing between them (#1758)', async () => {
  const forms = [`${ENDPOINT}/image`, 'http://127.0.0.1:58080/image'] as const;
  const run = setup(imageOf);
  run.controller.update(run.view()); await flush();
  const ready = run.controller.snapshot(); assert.equal(ready?.status, 'ready');
  for (let flip = 1; flip <= 6; flip++) {
    run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: forms[flip % 2 === 0 ? 0 : 1]}}));
    assert.deepEqual(run.controller.snapshot(), ready, `flip ${flip} keeps the ready image while the form is acquired`);
    await flush();
    assert.deepEqual(run.controller.snapshot(), ready);
  }
  assert.equal(run.changes(), 1, 'the image was published once');
  assert.equal(run.fetches(), 7, 'each changed form is still acquired');
});

void test('an absent or refused reference still reports missing for the same track (#1758 keeps the existing rule)', async () => {
  const run = setup(imageOf);
  run.controller.update(run.view()); await flush();
  const ready = run.controller.snapshot(); assert.equal(ready?.status, 'ready');
  run.controller.update(run.view({observation: {status: 'playing', title: 'A'}}));
  assert.deepEqual(run.controller.snapshot(), {status: 'missing', generation: ready?.generation});
  run.controller.update(run.view()); await flush();
  assert.deepEqual(run.controller.snapshot(), ready);
  run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: 'http://192.0.2.1/elsewhere'}}));
  assert.deepEqual(run.controller.snapshot(), {status: 'missing', generation: ready?.generation});
  assert.equal(run.fetches(), 2);
});

void test('a replacement that fails withdraws the held image after its attempts; a different image replaces it once acquired (#1758)', async () => {
  let failure: ArtworkResult<Uint8Array> | undefined;
  const run = setup(imageOf, (candidate) => Promise.resolve(failure ?? {ok: true, value: new Uint8Array([candidate.endsWith('/other') ? 2 : 1])}));
  run.controller.update(run.view()); await flush();
  const ready = run.controller.snapshot(); assert.equal(ready?.status, 'ready');
  // Transient failures keep the held image through the 2 s and 4 s retries, and the last one withdraws it.
  failure = artworkFailure('unavailable', true);
  run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: `${ENDPOINT}/second`}})); await flush();
  assert.deepEqual(run.controller.snapshot(), ready);
  await run.advance(2000); assert.deepEqual(run.controller.snapshot(), ready);
  await run.advance(4000);
  assert.deepEqual(run.controller.snapshot(), {status: 'missing', generation: ready?.generation}); assert.equal(run.changes(), 2);
  failure = undefined;
  run.controller.update(run.view()); await flush();
  assert.deepEqual(run.controller.snapshot(), ready); assert.equal(run.changes(), 3);
  // A refusal withdraws it at once.
  failure = artworkFailure('capacity');
  run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: `${ENDPOINT}/third`}})); await flush();
  assert.deepEqual(run.controller.snapshot(), {status: 'missing', generation: ready?.generation}); assert.equal(run.changes(), 4);
  failure = undefined;
  run.controller.update(run.view()); await flush();
  assert.deepEqual(run.controller.snapshot(), ready); assert.equal(run.changes(), 5);
  run.controller.update(run.view({observation: {status: 'playing', title: 'A', thumbnailUrl: `${ENDPOINT}/other`}}));
  assert.deepEqual(run.controller.snapshot(), ready, 'nothing is shown for a form before it is acquired');
  await flush();
  const replaced = run.controller.snapshot();
  assert.equal(replaced?.status, 'ready'); assert.equal(replaced?.generation, ready?.generation);
  assert.notEqual(replaced?.status === 'ready' ? replaced.base64 : undefined, ready?.status === 'ready' ? ready.base64 : undefined);
  assert.equal(run.changes(), 6);
});

void test('a change of track publishes missing then ready with the new image, and never the earlier one (#1758)', async () => {
  const run = setup(imageOf, (candidate) => Promise.resolve({ok: true, value: new Uint8Array([candidate.endsWith('/b') ? 2 : 1])}));
  run.controller.update(run.view()); await flush();
  const first = run.controller.snapshot(); assert.equal(first?.status, 'ready');
  // The same reference for a new track is still acquired again under a new generation.
  run.controller.update(run.view({}, 'B'));
  const missing = run.controller.snapshot();
  assert.equal(missing?.status, 'missing'); assert.notEqual(missing?.generation, first?.generation);
  await flush();
  assert.equal(run.controller.snapshot()?.status, 'ready'); assert.equal(run.controller.snapshot()?.generation, missing?.generation);
  assert.equal(run.fetches(), 2);
  run.controller.update(run.view({observation: {status: 'playing', title: 'C', thumbnailUrl: `${ENDPOINT}/b`}}));
  assert.equal(run.controller.snapshot()?.status, 'missing');
  await flush();
  const third = run.controller.snapshot();
  assert.equal(third?.status === 'ready' ? third.base64 : undefined, 'c3ludGhldGljIGI=');
  assert.equal(run.changes(), 3);
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
  assert.equal(run.controller.snapshot()?.status, 'missing'); assert.notEqual(run.controller.snapshot()?.generation, generation);
  assert.ok(release); release({ok: true, value: thumbnail}); await flush();
  assert.equal(run.controller.snapshot()?.status, 'missing'); assert.equal(run.changes(), 0);
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
    assert.deepEqual(run.diagnostics, [{kind: 'failure', code, attempts: 1, source: 'sony'}, {kind: 'exhausted', code, attempts: 1, source: 'sony'}]);
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
    assert.deepEqual(run.diagnostics, [{kind: 'failure', code: 'unavailable', attempts: 1, source: 'sony'}, {kind: 'retry', code: 'unavailable', attempts: 1, source: 'sony'}]);
    run.signal.abort(); await flush(); await run.advance(30_000);
    assert.equal(run.fetches(), 1);
  });
}

void test('Sonos uses its own same-origin artwork through the existing bounded chain', async () => {
  const run = setup();
  run.controller.update(run.view({kind: 'sonos', endpoint: 'http://127.0.0.1:1400/MediaRenderer/AVTransport/Control',
    observation: {status: 'playing', title: 'Move', thumbnailUrl: 'http://127.0.0.1:1400/getaa?s=1&u=x'}}));
  await flush();
  assert.equal(run.controller.snapshot()?.status, 'ready');
  assert.equal(run.fetches(), 1);
  assert.equal(run.changes(), 1);
});

void test('Sonos duplicate, pause and freshness changes reuse its image and source handoff rejects late work', async () => {
  const run = setup();
  const sonos = {kind: 'sonos' as const, endpoint: 'http://127.0.0.1:1400/MediaRenderer/AVTransport/Control',
    observation: {status: 'playing', title: 'Same', thumbnailUrl: '/getaa'}};
  run.controller.update(run.view(sonos)); await flush();
  const ready = run.controller.snapshot();
  assert.equal(ready?.status, 'ready');
  run.controller.update(run.view({...sonos, availability: 'stale', observation: {...sonos.observation, status: 'paused'}}));
  await flush(); assert.deepEqual(run.controller.snapshot(), ready); assert.equal(run.fetches(), 1);
  const held: ((value: ArtworkResult<ArtworkThumbnail>) => void)[] = [];
  const delayed = setup(async () => new Promise(resolve => { held.push(resolve); }));
  delayed.controller.update(delayed.view(sonos)); await flush();
  const generation = delayed.controller.snapshot()?.generation;
  delayed.controller.update(delayed.view({index: 1, observation: {status: 'playing', title: 'Same'}}));
  assert.notEqual(delayed.controller.snapshot()?.generation, generation);
  assert.equal(delayed.controller.snapshot()?.status, 'missing');
  held[0]?.({ok: true, value: thumbnail}); await flush();
  assert.equal(delayed.controller.snapshot()?.status, 'missing'); assert.equal(delayed.changes(), 0);
});
