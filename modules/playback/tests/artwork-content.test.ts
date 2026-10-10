import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type Participant} from '@jimmie-potts/sdk';
import {SimulatedSpeakers} from '../src/simulated.js';
import type {SonyReply} from '../src/transport.js';
import {flush, host, test, withWriteFailure} from './support.js';

// Independent valid 1x1 RGBA PNG: pixel [20,60,100,255]. It is already normalized.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQsUn5DwAC0AG0vqck9wAAAABJRU5ErkJggg==', 'base64');
const thumbnail = {mediaType: 'image/png', width: 1, height: 1, base64: PNG.toString('base64')} as const;
const playing = {input: 'airplay', status: 'playing', title: 'Synthetic song', artist: 'Synthetic artist'} as const;
class ArtworkSpeakers extends SimulatedSpeakers {
  candidate = 'image-a';
  override async sony(endpoint: string, method: string, version: string, signal: AbortSignal): Promise<SonyReply> {
    const reply = await super.sony(endpoint, method, version, signal);
    if (method === 'getPlayingContentInfo' && 'result' in reply) {
      for (const entry of reply.result.flat()) if (typeof entry === 'object' && entry !== null) {
        Object.assign(entry, {content: {thumbnailUrl: `${new URL(endpoint).origin}/${this.candidate}`}});
      }
    }
    return reply;
  }
}
const reference = (record: ReturnType<Awaited<ReturnType<typeof host>>['record']>): string => {
  assert.equal(record.artwork?.status, 'ready');
  return `artwork.${record.artwork?.generation}.${record.revision}`;
};
const titleOf = (record: PlaybackState): string | undefined => record.playback.status === 'known' ? record.playback.title : undefined;

/** Hold the real outbox's state send after its transaction has committed. */
class HeldStateBus extends InProcessBus {
  #gate: Promise<void> | undefined;
  #release: (() => void) | undefined;
  readonly held: PlaybackState[] = [];

  hold(): void {
    this.#gate ??= new Promise(resolve => {this.#release = resolve;});
  }

  release(): void {
    this.#release?.();
    this.#gate = undefined;
    this.#release = undefined;
  }

  override connect(source: string): Participant {
    const inner = super.connect(source);
    if (source !== 'bunny/modules/playback') return inner;
    return {...inner, publishMessage: async <T extends object>(key: string, message: Message<T>) => {
      if (message.kind === 'state' && this.#gate !== undefined) {
        this.held.push(structuredClone(message.data) as PlaybackState);
        await this.#gate;
      }
      return inner.publishMessage(key, message);
    }};
  }
}

/** Sync deliberately exposes the working record; content must wait for its own successful commit pointer. */
const workingRecord = async (h: Awaited<ReturnType<typeof host>>): Promise<PlaybackState> => {
  const copied = await h.requester.sync<PlaybackState>(['playback'], () => {}, {timeoutMs: 1000});
  assert.equal(copied.status, 'synced');
  assert.ok(copied.status === 'synced');
  try {
    const current = copied.copy.states()[0]?.data;
    assert.ok(current);
    return structuredClone(current);
  } finally {
    await copied.copy.close();
  }
};

test('artwork content serves the current valid thumbnail without acquiring or refreshing evidence', async context => {
  let fetches = 0, decodes = 0;
  const speakers = new ArtworkSpeakers({sony: playing});
  const h = await host(context, speakers, {artwork: {
    fetch: () => {fetches++; return Promise.resolve({ok: true, value: PNG});},
    decode: () => {decodes++; return Promise.resolve({ok: true, value: thumbnail});},
  }});
  const current = structuredClone(h.record()), ref = reference(current);
  const counts = [fetches, decodes, h.published.length, h.outcomes().length, h.clock.pending(), speakers.state().sony.calls];
  for (let read = 0; read < 3; read++) {
    const found = await h.readContent(ref);
    assert.ok(found !== undefined && 'bytes' in found, 'valid current ready artwork has an owning content contribution');
    assert.equal(found.type, 'image/png'); assert.deepEqual(found.bytes, new Uint8Array(PNG));
  }
  assert.deepEqual(h.record(), current);
  assert.deepEqual([fetches, decodes, h.published.length, h.outcomes().length, h.clock.pending(), speakers.state().sony.calls], counts);
  assert.deepEqual(speakers.state().sony.commands, []);
  assert.deepEqual(h.problems(), []);
});

