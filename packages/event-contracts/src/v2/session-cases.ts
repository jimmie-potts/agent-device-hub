// The shared synthetic session case set (Hub #1865, design decision 10) and its loader. Each case in
// `fixtures/v2/session-cases.json` holds an input sequence (observations, commands, clock advances, restarts and the
// cutover reset), and for each check the expected records, removals and occurrences and each reader's expected output.
// The core's tests and every session reader's tests load the cases here, so the JSON stays compact: named synthetic
// sessions, turns by name and times as offsets. The loader expands them into full profile 2.0 messages, each expected
// record a `session/3.0` state built with `buildSession`, and refuses a case whose message the core families do not
// accept. Nothing here is a real session, title, prompt or host.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {coreValidator, sessionEntityId, type Attention, type Identity, type KnownId, type LifecycleEvent, type LifecycleObservation,
  type Notice, type NoticeAcknowledgeRequest, type Parent, type Session30Record, type Unavailable, type WorkClaim} from './families.js';
import type {Message} from './index.js';
import {buildSession, forConsumer, readSession, SESSION_SCHEMA, type ConsumerPolicy, type SessionView} from './session.js';

const LIFECYCLE_SCHEMA = 'https://bunny.invalid/events/lifecycle/2.0';
const ACKNOWLEDGE_SCHEMA = 'https://bunny.invalid/events/notice-acknowledge/2.0';
/** The source of synthetic hook observations, and of the Codex Desktop module's own. */
const HOOK_SOURCE = 'bunny/hooks/synthetic-host';
const DESKTOP_SOURCE = 'bunny/modules/codex-desktop';
const MAX_FILL = 128;

/** A named synthetic session: its identity, and its parent as `unknown`, `top-level` or another session's name. */
export type CaseSession = {identity: Identity; parent: string};
/** An attention item by kind, ID and turn names; null is unknown. */
export type CompactAttention = {kind: Attention['kind']; id: string | null; turn: string | null};
type CompactNotice = {turn: string | null; acknowledgedBy: string[]; id?: string};
/** One observation. It is observed at its step's instant unless `observedAtMs` names an earlier one. */
type CompactObservation = {
  session: string; turn: string | null; event: LifecycleEvent; ordering?: {epoch: string; sequence: number};
  nativeEventId?: string; observedAtMs?: number; occurredAtMs?: number;
};
type CompactStep = {atMs: number} & (
  | {observe: CompactObservation}
  | {again: number}
  | {conflict: number; observe: CompactObservation}
  | {acknowledge: {session: string; consumer: string; notice: string}}
  | {advance: true}
  | {restart: true}
  | {reset: true}
  | {fill: {count: number}}
);
/**
 * One expected record: its work state, why running work is unconfirmed besides its evidence (`restart`),
 * and its children as `[working, unconfirmed]`. Its status follows from its claims.
 */
type CompactRecord = {
  session: string; revision: number; generation: number; turn: string | null; work: WorkClaim['state'];
  attention?: CompactAttention[]; notices?: CompactNotice[]; read?: Session30Record['outcome']['read']; unavailable?: [Unavailable['dimension'], Unavailable['reason']][];
  ordering?: {epoch: string; sequence: number}; observedAtMs: number; lastEvidenceAtMs: number; unconfirmed?: 'restart';
  children?: [number, number];
};
type CompactCheck = {
  after: number; atMs: number; synced?: boolean; records: CompactRecord[]; fill?: {revision: number};
  removed?: CaseRemoval[]; occurrences?: CompactOccurrence[]; views?: Record<string, {status: SessionView['status']}>; readers: ReaderExpectations;
};
type CompactCase = {id: string; name: string; covers: string; since: CaseSince; steps: CompactStep[]; checks: CompactCheck[]};
type CaseFile = {description: string; startAtMs: number; sessions: Record<string, CaseSession>; policies: Record<string, ConsumerPolicy>; cases: CompactCase[]};

/** The first step whose core behavior a case pins: today's core, the storage step (7) or the restart and root-start step (8). */
export type CaseSince = 'now' | 'step 7' | 'step 8';
/** A removal a check expects, with its reason. */
export type CaseRemoval = {session: string; reason: 'expired' | 'retired'};
/** An occurrence a check expects since the previous check, in publication order. */
export type CompactOccurrence =
  | {kind: 'attention-raised'; session: string; attention: CompactAttention}
  | {kind: 'attention-cleared'; session: string; attention: CompactAttention; cause: 'resolved' | 'turn-ended' | 'turn-retired' | 'recovered'}
  | {kind: 'turn-ended'; session: string; notice: string | null}
  | {kind: 'session-ended'; session: string};
