// The shared agent-status helper for profile 2.0 (Hub #918). Copied from packages/agent-status/src/status.ts at main
// 9d609c8 and rewritten for session/2.0 records: `highestStatus` reads a consumer's synced copy of the session family
// instead of a 1.x snapshot. The 1.x package stays for the old controllers until #839, and the tests keep both helpers'
// ranking and colors equal.
import type {SessionRecord} from './families.js';

/**
 * The shared per-session ranking and whole-copy status reduction, consumed by every device that shows automatic agent
 * status. A session's state is never inferred from missing evidence: silence never means done. A root's own freshness
 * does not change its rank; an active child makes its root working only while the owner counts it.
 */
export type AgentState = 'attention' | 'working' | 'done';
/** `idle` means the copy is synced and nothing is outstanding. `unknown` covers only a copy that has not synced. */
export type HighestStatus = AgentState | 'idle' | 'unknown';

const RANK: Record<AgentState, number> = {attention: 0, working: 1, done: 2};

/**
 * One root session's state, or undefined when it has nothing outstanding. A root whose child is active is still
 * working, though the child has no state of its own. By default any consumer's acknowledgment retires `done`; passing
 * `consumers` restricts that to the named consumers only. Read evidence never retires `done`.
 */
export function sessionState(session: SessionRecord, consumers?: readonly string[]): AgentState | undefined {
  if (session.attention.length > 0) return 'attention';
  if (session.activity === 'active' || session.children.active > 0) return 'working';
  const acknowledged = (by: readonly string[]): boolean => consumers ? by.some(id => consumers.includes(id)) : by.length > 0;
  if (session.notices.some(notice => notice.kind === 'turn-ended' && !acknowledged(notice.acknowledgedBy))) return 'done';
  return undefined;
}

/**
 * A consumer's copy of the session family. `synced` is true once the copy's first sync completed and while it follows
 * the owner; it is false before that and after a later sync failed, when the copy keeps its last records.
 */
export type SessionCopy = {synced: boolean; sessions: readonly SessionRecord[]};

export type HighestStatusOptions = {
  /** Consumers whose acknowledgment retires `done`. Omitted: any consumer's acknowledgment. */
  acknowledgingConsumers?: readonly string[];
};

/**
 * The single highest state across every root session, or `idle`/`unknown`. Highest is attention > working > done. Each
 * root counts with the state the owner reports, whatever its own freshness: a finished turn waiting to be read is idle
 * by nature and soon uncertain, yet it is still done until acknowledged (#439). No copy, or one that has not synced,
 * makes the result `unknown`.
 */
export function highestStatus(copy: SessionCopy | undefined, options: HighestStatusOptions = {}): HighestStatus {
  if (copy === undefined || !copy.synced) return 'unknown';
  const shown = copy.sessions
    .filter(session => session.parent.status !== 'known')
    .map(session => sessionState(session, options.acknowledgingConsumers))
    .filter((state): state is AgentState => state !== undefined);
  if (shown.length === 0) return 'idle';
  return shown.reduce((best, state) => RANK[state] < RANK[best] ? state : best);
}

/** A display-agnostic RGB triple, shared so every device paints the same color per state. */
export type Rgb = readonly [number, number, number];

/** The colors every device uses for each state: ASK/attention amber, RUN/working blue, DONE/done green. */
export const STATUS_COLORS: Readonly<Record<AgentState, Rgb>> = Object.freeze({
  attention: [255, 160, 0], working: [40, 120, 255], done: [40, 200, 80],
});
