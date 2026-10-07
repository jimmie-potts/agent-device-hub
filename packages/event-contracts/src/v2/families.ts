// The core payload families of profile 2.0 (Hub #842, #918): the facts every module can rely on, and the commands
// that change them. Each payload schema lives in `schemas/v2/families/<family>.schema.json` and is built from the
// shared blocks. `MAPPING.md` shows where each 1.x field lands. The device families are in `devices.ts`.
import {createHash} from 'node:crypto';
import type {ErrorDetail, Message, MessageValidator, PayloadCheck} from './index.js';
import {defineFamily as define, registerFamilies, routedSubject, type PayloadFamily} from './registry.js';

export {FAMILY_VERSION, type PayloadFamily} from './registry.js';
/** A core payload family. */
export type CoreFamily = PayloadFamily;

/** A moment request's start lies at most this far after the request was sent. */
export const MOMENT_MAX_LEAD_MS = 60_000;
/** Freshness is `uncertain` once this long has passed without session evidence. */
export const STALE_AFTER_MS = 300_000;

export type Identity = {provider: 'codex' | 'claude'; client: 'cli' | 'desktop' | 'code'; hostId: string; sourceId: string; sessionId: string};
export type KnownId = {status: 'unknown'} | {status: 'known'; id: string};
export type Parent = {status: 'unknown'} | {status: 'top-level'} | {status: 'known'; identity: Identity};
export type Ordering = {status: 'unknown'} | {status: 'known'; authority: string; epoch: string; sequence: number};
export type AttentionKind = 'question' | 'input' | 'approval';
/** One attention item. `turn` is the turn it was raised on. */
export type Attention = {id: KnownId; kind: AttentionKind; turn: KnownId};
export type Unavailable = {
  dimension: 'activity' | 'attention' | 'turn' | 'parent' | 'read' | 'ordering';
  reason: 'unsupported' | 'inaccessible' | 'missing' | 'ambiguous' | 'lost';
};
export type Label = {value: string; origin: 'user' | 'agent'};
export type Title = {value: string; source: 'provider' | 'user'};

/** `org.bunny.session.updated`: the full record of one agent session. */
export type SessionRecord = {
  id: string; revision: number; generation: number; identity: Identity; parent: Parent; turn: KnownId;
  activity: 'unknown' | 'active' | 'idle' | 'interrupted';
  attention: Attention[];
  notices: {id: string; kind: 'turn-ended'; turn: KnownId; acknowledgedBy: string[]}[];
  read: 'unknown' | 'read' | 'unread'; unavailable: Unavailable[]; ordering: Ordering;
  observedAtMs: number; lastEvidenceAtMs: number; freshness: 'current' | 'uncertain'; restartUncertain: boolean;
  children: {active: number; uncertain: number};
  label?: Label; title?: Title; project?: string; projectId?: string; hostSessionId?: string;
};
export type LifecycleEvent =
  | {kind: 'session-started' | 'turn-started' | 'activity-observed' | 'turn-ended' | 'turn-interrupted' | 'runtime-ended'}
  | {kind: 'question-continuing' | 'attention-input' | 'attention-approval' | 'attention-resolved'; attention: KnownId}
  | {kind: 'read-observed'; state: 'read' | 'unread'}
  | ({kind: 'evidence-unavailable'} & Unavailable);
/**
 * `org.bunny.lifecycle.observed`: one hook observation for the core. A consumer's acknowledgment is not an observation:
 * it is the `notice-acknowledge` command (Hub #918).
 */
