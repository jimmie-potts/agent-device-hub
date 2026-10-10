// Independent fixture bitmap: never imports a renderer, font, decoder or production image helper.
import {createHash} from 'node:crypto';
const A = '010101111101101';
const PLAY = '100110111110100';
const HEADER = ['110101110100100', '100100100100111', A, '101101010010010', '111010010010111', '101111111111101', '111100101101111'];
type Color = readonly [number, number, number];
function glyph(rgb: Uint8Array, bitmap: string, x: number, y: number, color: Color): void {
  for (let dy = 0; dy < 5; dy += 1) for (let dx = 0; dx < 3; dx += 1) {
    if (bitmap[dy * 3 + dx] === '1') rgb.set(color, ((y + dy) * 64 + x + dx) * 3);
  }
}
function rgb(device: 'tidbyt' | 'pixoo', artwork: boolean): Uint8Array {
  const image = new Uint8Array(64 * (device === 'tidbyt' ? 32 : 64) * 3);
  glyph(image, PLAY, 0, 1, device === 'tidbyt' ? [40, 200, 80] : [70, 200, 100]);
  if (device === 'pixoo') {
    HEADER.forEach((bitmap, i) => glyph(image, bitmap, 5 + i * 4, 1, [70, 200, 100]));
    for (let x = 0; x < 64; x += 1) image.set([35, 35, 35], (9 * 64 + x) * 3);
  }
  glyph(image, A, artwork ? 27 : device === 'tidbyt' ? 5 : 0, device === 'tidbyt' ? 1 : 13,
    device === 'tidbyt' ? [220, 220, 220] : [200, 200, 200]);
  if (artwork) for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) {
    image.set([20, 60, 100], (((device === 'tidbyt' ? 8 : 13) + y) * 64 + x) * 3);
  }
  return image;
}
/** The fake cloud independently decodes the actual uploaded WebP into these colour families. */
export function expectedTidbytArtwork(artwork: boolean): string[] {
  const image = rgb('tidbyt', artwork);
  return Array.from({length: 32}, (_, y) => Array.from({length: 64}, (_, x) => {
    const at = (y * 64 + x) * 3;
    const r = image[at] ?? 0, g = image[at + 1] ?? 0, b = image[at + 2] ?? 0;
    if (r === 0 && g === 0 && b === 0) return '.';
    if (r === 20 && g === 60 && b === 100) return 'b';
    if (r === 40 && g === 200 && b === 80) return 'G';
    return 'W';
  }).join(''));
}
export const expectedPixooArtwork = (artwork: boolean): string =>
  createHash('sha256').update(rgb('pixoo', artwork)).digest('hex').slice(0, 16);
