// One log record, as both threads build it: the watchdog's thread loads only this file, never the SDK.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LogRecord = {
  timestamp: string;
  severity_text: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  severity_number: 5 | 9 | 13 | 17 | 21;
  event_name: string;
  resource: {'service.namespace': 'bunny'; 'service.name': 'runtime'};
  /** `bunny.runtime` for the runtime's own records, `bunny.modules.<name>` for a module's. */
  scope: {name: string};
  attributes: Record<string, string | number | boolean>;
  trace_id?: string;
  span_id?: string;
  trace_flags?: string;
};

const SEVERITY = {
  debug: ['DEBUG', 5], info: ['INFO', 9], warn: ['WARN', 13], error: ['ERROR', 17], fatal: ['FATAL', 21],
} as const satisfies Record<LogLevel, readonly [LogRecord['severity_text'], LogRecord['severity_number']]>;
export const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];

export type TraceIds = {traceId: string; spanId: string; flags: string};

export function record(level: LogLevel, scope: string, event: string, attributes: LogRecord['attributes'], timeMs: number, ids?: TraceIds): LogRecord {
  const [text, number] = SEVERITY[level];
  return {
    timestamp: new Date(timeMs).toISOString(), severity_text: text, severity_number: number, event_name: event,
    resource: {'service.namespace': 'bunny', 'service.name': 'runtime'}, scope: {name: scope}, attributes,
    ...(ids === undefined ? {} : {trace_id: ids.traceId, span_id: ids.spanId, trace_flags: ids.flags}),
  };
}

