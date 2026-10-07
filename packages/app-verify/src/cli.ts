import {capture} from './capture.js';
import {handoff} from './handoff.js';
import {refusalBody} from './error-body.js';
import {checkDeclarations, checkGiven, declaresInputs, parseInputs, resolveInputs} from './inputs.js';
import {DEFAULT_LEASE_MINUTES, doctor, EXIT, extend, Failure, has, restart, scenario, start, stop, UsageError, type Io} from './lifecycle.js';
import {LockedError} from './receipt.js';
import {inspectPrerequisites} from './prerequisites.js';
import type {AppPlugin, RunOptions} from './types.js';
import {APP_PATTERN, errorText} from './util.js';
import {VERSION} from './version.js';

const OPERATIONS = [
  'help',
  'prerequisites',
  'start [--scenario <name>] [--lease <minutes>]',
  'doctor [<run-id>]',
  'scenario <run-id> <name>',
  'capture <run-id> <step>',
  'handoff <run-id> [--reset <scenario>]',
  'extend <run-id> [--lease <minutes>]',
  'stop <run-id>',
  'restart <run-id>',
];

const FLAGS: Record<string, readonly string[]> = {start: ['--scenario', '--lease', '--input'], scenario: ['--input'], extend: ['--lease'], handoff: ['--reset']};
/** Flags that may repeat; each occurrence is kept in order. */
const REPEATED = new Set(['--input']);

function parse(argv: readonly string[]): {operation: string; positional: string[]; flags: Record<string, string>; inputs: string[]} {
  const [operation = 'help', ...rest] = argv;
  const positional: string[] = [], flags: Record<string, string> = {}, inputs: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument.startsWith('--')) {
      if (!(FLAGS[operation] ?? []).includes(argument)) throw new UsageError(`${operation} does not take ${argument}`);
      const value = rest[++index];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${argument} needs a value`);
      if (REPEATED.has(argument)) inputs.push(value);
      else flags[argument] = value;
    } else positional.push(argument);
  }
  return {operation, positional, flags, inputs};
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
  checkDeclarations(plugin);
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
    // Names and values are checked before any run is touched; required inputs once the recorded ones are known.
    const given = parseInputs(parsed.inputs);
    checkGiven(plugin, given);
    let outcome: {code: number; value: Record<string, unknown>; exitSoon?: boolean};
    switch (operation) {
      case 'help':
        // A plug-in without inputs keeps the 1.0 operation strings.
        outcome = {code: EXIT.ok, value: {operation, app: plugin.app, command: plugin.command, coreVersion: VERSION,
          operations: declaresInputs(plugin) ? OPERATIONS.map(o => (/^(?:start|scenario) /.test(o) ? `${o} [--input <name>=<value>]...` : o)) : OPERATIONS,
          inputs: Object.fromEntries(Object.entries(plugin.inputs ?? {}).map(([name, input]) => [name, {description: input.description, required: input.required === true}])),
          scenarioInputs: Object.fromEntries(Object.entries(plugin.scenarios).filter(([, v]) => v.requiredInputs?.length).map(([k, v]) => [k, [...v.requiredInputs!]])),
          scenarios: Object.fromEntries(Object.entries(plugin.scenarios).map(([k, v]) => [k, v.description])), defaultScenario: plugin.defaultScenario,
          steps: Object.fromEntries(Object.entries(plugin.captureSteps).map(([k, v]) => [k, v.description])),
          exitCodes: {0: 'operation completed', 1: 'failed outcome', 2: 'usage error', 3: 'required local tooling or prerequisite missing'}}};
        break;
      case 'start': {
        arity(positional, 0, operation);
        const name = flags['--scenario'] ?? plugin.defaultScenario;
        if (!has(plugin.scenarios, name)) throw new UsageError(`the fixtures define no scenario ${name}; see help`);
        outcome = await start(plugin, io, {scenario: name, leaseMinutes: lease(flags['--lease']), inputs: resolveInputs(plugin, given, {}, name)});
        break;
      }
      case 'prerequisites': {
        arity(positional, 0, operation);
        const value = await inspectPrerequisites(plugin, io.env);
        outcome = {code: value.checks.some(check => check.status === 'missing') ? EXIT.unavailable : EXIT.ok, value};
        break;
      }
      case 'doctor':
        if (positional.length > 1) throw new UsageError('doctor takes at most one run id');
        outcome = await doctor(plugin, io, positional[0]);
        break;
      case 'scenario':
        arity(positional, 2, operation);
        if (!has(plugin.scenarios, positional[1])) throw new UsageError(`the fixtures define no scenario ${positional[1]}; see help`);
        outcome = await scenario(plugin, io, positional[0], positional[1], given);
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
    // The 1.x `error` and `detail` stay until #839; `errorBody` adds the shared 2.0 body (#921).
    const refuse = (code: string, detail: string) => io.result({operation, error: code, detail, errorBody: refusalBody(code, detail)});
    if (error instanceof UsageError) {
      refuse('usage', error.message);
      return EXIT.usage;
    }
    if (error instanceof Failure) {
      refuse(error.code, error.detail);
      return EXIT.failed;
    }
    if (error instanceof LockedError) {
      refuse('receipt-locked', error.message);
      return EXIT.failed;
    }
    refuse('internal', errorText(error));
    stderr(error instanceof Error && error.stack ? error.stack : String(error));
    return EXIT.failed;
  }
}
