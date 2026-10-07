// The seeds of a disposable runtime run (Hub #920): which modules the runtime starts and the parts' run-generated
// credentials (Hub #835). Each catalog scenario seeds its own modules; `fixtures` starts the core with its stand-in parts, the lamp and the chime for
// exploring, `pixoo-migrated` the shipped list on a migrated Pixoo library (Hub #931), and `nanoleaf-migrated` the
// shipped list on a migrated Nanoleaf bridge state (Hub #933). Names starting with `control-` cross a boundary on
// purpose, so their start fails a boundary check.
import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SIMULATED_SECTION, writeSyntheticNanoleafState} from '@jimmie-potts/nanoleaf';
import {writeSyntheticLibrary} from '@jimmie-potts/pixoo';
import {runNanoleafMigration, runPixooMigration, shippedModules, type ModuleFactory} from '../src/index.js';
import {simulatedSections} from '../tests/fixtures/simulated.js';
import {SCENARIOS, type ModuleName, type Seed} from '../tests/scenarios/catalog.js';
import {partTokens, producerToken, writeConfiguration} from '../tests/scenarios/parts.js';

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
 * instead, as the shipped run does. `prepare` runs last, once the run's state directory exists, as an installer's step
 * before the runtime's first start would.
 */
export type RunScenario = {
  description: string; runtime: RunRuntime; modules: readonly ModuleName[]; fault?: Fault; config?: Seed['config']; simulated?: readonly ModuleFactory[];
  prepare?: (dataDir: string) => Promise<void>;
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
 * The parts' tokens, by role, with the agent hooks' producer token as `producer` (Hub #926), which the run's adapter
 * reads to connect its parts and write the producer file, and the runtime never reads: the credentials file holds only
 * their digests. Owner-only, and never printed.
 */
export const partTokensOf = (dataDir: string): string => join(configDirOf(dataDir), 'part-tokens.json');
/**
 * The agent hooks' producer file (Hub #926), unchanged 1.x, which the supervisor writes once the runtime's port is
 * known and the hook script takes as its argument: `<data>/config/producer/producer.json`.
 */
export const producerOf = (dataDir: string): string => join(configDirOf(dataDir), 'producer', 'producer.json');

/** Where the `pixoo-migrated` run keeps its synthetic Pixoo library, `<data>/pixoo-library` (Hub #931). */
export const pixooLibraryOf = (dataDir: string): string => join(dataDir, 'pixoo-library');
/**
 * Where a migrated run keeps its migration's JSON lines, `<data>/migration/`: `{migrate,verify}.json` for the Pixoo
 * library, and `nanoleaf-{migrate,verify}.json` with the section it wrote for the Nanoleaf bridge state.
 */
export const migrationOf = (dataDir: string): string => join(dataDir, 'migration');

/**
 * Writes a synthetic Pixoo library of the installed schema version and runs the migration tool's `migrate` and `verify`
 * on it into the run's state directory, as the installer will before the runtime's first start at the cutover (#840).
 * Keeps each one's line, and fails the seed unless both exit 0.
 */
async function migratePixoo(dataDir: string): Promise<void> {
  await writeSyntheticLibrary(pixooLibraryOf(dataDir));
  await mkdir(migrationOf(dataDir), {mode: 0o700});
  for (const operation of ['migrate', 'verify'] as const) {
    let line = '';
    const exit = await runPixooMigration([operation, '--library', pixooLibraryOf(dataDir), '--state-dir', stateDirOf(dataDir)], {write: text => { line += text; }});
    await writeFile(join(migrationOf(dataDir), `${operation}.json`), line, {mode: 0o600});
    if (exit !== 0) throw new Error(`the Pixoo library migration's ${operation} exited ${exit}`);
  }
}

/** Where the `nanoleaf-migrated` run keeps its synthetic Nanoleaf bridge state, `<data>/nanoleaf-bridge` (Hub #933). */
export const nanoleafBridgeOf = (dataDir: string): string => join(dataDir, 'nanoleaf-bridge');
/** The secrets directory the migration writes each Nanoleaf token into: the run's own, `<data>/config/secrets`. */
export const migratedSecretsOf = (dataDir: string): string => join(configDirOf(dataDir), 'secrets');

/** The migration tool's arguments for the run: the bridge's state into the run's state directory, secrets and section. */
export const nanoleafMigrationArgs = (operation: 'migrate' | 'verify', dataDir: string, section = join(migrationOf(dataDir), 'nanoleaf-section.json')): string[] =>
  [operation, '--source', nanoleafBridgeOf(dataDir), '--state-dir', stateDirOf(dataDir), '--secrets-dir', migratedSecretsOf(dataDir), '--section', section];

/**
 * Writes a synthetic Nanoleaf bridge state of the installed shape, with the simulated controllers' addresses and token
 * and the run's synthetic Claude Code hook as its qualified source, and runs the migration tool's `migrate` into the run's
 * state directory, as the installer will before the runtime's first start at the cutover (#840). Puts the section it
 * wrote into the run's configuration file in place of the simulated one, then runs `verify` against that file, as the
 * cutover's go. Keeps each line, and fails the seed unless both exit 0.
 */
async function migrateNanoleaf(dataDir: string): Promise<void> {
  await mkdir(nanoleafBridgeOf(dataDir), {mode: 0o700});
  await writeSyntheticNanoleafState(nanoleafBridgeOf(dataDir), {qualifiedSources: SIMULATED_SECTION.qualifiedSources});
  await mkdir(migrationOf(dataDir), {mode: 0o700});
  const run = async (operation: 'migrate' | 'verify', section?: string): Promise<void> => {
    let line = '';
    const exit = await runNanoleafMigration(nanoleafMigrationArgs(operation, dataDir, section), {write: text => { line += text; }});
    await writeFile(join(migrationOf(dataDir), `nanoleaf-${operation}.json`), line, {mode: 0o600});
    if (exit !== 0) throw new Error(`the Nanoleaf migration's ${operation} exited ${exit}`);
  };
  await run('migrate');
  const {config} = JSON.parse(await readFile(join(dataDir, RUN_FILE), 'utf8')) as RunFile;
  const file = JSON.parse(await readFile(config, 'utf8')) as {modules: Record<string, unknown>};
  file.modules.nanoleaf = JSON.parse(await readFile(join(migrationOf(dataDir), 'nanoleaf-section.json'), 'utf8')) as unknown;
  await writeFile(config, `${JSON.stringify(file, null, 2)}\n`, {mode: 0o600});
  await run('verify', config);
}

export const RUN_SCENARIOS: Readonly<Record<string, RunScenario>> = {
  fixtures: {description: 'The core with its stand-in parts, the lamp and the chime with simulated devices, for exploring', runtime: 'fixtures', modules: ['core', 'lamp', 'chime']},
  shipped: {
    description: 'The runtime\'s own entry point with the shipped module list: the core and each device module, configured for its simulated devices',
    // Each shipped module's simulated section (Hub #844, #929), so a run of the shipped list starts every module.
    runtime: 'shipped', modules: [], simulated: shippedModules,
  },
  'pixoo-migrated': {
    description: 'The shipped runtime on a Pixoo library migrated from a synthetic library of the installed schema version 3, as the installer migrates it before the runtime starts (Hub #931)',
    runtime: 'shipped', modules: [], simulated: shippedModules, prepare: migratePixoo,
  },
  'nanoleaf-migrated': {
    description: 'The shipped runtime with the Nanoleaf module on a bridge state migrated from a synthetic one of the installed shape, the Lines and NL22 Light Panels, '
      + 'as the installer migrates it before the runtime starts (Hub #933)',
    runtime: 'shipped', modules: [], simulated: shippedModules, prepare: migrateNanoleaf,
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
 * are never printed. Then the scenario's `prepare` runs, such as `pixoo-migrated`'s library migration or
 * `nanoleaf-migrated`'s migration.
 */
export async function seedRun(dataDir: string, name: string): Promise<void> {
  const scenario = RUN_SCENARIOS[name];
  if (scenario === undefined) throw new Error(`no run scenario ${name}`);
  const tokens = partTokens();
  const producer = producerToken();
  const dir = configDirOf(dataDir);
  const config = await writeConfiguration(dir, {
    ...(scenario.config === undefined ? {} : {modules: scenario.config}),
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
