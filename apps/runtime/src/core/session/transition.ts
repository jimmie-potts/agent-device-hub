// The core's session transition (Hub #1865, design decision 5): one pure function from the stored sessions, one input and
// the core's instant to everything the change does. It returns the changed sessions, the removals with their reasons and
// the retirement guards they leave, the occurrences in publication order, and the next instant a session or guard falls
// due. The store commits the whole result in one transaction or nothing, and derives no cause and no occurrence itself.
//
// Provenance: agent-state's owner operations (packages/agent-state/src/index.ts: `ingest`, `setTitle`, `setLabel`,
// `acknowledge`, `acknowledgeAll`, `recoverApproval` and expiry), the core's occurrence derivation and read-receipt
// retention from the core store at main 6adad7e7, with their rules unchanged. agent-state's journal, migrations, startup
// settlements of older formats and its own timer do not come along: history replaces the journal, the core's first start
// on this release drops the old session data, and the core's scheduler runs expiry.
import type {
  AgentOccurrence, Attention, AttentionCleared, Identity, KnownId, LifecycleObservation, ReadProvenance, Title,
} from '@jimmie-potts/event-contracts/v2/families';
import {reduceSession} from './reducer.js';
import {desktop, eligibleStart, guarded, oldEnd, rememberRetirement} from './retirement.js';
import {SESSION_LIMITS, entityOf, sameTurn, type Consumer, type RetirementGuard, type StoredSession} from './model.js';

/** What the transition reads: the stored sessions in their order, the guards in theirs, and the core's revision now. */
export type SessionState = {
  readonly sessions: ReadonlyMap<string, StoredSession>;
  readonly guards: readonly RetirementGuard[];
  /** The core's current revision: a transaction that publishes carries the next one, and a session it creates takes it. */
  readonly revision: number;
  /** Sessions loaded at the core's start that have had no fresh lifecycle evidence since: restart uncertainty. */
  readonly restarted: ReadonlySet<string>;
};

/** What the transition needs of the core beyond the state. */
export type TransitionContext = {
  /** The core's instant of the change, which never goes back before an earlier change's. */
  readonly nowMs: number;
  /** The wall clock, which an observation's age is judged by, so a corrected clock jump cannot strand a producer. */
  readonly wallMs: number;
  readonly consumers: readonly Consumer[];
  /** Whether current archive evidence covers a Codex Desktop identity or one of its ancestors. */
  readonly archived?: (identity: Identity, ancestors: readonly Identity[]) => boolean;
};

/** One input to the transition. Commands name their session by its entity ID. */
export type SessionInput =
  | {readonly kind: 'observation'; readonly observation: LifecycleObservation}
  | {readonly kind: 'title'; readonly id: string; readonly title: Title; readonly observedAtMs: number}
  | {readonly kind: 'label'; readonly id: string; readonly label: string | null}
  | {readonly kind: 'acknowledge'; readonly id: string; readonly noticeId: string; readonly consumerId: string}
  | {readonly kind: 'acknowledge-all'; readonly id: string; readonly noticeId: string}
  | {readonly kind: 'recover-approval'; readonly id: string; readonly turnId: string}
  | {readonly kind: 'read-receipt'; readonly id: string; readonly receipt: ReadProvenance}
  | {readonly kind: 'expiry'};

/** An occurrence the change publishes, without the revision its transaction gives it. */
export type Occurrence = {
  readonly family: 'attention-raised' | 'attention-cleared' | 'turn-ended' | 'session-ended';
  readonly data: Omit<AgentOccurrence, 'revision'> & {attention?: Attention; cause?: AttentionCleared['cause']; noticeId?: string};
};

/** Why the transition refused an input; a refusal changes nothing. */
export type Refusal = 'capacity' | 'not-found' | 'invalid-state' | 'revision-conflict';

export type TransitionResult = {
  readonly outcome: 'applied' | 'duplicate' | 'stale' | 'ambiguous' | 'refused';
  readonly refusal?: Refusal;
  /** Every session the change writes, new or changed, in the state's order with new ones last. */
  readonly changed: readonly StoredSession[];
  /** Every session the change removes, with its reason. */
  readonly removed: readonly {readonly id: string; readonly reason: 'expired' | 'retired'}[];
  /** The whole guard list after the change, when it changed. */
  readonly guards?: readonly RetirementGuard[];
  /** `session-ended` occurrences, which go out before the change's removals. */
  readonly ended: readonly Occurrence[];
  /** Attention and turn occurrences, which go out after its records. */
  readonly occurrences: readonly Occurrence[];
  /** Sessions whose restart uncertainty the change ends with fresh lifecycle evidence. */
  readonly fresh: readonly string[];
  /** The next instant a session expires or a guard lapses after the change, if any. */
  readonly deadlineMs: number | undefined;
};

