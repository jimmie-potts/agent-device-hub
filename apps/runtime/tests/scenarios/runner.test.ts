// The scenario runner and the in-memory harness's boundaries (Hub #846): a failed step names what it observed and stops
// the scenario, and a harness never listens on an installed service's port, keeps its state in a private directory
// outside every checkout, and keeps its run-generated tokens out of every log record and message.
import assert from 'node:assert/strict';
import {mkdir, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {RuntimeError} from '../../src/index.js';
import {it, stateDir} from '../support.js';
import {act, expect, holds, runScenario, scenario, type Scenario} from './catalog.js';
import {INSTALLED_PORTS, listenLoopback, startMemoryHarness} from './memory.js';

const EMPTY = {modules: [], follows: []} as const;
const named = (id: string): Scenario => {
  const found = scenario(id);
  assert.ok(found, id);
  return found;
};

it('an expectation that never holds fails with what it observed, and stops the scenario', async () => {
  const h = await startMemoryHarness(EMPTY, 'in-process');
  try {
    const result = await runScenario({id: 'control-never', title: 'negative control', seed: EMPTY, steps: [
      expect('the lamp is on', probe => probe.devices().lamp.power['lamp-1'] === 'on' || `lamp-1 is ${String(probe.devices().lamp.power['lamp-1'])}`, 200),
      act('never reached', () => { throw new Error('ran after a failure'); }),
    ]}, h);
    assert.equal(result.outcome, 'failed');
    assert.deepEqual(result.steps, [{name: 'the lamp is on', kind: 'expect', outcome: 'failed', detail: 'lamp-1 is off'}]);
  } finally {
    await h.close();
  }
});

it('an act that throws and a hold that breaks both fail', async () => {
  const h = await startMemoryHarness(EMPTY, 'in-process');
  try {
    const thrown = await runScenario({id: 'control-throws', title: 'negative control', seed: EMPTY, steps: [
      act('switch a lamp nobody serves', async probe => {
        const answer = await probe.send('operator', 'none', {key: 'bunny.cmd.lamp.lamp-1', draft: {
          type: 'org.bunny.lamp.switch.requested', subject: 'lamp-1', dataschema: 'https://bunny.invalid/events/lamp-switch/2.0', data: {power: 'on'},
        }}, {timeoutMs: 1000, requestId: 'req-none'});
        throw new Error(`the request is ${answer}`);
      }),
    ]}, h);
    assert.deepEqual(thrown.steps.map(step => [step.outcome, step.detail]), [['failed', 'the request is unavailable']]);
    const broken = await runScenario({id: 'control-hold', title: 'negative control', seed: EMPTY, steps: [
      holds('the clock stands still', probe => probe.now() === Date.parse('2026-10-06T12:00:00.000Z') || 'the clock moved', 100),
    ]}, h);
    assert.equal(broken.outcome, 'failed');
    assert.equal(broken.steps[0]?.detail, 'the clock moved');
  } finally {
    await h.close();
  }
});

it('a catalog scenario fails at the step whose behavior breaks', async () => {
  // The lamp's device fails its next switch, so the first command's outcome is failed rather than succeeded.
  const h = await startMemoryHarness(named('command-tracked-outcome').seed, 'in-process');
  try {
    h.simulate({device: 'lamp', action: 'fail-next'});
    const result = await runScenario(named('command-tracked-outcome'), h);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.steps.at(-1)?.name, 'the lamp is on');
    assert.equal(result.steps.at(-1)?.detail, 'lamp-1 is off');
  } finally {
    await h.close();
  }
});

it('a harness listens on loopback only, and never on an installed service\'s port', async () => {
  const h = await startMemoryHarness(EMPTY, 'remote');
  try {
    const url = new URL(h.url ?? '');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(INSTALLED_PORTS.includes(Number(url.port)), false);
  } finally {
    await h.close();
  }
  // The listener refuses a port it must not use and binds another.
  const server = createServer();
  const seen: number[] = [];
  try {
    const port = await listenLoopback(server, candidate => {
      seen.push(candidate);
      return seen.length === 1;
    });
    assert.equal(seen.length, 2, 'it bound again after the refused port');
    assert.equal(port, (server.address() as AddressInfo).port);
    assert.notEqual(port, seen[0]);
  } finally {
    server.close();
  }
  assert.deepEqual(INSTALLED_PORTS, [8765, 8787, 8788, 8791, 41231]);
});

it('a harness keeps its state private and outside every checkout, and refuses a directory inside one', async context => {
  const h = await startMemoryHarness(EMPTY, 'in-process');
  const dir = h.stateDir;
  try {
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
  } finally {
    await h.close();
  }
  await assert.rejects(stat(dir), 'close removed the state directory');
  const checkout = join(await stateDir(context), 'checkout');
  await mkdir(join(checkout, '.git'), {recursive: true});
  await assert.rejects(startMemoryHarness(EMPTY, 'in-process', {root: checkout}),
    (error: unknown) => error instanceof RuntimeError && error.code === 'state-dir-checkout');
});

it('each harness generates its own tokens, and none appears in a log record, an edge record or a message', async () => {
  const first = await startMemoryHarness(named('command-tracked-outcome').seed, 'remote');
  const second = await startMemoryHarness(EMPTY, 'remote');
  try {
    const result = await runScenario(named('command-tracked-outcome'), first);
    assert.equal(result.outcome, 'passed');
    const tokens = first.tokens();
    assert.equal(tokens.length, 4, 'one per part');
    assert.equal(new Set([...tokens, ...second.tokens()]).size, 8, 'no token repeats within or across harnesses');
    const seen = JSON.stringify([first.logs(), first.edgeLog(), first.published(), first.reader.heard()]);
    for (const token of tokens) assert.equal(seen.includes(token), false);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
