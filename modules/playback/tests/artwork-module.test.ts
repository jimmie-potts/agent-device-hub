import assert from 'node:assert/strict';
import {SimulatedSpeakers} from '../src/simulated.js';
import {decodeArtwork} from '../src/artwork-decode.js';
import type {ArtworkResult} from '../src/artwork-fetch.js';
import type {ArtworkThumbnail} from '../src/artwork-decode.js';
import type {SonyReply} from '../src/transport.js';
import sharp from 'sharp';
import {SECTION, flush, host, test} from './support.js';
import {artworkFailure, createArtworkFetch, type ArtworkFetch} from '../src/artwork-fetch.js';
import {SdkError} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {checkModuleRecord} from '@jimmie-potts/sdk/testing';

const sonyEndpoint = SECTION.sources.find(source => source.kind === 'sony')?.endpoint ?? '';
const receiverOrigin = new URL(sonyEndpoint).origin;
const playing = {input: 'airplay', status: 'playing', title: 'Synthetic song', artist: 'Synthetic artist'} as const;

class ArtworkSpeakers extends SimulatedSpeakers {
  candidate: string | undefined = `${receiverOrigin}/image-a`;
  override async sony(endpoint: string, method: string, version: string, signal: AbortSignal): Promise<SonyReply> {
    const reply = await super.sony(endpoint, method, version, signal);
    if (method === 'getPlayingContentInfo' && 'result' in reply) {
      for (const entry of reply.result.flat()) {
        if (typeof entry === 'object' && entry !== null) {
          Object.assign(entry, {content: this.candidate === undefined ? undefined : {thumbnailUrl: this.candidate}});
        }
      }
    }
    return reply;
  }
}

test('artwork publishes independently, reuses sync bytes, and does not refresh metadata freshness', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  const image = await sharp({create: {width: 32, height: 16, channels: 3, background: '#a04080'}}).jpeg().toBuffer();
  let release: ((value: ArtworkResult<ArtworkThumbnail>) => void) | undefined;
  let fetches = 0;
  const h = await host(context, speakers, {artwork: {
    fetch: () => { fetches++; return Promise.resolve({ok: true, value: image}); },
    decode: async () => new Promise(resolve => { release = resolve; }),
  }});
  assert.equal(h.record().artwork?.status, 'missing');
  const observedAtMs = h.record().observedAtMs;
  const generation = h.record().artwork?.generation;
  speakers.silent('sony'); speakers.silent('sonos');
  await h.advance(1000);
  assert.ok(release);
  release(await decodeArtwork(image)); await flush();
  assert.equal(h.record().artwork?.status, 'ready');
  assert.equal(h.record().observedAtMs, observedAtMs);
  assert.equal(h.record().artwork?.generation, generation);
  const copied = await h.requester.sync(['playback'], () => {}, {timeoutMs: 1000});
  assert.equal(copied.status, 'synced');
  if (copied.status === 'synced') {
    assert.deepEqual(copied.copy.states()[0]?.data, h.record());
    await copied.copy.close();
  }
  assert.equal(fetches, 1);
  await h.advance(4000);
  assert.equal(h.record().availability, 'stale', 'image completion did not reset the 5 s metadata deadline');
  assert.equal(h.record().artwork?.status, 'ready');
  await h.advance(25_000);
  assert.equal(h.record().availability, 'unavailable'); assert.equal(h.record().artwork, undefined);
  assert.deepEqual(h.problems(), []);
  assert.ok(!JSON.stringify(h.logs()).includes('image-a'));
});

test('a delayed image cannot publish after a reported track change and controls remain usable', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  const releases: ((value: ArtworkResult<ArtworkThumbnail>) => void)[] = [];
  const h = await host(context, speakers, {artwork: {
    fetch: () => Promise.resolve({ok: true, value: new Uint8Array([1])}),
    decode: async () => new Promise(resolve => { releases.push(resolve); }),
  }});
  const firstGeneration = h.record().artwork?.generation;
  const control = await h.send('pause', 'artwork-does-not-block-control');
  assert.equal(control.status, 'accepted');
  assert.deepEqual(speakers.state().sony.commands, ['pause']);
  speakers.candidate = `${receiverOrigin}/image-b`;
  speakers.play('sony', {title: 'Track B'});
  await h.advance(2000);
  assert.notEqual(h.record().artwork?.generation, firstGeneration);
  releases[0]?.({ok: true, value: {mediaType: 'image/png', width: 1, height: 1, base64: 'obsolete'}});
  await flush();
  assert.ok(!JSON.stringify(h.records()).includes('obsolete'));
  assert.deepEqual(h.problems(), []);
});

