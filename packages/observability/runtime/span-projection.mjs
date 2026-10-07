import { catalog, MAX_RECORD_BYTES, toOtlp } from '@jimmie-potts/bunny-observability';

const nonzero = (value, digits) => typeof value === 'string' &&
  new RegExp(`^[a-f0-9]{${digits}}$`).test(value) && !/^0+$/.test(value);
function nanos(time) {
  if (!Array.isArray(time) || time.length !== 2 || !time.every(Number.isSafeInteger) ||
    time[0] < 0 || time[1] < 0 || time[1] >= 1e9) return undefined;
  const value = BigInt(time[0]) * 1000000000n + BigInt(time[1]);
  return value <= 18446744073709551615n ? value : undefined;
}

/**
 * The span names profile `version` registers: every registered name but those a later profile adds, so a profile
 * rejects each later addition. An unknown profile registers none.
 */
export function profileSpanNames(version) {
  const index = catalog.schema_versions.indexOf(version);
  if (index < 0) return [];
  const later = new Set(catalog.schema_versions.slice(index + 1).flatMap(next => catalog.additions[next]?.span_names ?? []));
  return catalog.span_names.filter(name => !later.has(name));
}

/** Export only host-approved canonical metadata, never SDK content or detected resources. */
export function projectSpan(span, metadata, registeredName, approvedLinks = []) {
  try {
    // A span's name belongs to the profile of its metadata, as a record's event does.
    if (!profileSpanNames(metadata?.schema_version).includes(registeredName)) return undefined;
    if (!Array.isArray(approvedLinks) || approvedLinks.length > 8) return undefined;
    const links = [];
    for (const link of approvedLinks) {
      if (!link || Object.getPrototypeOf(link) !== Object.prototype ||
        Object.keys(link).some(key => !['traceId', 'spanId', 'traceFlags'].includes(key))) return undefined;
      const values = {};
      for (const key of ['traceId', 'spanId', 'traceFlags']) {
        const descriptor = Object.getOwnPropertyDescriptor(link, key);
        if (!descriptor || !('value' in descriptor)) return undefined;
        values[key] = descriptor.value;
      }
      if (!nonzero(values.traceId, 32) || !nonzero(values.spanId, 16) ||
        !Number.isInteger(values.traceFlags) || values.traceFlags < 0 || values.traceFlags > 255) return undefined;
      links.push({ traceId: values.traceId, spanId: values.spanId, flags: values.traceFlags & 1 });
    }
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
      ...(links.length ? { links } : {}),
      status: { code: [0, 1, 2].includes(span.status?.code) ? span.status.code : 0 },
    };
    const result = { resourceSpans: [{ resource: mapped.resource, scopeSpans: [{
      scope: group.scope, schemaUrl: group.schemaUrl, spans: [value],
    }] }] };
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_RECORD_BYTES ? result : undefined;
  } catch { return undefined; }
}
