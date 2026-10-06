// One subscriber's delivery queue (ADR 0012, "a slow consumer lags only itself"). Items are delivered one at a time
// and in order, so a slow handler delays only its own queue, never the sender or other subscribers.
export class DeliveryQueue<T extends object> {
  readonly #items: T[] = [];
  readonly #limit: number;
  readonly #deliver: (item: T) => Promise<void>;
  #running: Promise<void> | undefined;
  #closed = false;

  /** `deliver` must not reject: the bus reports handler errors itself. */
  constructor(limit: number, deliver: (item: T) => Promise<void>) {
    this.#limit = limit;
    this.#deliver = deliver;
  }

  /** Queues an item. False when the queue is closed or already holds `limit` items waiting. */
  push(item: T): boolean {
    if (this.#closed || this.#items.length >= this.#limit) return false;
    this.#items.push(item);
    this.#running ??= this.#drain();
    return true;
  }

  /** Drops waiting items, passing each to `dropped`, and accepts no more. Resolves when the item being delivered is done. */
  close(dropped?: (item: T) => void): Promise<void> {
    this.#closed = true;
    for (const item of this.#items.splice(0)) dropped?.(item);
    return this.#running ?? Promise.resolve();
  }

  async #drain(): Promise<void> {
    try {
      // Start after the sender's call returns, so no handler runs inside publish or request.
      await Promise.resolve();
      for (let item = this.#items.shift(); item !== undefined; item = this.#items.shift()) await this.#deliver(item);
    } finally {
      this.#running = undefined;
    }
  }
}
