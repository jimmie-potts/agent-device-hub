import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { createOwnedOrigins } from './propagation.mjs';

/** The host supplies its already-bound synthetic controller origins. No incoming auto spans. */
export function createOutgoingInstrumentation(readOrigins) {
  const permitted = origin => {
    try { return createOwnedOrigins(readOrigins()).has(origin); } catch { return false; }
  };
  return [
    new HttpInstrumentation({
      disableIncomingRequestInstrumentation: true,
      requireParentforOutgoingSpans: true,
      ignoreOutgoingRequestHook: request => {
        const hostname = request.hostname;
        const host = hostname === '::1' ? '[::1]' : hostname;
        const protocol = request.protocol ?? 'http:';
        const port = request.port || (protocol === 'https:' ? 443 : 80);
        let origin;
        try { origin = new URL(`${protocol}//${host}:${port}`).origin; } catch { return true; }
        return !permitted(origin);
      },
    }),
    new UndiciInstrumentation({
      requireParentforSpans: true,
      ignoreRequestHook: request => !permitted(request.origin),
    }),
  ];
}
