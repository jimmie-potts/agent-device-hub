import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {it} from 'node:test';
import type {ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type ModuleContent} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import sharp from 'sharp';
import {Library} from '../../src/library/index.js';
import {PIXOO64_HOSTED_PROFILE} from '../../src/media/contracts.js';
import {createPixooModule} from '../../src/module/module.js';
import {SimulatedPixoo} from '../../src/module/transport.js';
import {SECTION, FAST, bytesOf, hostedGif} from './support.js';

const JSON_LIMIT = 256 * 1024;
type PlaylistPage = {items: {id: string; name: string}[]; total: number; offset: number; limit: number; catalogRevision: number};
const request = (query: Readonly<Record<string, string>> = {}) => ({query, signal: new AbortController().signal});
function json<T>(result: ModuleContent | ErrorBody | undefined): T {
  assert.ok(result !== undefined && !('error' in result), 'a content read succeeded');
  assert.equal(result.type, 'application/json');
  assert.ok(result.bytes.byteLength <= JSON_LIMIT, 'JSON is bounded in bytes');
  return JSON.parse(Buffer.from(result.bytes).toString('utf8')) as T;
}

async function fixture(fill: (library: Library) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pixoo-content-'));
  const module = createPixooModule({transport: new SimulatedPixoo(), timing: FAST});
  const bus = new InProcessBus();
  const core = bus.connect('bunny/core');
  const playback = bus.connect('bunny/modules/playback');
  const harness = new ModuleHarness(module, {bus, stateDir: root, section: SECTION});
  try {
    const database = new DatabaseSync(join(root, 'pixoo.sqlite'));
    try {
      database.exec('PRAGMA synchronous=OFF');
      const library = await Library.attach({database, directory: join(root, 'pixoo')});
      try { await fill(library); } finally { await library.close(); }
    } finally { database.close(); }
    await core.serveSync(['session'], () => ({revision: 1, states: []}));
    await playback.serveSync(['playback'], () => ({revision: 1, states: []}));
    await harness.start();
    return {module, harness, async close() {
      await harness.stop();
      await core.close();
      await playback.close();
      await rm(root, {recursive: true, force: true});
    }};
  } catch (error) {
    await harness.stop();
    await core.close();
    await playback.close();
    await rm(root, {recursive: true, force: true});
    throw error;
  }
}

