import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderFrame, decodeFrameData, FRAME_BYTES } from '../dist/index.js';
import { goldenFrames, WIDTH, HEIGHT } from './frames.mjs';

const golden = JSON.parse(readFileSync(new URL('../fixtures/golden.json', import.meta.url), 'utf8'));

test('every golden frame renders to its committed WebP bytes', () => {
  assert.deepEqual(golden.cases.map(c => c.id).sort(), Object.keys(goldenFrames).sort());
  for (const c of golden.cases) {
    const rgb = goldenFrames[c.id]();
    assert.equal(Buffer.from(rgb).toString('base64'), c.rgb, `${c.id} frame data`);
    const result = renderFrame({ width: WIDTH, height: HEIGHT, rgb });
    assert.equal(result.ok, true, c.id);
    const expected = readFileSync(new URL(`../fixtures/golden/${c.id}.webp`, import.meta.url));
    assert.deepEqual(Buffer.from(result.webp), expected, `${c.id} bytes`);
  }
});

test('a rendered frame is a well-formed RIFF/WEBP VP8L container', () => {
  const { webp } = renderFrame({ width: WIDTH, height: HEIGHT, rgb: goldenFrames['status-bar']() });
  const view = Buffer.from(webp);
  assert.equal(view.toString('latin1', 0, 4), 'RIFF');
  assert.equal(view.readUInt32LE(4), view.length - 8);
  assert.equal(view.toString('latin1', 8, 16), 'WEBPVP8L');
  assert.equal(view.length % 2, 0);
  assert.equal(view[20], 0x2f);
  const bits = view.readUInt32LE(21);
  assert.equal((bits & 0x3fff) + 1, 64);
  assert.equal(((bits >>> 14) & 0x3fff) + 1, 32);
  assert.equal(bits >>> 29, 0, 'version 0');
});

test('rendering is deterministic and does not alias its input', () => {
  const rgb = goldenFrames.noise();
  const before = Buffer.from(rgb);
  const a = renderFrame({ width: WIDTH, height: HEIGHT, rgb });
  const b = renderFrame({ width: WIDTH, height: HEIGHT, rgb });
  assert.deepEqual(a, b);
  assert.deepEqual(Buffer.from(rgb), before);
});

test('invalid frames produce no image', () => {
  const good = goldenFrames.black();
  const cases = [
    { width: 64, height: 64, rgb: new Uint8Array(64 * 64 * 3) },
    { width: 32, height: 32, rgb: new Uint8Array(32 * 32 * 3) },
    { width: 64, height: 32, rgb: good.subarray(1) },
    { width: 64, height: 32, rgb: new Uint8Array(FRAME_BYTES + 3) },
    { width: 64, height: 32, rgb: Array.from(good) },
    { width: 64, height: 32 },
    { width: '64', height: 32, rgb: good },
    { width: 64, height: 32, rgb: good, extra: true },
    null,
  ];
  for (const frame of cases) assert.deepEqual(renderFrame(frame), { ok: false, code: 'invalid-frame' });
});

test('frame data decoding accepts only canonical base64 of exactly one frame', () => {
  const data = Buffer.from(goldenFrames['two-tone']()).toString('base64');
  const decoded = decodeFrameData({ width: 64, height: 32, encoding: 'rgb24-base64', data });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.frame.rgb.length, FRAME_BYTES);
  const bad = [
    { width: 64, height: 32, encoding: 'rgb24-base64', data: data.slice(0, -4) },
    { width: 64, height: 32, encoding: 'rgb24-base64', data: data + 'AAAA' },
    { width: 64, height: 32, encoding: 'rgb24-base64', data: data.replace(/.$/, '\n') },
    { width: 64, height: 32, encoding: 'rgb24-base64', data: data.replace('A', '-') },
    { width: 64, height: 32, encoding: 'rgba32-base64', data },
    { width: 64, height: 16, encoding: 'rgb24-base64', data },
    { width: 64, height: 32, encoding: 'rgb24-base64' },
    { width: 64, height: 32, encoding: 'rgb24-base64', data, label: 'x' },
  ];
  for (const frame of bad) assert.deepEqual(decodeFrameData(frame), { ok: false, code: 'invalid-frame' });
});

test('the renderer imports nothing from backend, credential or controller modules', () => {
  for (const file of ['render.js', 'webp.js']) {
    const source = readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:import|from)\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    assert(imports.every(name => ['./webp.js'].includes(name)), `${file} imports ${imports}`);
  }
});
