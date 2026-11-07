import {canvasSize, decodedPixels, DEFAULT_LIMITS} from '../media/contracts.js';
import type { Animation } from './contracts.js';

/** Bound the RGB allocation even when a custom playback store bypasses the library decoder. */
export function withinFrameBufferBudget(frameCount: number): boolean {
  return decodedPixels(canvasSize.width, canvasSize.height, frameCount) <= DEFAULT_LIMITS.maxSourcePixels;
}

export function snapshotAnimation(animation: Animation): Animation | undefined {
  const frames: unknown = animation?.frames;
  if (!Array.isArray(frames) || frames.length === 0 || !withinFrameBufferBudget(frames.length)) return undefined;
  if (!Array.from(animation.frames).every(frame => frame?.rgb instanceof Uint8Array && frame.rgb.length === 12288 &&
    Number.isSafeInteger(frame.delayMs) && frame.delayMs > 0)) return undefined;
  return { frames: animation.frames.map(frame => ({ rgb: new Uint8Array(frame.rgb), delayMs: frame.delayMs })) };
}
