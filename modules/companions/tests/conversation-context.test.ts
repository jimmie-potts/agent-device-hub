// The companion's sectioned context and New conversation (Hub #2029). A task's model calls receive the builder's
// sections in a fixed order: personality, knowledge notes (off until the owner turns them on for that companion), active
// preferences, an empty long-term memory slot and the recent messages of its own conversation, fixed when it starts.
// Each section keeps to its budget and states what it left out. New conversation gives a profile a fresh conversation,
// refused while its current one has an unfinished task. The follow-up cases resolve a subject from recent context with a
// scripted provider and synthetic data, and check the provider input and the page's context preview. These tests use
// gated fake providers and the harness's manual clock; they wait by yielding turns, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {AssistantDispatch, AssistantProfile, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AssistantStore} from '../src/assistant/store.js';
import {buildContext, entriesLeftOut, RECENT_MESSAGES, SECTION_BUDGETS, SECTION_ORDER, sectionOf, type ContextSource, type SectionName} from '../src/assistant/context.js';
import type {ContextPreview, ConversationList, RecentConversationPage} from '../src/assistant/history-contract.js';
import type {Archive, DuckWidget, HistoryPage} from '../src/knowledge/model.js';
import type {ModelProvider, TurnInput, TurnReply} from '../src/assistant/provider.js';

const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const call = (name: string, input: Record<string, unknown> = {}, id = `call-${name}`): TurnReply => ({text: null, calls: [{id, name, input}], stop: 'tool', units: 10});
const ask = (text: string): TurnReply => call('ask_owner', {text}, 'call-ask');
/** Yields event-loop turns until the check holds; no timer, so the manual clock alone moves time. */
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
type Pending = {input: TurnInput; resolve: (reply: TurnReply) => void};
/** A provider whose every call waits until the test answers it; `inputs` keeps every call's input. */
function gated(): ModelProvider & {pending: Pending[]; inputs: TurnInput[]; next: () => Promise<Pending>} {
  const pending: Pending[] = [], inputs: TurnInput[] = [];
  return {name: 'synthetic', model: 'synthetic', pending, inputs,
    next: async () => {await settle(() => pending.length > 0, 'a model call is waiting'); return pending.shift() ?? assert.fail('no model call');},
    turn: input => {inputs.push(input); return new Promise<TurnReply>(resolve => {pending.push({input, resolve});});}};
}
const text = (input: TurnInput, name: SectionName): string => sectionOf(input.context, name).text ?? '';
const previewed = (preview: ContextPreview, name: SectionName) => preview.sections.find(section => section.name === name) ?? assert.fail(name);
const unknown = {status: 'unknown'} as const;
const light = (id: string, configurationRevision = 3): DeviceRecord => ({
  id, label: id, kind: 'lifx', revision: 1, configurationRevision, generation: {epoch: 'start-1', sequence: 0}, availability: 'available',
  capabilities: {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: false},
    media: {supported: false}, moments: {supported: false}, preview: {supported: false}, scenes: {supported: false}, zones: {supported: false}},
  desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: 0, pendingKinds: [],
  lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
});

