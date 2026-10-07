// The module host (ADR 0012, "Runtime and transport"): manifests, configuration, contexts and supervision. Before it
// starts a module, it checks the module's own section of the configuration file and the secret files that section
// names (Hub #919); a module it refuses never starts, and the others do. A device's errors and timeouts are not module
// failures: under policy A, a module turns them into outcomes and an `unavailable` device state. Only an error that
// escapes a module, thrown, rejected or a start that outlasts its deadline, stops that module, through its
// participant's close, and health shows it unhealthy; the others keep working.
import {AsyncLocalStorage} from 'node:async_hooks';
import {Ajv2020} from 'ajv/dist/2020.js';
import type {DatabaseSync} from 'node:sqlite';
import {Worker, type WorkerOptions} from 'node:worker_threads';
import {errorBody, type ErrorCode, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  InProcessBus, SdkError, WorkerCalls, checkApiVersion, checkConfiguration, checkContributions, checkModuleName, childOf, noSpans, startSpan, type BunnyModule, type Cancel,
  type Clock, type CommandDraft, type Draft, type ErrorScope, type Handler, type ModuleContext, type Participant, type RequestOptions, type Responder,
  type Scheduler, type Sdk, type SendOptions, type SpanRecorder, type SubscribeOptions, type SyncHandler, type SyncOptions, type SyncProvider,
  type WorkerCallOptions,
} from '@jimmie-potts/sdk';
import {diagnosticWriter} from './diagnostics.js';
import {errorFields, type LogWriter, type Redactions, type RuntimeLogger} from './log.js';
import {MODULE_SCOPE, RUNTIME_SCOPE} from './record.js';
import {
  MAX_SECRET_BYTES, PrivateFileError, openModuleDatabase, openModuleFolder, readPrivateFile, sectionOf, type FileProblem, type RuntimeConfig,
} from './state.js';
import type {RuntimeTracing} from './tracing.js';

export type ModuleState = 'refused' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
/** Why a module is refused or failed: a code from the 2.0 error registry and a fixed sentence. */
export type Reason = {code: string; detail: string};
/**
 * A module's health. `serves` lists the families the module serves through sync now, when it serves any, so a consumer
 * of a family that several modules serve, such as `device`, learns its owners (#967).
 */
export type ModuleHealth = {
  name: string; apiVersion: string; state: ModuleState; healthy: boolean; syncRestarts: number; serves?: readonly string[]; reason?: Reason;
};

export type HostOptions = {
  /**
   * Hears that the core failed. The core is the one owner of agent sessions (Hub #831), so the runtime cannot continue
   * without it: the service process ends with a failure exit, and the service manager restarts the whole runtime.
   */
  onCoreFailure?: (error: unknown) => void;
  clock: Clock;
  scheduler: Scheduler;
  stateDir: string;
  logs: LogWriter;
  startTimeoutMs: number;
  stopTimeoutMs: number;
  /**
   * Records the bus's spans under the runtime's scope and each module's under `bunny.module` (Hub #949). Without it,
   * spans give only trace context.
   */
  tracing?: Pick<RuntimeTracing, 'recorder'>;
  /** The configuration file's sections, from `readRuntimeConfig`, or undefined when the runtime has no file. */
  config?: RuntimeConfig;
};

/**
 * Where a module's refusal, failure or stop problem arose, as the `bunny.phase` attribute of its record: its manifest,
 * its start, a handler or responder, a scheduled callback, a worker thread, its own async flow, or the two bounded steps
 * of its stop (the participant's close, which waits for its handlers, and its `stop`).
 */
type Phase = 'manifest' | 'start' | 'handler' | 'timer' | 'worker' | 'async' | 'handlers' | 'stop';
/** A failure: the reason health shows, and where it arose, which only the log record carries. */
type Failure = Reason & {phase: Phase};
type Flow = {fail: (failure: Failure, error: unknown) => void};
/** What the module's section gave it once admitted: its configuration, its devices and its secret files by name. */
type Setup = {config: unknown; devices: readonly string[]; secrets: ReadonlyMap<string, string>};
/**
 * A hosted module as the gateway sees it (Hub #835): its manifest, its state and, once admitted, the configuration and
 * devices its section gave it.
 */
