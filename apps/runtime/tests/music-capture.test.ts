import assert from 'node:assert/strict';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {observation, sessionStarted} from './fixtures/agents.js';
import {MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureProgress, type CaptureSelection, type CaptureState, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
import {connectRemote, type Command} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {tokenDigest} from '../src/credentials.js';
import {contextOf, edgeConfig, fixture, it, run, stateDir, waitFor} from './support.js';

const schema = (family: string, version = '2.0') => `https://bunny.invalid/events/${family}/${version}`;
async function setup(t: TestContext, directory?: string) {
  let handle: CoreHandle | undefined, wallOffset = 0;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const observer = fixture('capture-observer');
  const files = await edgeConfig(t, [], {credentials: JSON.stringify({schema: 'edge-credentials/1.0', credentials: [
    {id: 'music-producer', source: MUSIC_PRODUCER_SOURCE, digest: tokenDigest('synthetic-token'), scopes: [], role: 'music-producer'},
  ]})});
  const {runtime} = await run(t, {modules: [core, observer], configFile: files.config, edge: {schemas: {}}, clock: {now: () => Date.now() + wallOffset}, ...(directory === undefined ? {} : {stateDir: directory})});
  const producer = await connectRemote({url: runtime.url, source: MUSIC_PRODUCER_SOURCE, token: 'synthetic-token'});
  t.after(() => producer.close());
  const work: Command<CaptureWork>[] = [];let closed = 0, refuseStop = false;
  const endpoint = await producer.openEndpoint<CaptureWork>({family: 'music-capture-work', onClosed: () => {closed += 1;}, respond: command => {work.push(command);return refuseStop && command.data.action === 'stop' ? errorBody('unavailable') : {status: 'accepted'};}});
  let stateSchema: string | undefined;
  const read = async (): Promise<CaptureState> => {
    const result = await contextOf(observer).sdk.sync<CaptureState>(['music-capture-state'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
    assert.equal(result.status, 'synced', result.status === 'synced' ? '' : JSON.stringify({result, health: runtime.health()}));if (result.status !== 'synced') throw new Error('capture-sync');
    assert.equal(result.copy.states().length, 1);
    stateSchema = result.copy.states()[0]?.dataschema;
    const current = result.copy.states()[0]?.data;await result.copy.close();assert.ok(current);return current;
  };
  let registrations = 0;
  const enable = (microphoneId?: string) => endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested', dataschema: schema('music-capture-endpoint', microphoneId === undefined ? '2.0' : '2.1'),
    data: {action: 'enable', input: 'music', ...(microphoneId === undefined ? {} : {microphone: {id: microphoneId}})}}, {requestId: `enable-music-${++registrations}`, timeoutMs: 2000});
  const control = (requestId: string, expectedRevision: number, action: 'start' | 'stop', selection: CaptureSelection = {input: 'music'}) => core.operatorActions.dispatch({key: 'bunny.cmd.music-capture-control.music', requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: 'org.bunny.music-capture.control.requested', subject: 'music', dataschema: schema('music-capture-control', selection.input === 'music' ? '2.0' : '2.1'), data: {action, expectedRevision, ...(action === 'start' ? {endpointId: endpoint.id, ...selection} : {})}}});
  const progress = (data: CaptureProgress) => endpoint.publish('music-capture-progress', {kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed', dataschema: schema('music-capture-progress'), data});
  const frame = (generation: string, sequence: number, patch: Partial<CaptureFeatures> = {}) => {
    const at = Date.now();
    return endpoint.publish('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed', dataschema: schema('music-capture-features', patch.input === 'microphone' ? '2.1' : '2.0'), data: {
      generation, input: 'music', sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
      startMonotonicMs: (sequence - 1) * 100, endMonotonicMs: sequence * 100, emittedMonotonicMs: sequence * 100 + 1, observedAtMs: at, validUntilMs: at + 400,
      rms: 0, peak: 0, clippedFraction: 0, bands: {bass: 0, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}, discontinuity: false, ...patch,
    }});
  };
  return {core, runtime, producer, observer, endpoint, work, stateSchema: () => stateSchema, closed: () => closed, refuseStop: () => {refuseStop = true;}, read, enable, control, progress, frame, operation: (id: string) => handle?.operation(id), failWrites: async (value: boolean) => {
    assert.ok(handle);await handle.transaction(tx => {tx.database.exec(value
      ? "CREATE TEMP TRIGGER refuse_capture BEFORE UPDATE ON music_capture BEGIN SELECT RAISE(ABORT, 'synthetic-capture-store-refusal'); END"
      : 'DROP TRIGGER refuse_capture');});
  }, failHistory: async (value: boolean) => {
    assert.ok(handle);await handle.transaction(tx => {tx.database.exec(value
      ? "CREATE TEMP TRIGGER refuse_capture_history BEFORE INSERT ON core_history WHEN NEW.type = 'org.bunny.music-capture.features.observed' BEGIN SELECT RAISE(ABORT, 'synthetic-history-refusal'); END"
      : 'DROP TRIGGER refuse_capture_history');});
  }, wallOffset: (value: number) => {wallOffset = value;}};
}

it('a configured microphone is selected explicitly and only its current frames can activate capture', async t => {
  const h = await setup(t);
  assert.equal((await h.enable('studio-mic')).status, 'accepted');
  const initial = await h.read();
  assert.deepEqual(initial.microphone, {id: 'studio-mic'});
  assert.equal(initial.session.status, 'idle');
  assert.equal(h.stateSchema(), schema('music-capture-state', '2.1'));
  assert.equal(h.work.length, 0);
  const changed = await h.enable('another-mic');
  assert.equal(changed.status, 'rejected');
  const absent = await h.control('wrong-mic', initial.revision, 'start', {input: 'microphone', microphoneId: 'another-mic'});
  assert.ok('error' in absent);assert.equal(absent.error.code, 'unsupported-capability');
  assert.equal(h.work.length, 0);
  const selection = {input: 'microphone', microphoneId: 'studio-mic'} as const;
  assert.deepEqual(await h.control('start-mic', (await h.read()).revision, 'start', selection), {status: 'accepted', requestId: 'start-mic'});
  await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start?.data.action === 'start');
  assert.equal(start.dataschema, schema('music-capture-work', '2.1'));
  assert.ok(start.data.input === 'microphone');assert.equal(start.data.microphoneId, 'studio-mic');
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await waitFor(() => h.operation('start-mic')?.result === 'succeeded');
  await h.frame(start.data.generation, 1);
  await h.frame(start.data.generation, 2, {...selection, microphoneId: 'another-mic'});
  assert.equal((await h.read()).session.status, 'stale');
  await h.frame(start.data.generation, 3, selection);
  await waitFor(async () => (await h.read()).session.status === 'active');
  await h.control('stop-mic', (await h.read()).revision, 'stop');
  await waitFor(() => h.work.length === 2);
  const stop = h.work[1];assert.ok(stop?.data.action === 'stop');
  assert.equal(stop.dataschema, schema('music-capture-work'));
  const stopping = (await h.read()).session;assert.ok(stopping.status === 'stopping' && stopping.input === 'microphone');
  assert.equal(stopping.microphoneId, 'studio-mic');
  await h.progress({operationId: stop.data.operationId, generation: stop.data.generation, status: 'stopped'});
  await waitFor(async () => (await h.read()).session.status === 'idle');
  await h.frame(start.data.generation, 4, selection);
  assert.equal((await h.read()).session.status, 'idle');
  await h.endpoint.close();
  await waitFor(async () => (await h.read()).availability === 'unavailable');
  assert.equal((await h.read()).microphone, undefined);
});

