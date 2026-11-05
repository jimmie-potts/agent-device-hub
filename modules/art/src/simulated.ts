// The disposable runtime's provider. Only synthetic pixels and fixed usage cross its IPC link; no prompt or key is kept.
import {createRequire} from 'node:module';
import sharp from 'sharp';
import type {DeviceLink} from '@jimmie-potts/sdk';
import {GIF_FRAMES, IMAGE_MODEL, IDEA_MODEL} from './prices.js';
import {ProviderFault, type ArtProvider, type ImageRequest} from './provider.js';

const {GIFEncoder} = createRequire(import.meta.url)('gifenc') as typeof import('gifenc');
const USAGE = {inputTokens: 100, outputTokens: 100};
export const ART_SIMULATION_ACTIONS = ['invalid-next', 'lose-next', 'hold', 'release'] as const;
type Drawing = {size: string; frames: number; delayMs: number};
type Answer = {kind: 'image'; base64: string} | {kind: 'idea'; text: string};
export type ArtSimulationState = {imageCalls: number; ideaCalls: number; pending: number};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function drawing(value: unknown): Drawing {
  if (!object(value) || typeof value.size !== 'string' || !['512x256', '512x512', '1536x1024'].includes(value.size) ||
      typeof value.frames !== 'number' || ![1, GIF_FRAMES].includes(value.frames) || value.delayMs !== 200) throw new Error('invalid synthetic drawing');
  return {size: value.size, frames: value.frames, delayMs: value.delayMs};
}

async function pixels({size, frames, delayMs}: Drawing, call: number): Promise<Buffer> {
  const width = size === '1536x1024' ? 1536 : 512, height = size === '512x256' ? 256 : size === '512x512' ? 512 : 1024;
  const palette = [[20, 35, 65], [235, 180, 70], [70, 130, 160 + call % 90]];
  if (frames === 1) return sharp({create: {width, height, channels: 3, background: {r: 20, g: 35, b: 65}}})
    .composite([{input: Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${height / 4}" fill="#ebb446"/><rect x="0" y="${height * 3 / 4}" width="${width}" height="${height / 4}" fill="rgb(70,130,${160 + call % 90})"/></svg>`)}]).png().toBuffer();
  const gif = GIFEncoder();
  for (let frame = 0; frame < frames; frame++) {
    const indexes = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      indexes[y * width + x] = y > height * 3 / 4 ? 2 : Math.hypot(x - width / 2 - frame * 3, y - height / 2) < height / 4 ? 1 : 0;
    }
    gif.writeFrame(indexes, width, height, {palette, delay: delayMs, repeat: 0, dispose: 1, transparent: false});
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

export class SimulatedArt {
  #imageCalls = 0;
  #ideaCalls = 0;
  #next: 'image' | 'invalid' | 'lost' = 'image';
  #held = false;
  readonly #pending = new Set<() => void>();
  state(): ArtSimulationState {return {imageCalls: this.#imageCalls, ideaCalls: this.#ideaCalls, pending: this.#pending.size};}
  act(action: string): void {
    if (action === 'invalid-next') this.#next = 'invalid';
    else if (action === 'lose-next') this.#next = 'lost';
    else if (action === 'hold') this.#held = true;
    else if (action === 'release') {this.#held = false; for (const release of [...this.#pending]) release();}
  }
  async call(method: string, args: unknown, signal: AbortSignal): Promise<Answer> {
    if (method === 'idea') {this.#ideaCalls += 1; return {kind: 'idea', text: 'A synthetic moon above a small blue garden.'};}
    if (method !== 'image') throw new Error('unknown synthetic art call');
    const request = drawing(args), next = this.#next;
    this.#next = 'image'; this.#imageCalls += 1;
    if (this.#held) await new Promise<void>((resolve, reject) => {
      const finish = (): void => {this.#pending.delete(finish); signal.removeEventListener('abort', abort); resolve();};
      const abort = (): void => {this.#pending.delete(finish); reject(new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true}));};
      this.#pending.add(finish); signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort();
    });
    if (next === 'lost') throw new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
    return {kind: 'image', base64: (next === 'invalid' ? Buffer.from('synthetic-invalid-image') : await pixels(request, this.#imageCalls)).toString('base64')};
  }
}

type Call = (method: string, args: unknown, signal: AbortSignal) => Promise<unknown>;
/** This adapter sends dimensions only, so even a synthetic prompt is absent from the supervisor's state. */
export function simulatedProviders(call: Call): Readonly<Record<'openai' | 'anthropic', ArtProvider>> {
  const image = async (request: ImageRequest, signal: AbortSignal) => {
    const answer = await call('image', {size: request.size, frames: request.gif?.frameCount ?? 1, delayMs: request.gif?.frameDurationMs ?? 200}, signal);
    if (!object(answer) || answer.kind !== 'image' || typeof answer.base64 !== 'string') throw new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
    return {bytes: Buffer.from(answer.base64, 'base64'), usage: USAGE};
  };
  return {
    openai: {name: 'openai', model: IMAGE_MODEL, capabilities: {image: true, text: false}, image},
    anthropic: {name: 'anthropic', model: IDEA_MODEL, capabilities: {image: false, text: true}, text: async (_request, signal) => {
      const answer = await call('idea', {}, signal);
      if (!object(answer) || answer.kind !== 'idea' || typeof answer.text !== 'string') throw new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
      return {text: answer.text, usage: USAGE};
    }},
  };
}
export const remoteProviders = (link: DeviceLink): ReturnType<typeof simulatedProviders> => simulatedProviders(async (method, args, signal) => {
  const answer = await link.call(method, args, signal);
  if (answer.status !== 'answered') throw new ProviderFault('uncertain-result', 'lost-response', {uncertain: true, keep: true});
  return answer.value;
});
