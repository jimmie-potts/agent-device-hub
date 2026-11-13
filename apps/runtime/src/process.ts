// The runtime as a service process: arguments, the ready line, signals, escaped errors and the event-loop lag check.
// systemd runs it with `Restart=on-failure`: a failure exit (1) or the lag check's SIGKILL restarts the whole runtime.
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import type {BunnyModule, Clock, RemoteEdge, Scheduler} from '@jimmie-potts/sdk';
import {recordLog} from '@jimmie-potts/sdk';
import {contain} from './host.js';
import {INSTANCE_ID, LogWriter, Redactions, faultFields, stderrSink} from './log.js';
import {buildModules, moduleSchemas, type ModuleFactory} from './modules.js';
import {ENVIRONMENTS, LEVELS, RUNTIME_SCOPE, runtimeResource, type Environment, type LogLevel} from './record.js';
import type {StandbyCredentialAdmission} from './standby-credential-admission.js';
import {startRuntime, type Runtime} from './runtime.js';
import {RuntimeError, type RuntimeConfig} from './state.js';

export type ProcessOptions = {
  port: number; stateDir: string; lagLimitMs: number; logLevel: LogLevel;
  /** Build every module with its simulated transport, as a disposable verification run does (#920). */
  simulate: boolean;
  /** Serve the gateway on the health listener, with the credentials the configuration file's `edge` section names. */
  edge: boolean;
  /** Every record's `deployment.environment.name` (#903). The installed runtime runs as `production`. */
  environment: Environment;
  /** The private configuration file with each module's section (#919), or undefined to run without one. */
  config?: string;
  /**
   * Write each finished span to the state directory's bounded, private span file, for a disposable run to read (#950).
   * The installed runtime does not pass it, and keeps its spans in memory.
   */
  recordSpans: boolean;
};

export const DEFAULT_STATE_DIR = join(homedir(), '.local/state/agent-device-hub/runtime');
export const DEFAULT_LAG_LIMIT_MS = 10_000;
const USAGE = 'usage: main.js --port <0-65535> [--state-dir <absolute path>] [--config <absolute path>] [--lag-limit-ms <1-3600000>] [--log-level debug|info|warn|error] [--environment development|test|production] [--simulate] [--edge] [--record-spans]';
const INTEGER = /^(0|[1-9]\d*)$/;

/** Arguments the entry point cannot run with. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const isLevel = (value: string): value is LogLevel => (LEVELS as readonly string[]).includes(value);
const isEnvironment = (value: string): value is Environment => (ENVIRONMENTS as readonly string[]).includes(value);

function integer(value: string | undefined, name: string, min: number, max: number): number {
  const parsed = value !== undefined && INTEGER.test(value) ? Number(value) : Number.NaN;
  if (!(parsed >= min && parsed <= max)) throw new UsageError(`--${name} must be an integer from ${min} to ${max}`);
  return parsed;
}

export function parseArguments(argv: readonly string[]): ProcessOptions {
  let values: {
    port?: string; 'state-dir'?: string; config?: string; 'lag-limit-ms'?: string; 'log-level'?: string; environment?: string; simulate?: boolean;
    edge?: boolean; 'record-spans'?: boolean;
  };
  try {
    ({values} = parseArgs({
      args: [...argv], strict: true, allowPositionals: false,
      options: {
        'port': {type: 'string'}, 'state-dir': {type: 'string'}, 'config': {type: 'string'}, 'lag-limit-ms': {type: 'string'}, 'log-level': {type: 'string'},
        'environment': {type: 'string'}, 'simulate': {type: 'boolean'}, 'edge': {type: 'boolean'}, 'record-spans': {type: 'boolean'},
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'malformed arguments');
  }
  const logLevel = values['log-level'] ?? 'info';
  if (!isLevel(logLevel) || logLevel === 'fatal') throw new UsageError('--log-level must be debug, info, warn or error');
  const environment = values.environment ?? 'development';
  if (!isEnvironment(environment)) throw new UsageError('--environment must be development, test or production');
  return {
    port: integer(values.port, 'port', 0, 65_535),
    stateDir: values['state-dir'] ?? DEFAULT_STATE_DIR,
    lagLimitMs: values['lag-limit-ms'] === undefined ? DEFAULT_LAG_LIMIT_MS : integer(values['lag-limit-ms'], 'lag-limit-ms', 1, 3_600_000),
    logLevel,
    simulate: values.simulate === true,
    edge: values.edge === true,
    environment,
    ...(values.config === undefined ? {} : {config: values.config}),
    recordSpans: values['record-spans'] === true,
  };
}


/**
 * What the caller adds to the parsed options: the module factories, the payload schemas of families the edge accepts
 * although no module here owns them, such as a verification run's fixture families (#920), and a hook that gets the
 * edge once it serves. The shipped entry point passes only the factories.
 */
