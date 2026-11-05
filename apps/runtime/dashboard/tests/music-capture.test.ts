import assert from 'node:assert/strict';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CaptureFeatures, CaptureSelection, CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {Scheduler, Subscription, SyncedCopy, SyncHandler, SyncOptions, SyncResult} from '@jimmie-potts/sdk/remote';
import {CaptureProjection, MusicCaptureFeed} from '../src/music-capture-feed.ts';

const now = (mono: number, offset = 0) => ({wallMs: 100_000 + mono + offset, monotonicMs: mono});
const state = (status: Exclude<CaptureState['session']['status'], 'idle'> = 'active', generation = 'one'): CaptureState => ({
  id: 'music', revision: 1, endpointId: 'selected', availability: 'available', session: {status, generation, operationId: 'operation-one', input: 'music'},
});
const frame = (overrides: Partial<Omit<CaptureFeatures, 'input' | 'microphoneId'>> & (CaptureSelection | {input?: 'music'}) = {}): Message<CaptureFeatures> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: 'frame-one', source: 'bunny/parts/music-producer', kind: 'occurrence',
  type: 'org.bunny.music-capture.features.observed', subject: 'selected', time: new Date(101010).toISOString(),
  dataschema: 'https://bunny.invalid/events/music-capture-features/2.0', datacontenttype: 'application/json', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  data: {generation: 'one', sequence: 1, sampleRateHz: 48000, channels: 2, frameCount: 4800,
    startMonotonicMs: 100, endMonotonicMs: 200, emittedMonotonicMs: 205, observedAtMs: 101000, validUntilMs: 101400,
    rms: 0.25, peak: 0.5, clippedFraction: 0, bands: {bass: 0.1, mid: 0.2, treble: 0.1}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...overrides, ...(overrides.input === 'microphone' ? {input: 'microphone', microphoneId: overrides.microphoneId} : {input: 'music'})},
});
const level = (projection: CaptureProjection) => projection.view.features?.rms;
const ready = () => {const projection = new CaptureProjection(); projection.synchronize(state(), 101005, now(1000), now(1010)); return projection;};
void test('microphone projection requires its explicit alias and a supporting feature version', () => {
  const selected: CaptureState = {...state(), microphone: {id: 'studio-mic'},
    session: {status: 'active', generation: 'one', operationId: 'operation-one', input: 'microphone', microphoneId: 'studio-mic'}};
  const projection = new CaptureProjection();projection.synchronize(selected, 101005, now(1000), now(1010));
  projection.feature(frame(), now(1020));assert.equal(projection.view.features, undefined);
  const microphone = {...frame({input: 'microphone', microphoneId: 'studio-mic'}), dataschema: 'https://bunny.invalid/events/music-capture-features/2.1'};
  projection.feature({...microphone, data: {...microphone.data, input: 'microphone', microphoneId: 'another-mic'}}, now(1020));
  assert.equal(projection.view.features, undefined);
  projection.feature({...microphone, dataschema: frame().dataschema}, now(1020));assert.equal(projection.view.features, undefined);
  projection.feature(microphone, now(1020));assert.equal(level(projection), 0.25);
});
void test('measurement uses request/receipt clock bounds and distinguishes valid zero from unavailable', () => {
  const projection = ready(); assert.equal(projection.view.clockQualified, true);
  projection.feature(frame({rms: 0, peak: 0}), now(1020)); assert.equal(level(projection), 0);
  projection.tick(now(1394)); assert.equal(level(projection), 0);
  projection.tick(now(1395)); assert.equal(projection.view.features, undefined, 'upper core bound expires the original source measurement');
});
void test('unqualified latency and browser clock jumps never produce a meter', () => {
  for (const [sent, received] of [[now(1000), now(1200)], [now(1000), now(1010, 30)], [now(1000), now(990)]]) {
    assert.ok(sent !== undefined && received !== undefined); const projection = new CaptureProjection();
    projection.synchronize(state(), 101005, sent, received); projection.feature(frame(), now(1220));
    assert.equal(projection.view.clockQualified, false); assert.equal(projection.view.features, undefined);
  }
  for (const reading of [now(1020, 30), now(1020, -30), now(1005)]) {
    const projection = ready(); projection.feature(frame(), now(1020)); projection.tick(reading);
    assert.equal(projection.view.features, undefined); assert.equal(projection.view.clockQualified, false);
  }
});
void test('current identity, active state, numeric bounds and sequence gate each displayed measurement', () => {
  for (const bad of [frame({generation: 'old'}), {...frame(), source: 'bunny/parts/other'}, {...frame(), subject: 'other'},
    frame({rms: NaN}), frame({rms: -1}), frame({rms: 2, peak: 1}), frame({clippedFraction: 2}),
    frame({observedAtMs: 102000, validUntilMs: 102400}), frame({observedAtMs: 100000, validUntilMs: 100400})]) {
    const projection = ready(); projection.feature(bad, now(1020)); assert.equal(projection.view.features, undefined);
  }
  const rounding = ready(); rounding.feature(frame({rms: 0.5 + 5e-13, peak: 0.5}), now(1020));
  assert.notEqual(rounding.view.features, undefined, 'preserve the wire contract floating-point tolerance');
  const projection = ready(); projection.feature(frame({sequence: 2}), now(1020));
  projection.feature(frame({rms: 0.1}), now(1030)); assert.equal(level(projection), 0.25);
  projection.state(state('stale')); assert.equal(projection.view.features, undefined);
  projection.feature(frame({sequence: 3}), now(1040)); assert.equal(projection.view.features, undefined);
  projection.state(state('active', 'two')); projection.feature(frame({sequence: 4}), now(1050)); assert.equal(projection.view.features, undefined);
  projection.feature(frame({generation: 'two'}), now(1060)); assert.equal(level(projection), 0.25);
  projection.invalidate(); assert.equal(projection.view.features, undefined); assert.equal(projection.view.synced, false);
});

