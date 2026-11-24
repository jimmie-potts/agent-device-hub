// The core's `session/3.0` records (Hub #1865, design decisions 3 and 5): each stored session's public part as the record
// the core publishes, with its children counted from the other sessions and its status computed by the contracts
// package's `buildSession`. A record publishes when its public meaning changes. Its evidence time is part of that meaning
// at a coarse resolution (Hub #1947): a change of instants alone publishes only once `lastEvidenceAtMs` has moved
// `SESSION_LIMITS.evidenceResolutionMs` past the published record's, so a busy session's published evidence time is
// current enough to show its evidence age, and progress between publications writes the session only.
import type {Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession} from '@jimmie-potts/event-contracts/v2/session';
import {countChildren} from './children.js';
import {SESSION_LIMITS, type StoredSession} from './model.js';

/** Why running work is unconfirmed without evidence saying so: a core restart, the only such reason. */
const unconfirmedBy = (session: StoredSession): {unconfirmed?: 'restart'} => session.restartUnconfirmed === true ? {unconfirmed: 'restart'} : {};

/** Every stored session as its record at `revision`, by entity ID and in the sessions' order. */
export function publicRecords(sessions: Iterable<StoredSession>, revision: number): Map<string, Session30Record> {
  const stored = [...sessions];
  const children = countChildren(stored);
  return new Map(stored.map(session => {
    const {label, title, project, projectId, readReceipt, companions} = session;
    const hostSessionId = session.parent.status === 'known' ? undefined : session.hostSessionId;
    const record = buildSession({
      id: session.id, revision, generation: session.generation, identity: structuredClone(session.identity), parent: structuredClone(session.parent),
      turn: structuredClone(session.turn), work: session.activity, ...unconfirmedBy(session),
      attention: session.attention.map(({id, kind, turn}) => ({id: structuredClone(id), kind, turn: structuredClone(turn)})),
      notices: session.notices.map(({id, kind, turn, acknowledgedBy, result}) => ({id, kind, turn: structuredClone(turn), acknowledgedBy: [...acknowledgedBy],
        ...(result === undefined ? {} : {result})})),
      // A read receipt the session still holds shows it read; without one, its own read evidence does.
      read: readReceipt === undefined ? session.read : 'read',
      ...(readReceipt === undefined ? {} : {readReceipt: structuredClone(readReceipt)}),
      children: children.get(session.id) ?? {working: 0, unconfirmed: 0},
      unavailable: session.unavailable.map(({dimension, reason}) => ({dimension, reason})),
      ordering: structuredClone(session.ordering),
      observedAtMs: session.observedAtMs, lastEvidenceAtMs: session.lastEvidenceAtMs,
      ...(label === undefined ? {} : {label: {value: label.value, origin: label.origin}}),
      ...(title === undefined ? {} : {title: {value: title.value, source: title.source}}),
      ...(project === undefined ? {} : {project}),
      ...(projectId === undefined ? {} : {projectId}),
      ...(hostSessionId === undefined ? {} : {hostSessionId}),
      ...(companions === undefined ? {} : {companions: companions.map(({id, name}) => ({id, name}))}),
    });
    return [record.id, record];
  }));
}

/** A record's public meaning: everything but its revision and its instants. */
function meaning(record: Session30Record): string {
  const {revision: _revision, observedAtMs: _observed, lastEvidenceAtMs: _evidence, work, attention, outcome, ...rest} = record;
  const {evidenceAtMs: _work, ...workClaim} = work;
  const {evidenceAtMs: _attention, ...attentionClaim} = attention;
  const {evidenceAtMs: _outcome, ...outcomeClaim} = outcome;
  return JSON.stringify({...rest, work: workClaim, attention: attentionClaim, outcome: outcomeClaim});
}

/**
 * Whether `next` changes the public meaning of the record last published, which publishes it at a new revision: any
 * member but its revision and instants changed, or its evidence time moved at least `evidenceResolutionMs` past the
 * published one (Hub #1947). The store publishes a session whose stored record a release before the switch published
 * (`session/2.x`) whatever this says.
 */
export function meaningChanged(published: Session30Record | undefined, next: Session30Record): boolean {
  return published === undefined || meaning(published) !== meaning(next) ||
    next.lastEvidenceAtMs - published.lastEvidenceAtMs >= SESSION_LIMITS.evidenceResolutionMs;
}
