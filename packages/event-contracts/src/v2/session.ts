// The shared session read function (Hub #1865, design decision 10). `readSession` is the only way a reader interprets a
// session state message: it validates the message and returns the session's view, or nothing for a message it does not
// accept. Since the core publishes `session/3.0` (#1865 step 9) it reads `session/3.0`, since Hub #505 `session/3.1`
// too, which the core publishes for native assistant records, and since Hub #2054 `session/3.2`, which adds a native
// record's companions; the view is the record.
// `session/2.0` and `2.1` stay registered for reading retained documents, which no live reader does. The status
// function, the record builder, each consumer's policy, opportunity matching and the agent-status helper over views live
// in `session-view.ts`, which a browser part can bundle.
import {SCHEMA_BASE} from './errors.js';
import {coreValidator, type Session30Record} from './families.js';
import type {SessionView} from './session-view.js';
import {nativeProvider} from './sources.js';

export {
  buildSession, forConsumer, highestStatus, knownDetail, noticeCounts, opportunityMatches, sessionState, statusOf, STATUS_COLORS, STATUS_DETAILS,
} from './session-view.js';
export type {
  AgentState, ConsumerPolicy, HighestStatus, HighestStatusOptions, Rgb, SessionClaims, SessionFacts, SessionView, ViewCopy,
} from './session-view.js';

/** The session version the core publishes for every record that `session/3.1` or `3.2` is not needed for. */
export const SESSION_SCHEMA = `${SCHEMA_BASE}session/3.0`;
/** The session version of a native assistant record, or of one whose notice has a result (Hub #505). */
export const SESSION_31_SCHEMA = `${SCHEMA_BASE}session/3.1`;
/** The session version of a native record that names its companions (Hub #2054). */
export const SESSION_32_SCHEMA = `${SCHEMA_BASE}session/3.2`;
/** The session versions `readSession` reads. */
export const READABLE_SESSION_SCHEMAS: readonly string[] = Object.freeze([SESSION_SCHEMA, SESSION_31_SCHEMA, SESSION_32_SCHEMA]);

/**
 * The lowest session version that expresses a record (Hub #505, #2054): `session/3.2` for a record with companions,
 * `session/3.1` for another native identity or a notice with a result, `session/3.0` otherwise. A reader of an older
 * release then still reads every record it could read before.
 */
export function sessionSchemaOf(record: Pick<Session30Record, 'identity' | 'outcome' | 'companions'>): string {
  if (record.companions !== undefined) return SESSION_32_SCHEMA;
  return nativeProvider(record.identity.provider) || record.outcome.notices.some(notice => notice.result !== undefined) ? SESSION_31_SCHEMA : SESSION_SCHEMA;
}
/** The version of an agent occurrence about a session of `identity`: 2.1 for the native source, 2.0 otherwise (Hub #505). */
export function occurrenceSchemaOf(family: 'attention-raised' | 'attention-cleared' | 'turn-ended' | 'session-ended', identity: Pick<Session30Record['identity'], 'provider'>): string {
  return `${SCHEMA_BASE}${family}/${nativeProvider(identity.provider) && family !== 'session-ended' ? '2.1' : '2.0'}`;
}

/**
 * Validates one session state message against the core families and returns its view, or undefined for anything it
 * does not accept: an invalid message, another family, or a session version it does not read.
 */
export function readSession(message: unknown): SessionView | undefined {
  const result = coreValidator().validate<Session30Record>(message);
  if (!result.ok || !READABLE_SESSION_SCHEMAS.includes(result.value.dataschema)) return undefined;
  return result.value.data;
}