test('artwork generation survives duplicates, pause and freshness but changes across identical-text source handoffs', async context => {
  const speakers = new SimulatedSpeakers({sony: playing});
  const h = await host(context, speakers);
  const generation = h.record().artwork?.generation;
  assert.ok(generation !== undefined);
  assert.equal(h.record().artwork?.status, 'missing');
  await h.advance(2000);
  assert.equal(h.record().artwork?.generation, generation);
  speakers.pause('sony');
  await h.advance(2000);
  assert.equal(h.record().artwork?.generation, generation);
  speakers.play('sonos', {title: playing.title, artist: playing.artist});
  await h.advance(2000);
  assert.equal(h.record().artwork?.status, 'unsupported');
  assert.notEqual(h.record().artwork?.generation, generation);
  const sonosGeneration = h.record().artwork?.generation;
  speakers.silent('sonos');
  speakers.silent('sony');
  await h.advance(5000);
  assert.equal(h.record().availability, 'stale');
  assert.equal(h.record().artwork?.generation, sonosGeneration);
  await h.advance(25_000);
  assert.equal(h.record().availability, 'unavailable');
  assert.equal(h.record().artwork, undefined);
  assert.deepEqual(h.problems(), []);
});

test('stop, a new reported track and restart invalidate the current artwork association', async context => {
  const speakers = new SimulatedSpeakers({sony: playing});
  const h = await host(context, speakers);
  const original = h.record().artwork?.generation;
  assert.ok(original !== undefined);
  speakers.stop('sony');
  await h.advance(2000);
  assert.equal(h.record().artwork, undefined);
  speakers.play('sony', {title: playing.title, artist: playing.artist});
  await h.advance(2000);
  const resumed = h.record().artwork?.generation;
  assert.ok(resumed !== undefined); assert.notEqual(resumed, original);
  speakers.play('sony', {title: 'New synthetic song'});
  await h.advance(2000);
  assert.notEqual(h.record().artwork?.generation, resumed);
  const beforeRestart = h.record().artwork?.generation;
  await h.restart();
  assert.notEqual(h.record().artwork?.generation, beforeRestart);
  assert.deepEqual(h.problems(), []);
});

test('artwork failures log one transition, bounded retries and recovery without private content', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  const image = await sharp({create: {width: 1, height: 1, channels: 3, background: '#a04080'}}).png().toBuffer();
  const normalized = await decodeArtwork(image);
  let failing = true;
  const h = await host(context, speakers, {artwork: {
    fetch: () => Promise.resolve(failing ? artworkFailure('unavailable', true) : {ok: true, value: image}),
    decode: () => Promise.resolve(normalized),
  }});
  const diagnostics = () => h.logs().filter(record => record.fields['bunny.operation'] === 'media');
  assert.equal(diagnostics().filter(record => record.level === 'warn' && record.event === 'operation.failed').length, 1);
  await h.advance(6000);
  assert.equal(diagnostics().filter(record => record.level === 'warn').length, 1, 'repeated acquisition failure is summarized');
  assert.equal(diagnostics().filter(record => record.level === 'debug').length, 3, 'two scheduled retries and one exhausted summary');
  failing = false;
  speakers.candidate = `${receiverOrigin}/image-recovery`;
  await h.advance(2000);
  assert.equal(h.record().artwork?.status, 'ready');
  assert.equal(diagnostics().filter(record => record.level === 'info' && record.event === 'operation.completed').length, 1);
  assert.deepEqual(diagnostics().map(record => checkModuleRecord('playback', record)), diagnostics().map(() => undefined));
  const serialized = JSON.stringify(diagnostics());
  for (const privateText of [receiverOrigin, 'image-a', 'image-recovery', playing.title, playing.artist, image.toString('base64')]) assert.ok(!serialized.includes(privateText));
  assert.deepEqual(h.problems(), []);
});

