import type { RgbFrame } from '../../packages/device/src/index.js';

/** Synthetic pixels identify row, column and frame independently. No external artwork. */
export function rgbFrame(frame: number, delayMs = 40): RgbFrame {
  const rgb = new Uint8Array(64 * 64 * 3);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const offset = (y * 64 + x) * 3;
      rgb.set([x, y, frame], offset);
    }
  }
  return { rgb, delayMs };
}
