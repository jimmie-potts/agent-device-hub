import {directoryEntries} from './directory.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import {routeHash, type Route} from './routes.ts';

/**
 * What the jump palette (Hub #1888) can open. The list is a projection of the shell's own destinations and the
 * current catalog's declared pages; it reads nothing new and sends nothing. Choosing an entry only navigates.
 */
export type JumpGroup = 'Recent' | 'Hub' | 'Device pages';
export type JumpEntry = {group: JumpGroup; label: string; hint: string; route: Route};

const HUB: readonly Omit<JumpEntry, 'group'>[] = [
  {label: 'Home', hint: '', route: {kind: 'home'}},
  {label: 'Habitat', hint: '', route: {kind: 'habitat'}},
  {label: 'Rooms', hint: '', route: {kind: 'rooms'}},
  {label: 'Devices', hint: '', route: {kind: 'devices'}},
  {label: 'Automation', hint: '', route: {kind: 'automation'}},
  {label: 'Timeline', hint: 'Home', route: {kind: 'timeline'}},
  {label: 'Settings', hint: '', route: {kind: 'settings'}},
  {label: 'Connections', hint: 'Settings', route: {kind: 'connections'}},
];
/** How many recently visited pages the palette offers first. */
export const JUMP_RECENTS = 3;

/**
 * Every place the palette offers: the pages visited most recently in this page session, the hub's own destinations,
 * then each page a running module declares. A module that is not running is left out, as are addresses the catalog
 * no longer declares, so the palette never offers a page that would open as unavailable or not found.
 */
export function jumpEntries(runtime: RuntimeData, recents: readonly Route[], current: Route): JumpEntry[] {
  const places: JumpEntry[] = HUB.map(place => ({group: 'Hub', ...place}));
  const seen = new Set(places.map(place => routeHash(place.route)));
  for (const entry of directoryEntries(runtime)) {
    if (entry.state !== 'running') continue;
    for (const link of entry.links) {
      const hash = routeHash(link.route);
      if (seen.has(hash)) continue;
      seen.add(hash);
      places.push({group: 'Device pages', label: link.label.toLowerCase() === entry.label.toLowerCase() ? entry.label : `${entry.label} · ${link.label}`, hint: entry.category, route: link.route});
    }
  }
  const here = routeHash(current), recent: JumpEntry[] = [];
  for (const route of recents) {
    const hash = routeHash(route), place = places.find(candidate => routeHash(candidate.route) === hash);
    if (place === undefined || hash === here || recent.some(found => routeHash(found.route) === hash)) continue;
    recent.push({...place, group: 'Recent'});
    if (recent.length === JUMP_RECENTS) break;
  }
  return [...recent, ...places];
}

/**
 * The entries a typed query leaves, best match first. Every word must appear in an entry's name, hint or group. A name
 * that starts with the query ranks above one that only contains it, and that above a match in the hint or group. A
 * query drops the Recent copies, so a page appears once.
 */
export function filterJump(entries: readonly JumpEntry[], query: string): JumpEntry[] {
  const text = query.trim().toLowerCase();
  if (text === '') return [...entries];
  const words = text.split(/\s+/);
  const rank = (entry: JumpEntry): number => {
    const label = entry.label.toLowerCase();
    return label.startsWith(text) ? 0 : label.includes(text) ? 1 : 2;
  };
  return entries.filter(entry => entry.group !== 'Recent' && words.every(word => `${entry.label} ${entry.hint} ${entry.group}`.toLowerCase().includes(word)))
    .map((entry, index) => ({entry, index}))
    .sort((a, b) => {const byRank = rank(a.entry) - rank(b.entry); return byRank !== 0 ? byRank : a.index - b.index;})
    .map(item => item.entry);
}

/** The parts of a key press the palette reads. */
export type JumpKeyPress = {key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean};
/**
 * Where a key was pressed: on a Mac or not, with the palette open or not, in a text field (`field`), inside an open
 * menu, list or dialog that reads its own keys (`owned`), or while a modal dialog is open (`modal`).
 */
export type JumpKeyPlace = {mac: boolean; open: boolean; field: boolean; owned: boolean; modal: boolean};

/**
 * What a key press means to the palette. Command and K, or Control and K, opens or closes it from anywhere on the
 * page, with one exception: on a Mac, Control and K in a text field is the system's key for deleting to the end of the
 * line and stays that. A slash opens the palette, but not in a text field and not inside an open menu, list or dialog,
 * where the slash is theirs. While a modal dialog is open the palette could only open underneath it, so every key is
 * left alone.
 */
export function jumpShortcut(press: JumpKeyPress, place: JumpKeyPlace): 'toggle' | 'open' | undefined {
  if (place.modal) return undefined;
  if (press.key.toLowerCase() === 'k' && (press.metaKey || press.ctrlKey) && !press.altKey && !press.shiftKey) {
    return place.mac && !press.metaKey && place.field ? undefined : 'toggle';
  }
  if (press.key === '/' && !press.metaKey && !press.ctrlKey && !press.altKey && !place.open && !place.field && !place.owned) return 'open';
  return undefined;
}

/** Adds the page just left to the front of the recent list, without duplicates, keeping a few more than are shown. */
export function rememberRoute(recents: readonly Route[], left: Route): Route[] {
  if (left.kind === 'missing') return [...recents];
  const hash = routeHash(left);
  return [left, ...recents.filter(route => routeHash(route) !== hash)].slice(0, JUMP_RECENTS + 2);
}