export type ProcessInputs = {modules: readonly ModuleFactory[]} & ChildInputs;
export type EdgeInputs = {schemas?: Readonly<Record<string, object>>; onEdge?: (edge: RemoteEdge) => void};
/** What only the verification run's child (verify/child.ts) adds: the edge's inputs and, for a run on virtual time, a test clock. */
export type ChildInputs = EdgeInputs & {testClock?: TestClock};

/**
 * A clock a disposable verification run controls (Hub #1709): the runtime's wall clock and scheduler, and the monotonic
 * clock that advances with them, which the child passes to the core's options, since the runtime does not build them.
 * It is a programmatic input only:
 * no argument or environment variable names one, the installed entry points pass none, and `runProcess` refuses one
 * unless the process is a simulated test run with an edge and has an IPC channel, as the verification supervisor's fork gives.
 */
export type TestClock = {clock: Clock; scheduler: Scheduler; monotonic: () => number};

/**
 * Why the process may not take a test clock, or undefined when it may: only a simulated test run with an edge, an IPC
 * channel and a state directory other than the default. The verification supervisor's fork gives its child an IPC
 * channel and names the run's state directory; the service manager and the container entry give no IPC channel. Node
 * also opens one for a process whose environment names an open descriptor (`NODE_CHANNEL_FD`), so the default state
 * directory is refused too (Hub #1710). An explicit state directory, such as an installation's, is not refused by this
 * check; the other conditions still apply to it.
 */
function testClockRefusal({simulate, environment, edge, stateDir}: ProcessOptions): string | undefined {
  if (!simulate) return 'a test clock needs --simulate';
  if (environment !== 'test') return 'a test clock needs --environment test';
  if (!edge) return 'a test clock needs --edge';
  if (typeof process.send !== 'function') return 'a test clock needs an IPC channel';
  if (resolve(stateDir) === resolve(DEFAULT_STATE_DIR)) return 'a test clock needs a --state-dir of its own';
  return undefined;
}

/** Already built inputs from an admitting entrypoint; these values do not themselves grant ownership. */
export type ProcessStartup = {
  modules: readonly BunnyModule[]; config: RuntimeConfig; listener?: 'container-host-local';
  standbyCredentialAdmission?: StandbyCredentialAdmission;
};

/**
 * Runs the runtime until SIGTERM or SIGINT, which stop it and exit 0, also when one arrives while the modules start. An
 * error that escapes a module stops only that module. Any other escaped error, or a failed start, exits 1. Resolves
 * once the ready line is on stdout, or once a signal during startup has begun the stop.
 */
