// What a live Music session on the Lines starts over and what its ending can put back (#1614, over #1272 design D4).
// A scene saved on the light is selected again by name, and a plain colour (`*Solid*`) is written back from the hue and
// saturation or colour temperature read at the Start. Anything else, such as an unsaved scene, an effect or the frames
// an earlier session left, cannot be selected again: the session still starts, and its ending puts nothing back. No
// scene is guessed. Bounded moments keep the named-scene rule (`readFreeBase` in moments.ts).
import {isObject} from './compat.js';
import type {DeviceRead} from './moments.js';

/** The selection a light reports while it shows a plain colour. */
export const SOLID = '*Solid*';
/** The selections the light names itself rather than after a saved scene, which a record may show as they are. */
export const PLACEHOLDERS = [SOLID, '*Static*', '*Dynamic*', '*ExtControl*'] as const;
/** A plain colour as the light reports it: hue and saturation, or a colour temperature in kelvin. */
export type MusicColor = {hue: number; sat: number} | {ct: number};
/**
 * The base a session started over, frozen in its Start: a saved scene (`name` is its selection), a plain colour, or a
 * selection nothing can select again. Each keeps the brightness read with it, which the playing check compares.
 */
export type MusicBase =
  | {kind: 'scene'; name: string; brightness: number}
  | {kind: 'color'; selection: string; color: MusicColor; brightness: number}
  | {kind: 'unnamed'; selection: string; brightness: number};
/** What an ending of a session over a base puts back. */
export const RESTORES = ['scene', 'color', 'nothing'] as const;
export type Restores = typeof RESTORES[number];
/** One read of the light's selection: what it reported, whether it is a scene saved on the light, and what an ending would put back. */
export type SelectionRead = {selection: string; saved: boolean; restores: Restores};

export const selectionOf = (base: MusicBase): string => base.kind === 'scene' ? base.name : base.selection;
export const restoresOf = (base: MusicBase): Restores => base.kind === 'scene' ? 'scene' : base.kind === 'color' ? 'color' : 'nothing';

/** Whether `select` is a scene saved on the light: listed, and not one of the light's `*...*` placeholders. */
export const savedScene = (select: string, listing: unknown): boolean =>
  !select.startsWith('*') && isObject(listing) && Array.isArray(listing.effectsList) && listing.effectsList.includes(select);

/** What one `/effects` answer says about the selection, or undefined when it names none. A `*Solid*` is a colour unless `/state` says otherwise. */
export function selectionRead(listing: unknown): SelectionRead | undefined {
  if (!isObject(listing) || typeof listing.select !== 'string' || listing.select === '') return undefined;
  const saved = savedScene(listing.select, listing);
  return {selection: listing.select, saved, restores: saved ? 'scene' : listing.select === SOLID ? 'color' : 'nothing'};
}

const integerIn = (field: unknown, low: number, high: number): number | undefined => {
  if (!isObject(field) || typeof field.value !== 'number' || !Number.isInteger(field.value)) return undefined;
  const min = typeof field.min === 'number' ? Math.max(low, field.min) : low, max = typeof field.max === 'number' ? Math.min(high, field.max) : high;
  return field.value >= min && field.value <= max ? field.value : undefined;
};
/** The plain colour `/state` reports, from its colour mode: hue and saturation (`hs`) or a colour temperature (`ct`). */
export function colorOf(state: unknown): MusicColor | undefined {
  if (!isObject(state)) return undefined;
  if (state.colorMode === 'hs') {
    const hue = integerIn(state.hue, 0, 360), sat = integerIn(state.sat, 0, 100);
    return hue === undefined || sat === undefined ? undefined : {hue, sat};
  }
  if (state.colorMode === 'ct') {
    const ct = integerIn(state.ct, 1000, 10000);
    return ct === undefined ? undefined : {ct};
  }
  return undefined;
}

/** Whether `/state` still reports `color` in its own colour mode: any other colour or mode is a newer choice. */
export function sameColorOf(state: unknown, color: MusicColor): boolean {
  const now = colorOf(state);
  return now !== undefined && ('ct' in color ? 'ct' in now && now.ct === color.ct
    : 'hue' in now && now.hue === color.hue && now.sat === color.sat);
}

/** Why a Start cannot take the base it read: the light is off, or it reported no selection or brightness. */
export type BaseRefusal = 'off' | 'unreadable';
/**
 * Reads the light's selection (`/effects`) and state (`/state`), the Start's two existing reads, and returns the base a
 * session would start over with what the reads found, or why there is none. A light that is off, or reports no
 * selection or brightness, has no base. A failed read rejects.
 */
export async function readMusicBase(read: DeviceRead): Promise<{observed: SelectionRead | undefined} & ({base: MusicBase} | {refusal: BaseRefusal})> {
  const listing = await read('/effects');
  const state = await read('/state');
  const found = selectionRead(listing);
  if (found === undefined || !isObject(state)) return {observed: found, refusal: 'unreadable'};
  const brightness = integerIn(state.brightness, 0, 100);
  const color = found.restores === 'color' ? colorOf(state) : undefined;
  // A `*Solid*` whose colour cannot be read is a selection nothing can put back.
  const observed: SelectionRead = found.restores === 'color' && color === undefined ? {...found, restores: 'nothing'} : found;
  if (isObject(state.on) && state.on.value === false) return {observed, refusal: 'off'};
  if (brightness === undefined) return {observed, refusal: 'unreadable'};
  const {selection} = observed;
  const base: MusicBase = observed.saved ? {kind: 'scene', name: selection, brightness}
    : color !== undefined ? {kind: 'color', selection, color, brightness} : {kind: 'unnamed', selection, brightness};
  return {observed, base};
}

/**
 * Puts the base back on a light still in the session's streaming selection `shown`: brightness, then the scene by name
 * or the colour, each through `write`, which guards it. Only while the light still reports `shown`, a scene base is
 * still listed, the light is not off, its brightness is unchanged and nothing newer took over (`stale`). An unnamed base
 * has nothing to put back and is never passed here. False: skipped without a write. A guard that finds a newer choice
 * between the writes throws.
 */
export async function restoreMusicBase(read: DeviceRead, base: Exclude<MusicBase, {kind: 'unnamed'}>, shown: string, stale: () => boolean,
  write: (endpoint: string, payload: unknown) => Promise<unknown>): Promise<boolean> {
  const listing = await read('/effects') as {select?: unknown; effectsList?: unknown};
  if (listing.select !== shown || (base.kind === 'scene' && !savedScene(base.name, listing))) return false;
  // A light switched off by hand is a newer choice: restoring brightness and the base would override it.
  const state = await read('/state') as {on?: {value?: unknown}; brightness?: {value?: unknown}};
  if (state.on?.value === false || state.brightness?.value !== base.brightness) return false;
  if (stale()) return false;
  await write('/state', {brightness: {value: base.brightness, duration: 0}});
  if (base.kind === 'scene') await write('/effects', {select: base.name});
  else await write('/state', 'ct' in base.color ? {ct: {value: base.color.ct}} : {hue: {value: base.color.hue}, sat: {value: base.color.sat}});
  return true;
}
