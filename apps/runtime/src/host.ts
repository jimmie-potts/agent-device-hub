// The module host (ADR 0012, "Runtime and transport"): manifests, contexts and supervision. A module's thrown error,
// rejected promise or device timeout stops only that module, through its participant's close, and health shows it
// unhealthy; the others keep working.
import {AsyncLocalStorage} from 'node:async_hooks';
import type {DatabaseSync} from 'node:sqlite';
import {Worker, type WorkerOptions} from 'node:worker_threads';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import {
  InProcessBus, MODULE_API_VERSION, SdkError, childOf, type BunnyModule, type Cancel, type Clock, type CommandDraft, type Draft,
  type ErrorScope, type Handler, type ModuleContext, type Participant, type RequestOptions, type Responder, type Scheduler, type Sdk,
  type SendOptions, type SubscribeOptions, type SyncHandler, type SyncOptions, type SyncProvider,
} from '@jimmie-potts/sdk';
import {errorFields, type LogWriter, type RuntimeLogger} from './log.js';
import {openModuleDatabase} from './state.js';

export type ModuleState = 'refused' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
/** Why a module is refused or failed: a code from the 2.0 error registry and a fixed sentence. */
export type Reason = {code: string; detail: string};
export type ModuleHealth = {name: string; apiVersion: string; state: ModuleState; healthy: boolean; syncRestarts: number; reason?: Reason};

export type HostOptions = {
  clock: Clock;
  scheduler: Scheduler;
  stateDir: string;
  logs: LogWriter;
  startTimeoutMs: number;
  stopTimeoutMs: number;
};

