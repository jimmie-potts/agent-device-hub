// Hub #920: the runtime adapter's capture steps judged without a supervisor unit, so they also run on CI hosts without
// systemd --user. Each step gets its own freshly seeded run (the supervisor started directly). The edge-grants step and
// every catalog scenario step pass, the same scenarios that pass in the in-memory harness; the negative control fails.
// No step's proof or runtime record holds a grant or the configured modules' synthetic token (Hub #919).
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import type {Page} from 'playwright';
import {runCaptureStep, type CaptureContext, type CaptureStepResult} from '@jimmie-potts/app-verify';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {SYNTHETIC_TOKEN} from '../../tests/fixtures/sign.js';
import {SCENARIOS, TOKEN_PREFIX, runScenario, scenario} from '../../tests/scenarios/catalog.js';
import {connectRun, readGrants} from '../adapter.js';
import plugin from '../plugin.js';
import {base, captureShard, inShard, startRun} from './support.js';

let outputs = 0;
async function judge(context: TestContext, at: string, step: string): Promise<CaptureStepResult> {
  const scenario = plugin.captureSteps[step]?.scenario ?? plugin.defaultScenario;
  const run = await startRun(context, at, scenario);
  try {
    outputs += 1;
    const original = plugin.captureSteps[step]; assert.ok(original);
    const selected = step !== 'scenario-tidbyt-art' ? plugin : {...plugin, captureSteps: {...plugin.captureSteps, [step]: {...original,
      run: async (given: CaptureContext) => {
        await original.run(given);
        await given.expect('the finalized capture stays on the authenticated exact Tidbyt preview', async () => {
          const page = given.page as Page;
          assert.match(new URL(page.url()).pathname, /^\/modules\/tidbyt\/content\/art\.[0-9a-f]{64}$/);
          assert.deepEqual(await page.locator('img').evaluate(element => {
            const image = element as HTMLImageElement;
            return [image.complete, image.naturalWidth, image.naturalHeight];
          }), [true, 64, 32]);
          assert.equal(await page.getByText('Synthetic Tidbyt art preview · physical display unverified', {exact: true}).isVisible(), true);
        });
      },
    }}};
    const result = await runCaptureStep(selected, step, {
      url: run.url, outputDir: join(at, `o${outputs}`), scenario, dataDir: run.dataDir, runtimeDir: run.runtimeDir, endpoints: {harness: run.harness},
    });
    const log = await readFile(result.log, 'utf8');
    for (const token of (await readGrants(run.dataDir)).values()) assert.equal(log.includes(token), false, `${step}: the capture log never holds a grant`);
    const proof = await Promise.all([result.log, ...result.attachments].map(file => readFile(file, 'utf8')));
    assert.equal([...proof, run.stderr()].some(text => text.includes(SYNTHETIC_TOKEN)), false, `${step}: no proof and no runtime record holds the synthetic token`);
    assert.equal([...proof, run.stderr()].some(text => text.includes(TOKEN_PREFIX)), false, `${step}: no proof and no runtime record holds a part's token (Hub #835)`);
    return result;
  } finally {
    assert.equal((await run.stop()).code, 0, `${step}: the run stopped cleanly`);
  }
}

const reference = Object.keys(plugin.captureSteps).filter(step => !step.startsWith('control-'));
// Packaged qualification splits this file's capture cases between two parallel jobs (#1512). The first shard also keeps
// every test outside the capture loop, so the shards together run each test once. Unset, this process runs them all.
const shard = captureShard();
const first: typeof test = shard.index === 1 ? test : (() => undefined) as never;
void first('assistant recovery waits for a delayed reader resync before submitting its answer once', async context => {
  const selected = scenario('assistant-task'); assert.ok(selected);
  const at = await base(context), run = await startRun(context, at, selected.id);
  const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed: selected.seed});
  try {
    const restart = h.restart.bind(h), wait = h.wait.bind(h), states = h.reader.states.bind(h.reader), syncs = h.reader.syncs.bind(h.reader), gateway = h.gateway.bind(h);
    let heldPolls = 0, oldSyncs = 0, oldStates: Message<unknown>[] = [], answers = 0;
    h.restart = async () => {
      oldStates = states('assistant-state', 'bunny/modules/companions'); oldSyncs = syncs('assistant-state', 'bunny/modules/companions');
      await restart(); heldPolls = 20;
    };
    // Hold the observed copy across more polls than the scenario's 100 ms stability check, independent of host speed.
    h.wait = async ms => {await wait(ms); heldPolls = Math.max(0, heldPolls - 1);};
    h.reader.states = <T>(family: string, owner?: string): Message<T>[] =>
      family === 'assistant-state' && heldPolls > 0 ? oldStates as Message<T>[] : states<T>(family, owner);
    h.reader.syncs = (family, owner) => family === 'assistant-state' && heldPolls > 0 ? oldSyncs : syncs(family, owner);
    h.gateway = call => {if (call.path.includes('requestId=assistant-answer')) answers += 1; return gateway(call);};
    const result = await runScenario(selected, h);
    assert.equal(result.outcome, 'passed', JSON.stringify(result.steps.filter(step => step.outcome !== 'passed')));
    assert.equal(answers, 1, 'the scenario submits one answer after resync, never retries a refused input');
  } finally {await h.close(); assert.equal((await run.stop()).code, 0);}
});

