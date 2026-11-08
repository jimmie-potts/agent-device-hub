import {expectedCard} from '../helpers/artwork-oracle.js';
// The Pixoo module's behavior on the bus (Hub #843, ADR 0014): the status base follows the core's sessions, playback commands complete with
// their uploads, Now Playing follows the playback record, an offline device is unavailable without failing the module, a
// bad image fails only its own job, nothing is sent twice, and a finished turn is dismissed for the Pixoo only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync, type SQLInputValue, type StatementResultingChanges, type StatementSync} from 'node:sqlite';
import {describe, it} from 'node:test';
import {MAX_MESSAGE_BYTES, type Message} from '@jimmie-potts/event-contracts/v2';
import type {MomentEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {RequestResult} from '@jimmie-potts/sdk';
import {checkModuleRecord} from '@jimmie-potts/sdk/testing';
import sharp from 'sharp';
import {DEFAULT_LIMITS, DEFAULT_TRANSFORM, MediaStore, SIMULATOR_PROFILE} from '../../src/media/index.js';
import {runWorker} from '../../src/media/worker-client.js';
import {DashboardPager} from '../../src/presentation/agent-dashboard.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {momentContent, renderMomentContent} from '../../src/presentation/moment-content.js';
import {nowPlayingView, renderNowPlaying} from '../../src/presentation/now-playing.js';
import {monitorView} from '../../src/presentation/sources.js';
import {PixooStore} from '../../src/module/store.js';
import {HOSTED_PROFILE} from '../../src/module/configuration.js';
import {FAMILIES, type PlaylistRecord, type RenditionRecord} from '../../src/module/schemas.js';
import {frameDigest} from '../../src/module/transport.js';
import {DEVICE, FAST, SECTION, SESSION_ID, World, bytesOf, declaredPng, hostedGif, manyColorGif, playbackRecord, playbackState, sleep, waitFor} from './support.js';

const FAILING_WORKER = new URL('./fixtures/failing-render-worker.js', import.meta.url);
const HEAP_WORKER = new URL('./fixtures/heap-worker.js', import.meta.url);
const NOTICE = 'c'.repeat(64);

/** The world followed profile 2.0, every record is one the runtime writes whole, and nothing in the module failed. */
function assertClean(world: World): void {
  assert.deepEqual(world.invalid, [], 'every message follows profile 2.0');
  assert.deepEqual(world.logs().map(entry => checkModuleRecord('pixoo', entry)).filter(problem => problem !== undefined), [], 'every log record is registered');
  assert.deepEqual(world.failures(), [], 'no handler, timer or worker of the module failed');
}
async function within(world: World, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    assertClean(world);
  } finally {
    await world.close();
  }
}
const accepted = async (pending: Promise<{status: string; requestId: string}>): Promise<string> => {
  const result = await pending;
  assert.equal(result.status, 'accepted', JSON.stringify(result));
  return result.requestId;
};
const mode = (world: World, value: 'work' | 'free' | 'quiet'): Promise<string> =>
  accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: value}));
const solid = (rgb: [number, number, number]): Promise<Buffer> =>
  sharp({create: {width: 64, height: 64, channels: 3, background: {r: rgb[0], g: rgb[1], b: rgb[2]}}}).png().toBuffer();
const asset = (world: World, change: object): Promise<{status: string; requestId: string}> =>
  world.request(FAMILIES.assetChange, 'org.bunny.pixoo-asset.change.requested', {change});
const playlist = (world: World, change: object): Promise<{status: string; requestId: string}> =>
  world.request(FAMILIES.playlistChange, 'org.bunny.pixoo-playlist.change.requested', {change});
const records = <T>(world: World, family: string): T[] => {
  const latest = new Map<string, T>();
  for (const message of world.seen) {
    if (message.dataschema.endsWith(`/${family}/2.0`) && message.kind === 'state') latest.set(message.subject, message.data as T);
    if (message.kind === 'removal' && (message.data as {entity?: {family?: string}}).entity?.family === family) latest.delete(message.subject);
  }
  return [...latest.values()];
};

/** Imports one solid-colored 64x64 PNG and returns its rendition. */
async function importSolid(world: World, rgb: [number, number, number], name: string): Promise<RenditionRecord> {
  const requestId = await accepted(asset(world, {operation: 'import', name, content: {inline: (await solid(rgb)).toString('base64')}}));
  assert.deepEqual((await world.outcome(requestId, 20_000)).data, {requestId, result: 'succeeded', evidence: 'observed'});
  return waitFor(() => records<RenditionRecord>(world, FAMILIES.rendition).find(item => item.name === name), `the rendition ${name}`);
}

