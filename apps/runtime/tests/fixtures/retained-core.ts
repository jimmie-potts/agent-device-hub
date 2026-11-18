// The retained session path, for the differential test of Hub #1865 group 7: agent-state's owner on an in-memory store,
// fed the 1.2 envelope of each 2.0 observation, with the core store's projection and occurrence derivation of main
// 6adad7e7 copied here. It is the reference the core's own session logic is compared with, and lives only in the tests:
// the core no longer turns observations into envelopes or runs agent-state's owner.
import {createAgentState, MemoryStorage, type Commit, type DurableState, type Envelope, type Outcome, type Session, type Storage} from '@jimmie-potts/agent-state';
import {
  STALE_AFTER_MS, sessionEntityId, type AgentOccurrence, type Attention, type AttentionCleared, type Identity, type KnownId, type LifecycleEvent,
  type LifecycleObservation, type Ordering, type SessionRecord, type Title,
} from '@jimmie-potts/event-contracts/v2/families';
import {DEFAULT_CONSUMERS} from '../../src/index.js';

/** The 1.x event the reducer admits for a 2.0 lifecycle event: the same evidence, with its dotted kind. */
function eventOf(event: LifecycleEvent): Envelope['event'] {
  switch (event.kind) {
    case 'metadata-observed':
      throw new Error('metadata observations use the owner title operation');
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
 * The lifecycle 1.2 envelope for a 2.0 observation, as the core built it before #1865 group 7: `nativeEventId` is 1.x's
 * `eventId`, and known ordering drops the `authority` that 2.0 adds.
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

const reducedKind = (observation: LifecycleObservation): string => observation.event.kind === 'metadata-observed' ? 'metadata.observed' : eventOf(observation.event).kind;
const entityOf = (session: Pick<Session, 'identity'>): string => sessionEntityId(session.identity);
const sameTurn = (a: KnownId, b: KnownId): boolean => a.status === 'known' && b.status === 'known' && a.id === b.id;
const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.provider === b.provider && a.client === b.client && a.hostId === b.hostId && a.sourceId === b.sourceId && a.sessionId === b.sessionId;
const orderingOf = (identity: Identity, ordering: Session['ordering']): Ordering =>
  ordering.status === 'known' ? {status: 'known', authority: identity.sourceId, epoch: ordering.epoch, sequence: ordering.sequence} : {status: 'unknown'};
type Projected = Omit<SessionRecord, 'revision'>;

function project(sessions: readonly Session[], restarted: ReadonlySet<string>, hostSessions: ReadonlyMap<string, string>, atMs: number): Map<string, Projected> {
  const records = sessions.map((session): Projected => {
    const id = entityOf(session), restartUncertain = restarted.has(id);
    const hostSessionId = session.parent.status === 'known' ? undefined : hostSessions.get(id);
    const {label, labelOrigin, title, project: name, projectId} = session;
    return {
      id, generation: session.generation ?? 0, identity: session.identity, parent: session.parent, turn: session.turn,
      activity: session.activity === 'ended' ? 'unknown' : session.activity,
      attention: session.attention.map(({id: attention, kind, turn}): Attention => ({id: attention, kind, turn})),
      notices: session.notices.map(({id: notice, kind, turn, acknowledgedBy}) => ({id: notice, kind, turn, acknowledgedBy: [...acknowledgedBy]})),
      read: session.read, unavailable: session.unavailable.map(({dimension, reason}) => ({dimension, reason})),
      ordering: orderingOf(session.identity, session.ordering), observedAtMs: session.observedAtMs, lastEvidenceAtMs: session.lastEvidenceAtMs,
      freshness: restartUncertain || atMs - session.lastEvidenceAtMs >= STALE_AFTER_MS ? 'uncertain' : 'current', restartUncertain,
      children: {active: 0, uncertain: 0},
      ...(label === undefined ? {} : {label: {value: label, origin: labelOrigin ?? 'user'}}),
      ...(title === undefined ? {} : {title}), ...(name === undefined ? {} : {project: name}), ...(projectId === undefined ? {} : {projectId}),
      ...(hostSessionId === undefined ? {} : {hostSessionId}),
    };
  });
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
  return new Map(records.map(record => [record.id, record]));
}

const changed = (stored: SessionRecord | undefined, next: Projected): boolean => {
  if (stored === undefined) return true;
  const {revision: _revision, ...rest} = stored;
  return JSON.stringify(rest) !== JSON.stringify(next);
};
const sameItem = (a: Attention, b: Attention): boolean => JSON.stringify([a.kind, a.id, a.turn]) === JSON.stringify([b.kind, b.id, b.turn]);
const attentionAdded = (before: readonly Attention[], after: readonly Attention[]): Attention[] => after.filter(item => !before.some(old => sameItem(old, item)));
function causeOf(kind: string, item: Attention, turn: KnownId): AttentionCleared['cause'] {
  if (sameTurn(item.turn, turn) && kind === 'attention.resolved') return 'resolved';
  if (sameTurn(item.turn, turn) && kind === 'turn.ended') return 'turn-ended';
  return 'turn-retired';
}
function noticeOf(before: Session['notices'], after: Session['notices'], turn: KnownId): string | undefined {
  const added = after.filter(notice => !before.some(old => old.id === notice.id));
  if (added.length === 1) return added[0]?.id;
  return after.find(notice => sameTurn(notice.turn, turn))?.id;
}

/** One message the retained path published: its type and data. */
export type Sent = {type: string; subject: string; data: unknown};
type Cause = {kind: string; entity: string; observation?: LifecycleObservation};

/**
 * agent-state's owner with the core store's per-commit planning of main 6adad7e7: restart uncertainty and host session
 * IDs kept beside the records, every record whose content changed republished at a new revision, and each commit's
 * occurrences derived from the session before and after it.
 */
export class RetainedCore {
  readonly sent: Sent[] = [];
  #owner: Awaited<ReturnType<typeof createAgentState>> | undefined;
  readonly #memory = new MemoryStorage();
  readonly #clock: () => number;
  readonly #archived: (identity: Identity, ancestors: readonly Identity[]) => boolean;
  #durable: DurableState | undefined;
  #records = new Map<string, SessionRecord>();
  #restarted = new Set<string>();
  #hostSessions = new Map<string, string>();
  #revision = 0;
  #cause: Cause | undefined;
  #started = false;

  constructor(clock: () => number, archived: (identity: Identity, ancestors: readonly Identity[]) => boolean = () => false) {
    this.#clock = clock;
    this.#archived = archived;
  }

  /** Starts the owner, as the core's start did: the owner and its startup maintenance, then fresh records. */
  async start(): Promise<void> {
    this.#started = false;
    const storage: Storage = {acquire: async (ownerId, signal) => {
      const lease = await this.#memory.acquire(ownerId, signal);
      return {
        load: async abort => {
          const loaded = await lease.load(abort) as DurableState | null;
          this.#durable = loaded ?? undefined;
          if (!this.#started) this.#restarted = new Set((loaded?.sessions ?? []).map(entityOf));
          this.#started = true;
          return loaded;
        },
        commit: async (change, abort) => {
          await lease.commit(change, abort);
          this.#committed(change, (await lease.load(abort)) as DurableState);
        },
        release: () => lease.release(),
      };
    }};
    this.#owner = await createAgentState({storage, ownerId: 'bunny-core', consumers: DEFAULT_CONSUMERS.map(consumer => ({...consumer})), clock: this.#clock,
      isArchived: (identity, _signal, ancestors) => Promise.resolve(this.#archived(identity, ancestors))});
    this.refresh();
  }

  /** Stops the owner and starts it again on what it committed, as a core restart did. */
  async restart(): Promise<void> {
    await this.#owner?.shutdown();
    // The core store loaded its published records ordered by entity ID.
    this.#records = new Map([...this.#records].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    await this.start();
  }

  async stop(): Promise<void> {
    await this.#owner?.shutdown();
    this.#owner = undefined;
  }

  #owned(): Awaited<ReturnType<typeof createAgentState>> {
    if (this.#owner === undefined) throw new Error('the retained owner is not running');
    return this.#owner;
  }

  async #during(cause: Cause | undefined, work: () => Promise<Outcome>): Promise<Outcome> {
    this.#cause = cause;
    try {
      return await work();
    } finally {
      this.#cause = undefined;
    }
  }

  observe(observation: LifecycleObservation): Promise<Outcome> {
    const cause = {kind: reducedKind(observation), entity: sessionEntityId(observation.identity), observation};
    return this.#during(cause, () => this.#owned().ingest(toEnvelope(observation)));
  }

  title(identity: Identity, title: Title, observedAtMs: number, observation: LifecycleObservation): Promise<Outcome> {
    return this.#during({kind: 'metadata.observed', entity: sessionEntityId(identity), observation}, () => this.#owned().setTitle(identity, title, observedAtMs));
  }

  label(identity: Identity, label: string | null): Promise<Outcome> {
    return this.#during({kind: 'label', entity: sessionEntityId(identity)}, () => this.#owned().setLabel(identity, label, 'user'));
  }

  acknowledge(identity: Identity, noticeId: string, consumerId: string): Promise<Outcome> {
    return this.#during({kind: 'notice.acknowledged', entity: sessionEntityId(identity)}, () => this.#owned().acknowledge(identity, noticeId, consumerId));
  }

  acknowledgeAll(identity: Identity, noticeId: string): Promise<Outcome> {
    return this.#during({kind: 'notice.acknowledged', entity: sessionEntityId(identity)}, () => this.#owned().acknowledgeAll(identity, noticeId));
  }

  recoverApproval(identity: Identity, turnId: string): Promise<Outcome> {
    const owner = this.#owned();
    return this.#during({kind: 'attention.resolved', entity: sessionEntityId(identity)}, () => owner.recoverApproval(identity, turnId, owner.snapshot().revision));
  }

  /** Runs the owner's maintenance, as its timer did, then brings freshness up to date, as the core's timer did. */
  async due(): Promise<void> {
    await this.#owned().maintain();
    this.refresh();
  }

  /** The records the retained path serves. */
  records(): SessionRecord[] {
    return [...this.#records.values()];
  }

  /** Publishes each record whose freshness or children changed, as the core store's refresh did. */
  refresh(): void {
    this.#publish(this.#plan(undefined, this.#clock()));
  }

  #committed(change: Commit, next: DurableState): void {
    const plan = this.#plan({change, next}, this.#clock());
    this.#durable = next;
    this.#publish(plan);
  }

  #publish(plan: {revision: number | undefined; records: SessionRecord[]; removed: string[]; messages: Sent[]; restarted: Set<string>; hostSessions: Map<string, string>}): void {
    if (plan.revision !== undefined) this.#revision = plan.revision;
    for (const record of plan.records) this.#records.set(record.id, record);
    for (const id of plan.removed) this.#records.delete(id);
    this.#restarted = plan.restarted;
    this.#hostSessions = plan.hostSessions;
    this.sent.push(...plan.messages);
  }

  /** The core store's `#plan` of main 6adad7e7, with its `#matches`, minus SQLite. */
  #plan(committed: {change: Commit; next: DurableState} | undefined, atMs: number): {revision: number | undefined; records: SessionRecord[]; removed: string[];
    messages: Sent[]; restarted: Set<string>; hostSessions: Map<string, string>} {
    const prior = this.#durable;
    const next = committed?.next ?? prior;
    const change = committed?.change;
    const restarted = new Set(this.#restarted);
    const hostSessions = new Map(this.#hostSessions);
    const cause = change === undefined ? undefined : this.#matches(change, prior, committed?.next);
    const intake = cause?.observation === undefined ? undefined : {...cause, observation: cause.observation};
    const before = new Map((prior?.sessions ?? []).map(session => [entityOf(session), session]));
    const after = new Map((next?.sessions ?? []).map(session => [entityOf(session), session]));
    if (intake !== undefined && intake.kind !== 'metadata.observed' && change?.replace === undefined) {
      const session = after.get(intake.entity), old = before.get(intake.entity);
      if (session !== undefined) {
        const fresh = intake.kind !== 'read.observed' &&
          (old === undefined || session.lastEvidenceAtMs !== old.lastEvidenceAtMs || session.observedAtMs !== old.observedAtMs);
        if (fresh) restarted.delete(intake.entity);
        const host = intake.observation.hostSessionId;
        if (session.parent.status === 'known' || host === undefined) hostSessions.delete(intake.entity);
        else hostSessions.set(intake.entity, host);
      }
    }
    for (const id of [...restarted]) if (!after.has(id)) restarted.delete(id);
    for (const id of [...hostSessions.keys()]) if (!after.has(id)) hostSessions.delete(id);
    const projected = project([...after.values()], restarted, hostSessions, atMs);
    const updated = [...projected.values()].filter(record => changed(this.#records.get(record.id), record));
    const removed = [...this.#records.keys()].filter(id => !projected.has(id));
    const ended: Sent[] = [];
    const occurrences: Sent[] = [];
    const revision = Math.max(this.#revision + 1, change?.revision ?? 0);
    const observed = (session: Session): AgentOccurrence => {
      const {turn, observedAtMs, occurredAtMs, ordering} = intake?.observation ?? {} as LifecycleObservation;
      return {session: entityOf(session), identity: session.identity, turn, observedAtMs, ...(occurredAtMs === undefined ? {} : {occurredAtMs}), ordering, revision};
    };
    const occurrence = (type: string, data: AgentOccurrence & Record<string, unknown>): Sent => ({type, subject: data.session, data});
    if (intake !== undefined && change?.replace !== undefined) {
      const session = before.get(intake.entity);
      if (session !== undefined) ended.push(occurrence('org.bunny.session.ended', observed(session)));
    }
    for (const [id, session] of after) {
      const old = before.get(id);
      const raised = attentionAdded(old?.attention ?? [], session.attention);
      const cleared = attentionAdded(session.attention, old?.attention ?? []);
      if (intake !== undefined && change?.replace === undefined && id === intake.entity) {
        const base = observed(session), turn = intake.observation.turn;
        for (const attention of raised) occurrences.push(occurrence('org.bunny.attention.raised', {...base, attention}));
        for (const attention of cleared) occurrences.push(occurrence('org.bunny.attention.cleared', {...base, attention, cause: causeOf(intake.kind, attention, turn)}));
        if (intake.kind === 'turn.ended') {
          const noticeId = noticeOf(old?.notices ?? [], session.notices, turn);
          occurrences.push(occurrence('org.bunny.turn.ended', {...base, ...(noticeId === undefined ? {} : {noticeId})}));
        }
      } else if (old !== undefined && cleared.length > 0 && change !== undefined) {
        const cause = change.replace === undefined && change.journal?.kind === 'attention.resolved' ? 'recovered' : 'turn-retired';
        for (const attention of cleared) {
          occurrences.push(occurrence('org.bunny.attention.cleared', {session: entityOf(session), identity: session.identity, turn: session.turn,
            observedAtMs: change.atMs, ordering: {status: 'unknown'}, revision, attention, cause}));
        }
      }
    }
    const removals = removed.map((id): Sent => {
      const retired = (next?.retirements ?? []).some(item => entityOf(item) === id && item.atMs === change?.atMs);
      return {type: 'org.bunny.session.removed', subject: id, data: {entity: {family: 'session', id}, revision, reason: retired ? 'retired' : 'expired'}};
    });
    const publishes = updated.length + removed.length + ended.length + occurrences.length > 0;
    const records = updated.map(({id, ...rest}): SessionRecord => ({id, revision, ...rest}));
    return {
      revision: publishes ? revision : undefined, records, removed, restarted, hostSessions,
      messages: [...ended, ...removals, ...records.map((record): Sent => ({type: 'org.bunny.session.updated', subject: record.id, data: record})), ...occurrences],
    };
  }

  #matches(change: Commit, prior: DurableState | undefined, next: DurableState | undefined): Cause | undefined {
    const intake = this.#cause;
    if (intake === undefined) return undefined;
    if (change.replace === undefined) {
      const metadata = intake.observation;
      if (intake.kind === 'metadata.observed' && change.journal === undefined && change.session !== undefined && entityOf(change.session) === intake.entity &&
        metadata?.event.kind === 'metadata-observed' && metadata.title !== undefined && change.session.metadataObservedAtMs === metadata.observedAtMs &&
        change.session.title?.value === metadata.title.value && change.session.title.source === metadata.title.source) return intake;
      return change.session !== undefined && entityOf(change.session) === intake.entity && change.journal?.kind === intake.kind ? intake : undefined;
    }
    const ended = intake.kind === 'runtime.ended' && (prior?.sessions ?? []).some(session => entityOf(session) === intake.entity) &&
      !(next?.sessions ?? []).some(session => entityOf(session) === intake.entity) &&
      (next?.retirements ?? []).some(item => entityOf(item) === intake.entity && item.atMs === change.atMs);
    return ended ? intake : undefined;
  }
}
