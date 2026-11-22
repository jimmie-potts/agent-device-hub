import sharp from 'sharp';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {artContentRef, type ArtRendition} from '@jimmie-potts/event-contracts/v2/art-state';
import {isUploadArtworkId, MAX_ART_ATTACHMENT_BYTES, uploadArtworkId} from '@jimmie-potts/event-contracts/v2/art-show';
import {Outcome, type ModuleScheduler, type ModuleStagedUpload, type ModuleUploadRequest} from '@jimmie-potts/sdk';
import {FRAME_DELAY_MS, MAX_DISPLAY_BYTES, firstFrame, paletteOf, reduceGif, sha256} from './media.js';
import type {Artwork, StoredComposition} from './store.js';

export const ATTACHMENT_LIFETIME_MS = 10 * 60_000;
const MAX_ATTACHMENTS = 8;
const MAX_SIDE = 2048;
const MAX_PIXELS = 8 * 1024 * 1024;
const MAX_FRAMES = 20;
type Blob = {type: string; bytes: Uint8Array};
type PreparedAttachment = {
  artwork: Artwork;
  compositions: StoredComposition[];
  blobs: Map<string, Blob>;
  digest: string;
};

async function prepare(bytes: Uint8Array, requestId: string, now: number): Promise<PreparedAttachment | ErrorBody> {
  const image = sharp(bytes, {animated: true, limitInputPixels: MAX_PIXELS, failOn: 'warning'});
  const {format, width, height, pageHeight, pages = 1, delay = []} = await image.metadata();
  if (format !== 'png' && format !== 'jpeg' && format !== 'gif') return errorBody('unsupported-capability');
  const frameHeight = pageHeight ?? height;
  if (width === undefined || frameHeight === undefined) return errorBody('invalid-request');
  if (width > MAX_SIDE || frameHeight > MAX_SIDE || pages > MAX_FRAMES || width * frameHeight * pages > MAX_PIXELS) {
    return errorBody('too-large');
  }
  const animated = format === 'gif' && pages > 1;
  if ((!animated && pages !== 1) || (animated && delay.length !== pages)) return errorBody('invalid-request');

  const raw = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const frameBytes = width * frameHeight * 4;
  if (raw.byteLength !== frameBytes * pages) return errorBody('invalid-request');
  const frames = Array.from({length: pages}, (_, index) => raw.subarray(index * frameBytes, (index + 1) * frameBytes));
  const poster = animated ? await firstFrame(frames, width, frameHeight)
    : await sharp(bytes, {limitInputPixels: MAX_PIXELS, failOn: 'warning'}).autoOrient().png().toBuffer();
  const browser = await sharp(poster).resize({width: 1536, height: 1024, fit: 'inside', withoutEnlargement: true})
    .webp({quality: 90}).toBuffer({resolveWithObject: true});
  const artworkId = uploadArtworkId(requestId), digest = sha256(bytes);
  const blobs = new Map<string, Blob>([[digest, {type: `image/${format}`, bytes}]]);
  const rendition = (content: Uint8Array, type: ArtRendition['format'], w: number, h: number, frames = 1): ArtRendition => {
    const id = sha256(content);
    blobs.set(id, {type: `image/${type}`, bytes: content});
    return {renditionId: id, ref: artContentRef.rendition(id), format: type, width: w, height: h, frames,
      bytes: content.byteLength, durationMs: frames === 1 ? 0 : frames * FRAME_DELAY_MS};
  };
  const composition = (target: StoredComposition['target'], render: ArtRendition): StoredComposition => ({
    target, compositionId: sha256(Buffer.from(`${artworkId}/${target}`)), outcome: Outcome.succeeded,
    originalId: target === 'ui' ? digest : null, promptHash: null, gif: render.frames > 1 ? 'accepted' : null,
    motion: render.frames > 1 ? 'gif' : 'still', renditions: [render],
  });
  const compositions = [composition('ui', rendition(browser.data, 'webp', browser.info.width, browser.info.height))];
  for (const [target, w, h] of [['pixoo', 64, 64], ['tidbyt', 64, 32]] as const) {
    const content = animated ? await reduceGif(frames, width, frameHeight, w, h)
      : await sharp(poster).resize(w, h, {fit: 'cover'}).flatten({background: '#000'}).png().toBuffer();
    if (content.byteLength > MAX_DISPLAY_BYTES) return errorBody('too-large');
    compositions.push(composition(target, rendition(content, animated ? 'gif' : 'png', w, h, pages)));
  }
  return {artwork: {artworkId, requestId, favorite: true, feedback: null, variationOf: null, deletedAtMs: null,
    createdAtMs: now, generatedBy: 'local', palette: await paletteOf(poster)}, compositions, blobs, digest};
}

/** Holds validated bytes until their tracked command admits them, then until expiry or durable save. */
export class ArtAttachments {
  readonly #ready = new Map<string, PreparedAttachment>();
  #pending: {requestId: string; data?: PreparedAttachment} | undefined;

  constructor(private readonly scheduler: ModuleScheduler, private readonly now: () => number) {}

  async stage(request: ModuleUploadRequest): Promise<ModuleStagedUpload | ErrorBody> {
    if (request.target !== 'art' || !isUploadArtworkId(uploadArtworkId(request.requestId))) return errorBody('invalid-request');
    if (request.bytes.byteLength > MAX_ART_ATTACHMENT_BYTES) return errorBody('too-large');
    if (request.signal.aborted) return errorBody('cancelled');
    if (this.#pending !== undefined || this.#ready.size >= MAX_ATTACHMENTS) return errorBody('capacity');
    const pending: {requestId: string; data?: PreparedAttachment} = {requestId: request.requestId};
    this.#pending = pending;
    const release = (): void => {if (this.#pending === pending) this.#pending = undefined;};
    try {
      const data = await prepare(request.bytes, request.requestId, this.now());
      if ('error' in data) {release(); return data;}
      if (request.signal.aborted) {release(); return errorBody('cancelled');}
      pending.data = data;
      return {data: {action: 'stage', sha256: data.digest}, finish: reply => {
        if ('error' in reply && reply.error.code === 'uncertain-result' && this.#pending === pending) this.scheduler.after(30_000, release);
        else release();
      }};
    } catch {
      release();
      return errorBody('invalid-request');
    }
  }

  get pending(): Readonly<{requestId: string; data?: PreparedAttachment}> | undefined {return this.#pending;}
  get(id: string): PreparedAttachment | undefined {return this.#ready.get(id);}
  admit(data: PreparedAttachment): void {
    const id = data.artwork.artworkId;
    this.#ready.set(id, data);
    this.scheduler.after(ATTACHMENT_LIFETIME_MS, () => {if (this.#ready.get(id) === data) this.#ready.delete(id);});
  }
  discard(id: string): void {this.#ready.delete(id);}
  blob(id: string, admitted: (requestId: string) => boolean): Blob | undefined {
    for (const entry of this.#ready.values()) {
      const found = entry.blobs.get(id);
      if (found !== undefined && admitted(entry.artwork.requestId)) return found;
    }
    return undefined;
  }
}
