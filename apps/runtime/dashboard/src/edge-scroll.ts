/**
 * How a Fuse drag (#1933) scrolls the page near the window's top or bottom edge, on a time base (#2017): each frame
 * scrolls the speed times the time since the last frame, so the page scrolls as far in the same time at any frame rate
 * (a slow phone, a 120 Hz screen) instead of a fixed distance a frame.
 */

/** How near the window's top or bottom edge a drag scrolls the page, in CSS pixels. */
export const EDGE = 56;
/** How fast the page scrolls at the very edge, in CSS pixels a millisecond (14 px a frame at 60 frames a second). */
export const EDGE_SPEED = 0.84;
/** The longest frame a step counts, in milliseconds: after a stall the page moves this far, not by the whole stall. */
export const LONGEST_FRAME = 250;

/**
 * The scroll speed for a pointer at `y` in a window `height` CSS pixels tall: negative near the top, positive near the
 * bottom, 0 between. A pointer past the window's edge (a mouse dragged outside it) scrolls at the edge's speed.
 */
export function edgeSpeed(y: number, height: number): number {
  if (y < EDGE) return -EDGE_SPEED * Math.min(EDGE, EDGE - y) / EDGE;
  if (y > height - EDGE) return EDGE_SPEED * Math.min(EDGE, y - height + EDGE) / EDGE;
  return 0;
}

/** A running edge scroll: the last frame's time and the fraction of a pixel not scrolled yet. */
export type EdgeScroll = {last: number; carry: number};

/** The whole CSS pixels to scroll at the frame time `now` (a `performance.now()` time), carrying the fraction to the next frame. */
export function edgeStep(state: EdgeScroll, speed: number, now: number): number {
  const elapsed = Math.min(LONGEST_FRAME, Math.max(0, now - state.last));state.last = Math.max(state.last, now);
  const wanted = state.carry + speed * elapsed, whole = Math.trunc(wanted);state.carry = wanted - whole;
  return whole;
}
