// The core's mapping between profile 2.0 and the agent-state owner (Hub #831), as packages/event-contracts/MAPPING.md
// sets it out. A 2.0 `lifecycle` observation becomes the lifecycle 1.2 envelope the agent-state reducer admits, and each
// stored session becomes a `session/2.0` record whose freshness holds at the envelope time it is sent with. The reducer
// stays the reference for what an observation changes; this file only translates.
import type {Envelope, Session} from '@jimmie-potts/agent-state';
import {
  STALE_AFTER_MS, sessionEntityId, type Attention, type Identity, type LifecycleEvent, type LifecycleObservation, type Ordering,
  type SessionRecord,
} from '@jimmie-potts/event-contracts/v2/families';

export const SESSION_SCHEMA = 'https://bunny.invalid/events/session/2.0';
export const REMOVAL_SCHEMA = 'https://bunny.invalid/events/removal/2.0';
export const LIFECYCLE_TYPE = 'org.bunny.lifecycle.observed';

/** A session record as the core projects it, before the revision of its last change is set. */
export type Projected = Omit<SessionRecord, 'revision'>;

/** What the core knows about sessions beyond the agent-state store: restart uncertainty and each host session ID. */
export type View = {
  /** Session entity IDs loaded at the core's start that have had no fresh lifecycle evidence since. */
  readonly restarted: ReadonlySet<string>;
  /** The latest host session ID of each root session (lifecycle 1.2), by entity ID. */
  readonly hostSessions: ReadonlyMap<string, string>;
};

/** The 1.x event the reducer admits for a 2.0 lifecycle event: the same evidence, with its dotted kind. */
function eventOf(event: LifecycleEvent): Envelope['event'] {
  switch (event.kind) {
    case 'session-started':
      return {kind: 'session.started'};
    case 'turn-started':
      return {kind: 'turn.started'};
    case 'activity-observed':
      return {kind: 'activity.observed'};
    case 'turn-ended':
      return {kind: 'turn.ended'};
    case 'turn-interrupted':
      return {kind: 'turn.interrupted'};
    case 'runtime-ended':
      return {kind: 'runtime.ended'};
    case 'question-continuing':
      return {kind: 'question.continuing', attention: event.attention};
    case 'attention-input':
      return {kind: 'attention.input', attention: event.attention};
    case 'attention-approval':
      return {kind: 'attention.approval', attention: event.attention};
    case 'attention-resolved':
      return {kind: 'attention.resolved', attention: event.attention};
    case 'read-observed':
      return {kind: 'read.observed', state: event.state};
    case 'evidence-unavailable':
      return {kind: 'evidence.unavailable', dimension: event.dimension, reason: event.reason};
  }
}

/**
 * The lifecycle 1.2 envelope for a 2.0 observation. `nativeEventId` is 1.x's `eventId`, and known ordering drops the
 * `authority` that 2.0 adds, since the reducer scopes a sequence to its source already. Every observation becomes a 1.2
 * envelope, so a root observation without a host session ID clears the one held, as a 1.2 event does.
 */
export function toEnvelope(observation: LifecycleObservation): Envelope {
  const {identity, turn, parent, nativeEventId, event, observedAtMs, occurredAtMs, ordering, projectId, label, title, project, hostSessionId} = observation;
  return {
    apiVersion: '1.2', identity, turn, parent,
    ...(nativeEventId === undefined ? {} : {eventId: nativeEventId}),
    event: eventOf(event), observedAtMs,
    ...(occurredAtMs === undefined ? {} : {occurredAtMs}),
    ordering: ordering.status === 'known' ? {status: 'known', epoch: ordering.epoch, sequence: ordering.sequence} : {status: 'unknown'},
    ...(projectId === undefined ? {} : {projectId}),
    ...(label === undefined ? {} : {label}),
    ...(title === undefined ? {} : {title}),
    ...(project === undefined ? {} : {project}),
    ...(hostSessionId === undefined ? {} : {hostSessionId}),
  };
}

/** The 1.x event kind a 2.0 observation reduces as, as the reducer's journal names it. */
export const reducedKind = (observation: LifecycleObservation): string => eventOf(observation.event).kind;

/** 2.0 ordering for a session's identity: known ordering names its source as the authority. */
export function orderingOf(identity: Identity, ordering: Session['ordering']): Ordering {
  return ordering.status === 'known' ? {status: 'known', authority: identity.sourceId, epoch: ordering.epoch, sequence: ordering.sequence} : {status: 'unknown'};
}

