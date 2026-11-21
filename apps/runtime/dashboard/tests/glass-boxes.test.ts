// The glass journeys' check that the glass on screen follows the boxes (#1965), with a negative control.
import assert from 'node:assert/strict';
import test from 'node:test';
import {drawnMismatches, type LiveBox} from './glass-boxes.ts';

const viewport = {width: 1440, height: 900};
const card = (y: number, height = 200): LiveBox => ({id: 'card', x: 216, y, width: 400, height});
const drawn = (box: LiveBox): string => `${box.id}:${[box.x, box.y, box.width, box.height].map(value => value.toFixed(1)).join(',')}`;

void test('glass drawn where the box is follows it', () => {
  assert.deepEqual(drawnMismatches(drawn(card(120)), [card(120)], viewport), []);
});

void test('a visible change that was not drawn is reported (negative control)', () => {
  // The last frame drew the card at 120; the card has since moved to 160 and no frame followed.
  assert.deepEqual(drawnMismatches(drawn(card(120)), [card(160)], viewport), ['card glass 216,120,400,200 does not follow its box 216.0,160.0,400.0,200.0']);
  assert.deepEqual(drawnMismatches('', [card(120)], viewport), ['0 drawn panels for 1 boxes in view', 'card has no glass']);
});

void test('a change beyond the window and its reach needs no frame', () => {
  // A page taller than the window, drawn cut 64px below it, grows further below: what is drawn still follows.
  assert.deepEqual(drawnMismatches('card:216.0,120.0,400.0,844.0', [card(120, 2400)], viewport), []);
});
