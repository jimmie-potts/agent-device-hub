import assert from 'node:assert/strict';
import test from 'node:test';
import {changeArtPlacement, fitArt} from '../src/home-art.ts';
import type {HomeArrangements} from '@jimmie-potts/event-contracts/v2/families';

void test('art fits only a complete bounded trailing rectangle and preserves its selected shape', () => {
  assert.equal(fitArt(1000, 120), undefined, 'full Home omits art');
  assert.equal(fitArt(200, 600), undefined, 'a narrow unusable area is omitted');
  for (const width of [288, 358, 900]) for (const format of ['banner', 'square', 'tall'] as const) {
    const value = fitArt(width, 800, format);
    assert.ok(value !== undefined, `${width}/${format} has space`);
    assert.equal(value.format, format);
    assert(value.width <= width && value.height <= 800);
  }
  assert.equal(fitArt(1000, 340)?.format, 'banner');
  assert.equal(fitArt(358, 800)?.format, 'tall');
  assert.equal(fitArt(Number.NaN, 600), undefined);
});

void test('pin/dismiss/restore alter only explicit art metadata at the selected breakpoint', () => {
  const original: HomeArrangements = {desktop: [{widget: 'inbox', size: 'small', hidden: false}], phone: [{widget: 'sessions', size: 'medium', hidden: false}]};
  const pinned = changeArtPlacement(original, 'desktop', {art: {format: 'square', pinned: true}});
  assert.equal(original.desktop.length, 1);
  assert.deepEqual(pinned.desktop[0], original.desktop[0]);
  assert.deepEqual(pinned.phone, original.phone);
  assert.deepEqual(pinned.desktop[1]?.art, {format: 'square', pinned: true});
  const hidden = changeArtPlacement(pinned, 'desktop', {hidden: true});
  assert.equal(hidden.desktop[1]?.hidden, true);
  assert.deepEqual(changeArtPlacement(hidden, 'desktop', {hidden: false}), pinned);
});
