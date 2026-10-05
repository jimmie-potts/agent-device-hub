// Hub #853 fix round 1: a catalog scenario started from the page right after a (re)seed waits until the run is
// ready, so its first press reaches a connected controller; a run that never becomes ready records a failed
// readiness step with what it saw instead of a lost press.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { READY_STEP } from '../../dist/sim/scenarios.js';
import { seedRun, startServer } from '../server.mjs';

const shortTmp = () => (tmpdir().length <= 60 ? tmpdir() : '/tmp');

async function started(t, scenario, options = {}) {
  const dataDir = await mkdtemp(join(shortTmp(), 'cr-'));
  await seedRun(dataDir, scenario);
  const server = await startServer({ dataDir, processHooks: Object.assign(new EventEmitter(), { exit() {} }), ...options });
  t.after(async () => { await server.close(); await rm(dataDir, { recursive: true, force: true }); });
  const api = async (path, body) => {
    const response = await fetch(new URL(path, server.url), body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { server, api };
}

async function finished(api, ms = 45000) {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    const { body } = await api('/api/harness/state');
    if (body.scenario && body.scenario.state !== 'running') return body.scenario;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('the scenario did not finish');
}

test('a scenario run immediately after the seed waits for the run to be ready and passes', async t => {
  const { api } = await started(t, 'send-front-window');
  const before = (await api('/api/harness/state')).body;
  assert.notEqual(before.ready, true, 'right after the seed the controller is still connecting');
  assert.equal(typeof before.ready, 'string');
  assert.equal((await api('/api/harness/scenario', { op: 'run' })).status, 200);
  const result = await finished(api);
  assert.equal(result.state, 'passed', JSON.stringify(result.steps.at(-1)));
  assert.equal(result.steps[0].name, 'press the Codex task\'s slot key');
  assert.equal((await api('/api/harness/state')).body.ready, true);
});

test('a run that never becomes ready records a failed readiness step, not a lost press', async t => {
  const { api, server } = await started(t, 'send-front-window', { readyTimeoutMs: 1500 });
  assert.equal((await api('/api/harness/controller', { op: 'unplug' })).status, 200);
  assert.equal((await api('/api/harness/scenario', { op: 'run' })).status, 200);
  const result = await finished(api);
  assert.equal(result.state, 'failed');
  assert.deepEqual(result.steps, [{ name: READY_STEP, kind: 'expect', outcome: 'failed', detail: 'controller not connected' }]);
  assert.equal(server.parts.desktop.log.filter(e => e.kind === 'link' || e.kind === 'key').length, 0, 'no step acted');
});
