import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {Worker} from 'node:worker_threads';
import {decodeArtwork} from '../src/artwork-decode.js';
const image = (width: number, height: number) => sharp({create: {width, height, channels: 3, background: {r: 20, g: 60, b: 100}}});

void test('synthetic JPEG becomes bounded metadata-free PNG with preserved aspect', async () => {
  const jpeg = await image(320, 160).withMetadata({orientation: 1}).jpeg().toBuffer();
  const result = await decodeArtwork(jpeg); assert.ok(result.ok);
  assert.equal(result.value.mediaType, 'image/png'); assert.equal(result.value.width, 128); assert.equal(result.value.height, 64);
  const png = Buffer.from(result.value.base64, 'base64'); assert.ok(png.byteLength <= 65536);
  const metadata = await sharp(png).metadata(); assert.equal(metadata.format, 'png'); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
});

void test('pixel limit accepts 4MP and rejects excess pixels without raw decoder errors', async () => {
  const boundary = await image(2000, 2000).png().toBuffer(); assert.equal((await decodeArtwork(boundary)).ok, true);
  const over = await image(2001, 2000).png().toBuffer(); assert.deepEqual(await decodeArtwork(over), {ok: false, code: 'capacity', transient: false});
});

void test('unsupported signatures, corrupt PNG and oversized input fail safely', async () => {
  assert.deepEqual(await decodeArtwork(Buffer.from('not an image')), {ok: false, code: 'unsupported', transient: false});
  assert.equal((await decodeArtwork(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).ok, false);
  assert.deepEqual(await decodeArtwork(new Uint8Array(1_048_577)), {ok: false, code: 'capacity', transient: false});
});


void test('output beyond 64KiB is refused after normalization', async () => {
  const raw = Buffer.alloc(128 * 128 * 4);
  let seed = 123456789;
  for (let index = 0; index < raw.length; index++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; raw[index] = seed & 255; }
  const png = await sharp(raw, {raw: {width: 128, height: 128, channels: 4}}).png().toBuffer();
  assert.deepEqual(await decodeArtwork(png), {ok: false, code: 'capacity', transient: false});
});

void test('worker entry accepts synthetic bytes and replies with a normalized thumbnail', async () => {
  const bytes = await image(8, 8).jpeg().toBuffer();
  const worker = new Worker(new URL('../src/artwork-worker.js', import.meta.url), {workerData: bytes});
  try {
    const result: unknown = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    assert.ok(typeof result === 'object' && result !== null && 'ok' in result && result.ok === true);
  } finally { await worker.terminate(); }
});
