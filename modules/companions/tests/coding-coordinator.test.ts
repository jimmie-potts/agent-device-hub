import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODING_WORKER_SOURCE, DEFAULT_CODING_BOUNDS, type CodingCompanion, type CodingDispatch, type CodingHarnessReadiness, type CodingProgress, type CodingReadiness, type CodingResult, type CodingState, type CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, Outbox, type Command, type ModuleContext, type TraceContext} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {CodingCoordinator, GRACE_MS, SETUP_MS, START_MS, describeResult, type HandOffAnswer} from '../src/coding/coordinator.js';
import {initializeRevision} from '../src/revision.js';
import {slotBusy} from '../src/frontend/coding-status.js';
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
  const work: Command<CodingWork>[] = [], deliveries: {taskId: string; text: string; parent: TraceContext; startup: boolean}[] = [], outcomes: {requestId: string; result: string; evidence: string}[] = [];
  let workReply: 'accepted' | 'capacity' = 'accepted';
  await worker.respond<CodingWork>('bunny.cmd.coding-work.*', command => {work.push(command); return workReply === 'accepted' ? {status: 'accepted'} : errorBody('capacity');});
  // The core's dispatcher forwards a dispatch to the module's coding-run responder; a test can make it refuse or never answer.
  // 'held' answers by refusal only when released; 'held-forward' forwards when released; 'lost-answer' forwards and then
  // answers uncertain, as a reply lost after the module accepted the run.
  let coreReply: 'forward' | 'refuse' | 'held' | 'held-forward' | 'lost-answer' = 'forward', release = (): void => {};
  const dispatched: string[] = [];
  await core.respond<CodingDispatch>('bunny.cmd.coding-dispatch.assistant', async command => {
    dispatched.push(command.data.requestId);
    if (coreReply === 'refuse') return errorBody('unavailable');
    // A held dispatch is answered only when the test releases it, by refusal, after the module that sent it stopped.
    if (coreReply === 'held') {await new Promise<void>(resolve => {release = resolve;}); return errorBody('unavailable');}
    if (coreReply === 'held-forward') await new Promise<void>(resolve => {release = resolve;});
    const lost = coreReply === 'lost-answer';
    const answer = await core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: `https://bunny.invalid/events/coding-run/${command.data.harness === undefined ? '2.0' : '2.1'}`, data: command.data},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    if (lost) return errorBody('uncertain-result');
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  await core.subscribe<{requestId: string; result: string; evidence: string}>('bunny.event.coding-run.assistant', message => {outcomes.push(message.data);});
  const published: {dataschema: string; data: CodingState}[] = [];
  const finished = new Set<string>(), unreadable = new Set<string>(), sent: string[] = [];
  await core.subscribe<CodingState>('bunny.state.coding-state.coding', message => {published.push({dataschema: message.dataschema, data: message.data});});
  const dir = await mkdtemp(join(tmpdir(), 'coding-coordinator-'));
  let engine: CodingCoordinator | undefined;
  const make = () => new ModuleHarness({manifest: {name: 'companions', apiVersion: '1.3'}, start: async supplied => {
    const context = adapt(supplied), validator = new MessageValidator(); registerCoreFamilies(validator);
    initializeRevision(context.database(), 0);
    const outbox = new Outbox({sdk: context.sdk, database: context.database(), clock, validator, log: context.log, trace: context.trace});
    // A task's companion is in its synthetic ID here; the module reads it from the engine's saved task.
    engine = new CodingCoordinator(context, outbox, (taskId, text, given, _evidence, startup) => {deliveries.push({taskId, text, parent: given, startup}); return Promise.resolve();},
      {companionOf: taskId => /reachy/.test(taskId) ? 'reachy' : /microduck/.test(taskId) ? 'microduck' : 'bunny',
        // A task waits on its hand-off until the test ends it, as a cancel the coordinator never heard of would.
        awaits: taskId => {if (unreadable.has(taskId)) throw new Error('synthetic store read failure'); return !finished.has(taskId);}, sent: taskId => {sent.push(taskId);}});
    await engine.start(); await outbox.republish();
  }, stop: () => engine?.stop() ?? Promise.resolve()}, {bus, stateDir: dir, clock, scheduler});
  let host = make(); await host.start();
  t.after(async () => {await host.stop(); await Promise.all([core.close(), worker.close(), gateway.close(), module.close()]); await rm(dir, {recursive: true, force: true});});
  let n = 0;
  return {owner: () => engine ?? assert.fail('started'), work, deliveries, outcomes, dispatched, finished, unreadable, sent, busy: (companion: CodingCompanion) => slotBusy(engine?.inspect(), companion), refuseWork: () => {workReply = 'capacity';}, core: (mode: typeof coreReply) => {coreReply = mode;}, release: () => {release();},
    // An approved hand-off from a companion's task, bound to the endpoint revision the proposal saw.
    handOff: (taskId: string, expectedRevision = engine?.endpoint().revision ?? 0): Promise<HandOffAnswer> => (engine ?? assert.fail('started')).handOff({requestId: `${taskId}-step-1`, taskId,
      companion: /reachy/.test(taskId) ? 'reachy' : /microduck/.test(taskId) ? 'microduck' : 'bunny', repository: 'agent-device-hub', brief: 'Add a test.', expectedRevision}, parent),
    enable22: (endpoint = 'worker-1', slots = 3) => worker.request(`bunny.cmd.coding-endpoint.${endpoint}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpoint,
      dataschema: 'https://bunny.invalid/events/coding-endpoint/2.2', data: {requestId: `control-${String(++n)}`, action: 'enable', slots}}, {timeoutMs: 5000}),
    enableAdapters: (harnesses: CodingHarnessReadiness[], endpoint = 'worker-1') => worker.request(`bunny.cmd.coding-endpoint.${endpoint}`,
      {type: 'org.bunny.coding.endpoint.requested', subject: endpoint, dataschema: 'https://bunny.invalid/events/coding-endpoint/2.3',
        data: {requestId: `control-${String(++n)}`, action: 'enable', slots: 3, harnesses}}, {timeoutMs: 5000}),
    progressAdapters: (data: CodingProgress, endpoint = 'worker-1') => worker.publish(`bunny.event.coding-progress.${endpoint}`,
      {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpoint, dataschema: 'https://bunny.invalid/events/coding-progress/2.2', data}, {parent}),
    advance: async (ms = 0) => {now += ms; for (const timer of [...timers]) if (timer.at <= now) {timers.delete(timer); timer.run();} await new Promise(resolve => setImmediate(resolve));},
    control: (action: 'enable' | 'disable', endpoint = 'worker-1', readiness?: CodingReadiness) => worker.request(`bunny.cmd.coding-endpoint.${endpoint}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpoint,
      dataschema: `https://bunny.invalid/events/coding-endpoint/${readiness === undefined ? '2.0' : '2.1'}`, data: {requestId: `control-${String(++n)}`, action, ...(readiness === undefined ? {} : {readiness})}}, {timeoutMs: 5000}),
    progress21: (data: CodingProgress, endpoint = 'worker-1') => worker.publish(`bunny.event.coding-progress.${endpoint}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpoint,
      dataschema: 'https://bunny.invalid/events/coding-progress/2.1', data}, {parent}),
    published: published as {dataschema: string; data: CodingState}[],
    dispatch: (taskId = 'task-1', endpointId = 'worker-1', harness?: string) => module.request('bunny.cmd.coding-dispatch.assistant', {type: 'org.bunny.coding.dispatch.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/coding-dispatch/${harness === undefined ? '2.0' : '2.1'}`, data: {requestId: `${taskId}-step-1`, endpointId, taskId, repository: 'agent-device-hub', brief: 'Add a test.', bounds: DEFAULT_CODING_BOUNDS, ...(harness === undefined ? {} : {harness})}},
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
  assert.equal(w.owner().inspect().active?.status, 'dispatching'); assert.equal(w.owner().endpoint().available, true); assert.equal(w.busy('bunny'), true);
  const busy = await w.dispatch('task-2'); assert.equal(busy.status === 'rejected' && busy.error.error.code, 'capacity');
  await w.progress({operationId: start.operationId, status: 'started'});
  await until(() => w.outcomes.length === 1);
  assert.deepEqual(w.outcomes[0], {requestId: 'task-1-step-1', result: 'succeeded', evidence: 'observed'});
  assert.equal(w.owner().inspect().active?.status, 'started');
  await w.progress({operationId: start.operationId, status: 'completed', result: result()});
  await until(() => w.deliveries.length === 1);
  assert.equal(w.deliveries[0]?.taskId, 'task-1'); assert.match(w.deliveries[0]?.text ?? '', /^completed \(tested-candidate\): Added the generator/);
  assert.match(w.deliveries[0]?.text ?? '', /changed files: scripts\/readout\.mjs/); assert.equal(w.outcomes.length, 1, 'the run reports one tracked outcome');
  assert.equal(w.owner().inspect().active, null); assert.equal(w.owner().endpoint().available, true); assert.equal(w.busy('bunny'), false);
  await w.progress({operationId: start.operationId, status: 'completed', result: result()}); await w.advance(); assert.equal(w.deliveries.length, 1, 'a late duplicate is ignored');
});

