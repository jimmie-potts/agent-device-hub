// The runtime's log records: one JSON object per line, with OpenTelemetry field names (ADR 0012, Observability).
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
