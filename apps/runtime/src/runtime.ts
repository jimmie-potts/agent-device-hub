// The runtime (ADR 0012, "Runtime and transport"): one process, one in-process bus and a fixed list of modules, with a
// loopback health endpoint. It runs with zero modules. With an edge (#920), remote parts make the SDK calls over SSE and
// HTTP on the same listener, each with a grant from the state directory.
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {MODULE_API_VERSION, REMOTE_PATH, RemoteEdge, SdkError, type BunnyModule, type Clock, type Scheduler} from '@jimmie-potts/sdk';
import {diagnosticWriter} from './diagnostics.js';
import {ModuleHost, type ModuleHealth} from './host.js';
import {INSTANCE_ID, LogWriter, errorFields, stderrSink, type LogLevel, type LogSink} from './log.js';
import {RUNTIME_SCOPE, runtimeResource, type Environment} from './record.js';
import {RuntimeError, prepareStateDirectory, readEdgeGrants, type EdgeGrant} from './state.js';
import {startTracing, type SpanSink} from './tracing.js';
import {startWatchdog, type Watchdog} from './watchdog.js';

export {REGISTRY_REASONS} from './diagnostics.js';
export type {ModuleHealth, ModuleState} from './host.js';
export type {SpanSink} from './tracing.js';

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
  /**
   * Receives each finished span of the bus and the modules as one projected OTLP JSON document, through the observability
   * package's bounded queue (Hub #949). Without it, the runtime keeps the latest `RECENT_SPANS` for `spans()`.
   */
  spans?: SpanSink;
  /** The lowest level written. Defaults to `info`. */
  logLevel?: LogLevel;
  /** Every record's `deployment.environment.name`. Defaults to `development`. */
  environment?: Environment;
  /** How long a module's start may take before the module fails. Defaults to 10 s. */
  startTimeoutMs?: number;
  /** How long a module's participant close and stop may take. Defaults to 5 s. */
  stopTimeoutMs?: number;
  /** Runs the event-loop lag check with this limit. `worker` replaces the watchdog thread's file, for tests. */
  lagCheck?: {limitMs: number; worker?: URL};
  /** The modules were built with their simulated transports (`--simulate`); the `runtime.started` record says so. */
  simulate?: boolean;
  /**
   * Serves the SDK edge on the health listener once every module has started, with the grants in the state
   * directory's `edge-grants.json` (`readEdgeGrants`). `schemas` are the modules' own payload schemas; the edge checks
   * remote parts' messages against them and the core families. `onServing` is called with the edge once it serves, so
   * that a verification run can drop a part's stream as a lost connection would (#920).
   */
  edge?: {schemas: Readonly<Record<string, object>>; onServing?: (edge: RemoteEdge) => void};
};

export interface Runtime {
  /** The health server's origin, such as `http://127.0.0.1:41000`. */
  readonly url: string;
  health(): RuntimeHealth;
  /** The latest finished spans, oldest first, when no `spans` sink was given; empty otherwise. */
  spans(): readonly string[];
  /** Stops every module within its stop deadline, then the health server. Calling it again returns the same promise. */
  stop(): Promise<void>;
}

const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/** How many finished spans the runtime keeps in memory when it has no span sink: the contract's queue bound. */
export const RECENT_SPANS = 1024;

/**
 * Where the listener sends the SDK edge's routes: nowhere without an edge, the edge while it serves, and a refusal while
 * the modules start or the runtime stops.
 */
type EdgeRoute = {state: 'off'} | {state: 'starting'} | {state: 'serving'; edge: RemoteEdge} | {state: 'stopping'};
const UNAVAILABLE: Readonly<Record<'starting' | 'stopping', string>> = {
  starting: 'the edge serves once every module has started',
  stopping: 'the runtime is stopping',
};

/**
 * Serves health, and the SDK edge when there is one, on loopback. A request must name this listener as its host and
 * carry no browser origin or cross-site fetch metadata, as the Hub and local controllers require, so that a page on a
 * rebinding name cannot read it or reach the edge.
 */
function serve(port: number, health: () => RuntimeHealth, edge: () => EdgeRoute): Promise<Server> {
  let hosts: readonly string[] = [];
  const answer = (response: ServerResponse, status: number, body: object): void => {
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify(body));
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const site = request.headers['sec-fetch-site'];
    // A host name is not case-sensitive; the port must match exactly.
    const host = (request.headers.host ?? '').toLowerCase();
    const local = hosts.includes(host) && request.headers.origin === undefined && (site === undefined || site === 'none');
    const route = edge();
    const remote = route.state !== 'off' && (request.url ?? '').startsWith(`${REMOTE_PATH}/`);
    if (!local) {
      answer(response, 403, errorBody('forbidden', {detail: `${remote ? 'the edge' : 'health'} answers only local requests that name this listener`}));
      return;
    }
    if (remote) {
      if (route.state === 'serving') route.edge.handle(request, response);
      else answer(response, 503, errorBody('unavailable', {detail: UNAVAILABLE[route.state]}));
      return;
    }
    const found = request.method === 'GET' && request.url === HEALTH_PATH;
    if (found) answer(response, 200, health());
    else answer(response, 404, errorBody('not-found', {detail: 'no such route'}));
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

/** The edge's validator: profile 2.0, the core families and the modules' own payload schemas. */
function edgeValidator(schemas: Readonly<Record<string, object>>): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  for (const [dataschema, schema] of Object.entries(schemas)) validator.register(dataschema, schema);
  return validator;
}

