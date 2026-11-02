import type {ReadReceipt} from './read-receipts.js';
import {assistantFamilies} from './assistant.js';
import {lightingLayoutFamilies} from './lighting-layout.js';
import {playbackLayoutFamilies} from './playback-layout.js';
import {normalizeModeState} from './mode.js';
import {homeLayoutFamilies} from './home-layout.js';
export type {HomePlacement, HomeArrangements, HomeLayoutRecord, HomeLayoutSetRequest} from './home-layout.js';
export type {PlaybackPlacement, PlaybackLayoutRecord, PlaybackLayoutSetRequest} from './playback-layout.js';
export type {LightingLayout, LightingLayoutRecord, LightingLayoutSetRequest, LightingRoom, LightingGroup, LightingSelection} from './lighting-layout.js';
// The core payload families of profile 2.0 (Hub #842, #918): the facts every module can rely on, and the commands
// that change them. Each payload schema lives in `schemas/v2/families/<family>.schema.json` and is built from the
// shared blocks. `MAPPING.md` shows where each 1.x field lands. The device families are in `devices.ts`.
import {companionFamilies} from './companions.js';
import {codingFamilies} from './coding.js';
import {createHash} from 'node:crypto';
import type {ErrorDetail, Message, MessageValidator, PayloadCheck} from './index.js';
import {defineFamily as define, registerFamilies, routedSubject, type PayloadFamily} from './registry.js';

export {FAMILY_VERSION, type PayloadFamily} from './registry.js';
/** Core-derived optional maximum-on state, independent of observed device power and tracked operation outcomes. */
export type PowerLimitRecord={id:string;revision:number;settingsRevision:number;enabled:boolean;durationMs:number;enforcement:'hub-dependent';status:'disabled'|'unavailable'|'off'|'armed'|'elapsed-unknown'|'due'|'attempted'|'blocked';startedAtMs:number|null;deadlineMs:number|null;observedAtMs:number|null;lastAttempt:null|{requestId:string;outcome:'intent'|'receipt'|'not-sent'|'uncertain';reason?:string};updatedAtMs:number};
/** A core payload family. */
export type CoreFamily = PayloadFamily;

/** A moment request's start lies at most this far after the request was sent. */
export const MOMENT_MAX_LEAD_MS = 60_000;
/** Freshness is `uncertain` once this long has passed without session evidence. */
export const STALE_AFTER_MS = 300_000;

export type Identity = {provider: 'codex' | 'claude'; client: 'cli' | 'desktop' | 'code' | 'local'; hostId: string; sourceId: string; sessionId: string};
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
  readReceipt?: {noticeId: string; observedAtMs: number; source: string; receipt: ReadReceipt};
  read: 'unknown' | 'read' | 'unread'; unavailable: Unavailable[]; ordering: Ordering;
  observedAtMs: number; lastEvidenceAtMs: number; freshness: 'current' | 'uncertain'; restartUncertain: boolean;
  children: {active: number; uncertain: number};
  label?: Label; title?: Title; project?: string; projectId?: string; hostSessionId?: string;
};
export type LifecycleEvent =
  | {kind: 'metadata-observed'; archived?: boolean}
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
export type ModeOverride = {target: string; mode: Mode; selectedAtMs: number};
/** overrides is absent only in the retained mode/2.0 contract. */
export type ModeState = {id: string; revision: number; mode: Mode; selectedAtMs: number; overrides?: ModeOverride[]};
export type ModeSetRequest = {requestId: string; mode: Mode; expectedRevision?: number};
export type MomentPlayRequest = {
  requestId: string; momentId: string; mood: string; palette?: string[]; durationMs: number; priorityClass: 'event' | 'flourish';
  coversStatus: boolean; startAtMs: number; toleranceMs: number;
};
/**
 * `org.bunny.inbox-item.updated`: one failed or uncertain operation in the core's shared inbox. A finished turn is never
 * an inbox item: its unread state stays on the session record (Hub #782 removed the turn-ended item).
 */
