// Drawing helpers the status and now-playing frames share (Hub #930). Copied from controllers/tidbyt/src/draw.ts at main
// 627e3fe3 and converted to the strict profile.
import {fontText, glyph, GLYPH_ADVANCE, GLYPH_WIDTH} from './font.js';
import {FRAME_HEIGHT, FRAME_WIDTH} from './render.js';

export type Rgb = readonly [number, number, number];

export const dim = (color: Rgb): Rgb => [Math.floor(color[0] / 3), Math.floor(color[1] / 3), Math.floor(color[2] / 3)];

export function fill(rgb: Uint8Array, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= FRAME_WIDTH || y >= FRAME_HEIGHT) return;
  rgb.set(color, (y * FRAME_WIDTH + x) * 3);
}

/** Draws glyph rows, most significant bit on the left, with the top-left corner at (x, y). */
export function bits(rgb: Uint8Array, x: number, y: number, rows: readonly number[], color: Rgb): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < GLYPH_WIDTH; dx += 1) {
      if ((row & (1 << (GLYPH_WIDTH - 1 - dx))) !== 0) fill(rgb, x + dx, y + dy, color);
    }
  });
}

export function text(rgb: Uint8Array, x: number, y: number, value: string, color: Rgb): void {
  [...fontText(value)].forEach((ch, i) => { bits(rgb, x + i * GLYPH_ADVANCE, y, glyph(ch), color); });
}

export const textWidth = (value: string): number => value.length * GLYPH_ADVANCE - 1;
