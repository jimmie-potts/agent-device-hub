// One explicit browser action, with no retry or replay (Hub #1006). Device controls reuse this transport.
import {MAX_DETAIL, RETRYABLE, errorBody, isErrorCode, type ErrorBody} from '@jimmie-potts/event-contracts/v2/errors';
import {REQUEST_HEADER, childOf} from '@jimmie-potts/sdk/remote';

export type ActionReply = {status: 'accepted'; requestId: string} | ErrorBody;
export type BrowserAction = {family: string; target: string; data: object; requestId: string};
const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A closed shared error body, retaining optional diagnostic fields and a matching request identity. */
function refusal(value: unknown, requestId: string): value is ErrorBody {
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.error)) return false;
  const error = value.error;
  return Object.keys(error).every(key => ['code', 'retryable', 'requestId', 'traceId', 'detail'].includes(key)) &&
    isErrorCode(error.code) && error.retryable === RETRYABLE[error.code] &&
    (error.requestId === undefined || error.requestId === requestId) &&
    (error.traceId === undefined || typeof error.traceId === 'string' && /^[0-9a-f]{32}$/.test(error.traceId)) &&
    (error.detail === undefined || typeof error.detail === 'string' && error.detail.length > 0 && error.detail.length <= MAX_DETAIL);
}

/** Sends once. A lost or malformed reply leaves the attempt uncertain; recovery never resends it. */
export async function sendAction({family, target, data, requestId}: BrowserAction): Promise<ActionReply> {
  const uncertain = (): ErrorBody => errorBody('uncertain-result', {...ID.test(requestId) ? {requestId} : {}, detail: 'the action has no reliable reply; it was not sent again'});
  try {
    const response = await fetch(`/api/v2/commands/${encodeURIComponent(family)}`, {
      method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'same-origin',
      headers: {'content-type': 'application/json', [REQUEST_HEADER]: '1', ...childOf(undefined)},
      body: JSON.stringify({target, data, requestId}),
    });
    const answer: unknown = await response.json();
    if (response.status === 200 && object(answer) && Object.keys(answer).length === 3 && answer.schema === 'command-reply/2.0' &&
      answer.status === 'accepted' && answer.requestId === requestId) return {status: 'accepted', requestId};
    return refusal(answer, requestId) ? answer : uncertain();
  } catch {
    return uncertain();
  }
}
