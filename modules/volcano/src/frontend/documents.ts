// Browser-side checks of the Volcano module's read documents (Hub #616). They hold the same closed shapes as the module's
// schemas, without a schema compiler in the browser bundle. A document that does not match is refused and shown as
// unavailable, so nothing unchecked reaches the card.
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {isErrorCode, type ErrorCode} from '@jimmie-potts/event-contracts/v2/errors';
import type {Session} from '../sessions.js';
import type {VolcanoStatus} from '../status-document.js';

type Check = (value: unknown) => boolean;
type Common = {id: string; revision: number};
export type Edge = 'observed' | 'first-observation' | 'after-gap';
type Stamp = {seq: number; observedAtMs: number; receivedAtMs: number};
export type TimelineFact = Stamp & (
  | {kind: 'heater' | 'pump'; on: boolean; status1: number; edge: Edge}
  | {kind: 'setpoint'; targetDeciC: number}
  | {kind: 'temperature'; currentDeciC: number}
  | {kind: 'counter'; hours: number; minutes: number; totalMinutes: number}
  | {kind: 'link'; state: 'connected' | 'disconnected' | 'unavailable' | 'identity-mismatch' | 'stale'}
  | {kind: 'collector-restart'}
  | {kind: 'gap'; fromMs: number; toMs: number; heaterBefore: 'on' | 'off' | 'unknown'; heaterAfter: 'on' | 'off' | 'unknown'; creditedMinutes: number | null}
  | {kind: 'discontinuity'; reason: 'counter-decrease' | 'counter-jump' | 'identity-mismatch' | 'clock-step'; lastReadingAtMs: number | null}
);
export type TimelineDocument = Common & {schema: 'volcano-timeline/2.0'; facts: TimelineFact[]; next: string | null};
export type SessionsDocument = Common & {schema: 'volcano-sessions/2.0'; gapMinutes: number; preview: boolean; sessions: Session[]; next: string | null};
export type TotalsDay = {date: string; observedHeatingMs: number; creditedMinutes: number; stretches: number; sessions: number; pumpRuns: number};
export type TotalsDocument = Common & {schema: 'volcano-totals/2.0'; zone: string; gapMinutes: number; days: TotalsDay[]; next: string | null};
export type GapBucket = {fromMinutes: number; toMinutes: number | null; count: number; uncertain: number};
export type GapsDocument = Common & {schema: 'volcano-gaps/2.0'; gapMinutes: number; buckets: GapBucket[]};

const OWNER = 'bunny/modules/volcano';
const STATUS_TYPE = 'org.bunny.volcano-status.updated';
const STATUS_SCHEMA = 'https://bunny.invalid/events/volcano-status/2.0';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
function closed(shape: Readonly<Record<string, Check>>): Check {
  const keys = Object.keys(shape);
  return input => object(input) && Reflect.ownKeys(input).length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key), check = shape[key];
    return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor && check !== undefined && check(descriptor.value);
  });
}
const literal = (expected: string): Check => value => value === expected;
const oneOf = (...values: readonly string[]): Check => value => typeof value === 'string' && values.includes(value);
const integer = (minimum: number, maximum: number): Check => value => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const nullable = (check: Check): Check => value => value === null || check(value);
const list = (check: Check, maximum: number): Check => input => Array.isArray(input) && input.length <= maximum && Object.keys(input).length === input.length && input.every(check);
const string = (minimum: number, maximum: number, pattern?: RegExp): Check => value => typeof value === 'string' && value.length >= minimum && value.length <= maximum && (pattern === undefined || pattern.test(value));
const bool: Check = value => typeof value === 'boolean';

const count = integer(0, Number.MAX_SAFE_INTEGER), instant = count, register = integer(0, 65535), deciC = integer(-32768, 65535), gap = integer(1, 240);
const routingId = string(1, 128, /^[a-z0-9]+(-[a-z0-9]+)*$/u), cursor = nullable(string(1, 64));
const onOff = oneOf('on', 'off', 'unknown'), edge = oneOf('observed', 'first-observation', 'after-gap');
const linkState = ['connected', 'disconnected', 'unavailable', 'identity-mismatch', 'stale'] as const;
const base = {id: routingId, revision: count};

