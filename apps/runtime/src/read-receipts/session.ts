// The core's sessions as the read-receipt helpers read them (Hub #1865, design decision 10). The helpers run from each
// host's installed release, so they accept exactly what that release's `readSession` accepts. When the core switches
// session versions, a helper from an older release finds no record it accepts: it binds no target and sends no receipt,
// and its client sees the same answer as for a session the core does not hold (design decision 13).
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {readSession, type SessionView} from '@jimmie-potts/event-contracts/v2/session';

/** The view of a session state message the core published, or undefined for anything else. */
export function coreSession(message: unknown): SessionView | undefined {
  const view = readSession(message);
  return view !== undefined && (message as Message).source === 'bunny/core' ? view : undefined;
}
