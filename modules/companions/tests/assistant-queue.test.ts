// The conversation message queue (Hub #2030): Queue saves the owner's message for after the current task, and each
// queued message starts as a new task and turn when the task before it ends, unless the queue is held. Stop and a
// restart hold it. These tests use gated fake providers, the harness's manual clock and scheduler and a fixed zone; they
// wait by yielding event-loop turns, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {test, type TestContext} from 'node:test';
import type {AssistantProfile, AssistantState, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {QUEUE_FULL} from '../src/assistant/engine.js';
import type {QueueDocument} from '../src/assistant/queue.js';
import type {TitleProvider} from '../src/assistant/titles.js';
import type {ModelProvider, TurnInput, TurnReply} from '../src/assistant/provider.js';

const ZONE = 'America/Chicago';
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const ask = (text: string): TurnReply => ({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text}}], stop: 'tool', units: 10});
const propose = (mode: string): TurnReply => ({text: null, calls: [{id: 'call-mode', name: 'set_mode', input: {mode}}], stop: 'tool', units: 10});
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
/** Yields event-loop turns so that anything the engine would start has started. */
async function quiet(): Promise<void> {for (let turn = 0; turn < 200; turn += 1) await new Promise(resolve => {setImmediate(resolve);});}
type Pending = {input: TurnInput; signal: AbortSignal; resolve: (reply: TurnReply) => void; reject: (error: unknown) => void};
function gated(name: ModelProvider['name'] = 'synthetic', model = 'synthetic'): ModelProvider & {pending: Pending[]; calls: () => number; next: () => Pending} {
  const pending: Pending[] = []; let calls = 0;
  return {name, model, pending, calls: () => calls,
    next: () => pending.shift() ?? assert.fail('no model call is waiting'),
    turn: (input, signal) => {calls += 1; return new Promise<TurnReply>((resolve, reject) => {pending.push({input, signal, resolve, reject});});}};
}
const ownerText = (input: TurnInput): string | undefined => {const first = input.transcript[0]; return first?.role === 'owner' ? first.text : undefined;};
const QUEUE_ACTIONS = ['withdraw', 'reorder', 'resume-queue'];

