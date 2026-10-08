// The action tracker's state machine (Hub #782, ADR 0012 "High-impact messages" and "Errors, effects and outcomes").
// The core tracks each device command, moment and mode change it dispatches as one operation, from sent to accepted to
// completed, or to rejected, expired or uncertain. This file is the whole state machine: pure functions over one
// operation, with no clock, store or bus, so every transition is easy to find and to test. `tracker.ts` stores the
// operations and drives them.
//
//   sent ──reply accepted──▶ accepted ──outcome──▶ completed (succeeded, failed or uncertain)
//    │                          │
//    ├─reply refused──▶ rejected (failed: a rejection proves no effect)
//    ├─still queued at its reply deadline──▶ expired (failed: it never reached its owner)
//    ├─handler had it at its reply deadline──▶ uncertain
//    └──────────────────────────┴─outcome deadline, no outcome──▶ uncertain
//
// Late and conflicting outcomes (owner decision, 2026-10-07):
// - a definitive outcome (`succeeded` or `failed`) after an uncertain result replaces it; history keeps both;
// - an uncertain outcome after a definitive result adds its evidence and changes nothing else;
// - a `succeeded` and a `failed` outcome for one operation, in either order, keep both and leave the operation in
//   `conflict` for a person to decide; arrival order never picks a winner;
// - nothing is ever sent again: no transition sends a command, and a restart only lets a pending operation's deadline
//   pass.
import type {ErrorDetail} from '@jimmie-potts/event-contracts/v2';

/** What the core tracks (ADR 0012, "High-impact messages"): device commands, moments and mode changes. */
export type ActionKind = 'device' | 'moment' | 'mode';

/**
 * Each kind's deadlines, from the moment the core recorded the action as sent. `replyMs` is the command's own expiry:
 * a command still queued then is `expired`, and one whose handler still had it is uncertain. `outcomeMs` is how long
 * the core waits for the outcome before it records the action uncertain; a later outcome still completes it.
 * - device: a command to one device, such as a power or brightness change or a playback control: a reply within 5 s,
 *   and an outcome within 30 s, the longest a module's own device budget allows.
 * - moment: `moment-play` starts up to 60 s after it is sent and may wait up to 60 s more for its start (its
 *   tolerance), so its outcome may take 150 s.
 * - mode: a Hub mode change, which its owner fans out to every taking-part device: 60 s.
 */
export const DEADLINES: Readonly<Record<ActionKind, {readonly replyMs: number; readonly outcomeMs: number}>> = Object.freeze({
  device: Object.freeze({replyMs: 5000, outcomeMs: 30_000}),
  moment: Object.freeze({replyMs: 5000, outcomeMs: 150_000}),
  mode: Object.freeze({replyMs: 5000, outcomeMs: 60_000}),
});

/** The kind of action a command family is: a moment, a mode change, or otherwise a command to one device. */
export function kindOf(family: string): ActionKind {
  if (family === 'moment-play') return 'moment';
  if (family === 'mode-set') return 'mode';
  return 'device';
}

export type OperationStatus = 'sent' | 'accepted' | 'rejected' | 'expired' | 'uncertain' | 'completed' | 'conflict';
/** What the operation's result is: what a person reads. `conflict` holds a `succeeded` and a `failed` outcome. */
export type OperationResult = 'succeeded' | 'failed' | 'uncertain' | 'conflict';
export type Evidence = 'transmitted' | 'observed' | 'none';
/** One outcome the core took for the operation, by its `(source, id)`. */
export type TakenOutcome = {
  source: string; id: string; result: 'succeeded' | 'failed' | 'uncertain'; evidence: Evidence; error?: ErrorDetail; atMs: number;
};

/** One tracked action: a tracker row. */
export type Operation = {
  requestId: string;
  kind: ActionKind;
  /** The routing key the command went to, such as `bunny.cmd.power-set.lamp-1`. */
  key: string;
  family: string;
  /** The command's type, such as `org.bunny.power.set.requested`. */
  command: string;
  dataschema: string;
  /** The device or owner the command addressed: its key's routing ID and its subject. */
  target: string;
  /** The command's payload without its `requestId`, kept so a person can send it again as a new command (#923). */
  data: Record<string, unknown>;
  /** Who asked for the action: an authenticated caller's source, or the core part that dispatched it. */
  requestedBy: string;
  status: OperationStatus;
  /** Undefined while the action is pending: sent or accepted with no outcome yet. */
  result?: OperationResult;
  evidence?: Evidence;
  error?: ErrorDetail;
  /** The owner's reply: `accepted`, or the refusal's code; undefined until it comes, and for a request whose fate is unknown. */
  reply?: string;
  /** The participant that replied, which alone may report the outcome. */
  responder?: string;
  outcomes: TakenOutcome[];
  sentAtMs: number;
  /** When the core gives up waiting for the outcome and records the action uncertain. */
  deadlineAtMs: number;
  updatedAtMs: number;
  /** The trace context of the dispatch, which every later record of the operation joins. */
  traceparent: string;
};

