/** One current image and one admitted chain. Image completion never reports metadata evidence. */
import {randomUUID} from 'node:crypto';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, type Scheduler} from '@jimmie-potts/sdk';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {ARTWORK_DECODE_MS, ARTWORK_FETCH_MS, artworkFailure, artworkIdentity, artworkUrl, createArtworkFetch, type ArtworkFetch, type ArtworkResult, type ArtworkSource} from './artwork-fetch.js';
import type {ArtworkDecode, ArtworkThumbnail} from './artwork-decode.js';

export type ArtworkObservation = {status: string; title?: string; artist?: string; album?: string; thumbnailUrl?: string};
export type ArtworkPresentation = {
  index: number; kind: 'sony' | 'sonos'; endpoint: string;
  availability: 'available' | 'stale' | 'unavailable'; observation?: ArtworkObservation;
};
export type ArtworkControllerOptions = {
  scheduler: Scheduler; signal: AbortSignal; decode: ArtworkDecode;
  fetch?: ArtworkFetch; generation?: () => string; onChange: () => void;
  onDiagnostic?: (record: ArtworkDiagnostic) => void;
};
export type ArtworkDiagnostic = {kind: 'failure' | 'retry' | 'exhausted' | 'recovery'; code: ErrorCode; attempts: number; source: ArtworkSource};
type Candidate = {source: ArtworkSource; url: string; endpoint: string; generation: string; sequence: number; attempts: number; exhausted?: boolean};

export class ArtworkController {
  readonly #options: ArtworkControllerOptions;
  readonly #fetch: ArtworkFetch;
  #association: string | undefined;
  #artwork: PlaybackArtwork | undefined;
  #candidateIdentity: string | undefined;
  #candidate: Candidate | undefined;
  #sequence = 0;
  #running = false;
  #retry: (() => void) | undefined;
  #failure: ErrorCode | undefined;
  /** Whether the ready image is held while the first replacement after it is acquired, so the current reference has not confirmed it. */
  #holding = false;

  constructor(options: ArtworkControllerOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? createArtworkFetch();
    options.signal.addEventListener('abort', () => {
      this.#clear();
      this.#artwork = undefined;
      this.#association = undefined;
    }, {once: true});
  }

  snapshot(): PlaybackArtwork | undefined {
    return this.#artwork === undefined ? undefined : structuredClone(this.#artwork);
  }

  /** A source without receiver artwork retires the old receiver's image and pending results. */
  retire(): void {
    this.#clear();
    this.#association = undefined;
    this.#artwork = undefined;
  }

  /** Synchronous state update: the caller incorporates snapshot() in its next publication. */
  update(view: ArtworkPresentation): void {
    if (this.#options.signal.aborted) return;
    const observation = view.observation;
    const eligible = view.availability !== 'unavailable' && observation !== undefined &&
      (observation.status === 'playing' || observation.status === 'paused');
    if (!eligible || observation === undefined) {
      this.#clear();
      this.#association = undefined;
      this.#artwork = undefined;
      return;
    }
    const association = JSON.stringify([view.index, view.kind, view.endpoint, observation.title ?? null, observation.artist ?? null, observation.album ?? null]);
    if (association !== this.#association) {
      this.#clear();
      this.#association = association;
      this.#failure = undefined;
      this.#artwork = {status: 'missing', generation: (this.#options.generation ?? randomUUID)()};
    }
    if (this.#artwork === undefined) return;
    const raw = observation.thumbnailUrl;
    const identity = artworkIdentity(raw, view.kind);
    if (identity !== this.#candidateIdentity) {
      const superseded = this.#holding;
      this.#clear();
      this.#candidateIdentity = identity;
      const url = artworkUrl(raw, view.endpoint, view.kind);
      // A ready image here was acquired for this same association: an association change above has already made it
      // `missing` under a new generation. It is held only while the first admissible replacement after it makes its first
      // attempt, and an acquired image equal to it publishes nothing, so a receiver that alternates two references to one
      // image publishes that image once (#1758). An absent or refused reference, a reference that supersedes an
      // unconfirmed replacement, and a failed attempt all report `missing`, as before: an unconfirmed image never outlasts
      // one bounded attempt (the fetch and decode deadlines).
      if (this.#artwork.status === 'ready' && url !== undefined && !superseded) this.#holding = true;
      else this.#artwork = {status: 'missing', generation: this.#artwork.generation};
      if (url !== undefined) this.#candidate = {source: view.kind, url, endpoint: view.endpoint, generation: this.#artwork.generation, sequence: this.#sequence, attempts: 0};
      else if (raw !== undefined) this.#failed('unsupported-capability', 0, view.kind);
    }
    this.#start();
  }

  #clear(): void {
    this.#sequence += 1;
    this.#candidate = undefined;
    this.#candidateIdentity = undefined;
    this.#holding = false;
    this.#retry?.();
    this.#retry = undefined;
  }

  #current(candidate: Candidate): boolean {
    return !this.#options.signal.aborted && this.#candidate === candidate && candidate.sequence === this.#sequence && this.#artwork?.generation === candidate.generation;
  }

  #failed(code: ErrorCode, attempts: number, source: ArtworkSource): void {
    if (this.#failure === code) return;
    this.#options.onDiagnostic?.({kind: 'failure', code, attempts, source});
    this.#failure = code;
  }

  /** Bounds an operation independently of an injected facility and ends its signal at the deadline. */
  async #bounded<T>(ms: number, operation: (signal: AbortSignal) => Promise<ArtworkResult<T>>): Promise<ArtworkResult<T>> {
    const abort = new AbortController();
    const moduleSignal = this.#options.signal;
    if (moduleSignal.aborted) return artworkFailure('unavailable');
    let cancel = (): void => {};
    let stopped = (): void => {};
    const deadline = new Promise<ArtworkResult<T>>(resolve => {
      stopped = () => { abort.abort(); resolve(artworkFailure('unavailable')); };
      moduleSignal.addEventListener('abort', stopped, {once: true});
      cancel = this.#options.scheduler.after(ms, () => { abort.abort(); resolve(artworkFailure('unavailable', true)); });
    });
    try {
      const operationResult = Promise.resolve().then(() => operation(abort.signal)).catch((error: unknown) => {
        // Workers already classify their boundary. Only unavailable observations repeat; capacity,
        // uncertain results and internal faults keep their code and terminate this candidate.
        if (error instanceof SdkError) return artworkFailure(error.body.error.code, error.body.error.code === 'unavailable');
        return artworkFailure('internal');
      });
      return await Promise.race([operationResult, deadline]);
    } finally {
      cancel();
      moduleSignal.removeEventListener('abort', stopped);
    }
  }

