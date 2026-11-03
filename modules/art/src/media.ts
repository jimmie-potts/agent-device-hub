// Local image work, which costs nothing (docs/art-generation-qualification.md, "Compositions"): validation before storage,
// Lanczos reduction to a 32-color palette, sprite-sheet slicing and validation, GIF assembly and local motion. Every decode
// is bounded, and a decoder's message never leaves this file.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import sharp from 'sharp';
import type {Palette} from 'gifenc';

// CommonJS, as Pixoo loads it.
const {GIFEncoder, applyPalette, quantize} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
sharp.cache(false);
sharp.concurrency(1);

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Above the largest size the price table admits, so a decode cannot grow without bound. */
const MAX_PIXELS = 4096 * 4096;
export const COLOURS = 32;
export const SHEET_COLUMNS = 3;
export const SHEET_ROWS = 2;
/** Uniform, within Pixoo's observed GIF envelope of 100 to 800 ms. */
export const FRAME_DELAY_MS = 200;
/** The most a staged display rendition may hold (the record's `art-stage`). */
export const MAX_DISPLAY_BYTES = 160 * 1024;
/** Every request asks for PNG, and the store types an original as PNG. */
const ACCEPTED_FORMAT = 'png';
/** A pixel "changed noticeably" past this luminance step, as the trial counted them. */
const CHANGE_STEP = 32;
/** The trial's stable sheet changed at most 257 of 4,096 pixels between frames; this allows about twice that. */
export const MAX_CHANGED = 512 / 4096;
/** A subject on a cell edge covers at least this share of the edge with matching non-background pixels on both sides. */
const STRADDLE_SHARE = 0.05;

export type SheetReason = 'misaligned-cells' | 'excess-change';
export type SheetVerdict = {ok: true} | {ok: false; reason: SheetReason};
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
/**
 * Maps RGBA pixels onto one palette of at most `COLOURS`, as `gifenc` does for Pixoo. Sharp 0.35.4's own `colours` option
 * left 256 colors in both its PNG and GIF output, so it does not enforce this bound.
 */
function indexed(rgba: Uint8Array): {palette: Palette; indices: Uint8Array} {
  const palette = quantize(rgba, COLOURS, {format: 'rgb565'});
  return {palette, indices: applyPalette(rgba, palette, 'rgb565')};
}
/** One display still: Lanczos to the panel's size, then a 32-color palette. Metadata does not survive. */
export async function reduceStill(bytes: Uint8Array, width: number, height: number): Promise<Buffer> {
  const rgba = await lanczos(bytes, width, height).ensureAlpha(1).raw().toBuffer(), {palette, indices} = indexed(rgba), rgb = Buffer.alloc(width * height * 3);
  indices.forEach((index, at) => {const colour = palette[index]; rgb[at * 3] = colour?.[0] ?? 0; rgb[at * 3 + 1] = colour?.[1] ?? 0; rgb[at * 3 + 2] = colour?.[2] ?? 0;});
  return sharp(rgb, {raw: {width, height, channels: 3}}).png({palette: true, compressionLevel: 9}).toBuffer();
}
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

