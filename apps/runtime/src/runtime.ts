// The runtime (ADR 0012, "Runtime and transport"): one process, one in-process bus and a fixed list of modules, with a
// loopback health endpoint. It runs with zero modules.
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MODULE_API_VERSION, type BunnyModule, type Clock, type Scheduler} from '@jimmie-potts/sdk';
import {ModuleHost, type ModuleHealth} from './host.js';
import {LogWriter, errorFields, stderrSink, type LogLevel, type LogSink} from './log.js';
import {RuntimeError, prepareStateDirectory} from './state.js';
import {startWatchdog, type Watchdog} from './watchdog.js';

export type {ModuleHealth, ModuleState} from './host.js';

export const HEALTH_PATH = '/api/runtime/v1/health';
const HOST = '127.0.0.1';

export type RuntimeHealth = {
  schema: 'runtime-health/1.0';
  /** `ok` when every module runs and the lag check, if any, is active; `degraded` otherwise. */
  status: 'ok' | 'degraded';
  /** The module API version this runtime supports. */
  moduleApiVersion: string;
  startedAtMs: number;
  uptimeMs: number;
  /** The whole process's memory, from `process.memoryUsage()`. */
  memory: {rssBytes: number; heapTotalBytes: number; heapUsedBytes: number; externalBytes: number};
  /** The event-loop lag check: `off` without one, `stopped` when its watchdog ended without being asked to. */
  lagCheck: {status: 'off'} | {status: 'active' | 'stopped'; limitMs: number};
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
  /** Runs the event-loop lag check with this limit. `worker` replaces the watchdog thread's file, for tests. */
  lagCheck?: {limitMs: number; worker?: URL};
  /** Not built yet (#920). */
  simulate?: boolean;
  /** Not built yet (#920). */
  edge?: {schemas: Readonly<Record<string, object>>};
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

/**
 * Serves health on loopback. A request must name this listener as its host and carry no browser origin or cross-site
 * fetch metadata, as the Hub and local controllers require, so that a page on a rebinding name cannot read it.
 */
function serve(port: number, health: () => RuntimeHealth): Promise<Server> {
  let hosts: readonly string[] = [];
  const server = createServer((request, response) => {
    const site = request.headers['sec-fetch-site'];
    // A host name is not case-sensitive; the port must match exactly.
    const host = (request.headers.host ?? '').toLowerCase();
    const local = hosts.includes(host) && request.headers.origin === undefined && (site === undefined || site === 'none');
    const found = request.method === 'GET' && request.url === HEALTH_PATH;
    const [status, body] = !local ? [403, errorBody('forbidden', {detail: 'health answers only local requests that name this listener'})]
      : found ? [200, health()] : [404, errorBody('not-found', {detail: 'no such route'})];
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(body));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({host: HOST, port}, () => {
      server.off('error', reject);
      const bound = (server.address() as AddressInfo).port;
      hosts = [`${HOST}:${bound}`, `localhost:${bound}`];
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
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new RuntimeError('port-invalid', 'port must be an integer from 0 to 65535');
  const clock = options.clock ?? {now: () => Date.now()};
  const scheduler = options.scheduler ?? timers;
  const logs = new LogWriter(options.log ?? stderrSink, options.logLevel ?? 'info', clock);
  const log = logs.logger('bunny.runtime');
  const stateDir = await prepareStateDirectory(options.stateDir);
  const host = new ModuleHost(modules, {clock, scheduler, stateDir, logs, startTimeoutMs, stopTimeoutMs});
  const startedAtMs = clock.now();
  let lagCheck: RuntimeHealth['lagCheck'] = {status: 'off'};
  const health = (): RuntimeHealth => {
    const modulesHealth = host.health();
    const {rss, heapTotal, heapUsed, external} = process.memoryUsage();
    const ok = modulesHealth.every(module => module.healthy) && lagCheck.status !== 'stopped';
    return {
      schema: 'runtime-health/1.0', status: ok ? 'ok' : 'degraded',
      moduleApiVersion: MODULE_API_VERSION, startedAtMs, uptimeMs: Math.max(0, clock.now() - startedAtMs),
      memory: {rssBytes: rss, heapTotalBytes: heapTotal, heapUsedBytes: heapUsed, externalBytes: external},
      lagCheck,
      modules: modulesHealth,
    };
  };
  const server = await serve(port, health);
  const url = `http://${HOST}:${(server.address() as AddressInfo).port}`;
  let watchdog: Watchdog | undefined;
  if (options.lagCheck !== undefined) {
    const {limitMs, worker} = options.lagCheck;
    lagCheck = {status: 'active', limitMs};
    // Started before the modules, so that a start that blocks the event loop is caught too.
    watchdog = startWatchdog(limitMs, {
      failed: error => { log.error('runtime.watchdog.failed', errorFields(error)); },
      stopped: exitCode => {
        lagCheck = {status: 'stopped', limitMs};
        log.error('runtime.watchdog.stopped', {'bunny.exit_code': exitCode});
      },
    }, worker);
  }
  log.info('runtime.started', {'bunny.url': url, 'bunny.modules': modules.length});
  await host.start();
  let stopping: Promise<void> | undefined;
  return {
    url,
    health,
    stop: () => stopping ??= (async () => {
      await host.stop();
      await Promise.all([close(server), watchdog?.stop()]);
      log.info('runtime.stopped');
    })(),
  };
}
