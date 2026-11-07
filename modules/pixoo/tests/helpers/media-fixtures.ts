import {createRequire} from 'node:module';
const {GIFEncoder} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');

/** Original GIF89a fixtures. Literal LZW codes separated by clears keep a fixed code width. */
export interface GifPatch {
  x?: number; y?: number; width: number; height: number; pixels: number[];
  delay?: number | null; disposal?: number; transparent?: boolean; interlaced?: boolean;
}
export function gifFixture(width: number, height: number, frames: GifPatch[]): Buffer {
  const word = (n: number) => [n & 255, n >> 8];
  const bytes = [...Buffer.from('GIF89a'), ...word(width), ...word(height), 0x81, 0, 0,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  for (const frame of frames) {
    if (frame.delay !== null) bytes.push(0x21, 0xf9, 4, ((frame.disposal ?? 1) << 2) | (frame.transparent === true ? 1 : 0), ...word(frame.delay ?? 10), 0, 0);
    bytes.push(0x2c, ...word(frame.x ?? 0), ...word(frame.y ?? 0), ...word(frame.width), ...word(frame.height), frame.interlaced === true ? 0x40 : 0, 2);
    let pixels = frame.pixels;
    if (frame.interlaced === true) {
      pixels = [];
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const)
        for (let y = start; y < frame.height; y += step) pixels.push(...frame.pixels.slice(y * frame.width, (y + 1) * frame.width));
    }
    const codes = pixels.flatMap(p => [4, p]); codes.push(5);
    const packed: number[] = []; let bits = 0, count = 0;
    for (const code of codes) {
      bits |= code << count; count += 3;
      while (count >= 8) { packed.push(bits & 255); bits >>= 8; count -= 8; }
    }
    if (count !== 0) packed.push(bits & 255);
    for (let i = 0; i < packed.length; i += 255) { const block = packed.slice(i, i + 255); bytes.push(block.length, ...block); }
    bytes.push(0);
  }
  return Buffer.from([...bytes, 0x3b]);
}

/** The 2,200-frame patch GIF imports in 61,409 bytes. Full-frame hosted encoding needs 12,393,287 bytes. */
export function oversizedHostedSourceGif(): Buffer {
  const palette = Array.from({length: 256}, (_, i) => [i, i * 17 % 256, i * 113 % 256]);
  let seed = 498236;
  const noisy = Uint8Array.from({length: 4096}, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  });
  const encoder = GIFEncoder();
  encoder.writeFrame(noisy, 64, 64, {palette, delay: 100, dispose: 1, transparent: false, repeat: 0});
  for (let i = 1; i < 2200; i++) {
    encoder.writeFrame(Uint8Array.of(i % 256), 1, 1, {delay: 100, dispose: 1, transparent: false, repeat: 0});
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}
