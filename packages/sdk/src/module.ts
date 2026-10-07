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
export const MODULE_API_VERSION = '1.2';

const MODULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
/** The module API version that brought pages, content, tools and settings (Hub #835). */
const CONTRIBUTIONS_VERSION = '1.2';
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
export function checkManifest(manifest: ModuleManifest): ManifestProblem | undefined {
  return checkModuleName(manifest.name) ?? checkApiVersion(manifest.apiVersion) ?? checkContributions(manifest);
}

/** A page's or a content reference's ID: lowercase letters and digits with single hyphens, at most 64 characters. */
const PAGE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A tool's name: a lowercase letter, then lowercase letters, digits and underscores, at most 48 characters. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;
/** How many pages and tools one module may contribute. */
export const MAX_PAGES = 16;
export const MAX_TOOLS = 16;
/** The page ID the gateway keeps for a module's content, `/modules/<name>/content/<ref>`. */
export const CONTENT_PATH = 'content';
const contributionProblem = (detail: string): ManifestProblem => ({code: 'invalid-request', detail});
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
/** An object schema whose arguments or results the gateway checks: a JSON object with `type: "object"`. */
const isObjectSchema = (value: unknown): value is JsonObjectSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (value as {type?: unknown}).type === 'object';

/**
 * Why the runtime would refuse a manifest's pages, content, tools or settings (module API 1.2, Hub #835), or undefined.
 * A module that declares any of them must be written for module API 1.2 or later. Pages have distinct IDs, none of them
 * `content`, a title and a `render`; tools have distinct names, a description, object schemas whose arguments allow no
 * other member, and a `read`; settings need `configure`, an object schema and a `show`.
 */
