// The seeds of a disposable runtime run (Hub #920): which modules the runtime starts and the parts' run-generated
// credentials (Hub #835). Each catalog scenario seeds its own modules; `fixtures` starts the core with its stand-in parts,
// the lamp and the chime for exploring, and `shipped` the shipped list. A module's scenario file may add runs of its own,
// such as the shipped list on the module's migrated data, which the catalog collects with its scenarios (Hub #999). Names
// starting with `control-` cross a boundary on purpose, so their start fails a boundary check.
import {chmod, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {shippedModules, type ModuleFactory} from '../src/index.js';
import {simulatedSections} from '../tests/fixtures/simulated.js';
import {prepareWisprFixture} from '../tests/fixtures/wispr.js';
import {MODULE_FILES, SCENARIOS, type ModuleName, type Seed} from '../tests/scenarios/catalog.js';
import {partTokens, producerToken, writeConfiguration} from '../tests/scenarios/parts.js';
import {RUN_FILE, RUN_SCHEMA, configDirOf, homeOf, partTokensOf, stateDirOf, type Fault, type RunFile, type RunRuntime} from './paths.js';

export {
  RUN_FILE, RUN_SCHEMA, configDirOf, credentialsOf, homeOf, migrationOf, partTokensOf, producerOf, stateDirOf, type Fault, type RunFile, type RunRuntime,
} from './paths.js';

/**
 * `config` gives a catalog seed's sections; `simulated` configures each of those factories from its simulated section
 * instead, as the shipped run does. `prepare` runs last, once the run's state directory exists, as an installer's step
 * before the runtime's first start would. `refused` names the modules the runtime is expected to refuse, which the run's
 * health allows (Hub #954): a catalog seed's, or every configured shipped module in a control that gives no sections.
 */
export type RunScenario = {
  description: string; runtime: RunRuntime; modules: readonly ModuleName[]; fault?: Fault; config?: Seed['config']; simulated?: readonly ModuleFactory[];
  prepare?: (dataDir: string) => Promise<void>; refused?: readonly string[];
  wisprFixture?: Seed['wisprFixture'];
};

/** The shipped modules that take a section: a run that gives no sections, as the shipped controls do, has them refused. */
const CONFIGURED: readonly string[] = shippedModules.filter(factory => factory.simulatedSection !== undefined).map(factory => factory.name);

export const RUN_SCENARIOS: Readonly<Record<string, RunScenario>> = {
  fixtures: {description: 'The core with its stand-in parts, the lamp and the chime with simulated devices, for exploring', runtime: 'fixtures', modules: ['core', 'lamp', 'chime']},
  shipped: {
    description: 'The runtime\'s own entry point with the shipped module list: the core and each device module, configured for its simulated devices',
    // Each shipped module's simulated section (Hub #844, #929), so a run of the shipped list starts every module.
    runtime: 'shipped', modules: [], simulated: shippedModules,
  },
  // A module's own runs: the shipped list, each module on its simulated section, readied by the module's `prepare`.
  ...Object.fromEntries(Object.values(MODULE_FILES).flatMap(file => Object.entries(file.runs ?? {})).map(([name, {description, prepare}]) =>
    [name, {description, runtime: 'shipped', modules: [], simulated: shippedModules, prepare} satisfies RunScenario])),
  ...Object.fromEntries(SCENARIOS.map(scenario => [scenario.id, {
    description: `Seeded for the catalog scenario: ${scenario.title}`, runtime: 'fixtures', modules: scenario.seed.modules,
    ...(scenario.seed.config === undefined ? {} : {config: scenario.seed.config}), ...(scenario.seed.refused === undefined ? {} : {refused: scenario.seed.refused}),
    ...(scenario.seed.wisprFixture === undefined ? {} : {wisprFixture: scenario.seed.wisprFixture}),
  } satisfies RunScenario])),
  'control-real-transports': {
    description: 'Negative control, start only: the shipped runtime without --simulate, so the simulated-transports check fails',
    runtime: 'shipped', modules: [], fault: 'real-transports', refused: CONFIGURED,
  },
  'control-installed-port': {
    description: 'Negative control, start only: a probe module reaches for the installed Hub\'s port 8788, which the run\'s guard refuses, so the no-outbound-connections check fails',
    runtime: 'fixtures', modules: [], fault: 'installed-port',
  },
  'control-default-state': {
    description: 'Negative control, start only: the runtime without --state-dir falls back to its default directory under the run\'s private home, so the private-state check fails',
    runtime: 'shipped', modules: [], fault: 'default-state', refused: CONFIGURED,
  },
};

/** The boundary negative controls: each crosses a boundary, so its start fails a check by design. */
export const START_ONLY: readonly string[] = Object.keys(RUN_SCENARIOS).filter(name => RUN_SCENARIOS[name]?.fault !== undefined);

/**
 * Writes the scenario's run file, the runtime's state directory and private home, and under `<data>/config` the run's
 * private configuration file: the scenario's module sections, with a token file per configured module holding only the
 * synthetic token, and the edge's section (Hub #835), whose credentials file grants each part, as the catalog's `GRANTS`
 * say, under a run-generated token's digest. The parts' tokens go to a private file of their own for the adapter, and
 * are never printed. Then the scenario's `prepare` runs, such as a module's migration.
 */
export async function seedRun(dataDir: string, name: string): Promise<void> {
  const scenario = RUN_SCENARIOS[name];
  if (scenario === undefined) throw new Error(`no run scenario ${name}`);
  const tokens = partTokens();
  const producer = producerToken();
  const dir = configDirOf(dataDir);
  const modules = scenario.wisprFixture === undefined ? scenario.config
    : {...scenario.config, wispr: await prepareWisprFixture(dir, Date.now(), scenario.wisprFixture)};
  const config = await writeConfiguration(dir, {
    ...(modules === undefined ? {} : {modules}),
    ...(scenario.simulated === undefined ? {} : {sections: await simulatedSections(dir, scenario.simulated)}), tokens, producer,
  });
  await writeFile(partTokensOf(dataDir), `${JSON.stringify({...tokens, producer})}\n`, {mode: 0o600});
  await chmod(partTokensOf(dataDir), 0o600);
  const run: RunFile = {schema: RUN_SCHEMA, runtime: scenario.runtime, modules: [...scenario.modules], ...(scenario.fault === undefined ? {} : {fault: scenario.fault}), config};
  await writeFile(join(dataDir, RUN_FILE), `${JSON.stringify(run)}\n`, {mode: 0o600});
  for (const dir of [stateDirOf(dataDir), homeOf(dataDir)]) {
    await mkdir(dir, {mode: 0o700});
    await chmod(dir, 0o700);
  }
  await scenario.prepare?.(dataDir);
}
