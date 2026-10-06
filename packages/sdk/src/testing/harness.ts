// Stub: the kit's tests are written first (#882).
import type {InProcessBus} from '../in-process.js';
import type {BunnyModule, LogFields} from '../module.js';
import type {Clock, Scheduler} from '../sdk.js';

export type HarnessOptions = {bus: InProcessBus; stateDir: string; clock?: Clock; scheduler?: Scheduler};
export type HarnessRecord = {level: 'debug' | 'info' | 'warn' | 'error'; event: string; fields: LogFields};

export class ModuleHarness {
  readonly logs: HarnessRecord[] = [];
  readonly failures: unknown[] = [];
  readonly source: string;

  constructor(module: BunnyModule, _options: HarnessOptions) {
    this.source = `bunny/modules/${module.manifest.name}`;
  }

  start(): Promise<void> {
    return Promise.reject(new Error('not built yet'));
  }

  stop(): Promise<void> {
    return Promise.reject(new Error('not built yet'));
  }

  pendingTimers(): number {
    return -1;
  }

  runningWorkers(): number {
    return -1;
  }

  databaseOpen(): boolean {
    return true;
  }
}
