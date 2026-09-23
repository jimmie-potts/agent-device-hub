import { encodeLosslessRgb } from './webp.js';

/**
 * Pure 64×32 rendering boundary. It knows nothing about backends, credentials,
 * configuration, clocks or I/O, so a later Tronbyt connection reuses it unchanged.
 */
export const FRAME_WIDTH = 64;
export const FRAME_HEIGHT = 32;
export const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 3;
export const FRAME_ENCODING = 'rgb24-base64';

export type Frame = { width: 64; height: 32; rgb: Uint8Array };
/** Wire form of a frame inside a display request. */
export type FrameData = { width: 64; height: 32; encoding: typeof FRAME_ENCODING; data: string };
export type FrameFailure = { ok: false; code: 'invalid-frame' };

const invalid: FrameFailure = Object.freeze({ ok: false, code: 'invalid-frame' });

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function renderFrame(frame: unknown): { ok: true; webp: Uint8Array } | FrameFailure {
  if (!plainObject(frame) || !exactKeys(frame, ['width', 'height', 'rgb']) || frame.width !== FRAME_WIDTH
      || frame.height !== FRAME_HEIGHT || !(frame.rgb instanceof Uint8Array) || frame.rgb.length !== FRAME_BYTES) {
    return { ...invalid };
  }
  return { ok: true, webp: encodeLosslessRgb(FRAME_WIDTH, FRAME_HEIGHT, frame.rgb) };
}

const CANONICAL_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strictly decode wire frame data. Only canonical base64 of exactly one frame is accepted. */
export function decodeFrameData(value: unknown): { ok: true; frame: Frame } | FrameFailure {
  if (!plainObject(value) || !exactKeys(value, ['width', 'height', 'encoding', 'data']) || value.width !== FRAME_WIDTH
      || value.height !== FRAME_HEIGHT || value.encoding !== FRAME_ENCODING || typeof value.data !== 'string'
      || value.data.length !== Math.ceil(FRAME_BYTES / 3) * 4 || !CANONICAL_BASE64.test(value.data)) {
    return { ...invalid };
  }
  const bytes = Buffer.from(value.data, 'base64');
  if (bytes.length !== FRAME_BYTES || bytes.toString('base64') !== value.data) return { ...invalid };
  return { ok: true, frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb: new Uint8Array(bytes) } };
}
