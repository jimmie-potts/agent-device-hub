// The runtime as a service process: arguments, the ready line, signals, escaped errors and the event-loop lag check.
// systemd runs it with `Restart=on-failure`: a failure exit (1) or the lag check's SIGKILL restarts the whole runtime.
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {contain} from './host.js';
import {LogWriter, errorFields, stderrSink} from './log.js';
import {LEVELS, type LogLevel} from './record.js';
import {startRuntime, type Runtime} from './runtime.js';
import {startWatchdog} from './watchdog.js';

export type ProcessOptions = {port: number; stateDir: string; lagLimitMs: number; logLevel: LogLevel};

export const DEFAULT_STATE_DIR = join(homedir(), '.local/state/agent-device-hub/runtime');
export const DEFAULT_LAG_LIMIT_MS = 10_000;
const USAGE = 'usage: main.js --port <0-65535> [--state-dir <absolute path>] [--lag-limit-ms <1-3600000>] [--log-level debug|info|warn|error]';
const INTEGER = /^(0|[1-9]\d*)$/;

/** Arguments the entry point cannot run with. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const isLevel = (value: string): value is LogLevel => (LEVELS as readonly string[]).includes(value);

function integer(value: string | undefined, name: string, min: number, max: number): number {
  const parsed = value !== undefined && INTEGER.test(value) ? Number(value) : Number.NaN;
  if (!(parsed >= min && parsed <= max)) throw new UsageError(`--${name} must be an integer from ${min} to ${max}`);
  return parsed;
}

export function parseArguments(argv: readonly string[]): ProcessOptions {
  let values: {port?: string; 'state-dir'?: string; 'lag-limit-ms'?: string; 'log-level'?: string};
  try {
    ({values} = parseArgs({
      args: [...argv], strict: true, allowPositionals: false,
      options: {'port': {type: 'string'}, 'state-dir': {type: 'string'}, 'lag-limit-ms': {type: 'string'}, 'log-level': {type: 'string'}},
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'malformed arguments');
  }
  const logLevel = values['log-level'] ?? 'info';
  if (!isLevel(logLevel) || logLevel === 'fatal') throw new UsageError('--log-level must be debug, info, warn or error');
  return {
    port: integer(values.port, 'port', 0, 65_535),
    stateDir: values['state-dir'] ?? DEFAULT_STATE_DIR,
    lagLimitMs: values['lag-limit-ms'] === undefined ? DEFAULT_LAG_LIMIT_MS : integer(values['lag-limit-ms'], 'lag-limit-ms', 1, 3_600_000),
    logLevel,
  };
}

/**
 * Runs the runtime until SIGTERM or SIGINT, which stop it and exit 0. An error that escapes a module stops only that
 * module. Any other escaped error, or a failed start, exits 1. Resolves once the ready line is on stdout.
 */
export async function runProcess(options: ProcessOptions & {modules: readonly BunnyModule[]}): Promise<void> {
  const log = new LogWriter(stderrSink, options.logLevel, {now: () => Date.now()}).logger('bunny.runtime');
  const fail = (error: unknown): never => {
    log.fatal('runtime.failed', errorFields(error));
    process.exit(1);
  };
  const escaped = (error: unknown): void => { if (!contain(error)) fail(error); };
  process.on('uncaughtException', escaped);
  process.on('unhandledRejection', escaped);
  const watchdog = startWatchdog(options.lagLimitMs, error => { log.error('runtime.watchdog.failed', errorFields(error)); });
  let runtime: Runtime;
  try {
    runtime = await startRuntime({modules: options.modules, port: options.port, stateDir: options.stateDir, logLevel: options.logLevel});
  } catch (error) {
    return fail(error);
  }
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void Promise.all([runtime.stop(), watchdog.stop()]).then(() => process.exit(0), fail);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.stdout.write(`${JSON.stringify({event: 'runtime.ready', url: runtime.url})}\n`);
}

/** The entry point: parses `argv`, exiting with status 2 and a usage line when it is malformed, then runs the process. */
export async function runMain(argv: readonly string[], modules: readonly BunnyModule[]): Promise<void> {
  let options: ProcessOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exit(2);
  }
  await runProcess({...options, modules});
}
