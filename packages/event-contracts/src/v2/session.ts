// The shared session read function (Hub #1865, design decision 10). `readSession` is the only way a reader interprets a
// session state message: it validates the message and returns the version-independent view, or nothing for a message
// it does not accept. Until the core publishes `session/3.0` it reads `session/2.0` and `session/2.1`; the switch step
// changes it to `session/3.0` in the same pull request as the core. The view, the status function, each consumer's
// policy, opportunity matching and the agent-status helper live in `session-view.ts`, which a browser part can bundle.
import {SCHEMA_BASE} from './errors.js';
import {coreValidator, type SessionRecord} from './families.js';
import {sessionView, type SessionView} from './session-view.js';

export {
  forConsumer, highestStatus, knownDetail, opportunityMatches, sessionState, sessionView, statusOf, STATUS_COLORS, STATUS_DETAILS,
} from './session-view.js';
export type {
  AgentState, ConsumerPolicy, HighestStatus, HighestStatusOptions, Rgb, SessionClaims, SessionCopy, SessionView,
} from './session-view.js';

/** The session versions `readSession` reads now. */
export const READABLE_SESSION_SCHEMAS: readonly string[] = Object.freeze([`${SCHEMA_BASE}session/2.0`, `${SCHEMA_BASE}session/2.1`]);

/**
 * Validates one session state message against the core families and returns its view, or undefined for anything it
 * does not accept: an invalid message, another family, or a session version it does not read.
 */
export function readSession(message: unknown): SessionView | undefined {
  const result = coreValidator().validate<SessionRecord>(message);
  if (!result.ok || !READABLE_SESSION_SCHEMAS.includes(result.value.dataschema)) return undefined;
  return sessionView(result.value.data);
}
