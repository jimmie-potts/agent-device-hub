// Retirement guards (Hub #1865): agent-state's packages/agent-state/src/retirement.ts, ported to observations. A retired
// session leaves a guard for a day, bounded in count, so its delayed events cannot bring it back.
import type {Identity, LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {semanticKey} from './reducer.js';
import {SESSION_LIMITS, entityOf, type RetirementGuard, type StoredSession} from './model.js';

/** Archive admission evidence stays specific to Codex Desktop conversations. */
export const desktop = (identity: Identity): boolean => identity.provider === 'codex' && identity.client === 'desktop';
/** Only a start may establish a session again under a guard. */
export const eligibleStart = (observation: LifecycleObservation): boolean =>
  observation.event.kind === 'session-started' || observation.event.kind === 'turn-started';
const recent = <T>(values: T[], maximum: number): T[] => [...new Set(values)].slice(-maximum);

function orders(values: {epoch: string; sequence: number}[]): {epoch: string; sequence: number}[] {
  const result = new Map<string, number>();
  for (const value of values) result.set(value.epoch, Math.max(result.get(value.epoch) ?? 0, value.sequence));
  return [...result].slice(-SESSION_LIMITS.watermarks).map(([epoch, sequence]) => ({epoch, sequence}));
}
const sessionOrders = (session: StoredSession): {epoch: string; sequence: number}[] =>
  [...session.watermarks.map(({epoch, sequence}) => ({epoch, sequence})),
    ...(session.ordering.status === 'known' ? [{epoch: session.ordering.epoch, sequence: session.ordering.sequence}] : [])];
const priorSequence = (observation: LifecycleObservation, values: {epoch: string; sequence: number}[]): boolean => {
  const order = observation.ordering;
  return order.status === 'known' && values.some(value => value.epoch === order.epoch && order.sequence <= value.sequence);
};

/** Whether a guard covers an observation: its key, its turn or an earlier sequence of a retired epoch. */
export function guarded(observation: LifecycleObservation, guard: RetirementGuard | undefined): boolean {
  return guard !== undefined && (guard.keys.includes(semanticKey(observation)) ||
    observation.turn.status === 'known' && guard.turns.includes(observation.turn.id) || priorSequence(observation, guard.ordering));
}

/** Whether a runtime end is older than what the session holds: a retired turn, or an earlier sequence. */
export function oldEnd(observation: LifecycleObservation, session: StoredSession): boolean {
  return observation.turn.status === 'known' && session.retiredTurns.includes(observation.turn.id) || priorSequence(observation, sessionOrders(session));
}

/** The guard a retired session leaves: its turns, keys and orders, with the end's own when the end is this session's. */
export function rememberRetirement(session: StoredSession, old: RetirementGuard | undefined, atMs: number, end?: LifecycleObservation): RetirementGuard {
  const ownEnd = end !== undefined && entityOf(end.identity) === session.id;
  const turns = [...session.retiredTurns, ...[session.turn, ...session.notices.map(notice => notice.turn), ...session.attention.map(item => item.turn),
    ...(ownEnd ? [end.turn] : [])].flatMap(turn => turn.status === 'known' ? [turn.id] : [])];
  const endOrder = ownEnd && end.ordering.status === 'known' ? [{epoch: end.ordering.epoch, sequence: end.ordering.sequence}] : [];
  return {
    id: session.id, identity: structuredClone(session.identity), atMs,
    turns: recent([...(old?.turns ?? []), ...turns], SESSION_LIMITS.retiredTurns),
    keys: recent([...(old?.keys ?? []), ...session.seen.map(entry => entry.key), ...(ownEnd ? [semanticKey(end)] : [])], SESSION_LIMITS.seen),
    ordering: orders([...(old?.ordering ?? []), ...sessionOrders(session), ...endOrder]),
  };
}
