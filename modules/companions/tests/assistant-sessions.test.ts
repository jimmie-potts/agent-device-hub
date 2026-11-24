// Native assistant conversations in the shared session model (Hub #505): each profile's conversation is one session and
// each task in it a turn. Each change commits the observations that move the session, in lifecycle/2.4 from the module's
// own source with the conversation's one ordering sequence and its companion (Hub #2054), and nothing else reports. These tests use fake providers and
// the harness's manual clock and scheduler; they wait for messages, never for time.
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
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import type {ModelProvider, TurnReply} from '../src/assistant/provider.js';
import {SyntheticProvider} from '../src/assistant/synthetic.js';
import {
  changesOf, eventsOf, observationDraft, observationOf, projectionOf, titleObservationOf, waitsOnOwner, type ProjectedTask, type Projection,
} from '../src/assistant/sessions.js';
import {summarizeSessions} from '../src/assistant/tools.js';

const NATIVE = {provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions'} as const;
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const ask = (text: string): TurnReply => ({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text}}], stop: 'tool', units: 10});
const kinds = (events: {kind: string}[]): string[] => events.map(event => event.kind);
const base: ProjectedTask = {id: 'task-1', conversationId: 'conversation-1', profile: 'bunny', runId: 'run-1', status: 'running', question: null};

void test('each task status projects the claims the design names on the task\'s turn, and only an open clarification or approval is attention', () => {
  const project = (patch: Partial<ProjectedTask>): Projection | undefined => projectionOf({...base, ...patch});
  assert.equal(project({runId: null, status: 'paused'}), undefined, 'a task before its first run reports nothing');
  assert.deepEqual(project({}), {turn: 'task-1', work: 'active', question: null, result: null});
  assert.deepEqual(project({runId: 'run-2'}), project({}), 'a new run is the same turn');
  const clarification = {id: 'task-1-q1', kind: 'clarification' as const, answer: null};
  assert.deepEqual(project({status: 'waiting', question: clarification}), {turn: 'task-1', work: 'idle', question: {id: 'task-1-q1', kind: 'input'}, result: null});
  assert.deepEqual(project({status: 'waiting', question: {...clarification, kind: 'approval'}})?.question?.kind, 'approval');
  assert.equal(project({status: 'waiting', question: {...clarification, kind: 'delegation'}})?.question, null, 'a delegation wait is not owner attention');
  assert.deepEqual(project({status: 'waiting', question: {...clarification, kind: 'delegation'}})?.work, 'idle', 'and makes no running-work claim');
  assert.equal(project({status: 'paused', question: {...clarification, answer: 'yes'}})?.question, null, 'an answered question is no longer attention');
  assert.deepEqual(project({status: 'paused'})?.work, 'interrupted');
  assert.deepEqual(project({status: 'uncertain'})?.work, 'unknown');
  for (const result of ['succeeded', 'failed', 'cancelled'] as const) {
    assert.deepEqual(project({status: result, question: clarification}), {turn: 'task-1', work: 'idle', question: null, result}, result);
  }
  assert.equal(waitsOnOwner({...base, status: 'waiting', question: clarification}), true);
  assert.equal(waitsOnOwner({...base, status: 'paused', question: {...clarification, kind: 'approval'}}), true, 'a paused task with an open approval waits on its owner');
  assert.equal(waitsOnOwner({...base, status: 'waiting', question: {...clarification, kind: 'delegation'}}), false);
  assert.equal(waitsOnOwner({...base, status: 'cancelled', question: clarification}), false);
});