export type LifecycleObservation = {
  identity: Identity; turn: KnownId; parent: Parent; nativeEventId?: string; event: LifecycleEvent;
  observedAtMs: number; occurredAtMs?: number; ordering: Ordering;
  projectId?: string; label?: Label; title?: Title; project?: string; hostSessionId?: string;
};
/** What every agent occurrence carries. `turn` is the observation's turn. */
export type AgentOccurrence = {
  session: string; identity: Identity; turn: KnownId; observedAtMs: number; occurredAtMs?: number; ordering: Ordering; revision: number;
};
export type AttentionRaised = AgentOccurrence & {attention: Attention};
export type AttentionCleared = AttentionRaised & {cause: 'resolved' | 'turn-ended' | 'turn-retired' | 'recovered'};
export type TurnEnded = AgentOccurrence & {noticeId?: string};
export type SessionEnded = AgentOccurrence;
export type MomentEnded = {requestId: string; momentId: string; ending: 'completed' | 'preempted' | 'superseded' | 'interrupted'; endedAtMs: number};
export type Mode = 'work' | 'free' | 'quiet';
export type ModeState = {id: string; revision: number; mode: Mode; selectedAtMs: number};
export type ModeSetRequest = {requestId: string; mode: Mode; expectedRevision?: number};
export type MomentPlayRequest = {
  requestId: string; momentId: string; mood: string; palette?: string[]; durationMs: number; priorityClass: 'event' | 'flourish';
  coversStatus: boolean; startAtMs: number; toleranceMs: number;
};
export type InboxItem = {
  id: string; revision: number; createdAtMs: number; dismissedBy: string[];
  item:
    | {kind: 'turn-ended'; session: string; identity: Identity; turn: KnownId; noticeId: string}
    | {
      kind: 'operation'; requestId: string; command: string; target: string; result: 'failed' | 'uncertain';
      evidence?: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail;
    };
};
/**
 * `org.bunny.notice.acknowledge.requested`: a consumer acknowledges one turn-ended notice for its own consumer ID. The
 * envelope subject is the session's `id`. The acknowledgment is recorded for that consumer, and each consumer's policy
 * decides which acknowledgments clear what it shows. It proves no readership.
 */
export type NoticeAcknowledgeRequest = {requestId: string; consumerId: string; noticeId: string};
/**
 * `org.bunny.approval.recover.requested`: an operator retires the one uncertain approval marker without an attention ID
 * that a session holds on `turnId` (Hub #835). The envelope subject is the session's `id`, and `expectedRevision` the
 * session record's revision the operator read. It approves or denies nothing at the agent.
 */
export type ApprovalRecoverRequest = {requestId: string; turnId: string; expectedRevision: number};
export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';
/**
 * `org.bunny.playback.control.requested`: one action for the presented playback source. The envelope subject is the
 * playback record's `id`; its owner sends the action once, to the source presented at admission.
 */
export type PlaybackControlRequest = {requestId: string; action: PlaybackAction; expectedRevision?: number};
export type PlaybackState = {
  id: string; revision: number; availability: 'available' | 'stale' | 'unavailable'; observedAtMs?: number;
  playback: {status: 'unknown'} | {
    status: 'known'; player: 'playing' | 'paused' | 'stopped' | 'inactive' | 'unknown';
    title?: string; artist?: string; album?: string; controls: PlaybackAction[];
  };
};

/**
 * The ID of a session entity: the lowercase hex SHA-256 of its identity as compact JSON with sorted keys, in UTF-8.
 * The same identity always has the same ID, so a recreated session reuses it and its `generation` tells the two
 * records apart.
 */
export function sessionEntityId(identity: Identity): string {
  const {client, hostId, provider, sessionId, sourceId} = identity;
  return createHash('sha256').update(JSON.stringify({client, hostId, provider, sessionId, sourceId}), 'utf8').digest('hex');
}

/** The display title by precedence: the label, then the title. Undefined leaves the consumer's neutral fallback. */
export function sessionTitle(record: {label?: Label; title?: Title}): string | undefined {
  return record.label?.value ?? record.title?.value;
}

const SOURCE_KEYS = ['provider', 'client', 'hostId', 'sourceId'] as const;
// A known parent is in the child's own provider, client, host and source, with a different session ID (lifecycle 1.x).
function parentage(identity: Identity, parent: Parent): string | undefined {
  if (parent.status !== 'known') return undefined;
  if (SOURCE_KEYS.some(key => parent.identity[key] !== identity[key])) return 'payload /parent/identity another source';
  return parent.identity.sessionId === identity.sessionId ? 'payload /parent/identity same session' : undefined;
}
// Lifecycle sequences are meaningful only within their producing source.
const authority = (identity: Identity, ordering: Ordering): string | undefined =>
  ordering.status === 'known' && ordering.authority !== identity.sourceId ? 'payload /ordering/authority not the source' : undefined;
const repeated = (values: string[]): boolean => new Set(values).size !== values.length;
const entity = (message: Message, id: unknown): string | undefined => message.subject === id ? undefined : 'envelope /subject not the entity';

const sameId = (a: KnownId, b: KnownId): boolean => a.status === b.status && (a.status === 'unknown' || (b.status === 'known' && a.id === b.id));
// 1.x computed freshness at each read; 2.0 publishes it, so it must match the envelope time: uncertain exactly when the
// owner restarted since the last evidence or five minutes or more have passed.
function fresh(message: Message, record: SessionRecord): string | undefined {
  const stale = Date.parse(message.time) - record.lastEvidenceAtMs >= STALE_AFTER_MS;
  if (record.freshness === 'current') return stale ? 'payload /freshness current after five minutes' : undefined;
  return stale || record.restartUncertain ? undefined : 'payload /freshness uncertain before five minutes';
}

