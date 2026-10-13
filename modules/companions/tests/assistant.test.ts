import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {test, type TestContext} from 'node:test';
import {fullDisk, InProcessBus, type Participant, type ModuleContext} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsModule} from '../src/module.js';
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import type {AssistantOptions} from '../src/assistant/engine.js';

function deferred<T>() {let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.ok(check(), 'expected task state arrived');
}
async function world(context: TestContext, options: AssistantOptions = {}, adapt: (context: ModuleContext) => ModuleContext = context => context) {
  const spans = new RecordedSpans();
  let now = Date.now();
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-owner-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let module = createCompanionsModule(options), host = new ModuleHarness({...module, start: context => module.start(adapt(context))}, {bus, stateDir: dir, spans, ...time});
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {core, spans, advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}}, store: () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database')), module: () => module, host: () => host, restart: async () => {
    await host.stop(); module = createCompanionsModule(options); host = new ModuleHarness({...module, start: context => module.start(adapt(context))}, {bus, stateDir: dir, spans, ...time}); await host.start();
  }};
}
async function control(core: Participant, module: CompanionsModule, action: string, taskId?: string, requestId = randomUUID()) {
  return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action, expectedRevision: module.inspectAssistant()?.revision, ...(taskId === undefined ? {} : {taskId})}}, {requestId, timeoutMs: 5000});
}
async function input(core: Participant, module: CompanionsModule, text: string, answer = false, requestId = randomUUID(), extra: Record<string, unknown> = {}) {
  const state = module.inspectAssistant(), task = state?.tasks[0];
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile: 'bunny', expectedRevision: state?.revision, text,
      ...(answer ? {taskId: task?.taskId, questionId: task?.questionId} : {}), ...extra}))});
  assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
  return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
}

void test('private task pauses, restarts without execution and consumes an explicit saved answer in a new run', async context => {
  let calls = 0;
  const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text: `Synthetic ${text}`, units: 20});}});
  assert.equal(w.module().inspectAssistant()?.enabled, false);
  const enabled = await control(w.core, w.module(), 'enable'); assert.equal(enabled.status, 'accepted', JSON.stringify(enabled));
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-PROMPT')).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  const first = w.module().inspectAssistant()?.tasks[0]; assert.ok(first);
  assert.equal(calls, 1);
  await w.restart();
  assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.questionId, first.questionId);
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true)).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded');
  const last = w.module().inspectAssistant()?.tasks[0]; assert.ok(last);
  assert.equal(last.taskId, first.taskId); assert.equal(last.conversationId, first.conversationId); assert.notEqual(last.runId, first.runId);
  assert.equal(calls, 2); assert.equal(last.toolCalls, 1); assert.equal(last.questions, 1);
  const content = await w.module().manifest.content?.('conversation', {query: {profile: 'bunny'}, signal: new AbortController().signal});
  assert.ok(content !== undefined && !('error' in content));
  assert.match(Buffer.from(content.bytes).toString(), /PRIVATE-SYNTHETIC-PROMPT/);
  assert.match(Buffer.from(content.bytes).toString(), /PRIVATE-SYNTHETIC-ANSWER/);
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-SYNTHETIC'), false);
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC'), false);
});

void test('cancel fences a running call and records a late reply without running the next node', async context => {
  const result = deferred<{text: string; units: number}>(); let calls = 0;
  const w = await world(context, {model: () => {calls += 1; return result.promise;}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic cancel');
  await until(() => calls === 1);
  const task = w.module().inspectAssistant()?.tasks[0]; assert.ok(task);
  const stopped = await control(w.core, w.module(), 'cancel', task.taskId); assert.equal(stopped.status, 'accepted');
  await until(() => w.spans.named('bunny.assistant.run').every(span => span.endedAtMs !== undefined));
  result.resolve({text: 'Synthetic late reply', units: 15});
  await until(() => w.store().calls(task.taskId)[0]?.result !== null);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'cancelled'); assert.equal(calls, 1);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.toolCalls, 0);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.activeMs, LIMITS.modelMs);
  await w.restart(); assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'cancelled');
});