void test('the events of a change resolve, start, ask and stop in order; an answer or a resume stays in the turn, and a change that keeps the projection has none', () => {
  const running: Projection = {turn: 'task-1', work: 'active', question: null, result: null};
  const asked: Projection = {...running, question: {id: 'q1', kind: 'input'}};
  const waiting: Projection = {...asked, work: 'idle'};
  assert.deepEqual(kinds(eventsOf(undefined, running)), ['turn-started']);
  assert.deepEqual(kinds(eventsOf(running, asked)), ['attention-input']);
  assert.deepEqual(kinds(eventsOf(asked, waiting)), ['turn-waiting']);
  assert.deepEqual(eventsOf(waiting, running), [{kind: 'attention-resolved', attention: {status: 'known', id: 'q1'}}, {kind: 'activity-observed'}],
    'the answer resolves its question and the task works again in the same turn, with no new start');
  assert.deepEqual(kinds(eventsOf({...running, work: 'interrupted'}, running)), ['activity-observed'], 'a resume after a pause stays in the turn');
  assert.deepEqual(kinds(eventsOf({...running, work: 'unknown'}, running)), ['activity-observed'], 'as does a resume after an uncertain call');
  assert.deepEqual(eventsOf(waiting, {...waiting, work: 'idle', question: null, result: 'cancelled'}), [{kind: 'turn-ended', result: 'cancelled'}],
    'an ended task\'s turn end clears its question, which is not resolved');
  assert.deepEqual(kinds(eventsOf(running, {...running, work: 'interrupted'})), ['turn-interrupted']);
  assert.deepEqual(kinds(eventsOf(running, {...running, work: 'unknown'})), ['turn-uncertain']);
  assert.deepEqual(kinds(eventsOf(undefined, {...asked, work: 'idle'})), ['turn-started', 'attention-input', 'turn-waiting'], 'a first report states the whole task');
  assert.deepEqual(kinds(eventsOf({...running, turn: 'task-0', result: 'succeeded', work: 'idle'}, running)), ['turn-started'], 'another task starts a new turn');
  assert.deepEqual(eventsOf(waiting, waiting), []);
});

void test('a commit that ends task A and starts task B in one conversation reports A\'s turn end before B\'s turn start', () => {
  const a: ProjectedTask = {...base, id: 'task-a', status: 'waiting', question: {id: 'task-a-q1', kind: 'approval', answer: null}};
  const b: ProjectedTask = {...base, id: 'task-b'};
  const reported = {sequence: 3, projection: projectionOf(a)};
  const both = changesOf(reported, {...a, status: 'cancelled'}, b);
  assert.deepEqual(both?.events, [
    {turn: 'task-a', event: {kind: 'turn-ended', result: 'cancelled'}},
    {turn: 'task-b', event: {kind: 'turn-started'}},
  ]);
  assert.deepEqual(both?.projection, projectionOf(b));
  const ended = {sequence: 4, projection: projectionOf({...a, status: 'succeeded'})};
  assert.deepEqual(changesOf(ended, {...a, status: 'succeeded'}, b)?.events, [{turn: 'task-b', event: {kind: 'turn-started'}}], 'an end already reported is not repeated');
  assert.deepEqual(changesOf(ended, undefined, b)?.events, [{turn: 'task-b', event: {kind: 'turn-started'}}], 'nor is a turn whose task is gone');
  assert.equal(changesOf({sequence: 2, projection: projectionOf(b)}, undefined, b), undefined, 'an unchanged task reports nothing');
  assert.deepEqual(changesOf({sequence: 0, projection: undefined}, undefined, a)?.events.map(({event}) => event.kind), ['turn-started', 'attention-approval', 'turn-waiting'],
    'a conversation with no reported projection states its task whole');
});

void test('every observation is a valid lifecycle/2.4 message of the conversation\'s session with the conversation\'s ordering, the persona title and its companion', () => {
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    const task = {id: `task-${profile}`, conversationId: `conversation-${profile}`, profile};
    const events = eventsOf(undefined, {turn: task.id, work: 'idle', question: {id: 'q1', kind: 'approval'}, result: null});
    for (const [index, event] of events.entries()) {
      const observation = observationOf(task, {turn: task.id, event}, index + 1, 1_790_000_000_000);
      const {key, draft} = observationDraft(observation);
      assert.equal(key, `bunny.event.lifecycle.${sessionEntityId(observation.identity)}`);
      assert.deepEqual(observation.identity, {...NATIVE, sessionId: task.conversationId});
      assert.deepEqual(observation.turn, {status: 'known', id: task.id});
      assert.deepEqual(observation.ordering, {status: 'known', authority: 'companions', epoch: task.conversationId, sequence: index + 1});
      assert.deepEqual(observation.parent, {status: 'top-level'});
      const persona = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'}[profile];
      assert.deepEqual(observation.title, {value: persona, source: 'provider'});
      assert.deepEqual(observation.companions, [{id: profile, name: persona}], 'the conversation\'s companion, by its profile ID and persona name (Hub #2054)');
      assert.equal(draft.dataschema, 'https://bunny.invalid/events/lifecycle/2.4');
      const message = {specversion: '1.0', bunnyprofile: '2.0', id: `observation-${String(index)}`, source: 'bunny/modules/companions', time: new Date(1_790_000_000_000).toISOString(),
        datacontenttype: 'application/json', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...draft};
      const result = coreValidator().validate(message);
      assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.error));
    }
  }
  const resumed = observationDraft(observationOf({conversationId: 'conversation-1', profile: 'bunny'}, {turn: 'task-1', event: {kind: 'activity-observed'}}, 9, 1_790_000_000_000));
  const result = coreValidator().validate({specversion: '1.0', bunnyprofile: '2.0', id: 'observation-resume', source: 'bunny/modules/companions', time: new Date(1_790_000_000_000).toISOString(),
    datacontenttype: 'application/json', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...resumed.draft});
  assert.equal(result.ok, true, 'activity-observed is a lifecycle/2.4 input of the native source');
});

