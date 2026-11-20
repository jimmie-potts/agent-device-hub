import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {MAX_ART_BYTES} from '@jimmie-potts/event-contracts/v2/art';
import type {ModuleScheduler, ModuleStagedUpload, ModuleUploadRequest} from '@jimmie-potts/sdk';

export type LocalGif = {bytes: Buffer; sha256: string; frames: number; durationMs: number};
type PendingUpload = {requestId: string; gif?: LocalGif};
export const LOCAL_GIF_LIFETIME_MS = 10 * 60_000;

/** Only the request holding this slot can consume its input. The device worker validates and decodes the complete GIF. */
export class LocalGifUpload {
  #active: PendingUpload | undefined;

  constructor(private readonly scheduler: ModuleScheduler) {}

  async stage(request: ModuleUploadRequest): Promise<ModuleStagedUpload | ErrorBody> {
    if (request.target !== 'art') return errorBody('not-found');
    if (request.bytes.byteLength > MAX_ART_BYTES) return errorBody('too-large');
    if (request.signal.aborted) return errorBody('cancelled');
    if (this.#active !== undefined) return errorBody('capacity');
    const active: PendingUpload = {requestId: request.requestId};
    this.#active = active;
    const release = (): void => {if (this.#active === active) this.#active = undefined;};
    try {
      const bytes = Buffer.from(request.bytes);
      const signature = bytes.toString('latin1', 0, 6);
      if (bytes.length < 13 || (signature !== 'GIF89a' && signature !== 'GIF87a')) {release(); return errorBody('invalid-request');}
      if (bytes.readUInt16LE(6) !== 64 || bytes.readUInt16LE(8) !== 32) {release(); return errorBody('unsupported-capability');}
      const meta = await sharp(bytes, {animated: true, limitInputPixels: 64 * 32 * 20, failOn: 'warning'}).metadata();
      const frames = meta.pages ?? 1, delays = meta.delay ?? [];
      if (meta.format !== 'gif' || meta.width !== 64 || meta.pageHeight !== 32 || frames < 2 || frames > 20
        || delays.length !== frames || delays.some(delay => delay < 100 || delay > 800)) {
        release();
        return errorBody('unsupported-capability');
      }
      if (request.signal.aborted) {release(); return errorBody('cancelled');}
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      active.gif = {bytes, sha256, frames, durationMs: delays.reduce((sum, delay) => sum + delay, 0)};
      return {data: {sha256}, finish: reply => {
        // A lost dispatch reply can precede admission. Keep the bounded input for the remainder of the command window.
        if ('error' in reply && reply.error.code === 'uncertain-result' && this.#active === active) this.scheduler.after(30_000, release);
        else release();
      }};
    } catch {
      release();
      return errorBody('invalid-request');
    }
  }

  admitted(requestId: string, sha256: string): void {
    if (this.#active?.requestId === requestId && this.#active.gif?.sha256 === sha256) this.#active = undefined;
  }

  get input(): Readonly<PendingUpload> | undefined {return this.#active;}
}