void test('a second endpoint is refused while the first holds the selection, its loss changes nothing, and it can declare once the first is gone', async t => {
  const w = await world(t);
  assert.equal((await w.control('enable', 'worker-1')).status, 'accepted');
  const held = w.owner().inspect();
  const refused = await w.control('enable', 'worker-2');
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'invalid-state');
  // The refused worker closes its connection on its way out (Hub #1384), and the gateway reports that endpoint lost.
  await w.lost('worker-2'); await w.advance();
  assert.deepEqual(w.owner().inspect(), held, 'the selected endpoint and its revision are untouched');
  await w.lost('worker-1'); await until(() => w.owner().inspect().endpointId === null);
  assert.equal((await w.control('enable', 'worker-2')).status, 'accepted');
  assert.equal(w.owner().endpoint().endpointId, 'worker-2'); assert.equal(w.owner().endpoint().available, true);
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

// Hub #1743: the worker's readiness travels on its enable (2.1) and the state publishes it (2.1); progress 2.1 adds the
// usage-limit and waiting-for-owner outcomes. Waits here yield to the event loop only; no test waits on the clock.
const readiness = (signedIn: CodingReadiness['signedIn']): CodingReadiness => ({tool: 'claude-code', installed: 'yes', version: '2.1.292', signedIn, plan: signedIn === 'yes' ? 'pro' : null,
  limits: null, limitsObservedAtMs: null, checkedAtMs: 1767225600000});
async function settled(w: {advance: () => Promise<void>}, check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await w.advance();
  assert.ok(check(), 'the bus delivered it');
}

void test('the selected worker\'s readiness is recorded and published, refreshed by its next enable, and cleared when it goes', async t => {
  const w = await world(t);
  assert.equal((await w.control('enable', 'worker-1', readiness('unknown'))).status, 'accepted');
  assert.deepEqual(w.owner().inspect().readiness, readiness('unknown'));
  const revision = w.owner().inspect().revision, bound = w.owner().endpoint().revision;
  assert.equal((await w.control('enable', 'worker-1', readiness('yes'))).status, 'accepted');
  assert.equal(w.owner().inspect().readiness?.signedIn, 'yes'); assert.ok(w.owner().inspect().revision > revision);
  assert.equal(w.owner().endpoint().endpointId, 'worker-1', 'a refreshing enable keeps the selection');
  // A proposal bound before the report is still approvable: the report is not a change of worker or work.
  assert.equal(w.owner().endpoint().revision, bound);
  // Another endpoint cannot replace it, and an identical report changes nothing.
  const refused = await w.control('enable', 'worker-2', readiness('no')); assert.equal(refused.status === 'rejected' && refused.error.error.code, 'invalid-state');
  const same = w.owner().inspect().revision; await w.control('enable', 'worker-1', readiness('yes')); assert.equal(w.owner().inspect().revision, same);
  await settled(w, () => w.published.at(-1)?.data.readiness?.signedIn === 'yes');
  assert.equal(w.published.at(-1)?.dataschema, 'https://bunny.invalid/events/coding-state/2.2', 'the module publishes the newest version (Hub #2028)');
  assert.equal((await w.control('disable')).status, 'accepted'); assert.equal(w.owner().inspect().readiness, null);
  await w.control('enable', 'worker-1', readiness('yes')); await w.lost(); await settled(w, () => w.owner().inspect().endpointId === null);
  assert.equal(w.owner().inspect().readiness, null);
});

void test('a usage limit and a question reach the task with their outcome, the limit window and its reset or unknown', async t => {
  const w = await world(t); await w.control('enable');
  assert.equal((await w.dispatch('task-u')).status, 'accepted'); await settled(w, () => w.work.length === 1);
  await w.progress21({operationId: 'task-u-step-1', status: 'started'}); await settled(w, () => w.outcomes.length === 1);
  await w.progress21({operationId: 'task-u-step-1', status: 'failed', reason: 'usage-limit', result: {...result(), outcome: 'usage-limit', summary: 'The harness stopped at a usage limit.', limit: {window: 'five-hour', resetsAtMs: 1767286800000}}});
  await settled(w, () => w.deliveries.length === 1);
  assert.match(w.deliveries[0]?.text ?? '', /^failed \(usage-limit\): The harness stopped at a usage limit\./);
  assert.match(w.deliveries[0]?.text ?? '', /usage limit: five-hour, resets 2026-01-01T17:00:00\.000Z/); assert.equal(w.outcomes.length, 1);
  assert.match(describeResult('failed', {...result(), outcome: 'usage-limit', limit: {window: null, resetsAtMs: null}}, 'usage-limit'), /usage limit: window unknown, resets at an unknown time/);
  assert.equal((await w.dispatch('task-q')).status, 'accepted'); await settled(w, () => w.work.length === 2);
  await w.progress21({operationId: 'task-q-step-1', status: 'started'}); await settled(w, () => w.outcomes.length === 2);
  await w.progress21({operationId: 'task-q-step-1', status: 'completed', result: {...result(), outcome: 'waiting-for-owner', findings: ['Question: which file?']}});
  await settled(w, () => w.deliveries.length === 2);
  assert.match(w.deliveries[1]?.text ?? '', /^completed \(waiting-for-owner\): .*\n[\s\S]*findings: Question: which file\?/);
});

// Hub #2028: one slot per companion. These run without real-time waits: each check turns the event loop until it holds.
async function turned(check: () => boolean, seen: () => unknown = () => undefined): Promise<void> {
  for (let i = 0; i < 500; i += 1) {if (check()) return; await new Promise(resolve => setImmediate(resolve));}
  assert.ok(check(), `state arrived; seen ${JSON.stringify(seen())}`);
}
const starts = (work: Command<CodingWork>[]) => work.filter(command => command.data.action === 'start');

void test('three companions hand off at once, each run tagged with its companion, and a companion\'s further hand-off waits for its own slot', async t => {
  const w = await world(t);
  assert.equal((await w.enable22()).status, 'accepted');
  for (const taskId of ['task-bunny-1', 'task-reachy-1', 'task-microduck-1']) assert.equal((await w.handOff(taskId)).status, 'accepted', taskId);
  await turned(() => starts(w.work).length === 3);
  assert.deepEqual(starts(w.work).map(command => [command.data.action === 'start' && command.data.companion, command.dataschema]),
    [['bunny', 'https://bunny.invalid/events/coding-work/2.1'], ['reachy', 'https://bunny.invalid/events/coding-work/2.1'], ['microduck', 'https://bunny.invalid/events/coding-work/2.1']]);
  const state = w.owner().inspect();
  assert.equal(state.slots, 3);
  assert.deepEqual(state.runs?.map(run => [run.taskId, run.companion, run.status]), [['task-bunny-1', 'bunny', 'dispatching'], ['task-reachy-1', 'reachy', 'dispatching'], ['task-microduck-1', 'microduck', 'dispatching']]);
  assert.equal(state.active?.taskId, 'task-bunny-1', 'older readers see the oldest run');
  // B.U.N.N.Y.'s second hand-off waits; nothing reaches the core or the worker for it.
  assert.equal(w.busy('bunny'), true); assert.equal(w.owner().endpoint().available, true);
  assert.equal((await w.handOff('task-bunny-2')).status, 'waiting');
  assert.deepEqual(w.owner().inspect().waiting, [{operationId: 'task-bunny-2-step-1', taskId: 'task-bunny-2', companion: 'bunny'}]);
  assert.equal(w.dispatched.includes('task-bunny-2-step-1'), false);
  // Reachy's run ending frees only Reachy's slot: B.U.N.N.Y.'s hand-off keeps waiting.
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 1);
  assert.equal(w.deliveries[0]?.taskId, 'task-reachy-1'); assert.equal(w.owner().inspect().waiting?.length, 1); assert.equal(starts(w.work).length, 3);
  // B.U.N.N.Y.'s run ending sends the waiting hand-off once, on its own.
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'failed', reason: 'exit', result: null});
  await turned(() => starts(w.work).length === 4, () => w.owner().inspect());
  const next = starts(w.work)[3]?.data; assert.ok(next?.action === 'start'); assert.equal(next.taskId, 'task-bunny-2'); assert.equal(next.companion, 'bunny');
  await turned(() => w.sent.length === 1); assert.deepEqual(w.sent, ['task-bunny-2'], 'the engine hears the waiting hand-off was sent');
  assert.deepEqual(w.owner().inspect().waiting, []);
  assert.deepEqual(w.owner().inspect().runs?.map(run => run.taskId), ['task-microduck-1', 'task-bunny-2']);
  await w.advance(); assert.equal(w.dispatched.filter(id => id === 'task-bunny-2-step-1').length, 1, 'dispatched once');
});