/** A session's entity ID, from its agent-state identity. */
export const entityOf = (session: Pick<Session, 'identity'>): string => sessionEntityId(session.identity);

/**
 * Freshness at `atMs`, the envelope time: `uncertain` once the owner restarted since the session's last evidence, or
 * five minutes or more after it (MAPPING.md, `freshness`).
 */
export const freshnessAt = (lastEvidenceAtMs: number, restartUncertain: boolean, atMs: number): SessionRecord['freshness'] =>
  restartUncertain || atMs - lastEvidenceAtMs >= STALE_AFTER_MS ? 'uncertain' : 'current';

/** One stored session as a 2.0 record at `atMs`, its children not yet counted. */
function projectOne(session: Session, view: View, atMs: number): Projected {
  const id = entityOf(session);
  const restartUncertain = view.restarted.has(id);
  const hostSessionId = session.parent.status === 'known' ? undefined : view.hostSessions.get(id);
  const {label, labelOrigin, title, project, projectId} = session;
  return {
    id, generation: session.generation ?? 0, identity: session.identity, parent: session.parent, turn: session.turn,
    // Only stores the reducer wrote before every path retired on an accepted end hold `ended`; startup settles them, so
    // a record never reaches here with it. It has no 2.0 value, and the core never claims activity it does not know.
    activity: session.activity === 'ended' ? 'unknown' : session.activity,
    attention: session.attention.map(({id: attention, kind, turn}): Attention => ({id: attention, kind, turn})),
    notices: session.notices.map(({id: notice, kind, turn, acknowledgedBy}) => ({id: notice, kind, turn, acknowledgedBy: [...acknowledgedBy]})),
    read: session.read,
    unavailable: session.unavailable.map(({dimension, reason}) => ({dimension, reason})),
    ordering: orderingOf(session.identity, session.ordering),
    observedAtMs: session.observedAtMs, lastEvidenceAtMs: session.lastEvidenceAtMs,
    freshness: freshnessAt(session.lastEvidenceAtMs, restartUncertain, atMs), restartUncertain,
    children: {active: 0, uncertain: 0},
    // Snapshot 1.2's precedence: a stored label without an origin is the user's.
    ...(label === undefined ? {} : {label: {value: label, origin: labelOrigin ?? 'user'}}),
    ...(title === undefined ? {} : {title}),
    ...(project === undefined ? {} : {project}),
    ...(projectId === undefined ? {} : {projectId}),
    ...(hostSessionId === undefined ? {} : {hostSessionId}),
  };
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.provider === b.provider && a.client === b.client && a.hostId === b.hostId && a.sourceId === b.sourceId && a.sessionId === b.sessionId;

/**
 * Each known child's count on its parent, as agent-state's `childCounts` derives it for snapshots (copied from
 * packages/agent-state/src/children.ts): missing or contradictory evidence is uncertain, never active.
 */
function countChildren(records: Projected[]): void {
  for (const parent of records) {
    const counts = {active: 0, uncertain: 0};
    for (const child of records) {
      if (child.parent.status !== 'known' || !sameIdentity(child.parent.identity, parent.identity) ||
        child.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) continue;
      const uncertain = child.activity === 'unknown' || child.unavailable.some(item => item.dimension === 'activity' ||
        ((item.dimension === 'turn' || item.dimension === 'ordering') && item.reason === 'ambiguous'));
      if (uncertain) counts.uncertain += 1;
      else if (child.activity === 'active') counts[child.freshness === 'current' ? 'active' : 'uncertain'] += 1;
    }
    parent.children = counts;
  }
}

/** Every stored session as a 2.0 record at `atMs`, by entity ID, with the children each parent has. */
export function project(sessions: readonly Session[], view: View, atMs: number): Map<string, Projected> {
  const records = sessions.map(session => projectOne(session, view, atMs));
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

const sameItem = (a: Attention, b: Attention): boolean => JSON.stringify([a.kind, a.id, a.turn]) === JSON.stringify([b.kind, b.id, b.turn]);
/** The attention items `after` holds that `before` did not. */
export const attentionAdded = (before: readonly Attention[], after: readonly Attention[]): Attention[] =>
  after.filter(item => !before.some(old => sameItem(old, item)));
