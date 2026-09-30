import {randomUUID} from 'node:crypto';
import {HttpError, exact, id, object} from './common.js';
import type {ControllerClient} from './controllers.js';
import {sendMoment, type MomentResult, type MomentStart} from './moment-sender.js';

/**
 * The owner's moment route (Hub #336): one explicit press on a device's B.U.N.N.Y. page sends one moment to that
 * device. The hub assigns the moment ID and the `event` priority class and applies no arbitration, because the owner
 * chose it; the device's own precedence still decides whether it plays (Quiet blocks it, an alert pre-empts it).
 */

/**
 * How long the route waits for the sender, from the request's arrival. The hub destroys a response still open at 3 s,
 * and one sender call can take about 8.5 s (slot wait, snapshot read, POST), so the route answers before the cap.
 */
export const MOMENT_RESPONSE_BOUND_MS = 2500;

/** The route's answer: the sender's result, or `uncertain` with no start when the bound expired first. */
export type OwnerMomentResult = MomentResult | {kind:'uncertain'; momentId:string; start:MomentStart|null};
export type OwnerMomentInput = {mood:string; durationMs:number; coversStatus:boolean};

/** Exactly `{mood, durationMs, coversStatus}` in the contract's ranges; anything else is refused before any controller contact. */
export function ownerMomentInput(value: unknown): OwnerMomentInput {
  if (!object(value) || !exact(value,['mood','durationMs','coversStatus']) || !id(value.mood) ||
      typeof value.durationMs !== 'number' || !Number.isInteger(value.durationMs) || value.durationMs < 1000 || value.durationMs > 300000 ||
      typeof value.coversStatus !== 'boolean') throw new HttpError('invalid-request',400);
  return {mood:value.mood,durationMs:value.durationMs,coversStatus:value.coversStatus};
}

/**
 * Calls the sender once and answers within `boundMs`. When the bound expires first the answer is `uncertain`: the hub
 * does not yet know whether the POST left. The one call still runs to its own result, and nothing resends it.
 */
export async function sendOwnerMoment(client: ControllerClient, input: OwnerMomentInput, boundMs: number = MOMENT_RESPONSE_BOUND_MS): Promise<OwnerMomentResult> {
  const momentId = `bunny-${randomUUID()}`;
  const sending = sendMoment(client,{momentId,mood:input.mood,durationMs:input.durationMs,priorityClass:'event',coversStatus:input.coversStatus});
  // A late result has no reader; its rejection, if any, must not become an unhandled one.
  sending.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<OwnerMomentResult>(resolve => { timer = setTimeout(() => resolve({kind:'uncertain',momentId,start:null}),Math.max(0,boundMs)); });
  try { return await Promise.race([sending,late]); } finally { clearTimeout(timer); }
}