export type HostedModule = {
  readonly name: string;
  readonly manifest: BunnyModule['manifest'];
  readonly state: ModuleState;
  readonly admitted: boolean;
  readonly config: unknown;
  readonly devices: readonly string[];
};
/** A contribution's call that failed because the module was not running: `unavailable`, with nothing called. */
export class ModuleUnavailable extends Error {
  override readonly name = 'ModuleUnavailable';
}
/** A contribution's call that threw or rejected: the module has failed, as from a handler, and its error stays in memory. */
export class ContributionFailed extends Error {
  override readonly name = 'ContributionFailed';
}
type Slot = {
  readonly module: BunnyModule;
  readonly name: string;
  readonly apiVersion: string;
  readonly flow: Flow;
  readonly log: RuntimeLogger;
  readonly controller: AbortController;
  readonly timers: Set<Cancel>;
  /** Its worker threads, those of its worker calls included, which the runtime terminates when it stops. */
  readonly workers: Set<Worker>;
  readonly calls: WorkerCalls;
  setup: Setup | undefined;
  state: ModuleState;
  reason: Reason | undefined;
  /** How often an overflow restarted one of the module's sync copies. */
  syncRestarts: number;
  participant: Participant | undefined;
  database: DatabaseSync | undefined;
  /** Set when the module's stop begins; from then on its context refuses use. */
  stopping: Promise<void> | undefined;
};
type Outcome = {status: 'done'} | {status: 'failed'; error: unknown} | {status: 'timed-out'};
/** Drops on one subscription since its window opened, and the window's cancel. */
type Drops = {scope: ErrorScope; count: number; cancel: Cancel};

// setTimeout's longest delay; a longer one would fire at once.
const MAX_DELAY_MS = 2_147_483_647;
/** One subscription's first dropped delivery is logged at once, then the later ones once per window while they go on. */
export const DROP_WINDOW_MS = 60_000;
// The module whose code runs in the current async flow, so that an error escaping to the process names its module.
const running = new AsyncLocalStorage<Flow>();

/** Runs a call so that a throw becomes a rejected promise. */
function attempt(call: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(call());
  } catch (error) {
    return Promise.reject(error);
  }
}

/** A module's name in a record, when it is a valid name; a malformed one is no identity, so its record leaves it out. */
const named = (name: string): Record<string, string> => checkModuleName(name) === undefined ? {'bunny.module': name} : {};
/** A record's fields for a reason: its 2.0 registry code and where it arose, never the sentence. */
const reasonFields = ({code, phase}: Failure): Record<string, string> => ({'bunny.code': code, 'bunny.phase': phase});

/** What a secret file's problem tells the module and health: a registry code and a fixed ending for its sentence. */
const SECRET_PROBLEMS: Readonly<Record<FileProblem, readonly [ErrorCode, string]>> = {
  relative: ['forbidden', 'must be an absolute path'],
  mount: ['forbidden', 'must not be on a Windows mount'],
  missing: ['not-found', 'does not exist'],
  link: ['forbidden', 'must not be reached through a link'],
  checkout: ['forbidden', 'must be outside every Git checkout'],
  'not-file': ['forbidden', 'must be a regular file'],
  'not-private': ['forbidden', 'must be private to its owner: readable by it, with no permissions for group or others and one link'],
  'too-large': ['invalid-request', `must be at most ${MAX_SECRET_BYTES} bytes`],
};
const secretError = (name: string, [code, what]: readonly [ErrorCode, string], cause?: unknown): SdkError =>
  new SdkError(errorBody(code, {detail: `the secret file for ${name} ${what}`}), cause === undefined ? undefined : {cause});

/**
 * Reads a module's secret file, named `name` in its section, as a private file of at most 64 KiB, and returns its UTF-8
 * text without trailing line breaks. Throws an `SdkError` with a registry code and a fixed detail, never the text.
 */
async function loadSecret(name: string, path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readPrivateFile(path, MAX_SECRET_BYTES);
  } catch (error) {
    throw secretError(name, error instanceof PrivateFileError ? SECRET_PROBLEMS[error.problem] : ['internal', 'could not be read'], error);
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/[\r\n]+$/, '');
  } catch {
    throw secretError(name, ['invalid-request', 'must be UTF-8 text']);
  }
}