const empty = (state: SessionState, outcome: TransitionResult['outcome'], refusal?: Refusal): TransitionResult =>
  ({outcome, ...(refusal === undefined ? {} : {refusal}), changed: [], removed: [], ended: [], occurrences: [], fresh: [], deadlineMs: deadlineOf(state.sessions.values(), state.guards)});

/** The next instant a session goes a day without lifecycle evidence, or a guard is a day old. */
export function deadlineOf(sessions: Iterable<StoredSession>, guards: readonly RetirementGuard[]): number | undefined {
  let due = Infinity;
  for (const session of sessions) due = Math.min(due, session.lastEvidenceAtMs + SESSION_LIMITS.sessionAgeMs);
  for (const guard of guards) due = Math.min(due, guard.atMs + SESSION_LIMITS.sessionAgeMs);
  return due === Infinity ? undefined : due;
}

/** Applies one input to the stored sessions at the core's instant. Neither the state nor the input is changed. */
export function transition(state: SessionState, input: SessionInput, context: TransitionContext): TransitionResult {
  switch (input.kind) {
    case 'observation':
      return observe(state, input.observation, context);
    case 'expiry':
      return expire(state, context.nowMs);
    case 'recover-approval':
      return recover(state, input.id, input.turnId, context.nowMs);
    case 'title':
    case 'label':
    case 'acknowledge':
    case 'acknowledge-all':
    case 'read-receipt':
      return command(state, input, context);
  }
}

/** The result of a change to one session, with the occurrences it publishes. */
function changedOne(state: SessionState, before: StoredSession | undefined, after: StoredSession, outcome: 'applied' | 'ambiguous',
  occurrences: readonly Occurrence[] = [], fresh = false, extra: {removed?: TransitionResult['removed']; guards?: readonly RetirementGuard[]} = {}): TransitionResult {
  const sessions = new Map(state.sessions);
  for (const {id} of extra.removed ?? []) sessions.delete(id);
  sessions.set(after.id, after);
  const guards = extra.guards ?? state.guards;
  return {
    outcome, changed: [after], removed: extra.removed ?? [], ...(extra.guards === undefined ? {} : {guards: extra.guards}), ended: [], occurrences,
    fresh: fresh ? [after.id] : [], deadlineMs: deadlineOf(sessions.values(), guards),
  };
}

/**
 * Keeps a session's read receipt only while it still describes the session: the same turn, a root whose work has ended,
 * and the receipt's notice on that turn. The session's own read evidence replaces it.
 */
function keepReceipt(before: StoredSession, after: StoredSession, ownRead: boolean): void {
  const receipt = before.readReceipt;
  if (receipt === undefined) return;
  const keep = !ownRead && sameTurn(before.turn, after.turn) && after.parent.status !== 'known' && (after.activity === 'idle' || after.activity === 'interrupted') &&
    after.notices.some(notice => notice.id === receipt.noticeId && sameTurn(notice.turn, after.turn));
  if (!keep) delete after.readReceipt;
}

/** The subtree of a session: itself and every descendant linked by known parent selectors. */
function subtree(sessions: ReadonlyMap<string, StoredSession>, root: string): Set<string> {
  const ids = new Set([root]);
  let count = 0;
  while (count !== ids.size) {
    count = ids.size;
    for (const session of sessions.values()) if (session.parent.status === 'known' && ids.has(entityOf(session.parent.identity))) ids.add(session.id);
  }
  return ids;
}

/** Guards after a change at `atMs`: a day's worth, at most `SESSION_LIMITS.retirements`, the newest kept. */
const pruned = (guards: readonly RetirementGuard[], atMs: number): RetirementGuard[] =>
  guards.filter(guard => guard.atMs > atMs - SESSION_LIMITS.sessionAgeMs).slice(-SESSION_LIMITS.retirements);

/**
 * Retires the named sessions and every descendant in one change, leaving a bounded guard for each against recognizable
 * delayed events. One rule serves every provider and client; retirement forgets monitoring state and asserts nothing else.
 */
function retireTrees(state: SessionState, roots: readonly string[], atMs: number, end?: LifecycleObservation): {removed: Set<string>; guards: RetirementGuard[]} {
  const removed = new Set(roots.flatMap(root => [...subtree(state.sessions, root)]));
  const guards = state.guards.filter(guard => !removed.has(guard.id));
  for (const session of state.sessions.values()) {
    if (removed.has(session.id)) guards.push(rememberRetirement(session, state.guards.find(guard => guard.id === session.id), atMs, end));
  }
  return {removed, guards: pruned(guards, atMs)};
}

