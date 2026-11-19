// The glass layer's switch thumb (#1930): two capsules that follow the selected segment of a switch at different speeds.
// The shader joins them with a smooth minimum, so the thumb stretches while it travels and is one capsule at rest.
import type {GlassRect} from './glass-scene.ts';

/** A capsule's box: x, y, width and height in CSS pixels relative to the viewport. */
export type ThumbBox = readonly [number, number, number, number];
/** The capsules, the segment they head for (its `data-glass-thumb` value) and that segment's box. */
export type GlassThumb = {lead: ThumbBox; lag: ThumbBox; key: string; target: ThumbBox};
/** The selected segment as the scene reads it. */
export type ThumbGoal = {rect: GlassRect; key: string};

/**
 * How fast each capsule closes its gap, per second. The reference moves the lead 30% and the lag 12% of the remaining
 * gap per drawn frame; at 60 frames a second those are these rates, so the speed no longer depends on the display.
 */
export const LEAD_RATE = -Math.log(1 - 0.3) * 60;
export const LAG_RATE = -Math.log(1 - 0.12) * 60;
/** A capsule this close to its goal lands on it, so the motion ends. */
const SNAP = 0.3;

const boxOf = (rect: GlassRect): ThumbBox => [rect.x, rect.y, rect.width, rect.height];
const same = (a: ThumbBox, b: ThumbBox): boolean => a.every((value, index) => value === b[index]);
/** Only the travel along the switch eases; a scroll or a new size moves both capsules at once, as in the reference. */
function follow(box: ThumbBox, goal: ThumbBox, rate: number, seconds: number): ThumbBox {
  const next = box[0] + (goal[0] - box[0]) * (1 - Math.exp(-rate * seconds));
  return [Math.abs(goal[0] - next) < SNAP ? goal[0] : next, goal[1], goal[2], goal[3]];
}

/**
 * The thumb after `seconds` toward `goal`. It travels only when another segment is selected. A thumb that first
 * appears, a resting thumb whose segment moved (a scroll, a resize, a repacked page) and any thumb when motion is
 * reduced sit on the goal at once; with no goal there is no thumb.
 */
export function stepThumb(thumb: GlassThumb | null, goal: ThumbGoal | null, seconds: number, still: boolean): GlassThumb | null {
  if (goal === null) return null;
  const target = boxOf(goal.rect), at = {lead: target, lag: target, key: goal.key, target};
  if (thumb === null || still || thumb.key === goal.key && same(thumb.lead, thumb.target) && same(thumb.lag, thumb.target)) return at;
  return {lead: follow(thumb.lead, target, LEAD_RATE, seconds), lag: follow(thumb.lag, target, LAG_RATE, seconds), key: goal.key, target};
}
/** Whether both capsules rest on the goal's segment, so the thumb needs no further frame. */
export function thumbSettled(thumb: GlassThumb | null, goal: ThumbGoal | null): boolean {
  if (thumb === null || goal === null) return thumb === null && goal === null;
  const target = boxOf(goal.rect);
  return thumb.key === goal.key && same(thumb.lead, target) && same(thumb.lag, target);
}
