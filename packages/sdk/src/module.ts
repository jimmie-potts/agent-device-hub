// The module API (ADR 0012, "Runtime and transport"): what a module declares, and what the runtime gives it. A module
// imports only the SDK and the contracts packages, so these types live here; `apps/runtime` implements them.
import type {DatabaseSync} from 'node:sqlite';
import type {TransferListItem, Worker, WorkerOptions} from 'node:worker_threads';
import type {ErrorBody, ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {refusalOf} from './refusal.js';
import type {Cancel, Clock, Sdk, TraceContext} from './sdk.js';
import type {SpanRecorder} from './spans.js';

/**
 * The module API version this SDK describes, `<major>.<minor>`. The runtime refuses a module that declares another
 * major version or a newer minor one. A module states the version it was written for as a literal, not this constant,
 * so that a later major version refuses it until it is updated.
 */
export const MODULE_API_VERSION = '1.1';

const MODULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** A routing ID (ADR 0012): the last token of an entity's routing keys, so a device's command key is `bunny.cmd.<family>.<id>`. */
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ROUTING_ID = 128;
/** How many secret files one module's section may name. */
export const MAX_SECRETS = 16;
const MAX_PATH = 4096;

/** Why a manifest or a configuration is refused: a code from the 2.0 error registry and a fixed sentence. */
export type ManifestProblem = {code: ErrorCode; detail: string};

/** Why a module name is refused, or undefined when it is lowercase letters and digits with single hyphens, at most 64. */
export function checkModuleName(name: string): ManifestProblem | undefined {
  if (MODULE_NAME.test(name) && name.length <= 64) return undefined;
  return {code: 'invalid-request', detail: 'name must be lowercase letters and digits with single hyphens, at most 64 characters'};
}

/** Why a declared module API version is refused, or undefined when it matches: the same major, and no newer minor. */
export function checkApiVersion(declared: string, supported: string = MODULE_API_VERSION): ManifestProblem | undefined {
  const [, major, minor] = VERSION.exec(declared) ?? [];
  const [, supportedMajor, supportedMinor] = VERSION.exec(supported) ?? [];
  if (major === undefined || minor === undefined) return {code: 'invalid-request', detail: 'apiVersion must be <major>.<minor>'};
  if (major !== supportedMajor || Number(minor) > Number(supportedMinor)) {
    return {code: 'unsupported-version', detail: `module API ${declared} does not match this runtime's ${supported}`};
  }
  return undefined;
}

/** Why the runtime would refuse this manifest on its own, or undefined when it may start. */
export function checkManifest({name, apiVersion}: ModuleManifest): ManifestProblem | undefined {
  return checkModuleName(name) ?? checkApiVersion(apiVersion);
}

/** What a module's `configure` accepts: its configuration, and the devices it controls. */
export type Configured<Config> = {
  /** What the module's context gives it as `config`. */
  readonly config: Config;
  /**
   * The routing IDs of the devices the module controls, lowercase letters and digits with single hyphens, at most 128
   * characters. A device's command keys end in its ID, so the runtime refuses a module that names a device another
   * module already named.
   */
  readonly devices?: readonly string[];
};

export type ModuleManifest<Config = unknown> = {
  /**
   * Lowercase letters and digits with single hyphens, at most 64 characters. It names the module's source
   * (`bunny/modules/<name>`), its SQLite file, its private folder, its section of the runtime's configuration file and
   * its log records.
   */
  readonly name: string;
  /** The module API version the module was written for, such as `1.1`. */
  readonly apiVersion: string;
  /**
   * Checks the module's section of the runtime's configuration file, a JSON object, and returns the module's
   * configuration, or a refusal from `errorBody` whose code and detail health shows. It runs before `start`, once per
   * start of the runtime, and must be synchronous: it reads no file and reaches no device. A module that declares it
   * needs a section; without it, the module takes no configuration and its `config` is undefined. The section's
   * `secrets` member, which the runtime checks first, names the module's secret files; `configure` sees their names
   * and paths, never their contents.
   */
  readonly configure?: (section: unknown) => Configured<Config> | ErrorBody;
};

/** The outcome of `checkConfiguration`: what the module's context gets, or why the module is refused. */
export type ConfigurationCheck<Config = unknown> =
  | {
    readonly status: 'accepted';
    /** What `configure` returned, or undefined for a module without one. */
    readonly config: Config | undefined;
    readonly devices: readonly string[];
    /** The secret files the section names: each name and its absolute path. */
    readonly secrets: ReadonlyMap<string, string>;
  }
  /** `error` is what `configure` threw, if it threw; it stays in memory and never reaches a record or health. */
  | {readonly status: 'refused'; readonly problem: ManifestProblem; readonly error?: unknown};

const refused = (code: ErrorCode, detail: string, error?: unknown): ConfigurationCheck<never> =>
  ({status: 'refused', problem: {code, detail}, ...(error === undefined ? {} : {error})});
const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && value.length <= MAX_PATH && !value.includes('\0');

/** The section's `secrets` member as names and paths, or undefined when it is malformed. */
function secretsOf(section: Readonly<Record<string, unknown>>): Map<string, string> | undefined {
  if (!Object.hasOwn(section, 'secrets')) return new Map();
  const listed = section.secrets;
  if (!isObject(listed)) return undefined;
  const entries = Object.entries(listed);
  if (entries.length > MAX_SECRETS) return undefined;
  const secrets = new Map<string, string>();
  for (const [name, path] of entries) {
    if (checkModuleName(name) !== undefined || !isPath(path)) return undefined;
    secrets.set(name, path);
  }
  return secrets;
}

/**
 * Checks a module's section of the runtime's configuration file as the runtime does before it starts the module: a
 * module with `configure` needs a section, a section is a JSON object, its `secrets` member maps at most `MAX_SECRETS`
 * names, each lowercase letters and digits with single hyphens, to absolute paths, and `configure` accepts it, naming
 * only valid, distinct device IDs. `section` is undefined when the file has none for the module. The runtime and the
 * module test kit both use it; the runtime then checks the secret files themselves and that no other module names the
 * same device.
 */
export function checkConfiguration<Config>(manifest: ModuleManifest<Config>, section: unknown): ConfigurationCheck<Config> {
  const {configure} = manifest;
  if (section === undefined) {
    if (configure !== undefined) return refused('not-found', 'the configuration has no section for this module');
    return {status: 'accepted', config: undefined, devices: [], secrets: new Map()};
  }
  if (!isObject(section)) return refused('invalid-request', 'the module\'s section of the configuration must be a JSON object');
  const secrets = secretsOf(section);
  if (secrets === undefined) {
    return refused('invalid-request', `the section's secrets must map at most ${MAX_SECRETS} names to absolute file paths`);
  }
  if (configure === undefined) return {status: 'accepted', config: undefined, devices: [], secrets};
  let answer: unknown;
  try {
    answer = configure(section);
  } catch (error) {
    return refused('internal', 'the module\'s configure failed', error);
  }
  const refusal = refusalOf(answer);
  if (refusal !== undefined) return refused(refusal.error.code, refusal.error.detail ?? 'the module refused its configuration');
  if (!isObject(answer) || !Object.hasOwn(answer, 'config')) {
    return refused('internal', 'the module\'s configure returned neither a configuration nor a refusal');
  }
  const configured = answer as Configured<Config>;
  const devices: unknown = configured.devices ?? [];
  const valid = (id: unknown): id is string => typeof id === 'string' && id.length <= MAX_ROUTING_ID && ROUTING_ID.test(id);
  if (!Array.isArray(devices) || !devices.every(valid) || new Set(devices).size !== devices.length) {
    return refused('invalid-request', 'the module\'s devices must be distinct routing IDs: lowercase letters and digits with single hyphens, at most 128 characters');
  }
  return {status: 'accepted', config: configured.config, devices: [...devices], secrets};
}

/** One module in the runtime's fixed, shipped list. `Config` is what its manifest's `configure` returns. */
export interface BunnyModule<Config = unknown> {
  readonly manifest: ModuleManifest<Config>;
  /**
   * Starts the module: subscribe, respond and open local resources here, such as its database, its files and its
   * secrets. Under policy A (ADR 0012, "Failure isolation"), start never waits on a device: the module reaches its
   * devices later and reports one that does not answer as `unavailable`. A throw, a rejection or a start that outlasts
   * the runtime's start deadline fails the module.
   */
  start(context: ModuleContext<Config>): void | Promise<void>;
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
 * Writes the module's log records as diagnostic-contract records under the `bunny.module` scope. `event` names what
 * happened and must be an event the contract's catalog registers for modules, such as `command.completed`; `fields` must
 * be registered attributes. The runtime drops a record with another event or an invalid value, and leaves out fields the
 * catalog does not register; the module test kit fails a module that logs either. `trace` is the message or span being
 * handled; the record then carries its trace and span IDs. Never put a secret, message or personal content in a field:
 * the runtime drops a record that holds a secret the module read.
 */
export interface Logger {
  debug(event: string, fields?: LogFields, trace?: TraceContext): void;
  info(event: string, fields?: LogFields, trace?: TraceContext): void;
  warn(event: string, fields?: LogFields, trace?: TraceContext): void;
  error(event: string, fields?: LogFields, trace?: TraceContext): void;
}

/**
 * A module's tracing. `start` records a span with a start, an end and a status, such as `bunny.device.call` around a
 * call to the module's device, under the `bunny.module` scope with the module's name (Hub #949). A span's context never
 * goes to a device or vendor.
 */
export interface Tracing extends SpanRecorder {
  /**
   * A new span for work the module received: in the parent's trace when one is given and valid, otherwise in a new
   * trace. Pass it as the `parent` of messages the work sends and as the `trace` of its log records. It is not recorded;
   * use `start` for work with a duration.
   */
  span(parent?: TraceContext): TraceContext;
}

/** The module's timers. They are cancelled when the module stops. */
export interface ModuleScheduler {
  /** Runs `callback` once after `delayMs`. A callback that throws or rejects fails the module. */
  after(delayMs: number, callback: () => void | Promise<void>): Cancel;
}

/** How many worker calls one module may have running at once. */
export const MAX_WORKER_CALLS = 4;

export type WorkerCallOptions = {
  /** How long the call may take, an integer from 1 to `MAX_TIMEOUT_MS`, on the runtime's scheduler. */
  timeoutMs: number;
  /** Ends the call early, as when newer work replaces it. */
  signal?: AbortSignal;
  /** Moved to the worker with the request rather than copied, such as an `ArrayBuffer`. */
  transferList?: readonly TransferListItem[];
};

export interface Workers {
  /**
   * Starts a worker thread from a module file. The runtime terminates it when the module stops, and an error the worker
   * does not catch fails the module. A worker given its own `env` keeps the process's `NODE_OPTIONS`.
   */
  start(file: URL, options?: WorkerOptions): Worker;
  /**
   * Runs one bounded request in a new worker thread from a module file, such as rendering a frame: the worker gets
   * `request` as its `workerData` and answers with one `parentPort.postMessage(reply)`, and the call resolves with that
   * reply. The worker is then terminated, as it is when the call ends any other way: the call rejects with an
   * `SdkError` carrying `uncertain-result` when the deadline passes, since the worker had the request; `cancelled` when
   * the module stops or `signal` aborts; `internal` when the worker throws, or ends without a reply; `capacity` when the
   * module already has `MAX_WORKER_CALLS` calls running; `invalid-request` for a malformed deadline; and `invalid-state`
   * once the module's stop has begun. A failed call never fails the module: the module turns it into an outcome.
   */
  call<Reply = unknown>(file: URL, request: unknown, options: WorkerCallOptions): Promise<Reply>;
}

/** The module's secret files, which its section of the runtime's configuration names. */
export interface Secrets {
  /**
   * Reads the secret file that the module's section names `name`, anew on each call, and resolves with its UTF-8 text
   * without trailing line breaks. The file must be private, as the configuration file is: a regular file with one link
   * and mode 600, owned by the runtime's user, at most 64 KiB, reached through no link and outside every Git checkout
   * and Windows mount. It rejects with an `SdkError`: `not-found` for a name the section does not name or a missing
   * file, `forbidden` for a file that is not private, `invalid-request` for one that is too large or not UTF-8 text,
   * and `invalid-state` once the module's stop has begun. Never put what it returns in a message, a log field, an
   * error body or health.
   */
  read(name: string): Promise<string>;
}

/**
 * What the runtime gives a module's `start`. Once the module's stop begins, its participant, scheduler, workers,
 * database, files and secrets refuse use with `invalid-state`; its configuration, logger, tracing, clock and signal keep
 * working, so `stop` can still log.
 */
export type ModuleContext<Config = unknown> = {
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
  /**
   * The configuration the manifest's `configure` returned from the module's own section, or undefined for a module
   * without `configure`. A module never sees another module's section.
   */
  readonly config: Config;
  /** The module's own secret files. */
  readonly secrets: Secrets;
  /**
   * The absolute path of the module's own private folder, `modules/<name>/` in the runtime's state directory beside its
   * SQLite file, for files such as media, layouts and scenes. It is created with mode 700 on the first call and kept
   * across restarts.
   */
  readonly files: () => string;
  /** Aborted when the module stops, so that device calls given this signal end. */
  readonly signal: AbortSignal;
};
