// The runtime (ADR 0012, "Runtime and transport"): one process, one in-process bus and a fixed list of modules.
import type {BunnyModule, Clock, Scheduler} from '@jimmie-potts/sdk';
import type {LogLevel, LogRecord} from './log.js';

export const HEALTH_PATH = '/api/runtime/v1/health';

export type ModuleState = 'refused' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
export type ModuleHealth = {name: string; apiVersion: string; state: ModuleState; healthy: boolean; reason?: {code: string; detail: string}};
export type RuntimeHealth = {
  schema: 'runtime-health/1.0';
  status: 'ok' | 'degraded';
  moduleApiVersion: string;
  startedAtMs: number;
  uptimeMs: number;
  memory: {rssBytes: number; heapTotalBytes: number; heapUsedBytes: number; externalBytes: number};
  modules: ModuleHealth[];
};

export type RuntimeOptions = {
  modules: readonly BunnyModule[];
  stateDir: string;
  port: number;
  clock?: Clock;
  scheduler?: Scheduler;
  log?: (record: LogRecord) => void;
  logLevel?: LogLevel;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
};

export interface Runtime {
  readonly url: string;
  health(): RuntimeHealth;
  contain(error: unknown): boolean;
  stop(): Promise<void>;
}

export function startRuntime(_options: RuntimeOptions): Promise<Runtime> {
  return Promise.reject(new Error('not implemented'));
}
