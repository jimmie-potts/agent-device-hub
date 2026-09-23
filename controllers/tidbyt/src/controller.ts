import { randomUUID } from 'node:crypto';
import {
  admit, evaluate, validate,
  type AdmissionState, type Clock, type FailureCode, type Receipt, type Request, type Snapshot, type Ticket,
} from '@jimmie-potts/device-contracts';
import type { ConnectionCapabilities, DisplayConnection, PushOutcome } from './connection.js';
import { decodeFrameData, renderFrame, FRAME_HEIGHT, FRAME_WIDTH, type FrameData } from './render.js';

export const DISPLAY_PROFILE = Object.freeze({ profileId: 'tidbyt-display', profileVersion: '1.1.0' });
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RECEIPTS = 256;

/** A controller v1 request envelope carrying a Tidbyt profile command: show a frame or remove the installation. */
export type DisplayRequest = Omit<Request, 'command'> & {
  command: { kind: 'tidbyt.display'; frame: FrameData } | { kind: 'tidbyt.remove' };
};

export type Submission =
  | { decision: FailureCode; reserved: false }
  | { decision: 'queued' | 'replay' | 'join' | FailureCode; reserved: boolean; receipt: Receipt; done: Promise<Receipt> };

type Known<T> = { status: 'unknown' } | ({ status: 'known' } & T);
export type TidbytSnapshot = {
  apiVersion: '1.0';
  profile: typeof DISPLAY_PROFILE;
  controller: Snapshot;
  display: {
    frame: { width: 64; height: 32; format: 'webp-lossless' };
    connection: ConnectionCapabilities;
    pending: { requestId: Ticket; generation: Ticket }[];
    holds: { authentication: boolean; rateLimitRemainingMs: number };
    /** Cloud installation listing only. It is not evidence that the display shows the frame. */
    installation: Known<{ present: boolean; clock: Clock; evidenceAgeMs: number }>;
    /** No backend reports what the display shows; physical acceptance is separate evidence. */
    visible: { status: 'unknown' };
  };
};

export type TidbytControllerOptions = {
  controllerId: string;
  deviceId: string;
  sourceId: string;
  /** Optional user-chosen label, never copied from content. */
  label?: string;
  connection: DisplayConnection;
  /** Controller epoch for request, generation, cursor and clock identities. */
  epoch?: string;
  /** Monotonic milliseconds. */
  now?: () => number;
  maxPending?: number;
};

type Entry = {
  request: DisplayRequest;
  receipt: Receipt;
  generation: Ticket;
  /** The rendered image for a push; absent for a removal. */
  webp?: Uint8Array;
  resolve: (receipt: Receipt) => void;
  done: Promise<Receipt>;
};

const PUSH = 'push';
const REMOVE = 'remove';
const operation = (entry: Entry) => entry.webp ? PUSH : REMOVE;
const sameTicket = (a: Ticket, b: Ticket) => a.epoch === b.epoch && a.sequence === b.sequence;
const clone = <T>(value: T): T => structuredClone(value);

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

// Object key order is immaterial; arrays keep order. Mirrors the contract's replay comparison.
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  if (!plain(a) || !plain(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
}

function displayRequest(value: unknown): value is DisplayRequest {
  if (!plain(value) || !exactKeys(value, ['apiVersion', 'controllerId', 'deviceId', 'requestId',
    'expectedConfigurationRevision', 'expectedGeneration', 'command'])) return false;
  const command = value.command;
  return value.apiVersion === '1.0' && validate('id', value.controllerId) && validate('id', value.deviceId)
    && validate('ticket', value.requestId) && validate('counter', value.expectedConfigurationRevision)
    && validate('ticket', value.expectedGeneration) && plain(command)
    && ((command.kind === 'tidbyt.display' && exactKeys(command, ['kind', 'frame']))
      || (command.kind === 'tidbyt.remove' && exactKeys(command, ['kind'])));
}

function bodyBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  });
}

/**
 * The single serialized writer for one Tidbyt. Every display write goes through
 * this queue; controller v1 identity, revision and generation rules apply.
 */
