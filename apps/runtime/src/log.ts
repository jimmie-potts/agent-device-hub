// The runtime's log records: diagnostic-contract records (ADR 0012, Observability), one JSON object per line, carrying
// the trace and span IDs of the work being handled. A failing sink never changes what the runtime does.
import {randomUUID} from 'node:crypto';
import {
  MAX_EXCEPTION_MESSAGE, MAX_EXCEPTION_STACKTRACE, REDACTED, SdkError, exceptionFields, filterExceptionText, traceFields, type Clock, type LogFields, type Logger, type TraceContext,
} from '@jimmie-potts/sdk';
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
 * The error's type and, when it has one, its code, for a record's attributes. A record of a decision carries only these;
 * the runtime's fault records add the filtered exception text through `faultFields`.
 */
export function errorFields(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return {'error.type': typeof error};
  const code: unknown = error instanceof SdkError ? error.body.error.code : 'code' in error ? error.code : undefined;
  return {
    'error.type': IDENTIFIER.test(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && IDENTIFIER.test(code) ? {'error.code': code} : {}),
  };
}

/**
 * A fault record's attributes (profile 1.7, Hub #777): the error's type and code, and its message and stack as the SDK's
 * `exceptionFields` filters and bounds them, with each secret `redactions` holds replaced before any rule runs. A record
 * of a refusal or a decision carries `errorFields` only; this is for an exception the runtime could not contain or a
 * module's own failure, whose text is what a reader needs to diagnose it. The text stays on the private diagnostic path:
 * the journal and the export; never an error body, health or history.
 */
export function faultFields(error: unknown, redactions?: Redactions): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {...errorFields(error), ...exceptionFields(error, redactions === undefined ? {} : {filter: text => redactions.scrub(text)})};
  if (redactions === undefined) return fields;
  // A text that still holds a secret, in a shape the filter missed, is left out whole; the counts go with the texts, so
  // the record keeps its type and code and still validates (a text needs its counts, and the counts a text).
  const kept = redactions.without(fields);
  if (kept['exception.message'] === undefined && kept['exception.stacktrace'] === undefined) {
    delete kept['bunny.exception.redacted_count'];
    delete kept['bunny.exception.truncated'];
  }
  return kept;
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

/**
 * The secrets the process's modules have read, which no record may carry (Hub #919). The process shares one registry
 * among all its writers, so that the record of a failure the runtime cannot contain is checked too. A secret file holds
 * one token, used whole, so a record carries a secret when an attribute's text contains that token: a string, or the
 * digits of a number.
 */
export class Redactions {
  readonly #secrets = new Set<string>();

  add(secret: string): void {
    if (secret !== '') this.#secrets.add(secret);
  }