async function world(context: TestContext, extra: CompanionsOptions = {}) {
  const providers = {bunny: gated(), reachy: gated(), microduck: gated()};
  const options: CompanionsOptions = {provider: providers.bunny, profileProviders: {reachy: providers.reachy, microduck: providers.microduck}, ...extra};
  let now = Date.parse('2026-11-24T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'conversation-context-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const observations: LifecycleObservation[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {observations.push(message.data);});
  const make = () => {const module = createCompanionsModule({timeZone: 'America/Chicago', ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const state = () => module.inspectAssistant() ?? assert.fail('assistant state');
  const task = (profile: AssistantProfile): AssistantTaskSummary | undefined => state().tasks.find(value => value.profile === profile);
  const content = async <T>(ref: string, query: Record<string, string> = {}): Promise<T> => {
    const result = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(result !== undefined && !('error' in result), JSON.stringify(result));
    return JSON.parse(Buffer.from(result.bytes).toString()) as T;
  };
  const refusal = async (ref: string, query: Record<string, string>): Promise<string | undefined> => {
    const result = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    return result !== undefined && 'error' in result ? result.error.code : undefined;
  };
  const control = (action: string, extraData: Record<string, unknown> = {}, revision = state().revision): Promise<RequestResult> => {
    const requestId = randomUUID();
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-control/${action === 'rename' ? '2.1' : '2.0'}`, data: {requestId, action, expectedRevision: revision, ...extraData}}, {requestId, timeoutMs: 5000});
  };
  const stage = async (target: 'assistant' | 'knowledge', input: object): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target, name: target === 'assistant' ? 'input.json' : 'knowledge.json', requestId,
      signal: new AbortController().signal, bytes: Buffer.from(JSON.stringify(input))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request(`bunny.cmd.assistant-input.${target}`, {type: 'org.bunny.assistant.input.requested', subject: target,
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const send = (profile: AssistantProfile, value: string, answer = false): Promise<RequestResult> => {
    const current = task(profile);
    return stage('assistant', {action: answer ? 'answer' : 'start', profile, expectedRevision: state().revision, text: value,
      ...(answer ? {taskId: current?.taskId, questionId: current?.questionId} : {})});
  };
  const fresh = (profile: AssistantProfile, revision = state().revision): Promise<RequestResult> => stage('assistant', {action: 'new-conversation', profile, expectedRevision: revision});
  const knowledge = (input: object, revision = state().revision): Promise<RequestResult> => stage('knowledge', {...input, expectedRevision: revision});
  const store = () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database'));
  return {providers, bus, core, state, task, content, refusal, control, send, fresh, knowledge, store, observations,
    advance: (ms: number) => {now += ms;}, now: () => now,
    preview: (profile: AssistantProfile) => content<ContextPreview>('assistant-context', {profile}),
    recent: (profile: AssistantProfile, conversationId?: string) => content<RecentConversationPage>('conversation', {profile, view: 'recent', ...(conversationId === undefined ? {} : {conversationId})}),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
type World = Awaited<ReturnType<typeof world>>;
const code = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.code : undefined;
const accepted = (result: RequestResult): void => {assert.equal(result.status, 'accepted', JSON.stringify(result));};
/** One whole B.U.N.N.Y. task: the owner's message, then each scripted reply in turn, until it finishes. */
async function exchange(w: World, message: string, ...replies: TurnReply[]): Promise<string> {
  accepted(await w.send('bunny', message));
  const id = w.task('bunny')?.taskId ?? assert.fail('task');
  for (const next of replies) (await w.providers.bunny.next()).resolve(next);
  await settle(() => w.task('bunny')?.taskId === id && w.task('bunny')?.status === 'succeeded', `${message} finished`);
  return id;
}

void test('the builder keeps the fixed order, keeps each section to its budget and states every trim', () => {
  const source: ContextSource = {profile: 'reachy', persona: {name: 'Reachy', character: 'Synthetic character.'},
    knowledge: {enabled: true, entries: Array.from({length: 12}, (_, index) => ({title: `Note ${String(index)}`, text: 'k'.repeat(4000)}))},
    preferences: [{title: 'Tea', text: 'Synthetic preference.'}],
    recent: {conversationId: 'conversation-1', total: 70, messages: Array.from({length: RECENT_MESSAGES}, (_, index) => ({id: `message-${String(index + 23)}`, role: 'owner' as const, text: `Synthetic message ${String(index + 23)}`}))}};
  const built = buildContext(source);
  assert.deepEqual(built.sections.map(section => section.name), SECTION_ORDER);
  assert.deepEqual(SECTION_ORDER, ['personality', 'knowledge', 'preferences', 'memory', 'recent']);
  for (const section of built.sections) assert.ok(section.bytes <= section.budgetBytes, section.name);
  const notes = sectionOf(built, 'knowledge');
  assert.equal(notes.state, 'included'); assert.equal(notes.included, 8); assert.equal(notes.trimmed, 4);
  assert.match(notes.text ?? '', /\n- Note 7: k+\n4 more notes were left out to fit the 32 KiB budget\.$/);
  // The Preferences and Companion knowledge pages count what is left out by the same rule (Hub #2029).
  assert.deepEqual([entriesLeftOut('knowledge', source.knowledge.entries), entriesLeftOut('preferences', source.preferences), entriesLeftOut('preferences', [])], [4, 0, 0]);
  // The newest messages fit; the 22 older ones the store held back count with them in the stated trim.
  const recent = sectionOf(built, 'recent');
  assert.equal(recent.included, RECENT_MESSAGES); assert.equal(recent.trimmed, 22);
  assert.match(recent.text ?? '', /\n22 earlier messages of this conversation were left out to fit the section's bound of 48 messages and 48 KiB\.\n\[message message-23\] Owner: Synthetic message 23\n/);
  assert.equal(sectionOf(built, 'memory').state, 'empty'); assert.equal(sectionOf(built, 'memory').text, null);
  // Large messages are trimmed by bytes, oldest first, and the newest one is always kept when it fits.
  const large = buildContext({...source, recent: {conversationId: 'conversation-1', total: 10,
    messages: Array.from({length: 10}, (_, index) => ({id: `big-${String(index)}`, role: 'tool' as const, tool: 'read_fixture', text: 'x'.repeat(8000)}))}});
  const bounded = sectionOf(large, 'recent');
  assert.ok(bounded.bytes <= SECTION_BUDGETS.recent); assert.equal(bounded.included + bounded.trimmed, 10); assert.ok(bounded.trimmed > 0);
  assert.match(bounded.text ?? '', /\[message big-9\] Tool result \(read_fixture\): x+$/);
  assert.equal((bounded.text ?? '').includes('[message big-0]'), false);
  // Knowledge stays out while off; an empty conversation sends no recent section.
  const off = buildContext({...source, knowledge: {enabled: false, entries: source.knowledge.entries}, recent: {conversationId: null, total: 0, messages: []}});
  assert.deepEqual([sectionOf(off, 'knowledge').state, sectionOf(off, 'knowledge').text, sectionOf(off, 'recent').state, sectionOf(off, 'recent').text], ['off', null, 'empty', null]);
});

void test('a follow-up task holds its conversation\'s earlier messages and tool results, fixed when it starts, and never a removed message', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  const first = await exchange(w, 'PRIVATE-FIRST What is the synthetic sample?', call('read_fixture', {}, 'call-read'), reply('PRIVATE-REPLY Blue.'));
  accepted(await w.send('bunny', 'And what about the other one?'));
  const second = w.task('bunny')?.taskId ?? assert.fail('second task');
  const one = await w.providers.bunny.next();
  const recent = sectionOf(one.input.context, 'recent');
  assert.equal(recent.state, 'included'); assert.equal(recent.included, 3); assert.equal(recent.trimmed, 0);
  assert.match(recent.text ?? '', new RegExp(`\\n\\[message ${first}-prompt\\] Owner: PRIVATE-FIRST What is the synthetic sample\\?\\n` +
    `\\[message ${first}-step-\\d+\\] Tool result \\(read_fixture\\): Read-only fixture: blue is the selected synthetic sample\\.\\n\\[message ${first}-result\\] B\\.U\\.N\\.N\\.Y\\.: PRIVATE-REPLY Blue\\.$`));
  // The task's own message is its transcript, never its context.
  assert.equal(JSON.stringify(one.input.context).includes('other one'), false);
  assert.deepEqual(one.input.transcript, [{role: 'owner', text: 'And what about the other one?'}]);
  one.resolve(ask('Which other one?'));
  await settle(() => w.task('bunny')?.status === 'waiting');
  // A message saved in the conversation after the task started, such as a late confirmation, waits for the next task.
  const store = w.store(), earlier = store.task(first) ?? assert.fail('first task');
  store.message(earlier, `${first}-late`, 'assistant', 'PRIVATE-LATE confirmation', w.now());
  accepted(await w.send('bunny', 'The second sample.', true));
  const two = await w.providers.bunny.next();
  assert.equal(text(two.input, 'recent'), recent.text, 'the section stays fixed for the task, so its cached prefix holds');
  two.resolve(reply('Green.'));
  await settle(() => w.task('bunny')?.taskId === second && w.task('bunny')?.status === 'succeeded');
  // The owner removes the first message; the next task holds the late message and no longer holds the removed one.
  accepted(await w.knowledge({action: 'delete-message', messageId: `${first}-prompt`}));
  accepted(await w.send('bunny', 'Summarize.'));
  const three = await w.providers.bunny.next();
  assert.equal(text(three.input, 'recent').includes('PRIVATE-FIRST'), false);
  assert.match(text(three.input, 'recent'), /PRIVATE-LATE confirmation/);
  assert.match(text(three.input, 'recent'), /\] Owner: The second sample\.\n/);
  three.resolve(reply('Done.'));
});

void test('no other companion\'s conversation, earlier conversation or companion exchange enters a prompt', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  // Every other conversation is saved before the checked one's last message, so a missing conversation filter would leak it.
  await exchange(w, 'PRIVATE-BUNNY-EARLIER message', reply('PRIVATE-BUNNY-EARLIER reply'));
  accepted(await w.fresh('bunny'));
  accepted(await w.knowledge({action: 'fixture'}));
  accepted(await w.send('reachy', 'PRIVATE-REACHY first'));
  (await w.providers.reachy.next()).resolve(reply('PRIVATE-REACHY reply'));
  await settle(() => w.task('reachy')?.status === 'succeeded');
  await exchange(w, 'PRIVATE-BUNNY-CURRENT message', reply('PRIVATE-BUNNY-CURRENT reply'));
  accepted(await w.send('reachy', 'Reachy follow-up'));
  const reachy = await w.providers.reachy.next();
  const seen = JSON.stringify(reachy.input);
  for (const leaked of ['PRIVATE-BUNNY', 'imaginary pond', 'garden adventure']) assert.equal(seen.includes(leaked), false, leaked);
  assert.match(text(reachy.input, 'recent'), /PRIVATE-REACHY first[\s\S]*PRIVATE-REACHY reply/);
  assert.equal(reachy.input.context.profile, 'reachy');
  reachy.resolve(reply('Reachy answer'));
  await settle(() => w.task('reachy')?.status === 'succeeded');
  accepted(await w.send('bunny', 'Bunny follow-up'));
  const bunny = await w.providers.bunny.next();
  const prompt = JSON.stringify(bunny.input);
  for (const leaked of ['PRIVATE-REACHY', 'Reachy follow-up', 'imaginary pond', 'PRIVATE-BUNNY-EARLIER']) assert.equal(prompt.includes(leaked), false, leaked);
  assert.match(text(bunny.input, 'recent'), /PRIVATE-BUNNY-CURRENT message[\s\S]*PRIVATE-BUNNY-CURRENT reply/);
  bunny.resolve(reply('Done'));
});

void test('a message another companion may not read stays out, even inside the profile\'s own conversation', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  await exchange(w, 'Synthetic opening', reply('Synthetic reply'));
  // A row between Reachy and MicroDuck in B.U.N.N.Y.'s conversation, as only a crafted record could save it.
  const store = w.store(), conversationId = store.conversation('bunny') ?? assert.fail('conversation');
  store.messages.put({schema: 'companion-message/1.0', messageId: 'crafted-row', conversationId, turnId: null, speakerId: 'reachy', recipientIds: ['microduck'],
    createdAtMs: w.now(), revision: 1, ordering: {authority: 'companions', epoch: conversationId, sequence: 99}, meaning: {kind: 'literal', text: 'PRIVATE-CROSS-PROFILE', language: 'en'},
    provenance: {kind: 'synthetic', imported: false}, deliveryRefs: [], taskId: null});
  const preview = await w.preview('bunny');
  assert.equal(JSON.stringify(preview).includes('PRIVATE-CROSS-PROFILE'), false);
  assert.equal(previewed(preview, 'recent').included, 2);
  accepted(await w.send('bunny', 'Next'));
  const next = await w.providers.bunny.next();
  assert.equal(JSON.stringify(next.input).includes('PRIVATE-CROSS-PROFILE'), false);
  next.resolve(reply('Done'));
});

void test('imported messages stay historical: an imported conversation\'s rows never reach the model', async context => {
  const source = await world(context);
  accepted(await source.control('enable'));
  await exchange(source, 'PRIVATE-IMPORTED owner message', reply('PRIVATE-IMPORTED reply'));
  const archive = await source.content<Archive>('companion-archive');
  const target = await world(context);
  accepted(await target.control('enable'));
  accepted(await target.knowledge({action: 'import-archive', archive}));
  assert.equal(previewed(await target.preview('bunny'), 'recent').state, 'empty');
  accepted(await target.send('bunny', 'A message after the import'));
  const call = await target.providers.bunny.next();
  assert.equal(JSON.stringify(call.input).includes('PRIVATE-IMPORTED'), false);
  call.resolve(reply('After the import'));
  await settle(() => target.task('bunny')?.status === 'succeeded');
  // The imported rows stay readable on the page.
  assert.match(JSON.stringify((await target.recent('bunny')).messages), /PRIVATE-IMPORTED owner message/);
  accepted(await target.send('bunny', 'Again'));
  const again = await target.providers.bunny.next();
  assert.equal(JSON.stringify(again.input).includes('PRIVATE-IMPORTED'), false);
  assert.match(text(again.input, 'recent'), /A message after the import[\s\S]*After the import/);
  again.resolve(reply('Done'));
});

void test('removing a task\'s owner message also drops that task\'s tool results, and its reply stays until removed', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  const first = await exchange(w, 'PRIVATE-REMOVED question', call('read_fixture', {}, 'call-read'), reply('PRIVATE-KEPT reply'));
  await exchange(w, 'PRIVATE-OTHER question', call('read_fixture', {}, 'call-read-2'), reply('PRIVATE-OTHER reply'));
  accepted(await w.knowledge({action: 'delete-message', messageId: `${first}-prompt`}));
  const recent = previewed(await w.preview('bunny'), 'recent').text ?? '';
  assert.equal(recent.includes('PRIVATE-REMOVED'), false);
  assert.equal(recent.includes(`[message ${first}-step-`), false, 'the removed message\'s task has no tool result in context');
  assert.match(recent, /PRIVATE-KEPT reply/);
  assert.match(recent, /PRIVATE-OTHER question\n\[message [^\]]+\] Tool result \(read_fixture\): Read-only fixture/);
  accepted(await w.knowledge({action: 'delete-message', messageId: `${first}-result`}));
  assert.equal((previewed(await w.preview('bunny'), 'recent').text ?? '').includes('PRIVATE-KEPT'), false);
});

void test('New conversation is refused while the current conversation\'s task is unfinished, and then starts a fresh one', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  // A profile without a conversation, or with an empty one, has nothing to leave behind: New conversation is refused.
  assert.equal(code(await w.fresh('microduck')), 'invalid-state');
  accepted(await w.send('reachy', 'Synthetic Reachy topic'));
  (await w.providers.reachy.next()).resolve(reply('Synthetic Reachy reply'));
  await settle(() => w.task('reachy')?.status === 'succeeded');
  await exchange(w, 'PRIVATE-EARLIER topic', reply('PRIVATE-EARLIER reply'));
  const earlier = w.task('bunny')?.conversationId ?? assert.fail('conversation');
  accepted(await w.send('bunny', 'Still working'));
  const running = await w.providers.bunny.next();
  // Running, waiting on a clarification, and after a restart uncertain: each refuses New conversation with invalid-state.
  assert.equal(code(await w.fresh('bunny')), 'invalid-state');
  running.resolve(ask('Which one?'));
  await settle(() => w.task('bunny')?.status === 'waiting');
  assert.equal(code(await w.fresh('bunny')), 'invalid-state');
  accepted(await w.send('bunny', 'This one.', true));
  await w.providers.bunny.next();
  await w.restart();
  assert.ok(['uncertain', 'paused'].includes(w.task('bunny')?.status ?? ''), w.task('bunny')?.status);
  assert.equal(code(await w.fresh('bunny')), 'invalid-state');
  // Another companion's unfinished task never holds this one: Reachy's New conversation is accepted.
  accepted(await w.fresh('reachy'));
  accepted(await w.control('cancel', {taskId: w.task('bunny')?.taskId}));
  // A command naming a revision from before the change of the profile's conversation is stale.
  const read = w.state().revision;
  accepted(await w.fresh('bunny', read));
  assert.equal(code(await w.fresh('bunny', read)), 'revision-conflict');
  assert.equal(code(await w.control('rename', {profile: 'bunny', title: 'Synthetic title'}, read)), 'revision-conflict');
  const store = w.store(), current = store.conversation('bunny') ?? assert.fail('current conversation');
  assert.notEqual(current, earlier);
  // The new conversation is empty, so another New conversation is refused until its first message.
  assert.equal(code(await w.fresh('bunny')), 'invalid-state');
  assert.equal(store.conversation('bunny'), current);
  // Both conversations changed at New conversation's revision: their own change rows (Hub #2027).
  assert.equal(store.changedAt(current), w.state().revision); assert.equal(store.changedAt(earlier), w.state().revision);
  // The profile has no task in its new conversation, and its recent history starts empty.
  assert.equal(w.task('bunny'), undefined);
  const page = await w.recent('bunny');
  assert.deepEqual([page.conversationId, page.messages, page.currentTask], [current, [], null]);
  // The earlier conversation stays readable by its ID, with no current task, and both are listed, newest first.
  const old = await w.recent('bunny', earlier);
  assert.deepEqual(old.messages.map(message => message.text).slice(0, 2), ['PRIVATE-EARLIER topic', 'PRIVATE-EARLIER reply']);
  assert.equal(old.currentTask, null);
  const list = await w.content<ConversationList>('conversation', {profile: 'bunny', view: 'list'});
  assert.deepEqual(list.conversations.map(value => [value.conversationId, value.current]), [[current, true], [earlier, false]]);
  assert.deepEqual(list.conversations[0]?.title, {value: 'B.U.N.N.Y.', source: 'provider'});
  // Another profile's conversation is not found under this profile.
  assert.equal(await w.refusal('conversation', {profile: 'reachy', view: 'recent', conversationId: earlier}), 'not-found');
  // The next message runs in the new conversation, with its own session on the devices and an empty recent section.
  const before = w.observations.length;
  accepted(await w.send('bunny', 'A fresh topic'));
  const fresh = await w.providers.bunny.next();
  await settle(() => w.observations.length > before, 'the new session reported');
  assert.equal(sectionOf(fresh.input.context, 'recent').state, 'empty');
  assert.equal(fresh.input.context.conversationId, current);
  assert.equal(JSON.stringify(fresh.input).includes('PRIVATE-EARLIER'), false);
  const started = w.observations.slice(before);
  assert.ok(started.length > 0 && started.every(observation => observation.identity.sessionId === current));
  assert.deepEqual(started[0]?.event, {kind: 'turn-started'});
  assert.deepEqual(started[0]?.companions, [{id: 'bunny', name: 'B.U.N.N.Y.'}]);
  assert.deepEqual(started[0]?.title, {value: 'B.U.N.N.Y.', source: 'provider'});
  assert.equal(w.task('bunny')?.conversationId, current);
  fresh.resolve(reply('Fresh answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  // A refused New conversation changed nothing: one conversation per accepted call.
  assert.equal((await w.content<ConversationList>('conversation', {profile: 'bunny', view: 'list'})).conversations.length, 2);
});

void test('knowledge notes enter a companion\'s context only once the owner turns them on for it, checked by their own scope', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  accepted(await w.knowledge({action: 'create', title: 'Neighbour', text: 'PRIVATE-KNOWLEDGE synthetic note'}));
  accepted(await w.send('bunny', 'First'));
  const off = await w.providers.bunny.next();
  assert.equal(sectionOf(off.input.context, 'knowledge').state, 'off');
  assert.equal(JSON.stringify(off.input).includes('PRIVATE-KNOWLEDGE'), false);
  off.resolve(reply('One'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  const read = w.state().revision;
  accepted(await w.knowledge({action: 'set-context-knowledge', persona: 'bunny', enabled: true}, read));
  // The same scope naming the same revision is stale; the library is another scope, so its command is accepted.
  assert.equal(code(await w.knowledge({action: 'set-context-knowledge', persona: 'reachy', enabled: true}, read)), 'revision-conflict');
  accepted(await w.knowledge({action: 'create', title: 'Second', text: 'PRIVATE-KNOWLEDGE second note'}, read));
  const profiles = await w.content<{knowledgeContext: AssistantProfile[]}>('companion-profiles');
  assert.deepEqual(profiles.knowledgeContext, ['bunny']);
  accepted(await w.send('bunny', 'Second'));
  const on = await w.providers.bunny.next();
  const notes = sectionOf(on.input.context, 'knowledge');
  assert.equal(notes.state, 'included'); assert.equal(notes.included, 2);
  assert.match(notes.text ?? '', /\n- Neighbour: PRIVATE-KNOWLEDGE synthetic note\n- Second: PRIVATE-KNOWLEDGE second note$/);
  on.resolve(reply('Two'));
  accepted(await w.send('reachy', 'Reachy'));
  const reachy = await w.providers.reachy.next();
  assert.equal(sectionOf(reachy.input.context, 'knowledge').state, 'off');
  reachy.resolve(reply('Reachy answer'));
  // Turning it off again keeps the notes out of the next call.
  await settle(() => w.task('bunny')?.status === 'succeeded');
  accepted(await w.knowledge({action: 'set-context-knowledge', persona: 'bunny', enabled: false}));
  assert.equal(previewed(await w.preview('bunny'), 'knowledge').state, 'off');
});

void test('the context preview shows exactly what the next call sends, before a task, during one and after a restart', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  accepted(await w.knowledge({action: 'create', title: 'Neighbour', text: 'Synthetic note'}));
  accepted(await w.knowledge({action: 'set-context-knowledge', persona: 'bunny', enabled: true}));
  await exchange(w, 'Synthetic opening', call('read_fixture'), reply('Synthetic reply'));
  const next = await w.preview('bunny');
  assert.deepEqual(next.basis, {kind: 'next-message'});
  assert.equal(next.schema, 'assistant-context/1.0'); assert.equal(next.provider, 'synthetic');
  assert.deepEqual(next.sections.map(section => [section.name, section.state]),
    [['personality', 'included'], ['knowledge', 'included'], ['preferences', 'empty'], ['memory', 'empty'], ['recent', 'included']]);
  await w.restart();
  assert.deepEqual((await w.preview('bunny')).sections, next.sections, 'a reload rebuilds the same sections from the saved records');
  accepted(await w.send('bunny', 'Follow-up'));
  const first = await w.providers.bunny.next();
  assert.deepEqual(first.input.context.sections, next.sections);
  first.resolve(ask('Which?'));
  await settle(() => w.task('bunny')?.status === 'waiting');
  const during = await w.preview('bunny');
  assert.deepEqual(during.basis, {kind: 'task', taskId: w.task('bunny')?.taskId});
  accepted(await w.send('bunny', 'That one.', true));
  const second = await w.providers.bunny.next();
  assert.deepEqual(second.input.context.sections, during.sections);
  second.resolve(reply('Done'));
  // The preview takes only a profile; anything else is refused.
  assert.equal(await w.refusal('assistant-context', {profile: 'nobody'}), 'invalid-request');
  assert.equal(await w.refusal('assistant-context', {profile: 'bunny', conversationId: 'x'}), 'invalid-request');
});

void test('a reference outside the recent budget is left out and the trim is stated; older records keep working', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  const store = w.store();
  // Sixty earlier owner messages, seeded as one finished task's, then a legacy tool result whose task holds no tool name.
  const seeded = store.newTask('bunny', 'Synthetic seed'); seeded.status = 'succeeded'; store.save(seeded);
  for (let index = 1; index <= 60; index += 1) store.message(seeded, `seed-${String(index)}`, 'owner', `Synthetic reference ${String(index)}`, w.now());
  store.message(seeded, 'seed-legacy-tool', 'tool', 'Synthetic legacy tool result', w.now());
  accepted(await w.send('bunny', 'What was reference one?'));
  const input = (await w.providers.bunny.next()).input;
  const recent = sectionOf(input.context, 'recent');
  assert.equal(recent.included, RECENT_MESSAGES); assert.equal(recent.trimmed, 61 - RECENT_MESSAGES);
  assert.match(recent.text ?? '', /\n13 earlier messages of this conversation were left out/);
  assert.equal((recent.text ?? '').includes('Synthetic reference 1\n'), false, 'the oldest reference is outside the budget');
  assert.match(recent.text ?? '', /\[message seed-legacy-tool\] Tool result: Synthetic legacy tool result$/);
  // The preview states the same trim, so the owner sees what the model cannot.
  assert.equal(previewed(await w.preview('bunny'), 'recent').trimmed, 13);
});

void test('a task saved before the recent section existed keeps an empty one', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  await exchange(w, 'Synthetic earlier message', reply('Synthetic earlier reply'));
  const store = w.store();
  const legacy = store.newTask('bunny', 'Synthetic legacy task'); delete legacy.contextThrough;
  store.save(legacy); store.message(legacy, `${legacy.id}-prompt`, 'owner', legacy.prompt, w.now());
  const preview = await w.preview('bunny');
  assert.deepEqual(preview.basis, {kind: 'task', taskId: legacy.id});
  assert.equal(previewed(preview, 'recent').state, 'empty');
});

void test('a device follow-up resolves the light discussed, asks which of two, and needs a fresh resolution after a change', async context => {
  let devices = [light('desk-lamp'), light('hall-lamp')];
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {tools: ['read_lifx', 'set_lifx_brightness'], devices: () => devices,
    dispatch: data => {requests.push(data); return Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {} as never});}});
  accepted(await w.control('enable'));
  await exchange(w, 'How is the desk lamp?', call('read_lifx', {device: 'desk-lamp'}), reply('The desk lamp is available.'));
  // The device's configuration changes after the discussion: the proposal binds what is current, not what was said.
  devices = [light('desk-lamp', 4), light('hall-lamp')];
  accepted(await w.send('bunny', 'Dim it'));
  const dim = await w.providers.bunny.next();
  const discussed = [...text(dim.input, 'recent').matchAll(/\b(desk|hall)-lamp\b/g)].map(match => match[0]);
  assert.deepEqual([...new Set(discussed)], ['desk-lamp'], 'only the discussed light is in context');
  dim.resolve(call('set_lifx_brightness', {device: 'desk-lamp', percent: 30}));
  await settle(() => w.task('bunny')?.status === 'waiting');
  const approval = (await w.recent('bunny')).currentTask?.question;
  assert.equal(approval?.kind, 'approval');
  assert.partialDeepStrictEqual(approval?.proposal, {family: 'brightness-set', target: 'desk-lamp', data: {percent: 30, expectedConfigurationRevision: 4}});
  assert.equal(requests.length, 0, 'context grants no approval: nothing is sent before the owner approves');
  accepted(await w.send('bunny', 'decline', true));
  (await w.providers.bunny.next()).resolve(reply('Nothing changed.'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  // After both lights are discussed, "dim it" could mean either: the companion asks which.
  await exchange(w, 'How is the hall lamp?', call('read_lifx', {device: 'hall-lamp'}), reply('The hall lamp is available.'));
  accepted(await w.send('bunny', 'Dim it'));
  const ambiguous = await w.providers.bunny.next();
  assert.deepEqual([...new Set([...text(ambiguous.input, 'recent').matchAll(/\b(desk|hall)-lamp\b/g)].map(match => match[0]))].sort(), ['desk-lamp', 'hall-lamp']);
  ambiguous.resolve(ask('Which light, desk-lamp or hall-lamp?'));
  await settle(() => w.task('bunny')?.status === 'waiting');
  assert.deepEqual((await w.recent('bunny')).currentTask?.question?.kind, 'clarification');
  accepted(await w.send('bunny', 'The desk lamp.', true));
  // The light was removed meanwhile: the proposal is refused against the current devices and nothing is sent.
  devices = [light('hall-lamp')];
  (await w.providers.bunny.next()).resolve(call('set_lifx_brightness', {device: 'desk-lamp', percent: 30}));
  const refused = await w.providers.bunny.next();
  assert.match(JSON.stringify(refused.input.transcript.at(-1)), /refused: not-found; no light change was proposed/);
  refused.resolve(reply('That light is gone.'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal(requests.length, 0);
});

void test('an artwork follow-up resolves "that animation" to the attachment of this conversation, not another library item', async context => {
  const target = 'display-blue';
  const w = await world(context, {tools: ['read_saved_art', 'control_art_show'], dispatch: () => assert.fail('approval is still pending')});
  await w.core.serveSync(['art-targets'], () => ({revision: 1, states: [{
    type: 'org.bunny.art-targets.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art-targets/2.0',
    data: {id: 'art', revision: 1, targets: [{target, kind: 'pixoo'}]},
  }]}));
  const pixoo = w.bus.connect('bunny/modules/pixoo'), art = w.bus.connect('bunny/modules/art');
  context.after(async () => {await pixoo.close(); await art.close();});
  const device = light(target);
  await pixoo.serveSync(['device'], () => ({revision: 1, states: [{
    type: 'org.bunny.device.updated', subject: target, dataschema: 'https://bunny.invalid/events/device/2.2',
    data: {...device, label: 'Blue panel', kind: 'pixoo', capabilities: {...device.capabilities, moments: {supported: true,
      moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['gif'], maxBytes: 65536}}}},
  }]}));
  const composition = {target: 'pixoo', compositionId: 'a'.repeat(64), outcome: 'succeeded', renditions: [{format: 'gif', bytes: 128}]};
  // The pennant came from this conversation's generation request; the meadow was added to the library afterwards.
  await art.serveSync(['art'], () => ({revision: 1, states: [{
    type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0', data: {id: 'art', revision: 1,
      jobs: [{requestId: 'pennant-generation', artworkId: 'pennant', status: 'finished', outcome: 'succeeded'},
        {requestId: 'meadow-generation', artworkId: 'meadow', status: 'finished', outcome: 'succeeded'}],
      artworks: [{artworkId: 'pennant', compositions: [composition]}, {artworkId: 'meadow', compositions: [composition]}]},
  }]}));
  const store = w.store();
  const original = store.newTask('bunny', 'Create a synthetic striped pennant animation');
  original.status = 'succeeded'; store.save(original);
  store.message(original, `${original.id}-prompt`, 'owner', original.prompt, w.now());
  store.artReply(original, 'pennant-generation', 'Striped pennant animation', w.now());
  accepted(await w.control('enable'));
  accepted(await w.send('bunny', 'Show that animation on the blue panel'));
  const first = await w.providers.bunny.next();
  assert.match(text(first.input, 'recent'), new RegExp(`\\[message ${original.id}-artwork\\] B\\.U\\.N\\.N\\.Y\\.: Artwork for this conversation\\. \\[artwork attachment: request pennant-generation, "Striped pennant animation"\\]`));
  first.resolve(call('read_saved_art'));
  const second = await w.providers.bunny.next();
  const read = second.input.transcript.at(-1);
  assert.equal(read?.role, 'tool');
  const library = JSON.parse(read.role === 'tool' ? read.result : '{}') as {artworks: {artworkId: string; sourceRequestId: string | null}[]};
  const attached = library.artworks.find(item => item.sourceRequestId === 'pennant-generation');
  assert.equal(attached?.artworkId, 'pennant');
  assert.equal(library.artworks.length, 2);
  second.resolve(call('control_art_show', {owner: 'bunny/core', target: 'hub', arguments: JSON.stringify({artworkId: attached.artworkId, targets: [target]})}));
  await settle(() => w.task('bunny')?.status === 'waiting');
  const question = (await w.recent('bunny')).currentTask?.question;
  assert.equal(question?.kind, 'approval');
  assert.match(question?.text ?? '', /Show Striped pennant animation on Blue panel \(display-blue\)/);
});

void test('a troubleshooting follow-up drafts the brief from the reported symptom, and approval still decides', async context => {
  const w = await world(context, {tools: ['delegate_coding'], coding: () => ({available: true, endpointId: 'worker-1', revision: 7}),
    delegate: () => assert.fail('nothing is dispatched before approval')});
  accepted(await w.control('enable'));
  const symptom = 'The Voice panel on the Conversation page shows a synthetic playback warning: an earlier reply is still unresolved.';
  await exchange(w, symptom, reply('That reply never confirmed playback.'));
  accepted(await w.send('bunny', 'Investigate that'));
  const draft = await w.providers.bunny.next();
  const recent = text(draft.input, 'recent');
  assert.ok(recent.includes(symptom));
  // The scripted model drafts the brief from the symptom it was given; #2043 owns the Voice panel's own evidence.
  draft.resolve(call('delegate_coding', {repository: 'agent-device-hub', brief: `Investigate on the Conversation page: ${symptom}`}));
  await settle(() => w.task('bunny')?.status === 'waiting');
  const question = (await w.recent('bunny')).currentTask?.question;
  assert.equal(question?.kind, 'approval');
  assert.partialDeepStrictEqual(question?.proposal, {family: 'coding-dispatch', data: {brief: `Investigate on the Conversation page: ${symptom}`}, expectedRevision: 7});
});

void test('a read-only follow-up is answered from the earlier report without running the worker again', async context => {
  const w = await world(context, {tools: ['delegate_coding'], coding: () => ({available: true, endpointId: 'worker-1', revision: 1}),
    delegate: () => assert.fail('the worker is not run again')});
  accepted(await w.control('enable'));
  const store = w.store();
  const earlier = store.newTask('bunny', 'Run the two synthetic checks');
  const report = 'completed (tested-candidate): Check 1 passed: lint. Check 2 failed: the synthetic unit test timed out.';
  earlier.transcript.push({role: 'tool', call: 'call-delegate', name: 'delegate_coding', result: report, ok: true, effect: `${earlier.id}-q1-result`} as never);
  earlier.status = 'succeeded'; store.save(earlier);
  store.message(earlier, `${earlier.id}-prompt`, 'owner', earlier.prompt, w.now());
  store.message(earlier, `${earlier.id}-q1-result`, 'tool', report, w.now());
  accepted(await w.send('bunny', 'Why did the second one fail?'));
  const question = await w.providers.bunny.next();
  assert.match(text(question.input, 'recent'), new RegExp(`\\[message ${earlier.id}-q1-result\\] Tool result \\(delegate_coding\\): completed \\(tested-candidate\\): Check 1 passed: lint\\. Check 2 failed`));
  question.resolve(reply('The second check failed because the synthetic unit test timed out.'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.deepEqual([w.task('bunny')?.toolCalls, w.task('bunny')?.modelCalls], [0, 1]);
});

void test('the Duck widget selection keeps working once companions have several conversations', async context => {
  const w = await world(context);
  accepted(await w.control('enable'));
  accepted(await w.knowledge({action: 'fixture'}));
  const listed = await w.content<HistoryPage>('companion-history', {profile: 'reachy'});
  const exchangeId = listed.conversations.find(value => value.participants.includes('microduck'))?.id ?? assert.fail('companion exchange');
  accepted(await w.knowledge({action: 'select-duck-conversation', conversationId: exchangeId}));
  for (const profile of ['microduck', 'reachy', 'microduck'] as const) {
    accepted(await w.send(profile, `Synthetic ${profile} message`));
    (await w.providers[profile].next()).resolve(reply(`Synthetic ${profile} answer`));
    await settle(() => w.task(profile)?.status === 'succeeded');
    accepted(await w.fresh(profile));
  }
  const widget = await w.content<DuckWidget>('duck-widget');
  assert.equal(widget.conversation?.id, exchangeId);
  assert.equal(widget.messages[0]?.speakerId, 'microduck');
  // The selection can still be changed and cleared, and the exchange stays listed beside the companions' conversations.
  accepted(await w.knowledge({action: 'select-duck-conversation', conversationId: null}));
  accepted(await w.knowledge({action: 'select-duck-conversation', conversationId: exchangeId}));
  const duck = await w.content<HistoryPage>('companion-history', {profile: 'microduck'});
  assert.ok(duck.conversations.some(value => value.id === exchangeId));
  assert.equal(duck.conversations.filter(value => value.profile === 'microduck').length, 3);
  assert.equal((await w.content<DuckWidget>('duck-widget')).conversation?.id, exchangeId);
});

void test('an archive with a profile\'s earlier conversations imports them as earlier ones and keeps the current one', async context => {
  const source = await world(context);
  accepted(await source.control('enable'));
  await exchange(source, 'Synthetic first conversation', reply('First reply'));
  accepted(await source.fresh('bunny'));
  await exchange(source, 'Synthetic second conversation', reply('Second reply'));
  const archive = await source.content<Archive>('companion-archive');
  assert.equal(archive.conversations.filter(value => value.profile === 'bunny').length, 2);
  const [earlier, current] = archive.conversations.filter(value => value.profile === 'bunny').map(value => value.id);
  const target = await world(context);
  accepted(await target.knowledge({action: 'import-archive', archive}));
  assert.equal(target.store().conversation('bunny'), current);
  assert.match(JSON.stringify((await target.recent('bunny', earlier ?? '')).messages), /Synthetic first conversation/);
  // Importing it again into the source, whose current conversation it already names, changes nothing and is accepted.
  accepted(await source.knowledge({action: 'import-archive', archive}));
  assert.equal(source.store().conversation('bunny'), current);
});

void test('on one configured provider each companion gets its own sections, and the preview names that provider for all three (Hub #2026)', async context => {
  const shared = Object.assign(gated(), {name: 'anthropic' as const, model: 'model-a'});
  const w = await world(context, {provider: shared, profileProviders: {}, prices: {'model-a': {input: 1, output: 1, cacheWrite: 1, cacheRead: 1}}});
  accepted(await w.control('enable'));
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    accepted(await w.send(profile, `PRIVATE-${profile} first`));
    (await shared.next()).resolve(reply(`PRIVATE-${profile} reply`));
    await settle(() => w.task(profile)?.status === 'succeeded');
  }
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    const preview = await w.preview(profile);
    assert.deepEqual([preview.provider, preview.model], ['anthropic', 'model-a']);
    accepted(await w.send(profile, `PRIVATE-${profile} follow-up`));
    const next = await shared.next();
    assert.deepEqual(next.input.context.sections, preview.sections, `${profile}: the preview is the next call`);
    assert.equal(next.input.context.profile, profile);
    const recent = text(next.input, 'recent');
    assert.match(recent, new RegExp(`PRIVATE-${profile} first`));
    for (const other of ['bunny', 'reachy', 'microduck'].filter(value => value !== profile)) assert.equal(JSON.stringify(next.input).includes(`PRIVATE-${other}`), false, `${profile} holds nothing of ${other}`);
    next.resolve(reply('Done'));
    await settle(() => w.task(profile)?.status === 'succeeded');
  }
});

void test('an archive round trip keeps each profile\'s current conversation current, wherever it was created', async context => {
  // Store X: B.U.N.N.Y.'s conversations A, then B, which is current.
  const x = await world(context);
  accepted(await x.control('enable'));
  await exchange(x, 'Synthetic conversation A', reply('Reply A'));
  accepted(await x.fresh('bunny'));
  x.advance(60_000);
  await exchange(x, 'Synthetic conversation B', reply('Reply B'));
  const fromX = await x.content<Archive>('companion-archive');
  // Store Z: its own current conversation C, created before it imports X's A and B.
  const z = await world(context);
  accepted(await z.control('enable'));
  await exchange(z, 'Synthetic conversation C', reply('Reply C'));
  const c = z.store().conversation('bunny') ?? assert.fail('conversation C');
  accepted(await z.knowledge({action: 'import-archive', archive: fromX}));
  assert.equal(z.store().conversation('bunny'), c, 'an import never moves the current conversation');
  // The current conversation is listed first, then the rest by their last message, newest first.
  const listed = (await z.content<ConversationList>('conversation', {profile: 'bunny', view: 'list'})).conversations;
  const texts = await Promise.all(listed.map(async value => (await z.recent('bunny', value.conversationId)).messages[0]?.text));
  assert.deepEqual([listed.map(value => value.current), texts], [[true, false, false], ['Synthetic conversation C', 'Synthetic conversation B', 'Synthetic conversation A']]);
  // Z's export lists C last for its profile, so a fresh store restores C as current.
  const fromZ = await z.content<Archive>('companion-archive');
  assert.equal(fromZ.conversations.filter(value => value.profile === 'bunny').at(-1)?.id, c);
  const w = await world(context);
  accepted(await w.knowledge({action: 'import-archive', archive: fromZ}));
  assert.equal(w.store().conversation('bunny'), c);
});

void test('Details lists every conversation in pages: the current one first, then by last activity', async context => {
  const w = await world(context);
  const store = w.store(), ids: string[] = [];
  for (let index = 0; index < 18; index += 1) {
    if (index > 0) store.newConversation('bunny');
    const task = store.newTask('bunny', `Synthetic conversation ${String(index)}`);
    task.status = 'succeeded'; store.save(task);
    store.message(task, `${task.id}-prompt`, 'owner', task.prompt, 1000 + index);
    ids.push(task.conversationId);
  }
  // Conversation 2 gets the newest message of all the earlier ones, as a late confirmation would.
  const late = {...store.newTask('bunny', 'Synthetic late'), conversationId: ids[2] ?? assert.fail('conversation 2')};
  store.message(late, 'synthetic-late-message', 'assistant', 'Synthetic late confirmation', 5000);
  const first = await w.content<ConversationList>('conversation', {profile: 'bunny', view: 'list'});
  assert.equal(first.conversations.length, 16); assert.equal(first.older, 16);
  assert.deepEqual(first.conversations.slice(0, 3).map(value => value.conversationId), [ids[17], ids[2], ids[16]]);
  const second = await w.content<ConversationList>('conversation', {profile: 'bunny', view: 'list', after: String(first.older)});
  assert.deepEqual([second.conversations.map(value => value.conversationId), second.older], [[ids[1], ids[0]], null]);
  assert.equal(new Set([...first.conversations, ...second.conversations].map(value => value.conversationId)).size, 18);
  assert.equal(await w.refusal('conversation', {profile: 'bunny', view: 'list', after: '-1'}), 'invalid-request');
});