void describe('Monitor', () => {
  void it('follows the core\'s sessions and paints the dashboard of the session that waits for a person', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const session = await world.publishSession({attention: [{id: {status: 'known', id: 'approve-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}]});
      // The simulator's start is passive: the first mode command lets the status base draw. Work writes nothing of its own.
      const requestId = await mode(world, 'work');
      assert.deepEqual((await world.outcome(requestId)).data, {requestId, result: 'succeeded', evidence: 'observed'});
      // The device shows the dashboard the presentation renders from the synced session: two frames, pulsing for approval.
      const layout = new DashboardPager().layout(monitorView({state: 'current', revision: session.revision, sessions: [session]}), Date.now());
      const expected = renderDashboard(layout).map(frameDigest);
      assert.equal(expected.length, 2);
      await waitFor(() => JSON.stringify(world.device.state().shown?.digests) === JSON.stringify(expected) ? true : undefined, 'the approval dashboard on the device');
      const display = await waitFor(() => world.display()?.showing === 'dashboard' ? world.display() : undefined, 'the display record');
      assert.deepEqual([display.mode, display.base, display.participating, display.monitor.matched, display.monitor.attention], ['work', 'status', true, 1, 1]);
      // The approval resolves: the dashboard stops pulsing, and the device shows it.
      const resolved = await world.publishSession({attention: []});
      const calm = renderDashboard(new DashboardPager().layout(monitorView({state: 'current', revision: resolved.revision, sessions: [resolved]}), Date.now())).map(frameDigest);
      await waitFor(() => JSON.stringify(world.device.state().shown?.digests) === JSON.stringify(calm) ? true : undefined, 'the calm dashboard on the device', 8000);
      // Its own paints are the device's last transmission, with no request ID.
      const record = await waitFor(() => world.deviceRecord()?.lastTransmission.status === 'known' ? world.deviceRecord() : undefined, 'a transmission');
      assert.deepEqual(record.lastTransmission.status === 'known' ? record.lastTransmission.operationIds : [], ['dashboard']);
    });
  });

  void it('keeps its picture and runs on when a render fails, reporting the run of failures once', async () => {
    const world = await World.open({options: {renderWorker: FAILING_WORKER}});
    await within(world, async () => {
      await world.start();
      await world.publishSession();
      await mode(world, 'free');
      await waitFor(() => world.logs().find(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'feed'), 'the failed render\'s record');
      await sleep(1500);
      assert.equal(world.logs().filter(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'feed').length, 1, 'one record for the run of failures');
      assert.equal(world.device.state().uploads, 0, 'nothing reached the device');
      assert.equal(world.deviceRecord()?.availability, 'available', 'a failed render is no evidence about the device');
    });
  });
});

void describe('Media', () => {
  void it('accepts a playlist start, completes it transmitted once the media reaches the device, and shows the media', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const rendition = await importSolid(world, [10, 20, 30], 'Teal');
      const created = await accepted(playlist(world, {operation: 'create', name: 'Desk'}));
      assert.equal((await world.outcome(created)).data.result, 'succeeded');
      const list = await waitFor(() => records<PlaylistRecord>(world, FAMILIES.playlist).find(item => item.name === 'Desk'), 'the playlist');
      const filled = await accepted(playlist(world, {operation: 'items', playlistId: list.id, revision: list.playlistRevision, items: [{renditionId: rendition.id}]}));
      assert.equal((await world.outcome(filled)).data.result, 'succeeded');
      await waitFor(() => {
        const record = world.deviceRecord();
        return record?.capabilities.media.supported === true && record.capabilities.media.playlistIds.includes(list.id) ? true : undefined;
      }, 'the playlist among the device\'s capabilities');
      const started = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}));
      const outcome = await world.outcome(started);
      assert.deepEqual(outcome.data, {requestId: started, result: 'succeeded', evidence: 'transmitted'});
      assert.equal(outcome.type, 'org.bunny.media.start.completed');
      const teal = frameDigest(Buffer.alloc(12288).map((_, index) => [10, 20, 30][index % 3] ?? 0));
      assert.deepEqual(world.device.state().shown?.digests, [teal], 'the device shows the media');
      const record = await waitFor(() => {
        const latest = world.deviceRecord();
        return latest?.lastTransmission.status === 'known' && latest.lastTransmission.requestId === started ? latest : undefined;
      }, 'the start as the last transmission');
      assert.equal(record.pending, 0);
      assert.deepEqual(record.lastOutcome, {status: 'known', outcome: {requestId: started, result: 'succeeded', evidence: 'transmitted'}});
      const display = await waitFor(() => world.display()?.player.renditionId === rendition.id ? world.display() : undefined, 'the playing rendition');
      assert.equal(display.player.playlistId, list.id);
      // A pause changes only the module's own playback: observed, with nothing sent.
      const uploads = world.device.state().uploads;
      const paused = await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'}));
      assert.deepEqual((await world.outcome(paused)).data, {requestId: paused, result: 'succeeded', evidence: 'observed'});
      assert.equal(world.device.state().uploads, uploads);
    });
  });

  void it('fails a corrupt or oversized image\'s job without stopping the module', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const corrupt = await accepted(asset(world, {operation: 'import', name: 'Corrupt', content: {inline: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('not a PNG after all')]).toString('base64')}}));
      const failed = await world.outcome(corrupt, 20_000);
      assert.deepEqual([failed.data.result, failed.data.evidence, failed.data.error?.code], ['failed', 'none', 'invalid-request']);
      // A pixel bomb: a few bytes that declare 20,000 x 20,000 pixels, over the decoder's 50 million pixel limit.
      const bomb = await accepted(asset(world, {operation: 'import', name: 'Bomb', content: {inline: declaredPng(20_000, 20_000).toString('base64')}}));
      const refused = await world.outcome(bomb, 20_000);
      assert.deepEqual([refused.data.result, refused.data.error?.code], ['failed', 'too-large']);
      // The module runs on: the next import succeeds.
      await importSolid(world, [200, 0, 0], 'Red');
      assert.equal(records<RenditionRecord>(world, FAMILIES.rendition).length, 1, 'only the good image joined the catalog');
    });
  });

  void it('imports a file staged in its private folder only when its size and hash match', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const bytes = await solid([0, 90, 0]);
      const hash = createHash('sha256').update(bytes).digest('hex');
      await mkdir(join(world.folder, 'incoming'), {recursive: true, mode: 0o700});
      await writeFile(join(world.folder, 'incoming', hash), bytes, {mode: 0o600});
      const staged = (file: string, size: number): Promise<{status: string; requestId: string}> =>
        asset(world, {operation: 'import', name: 'Green', content: {staged: {file, bytes: size}}});
      const wrongSize = await accepted(staged(hash, bytes.length + 1));
      assert.equal((await world.outcome(wrongSize)).data.error?.code, 'invalid-request');
      const missing = await accepted(staged('e'.repeat(64), bytes.length));
      assert.equal((await world.outcome(missing)).data.error?.code, 'not-found');
      const good = await accepted(staged(hash, bytes.length));
      assert.deepEqual((await world.outcome(good, 20_000)).data, {requestId: good, result: 'succeeded', evidence: 'observed'});
      await waitFor(() => records<RenditionRecord>(world, FAMILIES.rendition).find(item => item.name === 'Green'), 'the staged rendition');
    });
  });

  void it('decodes in a child process whose heap is capped at 256 MiB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pixoo-heap-'));
    try {
      await mkdir(join(dir, 'out'));
      await writeFile(join(dir, 'in'), 'x');
      await runWorker({input: join(dir, 'in'), output: join(dir, 'out'), sourceHash: 'a'.repeat(64), id: 'b'.repeat(64), transform: DEFAULT_TRANSFORM, profile: SIMULATOR_PROFILE, limits: DEFAULT_LIMITS},
        new AbortController().signal, HEAP_WORKER);
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  void it('reports a command it accepted before a restart as uncertain, and never sends it again', async () => {
    const world = await World.open({mode: 'silent'});
    await within(world, async () => {
      await world.start();
      const requestId = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 30}));
      await waitFor(() => world.deviceRecord()?.pending === 1 ? true : undefined, 'the pending command on the device record');
      assert.equal(world.device.state().sent, 1, 'the silent Pixoo took the write');
      await world.restart();
      const outcome = await world.outcome(requestId);
      assert.deepEqual([outcome.data.result, outcome.data.evidence, outcome.data.error?.code], ['uncertain', 'none', 'uncertain-result']);
      world.device.set('online');
      await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the device back online');
      await sleep(200);
      assert.deepEqual([world.device.state().sent, world.device.state().writes], [1, 0], 'the write was never sent again');
      assert.equal(world.deviceRecord()?.pending, 0);
    });
  });

  void it('accepts a repeated request again and changes nothing', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const first = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 55}, {requestId: 'bright-1'}));
      assert.equal((await world.outcome(first)).data.result, 'succeeded');
      const again = await world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 55}, {requestId: 'bright-1'});
      assert.equal(again.status, 'accepted');
      await sleep(100);
      assert.equal(world.device.state().writes, 1, 'one write');
      assert.equal(world.seen.filter(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === 'bright-1').length, 1, 'one outcome');
    });
  });

  void it('refuses a request ID used again for other content with duplicate-conflict, before and after a restart', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const first = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 55}, {requestId: 'bright-2'}));
      assert.equal((await world.outcome(first)).data.result, 'succeeded');
      const other = await world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 56}, {requestId: 'bright-2'});
      assert.equal(other.status === 'rejected' && other.error.error.code, 'duplicate-conflict');
      await world.restart();
      const later = await world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 57}, {requestId: 'bright-2'});
      assert.equal(later.status === 'rejected' && later.error.error.code, 'duplicate-conflict');
      const same = await world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 55}, {requestId: 'bright-2'});
      assert.equal(same.status, 'accepted', 'the same request is still accepted, and changes nothing');
      await sleep(100);
      assert.equal(world.device.state().writes, 1, 'one write');
      assert.equal(world.device.state().brightness, 55);
    });
  });

  void it('refuses a stale configuration revision, an unsupported mode and a stale generation before acting', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const stale = await world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work', expectedConfigurationRevision: 99});
      assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
      // Monitor and Media are no longer Pixoo modes (ADR 0014): a stored routine that names one is unsupported.
      const unsupported = await world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'monitor'});
      assert.equal(unsupported.status === 'rejected' && unsupported.error.error.code, 'unsupported-capability');
      const generation = await world.request('power-set', 'org.bunny.power.set.requested', {on: false, expectedGeneration: {epoch: 'other', sequence: 0}});
      assert.equal(generation.status === 'rejected' && generation.error.error.code, 'revision-conflict');
      assert.equal(world.device.state().writes, 0);
    });
  });

  void it('serves its catalog records within the message cap: a playlist of 1,000 items with the longest names fits', () => {
    const item = {id: '00000000-0000-4000-8000-000000000000', renditionId: 'f'.repeat(64), playback: {mode: 'duration' as const, durationMs: Number.MAX_SAFE_INTEGER}};
    const record: PlaylistRecord = {
      id: '00000000-0000-4000-8000-000000000001', revision: Number.MAX_SAFE_INTEGER, name: 'N'.repeat(120), playlistRevision: Number.MAX_SAFE_INTEGER,
      repeat: true, shuffle: true, items: Array.from({length: 1000}, () => item),
    };
    // The envelope adds well under 2 KiB.
    assert.ok(Buffer.byteLength(JSON.stringify(record)) + 2048 < MAX_MESSAGE_BYTES);
  });
});

