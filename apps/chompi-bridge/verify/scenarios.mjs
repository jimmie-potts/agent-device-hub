// Tier 1 of the CHOMPI bridge scenario catalog (Hub #853): each scenario runs against the real bridge CLI
// (`run --simulate --desktop sim`) in memory, on a manual clock, with the synthetic Hub feed. Nothing listens,
// opens a device or reaches a desktop.
//
//   npm run -s test:chompi-bridge:scenarios                       # every scenario
//   npm run -s test:chompi-bridge:scenarios -- <id> [<id>...]     # named scenarios
//   npm run -s test:chompi-bridge:scenarios -- --list             # ids and titles
//   npm run -s test:chompi-bridge:scenarios -- --json [<id>...]   # one JSON result per line
//
// Exit codes: 0 every scenario passed, 1 a scenario failed, 2 usage (an unknown id).
import { SCENARIOS, runScenario } from '../dist/sim/scenarios.js';
import { startMemoryHarness } from '../dist/sim/memory.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const ids = args.filter(arg => !arg.startsWith('--'));

if (args.includes('--list')) {
  for (const scenario of SCENARIOS) process.stdout.write(`${scenario.id}\t${scenario.title}\n`);
  process.exit(0);
}
const unknown = ids.filter(id => !SCENARIOS.some(s => s.id === id));
if (unknown.length) {
  process.stderr.write(`unknown scenario: ${unknown.join(', ')}; known: ${SCENARIOS.map(s => s.id).join(', ')}\n`);
  process.exit(2);
}

let failed = 0;
for (const scenario of SCENARIOS.filter(s => ids.length === 0 || ids.includes(s.id))) {
  const started = Date.now();
  /** @type {import('../dist/sim/scenarios.js').ScenarioResult & {error?: string}} */
  let result;
  /** @type {import('../dist/sim/memory.js').MemoryHarness | undefined} */
  let harness;
  try {
    harness = await startMemoryHarness(scenario.seed);
    result = await runScenario(scenario, harness, step => {
      if (!json) process.stdout.write(`  ${step.outcome === 'passed' ? 'ok  ' : 'FAIL'} ${step.kind.padEnd(6)} ${step.name}${step.detail ? ` (${step.detail})` : ''}\n`);
    });
  } catch (error) {
    result = { id: scenario.id, title: scenario.title, tier: 'memory', outcome: 'failed', steps: [], error: error instanceof Error ? error.message : String(error) };
  }
  const code = harness ? await harness.close() : null;
  if (result.outcome === 'passed' && code !== 0) result = { ...result, outcome: 'failed', error: `the bridge exited ${code}` };
  if (result.outcome !== 'passed') failed++;
  if (json) process.stdout.write(`${JSON.stringify({ ...result, ms: Date.now() - started })}\n`);
  else {
    const shown = harness;
    process.stdout.write(`${result.outcome === 'passed' ? 'passed' : 'FAILED'} ${scenario.id}: ${scenario.title} (${Date.now() - started} ms)${result.error ? `\n  ${result.error}` : ''}\n`);
    if (result.outcome !== 'passed' && shown) process.stdout.write(`  bridge output tail:\n${shown.output().trim().split('\n').slice(-15).map(line => `    ${line}`).join('\n')}\n`);
  }
}
if (!json) process.stdout.write(`${failed ? `${failed} scenario(s) failed` : 'all scenarios passed'}\n`);
process.exitCode = failed ? 1 : 0;
