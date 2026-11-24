// Steering a companion's running task (Hub #2031): Send while a task works saves the message at once as a steer, which
// the task's next model call reads after the last call's tool results, in the same turn. A steer forces one more call
// when the model was about to finish; one that arrives after the last call becomes the next queued message. Skip
// question and send and Decline with message settle a question and steer in one step; an approval queues free text; a
// delegation wait keeps the steer for the worker's result (coding-slots.test.ts). Stop returns unread steers to the
// queue, which may then pass its limit. These tests use gated fake providers, the harness's manual clock and scheduler
// and a fixed zone; they wait by yielding event-loop turns, never for time.
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
import type {SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {DECLINED, QUEUE_FULL, SKIPPED, STEERS_FULL} from '../src/assistant/engine.js';
import {LIMITS} from '../src/assistant/limits.js';
import {toMessages} from '../src/assistant/anthropic.js';
import type {QueueDocument} from '../src/assistant/queue.js';
import type {TitleProvider} from '../src/assistant/titles.js';
import {ProviderFault, type ModelProvider, type TranscriptItem, type TurnInput, type TurnReply} from '../src/assistant/provider.js';

const ZONE = 'America/Chicago';
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const ask = (text: string): TurnReply => ({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text}}], stop: 'tool', units: 10});
const propose = (mode: string): TurnReply => ({text: null, calls: [{id: 'call-mode', name: 'set_mode', input: {mode}}], stop: 'tool', units: 10});
const read = (): TurnReply => ({text: 'Synthetic reading the fixture.', calls: [{id: 'call-read', name: 'read_fixture', input: {}}], stop: 'tool', units: 10});
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
/** Yields event-loop turns so that anything the engine would start has started. */
async function quiet(): Promise<void> {for (let turn = 0; turn < 200; turn += 1) await new Promise(resolve => {setImmediate(resolve);});}
type Pending = {input: TurnInput; signal: AbortSignal; resolve: (reply: TurnReply) => void; reject: (error: unknown) => void};
function gated(): ModelProvider & {pending: Pending[]; calls: () => number; next: () => Pending} {
  const pending: Pending[] = []; let calls = 0;
  return {name: 'synthetic', model: 'synthetic', pending, calls: () => calls,
    next: () => pending.shift() ?? assert.fail('no model call is waiting'),
    turn: (input, signal) => {calls += 1; return new Promise<TurnReply>((resolve, reject) => {pending.push({input, signal, resolve, reject});});}};
}
/** A transcript without the engine's own effect keys, as a provider reads it. */
const plain = (transcript: readonly TranscriptItem[]): unknown[] => transcript.map(item => {const {effect: _effect, ...rest} = item as TranscriptItem & {effect?: string}; return rest;});
const ownerText = (input: TurnInput): string | undefined => {const first = input.transcript[0]; return first?.role === 'owner' ? first.text : undefined;};

