// #1272: the core's Music lighting sessions, on a real runtime with the real core, capture owner and tracker. The Music
// producer is a remote fake on the gateway's endpoint; the Nanoleaf module is a scripted fake that answers work and
// publishes `music-lighting-device` records. No controller, light or capture device is used.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test, type TestContext} from 'node:test';
import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PRODUCER_SOURCE, type CaptureFeatures, type CaptureProgress, type CaptureState, type CaptureWork} from '@jimmie-potts/event-contracts/v2/music-capture';
import type {LightingCapture, LightingDeviceState, LightingEnded, LightingState, LightingWork} from '@jimmie-potts/event-contracts/v2/music-lighting';
import {connectRemote, type BunnyModule, type Command, type Draft, type Logger, type ModuleContext, type Reply, type Responder, type Sdk} from '@jimmie-potts/sdk';
import type {LightingControl} from '@jimmie-potts/event-contracts/v2/music-lighting';
import {MusicLightingPart, lightingWorkRequestId} from '../src/core/music-lighting.js';
import type {CoreTransaction} from '../src/core/store.js';
import {createCoreModule, type CoreHandle} from '../src/core/core.js';
import {CREDENTIALS_SCHEMA, tokenDigest} from '../src/credentials.js';
import {edgePermissions, principalOf} from '../src/gateway/access.js';
import type {Action, ActionAnswer} from '../src/core/tracker.js';
import {contextOf, deferred, edgeConfig, fixture, it, run, stateDir, waitFor} from './support.js';

const schema = (family: string, version = '2.0') => `https://bunny.invalid/events/${family}/${version}`;
const PRODUCER_TOKEN = 'tok_SYNTHETIC1272_music_producer';
const OPERATOR_TOKEN = 'tok_SYNTHETIC1272_operator';
const OPERATOR_SOURCE = 'bunny/parts/lighting-operator';
const OLD_GENERATION = '00000000-0000-4000-8000-000000001272';
const PRESET = 'preset-pulse';
const sleep = (ms: number) => new Promise(resolve => { setTimeout(resolve, ms); });
const codeOf = (answer: ActionAnswer): ErrorCode | undefined => 'error' in answer ? answer.error.code : undefined;
const ended = (generation: string, reason: LightingEnded['reason'], restoration: LightingEnded['restoration'] = 'none'): LightingDeviceState['session'] =>
  ({generation, status: 'ended', ended: {generation, reason, restoration, atMs: Date.now()}});

