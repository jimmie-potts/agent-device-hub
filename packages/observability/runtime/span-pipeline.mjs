import { trace } from '@opentelemetry/api';
import { catalog, createRecord, validateRecord, MAX_QUEUE_RECORDS, MAX_QUEUE_BYTES, MAX_RECORD_BYTES } from '@jimmie-potts/bunny-observability';
import { createBoundedSink } from './bounded-sink.mjs';
import { profileSpanNames, projectSpan } from './span-projection.mjs';
import { createDeliveryEvidence } from './delivery-evidence.mjs';
const automaticScopes = new Set(['@opentelemetry/instrumentation-http', '@opentelemetry/instrumentation-undici']);
const key = identity => identity && trace.isSpanContextValid(identity) ? `${identity.traceId}:${identity.spanId}` : undefined;
const cap = (value, maximum) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('Invalid active span limit');
  return value;
};

/**
 * Host-owned association: no SDK attributes, resources, events or links are exported directly. `schemaVersion` names the
 * profile a span's metadata is checked against; it defaults to the contract's producer default.
 */
export function createSpanPipeline({ sink, queueOptions, maxActiveRecords = MAX_QUEUE_RECORDS, maxActiveBytes = MAX_QUEUE_BYTES, observe, schemaVersion }) {
  cap(maxActiveRecords, MAX_QUEUE_RECORDS); cap(maxActiveBytes, MAX_QUEUE_BYTES);
  const evidence=createDeliveryEvidence('traces',observe);
  const queue = createBoundedSink(sink, queueOptions,(id,phase)=>evidence.settle(id,phase)), active = new Map();
  const counters = { registered: 0, associationDropped: 0, unassociated: 0, invalid: 0, unfinished: 0, failures: 0 };
  const count = name => { counters[name] = Math.min(Number.MAX_SAFE_INTEGER, counters[name] + 1); };
  let bytes = 0, stopped = false;
  function register(span, metadata, name, links, automatic = false) {
    const id = key(span.spanContext());
    const size = Buffer.byteLength(JSON.stringify({ metadata, name, links }));
    // A name a later profile adds is no name of the metadata's profile, so an earlier host records no such span.
    if (!id || !validateRecord(metadata).ok || !profileSpanNames(metadata.schema_version).includes(name) || size > MAX_RECORD_BYTES) {
      count('invalid'); return;
    }
    const evidenceId=evidence.begin({traceId:span.spanContext().traceId,spanId:span.spanContext().spanId,name,
      resource:metadata.resource,scope:metadata.scope});
    if (stopped || active.has(id) || active.size >= maxActiveRecords || bytes + size > maxActiveBytes) {
      count('associationDropped');evidence.settle(evidenceId,'dropped');return;
    }
    active.set(id, { metadata, name, links, automatic, size,evidenceId }); bytes += size; count('registered');
  }
  const processor = {
    onStart(span, parentContext) {
      try {
        if (!automaticScopes.has(span.instrumentationScope.name)) return;
        const parent = active.get(key(trace.getSpanContext(parentContext)));
        if (parent) register(span, structuredClone(parent.metadata), 'bunny.command.request', [], true);
      } catch { count('failures'); }
    },
    onEnd(span) {
      try {
        const id = key(span.spanContext()), entry = active.get(id);
        if (!entry) { count('unassociated'); return; }
        active.delete(id); bytes -= entry.size;
        const value = projectSpan(span, entry.metadata, entry.name, entry.links);
        if (!value) { count('invalid');evidence.settle(entry.evidenceId,'failed');return; }
        evidence.project(entry.evidenceId,value);
        queue.push(JSON.stringify(value),entry.evidenceId);
      } catch { count('failures'); }
    },
    async forceFlush() {
      if (!await queue.flush()) throw new Error('Trace flush deadline exceeded');
    },
    shutdown() {
      if (!stopped) {
        stopped = true;
        counters.unfinished = Math.min(Number.MAX_SAFE_INTEGER, counters.unfinished + active.size);
        for(const entry of active.values())evidence.settle(entry.evidenceId,'pending');
        active.clear(); bytes = 0;
      }
      return queue.close();
    },
  };
  return {
    processor,
    /** Bind this narrow tracer adapter to the Hub/worker's existing startSpan injection seam. */
    wrapTracer(tracer, { resource, scope }) {
      return { startSpan(name, options = {}, parent) {
        const span = tracer.startSpan(name, options, parent);
        try {
          if (!span.isRecording()) return span;
          const attributes = { ...options.attributes };
          delete attributes['bunny.schema.version'];
          const selectedResource = typeof resource === 'function' ? resource(name, options) : resource;
          const selectedScope = typeof scope === 'function' ? scope(name, options) : scope;
          // The metadata is checked as a record of an event its scope allows; only its resource, scope and attributes are exported.
          const rule = catalog.scope_rules[selectedScope];
          const event = rule === undefined || rule.events.includes('operation.completed') ? 'operation.completed' : rule.events[0];
          const candidate = createRecord({ ...(schemaVersion === undefined ? {} : { schema_version: schemaVersion }), timestamp: new Date().toISOString(),
            event_name: event, severity_text: 'INFO', resource: selectedResource, scope: { name: selectedScope, version: '1.0.0' }, attributes });
          const canonical = candidate.ok ? validateRecord({ ...candidate.value, attributes }) : candidate;
          if (!canonical.ok) { count('invalid'); return span; }
          const incomingLinks = options.links ?? [];
          if (!Array.isArray(incomingLinks) || incomingLinks.length > 8) { count('invalid'); return span; }
          const links = incomingLinks.map(link => ({ traceId: link.context.traceId,
            spanId: link.context.spanId, traceFlags: link.context.traceFlags }));
          if (links.some(link => !key(link) || !Number.isInteger(link.traceFlags) || link.traceFlags < 0 || link.traceFlags > 255)) {
            count('invalid'); return span;
          }
          register(span, canonical.value, name, links);
        } catch { count('failures'); }
        return span;
      } };
    },
    /** Call before span.end, alongside the Pino emitter, with its canonical record. */
    observe(record) {
      try {
        const checked = validateRecord(record);
        if (!checked.ok) { count('invalid'); return false; }
        const value = checked.value;
        const entry = active.get(`${value.trace_id}:${value.span_id}`);
        if (!entry || entry.automatic) return false;
        const sameResource = Object.keys(entry.metadata.resource).length === Object.keys(value.resource).length &&
          Object.entries(entry.metadata.resource).every(([name, item]) => value.resource[name] === item);
        if (!sameResource || entry.metadata.scope.name !== value.scope.name || entry.metadata.scope.version !== value.scope.version) {
          count('invalid'); return false;
        }
        const size = Buffer.byteLength(JSON.stringify({ metadata: value, name: entry.name, links: entry.links }));
        if (size > MAX_RECORD_BYTES || bytes - entry.size + size > maxActiveBytes) { count('associationDropped'); return false; }
        bytes += size - entry.size; entry.size = size; entry.metadata = value;
        return true;
      } catch { count('failures'); return false; }
    },
    counts: () => ({ ...counters, active: active.size, activeBytes: bytes, output: queue.counts(),evidence:evidence.counts() }),
  };
}
