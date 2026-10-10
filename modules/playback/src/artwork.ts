/** One current image and one admitted chain. Image completion never reports metadata evidence. */
import {randomUUID} from 'node:crypto';
import type {PlaybackArtwork} from '@jimmie-potts/event-contracts/v2/families';
import {SdkError, type Scheduler} from '@jimmie-potts/sdk';
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {ARTWORK_DECODE_MS, ARTWORK_FETCH_MS, artworkFailure, artworkUrl, createArtworkFetch, type ArtworkFetch, type ArtworkResult} from './artwork-fetch.js';
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
export type ArtworkDiagnostic = {kind: 'failure' | 'retry' | 'exhausted' | 'recovery'; code: ErrorCode; attempts: number};
type Candidate = {url: string; endpoint: string; generation: string; sequence: number; attempts: number; exhausted?: boolean};

export class ArtworkController {
  readonly #options: ArtworkControllerOptions;
  readonly #fetch: ArtworkFetch;
  #association: string | undefined;
  #artwork: PlaybackArtwork | undefined;
  #rawCandidate: string | undefined;
  #candidate: Candidate | undefined;
  #sequence = 0;
  #running = false;
  #retry: (() => void) | undefined;
  #failure: ErrorCode | undefined;

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
      this.#artwork = {status: view.kind === 'sony' ? 'missing' : 'unsupported', generation: (this.#options.generation ?? randomUUID)()};
    }
    if (view.kind !== 'sony' || this.#artwork === undefined) return;
    const raw = observation.thumbnailUrl;
    if (raw !== this.#rawCandidate) {
      this.#clear();
      this.#rawCandidate = raw;
      this.#artwork = {status: 'missing', generation: this.#artwork.generation};
      const url = artworkUrl(raw, view.endpoint);
      if (url !== undefined) this.#candidate = {url, endpoint: view.endpoint, generation: this.#artwork.generation, sequence: this.#sequence, attempts: 0};
      else if (raw !== undefined) this.#failed('unsupported-capability', 0);
    }
    this.#start();
  }

  #clear(): void {
    this.#sequence += 1;
    this.#candidate = undefined;
    this.#rawCandidate = undefined;
    this.#retry?.();
    this.#retry = undefined;
  }

  #current(candidate: Candidate): boolean {
    return !this.#options.signal.aborted && this.#candidate === candidate && candidate.sequence === this.#sequence && this.#artwork?.generation === candidate.generation;
  }

  #failed(code: ErrorCode, attempts: number): void {
    if (this.#failure === code) return;
    this.#options.onDiagnostic?.({kind: 'failure', code, attempts});
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
    if (this.#running || this.#retry !== undefined || candidate === undefined || !this.#current(candidate) || candidate.exhausted === true || candidate.attempts >= 3 || this.#artwork?.status === 'ready') return;
    this.#running = true;
    candidate.attempts += 1;
    void this.#acquire(candidate).then(result => {
      if (!this.#current(candidate)) return;
      if (result.ok) {
        if (this.#failure !== undefined) {
          this.#options.onDiagnostic?.({kind: 'recovery', code: this.#failure, attempts: candidate.attempts});
          this.#failure = undefined;
        }
        this.#artwork = {status: 'ready', generation: candidate.generation, ...result.value};
        this.#options.onChange();
      } else {
        const code: ErrorCode = result.code === 'unsupported' ? 'unsupported-capability' : result.code === 'invalid-response' ? 'invalid-state' : result.code;
        this.#failed(code, candidate.attempts);
        if (code === 'unavailable' && result.transient && candidate.attempts < 3) {
          this.#options.onDiagnostic?.({kind: 'retry', code, attempts: candidate.attempts});
          this.#retry = this.#options.scheduler.after(candidate.attempts === 1 ? 2000 : 4000, () => {
            this.#retry = undefined;
            this.#start();
          });
        } else {
          candidate.exhausted = true;
          this.#options.onDiagnostic?.({kind: 'exhausted', code, attempts: candidate.attempts});
        }
      }
    }).finally(() => {
      this.#running = false;
      this.#start();
    });
  }

  async #acquire(candidate: Candidate): Promise<ArtworkResult<ArtworkThumbnail>> {
    const fetched = await this.#bounded(ARTWORK_FETCH_MS, signal => this.#fetch(candidate.url, candidate.endpoint, signal));
    if (!fetched.ok) return fetched;
    if (!this.#current(candidate)) return artworkFailure('unavailable');
    return this.#bounded(ARTWORK_DECODE_MS, signal => this.#options.decode(fetched.value, signal));
  }
}
