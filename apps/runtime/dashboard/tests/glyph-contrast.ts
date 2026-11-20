// The contrast of text against what is behind its glyphs, from two captures of the same page: one with the text and
// one with the text made transparent (#1950). Used by the glass journeys; unit-tested in glyph-contrast.test.ts.

/** One run of text: a box in CSS pixels at a device scale of 1, its ink colour, its words, and whether it lies wholly in the window. */
export type TextRun = {x: number; y: number; width: number; height: number; color: string; text: string; whole: boolean};
/** A raw capture: RGB or RGBA bytes, row by row. */
export type Capture = {data: Uint8Array; info: {width: number; channels: number}};
/** The lowest ratio behind any glyph and where it is, and the whole runs in which no glyph could be found. */
export type GlyphContrast = {min: number; worst: string; glyphs: number; inkless: string[]};

/** How far the two captures must differ at a pixel, as the sum of the RGB differences, for the pixel to be ink. */
export const INK_DIFFERENCE = 30;

const linear = (value: number): number => {const channel = value / 255;return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;};
const luminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/**
 * Measures each run only where its glyphs are: a pixel is a glyph pixel where the capture with text differs from the
 * one without, and its ink is measured against the capture without text. Empty rows of a line box can sit on
 * something no letter is drawn over, such as an artwork's shadow, and are not text. A run that lies wholly in the
 * window and has no glyph pixel at all is reported in `inkless`: its ink is so close to its ground that the captures
 * hardly differ, which is text nobody can read, never a pass.
 */
export function glyphContrast(inked: Capture, ground: Capture, runs: readonly TextRun[]): GlyphContrast {
  const {data, info} = ground;let min = Infinity, worst = '', glyphs = 0;const inkless: string[] = [];
  for (const run of runs) {
    const [r = 0, g = 0, b = 0, a = 1] = [...run.color.matchAll(/\d+(\.\d+)?/g)].map(match => Number(match[0]));
    let found = 0;
    for (let y = Math.ceil(run.y); y < Math.floor(run.y + run.height); y += 1) for (let x = Math.ceil(run.x); x < Math.floor(run.x + run.width); x += 1) {
      const at = (y * info.width + x) * info.channels, br = data[at] ?? 0, bg = data[at + 1] ?? 0, bb = data[at + 2] ?? 0;
      if (Math.abs((inked.data[at] ?? 0) - br) + Math.abs((inked.data[at + 1] ?? 0) - bg) + Math.abs((inked.data[at + 2] ?? 0) - bb) <= INK_DIFFERENCE) continue;
      found += 1;
      // Translucent ink is drawn over the same pixel it is measured against.
      const ink = luminance(br + (r - br) * a, bg + (g - bg) * a, bb + (b - bb) * a), back = luminance(br, bg, bb);
      const ratio = (Math.max(ink, back) + 0.05) / (Math.min(ink, back) + 0.05);
      if (ratio < min) {min = ratio;worst = `"${run.text}" at ${String(x)},${String(y)} in ${run.color}`;}
    }
    glyphs += found;
    if (found === 0 && run.whole) inkless.push(`"${run.text}" in ${run.color}`);
  }
  return {min, worst, glyphs, inkless};
}
