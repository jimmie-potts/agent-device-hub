// The pure 64x32 rendering boundary (Hub #930). Copied from controllers/tidbyt/src/render.ts at main 627e3fe3 and
// converted to the strict profile. It knows nothing about the cloud, credentials, configuration, clocks or I/O, so a
// later Tronbyt connection (#23, #24) reuses it unchanged. The display profile's wire form of a frame
// (`decodeFrameData`) is not copied: no message carries a frame, and the module's renderer gets its frames from its own
// views.
import {encodeLosslessRgb} from './webp.js';

export const FRAME_WIDTH = 64;
export const FRAME_HEIGHT = 32;
export const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 3;

export type Frame = {width: 64; height: 32; rgb: Uint8Array};
export type FrameFailure = {ok: false; code: 'invalid-frame'};

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** The frame as lossless WebP, or `invalid-frame` for anything but exactly one 64x32 RGB frame. */
export function renderFrame(frame: unknown): {ok: true; webp: Uint8Array} | FrameFailure {
  if (!plainObject(frame) || !exactKeys(frame, ['width', 'height', 'rgb']) || frame.width !== FRAME_WIDTH || frame.height !== FRAME_HEIGHT ||
    !(frame.rgb instanceof Uint8Array) || frame.rgb.length !== FRAME_BYTES) {
    return {ok: false, code: 'invalid-frame'};
  }
  return {ok: true, webp: encodeLosslessRgb(FRAME_WIDTH, FRAME_HEIGHT, frame.rgb)};
}
