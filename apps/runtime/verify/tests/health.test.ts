// Hub #954: a run's readiness and `doctor` report the runtime's own health, judged as the in-memory harness judges a
// scenario's start. `doctor` once said `health: passed` while the runtime was `degraded` with a failed module, because
// the probe read only the HTTP status.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ProbeContext} from '@jimmie-potts/app-verify';
import type {ModuleHealth, RuntimeHealth} from '../../src/index.js';
import {runScenario, scenario} from '../../tests/scenarios/catalog.js';
import {connectRun} from '../adapter.js';
import {judgeHealth} from '../health.js';
import plugin from '../plugin.js';
import {base, startRun, type Started} from './support.js';

const module = (name: string, state: ModuleHealth['state'], code?: string): ModuleHealth => ({
  name, apiVersion: '1.1', state, healthy: state === 'running', syncRestarts: 0, ...(code === undefined ? {} : {reason: {code, detail: 'tok_SYNTHETIC954 never shown'}}),
});
const health = (modules: ModuleHealth[], lagCheck: RuntimeHealth['lagCheck'] = {status: 'off'}): RuntimeHealth => ({
  schema: 'runtime-health/1.0', status: modules.every(entry => entry.healthy) && lagCheck.status !== 'stopped' ? 'ok' : 'degraded', moduleApiVersion: '1.2',
  startedAtMs: 0, uptimeMs: 1, memory: {rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 1}, lagCheck, modules,
});

void test('a run is healthy when every module runs, or a module its seed expects refused is refused, and the lag check has not stopped', () => {
  assert.deepEqual(judgeHealth(health([module('core', 'running'), module('lamp', 'running')])), {ok: true});
  assert.deepEqual(judgeHealth(health([module('core', 'running'), module('sign', 'refused', 'invalid-request')]), ['sign']), {ok: true}, 'an expected refusal');
  assert.deepEqual(judgeHealth(health([module('core', 'running'), module('nanoleaf', 'failed', 'internal')])),
    {ok: false, reason: 'the runtime is degraded: nanoleaf failed (internal)'}, 'a failed module, as #968\'s Acceptance review saw');
  assert.deepEqual(judgeHealth(health([module('core', 'running'), module('sign', 'refused', 'invalid-request')])),
    {ok: false, reason: 'the runtime is degraded: sign refused (invalid-request)'}, 'a refusal the seed does not expect');
  assert.deepEqual(judgeHealth(health([module('core', 'running'), module('sign', 'failed', 'internal')]), ['sign']),
    {ok: false, reason: 'the runtime is degraded: sign failed (internal)'}, 'an expected refusal excuses a refusal only');
  assert.deepEqual(judgeHealth(health([module('core', 'starting')])), {ok: false, reason: 'the runtime is degraded: core starting'}, 'not ready yet');
  assert.deepEqual(judgeHealth(health([module('core', 'running')], {status: 'stopped', limitMs: 1000})), {ok: false, reason: 'the runtime is degraded: the lag check stopped'});
  const reason = judgeHealth(health([module('lamp', 'failed', 'internal')]));
  assert.equal(JSON.stringify(reason).includes('tok_SYNTHETIC954'), false, 'a reason names states and codes, never a module\'s detail');
});

const probe = (run: Started, name: string): Promise<{ok: boolean; reason?: string}> =>
  plugin.readiness.probe({url: run.readyUrl, endpoints: {harness: run.harness}, scenario: name, signal: AbortSignal.timeout(5000)} as unknown as ProbeContext);

void test('doctor\'s health reads the runtime: a module that failed in a run makes it fail, and a refusal the seed expects does not', {timeout: 120_000}, async context => {
  const at = await base(context);
  const failing = scenario('module-fails-others-continue');
  assert.ok(failing !== undefined);
  const run = await startRun(context, at, failing.id);
  try {
    assert.deepEqual(await probe(run, failing.id), {ok: true}, 'every module runs at the start');
    const adapter = await connectRun({url: run.url, harness: run.harness, dataDir: run.dataDir, seed: failing.seed});
    try {
      assert.equal((await runScenario(failing, adapter)).outcome, 'passed');
    } finally {
      await adapter.close();
    }
    assert.deepEqual(await probe(run, failing.id), {ok: false, reason: 'the runtime is degraded: chime failed (internal)'}, 'the chime failed during the scenario');
  } finally {
    await run.stop();
  }
  const misconfigured = await startRun(context, at, 'misconfigured-module');
  try {
    assert.deepEqual(await probe(misconfigured, 'misconfigured-module'), {ok: true}, 'the seed expects the sign refused');
    assert.deepEqual(await probe(misconfigured, 'fixtures'), {ok: false, reason: 'the runtime is degraded: sign refused (invalid-request)'},
      'judged against a seed that expects no refusal, the same runtime is degraded');
  } finally {
    await misconfigured.stop();
  }
});
