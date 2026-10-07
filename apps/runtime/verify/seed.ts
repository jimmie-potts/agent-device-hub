// The seeds of a disposable runtime run (Hub #920): which modules the runtime starts and the parts' run-generated
// credentials (Hub #835). Each catalog scenario seeds its own modules; `fixtures` starts the core with its stand-in parts, the lamp and the chime for
// exploring. Names starting with `control-` cross a boundary on purpose, so their start fails a boundary check.
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {shippedModules, type ModuleFactory} from '../src/index.js';
import {simulatedSections} from '../tests/fixtures/simulated.js';
import {SCENARIOS, type ModuleName, type Seed} from '../tests/scenarios/catalog.js';
import {partTokens, writeConfiguration} from '../tests/scenarios/parts.js';

export const RUN_FILE = 'run.json';
export const RUN_SCHEMA = 'runtime-run/1.0';
/** How a boundary negative control crosses its boundary. */
export type Fault = 'real-transports' | 'installed-port' | 'default-state';
/**
 * Which runtime a run starts: `shipped`, the runtime's own entry point with the shipped module list, or
 * `fixtures`, the same runtime with the fixture modules and families the scenario catalog uses.
 */
export type RunRuntime = 'shipped' | 'fixtures';
/** What the supervisor reads from the run's data directory. `config` is the run's configuration file. */
export type RunFile = {schema: typeof RUN_SCHEMA; runtime: RunRuntime; modules: ModuleName[]; fault?: Fault; config: string};
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
/** Where a run keeps its configuration file, its edge's credentials file and its token files (Hub #919, #835): `<data>/config`. */
export const configDirOf = (dataDir: string): string => join(dataDir, 'config');
/** The edge's credentials file a run's configuration names, with each part's grant under its token's digest (Hub #835). */
export const credentialsOf = (dataDir: string): string => join(configDirOf(dataDir), 'edge-credentials.json');
/**
 * The parts' tokens, by role, which the run's adapter reads to connect its parts and the runtime never reads: the
 * credentials file holds only their digests. Owner-only, and never printed.
 */
export const partTokensOf = (dataDir: string): string => join(configDirOf(dataDir), 'part-tokens.json');

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
 * Writes the scenario's run file, the runtime's state directory and private home, and under `<data>/config` the run's
 * private configuration file: the scenario's module sections, with a token file per configured module holding only the
 * synthetic token, and the edge's section (Hub #835), whose credentials file grants each part, as the catalog's `GRANTS`
 * say, under a run-generated token's digest. The parts' tokens go to a private file of their own for the adapter, and
 * are never printed.
 */
export async function seedRun(dataDir: string, name: string): Promise<void> {
  const scenario = RUN_SCENARIOS[name];
  if (scenario === undefined) throw new Error(`no run scenario ${name}`);
  const tokens = partTokens();
  const dir = configDirOf(dataDir);
  const config = await writeConfiguration(dir, {
    ...(scenario.config === undefined ? {} : {modules: scenario.config}),
    ...(scenario.simulated === undefined ? {} : {sections: await simulatedSections(dir, scenario.simulated)}), tokens,
  });
  await writeFile(partTokensOf(dataDir), `${JSON.stringify(tokens)}\n`, {mode: 0o600});
  await chmod(partTokensOf(dataDir), 0o600);
  const run: RunFile = {schema: RUN_SCHEMA, runtime: scenario.runtime, modules: [...scenario.modules], ...(scenario.fault === undefined ? {} : {fault: scenario.fault}), config};
  await writeFile(join(dataDir, RUN_FILE), `${JSON.stringify(run)}\n`, {mode: 0o600});
  for (const dir of [stateDirOf(dataDir), homeOf(dataDir)]) {
    await mkdir(dir, {mode: 0o700});
    await chmod(dir, 0o700);
  }
}
