import { validateSnapshot, type Snapshot } from '@jimmie-potts/agent-state';
import type { Receipt } from '@jimmie-potts/device-contracts';
import type { DisplayRequest, TidbytController } from './controller.js';
import { FRAME_ENCODING } from './render.js';
import { statusFrame, statusView, type StatusView } from './status.js';

/**
 * The selected shared agent-state owner's feed. `snapshot()` returns its current
 * calculated state; `subscribe()` yields revision pointers or resync notices.
 */
export type StatusFeed = {
  /**
   * Must settle within a bounded time. A read that outlives the publisher's timeout
   * blocks further reads until it settles, so an adapter must enforce its own deadline.
   */
  snapshot(): Snapshot | Promise<Snapshot>;
  subscribe?(): AsyncIterable<unknown> & { close?(): void };
};

export type StatusTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type StatusPublisherOptions = {
  feed: StatusFeed;
  /** The designated writer for this Tidbyt. The publisher submits nothing elsewhere. */
  controller: TidbytController;
  acknowledgingConsumers?: readonly string[];
  /** Minimum time between writes. Default 15 s. */
  minIntervalMs?: number;
  /** Push an unchanged frame again after this long. Default 10 minutes. */
  refreshMs?: number;
  /** Re-read the feed this often without a change notice. Default 30 s. */
  pollMs?: number;
  /** A feed read slower than this counts as unavailable. Default 3 s. */
  feedTimeoutMs?: number;
  /** Monotonic milliseconds. */
  now?: () => number;
  timers?: StatusTimers;
};

export type InstallationState = 'present' | 'absent' | 'unknown';
export type StatusPublisherState = { installation: InstallationState; view?: StatusView; lastWrite?: Receipt };

const TIMEOUT = Symbol('timeout');

/**
 * Publishes shared agent status to one Tidbyt through its controller queue:
 * push on change at most every `minIntervalMs`, refresh every `refreshMs`, and
 * remove the installation when a healthy feed shows nothing to display.
 */
export class TidbytStatusPublisher {
  readonly #feed: StatusFeed;
  readonly #controller: TidbytController;
  readonly #consumers?: readonly string[];
  readonly #minIntervalMs: number;
  readonly #refreshMs: number;
  readonly #pollMs: number;
  readonly #feedTimeoutMs: number;
  readonly #now: () => number;
  readonly #timers: StatusTimers;
  #started = false;
  #stopped = false;
  #requested = false;
  #running?: Promise<void>;
  #timer?: unknown;
  #subscription?: AsyncIterable<unknown> & { close?(): void };
  /** The last snapshot that validated, kept for display while the feed is unavailable. */
  #lastGood?: Snapshot;
  #view?: StatusView;
  /** The last frame the cloud accepted, and when that push was submitted. */
  #sent?: { rgb: Uint8Array; atMs: number };
  #lastWriteAtMs?: number;
  #lastWrite?: Receipt;
  /** Consecutive writes not confirmed sent; each after the first doubles the wait before the next. */
  #failures = 0;
  /** A feed read that outlived its timeout. No new read starts until it settles. */
  #pendingRead?: Promise<unknown>;
  #installation: InstallationState = 'unknown';

  constructor(options: StatusPublisherOptions) {
    const minIntervalMs = options.minIntervalMs ?? 15_000;
    const refreshMs = options.refreshMs ?? 600_000;
    const pollMs = options.pollMs ?? 30_000;
    const feedTimeoutMs = options.feedTimeoutMs ?? 3_000;
    const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
    if (!options.feed || typeof options.feed.snapshot !== 'function' || !options.controller
        || ![minIntervalMs, refreshMs, pollMs, feedTimeoutMs].every(positive)
        || (options.acknowledgingConsumers !== undefined && !Array.isArray(options.acknowledgingConsumers))) {
      throw new Error('invalid-status-publisher-options');
    }
    this.#feed = options.feed;
    this.#controller = options.controller;
    this.#consumers = options.acknowledgingConsumers ? [...options.acknowledgingConsumers] : undefined;
    this.#minIntervalMs = minIntervalMs;
    this.#refreshMs = refreshMs;
    this.#pollMs = pollMs;
    this.#feedTimeoutMs = feedTimeoutMs;
    this.#now = options.now ?? (() => performance.now());
    this.#timers = options.timers ?? { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout) };
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    void this.update();
  }