/** Cuts a sheet into its cells, in reading order. A sheet the grid does not divide evenly has no cells. */
export async function sliceSheet(bytes: Uint8Array): Promise<Buffer[]> {
  const {width, height} = await image(bytes).metadata(), cellWidth = width / SHEET_COLUMNS, cellHeight = height / SHEET_ROWS;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) throw new MediaFault('invalid');
  const frames: Promise<Buffer>[] = [];
  for (let row = 0; row < SHEET_ROWS; row++) for (let column = 0; column < SHEET_COLUMNS; column++) {
    frames.push(image(bytes).extract({left: column * cellWidth, top: row * cellHeight, width: cellWidth, height: cellHeight}).png().toBuffer());
  }
  return Promise.all(frames);
}
type Grey = {data: Uint8Array; width: number; height: number};
const grey = async (bytes: Uint8Array, width?: number, height?: number): Promise<Grey> => {
  const pipeline = width === undefined || height === undefined ? image(bytes) : image(bytes).resize(width, height, {fit: 'fill', kernel: 'lanczos3'});
  const {data, info} = await pipeline.greyscale().removeAlpha().raw().toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
};
const value = (picture: Grey, x: number, y: number): number => picture.data[y * picture.width + x] ?? 0;
/** A subject that crosses a cell edge means the grid and the drawing disagree. The cells' corners stand for each cell's ground. */
function straddles(sheet: Grey): boolean {
  const cellWidth = sheet.width / SHEET_COLUMNS, cellHeight = sheet.height / SHEET_ROWS;
  const ground = (column: number, row: number): number[] => {
    const left = column * cellWidth, top = row * cellHeight, right = left + cellWidth - 1, bottom = top + cellHeight - 1;
    return [value(sheet, left, top), value(sheet, right, top), value(sheet, left, bottom), value(sheet, right, bottom)];
  };
  const subject = (pixel: number, corners: number[]): boolean => corners.every(corner => Math.abs(pixel - corner) > CHANGE_STEP);
  for (let row = 0; row < SHEET_ROWS; row++) for (let column = 0; column + 1 < SHEET_COLUMNS; column++) {
    const x = (column + 1) * cellWidth, before = ground(column, row), after = ground(column + 1, row);
    let matching = 0;
    for (let y = row * cellHeight; y < (row + 1) * cellHeight; y++) {
      const a = value(sheet, x - 1, y), b = value(sheet, x, y);
      if (Math.abs(a - b) < CHANGE_STEP && subject(a, before) && subject(b, after)) matching++;
    }
    if (matching / cellHeight > STRADDLE_SHARE) return true;
  }
  for (let column = 0; column < SHEET_COLUMNS; column++) {
    const y = cellHeight, before = ground(column, 0), after = ground(column, 1);
    let matching = 0;
    for (let x = column * cellWidth; x < (column + 1) * cellWidth; x++) {
      const a = value(sheet, x, y - 1), b = value(sheet, x, y);
      if (Math.abs(a - b) < CHANGE_STEP && subject(a, before) && subject(b, after)) matching++;
    }
    if (matching / cellWidth > STRADDLE_SHARE) return true;
  }
  return false;
}
function changedShare(a: Grey, b: Grey, dx = 0, dy = 0): number {
  let changed = 0, compared = 0;
  for (let y = Math.max(0, -dy); y < a.height - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < a.width - Math.max(0, dx); x++) {
    compared++;
    if (Math.abs(value(a, x, y) - value(b, x + dx, y + dy)) > CHANGE_STEP) changed++;
  }
  return compared === 0 ? 1 : changed / compared;
}
/** Whether moving one frame a few pixels explains most of its difference from the next: the scene itself jumped. */
function jumps(a: Grey, b: Grey, changed: number): boolean {
  if (changed <= MAX_CHANGED / 2) return false;
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    if ((dx !== 0 || dy !== 0) && changedShare(a, b, dx, dy) < changed * 0.4) return true;
  }
  return false;
}
/** A sheet is usable when the grid fits the drawing and its frames stay one scene. A rejected sheet still cost its call. */
export async function validateSheet(bytes: Uint8Array): Promise<SheetVerdict> {
  let cells: Buffer[];
  try {cells = await sliceSheet(bytes);} catch {return {ok: false, reason: 'misaligned-cells'};}
  if (straddles(await grey(bytes))) return {ok: false, reason: 'misaligned-cells'};
  const frames = await Promise.all(cells.map(cell => grey(cell, 64, 64)));
  let excess = false;
  for (let index = 0; index + 1 < frames.length; index++) {
    const a = frames[index], b = frames[index + 1];
    if (a === undefined || b === undefined) continue;
    const changed = changedShare(a, b);
    if (jumps(a, b, changed)) return {ok: false, reason: 'misaligned-cells'};
    if (changed > MAX_CHANGED) excess = true;
  }
  return excess ? {ok: false, reason: 'excess-change'} : {ok: true};
}
/** What a rejected sheet can still give local motion: one whole cell, or the whole sheet when the cells cannot be trusted. */
export async function stillFromSheet(bytes: Uint8Array, reason: SheetReason): Promise<Buffer> {
  if (reason === 'excess-change') {
    const [first] = await sliceSheet(bytes);
    if (first !== undefined) return first;
  }
  return image(bytes).png().toBuffer();
}
/** One frame as raw RGBA at the panel's size. */
export const reduceFrame = (bytes: Uint8Array, width: number, height: number): Promise<Buffer> =>
  lanczos(bytes, width, height).ensureAlpha().raw().toBuffer();
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
  for (let frame = 0; frame < SHEET_COLUMNS * SHEET_ROWS; frame++) {
    const phase = (frame / (SHEET_COLUMNS * SHEET_ROWS)) * 2 * Math.PI;
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