void test('deadline keeps unknown usage and reserved time across restart, then explicit resume reuses late evidence', async context => {
  const result = deferred<{text: string; units: number}>(); let calls = 0;
  const w = await world(context, {model: () => {calls += 1; return result.promise;}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic deadline');
  await until(() => calls === 1); w.advance(LIMITS.modelMs);
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'uncertain');
  const first = w.module().inspectAssistant()?.tasks[0]; assert.ok(first);
  assert.equal(first.usageUnits, null); assert.equal(first.reservedUnits, LIMITS.callUnits); assert.equal(first.activeMs, LIMITS.modelMs);
  const refused = await control(w.core, w.module(), 'resume', first.taskId); assert.equal(refused.status, 'rejected');
  result.resolve({text: 'Synthetic late evidence', units: 25});
  await until(() => w.store().calls(first.taskId)[0]?.status === 'succeeded');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'uncertain');
  await w.restart(); assert.equal(calls, 1);
  assert.equal((await control(w.core, w.module(), 'resume', first.taskId)).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  assert.equal(calls, 1);
  assert.equal((await input(w.core, w.module(), 'Synthetic answer', true)).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded');
  assert.equal(calls, 2); assert.equal(w.module().inspectAssistant()?.tasks[0]?.modelCalls, 2);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.activeMs, LIMITS.modelMs);
});

void test('startup projects an interrupt and saved answer without invoking the graph', async context => {
  let calls = 0;
  const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text, units: 10});}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic projection');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  const first = w.module().inspectAssistant()?.tasks[0]; assert.ok(first);
  const store = w.store(), task = store.task(first.taskId); assert.ok(task);
  // Recreate the domain side of a crash after the interrupt checkpoint, before its projection.
  task.question = null; task.questions = 0; task.status = 'running'; store.save(task);
  await w.restart(); assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.questionId, first.questionId);
  const saved = w.store().task(first.taskId); assert.ok(saved?.question);
  saved.question.answer = 'Synthetic durably saved answer'; saved.status = 'running'; w.store().save(saved);
  await w.restart(); assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'paused');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.hasAnswer, true);
  assert.equal((await control(w.core, w.module(), 'resume', first.taskId)).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded'); assert.equal(calls, 2);
});

void test('duplicate controls and stale, wrong-question or cross-profile input never repeat calls', async context => {
  let calls = 0;
  const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text, units: 10});}});
  await control(w.core, w.module(), 'enable');
  const requestId = randomUUID(), revision = w.module().inspectAssistant()?.revision;
  const staged = await w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: revision, text: 'Synthetic idempotence'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const send = () => w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  assert.equal((await send()).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  assert.equal((await send()).status, 'accepted'); assert.equal(calls, 1);
  for (const extra of [{questionId: 'wrong'}, {profile: 'reachy'}, {expectedRevision: 0}]) {
    assert.equal((await input(w.core, w.module(), 'Synthetic refused', true, randomUUID(), extra)).status, 'rejected');
  }
  assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.hasAnswer, false);
  assert.equal((await input(w.core, w.module(), 'Synthetic second unfinished')).status, 'rejected');
  assert.equal(w.store().latest().length, 1);
});

void test('per-task counters and usage ceilings survive restart and refuse calls before dispatch', async context => {
  for (const patch of [{modelCalls: LIMITS.modelCalls}, {toolCalls: LIMITS.toolCalls}, {reservedUnits: LIMITS.units}, {activeMs: LIMITS.activeMs}]) {
    let calls = 0, tools = 0;
    const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text, units: 10});}, tool: () => {tools += 1; return Promise.resolve('Synthetic fixture');}});
    await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic budget');
    await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
    const id = w.module().inspectAssistant()?.tasks[0]?.taskId; assert.ok(id !== undefined); const task = w.store().task(id); assert.ok(task);
    Object.assign(task, patch); w.store().save(task); await w.restart();
    const reply = await input(w.core, w.module(), 'Synthetic answer', true);
    if (reply.status === 'accepted') await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'failed');
    else assert.equal(reply.status, 'rejected');
    assert.equal(calls, 1); assert.equal(tools, 'modelCalls' in patch ? 1 : 0);
    const last = w.store().task(id); assert.ok(last); for (const [key, value] of Object.entries(patch)) assert.equal(last[key as keyof typeof last], value);
  }
});

