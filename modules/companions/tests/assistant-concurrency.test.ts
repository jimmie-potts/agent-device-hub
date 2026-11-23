// Several conversations at once (Hub #2027): each conversation has its own running task and graph invocation on the
// module's one SQLite connection, and none blocks another. A start is refused only while the same conversation has an
// unfinished task; disable stays refused while any conversation has one. These tests use gated fake providers, the
// harness's manual clock and scheduler and a fixed zone. They wait for messages by yielding turns, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {AssistantProfile, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import type {SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AssistantStore} from '../src/assistant/store.js';
import {SPEND_LIMIT_REACHED} from '../src/assistant/anthropic.js';
import {RECOVERY_FAILED} from '../src/assistant/engine.js';
import type {SpendView} from '../src/assistant/spend.js';
import {ProviderFault, type ModelProvider, type TurnInput, type TurnReply} from '../src/assistant/provider.js';

const ZONE = 'America/Chicago';
const PROFILES = ['bunny', 'reachy', 'microduck'] as const;
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const ask = (text: string, id = 'call-ask'): TurnReply => ({text: null, calls: [{id, name: 'ask_owner', input: {text}}], stop: 'tool', units: 10});
const fixture = (id = 'call-read'): TurnReply => ({text: null, calls: [{id, name: 'read_fixture', input: {}}], stop: 'tool', units: 10});
/** Yields event-loop turns until the check holds; no timer, so the manual clock alone moves time. */
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
type Pending = {input: TurnInput; signal: AbortSignal; resolve: (reply: TurnReply) => void; reject: (error: unknown) => void};
/** A provider whose every call waits until the test answers it, so replies can arrive in any order. */
function gated(name: ModelProvider['name'] = 'synthetic', model = 'synthetic'): ModelProvider & {pending: Pending[]; calls: () => number; next: () => Pending} {
  const pending: Pending[] = []; let calls = 0;
  return {name, model, pending, calls: () => calls,
    next: () => pending.shift() ?? assert.fail('no model call is waiting'),
    turn: (input, signal) => {calls += 1; return new Promise<TurnReply>((resolve, reject) => {pending.push({input, signal, resolve, reject});});}};
}
const three = () => ({bunny: gated(), reachy: gated(), microduck: gated()});
async function world(context: TestContext, options: CompanionsOptions = {}) {
  const now = Date.parse('2026-11-21T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-concurrency-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const observations: LifecycleObservation[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {observations.push(message.data);});
  const make = () => {const module = createCompanionsModule({timeZone: ZONE, ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const control = (action: string, extra: Record<string, unknown> = {}): Promise<RequestResult> => {
    const requestId = randomUUID();
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-control/${action === 'rename' ? '2.1' : '2.0'}`, data: {requestId, action, expectedRevision: state().revision, ...extra}}, {requestId, timeoutMs: 5000});
  };
  const send = async (profile: AssistantProfile, text: string, answer = false, revision = state().revision): Promise<RequestResult> => {
    const requestId = randomUUID(), current = task(profile);
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: answer ? 'answer' : 'start', profile, expectedRevision: revision, text,
        ...(answer ? {taskId: current?.taskId, questionId: current?.questionId} : {})}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const read = async <T>(ref: string, query: Record<string, string> = {}): Promise<T> => {
    const content = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(content !== undefined && !('error' in content), JSON.stringify(content));
    return JSON.parse(Buffer.from(content.bytes).toString()) as T;
  };
  const messages = async (profile: AssistantProfile) => (await read<{messages: {taskId: string; role: string; text: string}[]}>('conversation', {profile})).messages;
  return {state, task, control, send, messages, spend: () => read<SpendView>('spend'), observations,
    store: () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database')),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
const code = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.code : undefined;
const withProviders = (providers: Record<AssistantProfile, ModelProvider>): CompanionsOptions =>
  ({provider: providers.bunny, profileProviders: {reachy: providers.reachy, microduck: providers.microduck}});

void test('each conversation runs its own task at the same time, and replies in any order finish each in its own conversation', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  assert.equal((await w.control('enable')).status, 'accepted');
  for (const profile of ['microduck', 'bunny', 'reachy'] as const) assert.equal((await w.send(profile, `Synthetic ${profile} request`)).status, 'accepted', profile);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1), 'all three model calls are in flight at once');
  assert.deepEqual(PROFILES.map(profile => w.task(profile)?.status), ['running', 'running', 'running']);
  // Each graph has its own prompt: no conversation's text reaches another's call.
  for (const profile of PROFILES) assert.deepEqual(providers[profile].pending[0]?.input.transcript, [{role: 'owner', text: `Synthetic ${profile} request`}]);
  // A second message to a conversation whose own task is unfinished is refused, and the others keep running.
  assert.equal(code(await w.send('reachy', 'Synthetic second reachy request')), 'capacity');
  providers.microduck.next().resolve(reply('Synthetic microduck answer'));
  await settle(() => w.task('microduck')?.status === 'succeeded');
  providers.bunny.next().resolve(fixture());
  await settle(() => providers.bunny.pending.length === 1);
  providers.reachy.next().resolve(ask('Synthetic reachy question?'));
  await settle(() => w.task('reachy')?.status === 'waiting');
  // A finished conversation starts its next task while the other two are still working or waiting.
  assert.equal((await w.send('microduck', 'Synthetic microduck follow-up')).status, 'accepted');
  await settle(() => providers.microduck.pending.length === 1);
  assert.equal(w.task('bunny')?.status, 'running');
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal((await w.send('reachy', 'Synthetic reachy answer', true)).status, 'accepted');
  await settle(() => providers.reachy.pending.length === 1);
  providers.reachy.next().resolve(reply('Synthetic reachy result'));
  providers.microduck.next().resolve(reply('Synthetic microduck second answer'));
  await settle(() => w.task('reachy')?.status === 'succeeded' && w.task('microduck')?.status === 'succeeded');
  for (const profile of PROFILES) {
    const texts = (await w.messages(profile)).map(message => message.text);
    assert.ok(texts.every(text => !PROFILES.some(other => other !== profile && text.includes(other))), `${profile} holds only its own messages: ${JSON.stringify(texts)}`);
  }
  assert.deepEqual((await w.messages('bunny')).map(message => message.text), ['Synthetic bunny request', 'Read-only fixture: blue is the selected synthetic sample.', 'Synthetic bunny answer']);
  assert.deepEqual(PROFILES.map(profile => w.task(profile)?.modelCalls), [2, 2, 1]);
  assert.deepEqual(PROFILES.map(profile => w.task(profile)?.toolCalls), [1, 0, 0]);
  assert.deepEqual(PROFILES.map(profile => w.task(profile)?.questions), [0, 1, 0]);
});

void test('cancelling one conversation fences only its own task; a late reply cannot reactivate it or touch another', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  assert.equal((await w.control('cancel', {taskId: w.task('reachy')?.taskId})).status, 'accepted');
  await settle(() => w.task('reachy')?.status === 'cancelled');
  assert.equal(providers.reachy.pending[0]?.signal.aborted, true, 'the cancelled task\'s call is aborted');
  assert.equal(providers.bunny.pending[0]?.signal.aborted, false); assert.equal(providers.microduck.pending[0]?.signal.aborted, false);
  providers.reachy.next().resolve(reply('Synthetic late reachy answer'));
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  providers.microduck.next().resolve(reply('Synthetic microduck answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded' && w.task('microduck')?.status === 'succeeded');
  assert.equal(w.task('reachy')?.status, 'cancelled');
  assert.equal((await w.messages('reachy')).some(message => message.text.includes('late')), false, 'the late answer is not saved as a reply');
  assert.equal(providers.reachy.calls(), 1);
});

void test('disable is refused with invalid-state while any conversation has an unfinished task, and enable is unchanged', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  await w.send('bunny', 'Synthetic bunny request'); await w.send('microduck', 'Synthetic microduck request');
  await settle(() => providers.bunny.pending.length === 1 && providers.microduck.pending.length === 1);
  assert.equal(code(await w.control('disable')), 'invalid-state');
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal(code(await w.control('disable')), 'invalid-state', 'one unfinished conversation still refuses');
  providers.microduck.next().resolve(ask('Synthetic microduck question?'));
  await settle(() => w.task('microduck')?.status === 'waiting');
  assert.equal(code(await w.control('disable')), 'invalid-state', 'a task waiting on its owner is unfinished');
  assert.equal((await w.control('cancel', {taskId: w.task('microduck')?.taskId})).status, 'accepted');
  assert.equal((await w.control('disable')).status, 'accepted');
  assert.equal((await w.control('enable')).status, 'accepted');
  assert.equal(w.state().enabled, true);
});

void test('a restart recovers each conversation\'s unfinished task separately and starts no work', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  providers.reachy.next().resolve(ask('Synthetic reachy question?'));
  providers.microduck.next().resolve(ask('Synthetic microduck question?'));
  await settle(() => w.task('reachy')?.status === 'waiting' && w.task('microduck')?.status === 'waiting');
  assert.equal((await w.send('microduck', 'Synthetic microduck answer', true)).status, 'accepted');
  await settle(() => providers.microduck.pending.length === 1);
  // The bunny call and microduck's second call are in flight when the module stops.
  const calls = PROFILES.map(profile => providers[profile].calls());
  await w.restart();
  assert.deepEqual(PROFILES.map(profile => providers[profile].calls()), calls, 'startup sends nothing');
  assert.equal(w.task('reachy')?.status, 'waiting');
  for (const profile of ['bunny', 'microduck'] as const) assert.equal(w.task(profile)?.status, 'uncertain', `${profile}'s unanswered call leaves it uncertain`);
  assert.equal(w.state().tasks.length, 3);
  // Each conversation continues on its own: reachy's answer runs while the uncertain ones keep refusing a resume.
  const before = providers.reachy.calls();
  assert.equal((await w.send('reachy', 'Synthetic reachy answer', true)).status, 'accepted');
  await settle(() => providers.reachy.calls() === before + 1);
  assert.equal(code(await w.control('resume', {taskId: w.task('microduck')?.taskId})), 'uncertain-result');
  assert.equal(w.task('bunny')?.status, 'uncertain');
});

void test('spend reservations from several running turns are admitted atomically, so together they never pass the daily limit', async context => {
  // A long message makes each first call's reservation about $7.55 at these synthetic prices, while a new turn needs only
  // the smallest call, about $2.05: all three turns are admitted, and only two of their first calls fit under the $20 day.
  const prices = {'model-a': {input: 250, output: 1, cacheWrite: 250, cacheRead: 250}}, pad = ' '.padEnd(21_000, 'x');
  const providers = {bunny: gated('anthropic', 'model-a'), reachy: gated('anthropic', 'model-a'), microduck: gated('anthropic', 'model-a')};
  const w = await world(context, {prices, ...withProviders(providers)});
  await w.control('enable');
  for (const profile of PROFILES) assert.equal((await w.send(profile, `Synthetic ${profile} request${pad}`)).status, 'accepted', profile);
  await settle(() => PROFILES.filter(profile => providers[profile].pending.length === 1).length === 2 && w.state().tasks.some(task => task.status === 'failed'));
  const refused = w.state().tasks.find(task => task.status === 'failed') ?? assert.fail('one turn is refused');
  assert.equal(refused.code, 'capacity');
  assert.equal(providers[refused.profile].calls(), 0, 'the refused turn sent nothing');
  assert.match((await w.messages(refused.profile)).at(-1)?.text ?? '', /The daily spend limit of \$20\.00 would be passed/);
  const {day} = await w.spend();
  assert.ok(day.spentMicros <= day.limitMicros && day.spentMicros > day.limitMicros / 2, `two reservations count within the day: ${String(day.spentMicros)}`);
  const rows = w.store().database.prepare("SELECT owner FROM assistant_spend WHERE purpose='task'").all() as {owner: string}[];
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => w.state().tasks.some(task => task.taskId === row.owner && task.status === 'running')), 'each reservation belongs to its own running turn');
  for (const profile of PROFILES) providers[profile].pending.shift()?.resolve({...reply(`Synthetic ${profile} answer`), usage: {input: 10, output: 10, cacheWrite: 0, cacheRead: 0}});
  await settle(() => w.state().tasks.filter(task => task.status === 'succeeded').length === 2);
});

void test('an Anthropic spend-limit refusal ends each affected turn with its own closing reply and retries nothing', async context => {
  const providers = {bunny: gated('anthropic', 'model-a'), reachy: gated('anthropic', 'model-a'), microduck: gated()};
  const w = await world(context, {prices: {'model-a': {input: 1, output: 1, cacheWrite: 1, cacheRead: 1}}, ...withProviders(providers)});
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  providers.reachy.next().reject(new ProviderFault('capacity', false, undefined, SPEND_LIMIT_REACHED));
  providers.bunny.next().reject(new ProviderFault('capacity', false, undefined, SPEND_LIMIT_REACHED));
  await settle(() => w.task('bunny')?.status === 'failed' && w.task('reachy')?.status === 'failed');
  for (const profile of ['bunny', 'reachy'] as const) {
    assert.equal(w.task(profile)?.code, 'capacity');
    const saved = await w.messages(profile), closing = saved.at(-1);
    assert.ok(closing?.text.endsWith(SPEND_LIMIT_REACHED) === true, closing?.text);
    assert.equal(closing.taskId, w.task(profile)?.taskId, 'the closing reply is its own turn\'s');
    assert.equal(saved.filter(message => message.text.endsWith(SPEND_LIMIT_REACHED)).length, 1);
    assert.equal(providers[profile].calls(), 1, 'nothing retries');
  }
  assert.equal(w.task('microduck')?.status, 'running', 'the synthetic conversation keeps running');
  providers.microduck.next().resolve(reply('Synthetic microduck answer'));
  await settle(() => w.task('microduck')?.status === 'succeeded');
});

void test('each conversation\'s session reports keep their own ordering sequence and turns, interleaved across conversations', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  providers.microduck.next().resolve(ask('Synthetic microduck question?'));
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  providers.reachy.next().resolve(reply('Synthetic reachy answer'));
  await settle(() => w.task('microduck')?.status === 'waiting' && w.task('bunny')?.status === 'succeeded' && w.task('reachy')?.status === 'succeeded');
  await settle(() => w.observations.filter(item => item.event.kind === 'turn-ended').length === 2 && w.observations.some(item => item.event.kind === 'turn-waiting'));
  for (const task of w.state().tasks) {
    const own = w.observations.filter(item => item.identity.sessionId === task.conversationId);
    assert.ok(own.length > 0);
    assert.ok(own.every(item => item.turn.status === 'known' && item.turn.id === task.taskId), 'every observation is on the conversation\'s own turn');
    const sequences = own.map(item => item.ordering.status === 'known' ? item.ordering.sequence : -1);
    assert.deepEqual(sequences, sequences.map((_value, index) => index + 1), `${task.profile} counts its own sequence from one`);
    assert.equal(w.store().report(task.conversationId).sequence, own.length);
  }
});

void test('each spoken reply names its own conversation\'s line', async context => {
  const offers: {reply: SpokenReply; key: string; line: string}[] = [];
  const providers = three(), w = await world(context, {...withProviders(providers), speak: (spoken, key, _parent, line) => {offers.push({reply: spoken, key, line});}});
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  providers.reachy.next().resolve(reply('Synthetic reachy answer'));
  providers.bunny.next().resolve(ask('Synthetic bunny question?'));
  await settle(() => offers.length === 2);
  const lineOf = (profile: AssistantProfile) => offers.find(offer => offer.reply.taskId === w.task(profile)?.taskId)?.line;
  assert.deepEqual([lineOf('reachy'), lineOf('bunny')], [w.task('reachy')?.conversationId, w.task('bunny')?.conversationId]);
  assert.notEqual(lineOf('reachy'), lineOf('bunny'));
  const result = `${w.task('reachy')?.taskId ?? ''}-result`;
  assert.equal((await w.control('speak', {taskId: w.task('reachy')?.taskId, messageId: result})).status, 'accepted');
  await settle(() => offers.length === 3);
  assert.equal(offers[2]?.line, w.task('reachy')?.conversationId, 'a Read aloud replay waits in its own conversation\'s line');
});

void test('approvals from two conversations reach the single writer in arrival order, each with its own guard', async context => {
  // A fake single writer for the Hub mode: it applies commands in the order they arrive and refuses a stale revision.
  let revision = 3; const applied: string[] = [];
  const providers = three(), w = await world(context, {...withProviders(providers), tools: ['set_mode'], core: () => ({sessions: [], mode: {id: 'hub', revision, mode: 'work', selectedAtMs: 0}, synced: true}),
    dispatch: data => {
      assert.equal(data.family, 'mode-set');
      if (data.family !== 'mode-set' || data.data.expectedRevision !== revision) return Promise.resolve<RequestResult>({status: 'rejected', requestId: data.requestId, error: errorBody('revision-conflict')});
      revision += 1; applied.push(data.data.mode);
      return Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {} as never});
    }});
  await w.control('enable');
  await w.send('bunny', 'Synthetic bunny mode request'); await w.send('reachy', 'Synthetic reachy mode request');
  await settle(() => providers.bunny.pending.length === 1 && providers.reachy.pending.length === 1);
  providers.bunny.next().resolve({text: null, calls: [{id: 'call-bunny-mode', name: 'set_mode', input: {mode: 'quiet'}}], stop: 'tool', units: 10});
  providers.reachy.next().resolve({text: null, calls: [{id: 'call-reachy-mode', name: 'set_mode', input: {mode: 'free'}}], stop: 'tool', units: 10});
  await settle(() => w.task('bunny')?.status === 'waiting' && w.task('reachy')?.status === 'waiting');
  // Reachy's approval arrives first, then B.U.N.N.Y.'s, which was bound to the same revision and is now stale.
  assert.equal((await w.send('reachy', 'approve', true)).status, 'accepted');
  await settle(() => applied.length === 1 && providers.reachy.pending.length === 1);
  assert.equal((await w.send('bunny', 'approve', true)).status, 'accepted');
  await settle(() => providers.bunny.pending.length === 1);
  assert.deepEqual(applied, ['free'], 'the writer applied only the first arrival');
  const bunnyResult = providers.bunny.pending[0]?.input.transcript.at(-1), reachyResult = providers.reachy.pending[0]?.input.transcript.at(-1);
  assert.ok(bunnyResult?.role === 'tool' && /refused: revision-conflict: the Hub mode changed since this was proposed/.test(bunnyResult.result), JSON.stringify(bunnyResult));
  assert.ok(reachyResult?.role === 'tool' && reachyResult.result.startsWith('accepted: '), JSON.stringify(reachyResult));
  providers.bunny.next().resolve(reply('Synthetic bunny mode not changed'));
  providers.reachy.next().resolve(reply('Synthetic reachy mode changed'));
  await settle(() => w.task('bunny')?.status === 'succeeded' && w.task('reachy')?.status === 'succeeded');
});

