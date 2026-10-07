// What a bulb paints for automatic agent status (Hub #928). Copied from controllers/lifx/src/status-publisher.ts at main
// 483d3a93 and converted to the module: the status now comes from the module's synced copy of the core's sessions through
// `highestStatus` in @jimmie-potts/event-contracts/v2/status (#918), with no acknowledging-consumer filter, so any
// consumer's acknowledgment retires `done`, as before. The colors, the caps and the transition rules are unchanged.
import {STATUS_COLORS, type AgentState, type HighestStatus} from '@jimmie-potts/event-contracts/v2/status';
import type {NativeMode, StatusCaps} from './configuration.js';
import type {Hsbk} from './protocol.js';

/**
 * One bulb's shown key: the full status in Work, only attention in Quiet (everything else collapses to `none`, which
 * paints nothing), never anything in Free. `idle` is warm white; `none` leaves the bulb alone.
 */
export type PaintKey = AgentState | 'idle' | 'none';
export const PAINT_KEYS: readonly PaintKey[] = ['attention', 'working', 'done', 'idle', 'none'];

/** Standard RGB-to-HSV hue and saturation, ignoring value: brightness comes from the cap. */
function hueAndSaturation([r, g, b]: readonly [number, number, number]): {hue: number; saturation: number} {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {hue: Math.round(hue), saturation: Math.round(max === 0 ? 0 : (delta / max) * 100)};
}

/** The absolute color for a key at `capPercent`: idle is warm white 2700 K at zero saturation, every other key its shared status color. */
export function colorFor(key: Exclude<PaintKey, 'none'>, capPercent: number): Hsbk {
  const brightness = Math.round((capPercent * 65535) / 100);
  if (key === 'idle') return {hue: 0, saturation: 0, brightness, kelvin: 2700};
  const {hue, saturation} = hueAndSaturation(STATUS_COLORS[key]);
  return {hue: Math.round((hue * 65535) / 360), saturation: Math.round((saturation * 65535) / 100), brightness, kelvin: 3500};
}

/**
 * What a bulb in `mode` should show for `status`, or undefined when it paints nothing at all: in Free, and while the
 * status is `unknown`, which keeps the bulb's last appearance.
 */
export function shownKey(mode: NativeMode, status: HighestStatus): PaintKey | undefined {
  if (mode === 'free' || status === 'unknown') return undefined;
  if (mode === 'quiet') return status === 'attention' ? 'attention' : 'none';
  return status;
}

/** The paint for a key in `mode`, at the bulb's cap for that mode, or undefined for `none`. */
export function paintFor(key: PaintKey, mode: NativeMode, caps: StatusCaps): Hsbk | undefined {
  if (key === 'none') return undefined;
  return colorFor(key, mode === 'quiet' ? caps.quietCapPercent : caps.brightnessCapPercent);
}