void test('a proposal binds to the worker connection, so another companion\'s run starting or ending never refuses it; a changed endpoint does', async t => {
  const w = await world(t); await w.enable22();
  const bound = w.owner().endpoint().revision;
  assert.equal((await w.handOff('task-reachy-1')).status, 'accepted');
  await turned(() => starts(w.work).length === 1);
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'started'}); await turned(() => w.outcomes.length === 1);
  assert.notEqual(w.owner().inspect().revision, bound, 'the state moved');
  assert.equal(w.owner().endpoint().revision, bound, 'what a proposal binds to did not');
  assert.equal((await w.handOff('task-bunny-1', bound)).status, 'accepted', 'another companion\'s run never refuses an approval');
  // A worker that went away and came back is another endpoint: an approval bound to the old one is refused.
  await w.lost(); await turned(() => w.owner().inspect().endpointId === null);
  await w.enable22('worker-2');
  const stale = await w.handOff('task-microduck-1', bound);
  assert.equal(stale.status === 'rejected' && stale.error.error.code, 'revision-conflict');
  const none = await (async () => {await w.lost('worker-2'); await turned(() => w.owner().inspect().endpointId === null); return w.handOff('task-microduck-2', w.owner().endpoint().revision);})();
  assert.equal(none.status === 'rejected' && none.error.error.code, 'unavailable', 'with no worker connected nothing waits');
});

