// The profile 2.0 error code registry as a type (ADR 0012, "Errors, effects and outcomes"). These are the codes of
// `schemas/v2/errors.json`, in its order, each with its fixed `retryable` flag; a test keeps the two equal, code for
// code and flag for flag, so a code outside the registry fails to compile wherever a code is expected.

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
