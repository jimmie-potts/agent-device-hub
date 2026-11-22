import type {Capabilities} from './devices.js';

type Moments = Capabilities['moments'];

/** The configured owner must support the planned mood for the whole requested duration. */
export function supportsMoment(moments: Moments, mood: string, durationMs: number): moments is Extract<Moments, {supported: true}> {
  return moments.supported && moments.moods.includes(mood) && durationMs <= moments.maxDurationMs;
}