/**
 * Hub #807: the child session to retire for a new root, or none. Its whole subtree must be finished (idle or interrupted;
 * active and unknown may still be running) and hold no attention, so a running subagent or a pending approval never
 * disappears to make room. The subtree whose newest evidence is oldest goes first; ties go to the lower identity key.
 */
function displaceableChild(state: SessionState): StoredSession | undefined {
  let best: {session: StoredSession; at: number; key: string} | undefined;
  for (const session of state.sessions.values()) {
    if (session.parent.status !== 'known') continue;
    const members = [...subtree(state.sessions, session.id)].flatMap(id => state.sessions.get(id) ?? []);
    if (members.some(member => member.attention.length > 0 || !(member.activity === 'idle' || member.activity === 'interrupted'))) continue;
    const at = Math.max(...members.map(member => member.lastEvidenceAtMs));
    const key = identityOrder(session.identity);
    if (best === undefined || at < best.at || at === best.at && key < best.key) best = {session, at, key};
  }
  return best?.session;
}
const identityOrder = (identity: Identity): string =>
  JSON.stringify([identity.provider, identity.client, identity.hostId, identity.sourceId, identity.sessionId]);

/** What every occurrence of an observation carries: its session, identity, turn, evidence and ordering. */
function observed(observation: LifecycleObservation, session: StoredSession): Occurrence['data'] {
  const {turn, observedAtMs, occurredAtMs, ordering} = observation;
  return {session: session.id, identity: structuredClone(session.identity), turn: structuredClone(turn), observedAtMs,
    ...(occurredAtMs === undefined ? {} : {occurredAtMs}), ordering: structuredClone(ordering)};
}

const sameItem = (a: Attention, b: Attention): boolean => JSON.stringify([a.kind, a.id, a.turn]) === JSON.stringify([b.kind, b.id, b.turn]);
/** The attention items `after` holds that `before` did not. */
export const attentionAdded = (before: readonly Attention[], after: readonly Attention[]): Attention[] =>
  after.filter(item => !before.some(old => sameItem(old, item)));

/** Why an observation cleared an item: its own turn's resolution or end, or a newer turn retiring the item's turn. */
function causeOf(kind: string, item: Attention, turn: KnownId): AttentionCleared['cause'] {
  if (sameTurn(item.turn, turn) && kind === 'attention-resolved') return 'resolved';
  if (sameTurn(item.turn, turn) && kind === 'turn-ended') return 'turn-ended';
  return 'turn-retired';
}

/** The notice a turn end retained: the one it added, or the one already held for its known turn. */
function noticeOf(before: StoredSession['notices'], after: StoredSession['notices'], turn: KnownId): string | undefined {
  const added = after.filter(notice => !before.some(old => old.id === notice.id));
  if (added.length === 1) return added[0]?.id;
  return after.find(notice => sameTurn(notice.turn, turn))?.id;
}

/** The occurrences one observation's change publishes: attention raised and cleared, then the turn's end. */
function occurrencesOf(observation: LifecycleObservation, before: StoredSession | undefined, after: StoredSession): Occurrence[] {
  const base = observed(observation, after);
  const kind = observation.event.kind;
  const occurrences: Occurrence[] = [];
  for (const attention of attentionAdded(before?.attention ?? [], after.attention)) occurrences.push({family: 'attention-raised', data: {...base, attention}});
  for (const attention of attentionAdded(after.attention, before?.attention ?? [])) {
    occurrences.push({family: 'attention-cleared', data: {...base, attention, cause: causeOf(kind, attention, observation.turn)}});
  }
  if (kind === 'turn-ended') {
    const noticeId = noticeOf(before?.notices ?? [], after.notices, observation.turn);
    occurrences.push({family: 'turn-ended', data: {...base, ...(noticeId === undefined ? {} : {noticeId})}});
  }
  return occurrences;
}