void test('cancel removes a waiting hand-off and sends nothing; cancel, a timeout and a lost worker each end only their own run', async t => {
  const w = await world(t); await w.enable22();
  for (const taskId of ['task-bunny-1', 'task-reachy-1', 'task-microduck-1']) await w.handOff(taskId);
  await turned(() => starts(w.work).length === 3);
  for (const id of ['task-bunny-1', 'task-reachy-1', 'task-microduck-1']) await w.progress21({operationId: `${id}-step-1`, status: 'started'});
  await turned(() => w.outcomes.length === 3);
  assert.equal((await w.handOff('task-bunny-2')).status, 'waiting');
  w.owner().cancel('task-bunny-2'); await w.advance();
  assert.deepEqual(w.owner().inspect().waiting, []); assert.equal(w.work.length, 3, 'nothing was sent for the cancelled hand-off');
  // Cancelling Reachy's run asks the worker to stop that run alone.
  w.owner().cancel('task-reachy-1'); await turned(() => w.work.length === 4);
  assert.deepEqual([w.work[3]?.data.action, w.work[3]?.data.operationId], ['cancel', 'task-reachy-1-step-1']);
  assert.deepEqual(w.owner().inspect().runs?.map(run => [run.companion, run.status]), [['bunny', 'started'], ['reachy', 'cancelling'], ['microduck', 'started']]);
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'cancelled', reason: 'cancelled', result: null});
  await turned(() => w.deliveries.length === 1);
  assert.equal(w.owner().inspect().runs?.length, 2);
  // B.U.N.N.Y.'s slot freed by its own end sends nothing: its waiting hand-off was cancelled.
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 2); await w.advance();
  assert.equal(starts(w.work).length, 3);
  // A lost worker ends what it held, each run on its own, uncertain; nothing is resent.
  await w.handOff('task-bunny-3'); await turned(() => starts(w.work).length === 4);
  await w.lost(); await turned(() => w.deliveries.length === 4);
  assert.deepEqual(w.deliveries.slice(2).map(delivery => [delivery.taskId, delivery.text.split(':')[0]]).sort(), [['task-bunny-3', 'uncertain (lost)'], ['task-microduck-1', 'uncertain (lost)']]);
  assert.deepEqual(w.owner().inspect().runs, []); assert.equal(starts(w.work).length, 4);
});

