// The presented-source rule and observation freshness. Copied from the old Hub's `apps/hub/src/playback.ts` at main
// 483d3a93 (Hub #175, #233; copied for Hub #929) and converted to the strict profile. The Hub's version also admitted
// commands and kept receipts; in the module, `module.ts` admits commands, so this part keeps only the per-source
// observations, their freshness and which source is presented. Sources own their protocols, and this file imports none
// of their code: it accepts normalized observations only.

export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';
export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'inactive' | 'unknown';
/** One successful read of a source, normalized. A failed read is never an observation. */
export type PlaybackObservation = {
  status: PlaybackStatus; title?: string; artist?: string; album?: string; controls: PlaybackAction[];
  /** Private candidate, never copied into public playback metadata. */
  thumbnailUrl?: string;
};
export type Availability = 'available' | 'stale' | 'unavailable';

export const ACTIONS: readonly PlaybackAction[] = ['play', 'pause', 'next', 'previous'];
export const isAction = (value: unknown): value is PlaybackAction => typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
// About two missed two-second reads make a source stale; old metadata is withheld once unavailable.
export const STALE_MS = 5000;
export const UNAVAILABLE_MS = 30_000;
const FRESHNESS: Readonly<Record<Availability, number>> = {available: 2, stale: 1, unavailable: 0};

type Observed = {atMs: number; mark: number; value: PlaybackObservation};

/** What the presented source shows now: its availability, its last observation's time and age, and, unless unavailable, that observation. */
export type PresentedView = {availability: Availability; index: number; observedAtMs?: number; ageMs?: number; observation?: PlaybackObservation};

/**
 * The observations of the sources in configured order, and the one presented. Age is the larger of the monotonic and
 * wall-clock ages, so neither a clock step back nor a suspend makes old data look fresh.
 */
export class Presentation {
  readonly #observed: (Observed | undefined)[];
  readonly #clock: () => number;
  readonly #monotonic: () => number;

  constructor(count: number, clock: () => number, monotonic: () => number = clock) {
    this.#observed = Array.from({length: count}, () => undefined);
    this.#clock = clock;
    this.#monotonic = monotonic;
  }

  /** A source's successful read, including an unchanged one: it refreshes that source's observation time. */
  report(index: number, observation: PlaybackObservation): void {
    if (index < 0 || index >= this.#observed.length) throw new RangeError('no such source');
    this.#observed[index] = {atMs: this.#clock(), mark: this.#monotonic(), value: structuredClone(observation)};
  }

  /** How old the source's last observation is, or undefined before its first. */
  age(index: number): number | undefined {
    const record = this.#observed[index];
    return record === undefined ? undefined : Math.max(0, this.#monotonic() - record.mark, this.#clock() - record.atMs);
  }

  availability(index: number): Availability {
    const ms = this.age(index);
    return ms === undefined || ms >= UNAVAILABLE_MS ? 'unavailable' : ms >= STALE_MS ? 'stale' : 'available';
  }

  /** The source's last observation, kept while it ages, or undefined before its first. */
  observation(index: number): PlaybackObservation | undefined {
    return this.#observed[index]?.value;
  }

  /** The presented source: the first in configured order with a session (playing or paused), then the freshest. */
  presented(): number {
    let best = 0;
    let bestRank = -1;
    this.#observed.forEach((record, index) => {
      const state = this.availability(index);
      const status = record?.value.status;
      const session = state !== 'unavailable' && (status === 'playing' || status === 'paused') ? 1 : 0;
      const rank = session * 3 + FRESHNESS[state];
      if (rank > bestRank) {
        best = index;
        bestRank = rank;
      }
    });
    return best;
  }

  /** The presented source's view. An unavailable source shows no observation, so nothing looks paused for lack of evidence. */
  view(): PresentedView {
    const index = this.presented();
    const record = this.#observed[index];
    const availability = this.availability(index);
    const ageMs = this.age(index);
    return {
      availability, index, ...(record === undefined ? {} : {observedAtMs: record.atMs}), ...(ageMs === undefined ? {} : {ageMs}),
      ...(availability === 'unavailable' || record === undefined ? {} : {observation: structuredClone(record.value)}),
    };
  }

  /**
   * How long until some source's availability changes as its last observation ages, or undefined when none will: every
   * source is unobserved or already unavailable.
   */
  nextChangeInMs(): number | undefined {
    let soonest: number | undefined;
    this.#observed.forEach((_, index) => {
      const ms = this.age(index);
      if (ms === undefined || ms >= UNAVAILABLE_MS) return;
      const wait = (ms < STALE_MS ? STALE_MS : UNAVAILABLE_MS) - ms;
      soonest = soonest === undefined ? wait : Math.min(soonest, wait);
    });
    return soonest;
  }
}