function observe(state: SessionState, observation: LifecycleObservation, context: TransitionContext): TransitionResult {
  const {nowMs: now} = context;
  const id = entityOf(observation.identity);
  const kind = observation.event.kind;
  const previous = state.sessions.get(id);
  // Read evidence and a runtime end describe a known session; alone they cannot establish one.
  if (previous === undefined && (kind === 'read-observed' || kind === 'runtime-ended')) return empty(state, 'stale');
  // An observation older than the retention window is not new activity. It is judged by the wall clock, not the change's
  // instant, so a corrected clock jump cannot strand producers.
  if (observation.observedAtMs <= context.wallMs - SESSION_LIMITS.sessionAgeMs) return empty(state, 'stale');
  const guardOf = (key: string): RetirementGuard | undefined => state.guards.find(guard => guard.id === key);
  const old = guardOf(id);
  const parent = observation.parent;
  if (guarded(observation, old) || previous === undefined && old !== undefined && !eligibleStart(observation) ||
    previous === undefined && parent.status === 'known' && !state.sessions.has(entityOf(parent.identity)) && guardOf(entityOf(parent.identity)) !== undefined) {
    return empty(state, 'stale');
  }
  if (previous !== undefined && kind === 'runtime-ended') {
    if (oldEnd(observation, previous)) return empty(state, 'stale');
    const {removed, guards} = retireTrees(state, [id], now, observation);
    const sessions = [...state.sessions.values()].filter(session => !removed.has(session.id));
    return {
      outcome: 'applied', changed: [], removed: [...state.sessions.keys()].filter(key => removed.has(key)).map(key => ({id: key, reason: 'retired' as const})),
      guards, ended: [{family: 'session-ended', data: observed(observation, previous)}], occurrences: [], fresh: [], deadlineMs: deadlineOf(sessions, guards),
    };
  }
  const full = previous === undefined && state.sessions.size >= SESSION_LIMITS.sessions;
  // A new child never makes room (Hub #807).
  if (full && parent.status === 'known') return empty(state, 'refused', 'capacity');
  if (previous === undefined && desktop(observation.identity) && archived(state, observation, context)) return empty(state, 'stale');
  const reduced = reduceSession(previous, observation, now, context.consumers, state.revision + 1);
  if (reduced.capacity === true) return empty(state, 'refused', 'capacity');
  const session = reduced.session;
  if (session === undefined) return empty(state, reduced.outcome);
  const outcome = reduced.outcome === 'ambiguous' ? 'ambiguous' : 'applied';
  let displaced: {removed: TransitionResult['removed']; guards: readonly RetirementGuard[]} | undefined;
  if (full) {
    // Hub #807: subagent records must not crowd a new root task out for a day. Only an observation that creates a root
    // retires one finished child subtree without attention, through the ordinary retirement path, so its later events
    // other than an eligible start are stale. Roots are never displaced; without an eligible child the root is refused.
    const victim = displaceableChild(state);
    if (victim === undefined) return empty(state, 'refused', 'capacity');
    const {removed, guards} = retireTrees(state, [victim.id], now);
    displaced = {removed: [...state.sessions.keys()].filter(key => removed.has(key)).map(key => ({id: key, reason: 'retired' as const})), guards};
  }
  // Only a committed observation speaks for the host session: present sets, absent clears. A session whose parent is
  // known never carries one.
  if (session.parent.status === 'known' || observation.hostSessionId === undefined) delete session.hostSessionId;
  else session.hostSessionId = observation.hostSessionId;
  if (previous !== undefined) keepReceipt(previous, session, kind === 'read-observed');
  // Fresh lifecycle evidence ends restart uncertainty; read evidence and a repeat that refreshed nothing do not.
  const fresh = kind !== 'read-observed' &&
    (previous === undefined || session.lastEvidenceAtMs !== previous.lastEvidenceAtMs || session.observedAtMs !== previous.observedAtMs);
  return changedOne(state, previous, session, outcome, occurrencesOf(observation, previous, session), fresh, displaced ?? {});
}

/** Whether current archive evidence covers a new Codex Desktop session or a known ancestor, including its missing topmost parent. */
function archived(state: SessionState, observation: LifecycleObservation, context: TransitionContext): boolean {
  if (context.archived === undefined) return false;
  const ancestors: Identity[] = [];
  const seen = new Set([entityOf(observation.identity)]);
  let parent = observation.parent;
  while (parent.status === 'known' && !seen.has(entityOf(parent.identity))) {
    seen.add(entityOf(parent.identity));
    ancestors.push(parent.identity);
    parent = state.sessions.get(entityOf(parent.identity))?.parent ?? {status: 'unknown'};
  }
  return context.archived(observation.identity, ancestors);
}

/**
 * Retention forgets monitoring state after a day without lifecycle evidence. It is not acknowledgment, readership,
 * success or cancellation. Guards a day old lapse with it.
 */