void test('a run that outlives its wall clock ends uncertain alone, and the others keep running', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await w.handOff('task-reachy-1'); await turned(() => starts(w.work).length === 2);
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'}); await turned(() => w.outcomes.length === 1);
  await w.advance(DEFAULT_CODING_BOUNDS.wallClockMs);
  // Reachy's run never reported a start: it is uncertain at its start deadline; B.U.N.N.Y.'s keeps its wall clock.
  await turned(() => w.deliveries.length === 1);
  assert.equal(w.deliveries[0]?.taskId, 'task-reachy-1'); assert.deepEqual(w.owner().inspect().runs?.map(run => run.taskId), ['task-bunny-1']);
  // Queued git setup on the worker is not charged to the grace (Hub #2028): the plain grace has passed, the run still holds.
  await w.advance(GRACE_MS + 10_000); await w.advance();
  assert.equal(w.deliveries.length, 1, 'not given up while queued setup may still run');
  await w.advance(SETUP_MS); await turned(() => w.deliveries.length === 2);
  assert.match(w.deliveries[1]?.text ?? '', /^uncertain \(timeout\)/); assert.deepEqual(w.owner().inspect().runs, []);
});

void test('a restart keeps a never-sent hand-off waiting and sends it once, when its slot is actually free; an unanswered dispatch stays uncertain', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  assert.equal((await w.handOff('task-bunny-2')).status, 'waiting');
  await w.restart();
  // The run pending at the stop is uncertain and its task hears so at start; the waiting hand-off keeps its place.
  await turned(() => w.deliveries.length === 1);
  assert.equal(w.deliveries[0]?.taskId, 'task-bunny-1'); assert.match(w.deliveries[0]?.text ?? '', /^uncertain \(lost\)/); assert.equal(w.deliveries[0]?.startup, true);
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-2']); assert.equal(w.owner().inspect().availability, 'off');
  await w.advance(); assert.equal(starts(w.work).length, 1, 'nothing is sent without a worker');
  // The worker declares again: the slot is free, so the hand-off is sent once; a readiness refresh sends nothing more.
  await w.enable22();
  await turned(() => starts(w.work).length === 2);
  assert.equal(starts(w.work)[1]?.data.operationId, 'task-bunny-2-step-1');
  await w.enable22(); await w.advance();
  assert.equal(starts(w.work).length, 2); assert.equal(w.dispatched.filter(id => id === 'task-bunny-2-step-1').length, 1, 'one dispatch per request ID');
  // Restarting again with that run pending settles it uncertain; neither hand-off is ever sent again.
  await w.restart(); await turned(() => w.deliveries.length === 2);
  assert.equal(w.deliveries[1]?.taskId, 'task-bunny-2'); assert.equal(w.deliveries[1]?.startup, true);
  await w.enable22(); await w.advance();
  assert.equal(starts(w.work).length, 2); assert.deepEqual(w.owner().inspect().waiting, []);
});