void test('a titled conversation keeps its companion apart from the title, and its title metadata never carries the companion', () => {
  const at = 1_790_000_000_000;
  const valid = (draft: ReturnType<typeof observationDraft>['draft']): boolean => coreValidator().validate({specversion: '1.0', bunnyprofile: '2.0', id: 'observation-titled',
    source: 'bunny/modules/companions', time: new Date(at).toISOString(), datacontenttype: 'application/json',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...draft}).ok;
  for (const title of [{value: '#2054 Companion metadata', source: 'provider'}, {value: 'Renamed by the owner', source: 'user'}] as const) {
    const observation = observationOf({conversationId: 'conversation-reachy', profile: 'reachy'}, {turn: 'task-1', event: {kind: 'turn-started'}}, 1, at, title);
    assert.deepEqual(observation.title, title, 'the title is the conversation\'s own, with no companion name added');
    assert.deepEqual(observation.companions, [{id: 'reachy', name: 'Reachy'}], 'a generated title or a rename leaves the companion as it is');
    assert.equal(valid(observationDraft(observation).draft), true);
    const metadata = observationDraft(titleObservationOf('conversation-reachy', title, at));
    assert.equal(metadata.draft.dataschema, 'https://bunny.invalid/events/lifecycle/2.3', 'title metadata keeps its lowest version');
    assert.equal(metadata.draft.data.companions, undefined, 'a title carries no companion');
    assert.equal(valid(metadata.draft), true);
  }
});

void test('a baseline that cannot be written leaves no table, so the next start writes it whole', () => {
  const database = new DatabaseSync(':memory:');
  const store = new AssistantStore(database);
  store.save(store.newTask('bunny', 'synthetic prompt'));
  database.exec("DROP TABLE assistant_reports; UPDATE assistant_tasks SET record='not json'");
  assert.throws(() => new AssistantStore(database), SyntaxError);
  assert.equal(database.isTransaction, false, 'the savepoint is gone');
  assert.equal(database.prepare("SELECT 1 FROM sqlite_master WHERE name='assistant_reports'").get(), undefined, 'and so is the table');
  database.close();
});

