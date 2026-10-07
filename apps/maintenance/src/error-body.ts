// The shared 2.0 error body (ADR 0012) that a blocked intake response carries as `error`, beside its 1.x fields
// (Hub #921). The packaged intake bundles no contracts package, so this copies the registry codes it uses and their
// `retryable` flags from `@jimmie-potts/event-contracts` (`schemas/v2/errors.json`). A test proves that every body
// equals that package's `errorBody`.

/** The registry codes a blocked response uses, with the registry's `retryable` flag for each. */
const RETRYABLE = {
  'invalid-request': false,
  forbidden: false,
  expired: false,
  'not-found': false,
  'invalid-state': false,
  'revision-conflict': false,
  capacity: true,
  unavailable: true,
  internal: false,
} as const;

export type RefusalCode = keyof typeof RETRYABLE;

/** The 2.0 code for each blocked reason, as the README lists them. Any other reason is `internal`. */
export const REASON_CODES: Readonly<Record<string, RefusalCode>> = Object.freeze({
  'invalid-or-unavailable-intake': 'invalid-request',
  'invalid-request': 'invalid-request',
  'invalid-operation': 'invalid-request',
  'invalid-run': 'invalid-request',
  'invalid-evidence-directory': 'invalid-request',
  'unauthorized-maintenance': 'forbidden',
  'expired-deadline': 'expired',
  'unknown-run': 'not-found',
  'run-identity-mismatch': 'invalid-state',
  'interrupted-run-needs-reconciliation': 'invalid-state',
  'interrupted-before-evidence': 'invalid-state',
  'missing-retained-evidence': 'invalid-state',
  'invalid-finding-state': 'invalid-state',
  'missing-selected-issue': 'invalid-state',
  'trusted-file-drift': 'invalid-state',
  'unsafe-file': 'invalid-state',
  'unsafe-directory': 'invalid-state',
  'unsafe-name': 'invalid-state',
  'unsafe-evidence-entry': 'invalid-state',
  'source-repository-mismatch': 'invalid-state',
  'issue-is-pr': 'invalid-state',
  'issue-inventory-capped': 'invalid-state',
  'source-not-current': 'revision-conflict',
  'publication-inventory-changed': 'revision-conflict',
  'evidence-capacity': 'capacity',
  'process-deadline': 'unavailable',
  'process-unavailable': 'unavailable',
  'process-failed': 'unavailable',
  'process-output-limit': 'unavailable',
  'invalid-issue-inventory': 'unavailable',
  'invalid-issue-response': 'unavailable',
  'invalid-source-revision': 'unavailable',
  'intake-unavailable': 'internal',
  'invalid-query-bounds': 'internal',
  'invalid-issue': 'internal',
});

export interface ErrorBody {
  error: {code: RefusalCode; retryable: boolean; detail: string};
}

/** The registry's limit on `detail`. */
export const MAX_DETAIL = 1024;

/**
 * The 2.0 body for a blocked reason. `detail` is the reason, cut to the registry's limit, so the body still names it
 * after #839 removes the old fields.
 */
export function refusalBody(reason: string): ErrorBody {
  const code = Object.hasOwn(REASON_CODES, reason) ? (REASON_CODES[reason] ?? 'internal') : 'internal';
  return {error: {code, retryable: RETRYABLE[code], detail: reason.slice(0, MAX_DETAIL)}};
}
