import assert from 'node:assert/strict';
import {SimulatedSpeakers} from '../src/simulated.js';
import {decodeArtwork} from '../src/artwork-decode.js';
import type {ArtworkResult} from '../src/artwork-fetch.js';
import type {ArtworkThumbnail} from '../src/artwork-decode.js';
import type {SonyReply} from '../src/transport.js';
import sharp from 'sharp';
import {SECTION, flush, host, test} from './support.js';

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