void test('the release that reports conversations records each conversation\'s latest task as reported, unless it waits on its owner', () => {
  const database = new DatabaseSync(':memory:');
  const store = new AssistantStore(database);
  const older = Object.assign(store.newTask('bunny', 'synthetic prompt'), {status: 'succeeded', runId: 'run-0'});
  store.save(older);
  const ended = Object.assign(store.newTask('bunny', 'synthetic prompt'), {status: 'failed', runId: 'run-1'});
  store.save(ended);
  const waiting = Object.assign(store.newTask('reachy', 'synthetic prompt'), {status: 'waiting', runId: 'run-2'});
  waiting.question = {id: `${waiting.id}-q1`, text: 'Synthetic question?', answer: null, kind: 'clarification', call: 'call-1', proposal: null};
  store.save(waiting);
  const delegated = Object.assign(store.newTask('microduck', 'synthetic prompt'), {status: 'waiting', runId: 'run-3'});
  delegated.question = {id: `${delegated.id}-q1`, text: 'Synthetic brief', answer: null, kind: 'delegation', call: 'call-2', proposal: null};
  store.save(delegated);
  database.exec('DROP TABLE assistant_reports');
  const reopened = new AssistantStore(database);
  assert.equal(ended.conversationId, older.conversationId, 'one conversation per profile');
  assert.deepEqual(reopened.report(ended.conversationId), {sequence: 0, projection: projectionOf(ended)}, 'an ended task is silent');
  assert.deepEqual(reopened.report(waiting.conversationId), {sequence: 0, projection: undefined}, 'a task waiting on its owner is reported at its next commit');
  assert.deepEqual(reopened.report(delegated.conversationId), {sequence: 0, projection: projectionOf(delegated)}, 'a delegation wait is silent');
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM assistant_reports').get() as {count: number}).count, 3, 'one row per conversation');
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

/** A title provider that writes no title, so every conversation keeps its persona title in these tests (titles: Hub #2025). */
const untitled = {name: 'synthetic' as const, model: 'synthetic', title: () => Promise.resolve({text: null, usage: null})};

/**
 * The module under the harness on a bus, with every lifecycle observation the bus carries collected in order; a title's
 * display metadata, which no turn carries, is collected apart.
 */
async function world(context: TestContext, options: CompanionsOptions) {
  options = {titleProvider: untitled, syntheticTitleProvider: untitled, ...options};
  let now = 1_790_000_000_000;
  const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-sessions-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const seen: Message<LifecycleObservation>[] = [], titles: Message<LifecycleObservation>[] = [], waiters: {count: number; resolve: () => void}[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {
    if (message.data.event.kind === 'metadata-observed') {titles.push(message); return;}
    seen.push(message);
    for (const waiter of waiters.filter(item => seen.length >= item.count)) waiter.resolve();
  });
  const make = () => {const module = createCompanionsModule(options); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, spans: new RecordedSpans(), section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {
    core, seen, titles, module: () => module, tick: (ms: number) => {now += ms;},
    /** Resolves once the bus has carried `count` observations in all. */
    observed: (count: number) => seen.length >= count ? Promise.resolve() : new Promise<void>(resolve => {waiters.push({count, resolve});}),
    /** Stops the module, lets `between` change its database file as an earlier release or a crash left it, and starts it again. */
    restart: async (between?: (file: string) => void) => {await host.stop(); between?.(join(dir, 'companions.sqlite')); ({module, host} = make()); await host.start();},
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

/** The observations since `from`, each as its kind, its question placeholder `q<n>` and its result. */
const kindsSince = (w: World, from = 0): string[] => w.seen.slice(from).map(({data}) =>
  `${data.event.kind}${'attention' in data.event && data.event.attention.status === 'known' ? ` q${data.event.attention.id.replace(/.*-q/, '')}` : ''}${'result' in data.event ? ` ${data.event.result}` : ''}`);

// Each test's timeout fails a missing report at the runner's bound instead of waiting forever.
void test('a conversation is one session across its tasks: each task one turn, an answered question in it, one ordering sequence', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Which synthetic detail?'), reply('Synthetic answer.'), reply('Second synthetic answer.')])});
  await control(w, 'enable');
  assert.equal(w.seen.length, 0, 'enabling the conversation is not work');
  await input(w, 'synthetic request');
  await w.observed(3);
  const state = w.module().inspectAssistant()?.tasks[0];
  assert.ok(state !== undefined && state.runId !== null && state.questionId !== null);
  const [first, question, run] = [state.taskId, state.questionId, state.runId];
  await input(w, 'synthetic answer', true);
  await w.observed(6);
  assert.notEqual(w.module().inspectAssistant()?.tasks[0]?.runId, run, 'the answer activates a new run');
  await input(w, 'second synthetic request');
  await w.observed(8);
  const second = w.module().inspectAssistant()?.tasks[0]?.taskId;
  assert.ok(second !== undefined && second !== first);
  assert.deepEqual(summary(w), [`turn-started on ${first} #1`, `attention-input ${question} on ${first} #2`, `turn-waiting on ${first} #3`,
    `attention-resolved ${question} on ${first} #4`, `activity-observed on ${first} #5`, `turn-ended succeeded on ${first} #6`,
    `turn-started on ${second} #7`, `turn-ended succeeded on ${second} #8`], 'the answer and its new run stay in the first turn; the second task is the next turn');
  for (const message of w.seen) {
    assert.equal(message.source, 'bunny/modules/companions');
    assert.equal(message.dataschema, 'https://bunny.invalid/events/lifecycle/2.4');
    assert.deepEqual(message.data.companions, [{id: 'bunny', name: 'B.U.N.N.Y.'}]);
    assert.deepEqual(message.data.identity, {...NATIVE, sessionId: state.conversationId});
    assert.deepEqual(message.data.ordering, {status: 'known', authority: 'companions', epoch: state.conversationId, sequence: Number(message.data.nativeEventId)});
    assert.equal(message.data.title?.value, 'B.U.N.N.Y.');
  }
  // Reads and a restart with a finished task report nothing more.
  await w.module().manifest.content?.('conversation', {query: {profile: 'bunny'}, signal: new AbortController().signal});
  await w.restart();
  await control(w, 'enable');
  assert.equal(w.seen.length, 8);
  assert.deepEqual(w.store().report(state.conversationId).sequence, 8);
});

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
  assert.deepEqual(summary(w).slice(3), [`turn-ended cancelled on ${String(taskId)} #4`]);
});

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
  assert.deepEqual(kindsSince(w), ['turn-started', 'turn-uncertain']);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'uncertain');
});

