// The Pixoo module's behavior on the bus (Hub #843): Monitor follows the core's sessions, Media commands complete with
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
import {checkModuleRecord} from '@jimmie-potts/sdk/testing';
import sharp from 'sharp';
import {DEFAULT_LIMITS, DEFAULT_TRANSFORM, MediaStore, SIMULATOR_PROFILE} from '../../src/media/index.js';
import {runWorker} from '../../src/media/worker-client.js';
import {DashboardPager} from '../../src/presentation/agent-dashboard.js';
import {renderDashboard} from '../../src/presentation/dashboard-pixels.js';
import {nowPlayingView, renderNowPlaying} from '../../src/presentation/now-playing.js';
import {monitorView} from '../../src/presentation/sources.js';
import {HOSTED_PROFILE} from '../../src/module/configuration.js';
import {FAMILIES, type PlaylistRecord, type RenditionRecord} from '../../src/module/schemas.js';
import {frameDigest} from '../../src/module/transport.js';
import {DEVICE, FAST, SECTION, SESSION_ID, World, bytesOf, declaredPng, hostedGif, manyColorGif, sleep, waitFor} from './support.js';

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
const mode = (world: World, value: 'monitor' | 'media'): Promise<string> =>
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
      const requestId = await mode(world, 'monitor');
      assert.deepEqual((await world.outcome(requestId)).data, {requestId, result: 'succeeded', evidence: 'observed'});
      // The device shows the dashboard the presentation renders from the synced session: two frames, pulsing for approval.
      const layout = new DashboardPager().layout(monitorView({state: 'current', revision: session.revision, sessions: [session]}), Date.now());
      const expected = renderDashboard(layout).map(frameDigest);
      assert.equal(expected.length, 2);
      await waitFor(() => JSON.stringify(world.device.state().shown?.digests) === JSON.stringify(expected) ? true : undefined, 'the approval dashboard on the device');
      const display = await waitFor(() => world.display()?.showing === 'dashboard' ? world.display() : undefined, 'the display record');
      assert.deepEqual([display.mode, display.participating, display.monitor.matched, display.monitor.attention], ['monitor', true, 1, 1]);
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
      await mode(world, 'monitor');
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
      const stale = await world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'monitor', expectedConfigurationRevision: 99});
      assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
      const unsupported = await world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work'});
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
  void it('shows the playback record\'s card as a pop-up over Monitor', async () => {
    const world = await World.open();
    await within(world, async () => {
      await world.start();
      await world.publishSession();
      await mode(world, 'monitor');
      await waitFor(() => world.device.state().shown === null ? undefined : true, 'the dashboard');
      const record = await world.publishPlayback();
      const card = frameDigest(renderNowPlaying(nowPlayingView(record, {current: true})));
      await waitFor(() => world.device.state().shown?.digests[0] === card ? true : undefined, 'the card on the device');
      const display = await waitFor(() => world.display()?.showing === 'card' ? world.display() : undefined, 'the card in the display record');
      assert.deepEqual(display.nowPlaying, {media: 'off', card: true, stale: false, takeover: null});
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
      const records = world.seen.filter(message => message.subject === DEVICE && message.dataschema.endsWith('/device/2.0')).map(message => JSON.stringify({...message.data, revision: 0}));
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
        assert.deepEqual(synced.copy.states().filter(state => state.dataschema.endsWith('/device/2.0')).map(state => state.data.id), [DEVICE]);
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
      const database = new DatabaseSync(world.databaseFile);
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
        database.exec('DROP TRIGGER IF EXISTS fail_outcome');
        database.close();
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
          last = created.id;
        }
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