/** A scripted Nanoleaf owner: it answers `music-lighting-work` and serves and publishes `music-lighting-device`. */
class FakeLines {
  readonly work: Command<LightingWork>[] = [];
  readonly records = new Map<string, LightingDeviceState>();
  revision = 0;
  /** While true, its sync refuses, as an owner that is not serving yet. */
  down = false;
  reply: (command: Command<LightingWork>) => Reply | Promise<Reply> = () => ({status: 'accepted'});
  #context: ModuleContext | undefined;
  constructor(readonly ids: readonly string[]) {for (const id of ids) this.records.set(id, {id, revision: 0, session: null});}
  module(): BunnyModule {
    return {
      manifest: {name: 'nanoleaf', apiVersion: '1.2', configure: section => ({config: section, devices: [...this.ids]})},
      start: async context => {
        this.#context = context;
        await context.sdk.serveSync(['music-lighting-device'], () => this.down ? errorBody('unavailable', {detail: 'the fake owner is down'})
          : {revision: this.revision, states: [...this.records.values()].map(record => this.#draft(record))});
        await context.sdk.respond<LightingWork>('bunny.cmd.music-lighting-work.*', command => {this.work.push(command); return this.reply(command);});
      },
      stop: () => {this.#context = undefined;},
    };
  }
  #draft(record: LightingDeviceState) {
    return {type: 'org.bunny.music-lighting-device.updated', subject: record.id, dataschema: schema('music-lighting-device'), data: record};
  }
  /** Changes the record without publishing it, as the module would while the core is down. */
  set(id: string, session: LightingDeviceState['session']): LightingDeviceState {
    this.revision += 1;
    const record = {id, revision: this.revision, session};
    this.records.set(id, record);
    return record;
  }
  async publish(id: string, session: LightingDeviceState['session']): Promise<void> {
    const record = this.set(id, session);
    assert.ok(this.#context);
    await this.#context.sdk.publish(`bunny.state.music-lighting-device.${id}`, {kind: 'state', ...this.#draft(record)});
  }
}

async function setup(t: TestContext, lines = new FakeLines(['wall']), directory?: string) {
  let handle: CoreHandle | undefined;
  const core = createCoreModule({parts: [{start: given => {handle = given; return Promise.resolve();}}]});
  const observer = fixture('lighting-observer');
  const files = await edgeConfig(t, [], {modules: {nanoleaf: {}}, credentials: JSON.stringify({schema: CREDENTIALS_SCHEMA, credentials: [
    {id: 'music-producer', source: MUSIC_PRODUCER_SOURCE, digest: tokenDigest(PRODUCER_TOKEN), scopes: [], role: 'music-producer'},
    {id: 'operator', source: OPERATOR_SOURCE, digest: tokenDigest(OPERATOR_TOKEN), scopes: ['read', 'control']},
  ]})});
  const {runtime} = await run(t, {modules: [core, lines.module(), observer], configFile: files.config, edge: {schemas: {}}, ...(directory === undefined ? {} : {stateDir: directory})});
  const producer = await connectRemote({url: runtime.url, source: MUSIC_PRODUCER_SOURCE, token: PRODUCER_TOKEN});
  const pumps = new Set<{stopped: boolean}>();
  const stopPumps = () => {for (const pump of pumps) pump.stopped = true;pumps.clear();};
  t.after(async () => {stopPumps();await producer.close();});
  const captureWork: Command<CaptureWork>[] = [];
  const endpoint = await producer.openEndpoint<CaptureWork>({family: 'music-capture-work', respond: command => {captureWork.push(command);return {status: 'accepted'};}});
  const sdk = () => contextOf(observer).sdk;
  const captureState = async (): Promise<CaptureState> => {
    const result = await sdk().sync<CaptureState>(['music-capture-state'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
    assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('capture-sync');
    const current = result.copy.states()[0]?.data;await result.copy.close();assert.ok(current);return current;
  };
  const lights = async (): Promise<Map<string, LightingState>> => {
    const result = await sdk().sync<LightingState>(['music-lighting-state'], () => {}, {owner: 'bunny/core', timeoutMs: 2000});
    assert.equal(result.status, 'synced');if (result.status !== 'synced') throw new Error('lighting-sync');
    const records = new Map(result.copy.states().map(message => {
      assert.equal(message.dataschema, schema('music-lighting-state'));assert.equal(message.subject, message.data.id);
      return [message.subject, message.data] as const;
    }));
    await result.copy.close();return records;
  };
  const light = async (id = 'wall'): Promise<LightingState> => {const record = (await lights()).get(id);assert.ok(record, `a record for ${id}`);return record;};
  let registrations = 0, captures = 0;
  const enable = async (microphoneId?: string) => {
    const reply = await endpoint.request('music-capture-endpoint', {type: 'org.bunny.music-capture.endpoint.requested', dataschema: schema('music-capture-endpoint', microphoneId === undefined ? '2.0' : '2.1'),
      data: {action: 'enable', input: 'music', ...(microphoneId === undefined ? {} : {microphone: {id: microphoneId}})}}, {requestId: `enable-music-${++registrations}`, timeoutMs: 2000});
    assert.equal(reply.status, 'accepted');
  };
  const captureControl = (requestId: string, data: object) => core.operatorActions.dispatch({key: 'bunny.cmd.music-capture-control.music', requestedBy: 'bunny/parts/operator', requestId,
    draft: {type: 'org.bunny.music-capture.control.requested', subject: 'music', dataschema: schema('music-capture-control', 'input' in data && data.input === 'microphone' ? '2.1' : '2.0'), data}});
  const progress = (data: CaptureProgress) => endpoint.publish('music-capture-progress', {kind: 'occurrence', type: 'org.bunny.music-capture.progress.observed', dataschema: schema('music-capture-progress'), data});
  /** Publishes contiguous fresh frames every 100 ms, as the producer does, until the capture stops. */
  const pump = (generation: string, microphoneId?: string) => {
    const state = {stopped: false};pumps.add(state);
    void (async () => {
      for (let sequence = 1; !state.stopped; sequence += 1) {
        const at = Date.now();
        const data: CaptureFeatures = {generation, ...(microphoneId === undefined ? {input: 'music'} : {input: 'microphone', microphoneId}), sequence, sampleRateHz: 48000, channels: 2, frameCount: 4800,
          startMonotonicMs: (sequence - 1) * 100, endMonotonicMs: sequence * 100, emittedMonotonicMs: sequence * 100 + 1, observedAtMs: at, validUntilMs: at + 400,
          rms: 0, peak: 0, clippedFraction: 0, bands: {bass: 0, mid: 0, treble: 0}, onset: {strength: 0, confidence: 0}, discontinuity: false};
        await endpoint.publish('music-capture-features', {kind: 'occurrence', type: 'org.bunny.music-capture.features.observed',
          dataschema: schema('music-capture-features', microphoneId === undefined ? '2.0' : '2.1'), data}).catch(() => {});
        await sleep(100);
      }
    })();
    return state;
  };
  let live: {stopped: boolean} | undefined;
  /** Starts the core's capture session and keeps it active with fresh frames. */
  const liveCapture = async (microphoneId?: string): Promise<LightingCapture> => {
    const requestId = `capture-${++captures}`;
    const answer = await captureControl(requestId, {action: 'start', expectedRevision: (await captureState()).revision, endpointId: endpoint.id,
      ...(microphoneId === undefined ? {input: 'music'} : {input: 'microphone', microphoneId})});
    assert.deepEqual(answer, {status: 'accepted', requestId});
    await waitFor(() => captureWork.some(command => command.data.requestId === requestId));
    const start = captureWork.find(command => command.data.requestId === requestId);assert.ok(start);
    await progress({operationId: start.data.operationId, generation: start.data.generation, status: 'started'});
    live = pump(start.data.generation, microphoneId);
    await waitFor(async () => (await captureState()).session.status === 'active');
    return {endpointId: endpoint.id, generation: start.data.generation};
  };
  const stopCapture = async (): Promise<void> => {
    if (live !== undefined) live.stopped = true;
    const requestId = `capture-${++captures}`;
    assert.deepEqual(await captureControl(requestId, {action: 'stop', expectedRevision: (await captureState()).revision}), {status: 'accepted', requestId});
    await waitFor(() => captureWork.some(command => command.data.requestId === requestId));
    const stop = captureWork.find(command => command.data.requestId === requestId);assert.ok(stop);
    await progress({operationId: stop.data.operationId, generation: stop.data.generation, status: 'stopped'});
    await waitFor(async () => (await captureState()).session.status === 'idle');
  };
  const control = (requestId: string, expectedRevision: number, data: {action: 'start'; capture: LightingCapture; presetId?: string} | {action: 'stop'}, target = 'wall') =>
    core.operatorActions.dispatch({key: `bunny.cmd.music-lighting-control.${target}`, requestedBy: 'bunny/parts/operator', requestId,
      draft: {type: 'org.bunny.music-lighting.control.requested', subject: target, dataschema: schema('music-lighting-control'),
        data: {expectedRevision, ...(data.action === 'start' ? {presetId: PRESET, ...data} : data)}}});
  const start = async (requestId: string, capture: LightingCapture, target = 'wall') => control(requestId, (await light(target)).revision, {action: 'start', capture}, target);
  const stop = async (requestId: string, target = 'wall') => control(requestId, (await light(target)).revision, {action: 'stop'}, target);
  const status = async (id: string, expected: string, what = `${id} ${expected}`) => waitFor(async () => (await light(id)).session.status === expected, 5000, what);
  const http = async (path: string, body?: object) => {
    const response = await fetch(new URL(path, runtime.url), {method: body === undefined ? 'GET' : 'POST',
      headers: {authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: response.status, body: await response.json() as Record<string, unknown>};
  };
  return {core, runtime, producer, observer, lines, endpoint, captureWork, captureState, lights, light, enable, liveCapture, stopCapture, control, start, stop, status, http,
    stopPumps, operation: (id: string) => handle?.operation(id)};
}

it('a Start is admitted only for a qualified light against the core\'s active Music capture', async t => {
  const h = await setup(t);
  await h.enable();
  assert.deepEqual(await h.light(), {id: 'wall', revision: 0, session: {status: 'idle'}, last: null});
  const absent = {endpointId: h.endpoint.id, generation: OLD_GENERATION};
  assert.equal(codeOf(await h.start('no-capture', absent)), 'unavailable');
  assert.equal(codeOf(await h.control('unknown-light', 0, {action: 'start', capture: absent}, 'attic')), 'unavailable');
  const raw = await contextOf(h.observer).sdk.request('bunny.cmd.music-lighting-control.wall', {type: 'org.bunny.music-lighting.control.requested', subject: 'wall',
    dataschema: schema('music-lighting-control'), data: {expectedRevision: 0, action: 'start', capture: absent, presetId: PRESET}}, {timeoutMs: 2000});
  assert.equal(raw.status === 'rejected' && raw.error.error.code, 'forbidden', 'only the dispatcher admits an operator Start');
  const capture = await h.liveCapture();
  assert.equal(codeOf(await h.control('stale-revision', 7, {action: 'start', capture})), 'revision-conflict');
  assert.equal(codeOf(await h.start('old-generation', {...capture, generation: OLD_GENERATION})), 'revision-conflict');
  assert.equal(codeOf(await h.start('other-endpoint', {...capture, endpointId: 'other-endpoint'})), 'revision-conflict');
  assert.equal(h.lines.work.length, 0, 'no refusal addresses the light');
  assert.equal((await h.light()).session.status, 'idle');

  assert.deepEqual(await h.start('start-wall', capture), {status: 'accepted', requestId: 'start-wall'});
  await waitFor(() => h.lines.work.length === 1);
  const work = h.lines.work[0];assert.ok(work);
  assert.equal(work.source, 'bunny/core');assert.equal(work.subject, 'wall');
  assert.equal(work.type, 'org.bunny.music-lighting.work.requested');assert.equal(work.dataschema, schema('music-lighting-work'));
  assert.ok(work.data.action === 'start');
  assert.deepEqual(work.data.capture, capture);assert.equal(work.data.presetId, PRESET);
  assert.match(work.data.requestId, /^lighting-[0-9a-f]{64}$/);
  assert.match(work.data.generation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(work.traceparent.slice(3, 35), h.operation('start-wall')?.traceparent.slice(3, 35), 'the work joins the operator command\'s trace');
  const starting = await h.light();
  assert.ok(starting.session.status === 'starting');
  assert.deepEqual(starting.session, {status: 'starting', generation: work.data.generation, operationId: 'start-wall', capture, presetId: PRESET, startedAtMs: starting.session.startedAtMs});
  assert.equal(starting.last, null);
  await waitFor(() => h.operation('start-wall')?.result === 'succeeded');
  assert.equal(h.operation('start-wall')?.evidence, 'observed', 'saving the session completes the operator command');
  assert.equal(h.operation(work.data.requestId)?.family, 'music-lighting-work');
  assert.equal(codeOf(await h.start('second-start', capture)), 'invalid-state');
  assert.deepEqual(await h.control('start-wall', 0, {action: 'start', capture}), {status: 'accepted', requestId: 'start-wall'}, 'a duplicate answers as before');
  await sleep(100);
  assert.equal(h.lines.work.length, 1, 'nothing is sent again');
});

it('a microphone capture session is refused as unsupported and never addresses the light', async t => {
  const h = await setup(t);
  await h.enable('studio-mic');
  const capture = await h.liveCapture('studio-mic');
  assert.equal(codeOf(await h.start('microphone-start', capture)), 'unsupported-capability');
  assert.equal(h.lines.work.length, 0);
  assert.equal((await h.light()).session.status, 'idle');
});

it('device endings settle the session; nothing resumes when capture restarts and a restart is a new generation', async t => {
  const h = await setup(t);
  await h.enable();
  let capture = await h.liveCapture();
  let previous = OLD_GENERATION;
  for (const [index, reason] of (['alert', 'manual', 'source-lost'] as const).entries()) {
    assert.deepEqual(await h.start(`start-${reason}`, capture), {status: 'accepted', requestId: `start-${reason}`});
    await waitFor(() => h.lines.work.length === index + 1);
    const generation = h.lines.work[index]?.data.generation;assert.ok(generation !== undefined);
    assert.notEqual(generation, previous);
    await h.lines.publish('wall', {generation, status: 'starting'});
    await sleep(50);
    assert.equal((await h.light()).session.status, 'starting');
    await h.lines.publish('wall', {generation, status: 'playing'});
    await h.status('wall', 'active');
    // A record of another generation is not this session's.
    await h.lines.publish('wall', ended(previous, 'stopped', 'restored'));
    await sleep(100);
    assert.equal((await h.light()).session.status, 'active', 'a stale generation is ignored');
    const ending = ended(generation, reason, reason === 'manual' ? 'none' : 'restored');
    await h.lines.publish('wall', ending);
    await h.status('wall', 'idle');
    assert.ok(ending?.status === 'ended');
    assert.deepEqual((await h.light()).last, ending.ended);
    await h.stopCapture();
    capture = await h.liveCapture();
    await sleep(300);
    assert.equal(h.lines.work.length, index + 1, `nothing resumes after ${reason}`);
    assert.equal((await h.light()).session.status, 'idle');
    previous = generation;
  }
  assert.equal(new Set(h.lines.work.map(command => command.data.generation)).size, 3, 'each explicit Start is a new generation');
  assert.equal(new Set(h.lines.work.map(command => command.data.requestId)).size, 3);
});

it('Stop saves stopping and ends through the device record, an already-ended session or another refusal', async t => {
  const h = await setup(t);
  await h.enable();
  const capture = await h.liveCapture();
  const active = async (requestId: string): Promise<string> => {
    const sent = h.lines.work.length;
    assert.deepEqual(await h.start(requestId, capture), {status: 'accepted', requestId});
    await waitFor(() => h.lines.work.length === sent + 1);
    const generation = h.lines.work[sent]?.data.generation;assert.ok(generation !== undefined);
    await h.lines.publish('wall', {generation, status: 'playing'});
    await h.status('wall', 'active');
    return generation;
  };
  assert.equal(codeOf(await h.stop('stop-idle')), 'invalid-state');
  const first = await active('start-one');
  assert.equal(codeOf(await h.control('stop-stale', 0, {action: 'stop'})), 'revision-conflict');
  assert.deepEqual(await h.stop('stop-one'), {status: 'accepted', requestId: 'stop-one'});
  await waitFor(() => h.lines.work.length === 2);
  const stopWork = h.lines.work[1];assert.ok(stopWork);
  assert.deepEqual({action: stopWork.data.action, generation: stopWork.data.generation}, {action: 'stop', generation: first});
  assert.notEqual(stopWork.data.requestId, h.lines.work[0]?.data.requestId);
  const stopping = (await h.light()).session;
  assert.ok(stopping.status === 'stopping');assert.equal(stopping.generation, first);assert.equal(stopping.operationId, 'stop-one');
  assert.equal(codeOf(await h.stop('stop-twice')), 'invalid-state');
  const stopped = ended(first, 'stopped', 'restored');
  await h.lines.publish('wall', stopped);
  await h.status('wall', 'idle');
  assert.ok(stopped?.status === 'ended');assert.deepEqual((await h.light()).last, stopped.ended);

  // The module no longer has the session: the device record decides, and without an ending the Stop stands.
  const second = await active('start-two');
  h.lines.reply = command => command.data.action === 'stop' ? errorBody('invalid-state') : {status: 'accepted'};
  await h.stop('stop-two');
  await h.status('wall', 'idle');
  const last = (await h.light()).last;
  assert.ok(last !== null);
  assert.deepEqual({...last, atMs: 0}, {generation: second, reason: 'stopped', restoration: 'none', atMs: 0});

  // Any other refusal leaves the outcome unknown; a later Stop is still allowed.
  const third = await active('start-three');
  h.lines.reply = command => command.data.action === 'stop' ? errorBody('unavailable') : {status: 'accepted'};
  await h.stop('stop-three');
  await h.status('wall', 'uncertain');
  h.lines.reply = () => ({status: 'accepted'});
  assert.deepEqual(await h.stop('stop-again'), {status: 'accepted', requestId: 'stop-again'});
  await h.status('wall', 'stopping');
  await h.lines.publish('wall', ended(third, 'stopped', 'skipped'));
  await h.status('wall', 'idle');
  assert.equal(h.lines.work.filter(command => command.data.action === 'start').length, 3);
  assert.equal(h.lines.work.filter(command => command.data.action === 'stop').length, 4);
});

it('a refused work Start ends refused or expired; a lost reply is uncertain until the device record settles it', async t => {
  const h = await setup(t);
  await h.enable();
  const capture = await h.liveCapture();
  for (const [index, code] of (['invalid-state', 'expired'] as const).entries()) {
    h.lines.reply = () => errorBody(code);
    assert.deepEqual(await h.start(`refused-${code}`, capture), {status: 'accepted', requestId: `refused-${code}`});
    await waitFor(() => h.lines.work.length === index + 1);
    await h.status('wall', 'idle');
    const last = (await h.light()).last;assert.ok(last !== null);
    assert.deepEqual({...last, atMs: 0}, {generation: h.lines.work[index]?.data.generation, reason: code === 'expired' ? 'expired' : 'refused', restoration: 'none', atMs: 0});
  }
  // No reply within the device reply deadline: the work's fate is unknown.
  const held = deferred<Reply>();
  t.after(() => {held.resolve({status: 'accepted'});});
  h.lines.reply = () => held.promise;
  await h.start('lost-start', capture);
  await waitFor(() => h.lines.work.length === 3);
  await sleep(200);
  assert.equal((await h.light()).session.status, 'starting', 'a pending reply leaves the Start waiting');
  await waitFor(async () => (await h.light()).session.status === 'uncertain', 8000, 'the lost reply');
  held.resolve({status: 'accepted'});
  await sleep(100);
  assert.equal((await h.light()).session.status, 'uncertain', 'a reply after the deadline changes nothing');
  const generation = h.lines.work[2]?.data.generation;assert.ok(generation !== undefined);
  await h.lines.publish('wall', {generation, status: 'playing'});
  await h.status('wall', 'active');
  await sleep(100);
  assert.equal(h.lines.work.length, 3, 'nothing is sent again');
}, 30_000);

it('a core restart leaves sessions uncertain without resending, and the device sync resolves each one', async t => {
  const lines = new FakeLines(['wall', 'desk', 'shelf', 'door']);
  const directory = await stateDir(t);
  const first = await setup(t, lines, directory);
  await first.enable();
  const capture = await first.liveCapture();
  const generations = new Map<string, string>();
  for (const id of lines.ids) {
    await first.start(`start-${id}`, capture, id);
    await waitFor(() => lines.work.some(command => command.subject === id));
    const generation = lines.work.find(command => command.subject === id)?.data.generation;assert.ok(generation !== undefined);
    generations.set(id, generation);
    await lines.publish(id, {generation, status: 'playing'});
    await first.status(id, 'active');
  }
  first.stopPumps();
  await first.runtime.stop();await first.producer.close();
  // While the core is down: one light ended on an alert and one still plays; the module lost one session and holds an
  // older generation's record for another.
  const wall = generations.get('wall');assert.ok(wall !== undefined);
  const alert = ended(wall, 'alert', 'restored');
  lines.set('wall', alert);
  lines.set('shelf', null);
  lines.set('door', ended(OLD_GENERATION, 'stopped', 'restored'));
  lines.down = true;
  const second = await setup(t, lines, directory);
  const recovered = await second.lights();
  assert.deepEqual([...recovered.values()].map(record => [record.id, record.session.status]).sort(), [['desk', 'uncertain'], ['door', 'uncertain'], ['shelf', 'uncertain'], ['wall', 'uncertain']]);
  lines.down = false;
  await second.status('wall', 'idle', 'the ended wall session');
  await second.status('desk', 'active', 'the playing desk session');
  await second.status('shelf', 'idle', 'the shelf restart');
  await second.status('door', 'idle', 'the door restart');
  assert.ok(alert?.status === 'ended');
  assert.deepEqual((await second.light('wall')).last, alert.ended);
  for (const id of ['shelf', 'door']) {
    const restarted = (await second.light(id)).last;assert.ok(restarted !== null);
    assert.deepEqual({...restarted, atMs: 0}, {generation: generations.get(id), reason: 'restart', restoration: 'none', atMs: 0});
  }
  assert.equal(lines.work.length, 4, 'a restart resends nothing');
});

it('operators cannot send lighting work; the gateway admits control and serves state', async t => {
  const h = await setup(t);
  await h.enable();
  const work = (requestedBy: string) => ({key: 'bunny.cmd.music-lighting-work.wall', requestedBy, requestId: `raw-work-${requestedBy.length}`,
    draft: {type: 'org.bunny.music-lighting.work.requested', subject: 'wall', dataschema: schema('music-lighting-work'),
      data: {generation: OLD_GENERATION, action: 'stop'}}});
  assert.equal(codeOf(await h.core.actions.dispatch(work('bunny/parts/operator'))), 'forbidden');
  assert.equal(codeOf(await h.core.operatorActions.dispatch(work('bunny/parts/operator-two'))), 'forbidden');
  for (const family of ['music-lighting-work', 'music-lighting-device', 'music-lighting-state']) {
    const answer = await h.http(`/api/v2/commands/${family}`, {target: 'wall', requestId: `http-${family}`, data: {generation: OLD_GENERATION, action: 'stop'}});
    assert.equal(answer.status, 403, family);
    assert.equal((answer.body.error as {code?: string} | undefined)?.code, 'forbidden');
  }
  const read = await h.http('/api/v2/families/music-lighting-state');
  assert.equal(read.status, 200);
  assert.deepEqual((read.body.records as LightingState[]).map(record => record.id), ['wall']);
  const capture = await h.liveCapture();
  const revision = (await h.light()).revision;
  const started = await h.http('/api/v2/commands/music-lighting-control', {target: 'wall', requestId: 'http-start', data: {action: 'start', expectedRevision: revision, capture, presetId: PRESET}});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(h.operation('http-start')?.dataschema, schema('music-lighting-control'));
  assert.equal(h.operation('http-start')?.requestedBy, OPERATOR_SOURCE);
  await waitFor(() => h.lines.work.length === 1);
  assert.equal(h.lines.work[0]?.source, 'bunny/core');
  const devices = await h.http('/api/v2/families/music-lighting-device');
  assert.equal(devices.status, 200);
});

it('no edge grant requests lighting work or publishes a device record', () => {
  for (const scopes of [['read'], ['control'], ['ingest'], ['read', 'control', 'ingest', 'admin']] as const) {
    const grant = edgePermissions(principalOf({id: 'ordinary', source: 'bunny/parts/ordinary', digest: tokenDigest('synthetic'), scopes: [...scopes]}));
    assert.equal((grant.keys ?? []).some(key => key.startsWith('bunny.cmd.') && !key.startsWith('bunny.cmd.approval-recover') && !key.startsWith('bunny.cmd.notice-acknowledge') && !key.startsWith('bunny.cmd.inbox-handle')), false);
    assert.equal((grant.publishes ?? []).some(family => family.startsWith('music-lighting-')), false);
    assert.equal(grant.endpoint, undefined);
  }
});

// The part alone, on a real SQLite store: only the dispatcher and transport are stand-ins. Expiry and admission are
// decided here, before the bus could, so they are checked without the runtime.
void test('an expired, unadmitted, invalid or unqualified command saves nothing and sends no work', async () => {
  const database = new DatabaseSync(':memory:');
  const dispatched: Action[] = [], published: Draft<object>[] = [];
  let admitted = true, responder: Responder<LightingControl> | undefined, revision = 0, completed = 0;
  const capture = {endpointId: 'music-endpoint', generation: OLD_GENERATION};
  const part = new MusicLightingPart({admit: () => admitted, complete: () => {completed += 1;return () => {};}, end: () => {}},
    {after: () => () => {}}, () => ({...capture, input: 'music'}));
  part.open(database);
  part.setParticipants([{id: 'wall', kind: 'nanoleaf'}, {id: 'pixoo-1', kind: 'pixoo'}]);
  const sdk = {source: 'bunny/core',
    respond: (_pattern: string, handler: Responder<LightingControl>) => {responder = handler;return Promise.resolve({close: () => Promise.resolve()});},
    sync: () => Promise.resolve({status: 'rejected', requestId: 'sync', error: errorBody('unavailable')}),
  } as unknown as Sdk;
  await part.start({sdk, clock: {now: () => Date.now()}, ready: Promise.resolve(), log: {} as Logger, received: () => 'new', operation: () => undefined,
    dispatch: action => {dispatched.push(action);return Promise.resolve({status: 'accepted', requestId: action.requestId ?? ''});},
    transaction: work => {
      database.exec('BEGIN');
      try {
        const staged: Draft<object>[] = [];
        const tx = {database, atMs: Date.now(), revision: () => revision + 1, take: () => {}, record: () => {}, step: () => {},
          add: (_key: string, draft: Draft<object>) => {staged.push(draft);return draft;}} as unknown as CoreTransaction;
        const result = work(tx);
        database.exec('COMMIT');revision += 1;published.push(...staged);
        return Promise.resolve(result);
      } catch (error) {database.exec('ROLLBACK');return Promise.reject(error instanceof Error ? error : new Error('transaction'));}
    }});
  assert.deepEqual(part.states(['music-lighting-state']).map(state => state.data), [{id: 'wall', revision: 0, session: {status: 'idle'}, last: null}]);
  const command = (requestId: string, patch: Partial<Command<LightingControl>> = {}, data: Partial<LightingControl> = {}): Command<LightingControl> => ({
    specversion: '1.0', bunnyprofile: '2.0', id: `message-${requestId}`, source: 'bunny/core', type: 'org.bunny.music-lighting.control.requested', subject: 'wall',
    time: new Date().toISOString(), expiresat: new Date(Date.now() + 5000).toISOString(), kind: 'command', datacontenttype: 'application/json',
    dataschema: schema('music-lighting-control'), traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    data: {requestId, expectedRevision: 0, action: 'start', capture, presetId: PRESET, ...data}, ...patch,
  });
  assert.ok(responder);
  const code = async (given: Command<LightingControl>) => {const reply = await responder?.(given);return reply !== undefined && 'error' in reply ? reply.error.code : reply?.status;};
  assert.equal(await code(command('expired', {expiresat: new Date(Date.now() - 1).toISOString()})), 'expired');
  admitted = false;
  assert.equal(await code(command('unadmitted')), 'forbidden');
  admitted = true;
  assert.notEqual(await code(command('invalid', {}, {presetId: 'Not A Preset'})), 'accepted');
  assert.equal(await code(command('pixoo', {subject: 'pixoo-1'})), 'unavailable', 'only a Nanoleaf participant is a target');
  assert.deepEqual([dispatched.length, published.length, completed], [0, 0, 0]);
  assert.equal(await code(command('accepted')), 'accepted');
  await waitFor(() => dispatched.length === 1);
  const sent = dispatched[0];assert.ok(sent);
  assert.deepEqual({key: sent.key, requestedBy: sent.requestedBy, requestId: sent.requestId, parent: sent.parent?.traceparent},
    {key: 'bunny.cmd.music-lighting-work.wall', requestedBy: 'bunny/core', requestId: lightingWorkRequestId('accepted', 'wall'), parent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'});
  assert.deepEqual([published.length, completed], [1, 1]);
  database.close();
});
