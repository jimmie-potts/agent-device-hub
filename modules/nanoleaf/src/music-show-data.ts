// Browser-safe show data. Compilation, storage and device rendering stay with the server owner.
import type {MusicTimeline} from './music-timeline-data.js';

export const SHOW_TARGET = 'shows';
export const SHOW_VERSION_SCHEMA = 'nanoleaf-show-version/2.0';
export const SHOW_ID_PATTERN = '^show-[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SHOW_LIMITS = Object.freeze({shows: 32, versions: 256, versionBytes: 128 * 1024, name: 80, id: 64});
export type ShowVersion = Readonly<{
  schema: typeof SHOW_VERSION_SCHEMA; showId: string; version: number; name: string; versionName: string;
  kind: 'decorative'; timeline: MusicTimeline;
}>;
export type ShowSummary = Readonly<{id: string; name: string; version: number; versions: readonly {version: number; versionName: string}[]}>;
export type ShowCatalog = Readonly<{id: typeof SHOW_TARGET; revision: number; shows: readonly ShowSummary[]}>;
export type ShowSave = Readonly<{showId: string; expectedVersion: number; name: string; versionName: string; timeline: MusicTimeline}>;

export const validShowId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= SHOW_LIMITS.id && new RegExp(SHOW_ID_PATTERN).test(value);
