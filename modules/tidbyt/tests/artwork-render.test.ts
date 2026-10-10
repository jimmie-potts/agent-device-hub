import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {renderArtworkTile} from '../src/tiles.js';
import {nowPlayingFrame, type CardView} from '../src/nowplaying.js';
import {expectedCard, type GoldenLine} from './artwork-oracle.js';
type Ready = Extract<PlaybackArtwork, {status: 'ready'}>;
const GENERATION = '11111111-1111-4111-8111-111111111111';
const baseView: CardView = {card: true, status: 'playing', title: 'A', artist: 'H', stale: false};
async function image(width = 1, height = 1): Promise<Ready> {
  const png = await sharp({create: {width, height, channels: 3, background: {r: 192, g: 24, b: 48}}}).png().toBuffer();
  return {status: 'ready', generation: GENERATION, mediaType: 'image/png', width, height, base64: png.toString('base64')};
}
async function rendered(view: CardView, artwork?: PlaybackArtwork): Promise<{rgb: Uint8Array; code: unknown}> {
  const result = await renderArtworkTile({tile: 'now-playing', view, ...(artwork === undefined ? {} : {artwork})});
  assert.ok(result.ok);
  const metadata = await sharp(result.webp).metadata();
  assert.equal(metadata.format, 'webp');
  const {data, info} = await sharp(result.webp).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject: true});
  assert.deepEqual([info.width, info.height, info.channels], [64, 32, 3]);
  return {rgb: new Uint8Array(data), code: result.artworkCode};
}
void test('complete artwork frames match the independent bitmap oracle for playing, paused and stale', async () => {
  const artwork = await image();
  for (const status of ['playing', 'paused'] as const) for (const stale of [false, true]) {
    const view = {...baseView, status, stale};
    const actual = await rendered(view, artwork);
    assert.equal(actual.code, undefined);
    const expected = expectedCard(32, status, stale, [{text: 'A', y: 1}, {text: 'H', y: 9, artist: true}]);
    assert.deepEqual(actual.rgb, expected);
    const wrong = expected.slice(); wrong[3000] = (wrong[3000] ?? 0) ^ 255;
    assert.throws(() => { assert.deepEqual(actual.rgb, wrong); }, 'changed oracle must fail');
  }
});
void test('long and missing text retains its fixed row allocation beside artwork', async () => {
  const artwork = await image();
  const cases: {title: string; artist: string; lines: GoldenLine[]}[] = [
    {title: 'A'.repeat(20), artist: 'H'.repeat(20), lines: [{text: 'AAAAAAAAA', y: 1}, {text: 'AAAAAAAA.', y: 9}, {text: 'HHHHHHHHH', y: 17, artist: true}, {text: 'HHHHHHHH.', y: 25, artist: true}]},
    {title: '', artist: 'H', lines: [{text: 'H', y: 1, artist: true}]},
    {title: 'A', artist: '', lines: [{text: 'A', y: 1}]},
    {title: '', artist: '', lines: []},
  ];
  for (const entry of cases) assert.deepEqual((await rendered({...baseView, title: entry.title, artist: entry.artist}, artwork)).rgb,
    expectedCard(32, 'playing', false, entry.lines));
});
void test('a non-square solid image is contained with black padding', async () => {
  assert.deepEqual((await rendered(baseView, await image(2, 1))).rgb,
    expectedCard(32, 'playing', false, [{text: 'A', y: 1}, {text: 'H', y: 9, artist: true}], true));
});
void test('absent and refused artwork preserve the exact synchronous text fallback and safe refusal code', async () => {
  const ready = await image();
  const png = Buffer.from(ready.base64, 'base64');
  const corrupt = Buffer.from(png);
  for (let offset = 8; offset + 12 <= corrupt.length; offset += corrupt.readUInt32BE(offset) + 12) {
    if (corrupt.toString('ascii', offset + 4, offset + 8) === 'IDAT') { corrupt[offset + 8] = 0; break; }
  }
  const animation = Buffer.alloc(20); animation.writeUInt32BE(8, 0); animation.write('acTL', 4, 'ascii');
  const animated = Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]);
  const cases: {artwork?: PlaybackArtwork; code?: string}[] = [
    {}, {artwork: {status: 'missing', generation: GENERATION}}, {artwork: {status: 'unsupported', generation: GENERATION}},
    {artwork: {...ready, base64: png.subarray(0, -1).toString('base64')}, code: 'invalid-request'},
    {artwork: {...ready, base64: Buffer.concat([png, png.subarray(-12)]).toString('base64')}, code: 'invalid-request'},
    {artwork: {...ready, base64: corrupt.toString('base64')}, code: 'invalid-request'},
    {artwork: {...ready, width: 2}, code: 'invalid-request'},
    {artwork: {...ready, width: 129}, code: 'invalid-request'},
    {artwork: {...ready, base64: ready.base64 + '\n'}, code: 'invalid-request'},
    {artwork: {...ready, base64: Buffer.alloc(65_537).toString('base64')}, code: 'too-large'},
    {artwork: {...ready, base64: animated.toString('base64')}, code: 'unsupported-capability'},
  ];
  for (const entry of cases) {
    const result = await rendered(baseView, entry.artwork);
    assert.deepEqual(result.rgb, nowPlayingFrame(baseView).rgb);
    assert.equal(result.code, entry.code);
  }
});