function expire(state: SessionState, now: number): TransitionResult {
  const gone = [...state.sessions.values()].filter(session => session.lastEvidenceAtMs <= now - SESSION_LIMITS.sessionAgeMs);
  if (gone.length === 0 && !state.guards.some(guard => guard.atMs <= now - SESSION_LIMITS.sessionAgeMs)) return empty(state, 'duplicate');
  const guards = pruned(state.guards, now);
  const sessions = [...state.sessions.values()].filter(session => !gone.includes(session));
  return {
    outcome: 'applied', changed: [], removed: gone.map(session => ({id: session.id, reason: 'expired' as const})), guards, ended: [], occurrences: [], fresh: [],
    deadlineMs: deadlineOf(sessions, guards),
  };
}

/**
 * Operator approval recovery: retires the one approval marker without an attention ID that the session holds on
 * `turnId`, only while its evidence is uncertain, five minutes without evidence or since a restart. No observation
 * started it, so its occurrence carries the session's current turn, the core's instant and unknown ordering.
 */
function recover(state: SessionState, id: string, turnId: string, now: number): TransitionResult {
  const previous = state.sessions.get(id);
  if (previous === undefined) return empty(state, 'refused', 'not-found');
  if (previous.turn.status !== 'known' || previous.turn.id !== turnId ||
    !(state.restarted.has(id) || now - previous.lastEvidenceAtMs >= SESSION_LIMITS.staleMs)) return empty(state, 'refused', 'invalid-state');
  const target = (item: Attention): boolean => item.kind === 'approval' && item.id.status === 'unknown' && item.turn.status === 'known' && item.turn.id === turnId;
  if (previous.attention.filter(target).length !== 1) return empty(state, 'refused', 'invalid-state');
  const session = structuredClone(previous);
  const [cleared] = session.attention.splice(session.attention.findIndex(target), 1);
  keepReceipt(previous, session, false);
  const data: Occurrence['data'] = {session: id, identity: structuredClone(session.identity), turn: structuredClone(session.turn), observedAtMs: now,
    ordering: {status: 'unknown'}, ...(cleared === undefined ? {} : {attention: cleared}), cause: 'recovered'};
  return changedOne(state, previous, session, 'applied', [{family: 'attention-cleared', data}]);
}

/** Title, label, acknowledgment and read receipt: changes to one known session's metadata or outcome. */
function command(state: SessionState, input: Exclude<SessionInput, {kind: 'observation' | 'expiry' | 'recover-approval'}>, context: TransitionContext): TransitionResult {
  const previous = state.sessions.get(input.id);
  const session = previous === undefined ? undefined : structuredClone(previous);
  switch (input.kind) {
    case 'title': {
      // Provider title evidence changes display metadata only: it cannot establish a session or refresh lifecycle evidence.
      if (previous === undefined || session === undefined || previous.parent.status === 'known' || input.observedAtMs < (previous.metadataObservedAtMs ?? 0)) return empty(state, 'stale');
      if (previous.title?.value === input.title.value && previous.title.source === input.title.source && previous.metadataObservedAtMs === input.observedAtMs) {
        return empty(state, 'duplicate');
      }
      session.title = {value: input.title.value, source: input.title.source};
      session.metadataObservedAtMs = input.observedAtMs;
      break;
    }
    case 'label':
      if (previous === undefined || session === undefined) return empty(state, 'refused', 'not-found');
      if (input.label === null) delete session.label;
      else session.label = {value: input.label, origin: 'user'};
      break;
    case 'acknowledge': {
      const notice = session?.notices.find(item => item.id === input.noticeId);
      if (previous === undefined || session === undefined || notice === undefined || !context.consumers.some(consumer => consumer.id === input.consumerId)) {
        return empty(state, 'refused', 'not-found');
      }
      if (notice.acknowledgedBy.includes(input.consumerId)) return empty(state, 'duplicate');
      notice.acknowledgedBy.push(input.consumerId);
      break;
    }
    case 'acknowledge-all': {
      // Acknowledges the session's latest notice for every configured consumer at once.
      if (previous === undefined || session === undefined) return empty(state, 'refused', 'not-found');
      const notice = session.notices.at(-1);
      if (notice?.id !== input.noticeId) return empty(state, 'refused', 'revision-conflict');
      const missing = context.consumers.filter(consumer => !notice.acknowledgedBy.includes(consumer.id));
      if (missing.length === 0) return empty(state, 'duplicate');
      notice.acknowledgedBy.push(...missing.map(consumer => consumer.id));
      break;
    }
    case 'read-receipt':
      if (previous === undefined || session === undefined) return empty(state, 'refused', 'not-found');
      session.readReceipt = structuredClone(input.receipt);
      return changedOne(state, previous, session, 'applied');
  }
  keepReceipt(previous, session, false);
  return changedOne(state, previous, session, 'applied');
}
