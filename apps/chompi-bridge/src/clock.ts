/** Time source for the bridge and simulator, so tests and the scripted monitor can run in virtual time. */
export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: handle => clearInterval(handle as NodeJS.Timeout),
};

interface Timer { id: number; due: number; every: number | undefined; callback: () => void }

/** A clock that moves only when `advance` is called; due timers run in time order, synchronously. */
export class ManualClock implements Clock {
  #now: number;
  #next = 1;
  readonly #timers = new Map<number, Timer>();

  constructor(start = 0) { this.#now = start; }

  now(): number { return this.#now; }

  setTimeout(callback: () => void, ms: number): unknown { return this.#add(callback, ms, undefined); }
  setInterval(callback: () => void, ms: number): unknown { return this.#add(callback, ms, Math.max(1, ms)); }
  clearTimeout(handle: unknown): void { this.#timers.delete(handle as number); }
  clearInterval(handle: unknown): void { this.#timers.delete(handle as number); }

  /** Number of scheduled timers, for leak checks. */
  get pending(): number { return this.#timers.size; }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      let due: Timer | undefined;
      for (const timer of this.#timers.values()) if (timer.due <= target && (!due || timer.due < due.due || (timer.due === due.due && timer.id < due.id))) due = timer;
      if (!due) break;
      this.#now = due.due;
      if (due.every === undefined) this.#timers.delete(due.id);
      else due.due += due.every;
      due.callback();
    }
    this.#now = target;
  }

  #add(callback: () => void, ms: number, every: number | undefined): number {
    const id = this.#next++;
    this.#timers.set(id, { id, due: this.#now + Math.max(0, ms), every, callback });
    return id;
  }
}
