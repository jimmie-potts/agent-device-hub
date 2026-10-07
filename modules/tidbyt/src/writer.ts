// The Tidbyt's one writer (Hub #930): a queue that sends one cloud call at a time, and a writer per tile that decides
// what that tile sends. Copied from `TidbytController`'s queue and holds in controllers/tidbyt/src/controller.ts and from
// `InstallationWriter` in controllers/tidbyt/src/publishing.ts at main 627e3fe3, and converted for the module:
// - The controller v1 envelope, its tickets, replays and conflicts are gone: only the module's own tiles write, and no
//   message carries a frame. The queue keeps the order, one call in flight, the authentication hold and the
//   rate-limit hold.
// - Every wait and deadline runs on the runtime's scheduler and ends at the module's stop.
// - A tile renders its frame only once its write is due, in a worker thread, and a tile can hold: write nothing while
//   what it shows is not known yet.
// - What a tile last sent, when, and whether its installation is present survive a restart in the module's database,
//   so a restart writes nothing while the tile stands, and the 15-second gate holds across it.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {SdkError, type Cancel, type ModuleScheduler} from '@jimmie-potts/sdk';
import type {ListResult, TidbytCloudConnection, WriteResult} from './cloud.js';
import type {TileRequest} from './tiles.js';

export type CallKind = 'push' | 'remove' | 'list';
/** A call that never went out: a hold refused it, or the module stopped first. */
export type NotSent = {outcome: 'held'; failure: 'unauthenticated' | 'forbidden'} | {outcome: 'cancelled'};
export type QueueOptions = {
  connection: TidbytCloudConnection;
  scheduler: ModuleScheduler;
  now: () => number;
  /** How long one call may take. */
  timeoutMs: number;
};

/**
 * The single serialized writer for one Tidbyt. Calls run in the order they were made, one at a time. A 401, a 403 or the
 * cloud's "no UID" 500 sets an authentication hold, and later calls end `held` without a request until the module starts
 * again and reads its key anew. A 429 holds later calls for its `Retry-After`. Closing it ends the call in flight and
 * every waiting one.
 */
export class CloudQueue {
  readonly #connection: TidbytCloudConnection;
  readonly #scheduler: ModuleScheduler;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #closing = new AbortController();
  #tail: Promise<unknown> = Promise.resolve();
  #authentication: 'unauthenticated' | 'forbidden' | undefined;
  #rateLimitedUntilMs: number | undefined;

  constructor({connection, scheduler, now, timeoutMs}: QueueOptions) {
    this.#connection = connection;
    this.#scheduler = scheduler;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
  }

  /** Whether a hold keeps calls from going out now. */
  held(): boolean {
    return this.#authentication !== undefined || (this.#rateLimitedUntilMs !== undefined && this.#rateLimitedUntilMs > this.#now());
  }

  get closed(): boolean {
    return this.#closing.signal.aborted;
  }

  /** Pushes a frame. `sending` hears the moment the request goes out, after any wait in the queue. */
  push(webp: Uint8Array, installation: string | undefined, sending?: () => void): Promise<WriteResult | NotSent> {
    return this.#enqueue(signal => this.#connection.push(webp, signal, installation), result => { this.#holdAfter(result); }, sending);
  }

  remove(installation: string | undefined, sending?: () => void): Promise<WriteResult | NotSent> {
    return this.#enqueue(signal => this.#connection.remove(signal, installation), result => { this.#holdAfter(result); }, sending);
  }

