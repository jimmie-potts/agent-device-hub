// Native assistant tasks in the shared session model (Hub #505): each task change commits the observations that move its
// session, in lifecycle/2.2 from the module's own source with known ordering, and nothing else reports. These tests use
// fake providers and the harness's manual clock and scheduler; they wait for messages, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {test, type TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator, sessionEntityId, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {InProcessBus} from '@jimmie-potts/sdk';
import {RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AssistantStore} from '../src/assistant/store.js';
import type {ModelProvider, TurnReply} from '../src/assistant/provider.js';
import {eventsOf, observationDraft, observationOf, projectionOf, type ProjectedTask, type Projection} from '../src/assistant/sessions.js';
import {summarizeSessions} from '../src/assistant/tools.js';

const NATIVE = {provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions'} as const;
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const ask = (text: string): TurnReply => ({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text}}], stop: 'tool', units: 10});
const kinds = (events: {event: {kind: string}}[]): string[] => events.map(({event}) => event.kind);
const base: ProjectedTask = {id: 'task-1', profile: 'bunny', runId: 'run-1', status: 'running', question: null};

void test('each task status projects the claims the design names, and only an open clarification or approval is attention', () => {
  const project = (patch: Partial<ProjectedTask>): Projection | undefined => projectionOf({...base, ...patch});
  assert.equal(project({runId: null, status: 'paused'}), undefined, 'a task before its first run reports nothing');
  assert.deepEqual(project({}), {run: 'run-1', work: 'active', question: null, result: null});
  const clarification = {id: 'task-1-q1', kind: 'clarification' as const, answer: null};
  assert.deepEqual(project({status: 'waiting', question: clarification}), {run: 'run-1', work: 'idle', question: {id: 'task-1-q1', kind: 'input', run: 'run-1'}, result: null});
  assert.deepEqual(project({status: 'waiting', question: {...clarification, kind: 'approval'}})?.question?.kind, 'approval');
  assert.equal(project({status: 'waiting', question: {...clarification, kind: 'delegation'}})?.question, null, 'a delegation wait is not owner attention');
  assert.deepEqual(project({status: 'waiting', question: {...clarification, kind: 'delegation'}})?.work, 'idle', 'and makes no running-work claim');
  assert.equal(project({status: 'paused', question: {...clarification, answer: 'yes'}})?.question, null, 'an answered question is no longer attention');
  assert.deepEqual(project({status: 'paused'})?.work, 'interrupted');
  assert.deepEqual(project({status: 'uncertain'})?.work, 'unknown');
  for (const result of ['succeeded', 'failed', 'cancelled'] as const) {
    assert.deepEqual(project({status: result, question: clarification}), {run: 'run-1', work: 'idle', question: null, result}, result);
  }
});

void test('the events of a change resolve, start, ask and stop in order, and a change that keeps the projection has none', () => {
  const running: Projection = {run: 'run-1', work: 'active', question: null, result: null};
  const asked: Projection = {...running, question: {id: 'q1', kind: 'input', run: 'run-1'}};
  const waiting: Projection = {...asked, work: 'idle'};
  assert.deepEqual(kinds(eventsOf(undefined, running)), ['turn-started']);
  assert.deepEqual(kinds(eventsOf(running, asked)), ['attention-input']);
  assert.deepEqual(kinds(eventsOf(asked, waiting)), ['turn-waiting']);
  const resumed = eventsOf(waiting, {run: 'run-2', work: 'active', question: null, result: null});
  assert.deepEqual(resumed, [
    {event: {kind: 'attention-resolved', attention: {status: 'known', id: 'q1'}}, turn: 'run-1'},
    {event: {kind: 'turn-started'}, turn: 'run-2'},
  ], 'the answer resolves its own question on the run that asked it, and the activation starts a new run');
  assert.deepEqual(eventsOf(waiting, {...waiting, work: 'idle', question: null, result: 'cancelled'}), [{event: {kind: 'turn-ended', result: 'cancelled'}, turn: 'run-1'}],
    'an ended task\'s turn end clears its question, which is not resolved');
  assert.deepEqual(kinds(eventsOf(running, {...running, work: 'interrupted'})), ['turn-interrupted']);
  assert.deepEqual(kinds(eventsOf(running, {...running, work: 'unknown'})), ['turn-uncertain']);
  assert.deepEqual(kinds(eventsOf(undefined, {...asked, work: 'idle'})), ['turn-started', 'attention-input', 'turn-waiting'], 'a first report states the whole task');
  assert.deepEqual(eventsOf(waiting, waiting), []);
});

