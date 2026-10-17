// What a device result can honestly claim, and the one way that claim changes
// (Hub #1140). The levels are ordered: absent < transmitted < uncertain < observed.
// `merge` keeps the stronger of two claims, so a claim never drops without new
// evidence, and its type says so: merging uncertain with transmitted is still
// uncertain, so treating the result as a confident transmitted (or absent)
// claim is a compile error. Only observed evidence moves past uncertain.
export type EvidenceLevel = 'absent' | 'transmitted' | 'uncertain' | 'observed';

declare const brand: unique symbol;

/** One evidence claim. Create it with the level functions below and change it only with `merge`. */
export interface Evidence<T extends EvidenceLevel> {
  readonly level: T;
  readonly [brand]: T;
}

// The levels at or above each level.
interface AtLeast {
  absent: EvidenceLevel;
  transmitted: 'transmitted' | 'uncertain' | 'observed';
  uncertain: 'uncertain' | 'observed';
  observed: 'observed';
}

/** The level `merge` returns: the stronger of the two, distributed over unions. */
export type Merged<P extends EvidenceLevel, N extends EvidenceLevel> = P extends EvidenceLevel ? N extends EvidenceLevel ? N extends AtLeast[P] ? N : P : never : never;

const RANK: Readonly<Record<EvidenceLevel, number>> = {absent: 0, transmitted: 1, uncertain: 2, observed: 3};

const make = <T extends EvidenceLevel>(level: T): Evidence<T> => Object.freeze({level}) as Evidence<T>;

export const absent = (): Evidence<'absent'> => make('absent');
export const transmitted = (): Evidence<'transmitted'> => make('transmitted');
export const uncertain = (): Evidence<'uncertain'> => make('uncertain');
export const observed = (): Evidence<'observed'> => make('observed');

/** The only transition: combine the previous claim with new evidence, keeping the stronger. */
export function merge<P extends EvidenceLevel, N extends EvidenceLevel>(prev: Evidence<P>, next: Evidence<N>): Evidence<Merged<P, N>> {
  return (RANK[next.level] > RANK[prev.level] ? next : prev) as Evidence<EvidenceLevel> as Evidence<Merged<P, N>>;
}

/**
 * A held claim that changes only through `merge` (Hub #1140). Bind it with `const`; the claim is read-only, so a
 * held claim cannot be replaced by assignment, only merged with new evidence, and it never drops.
 */
export class HeldEvidence<T extends EvidenceLevel> {
  #claim: Evidence<T>;

  constructor(initial: Evidence<T>) {
    this.#claim = initial;
  }

  get claim(): Evidence<T> {
    return this.#claim;
  }

  /** Combine new evidence with the held claim, keeping the stronger. */
  merge(next: Evidence<T>): Evidence<T> {
    this.#claim = merge(this.#claim, next);
    return this.#claim;
  }
}

/** Hold a claim whose later evidence stays within the levels `T`. */
export const hold = <T extends EvidenceLevel>(initial: Evidence<T>): HeldEvidence<T> => new HeldEvidence<T>(initial);
