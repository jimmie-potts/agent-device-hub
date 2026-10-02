import { createHash } from 'node:crypto';
import { catalog, validateRecord, toOtlp } from '@jimmie-potts/bunny-observability';
const resources = ['service.namespace', 'service.name', 'service.version', 'service.instance.id', 'deployment.environment.name'];
const normalize = key => key.replaceAll('.', '_');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const fail = () => { throw new Error('Backend query record invalid'); };
const ns = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
function hex(value, bytes) {
  if (typeof value !== 'string') return fail();
  if (new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value) && !/^0+$/.test(value)) return value;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== bytes || decoded.toString('base64') !== value || decoded.every(n => n === 0)) return fail();
  return decoded.toString('hex');
}
function attrs(values, allowed) {
  if (!Array.isArray(values) || values.length > 64) return fail();
  const result = {};
  for (const item of values) {
    if (!object(item) || !allowed.includes(item.key) || Object.hasOwn(result, item.key) || !object(item.value)) return fail();
    const entries = Object.entries(item.value);
    if (entries.length !== 1) return fail();
    const [type, value] = entries[0];
    if (!(type === 'stringValue' && typeof value === 'string' && value.length <= 256) &&
      !(type === 'intValue' && typeof value === 'string' && /^-?(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value))) &&
      !(type === 'boolValue' && typeof value === 'boolean') &&
      !(type === 'doubleValue' && typeof value === 'number' && Number.isFinite(value))) return fail();
    result[item.key] = { [type]: value };
  }
  return sorted(result);
}

/** Expected Loki projection from a validated released record, including explicit Collector event mapping. */
export function expectedLog(record) {
  if (!validateRecord(record).ok) return fail();
  const group = toOtlp(record).resourceLogs[0], log = group.scopeLogs[0].logRecords[0];
  const fields = Object.fromEntries(Object.entries({ ...record.resource, ...record.attributes,
    'bunny.schema.version': record.schema_version }).map(([key, value]) => [normalize(key), String(value)]));
  Object.assign(fields, { scope_name: record.scope.name, scope_version: record.scope.version,
    event_name: record.event_name, severity_number: String(record.severity_number), severity_text: record.severity_text });
  if (log.traceId) fields.trace_id = log.traceId;
  if (log.spanId) fields.span_id = log.spanId;
  if (log.flags) fields.flags = String(log.flags);
  if (log.timeUnixNano && log.observedTimeUnixNano) fields.observed_timestamp = log.observedTimeUnixNano;
  return { timestamp: log.timeUnixNano ?? log.observedTimeUnixNano, body: record.body, fields: sorted(fields) };
}

export function readLokiRecords(value, { limit = 5000 } = {}) {
  if (value?.status !== 'success' || (value.warnings != null && (!Array.isArray(value.warnings) || value.warnings.length)) || value.data?.resultType !== 'streams' ||
    !Array.isArray(value.data.encodingFlags) || !value.data.encodingFlags.includes('categorize-labels') || !Array.isArray(value.data.result) ||
    !Number.isInteger(limit) || limit < 1 || limit > 5000) return fail();
  const rows = [], allowed = new Set([...resources.map(normalize), ...Object.keys(catalog.attributes).map(normalize),
    'bunny_schema_version', 'scope_name', 'scope_version', 'event_name', 'severity_number', 'severity_text',
    'trace_id', 'span_id', 'flags', 'observed_timestamp', 'detected_level']);
  for (const stream of value.data.result) {
    if (!object(stream.stream) || !Array.isArray(stream.values)) return fail();
    for (const entry of stream.values) {
      if (!Array.isArray(entry) || entry.length !== 3 || !ns(entry[0]) || typeof entry[1] !== 'string' ||
        !object(entry[2]?.structuredMetadata) || Object.keys(entry[2].parsed ?? {}).length) return fail();
      const fields = { ...stream.stream };
      for (const [key, val] of Object.entries(entry[2].structuredMetadata)) {
        if (Object.hasOwn(fields, key) && fields[key] !== val) return fail(); fields[key] = val;
      }
      if (Object.entries(fields).some(([key, val]) => !allowed.has(key) || typeof val !== 'string' || val.length > 256)) return fail();
      delete fields.detected_level;
      const attributes = {};
      for (const [key, definition] of Object.entries(catalog.attributes)) {
        const raw = fields[normalize(key)]; if (raw === undefined) continue;
        attributes[key] = definition.type === 'boolean' ? raw === 'true' ? true : raw === 'false' ? false : null
          : ['number', 'integer'].includes(definition.type) ? Number(raw) : raw;
      }
      const iso = stamp => { if (!ns(stamp) || BigInt(stamp) % 1000000n) return fail(); return new Date(Number(BigInt(stamp) / 1000000n)).toISOString(); };
      const record = { schema_version: fields.bunny_schema_version, timestamp: iso(entry[0]),
        event_name: fields.event_name, body: entry[1], severity_number: Number(fields.severity_number), severity_text: fields.severity_text,
        resource: Object.fromEntries(resources.map(key => [key, fields[normalize(key)]])),
        scope: { name: fields.scope_name, version: fields.scope_version }, attributes,
        ...(fields.trace_id ? { trace_id: fields.trace_id, span_id: fields.span_id, trace_flags: Number(fields.flags ?? 0).toString(16).padStart(2, '0') } : {}),
        ...(fields.observed_timestamp ? { observed_timestamp: iso(fields.observed_timestamp) } : {}) };
      const expected = expectedLog(record);
      if (JSON.stringify(expected.fields) !== JSON.stringify(sorted(fields))) return fail();
      rows.push(expected);
      if (rows.length >= limit) throw new Error('Backend query result limit reached; completeness unknown');
    }
  }
  return rows;
}

