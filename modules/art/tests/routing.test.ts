import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import {errorBody, type ErrorBody, type ErrorDetail} from '@jimmie-potts/event-contracts/v2';
import type {ArtDispatch} from '@jimmie-potts/event-contracts/v2/art';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {InProcessBus, SdkError, type ModuleScheduler, type Participant, type Snapshot, type TraceContext} from '@jimmie-potts/sdk';
import {realDispatch, realWeather, type ArtStageRequest, type StageResult} from '../src/seams.js';
import {artDevice, deviceDraft} from './device-fixtures.js';
import {gradientPng} from './fixtures.js';
import {gate, until} from './support.js';

const parent: TraceContext = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const flush = () => new Promise<void>(resolve => {setImmediate(resolve);});
async function world(t: TestContext) {
  const errors: unknown[] = [];
  const bus = new InProcessBus({maxQueued: 1, onError: error => {errors.push(error);}}), core = bus.connect('bunny/core'), sdk = bus.connect('bunny/modules/art');
  const schemas: string[] = [], forwarded: ArtDispatch[] = [], scheduled = new Set<() => void | Promise<void>>();
  const scheduler: ModuleScheduler = {after: (_delay, callback) => {scheduled.add(callback); return () => {scheduled.delete(callback);};}};
  await core.serveSync(['operation'], () => ({revision: 0, states: []}));
  await core.respond<ArtDispatch>('bunny.cmd.art-dispatch.art', command => {schemas.push(command.dataschema); forwarded.push(command.data); return {status: 'accepted'};});
  const dispatch = realDispatch({sdk, scheduler, signal: new AbortController().signal});
  let watches: Awaited<ReturnType<typeof dispatch.watch>> = [];
  const results: {requestId: string; result: StageResult; error?: ErrorDetail}[] = [];
  const start = async () => {watches = await dispatch.watch((requestId, result, error) => {results.push({requestId, result, ...(error === undefined ? {} : {error})});}); await flush();};
  const stop = async () => {for (const subscription of watches) await subscription.close(); watches = [];};
  t.after(async () => {await stop(); await sdk.close(); await core.close();
    assert.ok(errors.every(error => error instanceof SdkError && error.body.error.code === 'capacity'), 'only the deliberately induced SDK overflow is expected');
  });
  const owner = async (kind: 'pixoo' | 'tidbyt', records: DeviceRecord[], source = `bunny/modules/${kind}`) => {
    const participant = bus.connect(source);
    t.after(() => participant.close());
    let revision = Math.max(0, ...records.map(record => record.revision)), reads = 0;
    let answer: Promise<Snapshot | ErrorBody> | undefined;
    const snapshot = (): Snapshot => ({revision, states: records.map(deviceDraft)});
    await participant.serveSync(['device'], () => {reads += 1; return answer ?? snapshot();});
    return {
      get reads() {return reads;},
      set answer(value: Promise<Snapshot | ErrorBody> | undefined) {answer = value;},
      snapshot,
      replace: (values: DeviceRecord[], at: number) => {records = values; revision = at;},
      update: async (value: DeviceRecord) => {revision = value.revision; records = [...records.filter(record => record.id !== value.id), value]; await participant.publish(`bunny.state.device.${value.id}`, {kind: 'state', ...deviceDraft(value)});},
      remove: async (id: string) => {revision += 1; records = records.filter(record => record.id !== id); await participant.publish(`bunny.state.device.${id}`, {
        kind: 'removal', type: 'org.bunny.entity.removed', subject: id, dataschema: 'https://bunny.invalid/events/removal/2.0', data: {entity: {family: 'device', id}, revision, reason: 'retired'},
      });},
    };
  };
  const bytes = await gradientPng(64, 64);
  const stage = (target: 'pixoo' | 'tidbyt', extra: Partial<ArtStageRequest> = {}) => dispatch.stage({requestId: `stage-${forwarded.length}`, target,
    compositionId: 'synthetic-composition', format: 'png', width: 64, height: 64, frames: 1, durationMs: 0, sha256: createHash('sha256').update(bytes).digest('hex'), bytes, lifetimeMs: 60_000, ...extra}, parent);
  const ambient = () => dispatch.ambient({requestId: `ambient-${forwarded.length}`, target: 'tidbyt', compositionId: 'synthetic-composition'}, parent);
  return {owner, start, stop, stage, ambient, forwarded, schemas, scheduled, core, results, retry: async () => {const waiting = [...scheduled]; scheduled.clear(); for (const callback of waiting) await callback(); await flush();}};
}

