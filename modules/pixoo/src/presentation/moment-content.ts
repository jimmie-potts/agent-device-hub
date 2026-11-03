// What a Pixoo moment shows (Hub #1287). The presentation plays frames and never asks where they came from: `momentContent`
// is the one place that chooses them from a request, and `renderMomentContent` the one place that draws the choice.
import type {MomentPlayRequest} from '@jimmie-potts/event-contracts/v2/families';

export const MOMENT_MOODS: readonly string[] = ['celebrate', 'setback', 'reminder'];
/** The longest moment the Pixoo plays, as long as a Now Playing pop-up. */
export const MOMENT_MAX_MS = 10_000;
const SIZE = 64;
const FRAME_BYTES = SIZE * SIZE * 3;
type Rgb = readonly [number, number, number];

/** What one moment shows. A new kind of content, such as a library rendition, is one more member here. */
export type MomentContent = {kind: 'mood'; mood: string; palette?: string[]};

/** Chooses what a moment shows. Hub #679's art reference selects a rendition here, ahead of the mood. */
export function momentContent(request: Pick<MomentPlayRequest, 'mood' | 'palette'>): MomentContent {
  return {kind: 'mood', mood: request.mood, ...(request.palette === undefined ? {} : {palette: request.palette})};
}

const PALETTES: Readonly<Record<string, readonly Rgb[]>> = {
  celebrate: [[255, 196, 40], [255, 92, 138], [64, 200, 255]],
  setback: [[64, 104, 176], [120, 160, 220]],
  reminder: [[255, 168, 48], [255, 224, 160]],
};
const parse = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];

/** Two complete frames that alternate, drawn from the mood's own shapes and the palette or its preset colors. */
export function renderMoment(content: Extract<MomentContent, {kind: 'mood'}>): Uint8Array[] {
  const colors = content.palette?.map(parse) ?? PALETTES[content.mood] ?? PALETTES.reminder ?? [];
  const at = (index: number): Rgb => colors[index % colors.length] ?? [255, 255, 255];
  const frame = (paint: (x: number, y: number) => Rgb | null): Uint8Array => {
    const rgb = new Uint8Array(FRAME_BYTES);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const color = paint(x, y);
        if (color !== null) rgb.set(color, (y * SIZE + x) * 3);
      }
    }
    return rgb;
  };
  const center = SIZE / 2 - .5;
  const distance = (x: number, y: number): number => Math.hypot(x - center, y - center);
  switch (content.mood) {
    case 'celebrate': return [0, 1].map(phase => frame((x, y) => {
      // Sparks scattered on a fixed lattice, which swap places between the frames.
      const cell = Math.floor(x / 8) + Math.floor(y / 8) * 8;
      return (x + y * 3 + cell * 5 + phase * 4) % 16 === 0 && (x * 7 + y) % 3 !== 0 ? at(cell) : null;
    }));
    case 'setback': return [0, 1].map(phase => frame((x, y) => (x % 8 === 3 && (y + phase * 6 + x) % 12 < 4 ? at(x % 3 === 0 ? 1 : 0) : null)));
    default: return [0, 1].map(phase => frame((x, y) => {
      const ring = Math.abs(distance(x, y) - (phase === 0 ? 20 : 26));
      return ring < 2 ? at(0) : distance(x, y) < 6 ? at(1) : null;
    }));
  }
}

/** Draws what `momentContent` chose. */
export function renderMomentContent(content: MomentContent): Uint8Array[] {
  return renderMoment(content);
}
