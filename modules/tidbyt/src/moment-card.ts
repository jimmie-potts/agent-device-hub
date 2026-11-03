// What a moment shows on the Tidbyt (Hub #337): the seam between the moment's request and the picture it pushes. The
// default is a mood card, drawn here and rendered in the module's worker. Exact art (#679, #681) replaces only the
// `MomentPicture`, through `TidbytModuleOptions.momentPicture`: the bounded takeover around it does not change.
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';
import {fill, text, textWidth, type Rgb} from './draw.js';
import {GLYPH_HEIGHT} from './font.js';
import {FRAME_BYTES, FRAME_HEIGHT, FRAME_WIDTH, type Frame} from './render.js';

/** The moods the Tidbyt declares, the core moods of ADR 0006. */
export const MOMENT_MOODS = ['celebrate', 'setback', 'reminder'] as const;
/**
 * Supplies the encoded WebP one moment shows. It runs once, after the moment was accepted and before anything goes out, so
 * a rejection ends the moment with nothing sent. It may read `moment` only as the accepted request: no message carries a
 * frame, and what it fetches or draws stays private to the module.
 */
export type MomentPicture = (moment: MomentPlayRequest) => Promise<Uint8Array>;
export type MomentView = {mood: string; palette: readonly string[]};

const MOOD_PALETTES: Readonly<Record<string, readonly string[]>> = {
  celebrate: ['#FFC828', '#FF5A8C', '#3CC8FF'], setback: ['#5A78B4', '#2D3C5A'], reminder: ['#FFA000', '#FFE6A0'],
};
const BAND_HEIGHT = 7;
const LABEL_COLOR: Rgb = [235, 235, 235];

/** The card's view of a moment: its mood, in the moment's palette or the mood's own. */
export const momentView = (moment: Pick<MomentPlayRequest, 'mood' | 'palette'>): MomentView =>
  ({mood: moment.mood, palette: moment.palette ?? MOOD_PALETTES[moment.mood] ?? ['#DCDCDC']});

const rgbOf = (color: string): Rgb => [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];

/** A mood card as a 64x32 RGB frame: the mood's name between two bands of its palette. */
export function momentFrame(view: MomentView): Frame {
  const rgb = new Uint8Array(FRAME_BYTES);
  const colors = view.palette.map(rgbOf);
  for (let x = 0; x < FRAME_WIDTH; x += 1) {
    const color = colors[Math.floor(x * colors.length / FRAME_WIDTH)] ?? LABEL_COLOR;
    for (let y = 0; y < BAND_HEIGHT; y += 1) {
      fill(rgb, x, y, color);
      fill(rgb, x, FRAME_HEIGHT - 1 - y, color);
    }
  }
  const label = view.mood.toUpperCase();
  text(rgb, Math.floor((FRAME_WIDTH - textWidth(label)) / 2), Math.floor((FRAME_HEIGHT - GLYPH_HEIGHT) / 2), label, LABEL_COLOR);
  return {width: FRAME_WIDTH, height: FRAME_HEIGHT, rgb};
}