void test('Audio scope expires at the conservative deadline and closes owned subscriptions and copies', async () => {
  let mono = 1000, subscriptionClosed = 0, copyClosed = 0;
  const scheduled = new Set<{at: number; callback: () => void}>();
  const scheduler: Scheduler = {after: (delay, callback) => {const entry = {at: mono + delay, callback}; scheduled.add(entry); return () => {scheduled.delete(entry);};}};
  const advance = (to: number): void => {
    for (;;) {const next = [...scheduled].filter(entry => entry.at <= to).sort((a, b) => a.at - b.at)[0];
      if (next === undefined) break; scheduled.delete(next); mono = next.at; next.callback();}
    mono = to;
  };
  let receive: (message: Message<CaptureFeatures>) => void | Promise<void> = () => {};
  const source = {...frame(), kind: 'state' as const, type: 'org.bunny.music-capture.updated', source: 'bunny/core', subject: 'music', dataschema: 'https://bunny.invalid/events/music-capture-state/2.0', data: state()};
  const copy: SyncedCopy<CaptureState> = {states: () => [source], get: () => source, close: () => {copyClosed += 1; return Promise.resolve();}};
  const participant = {
    subscribe: (_pattern: string, handler: typeof receive): Promise<Subscription> => {receive = handler; return Promise.resolve({close: () => {subscriptionClosed += 1; return Promise.resolve();}});},
    sync: (_families: readonly string[], _handler: SyncHandler<CaptureState>, options: SyncOptions): Promise<SyncResult<CaptureState>> => {
      assert.equal(options.owner, 'bunny/core'); mono = 1010;
      return Promise.resolve({status: 'synced', copy, message: {...source, kind: 'sync-completed', time: new Date(101005).toISOString(), data: {requestId: 'sync', revision: 1, members: []}}});
    },
  };
  const feed = new MusicCaptureFeed({participant: participant as unknown as ConstructorParameters<typeof MusicCaptureFeed>[0]['participant'], now: () => now(mono), scheduler});
  assert.equal(subscriptionClosed, 0); await feed.refresh(); mono = 1020; await receive(frame());
  assert.equal(feed.getSnapshot().features?.rms, 0.25); advance(1395);
  assert.equal(feed.getSnapshot().features, undefined);
  await feed.close(); assert.equal(subscriptionClosed, 1); assert.equal(copyClosed, 1);
  assert.equal(await feed.refresh(), false);
});

const stateMessage = (): Message<CaptureState> => ({...frame(), kind: 'state', type: 'org.bunny.music-capture.updated', source: 'bunny/core',
  subject: 'music', dataschema: 'https://bunny.invalid/events/music-capture-state/2.0', data: state()});