const statusCheck = closed({
  schema: literal('volcano-status/2.0'), ...base, configurationRevision: count, availability: oneOf('available', 'unavailable'), link: oneOf(...linkState, 'unknown'),
  observedAtMs: nullable(instant), receivedAtMs: nullable(instant), heater: onOff, pump: onOff, status1: nullable(register), currentDeciC: nullable(deciC), targetDeciC: nullable(deciC),
  heatingCounterMinutes: nullable(count), displayFahrenheit: nullable(bool), gapMinutes: gap, recording: oneOf('ok', 'refused'),
});
const fact = (kind: string, fields: Readonly<Record<string, Check>>): Check => closed({seq: count, kind: literal(kind), observedAtMs: instant, receivedAtMs: instant, ...fields});
const factChecks: readonly Check[] = [
  fact('heater', {on: bool, status1: register, edge}), fact('pump', {on: bool, status1: register, edge}), fact('setpoint', {targetDeciC: deciC}), fact('temperature', {currentDeciC: deciC}),
  fact('counter', {hours: register, minutes: register, totalMinutes: count}), fact('link', {state: oneOf(...linkState)}), fact('collector-restart', {}),
  fact('gap', {fromMs: instant, toMs: instant, heaterBefore: onOff, heaterAfter: onOff, creditedMinutes: nullable(count)}),
  fact('discontinuity', {reason: oneOf('counter-decrease', 'counter-jump', 'identity-mismatch', 'clock-step'), lastReadingAtMs: nullable(instant)}),
];
const span = {startAtMs: instant, startedBeforeObservation: bool, endAtMs: nullable(instant), endedUnobservedBy: nullable(instant), lastObservedOnAtMs: instant, open: bool, observedHeatingMs: count, creditedMinutes: count, pumpRuns: count};
const stretch = closed({...span, unobserved: list(closed({fromMs: instant, toMs: instant, creditedMinutes: nullable(count)}), 8), omittedUnobserved: count});
const session = closed({...span, discontinuities: count, stretches: list(stretch, 32), omittedStretches: count});
const timelineCheck = closed({schema: literal('volcano-timeline/2.0'), ...base, facts: list(value => factChecks.some(check => check(value)), 200), next: cursor});
const sessionsCheck = closed({schema: literal('volcano-sessions/2.0'), ...base, gapMinutes: gap, preview: bool, sessions: list(session, 25), next: cursor});
const totalsCheck = closed({
  schema: literal('volcano-totals/2.0'), ...base, zone: string(1, 64), gapMinutes: gap,
  days: list(closed({date: string(10, 10, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u), observedHeatingMs: count, creditedMinutes: count, stretches: count, sessions: count, pumpRuns: count}), 366), next: cursor,
});
const gapsCheck = closed({schema: literal('volcano-gaps/2.0'), ...base, gapMinutes: gap, buckets: list(closed({fromMinutes: count, toMinutes: nullable(count), count, uncertain: count}), 32)});

export class Refused extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super('The Volcano read was refused.');
    this.code = code;
  }
}
export function refusal(error: unknown): ErrorCode {
  if (error instanceof Refused) return error.code;
  if (typeof error === 'object' && error !== null && 'body' in error) {
    const body: unknown = error.body;
    if (object(body) && object(body.error) && isErrorCode(body.error.code)) return body.error.code;
  }
  return 'unavailable';
}
function checked<T extends Common>(input: unknown, check: Check, expectedId: string | undefined): T {
  if (!check(input)) throw new Refused('invalid-message');
  const value = input as T;
  if (expectedId !== undefined && value.id !== expectedId) throw new Refused('invalid-message');
  return value;
}
export const statusDocument = (input: unknown, expectedId?: string): VolcanoStatus => checked<VolcanoStatus>(input, statusCheck, expectedId);
export const timelineDocument = (input: unknown, expectedId: string): TimelineDocument => checked<TimelineDocument>(input, timelineCheck, expectedId);
export const totalsDocument = (input: unknown, expectedId: string): TotalsDocument => checked<TotalsDocument>(input, totalsCheck, expectedId);
export const gapsDocument = (input: unknown, expectedId: string): GapsDocument => checked<GapsDocument>(input, gapsCheck, expectedId);
export function sessionsDocument(input: unknown, expectedId: string, expectedGap?: number): SessionsDocument {
  const value = checked<SessionsDocument>(input, sessionsCheck, expectedId);
  if (expectedGap !== undefined && value.gapMinutes !== expectedGap) throw new Refused('invalid-message');
  return value;
}
export function messageStatus(message: Message<VolcanoStatus>, expectedId?: string): VolcanoStatus {
  if (message.source !== OWNER || message.kind !== 'state' || message.type !== STATUS_TYPE || message.dataschema !== STATUS_SCHEMA) throw new Refused('invalid-message');
  const doc = statusDocument(message.data, expectedId);
  if (message.subject !== doc.id) throw new Refused('invalid-message');
  return doc;
}
