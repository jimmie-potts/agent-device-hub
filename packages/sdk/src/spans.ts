// Recorded spans (ADR 0012, "Observability"): the SDK defines this small interface, and the runtime implements it with
// the observability package's host adapter. There is no second tracing implementation here: without a recorder, a span
// is only the trace context a message has always carried.
import type {TraceContext} from './sdk.js';
import {childOf, traceFields} from './trace.js';

/** The diagnostic contract's registered span names (profile 1.3). Names never hold IDs or content. */
export type SpanName =
  | 'bunny.command.request' | 'bunny.command.queue' | 'bunny.command.execute' | 'bunny.outcome.publish' | 'bunny.device.call'
  | 'bunny.lifecycle.observe' | 'bunny.feed.read' | 'bunny.process.start' | 'bunny.helper.run';
export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
/** Registered scalar attributes, fixed when the span starts. */
export type SpanAttributes = Readonly<Record<string, string | number | boolean>>;
export type SpanOptions = {
  /** The context the span continues. A malformed one is ignored, and the span starts a new trace. */
  readonly parent?: TraceContext | undefined;
  /** Contexts the span links to without continuing them, such as the original context of replayed work. At most 8. */
  readonly links?: readonly TraceContext[];
  readonly kind?: SpanKind;
  readonly attributes?: SpanAttributes;
};
/** `error` marks a failed execution; a typed refusal is not one. */
export type SpanStatus = 'unset' | 'error';

export interface Span {
  /** The span's own context: pass it as the `parent` of messages the work sends and as the `trace` of its records. */
  readonly context: TraceContext;
  /** Ends the span once; later calls do nothing. */
  end(status?: SpanStatus): void;
}

export interface SpanRecorder {
  start(name: SpanName, options?: SpanOptions): Span;
}

/** Records nothing: each span is only `childOf(parent)`, the context a message gets without a recorder. */
export const noSpans: SpanRecorder = {start: (_name, options = {}) => ({context: childOf(options.parent), end: () => {}})};

/**
 * Starts a span that never throws into domain work: a recorder that throws, or answers with a malformed context, gives
 * way to `noSpans`, and an `end` that throws is ignored.
 */
export function startSpan(recorder: SpanRecorder, name: SpanName, options: SpanOptions = {}): Span {
  let span: Span;
  let context: TraceContext;
  try {
    span = recorder.start(name, options);
    context = {traceparent: span.context.traceparent};
    if (traceFields(context) === undefined) return noSpans.start(name, options);
  } catch {
    return noSpans.start(name, options);
  }
  let ended = false;
  return {
    context,
    end: status => {
      if (ended) return;
      ended = true;
      try {
        span.end(status);
      } catch {
        // A recorder that fails to end a span loses it; the work goes on.
      }
    },
  };
}
