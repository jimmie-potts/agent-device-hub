// The renderer (Hub #930). Copied from controllers/tidbyt/tests/render.test.mjs at main 627e3fe3 and converted to the
// strict profile. The frame wire format's tests are not copied, with `decodeFrameData`; the worker's render is added.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {FRAME_BYTES, renderFrame} from '../src/render.js';
import {renderTile, tileFrame} from '../src/tiles.js';
import {statusView} from '../src/status.js';
import {HEIGHT, WIDTH, goldenFrames, titleSessions} from './frames.js';

const fixtures = new URL('../../fixtures/', import.meta.url);
const golden = JSON.parse(readFileSync(new URL('golden.json', fixtures), 'utf8')) as {width: number; height: number; cases: {id: string; rgb: string}[]};
const build = (id: string): Uint8Array => {
  const frame = goldenFrames[id];
  if (frame === undefined) throw new Error(`no golden frame ${id}`);
  return frame();
};

void test('every golden frame renders to its committed WebP bytes', () => {
  assert.deepEqual(golden.cases.map(entry => entry.id).sort(), Object.keys(goldenFrames).sort());
  for (const entry of golden.cases) {
    const rgb = build(entry.id);
    assert.equal(Buffer.from(rgb).toString('base64'), entry.rgb, `${entry.id} frame data`);
    const result = renderFrame({width: WIDTH, height: HEIGHT, rgb});
    assert.ok(result.ok, entry.id);
    const expected = readFileSync(new URL(`golden/${entry.id}.webp`, fixtures));
    assert.deepEqual(Buffer.from(result.webp), expected, `${entry.id} bytes`);
  }
});

void test('a rendered frame is a well-formed RIFF/WEBP VP8L container', () => {
  const result = renderFrame({width: WIDTH, height: HEIGHT, rgb: build('status-bar')});
  assert.ok(result.ok);
  const view = Buffer.from(result.webp);
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

void test('rendering is deterministic and does not alias its input', () => {
  const rgb = build('noise');
  const before = Buffer.from(rgb);
  const a = renderFrame({width: WIDTH, height: HEIGHT, rgb});
  const b = renderFrame({width: WIDTH, height: HEIGHT, rgb});
  assert.deepEqual(a, b);
  assert.deepEqual(Buffer.from(rgb), before);
});

void test('invalid frames produce no image', () => {
  const good = build('black');
  const cases: unknown[] = [
    {width: 64, height: 64, rgb: new Uint8Array(64 * 64 * 3)},
    {width: 32, height: 32, rgb: new Uint8Array(32 * 32 * 3)},
    {width: 64, height: 32, rgb: good.subarray(1)},
    {width: 64, height: 32, rgb: new Uint8Array(FRAME_BYTES + 3)},
    {width: 64, height: 32, rgb: Array.from(good)},
    {width: 64, height: 32},
    {width: '64', height: 32, rgb: good},
    {width: 64, height: 32, rgb: good, extra: true},
    null,
  ];
  for (const frame of cases) assert.deepEqual(renderFrame(frame), {ok: false, code: 'invalid-frame'});
});

void test('the render worker\'s function draws and encodes a tile\'s view, and refuses anything else', () => {
  const view = statusView({synced: true, sessions: titleSessions()});
  const reply = renderTile({tile: 'status', view});
  const expected = renderFrame(tileFrame({tile: 'status', view}));
  assert.ok(reply.ok && expected.ok);
  assert.deepEqual(reply.webp, expected.webp);
  for (const request of [undefined, null, {tile: 'other', view}, {tile: 'status'}, {tile: 'status', view: []}]) assert.deepEqual(renderTile(request), {ok: false});
});

void test('the renderer imports nothing from the cloud, credentials, configuration or the module', () => {
  for (const file of ['render.js', 'webp.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:import|from)\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.ok(imports.every(name => name === './webp.js'), `${file} imports ${imports.join(', ')}`);
  }
});
