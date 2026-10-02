import { catalog, MAX_RECORD_BYTES, toOtlp } from '@jimmie-potts/bunny-observability';

const nonzero = (value, digits) => typeof value === 'string' &&
  new RegExp(`^[a-f0-9]{${digits}}$`).test(value) && !/^0+$/.test(value);
function nanos(time) {
  if (!Array.isArray(time) || time.length !== 2 || !time.every(Number.isSafeInteger) ||
    time[0] < 0 || time[1] < 0 || time[1] >= 1e9) return undefined;
  const value = BigInt(time[0]) * 1000000000n + BigInt(time[1]);
  return value <= 18446744073709551615n ? value : undefined;
}

/** Export only host-approved canonical metadata, never SDK content or detected resources. */
export function projectSpan(span, metadata, registeredName) {
  try {
    if (!catalog.span_names.includes(registeredName)) return undefined;
    const mapped = toOtlp(metadata)?.resourceLogs[0];
    if (!mapped) return undefined;
    const identity = span.spanContext();
    if (!nonzero(identity.traceId, 32) || !nonzero(identity.spanId, 16) ||
      !Number.isInteger(identity.traceFlags) || identity.traceFlags < 0 || identity.traceFlags > 255) return undefined;
    const parent = span.parentSpanContext;
    if (parent && (parent.traceId !== identity.traceId || !nonzero(parent.spanId, 16))) return undefined;
    const start = nanos(span.startTime), end = nanos(span.endTime);
    if (start === undefined || end === undefined || end < start ||
      !Number.isInteger(span.kind) || span.kind < 0 || span.kind > 4) return undefined;
    const group = mapped.scopeLogs[0];
    const value = { traceId: identity.traceId, spanId: identity.spanId,
      ...(parent ? { parentSpanId: parent.spanId } : {}),
      flags: identity.traceFlags & 1, name: registeredName, kind: span.kind + 1,
      startTimeUnixNano: String(start), endTimeUnixNano: String(end),
      attributes: group.logRecords[0].attributes,
      status: { code: [0, 1, 2].includes(span.status?.code) ? span.status.code : 0 },
    };
    const result = { resourceSpans: [{ resource: mapped.resource, scopeSpans: [{
      scope: group.scope, schemaUrl: group.schemaUrl, spans: [value],
    }] }] };
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_RECORD_BYTES ? result : undefined;
  } catch { return undefined; }
}
