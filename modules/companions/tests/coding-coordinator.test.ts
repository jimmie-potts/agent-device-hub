import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODING_WORKER_SOURCE, DEFAULT_CODING_BOUNDS, type CodingDispatch, type CodingProgress, type CodingResult, type CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, Outbox, type Command, type ModuleContext, type TraceContext} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {CodingCoordinator, START_MS, describeResult} from '../src/coding/coordinator.js';
import {initializeRevision} from '../src/revision.js';
const parent = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  assert.ok(check(), 'state arrived');
}
const result = (): CodingResult => ({outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'b'.repeat(40), changedFiles: ['scripts/readout.mjs'],
  checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: [], summary: 'Added the generator and its test.', sessionId: 'session-1', usage: {turns: 9, costUsd: 0.3, durationMs: 120000}});
async function world(t: TestContext, adapt: (context: ModuleContext) => ModuleContext = context => context) {
  let now = Date.now();
  const timers = new Set<{at: number; run(): void}>();
  const clock = {now: () => now}, scheduler = {after: (ms: number, run: () => void) => {const timer = {at: now + ms, run}; timers.add(timer); return () => {timers.delete(timer);};}};
  const bus = new InProcessBus({now: clock.now}), core = bus.connect('bunny/core'), worker = bus.connect(CODING_WORKER_SOURCE), gateway = bus.connect('bunny/runtime/gateway'), module = bus.connect('bunny/modules/companions');
  const work: Command<CodingWork>[] = [], deliveries: {taskId: string; text: string; parent: TraceContext}[] = [], outcomes: {requestId: string; result: string; evidence: string}[] = [];
  let workReply: 'accepted' | 'capacity' = 'accepted';
  await worker.respond<CodingWork>('bunny.cmd.coding-work.*', command => {work.push(command); return workReply === 'accepted' ? {status: 'accepted'} : errorBody('capacity');});
  await core.respond<CodingDispatch>('bunny.cmd.coding-dispatch.assistant', async command => {
    const answer = await core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  await core.subscribe<{requestId: string; result: string; evidence: string}>('bunny.event.coding-run.assistant', message => {outcomes.push(message.data);});
  const dir = await mkdtemp(join(tmpdir(), 'coding-coordinator-'));
  let engine: CodingCoordinator | undefined;
  const make = () => new ModuleHarness({manifest: {name: 'companions', apiVersion: '1.3'}, start: async supplied => {
    const context = adapt(supplied), validator = new MessageValidator(); registerCoreFamilies(validator);
    initializeRevision(context.database(), 0);
    const outbox = new Outbox({sdk: context.sdk, database: context.database(), clock, validator, log: context.log, trace: context.trace});
    engine = new CodingCoordinator(context, outbox, (taskId, text, given) => {deliveries.push({taskId, text, parent: given}); return Promise.resolve();});
    await engine.start(); await outbox.republish();
  }, stop: () => engine?.stop() ?? Promise.resolve()}, {bus, stateDir: dir, clock, scheduler});
  let host = make(); await host.start();
  t.after(async () => {await host.stop(); await Promise.all([core.close(), worker.close(), gateway.close(), module.close()]); await rm(dir, {recursive: true, force: true});});
  let n = 0;
  return {owner: () => engine ?? assert.fail('started'), work, deliveries, outcomes, refuseWork: () => {workReply = 'capacity';},
    advance: async (ms = 0) => {now += ms; for (const timer of [...timers]) if (timer.at <= now) {timers.delete(timer); timer.run();} await new Promise(resolve => setImmediate(resolve));},
    control: (action: 'enable' | 'disable', endpoint = 'worker-1') => worker.request(`bunny.cmd.coding-endpoint.${endpoint}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpoint,
      dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: `control-${String(++n)}`, action}}, {timeoutMs: 5000}),
    dispatch: (taskId = 'task-1', endpointId = 'worker-1') => module.request('bunny.cmd.coding-dispatch.assistant', {type: 'org.bunny.coding.dispatch.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/coding-dispatch/2.0', data: {requestId: `${taskId}-step-1`, endpointId, taskId, repository: 'agent-device-hub', brief: 'Add a test.', bounds: DEFAULT_CODING_BOUNDS}},
    {timeoutMs: 5000, requestId: `${taskId}-step-1`, parent}),
    progress: (data: CodingProgress, endpoint = 'worker-1') => worker.publish(`bunny.event.coding-progress.${endpoint}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpoint,
      dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data}, {parent}),
    lost: (endpoint = 'worker-1') => gateway.publish(`bunny.event.coding-lost.${endpoint}`, {kind: 'occurrence', type: 'org.bunny.coding.endpoint-lost', subject: endpoint,
      dataschema: 'https://bunny.invalid/events/coding-lost/2.0', data: {id: endpoint}}),
    restart: async () => {await host.stop(); host = make(); await host.start();}, host: () => host};
}

void test('a dispatch reaches the enabled worker once, its start settles the tracked outcome and its result reaches the task', async t => {
  const w = await world(t);
  assert.equal(w.owner().endpoint().available, false);
  const early = await w.dispatch(); assert.equal(early.status === 'rejected' && early.error.error.code, 'unavailable');
  assert.equal((await w.control('enable')).status, 'accepted');
  const before = w.owner().endpoint(); assert.equal(before.available, true); assert.equal(before.endpointId, 'worker-1');
  assert.equal((await w.dispatch()).status, 'accepted');
  await until(() => w.work.length === 1);
  const start = w.work[0]?.data; assert.ok(start?.action === 'start'); assert.equal(start.taskId, 'task-1'); assert.equal(start.brief, 'Add a test.');
  assert.equal(w.owner().inspect().active?.status, 'dispatching'); assert.equal(w.owner().endpoint().available, false);
  const busy = await w.dispatch('task-2'); assert.equal(busy.status === 'rejected' && busy.error.error.code, 'capacity');
  await w.progress({operationId: start.operationId, status: 'started'});
  await until(() => w.outcomes.length === 1);
  assert.deepEqual(w.outcomes[0], {requestId: 'task-1-step-1', result: 'succeeded', evidence: 'observed'});
  assert.equal(w.owner().inspect().active?.status, 'started');
  await w.progress({operationId: start.operationId, status: 'completed', result: result()});
  await until(() => w.deliveries.length === 1);
  assert.equal(w.deliveries[0]?.taskId, 'task-1'); assert.match(w.deliveries[0]?.text ?? '', /^completed \(tested-candidate\): Added the generator/);
  assert.match(w.deliveries[0]?.text ?? '', /changed files: scripts\/readout\.mjs/); assert.equal(w.outcomes.length, 1, 'the run reports one tracked outcome');
  assert.equal(w.owner().inspect().active, null); assert.equal(w.owner().endpoint().available, true);
  await w.progress({operationId: start.operationId, status: 'completed', result: result()}); await w.advance(); assert.equal(w.deliveries.length, 1, 'a late duplicate is ignored');
});

void test('a refused start, a missing start and a lost endpoint end the operation truthfully, and a restart never resends', async t => {
  const w = await world(t); await w.control('enable');
  w.refuseWork(); assert.equal((await w.dispatch('task-r')).status, 'accepted');
  await until(() => w.deliveries.length === 1); assert.match(w.deliveries[0]?.text ?? '', /^failed \(refused\)/);
  assert.deepEqual(w.outcomes.at(-1)?.result, 'failed'); assert.equal(w.owner().inspect().active, null);
  const w2 = await world(t); await w2.control('enable'); assert.equal((await w2.dispatch('task-s')).status, 'accepted'); await until(() => w2.work.length === 1);
  await w2.advance(START_MS); await until(() => w2.deliveries.length === 1);
  assert.match(w2.deliveries[0]?.text ?? '', /^uncertain \(lost\)/); assert.equal(w2.outcomes.at(-1)?.result, 'uncertain');
  const w3 = await world(t); await w3.control('enable'); assert.equal((await w3.dispatch('task-l')).status, 'accepted'); await until(() => w3.work.length === 1);
  await w3.progress({operationId: 'task-l-step-1', status: 'started'}); await until(() => w3.outcomes.length === 1);
  await w3.lost(); await until(() => w3.deliveries.length === 1);
  assert.match(w3.deliveries[0]?.text ?? '', /^uncertain \(lost\)/); assert.equal(w3.owner().inspect().availability, 'unavailable'); assert.equal(w3.outcomes.length, 1);
  assert.equal((await w3.control('enable', 'worker-2')).status, 'accepted'); assert.equal(w3.owner().endpoint().endpointId, 'worker-2');
  const w4 = await world(t); await w4.control('enable'); assert.equal((await w4.dispatch('task-p')).status, 'accepted'); await until(() => w4.work.length === 1);
  await w4.restart(); await until(() => w4.deliveries.length === 1);
  assert.match(w4.deliveries[0]?.text ?? '', /^uncertain \(lost\)/); assert.equal(w4.work.length, 1, 'restart sends no second start'); assert.equal(w4.owner().inspect().availability, 'off');
});

void test('cancelling the task asks the worker to stop, and the worker\'s own report settles it', async t => {
  const w = await world(t); await w.control('enable'); assert.equal((await w.dispatch('task-c')).status, 'accepted'); await until(() => w.work.length === 1);
  await w.progress({operationId: 'task-c-step-1', status: 'started'}); await until(() => w.outcomes.length === 1);
  w.owner().cancel('task-other'); await w.advance(); assert.equal(w.work.length, 1);
  w.owner().cancel('task-c'); await until(() => w.work.length === 2);
  assert.equal(w.work[1]?.data.action, 'cancel'); assert.equal(w.owner().inspect().active?.status, 'cancelling');
  await w.progress({operationId: 'task-c-step-1', status: 'cancelled', reason: 'cancelled', result: null}); await until(() => w.deliveries.length === 1);
  assert.match(w.deliveries[0]?.text ?? '', /^cancelled \(cancelled\): the worker returned no structured result/); assert.equal(w.outcomes.length, 1);
});

void test('the result text names outcome, git facts, checks, findings, limitations and usage, bounded and without paths', () => {
  const text = describeResult('completed', {...result(), findings: ['A test is flaky.'], limitations: ['No browser check.'], usage: {turns: null, costUsd: null, durationMs: 5000}});
  assert.match(text, /^completed \(tested-candidate\): Added the generator and its test\./);
  assert.match(text, /base aaaaaaaa; head bbbbbbbb; changed files: scripts\/readout\.mjs/);
  assert.match(text, /checks: node --test passed/); assert.match(text, /findings: A test is flaky\./); assert.match(text, /limitations: No browser check\./);
  assert.match(text, /usage: unknown turns, unknown cost, 5 s/);
  const long = describeResult('completed', {...result(), summary: 'x'.repeat(5000)});
  assert.ok(long.length <= 3600 && long.endsWith('(result text truncated)'));
  assert.equal(describeResult('failed', undefined, 'timeout'), 'failed (timeout): the worker returned no structured result.');
});
