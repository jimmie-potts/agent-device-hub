// Which sessions the marker gives read evidence for (Hub #926): the old Hub's rules (`readEvents` in
// apps/hub/src/codex-desktop.ts at main 8590332f), applied to the core's `session/2.0` records. Only the configured
// Codex Desktop producer's top-level sessions qualify: Desktop lists unopened subagent threads indefinitely. A listed
// session is unread. An unlisted one is read once it was unread, or, when its read state is unknown and no turn is known
// to run, once the flag has had time to appear.
import type {LifecycleObservation, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';

/** How long after its last evidence an unlisted session counts as read: Desktop sets the flag shortly after Stop. */
export const READ_SETTLE_MS = 5000;

/** The Codex Desktop producer whose sessions the marker speaks for. */
export type DesktopSource = {readonly hostId: string; readonly sourceId: string};
export type Evidence = {readonly session: SessionRecord; readonly state: 'read' | 'unread'};

/** The read evidence `unread` gives for `sessions` at `nowMs`: each session whose read state it changes. */
export function readEvidence(sessions: readonly SessionRecord[], unread: ReadonlySet<string>, source: DesktopSource, nowMs: number): Evidence[] {
  const evidence: Evidence[] = [];
  for (const session of sessions) {
    const {identity} = session;
    if (identity.provider !== 'codex' || identity.client !== 'desktop' || identity.hostId !== source.hostId || identity.sourceId !== source.sourceId ||
      session.parent.status === 'known') continue;
    // The marker lists only unread threads, so absence means read once the flag has had time to appear. Unordered
    // interrupt and end hooks leave activity unknown, so only a known running turn waits.
    const settled = session.read === 'unknown' && session.activity !== 'active' && nowMs - session.lastEvidenceAtMs >= READ_SETTLE_MS;
    const state = unread.has(identity.sessionId) ? 'unread' : session.read === 'unread' || settled ? 'read' : undefined;
    if (state !== undefined && state !== session.read) evidence.push({session, state});
  }
  return evidence;
}

/** The observation that carries one piece of read evidence to the core, as the old Hub ingested it. */
export function readObservation({session, state}: Evidence, nowMs: number): LifecycleObservation {
  return {identity: session.identity, turn: session.turn, parent: {status: 'unknown'}, event: {kind: 'read-observed', state}, observedAtMs: nowMs, ordering: {status: 'unknown'}};
}
