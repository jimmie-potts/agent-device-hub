// One observation's effect on one session (Hub #1865, design decision 1): agent-state's reducer
// (packages/agent-state/src/reducer.ts), ported to take 2.0 `lifecycle` observations and to keep the 2.0 shapes. Its rules
// are unchanged: semantic duplicates and collisions, ordering watermarks and epochs, turn selection and retirement,
// approvals without a request ID, notices and the consumers a new turn acknowledges for. Semantic keys hash the
// observation's canonical content; no 1.x key form is kept, since the step that moved here dropped the old session data.
// One rule changed on purpose (#1865 step 8, design decision 6, #397): a root start claims no work. Hub #505 adds the
// common inputs of `lifecycle/2.2` (`turn-waiting`, `turn-uncertain` and a turn end's result) and lets an ordered,
// newer turn start recover the turn and activity evidence, as a best-effort start already does, and ordered work
// evidence on the same turn, newer than the marker that made the activity lost, settle it. Hub #2021 bounds what a session
// that keeps taking turns accumulates: past the notice limit a turn end retires superseded notices, and past the watermark
// limit the session keeps a floor for the watermarks of attention it no longer holds, so only notices that still count can
// reach the limit.
import {createHash} from 'node:crypto';
import type {Attention, KnownId, LifecycleObservation, Unavailable} from '@jimmie-potts/event-contracts/v2/families';
import {noticeCounts} from '@jimmie-potts/event-contracts/v2/session-view';
import {SESSION_LIMITS, entityOf, sameId, sameTurn, type Consumer, type StoredSession} from './model.js';

