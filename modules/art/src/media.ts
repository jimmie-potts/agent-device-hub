// Local image work, which costs nothing (docs/art-generation-qualification.md, "Compositions"): validation before storage,
// GIF decoding, Lanczos reduction to one 32-color palette, GIF assembly and local motion. Sharp reduces and `gifenc` builds
// the GIF, since Sharp 0.35.4's own `colours` option left 256 colors. Every decode is bounded, and a decoder's message never
// leaves this file.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';

// CommonJS, as Pixoo loads it.
const {GIFEncoder, applyPalette, quantize} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
sharp.cache(false);
sharp.concurrency(1);

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Above the largest size the price table admits, so a decode cannot grow without bound. */
const MAX_PIXELS = 4096 * 4096;
export const COLOURS = 32;
export const FRAME_COUNT = 8;
/** Uniform, within Pixoo's observed GIF envelope of 100 to 800 ms and 20 frames. */
export const FRAME_DELAY_MS = 200;
const MIN_DELAY_MS = 100, MAX_DELAY_MS = 800, MAX_GIF_FRAMES = 20;
/** The most a staged display rendition may hold (the record's `art-stage`). */
export const MAX_DISPLAY_BYTES = 160 * 1024;
/** Every request for a still asks for PNG, and the store types an original as PNG. */
const ACCEPTED_FORMAT = 'png';

export class MediaFault extends Error {
  constructor(readonly reason: 'invalid' | 'too-large') {super(reason === 'invalid' ? 'invalid image' : 'image too large');}
}
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const image = (bytes: Uint8Array) => sharp(bytes, {limitInputPixels: MAX_PIXELS, failOn: 'error'});

/** Refuses anything but one complete image of the requested size, before it can reach storage. */
export async function validateImage(bytes: Uint8Array, width: number, height: number): Promise<{width: number; height: number}> {
  if (bytes.length === 0) throw new MediaFault('invalid');
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaFault('too-large');
  try {
    const info = await image(bytes).metadata();
    if (info.format !== ACCEPTED_FORMAT || info.width !== width || info.height !== height || (info.pages ?? 1) !== 1) throw new MediaFault('invalid');
    // Reading the header proves little: decode every pixel, so a truncated file fails here.
    await image(bytes).raw().toBuffer();
    return {width, height};
  } catch (error) {
    if (error instanceof MediaFault) throw error;
    throw new MediaFault('invalid');
  }
}
const lanczos = (bytes: Uint8Array, width: number, height: number) => image(bytes).resize(width, height, {fit: 'cover', position: 'centre', kernel: 'lanczos3'});
/** One browser rendition, kept in color. */
export const browserRendition = (bytes: Uint8Array, width: number, height: number): Promise<Buffer> =>
  image(bytes).resize(width, height, {fit: 'cover', kernel: 'lanczos3'}).webp({quality: 82}).toBuffer();
