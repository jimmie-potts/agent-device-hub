import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {it} from 'node:test';
import sharp from 'sharp';
import {z} from 'zod';
import type {MomentEnded} from '@jimmie-potts/event-contracts/v2/families';
import type {ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';
import type {RequestResult} from '@jimmie-potts/sdk';
import {DEVICE, SECTION, World, bytesOf, hostedGif, manyColorGif, sleep, waitFor} from './support.js';
import {gifFixture, oversizedHostedSourceGif} from '../helpers/media-fixtures.js';
import {FAMILIES} from '../../src/module/schemas.js';
import {frameDigest} from '../../src/module/transport.js';
import {HttpDeviceAdapter} from '../../src/device/http-adapter.js';
import {encodeHostedGif} from '../../src/media/hosted-gif.js';
import {MediaError} from '../../src/media/contracts.js';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const content = (id: string, bytes: Buffer, frames = 1): ArtStageContent => ({compositionId: digest(Buffer.from(id)), format: frames === 1 ? 'png' : 'gif', width: 64, height: 64,
  frames, durationMs: frames === 1 ? 0 : frames * 100, sha256: digest(bytes), base64: bytes.toString('base64'), lifetimeMs: 60_000});
const stage = (world: World, data: ArtStageContent): Promise<RequestResult> => world.core.request(`bunny.cmd.art-stage.${DEVICE}`,
  {type: 'org.bunny.art.stage.requested', subject: DEVICE, dataschema: 'https://bunny.invalid/events/art-stage/2.0', data}, {timeoutMs: 10_000});
async function accepted(pending: Promise<RequestResult>): Promise<string> {
  const result = await pending;
  assert.equal(result.status, 'accepted', JSON.stringify(result));
  assert.ok(result.status === 'accepted');
  return result.requestId;
}
const artMoment = (world: World, compositionId: string, patch: object = {}, core = true): Promise<RequestResult> => (core ? world.core : world.probe).request(`bunny.cmd.moment-play.${DEVICE}`,
  {type: 'org.bunny.moment.play.requested', subject: DEVICE, dataschema: `https://bunny.invalid/events/moment-play/${'notice' in patch ? '2.2' : '2.1'}`,
    data: {momentId: `show-${compositionId}`, mood: 'celebrate', durationMs: 1000, priorityClass: 'event', coversStatus: true,
      startAtMs: Date.now(), toleranceMs: 10_000, art: {compositionId}, ...patch}}, {timeoutMs: 5000});
const previewSchema = z.object({compositionId: z.string(), frameCount: z.number(), durationMs: z.number(), expiresAtMs: z.number(), profile: z.string(),
  frames: z.array(z.object({index: z.number(), delayMs: z.number().nullable(), sha256: z.string(), ref: z.string()}))});
async function preview(world: World, id: string) {
  const result = await world.module.manifest.content?.(`art-preview.${id}`);
  assert.ok(result !== undefined && !('error' in result));
  return previewSchema.parse(JSON.parse(Buffer.from(result.bytes).toString('utf8')));
}
const rgbFrame = (index: number, phase: number): Buffer => {
  const bytes = Buffer.alloc(12288);
  for (let pixel = 0; pixel < 4096; pixel += 1) bytes.set((pixel + phase) % 2 === 0 ? [index % 256, 0, 0] : [0, index % 256, 255], pixel * 3);
  return bytes;
};
async function monitor(world: World): Promise<string> {
  const mode = await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work'}));
  await world.outcome(mode);
  await world.publishSession();
  return waitFor(() => world.device.state().shown?.digests[0], 'monitor');
}

void it('plays a labelled rain forecast with every exact art frame and leaves its staged bytes unchanged', async () => {
  const world = await World.open();
  try {
    await world.start();
    const base = await monitor(world);
    const data = content('rain-art', hostedGif(19, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const before = await preview(world, data.compositionId);
    const now = Date.now();
    const notice = {kind: 'rain-forecast', likelihood: 'chance', forecastStartAtMs: now + 60_000, forecastEndAtMs: now + 120_000,
      forecastUpdatedAtMs: now - 1000, observedAtMs: now, staleAtMs: now + 120_000, weatherRevision: 1};
    const writes = world.device.state().sent;
    const outsider = await artMoment(world, data.compositionId, {notice}, false);
    assert.ok(outsider.status === 'rejected'); assert.equal(outsider.error.error.code, 'forbidden');
    const tooShort = await artMoment(world, data.compositionId, {notice: {...notice, staleAtMs: now + 500}});
    assert.ok(tooShort.status === 'rejected'); assert.equal(tooShort.error.error.code, 'invalid-message');
    assert.equal(world.device.state().sent, writes, 'refusals cause no device effect');
    const requestId = await accepted(artMoment(world, data.compositionId, {notice, durationMs: 1000}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'labelled rain art');
    const shown = world.device.state().shown;
    assert.deepEqual(shown?.delaysMs, Array(8).fill(100));
    assert.notEqual(shown?.digests[0], frameDigest(rgbFrame(19, 0)), 'a separate factual band accompanies the retained art');
    assert.deepEqual(await preview(world, data.compositionId), before);
    const outcome = await world.outcome(requestId);
    assert.equal(outcome.data.result, 'succeeded');
    assert.equal(outcome.data.evidence, 'transmitted');
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'the current Monitor base');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('labels rain art past the former 20-frame cap within the direct route limit', async () => {
  const world = await World.open();
  try {
    await world.start();
    const base = await monitor(world);
    const data = content('rain-art-21', hostedGif(19, 21), 21);
    await world.outcome(await accepted(stage(world, data)));
    const now = Date.now();
    const notice = {kind: 'rain-forecast', likelihood: 'chance', forecastStartAtMs: now + 60_000, forecastEndAtMs: now + 120_000,
      forecastUpdatedAtMs: now - 1000, observedAtMs: now, staleAtMs: now + 120_000, weatherRevision: 1};
    const requestId = await accepted(artMoment(world, data.compositionId, {notice, durationMs: 1000}));
    await waitFor(() => world.device.state().shown?.frames === 21 ? true : undefined, 'all 21 labelled frames');
    const outcome = await world.outcome(requestId);
    assert.equal(outcome.data.result, 'succeeded');
    assert.equal(outcome.data.evidence, 'transmitted');
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'the current Monitor base');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('refuses a hosted rain notice whose label cannot fit the GIF palette, with no transmission claim and Monitor kept', async () => {
  // The production adapter and hosted encoder, over an in-memory transport: a full 256-color original is admissible on
  // its own, and the label's black and white push it to 258 colors before any file is published or command sent.
  const source = new Uint8Array(12288);
  for (let pixel = 0; pixel < 4096; pixel += 1) source.set([(Math.floor(pixel / 64) * 19 + (pixel % 64) * 53) % 256, 13, 249], pixel * 3);
  const gif = encodeHostedGif([source, source].map(rgb => ({rgb, delayMs: 100})));
  const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-hosted-2026-10-01'}}});
  const commands: string[] = [], published: number[] = [];
  world.device.open = ({address, clock, profile}) => {
    const adapter = new HttpDeviceAdapter({ip: address, clock, profile: {...profile, evidence: 'observed', readyDelayMs: 0}, hosted: {
      files: {publish: bytes => { published.push(bytes.length); return {url: 'http://example.invalid/art.gif', transferred: Promise.resolve(), revoke() {}}; }},
      encode: animation => encodeHostedGif(animation.frames),
    }}, body => { commands.push(String(body.Command)); return Promise.resolve({error_code: 0, SelectIndex: 0, Brightness: 80, LightSwitch: 1, PicId: 27}); });
    return Promise.resolve({adapter, close: () => adapter.close()});
  };
  try {
    await world.start();
    await world.outcome(await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work'})));
    await world.publishSession();
    await waitFor(() => commands.includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base');
    const data = {...content('full-palette-rain', gif, 2), compositionId: digest(gif)};
    assert.equal((await world.outcome(await accepted(stage(world, data)))).data.result, 'succeeded');
    const now = Date.now();
    const notice = {kind: 'rain-forecast', likelihood: 'chance', forecastStartAtMs: now + 60_000, forecastEndAtMs: now + 120_000,
      forecastUpdatedAtMs: now - 1000, observedAtMs: now, staleAtMs: now + 120_000, weatherRevision: 1};
    const before = commands.length;
    const outcome = await world.outcome(await accepted(artMoment(world, data.compositionId, {notice})));
    assert.equal(outcome.data.result, 'failed', JSON.stringify(outcome.data));
    assert.equal(outcome.data.evidence, 'none');
    assert.equal(outcome.data.error?.code, 'unsupported-capability');
    assert.ok(!('transmission' in outcome.data), 'no transmission is recorded');
    assert.deepEqual(published, [], 'no hosted file is published');
    assert.ok(!commands.slice(before).includes('Device/PlayTFGif'), 'no hosted play command is sent');
    // Nothing reached the panel, so Monitor stays the current base and draws itself again instead of stopping.
    await waitFor(() => commands.slice(before).includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base after the refusal');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('refuses a hosted art moment whose encoded file is too large, with no transmission claim and Monitor kept', async () => {
  // The hosted encoder's byte budget, like its palette, is checked locally before any file is published or command sent.
  // A rain label can push an admissible original past it; the encoder here refuses every animated upload the same way.
  const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-hosted-2026-10-01'}}});
  const commands: string[] = [], published: number[] = [];
  let encoded = 0;
  world.device.open = ({address, clock, profile}) => {
    const adapter = new HttpDeviceAdapter({ip: address, clock, profile: {...profile, evidence: 'observed', readyDelayMs: 0}, hosted: {
      files: {publish: bytes => { published.push(bytes.length); return {url: 'http://example.invalid/art.gif', transferred: Promise.resolve(), revoke() {}}; }},
      encode: () => { encoded += 1; throw new MediaError('storage-limit'); },
    }}, body => { commands.push(String(body.Command)); return Promise.resolve({error_code: 0, SelectIndex: 0, Brightness: 80, LightSwitch: 1, PicId: 27}); });
    return Promise.resolve({adapter, close: () => adapter.close()});
  };
  try {
    await world.start();
    await world.outcome(await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work'})));
    await world.publishSession();
    await waitFor(() => commands.includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base');
    const data = content('oversized-hosted-art', hostedGif(19, 8), 8);
    assert.equal((await world.outcome(await accepted(stage(world, data)))).data.result, 'succeeded');
    const before = commands.length;
    const outcome = await world.outcome(await accepted(artMoment(world, data.compositionId)));
    assert.equal(outcome.data.result, 'failed', JSON.stringify(outcome.data));
    assert.equal(outcome.data.evidence, 'none');
    assert.equal(outcome.data.error?.code, 'too-large');
    assert.ok(!('transmission' in outcome.data), 'no transmission is recorded');
    assert.ok(encoded > 0, 'the hosted encoder was reached');
    assert.deepEqual(published, [], 'no hosted file is published');
    assert.ok(!commands.slice(before).includes('Device/PlayTFGif'), 'no hosted play command is sent');
    await waitFor(() => commands.slice(before).includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base after the refusal');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

for (const [name, local] of [
  ['an encoder RangeError', {encode: (): Uint8Array => { throw new RangeError('synthetic encoder fault'); }, publish: true}],
  ['a publisher TypeError', {encode: (): Uint8Array => new Uint8Array(8), publish: false}],
] as const) {
  void it(`fails a hosted art moment on ${name} before any send, with no transmission claim and Monitor kept (#1504)`, async () => {
    // A local throw before the first mutating send reached nothing: it is no unreadable device answer.
    const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-hosted-2026-10-01'}}});
    const commands: string[] = [];
    let reached = 0;
    world.device.open = ({address, clock, profile}) => {
      const adapter = new HttpDeviceAdapter({ip: address, clock, profile: {...profile, evidence: 'observed', readyDelayMs: 0}, hosted: {
        files: {publish: () => {
          if (local.publish) return {url: 'http://example.invalid/art.gif', transferred: Promise.resolve(), revoke() {}};
          reached += 1; throw new TypeError('synthetic publisher fault');
        }},
        encode: () => { if (local.publish) reached += 1; return local.encode(); },
      }}, body => { commands.push(String(body.Command)); return Promise.resolve({error_code: 0, SelectIndex: 0, Brightness: 80, LightSwitch: 1, PicId: 27}); });
      return Promise.resolve({adapter, close: () => adapter.close()});
    };
    try {
      await world.start();
      await world.outcome(await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'work'})));
      await world.publishSession();
      await waitFor(() => commands.includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base');
      const data = content(`local-fault-${local.publish ? 'encoder' : 'publisher'}`, hostedGif(19, 8), 8);
      assert.equal((await world.outcome(await accepted(stage(world, data)))).data.result, 'succeeded');
      const before = commands.length;
      const outcome = await world.outcome(await accepted(artMoment(world, data.compositionId)));
      assert.equal(outcome.data.result, 'failed', JSON.stringify(outcome.data));
      assert.equal(outcome.data.evidence, 'none');
      assert.equal(outcome.data.error?.code, 'unavailable');
      assert.ok(!('transmission' in outcome.data), 'no transmission is recorded');
      assert.ok(reached > 0, 'the synthetic fault was reached');
      assert.ok(!commands.slice(before).includes('Device/PlayTFGif'), 'no hosted play command is sent');
      // Nothing reached the panel, so Monitor stays the current base and draws itself again instead of stopping.
      await waitFor(() => commands.slice(before).includes('Draw/SendHttpGif') ? true : undefined, 'the Monitor base after the failure');
      assert.deepEqual(world.invalid, []);
    } finally { await world.close(); }
  });
}

void it('stages bounded still and animation without a display write or permanent import', async () => {
  const world = await World.open();
  try {
    await world.start();
    const before = world.device.state().uploads;
    const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#1764ca'}}).png().toBuffer();
    for (const data of [content('art-still', png), content('art-animation', hostedGif(19, 8), 8)]) {
      const outcome = await world.outcome(await accepted(stage(world, data)));
      assert.equal(outcome.data.result, 'succeeded');
      assert.equal(outcome.data.evidence, 'observed');
      const shown = await preview(world, data.compositionId);
      assert.equal(shown.frameCount, data.frames);
      assert.equal(shown.durationMs, data.durationMs);
      for (const [index, frame] of shown.frames.entries()) {
        const result = await world.module.manifest.content?.(frame.ref);
        assert.ok(result !== undefined && !('error' in result));
        assert.equal(digest(result.bytes), frame.sha256);
        const actual = await sharp(result.bytes).removeAlpha().raw().toBuffer();
        const expected = data.format === 'gif' ? rgbFrame(19, index) : Buffer.from(Array.from({length: 4096}, () => [23, 100, 202]).flat());
        assert.deepEqual(actual, expected);
        assert.equal(frame.delayMs, data.format === 'gif' ? 100 : null);
      }
      const row = world.withDatabase(db => db.prepare('SELECT rendition_id FROM pixoo_art_copies WHERE composition_id = ?').get(data.compositionId));
      assert.equal(typeof row?.rendition_id, 'string');
      assert.deepEqual(await readFile(join(world.folder, 'art', String(row?.rendition_id), 'originals', data.sha256)), Buffer.from(data.base64, 'base64'));
    }
    assert.equal(world.device.state().uploads, before);
    assert.equal((await world.synced('pixoo-rendition')).length, 0);
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('refuses an unknown art reference without a mood fallback', async () => {
  const world = await World.open();
  try {
    await world.start();
    const shown = await monitor(world), before = world.device.state().uploads;
    const result = await artMoment(world, '0'.repeat(64));
    assert.ok(result.status === 'rejected');
    assert.equal(result.error.error.code, 'not-found');
    await sleep(100);
    assert.equal(world.device.state().uploads, before);
    assert.equal(world.device.state().shown?.digests[0], shown);
  } finally { await world.close(); }
});

void it('a damaged private frame fails without replacing the display with a mood or partial art', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('damaged-copy', hostedGif(23, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const base = await monitor(world), writes = world.device.state().uploads;
    const row = world.withDatabase(db => db.prepare('SELECT rendition_id FROM pixoo_art_copies WHERE composition_id = ?').get(data.compositionId));
    assert.equal(typeof row?.rendition_id, 'string');
    const id = String(row?.rendition_id);
    await writeFile(join(world.folder, 'art', id, 'renditions', id, '3.rgb'), Buffer.alloc(12288));
    const result = await world.outcome(await accepted(artMoment(world, data.compositionId)));
    assert.equal(result.data.result, 'failed'); assert.equal(result.data.evidence, 'none');
    assert.equal(world.device.state().uploads, writes);
    assert.equal(world.device.state().shown?.digests[0], base);
  } finally { await world.close(); }
});

void it('renews identical staging, refuses conflicting bytes and keeps copies across restart', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('reuse', hostedGif(21, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const first = await preview(world, data.compositionId);
    await sleep(5);
    await world.outcome(await accepted(stage(world, data)));
    const second = await preview(world, data.compositionId);
    assert.ok(second.expiresAtMs > first.expiresAtMs);
    assert.deepEqual(second.frames, first.frames);
    const other = content('reuse', hostedGif(22, 8), 8);
    const conflict = await stage(world, other);
    assert.ok(conflict.status === 'rejected');
    assert.equal(conflict.error.error.code, 'duplicate-conflict');
    assert.deepEqual(await preview(world, data.compositionId), second);
    const writes = world.device.state().uploads;
    await world.restart();
    assert.deepEqual(await preview(world, data.compositionId), second);
    assert.equal(world.device.state().uploads, writes);
    assert.equal((await world.synced(FAMILIES.rendition)).length, 0);
  } finally { await world.close(); }
});

void it('refuses forged callers, bad bytes, decoded metadata and excessive resources without display effects', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('bad', hostedGif(21, 8), 8), before = world.device.state().uploads;
    const forged = await world.probe.request(`bunny.cmd.art-stage.${DEVICE}`, {type: 'org.bunny.art.stage.requested', subject: DEVICE,
      dataschema: 'https://bunny.invalid/events/art-stage/2.0', data}, {timeoutMs: 5000});
    assert.ok(forged.status === 'rejected'); assert.equal(forged.error.error.code, 'forbidden');
    for (const bad of [{...data, sha256: '0'.repeat(64)}, {...data, width: 32}, {...data, frames: 60},
      content('signature', Buffer.alloc(32), 8), content('bytes-limit', Buffer.concat([hostedGif(21, 8), Buffer.alloc(163_840)]), 8)]) {
      const result = await stage(world, bad);
      assert.ok(result.status === 'rejected');
    }
    for (const bad of [{...data, frames: 7, durationMs: 700}, content('broken', hostedGif(21, 8).subarray(0, 30), 8)]) {
      const result = await world.outcome(await accepted(stage(world, bad)));
      assert.equal(result.data.result, 'failed'); assert.equal(result.data.evidence, 'none');
    }
    const shown = await world.module.manifest.content?.(`art-preview.${data.compositionId}`);
    assert.ok(shown !== undefined && 'error' in shown); assert.equal(shown.error.code, 'not-found');
    assert.equal(world.device.state().uploads, before);
  } finally { await world.close(); }
});

void it('plays all staged frames at their exact delay and returns to the current status base', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('exact', hostedGif(31, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const base = await monitor(world);
    const request = await accepted(artMoment(world, data.compositionId));
    const showing = await waitFor(() => world.device.state().shown?.frames === 8 ? world.device.state().shown : undefined, 'eight art frames');
    assert.deepEqual(showing?.delaysMs, Array(8).fill(100));
    assert.deepEqual(showing?.digests, Array.from({length: 8}, (_, index) => frameDigest(rgbFrame(31, index))));
    world.withDatabase(db => db.prepare('UPDATE pixoo_art_copies SET expires_at_ms = ? WHERE composition_id = ?').run(Date.now() - 1, data.compositionId));
    const result = await world.outcome(request);
    assert.equal(result.data.result, 'succeeded'); assert.equal(result.data.evidence, 'transmitted');
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'base restored');
    const expired = await artMoment(world, data.compositionId, {momentId: 'expired-art'});
    assert.ok(expired.status === 'rejected'); assert.equal(expired.error.error.code, 'not-found');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('keeps profile restrictions and never falls back to a mood for refused art', async () => {
  for (const profile of ['pixoo64-smoke-2026-09-06', 'pixoo64-hosted-2026-10-01']) {
    const world = await World.open({section: {device: {...SECTION.device, profile}}});
    try {
      await world.start();
      const bytes = profile.includes('smoke') ? gifFixture(64, 64, [5, 15].map(delay => ({width: 1, height: 1, pixels: [1], delay}))) : manyColorGif();
      const data = content(profile, bytes, 2);
      const result = await world.outcome(await accepted(stage(world, data)));
      assert.equal(result.data.result, 'failed'); assert.equal(result.data.error?.code, 'unsupported-capability');
      const refused = await artMoment(world, data.compositionId);
      assert.ok(refused.status === 'rejected'); assert.equal(refused.error.error.code, 'not-found');
      assert.equal(world.device.state().uploads, 0);
    } finally { await world.close(); }
  }
});

void it('requires the core for art moments and preserves attention admission', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('gated', hostedGif(21, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const forged = await artMoment(world, data.compositionId, {}, false);
    assert.ok(forged.status === 'rejected'); assert.equal(forged.error.error.code, 'forbidden');
    // A paused item's refusal is covered below; an empty pause no longer refuses art (ADR 0014).
    await monitor(world);
    await world.publishSession({attention: [{kind: 'approval', id: {status: 'known', id: 'approval-art'}, turn: {status: 'known', id: 'turn-1'}}]});
    const blocked = await artMoment(world, data.compositionId);
    assert.ok(blocked.status === 'rejected'); assert.equal(blocked.error.error.code, 'invalid-state');
    assert.equal(world.display()?.moments.playing, null);
  } finally { await world.close(); }
});

void it('exact art over the status base with nothing loaded plays in Free without cover permission, and the dashboard returns', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('status-base-art', hostedGif(37, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    await world.outcome(await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'free'})));
    await world.publishSession();
    const base = await waitFor(() => world.device.state().shown?.digests[0], 'the status base');
    const before = world.display()?.player;
    assert.equal(before?.state, 'idle'); assert.equal(before.intent, 'stopped'); assert.equal(before.itemId, null); assert.equal(before.playlistId, null);
    const request = await accepted(artMoment(world, data.compositionId, {coversStatus: false, priorityClass: 'flourish'}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art over the status base');
    assert.deepEqual([world.display()?.mode, world.display()?.base], ['free', 'status']);
    assert.equal(world.display()?.player.intent, 'stopped');
    const result = await world.outcome(request);
    assert.equal(result.data.result, 'succeeded'); assert.equal(result.data.evidence, 'transmitted');
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'the status base back');
    assert.deepEqual(world.display()?.player, before);
    const plain = await world.request('moment-play', 'org.bunny.moment.play.requested', {momentId: 'plain-empty', mood: 'celebrate', durationMs: 1000,
      priorityClass: 'flourish', coversStatus: false, startAtMs: Date.now(), toleranceMs: 5000});
    const plainRequest = await accepted(Promise.resolve(plain));
    const plainOutcome = await world.outcome(plainRequest);
    assert.equal(plainOutcome.data.result, 'succeeded');
    assert.equal(plainOutcome.data.evidence, 'transmitted');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('in Work exact art covers the status base only with permission to cover status', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('work-art', hostedGif(38, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    await monitor(world);
    const uploads = world.device.state().uploads;
    const refused = await artMoment(world, data.compositionId, {momentId: 'work-flourish', coversStatus: false, priorityClass: 'flourish'});
    assert.ok(refused.status === 'rejected'); assert.equal(refused.error.error.code, 'invalid-state');
    assert.equal(world.device.state().uploads, uploads);
    const request = await accepted(artMoment(world, data.compositionId, {momentId: 'work-covers'}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art over the status base in Work');
    assert.equal((await world.outcome(request)).data.result, 'succeeded');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('a manual pause during exact art over the status base ends it, the dashboard returns, and no saved pause refuses the next art', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('empty-manual', hostedGif(39, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const base = await monitor(world);
    const request = await accepted(artMoment(world, data.compositionId, {durationMs: 10_000}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art before the pause');
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'})));
    assert.equal((await world.outcome(request)).data.result, 'succeeded');
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'the status base after the pause');
    assert.deepEqual([world.display()?.base, world.display()?.player.intent], ['status', 'paused']);
    const again = await accepted(artMoment(world, data.compositionId, {momentId: 'after-empty-pause'}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art again');
    assert.equal((await world.outcome(again)).data.result, 'succeeded');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('a saved empty pause from before ADR 0014 is never read: after a restart, exact art plays over the status base', async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content('durable-empty-pause', hostedGif(47, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    world.withDatabase(db => db.prepare('INSERT INTO pixoo_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run('emptyIntent', 'paused'));
    await world.restart();
    assert.equal(world.display()?.player.intent, 'stopped');
    await monitor(world);
    const request = await accepted(artMoment(world, data.compositionId, {momentId: 'after-restart'}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'art after the restart');
    assert.equal((await world.outcome(request)).data.result, 'succeeded');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('a selection restored paused after a restart refuses art, and a clear returns the status base, which admits it', async () => {
  const world = await World.open();
  try {
    let renditionId = '';
    await world.populate(async library => {
      const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#517aaf'}}).png().toBuffer();
      renditionId = (await library.importMedia(bytesOf(png), 'Selection after pause')).rendition.id;
    });
    await world.start();
    const data = content('clear-empty-pause', hostedGif(48, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    await world.outcome(await accepted(world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId, playback: {mode: 'duration', durationMs: 60_000}})));
    const itemId = world.display()?.player.itemId;
    assert.notEqual(itemId, null);
    const writes = world.device.state().uploads;
    await world.restart();
    assert.equal(world.device.state().uploads, writes);
    assert.deepEqual([world.display()?.player.itemId, world.display()?.player.intent, world.display()?.base], [itemId, 'paused', 'playback']);
    const refused = await artMoment(world, data.compositionId, {momentId: 'over-paused', coversStatus: false});
    assert.ok(refused.status === 'rejected'); assert.equal(refused.error.error.code, 'invalid-state');
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'clear'})));
    await world.restart();
    assert.equal(world.display()?.player.itemId, null);
    assert.equal(world.display()?.player.intent, 'stopped');
    await monitor(world);
    const request = await accepted(artMoment(world, data.compositionId, {momentId: 'after-owner-clear'}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'art after explicit clear');
    assert.equal((await world.outcome(request)).data.result, 'succeeded');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

for (const waiting of [false, true]) void it(`a status view change interrupts ${waiting ? 'waiting' : 'playing'} exact art over the status base`, async () => {
  const world = await World.open();
  try {
    await world.start();
    const data = content(`empty-view-${String(waiting)}`, hostedGif(49, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const base = await monitor(world);
    const request = await accepted(artMoment(world, data.compositionId, {durationMs: 10_000, startAtMs: Date.now() + (waiting ? 800 : 0)}));
    if (!waiting) await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'art before view change');
    await world.outcome(await accepted(world.request(FAMILIES.monitor, 'org.bunny.pixoo-monitor.set.requested', {filter: {}, cadenceMs: 2000})));
    const result = await world.outcome(request);
    assert.equal(result.data.result, waiting ? 'failed' : 'succeeded');
    assert.equal(result.data.evidence, waiting ? 'none' : 'transmitted');
    if (!waiting) {
      const ended = world.seen.find(message => message.type === 'org.bunny.moment.ended' && (message.data as MomentEnded).requestId === request)?.data as MomentEnded | undefined;
      assert.equal(ended?.ending, 'interrupted');
    }
    await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'the dashboard after the view change');
    const writes = world.device.state().uploads;
    await sleep(1000);
    assert.equal(world.device.state().uploads, writes, 'the interrupted moment never replays');
    assert.equal(world.display()?.moments.playing, null);
    assert.equal(world.display()?.player.intent, 'stopped');
    if (waiting) assert.equal(world.device.state().shown?.frames === 8, false, 'waiting art never wrote');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('attention, a paused item and Now Playing refuse exact art; a stopped saved item admits it over the status base', async () => {
  const world = await World.open();
  try {
    let renditionId = '';
    await world.populate(async library => {
      const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#345678'}}).png().toBuffer();
      renditionId = (await library.importMedia(bytesOf(png), 'Held selection')).rendition.id;
    });
    await world.start();
    const data = content('protected-media', hostedGif(41, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const refusedWithoutWrite = async (momentId: string): Promise<void> => {
      const before = world.device.state();
      const refused = await artMoment(world, data.compositionId, {momentId, coversStatus: false});
      assert.ok(refused.status === 'rejected'); assert.equal(refused.error.error.code, 'invalid-state');
      assert.equal(world.device.state().uploads, before.uploads); assert.deepEqual(world.device.state().shown, before.shown);
    };
    await world.outcome(await accepted(world.request('device-mode-set', 'org.bunny.device-mode.set.requested', {mode: 'free'})));
    await world.publishSession({attention: [{kind: 'approval', id: {status: 'known', id: 'empty-attention'}, turn: {status: 'known', id: 'turn-1'}}]});
    await waitFor(() => world.display()?.monitor.attention === 1 ? true : undefined, 'the attention');
    await refusedWithoutWrite('status-with-attention');
    await world.publishSession({attention: []});
    await world.outcome(await accepted(world.request(FAMILIES.show, 'org.bunny.pixoo-media.show.requested', {renditionId, playback: {mode: 'duration', durationMs: 60_000}})));
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'})));
    assert.notEqual(world.display()?.player.itemId, null);
    await refusedWithoutWrite('selected-pause');
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'stop'})));
    const stopped = world.display()?.player;
    assert.ok(stopped !== undefined && stopped.itemId !== null);
    await waitFor(() => world.display()?.participating === true ? true : undefined, 'the status base after the stop');
    const stoppedMoment = await accepted(artMoment(world, data.compositionId, {momentId: 'selected-stop', coversStatus: false, durationMs: 1000}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact animation over the status base');
    const completed = await world.outcome(stoppedMoment);
    assert.equal(completed.data.result, 'succeeded'); assert.equal(completed.data.evidence, 'transmitted');
    await waitFor(() => world.display()?.showing === 'dashboard' && world.device.state().shown?.frames !== 8 ? true : undefined, 'the status base after the art');
    assert.equal(world.display()?.player.itemId, stopped.itemId);
    assert.equal(world.display()?.player.intent, 'stopped');
    assert.equal(world.display()?.player.playlistId, stopped.playlistId);
    assert.equal(world.display()?.player.renditionId, stopped.renditionId);
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'resume'})));
    await world.outcome(await accepted(world.request(FAMILIES.nowPlaying, 'org.bunny.pixoo-now-playing.set.requested', {media: 'whole'})));
    const beforeCard = world.device.state().uploads;
    await world.publishPlayback();
    await waitFor(() => world.display()?.nowPlaying.takeover === 'whole' && world.display()?.showing === 'card' && world.device.state().uploads > beforeCard ? true : undefined, 'Now Playing owns display');
    await refusedWithoutWrite('now-playing-art');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('a pause while exact art waits over a playing item refuses it at its start, before any display write', async () => {
  const world = await World.open();
  try {
    let playlistId = '';
    await world.populate(async library => {
      const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#132538'}}).png().toBuffer();
      const imported = await library.importMedia(bytesOf(png), 'Synthetic base');
      playlistId = (await library.createPlaylist('Synthetic list', {}, {items: [{renditionId: imported.rendition.id}]})).id;
    });
    await world.start();
    await world.outcome(await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId})));
    await waitFor(() => world.display()?.player.state === 'playing' ? true : undefined, 'the playing playlist');
    const data = content('waiting-empty', hostedGif(43, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const request = await accepted(artMoment(world, data.compositionId, {startAtMs: Date.now() + 400, durationMs: 1000, coversStatus: false}));
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'})));
    const result = await world.outcome(request);
    assert.equal(result.data.result, 'failed'); assert.equal(result.data.evidence, 'none');
    assert.notEqual(world.device.state().shown?.frames, 8);
    assert.equal(world.display()?.player.intent, 'paused');
  } finally { await world.close(); }
});

void it('returns exact art to the same playing item and lets a manual pause end the art', async () => {
  const world = await World.open();
  try {
    let playlistId = '';
    await world.populate(async library => {
      const png = await sharp({create: {width: 64, height: 64, channels: 3, background: '#132537'}}).png().toBuffer();
      const imported = await library.importMedia(bytesOf(png), 'Synthetic base');
      const list = await library.createPlaylist('Synthetic list', {}, {items: [{renditionId: imported.rendition.id}]});
      playlistId = list.id;
    });
    await world.start();
    await world.outcome(await accepted(world.request('media-start', 'org.bunny.media.start.requested', {playlistId})));
    const base = await waitFor(() => world.display()?.player.state === 'playing' ? world.display() : undefined, 'base playing');
    const pixels = world.device.state().shown?.digests;
    const data = content('media-art', hostedGif(33, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const first = await accepted(artMoment(world, data.compositionId, {momentId: 'media-art-first', coversStatus: false}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art over Media');
    assert.equal((await world.outcome(first)).data.result, 'succeeded');
    const returned = await waitFor(() => world.display()?.player.state === 'playing' ? world.display() : undefined, 'same item resumed');
    assert.equal(returned.player.itemId, base.player.itemId);
    assert.deepEqual(world.device.state().shown?.digests, pixels);
    const second = await accepted(artMoment(world, data.compositionId, {momentId: 'media-art-second', durationMs: 10_000, coversStatus: false}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'second exact art over Media');
    await world.outcome(await accepted(world.request('media-control', 'org.bunny.media.control.requested', {action: 'pause'})));
    assert.equal((await world.outcome(second)).data.result, 'succeeded');
    await waitFor(() => world.device.state().shown?.digests[0] === frameDigest(new Uint8Array(12288)) ? true : undefined, 'manual pause blanks art');
    assert.equal(world.display()?.player.intent, 'paused');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('attention interrupts exact art and restart never replays an admitted art moment', async () => {
  const world = await World.open();
  try {
    await world.start(); await monitor(world);
    const data = content('interrupt-art', hostedGif(35, 8), 8);
    await world.outcome(await accepted(stage(world, data)));
    const first = await accepted(artMoment(world, data.compositionId, {momentId: 'attention-art', durationMs: 10_000}));
    await waitFor(() => world.device.state().shown?.frames === 8 ? true : undefined, 'exact art before attention');
    await world.publishSession({attention: [{kind: 'approval', id: {status: 'known', id: 'attention-interrupt'}, turn: {status: 'known', id: 'turn-1'}}]});
    assert.equal((await world.outcome(first)).data.result, 'succeeded');
    await waitFor(() => world.device.state().shown?.frames === 2 ? true : undefined, 'attention dashboard replaces art');
    await world.publishSession({attention: []});
    await waitFor(() => world.device.state().shown?.frames === 1 ? true : undefined, 'calm dashboard');
    const queued = await accepted(artMoment(world, data.compositionId, {momentId: 'restart-art', startAtMs: Date.now() + 200, durationMs: 10_000}));
    await world.restart();
    assert.equal((await world.outcome(queued)).data.result, 'uncertain');
    await sleep(600);
    assert.notEqual(world.device.state().shown?.frames, 8);
    assert.equal((await preview(world, data.compositionId)).frameCount, 8);
    const repeated = await artMoment(world, data.compositionId, {momentId: 'restart-art'});
    assert.ok(repeated.status === 'rejected'); assert.equal(repeated.error.error.code, 'invalid-state');
    assert.deepEqual(world.invalid, []);
  } finally { await world.close(); }
});

void it('stages and plays exact art at the direct command boundary on the historic smoke configuration', async () => {
  const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-smoke-2026-09-06'}}});
  try {
    await world.start();
    const admitted: ArtStageContent[] = [];
    const before = world.device.state().uploads;
    for (const count of [21, 59, 60]) {
      const data = content(`direct-${count}`, hostedGif(37, count), count);
      const answer = await stage(world, data);
      if (count === 60) {
        assert.ok(answer.status === 'rejected');
        assert.match(answer.error.error.detail ?? '', /direct.*59/i);
      } else {
        assert.ok(answer.status === 'accepted', JSON.stringify(answer));
        assert.equal((await world.outcome(answer.requestId)).data.result, 'succeeded');
        admitted.push(data);
      }
      assert.equal(world.device.state().uploads, before);
    }
    const base = await monitor(world);
    for (const data of admitted) {
      const moment = await accepted(artMoment(world, data.compositionId, {coversStatus: true}));
      const shown = await waitFor(() => world.device.state().shown?.frames === data.frames ? world.device.state().shown : undefined, 'exact direct art');
      assert.deepEqual(shown?.delaysMs, Array<number>(data.frames).fill(100));
      assert.equal((await world.outcome(moment)).data.result, 'succeeded');
      await waitFor(() => world.device.state().shown?.digests[0] === base ? true : undefined, 'monitor restored');
    }
  } finally { await world.close(); }
});

void it('retains and plays a 1,001-frame private whole GIF through the extended Pixoo stage', async () => {
  const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-hosted-2026-10-01'}}});
  try {
    await world.start();
    const frames = 1001;
    const bytes = gifFixture(64, 64, Array.from({length: frames}, (_, index) => ({width: 1, height: 1, pixels: [1 + index % 2], delay: 10})));
    const data = content('whole-gif-1001', bytes, frames);
    const id = await accepted(world.core.request(`bunny.cmd.art-stage.${DEVICE}`, {
      type: 'org.bunny.art.stage.requested', subject: DEVICE, dataschema: 'https://bunny.invalid/events/art-stage/2.1', data,
    }, {timeoutMs: 10_000}));
    assert.equal((await world.outcome(id, 30_000)).data.result, 'succeeded');
    assert.equal(world.device.state().uploads, 0);
    const stored = await preview(world, data.compositionId);
    assert.equal(stored.frameCount, frames);
    const last = stored.frames.at(-1);
    assert.ok(last !== undefined); assert.equal(last.delayMs, 100);
    const png = await world.module.manifest.content?.(last.ref);
    assert.ok(png !== undefined && !('error' in png)); assert.equal(digest(png.bytes), last.sha256);
    await monitor(world);
    const moment = await accepted(artMoment(world, data.compositionId, {coversStatus: true}));
    const showing = await waitFor(() => world.device.state().shown?.frames === frames ? world.device.state().shown : undefined, 'whole GIF');
    assert.deepEqual(showing?.delaysMs, Array<number>(frames).fill(100));
    assert.equal((await world.outcome(moment)).data.result, 'succeeded');
  } finally { await world.close(); }
});

void it('refuses an oversized encoded hosted stage before use and keeps the prior private copy', async () => {
  const world = await World.open({section: {device: {...SECTION.device, profile: 'pixoo64-hosted-2026-10-01'}}});
  try {
    await world.start();
    const prior = content('existing-hosted-copy', hostedGif(7, 8), 8);
    assert.equal((await world.outcome(await accepted(stage(world, prior)))).data.result, 'succeeded');
    const committed = await preview(world, prior.compositionId);
    const data = content('excess-hosted-bytes', oversizedHostedSourceGif(), 2200);
    const result = await world.outcome(await accepted(world.core.request(`bunny.cmd.art-stage.${DEVICE}`, {
      type: 'org.bunny.art.stage.requested', subject: DEVICE, dataschema: 'https://bunny.invalid/events/art-stage/2.1', data,
    }, {timeoutMs: 10_000})), 30_000);
    assert.equal(result.data.result, 'failed');
    assert.equal(result.data.error?.code, 'too-large');
    assert.equal(result.data.evidence, 'none');
    const absent = await world.module.manifest.content?.(`art-preview.${data.compositionId}`);
    assert.ok(absent !== undefined && 'error' in absent); assert.equal(absent.error.code, 'not-found');
    assert.deepEqual(await preview(world, prior.compositionId), committed);
    assert.equal(world.device.state().sent, 0);
  } finally { await world.close(); }
});