void test('a step in another conversation never makes a command stale, while a change in its own conversation does', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  await w.send('bunny', 'Synthetic bunny request'); await w.send('reachy', 'Synthetic reachy request');
  await settle(() => providers.bunny.pending.length === 1 && providers.reachy.pending.length === 1);
  providers.bunny.next().resolve(ask('Synthetic bunny question?'));
  await settle(() => w.task('bunny')?.status === 'waiting');
  // The owner reads the page at this revision; then Reachy's turn takes a step, which changes the assistant's revision.
  const seen = w.state().revision;
  providers.reachy.next().resolve(fixture());
  await settle(() => providers.reachy.pending.length === 1);
  assert.ok(w.state().revision > seen, 'the other conversation moved the assistant revision');
  // Commands for conversations that did not change since are accepted against the revision the owner saw.
  assert.equal((await w.send('microduck', 'Synthetic microduck request', false, seen)).status, 'accepted', 'a start');
  assert.equal((await w.control('speak', {taskId: w.task('bunny')?.taskId, messageId: w.task('bunny')?.questionId, expectedRevision: seen})).status, 'accepted', 'a Read aloud');
  assert.equal((await w.send('bunny', 'Synthetic bunny answer', true, seen)).status, 'accepted', 'an answer');
  await settle(() => providers.bunny.pending.length === 1 && providers.microduck.pending.length === 1);
  const before = w.state().revision;
  providers.microduck.next().resolve(fixture());
  await settle(() => providers.microduck.pending.length === 1 && w.state().revision > before);
  assert.equal((await w.control('cancel', {taskId: w.task('bunny')?.taskId, expectedRevision: before})).status, 'accepted', 'a cancel of a running task');
  // A command whose own conversation changed after the revision it names is stale.
  assert.equal(code(await w.control('cancel', {taskId: w.task('reachy')?.taskId, expectedRevision: seen})), 'revision-conflict', 'a stale cancel');
  assert.equal(code(await w.send('bunny', 'Synthetic stale bunny request', false, seen)), 'revision-conflict', 'a stale start');
  assert.equal(code(await w.control('cancel', {taskId: w.task('reachy')?.taskId, expectedRevision: w.state().revision + 1})), 'revision-conflict', 'a revision from the future');
  // Enable and disable keep the assistant-wide revision.
  assert.equal(code(await w.control('disable', {expectedRevision: seen})), 'revision-conflict');
  assert.equal((await w.control('cancel', {taskId: w.task('reachy')?.taskId})).status, 'accepted');
});