/** A Tronbyt status row: its state and whether it shows `?`. */
export type TronbytRow = ['ASK' | 'RUN' | 'DONE', boolean];
/** A Nanoleaf task status (design decision 10): the task's state on the Lines. */
export type NanoleafTask = 'blocked' | 'question' | 'working' | 'unread' | 'idle';
/** What each reader shows at a check. Sessions are named as in the case file; a status is `class/detail`. */
export type ReaderExpectations = {
  /** The hub's status of each session in the copy. */
  status: Record<string, string>;
  /** Each named policy's status of the sessions where it differs from the hub's. */
  policies?: Record<string, Record<string, string>>;
  /** `highestStatus` with no acknowledging consumers, as LIFX shows it. */
  lifx: string;
  /** The Tronbyt status rows, in order. */
  tronbyt: TronbytRow[];
  /** Whether the Pixoo Monitor marks each root row uncertain. */
  pixoo: Record<string, boolean>;
  /** Whether the Pixoo Monitor shows each root row's children marker, where the case pins it. */
  pixooChildren?: Record<string, boolean>;
  /** Each Nanoleaf task's status by its root, and the tasks the Lines hold steady for unconfirmed work. */
  nanoleaf: {tasks: Record<string, NanoleafTask>; steady: string[]};
  /** The dashboard chip of each session. */
  dashboard: Record<string, string>;
  /** Opportunity matches: an opportunity the core raised for a session's item or notice, judged now for a consumer. */
  opportunities?: {session: string; for: 'attention' | 'notice'; raisedAt: number; consumer: string; matches: boolean}[];
};

/** One step of a case's input sequence, at its instant. */
export type CaseStep = {atMs: number} & (
  | {kind: 'observe'; message: Message<LifecycleObservation>}
  | {kind: 'deliver'; message: Message<LifecycleObservation>; repeats: number}
  | {kind: 'acknowledge'; message: Message<NoticeAcknowledgeRequest>}
  | {kind: 'fill'; messages: Message<LifecycleObservation>[]}
  | {kind: 'advance' | 'restart' | 'reset'}
);
/** What a case expects after `after` steps, at `atMs`. */
export type CaseCheck = {
  after: number; atMs: number; synced: boolean;
  /** The expected copy: each record as the session state message the core publishes, at the check's instant. */
  messages: Message<Session30Record>[];
  /** The records by session name, fillers excluded. */
  records: Record<string, Session30Record>;
  removed: CaseRemoval[]; occurrences: CompactOccurrence[];
  /** The views readers see: `readSession` of each message, with the case's view overrides applied. */
  views: Record<string, SessionView>;
  readers: ReaderExpectations;
};
export type SessionCase = {id: string; name: string; covers: string; since: CaseSince; steps: CaseStep[]; checks: CaseCheck[]};
/** The loaded case set: its instants, named sessions, named reader policies and cases. */
export type SessionCases = {startAtMs: number; sessions: Readonly<Record<string, CaseSession>>; policies: Readonly<Record<string, ConsumerPolicy>>; cases: SessionCase[]};

const hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const knownId = (id: string | null): KnownId => id === null ? {status: 'unknown'} : {status: 'known', id};
const iso = (ms: number): string => new Date(ms).toISOString();
const traceparent = (id: string): string => `00-${hex(`trace ${id}`).slice(0, 32)}-${hex(`span ${id}`).slice(0, 16)}-01`;
const identityKey = (identity: Identity): string =>
  JSON.stringify([identity.provider, identity.client, identity.hostId, identity.sourceId, identity.sessionId]);
/** A turn-ended notice's ID as the core derives it for a known turn. */
export const noticeIdOf = (identity: Identity, turn: string): string => hex(JSON.stringify([identityKey(identity), turn, 'turn-ended']));

function checked<T>(value: Message<T>, where: string): Message<T> {
  const result = coreValidator().validate(value);
  if (!result.ok) throw new Error(`session case ${where}: ${result.error.detail ?? result.error.code}`);
  return value;
}