void describe('Now Playing', () => {
  void it('invalid artwork keeps the text card and safe refusal diagnostics recover on a valid image', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start(); await world.publishSession(); await mode(world, 'free');
      await waitFor(() => world.display()?.showing === 'dashboard' && world.device.state().shown !== null ? true : undefined, 'Monitor before playback');
      const baseline = {...playbackRecord(Date.now(), ++world.revision), playback: {status: 'known' as const, player: 'playing' as const, title: 'A', artist: 'H', controls: ['pause', 'next'] as ('pause' | 'next')[]}};
      const png = await sharp({create: {width: 1, height: 1, channels: 3, background: {r: 192, g: 24, b: 48}}}).png().toBuffer();
      const invalid = {...baseline, artwork: {status: 'ready' as const, generation: '12345678-1234-4234-8234-123456789abc',
        mediaType: 'image/png' as const, width: 1, height: 1, base64: png.subarray(0, png.length - 1).toString('base64')}};
      world.playback = [invalid];
      const refusedInput = await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(invalid)});
      const textDigest = frameDigest(renderNowPlaying(nowPlayingView(baseline, {current: true})));
      await waitFor(() => world.device.state().shown?.digests[0] === textDigest ? true : undefined, 'the current text fallback');
      const decisions = (event: string) => world.logs().filter(entry => entry.event === event && entry.fields['bunny.operation'] === 'playback');
      assert.equal(decisions('operation.failed').length, 1);
      assert.equal(decisions('operation.failed')[0]?.fields['bunny.code'], 'invalid-request');
      const refusal = decisions('operation.failed')[0];
      assert.deepEqual({level: refusal?.level, trace: refusal?.trace},
        {level: 'info', trace: {traceparent: refusedInput.traceparent}}, 'validation follows the selected state trace at its registered level');

      const uploads = world.device.state().uploads;
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(invalid)});
      await sleep(1100);
      assert.equal(world.device.state().uploads, uploads, 'duplicate artwork does not upload again');
      assert.equal(decisions('operation.failed').length, 1);
      const valid = {...invalid, revision: ++world.revision, artwork: {...invalid.artwork, generation: '22345678-1234-4234-8234-123456789abc', base64: png.toString('base64')}};
      world.playback = [valid];
      const recoveredInput = await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(valid)});
      const digest = frameDigest(expectedCard(64, 'playing', false, [{text: 'A', y: 13}, {text: 'H', y: 27, artist: true}]));
      await waitFor(() => world.device.state().shown?.digests[0] === digest ? true : undefined, 'the valid image replacement');
      assert.equal(decisions('operation.completed').length, 1);
      const recovery = decisions('operation.completed')[0];
      assert.deepEqual({level: recovery?.level, trace: recovery?.trace},
        {level: 'info', trace: {traceparent: recoveredInput.traceparent}}, 'recovery follows only the current observation trace');

      const diagnostics = JSON.stringify(world.logs());
      for (const image of [invalid.artwork, valid.artwork]) assert.ok(!diagnostics.includes(image.base64) && !diagnostics.includes(image.generation));
    });
  });
  void it('renders ready playback/2.1 and keeps text cards for missing2.1 and legacy2.0 updates', async () => {
    const world = await World.open();
    await within(world, async () => {
      const baseline = {...playbackRecord(Date.now(), ++world.revision), playback: {status: 'known' as const, player: 'playing' as const, title: 'A', artist: 'H', controls: ['pause', 'next'] as ('pause' | 'next')[]}};
      const png = await sharp({create: {width: 1, height: 1, channels: 3, background: {r: 192, g: 24, b: 48}}}).png().toBuffer();
      const ready = {...baseline, playback: {...baseline.playback, player: 'paused' as const}, artwork: {status: 'ready' as const, generation: '12345678-1234-4234-8234-123456789abc', mediaType: 'image/png' as const, width: 1, height: 1,
        base64: png.toString('base64')}};
      world.playback = [ready];
      await world.start();
      await waitFor(() => world.display()?.nowPlaying.card === true ? true : undefined, 'the ready2.1 paused record accepted through initial sync');
      await world.publishSession();
      await mode(world, 'free');
      await waitFor(() => world.display()?.showing === 'dashboard' && world.device.state().shown !== null ? true : undefined, 'Monitor active with its dashboard before playback resumes');
      // Startup sync occurs while Monitor is inactive. Resume after selecting Monitor supplies its actual popup trigger.
      const playing = {...baseline, revision: ++world.revision, artwork: ready.artwork};
      world.playback = [playing];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(playing)});
      const pictureOf = (record: ReturnType<typeof playbackRecord>): string => frameDigest(renderNowPlaying(nowPlayingView(record, {current: true})));
      const artworkDigest = frameDigest(expectedCard(64, 'playing', false, [{text: 'A', y: 13}, {text: 'H', y: 27, artist: true}]));
      await waitFor(() => world.device.state().shown?.digests[0] === artworkDigest ? true : undefined, 'the module passes the synced image to its worker and device queue');
      assert.equal(world.display()?.nowPlaying.card, true);
      assert.equal(playbackState(ready).dataschema, 'https://bunny.invalid/events/playback/2.1');

      const unsupported = {...baseline, revision: ++world.revision, artwork: {status: 'unsupported' as const, generation: '22345678-1234-4234-8234-123456789abc'}};
      world.playback = [unsupported];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(unsupported)});
      await waitFor(() => world.device.state().shown?.digests[0] === pictureOf(baseline) ? true : undefined, 'same-text Sonos handoff clears the old image');
      const returned = {...playing, revision: ++world.revision, artwork: {...ready.artwork, generation: '32345678-1234-4234-8234-123456789abc'}};
      world.playback = [returned];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(returned)});
      await waitFor(() => world.device.state().shown?.digests[0] === artworkDigest ? true : undefined, 'same-text Sony return uses its new association');
      const uploads = world.device.state().uploads;
      const duplicate = {...returned, revision: ++world.revision, artwork: {...returned.artwork, generation: '42345678-1234-4234-8234-123456789abc'}};
      world.playback = [duplicate];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(duplicate)});
      await sleep(1100);
      assert.equal(world.device.state().uploads, uploads, 'identical current pixels need no duplicate upload');

      // Pause changes the visible marker, so rejection of this live2.1 record cannot pass unnoticed.
      const paused = playbackRecord(baseline.observedAtMs ?? 0, ++world.revision, 'Harvest Moon', 'paused');
      const missing = {...paused, artwork: {status: 'missing' as const, generation: ready.artwork.generation}};
      world.playback = [missing];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(missing)});
      await waitFor(() => world.device.state().shown?.digests[0] === pictureOf(paused) ? true : undefined, 'missing2.1 changed the text card to paused');

      const legacy = playbackRecord(baseline.observedAtMs ?? 0, ++world.revision);
      world.playback = [legacy];
      assert.equal(playbackState(legacy).dataschema, 'https://bunny.invalid/events/playback/2.0');
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(legacy)});
      await waitFor(() => world.device.state().shown?.digests[0] === pictureOf(legacy) ? true : undefined, 'legacy2.0 changed the text card back to playing');
    });
  });

  void it('shows the playback record\'s card as a pop-up over the status base', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.publishSession();
      await mode(world, 'free');
      await waitFor(() => world.device.state().shown === null ? undefined : true, 'the dashboard');
      const record = await world.publishPlayback();
      const card = frameDigest(renderNowPlaying(nowPlayingView(record, {current: true})));
      await waitFor(() => world.device.state().shown?.digests[0] === card ? true : undefined, 'the card on the device');
      const display = await waitFor(() => world.display()?.showing === 'card' ? world.display() : undefined, 'the card in the display record');
      assert.deepEqual(display.nowPlaying, {media: 'off', card: true, stale: false, takeover: null});
    });
  });

  void it('completes a playlist start that a whole takeover holds back as observed, and plays it once the song stops', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const whole = await accepted(world.request(FAMILIES.nowPlaying, 'org.bunny.pixoo-now-playing.set.requested', {media: 'whole'}));
      assert.equal((await world.outcome(whole)).data.result, 'succeeded');
      const rendition = await importSolid(world, [10, 20, 30], 'Teal');
      const created = await accepted(playlist(world, {operation: 'create', name: 'Desk'}));
      assert.equal((await world.outcome(created)).data.result, 'succeeded');
      const list = await waitFor(() => records<PlaylistRecord>(world, FAMILIES.playlist).find(item => item.name === 'Desk'), 'the playlist');
      const filled = await accepted(playlist(world, {operation: 'items', playlistId: list.id, revision: list.playlistRevision, items: [{renditionId: rendition.id}]}));
      assert.equal((await world.outcome(filled)).data.result, 'succeeded');
      const record = await world.publishPlayback();
      await waitFor(() => world.display()?.nowPlaying.card === true ? true : undefined, 'the song\'s card offered');
      // The start commits the playlist as the selection; the takeover pauses it for the card before its first picture
      // goes out. The selection is the start's effect, so the start is observed, not cancelled.
      const started = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}));
      assert.deepEqual((await world.outcome(started)).data, {requestId: started, result: 'succeeded', evidence: 'observed'});
      const held = await waitFor(() => world.display()?.nowPlaying.takeover === 'whole' ? world.display() : undefined, 'the whole takeover');
      assert.equal(held.player.playlistId, list.id);
      const card = frameDigest(renderNowPlaying(nowPlayingView(record, {current: true})));
      await waitFor(() => world.device.state().shown?.digests[0] === card ? true : undefined, 'the card on the device');
      // The song stops: the takeover gives the display back, and the playlist plays its picture.
      world.revision += 1;
      world.playback = [{...record, revision: world.revision, playback: {status: 'known', player: 'stopped', controls: ['play']}}];
      await world.player.publish('bunny.state.playback.presented', {kind: 'state', ...playbackState(world.playback[0] ?? record)});
      const teal = frameDigest(Buffer.alloc(12288).map((_, index) => [10, 20, 30][index % 3] ?? 0));
      await waitFor(() => world.device.state().shown?.digests[0] === teal ? true : undefined, 'the playlist\'s picture once the song stops');
    });
  });
});

