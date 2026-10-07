// How often a disposable runtime run starts again a runtime that died on its own (Hub #920): at most `limit` times within
// any `windowMs`, as systemd's StartLimitBurst and StartLimitIntervalSec bound a service's restarts. A runtime that
// crashes now and then is restarted for as long as the run lasts; one that keeps crashing ends the run.
export class BurstLimit {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  /** When each restart within the window happened, oldest first. */
  readonly #starts: number[] = [];

  constructor(limit: number, windowMs: number, now: () => number = () => Date.now()) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** Counts one more restart now and says whether the limit allows it. A refused restart is not counted. */
  allow(): boolean {
    const now = this.#now();
    while (this.#starts.length > 0 && (this.#starts[0] ?? now) <= now - this.#windowMs) this.#starts.shift();
    if (this.#starts.length >= this.#limit) return false;
    this.#starts.push(now);
    return true;
  }
}
