// The shared session view (Hub #1865, design decisions 3, 4 and 10). Its only runtime import is `status.ts`, which has
// none of its own, so a browser part can bundle it: the status function, the record builder the core and tests share,
// each consumer's acknowledgment and read policy, opportunity matching, and the agent-status helper over views. Since
// the core publishes `session/3.0` (#1865 step 9), a session's view is its record: a browser part reads the records of a
// copy the core validated when it published them. `session.ts` adds `readSession`, which validates a message first.
import type {CompanionOpportunity} from './companions.js';
import type {
  Attention, AttentionKind, Confidence, Identity, KnownId, Notice, OutcomeClaim, ReadProvenance, RelationshipsClaim, Session30Record, SessionStatus,
  StatusClass, Unavailable, WorkClaim, WorkReason,
} from './families.js';
import {STATUS_COLORS, type AgentState, type HighestStatus, type HighestStatusOptions} from './status.js';

/**
 * A session as every reader sees it: its `session/3.0` record. A reader switches on `status.class`, and a detail it does
 * not know falls back to the class.
 */
export type SessionView = Session30Record;
/** What the status function reads: the record's turn and its claims. */
export type SessionClaims = Pick<Session30Record, 'turn' | 'work' | 'attention' | 'outcome' | 'relationships' | 'unavailable'>;

/** Every detail this version knows, by class. A reader treats any other detail as its class alone. */
export const STATUS_DETAILS: Readonly<Record<StatusClass, readonly string[]>> = Object.freeze({
  'needs-owner': Object.freeze(['approval', 'input', 'question']),
  working: Object.freeze(['confirmed', 'unconfirmed', 'subagent']),
  finished: Object.freeze(['turn-ended', 'succeeded', 'failed', 'cancelled']),
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
 * 3. a notice that still counts (`noticeCounts`): `finished`, whatever the acknowledgments and read evidence, detailed by
 *    the result of the last such notice that has one (`succeeded`, `failed` or `cancelled`, Hub #505), or `turn-ended`;
 * 4. idle or interrupted work: `quiet`, `idle` or `interrupted`;
 * 5. otherwise `unknown`, detailed by the activity's unavailable reason, or `unknown`.
 */
export function statusOf(claims: SessionClaims): SessionStatus {
  const items = claims.attention.items;
  const kind = ATTENTION_RANK.find(candidate => items.some(item => item.kind === candidate));
  if (kind !== undefined) return {class: 'needs-owner', detail: kind};
  if (claims.work.state === 'active') return {class: 'working', detail: claims.work.confidence};
  if (claims.relationships.children.working > 0) return {class: 'working', detail: 'subagent'};
  const counting = claims.outcome.notices.filter(notice => noticeCounts(notice, claims.turn));
  if (counting.length > 0) return {class: 'finished', detail: [...counting].reverse().find(notice => notice.result !== undefined)?.result ?? 'turn-ended'};
  if (claims.work.state === 'idle' || claims.work.state === 'interrupted') return {class: 'quiet', detail: claims.work.state};
  return {class: 'unknown', detail: claims.unavailable.find(item => item.dimension === 'activity')?.reason ?? 'unknown'};
}

const confidenceOf = (unavailable: readonly Unavailable[], dimension: Unavailable['dimension']): Confidence =>
  unavailable.some(item => item.dimension === dimension && (item.reason === 'ambiguous' || item.reason === 'lost')) ? 'unconfirmed' : 'confirmed';

/**
 * What a session's `session/3.0` record is built from: its public members, its work state with why running work is
 * unconfirmed besides its evidence, its attention items, its notices and read evidence, and its counted children. The
 * core builds every record it publishes from its stored sessions with `buildSession`, and tests build theirs the same way.
 */
export type SessionFacts = Pick<Session30Record, 'id' | 'revision' | 'generation' | 'identity' | 'parent' | 'turn' | 'unavailable' | 'ordering' |
  'observedAtMs' | 'lastEvidenceAtMs' | 'label' | 'title' | 'project' | 'projectId' | 'hostSessionId' | 'companions'> & {
  work: WorkClaim['state'];
  /** Why running work is unconfirmed without evidence saying so: the core restarted. Silence alone never does (Hub #1947). */
  unconfirmed?: 'restart';
  attention: Attention[];
  notices: Notice[];
  read: OutcomeClaim['read'];
  readReceipt?: ReadProvenance;
  /** The children whose work is active and confirmed, and those whose work the hub cannot confirm. */
  children: RelationshipsClaim['children'];
};

/**
 * The `session/3.0` record of a session's facts (design decisions 3 and 4, as Hub #1947 amends them), with the status of
 * its claims. Active work is unconfirmed after a restart, and while an ambiguous or lost activity entry exists (its
 * reason, after the restart); work that is not active is never unconfirmed. Ambiguous or lost evidence
 * makes the attention, outcome and relationship claims unconfirmed by their dimensions: attention, read and parent.
 * Silence never makes attention or an outcome unconfirmed. Every claim takes the record's last evidence time.
 */
export function buildSession(facts: SessionFacts): Session30Record {
  const {lastEvidenceAtMs: evidenceAtMs, unavailable} = facts;
  const evidence = unavailable.flatMap(({dimension, reason}): WorkReason[] =>
    dimension === 'activity' && (reason === 'ambiguous' || reason === 'lost') ? [reason] : []);
  // Only a restart is a reason without evidence; `deadline`, which a record of a release before Hub #1947 may hold, is never built.
  const reasons: WorkReason[] = facts.work === 'active' ? [...((facts.unconfirmed as string | undefined) === 'restart' ? ['restart' as const] : []), ...evidence] : [];
  const claims: SessionClaims = {
    turn: facts.turn,
    work: {state: facts.work, confidence: reasons.length > 0 ? 'unconfirmed' : 'confirmed', evidenceAtMs, reasons},
    attention: {items: facts.attention, confidence: confidenceOf(unavailable, 'attention'), evidenceAtMs},
    outcome: {
      notices: facts.notices, read: facts.read, ...(facts.readReceipt === undefined ? {} : {readReceipt: facts.readReceipt}),
      confidence: confidenceOf(unavailable, 'read'), evidenceAtMs,
    },
    relationships: {children: facts.children, confidence: confidenceOf(unavailable, 'parent')},
    unavailable,
  };
  const {label, title, project, projectId, hostSessionId, companions} = facts;
  return {
    id: facts.id, revision: facts.revision, generation: facts.generation, identity: facts.identity, parent: facts.parent,
    status: statusOf(claims), ...claims, ordering: facts.ordering, observedAtMs: facts.observedAtMs, lastEvidenceAtMs: facts.lastEvidenceAtMs,
    ...(label === undefined ? {} : {label}), ...(title === undefined ? {} : {title}), ...(project === undefined ? {} : {project}),
    ...(projectId === undefined ? {} : {projectId}), ...(hostSessionId === undefined ? {} : {hostSessionId}),
    ...(companions === undefined ? {} : {companions}),
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

/** The agent-status helper over views, which every device reader uses. The colors and the state names are `status.ts`'s. */
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

