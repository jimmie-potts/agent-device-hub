// Hosts one module for a test, as the runtime would (ADR 0012, "Runtime and transport"): its section checked as the
// runtime checks it, its own participant on a given bus, a context with its configuration, its secrets from memory, a
// private folder and the runtime's worker calls, and a stop that releases everything in the runtime's order. A module's
// tests cannot import the runtime, so the kit hosts modules with this.
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import {Worker, type WorkerOptions} from 'node:worker_threads';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {openModuleDatabaseFile} from '../database.js';
import type {InProcessBus} from '../in-process.js';
import {checkConfiguration, type BunnyModule, type LogFields, type Logger, type ModuleContext, type WorkerCallOptions} from '../module.js';
import {
  SdkError, type Cancel, type Clock, type CommandDraft, type Handler, type Participant, type Responder, type Scheduler, type Sdk, type SubscribeOptions,
  type TraceContext,
} from '../sdk.js';
import type {SyncHandler, SyncOptions} from '../sync.js';
import {noSpans, startSpan, type SpanRecorder} from '../spans.js';
import {childOf} from '../trace.js';
import {WorkerCalls} from '../workers.js';

export type HarnessOptions = {
  /** The bus the module joins, with source `bunny/modules/<name>`. */
  bus: InProcessBus;
  /** Where the module's SQLite file, `<name>.sqlite`, lives. A new harness on the same directory keeps the file. */
  stateDir: string;
  /** Defaults to `Date.now()`. */
  clock?: Clock;
  /** Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
  /** How long the participant's close and the module's stop may each take. Defaults to 5000, as in the runtime. */
  stopTimeoutMs?: number;
  /**
   * Records the module's spans from `trace.start`, with its name in `bunny.module`, as the runtime does. By default
   * nothing is recorded.
   */
  spans?: SpanRecorder;
  /**
   * The module's section of the runtime's configuration file, as the runtime reads it, or undefined for none. The
   * harness checks it with `checkConfiguration` before start, as the runtime does.
   */
  section?: unknown;
  /**
   * The text of each secret file, by the name the section gives it. The harness keeps them in memory and writes no
   * file; a name the section names without text here reads as a missing file.
   */
  secrets?: Readonly<Record<string, string>>;
};
export type HarnessRecord = {level: 'debug' | 'info' | 'warn' | 'error'; event: string; fields: LogFields; trace?: TraceContext};

// setTimeout's longest delay; a longer one would fire at once.
const MAX_DELAY_MS = 2_147_483_647;
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
const stopped = (): SdkError => new SdkError(errorBody('invalid-state', {detail: 'the module has stopped'}));
const missingSecret = (detail: string): SdkError => new SdkError(errorBody('not-found', {detail}));
/** The runtime's stop deadline for a module's participant close and for its `stop`. */
export const DEFAULT_STOP_TIMEOUT_MS = 5000;

/**
 * What a module sent that no subscriber sees: a command it requested, or the families it asked to sync, with the owner
 * it named, if any.
 */
export type HarnessSent = {call: 'request'; key: string; draft: CommandDraft<object>} | {call: 'sync'; families: readonly string[]; owner?: string};

/**
 * The module's SDK calls, without `close`: as in the runtime, only the host closes a module's participant. `saw` hears
 * the trace context of each message the module receives. Each command and sync the module sends is also kept in
 * `sent`, since no subscriber sees them.
 */
const calls = (participant: Participant, saw: (context: TraceContext) => void, sent: HarnessSent[]): Sdk => ({
  source: participant.source,
  publish: (key, draft, options) => participant.publish(key, draft, options),
  publishMessage: (key, message) => participant.publishMessage(key, message),
  subscribe: <T extends object>(pattern: string, handler: Handler<T>, options?: SubscribeOptions) => participant.subscribe<T>(pattern, message => {
    saw(message);
    return handler(message);
  }, options),
  request: (key, draft, options) => {
    sent.push({call: 'request', key, draft});
    return participant.request(key, draft, options);
  },
  respond: <T extends object>(pattern: string, responder: Responder<T>) => participant.respond<T>(pattern, command => {
    saw(command);
    return responder(command);
  }),
  sync: <T extends object>(families: readonly string[], handler: SyncHandler<T>, options: SyncOptions) => {
    sent.push({call: 'sync', families: [...families], ...(options.owner === undefined ? {} : {owner: options.owner})});
    return participant.sync<T>(families, change => {
      if (change.type !== 'failed' && change.message !== undefined) saw(change.message);
      return handler(change);
    }, options);
  },
  serveSync: (families, provider) => participant.serveSync(families, request => {
    saw(request);
    return provider(request);
  }),
});