export type InboxItem = {
  id: string; revision: number; createdAtMs: number; dismissedBy: string[];
  item: {
    kind: 'operation'; requestId: string; command: string; target: string; result: 'succeeded' | 'failed' | 'uncertain' | 'conflict';
    outcomes?: {source: string; id: string; result: 'succeeded' | 'failed'; evidence: 'transmitted' | 'observed' | 'none'; atMs: number; error?: ErrorDetail}[];
    evidence?: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail;
  };
};
/**
 * `org.bunny.operation.updated`: the latest state of one action the core tracks (Hub #922, #782), a copy of the tracker's
 * row that the core publishes from the tracker's change, in the same transaction, and serves through sync. Its `id` is
 * `operationEntityId(requestId)`. `result` is absent while the action is `sent` or `accepted`. An accepted reply is never
 * evidence of an effect; `evidence` describes the action's transmitted or observed effect. `kind` is the tracker's
 * existing category and deadline class, not proof of a physical target; `family` and `target` identify the action,
 * including tracked core-local metadata changes. The core keeps the latest records only, removing the
 * oldest settled one with reason `retired`; the inbox (#923) points at an operation by its request ID.
 */
export type OperationRecord = {
  id: string; revision: number; requestId: string; kind: 'device' | 'moment' | 'mode'; family: string; command: string; target: string;
  requestedBy: string; status: 'sent' | 'accepted' | 'rejected' | 'expired' | 'uncertain' | 'completed' | 'conflict';
  result?: 'succeeded' | 'failed' | 'uncertain' | 'conflict'; evidence?: 'transmitted' | 'observed' | 'none'; error?: ErrorDetail; reply?: string;
  sentAtMs: number; updatedAtMs: number; deadlineAtMs: number;
};
/**
 * `org.bunny.outcome.recorded`: the outcome acknowledgment (ADR 0012, "Acknowledging outcomes", Hub #782). The core,
 * and only the core, tells the module whose `source` it names that it recorded the outcome with message `id`. It goes
 * out on `outcomeRecordedKey(source)` once the outcome commits, and again for each exact duplicate. Its subject is `id`.
 */
export type OutcomeRecorded = {source: string; id: string};
/** The only sender of an outcome acknowledgment: the core. */
export const CORE_SOURCE = 'bunny/core';
/** The key an acknowledgment of `source`'s outcomes travels on: `bunny.event.outcome-recorded.<its last segment>`. */
export const outcomeRecordedKey = (source: string): string => `bunny.event.outcome-recorded.${source.slice(source.lastIndexOf('/') + 1)}`;
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
/** An operator override for the selected latest notice; null selects no notice and changes no session state. */
export type NoticeClearRequest = {requestId: string; noticeId: string | null; expectedRevision: number};
/** A tracked operator label change, guarded by the current session record's revision; null clears the label. */
export type SessionLabelSetRequest = {requestId: string; label: string | null; expectedRevision: number};
export type PlaybackAction = 'play' | 'pause' | 'next' | 'previous';
/**
 * `org.bunny.playback.control.requested`: one action for the presented playback source. The envelope subject is the
 * playback record's `id`; its owner sends the action once, to the source presented at admission.
 */
export type PlaybackControlRequest = {requestId: string; action: PlaybackAction; expectedRevision?: number};
/** Optional bounded artwork in playback/2.1; the token identifies the owner's presented observation. */
export type PlaybackArtwork =
  | {status: 'missing' | 'unsupported'; generation: string}
  | {status: 'ready'; generation: string; mediaType: 'image/png'; width: number; height: number; base64: string};
