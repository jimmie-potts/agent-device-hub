// Fixed read projections only (Hub #615). No query selects a file, a raw row or an identifier, every document is checked
// against its closed schema and capped at 256 KiB, and a read writes nothing: a preview threshold regroups one answer.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {fullDisk, SdkError, type ModuleContent, type ModuleContentRequest} from '@jimmie-potts/sdk';
import {MAX_GAP_MINUTES, MIN_GAP_MINUTES} from './facts.js';
import {MAX_DAYS, MAX_SESSIONS, MAX_TIMELINE, validateGaps, validateSessions, validateStatus, validateTimeline, validateTotals} from './families.js';
import {dailyTotals, dayIn, derive, gapDistribution, groupSessions, type Session} from './sessions.js';
import type {VolcanoStatus} from './status.js';
import type {VolcanoStore} from './store.js';

const MAX_BYTES = 256 * 1024;
/** A page stops short of the cap, so one long session moves to the next page instead of refusing the read. */
const PAGE_BYTES = 224 * 1024;
const ZONE = /^[A-Za-z0-9_+./-]{1,64}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SESSIONS_CURSOR = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,14})$/;
const TIMELINE_CURSOR = /^(0|[1-9][0-9]{0,15})-([1-9][0-9]{0,15})$/;

type Code = 'invalid-request' | 'invalid-message' | 'cancelled' | 'too-large' | 'internal' | 'capacity';
const fail = (code: Code): ErrorBody => errorBody(code, {detail: 'The Volcano read was refused.'});

const cancelled = (request: ModuleContentRequest | undefined): boolean => request?.signal.aborted === true;

function decimal(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !/^(0|[1-9]\d*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  status: [], timeline: ['from', 'to', 'cursor', 'limit'], sessions: ['cursor', 'limit', 'gapMinutes'], totals: ['zone', 'cursor', 'limit'], gaps: [],
};

function zoneDay(zone: string | undefined): ((atMs: number) => string) | undefined {
  if (zone === undefined || !ZONE.test(zone)) return undefined;
  try {
    return dayIn(zone);
  } catch {
    return undefined;
  }
}

/**
 * One page, newest stored first. A clock step can put a later session's start before an earlier one's, so the cursor counts
 * positions in the derived order rather than comparing times. New sessions only add after that position, and a cursor names
 * the threshold it counted under, since another threshold groups other sessions.
 */
function sessionsPage(sessions: readonly Session[], remaining: number | undefined, gapMinutes: number, limit: number): {page: Session[]; next: string | null} {
  const newest = sessions.slice(0, remaining ?? sessions.length).reverse();
  const page: Session[] = [];
  let bytes = 0;
  for (const session of newest) {
    const size = Buffer.byteLength(JSON.stringify(session));
    if (page.length >= limit || (page.length > 0 && bytes + size > PAGE_BYTES)) break;
    page.push(session);
    bytes += size;
  }
  return {page, next: newest.length > page.length ? `${String(gapMinutes)}:${String(newest.length - page.length)}` : null};
}

/** Answers one read of `ref`, or undefined for a reference the module does not serve. */
export function readContent(ref: string, request: ModuleContentRequest | undefined, status: VolcanoStatus, store: VolcanoStore, observedThroughMs: number | null): ModuleContent | ErrorBody | undefined {
  const allowed = ALLOWED[ref];
  if (allowed === undefined) return undefined;
  if (cancelled(request)) return fail('cancelled');
  const query = request?.query ?? {};
  if (Object.keys(query).some(key => !allowed.includes(key))) return fail('invalid-request');
  const base = {id: status.id, revision: status.revision};
  try {
    let value: unknown;
    let valid: (candidate: unknown) => boolean;
    switch (ref) {
      case 'status':
        value = status;
        valid = validateStatus;
        break;
      case 'timeline': {
        const limit = query.limit === undefined ? MAX_TIMELINE : decimal(query.limit, 1, MAX_TIMELINE);
        const from = query.from === undefined ? 0 : decimal(query.from, 0, Number.MAX_SAFE_INTEGER);
        const to = query.to === undefined ? Number.MAX_SAFE_INTEGER : decimal(query.to, 0, Number.MAX_SAFE_INTEGER);
        const position = query.cursor === undefined ? undefined : TIMELINE_CURSOR.exec(query.cursor);
        if (limit === undefined || from === undefined || to === undefined || from > to || position === null) return fail('invalid-request');
        const facts = store.timeline(from, to, position === undefined ? undefined : {atMs: Number(position[1]), seq: Number(position[2])}, limit);
        const last = facts.at(-1);
        value = {schema: 'volcano-timeline/2.0', ...base, facts, next: last === undefined || facts.length < limit ? null : `${String(last.observedAtMs)}-${String(last.seq)}`};
        valid = validateTimeline;
        break;
      }
      case 'sessions': {
        const limit = query.limit === undefined ? MAX_SESSIONS : decimal(query.limit, 1, MAX_SESSIONS);
        const position = query.cursor === undefined ? undefined : SESSIONS_CURSOR.exec(query.cursor);
        const preview = query.gapMinutes === undefined ? undefined : decimal(query.gapMinutes, MIN_GAP_MINUTES, MAX_GAP_MINUTES);
        if (limit === undefined || position === null || (query.gapMinutes !== undefined && preview === undefined)) return fail('invalid-request');
        const gapMinutes = preview ?? status.gapMinutes;
        if (position !== undefined && Number(position[1]) !== gapMinutes) return fail('invalid-request');
        const {page, next} = sessionsPage(groupSessions(derive(store.structural(), observedThroughMs), gapMinutes), position === undefined ? undefined : Number(position[2]), gapMinutes, limit);
        value = {schema: 'volcano-sessions/2.0', ...base, gapMinutes, preview: preview !== undefined, sessions: page, next};
        valid = validateSessions;
        break;
      }
      case 'totals': {
        const day = zoneDay(query.zone);
        const limit = query.limit === undefined ? 31 : decimal(query.limit, 1, MAX_DAYS);
        if (day === undefined || query.zone === undefined || limit === undefined || (query.cursor !== undefined && !DATE.test(query.cursor))) return fail('invalid-request');
        const derived = derive(store.structural(), observedThroughMs);
        const all = dailyTotals(derived, groupSessions(derived, status.gapMinutes), query.zone);
        const remaining = query.cursor === undefined ? all : all.filter(({date}) => date < (query.cursor ?? ''));
        const days = remaining.slice(0, limit);
        value = {schema: 'volcano-totals/2.0', ...base, zone: query.zone, gapMinutes: status.gapMinutes, days, next: remaining.length > days.length ? days.at(-1)?.date ?? null : null};
        valid = validateTotals;
        break;
      }
      default:
        value = {schema: 'volcano-gaps/2.0', ...base, gapMinutes: status.gapMinutes, buckets: gapDistribution(derive(store.structural(), observedThroughMs))};
        valid = validateGaps;
    }
    if (!valid(value)) return fail('invalid-message');
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > MAX_BYTES) return fail('too-large');
    if (cancelled(request)) return fail('cancelled');
    return {type: 'application/json', bytes};
  } catch (error) {
    return error instanceof SdkError ? errorBody(error.body.error.code, {detail: 'The Volcano read was refused.'}) : fail(fullDisk(error) ? 'capacity' : 'internal');
  }
}