async function readyPlaylist(world: World): Promise<{list: PlaylistRecord; rendition: RenditionRecord}> {
  const rendition = await importSolid(world, [10, 20, 30], 'Teal');
  await world.outcome(await accepted(playlist(world, {operation: 'create', name: 'Desk'})));
  const list = await waitFor(() => records<PlaylistRecord>(world, FAMILIES.playlist).find(item => item.name === 'Desk'), 'the playlist');
  await world.outcome(await accepted(playlist(world, {operation: 'items', playlistId: list.id, revision: list.playlistRevision, items: [{renditionId: rendition.id}]})));
  await waitFor(() => {
    const media = world.deviceRecord()?.capabilities.media;
    return media?.supported === true && media.playlistIds.includes(list.id) ? true : undefined;
  }, 'the listed playlist');
  return {list, rendition};
}

void describe('moments', () => {
  const MOMENT = 'org.bunny.moment.play.requested';
  const moment = (id: string, patch: object = {}): object => ({momentId: id, mood: 'celebrate', durationMs: 1000, priorityClass: 'event', coversStatus: true, startAtMs: Date.now(), toleranceMs: 10_000, ...patch});
  const momentFrame = (): string => frameDigest(renderMomentContent(momentContent({mood: 'celebrate'}))[0] ?? new Uint8Array());
  const ended = (world: World, requestId: string): MomentEnded | undefined =>
    world.seen.find(message => message.type === 'org.bunny.moment.ended' && (message.data as MomentEnded).requestId === requestId)?.data as MomentEnded | undefined;
  const refusal = async (pending: Promise<RequestResult>): Promise<string | undefined> => {
    const result = await pending;
    return result.status === 'rejected' ? result.error.error.code : result.status;
  };

  void it('declares the moods and bound, and plays over the status base without changing its mode, then returns and reports its ending', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const capabilities = await waitFor(() => world.deviceRecord()?.capabilities.moments, 'the capability');
      assert.deepEqual(capabilities, {supported: true, moods: ['celebrate', 'setback', 'reminder'], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['png', 'gif'], maxBytes: 163_840, notices: ['rain-forecast']}});
      await world.outcome(await mode(world, 'work'));
      await world.publishSession();
      const dashboard = await waitFor(() => world.device.state().shown?.digests[0], 'the dashboard on the device');
      const requestId = await accepted(world.request('moment-play', MOMENT, moment('m-monitor')));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the moment on the device');
      const showing = await waitFor(() => world.display()?.showing === 'moment' ? world.display() : undefined, 'the moment in the display record');
      assert.deepEqual([showing.mode, showing.base], ['work', 'status']);
      assert.deepEqual(showing.moments, {overStatus: true, playing: 'm-monitor'});
      const outcome = await world.outcome(requestId);
      assert.equal(outcome.data.result, 'succeeded');
      assert.equal(outcome.data.evidence, 'transmitted');
      assert.deepEqual({...ended(world, requestId), endedAtMs: 0}, {requestId, momentId: 'm-monitor', ending: 'completed', endedAtMs: 0});
      await waitFor(() => world.device.state().shown?.digests[0] === dashboard ? true : undefined, 'the dashboard back on the device');
      assert.equal(world.display()?.participating, true);
    });
  });

  void it('refuses what the device does not offer, what the status base in Work does not admit, and a moment it has seen, across a restart', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const send = (id: string, patch: object = {}): Promise<RequestResult> => world.request('moment-play', MOMENT, moment(id, patch));
      assert.equal(await refusal(send('m-mood', {mood: 'unknown-mood'})), 'unsupported-capability');
      assert.equal(await refusal(send('m-long', {durationMs: 10_001})), 'unsupported-capability');
      await world.outcome(await mode(world, 'work'));
      await world.publishSession();
      await waitFor(() => world.device.state().shown, 'the dashboard on the device');
      assert.equal(await refusal(send('m-flourish', {priorityClass: 'flourish', coversStatus: false})), 'invalid-state');
      assert.equal(await refusal(send('m-late', {startAtMs: Date.now() - 5000, toleranceMs: 1000})), 'invalid-state');
      const off = await accepted(world.request(FAMILIES.moments, 'org.bunny.pixoo-moments.set.requested', {overStatus: false}));
      assert.deepEqual((await world.outcome(off)).data, {requestId: off, result: 'succeeded', evidence: 'observed'});
      await waitFor(() => {
        const moments = world.deviceRecord()?.capabilities.moments;
        return moments?.supported === true && !moments.coversStatus ? true : undefined;
      }, 'the capability follows the setting');
      assert.equal(await refusal(send('m-off')), 'invalid-state');
      const on = await accepted(world.request(FAMILIES.moments, 'org.bunny.pixoo-moments.set.requested', {overStatus: true}));
      await world.outcome(on);
      await world.publishSession({attention: [{id: {status: 'known', id: 'approve-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}]});
      await waitFor(() => world.display()?.monitor.attention === 1 ? true : undefined, 'the attention');
      assert.equal(await refusal(send('m-attention')), 'invalid-state');
      await world.publishSession({attention: []});
      await waitFor(() => world.display()?.monitor.attention === 0 ? true : undefined, 'the attention resolved');
      const played = await accepted(send('m-once'));
      assert.equal(await refusal(send('m-busy')), 'capacity');
      await world.outcome(played);
      assert.equal(await refusal(send('m-once')), 'invalid-state');
      await world.restart();
      await waitFor(() => world.display(), 'the display after the restart');
      assert.equal(await refusal(send('m-once')), 'invalid-state');
    });
  });

  void it('ends over the status base when attention arrives, with no replay', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.outcome(await mode(world, 'work'));
      await world.publishSession();
      await waitFor(() => world.device.state().shown, 'the dashboard on the device');
      const requestId = await accepted(world.request('moment-play', MOMENT, moment('m-attention', {durationMs: 10_000})));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the moment on the device');
      await world.publishSession({attention: [{id: {status: 'known', id: 'approve-1'}, kind: 'approval', turn: {status: 'known', id: 'turn-1'}}]});
      const outcome = await world.outcome(requestId);
      assert.equal(outcome.data.result, 'succeeded');
      assert.equal(ended(world, requestId)?.ending, 'preempted');
      await waitFor(() => world.device.state().shown !== null && world.device.state().shown?.digests[0] !== momentFrame() ? true : undefined, 'the dashboard back on the device');
      await world.publishSession({attention: []});
      await sleep(1200);
      assert.notEqual(world.device.state().shown?.digests[0], momentFrame());
    });
  });

  void it('plays over a playing item and gives the playlist back at the same item', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const {list} = await readyPlaylist(world);
      const started = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}));
      await world.outcome(started);
      const playing = await waitFor(() => world.display()?.player.intent === 'active' ? world.display() : undefined, 'the playing playlist');
      const picture = world.device.state().shown?.digests[0];
      const requestId = await accepted(world.request('moment-play', MOMENT, moment('m-media', {priorityClass: 'flourish', coversStatus: false})));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the moment on the device');
      const showing = await waitFor(() => world.display()?.showing === 'moment' ? world.display() : undefined, 'the moment in the display record');
      assert.deepEqual([showing.mode, showing.base], ['free', 'playback']);
      assert.equal(showing.player.intent, 'paused');
      assert.equal((await world.outcome(requestId)).data.result, 'succeeded');
      assert.equal(ended(world, requestId)?.ending, 'completed');
      await waitFor(() => world.device.state().shown?.digests[0] === picture ? true : undefined, 'the playlist\'s picture back');
      const back = await waitFor(() => world.display()?.player.intent === 'active' ? world.display() : undefined, 'the playlist back');
      assert.equal(back.player.itemId, playing.player.itemId);
      assert.equal(back.mode, 'free');
    });
  });

  void it('keeps playing when next is pressed during a moment over a playing item, and blanks the art when pause is', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const {list} = await readyPlaylist(world);
      await world.outcome(await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id})));
      await waitFor(() => world.display()?.player.state === 'playing' ? true : undefined, 'the playing playlist');
      const flourish = {priorityClass: 'flourish', coversStatus: false, durationMs: 10_000};
      const first = await accepted(world.request('moment-play', MOMENT, moment('m-next', flourish)));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the moment on the device');
      const next = await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'next'}));
      assert.equal((await world.outcome(next)).data.result, 'succeeded');
      assert.equal((await world.outcome(first)).data.result, 'succeeded');
      assert.equal(ended(world, first)?.ending, 'interrupted');
      await waitFor(() => world.display()?.player.intent === 'active' ? true : undefined, 'the playlist still playing');
      await waitFor(() => world.device.state().shown?.digests[0] !== momentFrame() ? true : undefined, 'the art replaced');
      await waitFor(() => world.display()?.player.state === 'playing' ? true : undefined, 'the playlist playing again');
      const second = await accepted(world.request('moment-play', MOMENT, moment('m-pause', flourish)));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the second moment on the device');
      const paused = await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'}));
      await world.outcome(paused);
      assert.equal(ended(world, second)?.ending ?? (await world.outcome(second), ended(world, second)?.ending), 'interrupted');
      await waitFor(() => world.device.state().shown?.digests[0] === frameDigest(new Uint8Array(12288)) ? true : undefined, 'the blank frame');
      assert.equal(world.display()?.player.intent, 'paused');
    });
  });

  void it('plays over the status base with nothing loaded in Free without cover permission, leaves the player alone and returns the dashboard', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.outcome(await mode(world, 'free'));
      await world.publishSession();
      const dashboard = await waitFor(() => world.device.state().shown?.digests[0], 'the dashboard on the device');
      const requestId = await accepted(world.request('moment-play', MOMENT, moment('m-idle', {durationMs: 1000, priorityClass: 'flourish', coversStatus: false})));
      await waitFor(() => world.device.state().shown?.digests[0] === momentFrame() ? true : undefined, 'the moment on the device');
      assert.equal((await world.outcome(requestId)).data.result, 'succeeded');
      assert.equal(ended(world, requestId)?.ending, 'completed');
      await waitFor(() => world.device.state().shown?.digests[0] === dashboard ? true : undefined, 'the dashboard back on the device');
      assert.deepEqual([world.display()?.mode, world.display()?.base], ['free', 'status']);
      assert.equal(world.display()?.player.intent, 'stopped');
    });
  });

  void it('refuses while an item is paused, since nothing could repaint it', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const {list} = await readyPlaylist(world);
      await world.outcome(await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id})));
      await waitFor(() => world.display()?.player.state === 'playing' ? true : undefined, 'the playing playlist');
      await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'})));
      const uploads = world.device.state().uploads;
      assert.equal(await refusal(world.request('moment-play', MOMENT, moment('m-paused'))), 'invalid-state');
      assert.equal(world.device.state().uploads, uploads);
    });
  });

  void it('reports a moment cut off by a restart as uncertain and never plays it again', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.outcome(await mode(world, 'work'));
      await world.publishSession();
      await waitFor(() => world.device.state().shown, 'the dashboard on the device');
      const requestId = await accepted(world.request('moment-play', MOMENT, moment('m-restart', {startAtMs: Date.now() + 200, durationMs: 10_000})));
      await world.restart();
      const outcome = await world.outcome(requestId);
      assert.equal(outcome.data.result, 'uncertain');
      await sleep(600);
      assert.notEqual(world.device.state().shown?.digests[0], momentFrame());
      assert.equal(ended(world, requestId), undefined);
    });
  });
});

