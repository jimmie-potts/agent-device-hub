// The runtime's recorded spans (ADR 0012, "Observability"; Hub #949): the SDK's span interface, implemented with the
// observability package's host adapter, with tracing on, 100% head sampling that honors a parent's sampled flag and its
// bounded local span sink. Spans take explicit parents, so the runtime installs no process context manager. A span's
// context never goes to a device or vendor. With a configured Collector (Hub #813), the same adapter exports the
// runtime's spans and, through its log pipeline, each record the runtime's writer feeds it: one ingestion path per
// signal, bounded queues, drops and failures counted and never acknowledged to the work that wrote them.
import {ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Context, type Link} from '@opentelemetry/api';
import {createHostDiagnostics} from '@jimmie-potts/bunny-observability/host';
import {recordLog, errorType, noSpans, traceFields, type LogFields, type SpanKind as Kind, type SpanRecorder, type TraceContext} from '@jimmie-potts/sdk';
import type {LogRecord, RuntimeLogger} from './log.js';
import {SCHEMA_VERSION, withoutForeignIds, type Resource} from './record.js';

/** Receives each finished span as one projected OTLP JSON document, the contract's `projectSpan` output. */
export type SpanSink = (span: string) => void;
/** Spans lost: invalid, dropped by the bounded queue or unfinished at shutdown; and spans the sink failed. */
export type SpanCounts = {dropped: number; failed: number};

export interface RuntimeTracing {
  /** A recorder for spans under `scope`, whose `base` attributes win over a span's own, as a module's name does. */
  recorder(scope: string, base?: LogFields): SpanRecorder;
  /**
   * Hands one written record to the Collector export's bounded queue; false when there is no Collector, the queue is
   * full or the adapter has shut down. The loss is counted, never thrown, so the writer's work goes on.
   */
  export(record: LogRecord): boolean;
  /** Spans lost and, with a Collector, records the export dropped or failed; `failed` includes a Collector that refused. */
  counts(): SpanCounts;
  /** Ends the host adapter, flushing spans to the sink within the contract's one-second bound. */
  shutdown(): Promise<void>;
}

const KINDS: Readonly<Record<Kind, SpanKind>> = {
  internal: SpanKind.INTERNAL, server: SpanKind.SERVER, client: SpanKind.CLIENT, producer: SpanKind.PRODUCER, consumer: SpanKind.CONSUMER,
};
// The contract allows at most eight links to a span.
const MAX_LINKS = 8;

/** A W3C context as the OpenTelemetry API holds it; only an authenticated, validated one ever reaches this. */
function spanContextOf(context: TraceContext): {traceId: string; spanId: string; traceFlags: number; isRemote: true} | undefined {
  const ids = traceFields(context);
  return ids === undefined ? undefined : {traceId: ids.traceId, spanId: ids.spanId, traceFlags: Number.parseInt(ids.flags, 16), isRemote: true};
}

type Counts = {invalid?: number; associationDropped?: number; unfinished?: number; failures?: number; output?: {dropped?: number; failed?: number}};
type LogExportCounts = {dropped?: number; failed?: number; invalid?: number; mappingFailed?: number};
const count = (value: number | undefined): number => value ?? 0;
const saturating = (value: number): number => Math.min(Number.MAX_SAFE_INTEGER, value);

/**
 * Starts recording the runtime's spans with `resource`, passing each finished span to `sink`. Undefined when the host
 * adapter cannot start: the runtime then runs without recorded spans, since diagnostics never stop the product, and
 * `log` gets one `runtime.tracing.failed` record with only the exception's type, so the loss of every span is visible.
 * `create` is the host adapter's constructor; a test passes one that fails as a broken install would. `collector` is the
 * configuration's exported Collector origin: with one, spans go to it after `sink`, and `export` feeds it records.
 */
export async function startTracing(
  resource: Resource, sink: SpanSink, log: RuntimeLogger, create: typeof createHostDiagnostics = createHostDiagnostics, collector?: string,
): Promise<RuntimeTracing | undefined> {
  let host: Awaited<ReturnType<typeof createHostDiagnostics>>;
  try {
    host = await create({
      enabled: true, resource, schemaVersion: SCHEMA_VERSION, tracing: true, samplingRatio: 1, globalContext: false,
      // The runtime writes its own records to stderr itself, so the adapter's local log sink stays empty; its log
      // pipeline carries them to the Collector, every level the writer let through, since the writer holds the floors.
      localSink: () => {}, localSpanSink: line => { sink(line); },
      ...(collector === undefined ? {} : {collectorOrigin: collector, queueOptions: {minimumSeverity: 1}}),
    });
  } catch (error) {
    // Only the type: an error's code, such as a module loader's, is not part of this record.
    recordLog(log, 'runtime.tracing.failed', {'error.type': errorType(error)});
    return undefined;
  }
  return {
    recorder(scope, base = {}) {
      const tracer = host.tracerFor({resource, scope});
      if (tracer === undefined) return noSpans;
      return {start(name, {parent, links = [], kind = 'internal', attributes = {}} = {}) {
        const from = parent === undefined ? undefined : spanContextOf(parent);
        const active: Context = from === undefined ? ROOT_CONTEXT : trace.setSpanContext(ROOT_CONTEXT, from);
        const linked: Link[] = links.slice(0, MAX_LINKS).flatMap(link => {
          const context = spanContextOf(link);
          return context === undefined ? [] : [{context}];
        });
        const span = tracer.startSpan(name, {
          kind: KINDS[kind], links: linked, attributes: {...withoutForeignIds(attributes), ...base, 'bunny.provenance': 'source'},
        }, active);
        const own = span.spanContext();
        // A continued trace keeps its parent's flags, reserved bits included, as `childOf` does; a new one is sampled.
        const flags = parent === undefined ? undefined : traceFields(parent)?.flags;
        const traceparent = `00-${own.traceId}-${own.spanId}-${flags ?? ((own.traceFlags & 1) === 1 ? '01' : '00')}`;
        return {context: {traceparent}, end: status => {
          if (status === 'error') span.setStatus({code: SpanStatusCode.ERROR});
          span.end();
        }};
      }};
    },
    export(record) {
      if (collector === undefined) return false;
      try {
        return host.emit(record);
      } catch {
        return false;
      }
    },
    counts() {
      const all = host.counts() as {traces?: Counts; logs?: LogExportCounts};
      const traces = all.traces ?? {};
      const logs = collector === undefined ? {} : all.logs ?? {};
      return {
        dropped: saturating(count(traces.invalid) + count(traces.associationDropped) + count(traces.unfinished) + count(traces.output?.dropped) + count(logs.dropped)),
        failed: saturating(count(traces.failures) + count(traces.output?.failed) + count(logs.failed) + count(logs.invalid) + count(logs.mappingFailed)),
      };
    },
    shutdown: () => host.shutdown(),
  };
}