void test('a restart while a waiting hand-off\'s dispatch was unanswered leaves it uncertain and never sends it again', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  await w.handOff('task-bunny-2');
  w.core('held');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.dispatched.includes('task-bunny-2-step-1'));
  await w.restart();
  await turned(() => w.deliveries.length === 2);
  assert.equal(w.deliveries[1]?.taskId, 'task-bunny-2'); assert.match(w.deliveries[1]?.text ?? '', /^uncertain \(lost\)/); assert.equal(w.deliveries[1]?.startup, true);
  // The late refusal reaches the stopped module only; the new one has already settled the hand-off once.
  w.release(); w.core('forward'); await w.enable22(); await w.advance();
  assert.equal(w.deliveries.length, 2);
  assert.equal(w.dispatched.filter(id => id === 'task-bunny-2-step-1').length, 1); assert.equal(starts(w.work).length, 1);
});

void test('a waiting hand-off the core refuses ends without a run, its task hears why, and the next one in line goes', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  await w.handOff('task-bunny-2'); await w.handOff('task-bunny-3');
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-2', 'task-bunny-3']);
  w.core('refuse');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 3, () => w.deliveries);
  assert.deepEqual(w.deliveries.slice(1).map(delivery => [delivery.taskId, delivery.text]), [
    ['task-bunny-2', 'failed (refused: unavailable): the worker returned no structured result.'], ['task-bunny-3', 'failed (refused: unavailable): the worker returned no structured result.']]);
  assert.deepEqual(w.owner().inspect().waiting, []); assert.equal(starts(w.work).length, 1);
});

