import {capture} from './capture.js';
import {handoff} from './handoff.js';
import {DEFAULT_LEASE_MINUTES, doctor, EXIT, extend, Failure, has, restart, scenario, start, stop, UsageError, type Io} from './lifecycle.js';
import type {AppPlugin, RunOptions} from './types.js';
import {APP_PATTERN, errorText} from './util.js';

const OPERATIONS = [
  'help',
  'start [--scenario <name>] [--lease <minutes>]',
  'doctor [<run-id>]',
  'scenario <run-id> <name>',
  'capture <run-id> <step>',
  'handoff <run-id> [--reset <scenario>]',
  'extend <run-id> [--lease <minutes>]',
  'stop <run-id>',
  'restart <run-id>',
];

const FLAGS: Record<string, readonly string[]> = {start: ['--scenario', '--lease'], extend: ['--lease'], handoff: ['--reset']};

function parse(argv: readonly string[]): {operation: string; positional: string[]; flags: Record<string, string>} {
  const [operation = 'help', ...rest] = argv;
  const positional: string[] = [], flags: Record<string, string> = {};
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index]!;
    if (argument.startsWith('--')) {
      if (!(FLAGS[operation] ?? []).includes(argument)) throw new UsageError(`${operation} does not take ${argument}`);
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${argument} needs a value`);
      flags[argument] = value;
    } else positional.push(argument);
  }
  return {operation, positional, flags};
}

function lease(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LEASE_MINUTES;
  const minutes = Number(value);
  if (!/^\d+(?:\.\d+)?$/.test(value) || !(minutes >= 0.05) || minutes > 1440) throw new UsageError('--lease takes minutes from 0.05 to 1440');
  return minutes;
}

function arity(positional: string[], count: number, operation: string) {
  if (positional.length !== count) throw new UsageError(`${operation} takes ${count} argument${count === 1 ? '' : 's'}; see help`);
}

function checkPlugin(plugin: AppPlugin) {
  if (!APP_PATTERN.test(plugin.app) || plugin.app.length > 16) throw new Error(`plug-in app name ${plugin.app} must be lowercase kebab-case, at most 16 characters`);
  if (!has(plugin.scenarios, plugin.defaultScenario)) throw new Error(`plug-in default scenario ${plugin.defaultScenario} is not defined`);
  if (!plugin.root.startsWith('/')) throw new Error('plug-in root must be an absolute path');
}

/** Run one operation for `plugin` and return the process exit code. */
export async function runCli(plugin: AppPlugin, argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((line: string) => void process.stdout.write(line + '\n'));
  const stderr = options.stderr ?? ((line: string) => void process.stderr.write(line + '\n'));
  const io: Io = {env: options.env ?? process.env, result: value => stdout(JSON.stringify(value)), progress: stderr};
  let operation = argv[0] ?? 'help';
  try {
    checkPlugin(plugin);
    const parsed = parse(argv);
    operation = parsed.operation;
    const {positional, flags} = parsed;
    let outcome: {code: number; value: Record<string, unknown>; exitSoon?: boolean};
    switch (operation) {
      case 'help':
        outcome = {code: EXIT.ok, value: {operation, app: plugin.app, command: plugin.command, operations: OPERATIONS,
          scenarios: Object.fromEntries(Object.entries(plugin.scenarios).map(([k, v]) => [k, v.description])), defaultScenario: plugin.defaultScenario,
          steps: Object.fromEntries(Object.entries(plugin.captureSteps).map(([k, v]) => [k, v.description])),
          exitCodes: {0: 'verified', 1: 'failed outcome', 2: 'usage error', 3: 'supervisor or browser tooling unavailable'}}};
        break;
      case 'start': {
        arity(positional, 0, operation);
        const name = flags['--scenario'] ?? plugin.defaultScenario;
        if (!has(plugin.scenarios, name)) throw new UsageError(`the fixtures define no scenario ${name}; see help`);
        outcome = await start(plugin, io, {scenario: name, leaseMinutes: lease(flags['--lease'])});
        break;
      }
      case 'doctor':
        if (positional.length > 1) throw new UsageError('doctor takes at most one run id');
        outcome = await doctor(plugin, io, positional[0]);
        break;
      case 'scenario':
        arity(positional, 2, operation);
        if (!has(plugin.scenarios, positional[1]!)) throw new UsageError(`the fixtures define no scenario ${positional[1]}; see help`);
        outcome = await scenario(plugin, io, positional[0], positional[1]);
        break;
      case 'capture':
        arity(positional, 2, operation);
        outcome = await capture(plugin, io, positional[0], positional[1]);
        break;
      case 'handoff':
        arity(positional, 1, operation);
        if (flags['--reset'] !== undefined && !has(plugin.scenarios, flags['--reset'])) throw new UsageError(`the fixtures define no scenario ${flags['--reset']}; see help`);
        outcome = await handoff(plugin, io, positional[0], flags['--reset']);
        break;
      case 'extend':
        arity(positional, 1, operation);
        outcome = await extend(plugin, io, positional[0], lease(flags['--lease']));
        break;
      case 'stop':
        arity(positional, 1, operation);
        outcome = await stop(plugin, io, positional[0]);
        break;
      case 'restart':
        arity(positional, 1, operation);
        outcome = await restart(plugin, io, positional[0]);
        break;
      default:
        throw new UsageError(`unknown operation ${operation}; see help`);
    }
    io.result(outcome.value);
    // An interrupted or timed-out capture step may still hold timers; do not let it keep the process alive.
    if (outcome.exitSoon) setTimeout(() => process.exit(outcome.code), 250).unref();
    return outcome.code;
  } catch (error) {
    if (error instanceof UsageError) {
      io.result({operation, error: 'usage', detail: error.message});
      return EXIT.usage;
    }
    if (error instanceof Failure) {
      io.result({operation, error: error.code, detail: error.detail});
      return EXIT.failed;
    }
    io.result({operation, error: 'internal', detail: errorText(error)});
    stderr(error instanceof Error && error.stack ? error.stack : String(error));
    return EXIT.failed;
  }
}
