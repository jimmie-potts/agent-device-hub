import assert from 'node:assert/strict';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {TestContext} from 'node:test';
import type {DatabaseSync} from 'node:sqlite';
import {observation, sessionStarted} from './fixtures/agents.js';
import {CAPTURE_MAX_CLOCK_SKEW_MS, CAPTURE_WINDOW_MS, MUSIC_PRODUCER_SOURCE, type CaptureResponseSettings, type CaptureFeatures, type CaptureProgress, type CaptureSelection, type CaptureState, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
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
  const liveStates: Message<CaptureState>[] = [];
  await contextOf(observer).sdk.subscribe<CaptureState>('bunny.state.music-capture-state.music', message => {liveStates.push(message);});
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
  const tune = (requestId: string, data: object) => core.operatorActions.dispatch({key: 'bunny.cmd.music-capture-control.music', requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: 'org.bunny.music-capture.control.requested', subject: 'music', dataschema: schema('music-capture-control', '2.2'), data}});
  return {core, runtime, producer, observer, endpoint, work, liveStates, tune, legacyResponsibilities: async () => {
    assert.ok(handle);await handle.transaction(tx => {tx.database.exec("UPDATE music_capture_responsibilities SET record = json_remove(record, '$.selection')");});
  }, stateSchema: () => stateSchema, closed: () => closed, refuseStop: () => {refuseStop = true;}, read, enable, control, progress, frame, operation: (id: string) => handle?.operation(id), failWrites: async (value: boolean) => {
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
  assert.equal(h.stateSchema(), schema('music-capture-state', '2.2'));
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
  await waitFor(() => h.liveStates.some(message => message.data.availability === 'unavailable'));
  assert.ok(h.liveStates.length > 0);
  assert.deepEqual([...new Set(h.liveStates.map(message => message.dataschema))], [schema('music-capture-state', '2.2')]);
  assert.deepEqual([...new Set(h.liveStates.map(message => message.subject))], ['music']);
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

for (const input of ['music', 'microphone'] as const) it(`restart retires pending ${input} without replay, including old Music records`, async t => {
  const directory = await stateDir(t), first = await setup(t, directory);
  const selection: CaptureSelection = input === 'music' ? {input} : {input, microphoneId: 'studio-mic'};
  await first.enable(input === 'music' ? undefined : 'studio-mic');
  await first.control('pending-start', (await first.read()).revision, 'start', selection);
  await waitFor(() => first.work.length === 1);
  if (input === 'music') await first.legacyResponsibilities();
  await first.runtime.stop();await first.producer.close();
  const second = await setup(t, directory), recovered = await second.read();
  assert.equal(recovered.availability, 'unavailable');
  assert.ok(recovered.session.status === 'unavailable');
  assert.equal(recovered.session.input, input);
  if (recovered.session.input === 'microphone') assert.equal(recovered.session.microphoneId, 'studio-mic');
  assert.equal(recovered.microphone, undefined);
  assert.equal(second.stateSchema(), schema('music-capture-state', '2.2'));
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


async function activeMicrophone(h: Awaited<ReturnType<typeof setup>>, name: string) {
  await h.enable('studio-mic');
  const selection = {input: 'microphone', microphoneId: 'studio-mic'} as const;
  await h.control(name, (await h.read()).revision, 'start', selection);await waitFor(() => h.work.length === 1);
  const start = h.work[0];assert.ok(start);
  await h.progress({operationId: name, generation: start.data.generation, status: 'started'});
  const first = {sequence: 1, observedAtMs: Date.now()};
  await h.frame(start.data.generation, 1, {...selection, observedAtMs: first.observedAtMs, validUntilMs: first.observedAtMs + 400});
  await waitFor(async () => (await h.read()).session.status === 'active');
  const binding = {endpointId: h.endpoint.id, generation: start.data.generation, microphoneId: 'studio-mic', sampleRateHz: 48000, channels: 2};
  return {binding, selection, first};
}
type GridFrame = {sequence: number; observedAtMs: number};
/**
 * Keeps a microphone source fresh after `first`, one frame per 100 ms on the source's own timeline, as a capture helper
 * does (#1545). Each frame's wall time matches its source time, so a slow runner cannot age the source past its 400 ms
 * validity, or make it look incoherent, while a test waits for an admission. `until` stops the feed after the frame that
 * satisfies it. `stop` keeps feeding until the next frame's time is at least `notBeforeMs`, then returns that next grid
 * slot for the test's own frame, waiting until its time has come unless `wait` is false.
 */
function feedSource(t: TestContext, h: Awaited<ReturnType<typeof setup>>, generation: string, selection: CaptureSelection, first: GridFrame,
  {patch = {}, until}: {patch?: Partial<CaptureFeatures>; until?: () => Promise<boolean>} = {}) {
  const at = (sequence: number): number => first.observedAtMs + (sequence - first.sequence) * 100;
  let next = first.sequence + 1, stopped = false, failure: Error | undefined, sending: Promise<void> = Promise.resolve();
  const send = async (): Promise<void> => {
    while (!stopped && at(next) <= Date.now()) {
      const sequence = next++;
      await h.frame(generation, sequence, {...selection, ...patch, observedAtMs: at(sequence), validUntilMs: at(sequence) + 400});
      if (until !== undefined && await until()) stopped = true;
    }
  };
  const timer = setInterval(() => {sending = sending.then(send).catch((error: unknown) => {failure ??= error instanceof Error ? error : new Error('the feed could not publish a frame', {cause: error});stopped = true;});}, 20);
  const stop = async ({notBeforeMs = 0, wait = true}: {notBeforeMs?: number; wait?: boolean} = {}): Promise<GridFrame> => {
    while (!stopped && at(next) < notBeforeMs) await new Promise(resolve => setTimeout(resolve, 10));
    stopped = true;clearInterval(timer);await sending;
    if (failure !== undefined) throw failure;
    if (wait) await new Promise(resolve => setTimeout(resolve, Math.max(0, at(next) - Date.now())));
    return {sequence: next, observedAtMs: at(next)};
  };
  t.after(async () => {stopped = true;clearInterval(timer);await sending;});
  return {stop, stopped: () => stopped};
}
/** A quiet measurement admits only frames observed after its window: one window plus the skew bound after admission. */
const QUIET_WINDOW_OPENS_MS = CAPTURE_WINDOW_MS + CAPTURE_MAX_CLOCK_SKEW_MS + 1;
const manualSettings: CaptureResponseSettings = {sensitivity: 2, smoothingMs: 150, emphasis: {bass: 2, mid: 1, treble: 0.5}, gate: {mode: 'manual', threshold: 0.02}};

it('response Apply is atomic and revision-bound; calibration Cancel and Stop remain independent', async t => {
  const h = await setup(t), {binding} = await activeMicrophone(h, 'tuning-start');
  const initial = await h.read();assert.ok(initial.response);
  const apply = await h.tune('apply-manual', {action: 'apply-tuning', binding, expectedRevision: initial.revision, expectedSettingsRevision: initial.response.settingsRevision, settings: manualSettings});
  assert.deepEqual(apply, {status: 'accepted', requestId: 'apply-manual'});
  await waitFor(() => h.operation('apply-manual')?.result === 'succeeded');
  const saved = await h.read();assert.deepEqual(saved.response?.settings, manualSettings);assert.deepEqual(saved.response?.appliedTo, binding);
  const conflict = await h.tune('conflicting-settings', {action: 'apply-tuning', binding, expectedRevision: saved.revision, expectedSettingsRevision: 0, settings: {...manualSettings, sensitivity: 3}});
  assert.ok('error' in conflict);assert.equal(conflict.error.code, 'revision-conflict');
  assert.deepEqual((await h.read()).response?.settings, manualSettings);
  const wrongBinding = await h.tune('wrong-calibration-binding', {action: 'calibrate', expectedRevision: saved.revision, binding: {...binding, microphoneId: 'other'}});
  assert.ok('error' in wrongBinding);assert.equal(wrongBinding.error.code, 'revision-conflict');
  await h.tune('quiet-cancel', {action: 'calibrate', binding, expectedRevision: saved.revision});
  const measuring = await h.read();assert.equal(measuring.response?.calibration.status, 'measuring');
  assert.notEqual(h.operation('quiet-cancel')?.result, 'succeeded');
  await h.progress({operationId: 'quiet-cancel', generation: binding.generation, status: 'started'});
  assert.equal((await h.read()).response?.calibration.status, 'measuring', 'producer progress cannot settle core-only measurement');
  assert.notEqual(h.operation('quiet-cancel')?.result, 'succeeded');
  await h.tune('cancel-quiet', {action: 'cancel-calibration', binding, operationId: 'quiet-cancel', expectedRevision: measuring.revision});
  await waitFor(() => h.operation('cancel-quiet')?.result === 'succeeded');
  assert.equal(h.operation('quiet-cancel')?.result, 'failed');
  assert.deepEqual((await h.read()).response?.settings, manualSettings);
  assert.deepEqual((await h.read()).response?.appliedTo, binding, 'cancel does not retire applied settings or capture');
  assert.equal(h.work.length, 1, 'tuning commands send no producer work');
  await h.tune('quiet-stop', {action: 'calibrate', binding, expectedRevision: (await h.read()).revision});
  await h.control('independent-stop', (await h.read()).revision, 'stop');
  await waitFor(() => h.work.length === 2);
  assert.equal(h.operation('quiet-stop')?.result, 'failed');
  assert.equal((await h.read()).response?.appliedTo, null);
  const stop = h.work[1];assert.ok(stop);
  await h.progress({operationId: stop.data.operationId, generation: stop.data.generation, status: 'stopped'});
});

async function completeQuiet(t: TestContext, h: Awaited<ReturnType<typeof setup>>, active: Awaited<ReturnType<typeof activeMicrophone>>, requestId: string) {
  const {binding, selection, first} = active;
  const settled = async (): Promise<boolean> => ['ready', 'ended'].includes((await h.read()).response?.calibration.status ?? '');
  const source = feedSource(t, h, binding.generation, selection, first, {patch: {rms: 0.01, peak: 0.02}, until: settled});
  await h.tune(requestId, {action: 'calibrate', binding, expectedRevision: (await h.read()).revision});
  await waitFor(() => source.stopped(), 15_000, 'a settled quiet measurement');
  // The caller's next frame follows the ready frame at once, so nothing waits for the next grid slot here.
  const next = await source.stop({wait: false});
  assert.deepEqual((await h.read()).response?.calibration, {status: 'ready', operationId: requestId}, 'the quiet measurement ended before it was ready');
  await waitFor(() => h.operation(requestId)?.result === 'succeeded');
  return {state: await h.read(), sequence: next.sequence - 1};
}

it('a completed quiet interval is a candidate until Apply and restart retains evidence without qualification', async t => {
  const directory = await stateDir(t), h = await setup(t, directory), active = await activeMicrophone(h, 'quiet-start'), {binding} = active;
  const {state: candidate} = await completeQuiet(t, h, active, 'quiet-complete');assert.ok(candidate.response?.evidence);
  assert.equal(candidate.response.evidence.windowCount, 50);assert.equal(candidate.response.evidence.percentileRms, 0.01);
  assert.equal(candidate.response.evidence.suggestedThreshold, 0.02);assert.equal(candidate.response.settings.gate.mode, 'off');
  assert.equal(candidate.response.appliedTo, null);
  const settings: CaptureResponseSettings = {...manualSettings, gate: {mode: 'calibrated', threshold: 0.025, calibrationId: 'quiet-complete'}};
  await h.tune('apply-measured', {action: 'apply-tuning', binding, expectedRevision: candidate.revision, expectedSettingsRevision: candidate.response.settingsRevision, settings});
  await waitFor(() => h.operation('apply-measured')?.result === 'succeeded');
  assert.deepEqual((await h.read()).response?.settings, settings);
  await h.runtime.stop();await h.producer.close();
  const recovered = await setup(t, directory), state = await recovered.read();
  assert.deepEqual(state.response?.settings, settings);assert.deepEqual(state.response?.evidence, candidate.response.evidence);
  assert.equal(state.response?.appliedTo, null);assert.equal(state.response?.calibration.status, 'ended');
  assert.equal(recovered.operation('quiet-complete')?.result, 'succeeded');assert.equal(recovered.work.length, 0);
});

it('clipping fails quiet measurement and a later source discontinuity retires a manually applied gate', async t => {
  const h = await setup(t), {binding, selection, first} = await activeMicrophone(h, 'quiet-failure-start');
  const source = feedSource(t, h, binding.generation, selection, first);
  await h.tune('clipped-quiet', {action: 'calibrate', binding, expectedRevision: (await h.read()).revision});
  const clipped = await source.stop({notBeforeMs: Date.now() + QUIET_WINDOW_OPENS_MS});
  await h.frame(binding.generation, clipped.sequence, {...selection, clippedFraction: 0.001, observedAtMs: clipped.observedAtMs, validUntilMs: clipped.observedAtMs + 400});
  await waitFor(() => h.operation('clipped-quiet')?.result === 'failed');
  assert.deepEqual((await h.read()).response?.calibration, {status: 'ended', operationId: 'clipped-quiet', reason: 'clipping'});
  const after = feedSource(t, h, binding.generation, selection, clipped);
  const current = await h.read();assert.ok(current.response);
  await h.tune('manual-after-clipping', {action: 'apply-tuning', binding, expectedRevision: current.revision, expectedSettingsRevision: current.response.settingsRevision, settings: manualSettings});
  await waitFor(() => h.operation('manual-after-clipping')?.result === 'succeeded');
  const broken = await after.stop();
  assert.deepEqual((await h.read()).response?.appliedTo, binding, 'the manual gate is bound until the discontinuity');
  await h.frame(binding.generation, broken.sequence, {...selection, discontinuity: true, observedAtMs: broken.observedAtMs, validUntilMs: broken.observedAtMs + 400});
  await waitFor(async () => (await h.read()).response?.appliedTo === null);
  assert.deepEqual((await h.read()).response?.settings, manualSettings);
});

it('incoherent source and wall elapsed fail calibration and retire the applied gate without replacing preferences', async t => {
  const h = await setup(t), {binding, selection, first} = await activeMicrophone(h, 'clock-evidence-start');
  const source = feedSource(t, h, binding.generation, selection, first);
  const before = await h.read();assert.ok(before.response);
  await h.tune('clock-evidence-apply', {action: 'apply-tuning', binding, expectedRevision: before.revision,
    expectedSettingsRevision: before.response.settingsRevision, settings: manualSettings});
  await h.tune('clock-evidence-measure', {action: 'calibrate', binding, expectedRevision: (await h.read()).revision});
  // Two frames 100 ms apart in source time but observed at the same wall time, both inside the measurement window.
  const next = await source.stop({notBeforeMs: Date.now() + QUIET_WINDOW_OPENS_MS}), patch = {...selection, observedAtMs: next.observedAtMs, validUntilMs: next.observedAtMs + 400};
  await h.frame(binding.generation, next.sequence, patch);await h.frame(binding.generation, next.sequence + 1, patch);
  await waitFor(() => h.operation('clock-evidence-measure')?.result === 'failed');
  const state = await h.read();
  assert.deepEqual(state.response?.calibration, {status: 'ended', operationId: 'clock-evidence-measure', reason: 'clock'});
  assert.equal(state.response?.evidence, null);assert.deepEqual(state.response?.settings, manualSettings);
  assert.equal(state.response?.appliedTo, null);assert.equal(h.work.length, 1);
});

it('an applied gate without a measurement retires on incoherent clocks and requires explicit reapply', async t => {
  const h = await setup(t), {binding, selection} = await activeMicrophone(h, 'ordinary-clock-start');
  const before = await h.read();assert.ok(before.response);
  await h.tune('ordinary-clock-apply', {action: 'apply-tuning', binding, expectedRevision: before.revision,
    expectedSettingsRevision: before.response.settingsRevision, settings: manualSettings});
  const observedAtMs = Date.now();
  for (let sequence = 2; sequence <= 5; sequence++) await h.frame(binding.generation, sequence, {...selection, observedAtMs, validUntilMs: observedAtMs + 400});
  const retired = await h.read();assert.equal(retired.session.status, 'active');
  assert.equal(retired.response?.calibration.status, 'idle');assert.equal(retired.response?.appliedTo, null);
  assert.deepEqual(retired.response?.settings, manualSettings);
  const reappliedAt = Date.now();
  await h.frame(binding.generation, 6, {...selection, observedAtMs: reappliedAt, validUntilMs: reappliedAt + 400});
  const inactive = await h.read();assert.ok(inactive.response);assert.equal(inactive.response.appliedTo, null);
  await h.tune('ordinary-clock-reapply', {action: 'apply-tuning', binding, expectedRevision: inactive.revision,
    expectedSettingsRevision: inactive.response.settingsRevision, settings: manualSettings});
  assert.deepEqual((await h.read()).response?.appliedTo, binding);
  const nextAt = reappliedAt + 100;await new Promise(resolve => setTimeout(resolve, Math.max(0, nextAt - Date.now())));
  await h.frame(binding.generation, 7, {...selection, observedAtMs: nextAt, validUntilMs: nextAt + 400});
  assert.deepEqual((await h.read()).response?.appliedTo, binding);
  assert.equal(h.work.length, 1);
});

it('a ready candidate keeps its timing guard and loses eligibility on later clock drift', async t => {
  const h = await setup(t), active = await activeMicrophone(h, 'candidate-clock-start');
  const {state: candidate, sequence} = await completeQuiet(t, h, active, 'candidate-clock-measure');
  assert.ok(candidate.response?.evidence);
  const observedAtMs = candidate.response.evidence.endedAtMs;
  await h.frame(active.binding.generation, sequence + 1, {...active.selection, observedAtMs, validUntilMs: observedAtMs + 400});
  await waitFor(async () => (await h.read()).response?.calibration.status === 'ended');
  const retired = await h.read();assert.equal(retired.session.status, 'active');assert.ok(retired.response);
  assert.deepEqual(retired.response.calibration, {status: 'ended', operationId: 'candidate-clock-measure', reason: 'clock'});
  assert.deepEqual(retired.response.evidence, candidate.response.evidence);assert.equal(retired.response.appliedTo, null);
  assert.equal(h.operation('candidate-clock-measure')?.result, 'succeeded', 'later loss preserves the completed measurement outcome');
  const refused = await h.tune('candidate-clock-reuse', {action: 'apply-tuning', binding: active.binding, expectedRevision: retired.revision,
    expectedSettingsRevision: retired.response.settingsRevision, settings: {...manualSettings, gate: {mode: 'calibrated', threshold: 0.02, calibrationId: 'candidate-clock-measure'}}});
  assert.ok('error' in refused);assert.equal(refused.error.code, 'invalid-state');assert.equal(h.work.length, 1);
});

it('a refused clock-retirement write disconnects capture and recovery keeps settings inactive', async t => {
  const h = await setup(t), {binding, selection} = await activeMicrophone(h, 'clock-store-start');
  const before = await h.read();assert.ok(before.response);
  await h.tune('clock-store-apply', {action: 'apply-tuning', binding, expectedRevision: before.revision,
    expectedSettingsRevision: before.response.settingsRevision, settings: manualSettings});
  await h.failWrites(true);
  const observedAtMs = Date.now();
  for (let sequence = 2; sequence <= 3; sequence++) await h.frame(binding.generation, sequence, {...selection, observedAtMs, validUntilMs: observedAtMs + 400}).catch(() => {});
  await waitFor(() => h.closed() > 0);await h.failWrites(false);
  await waitFor(async () => {try {return (await h.read()).availability === 'unavailable';} catch {return false;}}, 4000);
  const recovered = await h.read();assert.deepEqual(recovered.response?.settings, manualSettings);
  assert.equal(recovered.response?.appliedTo, null);assert.equal(h.work.length, 1);
});

it('restart settles unfinished calibration and refuses later reuse of its candidate', async t => {
  const directory = await stateDir(t), first = await setup(t, directory), {binding} = await activeMicrophone(first, 'restart-calibration-start');
  await first.tune('interrupted-quiet', {action: 'calibrate', binding, expectedRevision: (await first.read()).revision});
  await first.runtime.stop();await first.producer.close();
  const second = await setup(t, directory), recovered = await second.read();
  assert.equal(second.operation('interrupted-quiet')?.result, 'uncertain');
  assert.deepEqual(recovered.response?.calibration, {status: 'ended', operationId: 'interrupted-quiet', reason: 'restart'});
  assert.equal(recovered.response?.evidence, null);assert.equal(second.work.length, 0);
  const fresh = await activeMicrophone(second, 'restart-new-generation');
  const current = await second.read();assert.ok(current.response);
  const refused = await second.tune('reuse-interrupted', {action: 'apply-tuning', binding: fresh.binding, expectedRevision: current.revision,
    expectedSettingsRevision: current.response.settingsRevision, settings: {...manualSettings, gate: {mode: 'calibrated', threshold: 0.02, calibrationId: 'interrupted-quiet'}}});
  assert.ok('error' in refused);assert.equal(refused.error.code, 'invalid-state');
});

it('a refused tuning write leaves prior preferences intact and storage recovery retires the binding', async t => {
  const h = await setup(t), {binding} = await activeMicrophone(h, 'tuning-storage-start');
  const current = await h.read();assert.ok(current.response);await h.failWrites(true);
  const refused = await h.tune('unsaved-tuning', {action: 'apply-tuning', binding, expectedRevision: current.revision,
    expectedSettingsRevision: current.response.settingsRevision, settings: manualSettings});
  assert.ok('error' in refused);assert.equal(refused.error.code, 'internal');await h.failWrites(false);
  await waitFor(async () => {try {return (await h.read()).availability === 'unavailable';} catch {return false;}}, 4000);
  assert.deepEqual((await h.read()).response?.settings, current.response.settings);assert.equal((await h.read()).response?.appliedTo, null);
  assert.equal(h.work.length, 1);assert.equal(h.operation('unsaved-tuning')?.result, 'failed');
});

for (const interruption of ['format', 'stale', 'clock', 'source-lost'] as const) it(`calibration and an applied gate retire together on ${interruption}`, async t => {
  const h = await setup(t), {binding, selection} = await activeMicrophone(h, `retire-${interruption}`);
  const current = await h.read();assert.ok(current.response);
  await h.tune(`apply-${interruption}`, {action: 'apply-tuning', binding, expectedRevision: current.revision,
    expectedSettingsRevision: current.response.settingsRevision, settings: manualSettings});
  await h.tune(`measure-${interruption}`, {action: 'calibrate', binding, expectedRevision: (await h.read()).revision});
  if (interruption === 'format') await h.frame(binding.generation, 2, {...selection, sampleRateHz: 44100, frameCount: 4410});
  else if (interruption === 'clock') h.wallOffset(1000);
  else if (interruption === 'source-lost') await h.endpoint.close();
  await waitFor(async () => (await h.read()).response?.appliedTo === null, 2500);
  const retired = await h.read();assert.deepEqual(retired.response?.settings, manualSettings);
  assert.equal(retired.response?.calibration.status, 'ended');
  assert.notEqual(h.operation(`measure-${interruption}`)?.result, 'succeeded');
  assert.equal(h.work.length, 1, 'retirement never dispatches more source work');
});
