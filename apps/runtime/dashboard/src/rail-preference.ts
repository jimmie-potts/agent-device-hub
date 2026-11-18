/**
 * The rail's collapse choice (Hub #1887). It is this browser's preference, never core or module state. Wide windows
 * and narrower ones each remember the last toggle made at that size; until there is one, the rail is expanded when
 * the window is wide and an icon rail when it is narrower.
 */
export const RAIL_PREFERENCE_KEY = 'bunny.dashboard.rail.v1';
/** The window width from which the rail starts expanded. */
export const RAIL_WIDE_QUERY = '(min-width: 1200px)';

export type RailSize = 'wide' | 'narrow';
/** `true` expands the rail at that size, `false` collapses it and `null` leaves the default. */
export type RailPreference = {readonly wide: boolean | null; readonly narrow: boolean | null};

const UNSET: RailPreference = {wide: null, narrow: null};
const choice = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

/** Reads a saved preference. Anything unexpected is no preference, so a damaged value never breaks the shell. */
export function parseRailPreference(raw: string | null): RailPreference {
  if (raw === null) return UNSET;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return UNSET;
    const saved = new Map<string, unknown>(Object.entries(value));
    return {wide: choice(saved.get('wide')), narrow: choice(saved.get('narrow'))};
  } catch {
    return UNSET;
  }
}

export const railExpanded = (preference: RailPreference, size: RailSize): boolean => preference[size] ?? size === 'wide';
/** How a saved choice is published to the stylesheet. No value leaves the stylesheet's default for that window size. */
export const railAttribute = (saved: boolean | null): 'expanded' | 'collapsed' | undefined => saved === null ? undefined : saved ? 'expanded' : 'collapsed';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export class RailPreferenceStore {
  readonly #storage: () => PreferenceStorage;
  readonly #listeners = new Set<() => void>();
  #preference: RailPreference;
  constructor(storage: () => PreferenceStorage) {
    this.#storage = storage;
    let saved: string | null = null;
    try {saved = storage().getItem(RAIL_PREFERENCE_KEY);} catch {/* Storage is unavailable; use the defaults. */}
    this.#preference = parseRailPreference(saved);
  }
  readonly getSnapshot = (): RailPreference => this.#preference;
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};
  /** Flips the rail at one size and remembers it. The other size keeps its own choice. */
  toggle(size: RailSize): void {
    this.#preference = {...this.#preference, [size]: !railExpanded(this.#preference, size)};
    try {this.#storage().setItem(RAIL_PREFERENCE_KEY, JSON.stringify(this.#preference));} catch {/* The choice still applies to this page. */}
    this.#notify();
  }
  /** Follows a choice made in another tab of this browser. */
  storageChanged(key: string | null, value: string | null): void {
    if (key !== RAIL_PREFERENCE_KEY) return;
    const next = parseRailPreference(value);
    if (next.wide === this.#preference.wide && next.narrow === this.#preference.narrow) return;
    this.#preference = next;
    this.#notify();
  }
  #notify(): void {for (const listener of this.#listeners) listener();}
}
