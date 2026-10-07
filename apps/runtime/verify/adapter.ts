// The run adapter of the runtime's scenario catalog (Hub #920, tier 2): the catalog's `Harness` over a disposable run.
// The scenario's parts are remote parts, each with its run-generated grant, connected to the run's SDK edge; the
// simulated devices, the run's controls, its log records and what its bus published come from the run's harness API.
// Time is real. The catalog's reads are synchronous, so the adapter keeps a copy of the run's state, refreshed on every
// wait and after every action, and the harness API's flush makes that copy current. A part dropped by `disconnect`
// connects again at the next wait, as the in-memory harness's does when virtual time moves.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {EDGE_GRANTS_FILE} from '../src/index.js';
import type {Harness, Seed} from '../tests/scenarios/catalog.js';
import {stateDirOf} from './seed.js';

/** Where a run adapter finds the run: its runtime's URL, its harness endpoint and its data directory. */
export type RunTarget = {url: string; harness: string; dataDir: string; seed: Seed};
export interface RunHarness extends Harness {
  /** What went wrong outside the steps: messages that break profile 2.0, and errors a part reported. */
  problems(): readonly string[];
  close(): Promise<void>;
}


/** The run's grants, by source, from the state directory. They are never printed. */
export async function readGrants(dataDir: string): Promise<Map<string, string>> {
  const document = JSON.parse(await readFile(join(stateDirOf(dataDir), EDGE_GRANTS_FILE), 'utf8')) as {grants: {source: string; token: string}[]};
  return new Map(document.grants.map(({source, token}) => [source, token]));
}

/** Connects the scenario's parts to a run, each with its grant, and syncs the reader's copies. */
export function connectRun(target: RunTarget): Promise<RunHarness> {
  return Promise.reject(new Error(`the run adapter is not built yet (${target.url})`));
}
