/** The approved diagnostics host adapter; no exporter, payload, credential or native identity is collected. */
import {randomUUID} from 'node:crypto';
import {ROOT_CONTEXT, SpanKind, SpanStatusCode, trace as otelTrace, type Link} from '@opentelemetry/api';
import {createRecord, catalog} from '@jimmie-potts/bunny-observability';
import {createHostDiagnostics} from '@jimmie-potts/bunny-observability/host';
import {childOf, errorType, noSpans, SdkError, traceFields, type Diagnostic, type Logger, type LogFields, type SpanRecorder, type TraceContext} from '@jimmie-potts/sdk';
import {HELPER_SOURCE} from '@jimmie-potts/bb8/link';
const SCHEMA = '1.5';
const KINDS = {internal: SpanKind.INTERNAL, server: SpanKind.SERVER, client: SpanKind.CLIENT, producer: SpanKind.PRODUCER, consumer: SpanKind.CONSUMER};
const severity = {debug: 'DEBUG', info: 'INFO', warn: 'WARN', error: 'ERROR'} as const;
export async function startHelperDiagnostics(options: {sink: (line: string, signal: AbortSignal) => unknown; spanSink?: (line: string, signal: AbortSignal) => unknown}) {
  const resource = {'service.namespace': 'bunny', 'service.name': 'bunny-tool', 'service.version': '0.1.0', 'service.instance.id': randomUUID(), 'deployment.environment.name': 'production'};
  const host = await createHostDiagnostics({enabled: true, resource, schemaVersion: SCHEMA, tracing: true, samplingRatio: 1, globalContext: false, localSink: options.sink, localSpanSink: options.spanSink ?? options.sink});
  const write = (level: keyof Logger) => (event: string, fields: LogFields = {}, parent?: TraceContext): void => {
    const ids = traceFields(parent ?? childOf(undefined));
    const clean = Object.fromEntries(Object.entries(fields).filter(([key, value]) => key in catalog.attributes && (key !== 'bunny.request.id' || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)))));
    const record = createRecord({schema_version: SCHEMA, timestamp: new Date().toISOString(), severity_text: severity[level], event_name: event, resource, scope: {name: 'bunny.helper', version: '1.0.0'}, attributes: {...clean, 'bunny.participant': HELPER_SOURCE, 'bunny.provenance': 'source'}, ...(ids === undefined ? {} : {trace_id: ids.traceId, span_id: ids.spanId, trace_flags: ids.flags})});
    if (record.ok) host.emit(record.value);
  };
  const log: Logger = {debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error')};
  const tracer = host.tracerFor({resource, scope: 'bunny.helper'});
  const contextOf = (parent: TraceContext) => {const ids = traceFields(parent); return ids === undefined ? undefined : {traceId: ids.traceId, spanId: ids.spanId, traceFlags: parseInt(ids.flags, 16), isRemote: true};};
  const trace: SpanRecorder = tracer === undefined ? noSpans : {start(name, {parent, links = [], kind = 'internal', attributes = {}} = {}) {
    const from = parent === undefined ? undefined : contextOf(parent);
    const active = from === undefined ? ROOT_CONTEXT : otelTrace.setSpanContext(ROOT_CONTEXT, from);
    const linked: Link[] = links.slice(0, 8).flatMap(link => {const context = contextOf(link); return context === undefined ? [] : [{context}];});
    const span = tracer.startSpan(name, {kind: KINDS[kind], links: linked, attributes: {...attributes, 'bunny.participant': HELPER_SOURCE, 'bunny.provenance': 'source'}}, active);
    const own = span.spanContext(), flags = parent === undefined ? undefined : traceFields(parent)?.flags;
    return {context: {traceparent: `00-${own.traceId}-${own.spanId}-${flags ?? ((own.traceFlags & 1) === 1 ? '01' : '00')}`}, end: status => {if (status === 'error') span.setStatus({code: SpanStatusCode.ERROR}); span.end();}};
  }};
  const diagnostic = (item: Diagnostic): void => {
    const event = item.event === 'remote.reconnected' ? 'operation.completed' : ['remote.disconnected', 'remote.refused', 'remote.command.uncertain'].includes(item.event) ? 'operation.failed' : 'message.received';
    log[item.level](event, {...(item.code === undefined ? {} : {'bunny.code': item.code}), ...(item.requestId === undefined ? {} : {'bunny.request.id': item.requestId}), ...(item.outcome === undefined ? {} : {'bunny.outcome': item.outcome}), ...(item.key === undefined ? {} : {'bunny.routing.key': item.key}), ...(item.attempts === undefined ? {} : {'bunny.attempt_count': item.attempts})}, item.trace);
  };
  const failed = (error: unknown, parent?: TraceContext): void => {log.error('operation.failed', {'bunny.code': error instanceof SdkError ? error.body.error.code : 'internal', 'error.type': errorType(error), 'bunny.outcome': 'failed'}, parent);};
  return {log, trace, diagnostic, failed, counts: () => host.counts(), shutdown: () => host.shutdown()};
}
