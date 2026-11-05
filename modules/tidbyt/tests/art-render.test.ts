import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';
import {renderArtworkTile} from '../src/tiles.js';
import {test} from './support.js';
import {artStage, gifFrames} from './art-fixtures.js';

test('the art worker preserves the exact pixels and timing of every GIF frame', async () => {
  const frame = Buffer.alloc(64 * 32 * 3);
  const other = Buffer.alloc(frame.length);
  for (let at = 0; at < frame.length; at += 3) {frame[at] = 255; other[at + 2] = 255;}
  const expected = Buffer.concat([frame, other]);
  const gif = await sharp(expected, {raw: {width: 64, height: 64, channels: 3, pageHeight: 32}}).gif({delay: [100, 300], loop: 0}).toBuffer();
  const stage: ArtStageContent = {compositionId: 'a'.repeat(64), format: 'gif', width: 64, height: 32, frames: 2, durationMs: 400,
    sha256: createHash('sha256').update(gif).digest('hex'), base64: gif.toString('base64'), lifetimeMs: 86_400_000};
  const result = await renderArtworkTile({tile: 'art', stage});
  assert.equal(result.ok, true, 'valid exact art is prepared instead of falling back to a mood');
  if (!result.ok) return;
  const decoded = sharp(result.webp, {animated: true});
  const metadata = await decoded.metadata();
  assert.deepEqual([metadata.width, metadata.pageHeight, metadata.pages, metadata.delay, metadata.loop], [64, 32, 2, [100, 300], 0]);
  assert.deepEqual(await decoded.removeAlpha().raw().toBuffer(), expected);
});

test('duplicate frames remain distinct with their original delays and valid RIFF chunk bounds', async () => {
  const stage = artStage(gifFrames([{index: 1, delay: 100}, {index: 1, delay: 200}, {index: 2, delay: 300}]), {frames: 3, durationMs: 600});
  const result = await renderArtworkTile({tile: 'art', stage});
  assert.ok(result.ok);
  const bytes = Buffer.from(result.webp);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  let at = 12;
  const kinds: string[] = [];
  while (at < bytes.length) {
    const kind = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4);
    kinds.push(kind);
    assert.ok(at + 8 + size <= bytes.length);
    if (kind === 'ANMF') {
      assert.equal(bytes[at + 23], 2, 'complete opaque frames replace their canvas');
      assert.equal(bytes.toString('ascii', at + 24, at + 28), 'VP8L');
      assert.equal(size, 24 + bytes.readUInt32LE(at + 28) + (bytes.readUInt32LE(at + 28) & 1));
    }
    if ((size & 1) !== 0) assert.equal(bytes[at + 8 + size], 0);
    at += 8 + size + (size & 1);
  }
  assert.equal(at, bytes.length);
  assert.deepEqual(kinds, ['VP8X', 'ANIM', 'ANMF', 'ANMF', 'ANMF']);
  const image = sharp(result.webp, {animated: true}), metadata = await image.metadata();
  assert.deepEqual([metadata.pages, metadata.delay], [3, [100, 200, 300]]);
  const raw = await image.removeAlpha().raw().toBuffer();
  assert.deepEqual(raw.subarray(0, 6144), raw.subarray(6144, 12288));
  assert.notDeepEqual(raw.subarray(0, 6144), raw.subarray(12288));
});