export async function runProcess(options: ProcessOptions & ProcessInputs, startup?: ProcessStartup): Promise<void> {
  if (startup !== undefined && options.config !== undefined) throw new RuntimeError('config-invalid', 'configuration inputs conflict');
  // One resource for the process: these records, the runtime's and the watchdog thread's share its instance ID. One
  // redaction registry too: an error that escapes every module may carry a secret a module read, such as an error code
  // a device library copied from its credential, so `runtime.failed` leaves out an attribute that holds one (Hub #919).
  const redactions = new Redactions();
  const resource = runtimeResource(options.environment, INSTANCE_ID);
  const log = new LogWriter(stderrSink, options.logLevel, {now: () => Date.now()}, resource, redactions).logger(RUNTIME_SCOPE);
  const fail = (error: unknown): never => {
    log.fatal('runtime.failed', faultFields(error, redactions));
    process.exit(1);
  };
  // A test clock is for a disposable verification run only (Hub #1709). The installed image holds the run's child too,
  // so the process itself refuses one outside such a run, before any module starts or any port is bound.
  if (options.testClock !== undefined) {
    const refusal = testClockRefusal(options);
    if (refusal !== undefined) fail(new RuntimeError('invalid-state', refusal));
  }
  const escaped = (error: unknown): void => { if (!contain(error)) fail(error); };
  process.on('uncaughtException', escaped);
  process.on('unhandledRejection', escaped);
  // Signals are handled before anything starts: a signal during startup is remembered, and the runtime stops once its
  // modules' starts have settled, so every module that started also stops.
  let runtime: Runtime | undefined;
  let signalled = false;
  let stopping = false;
  const stop = (): void => {
    if (runtime === undefined) {
      signalled = true;
      return;
    }
    if (stopping) return;
    stopping = true;
    void runtime.stop().then(() => process.exit(0), fail);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  // SIGHUP reads the edge's credentials file again (#835): a grant, revocation or rotation takes effect without a
  // restart. A file the runtime refuses keeps the credentials it had; the reload's record says so. One during startup
  // is remembered and runs once the gateway serves, so a grant made then is never lost.
  let reloadPending = false;
  process.on('SIGHUP', () => {
    if (runtime === undefined) {
      reloadPending = true;
      return;
    }
    void runtime.reload().catch(() => {});
  });
  try {
    runtime = await startRuntime({
      ...(startup?.listener === undefined ? {} : {listener: startup.listener}),
      ...(startup?.standbyCredentialAdmission === undefined ? {} : {standbyCredentialAdmission: startup.standbyCredentialAdmission}),
      modules: startup?.modules ?? buildModules(options.modules, options.simulate), port: options.port, stateDir: options.stateDir,
      ...(startup === undefined ? (options.config === undefined ? {} : {configFile: options.config}) : {config: startup.config}),
      logLevel: options.logLevel, environment: options.environment, lagCheck: {limitMs: options.lagLimitMs}, simulate: options.simulate, redactions,
      ...(options.testClock === undefined ? {} : {clock: options.testClock.clock, scheduler: options.testClock.scheduler}),
      // The runtime cannot continue without the one owner of agent sessions: the service manager restarts it whole.
      onCoreFailure: () => { fail(new RuntimeError('core-failed', 'the core failed')); },
      ...(options.recordSpans ? {spans: 'state-file' as const} : {}),
      ...(options.edge ? {edge: {
        schemas: {...options.schemas, ...moduleSchemas(options.modules)}, ...(options.onEdge === undefined ? {} : {onServing: options.onEdge}),
      }} : {}),
    });
  } catch (error) {
    return fail(error);
  }
  if (signalled) {
    stop();
    return;
  }
  if (reloadPending) void runtime.reload().catch(() => {});
  // The ready line is machine-readable stdout with its own contract, which readiness checks parse; the record is the
  // journal's.
  recordLog(log, 'runtime.ready', {'bunny.module_count': startup?.modules.length ?? options.modules.length});
  process.stdout.write(`${JSON.stringify({event: 'runtime.ready', url: runtime.url})}\n`);
}

/**
 * The entry point: parses `argv`, exiting with status 2 and a usage line when it is malformed, then runs the process with
 * a module from each factory: with its simulated transport under `--simulate`. `schemas` are families the edge accepts
 * beyond the modules' own; `onEdge` gets the edge once it serves under `--edge`; `testClock` runs the runtime on a
 * verification run's clock, which `runProcess` refuses outside such a run.
 */
export async function runMain(argv: readonly string[], modules: readonly ModuleFactory[], {schemas, onEdge, testClock}: ChildInputs = {}): Promise<void> {
  let options: ProcessOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exit(2);
  }
  await runProcess({
    ...options, modules, ...(schemas === undefined ? {} : {schemas}), ...(onEdge === undefined ? {} : {onEdge}), ...(testClock === undefined ? {} : {testClock}),
  });
}