void test('a recovery that fails in one conversation leaves that conversation unavailable and the others answering', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  for (const profile of PROFILES) await w.send(profile, `Synthetic ${profile} request`);
  await settle(() => PROFILES.every(profile => providers[profile].pending.length === 1));
  for (const profile of PROFILES) providers[profile].next().resolve(ask(`Synthetic ${profile} question?`));
  await settle(() => PROFILES.every(profile => w.task(profile)?.status === 'waiting'));
  // Reachy's saved graph state becomes unreadable, so its startup reconciliation fails.
  const reachy = w.task('reachy')?.taskId ?? assert.fail('reachy task');
  w.store().database.prepare("UPDATE assistant_checkpoints SET checkpoint=CAST('not a checkpoint' AS BLOB) WHERE thread=?").run(reachy);
  await w.restart();
  assert.equal(w.state().available, true, 'the assistant as a whole stays available');
  assert.deepEqual([w.task('reachy')?.status, w.task('reachy')?.code], ['paused', 'unavailable']);
  for (const profile of ['bunny', 'microduck'] as const) {
    assert.equal(w.task(profile)?.status, 'waiting');
    assert.equal((await w.send(profile, `Synthetic ${profile} answer`, true)).status, 'accepted', `${profile} still answers`);
  }
  await settle(() => providers.bunny.pending.length === 1 && providers.microduck.pending.length === 1);
  // The failed conversation stays unavailable until a restart, even after its task is cancelled.
  assert.equal(code(await w.send('reachy', 'Synthetic reachy answer', true)), 'unavailable');
  assert.equal((await w.control('cancel', {taskId: reachy})).status, 'accepted');
  assert.equal(code(await w.send('reachy', 'Synthetic reachy request again')), 'unavailable');
  // The owner reads why in that conversation, once for this failed start, and the others read nothing of it.
  const notice = (texts: {text: string}[]) => texts.filter(message => message.text === RECOVERY_FAILED).length;
  assert.equal(notice(await w.messages('reachy')), 1);
  assert.equal(notice(await w.messages('bunny')) + notice(await w.messages('microduck')), 0);
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  providers.microduck.next().resolve(reply('Synthetic microduck answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded' && w.task('microduck')?.status === 'succeeded');
  // A start that recovers without a failure writes no such message.
  await w.restart();
  assert.equal(notice(await w.messages('reachy')), 1);
});

