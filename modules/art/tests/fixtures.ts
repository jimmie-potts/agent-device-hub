// Synthetic images and fake providers. Nothing here reaches a provider, and no test reads a real key.
import {createRequire} from 'node:module';
import sharp from 'sharp';
import type {ArtProvider, ImageAnswer, ImageRequest, TextAnswer, TextRequest} from '../src/provider.js';

const {GIFEncoder, applyPalette, quantize} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');

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
/** A small GIF as the provider would answer: a plain ground and a square that moves, with a seed for distinct bytes. */
export function gifBytes(width: number, height: number, options: {frames?: number; delayMs?: number; seed?: number} = {}): Buffer {
  const frames = options.frames ?? 8, delay = options.delayMs ?? 200, seed = options.seed ?? 0, palette = quantize(Buffer.from([20, 40, 60, 255, 250, 200, 80, 255, (seed * 16) % 256, 90, 120, 255]), 4), gif = GIFEncoder();
  const rgba = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < frames; frame++) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, inside = x >= 40 + frame * 8 && x < 80 + frame * 8 && y >= 40 && y < 80, band = y > height - 20;
      rgba[at] = inside ? 250 : band ? (seed * 16) % 256 : 20; rgba[at + 1] = inside ? 200 : band ? 90 : 40; rgba[at + 2] = inside ? 80 : band ? 120 : 60; rgba[at + 3] = 255;
    }
    gif.writeFrame(applyPalette(rgba, palette), width, height, {...(frame === 0 ? {palette} : {}), delay, dispose: 1, transparent: false, repeat: 0});
  }
  gif.finish();
  return Buffer.from(gif.bytes());
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
/** Answers each request with what it asked for, a GIF or a PNG of its size, and a usage below the reservation. */
export const drawing = (usage: {inputTokens: number; outputTokens: number} | null = {inputTokens: 100, outputTokens: 100}) => async (request: ImageRequest): Promise<ImageAnswer> => {
  const [width, height] = dimensions(request.size);
  return {bytes: request.gif === undefined ? await gradientPng(width, height) : gifBytes(width, height, {frames: request.gif.frameCount, delayMs: request.gif.frameDurationMs}), usage};
};
/** Answers each request with new bytes of what it asked for, so each composition has its own identity. */
export function distinctDrawing(): (request: ImageRequest) => Promise<ImageAnswer> {
  let tone = 0;
  return async request => {
    tone += 1;
    const [width, height] = dimensions(request.size), usage = {inputTokens: 1, outputTokens: 1};
    if (request.gif !== undefined) return {bytes: gifBytes(width, height, {frames: request.gif.frameCount, delayMs: request.gif.frameDurationMs, seed: tone}), usage};
    return {bytes: await sharp(Buffer.alloc(width * height * 3, tone * 16), {raw: {width, height, channels: 3}}).png().toBuffer(), usage};
  };
}
