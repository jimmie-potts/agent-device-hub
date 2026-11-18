import {SESSION_RECEIPT_SCHEMA} from '@jimmie-potts/event-contracts/v2/read-receipts';
// The core's `session/2.x` records (Hub #831, #1865): each stored session as the record the core publishes, whose
// freshness holds at the envelope time it is sent with and whose children are counted from the other sessions, as
// packages/event-contracts/MAPPING.md sets it out. The session logic in `session/` keeps the stored sessions; this file
// only projects them, until the core publishes `session/3.0` (#1865 step 9).
import {STALE_AFTER_MS, type Attention, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {countChildren} from './session/children.js';
import type {StoredSession} from './session/model.js';

export const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
export const sessionSchema = (record: SessionRecord): string => record.readReceipt === undefined ? SESSION_SCHEMA : SESSION_RECEIPT_SCHEMA;
export const REMOVAL_SCHEMA = 'https://bunny.invalid/events/removal/2.0';
export const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';

/** A session record as the core projects it, before the revision of its last change is set. */
export type Projected = Omit<SessionRecord, 'revision'>;

/**
 * Freshness at `atMs`, the envelope time: `uncertain` once the core restarted since the session's last evidence, or
 * five minutes or more after it (MAPPING.md, `freshness`).
 */
export const freshnessAt = (lastEvidenceAtMs: number, restartUncertain: boolean, atMs: number): SessionRecord['freshness'] =>
  restartUncertain || atMs - lastEvidenceAtMs >= STALE_AFTER_MS ? 'uncertain' : 'current';

/** One stored session as a 2.0 record at `atMs`, its children not yet counted. */
function projectOne(session: StoredSession, restarted: ReadonlySet<string>, atMs: number): Projected {
  const restartUncertain = restarted.has(session.id);
  const {label, title, project, projectId, readReceipt} = session;
  const hostSessionId = session.parent.status === 'known' ? undefined : session.hostSessionId;
  return {
    id: session.id, generation: session.generation, identity: structuredClone(session.identity), parent: structuredClone(session.parent),
    turn: structuredClone(session.turn), activity: session.activity,
    attention: session.attention.map(({id: attention, kind, turn}): Attention => ({id: structuredClone(attention), kind, turn: structuredClone(turn)})),
    notices: session.notices.map(({id: notice, kind, turn, acknowledgedBy}) => ({id: notice, kind, turn: structuredClone(turn), acknowledgedBy: [...acknowledgedBy]})),
    // A read receipt the session still holds shows it read; without one, its own read evidence does.
    read: readReceipt === undefined ? session.read : 'read',
    unavailable: session.unavailable.map(({dimension, reason}) => ({dimension, reason})),
    ordering: structuredClone(session.ordering),
    observedAtMs: session.observedAtMs, lastEvidenceAtMs: session.lastEvidenceAtMs,
    freshness: freshnessAt(session.lastEvidenceAtMs, restartUncertain, atMs), restartUncertain,
    children: {active: 0, uncertain: 0},
    ...(label === undefined ? {} : {label: {value: label.value, origin: label.origin}}),
    ...(title === undefined ? {} : {title: {value: title.value, source: title.source}}),
    ...(project === undefined ? {} : {project}),
    ...(projectId === undefined ? {} : {projectId}),
    ...(hostSessionId === undefined ? {} : {hostSessionId}),
    ...(readReceipt === undefined ? {} : {readReceipt: structuredClone(readReceipt)}),
  };
}

/** Every stored session as a 2.0 record at `atMs`, by entity ID and in the sessions' order, with the children each parent has. */
export function project(sessions: Iterable<StoredSession>, restarted: ReadonlySet<string>, atMs: number): Map<string, Projected> {
  const records = [...sessions].map(session => projectOne(session, restarted, atMs));
  countChildren(records);
  return new Map(records.map(record => [record.id, record]));
}

/** True when two records differ in anything but the revision. */
export const changed = (stored: SessionRecord | undefined, next: Projected): boolean => {
  if (stored === undefined) return true;
  const {revision: _revision, ...rest} = stored;
  return JSON.stringify(rest) !== JSON.stringify(next);
};

/** The moment a current record's freshness turns uncertain, or undefined when nothing will turn on its own. */
export const turnsUncertainAt = (record: Projected | SessionRecord): number | undefined =>
  record.freshness === 'current' ? record.lastEvidenceAtMs + STALE_AFTER_MS : undefined;