/** Loads and expands the shared case set, refusing any case whose messages the core families do not accept. */
export function loadSessionCases(): SessionCases {
  const file = JSON.parse(readFileSync(new URL('../../fixtures/v2/session-cases.json', import.meta.url), 'utf8')) as CaseFile;
  const {startAtMs, sessions, policies} = file;
  const named = (name: string): CaseSession => {
    const found = Object.hasOwn(sessions, name) ? sessions[name] : fillerOf(name);
    if (found === undefined) throw new Error(`session case: unknown session ${name}`);
    return found;
  };
  const parentOf = (name: string): Parent => {
    const {parent} = named(name);
    return parent === 'unknown' || parent === 'top-level' ? {status: parent} : {status: 'known', identity: named(parent).identity};
  };
  const ids = new Set<string>();
  let checkCount = 0;

  function observation(where: string, id: string, atMs: number, compact: CompactObservation): Message<LifecycleObservation> {
    const {identity} = named(compact.session);
    const data: LifecycleObservation = {
      identity, turn: knownId(compact.turn), parent: parentOf(compact.session), event: compact.event,
      observedAtMs: startAtMs + (compact.observedAtMs ?? atMs),
      ordering: compact.ordering === undefined ? {status: 'unknown'} : {status: 'known', authority: identity.sourceId, ...compact.ordering},
      ...(compact.nativeEventId === undefined ? {} : {nativeEventId: compact.nativeEventId}),
      ...(compact.occurredAtMs === undefined ? {} : {occurredAtMs: startAtMs + compact.occurredAtMs}),
    };
    return checked({
      specversion: '1.0', bunnyprofile: '2.0', id, source: identity.client === 'desktop' ? DESKTOP_SOURCE : HOOK_SOURCE,
      type: 'org.bunny.lifecycle.observed', subject: sessionEntityId(identity), time: iso(startAtMs + atMs), kind: 'occurrence',
      datacontenttype: 'application/json', dataschema: LIFECYCLE_SCHEMA, traceparent: traceparent(id), data,
    }, where);
  }

  function record(where: string, atMs: number, compact: CompactRecord): Message<Session30Record> {
    const {identity} = named(compact.session);
    const timeMs = startAtMs + atMs;
    const notices: Notice[] = (compact.notices ?? []).map(notice => ({
      id: notice.id ?? (notice.turn === null ? '' : noticeIdOf(identity, notice.turn)), kind: 'turn-ended', turn: knownId(notice.turn),
      acknowledgedBy: notice.acknowledgedBy,
    }));
    const [working, unconfirmed] = compact.children ?? [0, 0];
    const data = buildSession({
      id: sessionEntityId(identity), revision: compact.revision, generation: compact.generation, identity, parent: parentOf(compact.session),
      turn: knownId(compact.turn), work: compact.work, ...(compact.unconfirmed === undefined ? {} : {unconfirmed: compact.unconfirmed}),
      attention: (compact.attention ?? []).map(item => ({id: knownId(item.id), kind: item.kind, turn: knownId(item.turn)})),
      notices, read: compact.read ?? 'unknown', children: {working, unconfirmed},
      unavailable: (compact.unavailable ?? []).map(([dimension, reason]) => ({dimension, reason})),
      ordering: compact.ordering === undefined ? {status: 'unknown'} : {status: 'known', authority: identity.sourceId, ...compact.ordering},
      observedAtMs: startAtMs + compact.observedAtMs, lastEvidenceAtMs: startAtMs + compact.lastEvidenceAtMs,
    });
    const id = `${where.replace(/[^A-Za-z0-9_.-]/g, '-')}-${compact.session}`;
    return checked({
      specversion: '1.0', bunnyprofile: '2.0', id, source: 'bunny/core', type: 'org.bunny.session.updated', subject: data.id,
      time: iso(timeMs), kind: 'state', datacontenttype: 'application/json',
      dataschema: SESSION_SCHEMA, traceparent: traceparent(id), data,
    }, where);
  }

  const cases = file.cases.map((compact): SessionCase => {
    if (ids.has(compact.id)) throw new Error(`session case: duplicate case ${compact.id}`);
    ids.add(compact.id);
    const fillers: string[] = [];
    const steps = compact.steps.map((step, index): CaseStep => {
      const where = `${compact.id} step ${index}`, id = `${compact.id}-${index}`;
      if ('fill' in step) {
        if (step.fill.count < 1 || step.fill.count > MAX_FILL) throw new Error(`session case ${where}: fill count`);
        const names = Array.from({length: step.fill.count}, (_, n) => `filler-${String(n).padStart(3, '0')}`);
        fillers.push(...names);
        return {atMs: step.atMs, kind: 'fill', messages: names.map(name =>
          observation(where, `${id}-${name}`, step.atMs, {session: name, turn: null, event: {kind: 'session-started'}}))};
      }
      if ('conflict' in step) {
        const earlier = compact.steps[step.conflict];
        if (earlier === undefined || !('observe' in earlier)) throw new Error(`session case ${where}: conflict names no observation`);
        return {atMs: step.atMs, kind: 'deliver', repeats: step.conflict, message: observation(where, `${compact.id}-${step.conflict}`, step.atMs, step.observe)};
      }
      if ('observe' in step) return {atMs: step.atMs, kind: 'observe', message: observation(where, id, step.atMs, step.observe)};
      if ('again' in step) {
        const earlier = compact.steps[step.again];
        if (earlier === undefined || !('observe' in earlier)) throw new Error(`session case ${where}: again names no observation`);
        return {atMs: step.atMs, kind: 'deliver', repeats: step.again, message: observation(where, `${compact.id}-${step.again}`, earlier.atMs, earlier.observe)};
      }
      if ('acknowledge' in step) {
        const {session, consumer, notice} = step.acknowledge;
        const {identity} = named(session);
        return {atMs: step.atMs, kind: 'acknowledge', message: checked({
          specversion: '1.0', bunnyprofile: '2.0', id, source: `bunny/modules/${consumer}`, type: 'org.bunny.notice.acknowledge.requested',
          subject: sessionEntityId(identity), time: iso(startAtMs + step.atMs), expiresat: iso(startAtMs + step.atMs + 5000), kind: 'command',
          datacontenttype: 'application/json', dataschema: ACKNOWLEDGE_SCHEMA, traceparent: traceparent(id),
          data: {requestId: id, consumerId: consumer, noticeId: noticeIdOf(identity, notice)},
        }, where)};
      }
      if ('advance' in step) return {atMs: step.atMs, kind: 'advance'};
      if ('restart' in step) return {atMs: step.atMs, kind: 'restart'};
      return {atMs: step.atMs, kind: 'reset'};
    });
    const checks = compact.checks.map((check, index): CaseCheck => {
      const where = `${compact.id} check ${index}`;
      if (check.after < 1 || check.after > steps.length) throw new Error(`session case ${where}: after`);
      const messages = check.records.map(item => record(where, check.atMs, item));
      const fill = check.fill;
      const filled = fill === undefined ? [] : fillers.map(name => record(where, check.atMs, {
        session: name, revision: fill.revision, generation: fill.revision, turn: null, work: 'idle',
        unavailable: [['turn', 'missing'], ['ordering', 'missing']], observedAtMs: 0, lastEvidenceAtMs: 0,
      }));
      const views: Record<string, SessionView> = {};
      const records: Record<string, Session30Record> = {};
      check.records.forEach((item, at) => {
        const message = messages[at];
        const view = message === undefined ? undefined : readSession(message);
        if (message === undefined || view === undefined) throw new Error(`session case ${where}: ${item.session} unreadable`);
        records[item.session] = message.data;
        const override = check.views?.[item.session];
        views[item.session] = override === undefined ? view : {...view, ...override};
      });
      checkCount++;
      return {
        after: check.after, atMs: check.atMs, synced: check.synced ?? true, messages: [...messages, ...filled], records,
        removed: check.removed ?? [], occurrences: check.occurrences ?? [], views, readers: check.readers,
      };
    });
    return {id: compact.id, name: compact.name, covers: compact.covers, since: compact.since, steps, checks};
  });
  if (cases.length === 0 || checkCount === 0) throw new Error('session case: empty case set');
  return {startAtMs, sessions: Object.freeze({...sessions}), policies: Object.freeze({...policies}), cases};

  function fillerOf(name: string): CaseSession | undefined {
    const match = /^filler-(\d{3})$/.exec(name);
    if (match === null) return undefined;
    const codex = Number(match[1]) % 2 === 1;
    return {
      identity: codex ? {provider: 'codex', client: 'local', hostId: 'synthetic-host', sourceId: 'codex-hooks', sessionId: `synthetic-${name}`}
        : {provider: 'claude', client: 'code', hostId: 'synthetic-host', sourceId: 'claude-hooks', sessionId: `synthetic-${name}`},
      parent: 'unknown',
    };
  }
}

/** A view as one named policy of the case set shows it. */
export function policyView(cases: SessionCases, policy: string, view: SessionView): SessionView {
  const found = Object.hasOwn(cases.policies, policy) ? cases.policies[policy] : undefined;
  if (found === undefined) throw new Error(`session case: unknown policy ${policy}`);
  return forConsumer(view, found);
}

/** A status as the case set writes it: `class/detail`. */
export const statusText = (view: Pick<SessionView, 'status'>): string => `${view.status.class}/${view.status.detail}`;