/**
 * A worker's options with the process's `NODE_OPTIONS` kept in an `env` of the module's own, before its own, so that a
 * worker a module gives its own environment still loads what the process preloads, such as a verification run's
 * network guard (Hub #920). `SHARE_ENV` and an inherited environment keep it already.
 */
function keepNodeOptions(options: WorkerOptions | undefined): WorkerOptions | undefined {
  const inherited = process.env.NODE_OPTIONS;
  const env = options?.env;
  if (inherited === undefined || inherited === '' || typeof env !== 'object') return options;
  const own = env.NODE_OPTIONS;
  if (own !== undefined && own.includes(inherited)) return options;
  return {...options, env: {...env, NODE_OPTIONS: own === undefined || own === '' ? inherited : `${inherited} ${own}`}};
}

/**
 * A module's span recorder that leaves out each attribute holding a secret a module read, as the log writer does for
 * records (Hub #919). The span itself is kept, so its children keep their parent.
 */
const redactedSpans = (recorder: SpanRecorder, redactions: Redactions): SpanRecorder => ({
  start: (name, options = {}) => recorder.start(name, options.attributes === undefined ? options : {...options, attributes: redactions.without(options.attributes)}),
});

/** Why a manifest is refused, or undefined when the module may start. `taken` holds the names already in use. */
function refusal(manifest: BunnyModule['manifest'], taken: ReadonlySet<string>): Reason | undefined {
  const named = checkModuleName(manifest.name);
  if (named !== undefined) return named;
  if (taken.has(manifest.name)) return {code: 'invalid-request', detail: 'another module already has this name'};
  return checkApiVersion(manifest.apiVersion) ?? checkContributions(manifest) ?? checkToolSchemas(manifest);
}

/** Argument names the MCP gateway keeps for itself, so that no tool can take a target or a credential from its caller. */
const RESERVED_ARGUMENTS = ['deviceId', 'controllerId', 'url', 'ip', 'path', 'credential', 'authorization'];

/**
 * Why the gateway could not publish a module's tools (Hub #835): each schema must compile as strict JSON Schema 2020-12,
 * as MCP publishes it, and no argument may take a name the gateway keeps. Undefined when every tool can be published.
 */
function checkToolSchemas({tools = []}: BunnyModule['manifest']): Reason | undefined {
  const ajv = new Ajv2020({strict: true, allErrors: false});
  for (const tool of tools) {
    const names = Object.keys((tool.input as {properties?: object}).properties ?? {});
    if (names.some(name => RESERVED_ARGUMENTS.includes(name))) {
      return {code: 'invalid-request', detail: `a tool's arguments may not be named ${RESERVED_ARGUMENTS.join(', ')}`};
    }
    try {
      ajv.compile(tool.input);
      ajv.compile(tool.output);
    } catch {
      return {code: 'invalid-request', detail: 'a tool\'s input or output schema is not strict JSON Schema 2020-12'};
    }
  }
  return undefined;
}

/**
 * Stops the module whose async flow raised `error`, an error that escaped to the process. False when no module raised
 * it: then it is the runtime's own failure.
 */
export function contain(error: unknown): boolean {
  const flow = running.getStore();
  if (flow === undefined) return false;
  flow.fail({code: 'internal', detail: 'an error escaped the module', phase: 'async'}, error);
  return true;
}

const stopped = (): SdkError => new SdkError(errorBody('invalid-state', {detail: 'the module has stopped'}));

/** The module the runtime hosts as the core (Hub #831), with the source `bunny/core`; every other module is `bunny/modules/<name>`. */
export const CORE_MODULE = 'core';
/** A module's source on the bus. */
export const sourceOf = (name: string): string => name === CORE_MODULE ? 'bunny/core' : `bunny/modules/${name}`;

export class ModuleHost {
  readonly #slots: Slot[] = [];
  readonly #bySource = new Map<string, Slot>();
  readonly #bus: InProcessBus;
  readonly #options: HostOptions;
  readonly #log: RuntimeLogger;
  readonly #drops = new Map<string, Drops>();

