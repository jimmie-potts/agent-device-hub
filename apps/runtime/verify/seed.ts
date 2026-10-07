// The seeds of a disposable runtime run (Hub #920): which modules the runtime starts and the parts' run-generated
// grants. Each catalog scenario seeds its own modules; `fixtures` starts the core with its stand-in parts, the lamp and the chime for
// exploring. Names starting with `control-` cross a boundary on purpose, so their start fails a boundary check.
import {randomBytes} from 'node:crypto';
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EDGE_GRANTS_FILE, shippedModules, type ModuleFactory} from '../src/index.js';
import {writeSimulatedConfiguration} from '../tests/fixtures/simulated.js';
import {ROLES, SCENARIOS, type ModuleName, type Seed} from '../tests/scenarios/catalog.js';
import {sourceOf, writeConfiguration} from '../tests/scenarios/parts.js';

export const RUN_FILE = 'run.json';
export const RUN_SCHEMA = 'runtime-run/1.0';
/** How a boundary negative control crosses its boundary. */
export type Fault = 'real-transports' | 'installed-port' | 'default-state';
/**
 * Which runtime a run starts: `shipped`, the runtime's own entry point with the shipped module list, or
 * `fixtures`, the same runtime with the fixture modules and families the scenario catalog uses.
 */
export type RunRuntime = 'shipped' | 'fixtures';
/** What the supervisor reads from the run's data directory. `config` is the run's configuration file, when it has one. */
export type RunFile = {schema: typeof RUN_SCHEMA; runtime: RunRuntime; modules: ModuleName[]; fault?: Fault; config?: string};
/**
 * `config` gives a catalog seed's sections; `simulated` configures each of those factories from its simulated section
 * instead, as the shipped run does.
 */
export type RunScenario = {
  description: string; runtime: RunRuntime; modules: readonly ModuleName[]; fault?: Fault; config?: Seed['config']; simulated?: readonly ModuleFactory[];
};

/** The run's state directory, which the runtime's `--state-dir` names: `<data>/state`. */
export const stateDirOf = (dataDir: string): string => join(dataDir, 'state');
/** The private home the runtime's child gets: `<data>/home`. */
export const homeOf = (dataDir: string): string => join(dataDir, 'home');
/** Where a configured run keeps its configuration file and token files (Hub #919): `<data>/config`. */
export const configDirOf = (dataDir: string): string => join(dataDir, 'config');

export const RUN_SCENARIOS: Readonly<Record<string, RunScenario>> = {
  fixtures: {description: 'The core with its stand-in parts, the lamp and the chime with simulated devices, for exploring', runtime: 'fixtures', modules: ['core', 'lamp', 'chime']},
  shipped: {
    description: 'The runtime\'s own entry point with the shipped module list: the core and each device module, configured for its simulated devices',
    // Each shipped module's simulated section (Hub #844, #929), so a run of the shipped list starts every module.
    runtime: 'shipped', modules: [], simulated: shippedModules,
  },
  ...Object.fromEntries(SCENARIOS.map(scenario => [scenario.id, {
    description: `Seeded for the catalog scenario: ${scenario.title}`, runtime: 'fixtures', modules: scenario.seed.modules,
    ...(scenario.seed.config === undefined ? {} : {config: scenario.seed.config}),
  } satisfies RunScenario])),
  'control-real-transports': {
    description: 'Negative control, start only: the shipped runtime without --simulate, so the simulated-transports check fails',
    runtime: 'shipped', modules: [], fault: 'real-transports',
  },
  'control-installed-port': {
    description: 'Negative control, start only: a probe module reaches for the installed Hub\'s port 8788, which the run\'s guard refuses, so the no-outbound-connections check fails',
    runtime: 'fixtures', modules: [], fault: 'installed-port',
  },
  'control-default-state': {
    description: 'Negative control, start only: the runtime without --state-dir falls back to its default directory under the run\'s private home, so the private-state check fails',
    runtime: 'shipped', modules: [], fault: 'default-state',
  },
};

/** The boundary negative controls: each crosses a boundary, so its start fails a check by design. */
export const START_ONLY: readonly string[] = Object.keys(RUN_SCENARIOS).filter(name => RUN_SCENARIOS[name]?.fault !== undefined);

/**
 * Writes the scenario's run file, the runtime's state directory and private home, one run-generated grant for each part
 * in the state directory's `edge-grants.json`, owner-only, and, for a scenario with a configuration, its private
 * configuration file and token files under `<data>/config`. The grants are never printed, and the token files hold
 * only the synthetic token.
 */
export async function seedRun(dataDir: string, name: string): Promise<void> {
  const scenario = RUN_SCENARIOS[name];
  if (scenario === undefined) throw new Error(`no run scenario ${name}`);
  const config = scenario.simulated !== undefined ? await writeSimulatedConfiguration(configDirOf(dataDir), scenario.simulated) :
    scenario.config === undefined ? undefined : await writeConfiguration(configDirOf(dataDir), scenario.config);
  const run: RunFile = {
    schema: RUN_SCHEMA, runtime: scenario.runtime, modules: [...scenario.modules], ...(scenario.fault === undefined ? {} : {fault: scenario.fault}),
    ...(config === undefined ? {} : {config}),
  };
  await writeFile(join(dataDir, RUN_FILE), `${JSON.stringify(run)}\n`, {mode: 0o600});
  for (const dir of [stateDirOf(dataDir), homeOf(dataDir)]) {
    await mkdir(dir, {mode: 0o700});
    await chmod(dir, 0o700);
  }
  const grants = ROLES.map(role => ({source: sourceOf(role), token: randomBytes(32).toString('base64url')}));
  const file = join(stateDirOf(dataDir), EDGE_GRANTS_FILE);
  await writeFile(file, `${JSON.stringify({schema: 'edge-grants/1.0', grants})}\n`, {mode: 0o600});
  await chmod(file, 0o600);
}