async function world(context: TestContext, options: CompanionsOptions = {}) {
  const now = Date.parse('2026-11-24T18:00:00Z');
  const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-steer-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const observations: LifecycleObservation[] = [], states: {dataschema: string; data: AssistantState}[] = [], spoken: SpokenReply[] = [], dispatched: string[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {observations.push(message.data);});
  await core.subscribe<AssistantState>('bunny.state.assistant-state.assistant', message => {states.push({dataschema: message.dataschema, data: message.data});});
  const make = () => {const module = createCompanionsModule({timeZone: ZONE, tools: ['set_mode'], core: () => ({sessions: [], mode: {id: 'hub', revision: 7, mode: 'work', selectedAtMs: 0}, synced: true}),
    dispatch: data => {dispatched.push(data.requestId); return Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {} as never});},
    speak: value => {spoken.push(value);}, ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile = 'bunny'): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const control = (action: string, extra: Record<string, unknown> = {}, revision = state().revision): Promise<RequestResult> => {
    const requestId = randomUUID();
    const version = ['withdraw', 'reorder', 'resume-queue'].includes(action) ? '2.2' : '2.0';
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-control/${version}`, data: {requestId, action, expectedRevision: revision, ...extra}}, {requestId, timeoutMs: 5000});
  };
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
  /** Sends a steer to the profile's current task, or the turn it names. */
  const steer = async (text: string, extra: {taskId?: string | undefined; questionId?: string; profile?: AssistantProfile; expectedRevision?: number} = {}): Promise<{id: string; result: RequestResult}> => {
    const profile = extra.profile ?? 'bunny';
    const data = await staged({action: 'steer', profile, text, taskId: 'taskId' in extra ? extra.taskId : task(profile)?.taskId,
      ...(extra.questionId === undefined ? {} : {questionId: extra.questionId}), ...(extra.expectedRevision === undefined ? {} : {expectedRevision: extra.expectedRevision})});
    return {id: data.requestId, result: await input(data)};
  };
  const queue = async (text: string, profile: AssistantProfile = 'bunny'): Promise<{id: string; result: RequestResult}> => {
    const data = await staged({action: 'queue', profile, text});
    return {id: data.requestId, result: await input(data)};
  };
  const content = async <T>(ref: string, query: Record<string, string>): Promise<T> => {
    const answer = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(answer !== undefined && !('error' in answer), JSON.stringify(answer));
    return JSON.parse(Buffer.from(answer.bytes).toString()) as T;
  };
  const queued = (profile: AssistantProfile = 'bunny') => content<QueueDocument>('conversation', {profile, view: 'queue'});
  const messages = async (profile: AssistantProfile = 'bunny') => (await content<{messages: {id: string; taskId: string; role: string; text: string}[]}>('conversation', {profile})).messages;
  return {state, task, control, staged, input, send, steer, queue, queued, messages, observations, states, spoken, dispatched,
    database: () => host.moduleDatabase() ?? assert.fail('open database'),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
const code = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.code : undefined;
const detail = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.detail : undefined;
const texts = (document: QueueDocument): string[] => document.messages.map(message => message.text);
const steerTexts = (document: QueueDocument): string[] => document.steers.map(message => message.text);
type Database = ReturnType<Awaited<ReturnType<typeof world>>['database']>;
const records = (database: Database): {id: string; prompt: string; status: string; graphVersion: string; modelCalls: number; reservedUnits: number; transcript: TranscriptItem[]}[] =>
  (database.prepare('SELECT record FROM assistant_tasks ORDER BY seq').all() as {record: string}[]).map(row => JSON.parse(row.record) as never);
/** Rewrites fields of a saved task record, as a store in a given state would hold it; the engine reads the record at each step. */
const rewrite = (database: Database, taskId: string, fields: Record<string, unknown>): void => {
  for (const [key, value] of Object.entries(fields)) database.prepare(`UPDATE assistant_tasks SET record=json_set(record,'$.${key}',json(?)) WHERE id=?`).run(JSON.stringify(value), taskId);
};
const valid = (published: {dataschema: string; data: AssistantState}): boolean => coreValidator().validate({specversion: '1.0', bunnyprofile: '2.0', id: 'state-1', source: 'bunny/modules/companions',
  type: 'org.bunny.assistant-state.updated', subject: 'assistant', time: '2026-11-24T18:00:00.000Z', kind: 'state', datacontenttype: 'application/json',
  dataschema: published.dataschema, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data: published.data}, {nowMs: Date.parse('2026-11-24T18:00:00Z')}).ok;

void test('a steer during tool use is saved at once and read after the tool result, before the next model call, in the same turn', async context => {
  const prompts: string[] = [];
  const titleProvider: TitleProvider = {name: 'synthetic', model: 'synthetic', title: prompt => {prompts.push(prompt); return Promise.resolve({text: 'Title', usage: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}});}};
  const provider = gated(), w = await world(context, {provider, syntheticTitleProvider: titleProvider});
  await w.control('enable');
  assert.equal((await w.send('Synthetic request that reads')).status, 'accepted');
  await settle(() => provider.pending.length === 1 && prompts.length === 1);
  const first = w.task()?.taskId;
  const generation = (): number => (JSON.parse((w.database().prepare('SELECT record FROM assistant_tasks').get() as {record: string}).record) as {generation: number}).generation;
  const before = generation();
  const sent = await w.steer('Synthetic steer: use the blue sample');
  assert.equal(sent.result.status, 'accepted');
  // Saved at once: the steer waits for the next model call, and the running call goes on.
  assert.deepEqual(steerTexts(await w.queued()), ['Synthetic steer: use the blue sample']);
  assert.deepEqual(texts(await w.queued()), []);
  assert.equal(provider.pending[0]?.signal.aborted, false, 'the running call is not cut off');
  assert.equal(generation(), before, 'the generation is not bumped, so the run is not fenced');
  assert.equal(w.state().queues, undefined, 'a steer is not a queued message');
  provider.next().resolve(read());
  await settle(() => provider.pending.length === 1, 'the next model call after the tool');
  const next = provider.next();
  assert.deepEqual(plain(next.input.transcript), [{role: 'owner', text: 'Synthetic request that reads'},
    {role: 'assistant', text: 'Synthetic reading the fixture.', calls: [{id: 'call-read', name: 'read_fixture', input: {}}]},
    {role: 'tool', call: 'call-read', name: 'read_fixture', result: 'Read-only fixture: blue is the selected synthetic sample.', ok: true},
    {role: 'owner', text: 'Synthetic steer: use the blue sample'}]);
  // The Messages API reads the tool result first and the steer's text after it, in one user turn.
  assert.deepEqual(toMessages(next.input.transcript).at(-1), {role: 'user', content: [
    {type: 'tool_result', tool_use_id: 'call-read', content: 'Read-only fixture: blue is the selected synthetic sample.'},
    {type: 'text', text: 'Synthetic steer: use the blue sample'}]});
  assert.deepEqual(steerTexts(await w.queued()), [], 'a read steer is no longer waiting');
  assert.equal(w.task()?.taskId, first, 'the steer joins the current turn');
  next.resolve(reply('Synthetic answer after the steer'));
  await settle(() => w.task()?.status === 'succeeded' && prompts.length === 2);
  assert.deepEqual((await w.messages()).map(message => [message.role, message.text]), [['owner', 'Synthetic request that reads'],
    ['tool', 'Read-only fixture: blue is the selected synthetic sample.'], ['owner', 'Synthetic steer: use the blue sample'], ['assistant', 'Synthetic answer after the steer']]);
  assert.equal(w.task()?.modelCalls, 2);
  // One turn in the session: it started once and ended once, and the steer is not a turn of its own.
  assert.equal(w.observations.filter(entry => entry.event.kind === 'turn-started').length, 1);
  assert.equal(w.observations.filter(entry => entry.event.kind === 'turn-ended').length, 1);
  // A steer runs no title check: the message that started the task and the finished task did.
  await quiet();
  const labels = prompts.map(prompt => [...prompt.matchAll(/(The owner sent a message\.|A task finished: [a-z]+\.)/gu)].map(match => match[1]));
  assert.deepEqual(labels, [['The owner sent a message.'], ['A task finished: succeeded.']]);
  // The steer's text reaches only the task's own model call: no published state or session report carries it.
  assert.doesNotMatch(JSON.stringify(w.states), /Synthetic steer/);
  assert.doesNotMatch(JSON.stringify(w.observations), /Synthetic steer/);
  for (const published of w.states) assert.equal(valid(published), true, published.dataschema);
});

void test('a steer forces one more model call when the model was about to finish; the superseded reply is saved and only the final one is spoken', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request');
  await settle(() => provider.pending.length === 1);
  assert.equal((await w.steer('Synthetic steer: also say goodbye')).result.status, 'accepted');
  provider.next().resolve(reply('Synthetic early answer'));
  await settle(() => provider.pending.length === 1, 'a forced call reads the steer');
  const forced = provider.next();
  assert.deepEqual(plain(forced.input.transcript), [{role: 'owner', text: 'Synthetic request'}, {role: 'assistant', text: 'Synthetic early answer', calls: []},
    {role: 'owner', text: 'Synthetic steer: also say goodbye'}]);
  // The forced call is admitted as any other: counted and reserved before it is sent.
  assert.equal(w.task()?.modelCalls, 2);
  assert.ok((w.task()?.reservedUnits ?? 0) > LIMITS.outputUnits, 'the forced call reserved its units');
  assert.equal(w.spoken.length, 0, 'the superseded answer is not spoken');
  forced.resolve(reply('Synthetic final answer, goodbye'));
  await settle(() => w.task()?.status === 'succeeded');
  assert.deepEqual((await w.messages()).map(message => [message.role, message.text]), [['owner', 'Synthetic request'], ['assistant', 'Synthetic early answer'],
    ['owner', 'Synthetic steer: also say goodbye'], ['assistant', 'Synthetic final answer, goodbye']]);
  await settle(() => w.spoken.length === 1);
  await quiet();
  assert.deepEqual(w.spoken.map(entry => entry.text), ['Synthetic final answer, goodbye'], 'only the final reply is spoken');
  // Negative control: without a steer the same answer ends the turn after one call.
  await w.send('Synthetic second request');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(reply('Synthetic only answer'));
  await settle(() => w.task()?.status === 'succeeded' && w.task()?.modelCalls === 1);
  assert.equal(provider.calls(), 3);
});

void test('a steer that arrives after the last model call becomes the next queued message; the turn\'s close decides it', async context => {
  const provider = gated();
  // The steer lands just after the last call's answer was saved and before the turn closes: the hook runs at the
  // engine's next availability check, which follows the call's receipt.
  let late: (() => void) | undefined;
  const w = await world(context, {provider, available: () => {late?.(); return true;}});
  await w.control('enable');
  await w.queue('Synthetic message queued earlier');
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.pending[0]?.input ?? assert.fail()), 'Synthetic message queued earlier', 'the queue started at once');
  await w.queue('Synthetic message queued behind');
  const taskId = w.task()?.taskId ?? assert.fail(), conversationId = w.task()?.conversationId ?? assert.fail();
  const database = w.database();
  late = () => {
    const receipt = database.prepare("SELECT json_extract(record,'$.status') AS status FROM assistant_calls WHERE id=?").get(`${taskId}-step-0`) as {status: string} | undefined;
    if (receipt?.status !== 'succeeded') return;
    late = undefined;
    database.prepare('INSERT INTO assistant_steers VALUES (?,?,?,?,?,?,?,?)').run('late-steer-1', taskId, conversationId, 'bunny', 1, 'Synthetic late steer', 0,
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
  };
  provider.next().resolve(reply('Synthetic last answer'));
  await settle(() => provider.pending.length === 1, 'the late steer started as the next message');
  const started = provider.next();
  assert.deepEqual(plain(started.input.transcript), [{role: 'owner', text: 'Synthetic late steer'}], 'a new task and turn, ahead of the queue');
  assert.equal(records(database)[0]?.status, 'succeeded', 'no forced call: the turn had closed');
  assert.equal(records(database)[0]?.modelCalls, 1);
  assert.deepEqual(texts(await w.queued()), ['Synthetic message queued behind']);
  started.resolve(reply('Synthetic answer to the late steer'));
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic message queued behind');
});

void test('Skip question and send drops the pending clarification and steers the task in one step', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that asks');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Which synthetic sample?'));
  await settle(() => w.task()?.status === 'waiting');
  const questionId = w.task()?.questionId ?? assert.fail();
  // A stale question is refused, and the question stays.
  assert.equal(code((await w.steer('Synthetic steer', {questionId: 'unknown-question'})).result), 'invalid-state');
  assert.equal((await w.steer('Synthetic steer: never mind, list the sessions', {questionId})).result.status, 'accepted');
  await settle(() => provider.pending.length === 1, 'the task continues');
  const next = provider.next();
  assert.deepEqual(plain(next.input.transcript).slice(2), [{role: 'tool', call: 'call-ask', name: 'ask_owner', result: SKIPPED, ok: true},
    {role: 'owner', text: 'Synthetic steer: never mind, list the sessions'}]);
  next.resolve(reply('Synthetic answer without the question'));
  await settle(() => w.task()?.status === 'succeeded');
  assert.deepEqual((await w.messages()).map(message => [message.role, message.text]), [['owner', 'Synthetic request that asks'], ['assistant', 'Which synthetic sample?'],
    ['owner', 'Synthetic steer: never mind, list the sessions'], ['assistant', 'Synthetic answer without the question']], 'the skip saves no answer of its own');
  assert.equal(w.observations.filter(entry => entry.event.kind === 'attention-resolved').length, 1, 'the question no longer waits on the owner');
});

void test('Decline with message declines an approval and steers in one step; free text during an approval is queued', async context => {
  const prompts: string[] = [];
  const titleProvider: TitleProvider = {name: 'synthetic', model: 'synthetic', title: prompt => {prompts.push(prompt); return Promise.resolve({text: 'Title', usage: {input: 0, output: 0, cacheWrite: 0, cacheRead: 0}});}};
  const provider = gated(), w = await world(context, {provider, syntheticTitleProvider: titleProvider});
  await w.control('enable');
  await w.send('Synthetic request that proposes');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(propose('free'));
  await settle(() => w.task()?.status === 'waiting' && w.task()?.questionId !== null);
  const questionId = w.task()?.questionId ?? assert.fail();
  // Free text during an approval is queued: it neither applies nor dismisses the proposal.
  const free = await w.steer('Synthetic text during the approval');
  assert.equal(free.result.status, 'accepted');
  assert.deepEqual(texts(await w.queued()), ['Synthetic text during the approval']);
  assert.deepEqual(steerTexts(await w.queued()), []);
  assert.equal(w.task()?.status, 'waiting');
  await quiet();
  assert.equal(provider.calls(), 1);
  const checks = prompts.length;
  assert.equal((await w.steer('Synthetic steer: keep the work mode', {questionId})).result.status, 'accepted');
  await settle(() => provider.pending.length === 1, 'the declined task continues');
  const next = provider.next();
  assert.deepEqual(plain(next.input.transcript).slice(2), [{role: 'tool', call: 'call-mode', name: 'set_mode', result: DECLINED, ok: false},
    {role: 'owner', text: 'Synthetic steer: keep the work mode'}]);
  assert.deepEqual(w.dispatched, [], 'nothing was dispatched');
  next.resolve(reply('Synthetic answer keeping work'));
  // The queued text starts after the declined task ends.
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic text during the approval');
  const messages = (await w.messages()).map(message => [message.role, message.text]);
  assert.deepEqual(messages.slice(1, 5), [['assistant', 'Set the Hub mode to free?'], ['owner', 'decline'], ['tool', DECLINED], ['owner', 'Synthetic steer: keep the work mode']]);
  // The declined approval is still the title's major event; the steer adds no check.
  await settle(() => prompts.slice(checks).some(prompt => prompt.includes('The owner declined')));
});

void test('a steer becomes a queued message when fewer than two model calls remain in the turn\'s limits', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request near its limits');
  await settle(() => provider.pending.length === 1);
  const taskId = w.task()?.taskId ?? assert.fail();
  // Negative control: with two calls left the steer waits for the next one.
  rewrite(w.database(), taskId, {modelCalls: LIMITS.modelCalls - 2});
  assert.equal((await w.steer('Synthetic steer with two calls left')).result.status, 'accepted');
  rewrite(w.database(), taskId, {modelCalls: LIMITS.modelCalls - 1});
  assert.equal((await w.steer('Synthetic steer with one call left')).result.status, 'accepted');
  assert.deepEqual(steerTexts(await w.queued()), ['Synthetic steer with two calls left']);
  assert.deepEqual(texts(await w.queued()), ['Synthetic steer with one call left']);
  // The active time limit counts too: a turn without two model deadlines of active time left queues the steer.
  rewrite(w.database(), taskId, {modelCalls: 1, activeMs: LIMITS.activeMs - LIMITS.modelMs});
  assert.equal((await w.steer('Synthetic steer with no time left')).result.status, 'accepted');
  assert.deepEqual(texts(await w.queued()), ['Synthetic steer with one call left', 'Synthetic steer with no time left']);
});

void test('Stop returns unread steers to the head of the queue, which may pass its limit; Queue waits until it is below the limit again', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that will stop');
  await settle(() => provider.pending.length === 1);
  const queuedIds: string[] = [];
  for (let index = 0; index < LIMITS.queuedMessages; index += 1) queuedIds.push((await w.queue(`Synthetic queued ${String(index)}`)).id);
  const first = await w.steer('Synthetic steer one'), second = await w.steer('Synthetic steer two');
  assert.deepEqual([first.result.status, second.result.status], ['accepted', 'accepted'], 'a full queue does not refuse a steer');
  assert.equal((await w.control('cancel', {taskId: w.task()?.taskId})).status, 'accepted');
  await settle(() => w.task()?.status === 'cancelled');
  provider.pending.length = 0;
  const returned = await w.queued();
  assert.deepEqual(texts(returned), ['Synthetic steer one', 'Synthetic steer two', ...queuedIds.map((_, index) => `Synthetic queued ${String(index)}`)], 'the steers come back first, in order');
  assert.deepEqual(returned.messages.slice(0, 2).map(message => message.id), [first.id, second.id], 'each keeps its request ID');
  assert.deepEqual(returned.held, {reason: 'stop', code: null, detail: null});
  assert.deepEqual(returned.steers, []);
  assert.deepEqual(w.state().queues?.map(entry => [entry.messages, entry.held]), [[10, 'stop']]);
  assert.equal(w.states.at(-1)?.dataschema, 'https://bunny.invalid/events/assistant-state/2.3', 'past the limit the state is 2.3');
  assert.equal(valid(w.states.at(-1) ?? assert.fail()), true);
  // While the queue holds its limit or more, a new message is not queued.
  const full = (await w.queue('Synthetic refused while over')).result;
  assert.deepEqual([code(full), detail(full)], ['capacity', QUEUE_FULL]);
  for (const id of queuedIds.slice(0, 2)) assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: id})).status, 'accepted');
  assert.equal(code((await w.queue('Synthetic refused at the limit')).result), 'capacity', 'at the limit, still refused');
  assert.equal(w.states.at(-1)?.dataschema, 'https://bunny.invalid/events/assistant-state/2.2', 'at the limit the state is 2.2 again');
  assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: queuedIds[2]})).status, 'accepted');
  assert.equal((await w.queue('Synthetic accepted below the limit')).result.status, 'accepted');
  await quiet();
  assert.equal(provider.calls(), 1, 'the held queue started nothing');
  // Resume queue starts the first returned steer as its own task and turn.
  assert.equal((await w.control('resume-queue', {profile: 'bunny'})).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal(ownerText(provider.next().input), 'Synthetic steer one');
});

void test('a task takes at most its limit of unread steers, and they and the queue never pass the queue\'s bound', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request with many steers');
  await settle(() => provider.pending.length === 1);
  for (let index = 0; index < LIMITS.steers; index += 1) assert.equal((await w.steer(`Synthetic steer ${String(index)}`)).result.status, 'accepted');
  const refused = (await w.steer('Synthetic steer past the limit')).result;
  assert.deepEqual([code(refused), detail(refused)], ['capacity', STEERS_FULL]);
  for (let index = 0; index < LIMITS.queuedMessages; index += 1) await w.queue(`Synthetic queued ${String(index)}`);
  await w.control('cancel', {taskId: w.task()?.taskId});
  await settle(() => w.task()?.status === 'cancelled');
  provider.pending.length = 0;
  assert.equal((await w.queued()).messages.length, LIMITS.queueBound);
  assert.equal(w.states.at(-1)?.dataschema, 'https://bunny.invalid/events/assistant-state/2.3');
  assert.equal(valid(w.states.at(-1) ?? assert.fail()), true, 'the bound is the state\'s');
  // Send still starts a task beside the held queue; its steers have no room while the queue holds its bound.
  await quiet();
  assert.equal((await w.send('Synthetic task beside the held queue')).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal(code((await w.steer('Synthetic steer with no room')).result), 'capacity');
  const ids = (await w.queued()).messages.map(message => message.id);
  assert.equal((await w.control('withdraw', {profile: 'bunny', queuedId: ids[0]})).status, 'accepted');
  assert.equal((await w.steer('Synthetic steer with room again')).result.status, 'accepted');
});

void test('a forced call that the turn\'s limits refuse fails the turn with capacity, and its steer is returned and starts next', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request near its units');
  await settle(() => provider.pending.length === 1);
  const taskId = w.task()?.taskId ?? assert.fail();
  assert.equal((await w.steer('Synthetic steer that needs one more call')).result.status, 'accepted');
  // The units the turn has used leave no room for another call, though the steer was admitted before.
  rewrite(w.database(), taskId, {reservedUnits: LIMITS.units - LIMITS.outputUnits});
  provider.next().resolve({...reply('Synthetic early answer'), units: null});
  await settle(() => provider.pending.length === 1, 'the returned steer started');
  const started = provider.next();
  assert.deepEqual(plain(started.input.transcript), [{role: 'owner', text: 'Synthetic steer that needs one more call'}]);
  const [failed] = records(w.database());
  assert.deepEqual([failed?.status, failed?.modelCalls], ['failed', 1], 'the refused call was never counted as sent');
  assert.equal(failed?.transcript.some(item => item.role === 'owner' && item.text === 'Synthetic steer that needs one more call'), false, 'the refused call read no steer');
  const closing = (await w.messages()).find(message => message.taskId === taskId && message.role === 'assistant' && message.text.includes('limit of'));
  assert.ok(closing !== undefined, 'the closing reply names the limit');
  started.resolve(reply('Synthetic answer'));
});

void test('a steer aimed at a turn that is not the conversation\'s unfinished task is refused with invalid-state', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  assert.equal(code((await w.steer('Synthetic steer with no task', {taskId: 'unknown-task'})).result), 'invalid-state');
  await w.send('Synthetic first request');
  await settle(() => provider.pending.length === 1);
  const first = w.task()?.taskId;
  provider.next().resolve(reply('Synthetic first answer'));
  await settle(() => w.task()?.status === 'succeeded');
  assert.equal(code((await w.steer('Synthetic steer at a finished turn', {taskId: first})).result), 'invalid-state', 'a finished turn is stale');
  await w.send('Synthetic second request');
  await settle(() => provider.pending.length === 1);
  await w.send('Synthetic reachy request', 'reachy');
  await settle(() => provider.pending.length === 2);
  assert.equal(code((await w.steer('Synthetic steer at another conversation', {taskId: w.task('reachy')?.taskId})).result), 'invalid-state');
  assert.equal(code((await w.steer('Synthetic steer from the future', {expectedRevision: w.state().revision + 1})).result), 'revision-conflict');
  // A revision from before the task's own steps never refuses it: the expected turn decides.
  const before = w.state().revision;
  provider.pending[1]?.resolve(reply('Synthetic reachy answer'));
  await settle(() => w.task('reachy')?.status === 'succeeded');
  assert.ok(w.state().revision > before);
  assert.equal((await w.steer('Synthetic steer naming an earlier revision', {expectedRevision: before})).result.status, 'accepted');
  // An uncertain task makes no next call until the owner resumes it, so it takes no steer.
  provider.pending[0]?.reject(new ProviderFault('unavailable', true));
  await settle(() => w.task()?.status === 'uncertain');
  assert.equal(code((await w.steer('Synthetic steer at an uncertain task')).result), 'invalid-state');
  await quiet();
  assert.equal(provider.calls(), 3, 'nothing retried');
  // Its unread steer goes back to the queue when the owner cancels it.
  await w.control('cancel', {taskId: w.task()?.taskId});
  await settle(() => w.task()?.status === 'cancelled');
  assert.deepEqual(texts(await w.queued()), ['Synthetic steer naming an earlier revision']);
});

void test('a restart starts no work; a pending steer stays with its task and is read when the answered task continues', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that asks');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Which synthetic detail?'));
  await settle(() => w.task()?.status === 'waiting');
  assert.equal((await w.steer('Synthetic steer behind the question')).result.status, 'accepted');
  await w.restart();
  await quiet();
  assert.equal(provider.calls(), 1, 'the start ran nothing');
  assert.deepEqual(steerTexts(await w.queued()), ['Synthetic steer behind the question'], 'the steer was saved');
  assert.equal((await w.send('The synthetic detail.', 'bunny', true)).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  const next = provider.next();
  assert.deepEqual(plain(next.input.transcript).slice(2), [{role: 'tool', call: 'call-ask', name: 'ask_owner', result: 'The synthetic detail.', ok: true},
    {role: 'owner', text: 'Synthetic steer behind the question'}]);
  next.resolve(reply('Synthetic answer'));
  await settle(() => w.task()?.status === 'succeeded');
});

void test('a task saved under the graph before steering is upgraded at the start and continues; an older graph still refuses resume', async context => {
  const provider = gated(), w = await world(context, {provider});
  await w.control('enable');
  await w.send('Synthetic request that asks');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Which synthetic detail?'));
  await settle(() => w.task()?.status === 'waiting');
  const taskId = w.task()?.taskId ?? assert.fail();
  rewrite(w.database(), taskId, {graphVersion: 'conversation-1'});
  await w.restart();
  assert.equal(records(w.database())[0]?.graphVersion, 'conversation-2', 'upgraded explicitly at the start');
  assert.equal(w.task()?.status, 'waiting');
  assert.equal((await w.send('The synthetic detail.', 'bunny', true)).status, 'accepted');
  await settle(() => provider.pending.length === 1);
  assert.equal((await w.steer('Synthetic steer after the upgrade')).result.status, 'accepted');
  provider.next().resolve(reply('Synthetic early answer'));
  await settle(() => provider.pending.length === 1, 'the upgraded task takes the new edge');
  provider.next().resolve(reply('Synthetic final answer'));
  await settle(() => w.task()?.status === 'succeeded');
  // Negative control: a task of the fixed synthetic graph is recovered unavailable and refuses resume.
  await w.send('Synthetic second request that asks');
  await settle(() => provider.pending.length === 1);
  provider.next().resolve(ask('Which other detail?'));
  await settle(() => w.task()?.status === 'waiting');
  const old = w.task()?.taskId ?? assert.fail();
  rewrite(w.database(), old, {graphVersion: 'synthetic-1'});
  await w.restart();
  assert.deepEqual([w.task()?.status, w.task()?.code], ['paused', 'unavailable']);
  assert.equal(records(w.database()).find(entry => entry.id === old)?.graphVersion, 'synthetic-1');
});

void test('a process exit during the call that read a steer leaves the steer read once and returns nothing at a cancel', () => {
  const child = join(import.meta.dirname, 'assistant-steer-child.js');
  const run = (dir: string, mode: string) => spawnSync(process.execPath, [child, dir, mode], {encoding: 'utf8', timeout: 60_000});
  const dir = join(tmpdir(), `assistant-steer-process-${randomUUID()}`);
  try {
    const crashed = run(dir, 'crash');
    assert.equal(crashed.status, 23, crashed.stderr);
    const before = JSON.parse(crashed.stdout) as {steers: number; transcriptSteers: number; messages: number};
    assert.deepEqual(before, {steers: 0, transcriptSteers: 1, messages: 1}, 'the call\'s admission took the steer into the transcript');
    const after = run(dir, 'cancel');
    assert.equal(after.status, 0, after.stderr);
    const report = JSON.parse(after.stdout) as {status: string; steers: number; transcriptSteers: number; messages: number; queued: number; calls: number};
    assert.deepEqual(report, {status: 'cancelled', steers: 0, transcriptSteers: 1, messages: 1, queued: 0, calls: 0}, 'the read steer is neither repeated nor returned');
  } finally {spawnSync('rm', ['-rf', dir]);}
});
