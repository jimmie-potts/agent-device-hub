// Hosts one module for a test, as the runtime would (ADR 0012, "Runtime and transport"): its own participant on a
// given bus, a context, and a stop that releases everything in the runtime's order. A module's tests cannot import the
// runtime, so the kit hosts modules with this.
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Worker, type WorkerOptions} from 'node:worker_threads';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {InProcessBus} from '../in-process.js';
import type {BunnyModule, LogFields, Logger, ModuleContext} from '../module.js';
import {SdkError, type Cancel, type Clock, type Participant, type Scheduler, type TraceContext} from '../sdk.js';
import {childOf} from '../trace.js';

export type HarnessOptions = {
  /** The bus the module joins, with source `bunny/modules/<name>`. */
  bus: InProcessBus;
  /** Where the module's SQLite file, `<name>.sqlite`, lives. A new harness on the same directory keeps the file. */
  stateDir: string;
  /** Defaults to `Date.now()`. */
  clock?: Clock;
  /** Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
};
export type HarnessRecord = {level: 'debug' | 'info' | 'warn' | 'error'; event: string; fields: LogFields; trace?: TraceContext};

// setTimeout's longest delay; a longer one would fire at once.
const MAX_DELAY_MS = 2_147_483_647;
const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};
const stopped = (): SdkError => new SdkError(errorBody('invalid-state', {detail: 'the module has stopped'}));

export class ModuleHarness {
  /** The module's log records. */
  readonly logs: HarnessRecord[] = [];
  /** Errors from the module's timer callbacks and workers, which the runtime would fail the module for. */
  readonly failures: unknown[] = [];
  readonly source: string;
  readonly #module: BunnyModule;
  readonly #options: HarnessOptions;
  readonly #controller = new AbortController();
  readonly #timers = new Set<Cancel>();
  readonly #workers = new Set<Worker>();
  #participant: Participant | undefined;
  #database: DatabaseSync | undefined;
  #stopping: Promise<void> | undefined;

  constructor(module: BunnyModule, options: HarnessOptions) {
    this.#module = module;
    this.#options = options;
    this.source = `bunny/modules/${module.manifest.name}`;
  }

  /** Connects the module's participant and runs its start. */
  async start(): Promise<void> {
    if (this.#participant !== undefined) throw new SdkError(errorBody('invalid-state', {detail: 'the module has started'}));
    this.#participant = this.#options.bus.connect(this.source);
    await this.#module.start(this.#context(this.#participant));
  }

  /**
   * Stops the module as the runtime does: its signal aborts, its timers are cancelled and its participant closes, then
   * its `stop` runs, its workers end and its database closes. Calling it again returns the same promise.
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

  async #stop(): Promise<void> {
    this.#controller.abort();
    for (const cancel of [...this.#timers]) cancel();
    await this.#participant?.close();
    await this.#module.stop();
    await Promise.allSettled([...this.#workers].map(worker => worker.terminate()));
    if (this.#database?.isOpen === true) this.#database.close();
  }

  #context(participant: Participant): ModuleContext {
    const {clock = {now: () => Date.now()}, scheduler = timers, stateDir} = this.#options;
    const live = (): void => { if (this.#stopping !== undefined) throw stopped(); };
    const record = (level: HarnessRecord['level']) => (event: string, fields: LogFields = {}, trace?: TraceContext): void => {
      this.logs.push({level, event, fields, ...(trace === undefined ? {} : {trace})});
    };
    const log: Logger = {debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error')};
    return {
      sdk: participant,
      log,
      trace: {span: parent => childOf(parent)},
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
      workers: {start: (file: URL, options?: WorkerOptions) => {
        live();
        const worker = new Worker(file, options);
        this.#workers.add(worker);
        worker.on('error', error => { this.failures.push(error); });
        worker.once('exit', () => { this.#workers.delete(worker); });
        return worker;
      }},
      database: () => {
        live();
        if (this.#database === undefined) {
          this.#database = new DatabaseSync(join(stateDir, `${this.#module.manifest.name}.sqlite`));
          this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL');
        }
        return this.#database;
      },
      signal: this.#controller.signal,
    };
  }
}
