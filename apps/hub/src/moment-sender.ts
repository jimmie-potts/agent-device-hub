import {validate, MOMENT_MAX_LEAD_MS, type FailureCode, type MomentCommand, type PriorityClass, type ReceiptV1_1, type RequestV1_1,
  type Snapshot, type SnapshotV1_1} from '@jimmie-potts/device-contracts';
import {HttpError, object} from './common.js';
import {MAX_SLOT_WAIT_MS, type ControllerClient} from './controllers.js';

/**
 * The hub's moment sender (Hub #335, controller contract 1.1 "Moments"). One call sends one moment to one device and
 * returns one result. It applies no policy: callers arbitrate quiet hours, budgets and interrupt sets, and fan out to
 * several devices themselves, for example with `Promise.allSettled` over one call per device and one shared
 * `startAtHubMs`. It keeps no state, never resends and never runs on its own, so a hub start, reconnect or read sends
 * nothing. The device's start window, clock epoch and moment ID memory make a stale or repeated delivery harmless.
 */

/** The hub's monotonic clock in milliseconds, the clock of `MomentInput.startAtHubMs`. */
export const hubMonotonicNow = (): number => performance.now();
/** The start window a moment gets unless its caller sets one. It covers the POST, the only step after the start is computed. */
export const DEFAULT_MOMENT_TOLERANCE_MS = 10000;
/** The contract's largest start window. */
export const MAX_MOMENT_TOLERANCE_MS = 60000;

/** The command's `start`, in the receiving controller's monotonic clock. */
export type MomentStart = MomentCommand['start'];

/** One moment for one device. The contract fields pass through unchanged. */
export type MomentInput = {
  momentId: string;
  mood: string;
  palette?: string[];
  durationMs: number;
  priorityClass: PriorityClass;
  coversStatus: boolean;
  /** When the moment starts, on `hubMonotonicNow`'s clock, at most 60,000 ms ahead. Defaults to the snapshot's arrival. */
  startAtHubMs?: number;
  /** How late the device may still start the moment, 0 to 60,000 ms. Defaults to 10,000. */
  toleranceMs?: number;
};

/**
 * Why a moment was not sent. The sender decides these from the slot, the snapshot read or the snapshot itself and then
 * sends no POST, except that `capacity`, `unsupported-capability` and `unavailable` also cover a controller that refused
 * the POST without admitting it; the result's `failure` then carries the controller's code.
 */
export type MomentNotSentReason = '1.0-only'|'moments-unsupported'|'unsupported-capability'|'capacity'|'unavailable';

/**
 * One device's result. `start` is the start the moment has, or would have had, in that device's clock; it is null only
 * when the sender stopped before reading a snapshot. A receipt keeps its transmission-only meaning: `queued` or `sent`
 * never says a person saw the moment.
 */
export type MomentResult =
  | {kind:'receipt'; momentId:string; start:MomentStart; receipt:ReceiptV1_1}
  | {kind:'not-sent'; momentId:string; start:MomentStart|null; reason:MomentNotSentReason; failure?:FailureCode}
  | {kind:'uncertain'; momentId:string; start:MomentStart};

export type MomentSendOptions = {
  /** The hub's monotonic clock, injectable for tests. Defaults to `hubMonotonicNow`. */
  now?: () => number;
};

const INPUT_KEYS = ['momentId','mood','palette','durationMs','priorityClass','coversStatus','startAtHubMs','toleranceMs'];

/** Checks the caller's input before any controller contact. Invalid input is a caller bug, so it throws. */
function checked(input: unknown, nowMs: number): {fields:Omit<MomentCommand,'kind'|'start'>; startAtHubMs?:number; toleranceMs:number} {
  const invalid = () => new HttpError('invalid-request',400);
  if (!object(input) || Object.keys(input).some(key => !INPUT_KEYS.includes(key))) throw invalid();
  const {startAtHubMs, toleranceMs = DEFAULT_MOMENT_TOLERANCE_MS} = input;
  if (typeof toleranceMs !== 'number' || !Number.isInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > MAX_MOMENT_TOLERANCE_MS) throw invalid();
  if (startAtHubMs !== undefined && (typeof startAtHubMs !== 'number' || !Number.isFinite(startAtHubMs) || startAtHubMs - nowMs > MOMENT_MAX_LEAD_MS)) throw invalid();
  const fields = {momentId:input.momentId,mood:input.mood,...(input.palette === undefined ? {} : {palette:input.palette}),
    durationMs:input.durationMs,priorityClass:input.priorityClass,coversStatus:input.coversStatus} as Omit<MomentCommand,'kind'|'start'>;
  // The contract schema checks the fields, including that a flourish never covers status.
  if (!validate('momentCommand',{kind:'moment',...fields,start:{domain:'controller-monotonic',epoch:'check',atMs:0,toleranceMs}})) throw invalid();
  return {fields,...(startAtHubMs === undefined ? {} : {startAtHubMs}),toleranceMs};
}

