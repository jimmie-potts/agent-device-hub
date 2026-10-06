// The module host: manifests, contexts and supervision (ADR 0012, failure isolation).

/** Why a declared module API version is refused, or undefined when it matches the supported one. */
export function checkApiVersion(_declared: string, _supported: string): {code: string; detail: string} | undefined {
  return {code: 'internal', detail: 'not implemented'};
}
