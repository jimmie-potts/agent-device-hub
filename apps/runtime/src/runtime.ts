// The runtime (ADR 0012, "Runtime and transport"): one process, one in-process bus and a fixed list of modules, with a
// loopback health endpoint. It runs with zero modules.
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MODULE_API_VERSION, type BunnyModule, type Clock, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHost, type ModuleHealth} from './host.js';
import {LogWriter, stderrSink, type LogLevel, type LogSink} from './log.js';
import {prepareStateDirectory} from './state.js';

export type {ModuleHealth, ModuleState} from './host.js';

export const HEALTH_PATH = '/api/runtime/v1/health';
const HOST = '127.0.0.1';

export type RuntimeHealth = {
  schema: 'runtime-health/1.0';
  /** `ok` when every module runs; `degraded` when one is refused, failed or not yet running. */
  status: 'ok' | 'degraded';
  /** The module API version this runtime supports. */
  moduleApiVersion: string;
  startedAtMs: number;
  uptimeMs: number;
  /** The whole process's memory, from `process.memoryUsage()`. */
  memory: {rssBytes: number; heapTotalBytes: number; heapUsedBytes: number; externalBytes: number};
  modules: ModuleHealth[];
};

export type RuntimeOptions = {
  /** The modules to host, in order. The service process passes the shipped list. */
  modules: readonly BunnyModule[];
  /** The private state directory. It is created owner-only when missing; see `prepareStateDirectory`. */
  stateDir: string;
  /** The loopback port for health. 0 picks a free port. */
  port: number;
  /** The clock for the bus, the modules and log records. Defaults to `Date.now()`. */
  clock?: Clock;
  /** Runs SDK deadlines, module timers and the start and stop deadlines. Defaults to the global `setTimeout`. */
  scheduler?: Scheduler;
  /** Receives each log record. Defaults to one JSON line on stderr. */
  log?: LogSink;
  /** The lowest level written. Defaults to `info`. */
  logLevel?: LogLevel;
  /** How long a module's start may take before the module fails. Defaults to 10 s. */
  startTimeoutMs?: number;
  /** How long a module's participant close and stop may take. Defaults to 5 s. */
  stopTimeoutMs?: number;
};

export interface Runtime {
  /** The health server's origin, such as `http://127.0.0.1:41000`. */
  readonly url: string;
  health(): RuntimeHealth;
  /** Stops every module within its stop deadline, then the health server. Calling it again returns the same promise. */
  stop(): Promise<void>;
}

const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

function serve(port: number, health: () => RuntimeHealth): Promise<Server> {
  const server = createServer((request, response) => {
    const found = request.method === 'GET' && request.url === HEALTH_PATH;
    const body = found ? health() : errorBody('not-found', {detail: 'no such route'});
    response.writeHead(found ? 200 : 404, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(body));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({host: HOST, port}, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => { resolve(); });
    server.closeAllConnections();
  });
}

/** Prepares the state directory, serves health, then starts the modules and resolves when each start has settled. */
export async function startRuntime(options: RuntimeOptions): Promise<Runtime> {
  const {modules, port, startTimeoutMs = 10_000, stopTimeoutMs = 5_000} = options;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new RangeError('port must be an integer from 0 to 65535');
  const clock = options.clock ?? {now: () => Date.now()};
  const scheduler = options.scheduler ?? timers;
  const logs = new LogWriter(options.log ?? stderrSink, options.logLevel ?? 'info', clock);
  const log = logs.logger('bunny.runtime');
  const stateDir = await prepareStateDirectory(options.stateDir);
  const host = new ModuleHost(modules, {clock, scheduler, stateDir, logs, startTimeoutMs, stopTimeoutMs});
  const startedAtMs = clock.now();
  const health = (): RuntimeHealth => {
    const modulesHealth = host.health();
    const {rss, heapTotal, heapUsed, external} = process.memoryUsage();
    return {
      schema: 'runtime-health/1.0', status: modulesHealth.every(module => module.healthy) ? 'ok' : 'degraded',
      moduleApiVersion: MODULE_API_VERSION, startedAtMs, uptimeMs: Math.max(0, clock.now() - startedAtMs),
      memory: {rssBytes: rss, heapTotalBytes: heapTotal, heapUsedBytes: heapUsed, externalBytes: external},
      modules: modulesHealth,
    };
  };
  const server = await serve(port, health);
  const url = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  log.info('runtime.started', {'bunny.url': url, 'bunny.modules': modules.length});
  await host.start();
  let stopping: Promise<void> | undefined;
  return {
    url,
    health,
    stop: () => stopping ??= (async () => {
      await host.stop();
      await close(server);
      log.info('runtime.stopped');
    })(),
  };
}
