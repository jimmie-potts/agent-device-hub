// The runtime's log records: one JSON object per line, with OpenTelemetry field names, carrying the trace and span IDs of
// the work being handled (ADR 0012, Observability). A failing sink never changes what the runtime does.
import {SdkError, traceFields, type Clock, type LogFields, type Logger, type TraceContext} from '@jimmie-potts/sdk';
import {LEVELS, record, type LogLevel, type LogRecord} from './record.js';

export type {LogLevel, LogRecord} from './record.js';

export type LogSink = (record: LogRecord) => void;
/** A logger that can also report the runtime's own fatal failures. */
export type RuntimeLogger = Logger & {fatal(event: string, fields?: LogFields, trace?: TraceContext): void};

// A type or code that is a plain identifier; anything else is not stringified into a record.
const IDENTIFIER = /^[A-Za-z0-9_.$-]{1,64}$/;

/**
 * The error's type and, when it has one, its code, for a record's attributes. The diagnostic contract keeps raw
 * exception messages and stacks out of records, because a library's message may quote a URL with a token in it.
 */
export function errorFields(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return {'error.type': typeof error};
  const code: unknown = error instanceof SdkError ? error.body.error.code : 'code' in error ? error.code : undefined;
  return {
    'error.type': IDENTIFIER.test(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && IDENTIFIER.test(code) ? {'error.code': code} : {}),
  };
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