export type PlaybackState = {
  id: string; revision: number; availability: 'available' | 'stale' | 'unavailable'; observedAtMs?: number; artwork?: PlaybackArtwork;
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

/** One Codex Desktop feed a host-local collector reports for: the session identity without its session (Hub #567). */
export type DesktopFeed = {provider: 'codex'; client: 'desktop'; hostId: string; sourceId: string};
/**
 * `org.bunny.desktop-metadata.observed`: one bounded snapshot of Codex Desktop's three metadata inputs for one feed, as
 * a source-bound collector publishes it on `bunny.event.desktop-metadata.<feed ID>` (Hub #567). `unread` is the marker's
 * unread thread IDs, or null when the marker is missing, unusable or over its bounds; `archived` is the positive rollout
 * filename scan, or null when it is unavailable or over its bounds; `titles` is the bounded index tail's latest valid
 * title per thread. `stamp` names the snapshot's content, so an unchanged one is recognized without comparing the sets.
 * Only the Codex Desktop module turns a snapshot into lifecycle evidence; the core ignores the family.
 */
export type DesktopMetadataSnapshot = {
  feed: DesktopFeed; observedAtMs: number; stamp: string;
  unread: string[] | null; archived: string[] | null; titles: {id: string; title: Title}[];
};
/** The `desktop-metadata` family's type, schema and routing-key prefix, for its one publisher and its one consumer (Hub #567). */
export const DESKTOP_METADATA_TYPE = 'org.bunny.desktop-metadata.observed';
export const DESKTOP_METADATA_SCHEMA = 'https://bunny.invalid/events/desktop-metadata/2.0';
export const DESKTOP_METADATA_KEY_PREFIX = 'bunny.event.desktop-metadata.';
/** The routing key of one feed's snapshots. */
export const desktopMetadataKey = (feed: DesktopFeed): string => `${DESKTOP_METADATA_KEY_PREFIX}${desktopFeedId(feed)}`;
/** The ID of a Desktop feed's entity: the lowercase hex SHA-256 of its four identity fields, sorted, in UTF-8 JSON. */
export function desktopFeedId(feed: DesktopFeed): string {
  const {client, hostId, provider, sourceId} = feed;
  return createHash('sha256').update(JSON.stringify({client, hostId, provider, sourceId}), 'utf8').digest('hex');
}

/** The ID of an operation entity: the lowercase hex SHA-256 of its request ID in UTF-8, so one request has one entity. */
export function operationEntityId(requestId: string): string {
  return createHash('sha256').update(requestId, 'utf8').digest('hex');
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
  if (record.readReceipt !== undefined && (record.turn.status !== 'known' || !record.notices.some(notice =>
    notice.id === record.readReceipt?.noticeId && notice.turn.status === 'known' && record.turn.status === 'known' && notice.turn.id === record.turn.id))) {
    return 'payload /readReceipt does not name the current finished turn';
  }
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
// A Desktop snapshot's subject is its feed, and it names each thread once: the schema refuses a repeated unread or
// archived ID, and this check a repeated title ID, which `uniqueItems` cannot state.
const checkDesktopMetadata: PayloadCheck = message => {
  const snapshot = message.data as DesktopMetadataSnapshot;
  if (message.subject !== desktopFeedId(snapshot.feed)) return 'envelope /subject not the feed';
  return repeated(snapshot.titles.map(title => title.id)) ? 'payload /titles duplicate id' : undefined;
};
const checkEntity: PayloadCheck = message => entity(message, message.data.id);
// An operation's entity is its request's, and its command is its family's.
const checkOperation: PayloadCheck = message => {
  const record = message.data as OperationRecord;
  const verb = record.family.lastIndexOf('-');
  return entity(message, record.id) ?? (record.id === operationEntityId(record.requestId) ? undefined : 'payload /id not the request\'s entity')
    ?? (verb > 0 && record.command === `org.bunny.${record.family.slice(0, verb)}.${record.family.slice(verb + 1)}.requested` ? undefined : 'payload /command not the family\'s');
};
// Only the core acknowledges an outcome, and the acknowledgment's subject is the outcome's message ID.
const checkRecorded: PayloadCheck = message => {
  if (message.source !== CORE_SOURCE) return 'envelope /source not the core';
  return message.subject === (message.data as OutcomeRecorded).id ? undefined : 'envelope /subject not the outcome id';
};
// A moment goes to one device, named by its subject.
const checkMoment: PayloadCheck = message => routedSubject('device')(message) ??
  ((message.data as MomentPlayRequest).startAtMs > Date.parse(message.time) + MOMENT_MAX_LEAD_MS ?
    `payload /startAtMs more than ${MOMENT_MAX_LEAD_MS} ms after time` : undefined);
// The command goes to the session it acknowledges or recovers, whose entity ID is a SHA-256 hash.
const checkSessionSubject: PayloadCheck = message => /^[0-9a-f]{64}$/.test(message.subject) ? undefined : 'envelope /subject not a session id';
const checkSessionLabel: PayloadCheck = message => {
  const {label} = message.data as SessionLabelSetRequest;
  return checkSessionSubject(message) ?? (label !== null && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(label)
    ? 'payload /label not Unicode scalar values' : undefined);
};

/** Checks encoding and PNG header bounds without running an image decoder on the bus thread. */
const checkPlaybackArtwork: PayloadCheck = message => {
  const entity = checkEntity(message);
  if (entity !== undefined) return entity;
  const {artwork} = message.data as PlaybackState;
  if (artwork?.status !== 'ready') return undefined;
  const bytes = Buffer.from(artwork.base64, 'base64');
  if (bytes.length > 65_536 || bytes.toString('base64') !== artwork.base64 || bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== artwork.width || bytes.readUInt32BE(20) !== artwork.height) {
    return 'payload /artwork invalid bounded PNG encoding or dimensions';
  }
  return undefined;
};

/** Every core family, in registration order: the session schema holds definitions the other agent families use. */
export const coreFamilies: readonly CoreFamily[] = [
  define('session', 'state', 'org.bunny.session.updated', checkSession),
  define('session', 'state', 'org.bunny.session.updated', checkSession, '2.1'),
  define('mode', 'state', 'org.bunny.mode.updated', checkEntity),
  define('mode', 'state', 'org.bunny.mode.updated', message => checkEntity(message) ?? (normalizeModeState(message.data) === undefined ? 'payload mode choices are invalid' : undefined), '2.1'),
  define('power-limit', 'state', 'org.bunny.power-limit.updated', message=>{
    const issue=checkEntity(message);if(issue!==undefined)return issue;
    const record=message.data as PowerLimitRecord;
    if(record.deadlineMs!==(record.startedAtMs===null?null:record.startedAtMs+record.durationMs))return 'power-limit deadline must retain its original start';
    if(!record.enabled&&record.status!=='disabled'||record.enabled&&record.status==='disabled')return 'power-limit enabled/status mismatch';
    if((record.status==='armed'||record.status==='due')&&record.startedAtMs===null)return 'timed limit requires a known start';
    return undefined;
  }),
  define('inbox-item', 'state', 'org.bunny.inbox-item.updated', checkEntity),
  define('inbox-item', 'state', 'org.bunny.inbox-item.updated', message => {
    const checked = checkEntity(message);
    const {item} = message.data as InboxItem;
    return checked ?? (item.result === 'conflict' && !['succeeded', 'failed'].every(result => item.outcomes?.some(outcome => outcome.result === result) === true)
      ? 'payload /item/outcomes must retain opposite definitive results' : undefined);
  }, '2.1'),
  define('inbox-handle', 'command', 'org.bunny.inbox.handle.requested', routedSubject('routing')),
  define('playback', 'state', 'org.bunny.playback.updated', checkEntity),
  define('playback', 'state', 'org.bunny.playback.updated', checkPlaybackArtwork, '2.1'),
  define('operation', 'state', 'org.bunny.operation.updated', checkOperation),
  define('lifecycle', 'occurrence', 'org.bunny.lifecycle.observed', checkLifecycle),
  define('desktop-metadata', 'occurrence', 'org.bunny.desktop-metadata.observed', checkDesktopMetadata),
  define('attention-raised', 'occurrence', 'org.bunny.attention.raised', checkRaised),
  define('attention-cleared', 'occurrence', 'org.bunny.attention.cleared', checkOccurrence),
  define('turn-ended', 'occurrence', 'org.bunny.turn.ended', checkOccurrence),
  define('session-ended', 'occurrence', 'org.bunny.session.ended', checkOccurrence),
  define('moment-ended', 'occurrence', 'org.bunny.moment.ended'),
  define('outcome-recorded', 'occurrence', 'org.bunny.outcome.recorded', checkRecorded),
  define('mode-set', 'command', 'org.bunny.mode.set.requested'),
  define('mode-override-set', 'command', 'org.bunny.mode-override.set.requested', routedSubject('routing')),
  define('moment-play', 'command', 'org.bunny.moment.play.requested', checkMoment),
  define('notice-acknowledge', 'command', 'org.bunny.notice.acknowledge.requested', checkSessionSubject),
  define('approval-recover', 'command', 'org.bunny.approval.recover.requested', checkSessionSubject),
  define('notice-clear', 'command', 'org.bunny.notice.clear.requested', checkSessionSubject),
  define('session-label-set', 'command', 'org.bunny.session-label.set.requested', checkSessionLabel),
  define('playback-control', 'command', 'org.bunny.playback.control.requested', routedSubject('routing')),
  define('reachy-dispatch', 'command', 'org.bunny.reachy.dispatch.requested', message => message.subject === 'reachy' ? undefined : 'Reachy dispatch subject mismatch'),
  define('microduck-dispatch', 'command', 'org.bunny.microduck.dispatch.requested', message => message.subject === 'microduck' ? undefined : 'MicroDuck dispatch subject mismatch'),
  ...companionFamilies,
  ...codingFamilies,
  ...assistantFamilies,
  ...lightingLayoutFamilies,
  ...playbackLayoutFamilies,
  ...homeLayoutFamilies,
];

/**
 * Registers every core family with its checks. A family's messages must use its kind and type. Their replies,
 * outcomes, removals and sync messages use the payloads the profile owns.
 */
export function registerCoreFamilies(validator: MessageValidator): void {
  registerFamilies(validator, coreFamilies);
}
