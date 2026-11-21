import assert from 'node:assert/strict';
import test from 'node:test';
import {changeArtPlacement} from '../src/home-art.ts';
import type {HomeArrangements} from '@jimmie-potts/event-contracts/v2/families';

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
