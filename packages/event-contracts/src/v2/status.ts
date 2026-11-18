// The shared agent-status helper for profile 2.0 (Hub #918), over the shared session view since Hub #1865. It was
// copied from packages/agent-status/src/status.ts at main 9d609c8; `sessionState` and `highestStatus` now read each
// session through the view in `session-view.ts`, so they rank by the hub's status with each caller's acknowledgment
// policy. The 1.x package stays for the old controllers until #839, and the tests keep both helpers' ranking and
// colors equal. This entry stays free of runtime imports other than the view, so a browser part can bundle it.
export {highestStatus, sessionState, STATUS_COLORS} from './session-view.js';
export type {AgentState, HighestStatus, HighestStatusOptions, Rgb, SessionCopy} from './session-view.js';