void test('each profile\'s conversation is its own session, titled by its persona', {timeout: 20_000}, async context => {
  // Reachy gets the synthetic provider here, which asks its fixed question first; the owner cancels it, and a B.U.N.N.Y. task runs.
  const w = await world(context, {provider: scripted([]), profileProviders: {reachy: new SyntheticProvider()}});
  await control(w, 'enable');
  await input(w, 'synthetic reachy request', false, 'reachy');
  await w.observed(3);
  await control(w, 'cancel', w.module().inspectAssistant()?.tasks.find(task => task.profile === 'reachy')?.taskId);
  await w.observed(4);
  await input(w, 'synthetic bunny request');
  await w.observed(6);
  const tasks = w.module().inspectAssistant()?.tasks ?? [];
  const reachy = tasks.find(task => task.profile === 'reachy')?.conversationId, bunny = tasks.find(task => task.profile === 'bunny')?.conversationId;
  assert.ok(reachy !== undefined && bunny !== undefined && reachy !== bunny);
  assert.deepEqual(w.seen.map(({data}) => [data.identity.sessionId, data.title?.value, data.event.kind, data.ordering.status === 'known' ? data.ordering.sequence : null]), [
    [reachy, 'Reachy', 'turn-started', 1], [reachy, 'Reachy', 'attention-input', 2], [reachy, 'Reachy', 'turn-waiting', 3], [reachy, 'Reachy', 'turn-ended', 4],
    [bunny, 'B.U.N.N.Y.', 'turn-started', 1], [bunny, 'B.U.N.N.Y.', 'turn-ended', 2],
  ], 'each conversation counts its own sequence');
  assert.deepEqual(w.seen.map(({data}) => data.companions?.map(companion => companion.id).join(',')), ['reachy', 'reachy', 'reachy', 'reachy', 'bunny', 'bunny'],
    'each conversation names its own companion');
});

/** Saves the first task as a crash left it: running, with its question answered, and optionally without the report table. */
function crashedRunning(file: string, upgrade: boolean): void {
  const database = new DatabaseSync(file);
  const row = database.prepare('SELECT id, record FROM assistant_tasks ORDER BY seq LIMIT 1').get() as {id: string; record: string};
  const saved = JSON.parse(row.record) as {status: string; question: {answer: string | null} | null};
  saved.status = 'running';
  if (saved.question !== null) saved.question.answer = 'synthetic answer';
  database.prepare('UPDATE assistant_tasks SET status=?, record=? WHERE id=?').run('running', JSON.stringify(saved), row.id);
  if (upgrade) database.exec('DROP TABLE assistant_reports');
  database.close();
}

void test('a task the startup recovers as paused reports its answered question and its interrupted run, and its resume stays in its turn', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Synthetic question?'), reply('Synthetic answer.')])});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(3);
  await w.restart(file => {crashedRunning(file, false);});
  await w.observed(5);
  const task = w.module().inspectAssistant()?.tasks[0] ?? assert.fail('a task');
  assert.equal(task.status, 'paused');
  assert.deepEqual(kindsSince(w, 3), ['attention-resolved q1', 'turn-interrupted']);
  await control(w, 'resume', task.taskId);
  await w.observed(7);
  assert.deepEqual(summary(w).slice(5), [`activity-observed on ${task.taskId} #6`, `turn-ended succeeded on ${task.taskId} #7`], 'the resumed run is the same turn, with no new start');
});

void test('a task running when this release first starts reports only its recovered state, from the baseline', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Synthetic question?')])});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(3);
  const before = w.seen.length;
  await w.restart(file => {crashedRunning(file, true);});
  await w.observed(before + 1);
  const conversationId = w.module().inspectAssistant()?.tasks[0]?.conversationId ?? assert.fail('a task');
  assert.deepEqual(w.seen.slice(before).map(({data}) => [data.event.kind, data.ordering.status === 'known' ? data.ordering.sequence : null]), [['turn-interrupted', 1]],
    'the baseline is the running task, so its first report is how the start recovered it');
  assert.equal(w.store().report(conversationId).sequence, 1);
});

