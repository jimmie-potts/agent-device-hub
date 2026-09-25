import type { Receipt } from '@jimmie-potts/device-contracts';
import type { DisplayRequest, TidbytController } from './controller.js';
import { FRAME_ENCODING } from './render.js';

/**
 * Shared machinery for publishers that keep one Tidbyt installation current:
 * an evaluation loop, a bounded feed read and the installation's write policy.
 */
export type PublisherTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const systemTimers: PublisherTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

/** Runs one evaluation at a time; requests made while one runs coalesce into a single rerun. */
export class EvaluationLoop {
  readonly #evaluate: () => Promise<number>;
  readonly #timers: PublisherTimers;
  #stopped = false;
  #requested = false;
  #running?: Promise<void>;
  #timer?: unknown;

  /** `evaluate` returns the delay before the next scheduled evaluation. */
  constructor(evaluate: () => Promise<number>, timers: PublisherTimers) {
    this.#evaluate = evaluate;
    this.#timers = timers;
  }

  get stopped(): boolean { return this.#stopped; }

  update(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#requested = true;
    this.#running ??= this.#loop().finally(() => { this.#running = undefined; });
    return this.#running;
  }

  whenIdle(): Promise<void> {
    return this.#running ?? Promise.resolve();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #loop(): Promise<void> {
    while (this.#requested && !this.#stopped) {
      this.#requested = false;
      const wakeMs = await this.#evaluate();
      if (this.#stopped) return;
      if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
      this.#timer = this.#timers.setTimeout(() => { this.#timer = undefined; void this.update(); }, wakeMs);
    }
  }
}

const TIMEOUT = Symbol('timeout');

/**
 * A feed read bounded by a timeout. A read that outlives it counts as failed and
 * blocks further reads until it settles, so a hung feed never piles up requests.
 */
export class BoundedReader<T> {
  readonly #read: () => T | Promise<T>;
  readonly #timeoutMs: number;
  readonly #timers: PublisherTimers;
  #pending?: Promise<unknown>;

  constructor(read: () => T | Promise<T>, timeoutMs: number, timers: PublisherTimers) {
    this.#read = read;
    this.#timeoutMs = timeoutMs;
    this.#timers = timers;
  }

  /** The read's value, or undefined when it threw, timed out or an earlier read is still hung. */
  async read(): Promise<T | undefined> {
    if (this.#pending) return undefined;
    let timer: unknown;
    try {
      const timeout = new Promise<typeof TIMEOUT>(resolve => { timer = this.#timers.setTimeout(() => resolve(TIMEOUT), this.#timeoutMs); });
      const read = Promise.resolve().then(() => this.#read());
      const value = await Promise.race([read, timeout]);
      if (value === TIMEOUT) {
        const pending: Promise<unknown> = read.catch(() => undefined).finally(() => {
          if (this.#pending === pending) this.#pending = undefined;
        });
        this.#pending = pending;
        return undefined;
      }
      return value;
    } catch {
      return undefined;
    } finally {
      this.#timers.clearTimeout(timer);
    }
  }
}

export type InstallationState = 'present' | 'absent' | 'unknown';

export type InstallationWriterOptions = {
  /** The designated writer for this Tidbyt. The writer submits nothing elsewhere. */
  controller: TidbytController;
  /** An additional installation the controller's connection lists; omitted, the default one. */
  installation?: string;
  minIntervalMs: number;
  refreshMs: number;
  pollMs: number;
  /** Monotonic milliseconds. */
  now: () => number;
};

/**
 * Keeps one installation showing the latest frame: push on change at most every
 * `minIntervalMs`, push an unchanged frame again after `refreshMs`, and remove the
 * installation when there is nothing to show. Failed writes are never replayed.
 */
export class InstallationWriter {
  readonly #controller: TidbytController;
  readonly #target: { installation: string } | Record<string, never>;
  readonly #minIntervalMs: number;
  readonly #refreshMs: number;
  readonly #pollMs: number;
  readonly #now: () => number;
  /** The last frame the cloud accepted, and when that push was submitted. */
  #sent?: { rgb: Uint8Array; atMs: number };
  #lastWriteAtMs?: number;
  #lastWrite?: Receipt;
  /** Consecutive writes not confirmed sent; each after the first doubles the wait before the next. */
  #failures = 0;
  #installation: InstallationState = 'unknown';

  constructor(options: InstallationWriterOptions) {
    this.#controller = options.controller;
    this.#target = options.installation === undefined ? {} : { installation: options.installation };
    this.#minIntervalMs = options.minIntervalMs;
    this.#refreshMs = options.refreshMs;
    this.#pollMs = options.pollMs;
    this.#now = options.now;
  }

  get installation(): InstallationState { return this.#installation; }
  get lastWrite(): Receipt | undefined { return this.#lastWrite; }

  /** Show `rgb`, or remove the installation when it is undefined. Returns the delay before the next evaluation. */
  async write(rgb: Uint8Array | undefined): Promise<number> {
    const now = this.#now();
    let command: DisplayRequest['command'] | undefined;
    if (rgb) {
      const unchanged = this.#sent !== undefined && Buffer.from(this.#sent.rgb).equals(rgb);
      if (!unchanged || now - this.#sent!.atMs >= this.#refreshMs) {
        command = { kind: 'tidbyt.display', frame: { width: 64, height: 32, encoding: FRAME_ENCODING, data: Buffer.from(rgb).toString('base64') }, ...this.#target };
      }
    } else if (this.#installation !== 'absent') {
      command = { kind: 'tidbyt.remove', ...this.#target };
    }
    const refreshDue = this.#sent && rgb ? Math.max(1, this.#sent.atMs + this.#refreshMs - now) : this.#pollMs;
    if (!command) return Math.min(this.#pollMs, refreshDue);
    const wait = this.#lastWriteAtMs === undefined ? 0 : this.#lastWriteAtMs + this.#backoffMs() - now;
    if (wait > 0) return wait;
    this.#lastWriteAtMs = now;
    const holds = this.#controller.snapshot().display.holds;
    if (command.kind === 'tidbyt.remove' && this.#installation === 'unknown' && !holds.authentication && holds.rateLimitRemainingMs === 0) {
      // Read the installation list first, so an installation that is already gone is not deleted again.
      const listing = await this.#controller.refresh(command.installation);
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