test('transparent GIF disposal is composited into exact opaque frames, and PNG remains a still', async () => {
  const pixels = new Uint8Array(2048); pixels[0] = 3;
  const gif = gifFrames([{index: 1, delay: 200, dispose: 2}, {index: 0, delay: 300, pixels, transparent: true}]);
  const result = await renderArtworkTile({tile: 'art', stage: artStage(gif, {durationMs: 500})});
  assert.ok(result.ok);
  const expected = await sharp(gif, {animated: true}).flatten({background: '#000000'}).removeAlpha().raw().toBuffer();
  assert.deepEqual(await sharp(result.webp, {animated: true}).removeAlpha().raw().toBuffer(), expected);
  assert.deepEqual([...expected.subarray(6144, 6150)], [0, 255, 0, 0, 0, 0]);
  const png = await sharp({create: {width: 64, height: 32, channels: 4, background: {r: 255, g: 0, b: 0, alpha: 0}}}).png().toBuffer();
  const still = await renderArtworkTile({tile: 'art', stage: artStage(png, {format: 'png', frames: 1, durationMs: 0})});
  assert.ok(still.ok);
  assert.deepEqual(await sharp(still.webp).removeAlpha().raw().toBuffer(), Buffer.alloc(6144));
  assert.equal((await sharp(still.webp).metadata()).pages, undefined);
  const restored = gifFrames([{index: 1, delay: 100}, {index: 0, delay: 200, pixels, transparent: true, dispose: 3}, {index: 0, delay: 300, transparent: true}]);
  const restoreOutput = await renderArtworkTile({tile: 'art', stage: artStage(restored, {frames: 3, durationMs: 600})});
  assert.ok(restoreOutput.ok);
  const restoredPixels = await sharp(restoreOutput.webp, {animated: true}).removeAlpha().raw().toBuffer();
  assert.deepEqual(restoredPixels.subarray(0, 6144), restoredPixels.subarray(12288), 'restore-previous disposal restores the first canvas');
  assert.deepEqual(restoredPixels, await sharp(restored, {animated: true}).flatten({background: '#000000'}).removeAlpha().raw().toBuffer());
});

test('the largest frame count keeps every delay and an output above the old thumbnail limit', async () => {
  const palette = Array.from({length: 256}, (_, index) => [index, (index * 37) % 256, (index * 71) % 256]);
  const frames = Array.from({length: 20}, (_, index) => ({index: 0, delay: 800, pixels: Uint8Array.from({length: 2048}, (_, at) => (at + index) % 256)}));
  const source = gifFrames(frames, palette);
  const result = await renderArtworkTile({tile: 'art', stage: artStage(source, {frames: 20, durationMs: 16_000})});
  assert.ok(result.ok);
  assert.ok(result.webp.length > 65_536 && result.webp.length <= 163_840, 'the art and thumbnail envelopes are distinct');
  const output = sharp(result.webp, {animated: true});
  assert.deepEqual((await output.metadata()).delay, Array<number>(20).fill(800));
  assert.deepEqual(await output.removeAlpha().raw().toBuffer(), await sharp(source, {animated: true}).removeAlpha().raw().toBuffer());
  const broken = Buffer.from(result.webp); broken.writeUInt32LE(0xffffffff, 16);
  await assert.rejects(sharp(broken, {animated: true}).raw().toBuffer(), 'the independent decoder detects corrupt chunk bounds');
});

test('art refuses malformed framing, false metadata and unsupported bounds without a fallback frame', async () => {
  const gif = gifFrames([{index: 1, delay: 200}, {index: 2, delay: 200}]);
  const interactive = Buffer.from(gif), control = interactive.indexOf(Buffer.from([0x21, 0xf9, 4]));
  assert.ok(control >= 0);
  interactive[control + 3] = (interactive[control + 3] ?? 0) | 2;
  const cases: ArtStageContent[] = [
    artStage(interactive),
    artStage(gif.subarray(0, gif.length - 1)), artStage(Buffer.concat([gif, Buffer.from([0])])),
    artStage(gif, {frames: 1}), artStage(gif, {durationMs: 500}), artStage(gif, {width: 32}), artStage(gif, {sha256: '0'.repeat(64)}),
    artStage(gif, {frames: 21}), artStage(gif, {durationMs: 16_001}), artStage(Buffer.alloc(163_841)),
    artStage(gifFrames([{index: 1, delay: 10}, {index: 2, delay: 200}]), {durationMs: 210}),
    artStage(gifFrames([{index: 1, delay: 900}, {index: 2, delay: 200}]), {durationMs: 1100}),
  ];
  for (const stage of cases) assert.equal((await renderArtworkTile({tile: 'art', stage})).ok, false);
  const single = await renderArtworkTile({tile: 'art', stage: artStage(gifFrames([{index: 1, delay: 200}]), {frames: 1, durationMs: 200})});
  assert.ok(single.ok);
  assert.deepEqual((await sharp(single.webp, {animated: true}).metadata()).delay, [200]);
});