void describe('the device', () => {
  void it('starts while the Pixoo is offline, reports it unavailable, and logs one degradation and one recovery', async () => {
    const world = await World.open({mode: 'offline'});
    await within(world, async () => {
      await world.start();
      await waitFor(() => world.deviceRecord()?.availability === 'unavailable' ? true : undefined, 'the device unavailable');
      // Several probes fail while it stays offline.
      await sleep(900);
      const warnings = world.logs().filter(entry => entry.event === 'device.unavailable' && entry.level === 'warn');
      assert.equal(warnings.length, 1, 'one degradation, not a warning per probe');
      world.device.set('online');
      await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the device available');
      const recoveries = world.logs().filter(entry => entry.event === 'device.available');
      assert.equal(recoveries.length, 1);
      assert.ok(Number(recoveries[0]?.fields['bunny.attempt_count']) > 1, 'the recovery counts the failed probes');
      // Nothing published a device record that changed nothing.
      const records = world.seen.filter(message => message.subject === DEVICE && message.dataschema.endsWith('/device/2.3')).map(message => JSON.stringify({...message.data, revision: 0}));
      assert.equal(new Set(records).size, records.length, 'each device record differs from the one before');
    });
  });
});

void describe('another module\'s devices', () => {
  void it('serves its own device records beside another module that serves device, to a reader that names it', async () => {
    const world = await World.open();
    const lifx = world.bus.connect('bunny/modules/lifx');
    const bulb = {type: 'org.bunny.device.updated', subject: 'pendant-1', dataschema: 'https://bunny.invalid/events/device/2.0', data: {id: 'pendant-1', revision: 1}};
    await lifx.serveSync(['device'], () => ({revision: 1, states: [bulb]}));
    await within(world, async () => {
      await world.start();
      await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the live device record');
      assert.equal(world.logs().some(entry => entry.level === 'error'), false, 'no ERROR record: device is a shared family');
      // A reader names the owner it syncs device from, and gets that owner's devices only.
      const synced = await world.probe.sync<{id: string}>(['device', FAMILIES.display], () => {}, {timeoutMs: 2000, owner: 'bunny/modules/pixoo'});
      assert.equal(synced.status, 'synced');
      if (synced.status === 'synced') {
        assert.deepEqual(synced.copy.states().filter(state => state.dataschema.endsWith('/device/2.3')).map(state => state.data.id), [DEVICE]);
        await synced.copy.close();
      }
      // Without an owner, a sync of device is refused, since two modules serve it.
      const unnamed = await world.probe.sync(['device'], () => {}, {timeoutMs: 2000});
      assert.equal(unnamed.status === 'rejected' && unnamed.error.error.code, 'invalid-request');
    });
    await lifx.close();
  });
});