  /** Reads the installation list. It never resubmits a write. */
  list(installation: string | undefined, sending?: () => void): Promise<ListResult | NotSent> {
    return this.#enqueue(signal => this.#connection.list(signal, installation), result => {
      if (!result.ok && (result.failure === 'unauthenticated' || result.failure === 'forbidden')) this.#authentication = result.failure;
    }, sending);
  }

  /** Ends the call in flight, whose result is then uncertain, and every waiting call, which sends nothing. */
  close(): void {
    this.#closing.abort();
  }

  #holdAfter(result: WriteResult): void {
    if (result.outcome !== 'failed') return;
    if (result.failure === 'unauthenticated' || result.failure === 'forbidden') this.#authentication = result.failure;
    if (result.failure === 'capacity') this.#rateLimitedUntilMs = this.#now() + result.retryAfterMs;
  }

  #enqueue<T extends object>(send: (signal: AbortSignal) => Promise<T>, after: (result: T) => void, sending: (() => void) | undefined): Promise<T | NotSent> {
    const run = this.#tail.then(() => this.#attempt(send, after, sending));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #attempt<T extends object>(send: (signal: AbortSignal) => Promise<T>, after: (result: T) => void, sending: (() => void) | undefined): Promise<T | NotSent> {
    for (;;) {
      if (this.closed) return {outcome: 'cancelled'};
      if (this.#authentication !== undefined) return {outcome: 'held', failure: this.#authentication};
      const wait = (this.#rateLimitedUntilMs ?? 0) - this.#now();
      if (wait <= 0) break;
      await this.#sleep(wait);
    }
    this.#rateLimitedUntilMs = undefined;
    const deadline = new AbortController();
    const cancel = this.#after(this.#timeoutMs, () => { deadline.abort(); });
    sending?.();
    try {
      const result = await send(AbortSignal.any([deadline.signal, this.#closing.signal]));
      after(result);
      return result;
    } finally {
      cancel();
    }
  }

  /** Waits `ms` on the runtime's scheduler, or until the queue closes. */
  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const done = (): void => {
        cancel();
        this.#closing.signal.removeEventListener('abort', done);
        resolve();
      };
      const cancel = this.#after(ms, done);
      this.#closing.signal.addEventListener('abort', done, {once: true});
    });
  }

  /** A timer on the runtime's scheduler; once the module stops, the scheduler refuses one, and the queue is closed. */
  #after(ms: number, callback: () => void): Cancel {
    try {
      return this.#scheduler.after(Math.max(0, Math.ceil(ms)), callback);
    } catch {
      this.close();
      callback();
      return () => {};
    }
  }
}

/** What a tile should show: a frame, identified by its view, nothing, or nothing new until what it shows is known. */
export type TileTarget = {kind: 'show'; key: string; request: TileRequest} | {kind: 'remove'} | {kind: 'hold'};
/** What the module keeps of a tile across restarts. */
export type TileMemory = {key?: string; sentAtMs?: number; lastWriteAtMs?: number; presence: 'present' | 'absent' | 'unknown'};
/** One call a tile made, and how it ended, for the module's device record, records and spans. */
export type TileCall =
  | {call: 'push' | 'remove'; result: WriteResult | NotSent}
  | {call: 'list'; result: ListResult | NotSent}
  /** The frame could not be drawn in its worker thread, so nothing was sent. `code` is the worker call's registry code. */
  | {call: 'render'; failed: true; code: ErrorCode};

export type TileWriterOptions = {
  queue: CloudQueue;
  /** The tile's installation, or undefined for the connection's default one, which the status tile uses. */
  installation: string | undefined;
  /** Draws and encodes a frame in a worker thread. A rejection is a failed render, and nothing is sent. */
  render: (request: TileRequest) => Promise<Uint8Array>;
  /** Hears each call and render, with how it ended. */
  report: (call: TileCall) => void;
  /** Hears that a call is about to be made, and answers what to call once it ended, such as the end of its span. */
  begin: (call: CallKind) => (succeeded: boolean) => void;
  /** Hears what to keep across restarts, after each change. */
  remember: (memory: TileMemory) => void;
  /** Whether the module stops, so nothing new goes out. */
  stopped: () => boolean;
  minIntervalMs: number;
  refreshMs: number;
  pollMs: number;
  now: () => number;
  restored?: TileMemory;
};

/**
 * Keeps one installation showing the latest frame: a push on change, at most every `minIntervalMs`, an unchanged frame
 * pushed again after `refreshMs`, and a removal when there is nothing to show. A failed or uncertain write is never sent
 * again: a later write is a fresh one for the current state, after a wait that starts at `minIntervalMs` and doubles
 * with each further write not confirmed sent, up to `refreshMs`.
 */
export class TileWriter {
  readonly #options: TileWriterOptions;
  /** The last frame the cloud accepted, and when that push was made. */
  #sent: {key: string; atMs: number} | undefined;
  #lastWriteAtMs: number | undefined;
  /** Consecutive writes not confirmed sent; each after the first doubles the wait before the next. */
  #failures = 0;
  #presence: TileMemory['presence'] = 'unknown';

  constructor(options: TileWriterOptions) {
    this.#options = options;
    const {restored} = options;
    if (restored === undefined) return;
    if (restored.key !== undefined && restored.sentAtMs !== undefined) this.#sent = {key: restored.key, atMs: restored.sentAtMs};
    this.#lastWriteAtMs = restored.lastWriteAtMs;
    this.#presence = restored.presence;
  }

  get presence(): TileMemory['presence'] {
    return this.#presence;
  }