void test('the persisted question ceiling prevents another question from being published', async context => {
  const result = deferred<{text: string; units: number}>(); let calls = 0;
  const w = await world(context, {model: () => {calls += 1; return result.promise;}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic question ceiling');
  await until(() => calls === 1);
  const id = w.module().inspectAssistant()?.tasks[0]?.taskId; assert.ok(id !== undefined);
  const task = w.store().task(id); assert.ok(task); task.questions = LIMITS.questions; w.store().save(task);
  result.resolve({text: 'Synthetic interpretation', units: 10});
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'failed');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.code, 'capacity');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.questionId, null);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.toolCalls, 0);
  await w.restart(); assert.equal(calls, 1); assert.equal(w.module().inspectAssistant()?.tasks[0]?.questions, LIMITS.questions);
});

void test('human wait and downtime use no active budget; profiles keep independent conversations', async context => {
  const w = await world(context);
  await control(w.core, w.module(), 'enable');
  const conversations = new Set<string>();
  for (const profile of ['bunny', 'reachy', 'microduck']) {
    assert.equal((await input(w.core, w.module(), `Synthetic ${profile}`, false, randomUUID(), {profile})).status, 'accepted');
    await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.status === 'waiting');
    const task = w.module().inspectAssistant()?.tasks.find(t => t.profile === profile); assert.ok(task);
    conversations.add(task.conversationId); w.advance(3_600_000); await w.restart();
    assert.equal(w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.activeMs, 0);
    assert.equal((await input(w.core, w.module(), 'Synthetic answer', true, randomUUID(), {profile, taskId: task.taskId, questionId: task.questionId})).status, 'accepted');
    await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.status === 'succeeded');
  }
  assert.equal(conversations.size, 3);
  assert.equal(w.spans.named('bunny.assistant.run').length, 6);
  assert.ok(w.spans.named('bunny.assistant.run').every(span => span.endedAtMs !== undefined));
  assert.ok(w.spans.named('bunny.assistant.run').filter(span => span.links.length === 1).length === 3);
});

void test('malformed, oversized and expired staged input has no effect, and expired staging frees its bound', async context => {
  const w = await world(context); await control(w.core, w.module(), 'enable');
  const stage = (bytes: Uint8Array, requestId = randomUUID()) => w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal, bytes});
  const json = (text: string) => Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', text, expectedRevision: w.module().inspectAssistant()?.revision}));
  for (const bytes of [Buffer.from('{'), json('x'.repeat(4097)), json('🐇'.repeat(1025)), Buffer.from('[]')]) {
    const result = await stage(bytes); assert.ok(result !== undefined && 'error' in result);
  }
  const requestId = randomUUID(), saved = await stage(json('Synthetic expiry'), requestId); assert.ok(saved !== undefined && !('error' in saved));
  w.advance(5000);
  const expired = await w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...saved.data}}, {requestId, timeoutMs: 5000});
  assert.equal(expired.status, 'rejected'); assert.equal(w.store().latest().length, 0);
  for (let n = 0; n < 12; n += 1) {const fresh = await stage(json('Synthetic abandoned')); assert.ok(fresh !== undefined && !('error' in fresh)); w.advance(5000);}
});

void test('unsupported graph stays readable and resume is refused without resetting reservations', async context => {
  const w = await world(context); await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic old graph');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  const id = w.module().inspectAssistant()?.tasks[0]?.taskId; assert.ok(id !== undefined); const task = w.store().task(id); assert.ok(task?.question);
  task.graphVersion = 'future-graph'; task.question.answer = 'Synthetic saved'; w.store().save(task); await w.restart();
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.code, 'unavailable');
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
  const page = w.store().page('bunny', 0); assert.equal(page.currentTask?.question?.answer, 'Synthetic saved'); assert.ok(page.messages.length > 0);
});

void test('tool deadline and oversized output stop before composition; unknown usage stays unknown', async context => {
  let calls = 0, tools = 0;
  const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text, units: null});},
    tool: () => {tools += 1; return new Promise(() => {});}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic tool timeout');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.usageUnits, null);
  await input(w.core, w.module(), 'Synthetic answer', true); await until(() => tools === 1); w.advance(5000);
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'uncertain'); assert.equal(calls, 1);
  await w.restart(); assert.equal(w.module().inspectAssistant()?.tasks[0]?.activeMs, 5000); assert.equal(calls, 1);
  const large = await world(context, {tool: () => Promise.resolve('x'.repeat(8193))});
  await control(large.core, large.module(), 'enable'); await input(large.core, large.module(), 'Synthetic large output');
  await until(() => large.module().inspectAssistant()?.tasks[0]?.status === 'waiting'); await input(large.core, large.module(), 'Synthetic answer', true);
  await until(() => large.module().inspectAssistant()?.tasks[0]?.status === 'uncertain');
  assert.equal(large.module().inspectAssistant()?.tasks[0]?.modelCalls, 1);
});