  /** Whether `value` holds one of the secrets. */
  holds(value: string | number | boolean): boolean {
    if (this.#secrets.size === 0 || typeof value === 'boolean') return false;
    const text = String(value);
    return [...this.#secrets].some(secret => text.includes(secret));
  }

  /**
   * Whether `bytes` hold one of the secrets, as its UTF-8 bytes anywhere in them, such as in an image's metadata, which
   * no text check of a decoding would find.
   */
  holdsBytes(bytes: Uint8Array): boolean {
    if (this.#secrets.size === 0) return false;
    const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [...this.#secrets].some(secret => view.includes(Buffer.from(secret, 'utf8')));
  }

  /** `text` with each secret it holds replaced by the SDK's `[redacted]` marker, longest first, and how many it replaced. */
  scrub(text: string): {text: string; replaced: number} {
    let out = text;
    let replaced = 0;
    for (const secret of [...this.#secrets].sort((a, b) => b.length - a.length)) {
      if (!out.includes(secret)) continue;
      const parts = out.split(secret);
      replaced += parts.length - 1;
      out = parts.join(REDACTED);
    }
    return {text: out, replaced};
  }

  /** Whether any of `attributes` holds a secret. */
  carried(attributes: LogFields): boolean {
    return Object.values(attributes).some(value => this.holds(value));
  }

  /** `attributes` without those that hold a secret. */
  without<T extends string | number | boolean>(attributes: Readonly<Record<string, T>>): Record<string, T> {
    return Object.fromEntries(Object.entries(attributes).filter(([, value]) => !this.holds(value)));
  }
}

export class LogWriter {
  readonly #sink: LogSink;
  readonly #minimum: number;
  readonly #clock: Clock;
  readonly #resource: Resource;
  readonly #redactions: Redactions;
  #written = 0;
  #dropped = 0;
  #failed = 0;

  /**
   * `resource` defaults to this process's instance in the `development` environment, and `redactions` to a registry of
   * this writer's own.
   */
  constructor(
    sink: LogSink, minimum: LogLevel, clock: Clock, resource: Resource = runtimeResource('development', INSTANCE_ID), redactions = new Redactions(),
  ) {
    this.#redactions = redactions;
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
    this.#redactions.add(secret);
  }

  /** The registry this writer checks, which the module host also applies to its modules' span attributes. */
  get redactions(): Redactions {
    return this.#redactions;
  }

  /**
   * A module's own exception text, `exception.message` and `exception.stacktrace` written directly into a record's fields,
   * through the same filters and bounds as `exceptionFields`, with each secret this writer knows replaced (Hub #777):
   * the module path and the runtime's meet the same rules. The counts follow the texts.
   */
  #filteredException(attributes: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const texts = [['exception.message', MAX_EXCEPTION_MESSAGE], ['exception.stacktrace', MAX_EXCEPTION_STACKTRACE]] as const;
    if (!texts.some(([name]) => Object.hasOwn(attributes, name))) return attributes;
    const out = {...attributes};
    let replaced = typeof out['bunny.exception.redacted_count'] === 'number' ? out['bunny.exception.redacted_count'] : 0;
    let truncated = out['bunny.exception.truncated'] === true;
    for (const [name, limit] of texts) {
      const value = out[name];
      if (value === undefined) continue;
      if (typeof value !== 'string') { delete out[name]; continue; }
      // The message as the record carries it, before this pass, since the filtered one no longer matches the stack's header.
      const message = attributes['exception.message'];
      const clean = filterExceptionText(value, limit, {
        filter: text => this.#redactions.scrub(text), ...(name === 'exception.stacktrace' ? {stackOf: typeof message === 'string' ? message : ''} : {}),
      });
      replaced = Math.min(Number.MAX_SAFE_INTEGER, replaced + clean.replaced);
      truncated ||= clean.truncated;
      if (clean.text === '') delete out[name]; else out[name] = clean.text;
    }
    if (out['exception.message'] === undefined && out['exception.stacktrace'] === undefined) {
      delete out['bunny.exception.redacted_count'];
      delete out['bunny.exception.truncated'];
      return out;
    }
    return {...out, 'bunny.exception.redacted_count': replaced, 'bunny.exception.truncated': truncated};
  }

  /** A logger for one scope. `base` attributes are added to every record and win over the caller's fields. */
  logger(scope: string, base: LogFields = {}): RuntimeLogger {
    const at = (level: LogLevel) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => {
      if (LEVELS.indexOf(level) < this.#minimum) return;
      let entry: LogRecord | undefined;
      try {
        const attributes = this.#filteredException({...fields, ...base});
        const ids = trace === undefined ? undefined : traceFields(trace);
        entry = this.#redactions.carried(attributes) ? undefined : record(level, scope, event, attributes, this.#clock.now(), this.#resource, ids);
        // A record the contract refuses with its exception text, as one too large once serialized, is written without it
        // (profile 1.7): the fault's type, code and correlation are worth more than nothing.
        if (entry === undefined && (Object.hasOwn(attributes, 'exception.message') || Object.hasOwn(attributes, 'exception.stacktrace'))) {
          const {
            ['exception.message']: _message, ['exception.stacktrace']: _stack, ['bunny.exception.redacted_count']: _count, ['bunny.exception.truncated']: _cut, ...rest
          } = attributes;
          entry = this.#redactions.carried(rest) ? undefined : record(level, scope, event, rest, this.#clock.now(), this.#resource, ids);
        }
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
