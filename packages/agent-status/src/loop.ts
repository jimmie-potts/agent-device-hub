/**
 * Generic feed-cadence machinery shared by every status publisher: an evaluation loop and
 * a bounded feed read. Display-specific write policy (cadence, backoff, installation state)
 * stays with each consuming controller.
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
  #pollTimer?: unknown;
  readonly #pollMs?: number;

  /** `evaluate` returns the delay before the next scheduled evaluation. */
  constructor(evaluate: () => Promise<number>, timers: PublisherTimers, pollMs?: number) {
    if (pollMs !== undefined && (!Number.isSafeInteger(pollMs) || pollMs <= 0)) throw new Error('invalid-poll-interval');
    this.#pollMs = pollMs;
    this.#evaluate = evaluate;
    this.#timers = timers;
  }

  get stopped(): boolean { return this.#stopped; }

  update(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    this.#schedulePoll();
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
    if (this.#pollTimer !== undefined) this.#timers.clearTimeout(this.#pollTimer);
    this.#pollTimer = undefined;
  }

  #schedulePoll(): void {
    if (this.#pollMs === undefined || this.#pollTimer !== undefined || this.#stopped) return;
    this.#pollTimer = this.#timers.setTimeout(() => {
      this.#pollTimer = undefined;
      this.#schedulePoll();
      void this.update();
    }, this.#pollMs);
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
  readonly #read: (signal: AbortSignal) => T | Promise<T>;
  readonly #timeoutMs: number;
  readonly #timers: PublisherTimers;
  #pending?: Promise<unknown>;
  #stopped = false;
  #cancel?: () => void;

  constructor(read: (signal: AbortSignal) => T | Promise<T>, timeoutMs: number, timers: PublisherTimers) {
    this.#read = read;
    this.#timeoutMs = timeoutMs;
    this.#timers = timers;
  }

  stop(): void { this.#stopped = true; this.#cancel?.(); }

  /** The read's value, or undefined when it threw, timed out or an earlier read is still hung. */
  async read(): Promise<T | undefined> {
    if (this.#stopped || this.#pending) return undefined;
    const abort = new AbortController();
    let timer: unknown;
    try {
      const timeout = new Promise<typeof TIMEOUT>(resolve => {
        this.#cancel = () => { abort.abort(); resolve(TIMEOUT); };
        timer = this.#timers.setTimeout(this.#cancel, this.#timeoutMs);
      });
      const read = Promise.resolve().then(() => this.#stopped ? undefined : this.#read(abort.signal));
      const value = await Promise.race([read, timeout]);
      if (value === TIMEOUT) {
        const pending: Promise<unknown> = read.catch(() => undefined).finally(() => {
          if (this.#pending === pending) this.#pending = undefined;
        });
        this.#pending = pending;
        return undefined;
      }
      return this.#stopped ? undefined : value;
    } catch {
      return undefined;
    } finally {
      this.#timers.clearTimeout(timer);
      this.#cancel = undefined;
    }
  }
}
