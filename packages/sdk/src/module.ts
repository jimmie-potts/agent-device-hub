// The module API (ADR 0012, "Runtime and transport"): what a module declares, and what the runtime gives it. A module
// imports only the SDK and the contracts packages, so these types live here; `apps/runtime` implements them.
import type {DatabaseSync} from 'node:sqlite';
import type {Worker, WorkerOptions} from 'node:worker_threads';
import type {Cancel, Clock, Sdk, TraceContext} from './sdk.js';

/**
 * The module API version this SDK describes, `<major>.<minor>`. The runtime refuses a module that declares another
 * major version or a newer minor one. A module states the version it was written for as a literal, not this constant,
 * so that a later major version refuses it until it is updated.
 */
export const MODULE_API_VERSION = '1.0';

export type ModuleManifest = {
  /**
   * Lowercase letters and digits with single hyphens, at most 64 characters. It names the module's source
   * (`bunny/modules/<name>`), its SQLite file and its log records.
   */
  readonly name: string;
  /** The module API version the module was written for, such as `1.0`. */
  readonly apiVersion: string;
};

/** One module in the runtime's fixed, shipped list. */
export interface BunnyModule {
  readonly manifest: ModuleManifest;
  /**
   * Starts the module: subscribe, respond and open devices here. A throw, a rejection or a start that outlasts the
   * runtime's start deadline fails the module.
   */
  start(context: ModuleContext): void | Promise<void>;
  /**
   * Releases what the module holds. The runtime calls it once for every module whose start it called, even when start
   * failed or has not finished. It runs after the module's participant has closed, which waits for the module's running
   * handlers up to the stop deadline; a handler that outlasts that deadline may still be running.
   */
  stop(): void | Promise<void>;
}

/** Scalar attributes for one log record. */
export type LogFields = Readonly<Record<string, string | number | boolean>>;

/**
 * Writes the module's log records. `event` names what happened, such as `scene.applied`. `trace` is the message or span
 * being handled; the record then carries its trace and span IDs. Never put a secret in a field or an error message.
 */
export interface Logger {
  debug(event: string, fields?: LogFields, trace?: TraceContext): void;
  info(event: string, fields?: LogFields, trace?: TraceContext): void;
  warn(event: string, fields?: LogFields, trace?: TraceContext): void;
  error(event: string, fields?: LogFields, trace?: TraceContext): void;
}

export interface Tracing {
  /**
   * A new span for work the module received: in the parent's trace when one is given and valid, otherwise in a new
   * trace. Pass it as the `parent` of messages the work sends and as the `trace` of its log records.
   */
  span(parent?: TraceContext): TraceContext;
}

/** The module's timers. They are cancelled when the module stops. */
export interface ModuleScheduler {
  /** Runs `callback` once after `delayMs`. A callback that throws or rejects fails the module. */
  after(delayMs: number, callback: () => void | Promise<void>): Cancel;
}

export interface Workers {
  /**
   * Starts a worker thread from a module file. The runtime terminates it when the module stops, and an error the worker
   * does not catch fails the module.
   */
  start(file: URL, options?: WorkerOptions): Worker;
}

/**
 * What the runtime gives a module's `start`. Once the module's stop begins, its participant, scheduler, workers and
 * database refuse use with `invalid-state`; its logger, tracing, clock and signal keep working, so `stop` can still log.
 */
export type ModuleContext = {
  /** The module's own participant on the runtime's bus, with source `bunny/modules/<name>`. */
  readonly sdk: Sdk;
  readonly log: Logger;
  readonly trace: Tracing;
  /** The runtime's clock, which the bus also uses for `time` and `expiresat`. */
  readonly clock: Clock;
  /** Timers on the runtime's scheduler, which also runs the module's request deadlines. */
  readonly scheduler: ModuleScheduler;
  readonly workers: Workers;
  /**
   * The module's own SQLite database, a file under the runtime's private state directory. It is opened on the first
   * call and closed when the module stops.
   */
  readonly database: () => DatabaseSync;
  /** Aborted when the module stops, so that device calls given this signal end. */
  readonly signal: AbortSignal;
};
