import assert from 'node:assert/strict';
import test from 'node:test';
import type {Command, LogFields, RemoteEndpoint, RemoteParticipant, Reply} from '@jimmie-potts/sdk';
import type {CaptureFeatures, CaptureProgress, CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
import type {NativeInput, NativeSource, NativeTermination} from '../src/native.js';
import type {NativeFrame} from '../src/protocol.js';
import {MusicProducer} from '../src/producer.js';
import {flush, timerWorld} from './support.js';

const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
const generation = '00000000-0000-4000-8000-000000000001';
function fixture({qualified = true, skew = 0, deferredClock = false, microphoneId, diagnostic}: {qualified?: boolean; skew?: number; deferredClock?: boolean; microphoneId?: string; diagnostic?: (fields: LogFields) => void} = {}) {
  const time = timerWorld();
  let captures = 0, stopped = 0, closed = 0, held = false;
  let onFrame: (frame: NativeFrame) => void = () => {};
  let onClosed = () => {};
  let respond: (command: Command<CaptureWork>) => Reply | Promise<Reply> = () => {throw new Error('not ready');};
  let finish: (end: NativeTermination) => void = () => {};
  let releaseFeature = () => {};
  let releaseClock: (value: boolean) => void = () => {};
  const clockResult = new Promise<boolean>(resolve => {releaseClock = resolve;});
  const publications: {family: string; data: object; at: number; dataschema: string}[] = [];
  const requests: object[] = [];
  const inputs: NativeInput[] = [];
  const endpoint: RemoteEndpoint = {id: 'capture-1', close: () => {onClosed(); return Promise.resolve();},
    publish: async (family, draft) => {
      publications.push({family, data: draft.data, at: time.clock().monotonicMs, dataschema: draft.dataschema});
      if (held && family === 'music-capture-features') await new Promise<void>(resolve => {releaseFeature = resolve;});
      return {specversion: '1.0', bunnyprofile: '2.0', id: 'event-1', source: 'bunny/parts/music-producer', subject: 'capture-1',
        time: new Date(time.clock().wallMs).toISOString(), traceparent, datacontenttype: 'application/json', ...draft};
    }, request: (_family, draft) => {
      requests.push(draft.data);
      return Promise.resolve({status: 'accepted', requestId: 'register', reply: {specversion: '1.0', bunnyprofile: '2.0', id: 'reply-1', source: 'bunny/core',
        type: 'org.bunny.command.replied', subject: 'capture-1', time: new Date(time.clock().wallMs + skew).toISOString(), kind: 'reply',
        datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/reply/2.0', traceparent,
        data: {requestId: 'register', status: 'accepted'}}});
    }};
  const participant: Pick<RemoteParticipant, 'openEndpoint' | 'close'> = {close: () => {closed += 1; onClosed(); return Promise.resolve();},
    openEndpoint: options => {
      onClosed = options.onClosed ?? (() => {});
      respond = command => options.respond(command as never);
      return Promise.resolve(endpoint);
    }};
  const native: NativeSource = {qualifyClock: () => deferredClock ? clockResult : Promise.resolve(qualified), start: (callback, input = {input: 'music'}) => {
    inputs.push(input);
    captures += 1; onFrame = callback;
    const ended = new Promise<NativeTermination>(resolve => {finish = resolve;});
    return {ended, stop: () => {stopped += 1; return ended;}};
  }};
  const producer = new MusicProducer({participant, native, clock: time.clock, scheduler: time.scheduler,
    ...(diagnostic === undefined ? {} : {diagnostic}),
    ...(microphoneId === undefined ? {} : {microphone: {id: microphoneId, uid: 'synthetic-private-uid'}})});
  const work = (data: CaptureWork, source = 'bunny/core') => respond({specversion: '1.0', bunnyprofile: '2.0', id: `cmd-${data.requestId}`, source,
    type: 'org.bunny.music-capture.work.requested', subject: 'capture-1', time: new Date(time.clock().wallMs).toISOString(), kind: 'command',
    datacontenttype: 'application/json', dataschema: `https://bunny.invalid/events/music-capture-work/${data.action === 'start' && data.input === 'microphone' ? '2.1' : '2.0'}`, traceparent,
    expiresat: new Date(time.clock().wallMs + 2000).toISOString(), data});
  return {...time, producer, publications, requests, inputs, captures: () => captures, stopped: () => stopped, closed: () => closed,
    start: () => work({requestId: 'start', operationId: 'start', generation, action: 'start', input: 'music'}),
    stop: () => work({requestId: 'stop', operationId: 'stop', generation, action: 'stop'}), work,
    finish: (end: NativeTermination) => finish(end), lose: () => onClosed(), releaseClock: () => releaseClock(true),
    hold: () => {held = true;}, release: () => {held = false; releaseFeature();},
    frame(sequence: number, age = 0) {
      const end = time.clock().monotonicMs - age;
      onFrame({sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800, startMonotonicMs: end - 100, endMonotonicMs: end,
        emittedMonotonicMs: end, rms: 0, peak: 0, clippedFraction: 0, bands: {bass: 0, mid: 0, treble: 0},
        onset: {strength: 0, confidence: 0}, discontinuity: sequence === 1});
    },
    features: () => publications.filter(value => value.family === 'music-capture-features').map(value => value.data as CaptureFeatures),
    progress: () => publications.filter(value => value.family === 'music-capture-progress').map(value => value.data as CaptureProgress),
  };
}

void test('microphone capability is configured without capture and only its selected alias is published', async () => {
  const world = fixture({microphoneId: 'studio-mic'}); await world.producer.start();
  assert.equal(world.captures(), 0);
  const request = world.requests[0];assert.ok(request && 'microphone' in request);
  assert.deepEqual(request.microphone, {id: 'studio-mic'});
  const selection = {input: 'microphone', microphoneId: 'studio-mic'} as const;
  const start = {requestId: 'start', operationId: 'start', generation, action: 'start', ...selection} as const;
  assert.deepEqual(await world.work({...start, microphoneId: 'another-mic'}), {error: {code: 'unsupported-capability', retryable: false}});
  assert.equal(world.captures(), 0);
  assert.deepEqual(await world.work(start), {status: 'accepted'}); await flush();
  assert.equal(world.captures(), 1);
  assert.deepEqual(world.inputs, [{input: 'microphone', uid: 'synthetic-private-uid'}]);
  world.frame(1);await flush();
  const feature = world.features()[0];assert.ok(feature?.input === 'microphone');
  assert.equal(feature.microphoneId, selection.microphoneId);
  assert.equal(world.publications.find(value => value.family === 'music-capture-features')?.dataschema, 'https://bunny.invalid/events/music-capture-features/2.1');
  assert.ok(!JSON.stringify([...world.requests, ...world.publications]).includes('synthetic-private-uid'));
  await world.stop();world.finish({status: 'stopped'});await flush();await world.producer.stop();
});

void test('registration declares one endpoint but never launches capture', async () => {
  let opened = 0, captures = 0;
  const endpoint: RemoteEndpoint = {id: 'capture-1', close: async () => {}, publish: () => Promise.reject(new Error('unexpected publication')),
    request: () => Promise.resolve({status: 'accepted', requestId: 'register', reply: {specversion: '1.0', bunnyprofile: '2.0', id: 'reply-1',
      source: 'bunny/core', type: 'org.bunny.command.replied', subject: 'capture-1', time: new Date().toISOString(),
      kind: 'reply', datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/reply/2.0',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: {requestId: 'register', status: 'accepted'}}})};
  const participant: Pick<RemoteParticipant, 'openEndpoint' | 'close'> = {close: async () => {}, openEndpoint: () => {opened += 1; return Promise.resolve(endpoint);}};
  const producer = new MusicProducer({participant, native: {qualifyClock: () => Promise.resolve(true), start: () => {captures += 1; throw new Error('unexpected capture');}}});
  await producer.start();
  assert.equal(opened, 1); assert.equal(captures, 0);
  await producer.stop();
});

void test('only core starts capture and started requires the first fresh frame, including silence', async () => {
  const world = fixture(); await world.producer.start();
  assert.equal(world.captures(), 0);
  assert.deepEqual(await world.work({requestId: 'bad', operationId: 'bad', generation, action: 'start', input: 'music'}, 'bunny/parts/other'),
    {error: {code: 'forbidden', retryable: false}});
  assert.deepEqual(await world.start(), {status: 'accepted'}); await flush();
  assert.equal(world.captures(), 1); assert.deepEqual(world.progress(), []);
  world.frame(1, 251); await flush(); assert.deepEqual(world.progress(), []);
  world.frame(2); await flush();
  assert.deepEqual(world.progress(), [{operationId: 'start', generation, status: 'started'}]);
  assert.equal(world.features()[0]?.rms, 0); assert.equal(world.features()[0]?.discontinuity, true);
  assert.deepEqual(await world.stop(), {status: 'accepted'});
  world.frame(3); world.finish({status: 'stopped'}); await flush();
  assert.equal(world.features().length, 1);
  assert.deepEqual(world.progress()[1], {operationId: 'stop', generation, status: 'stopped'});
  await world.producer.stop();
});

void test('slow feature publication retains one latest value and never bursts recovery above ten hertz', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.hold(); world.frame(1); await flush();
  for (let n = 2; n <= 6; n += 1) {world.advance(100); world.frame(n); await flush();}
  assert.equal(world.features().length, 1);
  world.release(); await flush();
  assert.deepEqual(world.features().map(frame => frame.sequence), [1, 6]);
  world.frame(7); await flush(); assert.equal(world.features().length, 2);
  world.advance(99); await flush(); assert.equal(world.features().length, 2);
  world.advance(1); await flush(); assert.equal(world.features().length, 3);
  const sent = world.publications.filter(value => value.family === 'music-capture-features');
  assert.ok(sent.every((value, index) => index === 0 || value.at - (sent[index - 1]?.at ?? 0) >= 100));
  await world.stop(); world.finish({status: 'stopped'}); await flush(); await world.producer.stop();
});

void test('a queued stale frame is discarded at actual publication and disconnect fences everything', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.hold(); world.frame(1); await flush(); world.advance(100); world.frame(2); world.advance(251);
  world.release(); await flush(); assert.equal(world.features().length, 1);
  world.lose(); assert.equal(world.stopped(), 1); world.frame(3); await flush();
  assert.equal(world.features().length, 1); world.finish({status: 'stopped'}); await flush();
  assert.equal(world.progress().length, 1); assert.ok(world.closed() >= 1);
});

void test('clock refusal and stop during qualification cannot open capture later', async () => {
  const skewed = fixture({skew: 51}); await assert.rejects(skewed.producer.start()); assert.equal(skewed.captures(), 0);
  const world = fixture({deferredClock: true}); await world.producer.start(); await world.start();
  assert.deepEqual(await world.stop(), {status: 'accepted'}); await flush(); world.releaseClock(); await flush();
  assert.equal(world.captures(), 0);
  assert.deepEqual(world.progress(), [{operationId: 'stop', generation, status: 'stopped'}]);
  await world.producer.stop();
});

void test('startup timeout and unknown teardown report uncertainty without accepting another capture', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.advance(5000); assert.equal(world.stopped(), 1);
  world.finish({status: 'uncertain', error: {code: 'uncertain-result', retryable: false}}); await flush();
  assert.equal(world.progress()[0]?.status, 'uncertain');
  assert.deepEqual(await world.start(), {error: {code: 'invalid-state', retryable: false}});
  await world.producer.stop();
});

void test('a core cleanup stop can retire a failing generation and later confirm the same clean teardown', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.advance(5000);
  assert.deepEqual(await world.stop(), {status: 'accepted'});
  world.finish({status: 'stopped'}); await flush();
  assert.deepEqual(world.progress(), [{operationId: 'stop', generation, status: 'stopped'}]);
  const captures = world.captures();
  assert.deepEqual(await world.work({requestId: 'cleanup', operationId: 'cleanup', generation, action: 'stop'}), {status: 'accepted'});
  await flush();
  assert.deepEqual(world.progress()[1], {operationId: 'cleanup', generation, status: 'stopped'});
  assert.equal(world.captures(), captures);
  assert.deepEqual(await world.start(), {error: {code: 'invalid-state', retryable: false}});
  await world.producer.stop();
});

void test('a late cleanup stop preserves unknown teardown and never opens another helper', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.finish({status: 'uncertain', error: {code: 'uncertain-result', retryable: false}}); await flush();
  assert.deepEqual(await world.stop(), {status: 'accepted'}); await flush();
  assert.deepEqual(world.progress()[1], {operationId: 'stop', generation, status: 'uncertain', error: {code: 'uncertain-result', retryable: false}});
  assert.equal(world.captures(), 1);
  await world.producer.stop();
});