  /** Shows `target`, and answers how long to wait before the next evaluation. */
  async write(target: TileTarget): Promise<number> {
    const {queue, installation, render, stopped, refreshMs, pollMs, now: clock} = this.#options;
    if (stopped() || target.kind === 'hold') return pollMs;
    const now = clock();
    let call: 'push' | 'remove' | undefined;
    if (target.kind === 'show') {
      const sent = this.#sent;
      if (sent === undefined || sent.key !== target.key || now - sent.atMs >= refreshMs) call = 'push';
    } else if (this.#presence !== 'absent') {
      call = 'remove';
    }
    const refreshDue = this.#sent !== undefined && target.kind === 'show' ? Math.max(1, this.#sent.atMs + refreshMs - now) : pollMs;
    if (call === undefined) return Math.min(pollMs, refreshDue);
    const wait = this.#lastWriteAtMs === undefined ? 0 : this.#lastWriteAtMs + this.#backoffMs() - now;
    if (wait > 0) return wait;
    // The gate runs from the moment each request goes out, after a render and any wait in the queue, so two writes of
    // this tile reach the cloud at least `minIntervalMs` apart. It is set now too, so a stop before the send keeps it.
    this.#lastWriteAtMs = now;
    const sending = (): void => {
      this.#lastWriteAtMs = clock();
      this.#remember();
    };
    if (call === 'remove' && this.#presence === 'unknown' && !queue.held()) {
      // Read the installation list first, so an installation that is already gone is not deleted again.
      const end = this.#options.begin('list');
      const listing = await queue.list(installation, sending);
      end('ok' in listing && listing.ok);
      this.#options.report({call: 'list', result: listing});
      if ('ok' in listing && listing.ok && !listing.present) {
        this.#presence = 'absent';
        this.#failures = 0;
        this.#remember();
        return pollMs;
      }
    }
    if (stopped()) return pollMs;
    let result: WriteResult | NotSent;
    if (target.kind === 'show') {
      let webp: Uint8Array;
      try {
        webp = await render(target.request);
      } catch (error) {
        if (stopped()) return pollMs;
        // A failed render sent nothing and is no evidence about the device; it counts as a write not confirmed sent.
        this.#failures += 1;
        this.#options.report({call: 'render', failed: true, code: error instanceof SdkError ? error.body.error.code : 'internal'});
        return this.#backoffMs();
      }
      // The render was a wait: nothing goes out once the module stops.
      if (stopped()) return pollMs;
      const end = this.#options.begin('push');
      result = await queue.push(webp, installation, sending);
      end(result.outcome === 'sent');
      this.#options.report({call: 'push', result});
      this.#record('push', result, target.key, this.#lastWriteAtMs);
    } else {
      const end = this.#options.begin('remove');
      result = await queue.remove(installation, sending);
      end(result.outcome === 'sent');
      this.#options.report({call: 'remove', result});
      this.#record('remove', result, undefined, this.#lastWriteAtMs);
    }
    return result.outcome === 'sent' ? Math.min(pollMs, refreshDue) : this.#backoffMs();
  }

  /** The minimum interval, doubled for each consecutive write not confirmed sent after the first, up to the refresh period. */
  #backoffMs(): number {
    const {minIntervalMs, refreshMs} = this.#options;
    const doublings = Math.min(Math.max(0, this.#failures - 1), 16);
    return Math.min(minIntervalMs * 2 ** doublings, Math.max(minIntervalMs, refreshMs));
  }

  #record(call: 'push' | 'remove', result: WriteResult | NotSent, key: string | undefined, atMs: number): void {
    switch (result.outcome) {
      case 'sent':
        this.#failures = 0;
        if (call === 'push' && key !== undefined) {
          this.#sent = {key, atMs};
          this.#presence = 'present';
        } else {
          this.#sent = undefined;
          this.#presence = 'absent';
        }
        break;
      case 'uncertain':
        // The write may have taken effect, so neither the frame nor the installation's presence is known.
        this.#failures += 1;
        this.#sent = undefined;
        this.#presence = 'unknown';
        break;
      case 'failed':
      case 'held':
        this.#failures += 1;
        // The installation may already be gone; the next removal reads the list before deleting again.
        if (call === 'remove') this.#presence = 'unknown';
        break;
      case 'cancelled':
        return;
    }
    this.#remember();
  }

  #remember(): void {
    this.#options.remember({
      ...(this.#sent === undefined ? {} : {key: this.#sent.key, sentAtMs: this.#sent.atMs}),
      ...(this.#lastWriteAtMs === undefined ? {} : {lastWriteAtMs: this.#lastWriteAtMs}),
      presence: this.#presence,
    });
  }
}
