// Where a disposable runtime run keeps what it seeds (Hub #920): its run file, state directory, private home and
// configuration. It imports nothing of the run's, so a module's scenario file can name these paths for a run of its own
// (Hub #999) without importing the catalog that collects it.
import {join} from 'node:path';

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
export type RunFile = {schema: typeof RUN_SCHEMA; runtime: RunRuntime; modules: string[]; fault?: Fault; config: string};

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
/** Where a run that migrates a module's installed data keeps the migration tool's JSON lines: `<data>/migration/`. */
export const migrationOf = (dataDir: string): string => join(dataDir, 'migration');
