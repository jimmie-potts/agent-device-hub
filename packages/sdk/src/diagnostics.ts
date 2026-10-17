// What an SDK boundary decided (ADR 0012, "Observability"): the bus, a remote edge and a remote client each report every
// decision they make once, through one optional callback that the runtime connects to its sink. A diagnostic is a
// closed record of values the SDK has already checked. It never holds a payload, an error object, an exception's
// message or a credential.
import type {ErrorCode} from '@jimmie-potts/event-contracts/v2';
import type {ErrorScope} from './in-process.js';
import type {LogFields, Logger} from './module.js';
import {SdkError, type TraceContext} from './sdk.js';

/** ADR 0012's levels. The boundary that decides sets it; it never changes a result. */
export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * The decisions the SDK reports:
 * - `command.admitted`: the bus put a command in its owner's queue.
 * - `command.refused`: the bus refused a command that never reached a handler: no responder owns its key, its owner's
 *   queue is full, it expired while it waited or reached the handler past its expiry, its responder closed, or the edge
 *   could not deliver it.
 * - `command.cancelled`: its requester closed or stopped waiting before a handler started it.
 * - `command.replied`: its owner replied, accepted or with a typed refusal.
 * - `command.uncertain`: a handler had it, and the request ended `uncertain-result`.
 * - `sync.served`, `sync.refused`: the bus's answer to a sync request. `sync.restarted`: an overflow restarted a copy.
 * - `edge.connected`, `edge.disconnected`, `edge.refused`, `edge.failed`: a remote edge's own decisions. A repeated
 *   refusal is recorded once, then summarized with its count at most once a minute.
 * - `remote.disconnected`, `remote.reconnected`: a remote client's stream.
 * - `remote.refused`: the edge refused a remote client's reconnect with `unauthenticated` or `forbidden`, as when its
 *   credential was revoked or its browser session ended. The client reports it once per code until it reconnects.
 * - `remote.command.uncertain`: a remote client settled a request `uncertain-result` itself, because the edge failed,
 *   could not be heard by the deadline and its grace, or the requester closed first. A request the edge answers is
 *   recorded where it was decided, at the edge or its bus.
 */
export type DiagnosticEvent =
  | 'command.admitted' | 'command.refused' | 'command.cancelled' | 'command.replied' | 'command.uncertain'
  | 'sync.served' | 'sync.refused' | 'sync.restarted'
  | 'edge.connected' | 'edge.disconnected' | 'edge.refused' | 'edge.failed'
  | 'remote.disconnected' | 'remote.reconnected' | 'remote.refused' | 'remote.command.uncertain';

/** How the work stood after the decision, in the diagnostic contract's `bunny.outcome` terms. */
export type DiagnosticOutcome = 'queued' | 'accepted' | 'rejected' | 'cancelled' | 'uncertain' | 'succeeded';

/** An edge route: one of its calls, `stream`, or `other` for any path the edge does not serve. */
export type EdgeRoute = 'stream' | 'publish' | 'subscribe' | 'request' | 'respond' | 'reply' | 'sync' | 'serve' | 'answer' | 'close' | 'other';

export type Diagnostic = {
  readonly event: DiagnosticEvent;
  readonly level: DiagnosticLevel;
  /** The participant whose call, request or copy it was. Absent before an edge authenticated the call. */
  readonly source?: string;
  /** A command's routing key. */
  readonly key?: string;
  /** `sync <families>`, joined by commas, for a sync decision. */
  readonly pattern?: string;
  readonly requestId?: string;
  /** The command's or sync request's message `id`. */
  readonly messageId?: string;
  readonly outcome?: DiagnosticOutcome;
  /** The 2.0 registry code of a refusal, a cancellation or an uncertain result. */
  readonly code?: ErrorCode;
  readonly route?: EdgeRoute;
  /** An exception's type as an identifier, never its message. */
  readonly errorType?: string;
  /**
   * How many attempts failed, as a remote client counts its reconnects, or, on an edge's summary of a repeated refusal,
   * how many times it refused again since its last record of that refusal.
   */
  readonly attempts?: number;
  /** The trace context of the work the decision is about. Absent when the edge has not validated the input. */
  readonly trace?: TraceContext;
};

/**
 * ADR 0012's level for each registry code: the one table every boundary uses for a refusal, a cancellation, an owner's
 * typed refusal or an uncertain result. INFO for validation and domain refusals and an expected cancellation; WARN for
 * refusals a correct caller should never receive, lost capacity, queued expiry and uncertain outcomes; ERROR for an
 * internal fault. A record type keeps it whole: a code added to the registry fails to compile until it has a level.
 */
const LEVELS: Readonly<Record<ErrorCode, DiagnosticLevel>> = {
  'invalid-request': 'info',
  'invalid-message': 'info',
  'too-large': 'warn',
  'unsupported-version': 'info',
  'unknown-schema': 'info',
  'unsupported-capability': 'info',
  unauthenticated: 'warn',
  forbidden: 'warn',
  'not-found': 'info',
  'invalid-state': 'info',
  'revision-conflict': 'info',
  'duplicate-conflict': 'warn',
  expired: 'warn',
  cancelled: 'info',
  capacity: 'warn',
  unavailable: 'warn',
  'uncertain-result': 'warn',
  internal: 'error',
};

/**
 * The level of each record that has no registry code (ADR 0012 amendment of 2026-10-17, Hub #1143). This table and
 * `LEVELS` own every level: a call site names its code or event, never a level. An event added here fails to compile
 * until it has a level, and an event missing here cannot be recorded through `recordLog`.
 */
