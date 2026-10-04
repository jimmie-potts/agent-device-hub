import { INPUT_SIZE } from './keyboard.js';

/** One mouse-wheel notch. */
export const WHEEL_DELTA = 120;
/** Most notches one `scrollClient` call sends. */
export const MAX_SCROLL_NOTCHES = 10;

const INPUT_MOUSE = 0;
const MOUSEEVENTF_WHEEL = 0x0800;

/** Point and rectangle in screen coordinates, as `GetCursorPos` and `GetWindowRect` report them. */
export interface ScreenPoint { x: number; y: number }
export interface ScreenRect { left: number; top: number; right: number; bottom: number }

/**
 * Encodes one wheel `INPUT` record (64-bit layout; `MOUSEINPUT` starts at offset 8). `dx` and `dy` stay 0 and
 * only `MOUSEEVENTF_WHEEL` is set, so the pointer never moves and no button changes.
 */
export function encodeWheelInput(delta: number): Buffer {
  const buffer = Buffer.alloc(INPUT_SIZE);
  buffer.writeUInt32LE(INPUT_MOUSE, 0);
  buffer.writeInt32LE(delta, 16);
  buffer.writeUInt32LE(MOUSEEVENTF_WHEEL, 20);
  return buffer;
}

/** Windows treats a window rectangle as including its left and top edges and excluding its right and bottom edges. */
export const pointInRect = (point: ScreenPoint, rect: ScreenRect) =>
  point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
