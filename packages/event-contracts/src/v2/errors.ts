// The profile 2.0 error code registry as a type (ADR 0012, "Errors, effects and outcomes"). These are the codes of
// `schemas/v2/errors.json`, in its order, each with its fixed `retryable` flag; a test keeps the two equal, code for
// code and flag for flag, so a code outside the registry fails to compile wherever a code is expected. The error body and
// the schema base live here too, in a module that reads no file, so a browser part can bundle them (Hub #922); the
// package's `v2` entry exports them unchanged.

/** Every registry code and its fixed `retryable` flag. */
export const RETRYABLE = {
  'invalid-request': false,
  'invalid-message': false,
  'too-large': false,
  'unsupported-version': false,
  'unknown-schema': false,
  'unsupported-capability': false,
  unauthenticated: false,
  forbidden: false,
  'not-found': false,
  'invalid-state': false,
  'revision-conflict': false,
  'duplicate-conflict': false,
  expired: false,
  cancelled: false,
  capacity: true,
  unavailable: true,
  'uncertain-result': false,
  internal: false,
} as const satisfies Readonly<Record<string, boolean>>;

/** A code from the registry. */
export type ErrorCode = keyof typeof RETRYABLE;

/** Whether `value` is a registry code, for a code read from data that has not been validated. */
export const isErrorCode = (value: unknown): value is ErrorCode => typeof value === 'string' && Object.hasOwn(RETRYABLE, value);

/** The base of every schema identifier: `https://bunny.invalid/events/<family>/<major>.<minor>`. */
export const SCHEMA_BASE = 'https://bunny.invalid/events/';
/** The longest `detail` an error body carries. */
export const MAX_DETAIL = 1024;

export type ErrorDetail = {code: ErrorCode; retryable: boolean; requestId?: string; traceId?: string; detail?: string};
export type ErrorBody = {error: ErrorDetail};

const ID = /^[A-Za-z0-9_.-]{1,128}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;

/**
 * The error body every boundary returns. `retryable` comes from the registry, and the validator refuses received
 * bodies whose code or flag disagrees with it. A code outside the registry fails to compile, and throws when an
 * untyped caller passes one. Extras that the error block would refuse throw here.
 */
export function errorBody(code: ErrorCode, extra: {requestId?: string; traceId?: string; detail?: string} = {}): ErrorBody {
  if (!isErrorCode(code)) throw new Error(`unregistered error code: ${String(code)}`);
  if (extra.requestId !== undefined && !ID.test(extra.requestId)) throw new Error('requestId is not an identifier');
  if (extra.traceId !== undefined && !TRACE_ID.test(extra.traceId)) throw new Error('traceId is not 32 lowercase hex digits');
  if (extra.detail !== undefined && (extra.detail.length === 0 || extra.detail.length > MAX_DETAIL)) throw new Error(`detail must have 1 to ${MAX_DETAIL} characters`);
  return {error: {code, retryable: RETRYABLE[code], ...extra}};
}
