import assert from 'node:assert/strict';
import test from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {CaptureState} from '@jimmie-potts/event-contracts/v2/music-capture-data';
import type {LightingState} from '@jimmie-potts/event-contracts/v2/music-lighting-data';
import type {ReactiveCatalogView} from '@jimmie-potts/nanoleaf/reactive-presets';
import type {SyncedCopy, SyncHandler, SyncOptions, SyncResult} from '@jimmie-potts/sdk/remote';
import {lightingWorkRequestId} from '../../dist/src/core/music-lighting.js';
import {MusicLightingFeed, NANOLEAF_OWNER, type PresetFollower} from '../src/music-lighting-feed.ts';
import {controlText, endingText, lightingRecord, lightingWorkId, sessionText, startBlocked, startCapture, stopBlocked, workText,
  type LightingControls} from '../src/music-lighting-model.ts';

const capture = {endpointId: 'endpoint-one', generation: 'capture-one'};
const idle: LightingState = {id: 'wall', revision: 4, session: {status: 'idle'}, last: null};
const running = (status: 'starting' | 'active' | 'stopping' | 'uncertain'): LightingState => ({id: 'wall', revision: 5,
  session: {status, generation: 'session-one', operationId: 'start-one', capture, presetId: 'preset-green', startedAtMs: 1000}, last: null});
const message = (data: unknown, overrides: Partial<Message<unknown>> = {}): Message<unknown> => ({
  specversion: '1.0', bunnyprofile: '2.0', id: 'state-one', source: 'bunny/core', kind: 'state', type: 'org.bunny.music-lighting.updated', subject: 'wall',
  time: new Date(1000).toISOString(), dataschema: 'https://bunny.invalid/events/music-lighting-state/2.0', datacontenttype: 'application/json',
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data, ...overrides,
});
const musicCapture = (overrides: Partial<CaptureState> = {}): CaptureState => ({id: 'music', revision: 2, endpointId: 'endpoint-one', availability: 'available',
  session: {status: 'active', generation: 'capture-one', operationId: 'capture-start', input: 'music'}, ...overrides});
const RECIPE = {rendererVersion: 1, effect: 'level-glow', palette: ['#12ab34'], intensity: 0.5, sensitivity: 1, smoothingMs: 0} as const;
const catalog = (count: number): ReactiveCatalogView => ({live: true, pending: false, failed: false, value: {id: 'reactive-presets', revision: count,
  presets: Array.from({length: count}, (_, index) => ({schema: 'nanoleaf-reactive-preset/2.0' as const, presetId: `preset-${String(index)}`, name: `Preset ${String(index)}`,
    recipe: RECIPE}))}});
const ready = (overrides: Partial<LightingControls> = {}): LightingControls => ({record: idle, recordsLive: true, control: true, operationsLive: true,
  capture: musicCapture(), captureLive: true, presets: catalog(1), presetId: 'preset-0', startLocked: false, stopLocked: false, ...overrides});

void test('only the core\'s own valid lighting record is shown', () => {
  assert.deepEqual(lightingRecord(message(idle)), idle);
  const active = running('active');
  assert.deepEqual(lightingRecord(message(active)), active);
  const ended = {...idle, last: {generation: 'session-one', reason: 'refused', restoration: 'none', atMs: 2000, code: 'invalid-state'}};
  assert.deepEqual(lightingRecord(message(ended)), ended);
  for (const bad of [message(idle, {source: 'bunny/modules/nanoleaf'}), message(idle, {subject: 'panels'}),
    message(idle, {dataschema: 'https://bunny.invalid/events/music-lighting-device/2.0'}), message(idle, {kind: 'occurrence'}),
    message({...idle, session: {status: 'playing'}}), message({...active, session: {...active.session, capture: {endpointId: 'endpoint-one'}}}),
    message({...idle, last: {...ended.last, reason: 'paused'}}), message({...idle, last: {...ended.last, restoration: 'maybe'}}), message({...idle, revision: -1})]) {
    assert.equal(lightingRecord(bad), undefined);
  }
});

