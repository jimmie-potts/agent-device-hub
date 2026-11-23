// A disposable process fixture for the concurrency qualification (Hub #2027): three conversations' graphs in one module
// on its one SQLite connection, with gated paid providers answered in mixed order. `crash` exits abruptly, without the
// module's orderly stop, while two conversations' model calls are in flight and a third waits on its question; `restart`
// starts the same state again, finishes the waiting conversation and reports what every record holds. The clock is
// manual and nothing waits for time.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';
import {AssistantStore, type Task} from '../src/assistant/store.js';
import {SqliteCheckpointSaver} from '../src/assistant/checkpointer.js';
import type {ModelProvider, TurnInput, TurnReply} from '../src/assistant/provider.js';
import type {TitleProvider} from '../src/assistant/titles.js';

const [stateDir, mode] = process.argv.slice(2); assert.ok(stateDir !== undefined && (mode === 'crash' || mode === 'restart'));
const PROFILES = ['bunny', 'reachy', 'microduck'] as const;
const TOPICS: Record<AssistantProfile, {errand: string; title: string}> = {
  bunny: {errand: 'Synthetic bunny errand: check the garden lights', title: 'Garden lights check'},
  reachy: {errand: 'Synthetic reachy errand: label the pantry shelf', title: 'Pantry shelf labels'},
  microduck: {errand: 'Synthetic microduck errand: time the bath', title: 'Bath timer'},
};
const now = Date.parse('2026-11-21T18:00:00Z');
const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
async function settle(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 20_000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.fail(what);
}
type Pending = {input: TurnInput; signal: AbortSignal; resolve: (reply: TurnReply) => void};
function gated(): ModelProvider & {pending: Pending[]; calls: () => number; next: () => Pending} {
  const pending: Pending[] = []; let calls = 0;
  return {name: 'anthropic', model: 'model-a', pending, calls: () => calls, next: () => pending.shift() ?? assert.fail('no model call is waiting'),
    turn: (input, signal) => {calls += 1; return new Promise<TurnReply>(resolve => {pending.push({input, signal, resolve});});}};
}
const usage = {input: 100, output: 20, cacheWrite: 0, cacheRead: 0};
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 120, usage});
const ask = (text: string, id: string): TurnReply => ({text: null, calls: [{id, name: 'ask_owner', input: {text}}], stop: 'tool', units: 120, usage});
// A paid title model that answers each conversation from its own prompt, so a prompt holding another's text shows.
const titlePrompts: string[] = [];
const titles: TitleProvider = {name: 'anthropic', model: 'model-a', title: prompt => {
  titlePrompts.push(prompt);
  const own = PROFILES.filter(profile => prompt.includes(TOPICS[profile].errand));
  return Promise.resolve({text: own.length === 1 && own[0] !== undefined ? TOPICS[own[0]].title : 'Mixed conversation', usage: {input: 50, output: 5, cacheWrite: 0, cacheRead: 0}});
}};
const providers = {bunny: gated(), reachy: gated(), microduck: gated()};
const bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
const observations: LifecycleObservation[] = [];
await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {observations.push(message.data);});
const module = createCompanionsModule({prices: {'model-a': {input: 1, output: 1, cacheWrite: 1, cacheRead: 1}}, timeZone: 'America/Chicago',
  provider: providers.bunny, profileProviders: {reachy: providers.reachy, microduck: providers.microduck}, titleProvider: titles, syntheticTitleProvider: titles});
const host = new ModuleHarness(module, {bus, stateDir, section: {}, ...time});
await host.start();
const startupCalls = PROFILES.map(profile => providers[profile].calls());
const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
const task = (profile: AssistantProfile) => state().tasks.find(value => value.profile === profile);
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
const accepted = (result: RequestResult, what: string): void => {assert.equal(result.status, 'accepted', `${what}: ${JSON.stringify(result)}`);};
const observed = () => observations.map(item => ({session: item.identity.sessionId, turn: item.turn.status === 'known' ? item.turn.id : null,
  sequence: item.ordering.status === 'known' ? item.ordering.sequence : null, kind: item.event.kind, title: item.title?.value ?? null}));

