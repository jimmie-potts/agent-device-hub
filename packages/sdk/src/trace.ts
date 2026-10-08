// W3C trace context (ADR 0012, Observability). Only version-00 traceparent is accepted, as the diagnostic contract
// says; a malformed or all-zero parent is ignored, never adopted. Its IDs come from Web Crypto, which Node and a browser
// both have, so a browser part can bundle it (Hub #922).
import type {TraceContext} from './sdk.js';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO = /^0+$/;

function nonzeroHex(bytes: number): string {
  let value: string;
  do {
    value = Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  } while (ZERO.test(value));
  return value;
}

/**
 * The context for a message sent while handling `parent`: the same trace and flags, in a new span. Only `traceparent`
 * is passed on; a `tracestate` the parent carries is dropped, as the diagnostic contract disables its propagation.
 * Without a valid parent, a new trace starts with the sampled flag set, because the SDK has no sampler of its own.
 */
export function childOf(parent: TraceContext | undefined): TraceContext {
  const [, traceId, spanId, flags] = TRACEPARENT.exec(parent?.traceparent ?? '') ?? [];
  if (parent === undefined || traceId === undefined || spanId === undefined || flags === undefined || ZERO.test(traceId) || ZERO.test(spanId)) {
    return {traceparent: `00-${nonzeroHex(16)}-${nonzeroHex(8)}-01`};
  }
  return {traceparent: `00-${traceId}-${nonzeroHex(8)}-${flags}`};
}

/** The trace id of a traceparent built by `childOf`. */
export const traceIdOf = (traceparent: string): string => traceparent.slice(3, 35);

/** The trace ID, span ID and flags of a valid version-00 context, as log records carry them; undefined otherwise. */
export function traceFields(context: TraceContext): {traceId: string; spanId: string; flags: string} | undefined {
  const [, traceId, spanId, flags] = TRACEPARENT.exec(context.traceparent) ?? [];
  if (traceId === undefined || spanId === undefined || flags === undefined || ZERO.test(traceId) || ZERO.test(spanId)) return undefined;
  return {traceId, spanId, flags};
}