void describe('the copies of other owners\' records', () => {
  void it('waits quietly for a playback owner that starts later, warns once if it stays away, and records its arrival once', async () => {
    const world = await World.open({playback: false});
    await within(world, async () => {
      await world.start();
      const playback = (event: string, level: string): number =>
        world.logs().filter(entry => entry.event === event && entry.level === level && entry.fields['bunny.operation'] === 'playback').length;
      // The first attempts are DEBUG: an owner that starts after the Pixoo is no fault.
      await waitFor(() => playback('operation.failed', 'debug') >= 2 ? true : undefined, 'the quiet attempts');
      assert.equal(playback('operation.failed', 'warn'), 0);
      // Once the wait has grown to its longest, one warning says Now Playing has no source.
      await waitFor(() => playback('operation.failed', 'warn') === 1 ? true : undefined, 'one warning');
      await sleep(500);
      assert.equal(playback('operation.failed', 'warn'), 1, 'one warning, not one per attempt');
      await world.servePlayback();
      await waitFor(() => playback('operation.completed', 'info') === 1 ? true : undefined, 'one recovery');
      await world.publishPlayback();
      await waitFor(() => world.display()?.nowPlaying.card === true ? true : undefined, 'the card from the playback record');
    });
  });
});

void describe('a finished turn', () => {
  void it('is dismissed on the Pixoo only: the module acknowledges the notice for its own consumer ID', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.publishSession({activity: 'idle', notices: [{id: NOTICE, kind: 'turn-ended', turn: {status: 'known', id: 'turn-1'}, acknowledgedBy: []}]});
      await waitFor(() => world.display()?.monitor.sessions === 1 ? true : undefined, 'the session in the module\'s copy');
      const requestId = await accepted(world.request(FAMILIES.dismiss, 'org.bunny.pixoo-notice.dismiss.requested', {session: SESSION_ID, noticeId: NOTICE}));
      assert.deepEqual((await world.outcome(requestId)).data, {requestId, result: 'succeeded', evidence: 'observed'});
      const [acknowledgment] = world.acknowledged as Message<{consumerId: string; noticeId: string}>[];
      assert.equal(acknowledgment?.source, 'bunny/modules/pixoo');
      assert.equal(acknowledgment.subject, SESSION_ID);
      assert.deepEqual([acknowledgment.data.consumerId, acknowledgment.data.noticeId], ['pixoo', NOTICE]);
      const unknown = await world.request(FAMILIES.dismiss, 'org.bunny.pixoo-notice.dismiss.requested', {session: SESSION_ID, noticeId: 'd'.repeat(64)});
      assert.equal(unknown.status === 'rejected' && unknown.error.error.code, 'not-found');
      assert.equal(world.acknowledged.length, 1);
    });
  });
});

/**
 * Makes every rendition's manifest unreadable in the module's database, as a storage fault below the library would, and
 * keeps the library's schema as it was; `restore` repairs it.
 */
function corruptManifests(world: World): {restore: () => void} {
  const rewrite = (manifests: (id: string) => string): void => world.withDatabase(database => {
    const trigger = String((database.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get('immutable_rendition') as {sql: unknown}).sql);
    database.exec('BEGIN');
    try {
      database.exec('DROP TRIGGER immutable_rendition');
      for (const row of database.prepare('SELECT id FROM renditions').all()) {
        database.prepare('UPDATE renditions SET manifest_json = ? WHERE id = ?').run(manifests(String(row.id)), String(row.id));
      }
      database.exec(trigger);
      database.exec('COMMIT');
    } finally {
      if (database.isTransaction) database.exec('ROLLBACK');
    }
  });
  const saved = world.withDatabase(database =>
    new Map(database.prepare('SELECT id, manifest_json FROM renditions').all().map(row => [String(row.id), String(row.manifest_json)])));
  rewrite(() => '{');
  return {restore: () => { rewrite(id => saved.get(id) ?? '{'); }};
}
/** The module's records of `event` about its storage. */
const storageRecords = (world: World, event: string): ReturnType<World['logs']> =>
  world.logs().filter(entry => entry.event === event && entry.fields['bunny.operation'] === 'storage');

/** Counts commits on every SQLite connection: each COMMIT, and each write that runs outside a transaction. */
function countCommits(): {count: () => number; restore: () => void} {
  let commits = 0;
  const writes = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
  const exec = Reflect.get<DatabaseSync, 'exec'>(DatabaseSync.prototype, 'exec');
  const prepare = Reflect.get<DatabaseSync, 'prepare'>(DatabaseSync.prototype, 'prepare');
  DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string): void {
    if (/^\s*COMMIT\b/i.test(sql) || (!this.isTransaction && writes.test(sql))) commits += 1;
    exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string): StatementSync {
    const statement = prepare.call(this, sql);
    if (!writes.test(sql)) return statement;
    const run = statement.run.bind(statement) as (...values: SQLInputValue[]) => StatementResultingChanges;
    statement.run = ((...values: SQLInputValue[]) => {
      if (!this.isTransaction) commits += 1;
      return run(...values);
    }) as typeof statement.run;
    return statement;
  };
  return {count: () => commits, restore: () => { Object.assign(DatabaseSync.prototype, {exec, prepare}); }};
}

/** Counts reads of a rendition's frames from the media store, as a hosted rendition's validation does. */
function countFrameReads(): {count: () => number; restore: () => void} {
  let reads = 0;
  const readFrames = Reflect.get<MediaStore, 'readFrames'>(MediaStore.prototype, 'readFrames');
  MediaStore.prototype.readFrames = function (this: MediaStore, ...args: Parameters<MediaStore['readFrames']>) {
    reads += 1;
    return readFrames.apply(this, args);
  };
  return {count: () => reads, restore: () => { MediaStore.prototype.readFrames = readFrames; }};
}

