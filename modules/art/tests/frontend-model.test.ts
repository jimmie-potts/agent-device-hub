import assert from 'node:assert/strict';
import test from 'node:test';
import type {ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import {artworkOf, browserArt, catalogOf, latestBrowserArt, money} from '../src/frontend/model.js';

const hash = 'a'.repeat(64);
const artwork = (): ArtworkSummary => ({artworkId: 'synthetic-one', createdAtMs: 1, favorite: false, feedback: null, variationOf: null,
  palette: ['#112233'], provenance: {generatedBy: 'openai', factual: false}, compositions: [{target: 'ui', compositionId: hash, outcome: 'succeeded', motion: 'still',
    renditions: [{renditionId: hash, ref: `rendition.${hash}`, width: 1536, height: 1024, bytes: 400, frames: 1, durationMs: 0, format: 'webp'}]}]});

void test('gallery consumes the real numeric catalog cursor and rejects malformed private content', () => {
  const row = artwork();
  assert.deepEqual(catalogOf({artworks: [row], nextAfter: 17}), {artworks: [row], nextAfter: 17});
  assert.deepEqual(catalogOf({artworks: [], nextAfter: null}), {artworks: [], nextAfter: null});
  for (const page of [{artworks: [row], nextAfter: '../private'}, {artworks: [row], nextAfter: -1}, {artworks: [row, row], nextAfter: null},
    {artworks: Array.from({length: 7}, (_, i) => ({...row, artworkId: `art-${i}`})), nextAfter: null}]) assert.throws(() => catalogOf(page));
  assert.equal(artworkOf({...row, palette: ['url(https://invalid)']}), undefined);
  assert.equal(artworkOf({...row, provenance: {generatedBy: 'openai', factual: true}}), undefined);
  const invalid = artwork(); const image = invalid.compositions[0]?.renditions[0]; assert.ok(image !== undefined);
  image.ref = 'rendition.../secret'; assert.equal(artworkOf(invalid), undefined);
});

void test('browser presentation selects rich stills and never promotes a display GIF or explicit dismissal', () => {
  const row = artwork(), small = {...row.compositions[0]?.renditions[0], width: 768, height: 512};
  const composition = row.compositions[0]; assert.ok(composition !== undefined);
  const original = composition.renditions[0]; assert.ok(original !== undefined);
  composition.renditions.push({...original, ...small});
  assert.equal(browserArt(row, true)?.rendition.width, 768);
  assert.equal(browserArt(row)?.rendition.width, 1536);
  assert.equal(latestBrowserArt([{...row, feedback: 'dismiss', createdAtMs: 10}, row])?.createdAtMs, 1);
  composition.target = 'pixoo'; composition.motion = 'gif';
  assert.equal(browserArt(row), undefined);
  assert.equal(money(3500), '$0.0035');
});