for (const stalled of [false, true]) {
  void first(stalled ? 'agent hooks reject a reader that never resyncs' : 'agent hooks wait for a delayed reader resync before judging the restarted session', {timeout: 300_000}, async context => {
    const selected = scenario('agent-hooks'); assert.ok(selected);
    const at = await base(context), run = await startRun(context, at, selected.id);
    const h = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed: selected.seed});
    try {
      const hook = h.hook.bind(h), wait = h.wait.bind(h), states = h.reader.states.bind(h.reader), syncs = h.reader.syncs.bind(h.reader);
      let heldPolls = 0, oldSyncs = 0, oldStates: Message<unknown>[] = [], freshHooks = 0;
      h.hook = async (payload, options) => {
        if (options?.runtime === 'stopped') {
          oldStates = states('session'); oldSyncs = syncs('session');
          const result = await hook(payload, options);
          heldPolls = stalled ? 0 : 400;
          return result;
        }
        if (h.generation() === 2) {
          assert.equal(heldPolls, 0, 'the next live hook waits for the reader to catch up');
          freshHooks += 1;
        }
        return hook(payload, options);
      };
      // Keep the pre-restart copy for four seconds of polling, beyond the usual three-second expectation budget.
      h.wait = async ms => {await wait(ms); heldPolls = Math.max(0, heldPolls - 1);};
      h.reader.states = <T>(family: string, owner?: string): Message<T>[] =>
        family === 'session' && heldPolls > 0 ? oldStates as Message<T>[] : states<T>(family, owner);
      // In the stalled case, expose real state but withhold the completed-sync signal: matching values alone are insufficient.
      h.reader.syncs = (family, owner) => family === 'session' && (heldPolls > 0 || (stalled && h.generation() === 2)) ? oldSyncs : syncs(family, owner);
      const result = await runScenario(selected, h);
      assert.equal(result.outcome, stalled ? 'failed' : 'passed', JSON.stringify(result.steps.filter(step => step.outcome !== 'passed')));
      if (stalled) {
        assert.equal(result.steps.at(-1)?.name, 'the reader syncs the restarted session');
        assert.match(result.steps.at(-1)?.detail ?? '', /^session syncs /);
      }
      assert.equal(freshHooks, stalled ? 0 : 1, 'only a completed resync permits the next explicit live hook');
    } finally {await h.close(); assert.equal((await run.stop()).code, 0);}
  });
}

void first('the capture steps include edge grants, every catalog scenario and request following', () => {
  assert.deepEqual(reference, ['mac-codex-local', 'edge-grants', ...SCENARIOS.map(scenario => `scenario-${scenario.id}`), 'browser-speech', 'follow-one-request']);
});

void first('the capture shards take every case exactly once, and a malformed shard is refused', () => {
  for (const count of [1, 2, 3]) {
    const taken = Array.from({length: count}, (_, at) => inShard(reference, {index: at + 1, count})).flat();
    assert.deepEqual([...taken].sort(), [...reference].sort(), `${count} shards take every case`);
    assert.equal(new Set(taken).size, reference.length, `${count} shards take no case twice`);
  }
  assert.deepEqual(captureShard(''), {index: 1, count: 1});
  assert.deepEqual(captureShard('2/2'), {index: 2, count: 2});
  for (const value of ['0/2', '3/2', '1', '1/2/3', ' 1/2', '1/0', 'a/b']) assert.throws(() => captureShard(value), /BUNNY_CAPTURE_SHARD/, value);
});

// Each capture keeps its own timeout and fresh run. Catalog growth must not consume another case's test budget;
// the serial test runner and the CI job's outer bound still limit the complete suite.
for (const step of inShard(reference, shard)) {
  void test(`${step} passes in a fresh run`, {timeout: 300_000}, async context => {
    const at = await base(context);
    const result = await judge(context, at, step);
    assert.equal(result.outcome, 'passed', `${step}: ${result.reason ?? ''}`);
    assert.ok(result.assertions.length >= 2, `${step} asserts its observations`);
    if (step.startsWith('scenario-')) {
      const attached = result.attachments.find(file => file.endsWith('scenario-result.json'));
      if (attached === undefined) assert.fail(`${step} attaches its scenario result`);
      const scenario = JSON.parse(await readFile(attached, 'utf8')) as {synthetic: boolean; physical: boolean; clock: string; outcome: string; tier: string; problems: unknown[]};
      // The proof says which clock the run was on (Hub #1710): virtual only for a scenario that asks for it.
      const clock = SCENARIOS.find(entry => `scenario-${entry.id}` === step)?.runClock ?? 'real';
      assert.deepEqual([scenario.synthetic, scenario.physical, scenario.clock, scenario.outcome, scenario.tier, scenario.problems], [true, false, clock, 'passed', 'run', []]);
    }
    if (step === 'follow-one-request') await assertFollowAttachments(result);
  });
}

void first('the scenario negative control fails in a fresh run', {timeout: 300_000}, async context => {
  const at = await base(context);
  const control = await judge(context, at, 'control-scenario-fails');
  assert.equal(control.outcome, 'failed');
  assert.ok((control.reason ?? '').startsWith('assertion failed: the scenario passed'), control.reason);
});

void first('the follow negative control fails in a fresh run', {timeout: 300_000}, async context => {
  const at = await base(context);
  const absent = await judge(context, at, 'control-follow-fails');
  assert.equal(absent.outcome, 'failed');
  assert.ok((absent.reason ?? '').startsWith('assertion failed: the run found a request that was never sent'), absent.reason);
});

// Judge the attachment contract on the same fresh capture as the generic checks above. A second capture repeats
// the eight real cases and their safety windows without adding coverage.
async function assertFollowAttachments(result: CaptureStepResult): Promise<void> {
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
}
