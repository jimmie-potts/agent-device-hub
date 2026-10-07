// The shared 2.0 error body (ADR 0012) that a refusal line carries as `errorBody`, beside its 1.x `error` and
// `detail` (Hub #921). The core has no runtime dependency, so it copies the registry codes it uses and their
// `retryable` flags from `@jimmie-potts/event-contracts` (`schemas/v2/errors.json`). A workspace test proves that
// every body equals that package's `errorBody`.

/** The registry codes a refusal uses, with the registry's `retryable` flag for each. */
const RETRYABLE = {
  'invalid-request': false,
  'not-found': false,
  'invalid-state': false,
  capacity: true,
  unavailable: true,
  internal: false,
} as const;

export type RefusalCode = keyof typeof RETRYABLE;

/** The registry's limit on `detail`. */
export const MAX_DETAIL = 1024;

/** The 2.0 code for each 1.x refusal, as the README lists them. Any other refusal is `internal`. */
export const REFUSAL_CODES: Readonly<Record<string, RefusalCode>> = Object.freeze({
  usage: 'invalid-request',
  'unknown-scenario': 'invalid-request',
  'unknown-run': 'not-found',
  'invalid-receipt': 'invalid-state',
  'run-not-running': 'invalid-state',
  'scenario-mismatch': 'invalid-state',
  'already-frozen': 'invalid-state',
  'proof-conflict': 'invalid-state',
  'proof-irregular': 'invalid-state',
  'proof-root-unusable': 'invalid-state',
  'runtime-root-unusable': 'invalid-state',
  'capture-in-progress': 'capacity',
  'receipt-locked': 'capacity',
  'lease-failed': 'unavailable',
  internal: 'internal',
});

export interface ErrorBody {
  error: {code: RefusalCode; retryable: boolean; detail: string};
}

/**
 * The 2.0 body for a 1.x refusal. `detail` keeps the 1.x code and detail as `<error>: <detail>`, cut to the
 * registry's limit, so the body still names the 1.x reason once the old fields are removed (#839).
 */
export function refusalBody(error: string, detail: string): ErrorBody {
  const code = Object.hasOwn(REFUSAL_CODES, error) ? (REFUSAL_CODES[error] ?? 'internal') : 'internal';
  return {error: {code, retryable: RETRYABLE[code], detail: `${error}: ${detail}`.slice(0, MAX_DETAIL)}};
}
