// Hub #920: each boundary check of a runtime verification run passes on a correct run and fails when the run crosses
// its boundary. The crossing runs are real: the shipped runtime without --simulate, a probe module that reaches for the
// installed Hub's port 8788 (the guard refuses it before it connects), and the runtime left to its default state
// directory (inside the run's private home, so nothing personal is touched).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ProbeContext} from '@jimmie-potts/app-verify';
import {checkNoOutboundConnections, checkPrivateState, checkSimulatedTransports} from '../boundaries.js';
import plugin, {startOnlyRefusal} from '../plugin.js';
import type {BoundaryReport} from '../protocol.js';
import {START_ONLY} from '../seed.js';
import {base, startRun, type Started} from './support.js';

const report = (overrides: Partial<BoundaryReport> = {}): BoundaryReport => ({
  runtime: 'fixtures', simulate: true, stateDir: '/run/data/state', runStateDir: '/run/data/state', dataDir: '/run/data', home: '/run/data/home',
  grantsMode: 0o600, outbound: [], ...overrides,
});

void test('each check passes on a clean report and fails on each way of crossing its boundary', () => {
  assert.deepEqual([checkSimulatedTransports(report()), checkNoOutboundConnections(report()), checkPrivateState(report())].map(check => check.outcome),
    ['passed', 'passed', 'passed']);
  for (const simulate of [false, null]) assert.equal(checkSimulatedTransports(report({simulate})).outcome, 'failed', String(simulate));
  const outbound = checkNoOutboundConnections(report({outbound: [{host: '127.0.0.1', port: 8788}]}));
  assert.equal(outbound.outcome, 'failed');
  assert.match(outbound.outcome === 'failed' ? outbound.reason : '', /127\.0\.0\.1:8788.*an installed service's port was targeted/);
  assert.equal(checkNoOutboundConnections(report({outbound: [{host: 'device.invalid', port: 80}]})).outcome, 'failed');
  for (const crossing of [{stateDir: null}, {stateDir: '/elsewhere/state'}, {home: '/home/owner'}, {grantsMode: 0o644}, {grantsMode: null}]) {
    assert.equal(checkPrivateState(report(crossing)).outcome, 'failed', JSON.stringify(crossing));
  }
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
      assert.deepEqual(await checks(run), outcomes, scenario);
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
