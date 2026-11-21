// The liquid state (#1932): a panel that moves or changes size turns liquid, like spilled mercury, and settles in about
// a second. How liquid (`wob`, 0 to 1) follows how fast the panel's box changes, as in the Clear reference
// (docs/design-references/home-clear, `glFrame`), converted from its per-frame values at 60 fps to a time base.
//
// Boxes are measured from the layer's root, so scrolling, or a notice that appears above the page, moves every box with
// the root and stirs nothing. A rebased read (after a window resize, #1967) takes the boxes as they are. Only frames
// while a panel element animates (the unfold's eased move) measure speed: a box that jumps (a card's content growing,
// a move in Edit Home) draws one frame as before, so the liquid never adds frames under software WebGL beyond the
// motion the operator asked for.
import type {GlassPanel} from './glass-scene.ts';

/** A panel's box relative to the root when it was last read, and its liquid state. */
export type Liquid = {box: readonly [number, number, number, number]; wob: number};
/** The box change speed, in CSS pixels per second summed over position and size, that makes a panel fully liquid. */
export const FULL_SPEED = 9 * 60;
/** How fast the state rises toward the speed's share: half the gap per frame at 60 fps. */
export const RISE_RATE = -60 * Math.log(0.5);
/** How fast it settles: `exp(-3.4 s)`. */
export const SETTLE_RATE = 3.4;
const SNAP = 0.004;

/**
 * One step over `seconds` for every panel in the scene. With reduced motion (`still`) nothing turns liquid. `moving`
 * says whether another frame is needed. A step with no time passed (a repeated frame timestamp) keeps each known
 * panel's state and box, so the next step measures the whole move over the time it took.
 */
export function stirPanels(previous: ReadonlyMap<string, Liquid>, panels: readonly GlassPanel[], origin: {x: number; y: number}, seconds: number,
  options: {still: boolean; rebase: boolean; measure?: boolean}): {liquid: Map<string, Liquid>; moving: boolean} {
  const liquid = new Map<string, Liquid>(), step = Math.max(seconds, 1e-3);let moving = false;
  for (const panel of panels) {
    const box = [panel.rect.x - origin.x, panel.rect.y - origin.y, panel.rect.width, panel.rect.height] as const, last = previous.get(panel.id);
    if (seconds <= 0 && last !== undefined && !options.still && !options.rebase) {liquid.set(panel.id, last);if (last.wob > 0) moving = true;continue;}
    const travelled = last === undefined || options.rebase || options.measure === false ? 0 : box.reduce((sum, value, index) => sum + Math.abs(value - (last.box[index] ?? value)), 0);
    const stir = Math.min(1, travelled / step / FULL_SPEED), from = last?.wob ?? 0;
    let wob = options.still ? 0 : stir > from ? from + (stir - from) * (1 - Math.exp(-RISE_RATE * step)) : from * Math.exp(-SETTLE_RATE * step);
    if (wob < SNAP) wob = 0;else moving = true;
    liquid.set(panel.id, {box, wob});
  }
  return {liquid, moving};
}

/** The panels' liquid state, whether it still needs frames, and the timestamp of the frame that last stepped it. */
export type LiquidClock = {liquid: ReadonlyMap<string, Liquid>; moving: boolean; tick: number};
export const SETTLED: LiquidClock = {liquid: new Map(), moving: false, tick: 0};
/** The longest step one frame takes, so a frame after a stall does not jump. */
const MAX_STEP = 0.1;
/** The liquid panels' states by id; panels at rest are left out. */
export const wobsOf = (liquid: ReadonlyMap<string, Liquid>): Map<string, number> => new Map([...liquid].flatMap(([id, value]) => value.wob > 0 ? [[id, value.wob] as const] : []));
const sameWobs = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean => a.size === b.size && [...a].every(([id, value]) => b.get(id) === value);

/**
 * One frame of the liquid state at timestamp `now` (milliseconds), as glass-light.ts's `lightFrame` steps the lights:
 * a step after a rest counts as one 60 fps frame; while moving, it is the time since the last frame, at most
 * `MAX_STEP`. `changed` says whether this frame changed any panel's state; `again` whether the layer must draw another
 * frame, which it must while a panel is liquid or a panel element is `animating`, even when a frame repeats the last
 * timestamp and changes nothing. Speed is measured only while a panel element is `animating`.
 */
export function liquidFrame(clock: LiquidClock, panels: readonly GlassPanel[], origin: {x: number; y: number}, now: number,
  options: {still: boolean; rebase: boolean; animating: boolean}): {clock: LiquidClock; wobs: Map<string, number>; changed: boolean; again: boolean} {
  const seconds = clock.moving ? Math.min(MAX_STEP, Math.max(0, (now - clock.tick) / 1000)) : 1 / 60;
  const stirred = stirPanels(clock.liquid, panels, origin, seconds, {still: options.still, rebase: options.rebase, measure: options.animating}), wobs = wobsOf(stirred.liquid);
  const again = stirred.moving || options.animating;
  return {clock: {liquid: stirred.liquid, moving: again, tick: now}, wobs, changed: !sameWobs(wobsOf(clock.liquid), wobs), again};
}