void test('a wall clock jump while idle cannot reuse registration clock qualification', async () => {
  const world = fixture(); await world.producer.start(); world.shiftWall(26);
  await world.start(); await flush();
  assert.equal(world.captures(), 0);
  assert.deepEqual(world.progress(), [{operationId: 'start', generation, status: 'failed', error: {code: 'unavailable', retryable: true}}]);
  await world.producer.stop();
});

void test('a wall clock jump during capture stops it without refreshing an observation', async () => {
  const world = fixture(); await world.producer.start(); await world.start(); await flush();
  world.frame(1); await flush(); world.shiftWall(-26); world.advance(100); world.frame(2); await flush();
  assert.equal(world.stopped(), 1); assert.equal(world.features().length, 1);
  world.finish({status: 'stopped'}); await flush();
  assert.equal(world.progress()[1]?.status, 'failed');
  await world.producer.stop();
});

void test('capture checkpoints retain the later expired source window before the periodic observer fires', async () => {
  const records: LogFields[] = [];
  const world = fixture({diagnostic: fields => {records.push(fields);}});
  await world.producer.start(); await world.start(); await flush();
  world.frame(1, 100); await flush();
  world.advance(310); world.frame(2); await flush();
  assert.deepEqual(records.map(record => record['bunny.music.checkpoint']), ['loss', 'recovery']);
  assert.equal(records[0]?.['bunny.music.observation'], 'dequeued-window-expired');
  assert.equal(records[0]?.['bunny.music.dequeued_idle_ms'], 310);
  assert.equal(records[0]?.['bunny.music.dequeued_source_age_ms'], 100);
  world.advance(100); world.frame(3, 100); await flush();
  world.advance(310); world.frame(4); await flush();
  assert.equal(records.length, 2, 'the second episode is coalesced');
  await world.stop(); world.finish({status: 'stopped'}); await flush(); await world.producer.stop();
  const summary = records.find(record => record['bunny.music.checkpoint'] === 'summary');
  const terminal = records.find(record => record['bunny.music.checkpoint'] === 'terminal');
  assert.equal(summary?.['bunny.attempt_count'], 1);
  assert.equal(summary?.['bunny.music.capture_generation'], generation);
  assert.equal(summary?.['bunny.music.dequeued_sequence'], 3, 'the loss snapshot still describes the pre-recovery sequence');
  assert.equal(terminal?.['bunny.music.dequeued_sequence'], 4);
  assert.equal(records.length, 4);
  world.advance(60_000); assert.equal(records.length, 4, 'stop cancels the pending summary and sample');
});