void test('a task waiting on its owner when this release first starts is reported at once, whole, and an ended one stays silent', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([reply('Synthetic answer.')]), profileProviders: {reachy: new SyntheticProvider()}});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(2);
  // Reachy gets the synthetic provider here, which asks its fixed question, so its task waits on the owner.
  await input(w, 'synthetic reachy request', false, 'reachy');
  await w.observed(5);
  const before = w.seen.length;
  await w.restart(file => {const database = new DatabaseSync(file); database.exec('DROP TABLE assistant_reports'); database.close();});
  await w.observed(before + 3);
  const waiting = w.module().inspectAssistant()?.tasks.find(task => task.profile === 'reachy') ?? assert.fail('a waiting task');
  assert.equal(waiting.status, 'waiting');
  assert.deepEqual(summary(w).slice(before), [`turn-started on ${waiting.taskId} #1`, `attention-input ${String(waiting.questionId)} on ${waiting.taskId} #2`, `turn-waiting on ${waiting.taskId} #3`],
    'the waiting task appears on the devices as needing its owner');
  assert.ok(w.seen.slice(before).every(({data}) => data.identity.sessionId === waiting.conversationId), 'the ended B.U.N.N.Y. task reports nothing');
  await w.restart();
  assert.equal(w.seen.length, before + 3, 'the next start reports nothing again');
});

void test('a task running with a saved, unanswered question when this release first starts is reported whole, as needing its owner', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted([ask('Synthetic question?')])});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(3);
  const before = w.seen.length;
  // A crash after the question was saved and before the run stopped: running, the question unanswered, no report table yet.
  await w.restart(file => {
    const database = new DatabaseSync(file);
    const row = database.prepare('SELECT id, record FROM assistant_tasks ORDER BY seq LIMIT 1').get() as {id: string; record: string};
    database.prepare('UPDATE assistant_tasks SET status=?, record=? WHERE id=?').run('running', JSON.stringify({...JSON.parse(row.record) as object, status: 'running'}), row.id);
    database.exec('DROP TABLE assistant_reports');
    database.close();
  });
  await w.observed(before + 3);
  const task = w.module().inspectAssistant()?.tasks[0] ?? assert.fail('a task');
  assert.equal(task.status, 'waiting', 'the startup recovers it waiting on its question');
  assert.deepEqual(summary(w).slice(before), [`turn-started on ${task.taskId} #1`, `attention-input ${String(task.questionId)} on ${task.taskId} #2`, `turn-waiting on ${task.taskId} #3`]);
});

void test('a task waiting on delegated work raises no attention and makes no running-work claim', {timeout: 20_000}, async context => {
  const delegate = (call: {requestId: string}) => Promise.resolve({status: 'accepted' as const, requestId: call.requestId, reply: {} as never});
  const w = await world(context, {provider: scripted([{text: null, calls: [{id: 'call-delegate', name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Add a synthetic test.'}}], stop: 'tool', units: 10}]),
    tools: ['delegate_coding'], coding: () => ({available: true, endpointId: 'synthetic-worker', revision: 1}), delegate});
  await control(w, 'enable');
  await input(w, 'synthetic delegation');
  await w.observed(3);
  await input(w, 'approve', true);
  await w.observed(6);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'waiting');
  assert.deepEqual(kindsSince(w), ['turn-started', 'attention-approval q1', 'turn-waiting', 'attention-resolved q1', 'activity-observed', 'turn-waiting'],
    'the approval is attention; the wait on the worker is not');
});

void test('a task change that rolls back reports nothing: a question past the limit fails the task with only its end', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: scripted(Array.from({length: LIMITS.questions + 1}, (_, index) => ask(`Question ${String(index + 1)}?`)))});
  await control(w, 'enable');
  await input(w, 'synthetic request');
  await w.observed(3);
  // Each answer resolves one question, observes the work and raises the next: four observations.
  for (let answered = 1; answered < LIMITS.questions; answered += 1) {
    await input(w, `answer ${String(answered)}`, true);
    await w.observed(3 + 4 * answered);
  }
  const before = w.seen.length;
  await input(w, 'last answer', true);
  await w.observed(before + 3);
  assert.equal(w.module().inspectAssistant()?.tasks[0]?.status, 'failed');
  const kinds = kindsSince(w);
  assert.deepEqual(kinds.slice(before), [`attention-resolved q${String(LIMITS.questions)}`, 'activity-observed', 'turn-ended failed'], 'the refused question left no raise');
  assert.equal(kinds.filter(kind => kind.startsWith('attention-input')).length, LIMITS.questions);
  assert.equal(kinds.filter(kind => kind === 'turn-started').length, 1, 'the task is one turn');
});
