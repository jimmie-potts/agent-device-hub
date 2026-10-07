// The golden frames, decoded independently of the module's encoder (Hub #930). This replaces the old controller's
// Pillow check (controllers/tidbyt/tests/test_golden.py at main 627e3fe3): `sharp` decodes each committed WebP with its
// own libwebp build, and every pixel must match the frame recorded in golden.json. A corrupted golden must fail.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import sharp, {type OutputInfo} from 'sharp';

const fixtures = new URL('../../fixtures/', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('golden.json', fixtures), 'utf8')) as {width: number; height: number; cases: {id: string; rgb: string}[]};

/**
 * Decodes `webp` with libwebp, through sharp, and answers why it does not show `rgb`, or undefined when every pixel
 * matches and every pixel is opaque.
 */
async function mismatch(webp: Buffer, rgb: Buffer): Promise<string | undefined> {
  let decoded: {data: Buffer; info: OutputInfo};
  try {
    const metadata = await sharp(webp).metadata();
    if (metadata.format !== 'webp') return `the image is ${String(metadata.format)}, not WebP`;
    decoded = await sharp(webp).raw().toBuffer({resolveWithObject: true});
  } catch {
    return 'libwebp could not decode the image';
  }
  const {data, info} = decoded;
  if (info.width !== golden.width || info.height !== golden.height) return `the image is ${info.width}x${info.height}`;
  if (rgb.length !== golden.width * golden.height * 3) return 'the expected frame is not 64x32 RGB';
  let pixels = data;
  if (info.channels === 4) {
    // A decoder that keeps the alpha channel must find every pixel opaque, as the encoder writes it.
    pixels = Buffer.alloc(rgb.length);
    for (let from = 0, to = 0; from < data.length; from += 4, to += 3) {
      if (data[from + 3] !== 255) return `the pixel at ${to / 3} is not opaque`;
      data.copy(pixels, to, from, from + 3);
    }
  } else if (info.channels !== 3) {
    return `the image has ${info.channels} channels`;
  }
  const at = pixels.findIndex((value, index) => value !== rgb[index]);
  return at < 0 ? undefined : `the pixel at ${Math.floor(at / 3)} differs`;
}

const read = (id: string): Buffer => readFileSync(new URL(`golden/${id}.webp`, fixtures));
const expected = (id: string): Buffer => Buffer.from(golden.cases.find(entry => entry.id === id)?.rgb ?? '', 'base64');

void test('sharp decodes WebP with its own libwebp', () => {
  assert.match(sharp.versions.webp ?? '', /^\d+\.\d+/, 'libwebp is available');
});

void test('every golden image decodes to its frame, pixel by pixel, through an independent libwebp decoder', async () => {
  assert.deepEqual([golden.width, golden.height], [64, 32]);
  assert.ok(golden.cases.length >= 5);
  for (const {id} of golden.cases) assert.equal(await mismatch(read(id), expected(id)), undefined, id);
});

void test('a corrupted golden fails the check: a changed pixel, a truncated image and a changed expectation', async () => {
  // Every case but black has fixed 8-bit codes for its pixels, so one flipped bit in the pixel data changes one pixel.
  const changed = Buffer.from(read('noise'));
  const index = changed.length - 200;
  changed[index] = (changed[index] ?? 0) ^ 0x10;
  assert.match(await mismatch(changed, expected('noise')) ?? '', /differs/);
  assert.match(await mismatch(read('status-titles').subarray(0, 400), expected('status-titles')) ?? '', /could not decode|differs/);
  const wrong = Buffer.from(expected('now-playing'));
  wrong[3000] = (wrong[3000] ?? 0) ^ 0xff;
  assert.match(await mismatch(read('now-playing'), wrong) ?? '', /differs/);
});
