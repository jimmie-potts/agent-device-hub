// The runtime (ADR 0012, "Runtime and transport"): one process, one in-process bus and a fixed list of modules, with a
// loopback health endpoint. It runs with zero modules. With an edge (#920), its gateway (#835) serves the SDK edge, the
// `/api/v2` routes, MCP, the modules' pages and browser sign-in on the same listener, for the client credentials and
// browser sessions its configuration file's `edge` section grants.
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {MODULE_API_VERSION, type BunnyModule, type Clock, type RemoteEdge, type Scheduler} from '@jimmie-potts/sdk';
import {readEdgeCredentials, type EdgeCredential} from './credentials.js';
import {Gateway, readableFamilies} from './gateway/gateway.js';
import {ModuleHost, type ModuleHealth} from './host.js';
import {INSTANCE_ID, LogWriter, errorFields, stderrSink, type LogLevel, type LogSink, type Redactions} from './log.js';
import {RUNTIME_SCOPE, runtimeResource, type Environment} from './record.js';
import {openSpanFile} from './span-file.js';
import {RuntimeError, prepareStateDirectory, readRuntimeConfig, type RuntimeConfig} from './state.js';
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
  /** The modules to host, in order. The service process passes the shipped list, whose first module is the core. */
  modules: readonly BunnyModule[];
  /**
   * Hears that the core failed (Hub #831). The service process ends with a failure exit, so the service manager restarts
   * the runtime; without it, the core stays failed as any other module would.
   */
  onCoreFailure?: (error: unknown) => void;
  /** The private state directory. It is created owner-only when missing; see `prepareStateDirectory`. */
  stateDir: string;
  /**
   * The private configuration file (`--config`) that holds each module's own section, read before the runtime serves;
   * see `readRuntimeConfig`. Without one, a module that declares `configure` is refused.
   */
  configFile?: string;
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
   * package's bounded queue (Hub #949). `'state-file'` writes them to the state directory's bounded, private span file,
   * which a disposable run reads from outside the process (Hub #950). Without it, the runtime keeps the latest
   * `RECENT_SPANS` for `spans()`, and counts the older ones it lets go.
   */
  spans?: SpanSink | 'state-file';
  /** The lowest level written. Defaults to `info`. */
  logLevel?: LogLevel;
  /**
   * The registry of secrets the modules read, which no record may carry. The service process passes the one its own
   * writer uses, so its `runtime.failed` record leaves them out too. Defaults to one of the runtime's own.
   */
  redactions?: Redactions;
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
   * Serves the gateway (#835) on the health listener once every module has started: the SDK edge, the `/api/v2` routes,
   * MCP, the modules' pages and browser sign-in, for the client credentials in the file that the configuration file's
   * `edge` section names. `schemas` are the modules' own payload schemas; the edge checks remote parts' messages against
   * them and the core families. `onServing` is called with the edge once it serves, so that a verification run can drop
   * a part's stream as a lost connection would (#920). `liveness` sets the edge's heartbeat and stall limits, for tests.
   */
  edge?: {
    schemas: Readonly<Record<string, object>>; onServing?: (edge: RemoteEdge) => void;
    liveness?: {heartbeatMs?: number; stallMs?: number; scheduler?: Scheduler};
  };
};

export interface Runtime {
  /** The health server's origin, such as `http://127.0.0.1:41000`. */
  readonly url: string;
  health(): RuntimeHealth;
  /** The spans kept in memory when no `spans` destination was given; with one, none, and none evicted. */
  spans(): RecentSpans;
  /** Stops every module within its stop deadline, then the health server. Calling it again returns the same promise. */
  stop(): Promise<void>;
  /**
   * Reads the edge's credentials file again (#835), as SIGHUP asks the service process to: a credential granted since
   * is taken, and one revoked or changed has its streams ended and its next call refused. A file the runtime refuses
   * keeps the credentials it had, and rejects with its `RuntimeError`. Without an edge, it does nothing.
   */
  reload(): Promise<void>;
  /** The gateway, while it serves: its edge and its callers, for verification runs and tests. */
  gateway(): Gateway | undefined;
}

const timers: Scheduler = {after: (delayMs, callback) => {
  const timer = setTimeout(callback, delayMs);
  return () => { clearTimeout(timer); };
}};

/** How many finished spans the runtime keeps in memory when it has no span sink: the contract's queue bound. */
export const RECENT_SPANS = 1024;

/**
 * The latest `RECENT_SPANS` finished spans, oldest first, and how many older ones the runtime let go to keep that
 * bound. A span that is not in `recent` was evicted only while `evicted` is above 0; otherwise it never reached memory.
 */
export type RecentSpans = {recent: readonly string[]; evicted: number};

/**
 * Where the listener sends every route but health: nowhere without an edge, the gateway while it serves, and a refusal
 * while the modules start or the runtime stops.
 */
type GatewayRoute = {state: 'off'} | {state: 'starting'} | {state: 'serving'; gateway: Gateway} | {state: 'stopping'};
const UNAVAILABLE: Readonly<Record<'starting' | 'stopping', string>> = {
  starting: 'the gateway serves once every module has started',
  stopping: 'the runtime is stopping',
};

/**
 * Serves health, and the gateway when there is one, on loopback. Every request must name this listener as its host,
 * so that a page on a rebinding name reaches nothing. Health also takes no browser origin or cross-site fetch
 * metadata, as the Hub and local controllers require; the gateway checks each caller's own (#835).
 */
function serve(port: number, health: () => RuntimeHealth, gateway: () => GatewayRoute): Promise<Server> {
  let hosts: readonly string[] = [];
  const answer = (response: ServerResponse, status: number, body: object): void => {
    response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}).end(JSON.stringify(body));
  };
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const site = request.headers['sec-fetch-site'];
    // A host name is not case-sensitive; the port must match exactly.
    const host = (request.headers.host ?? '').toLowerCase();
    const route = gateway();
    const isHealth = (request.url ?? '').split('?')[0] === HEALTH_PATH;
    if (!hosts.includes(host)) {
      answer(response, 403, errorBody('forbidden', {detail: isHealth || route.state === 'off' ? 'health answers only local requests that name this listener' : 'the gateway answers only requests that name this listener'}));
      return;
    }
    if (isHealth || route.state === 'off') {
      const local = request.headers.origin === undefined && (site === undefined || site === 'none');
      if (!local) answer(response, 403, errorBody('forbidden', {detail: 'health answers only local requests that name this listener'}));
      else if (request.method === 'GET' && request.url === HEALTH_PATH) answer(response, 200, health());
      else answer(response, 404, errorBody('not-found', {detail: 'no such route'}));
      return;
    }
    if (route.state === 'serving') route.gateway.handle(request, response);
    else answer(response, 503, errorBody('unavailable', {detail: UNAVAILABLE[route.state]}));
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