it('registration never captures; explicit start and stop have observed outcomes and fence delayed frames', async t => {
  const h = await setup(t);
  assert.equal((await h.read()).session.status, 'idle');
  assert.equal((await h.enable()).status, 'accepted');
  assert.equal(h.work.length, 0);
  const initial = await h.read();assert.equal(initial.availability, 'available');
  assert.deepEqual(await h.control('start-one', initial.revision, 'start'), {status: 'accepted', requestId: 'start-one'});
  await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start?.data.action === 'start');
  assert.equal((await h.read()).session.status, 'starting');assert.notEqual(h.operation('start-one')?.result, 'succeeded');
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await waitFor(() => h.operation('start-one')?.result === 'succeeded');
  await h.frame(start.data.generation, 1);
  await waitFor(async () => (await h.read()).session.status === 'active');
  const active = await h.read();
  assert.deepEqual(await h.control('stop-one', active.revision, 'stop'), {status: 'accepted', requestId: 'stop-one'});
  await waitFor(() => h.work.length === 2);
  const stop = h.work[1];assert.ok(stop?.data.action === 'stop');
  assert.equal(stop.data.generation, start.data.generation);
  await h.frame(start.data.generation, 2);
  assert.equal((await h.read()).session.status, 'stopping');
  await h.progress({operationId: stop.data.operationId, generation: stop.data.generation, status: 'stopped'});
  await waitFor(() => h.operation('stop-one')?.result === 'succeeded');
  assert.equal((await h.read()).session.status, 'idle');
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 3);
  assert.equal((await h.read()).session.status, 'idle');
  assert.equal(h.work.length, 2);
});

