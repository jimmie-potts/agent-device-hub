export type SubscriptionCloseReason = 'closed' | 'stopped' | 'overflow';

/**
 * A bounded event queue for one subscriber. When the queue would exceed its limit, the subscription closes with
 * reason `overflow` and its queue is discarded: a consumer never sees a history with a missing release, and must
 * treat the end like a disconnect.
 */
export class Subscription<T> implements AsyncIterableIterator<T> {
  readonly limit: number;
  #queue: T[] = [];
  #closed: SubscriptionCloseReason | undefined;
  #waiting: ((result: IteratorResult<T>) => void) | undefined;
  readonly #onClose: (subscription: Subscription<T>) => void;

  constructor(limit: number, onClose: (subscription: Subscription<T>) => void) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 65536) throw new RangeError('invalid subscription limit');
    this.limit = limit;
    this.#onClose = onClose;
  }

  /** Why the subscription ended, or undefined while it is open. */
  get closedReason(): SubscriptionCloseReason | undefined { return this.#closed; }

  /** Internal: enqueues one event. Returns false when this push overflowed and closed the subscription. */
  push(event: T): boolean {
    if (this.#closed) return true;
    if (this.#waiting) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve({ done: false, value: event });
      return true;
    }
    if (this.#queue.length >= this.limit) {
      this.#queue = [];
      this.#end('overflow');
      return false;
    }
    this.#queue.push(event);
    return true;
  }

  /** Returns and removes every queued event without waiting. */
  drain(): T[] {
    const events = this.#queue;
    this.#queue = [];
    return events;
  }

  next(): Promise<IteratorResult<T>> {
    const event = this.#queue.shift();
    if (event !== undefined) return Promise.resolve({ done: false, value: event });
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise(resolve => { this.#waiting = resolve; });
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> { return this; }

  /** Stops delivery to this subscriber. Queued events stay readable. */
  close(): void { this.#end('closed'); }

  /** Internal: ends the subscription because the bridge stopped. Queued events stay readable. */
  stop(): void { this.#end('stopped'); }

  #end(reason: SubscriptionCloseReason): void {
    if (this.#closed) return;
    this.#closed = reason;
    const resolve = this.#waiting;
    this.#waiting = undefined;
    resolve?.({ done: true, value: undefined });
    this.#onClose(this);
  }
}
