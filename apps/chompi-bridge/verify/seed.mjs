// The app-verify scenarios of a CHOMPI bridge verification run and their seeds (Hub #853): free exploration
// (`desk-basic`), one per catalog scenario with that scenario's seed, and three negative controls that each cross
// one boundary so tests can prove its check fails. A seed writes the scenario name, a run-generated feed token and
// the shipped profile, each 0600, into the run's empty private data directory.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PROFILE_PATH } from '../dist/routing/profile.js';
import { DESK_BASIC, SCENARIOS } from '../dist/sim/scenarios.js';

/**
 * @typedef {{description: string, seed: import('../dist/sim/scenarios.js').RunSeed, catalog?: string, fault?: 'hid-device' | 'desktop-calls' | 'installed-hub'}} RunScenario
 * @type {Readonly<Record<string, RunScenario>>}
 */
export const RUN_SCENARIOS = Object.freeze({
  'desk-basic': { description: 'One Codex and one Claude task, idle, with another app in front; explore freely', seed: DESK_BASIC },
  ...Object.fromEntries(SCENARIOS.map(s => [s.id, { description: `Catalog scenario: ${s.title}`, seed: s.seed, catalog: s.id }])),
  'control-hid-device': { description: 'Negative control, not a catalog scenario: the bridge runs without --simulate, so its HID transport is created (node-hid is refused)', seed: DESK_BASIC, fault: 'hid-device' },
  'control-desktop-calls': { description: 'Negative control, not a catalog scenario: the bridge runs without --desktop sim, so the platform OS adapter is created (on Linux the unsupported adapter, which makes no Win32 or UI Automation call)', seed: DESK_BASIC, fault: 'desktop-calls' },
  'control-installed-hub': { description: 'Negative control, not a catalog scenario: the bridge is pointed at the installed Hub\'s port; the run refuses every such request', seed: DESK_BASIC, fault: 'installed-hub' },
});

/** @param {string} dataDir @param {string} name */
export async function seedRun(dataDir, name) {
  if (!RUN_SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);
  await writeFile(join(dataDir, 'scenario.json'), JSON.stringify({ name }), { mode: 0o600 });
  await writeFile(join(dataDir, 'feed-token'), randomBytes(32).toString('base64url'), { mode: 0o600 });
  await writeFile(join(dataDir, 'profile.json'), await readFile(DEFAULT_PROFILE_PATH), { mode: 0o600 });
}
