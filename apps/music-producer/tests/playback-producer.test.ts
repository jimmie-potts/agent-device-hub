import assert from 'node:assert/strict';
import test from 'node:test';
import type {Command, RemoteEndpoint, RemoteParticipant, Reply} from '@jimmie-potts/sdk';
import type {MusicPlaybackObservation, MusicPlaybackResult, MusicPlaybackWork} from '@jimmie-potts/event-contracts/v2/music-playback';
import type {PlaybackNativeControlResult, PlaybackNativeSource} from '../src/playback-native.js';
import {MusicPlaybackProducer} from '../src/playback-producer.js';
import {playbackSample} from './playback-fixtures.js';
import {flush, timerWorld} from './support.js';

const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
function fixture({skew = 0, holdRead = false, unknownReadCleanup = false, deferControl = false} = {}) {
  const time = timerWorld(); let reads = 0, controls = 0, nativeClosed = 0, remoteClosed = 0;
  let onClosed = () => {}, respond: (command: Command<MusicPlaybackWork>) => Reply | Promise<Reply> = () => {throw new Error('no endpoint');};
  let release = () => {}, holding = holdRead, nativeInstance = 'a'.repeat(64), unavailableRead = false;
  let finishControl: (cleanup?: 'confirmed' | 'uncertain') => void = () => {};
  const publications: {family: string; data: object}[] = [];
  const endpoint: RemoteEndpoint = {id: 'music-1', close: () => {onClosed(); return Promise.resolve();}, publish: (family, draft) => {
    publications.push({family, data: draft.data}); return Promise.resolve({specversion: '1.0', bunnyprofile: '2.0', id: `event-${publications.length}`,
      source: 'bunny/parts/music-playback', subject: 'music-1', time: new Date(time.clock().wallMs).toISOString(), traceparent,
      datacontenttype: 'application/json', ...draft});
  }, request: () => Promise.resolve({status: 'accepted', requestId: 'register', reply: {specversion: '1.0', bunnyprofile: '2.0', id: 'reply-1',
    source: 'bunny/modules/playback', subject: 'music-1', type: 'org.bunny.command.replied', kind: 'reply', traceparent,
    time: new Date(time.clock().wallMs + skew).toISOString(), datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/reply/2.0',
    data: {requestId: 'register', status: 'accepted'}}})};
  const participant: Pick<RemoteParticipant, 'openEndpoint' | 'close'> = {openEndpoint: options => {onClosed = options.onClosed ?? (() => {});
    respond = command => options.respond(command as never); return Promise.resolve(endpoint);}, close: () => {remoteClosed += 1; onClosed(); return Promise.resolve();}};
  const native: PlaybackNativeSource = {qualifyClock: () => Promise.resolve(true), close: () => {nativeClosed += 1; return Promise.resolve({status: 'stopped'});},
    read: async ({signal} = {}) => {reads += 1; const start = time.clock().monotonicMs;
      if (holding) await new Promise<void>(resolve => {release = resolve; signal?.addEventListener('abort', resolve.bind(undefined, undefined), {once: true});});
      if (signal?.aborted === true) return {status: 'failure', cleanup: unknownReadCleanup ? 'uncertain' : 'confirmed', mayHaveSent: false, error: {code: 'cancelled', retryable: false}};
      time.advance(50);
      if (unavailableRead) return {status: 'record', cleanup: 'confirmed', record: {schema: 'music-playback-read/1.0', status: 'unavailable',
        interval: {startedMonotonicMs: start, endedMonotonicMs: start + 50}, error: {code: 'forbidden', retryable: false}}};
      return {status: 'record', record: {...playbackSample(start), sourceInstance: nativeInstance}, cleanup: 'confirmed'};
    }, control: options => {controls += 1; const now = time.clock().monotonicMs;
      const record = {schema: 'music-playback-control/1.0' as const, action: options.action,
        expectedSourceInstance: options.expectedSourceInstance, status: 'sent', interval: {startedMonotonicMs: now, endedMonotonicMs: now},
        sendInterval: {startedMonotonicMs: now, endedMonotonicMs: now}} as const;
      if (deferControl) return new Promise<PlaybackNativeControlResult>(resolve => {finishControl = (cleanup = 'confirmed') => resolve({status: 'record', cleanup, record});});
      return Promise.resolve({status: 'record', cleanup: 'confirmed', record});}};
  const producer = new MusicPlaybackProducer({participant, native, libraryScopeId: 'synthetic-library', clock: time.clock, scheduler: time.scheduler});
  const observations = () => publications.filter(item => item.family === 'music-playback-observation').map(item => item.data as MusicPlaybackObservation);
  const work = (data: MusicPlaybackWork, source = 'bunny/modules/playback', expiry = time.clock().wallMs + 5000) => respond({
    specversion: '1.0', bunnyprofile: '2.0', id: `command-${data.requestId}`, source, subject: 'music-1', kind: 'command',
    type: 'org.bunny.music-playback.work.requested', dataschema: 'https://bunny.invalid/events/music-playback-work/2.0', datacontenttype: 'application/json', traceparent,
    time: new Date(time.clock().wallMs).toISOString(), expiresat: new Date(expiry).toISOString(), data});
  return {...time, producer, publications, observations, work, hold: () => {holding = true;}, release: () => release(), lose: () => onClosed(),
    replaceProcess: () => {nativeInstance = 'b'.repeat(64);}, refuseRead: () => {unavailableRead = true;}, finishControl: (cleanup?: 'confirmed' | 'uncertain') => finishControl(cleanup),
    reads: () => reads, controls: () => controls, nativeClosed: () => nativeClosed, remoteClosed: () => remoteClosed,
    results: () => publications.filter(item => item.family === 'music-playback-result').map(item => item.data as MusicPlaybackResult)};
}
void test('explicit startup publishes source-time observations only after qualified registration', async () => {
  const world = fixture(); assert.equal(world.reads(), 0); await world.producer.start(); await flush();
  const sample = world.observations()[0]; assert.equal(sample?.status, 'sample');
  if (sample?.status === 'sample') {assert.equal(sample.libraryScopeId, 'synthetic-library'); assert.equal(sample.position.status, 'observed');
    assert.equal(sample.interval.earliestAtMs, 1_000_900); assert.equal('sourceInstance' in sample, false);}
  assert.equal(world.reads(), 1); await world.producer.stop();
});
void test('playback controls are pinned to the observed process and are never repeated', async () => {
  const world = fixture(); await world.producer.start(); await flush(); const sample = world.observations()[0]; assert.ok(sample?.status === 'sample');
  const command = {requestId: 'work-1', operationId: 'operation-1', processEpoch: sample.processEpoch, action: 'pause' as const};
  assert.deepEqual(await world.work(command, 'bunny/core'), {error: {code: 'forbidden', retryable: false}});
  assert.deepEqual(await world.work({...command, processEpoch: 'retired'}), {error: {code: 'invalid-state', retryable: false}});
  assert.deepEqual(await world.work(command), {status: 'accepted'}); await flush();
  assert.equal(world.controls(), 1); assert.equal(world.results()[0]?.status, 'sent');
  assert.deepEqual(await world.work(command), {status: 'accepted'}); assert.equal(world.controls(), 1); await world.producer.stop();
});
void test('clock failure and endpoint loss terminate local reads without re-enrollment', async () => {
  const skewed = fixture({skew: 51}); await assert.rejects(skewed.producer.start()); assert.equal(skewed.reads(), 0);
  const world = fixture({holdRead: true}); await world.producer.start(); await flush(); assert.equal(world.reads(), 1);
  world.lose(); await world.producer.closed; world.release(); await flush();
  assert.equal(world.observations().length, 0); assert.equal(world.nativeClosed(), 1); assert.ok(world.remoteClosed() >= 1);
});
void test('control cancels an in-flight read and never starts a child after unknown read teardown', async () => {
  for (const unknownReadCleanup of [false, true]) {
    const world = fixture({unknownReadCleanup}); await world.producer.start(); await flush();
    const sample = world.observations()[0]; assert.ok(sample?.status === 'sample');
    world.hold(); world.advance(1950); await flush(); assert.equal(world.reads(), 2);
    const result = await world.work({requestId: 'pause', operationId: 'pause', processEpoch: sample.processEpoch, action: 'pause'});
    assert.deepEqual(result, {status: 'accepted'}); await flush();
    assert.equal(world.controls(), unknownReadCleanup ? 0 : 1); assert.equal(world.results()[0]?.status, unknownReadCleanup ? 'unsent' : 'sent');
    assert.equal(world.observations().length, 1); await world.producer.stop();
  }
});
void test('clock jumps and conservative expiry refuse new native controls and retire the endpoint', async () => {
  const world = fixture(); await world.producer.start(); await flush(); const sample = world.observations()[0]; assert.ok(sample?.status === 'sample');
  const data = {requestId: 'pause', operationId: 'pause', processEpoch: sample.processEpoch, action: 'pause' as const};
  assert.deepEqual(await world.work(data, 'bunny/modules/playback', world.clock().wallMs + 99), {error: {code: 'expired', retryable: false}});
  world.shiftWall(26); assert.deepEqual(await world.work(data), {error: {code: 'invalid-state', retryable: false}});
  await world.producer.closed; assert.equal(world.controls(), 0); assert.equal(world.nativeClosed(), 1);
});
void test('a valid late control result publishes once before uncertain-cleanup shutdown', async () => {
  const world = fixture({deferControl: true}); await world.producer.start(); await flush();
  const sample = world.observations()[0]; assert.ok(sample?.status === 'sample');
  await world.work({requestId: 'pause', operationId: 'pause', processEpoch: sample.processEpoch, action: 'pause'}); await flush();
  world.advance(4500); assert.deepEqual(world.results(), []); world.finishControl('uncertain'); await flush();
  assert.equal(world.results().length, 1); assert.equal(world.results()[0]?.status, 'sent'); assert.equal(world.controls(), 1);
  await world.producer.closed; assert.equal(world.nativeClosed(), 1);
});
void test('process replacement changes epoch and unavailable reads immediately refuse old controls', async () => {
  const world = fixture(); await world.producer.start(); await flush(); const first = world.observations()[0]; assert.ok(first?.status === 'sample');
  world.replaceProcess(); world.advance(2000); await flush(); const second = world.observations()[1]; assert.ok(second?.status === 'sample');
  assert.notEqual(second.processEpoch, first.processEpoch); assert.equal(second.discontinuity, true);
  assert.deepEqual(await world.work({requestId: 'old', operationId: 'old', processEpoch: first.processEpoch, action: 'pause'}),
    {error: {code: 'invalid-state', retryable: false}});
  world.refuseRead(); world.advance(2000); await flush(); assert.equal(world.observations()[2]?.status, 'unavailable');
  assert.deepEqual(await world.work({requestId: 'lost', operationId: 'lost', processEpoch: second.processEpoch, action: 'pause'}),
    {error: {code: 'invalid-state', retryable: false}}); assert.equal(world.controls(), 0); await world.producer.stop();
});