  constructor(modules: readonly BunnyModule[], options: HostOptions) {
    this.#options = options;
    this.#log = options.logs.logger(RUNTIME_SCOPE);
    this.#bus = new InProcessBus({
      now: () => options.clock.now(), scheduler: options.scheduler,
      onError: (error, scope) => { this.#reported(error, scope); },
      // The bus records each command and sync decision once, in the runtime's own scope, and its command spans.
      onDiagnostic: diagnosticWriter(this.#log), spans: options.tracing?.recorder(RUNTIME_SCOPE) ?? noSpans,
      onSyncRestart: ({source}) => {
        const slot = this.#bySource.get(source);
        if (slot !== undefined) slot.syncRestarts += 1;
      },
    });
    const names = new Set<string>();
    for (const module of modules) {
      const {name, apiVersion} = module.manifest;
      const controller = new AbortController();
      const workers = new Set<Worker>();
      const slot: Slot = {
        module, name, apiVersion, log: options.logs.logger(MODULE_SCOPE, {'bunny.module': name}),
        flow: {fail: (failure, error) => { this.#fail(slot, failure, error); }},
        controller, timers: new Set(), workers,
        calls: new WorkerCalls({scheduler: options.scheduler, signal: controller.signal, track: worker => {
          workers.add(worker);
          worker.once('exit', () => { workers.delete(worker); });
        }}),
        setup: undefined, state: 'starting', reason: undefined, syncRestarts: 0, participant: undefined, database: undefined, stopping: undefined,
      };
      const reason = refusal(module.manifest, names);
      if (checkModuleName(name) === undefined) names.add(name);
      if (reason !== undefined) this.#refuse(slot, reason);
      this.#slots.push(slot);
    }
  }

  /** The bus the modules share, so that a remote edge can mount on it (#846's harness, #920's launch option). */
  get bus(): InProcessBus {
    return this.#bus;
  }

  /**
   * Admits each module whose manifest was accepted, in list order, so that the first module to name a device keeps it.
   * Then starts every admitted module at once, and resolves when each start has finished, failed or timed out.
   */
  async start(): Promise<void> {
    const devices = new Set<string>();
    for (const slot of this.#slots) if (slot.state === 'starting') await this.#admit(slot, devices);
    await Promise.all(this.#slots.filter(slot => slot.state === 'starting').map(slot => this.#start(slot)));
  }

  /** Stops every module that started, each within the stop deadline, then logs the drops not yet logged. */
  async stop(): Promise<void> {
    await Promise.all(this.#slots.filter(slot => slot.participant !== undefined).map(slot => {
      if (slot.state === 'starting' || slot.state === 'running') slot.state = 'stopping';
      return this.#teardown(slot);
    }));
    for (const drops of this.#drops.values()) {
      drops.cancel();
      this.#logDrops(drops);
    }
    this.#drops.clear();
  }

  /** Every hosted module, in list order, as the gateway serves its pages, tools and settings (Hub #835). */
  modules(): HostedModule[] {
    return this.#slots.map(slot => ({
      name: slot.name, manifest: slot.module.manifest, state: slot.state, admitted: slot.setup !== undefined, config: slot.setup?.config,
      devices: slot.setup?.devices ?? [],
    }));
  }

  /**
   * Runs one of a running module's contributions, a page's render, its content, a tool's read or its settings' show, in
   * the module's own flow (Hub #835). A module that is not running is not called: `ModuleUnavailable`. An exception
   * that escapes the call fails the module, as one from a handler does, and the call rejects with
   * `ContributionFailed`; the exception stays in memory.
   */
  async invoke<T>(name: string, call: () => T | Promise<T>): Promise<T> {
    const slot = this.#slots.find(candidate => candidate.name === name);
    if (slot?.state !== 'running') throw new ModuleUnavailable(`${name} is not running`);
    try {
      return await running.run(slot.flow, () => attempt(call)) as T;
    } catch (error) {
      this.#fail(slot, {code: 'internal', detail: 'a contribution failed', phase: 'handler'}, error);
      throw new ContributionFailed('the module\'s contribution failed', {cause: error});
    }
  }

  health(): ModuleHealth[] {
    return this.#slots.map(({name, apiVersion, state, reason, syncRestarts}) => {
      const serves = this.#bus.served(sourceOf(name));
      return {name, apiVersion, state, healthy: state === 'running', syncRestarts, ...(serves.length === 0 ? {} : {serves}), ...(reason === undefined ? {} : {reason})};
    });
  }

  /**
   * Checks the module's own section of the configuration file, the devices it names against those of the modules
   * admitted before it, and each secret file the section names. A module that fails any check is refused, with a
   * reason whose code comes from the registry, and never starts.
   */
  async #admit(slot: Slot, devices: Set<string>): Promise<void> {
    const checked = running.run(slot.flow, () => checkConfiguration(slot.module.manifest, sectionOf(this.#options.config, slot.name)));
    if (checked.status === 'refused') {
      this.#refuse(slot, checked.problem, checked.error);
      return;
    }
    if (checked.devices.some(id => devices.has(id))) {
      this.#refuse(slot, {code: 'invalid-request', detail: 'another module already names one of this module\'s devices'});
      return;
    }
    for (const [name, path] of checked.secrets) {
      try {
        await loadSecret(name, path);
      } catch (error) {
        this.#refuse(slot, error instanceof SdkError ? {code: error.body.error.code, detail: error.body.error.detail ?? ''} : {code: 'internal', detail: 'a secret file could not be read'});
        return;
      }
    }
    for (const id of checked.devices) devices.add(id);
    slot.setup = {config: checked.config, devices: checked.devices, secrets: checked.secrets};
  }

  /** Refuses the module: it never starts, and health and its record name the reason. */
  #refuse(slot: Slot, reason: Reason, error?: unknown): void {
    slot.state = 'refused';
    slot.reason = reason;
    this.#log.error('runtime.module.refused', {...named(slot.name), ...reasonFields({...reason, phase: 'manifest'}), ...(error === undefined ? {} : this.#errorFields(error))});
    // The runtime cannot continue without the one owner of agent sessions (Hub #831), whether it failed or was refused,
    // as by a malformed `core` section of the configuration file.
    if (slot.name === CORE_MODULE) this.#options.onCoreFailure?.(error);
  }

  /**
   * An error's type and code for a record, leaving out one that holds a secret a module read, such as a code a device
   * library copied from its credential. The record itself survives, as `runtime.failed` does (Hub #919).
   */
  #errorFields(error: unknown): Record<string, string> {
    return this.#options.logs.redactions.without(errorFields(error));
  }

  /** The text of a secret file the module's own section names. Each read is checked anew and redacted from the log. */
  async #readSecret(slot: Slot, name: string): Promise<string> {
    if (slot.stopping !== undefined) throw stopped();
    const path = slot.setup?.secrets.get(name);
    if (path === undefined) throw new SdkError(errorBody('not-found', {detail: 'the configuration names no such secret'}));
    const text = await loadSecret(name, path);
    this.#options.logs.redact(text);
    return text;
  }

  async #start(slot: Slot): Promise<void> {
    this.#log.debug('runtime.module.starting', {'bunny.module': slot.name});
    const participant = this.#bus.connect(sourceOf(slot.name));
    slot.participant = participant;
    this.#bySource.set(participant.source, slot);
    const context = this.#context(slot, participant);
    const {startTimeoutMs} = this.#options;
    const outcome = await this.#within(running.run(slot.flow, () => attempt(() => slot.module.start(context))), startTimeoutMs);
    // A handler may have failed the module meanwhile, or the runtime may be stopping.
    if (slot.state !== 'starting') return;
    switch (outcome.status) {
      case 'done':
        slot.state = 'running';
        this.#log.info('runtime.module.started', {'bunny.module': slot.name});
        return;
      case 'failed':
        this.#fail(slot, {code: 'internal', detail: 'start failed', phase: 'start'}, outcome.error);
        return;
      case 'timed-out':
        this.#fail(slot, {code: 'unavailable', detail: `start did not finish within ${startTimeoutMs} ms`, phase: 'start'}, undefined);
        return;
    }
  }

  /** The module's context. Every callback the module hands it runs in the module's flow, so escaped errors name it. */
  #context(slot: Slot, participant: Participant): ModuleContext {
    const {clock, scheduler, stateDir} = this.#options;
    const live = (): void => { if (slot.stopping !== undefined) throw stopped(); };
    const inFlow = <T>(call: () => T): T => running.run(slot.flow, call);
    const spans = redactedSpans(this.#options.tracing?.recorder(MODULE_SCOPE, {'bunny.module': slot.name}) ?? noSpans, this.#options.logs.redactions);
    const sdk: Sdk = {
      source: participant.source,
      publish: <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => participant.publish(key, draft, options),
      publishMessage: <T extends object>(key: string, message: Message<T>) => participant.publishMessage(key, message),
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) =>
        participant.subscribe<T>(pattern, (message, key) => inFlow(() => handler(message, key)), options === undefined ? undefined : {
          ...(options.onOverflow === undefined ? {} : {onOverflow: overflow => inFlow(() => options.onOverflow?.(overflow))}),
        }),
      request: <T extends object>(key: string, draft: CommandDraft<T>, options: RequestOptions) => participant.request(key, draft, options),
      respond: <T extends object>(pattern: string, responder: Responder<T>) =>
        participant.respond<T>(pattern, command => inFlow(() => responder(command))),
      sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) =>
        participant.sync<T>(families, change => inFlow(() => handler(change)), options),
      serveSync: (families: readonly string[], provider: SyncProvider) => participant.serveSync(families, request => inFlow(() => provider(request))),
    };
    return {
      sdk,
      log: slot.log,
      trace: {span: parent => childOf(parent), start: (name, options) => startSpan(spans, name, options)},
      clock: {now: () => clock.now()},
      scheduler: {after: (delayMs, callback) => {
        live();
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
          throw new RangeError(`delayMs must be an integer from 0 to ${MAX_DELAY_MS}`);
        }
        let inner: Cancel = () => {};
        const cancel: Cancel = () => {
          inner();
          slot.timers.delete(cancel);
        };
        inner = scheduler.after(delayMs, () => {
          slot.timers.delete(cancel);
          void inFlow(() => attempt(callback)).catch((error: unknown) => {
            this.#fail(slot, {code: 'internal', detail: 'a scheduled callback failed', phase: 'timer'}, error);
          });
        });
        slot.timers.add(cancel);
        return cancel;
      }},
      workers: {
        start: (file: URL, options?: WorkerOptions) => {
          live();
          const worker = inFlow(() => new Worker(file, keepNodeOptions(options)));
          slot.workers.add(worker);
          worker.on('error', error => { this.#fail(slot, {code: 'internal', detail: 'a worker failed', phase: 'worker'}, error); });
          worker.once('exit', () => { slot.workers.delete(worker); });
          return worker;
        },
        call: <Reply>(file: URL, request: unknown, options: WorkerCallOptions): Promise<Reply> =>
          slot.stopping !== undefined ? Promise.reject(stopped()) : inFlow(() => slot.calls.call<Reply>(file, request, options)),
      },
      database: () => {
        live();
        slot.database ??= openModuleDatabase(stateDir, slot.name);
        return slot.database;
      },
      config: slot.setup?.config,
      secrets: {read: name => this.#readSecret(slot, name)},
      files: () => {
        live();
        return openModuleFolder(stateDir, slot.name);
      },
      signal: slot.controller.signal,
    };
  }

  /** The bus's report of a handler error or a dropped delivery. A handler error fails its module. */
  #reported(error: unknown, scope: ErrorScope): void {
    const slot = this.#bySource.get(scope.source);
    if (error instanceof SdkError && error.body.error.code === 'capacity') {
      // A full queue lags only its subscriber, and a copy that missed messages syncs again. A burst of drops must not
      // flood the log, so each subscription's are counted per window.
      this.#dropped(scope);
      return;
    }
    if (slot === undefined) {
      this.#log.error('runtime.handler.failed', {'bunny.participant': scope.source, 'bunny.pattern': scope.pattern, ...this.#errorFields(error)});
      return;
    }
    this.#fail(slot, {code: 'internal', detail: 'a handler threw', phase: 'handler'}, error);
  }

  #dropped(scope: ErrorScope): void {
    const key = `${scope.source}\n${scope.pattern}`;
    const open = this.#drops.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    this.#log.warn('runtime.delivery.dropped', {'bunny.participant': scope.source, 'bunny.pattern': scope.pattern, 'bunny.delivery.dropped_count': 1});
    const drops: Drops = {scope, count: 0, cancel: () => {}};
    this.#drops.set(key, drops);
    this.#openWindow(key, drops);
  }

  /**
   * At the window's end, the drops it counted are logged and the next window opens, so drops that go on are logged
   * once a minute. A quiet window ends the subscription's windows: its next drop is logged at once again.
   */
  #openWindow(key: string, drops: Drops): void {
    drops.cancel = this.#options.scheduler.after(DROP_WINDOW_MS, () => {
      if (drops.count === 0) {
        this.#drops.delete(key);
        return;
      }
      this.#logDrops(drops);
      this.#openWindow(key, drops);
    });
  }

  /** Logs the drops counted since the last record, at the runtime's stop or a window's end. */
  #logDrops(drops: Drops): void {
    const {scope, count} = drops;
    drops.count = 0;
    if (count > 0) this.#log.warn('runtime.delivery.dropped', {'bunny.participant': scope.source, 'bunny.pattern': scope.pattern, 'bunny.delivery.dropped_count': count});
  }

  /** Marks the module failed and stops it. Later errors from a module that has already stopped are only logged. */
  #fail(slot: Slot, failure: Failure, error: unknown): void {
    const fields = {'bunny.module': slot.name, ...(error === undefined ? {} : this.#errorFields(error))};
    if (slot.state === 'failed' || slot.state === 'stopped' || slot.state === 'refused') {
      this.#log.warn('runtime.module.error-after-stop', {...fields, 'bunny.phase': failure.phase});
      return;
    }
    slot.state = 'failed';
    slot.reason = {code: failure.code, detail: failure.detail};
    this.#log.error('runtime.module.failed', {...fields, ...reasonFields(failure)});
    void this.#teardown(slot);
    if (slot.name === CORE_MODULE) this.#options.onCoreFailure?.(error);
  }

  /**
   * Stops the module once, in its own async flow: the bus may report a handler's error from another module's flow, and
   * a failed start or the runtime's stop comes from the runtime's. An error the module's abort listeners or cleanup
   * then raise belongs to the module, never to whichever flow noticed the failure.
   */
  #teardown(slot: Slot): Promise<void> {
    slot.stopping ??= running.run(slot.flow, () => this.#close(slot));
    return slot.stopping;
  }

  /**
   * Stops one module and releases what the runtime gave it. Its signal aborts and its timers are cancelled. Then its
   * participant closes, which settles its own requests and waits only for its own running handlers, and then its `stop`
   * runs, each within the stop deadline. Its workers are terminated and its database is closed even when a deadline
   * passes.
   */
  async #close(slot: Slot): Promise<void> {
    slot.controller.abort();
    for (const cancel of [...slot.timers]) cancel();
    const {stopTimeoutMs} = this.#options;
    const fields = {'bunny.module': slot.name, 'bunny.timeout_ms': stopTimeoutMs};
    const closed = await this.#within(slot.participant?.close() ?? Promise.resolve(), stopTimeoutMs);
    if (closed.status === 'timed-out') this.#log.warn('runtime.module.stop-timed-out', {...fields, 'bunny.phase': 'handlers'});
    const ended = await this.#within(running.run(slot.flow, () => attempt(() => slot.module.stop())), stopTimeoutMs);
    if (ended.status === 'timed-out') this.#log.warn('runtime.module.stop-timed-out', {...fields, 'bunny.phase': 'stop'});
    if (ended.status === 'failed') this.#log.warn('runtime.module.stop-failed', {'bunny.module': slot.name, 'bunny.phase': 'stop', ...this.#errorFields(ended.error)});
    await Promise.allSettled([...slot.workers].map(worker => worker.terminate()));
    if (slot.database?.isOpen === true) slot.database.close();
    if (slot.state === 'stopping') slot.state = 'stopped';
    this.#log.info('runtime.module.stopped', {'bunny.module': slot.name});
  }

  /** How `work` ended within `timeoutMs` on the runtime's scheduler. A rejection after the deadline is still handled. */
  #within(work: Promise<unknown>, timeoutMs: number): Promise<Outcome> {
    return new Promise(resolve => {
      const cancel = this.#options.scheduler.after(timeoutMs, () => { resolve({status: 'timed-out'}); });
      work.then(() => {
        cancel();
        resolve({status: 'done'});
      }, (error: unknown) => {
        cancel();
        resolve({status: 'failed', error});
      });
    });
  }
}