void test('only a declared Pixoo receives extended staging; ordinary stages use the original contract', async t => {
  const w = await world(t);
  const extended = (kind: 'pixoo' | 'tidbyt', id: string, revision: number) => {
    const record = artDevice(kind, id, revision);
    const moments = record.capabilities.moments;
    assert.ok(moments.supported && moments.art);
    moments.art.stageVersion = '2.1';
    return record;
  };
  const pixoo = await w.owner('pixoo', [artDevice('pixoo', 'panel')]);
  await w.owner('tidbyt', [extended('tidbyt', 'tile', 1)]);
  await w.start();
  const extra = {format: 'gif' as const, durationMs: 10_010, frames: 1001};
  for (const kind of ['pixoo', 'tidbyt'] as const) {
    const denied = await w.stage(kind, extra);
    assert.equal('error' in denied && denied.error.code, 'unsupported-capability');
  }
  await pixoo.update(extended('pixoo', 'panel', 2));
  await flush();
  for (const frames of [8, 256, 257, 1001]) assert.deepEqual(await w.stage('pixoo', {...extra, frames}), {status: 'accepted'});
  assert.deepEqual(w.schemas.map(uri => uri.split('/').pop()), ['2.0', '2.0', '2.2', '2.2']);
});

void test('saved preparation refuses a changed or stale target identity and never falls back to the replacement display', async t => {
  const w = await world(t), owner = await w.owner('pixoo', [artDevice('pixoo', 'planned')]); await w.start();
  assert.deepEqual(await w.stage('pixoo', {expectedTargetId: 'planned'}), {status: 'accepted'});
  const replacement = gate<Snapshot | ErrorBody>(); owner.answer = replacement.promise;
  await Promise.all([owner.update(artDevice('pixoo', 'planned', 2)), owner.update(artDevice('pixoo', 'planned', 3))]);
  await until(() => owner.reads === 2);
  const stale = await w.stage('pixoo', {expectedTargetId: 'planned'});
  assert.equal('error' in stale && stale.error.code, 'unavailable');
  owner.replace([artDevice('pixoo', 'replacement', 4)], 4); replacement.open(owner.snapshot()); await flush();
  const changed = await w.stage('pixoo', {expectedTargetId: 'planned'});
  assert.equal('error' in changed && changed.error.code, 'invalid-state');
  assert.deepEqual(w.forwarded.map(item => item.target), ['planned']);
  assert.deepEqual(await w.stage('pixoo', {expectedTargetId: 'replacement'}), {status: 'accepted'});
});

void test('tracked staging errors retain their safe code and detail at the Art owner boundary', async t => {
  const w = await world(t); await w.start();
  const error = errorBody('unsupported-capability', {detail: 'synthetic display does not accept art'}).error;
  await w.core.publish('bunny.state.operation.operation-stage-test', {kind: 'state', type: 'org.bunny.operation.changed', subject: 'operation-stage-test',
    dataschema: 'https://bunny.invalid/events/operation/2.0', data: {id: 'operation-stage-test', revision: 1, requestId: 'stage-test', kind: 'device', family: 'art-stage',
      command: 'org.bunny.art.stage.requested', target: 'desk', requestedBy: 'bunny/modules/art', status: 'rejected', result: 'failed', evidence: 'none', error,
      sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 30_001}});
  await until(() => w.results.length === 1);
  assert.deepEqual(w.results, [{requestId: 'stage-test', result: 'failed', error}]);
});

