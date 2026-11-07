import {PIXOO64_HOSTED_PROFILE, SIMULATOR_PROFILE} from '../media/contracts.js';

/** Divoom Draw/SendHttpGif specifies PicNum < 60. Device/PlayTFGif fetches one whole GIF. */
export const DIRECT_FRAME_LIMIT = 59;
export type AnimationRoute = 'direct' | 'hosted' | 'simulator';

export function animationRoute(profileName: string): AnimationRoute {
  if (profileName === PIXOO64_HOSTED_PROFILE.name) return 'hosted';
  return profileName === SIMULATOR_PROFILE.name ? 'simulator' : 'direct';
}

export function frameCountRefusal(route: AnimationRoute, frames: number): string | undefined {
  return route === 'direct' && frames > DIRECT_FRAME_LIMIT
    ? 'The direct Draw/SendHttpGif route supports at most 59 frames.' : undefined;
}

export function timingRefusal(route: AnimationRoute, delays: readonly number[]): string | undefined {
  if (route !== 'simulator' && delays.some(delay => delay !== delays[0])) return 'Physical playback requires one frame delay.';
  if (route === 'hosted' && delays.length > 1 && delays.some(delay => delay % 10 !== 0 || delay > 655350)) {
    return 'The hosted GIF route requires delays representable in GIF centiseconds.';
  }
  return undefined;
}