  #start(): void {
    const candidate = this.#candidate;
    if (this.#running || this.#retry !== undefined || candidate === undefined || !this.#current(candidate) || candidate.exhausted === true || candidate.attempts >= 3) return;
    this.#running = true;
    candidate.attempts += 1;
    void this.#acquire(candidate).then(result => {
      if (!this.#current(candidate)) return;
      if (result.ok) {
        if (this.#failure !== undefined) {
          this.#options.onDiagnostic?.({kind: 'recovery', code: this.#failure, attempts: candidate.attempts, source: candidate.source});
          this.#failure = undefined;
        }
        // The candidate is acquired; it is not acquired again until a different one replaces it.
        this.#candidate = undefined;
        this.#holding = false;
        const held = this.#artwork;
        if (held?.status === 'ready' && held.mediaType === result.value.mediaType && held.width === result.value.width
          && held.height === result.value.height && held.base64 === result.value.base64) return;
        this.#artwork = {status: 'ready', generation: candidate.generation, ...result.value};
        this.#options.onChange();
      } else {
        const code: ErrorCode = result.code === 'unsupported' ? 'unsupported-capability' : result.code === 'invalid-response' ? 'invalid-state' : result.code;
        this.#failed(code, candidate.attempts, candidate.source);
        // The held image was not confirmed for the reference the receiver reports now, so it is withdrawn. Consumers hear
        // of it only after the retry bookkeeping, so one that re-enters update() clears this candidate's retry.
        const withdrawn = this.#holding;
        if (withdrawn) {
          this.#holding = false;
          this.#artwork = {status: 'missing', generation: candidate.generation};
        }
        if (code === 'unavailable' && result.transient && candidate.attempts < 3) {
          this.#options.onDiagnostic?.({kind: 'retry', code, attempts: candidate.attempts, source: candidate.source});
          this.#retry = this.#options.scheduler.after(candidate.attempts === 1 ? 2000 : 4000, () => {
            this.#retry = undefined;
            this.#start();
          });
        } else {
          candidate.exhausted = true;
          this.#options.onDiagnostic?.({kind: 'exhausted', code, attempts: candidate.attempts, source: candidate.source});
        }
        if (withdrawn) this.#options.onChange();
      }
    }).finally(() => {
      this.#running = false;
      this.#start();
    });
  }

  async #acquire(candidate: Candidate): Promise<ArtworkResult<ArtworkThumbnail>> {
    const fetched = await this.#bounded(ARTWORK_FETCH_MS, signal => this.#fetch(candidate.url, candidate.endpoint, signal, candidate.source));
    if (!fetched.ok) return fetched;
    if (!this.#current(candidate)) return artworkFailure('unavailable');
    return this.#bounded(ARTWORK_DECODE_MS, signal => this.#options.decode(fetched.value, signal));
  }
}
