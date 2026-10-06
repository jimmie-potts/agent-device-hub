import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMemoryHarness } from '../dist/sim/memory.js';
import { DESK_BASIC, SCENARIOS, act, expect, holds, runScenario, scenario, slotOf } from '../dist/sim/scenarios.js';
import { CONTROL } from '../dist/sim/panel.js';
import { onCleanup } from './routing-helpers.mjs';

const runner = fileURLToPath(new URL('../verify/scenarios.mjs', import.meta.url));

async function harness(t, seed = DESK_BASIC) {
  const h = await startMemoryHarness(seed);
  onCleanup(t, () => h.close());
  return h;
}

test('the catalog names each scenario once, with synthetic seeds and at least one observation', () => {
  const ids = SCENARIOS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['send-front-window', 'record-dictation', 'claude-question-wheel', 'codex-card-structure', 'reconnect-no-replay', 'profile-reload', 'task-pages', 'attention-key', 'volume-knob']) assert.ok(scenario(id), id);
  for (const s of SCENARIOS) {
    assert.match(s.id, /^[a-z][a-z0-9-]{2,40}$/);
    assert.ok(s.steps.some(step => step.kind !== 'act'), `${s.id} observes something`);
    assert.ok(s.steps.every(step => step.name.length > 3));
    assert.ok(s.seed.tasks.length > 0);
  }
});

test('an expectation that never holds fails with its name and what was observed, and stops the scenario', async t => {
  const h = await harness(t);
  const result = await runScenario({
    id: 'control-wrong-light', title: 'negative control', seed: DESK_BASIC, steps: [
      expect('the Codex slot key shows the attention color', h => String(h.simulator.leds[slotOf(h, 'codex') - 1]) === String(h.profile().colors.attention) || `LED ${h.simulator.leds[slotOf(h, 'codex') - 1]}`, 300),
      act('never reached', () => { throw new Error('ran after a failure'); }),
    ],
  }, h);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.steps[0], { name: 'the Codex slot key shows the attention color', kind: 'expect', outcome: 'failed', detail: 'LED 0,70,70' });
});

test('an action that throws and a condition that breaks during a hold both fail', async t => {
  const h = await harness(t);
  const thrown = await runScenario({ id: 'control-throws', title: 'negative control', seed: DESK_BASIC, steps: [act('press a slot that has no task', h => slotOf(h, 'codex') && slotOf({ logs: () => [] }, 'claude'))] }, h);
  assert.deepEqual(thrown.steps.map(s => [s.outcome, s.detail]), [['failed', 'no slot assigned to a claude task']]);
  const broken = await runScenario({
    id: 'control-hold', title: 'negative control', seed: DESK_BASIC, steps: [
      act('hold the CHOMPI key', h => h.simulator.press(CONTROL.record)),
      holds('nothing is held', h => h.desktop.held.length === 0 || `held ${h.desktop.held.join('+')}`, 1000),
    ],
  }, h);
  assert.equal(broken.outcome, 'failed');
  assert.equal(broken.steps[1].detail, 'held LeftControl+LeftWindows');
});

test('a catalog scenario fails at the step whose behavior breaks', async t => {
  const codex = scenario('codex-card-structure');
  const seed = { ...codex.seed, desktop: { ...codex.seed.desktop, cards: { codex: { ...codex.seed.desktop.cards.codex, established: false } } } };
  const h = await harness(t, seed);
  const result = await runScenario({ ...codex, seed }, h);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.steps.at(-1).name, 'the first stop (Deny) gets focus', 'an unestablished card leaves the wheel inert');
});

test('the Tier 1 command lists, selects and fails by name', () => {
  const list = execFileSync(process.execPath, [runner, '--list'], { encoding: 'utf8' });
  assert.deepEqual(list.trim().split('\n').map(line => line.split('\t')[0]), SCENARIOS.map(s => s.id));
  const unknown = spawnSync(process.execPath, [runner, 'no-such-scenario'], { encoding: 'utf8' });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown scenario: no-such-scenario/);
  const one = spawnSync(process.execPath, [runner, '--json', 'record-dictation'], { encoding: 'utf8' });
  assert.equal(one.status, 0, one.stdout + one.stderr);
  const [result] = one.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([result.id, result.tier, result.outcome], ['record-dictation', 'memory', 'passed']);
});
