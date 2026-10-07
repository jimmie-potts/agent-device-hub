// Tier 1 of the runtime's scenario catalog (Hub #846): every scenario runs in the in-memory harness, once with its
// parts on the runtime's bus and once through the runtime's SDK edge over SSE and HTTP. Every message the harness sees
// must follow profile 2.0, and no part may report an error.
import assert from 'node:assert/strict';
import {it} from '../support.js';
import {ROLES, SCENARIOS, TRANSPORTS, runScenario, type ScenarioResult} from './catalog.js';
import {startMemoryHarness, type MemoryHarness} from './memory.js';

/** A failed run's steps and the runtime's last log records, to show why it failed. */
function describe(result: ScenarioResult, h: MemoryHarness): string {
  const steps = result.steps.map(step => `  ${step.outcome === 'passed' ? 'ok  ' : 'FAIL'} ${step.kind} ${step.name}${step.detail === undefined ? '' : ` (${step.detail})`}`);
  const logs = h.logs().slice(-12).map(({generation, record}) => `  [${generation}] ${record.event_name} ${JSON.stringify(record.attributes)}`);
  return [`${result.id} over ${result.transport} failed:`, ...steps, 'last runtime records:', ...logs].join('\n');
}

it('the catalog names each scenario once, and each one observes something', () => {
  const ids = SCENARIOS.map(scenario => scenario.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [
    'approval-reaches-every-module', 'command-tracked-outcome', 'module-fails-others-continue', 'reconnect-and-sync', 'zero-modules', 'agent-sessions',
    'end-to-end', 'configured-module', 'misconfigured-module', 'speaker-playback', 'lifx-bulbs', 'device-owners', 'tidbyt-tiles', 'gateway-reads',
    'grants-and-duplicates', 'approval-recovery', 'module-contributions',
    'pixoo-monitor', 'pixoo-media', 'pixoo-now-playing', 'pixoo-offline', 'nanoleaf-wall',
  ]);
  for (const scenario of SCENARIOS) {
    assert.match(scenario.id, /^[a-z][a-z0-9-]{2,40}$/);
    assert.ok(scenario.steps.some(step => step.kind !== 'act'), `${scenario.id} observes something`);
    assert.ok(scenario.steps.every(step => step.name.length > 3), `${scenario.id} names its steps`);
    if (scenario.seed.modules.length > 0) assert.equal(scenario.seed.modules[0], 'core', `${scenario.id} starts the core first`);
  }
});

for (const scenario of SCENARIOS) {
  for (const transport of TRANSPORTS) {
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
    });
  }
}