/** The composition's dominant colors, as validated data for the theme. */
export async function paletteOf(bytes: Uint8Array): Promise<string[]> {
  const {data} = await image(bytes).resize(32, 32, {fit: 'cover', kernel: 'lanczos3'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const counts = new Map<number, number>();
  // Coarse buckets, so near-identical shades count as one color.
  for (let at = 0; at + 2 < data.length; at += 3) {
    const colour = (((data[at] ?? 0) & 0xe0) << 16) | (((data[at + 1] ?? 0) & 0xe0) << 8) | ((data[at + 2] ?? 0) & 0xe0);
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => a[1] === b[1] ? a[0] - b[0] : b[1] - a[1]).slice(0, 8).map(([colour]) => `#${colour.toString(16).padStart(6, '0').toUpperCase()}`);
}

/**
 * Decodes one returned GIF under the same limits and checks what the request asked for: its size, its frame count, and
 * timing inside Pixoo's observed envelope. It returns raw RGBA frames for reduction. Anything else is a wrong result, which
 * still counts as spent.
 */
export async function decodeGif(bytes: Uint8Array, width: number, height: number, frames: number): Promise<Buffer[]> {
  if (bytes.length === 0) throw new MediaFault('invalid');
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaFault('too-large');
  try {
    const animated = () => sharp(bytes, {animated: true, limitInputPixels: MAX_PIXELS, failOn: 'error'});
    const info = await animated().metadata();
    if (info.format !== 'gif' || info.width !== width || (info.pageHeight ?? info.height) !== height || (info.pages ?? 1) !== frames || frames < 2 || frames > MAX_GIF_FRAMES) throw new MediaFault('invalid');
    const delays = info.delay ?? [];
    if (delays.length !== frames || delays.some((delay: number) => delay < MIN_DELAY_MS || delay > MAX_DELAY_MS)) throw new MediaFault('invalid');
    const data = await animated().ensureAlpha().raw().toBuffer(), size = width * height * 4;
    if (data.length !== size * frames) throw new MediaFault('invalid');
    return Array.from({length: frames}, (_, index) => data.subarray(index * size, (index + 1) * size));
  } catch (error) {
    if (error instanceof MediaFault) throw error;
    throw new MediaFault('invalid');
  }
}
/** Reduces decoded frames with Lanczos and rebuilds one GIF with one 32-color palette and uniform timing. */
export async function reduceGif(frames: readonly Buffer[], sourceWidth: number, sourceHeight: number, width: number, height: number): Promise<Buffer> {
  const reduced = await Promise.all(frames.map(frame => sharp(frame, {raw: {width: sourceWidth, height: sourceHeight, channels: 4}}).resize(width, height, {fit: 'cover', position: 'centre', kernel: 'lanczos3'}).ensureAlpha(1).raw().toBuffer()));
  return assembleGif(reduced, width, height);
}
/** The palette of a GIF's first frame, for the theme. */
export function firstFrame(frames: readonly Buffer[], width: number, height: number): Promise<Buffer> {
  const [first] = frames;
  if (first === undefined) throw new MediaFault('invalid');
  return sharp(first, {raw: {width, height, channels: 4}}).png().toBuffer();
}
/** Joins raw RGBA frames into one looping GIF, with one palette of at most 32 colors. */
export function assembleGif(frames: readonly Uint8Array[], width: number, height: number): Buffer {
  const palette = quantize(Buffer.concat(frames), COLOURS, {format: 'rgb565'}), gif = GIFEncoder();
  frames.forEach((frame, index) => {
    gif.writeFrame(applyPalette(frame, palette, 'rgb565'), width, height, {...(index === 0 ? {palette} : {}), delay: FRAME_DELAY_MS, dispose: 1, transparent: false, repeat: 0});
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}
/** A gentle drift of two pixels across a slightly larger copy of a still. It spends nothing. */
export async function localMotion(bytes: Uint8Array, width: number, height: number): Promise<Buffer> {
  const margin = 2, wide = width + 2 * margin, tall = height + 2 * margin;
  const larger = await lanczos(bytes, wide, tall).ensureAlpha().raw().toBuffer();
  const frames: Promise<Buffer>[] = [];
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const phase = (frame / FRAME_COUNT) * 2 * Math.PI;
    frames.push(sharp(larger, {raw: {width: wide, height: tall, channels: 4}}).extract({left: Math.round(margin + margin * Math.cos(phase)), top: Math.round(margin + margin * Math.sin(phase)), width, height}).raw().toBuffer());
  }
  return assembleGif(await Promise.all(frames), width, height);
}
/** Procedural art: a soft gradient and a few discs from a seed. It reaches no provider. */
export function proceduralImage(seed: string): Promise<Buffer> {
  const size = 512, digest = createHash('sha256').update(seed).digest(), data = Buffer.alloc(size * size * 3);
  const byte = (index: number): number => digest[index % digest.length] ?? 0;
  const discs = [0, 1, 2, 3].map(index => ({x: byte(index * 4) * 2, y: byte(index * 4 + 1) * 2, radius: 24 + byte(index * 4 + 2) / 3, tone: byte(index * 4 + 3)}));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (y * size + x) * 3, disc = discs.find(entry => (x - entry.x) ** 2 + (y - entry.y) ** 2 < entry.radius ** 2);
    data[at] = disc?.tone ?? Math.floor(byte(16) * (1 - y / size));
    data[at + 1] = disc === undefined ? Math.floor(byte(17) * (x / size)) : 255 - disc.tone;
    data[at + 2] = disc === undefined ? Math.floor(byte(18) * (y / size)) : (disc.tone + 96) % 256;
  }
  return sharp(data, {raw: {width: size, height: size, channels: 3}}).png().toBuffer();
}
