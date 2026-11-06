import type {ArtSchedulePolicy, ArtScheduleRecord, ArtScheduleWrite} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import {REQUEST_HEADER, childOf} from '@jimmie-potts/sdk/remote';
import type {RuntimeData} from './runtime-feeds.ts';

export function artScheduleCopy(runtime: RuntimeData): {record: ArtScheduleRecord | undefined; synced: boolean} {
  const copy = runtime.copies.find(value => value.owner === 'bunny/core' && value.family === 'art-schedule');
  // The SDK has already validated this owner's closed family before publishing the copy.
  const record = copy?.records.find((value): value is ArtScheduleRecord => 'policy' in value && value.id === 'art');
  return {record, synced: copy?.synced === true};
}
export function sameArtPolicy(left: ArtSchedulePolicy, right: ArtSchedulePolicy): boolean {
  return left.enabled === right.enabled && left.wakingStartMinute === right.wakingStartMinute && left.wakingEndMinute === right.wakingEndMinute
    && left.appearances === right.appearances && left.browser === right.browser && left.ambient === right.ambient && left.generation === right.generation
    && left.weather === right.weather && left.coversStatus === right.coversStatus && JSON.stringify([...left.targets].sort()) === JSON.stringify([...right.targets].sort());
}
export function artMinute(value: string): number | undefined {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export const artTimeInput = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function artTime(atMs: number, timeZone: string): string {
  try {return new Intl.DateTimeFormat(undefined, {timeZone, dateStyle: 'medium', timeStyle: 'short'}).format(atMs);}
  catch {return 'Time unavailable';}
}
type SaveResult = {kind: 'acknowledged'; settingsRevision: number} | {kind: 'refused'; code: ErrorCode} | {kind: 'uncertain'};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** One explicit write. The synced policy, not this reply, confirms the saved version. */
export async function saveArtSchedule(value: ArtScheduleWrite): Promise<SaveResult> {
  try {
    const response = await fetch('/api/v2/automation/art', {method: 'PUT', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: {...childOf(undefined), 'content-type': 'application/json', [REQUEST_HEADER]: '1'}, body: JSON.stringify(value)});
    const answer: unknown = await response.json();
    if (!object(answer)) return {kind: 'uncertain'};
    if (!response.ok) {
      const code = object(answer.error) ? answer.error.code : undefined;
      return isErrorCode(code) && code !== 'internal' && code !== 'uncertain-result' ? {kind: 'refused', code} : {kind: 'uncertain'};
    }
    return answer.schema === 'art-schedule/2.0' && answer.id === 'art' && Number.isSafeInteger(answer.settingsRevision)
      && answer.settingsRevision === value.expectedSettingsRevision + 1
      ? {kind: 'acknowledged', settingsRevision: value.expectedSettingsRevision + 1} : {kind: 'uncertain'};
  } catch {return {kind: 'uncertain'};}
}