/** What happened to an operation. */
export type OperationEvent =
  | {type: 'reply'; status: 'accepted'; responder?: string; atMs: number}
  | {type: 'reply'; status: 'rejected'; error: ErrorDetail; responder?: string; atMs: number}
  | {type: 'reply'; status: 'uncertain'; error: ErrorDetail; atMs: number}
  | {type: 'outcome'; outcome: TakenOutcome}
  | {type: 'deadline'; atMs: number};

const PENDING: readonly OperationStatus[] = ['sent', 'accepted'];
/** Whether the operation still waits for its fate: sent or accepted, with no result. */
export const pending = (operation: Pick<Operation, 'status'>): boolean => PENDING.includes(operation.status);
const definitive = (result: OperationResult | TakenOutcome['result'] | undefined): result is 'succeeded' | 'failed' => result === 'succeeded' || result === 'failed';

/** The `uncertain-result` error an operation carries when its fate is unknown. */
const uncertainError = (requestId: string, detail: string): ErrorDetail => ({code: 'uncertain-result', retryable: false, requestId, detail});

/**
 * The operation after `event`, or undefined when the event changes nothing. Every change keeps the operation's
 * identity, command and deadline; only its status, result, evidence, error, reply and outcomes move.
 */
export function advance(operation: Operation, event: OperationEvent): Operation | undefined {
  switch (event.type) {
    case 'reply':
      return reply(operation, event);
    case 'outcome':
      return outcome(operation, event.outcome);
    case 'deadline':
      // Only an operation still waiting for its fate passes its deadline; a later outcome completes it.
      if (!pending(operation) || event.atMs < operation.deadlineAtMs) return undefined;
      return {
        ...operation, status: 'uncertain', result: 'uncertain', evidence: 'none', updatedAtMs: event.atMs,
        error: uncertainError(operation.requestId, 'no outcome arrived by the action\'s deadline'),
      };
  }
}

function reply(operation: Operation, event: Extract<OperationEvent, {type: 'reply'}>): Operation | undefined {
  const replied = {...operation, updatedAtMs: event.atMs, ...(event.status === 'uncertain' || event.responder === undefined ? {} : {responder: event.responder})};
  // An outcome can arrive before the reply is recorded, and a restart forgets the request: a reply then only records
  // what the owner said.
  if (operation.status !== 'sent') {
    if (operation.reply !== undefined || event.status === 'uncertain') return undefined;
    return {...replied, reply: event.status === 'accepted' ? 'accepted' : event.error.code};
  }
  switch (event.status) {
    case 'accepted':
      return {...replied, status: 'accepted', reply: 'accepted'};
    case 'rejected':
      // A rejection proves no effect: the owner refused it before acting, or it never reached the owner.
      return {
        ...replied, status: event.error.code === 'expired' ? 'expired' : 'rejected', result: 'failed', evidence: 'none', reply: event.error.code,
        error: {...event.error, requestId: operation.requestId},
      };
    case 'uncertain':
      return {...replied, status: 'uncertain', result: 'uncertain', evidence: 'none', error: {...event.error, requestId: operation.requestId}};
  }
}

function outcome(operation: Operation, taken: TakenOutcome): Operation | undefined {
  if (operation.outcomes.some(known => known.source === taken.source && known.id === taken.id)) return undefined;
  const outcomes = [...operation.outcomes, taken];
  const base = {...operation, outcomes, updatedAtMs: taken.atMs};
  const settled = {
    ...base, status: 'completed' as const, result: taken.result, evidence: taken.evidence,
    ...(taken.error === undefined ? {} : {error: taken.error}),
  };
  if (taken.error === undefined) delete settled.error;
  const current = operation.result;
  // Pending, or only uncertain so far: the outcome settles the operation, a definitive one replacing an uncertain result.
  if (current === undefined || (current === 'uncertain' && definitive(taken.result))) return settled;
  if (current === 'uncertain') return {...base, evidence: strongest(operation.evidence, taken.evidence)};
  // Already definitive or in conflict: an uncertain outcome adds its evidence only.
  if (!definitive(taken.result)) return base;
  if (current === 'conflict' || current !== taken.result) {
    // A succeeded and a failed outcome for one operation: keep both, and leave the decision to a person.
    return {...base, status: 'conflict', result: 'conflict', evidence: strongest(operation.evidence, taken.evidence)};
  }
  return base;
}

const STRENGTH: Readonly<Record<Evidence, number>> = {none: 0, transmitted: 1, observed: 2};
/** The stronger of two pieces of evidence: an observation over a transmission over none. */
function strongest(a: Evidence | undefined, b: Evidence): Evidence {
  return a !== undefined && STRENGTH[a] >= STRENGTH[b] ? a : b;
}