export class ModuleHarness {
  /** The module's log records. */
  readonly logs: HarnessRecord[] = [];
  /** The trace contexts of the messages the module received: commands, deliveries, synced states and sync requests. */
  readonly received: TraceContext[] = [];
  /** The commands and syncs the module sent, which no subscriber sees, so the kit can check them too. */
  readonly sent: HarnessSent[] = [];
  /**
   * Errors from the module's timer callbacks and workers, which the runtime would fail the module for, and a `stop`
   * that threw or a close or `stop` that outlasted its deadline, which the runtime logs as a warning.
   */
  readonly failures: unknown[] = [];
  /** The module's name, from its manifest. */
  readonly name: string;
  readonly source: string;
  readonly #module: BunnyModule;
  readonly #options: HarnessOptions;
  readonly #controller = new AbortController();
  readonly #timers = new Set<Cancel>();
  readonly #workers = new Set<Worker>();
  #participant: Participant | undefined;
  #database: DatabaseSync | undefined;
  #stopping: Promise<void> | undefined;
  #config: unknown;
  #secrets: ReadonlyMap<string, string> = new Map();

  constructor(module: BunnyModule, options: HarnessOptions) {
    this.#module = module;
    this.#options = options;
    this.name = module.manifest.name;
    this.source = `bunny/modules/${this.name}`;
  }

