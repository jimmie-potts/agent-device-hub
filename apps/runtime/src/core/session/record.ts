// The core's `session/3.0` records (Hub #1865, design decisions 3 and 5): each stored session's public part as the record
// the core publishes, with its children counted from the other sessions and its status computed by the contracts
// package's `buildSession`. A record publishes only when its public meaning changes: a change of instants alone, such as
// a work observation that only advances the private progress time, is no change, so a record's `lastEvidenceAtMs` is the
// evidence time of its last published change.
import type {Session30Record} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession} from '@jimmie-potts/event-contracts/v2/session';
import {countChildren} from './children.js';
import type {StoredSession} from './model.js';

/** Why running work is unconfirmed without evidence saying so: a core restart, or its passed deadline. */
const unconfirmedBy = (session: StoredSession): {unconfirmed?: 'restart' | 'deadline'} =>
  session.restartUnconfirmed === true ? {unconfirmed: 'restart'} : session.deadlineUnconfirmed === true ? {unconfirmed: 'deadline'} : {};

/** Every stored session as its record at `revision`, by entity ID and in the sessions' order. */
export function publicRecords(sessions: Iterable<StoredSession>, revision: number): Map<string, Session30Record> {
  const stored = [...sessions];
  const children = countChildren(stored);
  return new Map(stored.map(session => {
    const {label, title, project, projectId, readReceipt} = session;
    const hostSessionId = session.parent.status === 'known' ? undefined : session.hostSessionId;
    const record = buildSession({
      id: session.id, revision, generation: session.generation, identity: structuredClone(session.identity), parent: structuredClone(session.parent),
      turn: structuredClone(session.turn), work: session.activity, ...unconfirmedBy(session),
      attention: session.attention.map(({id, kind, turn}) => ({id: structuredClone(id), kind, turn: structuredClone(turn)})),
      notices: session.notices.map(({id, kind, turn, acknowledgedBy}) => ({id, kind, turn: structuredClone(turn), acknowledgedBy: [...acknowledgedBy]})),
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
 * Whether `next` changes the public meaning of the record last published, which publishes it at a new revision. A
 * record a release before the switch published (`session/2.x`, with no status) always differs.
 */
export function meaningChanged(published: Session30Record | undefined, next: Session30Record): boolean {
  if (published === undefined || !('status' in published)) return true;
  return meaning(published) !== meaning(next);
}