/** What one observation did to a session: its outcome, the session after it when it changed, and whether it was fresh evidence. */
export type Reduction = {outcome: 'applied' | 'duplicate' | 'stale' | 'ambiguous'; session?: StoredSession; fresh: boolean; capacity?: boolean};

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function canonical(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

/**
 * An observation's semantic key: with a native event ID, its identity, turn and that ID; otherwise its whole content.
 * The same observation always has the same key, whatever the order of its members.
 */
export function semanticKey(observation: LifecycleObservation): string {
  const material = observation.nativeEventId === undefined ? observation
    : {identity: observation.identity, turn: observation.turn, nativeEventId: observation.nativeEventId};
  return sha256(canonical(material));
}

/** The identity as agent-state keyed it, which notice IDs keep. */
export const identityKey = (identity: StoredSession['identity']): string =>
  JSON.stringify([identity.provider, identity.client, identity.hostId, identity.sourceId, identity.sessionId]);

/** Records an unavailable dimension. An ambiguous one stays ambiguous until something clears it. */
export function unavailable(session: StoredSession, dimension: Unavailable['dimension'], reason: Unavailable['reason']): void {
  if (session.unavailable.some(item => item.dimension === dimension && item.reason === 'ambiguous') && reason !== 'ambiguous') return;
  session.unavailable = session.unavailable.filter(item => item.dimension !== dimension);
  session.unavailable.push({dimension, reason});
}

function dimension(observation: LifecycleObservation): string {
  const event = observation.event;
  if ('attention' in event) return `attention:${event.attention.status === 'known' ? event.attention.id : event.kind}`;
  if (event.kind === 'read-observed') return 'read';
  if (event.kind === 'evidence-unavailable') return `unavailable:${event.dimension}`;
  return 'activity';
}

function retire(session: StoredSession, turn: KnownId): void {
  if (turn.status === 'known' && !session.retiredTurns.includes(turn.id)) {
    session.retiredTurns.push(turn.id);
    session.retiredTurns = session.retiredTurns.slice(-SESSION_LIMITS.retiredTurns);
  }
}

/** A newer turn proves that an approval without a request ID on a retired turn was answered. */
export const retiredApproval = (session: StoredSession, item: Attention): boolean => item.kind === 'approval' && item.id.status === 'unknown' &&
  item.turn.status === 'known' && session.retiredTurns.includes(item.turn.id);

export function forgetRetiredApprovals(session: StoredSession): void {
  session.attention = session.attention.filter(item => !retiredApproval(session, item));
}

/** A completed tool or the end of turn T proves that T's approvals without a request ID were answered. */
function forgetAnsweredApprovals(session: StoredSession, turn: KnownId): void {
  if (turn.status === 'known') {
    session.attention = session.attention.filter(item => !(item.kind === 'approval' && item.id.status === 'unknown' && sameTurn(item.turn, turn)));
  }
}

function mergeMetadata(session: StoredSession, observation: LifecycleObservation): {changed: boolean; ambiguous: boolean} {
  let changed = false, ambiguous = false;
  const parent = observation.parent;
  if (parent.status !== 'unknown') {
    const matches = session.parent.status === parent.status && (parent.status !== 'known' ||
      session.parent.status === 'known' && identityKey(session.parent.identity) === identityKey(parent.identity));
    if (session.unavailable.some(item => item.dimension === 'parent' && item.reason === 'ambiguous')) {
      changed = session.parent.status !== 'unknown';
      session.parent = {status: 'unknown'};
      ambiguous = true;
    } else if (!matches) {
      changed = true;
      if (session.parent.status !== 'unknown') {
        session.parent = {status: 'unknown'};
        unavailable(session, 'parent', 'ambiguous');
        ambiguous = true;
      } else session.parent = structuredClone(parent);
    }
  }
  if (observation.observedAtMs >= (session.metadataObservedAtMs ?? 0)) {
    const {label, title, project, projectId} = observation;
    if (label !== undefined && (label.origin === 'user' || session.label === undefined || session.label.origin === 'agent') &&
      (session.label?.value !== label.value || session.label.origin !== label.origin)) {
      session.label = {value: label.value, origin: label.origin};
      changed = true;
    }
    if (title !== undefined && (session.title?.value !== title.value || session.title.source !== title.source)) {
      session.title = {value: title.value, source: title.source};
      changed = true;
    }
    if (project !== undefined && session.project !== project) {
      session.project = project;
      changed = true;
    }
    if (projectId !== undefined && projectId !== '' && session.projectId !== projectId) {
      session.projectId = projectId;
      changed = true;
    }
    if (title !== undefined || project !== undefined || label !== undefined || (projectId !== undefined && projectId !== '')) {
      if (session.metadataObservedAtMs !== observation.observedAtMs) changed = true;
      session.metadataObservedAtMs = observation.observedAtMs;
    }
  }
  return {changed, ambiguous};
}

function selectTurn(session: StoredSession, turn: KnownId, consumers: readonly Consumer[], recover = false): void {
  const oldTurn = session.turn;
  if (!sameTurn(oldTurn, turn)) retire(session, oldTurn);
  for (const notice of session.notices) {
    if (notice.turn.status === 'unknown' || sameTurn(notice.turn, turn) || (!recover && !sameTurn(notice.turn, oldTurn))) continue;
    for (const consumer of consumers) if (consumer.clearOnNewTurn && !notice.acknowledgedBy.includes(consumer.id)) notice.acknowledgedBy.push(consumer.id);
  }
  session.turn = structuredClone(turn);
  if (recover) session.unavailable = session.unavailable.filter(item => item.dimension !== 'turn' && item.dimension !== 'activity');
}

/**
 * Hub #2021: past `SESSION_LIMITS.notices`, retires superseded notices until the session holds the limit: those every
 * consumer acknowledged first, then the oldest. A superseded notice is one `noticeCounts` no longer counts, so no status,
 * reader, opportunity, read receipt or override depends on it; its turn end stays in history. A notice that still counts
 * is never retired, so a session whose counting notices alone pass the limit stays past it and is refused.
 */
function retireSuperseded(session: StoredSession, consumers: readonly Consumer[]): void {
  const excess = session.notices.length - SESSION_LIMITS.notices;
  if (excess <= 0) return;
  const superseded = session.notices.filter(notice => !noticeCounts(notice, session.turn));
  const settled = (notice: StoredSession['notices'][number]): boolean => consumers.every(consumer => notice.acknowledgedBy.includes(consumer.id));
  const retiring = new Set([...superseded.filter(settled), ...superseded.filter(notice => !settled(notice))].slice(0, excess).map(notice => notice.id));
  session.notices = session.notices.filter(notice => !retiring.has(notice.id));
}

/**
 * The reserved watermark dimension of an epoch's floor (Hub #2021): the highest sequence of the watermarks the session
 * dropped in that epoch. No observation's dimension has this name. A release before the floor never matches it.
 */
export const WATERMARK_FLOOR = 'floor';

/** The attention dimensions whose items the session holds: a known item's own, and an unknown one's event kinds. */
function heldDimensions(session: StoredSession): Set<string> {
  const held = new Set<string>();
  for (const item of session.attention) {
    if (item.id.status === 'known') held.add(`attention:${item.id.id}`);
    else for (const kind of ['question-continuing', 'attention-input', 'attention-approval', 'attention-resolved']) held.add(`attention:${kind}`);
  }
  return held;
}

/**
 * Hub #2021: past `SESSION_LIMITS.watermarks`, drops the watermarks of attention the session no longer holds, lowest
 * sequence first, and raises its epoch's floor to each one dropped. An ordered observation at or below its epoch's floor
 * in a dimension without its own watermark is older than evidence the session already took, so it is stale.
 */
function boundWatermarks(session: StoredSession): void {
  if (session.watermarks.length <= SESSION_LIMITS.watermarks) return;
  const held = heldDimensions(session);
  const dropping = session.watermarks.filter(item => item.dimension.startsWith('attention:') && !held.has(item.dimension))
    .sort((a, b) => a.sequence - b.sequence);
  for (const victim of dropping) {
    if (session.watermarks.length <= SESSION_LIMITS.watermarks) break;
    session.watermarks = session.watermarks.filter(item => item !== victim);
    const floor = session.watermarks.find(item => item.dimension === WATERMARK_FLOOR && item.epoch === victim.epoch);
    if (floor !== undefined) floor.sequence = Math.max(floor.sequence, victim.sequence);
    else session.watermarks.push({dimension: WATERMARK_FLOOR, epoch: victim.epoch, sequence: victim.sequence});
  }
}

/** A new session for an observation: unknown activity, and the observation's identity, turn, parent and ordering. */
function created(observation: LifecycleObservation, now: number, generation: number): StoredSession {
  return {
    id: entityOf(observation.identity), generation, identity: structuredClone(observation.identity), turn: structuredClone(observation.turn),
    parent: structuredClone(observation.parent), activity: 'unknown', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: structuredClone(observation.ordering), lastEvidenceAtMs: now, observedAtMs: observation.observedAtMs, retiredTurns: [], seen: [], watermarks: [],
  };
}

/**
 * Reduces one observation on the session it names, `previous` when the core holds it, at the core's instant `now`. A
 * new session takes `generation`. The session passed in is never changed.
 */
export function reduceSession(previous: StoredSession | undefined, observation: LifecycleObservation, now: number, consumers: readonly Consumer[],
  generation: number): Reduction {
  const key = semanticKey(observation);
  const {nativeEventId: _native, ...withoutId} = observation;
  const content = semanticKey(withoutId);
  const collisionKey = sha256(JSON.stringify(['collision', key, content]));
  if (previous?.seen.some(entry => entry.key === collisionKey) === true) return {outcome: 'duplicate', fresh: false};
  const seen = previous?.seen.find(entry => entry.key === key);
  if (seen !== undefined && previous !== undefined) {
    if (seen.content === content) return {outcome: 'duplicate', fresh: false};
    const session = structuredClone(previous);
    unavailable(session, 'ordering', 'ambiguous');
    session.seen.push({key: collisionKey, content});
    session.seen = session.seen.slice(-SESSION_LIMITS.seen);
    return {session, outcome: 'ambiguous', fresh: false};
  }
  // A root start (#397): a SessionStart is not work, so it selects no turn and leaves a known root's work as it was.
  // Only a start under a known parent, a child start, keeps the meaning of evidenced child work.
  const rootStart = observation.event.kind === 'session-started' && observation.parent.status !== 'known';
  const session: StoredSession = previous === undefined ? created(observation, now, generation) : structuredClone(previous);
  // A new root starts with no work turn, whatever turn its start carries, such as a /resume command's prompt ID.
  if (rootStart && previous === undefined) session.turn = {status: 'unknown'};
  const remember = (): void => {
    session.seen.push({key, content});
    session.seen = session.seen.slice(-SESSION_LIMITS.seen);
  };
  const repeatedActivity = (unchanged: 'duplicate' | 'stale' = 'duplicate'): Reduction => {
    const metadata = mergeMetadata(session, observation);
    if (!metadata.changed) return {outcome: unchanged, fresh: false};
    remember();
    return {session, outcome: metadata.ambiguous ? 'ambiguous' : 'applied', fresh: false};
  };
  const event = observation.event;
  const eventDimension = dimension(observation);
  // Read evidence applies only to the read dimension; it is not a lifecycle observation.
  const lifecycle = eventDimension !== 'read';
  const order = observation.ordering;
  const turn = observation.turn;
  const retired = turn.status === 'known' && session.retiredTurns.includes(turn.id);
  if (retired && eventDimension === 'activity') return {outcome: 'stale', fresh: false};
  const completed = turn.status === 'known' && session.notices.some(notice => sameTurn(notice.turn, turn));
  if (order.status === 'unknown' && eventDimension === 'activity') {
    if (completed && event.kind === 'turn-ended') return sameTurn(session.turn, turn) ? repeatedActivity() : {outcome: 'duplicate', fresh: false};
    if (completed && (event.kind === 'turn-started' || event.kind === 'activity-observed')) {
      return sameTurn(session.turn, turn) ? repeatedActivity('stale') : {outcome: 'stale', fresh: false};
    }
    if (previous !== undefined && event.kind === 'turn-started' && sameTurn(previous.turn, turn) &&
      (previous.activity !== 'unknown' || previous.unavailable.some(item => item.dimension === 'activity' && item.reason === 'ambiguous'))) return repeatedActivity();
  }
  const watermark = order.status === 'known' ? session.watermarks.find(item => item.dimension === eventDimension && item.epoch === order.epoch) : undefined;
  if (order.status === 'known' && watermark !== undefined && order.sequence <= watermark.sequence) return {outcome: 'stale', fresh: false};
  const floor = order.status === 'known' && watermark === undefined ? session.watermarks.find(item => item.dimension === WATERMARK_FLOOR && item.epoch === order.epoch) : undefined;
  if (order.status === 'known' && floor !== undefined && order.sequence <= floor.sequence) return {outcome: 'stale', fresh: false};
  const orderedActivity = eventDimension === 'activity' && watermark !== undefined;
  const bestEffort = order.status === 'unknown' && !session.watermarks.some(item => item.dimension === 'activity') && session.ordering.status === 'unknown';
  const selectedStart = bestEffort && event.kind === 'turn-started' && turn.status === 'known';
  const matchingStop = bestEffort && event.kind === 'turn-ended' && sameTurn(session.turn, turn) &&
    !session.unavailable.some(item => item.dimension === 'activity' && item.reason === 'ambiguous');
  const canSelect = lifecycle && !retired && !rootStart && (eventDimension === 'activity' || order.status === 'known');
  let ambiguous = false;
  if (selectedStart) selectTurn(session, turn, consumers, true);
  else if (canSelect && previous !== undefined && turn.status === 'known' && session.turn.status === 'known' && !sameTurn(turn, session.turn)) {
    const prior = previous.ordering;
    const comparable = order.status === 'known' && prior.status === 'known' && order.epoch === prior.epoch;
    if (comparable && prior.status === 'known' && order.sequence <= prior.sequence) return {outcome: 'stale', fresh: false};
    if (comparable) {
      // An ordered, newer start is as good evidence of the new turn as a best-effort one (Hub #505). No producer sent
      // known ordering before the native assistant source, so only its sessions take this path today.
      selectTurn(session, turn, consumers, event.kind === 'turn-started');
    } else {
      // Only an eligible start can select by receipt order. Other conflicts stay unknown.
      if (bestEffort) retire(session, session.turn);
      session.turn = {status: 'unknown'};
      ambiguous = true;
      unavailable(session, 'turn', 'ambiguous');
      unavailable(session, 'ordering', 'ambiguous');
    }
  } else if (canSelect && session.turn.status === 'unknown' && turn.status === 'known') {
    if (session.unavailable.some(item => item.dimension === 'turn' && item.reason === 'ambiguous')) ambiguous = true;
    else session.turn = structuredClone(turn);
  }
  if (lifecycle && (turn.status === 'unknown' || rootStart && previous === undefined)) unavailable(session, 'turn', 'missing');
  if (order.status === 'unknown') {
    if (lifecycle) {
      if (!retired) session.ordering = {status: 'unknown'};
      unavailable(session, 'ordering', 'missing');
    }
  } else {
    if (lifecycle && !retired) {
      if (previous?.ordering.status === 'known' && previous.ordering.epoch !== order.epoch) {
        ambiguous = true;
        unavailable(session, 'ordering', 'ambiguous');
      }
      if (session.ordering.status !== 'known' || session.ordering.epoch !== order.epoch || session.ordering.sequence < order.sequence) session.ordering = structuredClone(order);
    }
    if (watermark !== undefined) watermark.sequence = order.sequence;
    else session.watermarks.push({dimension: eventDimension, epoch: order.epoch, sequence: order.sequence});
  }
  if (lifecycle && mergeMetadata(session, observation).ambiguous) ambiguous = true;
  // Ordered evidence of the work on the same turn, newer than whatever marked the activity lost, settles it (Hub #505): a
  // native task resumed after an uncertain call stays in its turn, so no new turn's start recovers it. Both markers are
  // ordered in the session's epoch: a `turn-uncertain` is behind the activity watermark this observation passed, and an
  // ordered `evidence-unavailable` has its own watermark, which this observation must pass too. A session whose ordering
  // was not known in this epoch, as after an unordered marker, settles nothing here. Only ordered sources reach this.
  const lostMarker = order.status === 'known' ? session.watermarks.find(item => item.dimension === 'unavailable:activity' && item.epoch === order.epoch) : undefined;
  if (orderedActivity && order.status === 'known' && event.kind !== 'turn-uncertain' && previous !== undefined && sameTurn(previous.turn, turn) &&
    previous.ordering.status === 'known' && previous.ordering.epoch === order.epoch && (lostMarker === undefined || lostMarker.sequence < order.sequence)) {
    session.unavailable = session.unavailable.filter(item => !(item.dimension === 'activity' && item.reason === 'lost'));
  }
  switch (event.kind) {
    case 'session-started':
      // A new root is idle; a known root keeps its work. A child start is evidenced child work.
      if (!rootStart) session.activity = 'active';
      else if (previous === undefined) session.activity = 'idle';
      break;
    case 'turn-started':
    case 'activity-observed':
      session.activity = 'active';
      break;
    case 'turn-ended': {
      session.activity = 'idle';
      forgetAnsweredApprovals(session, turn);
      const material = turn.status === 'known' ? [identityKey(observation.identity), turn.id, 'turn-ended'] : [identityKey(observation.identity), key];
      const noticeId = sha256(JSON.stringify(material));
      const result = 'result' in event ? event.result : undefined;
      if (!session.notices.some(notice => notice.id === noticeId)) {
        // An owner's cancel is the owner's own acknowledgment (Hub #505, owner decision 1): its notice leaves no reader unread.
        const acknowledgedBy = result === 'cancelled' ? consumers.map(consumer => consumer.id) : [];
        session.notices.push({id: noticeId, kind: 'turn-ended', turn: structuredClone(turn), acknowledgedBy, ...(result === undefined ? {} : {result})});
      }
      // A task that ended waits for no one: its turn's attention clears with it (Hub #505).
      if (result !== undefined && turn.status === 'known') session.attention = session.attention.filter(item => !sameTurn(item.turn, turn));
      break;
    }
    case 'turn-waiting':
      // The turn's work stopped to wait for an answer or delegated work; it holds no notice (Hub #505).
      session.activity = 'idle';
      break;
    case 'turn-uncertain':
      // The turn's work stopped and the fate of its last effect is unknown (Hub #505).
      session.activity = 'unknown';
      unavailable(session, 'activity', 'lost');
      break;
    case 'turn-interrupted':
      session.activity = 'interrupted';
      break;
    case 'question-continuing':
    case 'attention-input':
    case 'attention-approval': {
      const attention = event.attention;
      const kind = event.kind === 'question-continuing' ? 'question' : event.kind === 'attention-input' ? 'input' : 'approval';
      if (!session.attention.some(item => item.kind === kind && sameId(item.id, attention) && sameId(item.turn, turn))) {
        session.attention.push({id: structuredClone(attention), kind, turn: structuredClone(turn)});
      }
      if (attention.status === 'unknown') unavailable(session, 'attention', 'ambiguous');
      break;
    }
    case 'attention-resolved': {
      const attention = event.attention;
      if (attention.status === 'known' && turn.status === 'known') {
        session.attention = session.attention.filter(item => !(item.id.status === 'known' && item.id.id === attention.id && sameTurn(item.turn, turn)));
        forgetAnsweredApprovals(session, turn);
      } else {
        unavailable(session, 'attention', 'ambiguous');
        ambiguous = true;
      }
      break;
    }
    case 'read-observed':
      session.read = event.state;
      break;
    case 'evidence-unavailable':
      unavailable(session, event.dimension, event.reason);
      break;
    case 'runtime-ended':
    case 'metadata-observed':
      // The transition retires a session on a runtime end and takes metadata as a title; neither reaches here.
      break;
  }
  forgetRetiredApprovals(session);
  retireSuperseded(session, consumers);
  boundWatermarks(session);
  if (eventDimension === 'activity' && !rootStart) {
    const conflict = previous !== undefined && previous.activity !== 'unknown' && previous.activity !== session.activity && !orderedActivity && !selectedStart && !matchingStop;
    const missingStart = event.kind === 'turn-started' && turn.status === 'unknown';
    const unresolvedActivity = session.unavailable.some(item => (item.dimension === 'turn' || item.dimension === 'activity') && item.reason === 'ambiguous');
    if (conflict || missingStart || unresolvedActivity) {
      session.activity = 'unknown';
      unavailable(session, 'activity', 'ambiguous');
      ambiguous = true;
    }
  }
  if (session.notices.length > SESSION_LIMITS.notices || session.attention.length > SESSION_LIMITS.attention ||
    session.watermarks.length > SESSION_LIMITS.watermarks) return {outcome: 'ambiguous', fresh: false, capacity: true};
  // Only lifecycle observations are evidence: expiry runs from them, and read evidence does not refresh them.
  if (lifecycle) {
    session.lastEvidenceAtMs = now;
    session.observedAtMs = observation.observedAtMs;
  }
  remember();
  return {session, outcome: ambiguous ? 'ambiguous' : 'applied', fresh: lifecycle};
}
