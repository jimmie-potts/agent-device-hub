import { ROOT_CONTEXT, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { createRecord, parseTraceparent, validateRecord } from '@jimmie-potts/bunny-observability';

/** Synthetic controller adapter. The caller authenticates before request(); no domain callbacks run here. */
export function createWorkerDiagnostics({ resource, workerResource, emit, tracer }) {
  let failures = 0, invalidRecords = 0;
  const failed = () => { failures = Math.min(Number.MAX_SAFE_INTEGER, failures + 1); };
  const invalid = () => { invalidRecords = Math.min(Number.MAX_SAFE_INTEGER, invalidRecords + 1); };
  const safe = action => { try { return action(); } catch { failed(); return undefined; } };
  const snapshot = active => {
    const value = safe(() => trace.getSpanContext(active));
    return value && trace.isSpanContextValid(value) ?
      { traceId: value.traceId, spanId: value.spanId, traceFlags: value.traceFlags } : undefined;
  };
  function stage(name, scope, attributes, active, service, kind, links = []) {
    const started = performance.now();
    const candidate = createRecord({ timestamp: new Date().toISOString(), event_name: 'operation.completed', severity_text: 'INFO',
      resource: service, scope: { name: scope, version: '1.0.0' }, attributes: { ...attributes, 'bunny.provenance': 'source' } });
    const base = candidate.ok ? validateRecord({ ...candidate.value,
      attributes: { ...attributes, 'bunny.provenance': 'source' } }) : candidate;
    if (!base.ok) invalid();
    const span = base.ok ? safe(() => (tracer ?? trace.getTracer(scope, '1.0.0')).startSpan(name, {
      kind, attributes: { ...base.value.attributes, 'bunny.schema.version': base.value.schema_version }, links,
    }, active)) : undefined;
    const identity = span ? safe(() => span.spanContext()) : undefined;
    const captured = identity && trace.isSpanContextValid(identity) ?
      { traceId: identity.traceId, spanId: identity.spanId, traceFlags: identity.traceFlags } : undefined;
    const owned = captured ? trace.setSpanContext(ROOT_CONTEXT, captured) : ROOT_CONTEXT;
    let ended = false;
    function record(event, fields = {}) {
      if (!base.ok) return;
      const result = createRecord({ ...base.value, event_name: event, timestamp: new Date().toISOString(),
        severity_text: fields['bunny.outcome'] === 'rejected' ? 'WARN' : 'INFO',
        attributes: { ...base.value.attributes, ...fields },
        ...(captured ? { trace_id: captured.traceId, span_id: captured.spanId,
          trace_flags: captured.traceFlags.toString(16).padStart(2, '0') } : {}),
      });
      if (!result.ok) { invalid(); return; }
      safe(() => { void Promise.resolve(emit(result.value)).catch(failed); });
      safe(() => span?.setAttributes(result.value.attributes));
    }
    return { active: owned, identity: captured, record,
      finish(event, fields = {}) {
        if (ended) return;
        ended = true;
        const duration = Math.min(86400000, Math.max(0, performance.now() - started));
        try {
          record(event, { ...fields, 'bunny.duration_ms': duration,
            ...(scope === 'bunny.queue' ? { 'bunny.queue.wait_ms': duration } : {}),
            ...(name === 'bunny.command.execute' ? { 'bunny.execution.duration_ms': duration } : {}),
          });
          safe(() => span?.setStatus({ code: fields['bunny.outcome'] === 'rejected' ? SpanStatusCode.ERROR : SpanStatusCode.UNSET }));
        } finally { safe(() => span?.end()); }
      },
    };
  }
  const inert = Object.freeze({ finish() {} });
  return {
    counts: () => ({ failures, invalidRecords }),
    request(attributes, traceparent) {
      const incoming = parseTraceparent(traceparent, { authenticated: true, owned: true });
      const active = incoming ? trace.setSpanContext(ROOT_CONTEXT, { traceId: incoming.trace_id,
        spanId: incoming.span_id, traceFlags: parseInt(incoming.trace_flags, 16), isRemote: true }) : ROOT_CONTEXT;
      const request = stage('bunny.command.request', 'bunny.controller', attributes, active, resource, SpanKind.SERVER);
      let handoff;
      return {
        finish({ outcome }) { request.finish(outcome === 'rejected' ? 'command.rejected' : 'command.admitted', { 'bunny.outcome': outcome }); },
        queued() {
          if (handoff) return handoff;
          const queue = stage('bunny.command.queue', 'bunny.queue', attributes, request.active, resource, SpanKind.INTERNAL);
          queue.record('command.queued', { 'bunny.outcome': 'queued' });
          let settled = false;
          handoff = {
            cancel() {
              if (settled) return; settled = true;
              queue.finish('command.cancelled', { 'bunny.outcome': 'cancelled' });
            },
            execute() {
              if (settled) return inert; settled = true;
              queue.finish('operation.completed', { 'bunny.outcome': 'accepted' });
              // Preserve owned causal context and link deferred work to its original admission.
              const linked = snapshot(request.active);
              const execution = stage('bunny.command.execute', 'bunny.controller', attributes, queue.active,
                workerResource, SpanKind.INTERNAL, linked ? [{ context: linked }] : []);
              execution.record('command.executing', { 'bunny.outcome': 'accepted' });
              return { finish({ outcome }) { execution.finish('command.completed', { 'bunny.outcome': outcome }); } };
            },
          };
          return handoff;
        },
      };
    },
  };
}
