import type { SessionSnapshot, Snapshot } from '@jimmie-potts/agent-state';

/**
 * The shared per-session ranking and whole-owner status reduction, consumed by every
 * device that shows automatic agent status. A session's state is never inferred from
 * missing evidence: silence never means done, and an uncertain session is never ranked.
 */
export type AgentState = 'attention' | 'working' | 'done';
/** `idle` means the feed is healthy and nothing is outstanding. `unknown` covers an
 * unavailable feed, a non-running collector, or any shown session with uncertain freshness. */
export type HighestStatus = AgentState | 'idle' | 'unknown';

const RANK: Record<AgentState, number> = { attention: 0, working: 1, done: 2 };

/**
 * One root session's state, or undefined when it has nothing outstanding. A root whose
 * child is active is still working, though the child has no state of its own. By default
 * any consumer's acknowledgment retires `done`; passing `consumers` restricts that to the
 * named consumers only. Read evidence never retires `done`.
 */
export function sessionState(session: SessionSnapshot, consumers?: readonly string[]): AgentState | undefined {
  if (session.attention.length) return 'attention';
  if (session.activity === 'active' || session.children.active > 0) return 'working';
  const acknowledged = (by: string[]) => consumers ? by.some(id => consumers.includes(id)) : by.length > 0;
  if (session.notices.some(notice => notice.kind === 'turn-ended' && !acknowledged(notice.acknowledgedBy))) return 'done';
  return undefined;
}

export type HighestStatusOptions = {
  /** False when the latest read failed and `snapshot` is the last good one. */
  feedAvailable?: boolean;
  /** Consumers whose acknowledgment retires `done`. Omitted: any consumer's acknowledgment. */
  acknowledgingConsumers?: readonly string[];
};

/**
 * The single highest state across every root session, or `idle`/`unknown`. Highest is
 * attention > working > done. An uncertain shown session makes the whole result `unknown`,
 * because painting one color for the owner's status must not assert a state some evidence
 * cannot currently support.
 */
export function highestStatus(snapshot: Snapshot | undefined, options: HighestStatusOptions = {}): HighestStatus {
  if (options.feedAvailable === false || !snapshot || snapshot.collector !== 'running') return 'unknown';
  const shown = snapshot.sessions
    .filter(session => session.parent.status !== 'known')
    .map(session => ({ session, state: sessionState(session, options.acknowledgingConsumers) }))
    .filter((entry): entry is typeof entry & { state: AgentState } => entry.state !== undefined);
  if (shown.some(({ session }) => session.freshness === 'uncertain')) return 'unknown';
  if (shown.length === 0) return 'idle';
  return shown.reduce((best, entry) => RANK[entry.state] < RANK[best] ? entry.state : best, shown[0]!.state);
}

/** A display-agnostic RGB triple, shared so every device paints the same color per state. */
export type Rgb = readonly [number, number, number];

/** The colors every device uses for each state: ASK/attention amber, RUN/working blue, DONE/done green. */
export const STATUS_COLORS: Readonly<Record<AgentState, Rgb>> = Object.freeze({
  attention: [255, 160, 0], working: [40, 120, 255], done: [40, 200, 80],
});
