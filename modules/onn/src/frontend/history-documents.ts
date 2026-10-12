// Browser guards for the module-owned history-contract.ts schemas. No runtime code generation.
import type {HistoryState, HistoryPage, HistoryDetail} from '../history-types.js';
export type HistoryRecord = HistoryState & {id: string; revision: number; configurationRevision: number};
type Guard = (value: unknown) => boolean;
const integer: Guard = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const boolean: Guard = value => typeof value === 'boolean';
const oneOf = (...choices: readonly unknown[]): Guard => value => choices.includes(value);
const text = (maximum: number, pattern?: RegExp): Guard => value => typeof value === 'string' && [...value].length <= maximum && (pattern === undefined || pattern.test(value));
const identifier = text(128, /^[A-Za-z0-9_.-]{1,128}$/);
const nullable = (guard: Guard): Guard => value => value === null || guard(value);
const list = (guard: Guard, maximum: number): Guard => value => Array.isArray(value) && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1 && Array.from({length:value.length},(_,index) => Object.getOwnPropertyDescriptor(value,String(index))).every(descriptor => descriptor?.enumerable === true && Object.hasOwn(descriptor,'value') && guard(descriptor.value));
const closed = (value: unknown, fields: Record<string, Guard>): boolean => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const names = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return names.length === Object.keys(fields).length && names.every(name => {
    if (typeof name !== 'string' || !Object.hasOwn(fields, name)) return false;
    const descriptor = descriptors[name];
    const guard = fields[name];
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') && guard !== undefined && guard(descriptor.value);
  });
};
const intake = {intakeId: identifier, runId: identifier, poll: integer, receivedAtMs: integer};
const reader: Guard = value => closed(value, {sha256: text(64,/^[a-f0-9]{64}$/), sourceVersion: text(128)});
const accepted = {...intake, sequence: integer, deviceElapsedMs: integer, reader};
const fields = ['title','displayTitle','subtitle','artist','album','genre','description','mediaId'] as const;
const metadata: Guard = nullable(value => closed(value, {...Object.fromEntries(fields.map(field => [field, nullable(text(512))])), durationMs: nullable(integer)}));
const playback: Guard = nullable(value => closed(value, {
  state: value => integer(value) && (value as number) <= 11,
  positionMs: value => typeof value === 'number' && Number.isSafeInteger(value) && value >= -1,
  speed: value => typeof value === 'number' && Number.isFinite(value), positionUpdatedElapsedMs: integer,
}));
const omission: Guard = value => closed(value, {field: oneOf(...fields), reason: oneOf('credential-redacted','oversized')});
const projectionOmission: Guard = value => closed(value, {field: oneOf(...fields), reason: oneOf('projection-limit'), originalBytes: integer});
const session = {app: oneOf('youtube','stremio'), metadata, playback, omissions: list(omission,16), projectionOmissions: list(projectionOmission,8)};
const gap: Guard = value => closed(value, {...intake, sequence: integer, reason: oneOf('startup','unavailable','busy','storage','clock')});
const coverage: Guard = value => closed(value, {
  collectionStartedAtMs: nullable(integer), gapCount: integer, recentGaps: list(gap,20), storageAvailable: boolean,
  pendingGap: nullable(value => closed(value, {...intake, reason: oneOf('storage')})),
  limits: value => closed(value, Object.fromEntries(Object.entries({pollMs:5000,staleMs:15000,candidates:500,textBytes:512,responseBytes:131072,recentGaps:20,sourceSessions:8,sourceTextBytes:8192,sourceReplyBytes:262144}).map(([key,limit]) => [key,oneOf(limit)]))),
  semantics: oneOf('observations-only'),
});
const provenance: Guard = value => closed(value, {source: oneOf('android-media-session'), readerSchema: oneOf('onn-metadata/2.0'), semantics: oneOf('selected-title-observed','title-observed')});
const observation: Guard = value => closed(value, {...accepted,...session,id:text(128,/^obs-[1-9][0-9]*$/),provenance});
const occurrence: Guard = value => closed(value, {
  id:text(128,/^occ-[1-9][0-9]*$/),app:session.app,firstObservedAtMs:integer,matchingObservedAtMs:integer,
  identityConfidence:oneOf('unsupported','source-id','ambiguous'),observation,
});
const page = {cutoff:integer,nextCursor:nullable(text(4096)),coverage,pageOmissions:list(value => closed(value,{reason:oneOf('response-limit'),continuation:oneOf(true)}),1)};
const state = {schema:oneOf('onn-history-state/2.0'),enabled:boolean,status:oneOf('disabled','fresh','stale','unavailable'),current:list(value => closed(value,session),8),ambiguous:boolean,currentEvidence:oneOf('fresh-observation','last-observed','none'),lastAccepted:nullable(value => closed(value,accepted)),coverage};
const bounded = (value: unknown, guard: Guard): boolean => {
  try {return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 131072 && guard(value);} catch {return false;}
};
export const readState = (value: unknown): HistoryState | undefined => bounded(value, value => closed(value,state)) ? value as HistoryState : undefined;
export const readRecord = (value: unknown): HistoryRecord | undefined => bounded(value, value => closed(value,{...state,id:text(128,/^[a-z0-9]+(?:-[a-z0-9]+)*$/),revision:integer,configurationRevision:value => integer(value) && (value as number) >= 1})) ? value as HistoryRecord : undefined;
export const readPage = (value: unknown): HistoryPage | undefined => bounded(value, value => closed(value,{schema:oneOf('onn-history/2.0'),...page,ordering:oneOf('evidence-desc'),items:list(occurrence,100)})) ? value as HistoryPage : undefined;
export const readDetail = (value: unknown): HistoryDetail | undefined => bounded(value, value => closed(value,{schema:oneOf('onn-history-detail/2.0'),...page,occurrence,observations:list(observation,100)})) ? value as HistoryDetail : undefined;
