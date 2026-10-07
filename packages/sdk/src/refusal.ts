// A refusal as every SDK boundary reads one (ADR 0012, "Envelope and conventions"): the shared error body with a
// registry code and that code's `retryable` flag. Anything else is not a refusal, so it can never claim that a command
// had no effect.
import {MAX_DETAIL, RETRYABLE, errorBody, isErrorCode, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Reply} from './sdk.js';

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Fields : undefined;

/**
 * `value` rebuilt as the shared error body: its registered code with the registry's flag, and at most `MAX_DETAIL`
 * characters of detail. Anything else it carried is dropped. Undefined when the code is unregistered or the flag
 * disagrees with the registry.
 */
export function refusalOf(value: unknown): ErrorBody | undefined {
  const error = fields(fields(value)?.error);
  const code = error?.code;
  if (!isErrorCode(code) || RETRYABLE[code] !== error?.retryable) return undefined;
  const detail = typeof error?.detail === 'string' && error.detail.length > 0 ? error.detail.slice(0, MAX_DETAIL) : undefined;
  return errorBody(code, detail === undefined ? {} : {detail});
}

/** A responder's answer as a reply: `{status: 'accepted'}`, or a valid refusal rebuilt by `refusalOf`. Undefined otherwise. */
export function replyOf(value: unknown): Reply | undefined {
  return fields(value)?.status === 'accepted' ? {status: 'accepted'} : refusalOf(value);
}
