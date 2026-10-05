/**
 * Software detents for a smooth encoder: one step per `stepCounts` encoder counts, counted in one accumulator that
 * restarts at zero whenever a turn reverses its direction, so a small wiggle back never steps back.
 */
export class Detent {
  #counts = 0;

  /** Adds a turn's counts and returns the whole steps it completes (negative is counter-clockwise). */
  turn(delta: number, stepCounts: number): number {
    if (delta === 0) return 0;
    if (this.#counts !== 0 && Math.sign(delta) !== Math.sign(this.#counts)) this.#counts = 0;
    this.#counts += delta;
    const steps = Math.trunc(this.#counts / stepCounts);
    this.#counts -= steps * stepCounts;
    return steps;
  }

  reset(): void { this.#counts = 0; }
}