void test('every observation is a valid lifecycle/2.2 message of the native source with known ordering and the persona title', () => {
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    const task = {id: `task-${profile}`, profile};
    for (const [index, reported] of eventsOf(undefined, {run: 'run-1', work: 'idle', question: {id: 'q1', kind: 'approval', run: 'run-1'}, result: null}).entries()) {
      const observation = observationOf(task, reported, index + 1, 1_790_000_000_000);
      const {key, draft} = observationDraft(observation);
      assert.equal(key, `bunny.event.lifecycle.${sessionEntityId(observation.identity)}`);
      assert.deepEqual(observation.identity, {...NATIVE, sessionId: task.id});
      assert.deepEqual(observation.ordering, {status: 'known', authority: 'companions', epoch: task.id, sequence: index + 1});
      assert.deepEqual(observation.parent, {status: 'top-level'});
      assert.deepEqual(observation.title, {value: {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'}[profile], source: 'provider'});
      const message = {specversion: '1.0', bunnyprofile: '2.0', id: `observation-${String(index)}`, source: 'bunny/modules/companions', time: new Date(1_790_000_000_000).toISOString(),
        datacontenttype: 'application/json', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...draft};
      const result = coreValidator().validate(message);
      assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.error));
    }
  }
});

void test('the release that reports tasks records saved tasks as reported and reports none of them', () => {
  const database = new DatabaseSync(':memory:');
  const store = new AssistantStore(database);
  const saved = store.newTask('bunny', 'synthetic prompt');
  Object.assign(saved, {status: 'waiting', runId: 'run-old', question: {id: `${saved.id}-q1`, text: 'Synthetic question?', answer: null, kind: 'clarification', call: 'call-1', proposal: null}});
  store.save(saved);
  database.exec('DROP TABLE assistant_reports');
  const reopened = new AssistantStore(database);
  assert.deepEqual(reopened.report(saved.id), {sequence: 0, projection: projectionOf(saved)});
  database.close();
});

void test('read_sessions lists coding agent sessions only, never the assistant\'s own tasks', () => {
  const view = (provider: 'claude' | 'bunny', sessionId: string): SessionView => buildSession({
    id: sessionId, revision: 1, generation: 1, identity: provider === 'bunny' ? {...NATIVE, sessionId} : {provider, client: 'code', hostId: 'host', sourceId: 'hooks', sessionId},
    parent: {status: 'top-level'}, turn: {status: 'known', id: 'run-1'}, work: 'active', attention: [], notices: [], read: 'unknown', unavailable: [],
    ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000, children: {working: 0, unconfirmed: 0},
  });
  const text = summarizeSessions({synced: true, sessions: [view('claude', 'claude-1'), view('bunny', 'task-1')], mode: undefined}, 2000);
  assert.match(text, /^1 coding agent session\(s\):/);
  assert.doesNotMatch(text, /bunny/);
  assert.equal(summarizeSessions({synced: true, sessions: [view('bunny', 'task-1')], mode: undefined}, 2000), 'No coding agent session is known to the core right now.');
});

/** A provider that answers from a list, and one turn that never answers until released. */
function scripted(replies: (TurnReply | 'hold')[]): ModelProvider & {called: Promise<void>} {
  let turn = 0, called: () => void = () => {};
  const promise = new Promise<void>(resolve => {called = resolve;});
  return {name: 'synthetic', model: 'synthetic', called: promise, turn: () => {
    const next = replies[turn++] ?? reply('Done.');
    if (next === 'hold') {called(); return new Promise<TurnReply>(() => {});}
    return Promise.resolve(next);
  }};
}

