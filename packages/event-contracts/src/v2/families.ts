import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SCHEMA_BASE, type ErrorDetail, type Message, type MessageKind, type MessageValidator, type PayloadCheck} from './index.js';

/**
 * The core payload families of profile 2.0 (Hub #842): the facts every module can rely on. Each payload schema lives
 * in `schemas/v2/families/<family>.schema.json` and is built from the shared blocks. `MAPPING.md` shows where each
 * 1.x field lands.
 */
export const FAMILY_VERSION = '2.0';
/** A moment request's start lies at most this far after the request was sent. */
export const MOMENT_MAX_LEAD_MS = 60_000;

export type Identity = {provider: 'codex' | 'claude'; client: 'cli' | 'desktop' | 'code'; hostId: string; sourceId: string; sessionId: string};
export type KnownId = {status: 'unknown'} | {status: 'known'; id: string};
export type Parent = {status: 'unknown'} | {status: 'top-level'} | {status: 'known'; identity: Identity};
export type Ordering = {status: 'unknown'} | {status: 'known'; authority: string; epoch: string; sequence: number};
export type AttentionKind = 'question' | 'input' | 'approval';
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
  attention: {id: KnownId; kind: AttentionKind; turn: KnownId}[];
  notices: {id: string; kind: 'turn-ended'; turn: KnownId; acknowledgedBy: string[]}[];
  read: 'unknown' | 'read' | 'unread'; unavailable: Unavailable[]; ordering: Ordering;
  observedAtMs: number; lastEvidenceAtMs: number; freshness: 'current' | 'uncertain'; restartUncertain: boolean;
  children: {active: number; uncertain: number};
  label?: Label; title?: Title; project?: string; projectId?: string; hostSessionId?: string;
};
export type LifecycleEvent =
  | {kind: 'session-started' | 'turn-started' | 'activity-observed' | 'turn-ended' | 'turn-interrupted' | 'runtime-ended'}
  | {kind: 'question-continuing' | 'attention-input' | 'attention-approval' | 'attention-resolved'; attention: KnownId}
  | {kind: 'notice-acknowledged'; consumerId: string; noticeId: string}
  | {kind: 'read-observed'; state: 'read' | 'unread'}
  | ({kind: 'evidence-unavailable'} & Unavailable);
/** `org.bunny.lifecycle.observed`: one hook observation for the core. */
export type LifecycleObservation = {
  identity: Identity; turn: KnownId; parent: Parent; nativeEventId?: string; event: LifecycleEvent;
  observedAtMs: number; occurredAtMs?: number; ordering: Ordering;
  projectId?: string; label?: Label; title?: Title; project?: string; hostSessionId?: string;
};
/** What every agent occurrence carries. */
export type AgentOccurrence = {
  session: string; identity: Identity; turn: KnownId; observedAtMs: number; occurredAtMs?: number; ordering: Ordering; revision: number;
};
export type AttentionRaised = AgentOccurrence & {attention: {id: KnownId; kind: AttentionKind}};
export type AttentionCleared = AttentionRaised & {cause: 'resolved' | 'turn-ended' | 'turn-started' | 'recovered'};
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
    | {kind: 'operation'; requestId: string; command: string; target: string; result: 'failed' | 'uncertain'; error?: ErrorDetail};
};
export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';
export type PlaybackState = {
  id: string; revision: number; availability: 'available' | 'stale' | 'unavailable'; observedAtMs?: number;
  playback: {status: 'unknown'} | {
    status: 'known'; player: 'playing' | 'paused' | 'stopped' | 'inactive' | 'unknown';
    title?: string; artist?: string; album?: string; controls: PlaybackAction[];
  };
};

/**
 * The ID of a session entity: the lowercase hex SHA-256 of its identity as JSON with sorted keys. The same identity
 * always has the same ID, so a recreated session reuses it and its `generation` tells the two records apart.
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

const checkSession: PayloadCheck = message => {
  const record = message.data as SessionRecord;
  if (record.id !== sessionEntityId(record.identity)) return 'payload /id not the identity key';
  return entity(message, record.id) ?? parentage(record.identity, record.parent) ?? authority(record.identity, record.ordering) ??
    (repeated(record.notices.map(notice => notice.id)) ? 'payload /notices duplicate id' : undefined) ??
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
const checkEntity: PayloadCheck = message => entity(message, message.data.id);
const checkMoment: PayloadCheck = message => (message.data as MomentPlayRequest).startAtMs > Date.parse(message.time) + MOMENT_MAX_LEAD_MS ?
  `payload /startAtMs more than ${MOMENT_MAX_LEAD_MS} ms after time` : undefined;

export type CoreFamily = {family: string; kind: MessageKind; type: string; dataschema: string; schema: object; check?: PayloadCheck};
const define = (family: string, kind: MessageKind, type: string, check?: PayloadCheck): CoreFamily => ({
  family, kind, type, dataschema: `${SCHEMA_BASE}${family}/${FAMILY_VERSION}`,
  schema: JSON.parse(readFileSync(new URL(`../../schemas/v2/families/${family}.schema.json`, import.meta.url), 'utf8')) as object,
  ...(check === undefined ? {} : {check}),
});

/** Every core family, in registration order: the session schema holds definitions the other agent families use. */
export const coreFamilies: readonly CoreFamily[] = [
  define('session', 'state', 'org.bunny.session.updated', checkSession),
  define('mode', 'state', 'org.bunny.mode.updated', checkEntity),
  define('inbox-item', 'state', 'org.bunny.inbox-item.updated', checkEntity),
  define('playback', 'state', 'org.bunny.playback.updated', checkEntity),
  define('lifecycle', 'occurrence', 'org.bunny.lifecycle.observed', checkLifecycle),
  define('attention-raised', 'occurrence', 'org.bunny.attention.raised', checkOccurrence),
  define('attention-cleared', 'occurrence', 'org.bunny.attention.cleared', checkOccurrence),
  define('turn-ended', 'occurrence', 'org.bunny.turn.ended', checkOccurrence),
  define('session-ended', 'occurrence', 'org.bunny.session.ended', checkOccurrence),
  define('moment-ended', 'occurrence', 'org.bunny.moment.ended'),
  define('mode-set', 'command', 'org.bunny.mode.set.requested'),
  define('moment-play', 'command', 'org.bunny.moment.play.requested', checkMoment),
];

/**
 * Registers every core family with its checks. A family's messages must use its kind and type. Their replies,
 * outcomes, removals and sync messages use the payloads the profile owns.
 */
export function registerCoreFamilies(validator: MessageValidator): void {
  for (const {family, kind, type, dataschema, schema, check} of coreFamilies) {
    validator.register(dataschema, schema, message => {
      if (message.kind !== kind) return `envelope /kind ${family} is a ${kind} family`;
      if (message.type !== type) return `envelope /type ${family} uses ${type}`;
      return check?.(message);
    });
  }
}