test('artwork content retires old revisions, identical-text source handoffs, stale state and stop', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  const h = await host(context, speakers, {artwork: {fetch: () => Promise.resolve({ok: true, value: PNG}), decode: () => Promise.resolve({ok: true, value: thumbnail})}});
  const first = h.record(), firstRef = reference(first);
  assert.equal((await h.send('pause', 'content-pause')).status, 'accepted'); await flush();
  const paused = h.record(), pausedRef = reference(paused);
  assert.equal(paused.artwork?.generation, first.artwork?.generation);
  assert.notEqual(paused.revision, first.revision);
  assert.equal(await h.readContent(firstRef), undefined);
  assert.ok(await h.readContent(pausedRef));
  speakers.play('sonos', {title: playing.title, artist: playing.artist}); await h.advance(2000);
  assert.equal(h.record().artwork?.status, 'unsupported');
  assert.notEqual(h.record().artwork?.generation, first.artwork?.generation);
  assert.equal(await h.readContent(pausedRef), undefined);
  speakers.stop('sonos'); speakers.play('sony', {title: playing.title, artist: playing.artist}); await h.advance(2000);
  const restoredRef = reference(h.record()); assert.ok(await h.readContent(restoredRef));
  speakers.silent('sony'); speakers.silent('sonos'); await h.advance(5000);
  assert.equal(h.record().availability, 'stale'); assert.equal(await h.readContent(restoredRef), undefined);
  await h.advance(25_000);
  assert.equal(h.record().availability, 'unavailable'); assert.equal(await h.readContent(restoredRef), undefined);
  await h.stop(); assert.equal(await h.readContent(restoredRef), undefined);
  await h.start(); assert.equal(await h.readContent(restoredRef), undefined);
});

test('a failed artwork association commit cannot resurrect content from the old record', async context => {
  let refuse = false;
  const speakers = new ArtworkSpeakers({sony: playing});
  const h = await host(context, speakers, {wrapDatabase: db => withWriteFailure(db, () => refuse ? new Error('SQLITE_READONLY') : undefined),
    artwork: {fetch: () => Promise.resolve({ok: true, value: PNG}), decode: () => Promise.resolve({ok: true, value: thumbnail})}});
  const oldRef = reference(h.record()), oldRevision = h.record().revision;
  refuse = true; speakers.candidate = 'image-b'; speakers.play('sony', {title: 'B'}); await h.advance(2000);
  assert.equal(h.record().revision, oldRevision, 'failed commit publishes no replacement state');
  assert.equal(await h.readContent(oldRef), undefined, 'private current B cannot serve rolled-back A');
  refuse = false; await h.advance(2000);
  assert.ok(await h.readContent(reference(h.record()))); assert.equal(await h.readContent(oldRef), undefined);
});

test('same-generation candidate replacement retires its old revision before the delayed decode answers', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  let release: (() => void) | undefined, decodes = 0;
  const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4ISLyHwAEiAHwkp1qPAAAAABJRU5ErkJggg==', 'base64');
  const h = await host(context, speakers, {artwork: {
    fetch: () => Promise.resolve({ok: true, value: speakers.candidate === 'image-a' ? PNG : PNG_B}),
    decode: async bytes => {
      decodes++;
      if (decodes === 2) await new Promise<void>(resolve => {release = resolve;});
      return {ok: true, value: {...thumbnail, base64: Buffer.from(bytes).toString('base64')}};
    },
  }});
  const old = h.record(), oldRef = reference(old);
  speakers.candidate = 'image-b'; await h.advance(2000);
  assert.equal(h.record().artwork?.status, 'missing');
  assert.equal(h.record().artwork?.generation, old.artwork?.generation);
  assert.equal(await h.readContent(oldRef), undefined);
  assert.ok(release); release(); await flush();
  const next = h.record(); assert.equal(next.artwork?.generation, old.artwork?.generation);
  assert.notEqual(next.revision, old.revision);
  const found = await h.readContent(reference(next)); assert.ok(found !== undefined && 'bytes' in found);
  assert.deepEqual(found.bytes, new Uint8Array(PNG_B)); assert.equal(await h.readContent(oldRef), undefined);
});