void test('capture diagnostics distinguish a timestamp-rejected publication from a delayed acknowledgment', async () => {
  for (const pending of [false, true]) {
    const records: LogFields[] = [];
    const world = fixture({diagnostic: fields => {records.push(fields); throw new Error('synthetic failed sink');}});
    await world.producer.start(); await world.start(); await flush();
    world.hold(); world.frame(1); await flush();
    world.advance(100); world.frame(2);
    if (pending) {
      world.advance(100); world.frame(3);
      world.advance(100); world.frame(4);
      world.advance(100);
    } else {
      world.advance(251); world.release(); await flush();
    }
    const checkpoint = records.find(record => record['bunny.music.checkpoint'] === 'loss');
    assert.equal(checkpoint?.['bunny.music.observation'], pending ? 'publish-unacknowledged' : 'publication-timestamp-rejected');
    assert.equal(checkpoint?.['bunny.music.attempted_sequence'], 1);
    assert.equal(checkpoint?.['bunny.music.acknowledged_sequence'], pending ? undefined : 1);
    assert.equal(world.features().length, 1);
    assert.deepEqual(await world.stop(), {status: 'accepted'});
    world.finish({status: 'stopped'}); await flush();
    world.release(); await flush(); world.advance(60_000);
    assert.equal(records.filter(record => record['bunny.music.checkpoint'] === 'terminal').length, 1);
    assert.equal(world.features().length, 1, 'late acknowledgment does not restart publishing');
    await world.producer.stop();
  }
});