const EVENT_LEVELS = {
  // SDK boundary decisions with a fixed level.
  'command.admitted': 'info',
  'command.replied': 'info',
  'sync.served': 'info',
  'sync.restarted': 'debug',
  'remote.disconnected': 'warn',
  'remote.reconnected': 'info',
  'remote.command.uncertain': 'warn',
  'edge.connected': 'info',
  'edge.failed': 'error',
  // Module and runtime records without a code: accepted work, success and recovery are INFO; failed outcomes, lost
  // capacity and a stop that did not finish are WARN; a module or runtime fault is ERROR.
  'assistant.call.settled': 'info',
  'assistant.run.settled': 'info',
  'assistant.run.started': 'info',
  'command.completed': 'info',
  'command.executing': 'info',
  'command.queued': 'info',
  'command.rejected': 'info',
  'feed.changed': 'info',
  'message.received': 'info',
  'operation.completed': 'info',
  'operation.failed': 'warn',
  'outbox.deferred': 'warn',
  'outbox.republished': 'info',
  'runtime.delivery.dropped': 'warn',
  'runtime.edge.reloaded': 'info',
  'runtime.edge.serving': 'info',
  'runtime.handler.failed': 'error',
  'runtime.module.error-after-stop': 'warn',
  'runtime.module.failed': 'error',
  'runtime.module.refused': 'error',
  'runtime.module.started': 'info',
  'runtime.module.stop-failed': 'warn',
  'runtime.module.stop-timed-out': 'warn',
  'runtime.module.stopped': 'info',
  'runtime.ready': 'info',
  'runtime.started': 'info',
  'runtime.stopped': 'info',
  'runtime.tracing.failed': 'error',
  'runtime.watchdog.failed': 'error',
  'runtime.watchdog.stopped': 'error',
} as const satisfies Record<string, DiagnosticLevel>;

/** An event whose level the table owns when its record carries no registry code. */
export type LogEvent = keyof typeof EVENT_LEVELS;

/**
 * What a record is named by for its level: a registry code or a table event. `LEVELS` and `EVENT_LEVELS` together are
 * the DiagnosticCode table that ADR 0012's 2026-10-17 amendment makes the owner of levels.
 */
export type DiagnosticCode = ErrorCode | LogEvent;

const isErrorCode = (value: unknown): value is ErrorCode => typeof value === 'string' && Object.hasOwn(LEVELS, value);

/** The level of a decision that ends with registry `code`, or of a record of `event` that carries no code. */
export const levelOf = (code: DiagnosticCode): DiagnosticLevel => isErrorCode(code) ? LEVELS[code] : EVENT_LEVELS[code];

/**
 * Record one log entry at the level the table gives it (see `recordLevel`). Module and runtime code logs INFO, WARN and ERROR records only through this.
 */
export function recordLog(log: Logger, event: LogEvent, fields: LogFields = {}, trace?: TraceContext): void {
  log[recordLevel(event, fields)](event, fields, trace);
}

/**
 * A record's level. A fault event (ERROR in the table) stays ERROR whatever its code, because a module or runtime fault
 * is ERROR, and a success or recovery takes its event's level. Otherwise a registry `bunny.code` decides, raised to WARN for a failed or uncertain `bunny.outcome`, since
 * ADR 0012 logs failed and uncertain outcomes at WARN. A record without a code takes its event's level.
 */
export function recordLevel(event: LogEvent, fields: LogFields = {}): DiagnosticLevel {
  const byEvent = EVENT_LEVELS[event], code = fields['bunny.code'], outcome = fields['bunny.outcome'];
  if (byEvent === 'error' || outcome === 'succeeded' || !isErrorCode(code)) return byEvent;
  const byCode = LEVELS[code];
  return (outcome === 'failed' || outcome === 'uncertain') && (byCode === 'debug' || byCode === 'info') ? 'warn' : byCode;
}

/** Receives each diagnostic. It should return promptly; a throw is ignored. */
export type OnDiagnostic = (diagnostic: Diagnostic) => void;

/** A callback that never throws into the boundary: a failing one loses its record, and nothing reports that failure. */
export function reporter(onDiagnostic: OnDiagnostic | undefined): OnDiagnostic {
  if (onDiagnostic === undefined) return () => {};
  return diagnostic => {
    try {
      onDiagnostic(diagnostic);
    } catch {
      // Telemetry is never acknowledged: the record is lost, and the decision stands.
    }
  };
}

const IDENTIFIER = /^[A-Za-z0-9_.$-]{1,64}$/;

/** An exception's type as an identifier, as a record may carry it: its name, `Error`, or the type of a non-Error value. */
export function errorType(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  return IDENTIFIER.test(error.name) ? error.name : 'Error';
}

/**
 * The default `onError`: a `BunnySdkWarning` that names the source, the pattern and the error's type, with an
 * `SdkError`'s code. It never quotes the error's message, which may hold anything, such as a credential a library
 * quoted; the error stays the warning's `cause`, in memory.
 */
export function warnSafely(error: unknown, scope: ErrorScope): void {
  const kind = error instanceof SdkError ? `${errorType(error)} ${error.body.error.code}` : errorType(error);
  const warning = new Error(`${scope.source} on ${scope.pattern}: ${kind}`, {cause: error});
  warning.name = 'BunnySdkWarning';
  process.emitWarning(warning);
}