export function checkContributions(manifest: ModuleManifest): ManifestProblem | undefined {
  const {pages, content, tools, settings} = manifest;
  if (pages === undefined && content === undefined && tools === undefined && settings === undefined) return undefined;
  // The module must be written for 1.2 or a later minor version of the same major.
  if (checkApiVersion(CONTRIBUTIONS_VERSION, manifest.apiVersion) !== undefined) {
    return contributionProblem(`pages, content, tools and settings need module API ${CONTRIBUTIONS_VERSION}`);
  }
  if (pages !== undefined) {
    const given: unknown = pages;
    if (!Array.isArray(given) || pages.length > MAX_PAGES) return contributionProblem(`pages must be a list of at most ${MAX_PAGES}`);
    const ids = new Set<string>();
    for (const page of pages) {
      const {id, title, render} = page as Partial<ModulePage>;
      if (typeof id !== 'string' || !PAGE_ID.test(id) || id.length > 64 || id === CONTENT_PATH || ids.has(id)) {
        return contributionProblem('each page needs a distinct ID of lowercase letters and digits with single hyphens, at most 64, other than content');
      }
      if (!isText(title, 80) || typeof render !== 'function') return contributionProblem('each page needs a title of at most 80 characters and a render');
      ids.add(id);
    }
  }
  if (content !== undefined && typeof content !== 'function') return contributionProblem('content must be a function');
  if (tools !== undefined) {
    const given: unknown = tools;
    if (!Array.isArray(given) || tools.length > MAX_TOOLS) return contributionProblem(`tools must be a list of at most ${MAX_TOOLS}`);
    const names = new Set<string>();
    for (const tool of tools) {
      const {name, description, input, output, read} = tool as Partial<ModuleTool>;
      if (typeof name !== 'string' || !TOOL_NAME.test(name) || names.has(name)) {
        return contributionProblem('each tool needs a distinct name: a lowercase letter, then lowercase letters, digits and underscores, at most 48');
      }
      if (!isText(description, 1024) || typeof read !== 'function') return contributionProblem('each tool needs a description of at most 1024 characters and a read');
      if (!isObjectSchema(input) || input.additionalProperties !== false || !isObjectSchema(output)) {
        return contributionProblem('a tool\'s input and output are object schemas, and its input allows no other member');
      }
      names.add(name);
    }
  }
  if (settings !== undefined) {
    if (manifest.configure === undefined) return contributionProblem('settings show what configure accepted, so they need configure');
    const {schema, show} = settings as Partial<ModuleSettings<unknown>>;
    if (!isObjectSchema(schema) || typeof show !== 'function') return contributionProblem('settings need an object schema and a show');
  }
  return undefined;
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

/**
 * Checks the module's section of the runtime's configuration file, a JSON object, and returns the module's
 * configuration, or a refusal from `errorBody` whose code and detail health shows. It runs before `start`, once per
 * start of the runtime, and must be synchronous: it reads no file and reaches no device. A module that declares it
 * needs a section. The section's `secrets` member, which the runtime checks first, names the module's secret files;
 * `configure` sees their names and paths, never their contents. A refusal's detail is fixed text: it never repeats a
 * value from the section, which health would show.
 */
export type Configure<Config> = (section: unknown) => Configured<Config> | ErrorBody;

/** A JSON Schema for an object, as a tool's arguments and results and a module's settings use. */
export type JsonObjectSchema = {readonly type: 'object'; readonly [keyword: string]: unknown};

/**
 * A page the module contributes to the runtime's gateway (module API 1.2, Hub #835), served at
 * `/modules/<name>/<id>` to a browser session or a credential with the `read` scope. Its HTML may refer to the module's
 * content by reference, as `content/<ref>`, such as a preview frame. The gateway serves it with a policy that allows no
 * script, frame or form, and only images and styles from the runtime itself.
 */
export type ModulePage = {
  /** Lowercase letters and digits with single hyphens, at most 64 characters, and not `content`. */
  readonly id: string;
  /** A short title for a list of pages, at most 80 characters. */
  readonly title: string;
  /**
   * The page's HTML. It reads the module's own state and changes nothing. An exception that escapes it fails the
   * module, as one from a handler does.
   */
  readonly render: () => string | Promise<string>;
};

/** Content the module serves by reference, such as a preview frame: its media type and bytes. */
export type ModuleContent = {readonly type: string; readonly bytes: Uint8Array};

/**
 * A read tool the module contributes to MCP (module API 1.2, Hub #835). The gateway publishes it as
 * `<module>_<name>` to a credential with the `read` scope, checks its arguments against `input`, and returns what
 * `read` returns as `{result}`, or a refusal as the shared error body. It changes nothing; action tools come with Hub
 * #782's dispatcher.
 */
export type ModuleTool = {
  /** A lowercase letter, then lowercase letters, digits and underscores, at most 48 characters. */
  readonly name: string;
  /** What the tool reads, at most 1024 characters. */
  readonly description: string;
  /** The arguments' schema: an object that allows no other member (`additionalProperties: false`). */
  readonly input: JsonObjectSchema;
  /** The result's schema: an object. */
  readonly output: JsonObjectSchema;
  /**
   * Answers one call with the result, or refuses it with an error body from `errorBody`. An exception that escapes it
   * fails the module.
   */
  readonly read: (args: Readonly<Record<string, unknown>>) => object | ErrorBody | Promise<object | ErrorBody>;
};

/**
 * What the gateway shows of the module's settings (module API 1.2, Hub #835). A module has one configuration path:
 * its settings are the configuration `configure` accepted from its section of the runtime's configuration file, so a
 * module that declares settings declares `configure`. The gateway only shows them, at
 * `/api/v2/modules/<name>/settings`; a change is made in the configuration file and takes effect when the runtime
 * restarts. `show` picks what to show and never returns a secret; `schema` describes what it returns.
 */
export type ModuleSettings<Config> = {
  readonly schema: JsonObjectSchema;
  // A method, so that a module typed for its own configuration is still a `BunnyModule`.
  show(config: Config): Readonly<Record<string, unknown>>;
};

export type ModuleManifest<Config = unknown> = {
  /**
   * Lowercase letters and digits with single hyphens, at most 64 characters. It names the module's source
   * (`bunny/modules/<name>`), its SQLite file, its private folder, its section of the runtime's configuration file and
   * its log records.
   */
  readonly name: string;
  /** The module API version the module was written for, such as `1.2`. */
  readonly apiVersion: string;
  /** See `Configure`. Without it, the module takes no configuration and its `config` is undefined. */
  readonly configure?: Configure<Config>;
  /** Its pages, at most `MAX_PAGES` (module API 1.2). */
  readonly pages?: readonly ModulePage[];
  /**
   * Its content by reference (module API 1.2): what `ref`, an ID of 1 to 128 letters, digits, underscores, dots or
   * hyphens, names, or undefined when there is no such content. It reads and changes nothing else.
   */
  readonly content?: (ref: string) => ModuleContent | undefined | Promise<ModuleContent | undefined>;
  /** Its read tools, at most `MAX_TOOLS` (module API 1.2). */
  readonly tools?: readonly ModuleTool[];
  /** What the gateway shows of its configuration (module API 1.2). */
  readonly settings?: ModuleSettings<Config>;
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
   * reply. The worker is then terminated, as it is when the call ends any other way. Before the worker starts, the call
   * is refused, with no effect: `invalid-state` once the module's stop has begun, `invalid-request` for a malformed
   * deadline, `cancelled` when `signal` has already aborted, `capacity` when the module already has `MAX_WORKER_CALLS`
   * calls running, and `internal` when the worker cannot start. Once the worker has the request, every other ending
   * rejects with `uncertain-result`, because it may have done part of its work: the deadline passing, the module
   * stopping, `signal` aborting, the worker throwing, its reply being unreadable, or it ending without a reply. What
   * the worker threw stays in memory as the error's cause. A failed call never fails the module: the module turns it
   * into an outcome.
   */
  call<Reply = unknown>(file: URL, request: unknown, options: WorkerCallOptions): Promise<Reply>;
}

/** The module's secret files, which its section of the runtime's configuration names. */
export interface Secrets {
  /**
   * Reads the secret file that the module's section names `name`, anew on each call, and resolves with its UTF-8 text
   * without trailing line breaks. A secret file holds one token, used whole. The file must be private, as the
   * configuration file is: a regular file with one link and no permissions for group or others, owned and readable by
   * the runtime's user, at most 64 KiB, reached through no link and outside every Git checkout and Windows mount. It
   * rejects with an `SdkError`: `not-found` for a name the section does not name or a missing file, `forbidden` for a
   * file that is not private, `invalid-request` for one that is too large or not UTF-8 text, and `invalid-state` once
   * the module's stop has begun. Never put what it returns in a message, a log field, an error body or health.
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
   * without `configure`. The type says so because the manifest's `configure` is optional: a module that declares one
   * checks for undefined once, in `start`. A module never sees another module's section.
   */
  readonly config: Config | undefined;
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