  /** Stop publishing. A write already admitted to the controller reports its own result. */
  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#subscription?.close?.();
    this.#subscription = undefined;
  }

  /** Request an evaluation. Requests made while one runs coalesce into a single rerun. */
  update(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#requested = true;
    this.#running ??= this.#loop().finally(() => { this.#running = undefined; });
    return this.#running;
  }

  /** Resolves once no evaluation is running. */
  whenIdle(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  state(): StatusPublisherState {
    return structuredClone({
      installation: this.#installation,
      ...(this.#view ? { view: this.#view } : {}),
      ...(this.#lastWrite ? { lastWrite: this.#lastWrite } : {}),
    });
  }

  async #loop(): Promise<void> {
    while (this.#requested && !this.#stopped) {
      this.#requested = false;
      this.#subscribe();
      const wakeMs = await this.#evaluate();
      if (this.#stopped) return;
      if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
      this.#timer = this.#timers.setTimeout(() => { this.#timer = undefined; void this.update(); }, wakeMs);
    }
  }

  #subscribe(): void {
    if (this.#subscription || !this.#feed.subscribe) return;
    let subscription: AsyncIterable<unknown> & { close?(): void };
    try {
      subscription = this.#feed.subscribe();
    } catch {
      return;
    }
    this.#subscription = subscription;
    void (async () => {
      try {
        for await (const _ of subscription) {
          if (this.#stopped) break;
          void this.update();
        }
      } catch {
        // The next evaluation resubscribes; the poll keeps reading meanwhile.
      }
      if (this.#subscription === subscription) this.#subscription = undefined;
    })();
  }

  async #read(): Promise<Snapshot | undefined> {
    if (this.#pendingRead) return undefined;
    let timer: unknown;
    try {
      const timeout = new Promise<typeof TIMEOUT>(resolve => { timer = this.#timers.setTimeout(() => resolve(TIMEOUT), this.#feedTimeoutMs); });
      const read = Promise.resolve().then(() => this.#feed.snapshot());
      const value = await Promise.race([read, timeout]);
      if (value === TIMEOUT) {
        const pending: Promise<unknown> = read.catch(() => undefined).finally(() => {
          if (this.#pendingRead === pending) this.#pendingRead = undefined;
        });
        this.#pendingRead = pending;
        return undefined;
      }
      const valid = validateSnapshot(value);
      return valid.ok ? valid.value : undefined;
    } catch {
      return undefined;
    } finally {
      this.#timers.clearTimeout(timer);
    }
  }

  /** One evaluation. Returns the delay before the next scheduled evaluation. */
  async #evaluate(): Promise<number> {
    const current = await this.#read();
    if (current) this.#lastGood = current;
    const view = statusView(current ?? this.#lastGood, { feedAvailable: current !== undefined, acknowledgingConsumers: this.#consumers });
    this.#view = view;
    const now = this.#now();
    let command: DisplayRequest['command'] | undefined;
    let rgb: Uint8Array | undefined;
    if (!view.idle) {
      rgb = statusFrame(view).rgb;
      const unchanged = this.#sent !== undefined && Buffer.from(this.#sent.rgb).equals(rgb);
      if (!unchanged || now - this.#sent!.atMs >= this.#refreshMs) {
        command = { kind: 'tidbyt.display', frame: { width: 64, height: 32, encoding: FRAME_ENCODING, data: Buffer.from(rgb).toString('base64') } };
      }
    } else if (this.#installation !== 'absent') {
      command = { kind: 'tidbyt.remove' };
    }
    const refreshDue = this.#sent && !view.idle ? Math.max(1, this.#sent.atMs + this.#refreshMs - now) : this.#pollMs;
    if (!command) return Math.min(this.#pollMs, refreshDue);
    const wait = this.#lastWriteAtMs === undefined ? 0 : this.#lastWriteAtMs + this.#backoffMs() - now;
    if (wait > 0) return wait;
    this.#lastWriteAtMs = now;
    const holds = this.#controller.snapshot().display.holds;
    if (command.kind === 'tidbyt.remove' && this.#installation === 'unknown' && !holds.authentication && holds.rateLimitRemainingMs === 0) {
      // Read the installation list first, so an installation that is already gone is not deleted again.
      const listing = await this.#controller.refresh();
      if (listing?.ok && !listing.present) {
        this.#installation = 'absent';
        this.#failures = 0;
        return this.#pollMs;
      }
    }
    const receipt = await this.#submit(command);
    if (receipt) this.#record(command, receipt, rgb, now);
    else this.#failures += 1;
    return receipt?.outcome === 'sent' ? Math.min(this.#pollMs, refreshDue) : this.#backoffMs();
  }

  /** The minimum interval, doubled for each consecutive write not confirmed sent after the first, up to the refresh period. */
  #backoffMs(): number {
    const doublings = Math.min(Math.max(0, this.#failures - 1), 16);
    return Math.min(this.#minIntervalMs * 2 ** doublings, Math.max(this.#minIntervalMs, this.#refreshMs));
  }

  /** Submit a fresh request built from the controller's current identities. Never resubmits an earlier one. */
  async #submit(command: DisplayRequest['command']): Promise<Receipt | undefined> {
    const snapshot = this.#controller.snapshot().controller;
    const request: DisplayRequest = {
      apiVersion: '1.0', controllerId: snapshot.identity.controllerId, deviceId: snapshot.identity.deviceId,
      requestId: snapshot.nextRequestId, expectedConfigurationRevision: snapshot.configurationRevision,
      expectedGeneration: snapshot.generation, command,
    };
    const submission = this.#controller.submit(request);
    return 'done' in submission ? submission.done : undefined;
  }

  #record(command: DisplayRequest['command'], receipt: Receipt, rgb: Uint8Array | undefined, atMs: number): void {
    this.#lastWrite = receipt;
    this.#failures = receipt.outcome === 'sent' ? 0 : this.#failures + 1;
    if (receipt.outcome === 'sent') {
      if (command.kind === 'tidbyt.display') {
        this.#sent = { rgb: rgb!, atMs };
        this.#installation = 'present';
      } else {
        this.#sent = undefined;
        this.#installation = 'absent';
      }
    } else if (receipt.outcome === 'uncertain') {
      this.#sent = undefined;
      this.#installation = 'unknown';
    } else if (command.kind === 'tidbyt.remove') {
      // The installation may already be gone; the next attempt reads the list before deleting again.
      this.#installation = 'unknown';
    }
  }
}