void it('splits an oversized playlist catalog into bounded SQL pages with every entry reachable', async () => {
  const expected: string[] = [];
  const world = await fixture(async library => {
    for (let index = 0; index < 700; index += 1) expected.push((await library.createPlaylist('界'.repeat(115) + String(index))).id);
  });
  try {
    const read = world.module.manifest.content;
    assert.ok(read, 'the running Pixoo declares content reads');
    const entries: {id: string; name: string}[] = [];
    for (let offset = 0; offset < expected.length; offset += 100) {
      const page: PlaylistPage = json<PlaylistPage>(
        await read('catalog-playlists', request({q: '界', offset: String(offset), limit: '100'})));
      assert.equal(page.total, expected.length);
      assert.equal(page.offset, offset);
      assert.equal(page.limit, 100);
      assert.ok(Number.isSafeInteger(page.catalogRevision));
      assert.equal(page.items.length, 100);
      entries.push(...page.items);
    }
    assert.ok(Buffer.byteLength(JSON.stringify(entries)) > JSON_LIMIT, 'the aggregate exceeds the page byte budget');
    assert.deepEqual(new Set(entries.map(item => item.id)), new Set(expected));
    assert.equal(entries.length, expected.length, 'no repeated rows between pages');
    assert.deepEqual(json<{items: unknown[]}>(await read('catalog-playlists', request({offset: '700'}))).items, []);
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('resolves selected media and a referenced synthetic PNG without changing the catalog', async () => {
  let assetId = '', renditionId = '';
  const source = await sharp({create: {width: 64, height: 64, channels: 3, background: {r: 12, g: 34, b: 56}}}).png().toBuffer();
  const world = await fixture(async library => {
    const imported = await library.importMedia(bytesOf(source), 'Synthetic');
    assetId = imported.asset.id;
    renditionId = imported.rendition.id;
  });
  try {
    const read = world.module.manifest.content;
    assert.ok(read);
    const before = json<{catalogRevision: number; items: {renditionId: string; compatible: boolean}[]}>(await read('catalog-media', request()));
    assert.equal(before.items[0]?.renditionId, renditionId);
    assert.equal(before.items[0]?.compatible, true);
    const player = json<{state: {state: string}; session: unknown; sampledAtMs: number; simulated: boolean}>(await read('player', request()));
    assert.equal(player.state.state, 'idle');
    assert.equal(player.session, null);
    assert.equal(player.simulated, true);
    assert.ok(Number.isFinite(player.sampledAtMs));
    const asset = json<{asset: {id: string}; renditions: {id: string; transform: object}[]}>(await read(`asset.${assetId}`, request()));
    assert.equal(asset.asset.id, assetId);
    assert.equal(asset.renditions[0]?.id, renditionId);
    assert.equal(typeof asset.renditions[0]?.transform, 'object');
    assert.ok(!Object.hasOwn(asset.renditions[0] ?? {}, 'frames'), 'asset selection does not multiply frame manifests');
    assert.equal(json<{id: string}>(await read(`rendition.${renditionId}`, request())).id, renditionId);
    const preview = json<{renditionId: string; frameCount: number; frames: {index: number}[]}>(await read(`preview.${renditionId}`, request()));
    assert.equal(preview.renditionId, renditionId);
    assert.equal(preview.frameCount, 1);
    const frame = await read(`frame.${renditionId}.${preview.frames[0]?.index}`, request());
    assert.ok(frame !== undefined && !('error' in frame));
    assert.equal(frame.type, 'image/png');
    assert.ok(frame.bytes.byteLength <= 64 * 1024);
    const pixels = await sharp(frame.bytes).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixels.subarray(0, 3)], [12, 34, 56]);
    const thumbnail = await read(`thumbnail.${renditionId}`, request());
    assert.ok(thumbnail !== undefined && !('error' in thumbnail));
    assert.deepEqual(thumbnail.bytes, frame.bytes);
    assert.deepEqual(json(await read('catalog-media', request())), before, 'reads do not move owner revision');
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('returns safe invalid/not-found refusals and remains usable after bad reads', async () => {
  let playlistId = '';
  const world = await fixture(async library => { playlistId = (await library.createPlaylist('Saved')).id; });
  try {
    const read = world.module.manifest.content;
    assert.ok(read);
    for (const [ref, query, code] of [
      ['catalog-media', {extra: 'x'}, 'invalid-request'],
      ['player', {extra: 'x'}, 'invalid-request'],
      ['catalog-playlists', {limit: '101'}, 'invalid-request'],
      ['catalog-playlists', {offset: '-1'}, 'invalid-request'],
      ['catalog-playlists', {offset: '1e2'}, 'invalid-request'],
      ['catalog-playlists', {q: 'x'.repeat(121)}, 'invalid-request'],
      [`playlist.${playlistId}`, {q: 'x'}, 'invalid-request'],
      ['playlist.bad-id', {}, 'invalid-request'],
      [`playlist.${randomUUID()}`, {}, 'not-found'],
      [`frame.${'a'.repeat(64)}.99999`, {}, 'invalid-request'],
      [`preview.${'a'.repeat(64)}`, {}, 'not-found'],
      ['unknown', {}, 'not-found'],
    ] as const) {
      const result = await read(ref, request(query));
      assert.ok(result !== undefined && 'error' in result);
      assert.equal(result.error.code, code);
      assert.ok(!JSON.stringify(result).includes(ref), 'refusal does not echo the requested reference');
    }
    const stopped = new AbortController();
    stopped.abort();
    const result = await read('catalog-media', {query: {}, signal: stopped.signal});
    assert.ok(result !== undefined && 'error' in result);
    assert.equal(result.error.code, 'cancelled');
    const cancelledPlayer = await read('player', {query: {}, signal: stopped.signal});
    assert.ok(cancelledPlayer !== undefined && 'error' in cancelledPlayer);
    assert.equal(cancelledPlayer.error.code, 'cancelled');
    assert.equal(json<{playlist: {id: string}}>(await read(`playlist.${playlistId}`, request())).playlist.id, playlistId);
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('pages media using kept hosted compatibility without reading frames or writing checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pixoo-cached-content-'));
  const database = new DatabaseSync(join(root, 'catalog.sqlite'));
  let kept: boolean | undefined;
  let writes = 0;
  const library = await Library.attach({database, directory: root, hostedChecks: {
    get: () => kept, set: () => { writes += 1; },
  }});
  try {
    const imported = await library.importMedia(bytesOf(hostedGif(0, 2)), 'Animation');
    const second = await library.renderAsset(imported.asset.id, {transform: {fit: 'fit', scaling: 'nearest', background: [1, 0, 0]}});
    const third = await library.renderAsset(imported.asset.id, {transform: {fit: 'fit', scaling: 'nearest', background: [2, 0, 0]}});
    // A catalog read uses metadata and kept checks, not the immutable frame files.
    await rm(join(root, 'media', 'renditions', imported.rendition.id, '0.rgb'));
    const first = await library.queryMediaCached({q: 'Animation', offset: 0, limit: 1}, PIXOO64_HOSTED_PROFILE);
    assert.equal(first.total, 3);
    assert.equal(first.items[0]?.compatible, undefined, 'unchecked is not asserted compatible');
    kept = false;
    const rejected = await library.queryMediaCached({q: '', offset: 0, limit: 1}, PIXOO64_HOSTED_PROFILE);
    assert.equal(rejected.items[0]?.compatible, false);
    kept = true;
    const qualified = await library.queryMediaCached({q: '', offset: 0, limit: 1}, PIXOO64_HOSTED_PROFILE);
    assert.equal(qualified.items[0]?.compatible, true);
    assert.equal(qualified.catalogRevision, first.catalogRevision);
    assert.equal(writes, 0, 'read-side hosted evidence never writes');
    const ids = [first.items[0]?.renditionId];
    for (const offset of [1, 2]) ids.push((await library.queryMediaCached({q: '', offset, limit: 1}, PIXOO64_HOSTED_PROFILE)).items[0]?.renditionId);
    assert.deepEqual(new Set(ids), new Set([imported.rendition.id, second.rendition.id, third.rendition.id]));
    assert.equal((await library.queryMediaCached({q: '', offset: 3, limit: 1}, PIXOO64_HOSTED_PROFILE)).items.length, 0);
  } finally {
    await library.close();
    database.close();
    await rm(root, {recursive: true, force: true});
  }
});
