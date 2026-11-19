// Browser-safe show data. Compilation, storage and device rendering stay with the server owner.
import type {MusicTimeline} from './music-timeline-data.js';

export const SHOW_TARGET = 'shows';
export const SHOW_VERSION_SCHEMA = 'nanoleaf-show-version/2.0';
export const SHOW_ID_PATTERN = '^show-[a-z0-9]+(?:-[a-z0-9]+)*$';
export const SHOW_LIMITS = Object.freeze({shows: 32, versions: 256, versionBytes: 128 * 1024, name: 80, id: 64});
export type ShowVersion = Readonly<{
  schema: typeof SHOW_VERSION_SCHEMA; showId: string; version: number; name: string; versionName: string;
  timeline: MusicTimeline;
}> & ({kind: 'decorative'} | {kind: 'measured'; measurement: ShowMeasurement});
export type ShowSummary = Readonly<{id: string; name: string; version: number; versions: readonly {version: number; versionName: string; kind?: 'measured'}[]}>;
export type ShowCatalog = Readonly<{id: typeof SHOW_TARGET; revision: number; shows: readonly ShowSummary[]}>;
export type ShowSave = Readonly<{showId: string; expectedVersion: number; name: string; versionName: string; timeline: MusicTimeline; measurement?: ShowMeasurement; measurementProof?: string}>;

export const validShowId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= SHOW_LIMITS.id && new RegExp(SHOW_ID_PATTERN).test(value);

export type MeasuredItem = Readonly<{libraryScopeId: string; itemId: string}>;

export type ShowMeasurement = Readonly<{
  item: MeasuredItem; analysis: {method: 'energy-onset-v1'; sampleCount: number};
}>;

const object = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input);

export function showMeasurement(input: unknown): ShowMeasurement | undefined {
  if (!object(input) || Object.keys(input).length !== 2) return undefined;
  const {item, analysis} = input;
  if (!object(item) || Object.keys(item).length !== 2 || !object(analysis) || Object.keys(analysis).length !== 2
      || typeof item.libraryScopeId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.libraryScopeId)
      || item.libraryScopeId.length > 128 || typeof item.itemId !== 'string' || !/^[0-9a-fA-F]{1,128}$/.test(item.itemId)
      || analysis.method !== 'energy-onset-v1' || typeof analysis.sampleCount !== 'number'
      || !Number.isSafeInteger(analysis.sampleCount) || analysis.sampleCount < 1 || analysis.sampleCount > 18000) return undefined;
  return {item: {libraryScopeId: item.libraryScopeId, itemId: item.itemId}, analysis: {method: analysis.method, sampleCount: analysis.sampleCount}};
}
