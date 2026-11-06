import sharp from 'sharp';

/** Alternating one-pixel source frames keep even the long GIF within the inline import budget. */
export function pixooAnimation(delaysMs: number[]): Promise<Buffer> {
  const bytes = Buffer.from(delaysMs.flatMap((_, index) => index % 2 === 0 ? [0, 0, 255] : [255, 0, 0]));
  return sharp(bytes, {raw: {width: 1, height: delaysMs.length, pageHeight: 1, channels: 3}})
    .gif({delay: delaysMs, keepDuplicateFrames: true, effort: 1}).toBuffer();
}