void test('the owned diagnostics stream tolerates an asynchronous write failure', async () => {
  const {Writable} = await import('node:stream');
  const {producerDiagnosticWriter} = await import('../src/diagnostics.js');
  let writes = 0;
  let failed = () => {};
  const emitted = new Promise<void>(resolve => {failed = resolve;});
  const sink = new Writable({write(_chunk, _encoding, callback) {
    writes++;
    queueMicrotask(() => {callback(new Error('synthetic stderr failure')); failed();});
  }});
  const diagnostic = producerDiagnosticWriter(sink);
  const fields = {'bunny.music.capture_generation': generation, 'bunny.music.checkpoint': 'terminal'};
  diagnostic(fields);
  await emitted; await flush();
  diagnostic(fields);
  assert.equal(writes, 1);
});

void test('producer diagnostics count records skipped under sink pressure on the next successful write', async () => {
  const {Writable} = await import('node:stream');
  const {producerDiagnosticWriter} = await import('../src/diagnostics.js');
  const writes: string[] = [];
  let release = () => {};
  const sink = new Writable({highWaterMark: 1, write(chunk: Buffer, _encoding, callback) {
    writes.push(chunk.toString());
    release = () => callback();
  }});
  const diagnostic = producerDiagnosticWriter(sink);
  const fields = {'bunny.music.capture_generation': generation, 'bunny.music.checkpoint': 'terminal'};
  diagnostic(fields); diagnostic(fields); diagnostic(fields);
  assert.equal(writes.length, 1);
  const drained = new Promise<void>(resolve => {sink.once('drain', resolve);});
  release(); await drained;
  diagnostic(fields);
  assert.match(writes[1] ?? '', /"bunny.music.sink_dropped_count":2/);
  release(); sink.end();
});

