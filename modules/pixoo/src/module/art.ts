import {mkdir, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {artReferenceRefusal, artStageDecision, MAX_ART_BYTES, type ArtCopy, type ArtStageRequest} from '@jimmie-potts/event-contracts/v2/art';
import {SdkError, type ModuleContent, type ModuleContentRequest} from '@jimmie-potts/sdk';
import {DEFAULT_TRANSFORM, LIBRARY_PROFILE, hostedPalette, MediaError, MediaStore, type MediaProfile, type Rendition} from '../media/index.js';
import {animationRoute, frameCountRefusal, timingRefusal} from '../device/animation-policy.js';
import {PlaybackRouteError} from '../library/playback-policy.js';
import {isFrameIndex} from './content.js';
import {renditionId} from '../media/store.js';

const HASH = /^[a-f0-9]{64}$/;
const rowSchema = z.object({composition_id: z.string().regex(HASH), sha256: z.string().regex(HASH), rendition_id: z.string().regex(HASH),
  expires_at_ms: z.number().int().nonnegative(), profile: z.string(), delay_ms: z.number().int().positive()});
type Row = z.infer<typeof rowSchema>;
export const MAX_ART_COPIES = 128;
const MAX_QUEUED = 4;
const copyOf = (row: Row): ArtCopy => ({compositionId: row.composition_id, sha256: row.sha256, expiresAtMs: row.expires_at_ms});
const refusal = (detail: string): ErrorBody => errorBody('invalid-request', {detail});
const mismatch = (stage: ArtStageRequest, rendition: Rendition): boolean => rendition.sourceHash !== stage.sha256
  || rendition.source.format !== stage.format || rendition.source.width !== stage.width || rendition.source.height !== stage.height
  || rendition.frames.length !== stage.frames || (rendition.effectiveDurationMs ?? 0) !== stage.durationMs;

/** A resolved private copy stays available for one admitted moment or content read, even after its expiry. */
export type ArtLease = {delayMs: number; frames: () => Promise<Buffer[]>; release: () => void};

/** Transient art reuses the native renderer, in folders that the permanent library never cleans or imports. */
export class PixooArt {
  readonly #held = new Map<string, number>();
  #tail: Promise<unknown> = Promise.resolve();
  #queued = 0;
  constructor(readonly db: DatabaseSync, readonly directory: string, readonly profile: MediaProfile, readonly now: () => number, readonly signal: AbortSignal) {
    db.exec(`CREATE TABLE IF NOT EXISTS pixoo_art_copies (composition_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, rendition_id TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL, profile TEXT NOT NULL, delay_ms INTEGER NOT NULL) STRICT`);
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await this.prune();
  }

  #row(compositionId: string): Row | undefined {
    const row = this.db.prepare('SELECT * FROM pixoo_art_copies WHERE composition_id = ?').get(compositionId);
    return row === undefined ? undefined : rowSchema.parse(row);
  }

  #media(id: string): MediaStore {
    return new MediaStore({directory: join(this.directory, id), limits: {maxUploadBytes: MAX_ART_BYTES,
      maxGifCanvasPixels: 64 * 64, concurrency: 1, maxQueued: 0}});
  }

  stageRefusal(stage: ArtStageRequest): ErrorBody | undefined {
    if (this.#queued >= MAX_QUEUED) return errorBody('capacity', {detail: 'the art staging queue is full'});
    if (stage.width !== 64 || stage.height !== 64) return refusal('Pixoo art must be 64 by 64');
    const limit = frameCountRefusal(animationRoute(this.profile.name), stage.frames);
    if (limit !== undefined) return errorBody('unsupported-capability', {detail: limit});
    const row = this.#row(stage.compositionId), decision = artStageDecision(row === undefined ? undefined : copyOf(row), stage, this.now());
    if ('error' in decision) return decision;
    const active = this.db.prepare('SELECT count(*) AS count FROM pixoo_art_copies WHERE expires_at_ms > ?').get(this.now())?.count;
    return decision.action === 'store' && typeof active === 'number' && active >= MAX_ART_COPIES
      ? errorBody('capacity', {detail: 'the private art store is full'}) : undefined;
  }

  referenceRefusal(compositionId: string): ErrorBody | undefined {
    const row = this.#row(compositionId), missing = artReferenceRefusal(row === undefined ? undefined : copyOf(row), this.now());
    return missing ?? (row?.profile !== this.profile.name ? errorBody('unsupported-capability', {detail: 'the staged art uses another device profile'}) : undefined);
  }

  stage(stage: ArtStageRequest, admittedAtMs: number): Promise<void> {
    this.#queued += 1;
    return this.#serial(async () => {
      const row = this.#row(stage.compositionId), decision = artStageDecision(row === undefined ? undefined : copyOf(row), stage, this.now());
      if ('error' in decision) throw new SdkError(decision);
      if (this.signal.aborted) throw new MediaError('cancelled');
      const expiresAtMs = admittedAtMs + stage.lifetimeMs;
      if (decision.action === 'reuse' && row !== undefined && row.profile === this.profile.name) {
        const retained = await this.#media(row.rendition_id).getRendition(row.rendition_id);
        if (mismatch(stage, retained)) throw new MediaError('invalid-input');
        this.db.prepare('UPDATE pixoo_art_copies SET expires_at_ms = ? WHERE composition_id = ?').run(expiresAtMs, stage.compositionId);
        return;
      }
      const id = renditionId(stage.sha256, DEFAULT_TRANSFORM, LIBRARY_PROFILE), media = this.#media(id);
      const bytes = Buffer.from(stage.base64, 'base64');
      const input = async function* (): AsyncGenerator<Buffer> { yield await Promise.resolve(bytes); };
      try {
        const rendition = await media.render(input(), {signal: this.signal});
        if (mismatch(stage, rendition)) throw new MediaError('invalid-input');
        const delayMs = rendition.frames[0]?.delayMs ?? 500;
        const route = animationRoute(this.profile.name);
        // The transient player transmits one native delay for the whole composition.
        if (rendition.frames.some(frame => frame.delayMs !== null && frame.delayMs !== delayMs)) {
          throw new PlaybackRouteError('Pixoo art playback requires one frame delay.');
        }
        const delayIssue = timingRefusal(route, rendition.frames.map(frame => frame.delayMs ?? delayMs));
        if (delayIssue !== undefined) throw new PlaybackRouteError(delayIssue);
        if (route === 'hosted' && rendition.frames.length > 1) {
          const loaded = await media.readFrames(id, this.signal);
          hostedPalette(loaded.frames.map(rgb => ({rgb, delayMs})));
        }
        if (this.signal.aborted || this.now() >= expiresAtMs) throw new MediaError('cancelled');
        const active = this.db.prepare('SELECT count(*) AS count FROM pixoo_art_copies WHERE expires_at_ms > ? AND composition_id != ?').get(this.now(), stage.compositionId)?.count;
        if (typeof active === 'number' && active >= MAX_ART_COPIES) throw new MediaError('busy');
        this.db.prepare(`INSERT INTO pixoo_art_copies VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (composition_id) DO UPDATE SET sha256=excluded.sha256, rendition_id=excluded.rendition_id,
          expires_at_ms=excluded.expires_at_ms, profile=excluded.profile, delay_ms=excluded.delay_ms`)
          .run(stage.compositionId, stage.sha256, id, expiresAtMs, this.profile.name, delayMs);
      } finally { await this.#prune(); }
    }).finally(() => { this.#queued -= 1; });
  }

  retain(compositionId: string): ArtLease {
    const refused = this.referenceRefusal(compositionId);
    if (refused !== undefined) throw new SdkError(refused);
    const row = this.#row(compositionId);
    if (row === undefined) throw new SdkError(errorBody('not-found'));
    this.#held.set(row.rendition_id, (this.#held.get(row.rendition_id) ?? 0) + 1);
    let released = false;
    return {delayMs: row.delay_ms, frames: async () => (await this.#media(row.rendition_id).readFrames(row.rendition_id, this.signal)).frames,
      release: () => {
        if (released) return;
        released = true;
        const remaining = (this.#held.get(row.rendition_id) ?? 1) - 1;
        if (remaining === 0) this.#held.delete(row.rendition_id); else this.#held.set(row.rendition_id, remaining);
      }};
  }

  async content(ref: string, request?: ModuleContentRequest): Promise<ModuleContent | ErrorBody> {
    const parts = ref.split('.'), [kind, compositionId, frame] = parts;
    if (parts.length !== (kind === 'art-frame' ? 3 : 2) || compositionId === undefined || !HASH.test(compositionId)
      || Object.keys(request?.query ?? {}).length !== 0 || (kind !== 'art-preview' && kind !== 'art-frame')
      || (kind === 'art-frame' && (frame === undefined || !isFrameIndex(frame)))) return refusal('the art content reference is invalid');
    const refused = this.referenceRefusal(compositionId);
    if (refused !== undefined) return refused;
    const row = this.#row(compositionId);
    if (row === undefined) return errorBody('not-found');
    const held = this.retain(compositionId), media = this.#media(row.rendition_id);
    try {
      const rendition = await media.getRendition(row.rendition_id);
      const loaded = await media.readPreview(rendition, kind === 'art-frame' ? Number(frame) : null, request?.signal);
      if (loaded.bytes !== undefined) return {type: 'image/png', bytes: loaded.bytes};
      return {type: 'application/json', bytes: Buffer.from(JSON.stringify({compositionId, width: 64, height: 64, format: rendition.source.format,
        frameCount: rendition.frames.length, durationMs: rendition.effectiveDurationMs ?? 0, sha256: row.sha256, expiresAtMs: row.expires_at_ms,
        profile: row.profile, frames: rendition.frames.map(item => ({index: item.index, delayMs: item.delayMs, sha256: item.previewHash,
          ref: `art-frame.${compositionId}.${item.index}`}))}))};
    } catch (error) {
      if (error instanceof MediaError) return errorBody(error.code === 'cancelled' ? 'cancelled' : error.code === 'invalid-input' ? 'invalid-request' : 'unavailable', {detail: 'the private art copy could not be read'});
      throw error;
    } finally { held.release(); }
  }

  prune(): Promise<void> { return this.#serial(() => this.#prune()); }
  async close(): Promise<void> { await this.#tail; }
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(work);
    this.#tail = next.catch(() => undefined);
    return next;
  }

  async #prune(): Promise<void> {
    for (const raw of this.db.prepare('SELECT * FROM pixoo_art_copies WHERE expires_at_ms <= ?').all(this.now())) {
      const row = rowSchema.parse(raw);
      if (!this.#held.has(row.rendition_id)) this.db.prepare('DELETE FROM pixoo_art_copies WHERE composition_id = ?').run(row.composition_id);
    }
    const kept = new Set([...this.#held.keys(), ...this.db.prepare('SELECT * FROM pixoo_art_copies').all().map(row => rowSchema.parse(row).rendition_id)]);
    for (const entry of await readdir(this.directory, {withFileTypes: true})) {
      if (entry.isDirectory() && HASH.test(entry.name) && !kept.has(entry.name)) await rm(join(this.directory, entry.name), {recursive: true, force: true});
    }
  }
}
