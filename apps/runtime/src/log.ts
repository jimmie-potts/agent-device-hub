// The runtime's log records: diagnostic-contract records (ADR 0012, Observability), one JSON object per line, carrying
// the trace and span IDs of the work being handled. A failing sink never changes what the runtime does.
import {randomUUID} from 'node:crypto';
import {SdkError, traceFields, type Clock, type LogFields, type Logger, type TraceContext} from '@jimmie-potts/sdk';
import {LEVELS, record, runtimeResource, type LogLevel, type LogRecord, type Resource} from './record.js';

export type {Environment, LogLevel, LogRecord, Resource} from './record.js';

export type LogSink = (record: LogRecord) => void;
/** A logger that can also report the runtime's own fatal failures. */
export type RuntimeLogger = Logger & {fatal(event: string, fields?: LogFields, trace?: TraceContext): void};
/** Records a writer passed to its sink, records the contract refused, and records its sink threw on. */
export type LogCounts = {written: number; dropped: number; failed: number};

/** This process's neutral `service.instance.id`. Every writer in the process and the watchdog's thread share it. */
export const INSTANCE_ID = randomUUID();

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

let stderrGuarded = false;
/**
 * Writes each record as one JSON line on stderr, where the service manager's journal keeps it. A stderr that closes, as
 * when its reader goes away, reports EPIPE as a stream error; that error is dropped, so it never ends the runtime.
 */
export const stderrSink: LogSink = entry => {
  if (!stderrGuarded) {
    stderrGuarded = true;
    process.stderr.on('error', () => {});
  }
  process.stderr.write(`${JSON.stringify(entry)}\n`);
};

const saturating = (value: number): number => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

export class LogWriter {
  readonly #sink: LogSink;
  readonly #minimum: number;
  readonly #clock: Clock;
  readonly #resource: Resource;
  /** The secrets modules have read, which no record may carry (Hub #919). */
  readonly #secrets = new Set<string>();
  #written = 0;
  #dropped = 0;
  #failed = 0;

  /** `resource` defaults to this process's instance in the `development` environment. */
  constructor(sink: LogSink, minimum: LogLevel, clock: Clock, resource: Resource = runtimeResource('development', INSTANCE_ID)) {
    this.#sink = sink;
    this.#minimum = LEVELS.indexOf(minimum);
    this.#clock = clock;
    this.#resource = resource;
  }

  /** The resource every record of this writer carries. */
  get resource(): Resource {
    return this.#resource;
  }

  counts(): LogCounts {
    return {written: this.#written, dropped: this.#dropped, failed: this.#failed};
  }

  /**
   * Keeps every later record that would carry `secret` in an attribute out of the log: such a record is dropped whole
   * and counted, as one the contract refuses. The runtime calls it with each secret a module reads.
   */
  redact(secret: string): void {
    if (secret !== '') this.#secrets.add(secret);
  }

  #carriesSecret(attributes: LogFields): boolean {
    if (this.#secrets.size === 0) return false;
    return Object.values(attributes).some(value => typeof value === 'string' && [...this.#secrets].some(secret => value.includes(secret)));
  }

  /** A logger for one scope. `base` attributes are added to every record and win over the caller's fields. */
  logger(scope: string, base: LogFields = {}): RuntimeLogger {
    const at = (level: LogLevel) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => {
      if (LEVELS.indexOf(level) < this.#minimum) return;
      let entry: LogRecord | undefined;
      try {
        const attributes = {...fields, ...base};
        entry = this.#carriesSecret(attributes) ? undefined
          : record(level, scope, event, attributes, this.#clock.now(), this.#resource, trace === undefined ? undefined : traceFields(trace));
      } catch {
        entry = undefined;
      }
      if (entry === undefined) {
        this.#dropped = saturating(this.#dropped);
        return;
      }
      try {
        this.#sink(entry);
        this.#written = saturating(this.#written);
      } catch {
        // Telemetry is never acknowledged: a sink that fails loses the record, and the work goes on.
        this.#failed = saturating(this.#failed);
      }
    };
    return {debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), fatal: at('fatal')};
  }
}
