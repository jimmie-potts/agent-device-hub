// Knowledge revision scopes (Hub #2056): each companion knowledge command is checked only against the state it changes,
// so a running conversation's steps never make a library, voice, Duck widget or message command stale. Library entries
// and voices share a library scope, the Duck widget selection has its own, and a message correction or removal uses its
// conversation's change revision (Hub #2027). Enable and disable keep the assistant-wide revision. These tests use gated
// fake providers and the harness's manual clock and scheduler; they wait by yielding turns, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {AssistantProfile, AssistantTaskSummary} from '@jimmie-potts/event-contracts/v2/assistant';
import {InProcessBus, type RequestResult} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import type {Archive, CompanionMessage, Conversation} from '../src/knowledge/model.js';
import type {PreferenceView} from '../src/preferences/model.js';
import type {ModelProvider, TurnInput, TurnReply} from '../src/assistant/provider.js';

const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const read = (id: string): TurnReply => ({text: null, calls: [{id, name: 'read_fixture', input: {}}], stop: 'tool', units: 10});
/** Yields event-loop turns until the check holds; no timer, so the manual clock alone moves time. */
async function settle(check: () => boolean, what = 'expected state arrived'): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {if (check()) return; await new Promise(resolve => {setImmediate(resolve);});}
  assert.ok(check(), what);
}
type Pending = {input: TurnInput; signal: AbortSignal; resolve: (reply: TurnReply) => void};
/** A provider whose every call waits until the test answers it. */
function gated(): ModelProvider & {pending: Pending[]; next: () => Pending} {
  const pending: Pending[] = [];
  return {name: 'synthetic', model: 'synthetic', pending, next: () => pending.shift() ?? assert.fail('no model call is waiting'),
    turn: (input, signal) => new Promise<TurnReply>(resolve => {pending.push({input, signal, resolve});})};
}
async function world(context: TestContext) {
  const providers = {bunny: gated(), reachy: gated(), microduck: gated()};
  const options: CompanionsOptions = {provider: providers.bunny, profileProviders: {reachy: providers.reachy, microduck: providers.microduck}};
  const now = Date.parse('2026-11-23T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-scopes-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
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
  /** The revision the page reads from the knowledge view, which is the assistant revision. */
  const seen = async () => (await content<PreferenceView>('knowledge', {view: 'manage'})).revision;
  const control = (action: string, extra: Record<string, unknown> = {}): Promise<RequestResult> => {
    const requestId = randomUUID();
    return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
      dataschema: `https://bunny.invalid/events/assistant-control/${action === 'rename' ? '2.1' : '2.0'}`, data: {requestId, action, expectedRevision: state().revision, ...extra}},
    {requestId, timeoutMs: 5000});
  };
  const start = async (profile: AssistantProfile, text: string): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'start', profile, expectedRevision: state().revision, text}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  /** One knowledge command bound to the revision the page read. */
  const knowledge = async (input: object, expectedRevision: number): Promise<RequestResult> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'knowledge', name: 'knowledge.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({...input, expectedRevision}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.knowledge', {type: 'org.bunny.assistant.input.requested', subject: 'knowledge',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  /** Lets the running B.U.N.N.Y. turn take one step: its waiting call reads the fixture, which saves the task and moves the revision. */
  const step = async (id: string) => {
    const before = state().revision;
    providers.bunny.next().resolve(read(id));
    await settle(() => providers.bunny.pending.length === 1 && state().revision > before, 'the running conversation took a step');
  };
  /** A finished Reachy turn, a Reachy-Duck exchange and a running B.U.N.N.Y. turn with one model call waiting. */
  const running = async () => {
    assert.equal((await control('enable')).status, 'accepted');
    assert.equal((await start('reachy', 'Synthetic reachy request')).status, 'accepted');
    await settle(() => providers.reachy.pending.length === 1);
    providers.reachy.next().resolve(reply('Synthetic reachy answer'));
    await settle(() => task('reachy')?.status === 'succeeded');
    assert.equal((await knowledge({action: 'fixture'}, await seen())).status, 'accepted');
    assert.equal((await start('bunny', 'Synthetic bunny request')).status, 'accepted');
    await settle(() => providers.bunny.pending.length === 1);
  };
  const history = async (profile: AssistantProfile, owned: boolean) => {
    const list = await content<{conversations: Conversation[]}>('companion-history', {profile});
    const id = list.conversations.find(conversation => owned ? conversation.profile === profile : conversation.profile === null)?.id ?? assert.fail(`a ${profile} conversation`);
    return {id, messages: (await content<{messages: CompanionMessage[]}>('companion-history', {profile, conversationId: id})).messages};
  };
  return {providers, state, task, content, seen, control, start, knowledge, step, running,
    exchange: () => history('microduck', false), own: (profile: AssistantProfile) => history(profile, true),
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
const code = (result: RequestResult): string | undefined => result.status === 'rejected' ? result.error.error.code : undefined;

void test('a running conversation\'s steps never make a library, voice or Duck widget command stale, while a change in its own scope does', async context => {
  const w = await world(context);
  await w.running();
  const {id: duck} = await w.exchange();
  const seen = await w.seen();
  await w.step('call-library');
  // Negative control: the assistant-wide check, which enable and disable keep, refuses the revision the page read.
  assert.equal(code(await w.control('disable', {expectedRevision: seen})), 'revision-conflict', 'the assistant revision moved past the one the page read');
  // The library scope covers knowledge entries and voices.
  assert.equal((await w.knowledge({action: 'create', title: 'Synthetic Frank', text: 'Frank is a fictional friend.'}, seen)).status, 'accepted', 'a create');
  const entry = (await w.content<PreferenceView>('knowledge', {view: 'manage'})).entries[0] ?? assert.fail('the created entry');
  assert.equal(code(await w.knowledge({action: 'edit', id: entry.id, title: 'Synthetic Frank', text: 'Stale text.'}, seen)), 'revision-conflict', 'a stale edit');
  assert.equal(code(await w.knowledge({action: 'set-voice', persona: 'reachy', voiceRef: 'synthetic-voice-a'}, seen)), 'revision-conflict', 'a stale voice');
  // The Duck widget has its own scope: a library change leaves it current, a selection does not.
  assert.equal((await w.knowledge({action: 'select-duck-conversation', conversationId: duck}, seen)).status, 'accepted', 'a Duck selection');
  assert.equal(code(await w.knowledge({action: 'select-duck-conversation', conversationId: null}, seen)), 'revision-conflict', 'a stale Duck selection');
  // After more steps, each scope's next command names the revision read after that scope's last change.
  const later = await w.seen();
  await w.step('call-voice');
  assert.equal((await w.knowledge({action: 'set-voice', persona: 'reachy', voiceRef: 'synthetic-voice-a'}, later)).status, 'accepted', 'a voice');
  assert.equal((await w.knowledge({action: 'select-duck-conversation', conversationId: null}, later)).status, 'accepted', 'a Duck clearing');
  const voiced = await w.seen();
  await w.step('call-active');
  assert.equal((await w.knowledge({action: 'set-active', id: entry.id, active: false}, voiced)).status, 'accepted', 'a set-active');
  assert.equal(code(await w.knowledge({action: 'set-voice', persona: 'reachy', voiceRef: null}, voiced)), 'revision-conflict', 'a voice after set-active');
  const exported = await w.content<{entries: unknown[]}>('knowledge', {view: 'export'});
  const library = await w.seen();
  await w.step('call-import');
  assert.equal((await w.knowledge({action: 'import', library: {...exported, schema: 'knowledge-library/1.0'}}, library)).status, 'accepted', 'a standalone import');
  // A revision the assistant has not reached is refused in every scope.
  const ahead = w.state().revision + 1;
  assert.equal(code(await w.knowledge({action: 'create', title: 'Synthetic ahead', text: 'Ahead.'}, ahead)), 'revision-conflict');
  assert.equal(code(await w.knowledge({action: 'select-duck-conversation', conversationId: duck}, ahead)), 'revision-conflict');
  assert.equal(w.task('bunny')?.status, 'running', 'the conversation kept running throughout');
});

void test('a message correction or removal is checked against its own conversation\'s changes only', async context => {
  const w = await world(context);
  await w.running();
  const {messages: [first, second, third]} = await w.exchange();
  assert.ok(first !== undefined && second !== undefined && third !== undefined);
  const [reachyOwner] = (await w.own('reachy')).messages;
  assert.ok(reachyOwner !== undefined);
  const seen = await w.seen();
  await w.step('call-messages');
  assert.equal(code(await w.control('disable', {expectedRevision: seen})), 'revision-conflict', 'negative control: the assistant-wide check refuses');
  // Another conversation's steps never make a correction or removal stale.
  assert.equal((await w.knowledge({action: 'correct-message', messageId: first.messageId, meaning: {kind: 'literal', text: 'Synthetic corrected', language: 'en'}}, seen)).status,
    'accepted', 'a correction');
  assert.equal((await w.knowledge({action: 'correct-message', messageId: reachyOwner.messageId, meaning: {kind: 'unknown'}}, seen)).status, 'accepted',
    'a correction in another, finished conversation');
  // A correction or removal counts as a change of its conversation.
  assert.equal(code(await w.knowledge({action: 'correct-message', messageId: second.messageId, meaning: {kind: 'unknown'}}, seen)), 'revision-conflict', 'a stale correction');
  assert.equal(code(await w.knowledge({action: 'delete-message', messageId: third.messageId}, seen)), 'revision-conflict', 'a stale removal');
  assert.equal(code(await w.control('rename', {profile: 'reachy', title: 'Synthetic stale title', expectedRevision: seen})), 'revision-conflict',
    'the corrected conversation changed for its other commands too');
  assert.equal((await w.control('rename', {profile: 'microduck', title: 'Synthetic duck title', expectedRevision: seen})).status, 'accepted', 'another conversation is unaffected');
  const corrected = await w.seen();
  await w.step('call-removal');
  assert.equal((await w.knowledge({action: 'delete-message', messageId: third.messageId}, corrected)).status, 'accepted', 'a removal');
  assert.equal((await w.exchange()).messages.some(message => message.messageId === third.messageId), false);
  assert.equal(code(await w.knowledge({action: 'correct-message', messageId: second.messageId, meaning: {kind: 'unknown'}}, w.state().revision + 1)), 'revision-conflict',
    'a revision the assistant has not reached');
});

void test('a message in the running conversation is stale after that conversation\'s own step', async context => {
  const w = await world(context);
  await w.running();
  // B.U.N.N.Y.'s first turn finishes and its next one runs; the first turn's messages can be corrected.
  w.providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  assert.equal((await w.start('bunny', 'Synthetic bunny follow-up')).status, 'accepted');
  await settle(() => w.providers.bunny.pending.length === 1);
  const [owner] = (await w.own('bunny')).messages;
  assert.ok(owner !== undefined);
  const seen = await w.seen();
  await w.step('call-own');
  assert.equal(code(await w.knowledge({action: 'correct-message', messageId: owner.messageId, meaning: {kind: 'unknown'}}, seen)), 'revision-conflict');
  assert.equal((await w.knowledge({action: 'correct-message', messageId: owner.messageId, meaning: {kind: 'unknown'}}, await w.seen())).status, 'accepted');
});

void test('an archive import is checked against the library and each conversation it changes, and a fixture against the library', async context => {
  const w = await world(context);
  await w.running();
  const exported = await w.content<Archive>('companion-archive');
  const {id: duck, messages: [first]} = await w.exchange();
  assert.ok(first !== undefined);
  const seen = await w.seen();
  await w.step('call-archive');
  assert.equal(code(await w.control('disable', {expectedRevision: seen})), 'revision-conflict', 'negative control: the assistant-wide check refuses');
  // The archive repeats B.U.N.N.Y.'s running conversation as exported, so the import does not change it.
  assert.ok(exported.conversations.some(conversation => conversation.profile === 'bunny'));
  assert.equal((await w.knowledge({action: 'import-archive', archive: exported}, seen)).status, 'accepted', 'an import while a conversation runs');
  assert.equal(code(await w.knowledge({action: 'fixture'}, seen)), 'revision-conflict', 'a fixture after the import changed the library');
  const imported = await w.seen();
  await w.step('call-fixture');
  assert.equal((await w.knowledge({action: 'fixture'}, imported)).status, 'accepted', 'a fixture while a conversation runs');
  assert.equal(code(await w.knowledge({action: 'import-archive', archive: exported}, imported)), 'revision-conflict', 'an import after the fixture changed the library');
  // A conversation that the import would add a message to changed after the revision read.
  const read = await w.seen();
  await w.step('call-archive-2');
  assert.equal((await w.knowledge({action: 'correct-message', messageId: first.messageId, meaning: {kind: 'unknown'}}, read)).status, 'accepted');
  const current = await w.content<Archive>('companion-archive');
  const template = current.messages.find(message => message.conversationId === duck) ?? assert.fail('an exchange message');
  const added = {...current, messages: [...current.messages, {...template, messageId: 'synthetic-added', ordering: {...template.ordering, sequence: 99}}]};
  assert.equal(code(await w.knowledge({action: 'import-archive', archive: added}, read)), 'revision-conflict', 'after a conversation it changes changed');
  assert.equal((await w.knowledge({action: 'import-archive', archive: added}, await w.seen())).status, 'accepted');
  assert.ok((await w.exchange()).messages.some(message => message.messageId === 'synthetic-added'));
  assert.equal(code(await w.knowledge({action: 'fixture'}, w.state().revision + 1)), 'revision-conflict', 'a fixture naming a revision ahead');
});

void test('a start counts the library, the Duck widget and every conversation as changed at its revision', async context => {
  const w = await world(context);
  await w.running();
  w.providers.bunny.next().resolve(reply('Synthetic bunny answer'));
  await settle(() => w.task('bunny')?.status === 'succeeded');
  const {id: duck, messages: [first]} = await w.exchange();
  assert.ok(first !== undefined);
  const before = await w.seen();
  assert.equal((await w.knowledge({action: 'create', title: 'Synthetic Frank', text: 'Frank.'}, before)).status, 'accepted');
  const seen = await w.seen();
  // Before a restart, the Duck widget and the exchange are current for a revision older than the library change.
  assert.equal((await w.knowledge({action: 'select-duck-conversation', conversationId: duck}, before)).status, 'accepted');
  const selected = await w.seen();
  await w.restart();
  assert.equal(await w.seen(), selected, 'the start itself moved no revision');
  assert.equal(code(await w.knowledge({action: 'create', title: 'Synthetic Frank', text: 'Frank.'}, seen)), 'revision-conflict', 'the library');
  assert.equal(code(await w.knowledge({action: 'select-duck-conversation', conversationId: null}, seen)), 'revision-conflict', 'the Duck widget');
  assert.equal(code(await w.knowledge({action: 'correct-message', messageId: first.messageId, meaning: {kind: 'unknown'}}, seen)), 'revision-conflict',
    'a conversation without a profile');
  assert.equal((await w.knowledge({action: 'correct-message', messageId: first.messageId, meaning: {kind: 'unknown'}}, selected)).status, 'accepted');
  assert.equal((await w.knowledge({action: 'select-duck-conversation', conversationId: null}, selected)).status, 'accepted');
  assert.equal((await w.knowledge({action: 'create', title: 'Synthetic Frank', text: 'Frank.'}, selected)).status, 'accepted');
});
