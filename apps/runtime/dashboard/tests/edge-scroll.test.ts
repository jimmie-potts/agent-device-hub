import assert from 'node:assert/strict';
import test from 'node:test';
import {EDGE, EDGE_SPEED, LONGEST_FRAME, edgeSpeed, edgeStep, type EdgeScroll} from '../src/edge-scroll.ts';

/** Scrolls for `ms` at a constant speed with a frame every `frame` ms, as the Fuse drag's loop does, and returns how far. */
function scrolled(speed: number, ms: number, frame: number): number {
  const state: EdgeScroll = {last: 0, carry: 0};
  let total = 0;
  for (let count = 1; count * frame <= ms + 1e-6; count += 1) total += edgeStep(state, speed, count * frame);
  return total;
}

void test('a drag scrolls only near the window\'s top or bottom edge, faster nearer the edge and never faster than at it', () => {
  assert.equal(edgeSpeed(400, 844), 0);
  assert.equal(edgeSpeed(EDGE, 844), 0);assert.equal(edgeSpeed(844 - EDGE, 844), 0);
  assert.equal(edgeSpeed(0, 844), -EDGE_SPEED);assert.equal(edgeSpeed(844, 844), EDGE_SPEED);
  const near = (actual: number, expected: number): void => {assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)}`);};
  near(edgeSpeed(EDGE / 2, 844), -EDGE_SPEED / 2);near(edgeSpeed(844 - EDGE / 4, 844), EDGE_SPEED * 3 / 4);
  // A mouse dragged out of the window, above or below it.
  assert.equal(edgeSpeed(-300, 844), -EDGE_SPEED);assert.equal(edgeSpeed(844 + 300, 844), EDGE_SPEED);
});

void test('the page scrolls as far in the same time at 4 to 120 frames a second (#2017)', () => {
  // The phone journey's final touch point, 14 px above the bottom of an 844 px window.
  const speed = edgeSpeed(830, 844), expected = speed * 2000;
  for (const rate of [120, 60, 30, 10, 4]) {
    const distance = scrolled(speed, 2000, 1000 / rate);
    assert.ok(Math.abs(distance - expected) <= 1, `${String(rate)} frames a second scroll ${String(distance)} px of ${String(expected)}`);
  }
  assert.equal(scrolled(-EDGE_SPEED, 1000, 1000 / 60), -Math.round(EDGE_SPEED * 1000), 'up at the top edge');
});

void test('each step is whole pixels, and a speed of a fraction of a pixel a frame adds up instead of being lost', () => {
  // One CSS pixel inside the zone.
  const speed = edgeSpeed(844 - EDGE + 1, 844), state: EdgeScroll = {last: 0, carry: 0}, steps: number[] = [];
  for (let frame = 1; frame <= 60; frame += 1) steps.push(edgeStep(state, speed, frame * 1000 / 60));
  assert.ok(steps.every(step => Number.isInteger(step)));
  assert.ok(steps.includes(0), 'some frames scroll nothing');
  assert.ok(Math.abs(steps.reduce((sum, step) => sum + step, 0) - speed * 1000) <= 1);
});

void test('a stalled frame counts as the longest frame, so the page never jumps', () => {
  const state: EdgeScroll = {last: 0, carry: 0};
  assert.equal(edgeStep(state, EDGE_SPEED, 5000), Math.trunc(EDGE_SPEED * LONGEST_FRAME));
  assert.equal(state.last, 5000);
  assert.equal(edgeStep(state, EDGE_SPEED, 4990), 0, 'a timestamp before the last frame scrolls nothing');
});
