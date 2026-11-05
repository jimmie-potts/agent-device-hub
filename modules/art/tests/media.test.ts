// Local reduction, sheet validation, GIF assembly and local motion, on synthetic images only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {assembleGif, decodeGif, localMotion, paletteOf, proceduralImage, reduceGif, validateImage, MediaFault} from '../src/media.js';
import {gifBytes, gradientPng, noisePng} from './fixtures.js';

const colours = async (bytes: Uint8Array, animated = false): Promise<number> => {
  const {data, info} = await sharp(bytes, {animated}).ensureAlpha().raw().toBuffer({resolveWithObject: true}), seen = new Set<number>();
  for (let index = 0; index < data.length; index += info.channels) seen.add(((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0));
  return seen.size;
};

void test('valid output passes; corrupt, missing, oversized and wrong-sized output is refused before storage', async () => {
  const good = await gradientPng(1024, 1024);
  assert.equal((await validateImage(good, 1024, 1024)).width, 1024);
  await assert.rejects(validateImage(Buffer.from('not an image'), 1024, 1024), MediaFault);
  await assert.rejects(validateImage(Buffer.alloc(0), 1024, 1024), MediaFault);
  await assert.rejects(validateImage(good.subarray(0, Math.floor(good.length / 2)), 1024, 1024), MediaFault, 'a truncated file');
  await assert.rejects(validateImage(good, 1536, 1024), MediaFault, 'not the size requested');
  await assert.rejects(validateImage(await sharp(good).webp().toBuffer(), 1024, 1024), MediaFault, 'not the format requested');
  await assert.rejects(validateImage(Buffer.alloc(40 * 1024 * 1024, 1), 1024, 1024), MediaFault, 'oversized');
  await assert.rejects(validateImage(gifBytes(1024, 1024, {frames: 2}), 1024, 1024), MediaFault, 'a GIF is not a still');
});

void test('reducing a GIF uses Lanczos to 64x64 and 64x32, with one palette of at most 32 colors and uniform timing', async () => {
  // Noise frames need the whole palette, so the 32-color bound is what limits them.
  const {data} = await sharp(await noisePng(512, 512)).ensureAlpha().raw().toBuffer({resolveWithObject: true}), frames = Array.from({length: 8}, () => data);
  for (const [width, height] of [[64, 64], [64, 32]] as const) {
    const bytes = await reduceGif(frames, 512, 512, width, height), info = await sharp(bytes, {animated: true}).metadata();
    assert.deepEqual([info.format, info.pages, info.width, info.pageHeight], ['gif', 8, width, height]);
    assert.deepEqual(info.delay, Array.from({length: 8}, () => 200));
    assert.ok(await colours(bytes, true) <= 32);
    assert.ok(bytes.length <= 160 * 1024);
  }
  // A one-pixel checkerboard has two values. Lanczos blends them; nearest-neighbor would keep both extremes.
  const checker = Buffer.from(Array.from({length: 256 * 256 * 4}, (_, index) => {const pixel = Math.floor(index / 4); return index % 4 === 3 ? 255 : (pixel + Math.floor(pixel / 256)) % 2 === 0 ? 0 : 255;}));
  const reduced = await reduceGif([checker, checker], 256, 256, 64, 64), first = await sharp(reduced, {animated: true}).greyscale().raw().toBuffer();
  assert.ok(Math.min(...first) > 60 && Math.max(...first) < 195, 'the checkerboard is blended, not sampled');
});

void test('a palette is validated data for the theme', async () => {
  const palette = await paletteOf(await gradientPng(256, 256));
  assert.ok(palette.length >= 2 && palette.length <= 8);
  for (const colour of palette) assert.match(colour, /^#[0-9A-F]{6}$/);
});

void test('a returned GIF decodes into its frames under the limits', async () => {
  const frames = await decodeGif(gifBytes(512, 256), 512, 256, 8);
  assert.equal(frames.length, 8);
  assert.equal(frames[0]?.length, 512 * 256 * 4);
  assert.notDeepEqual(frames[0], frames[7], 'the frames are the GIF\'s own');
});

void test('a wrong result is refused: frame count, dimensions, timing, format or corrupt bytes', async () => {
  const good = gifBytes(512, 512);
  await assert.rejects(decodeGif(gifBytes(512, 512, {frames: 7}), 512, 512, 8), MediaFault, 'too few frames');
  await assert.rejects(decodeGif(gifBytes(512, 256), 512, 512, 8), MediaFault, 'another shape');
  await assert.rejects(decodeGif(gifBytes(512, 512, {delayMs: 50}), 512, 512, 8), MediaFault, 'too fast for Pixoo');
  await assert.rejects(decodeGif(gifBytes(512, 512, {delayMs: 900}), 512, 512, 8), MediaFault, 'too slow for Pixoo');
  await assert.rejects(decodeGif(gifBytes(512, 512, {frames: 21}), 512, 512, 21), MediaFault, 'more frames than Pixoo admits');
  await assert.rejects(decodeGif(gifBytes(512, 512, {frames: 1}), 512, 512, 1), MediaFault, 'a still');
  await assert.rejects(decodeGif(await gradientPng(512, 512), 512, 512, 8), MediaFault, 'not a GIF');
  await assert.rejects(decodeGif(good.subarray(0, Math.floor(good.length / 2)), 512, 512, 8), MediaFault, 'truncated');
  await assert.rejects(decodeGif(Buffer.alloc(0), 512, 512, 8), MediaFault, 'empty');
  await assert.rejects(decodeGif(Buffer.alloc(40 * 1024 * 1024, 1), 512, 512, 8), MediaFault, 'oversized');
});

void test('frames assemble into a looping GIF with one palette', () => {
  const frame = Buffer.alloc(64 * 32 * 4, 200), gif = assembleGif([frame, frame], 64, 32);
  assert.equal(gif.subarray(0, 6).toString('latin1'), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 64);
  assert.equal(gif.readUInt16LE(8), 32);
});

void test('local motion gives a gentle eight-frame GIF from a still, for free', async () => {
  const motion = await localMotion(await gradientPng(1024, 1024), 64, 64), info = await sharp(motion, {animated: true}).metadata();
  assert.deepEqual([info.format, info.pages, info.width, info.pageHeight], ['gif', 8, 64, 64]);
  assert.ok(await colours(motion, true) <= 32);
});

void test('procedural art is local bytes that depend only on their seed', async () => {
  const first = await proceduralImage('seed-a'), again = await proceduralImage('seed-a'), other = await proceduralImage('seed-b');
  assert.equal(first.equals(again), true);
  assert.equal(first.equals(other), false);
  assert.equal((await validateImage(first, 512, 512)).width, 512);
});
