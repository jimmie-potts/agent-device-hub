import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it} from 'node:test';
import {errorBody, type ErrorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type ModuleStagedUpload, type ModuleUploadReply, type ModuleUploadRequest} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import sharp from 'sharp';
import {createPixooModule} from '../../src/module/module.js';
import {FAMILIES, schemaOf} from '../../src/module/schemas.js';
import {SimulatedPixoo} from '../../src/module/transport.js';
import {DEVICE, FAST, SECTION, waitFor} from './support.js';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type UploadOutcome = Message<{requestId: string; result: string; evidence: string; error?: {code: string}}>;
const request = (bytes: Uint8Array, requestId: string, patch: Partial<ModuleUploadRequest> = {}): ModuleUploadRequest =>
  ({target: DEVICE, requestId, name: 'Synthetic', bytes, signal: new AbortController().signal, ...patch});
function prepared(result: ModuleStagedUpload | ErrorBody): ModuleStagedUpload {
  assert.ok(!('error' in result), 'upload was prepared');
  return result;
}
function refused(result: ModuleStagedUpload | ErrorBody, code: string): void {
  assert.ok('error' in result);
  assert.equal(result.error.code, code);
}
async function png(): Promise<Buffer> {
  const pixels = Buffer.alloc(128 * 128 * 3);
  let value = 42;
  for (let index = 0; index < pixels.length; index += 1) {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    pixels[index] = value >>> 24;
  }
  return sharp(pixels, {raw: {width: 128, height: 128, channels: 3}}).png().toBuffer();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pixoo-upload-'));
  const folder = join(root, 'pixoo');
  const incoming = join(folder, 'incoming');
  const bus = new InProcessBus();
  const core = bus.connect('bunny/core');
  const playback = bus.connect('bunny/modules/playback');
  const seen: Message[] = [];
  const device = new SimulatedPixoo();
  let module = createPixooModule({transport: device, timing: FAST});
  let harness = new ModuleHarness(module, {bus, stateDir: root, section: SECTION});
  await core.subscribe('bunny.*.*.*', message => { seen.push(message); });
  await core.serveSync(['session'], () => ({revision: 1, states: []}));
  await playback.serveSync(['playback'], () => ({revision: 1, states: []}));
  try { await harness.start(); } catch (error) {
    await harness.stop(); await core.close(); await playback.close(); await rm(root, {recursive: true, force: true}); throw error;
  }
  return {
    get module() { return module; }, get harness() { return harness; }, incoming, device, seen,
    async dispatch(upload: ModuleStagedUpload, requestId: string): Promise<ModuleUploadReply> {
      const reply = await core.request(`bunny.cmd.${FAMILIES.assetChange}.${DEVICE}`, {
        type: 'org.bunny.pixoo-asset.change.requested', subject: DEVICE, dataschema: schemaOf(FAMILIES.assetChange), data: upload.data,
      }, {requestId, timeoutMs: 5000});
      return reply.status === 'accepted' ? {status: 'accepted', requestId} : reply.error;
    },
    outcome(requestId: string) {
      return waitFor(() => seen.find(message => message.kind === 'outcome' && (message.data as {requestId?: string}).requestId === requestId) as UploadOutcome | undefined,
        'the upload owner outcome', 20_000);
    },
    async empty() { await waitFor(() => readdirSync(incoming).length === 0 ? true : undefined, 'staged input removed'); },
    async restart() {
      await harness.stop();
      module = createPixooModule({transport: device, timing: FAST});
      harness = new ModuleHarness(module, {bus, stateDir: root, section: SECTION});
      await harness.start();
    },
    async close() { await harness.stop(); await core.close(); await playback.close(); await rm(root, {recursive: true, force: true}); },
  };
}

