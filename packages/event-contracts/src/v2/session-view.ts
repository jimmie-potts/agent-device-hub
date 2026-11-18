// The shared session view (Hub #1865, design decisions 3, 4 and 10). Its only runtime import is `status.ts`, which has
// none of its own, so a browser part can bundle it: the status function, the version-independent view of a session
// record, each consumer's acknowledgment and read policy, opportunity matching, and the agent-status helper over views.
// `session.ts` adds `readSession`, which validates a message before it reads it.
import type {CompanionOpportunity} from './companions.js';
import type {
  Attention, AttentionKind, Confidence, Identity, KnownId, Notice, Session30Record, SessionRecord, SessionStatus, StatusClass, Unavailable, WorkReason,
} from './families.js';
import {STATUS_COLORS, type AgentState, type HighestStatus, type HighestStatusOptions} from './status.js';

/**
 * A session as every reader sees it, whichever version of the record carried it. Its members are those of
 * `session/3.0`. A reader switches on `status.class`, and a detail it does not know falls back to the class.
 */
export type SessionView = Session30Record;
/** What the status function reads: the record's turn and its claims. */
export type SessionClaims = Pick<Session30Record, 'turn' | 'work' | 'attention' | 'outcome' | 'relationships' | 'unavailable'>;

/** Every detail this version knows, by class. A reader treats any other detail as its class alone. */
export const STATUS_DETAILS: Readonly<Record<StatusClass, readonly string[]>> = Object.freeze({
  'needs-owner': Object.freeze(['approval', 'input', 'question']),
  working: Object.freeze(['confirmed', 'unconfirmed', 'subagent']),
  finished: Object.freeze(['turn-ended']),
  quiet: Object.freeze(['idle', 'interrupted', 'acknowledged', 'read']),
  unknown: Object.freeze(['unknown', 'unsupported', 'inaccessible', 'missing', 'ambiguous', 'lost']),
});
/** Whether this version knows the status's detail for its class. An unknown detail never makes an action eligible. */
export const knownDetail = (status: SessionStatus): boolean => STATUS_DETAILS[status.class].includes(status.detail);

const sameId = (a: KnownId, b: KnownId): boolean => a.status === b.status && (a.status === 'unknown' || (b.status === 'known' && a.id === b.id));
// The dashboard's ranking (apps/runtime/dashboard/src/sessions.ts): an approval blocks, then input, then a question.
const ATTENTION_RANK: readonly AttentionKind[] = ['approval', 'input', 'question'];

/**
 * Whether a notice still describes the session's finished turn, which status rule 3 and each reader's retirement
 * count. This is the one place that decides it. The owner chose the dashboard's rule (`nextTurnStarted` in
 * apps/runtime/dashboard/src/sessions.ts) on 2026-11-18 (Hub #1865, design decision 3): a notice counts until a known
 * later turn supersedes it, that is, unless its turn and the session's turn are both known and differ. Missing or
 * conflicting turn evidence never hides a recorded outcome.
 */
export function noticeCounts(notice: Pick<Notice, 'turn'>, turn: KnownId): boolean {
  return notice.turn.status !== 'known' || turn.status !== 'known' || notice.turn.id === turn.id;
}

/**
 * The hub's status of a session from its claims. The first rule that matches wins:
 * 1. attention items: `needs-owner`, detailed by the highest-ranked kind;
 * 2. active work: `working`, `confirmed` or `unconfirmed`; otherwise a working child: `working`, `subagent`;
 * 3. a notice that still counts (`noticeCounts`): `finished`, `turn-ended`, whatever the acknowledgments and read evidence;
 * 4. idle or interrupted work: `quiet`, `idle` or `interrupted`;
 * 5. otherwise `unknown`, detailed by the activity's unavailable reason, or `unknown`.
 */
