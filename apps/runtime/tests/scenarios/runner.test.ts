// The scenario runner and the in-memory harness's boundaries (Hub #846): a failed step names what it observed and stops
// the scenario, and a harness never listens on an installed service's port, keeps its state in a private directory
// outside every checkout, and keeps its run-generated tokens out of every log record and message.
import assert from 'node:assert/strict';
import {mkdir, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, traceFields} from '@jimmie-potts/sdk';
import {RuntimeError} from '../../src/index.js';
import {assertContractRecords, it, stateDir} from '../support.js';
import {StepFailure, act, expect, hookProblem, holds, runScenario, scenario, type Harness, type Scenario} from './catalog.js';
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
        const answer = await probe.send('operator', 'none', {key: 'bunny.cmd.lamp-switch.lamp-1', draft: {
          type: 'org.bunny.lamp.switch.requested', subject: 'lamp-1', dataschema: 'https://bunny.invalid/events/lamp-switch/2.0', data: {power: 'on'},
        }}, {timeoutMs: 1000, requestId: 'req-none'});
        throw new StepFailure(`the request is ${answer}`);
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

// A run keeps each step's detail in its proof, so a step names an exception by its type or registry code, never by its
// message, which may quote anything; a step's own failure keeps its fixed text (ADR 0012, "Safe errors"; Hub #954).
it('a failed step names an exception by its type or registry code, never its message, and keeps a step\'s own text', async () => {
  const secret = 'tok_SYNTHETIC954';
  const h = {tier: 'run', transport: 'remote', wait: () => Promise.resolve()} as unknown as Harness;
  const run = (step: Scenario['steps'][number]) => runScenario({id: 'control-throws', title: 'negative control', seed: EMPTY, steps: [step]}, h);
  const cases: [Scenario['steps'][number], string][] = [
    [act('parse a body', () => { JSON.parse(secret); }), 'threw SyntaxError'],
    [expect('a refusal', () => { throw new SdkError(errorBody('unavailable', {detail: `no owner for ${secret}`})); }, 0), 'threw SdkError unavailable'],
    [holds('a fetch', () => { throw new TypeError(`fetch failed for ${secret}`); }, 0), 'threw TypeError'],
    [act('a step\'s own failure', () => { throw new StepFailure('the request is unavailable'); }), 'the request is unavailable'],
  ];
  for (const [step, detail] of cases) {
    const result = await run(step);
    assert.deepEqual(result.steps.map(entry => [entry.outcome, entry.detail]), [['failed', detail]], step.name);
    assert.equal(JSON.stringify(result).includes(secret), false, `${step.name}: no detail quotes the exception`);
  }
});

// A hook that writes anything breaks its contract, and what it wrote may be a crash's stack, so the step names its length.
it('a hook run that wrote output fails with the output\'s length, never the output', () => {
  const output = 'TypeError: tok_SYNTHETIC954 is not a function\n    at file:///hook.mjs:1:1';
  assert.equal(hookProblem({code: 0, signal: null, output, elapsedMs: 5}), `the hook wrote ${output.length} characters`);
  assert.equal(hookProblem({code: 0, signal: null, output: '', elapsedMs: 5}), undefined);
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
    assert.equal(tokens.length, 5, 'one per part, and the agent hooks\' producer\'s (Hub #926)');
    assert.equal(new Set([...tokens, ...second.tokens()]).size, 10, 'no token repeats within or across harnesses');
    const seen = JSON.stringify([first.logs(), first.edgeLog(), first.published(), first.reader.heard()]);
    for (const token of tokens) assert.equal(seen.includes(token), false);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

it('every record the end-to-end scenario writes is a diagnostic-contract record, and the modules\' records are written, on both transports', async () => {
  for (const transport of ['in-process', 'remote'] as const) {
    const h = await startMemoryHarness(named('end-to-end').seed, transport);
    try {
      assert.equal((await runScenario(named('end-to-end'), h)).outcome, 'passed', transport);
      const records = h.logs().map(({record}) => record);
      assertContractRecords(records);
      const written = new Set(records.map(record => `${String(record.attributes['bunny.module'])} ${record.scope.name} ${record.event_name}`));
      for (const expected of ['lamp bunny.module command.completed', 'lamp bunny.module outbox.republished', 'core bunny.module message.received']) {
        assert.ok(written.has(expected), `${transport}: ${expected}`);
      }
    } finally {
      await h.close();
    }
  }
});

type Attribute = {key: string; value: {stringValue?: string}};
type Span = {
  traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number; startTimeUnixNano: string;
  endTimeUnixNano: string; attributes: Attribute[]; links?: {traceId: string; spanId: string}[];
};
/** One projected OTLP span document as its span. */
function spanOf(line: string): Span {
  const document = JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: Span[]}[]}[]};
  const found = document.resourceSpans[0]?.scopeSpans[0]?.spans[0];
  assert.ok(found, 'one span per document');
  return found;
}
const requestOf = (span: Span): string | undefined => span.attributes.find(item => item.key === 'bunny.request.id')?.value.stringValue;