test('artwork content withholds the working record while its state publication is held', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  let bus: HeldStateBus | undefined;
  context.after(() => {bus?.release();});
  const h = await host(context, speakers, {
    bus: options => {bus = new HeldStateBus(options); return bus;},
    artwork: {fetch: () => Promise.resolve({ok: true, value: PNG}), decode: () => Promise.resolve({ok: true, value: thumbnail})},
  });
  assert.ok(bus);
  const old = h.record(), oldRef = reference(old), publications = h.records().length;
  bus.hold();
  try {
    speakers.play('sony', {title: 'B'}); await h.advance(2000);
    const working = await workingRecord(h), workingRef = reference(working);
    assert.equal(titleOf(working), 'B'); assert.ok(working.revision > old.revision);
    assert.ok(bus.held.length > 0, 'a real state send is awaiting release');
    assert.equal(h.records().length, publications);
    const counts = [speakers.state().sony.calls, h.published.length, h.clock.pending(), h.outcomes().length];
    for (let read = 0; read < 3; read++) {
      assert.equal(await h.readContent(oldRef), undefined);
      assert.equal(await h.readContent(workingRef), undefined, 'working revision is not yet content-readable');
    }
    assert.deepEqual([speakers.state().sony.calls, h.published.length, h.clock.pending(), h.outcomes().length], counts);
    bus.release(); await flush();
    assert.deepEqual(h.record(), working);
    const found = await h.readContent(workingRef); assert.ok(found !== undefined && 'bytes' in found);
    assert.deepEqual(found.bytes, new Uint8Array(PNG));
    assert.equal(await h.readContent(oldRef), undefined);
    assert.deepEqual(h.problems(), []);
  } finally {
    bus.release();
  }
});

test('back-to-back held artwork commits expose only the final current association after release', async context => {
  const speakers = new ArtworkSpeakers({sony: playing});
  let bus: HeldStateBus | undefined;
  context.after(() => {bus?.release();});
  const h = await host(context, speakers, {
    bus: options => {bus = new HeldStateBus(options); return bus;},
    artwork: {fetch: () => Promise.resolve({ok: true, value: PNG}), decode: () => Promise.resolve({ok: true, value: thumbnail})},
  });
  assert.ok(bus);
  const firstRef = reference(h.record()), publications = h.records().length;
  bus.hold();
  try {
    speakers.play('sony', {title: 'B'}); await h.advance(2000);
    const b = await workingRecord(h), bRef = reference(b);
    assert.equal(titleOf(b), 'B');
    speakers.play('sony', {title: 'C'}); await h.advance(2000);
    const c = await workingRecord(h), cRef = reference(c);
    assert.equal(titleOf(c), 'C'); assert.ok(c.revision > b.revision);
    assert.notEqual(c.artwork?.generation, b.artwork?.generation);
    assert.ok(bus.held.length > 0); assert.equal(h.records().length, publications);
    for (const ref of [firstRef, bRef, cRef]) assert.equal(await h.readContent(ref), undefined);
    bus.release(); await flush();
    assert.deepEqual(h.record(), c);
    assert.equal(await h.readContent(firstRef), undefined); assert.equal(await h.readContent(bRef), undefined);
    const found = await h.readContent(cRef); assert.ok(found !== undefined && 'bytes' in found);
    assert.deepEqual(found.bytes, new Uint8Array(PNG));
    const titles = h.records().slice(publications).filter(record => record.artwork?.status === 'ready').map(titleOf);
    assert.deepEqual(titles, ['B', 'C'], 'the real serialized outbox retains commit publication order');
    assert.deepEqual(h.problems(), []);
  } finally {
    bus.release();
  }
});
