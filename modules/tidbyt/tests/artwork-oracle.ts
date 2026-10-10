type Color = readonly [number, number, number];
const glyphs: Readonly<Record<string, string>> = {
  A: '010101111101101', H: '101101111101101', P: '110101110100100', L: '100100100100111',
  Y: '101101010010010', I: '111010010010111', N: '101111111111101', G: '111100101101111',
  U: '101101101101111', S: '111100111001111', E: '111100110100111', D: '110101101101110',
  '?': '110001010000010', '.': '000000000000010',
};
export type GoldenLine = {text: string; y: number; artist?: boolean};
/** Fixed bitmap oracle, independent of production text/layout/PNG helpers. */
export function expectedCard(height: 32 | 64, status: 'playing' | 'paused', stale: boolean,
  lines: readonly GoldenLine[], nonsquare = false): Uint8Array {
  const pixels = new Uint8Array(64 * height * 3);
  const color = (rgb: Color): Color => stale ? [Math.floor(rgb[0] / 3), Math.floor(rgb[1] / 3), Math.floor(rgb[2] / 3)] : rgb;
  const put = (x: number, y: number, rgb: Color): void => { pixels.set(color(rgb), (y * 64 + x) * 3); };
  const draw = (bitmap: string, x: number, y: number, rgb: Color): void => {
    for (let i = 0; i < 15; i += 1) if (bitmap[i] === '1') put(x + i % 3, y + Math.floor(i / 3), rgb);
  };
  const word = (text: string, x: number, y: number, rgb: Color): void => {
    [...text].forEach((letter, i) => { const bitmap = glyphs[letter]; if (bitmap === undefined) throw new Error('oracle-glyph'); draw(bitmap, x + i * 4, y, rgb); });
  };
  const marker: Color = height === 32 ? status === 'playing' ? [40, 200, 80] : [255, 160, 0]
    : status === 'playing' ? [70, 200, 100] : [230, 170, 60];
  draw(stale ? glyphs['?'] ?? '' : status === 'playing' ? '100110111110100' : '101101101101101', 0, 1, marker);
  if (height === 64) {
    word(status === 'playing' ? 'PLAYING' : 'PAUSED', 5, 1, marker);
    for (let x = 0; x < 64; x += 1) put(x, 9, [35, 35, 35]);
  }
  const top = height === 32 ? 8 : 13;
  for (let y = 0; y < 24; y += 1) for (let x = 0; x < 24; x += 1) {
    if (!nonsquare || (y >= 6 && y < 18)) put(x, top + y, [192, 24, 48]);
  }
  for (const line of lines) word(line.text, 27, line.y, height === 32
    ? line.artist === true ? [90, 170, 230] : [220, 220, 220]
    : line.artist === true ? [70, 170, 220] : [200, 200, 200]);
  return pixels;
}