const checkSession: PayloadCheck = message => {
  const record = message.data as SessionRecord;
  if (record.id !== sessionEntityId(record.identity)) return 'payload /id not the identity key';
  if (record.generation > record.revision) return 'payload /generation after the revision';
  return entity(message, record.id) ?? parentage(record.identity, record.parent) ?? authority(record.identity, record.ordering) ??
    fresh(message, record) ?? (repeated(record.notices.map(notice => notice.id)) ? 'payload /notices duplicate id' : undefined) ??
    (repeated(record.unavailable.map(item => item.dimension)) ? 'payload /unavailable duplicate dimension' : undefined);
};
const checkLifecycle: PayloadCheck = message => {
  const observation = message.data as LifecycleObservation;
  if (message.subject !== sessionEntityId(observation.identity)) return 'envelope /subject not the session';
  return parentage(observation.identity, observation.parent) ?? authority(observation.identity, observation.ordering);
};
const checkOccurrence: PayloadCheck = message => {
  const occurrence = message.data as AgentOccurrence;
  if (occurrence.session !== sessionEntityId(occurrence.identity)) return 'payload /session not the identity key';
  if (message.subject !== occurrence.session) return 'envelope /subject not the session';
  return authority(occurrence.identity, occurrence.ordering);
};
// A raised item belongs to the observation's turn; a cleared one keeps the turn it was raised on.
const checkRaised: PayloadCheck = message => {
  const raised = message.data as AttentionRaised;
  return checkOccurrence(message) ?? (sameId(raised.attention.turn, raised.turn) ? undefined : 'payload /attention/turn not the observed turn');
};
const checkEntity: PayloadCheck = message => entity(message, message.data.id);
const checkInbox: PayloadCheck = message => {
  const {item} = message.data as InboxItem;
  return entity(message, message.data.id) ??
    (item.kind === 'turn-ended' && item.session !== sessionEntityId(item.identity) ? 'payload /item/session not the identity key' : undefined);
};
// A moment goes to one device, named by its subject.
const checkMoment: PayloadCheck = message => routedSubject('device')(message) ??
  ((message.data as MomentPlayRequest).startAtMs > Date.parse(message.time) + MOMENT_MAX_LEAD_MS ?
    `payload /startAtMs more than ${MOMENT_MAX_LEAD_MS} ms after time` : undefined);
// The command goes to the session it acknowledges or recovers, whose entity ID is a SHA-256 hash.
const checkSessionSubject: PayloadCheck = message => /^[0-9a-f]{64}$/.test(message.subject) ? undefined : 'envelope /subject not a session id';

/** Every core family, in registration order: the session schema holds definitions the other agent families use. */
export const coreFamilies: readonly CoreFamily[] = [
  define('session', 'state', 'org.bunny.session.updated', checkSession),
  define('mode', 'state', 'org.bunny.mode.updated', checkEntity),
  define('inbox-item', 'state', 'org.bunny.inbox-item.updated', checkInbox),
  define('playback', 'state', 'org.bunny.playback.updated', checkEntity),
  define('lifecycle', 'occurrence', 'org.bunny.lifecycle.observed', checkLifecycle),
  define('attention-raised', 'occurrence', 'org.bunny.attention.raised', checkRaised),
  define('attention-cleared', 'occurrence', 'org.bunny.attention.cleared', checkOccurrence),
  define('turn-ended', 'occurrence', 'org.bunny.turn.ended', checkOccurrence),
  define('session-ended', 'occurrence', 'org.bunny.session.ended', checkOccurrence),
  define('moment-ended', 'occurrence', 'org.bunny.moment.ended'),
  define('mode-set', 'command', 'org.bunny.mode.set.requested'),
  define('moment-play', 'command', 'org.bunny.moment.play.requested', checkMoment),
  define('notice-acknowledge', 'command', 'org.bunny.notice.acknowledge.requested', checkSessionSubject),
  define('approval-recover', 'command', 'org.bunny.approval.recover.requested', checkSessionSubject),
  define('playback-control', 'command', 'org.bunny.playback.control.requested', routedSubject('routing')),
];

/**
 * Registers every core family with its checks. A family's messages must use its kind and type. Their replies,
 * outcomes, removals and sync messages use the payloads the profile owns.
 */
export function registerCoreFamilies(validator: MessageValidator): void {
  registerFamilies(validator, coreFamilies);
}