void test('art stage and ambient route display kinds to the exact owners noncanonical device IDs', async t => {
  const w = await world(t);
  await w.owner('pixoo', [artDevice('pixoo', 'desk-pixoo-art')]);
  await w.owner('tidbyt', [{...artDevice('tidbyt', 'bedside-tronbyt'), availability: 'unavailable'}]);
  await w.start();
  assert.deepEqual(await w.stage('pixoo'), {status: 'accepted'});
  assert.deepEqual(await w.stage('tidbyt'), {status: 'accepted'});
  assert.deepEqual(await w.ambient(), {status: 'accepted'});
  assert.deepEqual(w.forwarded.map(value => [value.family, value.target]), [['art-stage', 'desk-pixoo-art'], ['art-stage', 'bedside-tronbyt'], ['art-ambient-set', 'bedside-tronbyt']]);
});

for (const [name, records, code] of [
  ['missing', [], 'unavailable'],
  ['wrong kind', [artDevice('tidbyt', 'wrong-kind')], 'unavailable'],
  ['ambiguous', [artDevice('pixoo', 'one'), artDevice('pixoo', 'two')], 'invalid-state'],
  ['no implemented art', [{...artDevice('pixoo', 'old-display'), capabilities: {...artDevice('pixoo', 'old-display').capabilities, moments: {supported: false}}}], 'unsupported-capability'],
] satisfies [string, DeviceRecord[], string][]) {
  void test(`routing refuses ${name} device evidence before forwarding`, async t => {
    const w = await world(t); await w.owner('pixoo', records); await w.start();
    const reply = await w.stage('pixoo');
    assert.equal('error' in reply ? reply.error.code : reply.status, code);
    assert.equal(w.forwarded.length, 0);
  });
}

void test('another owner cannot supply a missing Pixoo or Tidbyt identity', async t => {
  const w = await world(t);
  await w.owner('pixoo', [artDevice('pixoo', 'foreign-pixoo'), artDevice('tidbyt', 'foreign-tidbyt')], 'bunny/modules/other');
  await w.start();
  for (const reply of [await w.stage('pixoo'), await w.ambient()]) assert.equal('error' in reply && reply.error.code, 'unavailable');
  assert.equal(w.forwarded.length, 0);
});

void test('format and byte bounds come from the selected device art capability', async t => {
  const w = await world(t), device = artDevice('pixoo', 'limited');
  device.capabilities.moments = {supported: true, moods: [], maxDurationMs: 1000, coversStatus: false, art: {formats: ['gif'], maxBytes: 163_840}};
  const owner = await w.owner('pixoo', [device]); await w.start();
  assert.equal('error' in await w.stage('pixoo'), true);
  device.capabilities.moments.art = {formats: ['png'], maxBytes: 1};
  await owner.update({...device, revision: 2}); await flush();
  const tooLarge = await w.stage('pixoo');
  assert.equal('error' in tooLarge && tooLarge.error.code, 'unsupported-capability');
  assert.equal(w.forwarded.length, 0);
});

void test('removal withdraws a route and stale updates cannot restore it', async t => {
  const w = await world(t), owner = await w.owner('tidbyt', [artDevice('tidbyt', 'retired')]); await w.start();
  assert.deepEqual(await w.ambient(), {status: 'accepted'});
  await owner.remove('retired'); await flush();
  assert.equal('error' in await w.ambient(), true);
  await owner.update(artDevice('tidbyt', 'retired', 1)); await flush();
  assert.equal('error' in await w.ambient(), true);
  await owner.update(artDevice('tidbyt', 'replacement', 3)); await flush();
  assert.deepEqual(await w.ambient(), {status: 'accepted'});
  assert.deepEqual(w.forwarded.map(value => value.target), ['retired', 'replacement']);
});