  /**
   * Checks the module's section as the runtime does, then connects the module's participant and runs its start. A
   * section the runtime would refuse throws an `SdkError` with the refusal's code, and the module never starts.
   */
  async start(): Promise<void> {
    if (this.#participant !== undefined) throw new SdkError(errorBody('invalid-state', {detail: 'the module has started'}));
    const checked = checkConfiguration(this.#module.manifest, this.#options.section);
    if (checked.status === 'refused') throw new SdkError(errorBody(checked.problem.code, {detail: checked.problem.detail}), {cause: checked.error});
    this.#config = checked.config;
    this.#secrets = checked.secrets;
    this.#participant = this.#options.bus.connect(this.source);
    await this.#module.start(this.#context(this.#participant));
  }

  /**
   * Stops the module as the runtime does: its signal aborts, its timers are cancelled and its participant closes, then
   * its `stop` runs, its workers end and its database closes. The close and `stop` each have the stop deadline, and a
   * failure or a passed deadline in one step never keeps the next from running. As in the runtime, `stop` runs only
   * once `start` was called. Calling it again returns the same promise.
   */
  stop(): Promise<void> {
    this.#stopping ??= this.#stop();
    return this.#stopping;
  }

  /** How many of the module's timers are still pending. */
  pendingTimers(): number {
    return this.#timers.size;
  }

  runningWorkers(): number {
    return this.#workers.size;
  }

  databaseOpen(): boolean {
    return this.#database?.isOpen === true;
  }

  /**
   * The module's own database connection while it is open, for a test that reads or changes its rows. The module keeps
   * its file to itself, as in the runtime, so no second connection can open the file until the module stops.
   */
  moduleDatabase(): DatabaseSync | undefined {
    return this.#database?.isOpen === true ? this.#database : undefined;
  }

  async #stop(): Promise<void> {
    this.#controller.abort();
    for (const cancel of [...this.#timers]) cancel();
    const participant = this.#participant;
    if (participant === undefined) return;
    await this.#within(() => participant.close(), 'the participant\'s close');
    await this.#within(() => this.#module.stop(), 'the module\'s stop');
    await Promise.allSettled([...this.#workers].map(worker => worker.terminate()));
    if (this.#database?.isOpen === true) this.#database.close();
  }

  /** Runs one stop step within the stop deadline, recording a throw, a rejection or a passed deadline as a failure. */
  async #within(step: () => unknown, what: string): Promise<void> {
    const timeoutMs = this.#options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>(resolve => { timer = setTimeout(() => { resolve('late'); }, timeoutMs); });
    try {
      const ended = await Promise.race([(async () => { await step(); })(), late]);
      if (ended === 'late') this.failures.push(new Error(`${what} did not finish within ${timeoutMs} ms`));
    } catch (error) {
      this.failures.push(error);
    } finally {
      clearTimeout(timer);
    }
  }

  #context(participant: Participant): ModuleContext {
    const {clock = {now: () => Date.now()}, scheduler = timers, stateDir} = this.#options;
    const live = (): void => { if (this.#stopping !== undefined) throw stopped(); };
    const record = (level: HarnessRecord['level']) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => {
      this.logs.push({level, event, fields, ...(trace === undefined ? {} : {trace})});
    };
    const log: Logger = {debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error')};
    const spans = this.#options.spans ?? noSpans;
    const named = {'bunny.module': this.name};
    const workerCalls = new WorkerCalls({scheduler, signal: this.#controller.signal, track: worker => { this.#track(worker); }});
    return {
      sdk: calls(participant, context => { this.received.push({traceparent: context.traceparent}); }, this.sent),
      log,
      trace: {
        span: parent => childOf(parent),
        start: (name, options = {}) => startSpan(spans, name, {...options, attributes: {...options.attributes, ...named}}),
      },
      clock: {now: () => clock.now()},
      scheduler: {after: (delayMs, callback) => {
        live();
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) throw new RangeError(`delayMs must be an integer from 0 to ${MAX_DELAY_MS}`);
        let inner: Cancel = () => {};
        const cancel: Cancel = () => {
          inner();
          this.#timers.delete(cancel);
        };
        inner = scheduler.after(delayMs, () => {
          this.#timers.delete(cancel);
          void (async () => { await callback(); })().catch((error: unknown) => { this.failures.push(error); });
        });
        this.#timers.add(cancel);
        return cancel;
      }},
      workers: {
        start: (file: URL, options?: WorkerOptions) => {
          live();
          const worker = new Worker(file, options);
          this.#track(worker);
          worker.on('error', error => { this.failures.push(error); });
          return worker;
        },
        call: <Reply>(file: URL, request: unknown, options: WorkerCallOptions) => workerCalls.call<Reply>(file, request, options),
      },
      database: () => {
        live();
        if (this.#database === undefined) {
          // Opened as the runtime opens it (Hub #972), so a module's tests commit as it will.
          this.#database = openModuleDatabaseFile(join(stateDir, `${this.#module.manifest.name}.sqlite`));
        }
        return this.#database;
      },
      config: this.#config,
      secrets: {read: name => this.#readSecret(name)},
      files: () => {
        live();
        const folder = join(stateDir, this.name);
        mkdirSync(folder, {recursive: true, mode: 0o700});
        return folder;
      },
      signal: this.#controller.signal,
    };
  }

  /** A secret's text from memory, as the runtime reads one from its file: without trailing line breaks. */
  #readSecret(name: string): Promise<string> {
    if (this.#stopping !== undefined) return Promise.reject(stopped());
    if (!this.#secrets.has(name)) return Promise.reject(missingSecret('the configuration names no such secret'));
    const {secrets} = this.#options;
    const text = secrets !== undefined && Object.hasOwn(secrets, name) ? secrets[name] : undefined;
    if (text === undefined) return Promise.reject(missingSecret('the secret file is missing'));
    return Promise.resolve(text.replace(/[\r\n]+$/, ''));
  }

  #track(worker: Worker): void {
    this.#workers.add(worker);
    worker.once('exit', () => { this.#workers.delete(worker); });
  }
}