void describe('commands and the catalog', () => {
  void it('commits a command\'s acceptance with its pending count, so a device command commits at most five times', async () => {
    const commits = countCommits();
    // No probe in the window: only the commands commit.
    const world = await World.open({options: {timing: {...FAST, probeMs: 60_000}}});
    try {
      await within(world, async () => {
        await world.start();
        await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the device available');
        await sleep(200);
        const before = commits.count();
        for (let index = 0; index < 5; index += 1) {
          const requestId = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 20 + index}));
          await world.outcome(requestId);
        }
        await sleep(200);
        // Acceptance with its pending count is one commit, the completion another, and the SDK outbox marks each
        // published row with one more: three rows a command.
        assert.ok(commits.count() - before <= 25, `${commits.count() - before} commits for 5 commands`);
      });
    } finally {
      commits.restore();
    }
  });

  void it('keeps what it serves at what it committed when an outcome\'s transaction rolls back', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the device available');
      // A synthetic storage failure: the module's next outcome cannot be stored, so its transaction rolls back.
      // The module keeps its file to itself (Hub #972), so the trigger goes in through its own connection.
      const database = world.harness.moduleDatabase();
      assert.ok(database);
      try {
        database.exec('CREATE TRIGGER fail_outcome BEFORE INSERT ON bunny_outbox WHEN NEW.kind = \'outcome\' BEGIN SELECT RAISE(ABORT, \'synthetic failure\'); END');
        const requestId = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent: 42}, {requestId: 'rolled-back'}));
        await waitFor(() => world.logs().some(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'storage') ? true : undefined, 'the failed write');
        await sleep(200);
        assert.equal(world.seen.some(message => message.kind === 'outcome' && (message.data as {requestId?: unknown}).requestId === requestId), false, 'no outcome went out');
        // A new copy syncs exactly what followers heard live: the last committed record, still pending, with no transmission for the command.
        const live = world.deviceRecord();
        let synced: unknown;
        const result = await world.probe.sync(['device'], change => { if (change.type === 'updated' && change.entity.id === DEVICE) synced = change.message.data; }, {timeoutMs: 2000});
        assert.equal(result.status, 'synced');
        if (result.status === 'synced') await result.copy.close();
        assert.deepEqual(synced, live, 'the synced record is the last published one');
        assert.equal(live?.pending, 1);
        const last = live?.lastTransmission;
        assert.equal(last?.status === 'known' ? last.requestId : undefined, undefined, 'the rolled-back command is not the last transmission');
      } finally {
        if (database.isOpen) database.exec('DROP TRIGGER IF EXISTS fail_outcome');
      }
      // The command was accepted and never reported, so the next start reports it uncertain, once.
      await world.restart();
      assert.equal((await world.outcome('rolled-back')).data.result, 'uncertain');
    });
  });

  void it('starts a playlist beyond the 256 its capabilities list', async () => {
    const world = await World.open();
    await within(world, async () => {
      let last = '';
      await world.populate(async library => {
        const {rendition} = await library.importMedia(bytesOf(await solid([0, 0, 255])), 'Blue');
        for (let index = 0; index < 257; index += 1) {
          const created = await library.createPlaylist(`List ${String(index)}`);
          await library.replaceItems(created.id, created.revision, [{renditionId: rendition.id}]);
        }
        // The catalog lists playlists in the library's order, by creation time and then ID, and several share a
        // millisecond here, so the one beyond the 256 listed is the library's last, not the last created.
        last = (await library.listPlaylists()).at(-1)?.id ?? '';
      });
      await world.start();
      // At once after the start, before the catalog has been read, and again once the device record lists 256 playlists.
      const requestId = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: last}));
      const started = (await world.outcome(requestId, 10_000)).data;
      assert.deepEqual([started.result, started.evidence], ['succeeded', 'transmitted'], JSON.stringify(started));
      const listed = await waitFor(() => {
        const media = world.deviceRecord()?.capabilities.media;
        return media?.supported === true && media.playlistIds.length === 256 ? media.playlistIds : undefined;
      }, 'the device record listing 256 playlists', 10_000);
      assert.equal(listed.includes(last), false, 'the 257th playlist is beyond the listed ones');
      const again = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: last}));
      assert.equal((await world.outcome(again, 10_000)).data.result, 'succeeded');
      const unknown = await world.request('media-start', 'org.bunny.media.start.requested', {playlistId: '00000000-0000-4000-8000-0000000000ff'});
      assert.equal(unknown.status === 'rejected' && unknown.error.error.code, 'unsupported-capability');
    });
  });

  void it('refuses a sync of its catalog as unavailable while the catalog cannot be read, and serves it once it can', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.populate(async library => { await library.importMedia(bytesOf(await solid([0, 0, 255])), 'Blue'); });
      // A storage fault: the rendition's manifest is no longer JSON, so every read of the catalog fails.
      const manifest = corruptManifests(world);
      await world.start();
      const asked = performance.now();
      const refused = await world.probe.sync([FAMILIES.rendition], () => {}, {timeoutMs: 5000});
      assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unavailable');
      assert.ok(performance.now() - asked < 2000, `refused after ${String(Math.round(performance.now() - asked))} ms, not at the sync's deadline`);
      // The device record is still served, and the reads that keep failing are one record.
      assert.equal((await world.synced('device')).length, 1);
      await sleep(300);
      assert.equal(storageRecords(world, 'operation.failed').length, 1, 'one record for the run of failed reads');
      // The fault is repaired: the next read serves the catalog, and logs the recovery once.
      manifest.restore();
      await waitFor(() => storageRecords(world, 'operation.completed').length === 1 ? true : undefined, 'the recovery');
      assert.deepEqual((await world.synced<RenditionRecord>(FAMILIES.rendition)).map(item => item.name), ['Blue']);
    });
  });

  void it('completes a catalog command with its outcome though the read of the catalog after it fails', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.populate(async library => { await library.importMedia(bytesOf(await solid([0, 0, 255])), 'Blue'); });
      await world.start();
      assert.equal((await world.synced<RenditionRecord>(FAMILIES.rendition)).length, 1);
      const manifest = corruptManifests(world);
      // The library commits the playlist; the read after it fails. The outcome goes out at once, not at the next start.
      const created = await accepted(playlist(world, {operation: 'create', name: 'Desk'}));
      assert.deepEqual((await world.outcome(created, 3000)).data, {requestId: created, result: 'succeeded', evidence: 'observed'});
      assert.equal(world.deviceRecord()?.pending, 0);
      await sleep(300);
      assert.equal(storageRecords(world, 'operation.failed').length, 1, 'one record for the run of failed reads');
      // Once the catalog can be read again, the playlist goes out without another command.
      manifest.restore();
      await waitFor(() => records<PlaylistRecord>(world, FAMILIES.playlist).find(item => item.name === 'Desk'), 'the playlist, published live');
      assert.equal(storageRecords(world, 'operation.completed').length, 1, 'one recovery');
    });
  });

  void it('starts without reading its library\'s frames, within a bound, and checks each hosted rendition\'s frames once', async () => {
    const reads = countFrameReads();
    const world = await World.open({section: {device: {...SECTION.device, profile: HOSTED_PROFILE}}});
    try {
      await within(world, async () => {
        const count = 16;
        await world.populate(async library => {
          for (let index = 0; index < count; index += 1) await library.importMedia(bytesOf(hostedGif(index + 1, 50)), `Clip ${String(index)}`);
          await library.importMedia(bytesOf(manyColorGif()), 'Too many colors');
        });
        // A saved result from the historical 500-frame policy must not veto the current hosted command.
        world.withDatabase(db => {
          const store = new PixooStore(db);
          for (const row of db.prepare('SELECT id FROM renditions').all()) store.saveHostedCheck(String(row.id), HOSTED_PROFILE, false);
        });
        const before = reads.count(), started = performance.now();
        await world.start();
        const startMs = performance.now() - started;
        assert.equal(reads.count() - before, 0, 'the start read no rendition\'s frames');
        assert.ok(startMs < 1500, `the start took ${String(Math.round(startMs))} ms`);
        // A reader's sync waits for the first read of the catalog, which reads no frames either: until its frames are
        // checked, a hosted rendition is listed as its timing allows.
        const listed = await world.synced<RenditionRecord>(FAMILIES.rendition);
        assert.equal(listed.length, count + 1);
        // After the start, each one's frames are checked once, and the one whose colors do not fit goes out incompatible.
        await waitFor(() => reads.count() - before === count + 1 ? true : undefined, 'one check of each hosted rendition\'s frames', 20_000);
        const checked = await waitFor(() => records<RenditionRecord>(world, FAMILIES.rendition).find(item => item.name === 'Too many colors' && !item.compatible), 'the incompatible clip');
        assert.equal(checked.compatible, false);
        const synced = await world.synced<RenditionRecord>(FAMILIES.rendition);
        assert.deepEqual(synced.filter(item => !item.compatible).map(item => item.name), ['Too many colors']);
        // A playlist edit reads no frames, and neither does the next start: compatibility is kept per rendition and profile.
        const edit = await accepted(playlist(world, {operation: 'create', name: 'Clips'}));
        assert.equal((await world.outcome(edit)).data.result, 'succeeded');
        await world.restart();
        await waitFor(() => world.deviceRecord()?.availability === 'available' ? true : undefined, 'the restarted device');
        await sleep(300);
        assert.equal(reads.count() - before, count + 1, 'no frames read for the edit or the restart');
        assert.deepEqual((await world.synced<RenditionRecord>(FAMILIES.rendition)).filter(item => !item.compatible).map(item => item.name), ['Too many colors'],
          'the kept check survives the restart');
        // A new hosted clip's frames are checked once, at its import, before its outcome.
        const imported = await accepted(asset(world, {operation: 'import', name: 'New clip', content: {inline: hostedGif(99, 20).toString('base64')}}));
        assert.equal((await world.outcome(imported, 20_000)).data.result, 'succeeded');
        assert.equal(reads.count() - before, count + 2);
        assert.ok(records<RenditionRecord>(world, FAMILIES.rendition).some(item => item.name === 'New clip' && item.compatible), 'the new clip went out live');
        assert.equal((await world.synced<RenditionRecord>(FAMILIES.rendition)).length, count + 2);
      });
    } finally {
      reads.restore();
    }
  });
});