/**
 * The edge's validator: profile 2.0, the core families, the device families that every device module answers (#918,
 * #928), and the modules' own payload schemas.
 */
function edgeValidator(schemas: Readonly<Record<string, object>>): MessageValidator {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  registerDeviceFamilies(validator);
  for (const [dataschema, schema] of Object.entries(schemas)) validator.register(dataschema, schema);
  return validator;
}

/**
 * Prepares the state directory and reads the configuration file and the edge's grants, if any, serves health, then
 * admits and starts the modules and resolves when each start has settled. The edge serves only once every start has
 * settled.
 */
export async function startRuntime(options: RuntimeOptions): Promise<Runtime> {
  const {modules, port, startTimeoutMs = 10_000, stopTimeoutMs = 5_000} = options;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new RuntimeError('port-invalid', 'port must be an integer from 0 to 65535');
  const clock = options.clock ?? {now: () => Date.now()};
  const scheduler = options.scheduler ?? timers;
  const logs = new LogWriter(
    options.log ?? stderrSink, options.logLevel ?? 'info', clock, runtimeResource(options.environment ?? 'development', INSTANCE_ID), options.redactions,
  );
  const log = logs.logger(RUNTIME_SCOPE);
  const stateDir = await prepareStateDirectory(options.stateDir);
  const config: RuntimeConfig | undefined = options.configFile === undefined ? undefined : await readRuntimeConfig(options.configFile);
  const edgeConfig = config?.edge;
  if (options.edge !== undefined && edgeConfig === undefined) {
    throw new RuntimeError('edge-config-missing', 'the edge needs the configuration file\'s edge section, which names its credentials');
  }
  const credentials: EdgeCredential[] | undefined = options.edge === undefined || edgeConfig === undefined ? undefined : await readEdgeCredentials(edgeConfig.credentials);
  const validator = options.edge === undefined ? undefined : edgeValidator(options.edge.schemas);
  // Spans go to the given sink, or stay in memory: the oldest goes first, and is counted.
  const recent: string[] = [];
  let evicted = 0;
  const keep: SpanSink = line => {
    recent.push(line);
    if (recent.length <= RECENT_SPANS) return;
    recent.shift();
    evicted = Math.min(Number.MAX_SAFE_INTEGER, evicted + 1);
  };
  const spanFile = options.spans === 'state-file' ? openSpanFile(stateDir) : undefined;
  const sink = spanFile?.sink ?? (typeof options.spans === 'function' ? options.spans : keep);
  const tracing = await startTracing(logs.resource, sink, log);
  // Ends the host adapter, which flushes spans to the sink within the contract's bound, and then the file.
  const endTracing = async (): Promise<void> => {
    try {
      await tracing?.shutdown();
    } finally {
      spanFile?.close();
    }
  };
  const host = new ModuleHost(modules, {
    clock, scheduler, stateDir, logs, startTimeoutMs, stopTimeoutMs, ...(tracing === undefined ? {} : {tracing}), ...(config === undefined ? {} : {config}),
    ...(options.onCoreFailure === undefined ? {} : {onCoreFailure: options.onCoreFailure}),
  });
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
  let edge: GatewayRoute = {state: credentials === undefined ? 'off' : 'starting'};
  let server: Server;
  try {
    server = await serve(port, health, () => edge);
  } catch (error) {
    await endTracing();
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
  log.info('runtime.started', {'server.port': bound, 'bunny.module_count': modules.length, 'bunny.simulate': options.simulate === true, 'bunny.edge': credentials !== undefined});
  await host.start();
  if (credentials !== undefined && validator !== undefined && edgeConfig !== undefined && options.edge !== undefined) {
    const gateway = new Gateway({
      bus: host.bus, host, validator, families: readableFamilies(options.edge.schemas), edge: edgeConfig, credentials, log, redactions: logs.redactions,
      clock, scheduler, stateDir, ...(options.edge.liveness === undefined ? {} : {liveness: options.edge.liveness}),
    });
    try {
      await gateway.start(url, [`${HOST}:${bound}`, `localhost:${bound}`]);
    } catch (error) {
      await gateway.close();
      await host.stop();
      await close(server);
      await endTracing();
      throw error;
    }
    edge = {state: 'serving', gateway};
    log.info('runtime.edge.serving', {'server.port': bound, 'bunny.grant_count': credentials.length});
    options.edge.onServing?.(gateway.edge);
  }
  let stopping: Promise<void> | undefined;
  let reloading: Promise<void> = Promise.resolve();
  return {
    url,
    health,
    spans: () => ({recent: [...recent], evicted}),
    gateway: () => edge.state === 'serving' ? edge.gateway : undefined,
    reload: () => {
      // One reload at a time, each reading the file as it is then.
      reloading = reloading.catch(() => {}).then(async () => {
        if (edge.state !== 'serving' || edgeConfig === undefined) return;
        const {gateway} = edge;
        try {
          const next = await readEdgeCredentials(edgeConfig.credentials);
          gateway.reload(next);
          log.info('runtime.edge.reloaded', {'bunny.outcome': 'succeeded', 'bunny.grant_count': next.length});
        } catch (error) {
          log.error('runtime.edge.reloaded', {'bunny.outcome': 'failed', ...errorFields(error)});
          throw error;
        }
      });
      return reloading;
    },
    stop: () => stopping ??= (async () => {
      // Remote parts go first, so none acts on a module that is stopping. Until the listener closes, the gateway's
      // routes answer that the runtime is stopping.
      const serving = edge;
      if (serving.state !== 'off') edge = {state: 'stopping'};
      if (serving.state === 'serving') await serving.gateway.close();
      await host.stop();
      await Promise.all([close(server), watchdog?.stop()]);
      // The modules' work has ended, so its spans have too: flush them within the contract's bound.
      await endTracing();
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