if (mode === 'crash') {
  accepted(await control('enable'), 'enable');
  for (const profile of ['microduck', 'bunny', 'reachy'] as const) accepted(await send(profile, TOPICS[profile].errand), `${profile} start`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1), 'three model calls in flight at once');
  const concurrent = state().tasks.filter(value => value.status === 'running').length;
  // MicroDuck's owner cancels while its call is in flight; its late answer arrives after the other two have moved on.
  accepted(await control('cancel', {taskId: task('microduck')?.taskId}), 'microduck cancel');
  await settle(() => task('microduck')?.status === 'cancelled', 'microduck cancelled');
  providers.reachy.next().resolve(ask('Synthetic reachy question: which shelf?', 'call-reachy-ask'));
  providers.bunny.next().resolve(ask('Synthetic bunny question: which lights?', 'call-bunny-ask'));
  await settle(() => task('reachy')?.status === 'waiting' && task('bunny')?.status === 'waiting', 'two questions');
  providers.microduck.next().resolve(reply('Synthetic late microduck answer'));
  accepted(await send('bunny', 'Synthetic bunny answer: the porch lights', true), 'bunny answer');
  await settle(() => providers.bunny.pending.length === 1, 'bunny second call in flight');
  accepted(await send('microduck', 'Synthetic microduck errand: time the bath again'), 'microduck second start');
  await settle(() => providers.microduck.pending.length === 1, 'microduck second call in flight');
  const database = host.moduleDatabase() ?? assert.fail('open database');
  const titled = () => (database.prepare("SELECT COUNT(*) AS count FROM assistant_titles WHERE json_extract(record,'$.title') IS NOT NULL").get() as {count: number}).count;
  await settle(() => titlePrompts.length === 3 && titled() === 3, 'three titles saved');
  // Exit while B.U.N.N.Y.'s and MicroDuck's admitted calls have no answer and Reachy waits on its question, with no orderly
  // module stop: two conversations' runs are lost at once.
  process.stdout.write(JSON.stringify({concurrent, observed: observed()}));
  process.exit(23);
}

// restart: startup reconciles each conversation alone and starts nothing.
const recovered = Object.fromEntries(PROFILES.map(profile => [profile, task(profile)?.status]));
const startupObserved = observed();
accepted(await send('reachy', 'Synthetic reachy answer: the top shelf', true), 'reachy answer');
await settle(() => providers.reachy.pending.length === 1, 'reachy second call');
providers.reachy.next().resolve(reply('Synthetic reachy answer: labelled'));
await settle(() => task('reachy')?.status === 'succeeded', 'reachy finished');
const resume = await control('resume', {taskId: task('bunny')?.taskId});
const database = host.moduleDatabase() ?? assert.fail('open database'), store = new AssistantStore(database), saver = new SqliteCheckpointSaver(database);
const tasks = (database.prepare('SELECT record FROM assistant_tasks ORDER BY seq').all() as {record: string}[]).map(row => JSON.parse(row.record) as Task);
const checkpoints = await Promise.all(tasks.map(async value => {
  const tuple = await saver.getTuple({configurable: {thread_id: value.id}});
  return {taskId: value.id, values: tuple?.checkpoint.channel_values ?? null};
}));
process.stdout.write(JSON.stringify({
  startupCalls, recovered, startupObserved, observed: observed(), resume: resume.status === 'rejected' ? resume.error.error.code : resume.status,
  tasks: tasks.map(value => ({id: value.id, profile: value.profile, conversationId: value.conversationId, status: value.status, code: value.code,
    modelCalls: value.modelCalls, questions: value.questions, transcript: value.transcript, calls: store.calls(value.id).map(call => ({id: call.id, status: call.status}))})),
  checkpoints, threads: (database.prepare('SELECT DISTINCT thread FROM assistant_checkpoints UNION SELECT DISTINCT thread FROM assistant_writes').all() as {thread: string}[]).map(row => row.thread),
  spend: database.prepare('SELECT id,purpose,owner FROM assistant_spend ORDER BY at_ms,id').all(),
  titles: (database.prepare('SELECT conversation_id AS conversationId,record FROM assistant_titles').all() as {conversationId: string; record: string}[])
    .map(row => ({conversationId: row.conversationId, title: (JSON.parse(row.record) as {title: {value: string} | null}).title?.value ?? null})),
  titleCalls: (database.prepare('SELECT id,conversation_id AS conversationId FROM assistant_title_calls').all()),
  reports: Object.fromEntries(tasks.map(value => [value.conversationId, store.report(value.conversationId).sequence])),
  messages: Object.fromEntries(PROFILES.map(profile => [profile, (database.prepare('SELECT msg.text FROM assistant_messages msg JOIN assistant_conversations c ON c.id=msg.conversation_id WHERE c.profile=? ORDER BY msg.seq').all(profile) as {text: string}[]).map(row => row.text)])),
  calls: PROFILES.map(profile => providers[profile].calls()),
}));
await host.stop(); await core.close();