export function statusOf(claims: SessionClaims): SessionStatus {
  const items = claims.attention.items;
  const kind = ATTENTION_RANK.find(candidate => items.some(item => item.kind === candidate));
  if (kind !== undefined) return {class: 'needs-owner', detail: kind};
  if (claims.work.state === 'active') return {class: 'working', detail: claims.work.confidence};
  if (claims.relationships.children.working > 0) return {class: 'working', detail: 'subagent'};
  if (claims.outcome.notices.some(notice => noticeCounts(notice, claims.turn))) return {class: 'finished', detail: 'turn-ended'};
  if (claims.work.state === 'idle' || claims.work.state === 'interrupted') return {class: 'quiet', detail: claims.work.state};
  return {class: 'unknown', detail: claims.unavailable.find(item => item.dimension === 'activity')?.reason ?? 'unknown'};
}

const confidenceOf = (unavailable: readonly Unavailable[], dimension: Unavailable['dimension']): Confidence =>
  unavailable.some(item => item.dimension === dimension && (item.reason === 'ambiguous' || item.reason === 'lost')) ? 'unconfirmed' : 'confirmed';

/**
 * The view of a `session/2.0` or `2.1` record that its copy already validated (design decision 4). Active work is
 * unconfirmed while the record's freshness is uncertain (reason `deadline`) or it is restart-uncertain (reason
 * `restart`), and while an ambiguous or lost activity entry exists (its reason); silence never makes attention or an
 * outcome uncertain. The children map as `working = active` and `unconfirmed = uncertain`. Ambiguous or lost evidence
 * makes the attention, outcome and relationship claims unconfirmed by their dimensions: attention, read and parent.
 * Every claim takes the record's last evidence time. A record that has not been validated goes through `readSession`.
 */
export function sessionView(record: SessionRecord): SessionView {
  const evidenceAtMs = record.lastEvidenceAtMs;
  const silence: WorkReason[] = record.restartUncertain ? ['restart'] : record.freshness === 'uncertain' ? ['deadline'] : [];
  const evidence = record.unavailable.flatMap(({dimension, reason}): WorkReason[] =>
    dimension === 'activity' && (reason === 'ambiguous' || reason === 'lost') ? [reason] : []);
  const reasons: WorkReason[] = record.activity === 'active' ? [...silence, ...evidence] : [];
  const claims: SessionClaims = {
    turn: record.turn,
    work: {state: record.activity, confidence: reasons.length > 0 ? 'unconfirmed' : 'confirmed', evidenceAtMs, reasons},
    attention: {items: record.attention, confidence: confidenceOf(record.unavailable, 'attention'), evidenceAtMs},
    outcome: {
      notices: record.notices, read: record.read, ...(record.readReceipt === undefined ? {} : {readReceipt: record.readReceipt}),
      confidence: confidenceOf(record.unavailable, 'read'), evidenceAtMs,
    },
    relationships: {children: {working: record.children.active, unconfirmed: record.children.uncertain}, confidence: confidenceOf(record.unavailable, 'parent')},
    unavailable: record.unavailable,
  };
  const {label, title, project, projectId, hostSessionId} = record;
  return {
    id: record.id, revision: record.revision, generation: record.generation, identity: record.identity, parent: record.parent,
    status: statusOf(claims), ...claims, ordering: record.ordering, observedAtMs: record.observedAtMs, lastEvidenceAtMs: record.lastEvidenceAtMs,
    ...(label === undefined ? {} : {label}), ...(title === undefined ? {} : {title}), ...(project === undefined ? {} : {project}),
    ...(projectId === undefined ? {} : {projectId}), ...(hostSessionId === undefined ? {} : {hostSessionId}),
  };
}

/**
 * A reader's acknowledgment and read policy. Omitted `acknowledgingConsumers` counts any consumer's acknowledgment, as
 * LIFX and Tidbyt do; naming consumers counts only theirs. `read` makes positive read evidence count too.
 */
export type ConsumerPolicy = {acknowledgingConsumers?: readonly string[]; read?: boolean};

/**
 * The view as one reader shows it: a `finished` status retires to `quiet` once every notice that still counts
 * (`noticeCounts`) is acknowledged under the reader's policy (detail `acknowledged`), or, when read evidence counts for
 * it, once the session is read (detail `read`). Every other status is the hub's. Acknowledgments stay on the record.
 */