it('silence is live, expired and reversed frames do not refresh it, and a disconnect retires capture', async t => {
  const h = await setup(t);await h.enable();
  await h.control('freshness-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 10);
  await waitFor(async () => (await h.read()).session.status === 'active');
  await waitFor(async () => (await h.read()).session.status === 'stale', 2500);
  await h.frame(start.data.generation, 9);
  const old = Date.now() - 1000;
  await h.frame(start.data.generation, 11, {observedAtMs: old, validUntilMs: old + 400});
  assert.equal((await h.read()).session.status, 'stale');
  await h.frame(start.data.generation, 12);
  await waitFor(async () => (await h.read()).session.status === 'active');
  await h.endpoint.close();
  await waitFor(async () => (await h.read()).availability === 'unavailable');
  assert.equal((await h.read()).session.status, 'unavailable');
  assert.equal(h.operation('freshness-start')?.result, 'succeeded', 'later source loss cannot rewrite an observed start');
});

it('restart retires a pending generation and resolves responsibility without replay', async t => {
  const directory = await stateDir(t), first = await setup(t, directory);
  await first.enable();await first.control('pending-start', (await first.read()).revision, 'start');
  await waitFor(() => first.work.length === 1);
  await first.runtime.stop();await first.producer.close();
  const second = await setup(t, directory);
  assert.equal((await second.read()).availability, 'unavailable');
  assert.equal((await second.read()).session.status, 'unavailable');
  assert.equal(second.operation('pending-start')?.result, 'uncertain');
  await second.enable();assert.equal(second.work.length, 0);
});


it('late definitive progress settles uncertainty without restoring the retired generation', async t => {
  const h = await setup(t);await h.enable();
  await h.control('uncertain-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'uncertain', error: {code: 'uncertain-result', retryable: false}});
  await waitFor(() => h.operation('uncertain-start')?.result === 'uncertain');
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await waitFor(() => h.operation('uncertain-start')?.result === 'succeeded');
  await h.frame(start.data.generation, 1);
  assert.equal((await h.read()).session.status, 'uncertain');
  assert.equal(h.work.length, 1, 'nothing replays the start');
  const outcomes = h.operation('uncertain-start')?.outcomes;
  assert.deepEqual(outcomes?.map(outcome => outcome.result), ['uncertain', 'succeeded']);
});

it('a refused durable admission sends no capture work and bounded recovery never starts it', async t => {
  const h = await setup(t);await h.enable();const initial = await h.read();
  await h.failWrites(true);
  const refused = await h.control('unsaved-start', initial.revision, 'start');
  assert.ok('error' in refused);assert.equal(refused.error.code, 'internal');
  assert.equal(h.work.length, 0);
  await h.failWrites(false);
  await waitFor(async () => {
    try {return (await h.read()).availability === 'unavailable';} catch {return false;}
  }, 4000).catch(() => {assert.fail(JSON.stringify(h.runtime.health()));});
  assert.equal(h.work.length, 0);
  assert.equal(h.operation('unsaved-start')?.result, 'failed');
  assert.equal((await h.read()).session.status, 'idle');assert.equal(h.work.length, 0);
  await assert.rejects(async () => h.enable(), 'the retired endpoint cannot resume after storage recovery');
});

it('a wall-clock jump retires capture and fresh-looking frames cannot restore it', async t => {
  const h = await setup(t);await h.enable();
  await h.control('clock-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 1);await waitFor(async () => (await h.read()).session.status === 'active');
  h.wallOffset(100);
  await waitFor(async () => (await h.read()).availability === 'unavailable');
  h.wallOffset(0);await assert.rejects(async () => h.frame(start.data.generation, 2));
  assert.equal((await h.read()).session.status, 'unavailable');
  assert.equal(h.operation('clock-start')?.result, 'succeeded');
});


it('a superseded start deadline cannot fence a later active generation', async t => {
  const h = await setup(t);await h.enable();
  await h.control('superseded-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const first = h.work[0];assert.ok(first);
  await h.control('superseded-stop', (await h.read()).revision, 'stop');await waitFor(() => h.work.length === 2);
  const stop = h.work[1];assert.ok(stop);
  await h.progress({operationId: stop.data.operationId, generation: stop.data.generation, status: 'stopped'});
  await waitFor(() => h.operation('superseded-stop')?.result === 'succeeded');
  await h.control('replacement-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 3);
  const replacement = h.work[2];assert.ok(replacement);
  await h.progress({operationId: replacement.data.operationId, generation: replacement.data.generation, status: 'started'});
  for (let sequence = 1; sequence <= 120; sequence++) {
    await h.frame(replacement.data.generation, sequence);
    if (h.operation('superseded-start')?.result === 'uncertain') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(h.operation('superseded-start')?.result, 'uncertain');
  await h.frame(replacement.data.generation, 121);
  await waitFor(async () => (await h.read()).session.status === 'active');
  assert.equal(h.work.length, 3, 'old uncertainty sends no new work');
  const current = await h.read();assert.ok(current.session.status !== 'idle');
  assert.equal(current.session.generation, replacement.data.generation);
});


it('a failed feature-history commit disconnects capture even while current measurements are fresh', async t => {
  const h = await setup(t);await h.enable();
  await h.control('history-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 1);await waitFor(async () => (await h.read()).session.status === 'active');
  await h.failHistory(true);await h.frame(start.data.generation, 2);
  await waitFor(() => h.closed() === 1);
  assert.equal(h.runtime.health().modules.find(module => module.name === 'core')?.state, 'running');
  await h.failHistory(false);
  await waitFor(async () => {try {return (await h.read()).availability === 'unavailable';} catch {return false;}}, 4000);
  await assert.rejects(async () => h.frame(start.data.generation, 3));
  assert.equal(h.operation('history-start')?.result, 'succeeded');
});


it('a refused stop disconnects the producer because refusal does not stop an existing capture', async t => {
  const h = await setup(t);await h.enable();
  await h.control('stop-refusal-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 1);await waitFor(async () => (await h.read()).session.status === 'active');
  h.refuseStop();await h.control('refused-stop', (await h.read()).revision, 'stop');
  await waitFor(() => h.closed() === 1 && h.operation('refused-stop')?.result === 'failed');
  assert.equal(h.operation('stop-refusal-start')?.result, 'succeeded');
  await waitFor(async () => (await h.read()).availability === 'unavailable');
});


for (const status of ['failed', 'uncertain'] as const) it(`a ${status} stop report retires its connection without rewriting the start`, async t => {
  const h = await setup(t);await h.enable();
  await h.control('reported-stop-start', (await h.read()).revision, 'start');await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
  await h.frame(start.data.generation, 1);await waitFor(async () => (await h.read()).session.status === 'active');
  await h.control('reported-stop', (await h.read()).revision, 'stop');await waitFor(() => h.work.length === 2);
  const stop = h.work[1];assert.ok(stop);
  await h.progress({operationId: stop.data.operationId, generation: stop.data.generation, status,
    error: {code: 'uncertain-result', retryable: false}});
  await waitFor(() => h.closed() === 1 && h.operation('reported-stop')?.result === status);
  assert.equal(h.operation('reported-stop-start')?.result, 'succeeded');
});

it('a core clock jump after registration refuses start before any capture work', async t => {
  const h = await setup(t);await h.enable();const initial = await h.read();
  h.wallOffset(-250);
  const answer = await h.control('idle-clock-start', initial.revision, 'start');
  assert.ok('error' in answer, 'registration clock qualification must survive the idle interval');
  assert.equal(answer.error.code, 'unavailable');
  assert.equal(h.work.length, 0);
  await waitFor(() => h.closed() === 1);
  h.wallOffset(0);
});


it('a full disk during capture table creation keeps the core running and recovers without restart', async t => {
  const core = createCoreModule(), start = core.start.bind(core);
  let database: DatabaseSync | undefined, injected = false;
  core.start = context => {
    const db = context.database(), exec = db.exec.bind(db);
    database = db;
    db.exec = sql => {
      if (!injected && sql.startsWith('CREATE TABLE IF NOT EXISTS music_capture ')) {
        injected = true;
        const pages = db.prepare('PRAGMA page_count').get()?.page_count;
        assert.equal(typeof pages, 'number');
        exec(`PRAGMA max_page_count = ${String(pages)}`);
      }
      return exec(sql);
    };
    return start(context);
  };
  const observer = fixture('capture-recovery-observer');
  const {runtime, logs} = await run(t, {modules: [core, observer]});
  assert.equal(injected, true);
  assert.equal(runtime.health().modules.find(module => module.name === 'core')?.state, 'running');
  const sdk = contextOf(observer).sdk;
  const refused = await sdk.sync(['music-capture-state'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
  assert.equal(refused.status, 'rejected');
  assert.ok(database);
  database.exec('PRAGMA max_page_count = 1073741823');
  await waitFor(async () => {
    const synced = await sdk.sync<CaptureState>(['music-capture-state'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
    if (synced.status !== 'synced') return false;
    assert.equal(synced.copy.states()[0]?.data.availability, 'off');
    assert.deepEqual(synced.copy.states()[0]?.data.session, {status: 'idle'});
    await synced.copy.close();return true;
  }, 5000, 'the capture state after storage recovery');
  const {key, draft} = observation(sessionStarted, Date.now());
  await sdk.publish(key, draft);
  await waitFor(() => logs.some(record => record.event_name === 'message.received' && record.attributes['bunny.participant'] === 'bunny/modules/capture-recovery-observer' && record.attributes['bunny.outcome'] === 'accepted'));
  assert.equal(runtime.health().modules.find(module => module.name === 'core')?.state, 'running');
});
