import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import type {ArtStageContent} from '@jimmie-potts/event-contracts/v2/art';

type GifEncoder = {writeFrame(pixels: Uint8Array, width: number, height: number, options: {palette: number[][]; delay: number; dispose: number; transparent: boolean; transparentIndex: number; repeat: number}): void; finish(): void; bytes(): Uint8Array};
const {GIFEncoder} = createRequire(import.meta.url)('gifenc') as {GIFEncoder: () => GifEncoder};
export const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 0, 255], [0, 255, 0]];
export function gifFrames(frames: {index: number; delay: number; transparent?: boolean; dispose?: number; pixels?: Uint8Array}[], palette = PALETTE): Buffer {
  const gif = GIFEncoder();
  for (const frame of frames) gif.writeFrame(frame.pixels ?? new Uint8Array(64 * 32).fill(frame.index), 64, 32,
    {palette, delay: frame.delay, dispose: frame.dispose ?? 1, transparent: frame.transparent ?? false, transparentIndex: 0, repeat: 0});
  gif.finish();
  return Buffer.from(gif.bytes());
}
export function artStage(bytes = gifFrames([{index: 1, delay: 200}, {index: 2, delay: 200}]), overrides: Partial<ArtStageContent> = {}): ArtStageContent {
  return {compositionId: 'a'.repeat(64), format: 'gif', width: 64, height: 32, frames: 2, durationMs: 400,
    sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'), lifetimeMs: 86_400_000, ...overrides};
}