for (const [code, level] of [['capacity', 'warn'], ['internal', 'error'], ['uncertain-result', 'warn']] as const) {
  test(`typed artwork ${code} is recorded at ${level} without retry or private error detail`, async context => {
    const speakers = new ArtworkSpeakers({sony: playing});
    let fetches = 0;
    const h = await host(context, speakers, {artwork: {
      fetch: () => { fetches++; return Promise.resolve({ok: true, value: new Uint8Array([1])}); },
      decode: () => Promise.reject(new SdkError(errorBody(code, {detail: `${receiverOrigin}/private?token=synthetic-secret`}))),
    }});
    await h.advance(8000);
    assert.equal(fetches, 1);
    const diagnostics = h.logs().filter(record => record.fields['bunny.operation'] === 'media');
    assert.deepEqual(diagnostics.map(record => [record.level, record.event, record.fields['bunny.code'], record.fields['bunny.attempt_count']]),
      [[level, 'operation.failed', code, 1], ['debug', 'operation.failed', code, 1]]);
    assert.ok(!JSON.stringify(diagnostics).includes('synthetic-secret'));
    assert.ok(!JSON.stringify(diagnostics).includes(receiverOrigin));
    assert.deepEqual(diagnostics.map(record => checkModuleRecord('playback', record)), diagnostics.map(() => undefined));
    assert.deepEqual(h.problems(), []);
  });
}

/** Faults enter the real module owner; speaker metadata/control calls remain independent. */
for (const fault of ['unsupported', 'malformed', 'capacity', 'unavailable', 'fetch-deadline', 'stream-deadline'] as const) {
  test(`artwork ${fault} preserves metadata, controls and the 5s/30s freshness boundaries`, async context => {
    const speakers = new ArtworkSpeakers({sony: playing});
    let attempts = 0;
    const fetchSignals: AbortSignal[] = [];
    const malformedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const streamed = createArtworkFetch((_input, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
        // A fetch-backed HTTP body is aborted with its request. This fake stream has no network resource.
        signal?.addEventListener('abort', () => { controller.error(new Error('synthetic stream aborted')); }, {once: true});
      }});
      return Promise.resolve(new Response(body, {headers: {'content-type': 'text/plain'}}));
    });
    const fetch: ArtworkFetch = async (candidate, endpoint, signal) => {
      attempts++; fetchSignals.push(signal);
      switch (fault) {
        case 'unsupported': return {ok: true, value: new Uint8Array([1, 2, 3])};
        case 'malformed': return {ok: true, value: malformedJpeg};
        case 'capacity': return artworkFailure('capacity');
        case 'unavailable': return artworkFailure('unavailable', true);
        case 'fetch-deadline': return new Promise(() => {});
        case 'stream-deadline': return streamed(candidate, endpoint, signal);
      }
    };
    const h = await host(context, speakers, {artwork: {fetch, decode: decodeArtwork}});
    const expected = {status: 'known', player: 'playing', title: playing.title, artist: playing.artist, controls: ['pause', 'next', 'previous']};
    assert.deepEqual(h.record().playback, expected);
    assert.equal(h.record().availability, 'available');
    assert.equal(h.record().artwork?.status, 'missing');
    const generation = h.record().artwork?.generation;

    // A real module command/receipt while artwork is failed or still hanging, without inventing new metadata.
    const requestId = `fault-${fault}-next`;
    const sent = await h.send('next', requestId);
    assert.equal(sent.status, 'accepted');
    assert.deepEqual(speakers.state().sony.commands, ['next']);
    assert.deepEqual(speakers.state().sonos.commands, []);
    assert.deepEqual(h.outcomes().filter(outcome => outcome.requestId === requestId).map(outcome => [outcome.result, outcome.evidence]), [['succeeded', 'transmitted']]);
    await h.advance(8000);
    assert.deepEqual(h.record().playback, expected, 'continued successful polls retain text and supported controls');
    assert.equal(h.record().availability, 'available');
    assert.equal(h.record().artwork?.status, 'missing');
    assert.equal(h.record().artwork?.generation, generation);
    assert.ok(attempts >= 1 && attempts <= 3, 'admitted retries remain bounded');
    if (fault === 'fetch-deadline' || fault === 'stream-deadline') assert.equal(fetchSignals[0]?.aborted, true, 'the first request ended at its deadline');

    // The last successful poll was at t=8s. Later artwork retries/failures must not refresh its evidence.
    speakers.silent('sony'); speakers.silent('sonos');
    await h.advance(4999);
    assert.equal(h.record().availability, 'available', 'metadata remains fresh just before 5s');
    await h.advance(1);
    assert.equal(h.record().availability, 'stale', 'artwork activity did not move the 5s boundary');
    assert.deepEqual(h.record().playback, expected);
    assert.equal(h.record().artwork?.generation, generation);
    await h.advance(25_000);
    assert.equal(h.record().availability, 'unavailable', 'artwork activity did not move the 30s boundary');
    assert.deepEqual(h.record().playback, {status: 'unknown'});
    assert.equal(h.record().artwork, undefined);
    assert.deepEqual(h.problems(), []);
    assert.ok(!JSON.stringify(h.logs()).includes(receiverOrigin), 'private receiver URL never reaches diagnostics');
  });
}