// ADR 0014: the Pixoo takes the Hub's Work, Free and Quiet as policy only. Work refuses playback starts and stops what
// plays; Quiet writes its brightness and leaving it restores the remembered one; startup applies nothing; and a command
// that carries `requireMode` is refused.
void describe('Hub mode', () => {
  const refusals = (world: World, code: string): number => world.logs().filter(entry => entry.event === 'command.rejected' && entry.fields['bunny.code'] === code).length;
  const brightness = async (world: World, percent: number): Promise<void> => {
    const requestId = await accepted(world.request('brightness-set', 'org.bunny.brightness.set.requested', {percent}));
    assert.equal((await world.outcome(requestId)).data.result, 'succeeded');
  };

  void it('advertises the Hub\'s modes, saves each without touching the player, and reports it as the desired mode (AC1)', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const record = await waitFor(() => world.deviceRecord(), 'the device record');
      assert.deepEqual(record.capabilities.modes, {supported: true, values: ['work', 'free', 'quiet']});
      assert.deepEqual(record.desired.mode, {status: 'known', value: 'free'}, 'Free before any mode');
      for (const value of ['free', 'work'] as const) {
        const requestId = await mode(world, value);
        assert.deepEqual((await world.outcome(requestId)).data, {requestId, result: 'succeeded', evidence: 'observed'}, value);
        await waitFor(() => world.deviceRecord()?.desired.mode.status === 'known' && world.display()?.mode === value ? true : undefined, `${value} in the records`);
        assert.deepEqual(world.deviceRecord()?.desired.mode, {status: 'known', value});
        assert.deepEqual([world.display()?.base, world.display()?.player.intent, world.display()?.pendingMode], ['status', 'stopped', null]);
      }
      assert.equal(world.device.state().writes, 0, 'no brightness write without Quiet');
    });
  });

  void it('refuses playback starts in Work, plays them in Free, and Work stops playback with no resume on Free (AC2)', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const {list, rendition} = await readyPlaylist(world);
      await world.outcome(await mode(world, 'work'));
      await world.publishSession();
      await waitFor(() => world.display()?.participating === true ? true : undefined, 'the status base');
      const before = world.device.state(), refused = refusals(world, 'invalid-state');
      const results = [
        await world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}),
        await world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId: rendition.id}),
      ];
      for (const result of results) {
        assert.deepEqual(result.status === 'rejected' && [result.error.error.code, result.error.error.detail], ['invalid-state', 'playback is not admitted in Work'], JSON.stringify(result));
      }
      assert.equal(refusals(world, 'invalid-state'), refused + 2, 'each refusal is a command.rejected record');
      assert.deepEqual([world.device.state().uploads, world.device.state().writes], [before.uploads, before.writes], 'nothing reached the device');
      await world.outcome(await mode(world, 'free'));
      const started = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}));
      assert.deepEqual((await world.outcome(started)).data, {requestId: started, result: 'succeeded', evidence: 'transmitted'});
      await waitFor(() => world.display()?.base === 'playback' && world.display()?.player.intent === 'active' ? true : undefined, 'the playback base');
      // Work stops it: the mode command completes as that stop, the status base returns, and the item is kept.
      const working = await mode(world, 'work');
      assert.deepEqual((await world.outcome(working)).data, {requestId: working, result: 'succeeded', evidence: 'observed'});
      const stopped = await waitFor(() => world.display()?.base === 'status' && world.display()?.participating === true ? world.display() : undefined, 'the status base after Work');
      assert.deepEqual([stopped.player.intent, stopped.player.playlistId], ['stopped', list.id]);
      // A resume and a restart-with-changes are starts too, refused in Work while something is selected.
      for (const action of ['resume', 'restart-with-changes'] as const) {
        const result = await world.request('media-control', 'org.bunny.media.control.requested', {action});
        assert.equal(result.status === 'rejected' && result.error.error.code, 'invalid-state', action);
      }
      const uploads = world.device.state().uploads;
      await world.outcome(await mode(world, 'free'));
      await sleep(600);
      assert.equal(world.display()?.player.intent, 'stopped', 'nothing resumes when Free returns');
      assert.ok(world.device.state().uploads - uploads <= 1, 'at most the dashboard repainted');
    });
  });

  void it('writes the Quiet brightness once, restores the remembered brightness on leaving, and a brightness set in Quiet lasts until the next mode (AC3)', async () => {
    const world = await World.open({section: {...SECTION, quietBrightness: 20}});
    await within(world, async () => {
      await world.start();
      await brightness(world, 100);
      let writes = world.device.state().writes;
      const quiet = await mode(world, 'quiet');
      assert.deepEqual((await world.outcome(quiet)).data, {requestId: quiet, result: 'succeeded', evidence: 'transmitted'});
      assert.deepEqual([world.device.state().brightness, world.device.state().writes], [20, writes + 1], 'the Quiet level, written once');
      await brightness(world, 40);
      assert.equal(world.device.state().brightness, 40, 'honoured during Quiet');
      writes = world.device.state().writes;
      const work = await mode(world, 'work');
      assert.deepEqual((await world.outcome(work)).data, {requestId: work, result: 'succeeded', evidence: 'transmitted'});
      assert.deepEqual([world.device.state().brightness, world.device.state().writes], [100, writes + 1], 'the brightness requested before Quiet');
      // Work in Work and Free from Work write nothing; Quiet received in Quiet rewrites the Quiet level.
      writes = world.device.state().writes;
      for (const value of ['work', 'free'] as const) assert.equal((await world.outcome(await mode(world, value))).data.evidence, 'observed', value);
      assert.equal(world.device.state().writes, writes);
      await world.outcome(await mode(world, 'quiet'));
      await brightness(world, 60);
      const again = await mode(world, 'quiet');
      assert.equal((await world.outcome(again)).data.evidence, 'transmitted');
      assert.equal(world.device.state().brightness, 20, 'a Quiet reapply rewrites the Quiet level');
    });
  });

  void it('applies nothing at startup: a restart in Quiet reports Quiet and writes nothing until the next mode command', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await brightness(world, 80);
      await world.outcome(await mode(world, 'quiet'));
      assert.equal(world.device.state().brightness, 20, 'the default Quiet brightness');
      await world.restart();
      const record = await waitFor(() => world.deviceRecord()?.desired.mode.status === 'known' ? world.deviceRecord() : undefined, 'the record after the restart');
      assert.deepEqual(record.desired.mode, {status: 'known', value: 'quiet'});
      const writes = world.device.state().writes;
      await sleep(600);
      assert.equal(world.device.state().writes, writes, 'no brightness or player write at startup');
      const free = await mode(world, 'free');
      assert.equal((await world.outcome(free)).data.evidence, 'transmitted');
      assert.equal(world.device.state().brightness, 80, 'the remembered brightness, kept across the restart');
    });
  });

  void it('refuses a command that carries requireMode with invalid-request, and a start while a mode change is pending with invalid-state', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      const {list, rendition} = await readyPlaylist(world);
      const before = world.device.state(), refused = refusals(world, 'invalid-request');
      for (const requireMode of ['media', 'monitor', 'free']) {
        const start = await world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id, requireMode});
        assert.deepEqual(start.status === 'rejected' && [start.error.error.code, start.error.error.detail], ['invalid-request', 'the Pixoo takes no mode precondition from a caller'], requireMode);
        const control = await world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause', requireMode});
        assert.equal(control.status === 'rejected' && control.error.error.code, 'invalid-request', requireMode);
      }
      assert.equal(refusals(world, 'invalid-request'), refused + 6);
      // The show's closed schema no longer has the member, so it breaks the schema.
      const show = await world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId: rendition.id, requireMode: 'media'});
      assert.equal(show.status === 'rejected' && show.error.error.code, 'invalid-message');
      assert.deepEqual([world.device.state().uploads, world.device.state().writes], [before.uploads, before.writes], 'nothing reached the device');
      // Admissions run one at a time, and a mode change stays pending until its outcome commits, so a start sent right
      // behind it is checked while it is pending.
      const [changing, started] = await Promise.all([
        world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'free'}),
        world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}),
      ]);
      assert.equal(changing.status, 'accepted');
      assert.deepEqual(started.status === 'rejected' && [started.error.error.code, started.error.error.detail], ['invalid-state', 'a mode change is pending']);
      await world.outcome(changing.requestId);
      const plain = await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId: list.id}));
      assert.equal((await world.outcome(plain)).data.result, 'succeeded');
      await waitFor(() => world.display()?.player.playlistId === list.id ? true : undefined, 'the playing playlist');
    });
  });
});
