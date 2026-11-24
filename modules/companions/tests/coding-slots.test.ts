// Coding-worker slots through the companions module (Hub #2028): one slot per companion, a proposal bound to the
// worker's connection, and an approved hand-off that waits for a busy slot and is sent once when it frees. Each
// profile has one conversation until New conversation (#2029), so a companion's own second hand-off cannot arise here
// end to end; it is covered in coding-coordinator.test.ts. An older worker that declares no slots holds one run for
// every companion, which makes another companion's hand-off wait through the real module. Fake core dispatcher, fake
// worker and scripted providers only; time moves only on the harness's manual clock, and waits yield turns.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {AssistantProfile, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {CodingResult, CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {InProcessBus, type Command, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import type {ModelProvider, TurnReply} from '../src/assistant/provider.js';

const PROFILES = ['bunny', 'reachy', 'microduck'] as const;
const ENDPOINT = 'worker-endpoint-1';
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
/** Each profile's model: a task's first call proposes a hand-off, and the call after the worker's word reports it. */
const delegating = (profile: AssistantProfile): ModelProvider => ({name: 'synthetic', model: 'synthetic', turn: input => Promise.resolve<TurnReply>(input.transcript.every(item => item.role === 'owner')
  ? {text: null, calls: [{id: `call-${profile}-${String(input.transcript.length)}`, name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: `Synthetic ${profile} brief.`}}], stop: 'tool', units: 10}
  : {text: `Synthetic ${profile} report.`, calls: [], stop: 'end', units: 10})});
const result = (summary: string): CodingResult => ({outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: [], checks: [],
  findings: [], limitations: [], summary, sessionId: null, usage: null});