void test('full disk refuses cancellation without claiming a durable fence or exposing exception content', async context => {
  let calls = 0;
  const w = await world(context, {model: () => {calls += 1; return new Promise(() => {});}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic full disk'); await until(() => calls === 1);
  const id = w.module().inspectAssistant()?.tasks[0]?.taskId; assert.ok(id !== undefined);
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec('CREATE TABLE full_fixture (value BLOB); CREATE TRIGGER full_fixture_update BEFORE UPDATE ON assistant_tasks BEGIN INSERT INTO full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
  db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  assert.throws(() => db.prepare('UPDATE assistant_tasks SET status=status WHERE id=?').run(id), error => fullDisk(error));
  const result = await control(w.core, w.module(), 'cancel', id);
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.error.error.code, 'capacity');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'running');
  assert.equal(JSON.stringify(result).includes('SQLITE'), false);
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER full_fixture_update');
  assert.equal((await control(w.core, w.module(), 'cancel', id)).status, 'accepted');
});

void test('diagnostic records and spans correlate only registered identifiers with finished runs', async context => {
  const w = await world(context); await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-DIAGNOSTIC');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true);
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded');
  const logs = w.host().logs.filter(record => record.event.startsWith('assistant.'));
  assert.deepEqual(logs.map(record => checkModuleRecord('companions', record)), logs.map(() => undefined));
  assert.equal(logs.filter(record => record.event === 'assistant.run.started').length, 2);
  assert.equal(w.spans.named('bunny.assistant.model').length, 2); assert.equal(w.spans.named('bunny.assistant.tool').length, 1);
  assert.ok(w.spans.spans.every(span => span.endedAtMs !== undefined));
  assert.equal(JSON.stringify([logs, w.spans.spans]).includes('PRIVATE-SYNTHETIC'), false);
});

void test('outbox replays the original outcome identity and trace without another graph invocation', async context => {
  let drop = true, calls = 0; const attempts: Message<object>[] = [];
  const w = await world(context, {model: (_step, text) => {calls += 1; return Promise.resolve({text, units: 10});}}, context => ({...context,
    sdk: {...context.sdk, publishMessage: (key, message) => {
      if (message.kind === 'outcome') {attempts.push(message); if (drop) return Promise.reject(new Error('Synthetic lost publication'));}
      return context.sdk.publishMessage(key, message);
    }}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic deferred outcome');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting'); assert.equal(calls, 1);
  const original = attempts[0]; assert.ok(original); drop = false; await w.restart();
  assert.equal(calls, 1); const replay = attempts.filter(value => value.id === original.id); assert.ok(replay.length > 1);
  assert.ok(replay.every(value => value.traceparent === original.traceparent && value.time === original.time));
});

void test('throwing diagnostic sinks cannot fail a task or leak private exception text', async context => {
  const fail = () => {throw new Error('PRIVATE-SYNTHETIC-SINK-FAILURE');};
  const w = await world(context, {}, context => ({...context, log: {debug: fail, info: fail, warn: fail, error: fail}, trace: {...context.trace, start: fail}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic silent diagnostics');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting'); await input(w.core, w.module(), 'Synthetic answer', true);
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded');
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-SYNTHETIC'), false);
});

void test('unavailable fake model refuses activation while Reachy remains readable', async context => {
  const w = await world(context, {available: () => false});
  assert.equal(w.module().inspectAssistant()?.available, false);
  assert.equal((await control(w.core, w.module(), 'enable')).status, 'rejected');
  assert.equal(w.module().inspect()?.settings.enabled, false);
});

void test('private history pages remain bounded and always advance through escaped text', async context => {
  const w = await world(context), store = w.store(), task = store.newTask('bunny', '\u0001'.repeat(4096));
  task.question = {id: `${task.id}-q1`, text: 'Synthetic question', answer: '\u0001'.repeat(4096)}; store.save(task);
  store.message(task, 'prompt', 'owner', task.prompt, 0);
  for (let n = 0; n < 40; n += 1) store.message(task, `message-${String(n)}`, 'tool', '\u0001'.repeat(8192), 0);
  let after = 0, count = 0, pages = 0;
  do {
    const page = store.page('bunny', after); pages += 1; assert.ok(pages < 50);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= LIMITS.pageBytes); count += page.messages.length;
    if (page.next === null) break;
    assert.ok(page.next > after); after = page.next;
  } while (pages < 50);
  assert.equal(count, 41);
});

for (const condition of ['unavailable', 'incompatible', 'recovery-failure'] as const) {
  void test(`recovery guards preserve uncertain receipts when ${condition}`, async context => {
    let available = true, calls = 0;
    const w = await world(context, {available: () => available, model: () => {calls += 1; return new Promise(() => {});}});
    await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic uncertain recovery'); await until(() => calls === 1);
    const id = w.module().inspectAssistant()?.tasks[0]?.taskId; assert.ok(id !== undefined);
    if (condition === 'unavailable') available = false;
    if (condition === 'incompatible') {const task = w.store().task(id); assert.ok(task); task.graphVersion = 'future-graph'; w.store().save(task);}
    if (condition === 'recovery-failure') w.host().moduleDatabase()?.exec("UPDATE assistant_checkpoints SET checkpoint_type='unsupported-synthetic-format'");
    await w.restart();
    const state = w.module().inspectAssistant(), task = state?.tasks[0]; assert.ok(task);
    assert.equal(task.status, 'uncertain'); assert.equal(task.code, 'uncertain-result'); assert.equal(task.usageUnits, null);
    assert.equal(calls, 1); assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
    const saved = w.store().task(id); assert.ok(saved !== undefined && saved.runId !== null);
    const run = w.store().run(saved.runId); assert.ok(run); assert.notEqual(run.endedAtMs, null);
    if (condition !== 'incompatible') assert.equal(state?.available, false);
  });
}

void test('waiting, recovery and completion state retain the run trace continuity', async context => {
  const messages: Message<object>[] = [];
  const w = await world(context, {}, context => ({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
    if (key === 'bunny.state.assistant-state.assistant') messages.push(message);
    return context.sdk.publishMessage(key, message);
  }}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic trace continuity');
  await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'waiting');
  const originalRun = w.spans.named('bunny.assistant.run')[0]; assert.ok(originalRun);
  assert.equal(messages.at(-1)?.traceparent.split('-')[1], originalRun.traceId);
  await w.restart(); assert.equal(messages.at(-1)?.traceparent.split('-')[1], originalRun.traceId);
  await input(w.core, w.module(), 'Synthetic answer', true); await until(() => w.module().inspectAssistant()?.tasks[0]?.status === 'succeeded');
  const finalRun = w.spans.named('bunny.assistant.run').at(-1); assert.ok(finalRun);
  assert.equal(messages.at(-1)?.traceparent.split('-')[1], finalRun.traceId);
});

void test('internal projection faults use error severity without exception content', async context => {
  const w = await world(context);
  w.host().moduleDatabase()?.exec("CREATE TRIGGER fail_projection BEFORE UPDATE ON assistant_tasks WHEN NEW.status='waiting' BEGIN SELECT RAISE(ABORT, 'PRIVATE-SYNTHETIC-FAULT'); END;");
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic projection fault');
  await until(() => w.host().logs.some(record => record.event === 'assistant.run.settled'));
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'failed');
  const log = w.host().logs.find(record => record.event === 'assistant.run.settled'); assert.ok(log);
  assert.equal(log.fields['bunny.code'], 'internal'); assert.equal(log.level, 'error');
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC-FAULT'), false);
});

void test('expected cancellation before call admission uses info severity', async context => {
  const stopped = new AbortController();
  const w = await world(context, {}, context => ({...context, signal: stopped.signal, log: {...context.log, info: (event, fields, trace) => {
    context.log.info(event, fields, trace); if (event === 'assistant.run.started') stopped.abort();
  }}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic cancelled activation');
  await until(() => w.host().logs.some(record => record.event === 'assistant.run.settled'));
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'paused');
  const log = w.host().logs.find(record => record.event === 'assistant.run.settled'); assert.ok(log);
  assert.equal(log.fields['bunny.code'], 'cancelled'); assert.equal(log.level, 'info');
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.modelCalls, 0);
});
