// The runtime's recorded spans (ADR 0012, "Observability"; Hub #949): the SDK's span interface, implemented with the
// observability package's host adapter, with tracing on, 100% head sampling that honors a parent's sampled flag, no
// exporter and its bounded local span sink. Spans take explicit parents, so the runtime installs no process context
// manager. A span's context never goes to a device or vendor.
import {ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Context, type Link} from '@opentelemetry/api';
import {createHostDiagnostics} from '@jimmie-potts/bunny-observability/host';
import {noSpans, traceFields, type LogFields, type SpanKind as Kind, type SpanRecorder, type TraceContext} from '@jimmie-potts/sdk';
import {errorFields, type RuntimeLogger} from './log.js';
import {SCHEMA_VERSION, withoutForeignIds, type Resource} from './record.js';

/** Receives each finished span as one projected OTLP JSON document, the contract's `projectSpan` output. */
export type SpanSink = (span: string) => void;
/** Spans lost: invalid, dropped by the bounded queue or unfinished at shutdown; and spans the sink failed. */
export type SpanCounts = {dropped: number; failed: number};

export interface RuntimeTracing {
  /** A recorder for spans under `scope`, whose `base` attributes win over a span's own, as a module's name does. */
  recorder(scope: string, base?: LogFields): SpanRecorder;
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
const count = (value: number | undefined): number => value ?? 0;
const saturating = (value: number): number => Math.min(Number.MAX_SAFE_INTEGER, value);

/**
 * Starts recording the runtime's spans with `resource`, passing each finished span to `sink`. Undefined when the host
 * adapter cannot start: the runtime then runs without recorded spans, since diagnostics never stop the product, and
 * `log` gets one `runtime.tracing.failed` record with the exception's type, so the loss of every span is visible.
 */
export async function startTracing(resource: Resource, sink: SpanSink, log: RuntimeLogger): Promise<RuntimeTracing | undefined> {
  let host: Awaited<ReturnType<typeof createHostDiagnostics>>;
  try {
    host = await createHostDiagnostics({
      enabled: true, resource, schemaVersion: SCHEMA_VERSION, tracing: true, samplingRatio: 1, globalContext: false,
      // The runtime writes its own records; the adapter's log pipeline stays empty.
      localSink: () => {}, localSpanSink: line => { sink(line); },
    });
  } catch (error) {
    log.error('runtime.tracing.failed', errorFields(error));
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
    counts() {
      const traces = (host.counts() as {traces?: Counts}).traces ?? {};
      return {
        dropped: saturating(count(traces.invalid) + count(traces.associationDropped) + count(traces.unfinished) + count(traces.output?.dropped)),
        failed: saturating(count(traces.failures) + count(traces.output?.failed)),
      };
    },
    shutdown: () => host.shutdown(),
  };
}
