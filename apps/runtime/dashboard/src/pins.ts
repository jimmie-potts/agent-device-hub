import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {directoryEntries, moduleLabel} from './directory.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import {parseRoute, routeHash, type Route} from './routes.ts';

/**
 * Pages pinned to the rail (Hub #1889). The list is this browser's preference, never core or module state: pinning
 * and unpinning read nothing and send nothing. A pin is a page address. It is saved whether or not the catalog
 * declares that page now, so a page that comes back brings its pin back.
 */
export const PINS_KEY = 'bunny.dashboard.pins.v1';
/** The Conversation page has no pin: conversations get their own group in the rail (Hub #1890). */
const CONVERSATION = '#/module/companions/assistant';
const NONE: readonly string[] = [];

/** Whether an address is the kind of page that can be pinned: a device, a lighting brand, Audio or a module page. */
export const pinnableRoute = (route: Route): boolean =>
  (route.kind === 'component' || route.kind === 'lighting-brand' || route.kind === 'audio' || route.kind === 'module') && routeHash(route) !== CONVERSATION;

/** Reads a saved list. Anything that is not a pinnable address is dropped, and a damaged value is no pins. */
export function parsePins(raw: string | null): readonly string[] {
  if (raw === null) return NONE;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return NONE;
    const pins: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const route = parseRoute(item);
      if (!pinnableRoute(route)) continue;
      const hash = routeHash(route);
      if (!pins.includes(hash)) pins.push(hash);
    }
    return pins.length === 0 ? NONE : pins;
  } catch {
    return NONE;
  }
}

type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((pin, index) => pin === b[index]);

export class PinStore {
  readonly #storage: () => PinStorage;
  readonly #listeners = new Set<() => void>();
  #pins: readonly string[];
  constructor(storage: () => PinStorage) {
    this.#storage = storage;
    let saved: string | null = null;
    try {saved = storage().getItem(PINS_KEY);} catch {/* Storage is unavailable; start with no pins. */}
    this.#pins = parsePins(saved);
  }
  readonly getSnapshot = (): readonly string[] => this.#pins;
  readonly subscribe = (listener: () => void): (() => void) => {this.#listeners.add(listener); return () => {this.#listeners.delete(listener);};};
  /** Pins a page at the end of the list, or unpins it. An address that cannot be pinned changes nothing. */
  toggle(route: Route): void {
    if (!pinnableRoute(route)) return;
    const hash = routeHash(route);
    this.#pins = this.#pins.includes(hash) ? this.#pins.filter(pin => pin !== hash) : [...this.#pins, hash];
    try {this.#storage().setItem(PINS_KEY, JSON.stringify(this.#pins));} catch {/* The pins still apply to this page. */}
    this.#notify();
  }
  /** Follows a change made in another tab of this browser. A cleared store reports no key and clears the pins. */
  storageChanged(key: string | null, value: string | null): void {
    if (key !== null && key !== PINS_KEY) return;
    const next = parsePins(key === null ? null : value);
    if (same(next, this.#pins)) return;
    this.#pins = next;
    this.#notify();
  }
  #notify(): void {for (const listener of this.#listeners) listener();}
}

/**
 * A page that can be pinned now: its address, its name, the module it belongs to when it is one of several pages, a
 * short mark for the icon rail, and the state of its module when that module is not running.
 */
export type PinTarget = {hash: string; route: Route; name: string; group: string; mono: string; note: string};

const letters = (text: string): string => text.replace(/[^\p{L}\p{N}]/gu, '');
/** Two characters that stand for a page in the icon rail: the module's and the page's initials, or the start of a lone name. */
export function monogram(name: string, group: string): string {
  const mark = group === '' ? letters(name).slice(0, 2) : `${letters(group).slice(0, 1)}${letters(name).slice(0, 1)}`.toUpperCase();
  return mark === '' ? '·' : mark;
}
/** The whole name of a pinned page, as a title and an accessible name give it, with its module's state when the module is not running. */
export const pinName = (target: Pick<PinTarget, 'name' | 'group'> & {note?: string}): string =>
  `${target.group === '' ? target.name : `${target.group} · ${target.name}`}${target.note === undefined || target.note === '' ? '' : ` · ${target.note}`}`;

/**
 * Every page that can be pinned now, by address: each page the Devices directory lists, and each device's own page,
 * which for a light is reached from its brand page and not from the directory. It is a projection of the catalog and
 * the device records the page already holds. A saved pin with no entry here is not shown. A page of a module that is
 * not running is still a page, and carries that module's state so that its row never looks available.
 */
export function pinTargets(runtime: RuntimeData): ReadonlyMap<string, PinTarget> {
  const targets = new Map<string, PinTarget>();
  const add = (route: Route, name: string, group: string, state: string): void => {
    const hash = routeHash(route);
    if (pinnableRoute(route) && !targets.has(hash)) targets.set(hash, {hash, route, name, group, mono: monogram(name, group), note: state === 'running' ? '' : state});
  };
  for (const entry of directoryEntries(runtime)) {
    for (const link of entry.links) {
      const one = entry.links.length === 1 || link.label.toLowerCase() === entry.label.toLowerCase();
      add(link.route, one ? entry.label : link.label, one ? '' : entry.label, entry.state);
    }
  }
  for (const copy of runtime.copies) {
    if (copy.family !== 'device') continue;
    const module = copy.owner.slice(copy.owner.lastIndexOf('/') + 1);
    // A device whose owner the catalog does not list has no module state to show.
    const state = runtime.modules?.find(entry => entry.name === module)?.state ?? 'running';
    for (const device of copy.records as readonly DeviceRecord[]) add({kind: 'component', id: device.id}, device.label ?? device.id, moduleLabel(module), state);
  }
  return targets;
}