/**
 * Prepares the state directory and reads the edge's grants, if any, serves health, then starts the modules and
 * resolves when each start has settled. The edge serves only once every start has settled.
 */
export async function startRuntime(options: RuntimeOptions): Promise<Runtime> {
  const {modules, port, startTimeoutMs = 10_000, stopTimeoutMs = 5_000} = options;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new RuntimeError('port-invalid', 'port must be an integer from 0 to 65535');
  const clock = options.clock ?? {now: () => Date.now()};
  const scheduler = options.scheduler ?? timers;
  const logs = new LogWriter(options.log ?? stderrSink, options.logLevel ?? 'info', clock, runtimeResource(options.environment ?? 'development', INSTANCE_ID));
  const log = logs.logger(RUNTIME_SCOPE);
  const stateDir = await prepareStateDirectory(options.stateDir);
  const grants: EdgeGrant[] | undefined = options.edge === undefined ? undefined : await readEdgeGrants(stateDir);
  const validator = options.edge === undefined ? undefined : edgeValidator(options.edge.schemas);
  // Spans go to the given sink, or stay in memory, the latest first to go.
  const recent: string[] = [];
  const keep: SpanSink = line => {
    recent.push(line);
    if (recent.length > RECENT_SPANS) recent.shift();
  };
  const tracing = await startTracing(logs.resource, options.spans ?? keep);
  const host = new ModuleHost(modules, {clock, scheduler, stateDir, logs, startTimeoutMs, stopTimeoutMs, ...(tracing === undefined ? {} : {tracing})});
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
  let edge: EdgeRoute = {state: grants === undefined ? 'off' : 'starting'};
  let server: Server;
  try {
    server = await serve(port, health, () => edge);
  } catch (error) {
    await tracing?.shutdown();
    throw error;
  }
  const bound = (server.address() as AddressInfo).port;
  const url = `http://${HOST}:${bound}`;
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
    }, worker, logs.resource);
  }
  // `bunny.edge` says the edge is configured; `runtime.edge.serving` follows once it serves.
  // A record carries the listener's port, never its URL.
  log.info('runtime.started', {'server.port': bound, 'bunny.module_count': modules.length, 'bunny.simulate': options.simulate === true, 'bunny.edge': grants !== undefined});
  await host.start();
  if (grants !== undefined && validator !== undefined) {
    let mounted: RemoteEdge;
    try {
      mounted = new RemoteEdge({bus: host.bus, validator, grants, onDiagnostic: diagnosticWriter(log), now: () => clock.now(), scheduler});
    } catch (error) {
      // The grants were checked when read; the edge refuses only what they could not show, such as a malformed one.
      await host.stop();
      await close(server);
      await tracing?.shutdown();
      throw error instanceof SdkError ? new RuntimeError('edge-grants-invalid', 'the edge refused the grants') : error;
    }
    edge = {state: 'serving', edge: mounted};
    log.info('runtime.edge.serving', {'server.port': bound, 'bunny.grant_count': grants.length});
    options.edge?.onServing?.(mounted);
  }
  let stopping: Promise<void> | undefined;
  return {
    url,
    health,
    spans: () => [...recent],
    stop: () => stopping ??= (async () => {
      // Remote parts go first, so none acts on a module that is stopping. Until the listener closes, the edge's routes
      // answer that the runtime is stopping.
      const serving = edge;
      if (serving.state !== 'off') edge = {state: 'stopping'};
      if (serving.state === 'serving') await serving.edge.close();
      await host.stop();
      await Promise.all([close(server), watchdog?.stop()]);
      // The modules' work has ended, so its spans have too: flush them within the contract's bound.
      await tracing?.shutdown();
      // The records this runtime's writer dropped or its sink lost, and the spans lost, so the journal shows the loss.
      const {dropped, failed} = logs.counts();
      const spans = tracing?.counts() ?? {dropped: 0, failed: 0};
      log.info('runtime.stopped', {
        'bunny.telemetry.dropped_count': Math.min(Number.MAX_SAFE_INTEGER, dropped + spans.dropped),
        'bunny.telemetry.failure_count': Math.min(Number.MAX_SAFE_INTEGER, failed + spans.failed),
      });
    })(),
  };
}