async function world(context: TestContext, options: CompanionsOptions = {}) {
  let now = Date.parse('2026-11-24T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'coding-slots-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core'), worker = bus.connect('bunny/parts/coding-worker');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  // The core's tracked dispatcher forwards a dispatch to the module's coding-run responder, once per request ID.
  const dispatched: string[] = [], work: Command<CodingWork>[] = [];
  await core.respond<{requestId: string}>('bunny.cmd.coding-dispatch.assistant', async command => {
    dispatched.push(command.data.requestId);
    const answer = await core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  await worker.respond<CodingWork>('bunny.cmd.coding-work.*', command => {work.push(command); return {status: 'accepted'};});
  const make = () => {
    const module = createCompanionsModule({timeZone: 'America/Chicago', tools: ['delegate_coding'], provider: delegating('bunny'), profileProviders: {reachy: delegating('reachy'), microduck: delegating('microduck')}, ...options});
    return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};
  };
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await worker.close(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const control = (action: string, extra: Record<string, unknown> = {}): Promise<RequestResult> => {
    const requestId = randomUUID();
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action, expectedRevision: state().revision, ...extra}}, {requestId, timeoutMs: 5000});
  };
  const send = async (profile: AssistantProfile, text: string, answer = false): Promise<RequestResult> => {
    const requestId = randomUUID(), current = task(profile);
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile, expectedRevision: state().revision, text,
        ...(answer ? {taskId: current?.taskId, questionId: current?.questionId} : {})}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const messages = async (profile: AssistantProfile): Promise<{role: string; text: string}[]> => {
    const content = await module.manifest.content?.('conversation', {query: {profile}, signal: new AbortController().signal});
    assert.ok(content !== undefined && !('error' in content), JSON.stringify(content));
    return (JSON.parse(Buffer.from(content.bytes).toString()) as {messages: {role: string; text: string}[]}).messages;
  };
  /** The worker declares itself: a worker from Hub #2028 with three slots (2.2), or an older one that declares none (2.0). */
  const enable = (slots?: number) => worker.request(`bunny.cmd.coding-endpoint.${ENDPOINT}`, {type: 'org.bunny.coding.endpoint.requested', subject: ENDPOINT,
    dataschema: `https://bunny.invalid/events/coding-endpoint/${slots === undefined ? '2.0' : '2.2'}`, data: {requestId: randomUUID(), action: 'enable', ...(slots === undefined ? {} : {slots})}}, {timeoutMs: 5000});
  const progress = (data: object) => worker.publish(`bunny.event.coding-progress.${ENDPOINT}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: ENDPOINT,
    dataschema: 'https://bunny.invalid/events/coding-progress/2.1', data});
  const starts = () => work.filter(command => command.data.action === 'start');
  /** A profile's task asks, waits at its approval and is approved. */
  const approved = async (profile: AssistantProfile): Promise<void> => {
    await settle(() => task(profile)?.status === 'waiting' && task(profile)?.questionId !== null && task(profile)?.hasAnswer === false, `${profile} waits for approval`);
    assert.equal((await send(profile, 'approve', true)).status, 'accepted');
  };
  return {module: () => module, task, control, send, messages, enable, progress, starts, work, dispatched, approved, coding: () => module.inspectCoding() ?? assert.fail('coding state'),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}, advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}}};
}

void test('three companions hand off at once, each run tagged and each result back in its own conversation; another companion\'s run never refuses an approval', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable(3)).status, 'accepted');
  // B.U.N.N.Y.'s proposal is bound before Reachy's run starts; its approval afterwards is still accepted.
  assert.equal((await w.send('bunny', 'Synthetic bunny request')).status, 'accepted');
  await settle(() => w.task('bunny')?.status === 'waiting' && w.task('bunny')?.questionId !== null);
  for (const profile of ['reachy', 'microduck'] as const) {assert.equal((await w.send(profile, `Synthetic ${profile} request`)).status, 'accepted'); await w.approved(profile);}
  await settle(() => w.starts().length === 2);
  await w.progress({operationId: w.starts()[0]?.data.operationId, status: 'started'});
  await settle(() => w.coding().runs?.some(run => run.status === 'started') === true);
  await w.approved('bunny');
  await settle(() => w.starts().length === 3, 'B.U.N.N.Y.\'s approval was not refused');
  assert.deepEqual(w.starts().map(command => command.data.action === 'start' ? command.data.companion : undefined), ['reachy', 'microduck', 'bunny']);
  assert.deepEqual(w.coding().runs?.map(run => run.companion), ['reachy', 'microduck', 'bunny']);
  assert.doesNotMatch(JSON.stringify(await w.messages('bunny')), /revision-conflict/);
  // Each result resumes only its own conversation.
  for (const command of w.starts()) {
    const id = command.data.operationId, companion = command.data.action === 'start' ? command.data.companion ?? 'unknown' : 'unknown';
    if (companion !== 'reachy') await w.progress({operationId: id, status: 'started'});
    await w.progress({operationId: id, status: 'completed', result: result(`Synthetic ${companion} result.`)});
  }
  await settle(() => PROFILES.every(profile => w.task(profile)?.status === 'succeeded'), 'every conversation finished');
  for (const profile of PROFILES) {
    const text = JSON.stringify(await w.messages(profile));
    assert.match(text, new RegExp(`Synthetic ${profile} result`));
    for (const other of PROFILES.filter(value => value !== profile)) assert.doesNotMatch(text, new RegExp(`Synthetic ${other} result`));
  }
  assert.deepEqual(w.coding().runs, []);
});

void test('with an older worker\'s one slot, an approved hand-off waits busy, Cancel removes it unsent, and a waiting one survives a restart and is sent once', {timeout: 30_000}, async context => {
  const w = await world(context);
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic bunny request')).status, 'accepted'); await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  assert.equal(w.starts()[0]?.dataschema, 'https://bunny.invalid/events/coding-work/2.0', 'an older worker gets the start it knows');
  // Reachy is still offered the hand-off; once approved it waits, and the conversation says the worker is busy.
  assert.equal((await w.send('reachy', 'Synthetic reachy request')).status, 'accepted');
  await settle(() => w.task('reachy')?.status === 'waiting' && w.task('reachy')?.questionId !== null);
  assert.equal(w.module().inspectAssistant()?.tasks.find(entry => entry.profile === 'reachy')?.questionId?.includes('-q'), true, 'an approval, not a refusal');
  await w.approved('reachy');
  await settle(() => w.coding().waiting?.length === 1);
  assert.deepEqual(w.coding().waiting?.map(entry => entry.companion), ['reachy']);
  const waitingText = JSON.stringify(await w.messages('reachy'));
  assert.match(waitingText, /accepted: the coding worker is busy, so this hand-off waits for Reachy's slot/);
  assert.doesNotMatch(waitingText, /No coding worker is connected/);
  // The conversation says the hand-off waits; it says "delegated" only once it is sent.
  assert.match(waitingText, /Waiting to delegate to the coding worker in agent-device-hub: Synthetic reachy brief\./);
  assert.doesNotMatch(waitingText, /Delegated to the coding worker/);
  assert.equal(w.dispatched.length, 1, 'nothing left for the waiting hand-off');
  // Cancel removes it and sends nothing.
  const reachyTask = w.task('reachy')?.taskId ?? assert.fail('reachy task');
  assert.equal((await w.control('cancel', {taskId: reachyTask})).status, 'accepted');
  await settle(() => w.coding().waiting?.length === 0 && w.task('reachy')?.status === 'cancelled');
  assert.equal(w.work.length, 1); assert.equal(w.dispatched.length, 1);
  // MicroDuck's approved hand-off waits in its place, across a restart, and is sent once when the slot frees.
  assert.equal((await w.send('microduck', 'Synthetic microduck request')).status, 'accepted'); await w.approved('microduck');
  await settle(() => w.coding().waiting?.length === 1);
  await w.restart();
  // B.U.N.N.Y.'s unanswered run is uncertain now; MicroDuck's never-sent hand-off keeps waiting.
  await settle(() => w.task('bunny')?.status === 'succeeded', 'B.U.N.N.Y. heard its uncertain result');
  assert.match(JSON.stringify(await w.messages('bunny')), /uncertain \(lost\)/);
  assert.deepEqual(w.coding().waiting?.map(entry => entry.companion), ['microduck']);
  assert.equal((await w.enable()).status, 'accepted');
  await settle(() => w.starts().length === 2, 'the waiting hand-off is sent when the slot is free');
  const second = w.starts()[1]?.data; assert.ok(second?.action === 'start'); assert.equal(second.taskId, w.task('microduck')?.taskId);
  assert.equal((await w.enable()).status, 'accepted');
  for (let turn = 0; turn < 50; turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(w.starts().length, 2); assert.equal(w.dispatched.filter(id => id === second.operationId).length, 1, 'sent once');
  await w.progress({operationId: second.operationId, status: 'started'});
  await w.progress({operationId: second.operationId, status: 'completed', result: result('Synthetic microduck result.')});
  await settle(() => w.task('microduck')?.status === 'succeeded');
  const microduck = JSON.stringify(await w.messages('microduck'));
  assert.match(microduck, /Synthetic microduck result/);
  assert.ok(microduck.indexOf('Waiting to delegate to the coding worker') < microduck.indexOf('Delegated to the coding worker'), 'the line changes from waiting to delegated once sent');
});

void test('a waiting hand-off whose task was cancelled without the coordinator hearing it is never sent', {timeout: 30_000}, async context => {
  // The engine commits the cancel; the call that would remove the waiting hand-off is lost, as during a stop.
  const w = await world(context, {onCancelled: () => {}});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.enable()).status, 'accepted');
  assert.equal((await w.send('bunny', 'Synthetic bunny request')).status, 'accepted'); await w.approved('bunny');
  await settle(() => w.starts().length === 1);
  assert.equal((await w.send('reachy', 'Synthetic reachy request')).status, 'accepted'); await w.approved('reachy');
  await settle(() => w.coding().waiting?.length === 1);
  const reachyTask = w.task('reachy')?.taskId ?? assert.fail('reachy task');
  assert.equal((await w.control('cancel', {taskId: reachyTask})).status, 'accepted');
  await settle(() => w.task('reachy')?.status === 'cancelled');
  assert.equal(w.coding().waiting?.length, 1, 'the coordinator never heard the cancel');
  const bunnyRun = w.starts()[0]?.data.operationId;
  await w.progress({operationId: bunnyRun, status: 'started'});
  await w.progress({operationId: bunnyRun, status: 'completed', result: result('Synthetic bunny result.')});
  await settle(() => w.coding().waiting?.length === 0 && w.task('bunny')?.status === 'succeeded');
  for (let turn = 0; turn < 50; turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(w.starts().length, 1, 'the cancelled hand-off was never sent'); assert.equal(w.dispatched.length, 1);
});
