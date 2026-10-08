// Hub #920: each boundary check of a runtime verification run passes on a correct run and fails when the run crosses
// its boundary. The crossing runs are real: the shipped runtime without --simulate, a probe module that reaches for the
// installed Hub's port 8788 with fetch and with node:http (the guard refuses both before they connect), and the runtime
// left to its default state directory, which it then creates under the run's private home, so nothing personal is
// touched. The checks judge what happened, not what the runtime was told.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ProbeContext} from '@jimmie-potts/app-verify';
import {checkNoOutboundConnections, checkPrivateState, checkSimulatedTransports} from '../boundaries.js';
import plugin, {startOnlyRefusal} from '../plugin.js';
import {HARNESS_PATH, type BoundaryReport} from '../protocol.js';
import {START_ONLY} from '../seed.js';
import {base, startRun, type Started} from './support.js';

const report = (overrides: Partial<BoundaryReport> = {}): BoundaryReport => ({
  runtime: 'fixtures', simulate: true, dataDir: '/run/data', home: '/run/data/home', defaultState: false,
  stateFiles: ['/run/data/state/modules/core.sqlite', '/run/data/state/modules/lamp.sqlite'], grantsMode: 0o600, outbound: [], ...overrides,
});

void test('each check passes on a clean report and fails on each way of crossing its boundary', () => {
  assert.deepEqual([checkSimulatedTransports(report()), checkNoOutboundConnections(report()), checkPrivateState(report())].map(check => check.outcome),
    ['passed', 'passed', 'passed']);
  for (const simulate of [false, null]) assert.equal(checkSimulatedTransports(report({simulate})).outcome, 'failed', String(simulate));
  const outbound = checkNoOutboundConnections(report({outbound: [{protocol: 'tcp', host: '127.0.0.1', port: 8788}]}));
  assert.equal(outbound.outcome, 'failed');
  assert.match(outbound.outcome === 'failed' ? outbound.reason : '', /tcp 127\.0\.0\.1:8788.*an installed service's port was targeted/);
  assert.equal(checkNoOutboundConnections(report({outbound: [{protocol: 'udp', host: '239.255.255.250', port: 1900}]})).outcome, 'failed');
  for (const crossing of [
    {defaultState: true}, {stateFiles: ['/run/data/state/modules/core.sqlite', '/home/owner/.local/state/agent-device-hub/runtime/modules/lamp.sqlite']},
    {stateFiles: ['/run/data/state-elsewhere/modules/core.sqlite']}, {home: '/home/owner'}, {home: ''}, {grantsMode: 0o644}, {grantsMode: null},
  ]) {
    assert.equal(checkPrivateState(report(crossing)).outcome, 'failed', JSON.stringify(crossing));
  }
  assert.equal(checkPrivateState(report({stateFiles: []})).outcome, 'passed', 'a run whose modules keep no database has none open');
});

/** The plug-in's own boundary checks against a run, by id. */
async function checks(run: Started): Promise<Record<string, string>> {
  const context = {url: run.url, endpoints: {harness: run.harness}, signal: AbortSignal.timeout(5000)} as unknown as ProbeContext;
  const ids = (plugin.checks ?? []).filter(check => check.id !== 'build-current');
  return Object.fromEntries(await Promise.all(ids.map(async check => [check.id, (await check.run(context)).outcome] as const)));
}

void test('a correct run passes every check, and each negative control fails exactly its own', {timeout: 120_000}, async context => {
  const at = await base(context);
  const expected: Record<string, Record<string, string>> = {
    fixtures: {'simulated-transports': 'passed', 'no-outbound-connections': 'passed', 'private-state': 'passed'},
    shipped: {'simulated-transports': 'passed', 'no-outbound-connections': 'passed', 'private-state': 'passed'},
    'control-real-transports': {'simulated-transports': 'failed', 'no-outbound-connections': 'passed', 'private-state': 'passed'},
    'control-installed-port': {'simulated-transports': 'passed', 'no-outbound-connections': 'failed', 'private-state': 'passed'},
    'control-default-state': {'simulated-transports': 'passed', 'no-outbound-connections': 'passed', 'private-state': 'failed'},
  };
  assert.deepEqual([...START_ONLY].sort(), ['control-default-state', 'control-installed-port', 'control-real-transports']);
  for (const [scenario, outcomes] of Object.entries(expected)) {
    const run = await startRun(context, at, scenario);
    try {
      // Each run passes readiness first, so a control fails its own boundary check rather than its health (Hub #954).
      const ready = await plugin.readiness.probe({url: run.readyUrl, scenario, signal: AbortSignal.timeout(5000)} as unknown as ProbeContext);
      assert.deepEqual(ready, {ok: true}, `${scenario}: readiness`);
      assert.deepEqual(await checks(run), outcomes, scenario);
      const seen = await (await fetch(new URL(`${HARNESS_PATH}/boundaries`, run.harness))).json() as BoundaryReport;
      assert.equal(seen.home, `${run.dataDir}/home`, `${scenario}: the runtime's home is observed`);
      if (scenario === 'fixtures' || scenario === 'shipped') {
        const restart = await fetch(new URL(`${HARNESS_PATH}/restart`, run.harness), {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
        assert.equal(restart.status, 200);
        await restart.body?.cancel();
        const after = await (await fetch(new URL(`${HARNESS_PATH}/boundaries`, run.harness))).json() as BoundaryReport;
        assert.equal(after.home, `${run.dataDir}/home`, `${scenario}: the new child supplies its own home`);
        assert.deepEqual(await checks(run), outcomes, `${scenario}: boundaries after restart`);
      }
      if (scenario === 'fixtures') {
        const modules = ['chime', 'core', 'lamp'].map(name => `${run.dataDir}/state/modules/${name}.sqlite`);
        assert.deepEqual(seen.stateFiles, modules, 'the databases the runtime has open are observed');
      }
      if (scenario === 'control-installed-port') {
        assert.ok(seen.outbound.filter(attempt => attempt.protocol === 'tcp' && attempt.port === 8788).length >= 2, `fetch and node:http were both refused: ${JSON.stringify(seen.outbound)}`);
      }
    } finally {
      await run.stop();
    }
  }
});

void test('a running run is never reseeded into a boundary negative control', () => {
  for (const argv of [
    ['scenario', 'runtime-x', 'control-real-transports'], ['handoff', 'runtime-x', '--reset', 'control-default-state'],
    ['handoff', '--reset', 'control-installed-port', 'runtime-x'], ['scenario', '--lease', '5', 'runtime-x', 'control-installed-port'],
  ]) assert.equal(startOnlyRefusal(argv)?.error, 'start-only-scenario', argv.join(' '));
  for (const argv of [['scenario', 'runtime-x', 'end-to-end'], ['start', '--scenario', 'control-real-transports'], ['handoff', 'runtime-x'], []]) {
    assert.equal(startOnlyRefusal(argv), undefined, argv.join(' '));
  }
});
