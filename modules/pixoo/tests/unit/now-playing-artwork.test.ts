import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {renderArtworkCard} from '../../src/presentation/artwork-card.js';
import {renderNowPlaying, type NowPlayingView} from '../../src/presentation/now-playing.js';
import {expectedCard, type GoldenLine} from '../helpers/artwork-oracle.js';
type CardView = Extract<NowPlayingView, {card: true}>;
type Ready = Extract<PlaybackArtwork, {status: 'ready'}>;
const GENERATION = '11111111-1111-4111-8111-111111111111';
const baseView: CardView = {card: true, status: 'playing', title: 'A', artist: 'H', stale: false};
async function image(width = 1, height = 1): Promise<Ready> {
  const png = await sharp({create: {width, height, channels: 3, background: {r: 192, g: 24, b: 48}}}).png().toBuffer();
  return {status: 'ready', generation: GENERATION, mediaType: 'image/png', width, height, base64: png.toString('base64')};
}
async function rendered(view: CardView, artwork?: PlaybackArtwork): Promise<{rgb: Uint8Array; code: unknown}> {
  const result = await renderArtworkCard(view, artwork);
  assert.equal(result.frame.length, 12_288);
  // Independently decode an export of the complete worker RGB; the literal oracle checks layout.
  const png = await sharp(result.frame, {raw: {width: 64, height: 64, channels: 3}}).png().toBuffer();
  const {data, info} = await sharp(png).raw().toBuffer({resolveWithObject: true});
  assert.deepEqual([info.width, info.height, info.channels], [64, 64, 3]);
  return {rgb: new Uint8Array(data), code: result.artworkCode};
}
void test('complete artwork frames match the independent bitmap oracle for playing, paused and stale', async () => {
  const artwork = await image();
  for (const status of ['playing', 'paused'] as const) for (const stale of [false, true]) {
    const view = {...baseView, status, stale};
    const actual = await rendered(view, artwork);
    assert.equal(actual.code, undefined);
    const expected = expectedCard(64, status, stale, [{text: 'A', y: 13}, {text: 'H', y: 27, artist: true}]);
    assert.deepEqual(actual.rgb, expected);
    const wrong = expected.slice(); wrong[3000] = (wrong[3000] ?? 0) ^ 255;
    assert.throws(() => { assert.deepEqual(actual.rgb, wrong); }, 'changed oracle must fail');
  }
});
void test('long and missing text retains its fixed row allocation beside artwork', async () => {
  const artwork = await image();
  const cases: {title: string; artist: string; lines: GoldenLine[]}[] = [
    {title: 'A'.repeat(20), artist: 'H'.repeat(20), lines: [{text: 'AAAAAAAAA', y: 13}, {text: 'AAAAAAAAA', y: 20}, {text: 'AA', y: 27}, {text: 'HHHHHHHHH', y: 41, artist: true}, {text: 'HHHHHHHHH', y: 48, artist: true}, {text: 'HH', y: 55, artist: true}]},
    {title: '', artist: 'H', lines: [{text: 'H', y: 13, artist: true}]},
    {title: 'A', artist: '', lines: [{text: 'A', y: 13}]},
    {title: '', artist: '', lines: []},
  ];
  for (const entry of cases) assert.deepEqual((await rendered({...baseView, title: entry.title, artist: entry.artist}, artwork)).rgb,
    expectedCard(64, 'playing', false, entry.lines));
});
void test('a non-square solid image is contained with black padding', async () => {
  assert.deepEqual((await rendered(baseView, await image(2, 1))).rgb,
    expectedCard(64, 'playing', false, [{text: 'A', y: 13}, {text: 'H', y: 27, artist: true}], true));
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
    assert.deepEqual(result.rgb, renderNowPlaying(baseView));
    assert.equal(result.code, entry.code);
  }
});