async function world(context: TestContext, options: CompanionsOptions = {}) {
  const now = Date.parse('2026-11-24T18:00:00Z');
  const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-queue-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const observations: LifecycleObservation[] = [], states: {dataschema: string; data: AssistantState}[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {observations.push(message.data);});
  await core.subscribe<AssistantState>('bunny.state.assistant-state.assistant', message => {states.push({dataschema: message.dataschema, data: message.data});});
  const make = () => {const module = createCompanionsModule({timeZone: ZONE, tools: ['set_mode'], core: () => ({sessions: [], mode: {id: 'hub', revision: 7, mode: 'work', selectedAtMs: 0}, synced: true}),
    dispatch: data => Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {} as never}), ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile = 'bunny'): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const control = (action: string, extra: Record<string, unknown> = {}, revision = state().revision): Promise<RequestResult> => {
    const requestId = randomUUID();
    const version = QUEUE_ACTIONS.includes(action) ? '2.2' : action === 'rename' ? '2.1' : '2.0';
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-control/${version}`, data: {requestId, action, expectedRevision: revision, ...extra}}, {requestId, timeoutMs: 5000});
  };
  /** Stages one input and returns the command data, so a test can send the same command again. */
  const staged = async (input: Record<string, unknown>, requestId = randomUUID()): Promise<{requestId: string; inputRef: string}> => {
    const result = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({expectedRevision: state().revision, ...input}))});
    assert.ok(result !== undefined && !('error' in result), JSON.stringify(result));
    return {requestId, ...(result.data as {inputRef: string})};
  };
  const input = (data: {requestId: string; inputRef: string}): Promise<RequestResult> => core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data}, {requestId: data.requestId, timeoutMs: 5000});
  const send = async (text: string, profile: AssistantProfile = 'bunny', answer = false): Promise<RequestResult> => {
    const current = task(profile);
    return input(await staged({action: answer ? 'answer' : 'start', profile, text, ...(answer ? {taskId: current?.taskId, questionId: current?.questionId} : {})}));
  };
  const queue = async (text: string, profile: AssistantProfile = 'bunny'): Promise<{id: string; result: RequestResult}> => {
    const data = await staged({action: 'queue', profile, text});
    return {id: data.requestId, result: await input(data)};
  };
  const edit = async (queuedId: string, text: string, profile: AssistantProfile = 'bunny'): Promise<RequestResult> => input(await staged({action: 'edit-queued', profile, text, queuedId}));
  const read = async <T>(ref: string, query: Record<string, string>): Promise<T> => {
    const content = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(content !== undefined && !('error' in content), JSON.stringify(content));
    return JSON.parse(Buffer.from(content.bytes).toString()) as T;
  };
  const queued = (profile: AssistantProfile = 'bunny') => read<QueueDocument>('conversation', {profile, view: 'queue'});
  const messages = async (profile: AssistantProfile = 'bunny') => (await read<{messages: {taskId: string; role: string; text: string}[]}>('conversation', {profile})).messages;
  return {state, task, control, staged, input, send, queue, edit, queued, messages, observations, states,
    database: () => host.moduleDatabase() ?? assert.fail('open database'),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
const code = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.code : undefined;
const texts = (document: QueueDocument): string[] => document.messages.map(message => message.text);
const tasks = (database: ReturnType<Awaited<ReturnType<typeof world>>['database']>): {id: string; prompt: string; status: string}[] =>
  (database.prepare('SELECT record FROM assistant_tasks ORDER BY seq').all() as {record: string}[]).map(row => JSON.parse(row.record) as {id: string; prompt: string; status: string});

void test('Queue saves messages while a task runs, and each starts as a new task and turn when the one before it ends', async context => {
  const provider = gated(), w = await world(context, {provider});
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal((await w.send('Synthetic first request')).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  const first = w.task()?.taskId;
  // The composer stays available: Send is refused while the task runs, as before, and Queue saves the message.
  assert.equal(code(await w.send('Synthetic refused send')), 'capacity');
  const second = await w.queue('Synthetic second request'), third = await w.queue('Synthetic third request');
  assert.deepEqual([second.result.status, third.result.status], ['accepted', 'accepted']);
  assert.deepEqual(texts(await w.queued()), ['Synthetic second request', 'Synthetic third request']);
  assert.deepEqual(w.state().queues, [{conversationId: w.task()?.conversationId, profile: 'bunny', messages: 2, held: null, code: null}]);
  assert.equal(w.states.at(-1)?.dataschema, 'https://bunny.invalid/events/assistant-state/2.2');
  assert.equal(w.task()?.status, 'running', 'queuing never touches the running task');
  assert.equal(provider.calls(), 1);
  // The queued messages are not part of the conversation until they start.
  assert.deepEqual((await w.messages()).map(message => message.text), ['Synthetic first request']);
  provider.next().resolve(reply('Synthetic first answer'));
  await settle(() => provider.pending.length === 1 && w.task()?.taskId !== first, 'the next queued message started');
  const started = provider.pending[0]?.input ?? assert.fail('the second task\'s call');
  assert.deepEqual(started.transcript, [{role: 'owner', text: 'Synthetic second request'}], 'a new task with its own turn');
  assert.match(JSON.stringify(started.context), /Synthetic first answer/, 'its context holds the finished task before it');
  assert.equal(w.task()?.status, 'running');
  assert.deepEqual(texts(await w.queued()), ['Synthetic third request']);
  provider.next().resolve(reply('Synthetic second answer'));
  await settle(() => provider.pending.length === 1 && ownerText(provider.pending[0]?.input ?? assert.fail()) === 'Synthetic third request');
  provider.next().resolve(reply('Synthetic third answer'));
  await settle(() => w.task()?.status === 'succeeded' && w.task()?.taskId !== first);
  assert.deepEqual((await w.messages()).map(message => message.text), ['Synthetic first request', 'Synthetic first answer', 'Synthetic second request',
    'Synthetic second answer', 'Synthetic third request', 'Synthetic third answer']);
  assert.deepEqual(texts(await w.queued()), []);
  assert.equal(w.state().queues, undefined, 'an empty queue leaves the state at its earlier version');
  assert.equal(w.states.at(-1)?.dataschema, 'https://bunny.invalid/events/assistant-state/2.0');
  assert.deepEqual(tasks(w.database()).map(entry => entry.prompt), ['Synthetic first request', 'Synthetic second request', 'Synthetic third request']);
  for (const published of w.states) assert.equal(coreValidator().validate({specversion: '1.0', bunnyprofile: '2.0', id: 'state-1', source: 'bunny/modules/companions',
    type: 'org.bunny.assistant-state.updated', subject: 'assistant', time: '2026-11-24T18:00:00.000Z', kind: 'state', datacontenttype: 'application/json',
    dataschema: published.dataschema, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: published.data}, {nowMs: Date.parse('2026-11-24T18:00:00Z')}).ok, true);
});

void test('a queue with nothing to wait behind starts its message at once', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  const {result} = await w.queue('Synthetic queued while idle');
  assert.equal(result.status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic queued while idle');
  assert.deepEqual(texts(await w.queued()), []);
});

void test('queued messages can be edited, withdrawn and reordered, each checked against the queue\'s own revision', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic running request');
  await settle(() => provider.pending.length === 1);
  const a = await w.queue('Synthetic message A'), b = await w.queue('Synthetic message B'), c = await w.queue('Synthetic message C');
  const before = w.state().revision;
  assert.equal((await w.edit(b.id, 'Synthetic message B, edited')).status, 'accepted');
  assert.equal((await w.control('reorder', {profile: 'bunny', queuedId: c.id, beforeId: a.id})).status, 'accepted');
  assert.deepEqual(texts(await w.queued()), ['Synthetic message C', 'Synthetic message A', 'Synthetic message B, edited']);
  assert.equal((await w.control('reorder', {profile: 'bunny', queuedId: c.id, beforeId: null})).status, 'accepted', 'null moves it to the end');
  assert.deepEqual(texts(await w.queued()), ['Synthetic message A', 'Synthetic message B, edited', 'Synthetic message C']);
  assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: a.id})).status, 'accepted');
  assert.deepEqual(texts(await w.queued()), ['Synthetic message B, edited', 'Synthetic message C']);
  // A command naming a revision from before those changes is stale: the queue changed since.
  assert.equal(code(await w.control('withdraw', {profile: 'bunny', queuedId: b.id}, before)), 'revision-conflict');
  assert.equal(code(await w.control('withdraw', {profile: 'bunny', queuedId: a.id})), 'not-found', 'a withdrawn message is gone');
  assert.equal(code(await w.control('reorder', {profile: 'bunny', queuedId: b.id, beforeId: b.id})), 'invalid-request');
  assert.equal(code(await w.control('reorder', {profile: 'reachy', queuedId: b.id, beforeId: null})), 'not-found', 'another conversation\'s queue does not hold it');
  assert.equal(code(await w.edit('unknown-queued-message', 'Synthetic edit')), 'not-found');
  assert.equal(code(await w.control('resume-queue', {profile: 'bunny'})), 'invalid-state', 'a queue that is not held has nothing to resume');
  // The running task's own steps never make a queue command stale; the same revision refuses a conversation command.
  const revision = w.state().revision;
  provider.next().resolve(ask('Synthetic question?'));
  await settle(() => w.task()?.status === 'waiting');
  assert.ok(w.state().revision > revision);
  assert.equal((await w.control('reorder', {profile: 'bunny', queuedId: c.id, beforeId: b.id}, revision)).status, 'accepted');
  assert.equal(code(await w.control('cancel', {taskId: w.task()?.taskId}, revision)), 'revision-conflict', 'negative control: the conversation changed after that revision');
  assert.deepEqual(texts(await w.queued()), ['Synthetic message C', 'Synthetic message B, edited']);
});

void test('a queued message waits while the task waits on an answer or an approval, and starts only when the task ends', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that asks');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Synthetic clarification?'));
  await settle(() => w.task()?.status === 'waiting');
  const first = w.task()?.taskId;
  await w.queue('Synthetic queued during a question');
  await quiet();
  assert.equal(w.task()?.taskId, first, 'the waiting task stays the conversation\'s task');
  assert.equal(provider.calls(), 1);
  assert.equal((await w.send('Synthetic answer', 'bunny', true)).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(propose('free'));
  await settle(() => w.task()?.status === 'waiting' && w.task()?.questionId?.endsWith('-q2') === true, 'the task waits on an approval');
  await quiet();
  assert.equal(provider.calls(), 2, 'nothing started during the approval');
  assert.deepEqual(texts(await w.queued()), ['Synthetic queued during a question']);
  assert.equal((await w.send('approve', 'bunny', true)).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal(w.task()?.taskId, first, 'the approved task continues before the queued message');
  provider.next().resolve(reply('Synthetic done after approval'));
  await settle(() => provider.pending.length === 1 && w.task()?.taskId !== first);
  assert.equal(ownerText(provider.next().input), 'Synthetic queued during a question');
});

void test('Stop ends the task and holds the queue until Resume queue', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request to stop');
  await settle(() => provider.pending.length === 1);
  await w.queue('Synthetic queued behind a stop');
  assert.equal((await w.control('cancel', {taskId: w.task()?.taskId})).status, 'accepted');
  await settle(() => w.task()?.status === 'cancelled');
  await quiet();
  assert.equal(provider.calls(), 1, 'nothing starts after Stop');
  assert.deepEqual((await w.queued()).held, {reason: 'stop', code: null, detail: null});
  assert.deepEqual(w.state().queues?.map(entry => entry.held), ['stop']);
  // The owner can still send directly, and the queue stays held behind that task too.
  await w.queue('Synthetic second queued');
  assert.equal((await w.send('Synthetic direct send')).status, 'accepted');
  await settle(() => provider.pending.length === 2);
  provider.pending.shift();
  provider.next().resolve(reply('Synthetic direct answer'));
  await settle(() => w.task()?.status === 'succeeded');
  await quiet();
  assert.equal(provider.calls(), 2);
  assert.deepEqual(texts(await w.queued()), ['Synthetic queued behind a stop', 'Synthetic second queued']);
  assert.equal((await w.control('resume-queue', {profile: 'bunny'})).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic queued behind a stop');
  assert.equal((await w.queued()).held, null);
});

void test('Stop with an empty queue holds nothing, and a withdrawn last message releases a held queue', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request');
  await settle(() => provider.pending.length === 1);
  await w.control('cancel', {taskId: w.task()?.taskId});
  await settle(() => w.task()?.status === 'cancelled');
  assert.equal((await w.queued()).held, null);
  await quiet();
  assert.equal((await w.send('Synthetic next request')).status, 'accepted');
  await settle(() => provider.pending.length === 2);
  provider.pending.shift();
  const only = await w.queue('Synthetic lone queued message');
  await w.control('cancel', {taskId: w.task()?.taskId});
  await settle(() => w.task()?.status === 'cancelled');
  assert.equal((await w.queued()).held?.reason, 'stop');
  assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: only.id})).status, 'accepted');
  assert.deepEqual(await w.queued(), {version: 1, profile: 'bunny', conversationId: w.task()?.conversationId, held: null, messages: []});
});

void test('after a restart a waiting queue stays held until Start, and nothing runs at the start', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request across restart');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Synthetic question across restart?'));
  await settle(() => w.task()?.status === 'waiting');
  const queuedMessage = await w.queue('Synthetic queued across restart');
  const before = w.state().revision, calls = provider.calls();
  await w.restart();
  await quiet();
  assert.equal(provider.calls(), calls, 'a start starts no work');
  assert.equal(w.task()?.status, 'waiting');
  assert.deepEqual((await w.queued()).held, {reason: 'restart', code: null, detail: null});
  assert.deepEqual(texts(await w.queued()), ['Synthetic queued across restart'], 'a queued message survives the restart');
  assert.equal(code(await w.control('withdraw', {profile: 'bunny', queuedId: queuedMessage.id}, before)), 'revision-conflict', 'a revision from before the start is stale');
  // The waiting task is answered and finishes; the held queue still waits.
  assert.equal((await w.send('Synthetic answer after restart', 'bunny', true)).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(reply('Synthetic resumed answer'));
  await settle(() => w.task()?.status === 'succeeded');
  await quiet();
  assert.equal(provider.pending.length, 0);
  assert.equal((await w.control('resume-queue', {profile: 'bunny'})).status, 'accepted', 'Start');
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic queued across restart');
  assert.equal(tasks(w.database()).filter(entry => entry.prompt === 'Synthetic queued across restart').length, 1);
});

void test('a queued message starts at most once: a repeated queue command queues nothing more, before or after it starts', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic first');
  await settle(() => provider.pending.length === 1);
  const data = await w.staged({action: 'queue', profile: 'bunny', text: 'Synthetic queued once'});
  assert.equal((await w.input(data)).status, 'accepted');
  assert.equal((await w.input(data)).status, 'accepted', 'the same request is acknowledged again');
  assert.deepEqual(texts(await w.queued()), ['Synthetic queued once']);
  provider.next().resolve(reply('Synthetic first answer'));
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(reply('Synthetic queued answer'));
  await settle(() => w.task()?.status === 'succeeded' && tasks(w.database()).length === 2);
  assert.equal((await w.input(data)).status, 'accepted');
  await quiet();
  assert.deepEqual(texts(await w.queued()), []);
  assert.equal(provider.calls(), 2);
  assert.equal(tasks(w.database()).filter(entry => entry.prompt === 'Synthetic queued once').length, 1);
});

void test('when a task ends and the queued one starts in one commit, the earlier turn ends before the next turn starts', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic reported first');
  await settle(() => provider.pending.length === 1);
  const first = w.task()?.taskId;
  await w.queue('Synthetic reported second');
  provider.next().resolve(reply('Synthetic reported answer'));
  await settle(() => provider.pending.length === 1 && w.task()?.taskId !== first);
  const second = w.task()?.taskId;
  await settle(() => w.observations.some(observation => observation.turn.status === 'known' && observation.turn.id === second));
  const events = w.observations.filter(observation => observation.event.kind !== 'metadata-observed')
    .map(observation => [observation.turn.status === 'known' ? observation.turn.id : '?', observation.event.kind, observation.ordering.status === 'known' ? observation.ordering.sequence : -1] as const);
  const ended = events.findIndex(([turn, kind]) => turn === first && kind === 'turn-ended'), opened = events.findIndex(([turn, kind]) => turn === second && kind === 'turn-started');
  assert.ok(ended >= 0 && opened === ended + 1, JSON.stringify(events));
  assert.equal(events[opened]?.[2], (events[ended]?.[2] ?? 0) + 1, 'consecutive ordering sequences');
});

void test('a queued message that would pass the spend limits is refused at start with capacity, stays queued and holds the queue', async context => {
  const prices = {'model-a': {input: 250, output: 1, cacheWrite: 250, cacheRead: 250}};
  const provider = gated('anthropic', 'model-a'), w = await world(context, {prices, provider});
  await w.control('enable');
  await w.send('Synthetic paid request');
  await settle(() => provider.pending.length === 1);
  await w.queue('Synthetic paid queued message');
  // The first call reports enough usage that the day has too little left for another model call.
  provider.next().resolve({...reply('Synthetic paid answer'), usage: {input: 75_000, output: 0, cacheWrite: 0, cacheRead: 0}});
  await settle(() => w.task()?.status === 'succeeded');
  await quiet();
  assert.equal(provider.calls(), 1, 'the refused start sent nothing');
  const document = await w.queued();
  assert.deepEqual(texts(document), ['Synthetic paid queued message'], 'the message stays visible');
  assert.equal(document.held?.reason, 'refused'); assert.equal(document.held?.code, 'capacity');
  assert.match(document.held?.detail ?? '', /daily spend limit of \$20\.00 leaves too little/);
  assert.deepEqual(w.state().queues?.map(entry => [entry.held, entry.code]), [['refused', 'capacity']]);
  // Resume queue tries the start again; the limit refuses the command, and the queue stays held.
  const refused = await w.control('resume-queue', {profile: 'bunny'});
  assert.equal(code(refused), 'capacity');
  assert.match(refused.status === 'rejected' ? refused.error.error.detail ?? '' : '', /daily spend limit/);
  assert.equal((await w.queued()).held?.reason, 'refused');
  assert.equal(provider.calls(), 1);
});

void test('a queued start runs no title check of its own; the finished task before it does', async context => {
  const prompts: string[] = [];
  // A placeholder answer is refused, so the conversation stays untitled and a direct Send would check again.
  const titleProvider: TitleProvider = {name: 'synthetic', model: 'synthetic', title: prompt => {prompts.push(prompt); return Promise.resolve({text: 'Title', usage: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}});}};
  const provider = gated(), w = await world(context, {provider, syntheticTitleProvider: titleProvider});
  await w.control('enable');
  await w.send('Synthetic titled request');
  await settle(() => provider.pending.length === 1 && prompts.length === 1);
  await w.queue('Synthetic untitled queued request');
  provider.next().resolve(reply('Synthetic titled answer'));
  await settle(() => provider.pending.length === 1 && prompts.length === 2);
  await quiet();
  const labels = prompts.map(prompt => [...prompt.matchAll(/(The owner sent a message\.|A task finished: [a-z]+\.)/gu)].map(match => match[1]));
  assert.deepEqual(labels, [['The owner sent a message.'], ['A task finished: succeeded.']], 'no message check for the queued start');
  // Negative control: a direct Send in the same untitled conversation does check.
  provider.next().resolve(reply('Synthetic queued answer'));
  await settle(() => w.task()?.status === 'succeeded' && prompts.length === 3);
  await w.send('Synthetic direct request');
  await settle(() => prompts.length === 4);
  assert.match(prompts[3] ?? '', /The owner sent a message\./);
});

void test('New conversation is refused while the queue holds messages, as for an unfinished task, and the queue has a limit', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request');
  await settle(() => provider.pending.length === 1);
  const ids: string[] = [];
  for (let index = 0; index < 8; index += 1) ids.push((await w.queue(`Synthetic queued ${String(index)}`)).id);
  const full = (await w.queue('Synthetic one too many')).result;
  assert.equal(code(full), 'capacity');
  assert.equal(full.status === 'rejected' ? full.error.error.detail : undefined, QUEUE_FULL);
  await w.control('cancel', {taskId: w.task()?.taskId});
  await settle(() => w.task()?.status === 'cancelled');
  // Once the cancelled run has let go of its slot, only the queue keeps the conversation.
  await quiet();
  const fresh = async () => w.input(await w.staged({action: 'new-conversation', profile: 'bunny'}));
  assert.equal(code(await fresh()), 'invalid-state', 'a held queue keeps its conversation');
  for (const id of ids) assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: id})).status, 'accepted');
  assert.equal((await fresh()).status, 'accepted');
});

void test('a failed task still starts the next queued message, which runs once', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that fails');
  await settle(() => provider.pending.length === 1);
  await w.queue('Synthetic message after a failure');
  provider.next().resolve({text: 'Synthetic refusal', calls: [], stop: 'refusal', units: 1});
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic message after a failure');
  assert.deepEqual(tasks(w.database()).map(entry => entry.status), ['failed', 'running']);
});

void test('a process exit after the commit that started a queued message leaves it started once and queued nowhere', () => {
  const dir = join(tmpdir(), `assistant-queue-crash-${randomUUID()}`);
  const child = (mode: string, status = 0) => {
    const run = spawnSync(process.execPath, [new URL('./assistant-queue-child.js', import.meta.url).pathname, dir, mode], {encoding: 'utf8', timeout: 20_000});
    assert.equal(run.status, status, run.stderr);
    return JSON.parse(run.stdout) as {state: AssistantState; calls: number; queued: number; prompts: string[]};
  };
  try {
    const crashed = child('crash', 23);
    assert.deepEqual(crashed.prompts, ['Synthetic process first', 'Synthetic process queued'], 'the queued task was saved when the process ended');
    assert.equal(crashed.queued, 0, 'and its queue entry was gone in the same commit');
    const restarted = child('inspect');
    assert.equal(restarted.calls, 0, 'a start runs nothing');
    assert.equal(restarted.queued, 0);
    assert.deepEqual(restarted.prompts, ['Synthetic process first', 'Synthetic process queued'], 'one task for the queued message');
    assert.equal(restarted.state.tasks[0]?.status, 'paused');
    const resumed = child('resume');
    assert.equal(resumed.calls, 1, 'the queued message\'s task runs once, when the owner resumes it');
    assert.deepEqual(resumed.prompts, ['Synthetic process first', 'Synthetic process queued']);
    assert.equal(resumed.state.tasks[0]?.status, 'succeeded');
  } finally {void rm(dir, {recursive: true, force: true});}
});
