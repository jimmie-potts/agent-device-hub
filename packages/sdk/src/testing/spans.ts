// A span recorder for tests (Hub #949): it keeps every span as plain data, so a module's tests and the kit can check
// names, parents, links, status and timing without the runtime's tracing. Its contexts are the SDK's own: a new span in
// the parent's trace, or a new trace.
import type {TraceContext} from '../sdk.js';
import type {SpanAttributes, SpanKind, SpanName, SpanOptions, SpanRecorder, SpanStatus} from '../spans.js';
import {childOf, traceFields} from '../trace.js';

export type RecordedSpan = {
  readonly name: SpanName;
  readonly traceId: string;
  readonly spanId: string;
  /** The parent's span ID, when the span continues a valid parent. */
  readonly parentSpanId?: string;
  readonly links: readonly {traceId: string; spanId: string}[];
  readonly kind: SpanKind;
  readonly attributes: SpanAttributes;
  readonly startedAtMs: number;
  endedAtMs?: number;
  status?: SpanStatus;
};

export class RecordedSpans implements SpanRecorder {
  /** Every span started, in start order, by this recorder and those made from it with `with`. */
  readonly spans: RecordedSpan[];
  readonly #base: SpanAttributes;

  /** `base` attributes join every span's and win over its own, as the runtime adds a module's name. */
  constructor(base: SpanAttributes = {}, spans: RecordedSpan[] = []) {
    this.#base = base;
    this.spans = spans;
  }

  /** A recorder that keeps its spans in this one's list, with `base` attributes added. */
  with(base: SpanAttributes): RecordedSpans {
    return new RecordedSpans({...this.#base, ...base}, this.spans);
  }

  start(name: SpanName, {parent, links = [], kind = 'internal', attributes = {}}: SpanOptions = {}): {context: TraceContext; end: (status?: SpanStatus) => void} {
    const context = childOf(parent);
    const own = traceFields(context);
    const from = parent === undefined ? undefined : traceFields(parent);
    const continued = from !== undefined && own !== undefined && own.traceId === from.traceId;
    const span: RecordedSpan = {
      name, traceId: own?.traceId ?? '', spanId: own?.spanId ?? '', ...(continued ? {parentSpanId: from.spanId} : {}),
      links: links.flatMap(link => {
        const ids = traceFields(link);
        return ids === undefined ? [] : [{traceId: ids.traceId, spanId: ids.spanId}];
      }),
      kind, attributes: {...attributes, ...this.#base}, startedAtMs: performance.now(),
    };
    this.spans.push(span);
    return {context, end: (status = 'unset') => {
      if (span.endedAtMs !== undefined) return;
      span.endedAtMs = performance.now();
      span.status = status;
    }};
  }

  /** The spans named `name`, in start order. */
  named(name: SpanName): RecordedSpan[] {
    return this.spans.filter(span => span.name === name);
  }
}

/**
 * The spans whose parent is lost: neither a recorded span nor the span of one of `contexts`, the trace contexts of
 * messages that were really sent. A span with no parent is a root and is never lost.
 */
export function lostParents(spans: readonly RecordedSpan[], contexts: Iterable<TraceContext>): RecordedSpan[] {
  const known = new Set(spans.map(span => `${span.traceId}:${span.spanId}`));
  for (const context of contexts) {
    const ids = traceFields(context);
    if (ids !== undefined) known.add(`${ids.traceId}:${ids.spanId}`);
  }
  return spans.filter(span => span.parentSpanId !== undefined && !known.has(`${span.traceId}:${span.parentSpanId}`));
}
