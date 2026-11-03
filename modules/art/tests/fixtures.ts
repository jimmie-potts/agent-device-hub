// Synthetic images and fake providers. Nothing here reaches a provider, and no test reads a real key.
import sharp from 'sharp';
import type {ArtProvider, ImageAnswer, ImageRequest, TextAnswer, TextRequest} from '../src/provider.js';

export async function gradientPng(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 3;
    data[at] = Math.floor(255 * x / width); data[at + 1] = Math.floor(255 * y / height); data[at + 2] = 128;
  }
  return sharp(data, {raw: {width, height, channels: 3}}).png().toBuffer();
}
export async function noisePng(width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let index = 0; index < data.length; index++) {seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[index] = seed & 0xff;}
  return sharp(data, {raw: {width, height, channels: 3}}).png().toBuffer();
}
export type SheetOptions = {width?: number; straddle?: boolean; shiftScene?: boolean; chaotic?: boolean};
/**
 * A 3x2 sheet of a plain ground with a textured horizon and a small subject that bobs. `straddle` moves the subject onto a
 * cell edge, `shiftScene` jumps the textured scene in one cell, and `chaotic` makes each cell unrelated noise.
 */
export async function sheetPng(options: SheetOptions = {}): Promise<Buffer> {
  const width = options.width ?? 1536, height = 1024, cell = Math.floor(width / 3), rowHeight = height / 2, data = Buffer.alloc(width * height * 3, 40);
  const paint = (x: number, y: number, value: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 3;
    data[at] = value; data[at + 1] = value; data[at + 2] = Math.floor(value / 2);
  };
  for (let row = 0; row < 2; row++) for (let column = 0; column < 3; column++) {
    const frame = row * 3 + column, left = column * cell, top = row * rowHeight, shift = options.shiftScene === true && frame === 3 ? 56 : 0;
    if (options.chaotic === true) {
      let seed = frame * 7919 + 17;
      for (let y = 0; y < rowHeight; y += 8) for (let x = 0; x < cell; x += 8) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) paint(left + x + dx, top + y + dy, seed & 0xff);
      }
      continue;
    }
    // A stable textured scene of bars, inside the cell's margins.
    for (let bar = 0; bar < 8; bar++) for (let y = 120; y < rowHeight - 100; y++) for (let x = 0; x < 24; x++) paint(left + 60 + shift + bar * 50 + x, top + y, 120 + bar * 15);
    // The bobbing subject, or one laid across the cell's right edge.
    const size = 40, cx = options.straddle === true ? cell - size / 2 : Math.floor(cell / 2), cy = Math.floor(rowHeight / 2) + (frame % 2) * 4;
    for (let y = 0; y < size * 3; y++) for (let x = 0; x < size; x++) paint(left + cx + x, top + cy - size + y, 250);
  }
  return sharp(data, {raw: {width, height, channels: 3}}).png().toBuffer();
}

type ImageWork = (request: ImageRequest, signal: AbortSignal) => Promise<ImageAnswer>;
type TextWork = (request: TextRequest, signal: AbortSignal) => Promise<TextAnswer>;
/** A fake provider that records every call, with answers the test chooses. */
export function fakeImages(work: ImageWork): ArtProvider & {requests: ImageRequest[]} {
  const requests: ImageRequest[] = [];
  return {name: 'openai', model: 'gpt-image-2', requests, capabilities: {image: true, text: false}, image: (request, signal) => {requests.push(request); return work(request, signal);}};
}
export function fakeIdeas(work: TextWork): ArtProvider & {requests: TextRequest[]} {
  const requests: TextRequest[] = [];
  return {name: 'anthropic', model: 'claude-opus-5-5', requests, capabilities: {image: false, text: true}, text: (request, signal) => {requests.push(request); return work(request, signal);}};
}
export const dimensions = (size: string): [number, number] => {
  const [width, height] = size.split('x').map(Number);
  return [width ?? 0, height ?? 0];
};
/** Answers each request with a gradient of the requested size and a usage below the reservation. */
export const drawing = (usage: {inputTokens: number; outputTokens: number} | null = {inputTokens: 100, outputTokens: 100}) => async (request: ImageRequest): Promise<ImageAnswer> => {
  const [width, height] = dimensions(request.size);
  return {bytes: await gradientPng(width, height), usage};
};
/** Answers each request with new flat bytes of the requested size, so each composition has its own identity. */
export function distinctDrawing(): (request: ImageRequest) => Promise<ImageAnswer> {
  let tone = 0;
  return async request => {
    tone += 1;
    const [width, height] = dimensions(request.size), data = Buffer.alloc(width * height * 3, tone * 16);
    return {bytes: await sharp(data, {raw: {width, height, channels: 3}}).png().toBuffer(), usage: {inputTokens: 1, outputTokens: 1}};
  };
}