void test('an SDK gap immediately blocks routing until replacement sync, and failed sync stays blocked', async t => {
  const w = await world(t), owner = await w.owner('pixoo', [artDevice('pixoo', 'old')]); await w.start();
  assert.deepEqual(await w.stage('pixoo'), {status: 'accepted'});
  const replacement = gate<Snapshot | ErrorBody>(); owner.answer = replacement.promise;
  await Promise.all([owner.update(artDevice('pixoo', 'old', 2)), owner.update(artDevice('pixoo', 'old', 3))]);
  await until(() => owner.reads === 2, 'SDK replacement sync');
  const stale = await w.stage('pixoo');
  assert.equal('error' in stale && stale.error.code, 'unavailable');
  assert.equal(w.forwarded.length, 1, 'the retained pre-gap ID cannot forward');
  owner.replace([artDevice('pixoo', 'new', 4)], 4); replacement.open(owner.snapshot()); await flush();
  assert.deepEqual(await w.stage('pixoo'), {status: 'accepted'});
  assert.equal(w.forwarded[1]?.target, 'new', 'full sync replaced old membership');

  owner.answer = Promise.resolve(errorBody('unavailable'));
  await Promise.all([owner.update(artDevice('pixoo', 'new', 5)), owner.update(artDevice('pixoo', 'new', 6))]);
  await until(() => owner.reads === 3, 'failed replacement sync'); await flush();
  assert.equal('error' in await w.stage('pixoo'), true);
  assert.equal(w.forwarded.length, 2);
  owner.answer = undefined;
  owner.replace([artDevice('pixoo', 'recovered', 7)], 7);
  await w.retry();
  assert.deepEqual(await w.stage('pixoo'), {status: 'accepted'});
  assert.equal(w.forwarded[2]?.target, 'recovered');
  await w.stop();
  await owner.update(artDevice('pixoo', 'after-stop', 8)); await flush();
  assert.equal('error' in await w.stage('pixoo'), true);
  assert.equal(w.forwarded.length, 3);
  assert.equal(w.scheduled.size, 0, 'stop cancels every read retry');
});

void test('a held initial sync cannot route and closing it cannot revive a route', async t => {
  const w = await world(t), owner = await w.owner('tidbyt', [artDevice('tidbyt', 'late')]), held = gate<Snapshot | ErrorBody>();
  owner.answer = held.promise; await w.start();
  assert.equal('error' in await w.ambient(), true);
  await w.stop(); held.open(owner.snapshot()); await flush();
  assert.equal('error' in await w.ambient(), true);
  assert.equal(w.forwarded.length, 0);
  assert.equal(w.scheduled.size, 0);
  await Promise.all([owner.update(artDevice('tidbyt', 'late', 2)), owner.update(artDevice('tidbyt', 'late', 3))]); await flush();
  assert.equal(owner.reads, 1, 'the late completed copy was closed and cannot resync');
});

void test('runtime abort prevents late device, operation and weather sync failures from scheduling retries', async t => {
  const bus = new InProcessBus(), sdk = bus.connect('bunny/modules/art'), controller = new AbortController();
  const held = gate<Snapshot | ErrorBody>(), owners: Participant[] = [], scheduled: (() => void | Promise<void>)[] = [];
  let reads = 0;
  for (const [source, family] of [['bunny/core', 'operation'], ['bunny/modules/weather', 'weather-state'],
    ['bunny/modules/pixoo', 'device'], ['bunny/modules/tidbyt', 'device']] as const) {
    const owner = bus.connect(source);
    await owner.serveSync([family], () => {reads += 1; return held.promise;});
    owners.push(owner);
  }
  const scheduler: ModuleScheduler = {after: (_delay, callback) => {scheduled.push(callback); return () => {};}};
  const context = {sdk, scheduler, signal: controller.signal};
  const weather = realWeather(context), dispatch = realDispatch(context);
  const subscriptions = [...await weather.start(), ...await dispatch.watch(() => {})];
  t.after(async () => {for (const subscription of subscriptions) await subscription.close();
    await sdk.close(); for (const owner of owners) await owner.close();});
  await until(() => reads === 4, 'all owner snapshots are pending');
  controller.abort();
  held.open(errorBody('unavailable'));
  await flush();
  assert.equal(scheduled.length, 0, 'the runtime abort precedes module.stop and forbids new timers');
  assert.equal(weather.read(), null);
});