export class TidbytController {
  readonly #identity: Snapshot['identity'];
  readonly #epoch: string;
  readonly #now: () => number;
  readonly #maxPending: number;
  #connection: DisplayConnection;
  #nextSequence = 0;
  #configurationRevision = 0;
  #generation: Ticket;
  #cursor = 0;
  #cache: { request: unknown; receipt: Receipt }[] = [];
  #active: Entry[] = [];
  #inFlight?: { entry: Entry; abort: AbortController };
  #draining = false;
  #closed = false;
  /** The failure that set the hold; later writes fail with the same code. */
  #authenticationHold?: 'unauthenticated' | 'forbidden';
  #rateLimitUntil?: number;
  #holdAbort = new AbortController();
  #health: Snapshot['serviceHealth'] = 'unknown';
  #lastSuccessfulSend: Snapshot['state']['lastSuccessfulSend'] = { status: 'unknown' };
  #lastOutcome: Snapshot['state']['lastOutcome'] = { status: 'unknown' };
  #installation?: { present: boolean; sampledAtMs: number };

  constructor(options: TidbytControllerOptions) {
    const epoch = options.epoch ?? randomUUID();
    const maxPending = options.maxPending ?? 8;
    if (!validate('id', options.controllerId) || !validate('id', options.deviceId) || !validate('id', options.sourceId)
        || !validate('id', epoch) || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 32
        || (options.label !== undefined && (typeof options.label !== 'string' || [...options.label].length > 80))
        || !options.connection) {
      throw new Error('invalid-tidbyt-controller-options');
    }
    this.#identity = {
      deviceId: options.deviceId, controllerId: options.controllerId, sourceId: options.sourceId, controllerEpoch: epoch,
      ...(options.label === undefined ? {} : { label: options.label }),
    };
    this.#epoch = epoch;
    this.#generation = { epoch, sequence: 0 };
    this.#now = options.now ?? (() => performance.now());
    this.#maxPending = maxPending;
    this.#connection = options.connection;
  }

  #clock(): Clock {
    return { domain: 'controller-monotonic', epoch: this.#epoch, sampledAtMs: Math.max(0, this.#now()) };
  }

  #changed(): void { this.#cursor = Math.min(this.#cursor + 1, Number.MAX_SAFE_INTEGER); }

  #retain(request: unknown, receipt: Receipt): void {
    this.#cache.push({ request: clone(request), receipt: clone(receipt) });
    if (this.#cache.length > MAX_RECEIPTS) this.#cache.splice(0, this.#cache.length - MAX_RECEIPTS);
    this.#lastOutcome = { status: 'known', receipt: clone(receipt) };
    this.#changed();
  }

  /** Admit a display request or controller v1 request. Only this method creates writes. */
  submit(value: unknown): Submission {
    if (validate('request', value)) return this.#admitV1(value as Request);
    if (!displayRequest(value)) return { decision: 'invalid-request', reserved: false };
    const frame = value.command.kind === 'tidbyt.display' ? decodeFrameData(value.command.frame) : undefined;
    if (frame && !frame.ok) return { decision: 'invalid-request', reserved: false };
    const r = value;
    if (r.controllerId !== this.#identity.controllerId || r.deviceId !== this.#identity.deviceId) {
      return { decision: 'unknown-device', reserved: false };
    }
    if (bodyBytes(r) > MAX_BODY_BYTES) return { decision: 'capacity', reserved: false };
    if (r.requestId.epoch !== this.#epoch) return { decision: 'request-expired', reserved: false };
    const cached = this.#cache.find(entry => sameTicket((entry.request as Request).requestId, r.requestId));
    if (cached) {
      if (!sameJson(cached.request, r)) return { decision: 'request-conflict', reserved: false };
      return { decision: 'replay', reserved: false, receipt: clone(cached.receipt), done: Promise.resolve(clone(cached.receipt)) };
    }
    const pending = this.#active.find(entry => sameTicket(entry.request.requestId, r.requestId));
    if (pending) {
      if (!sameJson(pending.request, r)) return { decision: 'request-conflict', reserved: false };
      return { decision: 'join', reserved: false, receipt: clone(pending.receipt), done: pending.done.then(clone) };
    }
    if (r.requestId.sequence < this.#nextSequence) return { decision: 'request-expired', reserved: false };
    if (r.requestId.sequence > this.#nextSequence) return { decision: 'request-order', reserved: false };
    if (this.#closed || this.#active.length >= this.#maxPending || this.#nextSequence >= Number.MAX_SAFE_INTEGER
        || this.#configurationRevision >= Number.MAX_SAFE_INTEGER) {
      return { decision: 'capacity', reserved: false };
    }
    let failure: FailureCode | undefined;
    if (r.expectedConfigurationRevision !== this.#configurationRevision) failure = 'revision-conflict';
    else if (!sameTicket(r.expectedGeneration, this.#generation)) failure = 'stale-generation';
    this.#nextSequence += 1;
    if (!failure) this.#configurationRevision += 1;
    const receipt: Receipt = {
      apiVersion: '1.0', controllerId: r.controllerId, deviceId: r.deviceId, requestId: clone(r.requestId),
      configurationRevision: this.#configurationRevision, generation: clone(this.#generation),
      outcome: failure ? 'failed' : 'queued', priorEffects: 'none', completedOperations: [], uncertainOperations: [],
      ...(failure ? { failure: { code: failure } } : {}),
    };
    if (failure) {
      this.#retain(r, receipt);
      return { decision: failure, reserved: true, receipt: clone(receipt), done: Promise.resolve(clone(receipt)) };
    }
    const rendered = frame ? renderFrame(frame.frame) : undefined;
    if (rendered && !rendered.ok) throw new Error('validated frame failed to render');
    let resolve!: (receipt: Receipt) => void;
    const done = new Promise<Receipt>(settle => { resolve = settle; });
    this.#active.push({ request: clone(r), receipt, generation: clone(this.#generation), webp: rendered?.webp, resolve, done });
    this.#changed();
    void this.#drain();
    return { decision: 'queued', reserved: true, receipt: clone(receipt), done: done.then(clone) };
  }

  /** Controller v1 commands use the contract's own admission; this device supports none of them. */
  #admitV1(r: Request): Submission {
    const state: AdmissionState = {
      controllerId: this.#identity.controllerId, deviceId: this.#identity.deviceId, epoch: this.#epoch,
      nextSequence: this.#nextSequence, configurationRevision: this.#configurationRevision, generation: clone(this.#generation),
      capabilities: this.#capabilities(), maxBodyBytes: MAX_BODY_BYTES, maxInFlight: this.#maxPending, maxQueue: this.#maxPending,
      maxReceipts: MAX_RECEIPTS, inFlight: this.#active.length, queueDepth: this.#closed ? this.#maxPending : this.#active.length,
      cache: this.#cache as AdmissionState['cache'], pending: this.#active as unknown as AdmissionState['pending'],
    };
    // In-process callers are trusted; a future network surface must authenticate before admission.
    const auth = {
      credential: { kind: 'machine' as const, status: 'active' as const, declared: true, devices: [r.deviceId], scopes: ['control' as const] },
      deviceId: r.deviceId, scope: 'control' as const, hostAllowed: true, originPresent: false, originAllowed: false, fetchMetadataAllowed: true,
    };
    const result = admit({ state, auth, request: r, bodyBytes: bodyBytes(r) });
    if (result.decision === 'replay' && result.receipt) {
      return { decision: 'replay', reserved: false, receipt: result.receipt, done: Promise.resolve(clone(result.receipt)) };
    }
    if (!result.reserved || !result.receipt || result.decision === 'queued' || result.decision === 'join' || result.decision === 'replay') {
      return { decision: result.decision as FailureCode, reserved: false };
    }
    this.#nextSequence = result.nextSequence;
    this.#configurationRevision = result.receipt.configurationRevision;
    this.#retain(r, result.receipt);
    return { decision: result.decision, reserved: true, receipt: clone(result.receipt), done: Promise.resolve(clone(result.receipt)) };
  }

  #finish(entry: Entry, outcome: Receipt['outcome'], priorEffects: Receipt['priorEffects'], failure?: FailureCode): void {
    const receipt: Receipt = {
      ...clone(entry.receipt), outcome, priorEffects,
      completedOperations: outcome === 'sent' ? [operation(entry)] : [],
      uncertainOperations: outcome === 'uncertain' ? [operation(entry)] : [],
    };
    delete receipt.failure;
    if (failure) receipt.failure = { code: failure };
    this.#active = this.#active.filter(item => item !== entry);
    this.#retain(entry.request, receipt);
    entry.resolve(receipt);
  }

  /** `current` is false for a result from a connection that `reconfigure` has replaced. */
  #apply(entry: Entry, result: PushOutcome, current: boolean): void {
    if (result.outcome === 'sent') {
      if (current) this.#health = 'ready';
      this.#lastSuccessfulSend = { status: 'known', requestId: clone(entry.request.requestId), clock: this.#clock(), operationIds: [operation(entry)] };
      return this.#finish(entry, 'sent', 'confirmed-transmission');
    }
    if (result.outcome === 'uncertain') {
      if (current) this.#health = 'degraded';
      return this.#finish(entry, 'uncertain', 'possible', 'uncertain-result');
    }
    // A replaced connection's holds and health must not block its replacement.
    if (!current) return this.#finish(entry, 'failed', 'none', result.failure);
    if (result.failure === 'unauthenticated' || result.failure === 'forbidden') {
      this.#authenticationHold = result.failure;
      this.#health = 'unavailable';
    } else if (result.failure === 'capacity') {
      this.#rateLimitUntil = this.#now() + result.retryAfterMs;
      this.#health = 'degraded';
    } else {
      this.#health = result.failure === 'invalid-request' ? 'degraded' : 'unavailable';
    }
    this.#finish(entry, 'failed', 'none', result.failure);
  }

  #complete(entry: Entry, result: PushOutcome, connection: DisplayConnection): void {
    this.#apply(entry, result, connection === this.#connection);
    if (this.#closed) this.#health = 'unavailable';
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#active.length && !this.#closed) {
        if (this.#rateLimitUntil !== undefined) {
          await sleep(Math.max(0, this.#rateLimitUntil - this.#now()), this.#holdAbort.signal);
          this.#rateLimitUntil = undefined;
          this.#changed();
          continue;
        }
        const entry = this.#active[0];
        // Check the generation immediately before each side effect, using the contract reference.
        const decision = evaluate({ operation: 'dequeue', expectedGeneration: entry.generation,
          currentGeneration: this.#generation, priorEffects: 'none' }) as { decision: string };
        if (decision.decision !== 'send-permitted') { this.#finish(entry, 'cancelled', 'none', 'stale-generation'); continue; }
        if (this.#authenticationHold) { this.#finish(entry, 'failed', 'none', this.#authenticationHold); continue; }
        const abort = new AbortController();
        const connection = this.#connection;
        this.#inFlight = { entry, abort };
        let result: PushOutcome;
        try {
          result = await (entry.webp ? connection.push(entry.webp, abort.signal) : connection.remove(abort.signal));
        } catch {
          result = { outcome: 'uncertain' };
        } finally {
          this.#inFlight = undefined;
        }
        this.#complete(entry, result, connection);
      }
    } finally {
      this.#draining = false;
    }
  }

  /** Retire every queued write. A write already in flight completes and reports its own result. */
  cancelPending(): void {
    if (this.#generation.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('generation-exhausted');
    this.#generation = { epoch: this.#epoch, sequence: this.#generation.sequence + 1 };
    for (const entry of [...this.#active]) {
      if (entry === this.#inFlight?.entry) continue;
      this.#finish(entry, 'cancelled', 'none', 'stale-generation');
    }
    this.#changed();
  }

  #releaseHold(): void {
    this.#rateLimitUntil = undefined;
    this.#holdAbort.abort();
    this.#holdAbort = new AbortController();
  }

  /** Operator replacement of credentials or backend configuration. It never resends earlier work. */
  reconfigure(connection: DisplayConnection): void {
    if (this.#closed) throw new Error('controller-closed');
    if (this.#configurationRevision >= Number.MAX_SAFE_INTEGER) throw new Error('revision-exhausted');
    this.#configurationRevision += 1;
    this.#connection = connection;
    this.#authenticationHold = undefined;
    this.#releaseHold();
    this.#health = 'unknown';
    this.#installation = undefined;
    this.cancelPending();
  }

  /** Read-only reconnect: refresh installation evidence and health. No command is resubmitted. */
  async refresh(): Promise<void> {
    if (this.#closed) return;
    const connection = this.#connection;
    let result;
    try {
      result = await connection.readInstallation(new AbortController().signal);
    } catch {
      result = { ok: false as const, failure: 'transport-failure' as const };
    }
    if (connection !== this.#connection || this.#closed) return;
    if (result.ok) {
      this.#installation = { present: result.present, sampledAtMs: this.#now() };
      // Writes stay refused under an authentication hold, so the service is not ready.
      this.#health = this.#authenticationHold ? 'unavailable' : 'ready';
    } else {
      if (result.failure === 'unauthenticated' || result.failure === 'forbidden') this.#authenticationHold = result.failure;
      this.#health = 'unavailable';
    }
    this.#changed();
  }

  /** Stop the controller: abort the in-flight write (reported uncertain) and cancel queued writes. */
  close(): void {
    if (this.#closed) return;
    this.#inFlight?.abort.abort();
    this.cancelPending();
    this.#releaseHold();
    this.#closed = true;
    this.#health = 'unavailable';
    this.#changed();
  }

  #capabilities(): Snapshot['capabilities'] {
    return {
      power: { supported: false }, brightness: { supported: false }, media: { supported: false },
      zones: { supported: false }, scenes: { supported: false }, preview: { supported: false },
    };
  }

  snapshot(): TidbytSnapshot {
    const now = this.#now();
    const controller: Snapshot = {
      apiVersion: '1.0',
      identity: clone(this.#identity),
      configurationRevision: this.#configurationRevision,
      generation: clone(this.#generation),
      nextRequestId: { epoch: this.#epoch, sequence: this.#nextSequence },
      cursor: { epoch: this.#epoch, sequence: this.#cursor },
      sampleClock: this.#clock(),
      serviceHealth: this.#health,
      capabilities: this.#capabilities(),
      // The in-process library serves no feed, stream or authentication; those carry the schema minimum.
      limits: { maxPending: this.#maxPending, maxBodyBytes: MAX_BODY_BYTES, maxInFlight: this.#maxPending,
        maxReceipts: MAX_RECEIPTS, maxEvents: 1, maxStreams: 1, authenticationTimeoutMs: 1 },
      state: {
        desired: { power: { status: 'unknown' }, brightness: { status: 'unknown' }, mode: { status: 'unknown' } },
        pending: [],
        lastSuccessfulSend: clone(this.#lastSuccessfulSend),
        lastOutcome: clone(this.#lastOutcome),
        externalControl: { status: 'unknown' },
        observation: { status: 'unknown' },
      },
    };
    const installation = this.#installation;
    return {
      apiVersion: '1.0',
      profile: DISPLAY_PROFILE,
      controller,
      display: {
        frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT, format: 'webp-lossless' },
        connection: clone(this.#connection.capabilities),
        pending: this.#active.map(entry => ({ requestId: clone(entry.request.requestId), generation: clone(entry.generation) })),
        holds: {
          authentication: this.#authenticationHold !== undefined,
          rateLimitRemainingMs: this.#rateLimitUntil === undefined ? 0 : Math.max(0, this.#rateLimitUntil - now),
        },
        installation: installation ? {
          status: 'known', present: installation.present,
          clock: { domain: 'controller-monotonic', epoch: this.#epoch, sampledAtMs: Math.max(0, installation.sampledAtMs) },
          evidenceAgeMs: Math.max(0, now - installation.sampledAtMs),
        } : { status: 'unknown' },
        visible: { status: 'unknown' },
      },
    };
  }
}
