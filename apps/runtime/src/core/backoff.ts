// A capped, doubling wait between attempts (Hub #831), which the core and its tracker share: each failure doubles the
// wait, up to its cap, and a success resets it.

/** A capped, doubling wait between attempts. A first wait of 0 would retry at once, every time. */
export class Backoff {
  readonly #first: number;
  readonly #max: number;
  #delay = 0;
  #next = 0;
  #pending = false;

  constructor(first: number, max: number) {
    this.#first = first;
    this.#max = max;
  }

  /** Whether an attempt failed and the next one waits. */
  get pending(): boolean {
    return this.#pending;
  }

  /** When the next attempt is due. */
  get next(): number {
    return this.#next;
  }

  failed(now: number): void {
    this.#delay = this.#pending ? Math.min(this.#max, this.#delay * 2) : this.#first;
    this.#next = now + this.#delay;
    this.#pending = true;
  }

  ready(now: number): boolean {
    return !this.#pending || now >= this.#next;
  }

  reset(): void {
    this.#pending = false;
    this.#delay = 0;
  }
}