void it('imports bytes above the JSON command cap, cleans the outcome and releases a repeated accepted preparation', async () => {
  const world = await fixture();
  try {
    const upload = world.module.manifest.upload;
    assert.ok(upload, 'Pixoo declares ordinary upload staging');
    assert.equal(upload.family, FAMILIES.assetChange);
    assert.equal(upload.maxBytes, 10 * 1024 * 1024);
    const bytes = await png();
    assert.ok(bytes.length > 16 * 1024);
    const staged = prepared(await upload.stage(request(bytes, 'large-upload')));
    assert.deepEqual(staged.data, {change: {operation: 'import', name: 'Synthetic', content: {staged: {file: sha(bytes), bytes: bytes.length}}}});
    assert.deepEqual(await readFile(join(world.incoming, sha(bytes))), bytes);
    const reply = await world.dispatch(staged, 'large-upload');
    assert.deepEqual(reply, {status: 'accepted', requestId: 'large-upload'});
    assert.deepEqual((await world.outcome('large-upload')).data, {requestId: 'large-upload', result: 'succeeded', evidence: 'observed'});
    await world.empty();
    // A late finish for a completed upload must not release the next preparation.
    const next = prepared(await upload.stage(request(Buffer.from('another input'), 'next-upload')));
    await staged.finish(reply);
    assert.deepEqual(await readdir(world.incoming), [sha(Buffer.from('another input'))]);
    await next.finish(errorBody('forbidden'));
    await world.empty();
    // Model the core returning its retained accepted reply without sending another module command.
    const repeated = prepared(await upload.stage(request(bytes, 'large-upload')));
    await repeated.finish(reply);
    await world.empty();
    assert.equal(world.seen.filter(message => message.kind === 'outcome' && (message.data as {requestId?: string}).requestId === 'large-upload').length, 1);
    assert.equal(world.harness.moduleDatabase()?.prepare('SELECT count(*) AS n FROM assets').get()?.n, 1);
    assert.equal(world.device.state().uploads, 0, 'library import does not display media');
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('cleans a failed decode after its existing owner outcome and remains healthy', async () => {
  const world = await fixture();
  try {
    const upload = world.module.manifest.upload;
    assert.ok(upload);
    const staged = prepared(await upload.stage(request(Buffer.alloc(32 * 1024, 1), 'bad-media')));
    const reply = await world.dispatch(staged, 'bad-media');
    assert.deepEqual(reply, {status: 'accepted', requestId: 'bad-media'});
    await staged.finish(reply);
    const outcome = await world.outcome('bad-media');
    assert.equal(outcome.data.result, 'failed');
    assert.equal(outcome.data.error?.code, 'invalid-request');
    await world.empty();
    assert.equal(world.harness.moduleDatabase()?.prepare('SELECT count(*) AS n FROM assets').get()?.n, 0);
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('refuses bad target/name/size, a busy slot and cancellation without leaving partial input', async () => {
  const world = await fixture();
  try {
    const upload = world.module.manifest.upload;
    assert.ok(upload);
    const bytes = Buffer.from('synthetic input');
    refused(await upload.stage(request(bytes, 'wrong-target', {target: 'other-device'})), 'not-found');
    refused(await upload.stage(request(bytes, 'bad-name', {name: ' '})), 'invalid-request');
    refused(await upload.stage(request(new Uint8Array(), 'empty')), 'invalid-request');
    refused(await upload.stage(request(new Uint8Array(10 * 1024 * 1024 + 1), 'large')), 'too-large');
    const aborted = new AbortController(); aborted.abort();
    refused(await upload.stage(request(bytes, 'already-aborted', {signal: aborted.signal})), 'cancelled');
    const cancelled = new AbortController();
    const preparing = upload.stage(request(new Uint8Array(10 * 1024 * 1024), 'cancel-preparation', {signal: cancelled.signal}));
    cancelled.abort();
    refused(await preparing, 'cancelled');
    await world.empty();
    const staged = prepared(await upload.stage(request(bytes, 'active-upload')));
    refused(await upload.stage(request(Buffer.from('different input'), 'busy-upload')), 'capacity');
    assert.deepEqual(await readdir(world.incoming), [sha(bytes)]);
    await staged.finish(errorBody('invalid-request'));
    await world.empty();
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('reports unfinished work uncertain then clears only abandoned hash inputs without replay', async () => {
  const world = await fixture();
  try {
    const upload = world.module.manifest.upload;
    assert.ok(upload);
    const retained = prepared(await upload.stage(request(await png(), 'retained-media')));
    await retained.finish(await world.dispatch(retained, 'retained-media'));
    assert.equal((await world.outcome('retained-media')).data.result, 'succeeded');
    await world.empty();
    const bytes = Buffer.from('abandoned synthetic bytes');
    const staged = prepared(await upload.stage(request(bytes, 'abandoned-upload')));
    await staged.finish(errorBody('uncertain-result'));
    refused(await upload.stage(request(Buffer.from('blocked'), 'blocked-upload')), 'capacity');
    await mkdir(world.incoming, {recursive: true});
    await writeFile(join(world.incoming, 'keep.txt'), 'unrelated synthetic file');
    const database = world.harness.moduleDatabase();
    assert.ok(database);
    database.prepare(`INSERT INTO pixoo_commands (source,request_id,digest,family,type,traceparent,accepted_at_ms)
      VALUES (?,?,?,?,?,?,?)`).run('bunny/core', 'abandoned-upload', sha(bytes), FAMILIES.assetChange,
      'org.bunny.pixoo-asset.change.requested', `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`, Date.now());
    await world.restart();
    const outcome = await world.outcome('abandoned-upload');
    assert.equal(outcome.data.result, 'uncertain');
    assert.equal(outcome.data.evidence, 'none');
    assert.deepEqual(await readdir(world.incoming), ['keep.txt']);
    assert.equal(await readFile(join(world.incoming, 'keep.txt'), 'utf8'), 'unrelated synthetic file');
    assert.equal(world.harness.moduleDatabase()?.prepare('SELECT count(*) AS n FROM assets').get()?.n, 1, 'restart preserves existing media without importing abandoned input');
    const renditionId = world.harness.moduleDatabase()?.prepare('SELECT id FROM renditions').get()?.id;
    assert.equal(typeof renditionId, 'string');
    const frame = await world.module.manifest.content?.(`frame.${String(renditionId)}.0`);
    assert.ok(frame !== undefined && !('error' in frame));
    assert.equal(frame.type, 'image/png', 'retained media still resolves after restart');
    const next = prepared(await world.module.manifest.upload?.stage(request(bytes, 'after-restart')) ?? errorBody('internal'));
    await next.finish(errorBody('forbidden'));
    assert.deepEqual(await readdir(world.incoming), ['keep.txt']);
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});

void it('keeps a known reply and another input intact when cleanup fails', async () => {
  const world = await fixture();
  try {
    const upload = world.module.manifest.upload;
    assert.ok(upload);
    const bytes = Buffer.from('synthetic cleanup input');
    const staged = prepared(await upload.stage(request(bytes, 'cleanup-reply')));
    // Replace only this test's temporary file with a directory: file cleanup must not recurse into it.
    const path = join(world.incoming, sha(bytes));
    await rm(path);
    await mkdir(path);
    await writeFile(join(path, 'keep.txt'), 'another synthetic input');
    const reply: ModuleUploadReply = {status: 'accepted', requestId: 'cleanup-reply'};
    await assert.doesNotReject(() => Promise.resolve(staged.finish(reply)));
    assert.deepEqual(reply, {status: 'accepted', requestId: 'cleanup-reply'});
    assert.equal(await readFile(join(path, 'keep.txt'), 'utf8'), 'another synthetic input');
    refused(await upload.stage(request(Buffer.from('next bytes'), 'blocked-by-cleanup')), 'capacity');
    assert.ok(world.harness.logs.some(entry => entry.event === 'operation.failed' && entry.fields['bunny.operation'] === 'storage'));
    assert.deepEqual(world.harness.failures, []);
  } finally { await world.close(); }
});