/**
 * The hub instant `startAtHubMs` in the controller's clock: the snapshot's sample plus the hub time from the snapshot's
 * arrival to the start. A start earlier than the controller clock's zero keeps its deadline: `atMs` becomes 0 and the
 * window shrinks, down to 0, so the device still drops a moment that is too late.
 */
function startIn(snapshot: Snapshot|SnapshotV1_1, arrivalMs: number, startAtHubMs: number|undefined, toleranceMs: number): MomentStart {
  const {epoch, sampledAtMs} = snapshot.sampleClock;
  const atMs = sampledAtMs + ((startAtHubMs ?? arrivalMs) - arrivalMs);
  return atMs >= 0 ? {domain:'controller-monotonic',epoch,atMs,toleranceMs}
    : {domain:'controller-monotonic',epoch,atMs:0,toleranceMs:Math.max(0,Math.floor(atMs + toleranceMs))};
}

/** A controller's typed refusal of the POST, with no receipt, admitted nothing. */
function refused(code: string): MomentNotSentReason {
  return code === 'capacity' || code === 'unsupported-capability' ? code : 'unavailable';
}

/**
 * Sends one moment to the controller behind `client`: waits up to MAX_SLOT_WAIT_MS for its slot, reads a fresh snapshot
 * through the negotiated 1.1 read, builds one `requestV1_1` from it and POSTs it once, all inside that one slot.
 * It resolves to one result for any controller behaviour and rejects only for invalid input (`invalid-request`).
 */
export async function sendMoment(client: ControllerClient, moment: MomentInput, options: MomentSendOptions = {}): Promise<MomentResult> {
  const now = options.now ?? hubMonotonicNow;
  const {fields, startAtHubMs, toleranceMs} = checked(moment,now());
  const {momentId} = fields;
  let start: MomentStart|null = null;
  const notSent = (reason: MomentNotSentReason, failure?: string): MomentResult =>
    ({kind:'not-sent',momentId,start,reason,...(failure === undefined ? {} : {failure:failure as FailureCode})});
  try {
    return await client.hold(MAX_SLOT_WAIT_MS,async slot => {
      let snapshot: Snapshot|SnapshotV1_1;
      try { snapshot = await slot.snapshot('1.1'); }
      catch (error) { if (error instanceof HttpError) return notSent('unavailable'); throw error; }
      const sent = start = startIn(snapshot,now(),startAtHubMs,toleranceMs);
      if (snapshot.apiVersion !== '1.1') return notSent('1.0-only');
      const capability = snapshot.capabilities.moments;
      if (!capability.supported) return notSent('moments-unsupported');
      if (!capability.moods.includes(fields.mood) || fields.durationMs > capability.maxDurationMs) return notSent('unsupported-capability');
      const request: RequestV1_1 = {apiVersion:'1.1',controllerId:client.config.controllerId,deviceId:client.config.deviceId,
        requestId:snapshot.nextRequestId,expectedConfigurationRevision:snapshot.configurationRevision,expectedGeneration:snapshot.generation,
        command:{kind:'moment',...fields,start:sent}};
      // Only a controller clock near the largest safe integer could make the start unrepresentable.
      if (!validate('requestV1_1',request)) return notSent('unavailable');
      try { return {kind:'receipt',momentId,start:sent,receipt:(await slot.momentCommand(request)).body}; }
      catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (error.code === 'uncertain-result') return {kind:'uncertain',momentId,start:sent};
        // The client closed before the POST left.
        if (error.code === 'controller-unavailable') return notSent('unavailable');
        return notSent(refused(error.code),error.code);
      }
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'capacity') return notSent('capacity');
    if (error instanceof HttpError && error.code === 'controller-unavailable') return notSent('unavailable');
    throw error;
  }
}