test('successful paused-next retains receiver-lagged metadata and artwork until new metadata is reported', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  const image = await sharp({create: {width: 8, height: 4, channels: 3, background: '#206040'}}).jpeg().toBuffer();
  const normalized = await decodeArtwork(image);
  assert.ok(normalized.ok);
  let fetches = 0;
  let decodes = 0;
  let releaseNew: ((value: ArtworkResult<ArtworkThumbnail>) => void) | undefined;
  const h = await host(context, speakers, {artwork: {
    fetch: () => { fetches++; return Promise.resolve({ok: true, value: image}); },
    decode: async () => {
      decodes++;
      return decodes === 1 ? normalized : new Promise(resolve => { releaseNew = resolve; });
    },
  }});
  assert.equal(h.record().artwork?.status, 'ready');
  assert.equal((await h.send('pause', 'lag-pause')).status, 'accepted');
  await flush();
  const paused = structuredClone(h.record());
  assert.ok(paused.playback.status === 'known' && paused.playback.player === 'paused');
  assert.equal(paused.artwork?.status, 'ready');
  const requestId = 'lag-next';
  assert.equal((await h.send('next', requestId)).status, 'accepted');
  await h.advance(2000);
  assert.deepEqual(speakers.state().sony.commands, ['pause', 'next']);
  assert.deepEqual(h.outcomes().filter(outcome => outcome.requestId === requestId).map(outcome => [outcome.result, outcome.evidence]), [['succeeded', 'transmitted']]);
  assert.deepEqual(h.record().playback, paused.playback, 'successful next cannot manufacture metadata the receiver has not reported');
  assert.deepEqual(h.record().artwork, paused.artwork, 'unchanged receiver metadata keeps the existing artwork association');
  assert.equal(fetches, 1, 'paused-next with an unchanged candidate does not reacquire artwork');

  // Later receiver metadata is the association boundary, independently of the earlier successful command.
  speakers.play('sony', {title: 'New reported synthetic track', artist: playing.artist});
  speakers.pause('sony');
  speakers.candidate = `${receiverOrigin}/image-b`;
  await h.advance(2000);
  const current = h.record();
  assert.ok(current.playback.status === 'known');
  assert.equal(current.playback.title, 'New reported synthetic track');
  assert.equal(current.playback.player, 'paused');
  assert.deepEqual(current.playback.controls, ['next', 'previous']);
  assert.equal(current.artwork?.status, 'missing', 'the old ready image is cleared before the new decode answers');
  assert.notEqual(current.artwork?.generation, paused.artwork?.generation);
  assert.equal(fetches, 2);
  assert.ok(releaseNew);
  releaseNew(normalized); await flush();
  assert.equal(h.record().artwork?.status, 'ready');
  assert.equal(h.record().artwork?.generation, current.artwork?.generation);
  assert.deepEqual(h.problems(), []);
});
