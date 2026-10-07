import type { Animation } from './contracts.js';

export function snapshotAnimation(animation: Animation): Animation | undefined {
  const frames: unknown = animation?.frames;
  if (!Array.isArray(frames) || frames.length === 0) return undefined;
  if (!Array.from(animation.frames).every(frame => frame?.rgb instanceof Uint8Array && frame.rgb.length === 12288 &&
    Number.isSafeInteger(frame.delayMs) && frame.delayMs > 0)) return undefined;
  return { frames: animation.frames.map(frame => ({ rgb: new Uint8Array(frame.rgb), delayMs: frame.delayMs })) };
}
