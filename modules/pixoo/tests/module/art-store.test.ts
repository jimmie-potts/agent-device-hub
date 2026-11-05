import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {it} from 'node:test';
import type {ArtStageRequest} from '@jimmie-potts/event-contracts/v2/art';
import {SdkError} from '@jimmie-potts/sdk';
import {PixooArt, MAX_ART_COPIES} from '../../src/module/art.js';
import {Library} from '../../src/library/index.js';
import {PIXOO64_GIF_PROFILE} from '../../src/media/index.js';
import {bytesOf, hostedGif} from './support.js';

const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const stage = (name: string, bytes = hostedGif(17, 8)): ArtStageRequest => ({requestId: name, compositionId: hash(name), format: 'gif',
  width: 64, height: 64, frames: 8, durationMs: 800, sha256: hash(bytes), base64: bytes.toString('base64'), lifetimeMs: 60_000});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pixoo-art-store-')), db = new DatabaseSync(join(root, 'pixoo.sqlite'));
  let now = 1000;
  const controller = new AbortController();
  const art = new PixooArt(db, join(root, 'art'), PIXOO64_GIF_PROFILE, () => now, controller.signal);
  await art.initialize();
  return {root, db, art, controller, now: () => now, advance: (ms: number) => { now += ms; },
    async close() { controller.abort(); await art.close(); db.close(); await rm(root, {recursive: true, force: true}); }};
}

void it('expiry preserves active copies and all permanent library originals and referenced renditions', async () => {
  const w = await fixture();
  const library = await Library.attach({database: w.db, directory: w.root});
  try {
    const bytes = hostedGif(17, 8), data = stage('leased', bytes);
    const imported = await library.importMedia(bytesOf(bytes), 'Saved art', {profile: PIXOO64_GIF_PROFILE});
    const reference = await library.retainSession([imported.rendition.id]);
    await w.art.stage(data, w.now());
    const held = w.art.retain(data.compositionId), before = await held.frames();
    w.advance(60_001);
    assert.equal(w.art.referenceRefusal(data.compositionId)?.error.code, 'not-found');
    await w.art.prune();
    assert.deepEqual(await held.frames(), before);
    assert.equal((await readdir(join(w.root, 'art'))).length, 1);
    held.release(); held.release();
    await w.art.prune();
    assert.deepEqual(await readdir(join(w.root, 'art')), []);
    assert.deepEqual(await readFile(join(w.root, 'media', 'originals', data.sha256)), bytes);
    assert.deepEqual(await library.readFrame(imported.rendition.id, 0, 'rgb'), before[0]);
    await library.releaseSession(reference.id);
  } finally { await library.close(); await w.close(); }
});

void it('a replacement after expiry cannot change the bytes held by the earlier moment', async () => {
  const w = await fixture();
  try {
    const first = stage('replace'), replacement = stage('replace', hostedGif(19, 8));
    await w.art.stage(first, w.now());
    const old = w.art.retain(first.compositionId), pixels = await old.frames();
    w.advance(60_001);
    await w.art.stage(replacement, w.now());
    const current = w.art.retain(first.compositionId);
    assert.notDeepEqual(await current.frames(), pixels);
    assert.deepEqual(await old.frames(), pixels);
    old.release(); await w.art.prune();
    assert.equal((await readdir(join(w.root, 'art'))).length, 1);
    current.release();
  } finally { await w.close(); }
});

void it('failed metadata never retains an orphan and startup removes interrupted private staging only', async () => {
  const w = await fixture();
  try {
    await assert.rejects(w.art.stage({...stage('wrong'), durationMs: 900}, w.now()), {code: 'invalid-input'});
    assert.deepEqual(await readdir(join(w.root, 'art')), []);
    const valid = stage('valid'); await w.art.stage(valid, w.now());
    const orphan = join(w.root, 'art', '1'.repeat(64));
    await mkdir(orphan); await writeFile(join(orphan, 'interrupted'), 'synthetic');
    const startup = new PixooArt(w.db, join(w.root, 'art'), PIXOO64_GIF_PROFILE, w.now, w.controller.signal);
    await startup.initialize();
    assert.equal((await readdir(join(w.root, 'art'))).length, 1);
    assert.equal(startup.referenceRefusal(valid.compositionId), undefined);
    const held = startup.retain(valid.compositionId); assert.equal((await held.frames()).length, 8); held.release();
    await startup.close();
  } finally { await w.close(); }
});

void it('bounds live copies and frees capacity only after expiry without changing a retained identity', async () => {
  const w = await fixture();
  try {
    const data = stage('capacity'); await w.art.stage(data, w.now());
    const original = w.db.prepare('SELECT * FROM pixoo_art_copies').get(); assert.ok(original);
    const add = w.db.prepare('INSERT INTO pixoo_art_copies SELECT ?, sha256, rendition_id, expires_at_ms, profile, delay_ms FROM pixoo_art_copies WHERE composition_id = ?');
    for (let i = 1; i < MAX_ART_COPIES; i += 1) add.run(hash(String(i)), data.compositionId);
    assert.equal(w.art.stageRefusal(stage('over-capacity'))?.error.code, 'capacity');
    assert.equal(w.art.stageRefusal(data), undefined);
    w.advance(60_001); await w.art.prune();
    assert.equal(w.art.stageRefusal(stage('over-capacity')), undefined);
    assert.throws(() => w.art.retain(data.compositionId), (error: unknown) => error instanceof SdkError && error.body.error.code === 'not-found');
  } finally { await w.close(); }
});