void test('Start binds the current active Music.app capture only, and every blocked Start explains why', () => {
  assert.equal(startBlocked(ready()), undefined);
  assert.deepEqual(startCapture(musicCapture(), true), capture);
  assert.equal(startCapture(musicCapture(), false), undefined);
  const microphone = musicCapture({session: {status: 'active', generation: 'capture-one', operationId: 'capture-start', input: 'microphone', microphoneId: 'studio-mic'}});
  assert.equal(startCapture(microphone, true), undefined, 'a microphone session is never offered to lights');
  assert.match(startBlocked(ready({capture: microphone})) ?? '', /never a microphone/);
  assert.match(startBlocked(ready({capture: musicCapture({session: {status: 'idle'}})})) ?? '', /Start measuring Music.app first/);
  assert.match(startBlocked(ready({capture: musicCapture({session: {status: 'stale', generation: 'capture-one', operationId: 'capture-start', input: 'music'}})})) ?? '', /Start measuring/);
  assert.match(startBlocked(ready({capture: musicCapture({availability: 'off', endpointId: null})})) ?? '', /unavailable/);
  assert.match(startBlocked(ready({captureLive: false})) ?? '', /capture status is unavailable/);
  assert.match(startBlocked(ready({recordsLive: false})) ?? '', /stale or unavailable/);
  assert.match(startBlocked(ready({control: false})) ?? '', /Read-only/);
  assert.match(startBlocked(ready({operationsLive: false})) ?? '', /Command records/);
  assert.match(startBlocked(ready({presets: catalog(0), presetId: undefined})) ?? '', /No saved reactive presets/);
  assert.match(startBlocked(ready({presets: {...catalog(1), live: false}})) ?? '', /stale or still loading/);
  assert.match(startBlocked(ready({presets: {value: undefined, live: false, pending: false, failed: true}})) ?? '', /library is unavailable/);
  assert.match(startBlocked(ready({presetId: 'preset-gone'})) ?? '', /Choose a saved/);
  assert.match(startBlocked(ready({startLocked: true})) ?? '', /not sent again/);
  assert.match(startBlocked(ready({stopLocked: true})) ?? '', /not sent again/);
  for (const status of ['starting', 'active', 'stopping', 'uncertain'] as const) assert.match(startBlocked(ready({record: running(status)})) ?? '', /Stop it/);
});

void test('Stop is offered for every session that is not idle, independent of an unresolved Start', () => {
  for (const status of ['starting', 'active', 'stopping', 'uncertain'] as const) {
    assert.equal(stopBlocked(ready({record: running(status), startLocked: true})), undefined, status);
    assert.equal(stopBlocked(ready({record: running(status), capture: undefined, captureLive: false, presets: catalog(0)})), undefined, 'capture and presets do not gate Stop');
  }
  assert.match(stopBlocked(ready()) ?? '', /No session/);
  assert.match(stopBlocked(ready({record: running('active'), stopLocked: true})) ?? '', /previous Stop/);
  assert.match(stopBlocked(ready({record: running('active'), recordsLive: false})) ?? '', /stale/);
  assert.match(stopBlocked(ready({record: running('active'), control: false})) ?? '', /Read-only/);
});

void test('status, endings and outcomes keep saved, reported and restored evidence distinct', () => {
  assert.match(sessionText({status: 'idle'}), /^Idle/);
  assert.match(sessionText(running('starting').session), /saved the session and is waiting for the light/);
  assert.match(sessionText(running('active').session), /light reported that it is playing/);
  assert.match(sessionText(running('uncertain').session), /nothing is sent again/);
  assert.equal(endingText({generation: 'g', reason: 'stopped', restoration: 'restored', atMs: 1}),
    'Last session ended: stopped on request. The current base scene and brightness were restored. Nothing restarts automatically.');
  assert.match(endingText({generation: 'g', reason: 'alert', restoration: 'uncertain', atMs: 1}), /agent alert.*Restoration is uncertain.*may have landed/);
  assert.match(endingText({generation: 'g', reason: 'refused', restoration: 'none', atMs: 1, code: 'invalid-state'}), /refused the start \(invalid-state\)\. No restoration.*Free mode/);
  assert.match(endingText({generation: 'g', reason: 'source-lost', restoration: 'skipped', atMs: 1}), /Music input was lost.*skipped/);
  assert.match(endingText({generation: 'g', reason: 'manual', restoration: 'none', atMs: 1}), /manual change/);
  assert.equal(controlText('Completed: succeeded. The module observed the result.'), 'Completed: succeeded. The core saved it; the light reports separately.');
  assert.match(controlText('Refused (unsupported-capability) without changing state.'), /Only Music.app capture/);
  assert.equal(controlText('Accepted. Waiting for completion.'), 'Accepted. Waiting for completion.');
  assert.equal(workText('Completed: succeeded. Transmitted; physical effect was not observed.'), 'Completed: succeeded. Written to the light; the physical effect was not observed.');
});