/** Tempo v2 uses protobuf JSON byte IDs in some versions; normalize only exact hex/base64 identities. */
export function readTempoSpans(value, traceId) {
  traceId = hex(traceId, 16);
  if (value?.status != null && !['COMPLETE', 0].includes(value.status)) return fail();
  const groups = value?.trace?.resourceSpans;
  if (!Array.isArray(groups)) return fail();
  const spans = [], kinds = ['SPAN_KIND_UNSPECIFIED', 'SPAN_KIND_INTERNAL', 'SPAN_KIND_SERVER', 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER', 'SPAN_KIND_CONSUMER'];
  for (const group of groups) {
    const resource = attrs(group.resource?.attributes, resources);
    if (group.resource?.droppedAttributesCount || !Array.isArray(group.scopeSpans)) return fail();
    for (const scope of group.scopeSpans) {
      if (!object(scope.scope) || typeof scope.scope.name !== 'string' || scope.scope.name.length > 128 ||
        typeof scope.scope.version !== 'string' || scope.scope.version.length > 128 ||
        scope.scope.droppedAttributesCount || scope.scope.attributes?.length || !Array.isArray(scope.spans)) return fail();
      for (const span of scope.spans) {
        const id = hex(span.traceId, 16), spanId = hex(span.spanId, 8);
        if (id !== traceId || !catalog.span_names.includes(span.name) || !ns(span.startTimeUnixNano) || !ns(span.endTimeUnixNano) ||
          BigInt(span.endTimeUnixNano) < BigInt(span.startTimeUnixNano) || span.droppedAttributesCount || span.droppedEventsCount ||
          span.droppedLinksCount || span.events?.length || span.status?.message || !Array.isArray(span.links ?? [])) return fail();
        const kind = typeof span.kind === 'string' ? kinds.indexOf(span.kind) : span.kind ?? 0;
        const status = typeof span.status?.code === 'string' ? ['STATUS_CODE_UNSET', 'STATUS_CODE_OK', 'STATUS_CODE_ERROR'].indexOf(span.status.code) : span.status?.code ?? 0;
        if (![0, 1, 2, 3, 4, 5].includes(kind) || ![0, 1, 2].includes(status) || (span.flags != null && (!Number.isInteger(span.flags) || span.flags < 0 || span.flags > 4294967295))) return fail();
        const links = (span.links ?? []).map(link => {
          if (link.attributes?.length || link.droppedAttributesCount || (link.flags != null &&
            (!Number.isInteger(link.flags) || link.flags < 0 || link.flags > 4294967295))) return fail();
          return { traceId: hex(link.traceId, 16), spanId: hex(link.spanId, 8), flags: (link.flags ?? 0) & 1 };
        });
        if (links.length > 8) return fail();
        spans.push({ resource, scope: { name: scope.scope.name, version: scope.scope.version }, traceId: id, spanId,
          parentSpanId: span.parentSpanId ? hex(span.parentSpanId, 8) : null, name: span.name, kind,
          startTimeUnixNano: span.startTimeUnixNano, endTimeUnixNano: span.endTimeUnixNano, flags: (span.flags ?? 0) & 1,
          attributes: attrs(span.attributes ?? [], [...Object.keys(catalog.attributes), 'bunny.schema.version']), links, status });
        if (spans.length > 20000) return fail();
      }
    }
  }
  return spans;
}

const stable = value => Array.isArray(value) ? value.map(stable) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
/** Full canonical projections, compared as multisets. Counts alone never establish correlation. */
export function compareRecords(expected, actual) {
  if (![expected, actual].every(value => Array.isArray(value) && value.length <= 20000)) return fail();
  const counts = rows => {
    const result = new Map();
    for (const row of rows) {
      const key = createHash('sha256').update(JSON.stringify(stable(row))).digest('hex'); result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const before = counts(expected), after = counts(actual), missing = [], unexpected = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (before.get(key) ?? 0) - (after.get(key) ?? 0);
    if (delta > 0) missing.push({ sha256: key, count: delta });
    if (delta < 0) unexpected.push({ sha256: key, count: -delta });
  }
  return { equal: missing.length === 0 && unexpected.length === 0, expected: expected.length, actual: actual.length, missing, unexpected };
}
