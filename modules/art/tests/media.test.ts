// Local reduction, sheet validation, GIF assembly and local motion, on synthetic images only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {assembleGif, localMotion, paletteOf, proceduralImage, reduceFrame, reduceStill, sliceSheet, stillFromSheet, validateImage, validateSheet, MediaFault, SHEET_COLUMNS, SHEET_ROWS} from '../src/media.js';
import {gradientPng, noisePng, sheetPng} from './fixtures.js';

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
});

void test('reduction uses Lanczos to 64x64 and 64x32 with at most 32 colors', async () => {
  const source = await noisePng(1024, 1024);
  for (const [width, height] of [[64, 64], [64, 32]] as const) {
    const bytes = await reduceStill(source, width, height), info = await sharp(bytes).metadata();
    assert.deepEqual([info.width, info.height, info.format], [width, height, 'png']);
    assert.ok(await colours(bytes) <= 32);
  }
  // A one-pixel checkerboard has two values. Lanczos blends them; nearest-neighbor would keep both extremes.
  const checker = await sharp(Buffer.from(Array.from({length: 256 * 256}, (_, index) => (index + Math.floor(index / 256)) % 2 === 0 ? 0 : 255)), {raw: {width: 256, height: 256, channels: 1}}).png().toBuffer();
  const {data} = await sharp(await reduceStill(checker, 64, 64)).greyscale().raw().toBuffer({resolveWithObject: true});
  assert.ok(Math.min(...data) > 60 && Math.max(...data) < 195, 'the checkerboard is blended, not sampled');
});

void test('a palette is validated data for the theme', async () => {
  const palette = await paletteOf(await gradientPng(256, 256));
  assert.ok(palette.length >= 2 && palette.length <= 8);
  for (const colour of palette) assert.match(colour, /^#[0-9A-F]{6}$/);
});

void test('a stable sheet slices into six frames and passes', async () => {
  const sheet = await sheetPng();
  const frames = await sliceSheet(sheet);
  assert.equal(frames.length, SHEET_COLUMNS * SHEET_ROWS);
  assert.deepEqual(await validateSheet(sheet), {ok: true});
});

void test('misaligned cells and excess frame-to-frame change are rejected', async () => {
  assert.deepEqual(await validateSheet(await sheetPng({width: 1537})), {ok: false, reason: 'misaligned-cells'}, 'a sheet the grid does not divide');
  assert.deepEqual(await validateSheet(await sheetPng({straddle: true})), {ok: false, reason: 'misaligned-cells'}, 'a subject cut by a cell edge');
  assert.deepEqual(await validateSheet(await sheetPng({shiftScene: true})), {ok: false, reason: 'misaligned-cells'}, 'a scene that jumps between cells');
  assert.deepEqual(await validateSheet(await sheetPng({chaotic: true})), {ok: false, reason: 'excess-change'}, 'unrelated frames');
});

void test('frames assemble into a looping GIF at the target size with at most 32 colors', async () => {
  const frames = await Promise.all((await sliceSheet(await sheetPng())).map(frame => reduceFrame(frame, 64, 32)));
  const gif = assembleGif(frames, 64, 32), info = await sharp(gif, {animated: true}).metadata();
  assert.deepEqual([info.format, info.pages, info.width, info.pageHeight], ['gif', 6, 64, 32]);
  assert.ok(gif.length <= 160 * 1024);
  assert.ok(await colours(gif, true) <= 32);
});

void test('local motion gives a gentle GIF from a still; a rejected sheet still yields a source for it', async () => {
  const motion = await localMotion(await gradientPng(1024, 1024), 64, 64), info = await sharp(motion, {animated: true}).metadata();
  assert.deepEqual([info.format, info.pages, info.width, info.pageHeight], ['gif', 6, 64, 64]);
  const fromSheet = await stillFromSheet(await sheetPng({chaotic: true}), 'excess-change');
  assert.equal((await sharp(fromSheet).metadata()).width, 512, 'excess change keeps one whole cell');
  const whole = await stillFromSheet(await sheetPng({straddle: true}), 'misaligned-cells');
  assert.equal((await sharp(whole).metadata()).width, 1536, 'misaligned cells keep the sheet');
});

void test('procedural art is local bytes that depend only on their seed', async () => {
  const first = await proceduralImage('seed-a'), again = await proceduralImage('seed-a'), other = await proceduralImage('seed-b');
  assert.equal(first.equals(again), true);
  assert.equal(first.equals(other), false);
  assert.equal((await validateImage(first, 512, 512)).width, 512);
});