export function forConsumer(view: SessionView, policy: ConsumerPolicy = {}): SessionView {
  if (view.status.class !== 'finished') return view;
  const consumers = policy.acknowledgingConsumers;
  const acknowledged = (by: readonly string[]): boolean => consumers === undefined ? by.length > 0 : by.some(id => consumers.includes(id));
  if (view.outcome.notices.filter(notice => noticeCounts(notice, view.turn)).every(notice => acknowledged(notice.acknowledgedBy))) {
    return {...view, status: {class: 'quiet', detail: 'acknowledged'}};
  }
  if (policy.read === true && view.outcome.read === 'read') return {...view, status: {class: 'quiet', detail: 'read'}};
  return view;
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.provider === b.provider && a.client === b.client && a.hostId === b.hostId && a.sourceId === b.sourceId && a.sessionId === b.sessionId;
const sameAttention = (a: Attention, b: Attention): boolean => a.kind === b.kind && sameId(a.id, b.id) && sameId(a.turn, b.turn);

/**
 * Whether a companion opportunity is still current for this session (design decision 10): the same session, generation,
 * identity and turn, and its attention item still present, or its notice still present and not acknowledged by
 * `consumer`. A view whose status detail this version does not know matches nothing, because unknown action semantics
 * never grant eligibility. A reader adds only its own device conditions, such as the validity window, mode and Quiet.
 */
export function opportunityMatches(view: SessionView, opportunity: CompanionOpportunity, consumer: string): boolean {
  if (opportunity.session !== view.id || opportunity.identity === null || opportunity.generation !== view.generation ||
    !sameIdentity(opportunity.identity, view.identity) || !sameId(opportunity.turn, view.turn) || !knownDetail(view.status)) return false;
  switch (opportunity.category) {
    case 'coding-attention': {
      const {attention} = opportunity;
      return attention !== null && view.attention.items.some(item => sameAttention(item, attention));
    }
    case 'coding-notice':
      return opportunity.noticeId !== null && view.outcome.notices.some(notice => notice.id === opportunity.noticeId && !notice.acknowledgedBy.includes(consumer));
    case 'simulated-social':
      return false;
  }
}

/**
 * The agent-status helper over views, for the readers that move onto the view in their own steps. Nothing live calls it
 * in group 1: the live readers keep `status.ts`, which keeps today's rule over records until a reader's step moves it.
 * The colors and the ranking are `status.ts`'s.
 */
export {STATUS_COLORS, type AgentState, type HighestStatus, type HighestStatusOptions};
export type {Rgb} from './status.js';
/** A consumer's copy of the session family as views, synced as `status.ts`'s copy is. */
export type ViewCopy = {synced: boolean; sessions: readonly SessionView[]};

const RANK: Record<AgentState, number> = {attention: 0, working: 1, done: 2};

/**
 * One root session's state from its view, or undefined when it has nothing outstanding: `needs-owner` is attention,
 * `working` is working and `finished` is done. By default any consumer's acknowledgment retires `done`; passing
 * `consumers` restricts that to the named consumers only. Read evidence never retires `done`.
 */
export function sessionState(view: SessionView, consumers?: readonly string[]): AgentState | undefined {
  const {status} = forConsumer(view, consumers === undefined ? {} : {acknowledgingConsumers: consumers});
  switch (status.class) {
    case 'needs-owner': return 'attention';
    case 'working': return 'working';
    case 'finished': return 'done';
    case 'quiet':
    case 'unknown':
      return undefined;
  }
}

/**
 * The single highest state across every root view, or `idle`/`unknown`, ranked attention > working > done. Unconfirmed
 * work never hides the status the hub reports. No copy, or one that has not synced, makes the result `unknown`.
 */
export function highestStatus(copy: ViewCopy | undefined, options: HighestStatusOptions = {}): HighestStatus {
  if (copy === undefined || !copy.synced) return 'unknown';
  const shown = copy.sessions
    .filter(view => view.parent.status !== 'known')
    .map(view => sessionState(view, options.acknowledgingConsumers))
    .filter((state): state is AgentState => state !== undefined);
  if (shown.length === 0) return 'idle';
  return shown.reduce((best, state) => RANK[state] < RANK[best] ? state : best);
}