type Flow = {fail: (reason: Reason, error: unknown) => void};
type Slot = {
  readonly module: BunnyModule;
  readonly name: string;
  readonly apiVersion: string;
  readonly flow: Flow;
  readonly log: RuntimeLogger;
  readonly controller: AbortController;
  readonly timers: Set<Cancel>;
  readonly workers: Set<Worker>;
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

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
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

/** Why a declared module API version is refused, or undefined when it matches: the same major, and no newer minor. */
export function checkApiVersion(declared: string, supported: string): Reason | undefined {
  const [, major, minor] = VERSION.exec(declared) ?? [];
  const [, runtimeMajor, runtimeMinor] = VERSION.exec(supported) ?? [];
  if (major === undefined || minor === undefined) return {code: 'invalid-request', detail: 'apiVersion must be <major>.<minor>'};
  if (major !== runtimeMajor || Number(minor) > Number(runtimeMinor)) {
    return {code: 'unsupported-version', detail: `module API ${declared} does not match this runtime's ${supported}`};
  }
  return undefined;
}

/** Why a manifest is refused, or undefined when the module may start. `taken` holds the names already in use. */
function refusal({name, apiVersion}: BunnyModule['manifest'], taken: ReadonlySet<string>): Reason | undefined {
  if (!NAME.test(name) || name.length > 64) {
    return {code: 'invalid-request', detail: 'name must be lowercase letters and digits with single hyphens, at most 64 characters'};
  }
  if (taken.has(name)) return {code: 'invalid-request', detail: 'another module already has this name'};
  return checkApiVersion(apiVersion, MODULE_API_VERSION);
}

/**
 * Stops the module whose async flow raised `error`, an error that escaped to the process. False when no module raised
 * it: then it is the runtime's own failure.
 */
export function contain(error: unknown): boolean {
  const flow = running.getStore();
  if (flow === undefined) return false;
  flow.fail({code: 'internal', detail: 'an error escaped the module'}, error);
  return true;
}

const stopped = (): SdkError => new SdkError(errorBody('invalid-state', {detail: 'the module has stopped'}));

export class ModuleHost {
  readonly #slots: Slot[] = [];
  readonly #bySource = new Map<string, Slot>();
  readonly #bus: InProcessBus;
  readonly #options: HostOptions;
  readonly #log: RuntimeLogger;
  readonly #drops = new Map<string, Drops>();

  constructor(modules: readonly BunnyModule[], options: HostOptions) {
    this.#options = options;
    this.#log = options.logs.logger('bunny.runtime');
    this.#bus = new InProcessBus({
      now: () => options.clock.now(), scheduler: options.scheduler,
      onError: (error, scope) => { this.#reported(error, scope); },
      onSyncRestart: ({source}) => {
        const slot = this.#bySource.get(source);
        if (slot !== undefined) slot.syncRestarts += 1;
      },
    });
    const names = new Set<string>();
    for (const module of modules) {
      const {name, apiVersion} = module.manifest;
      const slot: Slot = {
        module, name, apiVersion, log: options.logs.logger(`bunny.modules.${name}`, {'bunny.module': name}),
        flow: {fail: (reason, error) => { this.#fail(slot, reason, error); }},
        controller: new AbortController(), timers: new Set(), workers: new Set(),
        state: 'starting', reason: undefined, syncRestarts: 0, participant: undefined, database: undefined, stopping: undefined,
      };
      const reason = refusal(module.manifest, names);
      if (NAME.test(name)) names.add(name);
      if (reason !== undefined) {
        slot.state = 'refused';
        slot.reason = reason;
        this.#log.error('runtime.module.refused', {'bunny.module': name, 'bunny.reason': reason.detail});
      }
      this.#slots.push(slot);
    }
  }

  /** Starts every module that was not refused, at once, and resolves when each start has finished, failed or timed out. */
  async start(): Promise<void> {
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

  health(): ModuleHealth[] {
    return this.#slots.map(({name, apiVersion, state, reason, syncRestarts}) =>
      ({name, apiVersion, state, healthy: state === 'running', syncRestarts, ...(reason === undefined ? {} : {reason})}));
  }

  async #start(slot: Slot): Promise<void> {
    this.#log.debug('runtime.module.starting', {'bunny.module': slot.name});
    const participant = this.#bus.connect(`bunny/modules/${slot.name}`);
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
        this.#fail(slot, {code: 'internal', detail: 'start failed'}, outcome.error);
        return;
      case 'timed-out':
        this.#fail(slot, {code: 'unavailable', detail: `start did not finish within ${startTimeoutMs} ms`}, undefined);
        return;
    }
  }

  /** The module's context. Every callback the module hands it runs in the module's flow, so escaped errors name it. */
  #context(slot: Slot, participant: Participant): ModuleContext {
    const {clock, scheduler, stateDir} = this.#options;
    const live = (): void => { if (slot.stopping !== undefined) throw stopped(); };
    const inFlow = <T>(call: () => T): T => running.run(slot.flow, call);
    const sdk: Sdk = {
      source: participant.source,
      publish: <T extends object>(key: string, draft: Draft<T>, options?: SendOptions) => participant.publish(key, draft, options),
      publishMessage: <T extends object>(key: string, message: Message<T>) => participant.publishMessage(key, message),
      subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) =>
        participant.subscribe<T>(pattern, message => inFlow(() => handler(message)), options === undefined ? undefined : {
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
      trace: {span: parent => childOf(parent)},
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
            this.#fail(slot, {code: 'internal', detail: 'a scheduled callback failed'}, error);
          });
        });
        slot.timers.add(cancel);
        return cancel;
      }},
      workers: {start: (file: URL, options?: WorkerOptions) => {
        live();
        const worker = inFlow(() => new Worker(file, options));
        slot.workers.add(worker);
        worker.on('error', error => { this.#fail(slot, {code: 'internal', detail: 'a worker failed'}, error); });
        worker.once('exit', () => { slot.workers.delete(worker); });
        return worker;
      }},
      database: () => {
        live();
        slot.database ??= openModuleDatabase(stateDir, slot.name);
        return slot.database;
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
      this.#log.error('runtime.handler.failed', {'bunny.source': scope.source, 'bunny.pattern': scope.pattern, ...errorFields(error)});
      return;
    }
    this.#fail(slot, {code: 'internal', detail: 'a handler threw'}, error);
  }

  #dropped(scope: ErrorScope): void {
    const key = `${scope.source}\n${scope.pattern}`;
    const open = this.#drops.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    this.#log.warn('runtime.delivery.dropped', {'bunny.source': scope.source, 'bunny.pattern': scope.pattern, 'bunny.dropped.count': 1});
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
    if (count > 0) this.#log.warn('runtime.delivery.dropped', {'bunny.source': scope.source, 'bunny.pattern': scope.pattern, 'bunny.dropped.count': count});
  }

  /** Marks the module failed and stops it. Later errors from a module that has already stopped are only logged. */
  #fail(slot: Slot, reason: Reason, error: unknown): void {
    const fields = {'bunny.module': slot.name, ...(error === undefined ? {} : errorFields(error))};
    if (slot.state === 'failed' || slot.state === 'stopped' || slot.state === 'refused') {
      this.#log.warn('runtime.module.error-after-stop', fields);
      return;
    }
    slot.state = 'failed';
    slot.reason = reason;
    this.#log.error('runtime.module.failed', {...fields, 'bunny.reason': reason.detail});
    void this.#teardown(slot);
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
    if (ended.status === 'failed') this.#log.warn('runtime.module.stop-failed', {'bunny.module': slot.name, ...errorFields(ended.error)});
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