void test('the browser derives the same work ID as the core', async () => {
  for (const [requestId, target] of [['start-one', 'wall'], ['8b5c3a52-11c3-4f6f-9a54-0c3a5e1c2b77', 'panels']] as const) {
    assert.equal(await lightingWorkId(requestId, target), lightingWorkRequestId(requestId, target));
  }
});

type Sync = (families: readonly string[], handler: SyncHandler<LightingState>, options: SyncOptions) => Promise<SyncResult<LightingState>>;
function world(states: () => Message<unknown>[]) {
  const syncs: {families: readonly string[]; owner: string | undefined; handler: SyncHandler<LightingState>; options: SyncOptions}[] = [];
  let closed = 0, follows = 0, disposed = 0, closeHangs = false;
  // A close waits for the edge's reply; a hanging one never settles.
  const copy = {states, get: () => undefined, close: () => {closed += 1; return closeHangs ? new Promise<void>(() => {}) : Promise.resolve();}} as unknown as SyncedCopy<LightingState>;
  const sync: Sync = (families, handler, options) => {
    syncs.push({families, owner: options.owner, handler, options});
    return Promise.resolve({status: 'synced', copy, message: {...message(undefined), kind: 'sync-completed', type: 'org.bunny.sync.completed', data: {requestId: 'sync', revision: 1, members: []}}} as unknown as SyncResult<LightingState>);
  };
  const follow: PresetFollower = (presetSync, show) => {
    follows += 1;
    void presetSync(() => {}, {onRestarted: () => {}});
    show(catalog(1));
    return () => {disposed += 1;};
  };
  const feed = new MusicLightingFeed({participant: {sync} as unknown as ConstructorParameters<typeof MusicLightingFeed>[0]['participant'], follow});
  return {feed, syncs, counts: () => ({closed, follows, disposed}), hangCloses: () => {closeHangs = true;}};
}

void test('the lighting scope only reads both owners, and closes every copy it opened', async () => {
  const records = [message(running('active')), message({...idle, id: 'lines'}, {subject: 'lines'})];
  const {feed, syncs, counts} = world(() => records);
  assert.equal(await feed.refresh(), true);
  assert.deepEqual(syncs.map(sync => [sync.families, sync.owner]), [[['nanoleaf-reactive-presets'], NANOLEAF_OWNER], [['music-lighting-state'], 'bunny/core']]);
  assert.deepEqual(feed.getSnapshot().records.map(record => record.id), ['lines', 'wall']);
  assert.equal(feed.getSnapshot().presets.live, true);
  const lighting = syncs[1];
  assert.ok(lighting !== undefined);
  lighting.options.onRestarted?.(); assert.equal(feed.getSnapshot().synced, false, 'a restarted copy is stale until it syncs again');
  await lighting.handler({type: 'synced'} as Parameters<SyncHandler<LightingState>>[0]); assert.equal(feed.getSnapshot().synced, true);
  await lighting.handler({type: 'failed'} as Parameters<SyncHandler<LightingState>>[0]); assert.equal(feed.getSnapshot().synced, false);
  assert.equal(feed.getSnapshot().records.length, 2, 'the last records stay visible as last known');
  assert.equal(await feed.refresh(), true); assert.deepEqual(counts(), {closed: 1, follows: 2, disposed: 1});
  await feed.close(); assert.deepEqual(counts(), {closed: 2, follows: 2, disposed: 2});
  assert.equal(await feed.refresh(), false); assert.equal(syncs.length, 4);
});

void test('a refresh does not wait for the replaced copy to finish closing', async () => {
  const {feed, counts, hangCloses} = world(() => [message(running('active'))]);
  assert.equal(await feed.refresh(), true);
  hangCloses();
  // The card keeps Refresh disabled while a refresh runs, so a refresh that waited here would lock it.
  const refreshed = await Promise.race([feed.refresh(), new Promise<'stuck'>(resolve => {setTimeout(() => {resolve('stuck');}, 1000);})]);
  assert.equal(refreshed, true);
  assert.equal(feed.getSnapshot().synced, true);
  assert.equal(counts().closed, 1, 'the replaced copy is still asked to close');
});

void test('a foreign or malformed record makes the lighting copy unavailable', async () => {
  const {feed} = world(() => [message(idle), message(idle, {source: 'bunny/parts/dashboard'})]);
  assert.equal(await feed.refresh(), false);
  assert.deepEqual(feed.getSnapshot().records, []);
});
