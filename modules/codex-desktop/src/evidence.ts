// Which sessions the marker gives read evidence for (Hub #926): the old Hub's rules (`readEvents` in
// apps/hub/src/codex-desktop.ts at main 8590332f), applied to the views `readSession` gives of the core's session
// records (Hub #1865). Only the configured Codex Desktop producer's top-level sessions qualify: Desktop lists unopened
// subagent threads indefinitely. A listed session is unread. An unlisted one is read once it was unread, or, when its
// read state is unknown and no turn is known to run, once the flag has had time to appear.
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {SessionView} from '@jimmie-potts/event-contracts/v2/session';

/** How long after its last evidence an unlisted session counts as read: Desktop sets the flag shortly after Stop. */
export const READ_SETTLE_MS = 5000;

/** The Codex Desktop producer whose sessions the marker speaks for. */
export type DesktopSource = {readonly hostId: string; readonly sourceId: string};
export type Evidence = {readonly session: SessionView; readonly state: 'read' | 'unread'};

/**
 * The read evidence `unread` gives for `sessions`: each session whose read state it changes. `readAtMs` is when the
 * marker's facts were current, the receipt of a remote snapshot (Hub #567) or now for a local read, so the settle rule
 * never counts time the marker was not yet read.
 */
export function readEvidence(sessions: readonly SessionView[], unread: ReadonlySet<string>, source: DesktopSource, nowMs: number, readAtMs = nowMs): Evidence[] {
  const evidence: Evidence[] = [];
  for (const session of sessions) {
    const {identity} = session;
    if (identity.provider !== 'codex' || identity.client !== 'desktop' || identity.hostId !== source.hostId || identity.sourceId !== source.sourceId ||
      session.parent.status === 'known') continue;
    // The marker lists only unread threads, so absence means read once the flag has had time to appear. Unordered
    // interrupt and end hooks leave work unknown, so only a known running turn waits, confirmed or not.
    const {read} = session.outcome;
    const settled = read === 'unknown' && session.work.state !== 'active' && Math.min(nowMs, readAtMs) - session.lastEvidenceAtMs >= READ_SETTLE_MS;
    const state = unread.has(identity.sessionId) ? 'unread' : read === 'unread' || settled ? 'read' : undefined;
    if (state !== undefined && state !== read) evidence.push({session, state});
  }
  return evidence;
}

/** The observation that carries one piece of read evidence to the core, as the old Hub ingested it. */
export function readObservation({session, state}: Evidence, nowMs: number): LifecycleObservation {
  return {identity: session.identity, turn: session.turn, parent: {status: 'unknown'}, event: {kind: 'read-observed', state}, observedAtMs: nowMs, ordering: {status: 'unknown'}};
}