void test('coalesced producer diagnostics flush the latest loss once at the trailing boundary', async () => {
  const records: LogFields[] = [];
  const world = fixture({diagnostic: fields => {records.push(fields);}});
  await world.producer.start(); await world.start(); await flush();
  world.frame(1, 100); await flush();
  world.advance(310); world.frame(2); await flush();
  world.advance(100); world.frame(3, 100); await flush();
  world.advance(310); world.frame(4); await flush();
  world.advance(60_000 - 410);
  const summaries = () => records.filter(record => record['bunny.music.checkpoint'] === 'summary');
  assert.equal(summaries().length, 1);
  assert.equal(summaries()[0]?.['bunny.music.dequeued_sequence'], 4);
  assert.ok(Number(summaries()[0]?.['bunny.attempt_count']) > 0);
  await world.stop(); world.finish({status: 'stopped'}); await flush(); await world.producer.stop();
  assert.equal(summaries().length, 1);
});

void test('a late publish acknowledgment cannot alter diagnostics for a replacement capture generation', async () => {
  const records: LogFields[] = [];
  const world = fixture({diagnostic: fields => {records.push(fields);}});
  await world.producer.start(); await world.start(); await flush();
  world.hold(); world.frame(1); await flush(); world.advance(400);
  await world.stop(); world.finish({status: 'stopped'}); await flush();
  const firstTerminal = records.find(record => record['bunny.music.checkpoint'] === 'terminal');
  assert.equal(firstTerminal?.['bunny.music.capture_generation'], generation);
  assert.equal(firstTerminal?.['bunny.music.publication_state'], 'pending');
  assert.equal(firstTerminal?.['bunny.music.publish_pending_overdue'], true);
  assert.equal(firstTerminal?.['bunny.music.dequeued_window_expired'], true);

  const replacement = '00000000-0000-4000-8000-000000000002';
  assert.deepEqual(await world.work({requestId: 'replacement', operationId: 'replacement', generation: replacement,
    action: 'start', input: 'music'}), {status: 'accepted'});
  await flush(); world.frame(7); await flush();
  world.release(); await flush();
  assert.deepEqual(world.features().map(frame => [frame.generation, frame.sequence]), [[generation, 1], [replacement, 7]]);
  await world.work({requestId: 'new-stop', operationId: 'new-stop', generation: replacement, action: 'stop'});
  world.finish({status: 'stopped'}); await flush(); await world.producer.stop();
  const terminals = records.filter(record => record['bunny.music.checkpoint'] === 'terminal');
  assert.deepEqual(terminals.map(record => [record['bunny.music.capture_generation'], record['bunny.music.acknowledged_sequence']]),
    [[generation, undefined], [replacement, 7]]);
});