/** The module under the harness on a bus, with every lifecycle observation the bus carries collected in order. */
async function world(context: TestContext, options: CompanionsOptions) {
  let now = 1_790_000_000_000;
  const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-sessions-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const seen: Message<LifecycleObservation>[] = [], waiters: {count: number; resolve: () => void}[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {
    seen.push(message);
    for (const waiter of waiters.filter(item => seen.length >= item.count)) waiter.resolve();
  });
  const make = () => {const module = createCompanionsModule(options); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, spans: new RecordedSpans(), section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {
    core, seen, module: () => module, tick: (ms: number) => {now += ms;},
    /** Resolves once the bus has carried `count` observations in all. */
    observed: (count: number) => seen.length >= count ? Promise.resolve() : new Promise<void>(resolve => {waiters.push({count, resolve});}),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();},
    store: () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database')),
  };
}
type World = Awaited<ReturnType<typeof world>>;
async function control(w: World, action: string, taskId?: string) {
  const requestId = randomUUID();
  return w.core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action, expectedRevision: w.module().inspectAssistant()?.revision, ...(taskId === undefined ? {} : {taskId})}}, {requestId, timeoutMs: 5000});
}
async function input(w: World, text: string, answer = false, profile = 'bunny') {
  const requestId = randomUUID(), module: CompanionsModule = w.module(), state = module.inspectAssistant(), task = state?.tasks.find(item => item.profile === profile);
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile, expectedRevision: state?.revision, text,
      ...(answer ? {taskId: task?.taskId, questionId: task?.questionId} : {})}))});
  assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
  return w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
}
const summary = (w: World) => w.seen.map(({data}) => `${data.event.kind}${'attention' in data.event && data.event.attention.status === 'known' ? ` ${data.event.attention.id}` : ''}${'result' in data.event ? ` ${data.event.result}` : ''} on ${data.turn.status === 'known' ? data.turn.id : '?'} #${data.ordering.status === 'known' ? String(data.ordering.sequence) : '?'}`);

// A missing report fails the test at the runner's bound instead of waiting forever.
void test('a task that asks, is answered and succeeds reports each change once, from the module, in order', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Which synthetic detail?'), reply('Synthetic answer.')])});
  await control(w, 'enable');
  assert.equal(w.seen.length, 0, 'enabling the conversation is not work');
  await input(w, 'synthetic request');
  await w.observed(3);
  const state = w.module().inspectAssistant()?.tasks[0];
  assert.ok(state !== undefined && state.runId !== null && state.questionId !== null);
  const [first, question] = [state.runId, state.questionId];
  await input(w, 'synthetic answer', true);
  await w.observed(6);
  const second = w.module().inspectAssistant()?.tasks[0]?.runId;
  assert.ok(second !== null && second !== undefined && second !== first, 'the answer activates a new run');
  assert.deepEqual(summary(w), [`turn-started on ${first} #1`, `attention-input ${question} on ${first} #2`, `turn-waiting on ${first} #3`,
    `attention-resolved ${question} on ${first} #4`, `turn-started on ${second} #5`, `turn-ended succeeded on ${second} #6`]);
  for (const message of w.seen) {
    assert.equal(message.source, 'bunny/modules/companions');
    assert.equal(message.dataschema, 'https://bunny.invalid/events/lifecycle/2.2');
    assert.deepEqual(message.data.identity, {...NATIVE, sessionId: state.taskId});
  }
  // Reads and a restart with a finished task report nothing more.
  await w.module().manifest.content?.('conversation', {query: {profile: 'bunny'}, signal: new AbortController().signal});
  await w.restart();
  await control(w, 'enable');
  assert.equal(w.seen.length, 6);
  assert.deepEqual(w.store().report(state.taskId).sequence, 6);
});

// A missing report fails the test at the runner's bound instead of waiting forever.
void test('an owner cancel ends a waiting task with its result and no resolution, and a restart keeps a waiting task silent', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Synthetic question?')])});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(3);
  await w.restart();
  assert.equal(w.seen.length, 3, 'a waiting task reconciled at startup reports nothing');
  const taskId = w.module().inspectAssistant()?.tasks[0]?.taskId;
  await control(w, 'cancel', taskId);
  await w.observed(4);
  assert.deepEqual(summary(w).slice(3).map(line => line.replace(/ on .*/, '')), ['turn-ended cancelled']);
});

// A missing report fails the test at the runner's bound instead of waiting forever.
void test('a restart while a call is unanswered reports the task uncertain once and starts nothing', {timeout: 20_000}, async context => {
  const provider = scripted(['hold']);
  const w = await world(context, {provider});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await provider.called;
  await w.observed(1);
  w.tick(1000);
  await w.restart();
  await w.observed(2);
  assert.deepEqual(summary(w).map(line => line.replace(/ on .*/, '')), ['turn-started', 'turn-uncertain']);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'uncertain');
});

// A missing report fails the test at the runner's bound instead of waiting forever.
void test('tasks of the demo profiles report too, each its own session', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([])});
  await control(w, 'enable');
  await input(w, 'synthetic reachy request', false, 'reachy');
  await w.observed(1);
  const [started] = w.seen;
  assert.equal(started?.data.title?.value, 'Reachy');
  assert.equal(started?.data.event.kind, 'turn-started');
});
