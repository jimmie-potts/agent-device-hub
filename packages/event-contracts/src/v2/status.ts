// The shared agent-status names and colors for profile 2.0 (Hub #918), copied from packages/agent-status/src/status.ts
// at main 9d609c8. Since #1865 the helper itself, `sessionState` and `highestStatus`, reads the shared session view in
// `session-view.ts`, so this file keeps only what that helper and every device share, and imports nothing. The 1.x
// package stays for the old controllers until #839, and the tests keep the view helper's ranking and colors equal to its.

/**
 * The per-session states every device that shows automatic agent status ranks. A session's state is never inferred from
 * missing evidence: silence never means done.
 */
export type AgentState = 'attention' | 'working' | 'done';
/** `idle` means the copy is synced and nothing is outstanding. `unknown` covers only a copy that has not synced. */
export type HighestStatus = AgentState | 'idle' | 'unknown';

export type HighestStatusOptions = {
  /** Consumers whose acknowledgment retires `done`. Omitted: any consumer's acknowledgment. */
  acknowledgingConsumers?: readonly string[];
};

/** A display-agnostic RGB triple, shared so every device paints the same color per state. */
export type Rgb = readonly [number, number, number];

/** The colors every device uses for each state: ASK/attention amber, RUN/working blue, DONE/done green. */
export const STATUS_COLORS: Readonly<Record<AgentState, Rgb>> = Object.freeze({
  attention: [255, 160, 0], working: [40, 120, 255], done: [40, 200, 80],
});