void test('an older worker that declares no slots holds one run for every companion: another companion waits, and the start is the 2.0 it knows', async t => {
  const w = await world(t);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal(w.owner().inspect().slots, null);
  assert.equal((await w.handOff('task-bunny-1')).status, 'accepted'); await turned(() => starts(w.work).length === 1);
  assert.equal(starts(w.work)[0]?.dataschema, 'https://bunny.invalid/events/coding-work/2.0'); assert.equal('companion' in (starts(w.work)[0]?.data ?? {}), false);
  assert.equal(w.busy('reachy'), true);
  assert.equal((await w.handOff('task-reachy-1')).status, 'waiting');
  await w.progress({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => starts(w.work).length === 2);
  const second = starts(w.work)[1]?.data; assert.equal(second?.action === 'start' && second.taskId, 'task-reachy-1');
});

void test('the published state is coding-state 2.2 and validates with every run and waiting hand-off', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await w.handOff('task-reachy-1'); await w.handOff('task-bunny-2');
  await turned(() => w.published.some(entry => entry.data.waiting?.length === 1 && entry.data.runs?.length === 2));
  const validator = new MessageValidator(); registerCoreFamilies(validator);
  const last = w.published.at(-1);
  assert.equal(last?.dataschema, 'https://bunny.invalid/events/coding-state/2.2');
  assert.equal(validator.validate({specversion: '1.0', bunnyprofile: '2.0', id: 'state-1', source: 'bunny/modules/companions', kind: 'state', type: 'org.bunny.coding-state.updated', subject: 'coding',
    time: new Date().toISOString(), datacontenttype: 'application/json', dataschema: last?.dataschema, traceparent: parent.traceparent, data: last?.data}).ok, true);
});

void test('a waiting hand-off whose task ended while the coordinator was stopped is dropped at the next send, never dispatched', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  assert.equal((await w.handOff('task-bunny-2')).status, 'waiting');
  // The owner's cancel commits on the task while the coordinator is stopped, so its own cancel never runs.
  await w.host().stop(); w.finished.add('task-bunny-2');
  await w.restart();
  await turned(() => w.deliveries.length === 1);
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-2'], 'kept until a send would take it');
  await w.enable22(); await w.advance();
  await turned(() => w.owner().inspect().waiting?.length === 0);
  assert.equal(w.dispatched.includes('task-bunny-2-step-1'), false, 'never dispatched');
  assert.equal(starts(w.work).length, 1); assert.equal(w.deliveries.length, 1, 'the ended task hears nothing more');
});

void test('a cancel while a waiting hand-off\'s dispatch is on its way refuses it on arrival, so nothing runs', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  await w.handOff('task-bunny-2');
  w.core('held-forward');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.dispatched.includes('task-bunny-2-step-1'));
  w.owner().cancel('task-bunny-2');
  w.release(); w.core('forward');
  await turned(() => w.owner().inspect().waiting?.length === 0);
  await w.advance();
  assert.equal(starts(w.work).length, 1, 'no start reached the worker');
  assert.deepEqual(w.owner().inspect().runs, []);
  assert.deepEqual(w.deliveries.map(delivery => delivery.taskId), ['task-bunny-1'], 'the cancelled task is not told anything');
  assert.deepEqual(w.sent, []);
});

void test('a waiting hand-off whose run the module accepted keeps its run when the dispatch answer is lost, and its result still arrives', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  await w.handOff('task-bunny-2');
  w.core('lost-answer');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => starts(w.work).length === 2);
  await turned(() => w.sent.length === 1);
  assert.deepEqual(w.deliveries.map(delivery => delivery.taskId), ['task-bunny-1'], 'no uncertain word for the running hand-off');
  w.core('forward');
  await w.progress21({operationId: 'task-bunny-2-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-2-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 2);
  assert.match(w.deliveries[1]?.text ?? '', /^completed \(tested-candidate\)/);
});

void test('a waiting hand-off whose task cannot be read keeps its place and is sent at a later send, never dropped', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  assert.equal((await w.handOff('task-bunny-2')).status, 'waiting');
  w.unreadable.add('task-bunny-2');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 1); await w.advance();
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-2'], 'kept while its task cannot be read');
  assert.equal(w.dispatched.includes('task-bunny-2-step-1'), false);
  // The read works again; the next send (another companion's run ending) takes it.
  w.unreadable.clear();
  await w.handOff('task-reachy-1'); await turned(() => starts(w.work).length === 2);
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'completed', result: result()});
  await turned(() => starts(w.work).some(command => command.data.operationId === 'task-bunny-2-step-1'), () => w.owner().inspect());
  assert.equal(w.dispatched.filter(id => id === 'task-bunny-2-step-1').length, 1);
});

