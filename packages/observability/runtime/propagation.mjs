import { trace } from '@opentelemetry/api';

/** Pilot endpoints are explicit numeric loopback origins, never DNS or device addresses. */
export function createOwnedOrigins(values) {
  if (!Array.isArray(values) || values.length > 32) throw new TypeError('Expected numeric loopback origins');
  const origins = new Set();
  for (const value of values) {
    let url;
    try { url = new URL(value); } catch { /* Reject below without echoing private input. */ }
    if (typeof value !== 'string' || !url || url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) || url.origin !== value) {
      throw new TypeError('Expected an exact numeric loopback origin');
    }
    origins.add(value);
  }
  return Object.freeze({ has: value => origins.has(value) });
}

/** Incoming authentication belongs to the application; SDK extraction never adopts headers. */
export const traceparentOnly = Object.freeze({
  fields: () => ['traceparent'],
  extract: active => active,
  inject(active, carrier, setter) {
    const span = trace.getSpanContext(active);
    if (!span || !trace.isSpanContextValid(span)) return;
    // Only the W3C sampled bit is supported by the published diagnostic contract.
    const flags = (span.traceFlags & 1).toString(16).padStart(2, '0');
    setter.set(carrier, 'traceparent', `00-${span.traceId}-${span.spanId}-${flags}`);
  },
});
