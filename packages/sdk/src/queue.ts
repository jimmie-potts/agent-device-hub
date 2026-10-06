// One subscriber's delivery queue (ADR 0012, "a slow consumer lags only itself"). Items are delivered one at a time
// and in order, so a slow handler delays only its own queue, never the sender or other subscribers.
import {AsyncLocalStorage} from 'node:async_hooks';

type Delivering = {queue: object; done: boolean};
// The delivery whose handler runs in the current async context, so that close() called from it never waits for itself.
const delivering = new AsyncLocalStorage<Delivering>();

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

  /** Takes out an item that is still waiting. False once it is being delivered, was delivered or was dropped. */
  remove(item: T): boolean {
    const index = this.#items.indexOf(item);
    if (index < 0) return false;
    this.#items.splice(index, 1);
    return true;
  }

  /**
   * Drops waiting items, passing each to `dropped`, and accepts no more. Resolves when the item being delivered is
   * done, or at once when called from that delivery's own handler, which would otherwise wait for itself.
   */
  close(dropped?: (item: T) => void): Promise<void> {
    this.#closed = true;
    for (const item of this.#items.splice(0)) dropped?.(item);
    const caller = delivering.getStore();
    if (caller !== undefined && caller.queue === this && !caller.done) return Promise.resolve();
    return this.#running ?? Promise.resolve();
  }

  async #drain(): Promise<void> {
    try {
      // Start after the sender's call returns, so no handler runs inside publish or request.
      await Promise.resolve();
      for (let item = this.#items.shift(); item !== undefined; item = this.#items.shift()) {
        const delivery: Delivering = {queue: this, done: false};
        const next = item;
        await delivering.run(delivery, () => this.#deliver(next));
        delivery.done = true;
      }
    } finally {
      this.#running = undefined;
    }
  }
}