void test('a waiting hand-off whose task cannot be read holds its slot\'s line: a later hand-off for that companion never goes first', async t => {
  const w = await world(t); await w.enable22();
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  await w.handOff('task-bunny-2'); await w.handOff('task-bunny-3');
  w.unreadable.add('task-bunny-2');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 1); await w.advance();
  assert.deepEqual(w.dispatched, ['task-bunny-1-step-1'], 'nothing goes ahead of the unreadable oldest hand-off');
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-2', 'task-bunny-3']);
  // Once its task reads again, the line resumes in order at the next send.
  w.unreadable.clear();
  await w.handOff('task-reachy-1'); await turned(() => starts(w.work).length === 2);
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-reachy-1-step-1', status: 'completed', result: result()});
  await turned(() => w.dispatched.includes('task-bunny-2-step-1'));
  assert.equal(w.dispatched.includes('task-bunny-3-step-1'), false, 'the next one waits for the slot again');
  assert.deepEqual(w.owner().inspect().waiting?.map(entry => entry.taskId), ['task-bunny-3']);
});

void test('accepted() knows a hand-off that runs and one that ran, and nothing else', async t => {
  const w = await world(t); await w.enable22();
  assert.equal(w.owner().accepted('task-bunny-1-step-1'), false, 'not before it is accepted');
  await w.handOff('task-bunny-1'); await turned(() => starts(w.work).length === 1);
  assert.equal(w.owner().accepted('task-bunny-1-step-1'), true, 'an active run');
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'started'});
  await w.progress21({operationId: 'task-bunny-1-step-1', status: 'completed', result: result()});
  await turned(() => w.deliveries.length === 1);
  assert.deepEqual(w.owner().inspect().runs, []);
  assert.equal(w.owner().accepted('task-bunny-1-step-1'), true, 'a recorded run that ended');
  await w.restart();
  assert.equal(w.owner().accepted('task-bunny-1-step-1'), true, 'still recorded after a restart');
  assert.equal(w.owner().accepted('task-reachy-1-step-1'), false);
});

void test('harness selection requires an advertised adapter and a second started event sets native identity once', async t => {
  const w = await world(t);
  assert.equal((await w.enable22()).status, 'accepted');
  const refused = await w.dispatch('legacy-choice', 'worker-1', 'codex');
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'unsupported-capability');
  assert.equal(w.work.length, 0);
  const harness: CodingHarnessReadiness = {harness: 'codex', installed: 'yes', version: '0.163.0', signedIn: 'yes', plan: 'plus',
    limits: null, limitsObservedAtMs: null, checkedAtMs: 1, capabilities: {steering: 'unsupported', resume: 'saved-session', review: true}};
  assert.equal((await w.enableAdapters([harness])).status, 'accepted');
  assert.equal((await w.dispatch('codex-choice', 'worker-1', 'codex')).status, 'accepted');
  await until(() => w.work.length === 1);
  const work = w.work[0];
  assert.equal(work?.dataschema, 'https://bunny.invalid/events/coding-work/2.2');
  assert.ok(work?.data.action === 'start');
  assert.equal(work.data.harness, 'codex');
  const {operationId} = work.data;
  await w.progressAdapters({operationId, harness: 'codex', status: 'started'});
  await until(() => w.outcomes.length === 1);
  await w.progressAdapters({operationId, harness: 'codex', status: 'started', sessionId: 'native-first'});
  await w.progressAdapters({operationId, harness: 'codex', status: 'started', sessionId: 'native-later'});
  await until(() => w.owner().inspect().runs?.[0]?.sessionId === 'native-first');
  assert.equal(w.outcomes.length, 1);
  assert.equal(w.published.at(-1)?.dataschema, 'https://bunny.invalid/events/coding-state/2.3');
  await w.lost();
  await until(() => w.deliveries.length === 1);
  assert.match(w.deliveries[0]?.text ?? '', /^uncertain \(lost\)/);
  assert.equal(w.work.length, 1);
});