void test('a rename counts as a change of its conversation, so a second rename bound to the same revision is refused', async context => {
  const w = await world(context, withProviders(three()));
  await w.control('enable');
  const seen = w.state().revision;
  assert.equal((await w.control('rename', {profile: 'reachy', title: 'Synthetic first title', expectedRevision: seen})).status, 'accepted');
  assert.equal(code(await w.control('rename', {profile: 'reachy', title: 'Synthetic stale title', expectedRevision: seen})), 'revision-conflict');
  assert.equal((await w.control('rename', {profile: 'bunny', title: 'Synthetic other title', expectedRevision: seen})).status, 'accepted', 'another conversation is unaffected');
});

void test('a start counts every conversation as changed at its revision, so a command naming an older revision is refused', async context => {
  const providers = three(), w = await world(context, withProviders(providers));
  await w.control('enable');
  await w.send('bunny', 'Synthetic bunny request');
  await settle(() => providers.bunny.pending.length === 1);
  providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  const seen = w.state().revision;
  await w.send('reachy', 'Synthetic reachy request');
  await settle(() => providers.reachy.pending.length === 1);
  assert.equal((await w.control('rename', {profile: 'microduck', title: 'Synthetic duck title', expectedRevision: seen})).status, 'accepted',
    'before a restart, another conversation\'s step leaves the revision current for this one');
  await w.restart();
  // A finished conversation, which startup reconciliation does not touch, still counts as changed at the start.
  assert.equal(code(await w.send('bunny', 'Synthetic bunny request again', false, seen)), 'revision-conflict');
  assert.equal((await w.send('bunny', 'Synthetic bunny request again')).status, 'accepted');
});
