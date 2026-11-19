// The shared session read function (Hub #1865, design decision 10). `readSession` is the only way a reader interprets a
// session state message: it validates the message and returns the session's view, or nothing for a message it does not
// accept. Since the core publishes `session/3.0` (#1865 step 9) it reads `session/3.0` only, and the view is the record.
// `session/2.0` and `2.1` stay registered for reading retained documents, which no live reader does. The status
// function, the record builder, each consumer's policy, opportunity matching and the agent-status helper over views live
// in `session-view.ts`, which a browser part can bundle.
import {SCHEMA_BASE} from './errors.js';
import {coreValidator, type Session30Record} from './families.js';
import type {SessionView} from './session-view.js';

export {
  buildSession, forConsumer, highestStatus, knownDetail, noticeCounts, opportunityMatches, sessionState, statusOf, STATUS_COLORS, STATUS_DETAILS,
} from './session-view.js';
export type {
  AgentState, ConsumerPolicy, HighestStatus, HighestStatusOptions, Rgb, SessionClaims, SessionFacts, SessionView, ViewCopy,
} from './session-view.js';

/** The session version the core publishes, and the only one `readSession` reads. */
export const SESSION_SCHEMA = `${SCHEMA_BASE}session/3.0`;
/** The session versions `readSession` reads. */
export const READABLE_SESSION_SCHEMAS: readonly string[] = Object.freeze([SESSION_SCHEMA]);

/**
 * Validates one session state message against the core families and returns its view, or undefined for anything it
 * does not accept: an invalid message, another family, or a session version it does not read.
 */
export function readSession(message: unknown): SessionView | undefined {
  const result = coreValidator().validate<Session30Record>(message);
  if (!result.ok || !READABLE_SESSION_SCHEMAS.includes(result.value.dataschema)) return undefined;
  return result.value.data;
}
