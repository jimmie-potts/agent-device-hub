// Tier 1 of the runtime's scenario catalog (Hub #846): every scenario runs in the in-memory harness, once with its
// parts on the runtime's bus and once through the runtime's SDK edge over SSE and HTTP. Every message the harness sees
// must follow profile 2.0, and no part may report an error. `BUNNY_SCENARIO_SHARD=i/n` generates only shard i of n of
// the scenario and transport pairs (Hub #1674, ./shard.ts).
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {moduleFolders} from '../../build/registry.js';
import {it} from '../support.js';
import {MODULE_FILES, ROLES, SCENARIOS, TRANSPORTS, runScenario, type ScenarioResult} from './catalog.js';
import {startMemoryHarness, type MemoryHarness} from './memory.js';
import {SHARD_VARIABLE, parseShard, shardOf} from './shard.js';

/** A failed run's steps and the runtime's last log records, to show why it failed. */
function describe(result: ScenarioResult, h: MemoryHarness): string {
  const steps = result.steps.map(step => `  ${step.outcome === 'passed' ? 'ok  ' : 'FAIL'} ${step.kind} ${step.name}${step.detail === undefined ? '' : ` (${step.detail})`}`);
  const logs = h.logs().slice(-12).map(({generation, record}) => `  [${generation}] ${record.event_name} ${JSON.stringify(record.attributes)}`);
  return [`${result.id} over ${result.transport} failed:`, ...steps, 'last runtime records:', ...logs].join('\n');
}

/** The module scenario files in the source tree, by name: each one's `.ts` beside the catalog's source. */
const SOURCES = readdirSync(fileURLToPath(new URL('../../../tests/scenarios/modules/', import.meta.url))).filter(file => file.endsWith('.ts')).map(file => file.slice(0, -'.ts'.length)).sort();
const MODULE_FOLDERS = moduleFolders(fileURLToPath(new URL('../../../../../', import.meta.url)));

/** Every scenario and transport pair, in the catalog's order. */
const PAIRS = SCENARIOS.flatMap(scenario => TRANSPORTS.map(transport => ({scenario, transport})));

/** The pairs this run generates and whether it runs the structural tests, or why its shard selection was refused. */
function select(): {pairs: typeof PAIRS; structural: boolean; refusal?: string} {
  try {
    const shard = parseShard(process.env[SHARD_VARIABLE], PAIRS.length);
    // The structural tests run unsharded and in shard 1 only, so that the shards' totals add up to the unsharded run's.
    return shard === undefined ? {pairs: PAIRS, structural: true} : {pairs: shardOf(PAIRS, shard), structural: shard.index === 1};
  } catch (error) {
    return {pairs: [], structural: false, refusal: error instanceof Error ? error.message : String(error)};
  }
}
const selection = select();
const {refusal} = selection;
// A refused selection fails the file instead of passing with no catalog tests.
if (refusal !== undefined) it('the shard selection names one shard of the catalog', () => assert.fail(refusal));
const structural: typeof it = selection.structural ? it : () => undefined;

structural('the catalog names each scenario once, the core\'s first, and each one observes something', () => {
  const ids = SCENARIOS.map(scenario => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 22), [
    'approval-reaches-every-module', 'command-tracked-outcome', 'module-fails-others-continue', 'reconnect-and-sync', 'zero-modules', 'agent-sessions',
    'end-to-end', 'configured-module', 'misconfigured-module', 'device-owners', 'gateway-reads', 'grants-and-duplicates', 'approval-recovery',
    'module-contributions', 'agent-hooks',
    'dashboard-sessions', 'dashboard-finished-turn', 'session-label', 'dashboard-controls', 'notice-clear', 'operation-records', 'shared-inbox-history',
  ]);
  for (const scenario of SCENARIOS) {
    assert.match(scenario.id, /^[a-z][a-z0-9-]{2,40}$/);
    assert.ok(scenario.steps.some(step => step.kind !== 'act'), `${scenario.id} observes something`);
    assert.ok(scenario.steps.every(step => step.name.length > 3), `${scenario.id} names its steps`);
    if (scenario.seed.modules.length > 0) assert.equal(scenario.seed.modules[0], 'core', `${scenario.id} starts the core first`);
  }
});

structural('the catalog includes the real scheduled rain journey', () => {
  assert.ok(SCENARIOS.some(scenario => scenario.id === 'art-schedule'), 'the scheduled rain scenario is registered');
});

// Each module's scenarios live in its own file, which the catalog collects without naming it (Hub #999).
structural('the catalog collects every module\'s scenario file, in name order, each named after a module folder with a scenario of its own', () => {
  assert.deepEqual(Object.keys(MODULE_FILES), SOURCES, 'every source file was built and collected');
  const ids = SCENARIOS.map(scenario => scenario.id);
  assert.deepEqual(ids.slice(ids.length - Object.values(MODULE_FILES).flatMap(file => file.scenarios).length),
    Object.values(MODULE_FILES).flatMap(file => file.scenarios.map(scenario => scenario.id)), 'the modules\' scenarios follow the core\'s, file by file');
  for (const [name, file] of Object.entries(MODULE_FILES)) {
    assert.ok(MODULE_FOLDERS.includes(name), `${name}.ts names a module folder`);
    assert.ok(file.scenarios.length > 0, `${name}.ts holds a scenario`);
  }
});

for (const {scenario, transport} of selection.pairs) {
  it(`${scenario.id} over ${transport}: ${scenario.title}`, async () => {
    const h = await startMemoryHarness(scenario.seed, transport);
    try {
      const result = await runScenario(scenario, h);
      assert.equal(result.outcome, 'passed', describe(result, h));
      assert.deepEqual(h.problems(), [], 'every message followed profile 2.0, and no part reported an error');
      const connected = new Set(h.edgeLog().flatMap(record => record.event === 'edge.connected' && record.source !== undefined ? [record.source] : []));
      assert.deepEqual([...connected].sort(), transport === 'remote' ? ROLES.map(role => `bunny/parts/${role}`).sort() : [],
        transport === 'remote' ? 'every part reached the runtime through its edge' : 'no part used an edge');
    } finally {
      await h.close();
    }
  }, scenario.memoryTimeoutMs);
}
