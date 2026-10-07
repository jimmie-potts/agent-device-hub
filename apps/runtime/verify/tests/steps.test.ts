// Hub #920: the runtime adapter's capture steps judged without a supervisor unit, so they also run on CI hosts without
// systemd --user. Each step gets its own freshly seeded run (the supervisor started directly). The edge-grants step and
// every catalog scenario step pass, the same scenarios that pass in the in-memory harness; the negative control fails.
// No step's proof or runtime record holds a grant or the configured modules' synthetic token (Hub #919).
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {runCaptureStep, type CaptureStepResult} from '@jimmie-potts/app-verify';
import {SYNTHETIC_TOKEN} from '../../tests/fixtures/sign.js';
import {SCENARIOS} from '../../tests/scenarios/catalog.js';
import {readGrants} from '../adapter.js';
import plugin from '../plugin.js';
import {base, startRun} from './support.js';

let outputs = 0;
async function judge(context: TestContext, at: string, step: string): Promise<CaptureStepResult> {
  const scenario = plugin.captureSteps[step]?.scenario ?? plugin.defaultScenario;
  const run = await startRun(context, at, scenario);
  try {
    outputs += 1;
    const result = await runCaptureStep(plugin, step, {
      url: run.url, outputDir: join(at, `o${outputs}`), scenario, dataDir: run.dataDir, runtimeDir: run.runtimeDir, endpoints: {harness: run.harness},
    });
    const log = await readFile(result.log, 'utf8');
    for (const token of (await readGrants(run.dataDir)).values()) assert.equal(log.includes(token), false, `${step}: the capture log never holds a grant`);
    const proof = await Promise.all([result.log, ...result.attachments].map(file => readFile(file, 'utf8')));
    assert.equal([...proof, run.stderr()].some(text => text.includes(SYNTHETIC_TOKEN)), false, `${step}: no proof and no runtime record holds the synthetic token`);
    return result;
  } finally {
    assert.equal((await run.stop()).code, 0, `${step}: the run stopped cleanly`);
  }
}

void test('the edge-grants step and every catalog scenario pass in a run; the negative control fails', {timeout: 600_000}, async context => {
  const at = await base(context);
  const reference = Object.keys(plugin.captureSteps).filter(step => !step.startsWith('control-'));
  assert.deepEqual(reference, ['edge-grants', ...SCENARIOS.map(scenario => `scenario-${scenario.id}`), 'follow-one-request']);
  for (const step of reference) {
    const result = await judge(context, at, step);
    assert.equal(result.outcome, 'passed', `${step}: ${result.reason ?? ''}`);
    assert.ok(result.assertions.length >= 2, `${step} asserts its observations`);
    if (step.startsWith('scenario-')) {
      const attached = result.attachments.find(file => file.endsWith('scenario-result.json'));
      if (attached === undefined) assert.fail(`${step} attaches its scenario result`);
      const scenario = JSON.parse(await readFile(attached, 'utf8')) as {synthetic: boolean; physical: boolean; outcome: string; tier: string; problems: unknown[]};
      assert.deepEqual([scenario.synthetic, scenario.physical, scenario.outcome, scenario.tier, scenario.problems], [true, false, 'passed', 'run', []]);
    }
  }
  const control = await judge(context, at, 'control-scenario-fails');
  assert.equal(control.outcome, 'failed');
  assert.ok((control.reason ?? '').startsWith('assertion failed: the scenario passed'), control.reason);
  const absent = await judge(context, at, 'control-follow-fails');
  assert.equal(absent.outcome, 'failed');
  assert.ok((absent.reason ?? '').startsWith('assertion failed: the run found a request that was never sent'), absent.reason);
});

void test('the follow step attaches one answer for each case it judges, and each holds only registered, validated values', {timeout: 300_000}, async context => {
  const at = await base(context);
  const result = await judge(context, at, 'follow-one-request');
  assert.equal(result.outcome, 'passed', result.reason ?? '');
  const names = result.attachments.map(file => file.slice(file.lastIndexOf('/') + 1)).sort();
  assert.deepEqual(names, ['follow-capped.json', 'follow-crash.json', 'follow-missing.json', 'follow-refusal.json', 'follow-replayed.json',
    'follow-success.json', 'follow-trace.json', 'follow-uncertain.json']);
  const answers = new Map<string, {synthetic: boolean; physical: boolean; followed: {schema: string; result: string; gaps: {kind: string; meaning: string}[]}}>();
  for (const file of result.attachments) {
    answers.set(file.slice(file.lastIndexOf('/') + 1), JSON.parse(await readFile(file, 'utf8')) as never);
    const text = await readFile(file, 'utf8');
    assert.equal(/tok_|token|secret|Error:|\bat \w+ \(/i.test(text), false, `${file} holds no token, secret or stack`);
  }
  for (const answer of answers.values()) assert.deepEqual([answer.synthetic, answer.physical, answer.followed.schema], [true, false, 'runtime-follow/1.0']);
  assert.equal(answers.get('follow-missing.json')?.followed.result, 'none-found');
  assert.equal(answers.get('follow-crash.json')?.followed.gaps.some(gap => gap.kind === 'generation-ended-without-stop'), true);
  assert.equal(answers.get('follow-capped.json')?.followed.gaps.some(gap => gap.kind === 'capped'), true);
  assert.equal(result.assertions.length, 9, 'each of the eight cases is judged, and the run\'s boundaries');
});