it('the end-to-end path\'s spans have durations and no lost parent, and work published after a restart links to its stored context, on both transports', async () => {
  for (const transport of ['in-process', 'remote'] as const) {
    const h = await startMemoryHarness(named('end-to-end').seed, transport);
    try {
      assert.equal((await runScenario(named('end-to-end'), h)).outcome, 'passed', transport);
      const spans = (await h.spans()).map(spanOf);
      assert.ok(spans.length > 20, `${transport}: the bus and the modules recorded spans`);
      for (const span of spans) assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano), `${transport}: ${span.name} has a duration`);
      // A parent is a recorded span, a published message's own span, or, for a remote command, the remote caller's
      // context, which the edge authenticated and validated and the server request span continues.
      const known = new Set([
        ...spans.map(span => span.spanId),
        ...h.published().flatMap(({message}) => traceFields(message)?.spanId ?? []),
        ...spans.filter(span => span.name === 'bunny.command.request' && span.kind === 2).flatMap(span => span.parentSpanId ?? []),
      ]);
      assert.deepEqual(spans.filter(span => span.parentSpanId !== undefined && !known.has(span.parentSpanId)).map(span => span.name), [],
        `${transport}: no span lost its parent`);
      const publishes = (requestId: string): Span[] => spans.filter(span => span.name === 'bunny.outcome.publish' && requestOf(span) === requestId);
      // req-crash's outcome first went out after the crash, and req-lost's again after the restart that its lost
      // acknowledgment forced: each of those is a new root linked to the stored context, never its child.
      const crashed = publishes('req-crash');
      assert.ok(crashed.length > 0 && crashed.every(span => span.parentSpanId === undefined && span.links?.length === 1), `${transport}: req-crash is linked`);
      const [first, replay, ...more] = publishes('req-lost');
      assert.ok(first && replay && more.length === 0, `${transport}: req-lost went out twice`);
      assert.ok(first.parentSpanId !== undefined, `${transport}: its first publication continues the stored context`);
      assert.equal(replay.parentSpanId, undefined, `${transport}: the replay is never reparented`);
      assert.deepEqual(replay.links?.map(link => link.spanId), [first.parentSpanId], `${transport}: the replay links to the stored context`);
      assert.ok(BigInt(replay.startTimeUnixNano) >= BigInt(first.endTimeUnixNano), `${transport}: later, after the restart`);
    } finally {
      await h.close();
    }
  }
});

it('a harness starts only when every module is healthy, except one the seed expects the runtime to refuse', async () => {
  const misconfigured = named('misconfigured-module').seed;
  const unexpected = {modules: misconfigured.modules, follows: misconfigured.follows, ...(misconfigured.config === undefined ? {} : {config: misconfigured.config})};
  await assert.rejects(startMemoryHarness(unexpected, 'in-process'), /the runtime did not start/, 'a refusal the seed does not expect');
  const h = await startMemoryHarness(misconfigured, 'in-process');
  await h.close();
});