function answer(close: () => Promise<void>, id = 'sync-one'): Extract<SyncResult<CaptureState>, {status: 'synced'}> {
  const source = stateMessage();
  return {status: 'synced', copy: {states: () => [source], get: () => source, close},
    message: {...source, id, kind: 'sync-completed', time: new Date(101005).toISOString(), data: {requestId: id, revision: 1, members: []}}};
}
const flush = async (): Promise<void> => {await new Promise(resolve => {setImmediate(resolve);});};
void test('a late subscription or copy cannot outlive its Audio scope', async () => {
  for (const phase of ['subscribe', 'sync'] as const) {
    let closed = 0, syncs = 0;
    const subscription: Subscription = {close: () => {closed += 1; return Promise.resolve();}};
    let finishSubscribe: (value: Subscription) => void = () => {throw new Error('no subscription');};
    let finishSync: (value: SyncResult<CaptureState>) => void = () => {throw new Error('no sync');};
    const participant = {
      subscribe: () => phase === 'subscribe' ? new Promise<Subscription>(resolve => {finishSubscribe = resolve;}) : Promise.resolve(subscription),
      sync: () => {syncs += 1; return new Promise<SyncResult<CaptureState>>(resolve => {finishSync = resolve;});},
    };
    const feed = new MusicCaptureFeed({participant: participant as unknown as ConstructorParameters<typeof MusicCaptureFeed>[0]['participant'], now: () => now(1010)});
    const pending = feed.refresh(); await flush(); await feed.close();
    if (phase === 'subscribe') finishSubscribe(subscription); else finishSync(answer(() => {closed += 1; return Promise.resolve();}));
    assert.equal(await pending, false); assert.equal(feed.getSnapshot().synced, false);
    assert.equal(syncs, phase === 'subscribe' ? 0 : 1); assert.equal(closed, phase === 'subscribe' ? 1 : 2);
  }
});
void test('an initial sync result retained across a restart cannot revive old freshness', async () => {
  let mono = 1000, handler: SyncHandler<CaptureState> = () => {}, options: SyncOptions = {timeoutMs: 1};
  let finish: (value: SyncResult<CaptureState>) => void = () => {throw new Error('no sync');};
  const participant = {
    subscribe: () => Promise.resolve({close: () => Promise.resolve()}),
    sync: (_families: readonly string[], given: SyncHandler<CaptureState>, settings: SyncOptions) => {
      handler = given; options = settings; return new Promise<SyncResult<CaptureState>>(resolve => {finish = resolve;});
    },
  };
  const feed = new MusicCaptureFeed({participant: participant as unknown as ConstructorParameters<typeof MusicCaptureFeed>[0]['participant'], now: () => now(mono)});
  const pending = feed.refresh(); await flush(); const initial = answer(async () => {});
  mono = 1010; await handler({type: 'synced', message: initial.message});
  mono = 1020; options.onRestarted?.(); finish(initial); await pending;
  assert.equal(feed.getSnapshot().synced, false, 'the first completion predates the restart');
  mono = 1030; await handler({type: 'synced', message: {...initial.message, id: 'sync-two', time: new Date(101025).toISOString()}});
  assert.equal(feed.getSnapshot().synced, true); assert.equal(feed.getSnapshot().clockQualified, true);
  await feed.close();
});

void test('Audio scope reads both registered state versions and ignores unregistered versions', async () => {
  for (const version of ['2.0', '2.1', '2.2']) {
    let mono = 1000;
    const source = {...stateMessage(), dataschema: `https://bunny.invalid/events/music-capture-state/${version}`};
    const participant = {
      subscribe: () => Promise.resolve({close: () => Promise.resolve()}),
      sync: () => {
        mono = 1010;
        return Promise.resolve({...answer(async () => {}), copy: {states: () => [source], get: () => source, close: () => Promise.resolve()}});
      },
    };
    const feed = new MusicCaptureFeed({participant: participant as unknown as ConstructorParameters<typeof MusicCaptureFeed>[0]['participant'], now: () => now(mono)});
    await feed.refresh();assert.equal(feed.getSnapshot().state?.id, version === '2.2' ? undefined : 'music');
    await feed.close();
  }
});
