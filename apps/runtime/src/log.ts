// The runtime's log records: one JSON object per line, with OpenTelemetry field names, carrying the trace and span IDs of
// the work being handled (ADR 0012, Observability). A failing sink never changes what the runtime does.
import {traceFields, type Clock, type LogFields, type Logger, type TraceContext} from '@jimmie-potts/sdk';
import {LEVELS, record, type LogLevel, type LogRecord} from './record.js';

export type {LogLevel, LogRecord} from './record.js';

export type LogSink = (record: LogRecord) => void;
/** A logger that can also report the runtime's own fatal failures. */
export type RuntimeLogger = Logger & {fatal(event: string, fields?: LogFields, trace?: TraceContext): void};

const MAX_MESSAGE = 512;

/** The error's type and message, cut short, for a record's attributes. Never a stack, and never a non-Error's value. */
export function errorFields(error: unknown): Record<string, string> {
  if (error instanceof Error) return {'error.type': error.name, 'error.message': error.message.slice(0, MAX_MESSAGE)};
  return {'error.type': typeof error};
}

/** Writes each record as one JSON line on stderr, where the service manager's journal keeps it. */
export const stderrSink: LogSink = entry => { process.stderr.write(`${JSON.stringify(entry)}\n`); };

export class LogWriter {
  readonly #sink: LogSink;
  readonly #minimum: number;
  readonly #clock: Clock;

  constructor(sink: LogSink, minimum: LogLevel, clock: Clock) {
    this.#sink = sink;
    this.#minimum = LEVELS.indexOf(minimum);
    this.#clock = clock;
  }

  /** A logger for one scope. `base` attributes are added to every record and win over the caller's fields. */
  logger(scope: string, base: LogFields = {}): RuntimeLogger {
    const at = (level: LogLevel) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => {
      if (LEVELS.indexOf(level) < this.#minimum) return;
      try {
        this.#sink(record(level, scope, event, {...fields, ...base}, this.#clock.now(), trace === undefined ? undefined : traceFields(trace)));
      } catch {
        // Telemetry is never acknowledged: a sink that fails loses the record, and the work goes on.
      }
    };
    return {debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), fatal: at('fatal')};
  }
}
