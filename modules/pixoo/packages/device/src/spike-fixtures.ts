import type { Animation } from './contracts.js';

const palette = [[0, 0, 0], [0, 24, 60], [60, 36, 0], [40, 40, 40]] as const;
function pixels(frame: number): Uint8Array {
  return Uint8Array.from({ length: 4096 }, (_, index) => {
    const x = index % 64, y = Math.floor(index / 64);
    if (x === 0 || y === 0 || x === 63 || y === 63) return 3;
    return y >= 16 && y < 48 && x >= (frame ? 32 : 8) && x < (frame ? 56 : 32) ? frame + 1 : 0;
  });
}
export function smokeAnimation(animated: boolean): Animation {
  return { frames: Array.from({ length: animated ? 2 : 1 }, (_, frame) => {
    const rgb = new Uint8Array(12288);
    pixels(frame).forEach((color, index) => { rgb.set(palette[color]!, index * 3); });
    return { rgb, delayMs: 500 };
  }) };
}

/** Original synthetic GIF89a; a clear code before each pixel keeps LZW at three bits. */
export function smokeGif(): Uint8Array {
  const bytes = [...Buffer.from('GIF89a'), 64, 0, 64, 0, 0xf1, 0, 0, ...palette.flat()];
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0);
  for (let frame = 0; frame < 2; frame++) {
    bytes.push(0x21, 0xf9, 4, 4, 50, 0, 0, 0); // 50 centiseconds, disposal 1
    bytes.push(0x2c, 0, 0, 0, 0, 64, 0, 64, 0, 0, 2);
    const codes = [...pixels(frame)].flatMap(pixel => [4, pixel]); codes.push(5);
    const packed: number[] = []; let bits = 0, count = 0;
    for (const code of codes) {
      bits |= code << count; count += 3;
      while (count >= 8) { packed.push(bits & 255); bits >>= 8; count -= 8; }
    }
    if (count) packed.push(bits & 255);
    for (let offset = 0; offset < packed.length; offset += 255) {
      const block = packed.slice(offset, offset + 255); bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
