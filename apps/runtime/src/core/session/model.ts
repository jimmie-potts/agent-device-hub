// The core's stored session (Hub #1865, design decision 1): the public part of its record and the private bookkeeping
// the session logic keeps beside it, both in the core store's own tables. Ported from agent-state's `Session`
// (packages/agent-state/src/types.ts), which stays for the retained 1.x owner until #839, with the 2.0 shapes of the
// `session` family in place of the 1.x ones.
import {
  sessionEntityId, type Attention, type Identity, type KnownId, type Label, type Notice, type Ordering, type Parent, type ReadProvenance, type Title,
  type Unavailable,
} from '@jimmie-potts/event-contracts/v2/families';

/** The session logic's bounds, as agent-state's `LIMITS` sets them. */
export const SESSION_LIMITS = Object.freeze({
  /** Sessions the core holds, roots and children together. */
  sessions: 128,
  /** Retirement guards it keeps. */
  retirements: 128,
  attention: 64, notices: 128, retiredTurns: 256, seen: 256, watermarks: 256,
  /** A session without lifecycle evidence for a day is removed as expired; a guard is kept for a day. */
  sessionAgeMs: 86_400_000,
  /**
   * Running work becomes unconfirmed this long after its private progress time, the last qualifying work evidence on
   * its current turn (design decision 4), and its approval may then be recovered.
   */
  workDeadlineMs: 300_000,
  /**
   * The largest observation the logic takes, as compact JSON. 1.x's owner took events of up to 2,048 bytes; the 2.0 form
   * of such an event can be larger by the ordering authority it names, so this leaves room for it.
   */
  observationBytes: 2304,
});

/** A consumer whose notice acknowledgments the core records, and whether a new turn acknowledges its earlier notices. */
export type Consumer = {readonly id: string; readonly clearOnNewTurn: boolean};

/**
 * The consumers whose notice acknowledgments the core records, and whether a new turn acknowledges a consumer's earlier
 * notices: the old Hub's integrated verification set. It is a constant of the code, not stored state.
 */
export const DEFAULT_CONSUMERS: readonly Consumer[] = Object.freeze([
  {id: 'dashboard', clearOnNewTurn: false}, {id: 'nanoleaf', clearOnNewTurn: true}, {id: 'pixoo', clearOnNewTurn: true},
]);

/** A session's activity as the logic holds it. */
export type Activity = 'unknown' | 'active' | 'idle' | 'interrupted';

/** One stored session. Everything up to `hostSessionId` is public; the rest is the logic's private bookkeeping. */
export type StoredSession = {
  /** The session's entity ID, from its identity. */
  id: string;
  /** The core revision of the transaction that created it. */
  generation: number;
  identity: Identity; parent: Parent; turn: KnownId; activity: Activity;
  attention: Attention[]; notices: Notice[];
  /** Read evidence from the session's own observations. A kept read receipt shows the record as read. */
  read: 'unknown' | 'read' | 'unread';
  /** Explicit read provenance, published in the outcome claim and kept only while its generation, turn and notice still hold. */
  readReceipt?: ReadProvenance;
  unavailable: Unavailable[]; ordering: Ordering;
  observedAtMs: number;
  /**
   * The core's instant of the last lifecycle evidence: expiry runs from it. A record shows the value it had at the
   * record's last published change.
   */
  lastEvidenceAtMs: number;
  label?: Label; title?: Title; project?: string; projectId?: string;
  /** A root's latest host session ID. Never an identity. */
  hostSessionId?: string;
  /** The producer instant of the last display metadata the session took, so older metadata cannot replace newer. */
  metadataObservedAtMs?: number;
  /**
   * Set while the session's work is active and a core start left it unconfirmed (design decision 4): by the start
   * transaction, or by evidence from before the start that made work active. Only qualifying evidence on the current turn
   * observed after the start confirms it again. Published as the work claim's reason `restart`.
   */
  restartUnconfirmed?: true;
  /**
   * Set while the session's work is active and its deadline passed: `workDeadlineMs` after its progress time with no
   * qualifying evidence since (design decision 4). The same evidence that ends a restart marking ends it. Published as
   * the work claim's reason `deadline`.
   */
  deadlineUnconfirmed?: true;
  /**
   * The private progress time: the core's instant of the work evidence that last confirmed running work, from which its
   * deadline runs. Progress that changes no public member advances it and publishes nothing (design decision 5). A
   * session a release before #1865 step 9 stored runs its deadline from `lastEvidenceAtMs` instead.
   */
  progressAtMs?: number;
  /** Turns a newer turn retired: their late activity is stale. */
  retiredTurns: string[];
  /** Semantic duplicate keys: the observation's key and its content's, and collision markers. */
  seen: {key: string; content: string}[];
  /** Per-dimension ordering watermarks. */
  watermarks: {dimension: string; epoch: string; sequence: number}[];
};

/** What the core keeps of a retired session for a day, so its delayed events cannot bring it back. */
export type RetirementGuard = {
  id: string; identity: Identity; atMs: number; turns: string[]; keys: string[]; ordering: {epoch: string; sequence: number}[];
};

export const entityOf = (identity: Identity): string => sessionEntityId(identity);
export const sameTurn = (a: KnownId, b: KnownId): boolean => a.status === 'known' && b.status === 'known' && a.id === b.id;
/** Two IDs that are both unknown, or both the same known ID. */
export const sameId = (a: KnownId, b: KnownId): boolean => a.status === 'unknown' && b.status === 'unknown' || sameTurn(a, b);
export const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.provider === b.provider && a.client === b.client && a.hostId === b.hostId && a.sourceId === b.sourceId && a.sessionId === b.sessionId;
