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
