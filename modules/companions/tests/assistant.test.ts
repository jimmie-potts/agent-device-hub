import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {ModeState, SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {test, type TestContext} from 'node:test';
import {fullDisk, InProcessBus, type Participant, type ModuleContext, type RequestResult} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import {CONTEXT_TOO_LARGE, DECLINED, REFUSED} from '../src/assistant/engine.js';
import {PreferenceStore} from '../src/preferences/store.js';
import {ProviderFault, type ModelProvider, type TurnInput, type TurnReply} from '../src/assistant/provider.js';
import {SyntheticProvider, SYNTHETIC_QUESTION} from '../src/assistant/synthetic.js';
import type {SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {FIXTURE_TEXT} from '../src/assistant/tools.js';

function deferred<T>() {let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.ok(check(), 'expected task state arrived');
}
/** A provider under test: the synthetic script, or a scripted list of replies, with every turn counted. */
function counted(script?: (input: TurnInput, turn: number, signal: AbortSignal) => TurnReply | Promise<TurnReply>): ModelProvider & {calls: () => number; inputs: TurnInput[]} {
  const synthetic = new SyntheticProvider(); let calls = 0; const inputs: TurnInput[] = [];
  return {name: 'synthetic', model: 'synthetic', calls: () => calls, inputs, turn: (input, signal) => {calls += 1; inputs.push(input); return script === undefined ? synthetic.turn(input) : Promise.resolve(script(input, calls, signal));}};
}
const reply = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const call = (name: string, input: Record<string, unknown> = {}, id = `call-${name}`): TurnReply => ({text: null, calls: [{id, name, input}], stop: 'tool', units: 10});
const hub = (revision: number, mode: ModeState['mode'] = 'work'): ModeState => ({id: 'hub', revision, mode, selectedAtMs: 0});
const session = (label: string): SessionRecord => ({id: 'session-1', revision: 1, generation: 1, identity: {provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'desktop', sessionId: 's-1'},
  parent: {status: 'top-level'}, turn: {status: 'unknown'}, activity: 'active', attention: [{id: {status: 'known', id: 'a-1'}, kind: 'approval', turn: {status: 'unknown'}}], notices: [], read: 'unknown', unavailable: [],
  ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000, freshness: 'current', restartUncertain: false, children: {active: 0, uncertain: 0}, label: {value: label, origin: 'user'}});
const accepted = (requestId: string): RequestResult => ({status: 'accepted', requestId, reply: {} as never});
async function world(context: TestContext, options: CompanionsOptions = {}, adapt: (context: ModuleContext) => ModuleContext = context => context) {
  const spans = new RecordedSpans();
  let now = Date.now();
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-owner-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const make = () => {const module = createCompanionsModule(options); return {module, host: new ModuleHarness({...module, start: context => module.start(adapt(context))}, {bus, stateDir: dir, spans, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {core, bus, spans, advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}}, store: () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database')), module: () => module, host: () => host, restart: async () => {
    await host.stop(); ({module, host} = make()); await host.start();
  }};
}
async function control(core: Participant, module: CompanionsModule, action: string, taskId?: string, requestId = randomUUID(), extra: Record<string, unknown> = {}) {
  return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action, expectedRevision: module.inspectAssistant()?.revision, ...(taskId === undefined ? {} : {taskId}), ...extra}}, {requestId, timeoutMs: 5000});
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
const task = (w: {module: () => CompanionsModule}) => w.module().inspectAssistant()?.tasks[0];
const status = (w: {module: () => CompanionsModule}) => task(w)?.status;
async function page(w: {module: () => CompanionsModule}, profile = 'bunny') {
  const content = await w.module().manifest.content?.('conversation', {query: {profile}, signal: new AbortController().signal});
  assert.ok(content !== undefined && !('error' in content));
  return JSON.parse(Buffer.from(content.bytes).toString()) as {messages: {role: string; text: string}[]; currentTask: {question: {kind: string; proposal: {data: {mode: string}; expectedRevision: number | null} | null; answer: string | null} | null} | null};
}

void test('private task pauses, restarts without execution and consumes an explicit saved answer in a new run', async context => {
  const provider = counted();
  const w = await world(context, {provider});
  assert.equal(w.module().inspectAssistant()?.enabled, false);
  assert.deepEqual([w.module().inspectAssistant()?.provider, w.module().inspectAssistant()?.model, w.module().inspectAssistant()?.tools], ['synthetic', 'synthetic', []]);
  const enabled = await control(w.core, w.module(), 'enable'); assert.equal(enabled.status, 'accepted', JSON.stringify(enabled));
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-PROMPT')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  const first = task(w); assert.ok(first);
  assert.equal(provider.calls(), 1);
  assert.equal((await page(w)).currentTask?.question?.kind, 'clarification');
  await w.restart();
  assert.equal(provider.calls(), 1); assert.equal(task(w)?.questionId, first.questionId);
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  const last = task(w); assert.ok(last);
  assert.equal(last.taskId, first.taskId); assert.equal(last.conversationId, first.conversationId); assert.notEqual(last.runId, first.runId);
  assert.equal(provider.calls(), 3); assert.equal(last.modelCalls, 3); assert.equal(last.toolCalls, 1); assert.equal(last.questions, 1);
  const saved = await page(w);
  assert.deepEqual(saved.messages.map(message => message.role), ['owner', 'assistant', 'owner', 'tool', 'assistant']);
  assert.match(JSON.stringify(saved), /PRIVATE-SYNTHETIC-PROMPT/); assert.match(JSON.stringify(saved), /PRIVATE-SYNTHETIC-ANSWER/);
  assert.ok(saved.messages.some(message => message.role === 'tool' && message.text === FIXTURE_TEXT));
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-SYNTHETIC'), false);
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC'), false);
  // The provider saw only the owner's text, the tool results and the fixed instructions: no preference, knowledge or key.
  assert.ok(provider.inputs.every(turn => turn.transcript.every(item => item.role !== 'owner' || item.text.startsWith('PRIVATE-SYNTHETIC'))));
});

void test('an approved proposal dispatches one mode-set bound to the proposal and its recorded revision', async context => {
  const dispatched: {requestId: string; data: {mode: string; expectedRevision?: number}}[] = [];
  const provider = counted();
  const w = await world(context, {provider, tools: ['read_sessions', 'set_mode'], core: () => ({sessions: [], mode: hub(7), synced: true}),
    dispatch: data => {dispatched.push({requestId: data.requestId, data: data.data}); return Promise.resolve(accepted(data.requestId));}});
  assert.deepEqual(w.module().inspectAssistant()?.tools, ['read_sessions', 'set_mode']);
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Please switch the Hub to free mode')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  const proposal = (await page(w)).currentTask?.question;
  assert.equal(proposal?.kind, 'approval'); assert.deepEqual(proposal?.proposal, {family: 'mode-set', target: 'hub', data: {mode: 'free'}, expectedRevision: 7});
  assert.equal(task(w)?.questions, 1);
  await w.restart();
  assert.deepEqual((await page(w)).currentTask?.question?.proposal?.data, {mode: 'free'}); assert.equal(dispatched.length, 0);
  const free = await input(w.core, w.module(), 'yes please', true); assert.equal(free.status, 'rejected');
  if (free.status === 'rejected') assert.equal(free.error.error.code, 'invalid-request');
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(dispatched.length, 1); assert.deepEqual(dispatched[0]?.data, {mode: 'free', expectedRevision: 7});
  assert.equal(dispatched[0]?.requestId, `${task(w)?.taskId ?? ''}-step-1`);
  const final = (await page(w)).messages.at(-1); assert.ok(final);
  assert.match(final.text, /accepted by the core, outcome tracked separately: accepted/); assert.equal(task(w)?.toolCalls, 1); assert.equal(task(w)?.modelCalls, 2);
  await w.restart(); assert.equal(dispatched.length, 1);
});

void test('a declined proposal sends nothing and a stale approval is reported as refused', async context => {
  let answer: RequestResult = {status: 'rejected', requestId: 'r', error: errorBody('revision-conflict')}; let sends = 0;
  const w = await world(context, {provider: counted(), tools: ['set_mode'], core: () => ({sessions: [], mode: hub(3), synced: true}), dispatch: () => {sends += 1; return Promise.resolve(answer);}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'quiet mode now'); await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'decline', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(sends, 0); assert.equal(task(w)?.toolCalls, 0);
  const declined = await page(w); assert.equal(declined.messages.at(-1)?.text.includes(DECLINED), true);
  await input(w.core, w.module(), 'back to work mode'); await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(sends, 1); assert.match((await page(w)).messages.at(-1)?.text ?? '', /not applied: refused: revision-conflict/);
  // The dispatcher's own uncertainty reaches the module as a rejection carrying `uncertain-result`, the shape the SDK delivers for a responder's error body.
  answer = {status: 'rejected', requestId: 'r', error: errorBody('uncertain-result')};
  await input(w.core, w.module(), 'free mode'); await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true); await until(() => status(w) === 'uncertain');
  assert.equal(task(w)?.code, 'uncertain-result');
  const id = task(w)?.taskId; assert.ok(id !== undefined);
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected'); assert.equal(sends, 2);
  assert.equal(JSON.stringify(await page(w)).includes('refused: uncertain-result'), false);
  await control(w.core, w.module(), 'cancel', id); await until(() => status(w) === 'cancelled');
  answer = {status: 'uncertain', requestId: 'r', error: errorBody('uncertain-result')};
  await input(w.core, w.module(), 'quiet mode'); await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true); await until(() => status(w) === 'uncertain'); assert.equal(sends, 3);
});

void test('a proposal needs a synced Hub-mode revision and a real mode, otherwise the call is refused to the model without a question', async context => {
  let sends = 0; const script = (_input: TurnInput, turn: number): TurnReply => turn === 1 ? call('set_mode', {mode: 'quiet'}) : reply('Done');
  const unsynced = await world(context, {provider: counted(script), tools: ['set_mode'], core: () => ({sessions: [], mode: undefined, synced: false}), dispatch: () => {sends += 1; return Promise.resolve(accepted('x'));}});
  await control(unsynced.core, unsynced.module(), 'enable'); await input(unsynced.core, unsynced.module(), 'quiet mode');
  await until(() => status(unsynced) === 'succeeded');
  assert.equal(sends, 0); assert.equal(task(unsynced)?.questions, 0); assert.equal(task(unsynced)?.toolCalls, 0);
  assert.match((await page(unsynced)).messages.find(message => message.role === 'tool')?.text ?? '', /not synced/);
  const party = await world(context, {provider: counted((_input, turn) => turn === 1 ? call('set_mode', {mode: 'party'}) : reply('Done')), tools: ['set_mode'], core: () => ({sessions: [], mode: hub(1), synced: true}), dispatch: () => {sends += 1; return Promise.resolve(accepted('x'));}});
  await control(party.core, party.module(), 'enable'); await input(party.core, party.module(), 'party mode');
  await until(() => status(party) === 'succeeded');
  assert.equal(sends, 0); assert.equal(task(party)?.questions, 0);
  assert.match((await page(party)).messages.find(message => message.role === 'tool')?.text ?? '', /not work, free or quiet/);
});

void test('a lost provider answer leaves the call uncertain, and the model\'s own blocks are replayed with the first call only', async context => {
  const provider = counted(() => {throw new ProviderFault('unavailable', true);});
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic lost answer');
  await until(() => status(w) === 'uncertain');
  assert.equal(task(w)?.code, 'uncertain-result'); assert.equal(task(w)?.usageUnits, null);
  const id = task(w)?.taskId; assert.ok(id !== undefined);
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
  const blocks = [{type: 'thinking', thinking: '', signature: 'sig-1'}, {type: 'text', text: 'Checking.'}, {type: 'tool_use', id: 'toolu_1', name: 'read_sessions', input: {}}];
  const scripted = counted((input, turn) => turn === 1 ? {text: 'Checking.', calls: [{id: 'toolu_1', name: 'read_sessions', input: {}}], stop: 'tool', units: 3, blocks} : reply(`Replayed ${String(input.transcript.filter(item => item.role === 'assistant' && item.blocks !== undefined).length)}`));
  const replay = await world(context, {provider: scripted, tools: ['read_sessions'], core: () => ({sessions: [], mode: hub(1), synced: true})});
  await control(replay.core, replay.module(), 'enable'); await input(replay.core, replay.module(), 'status');
  await until(() => status(replay) === 'succeeded');
  assert.deepEqual(scripted.inputs[1]?.transcript[1], {role: 'assistant', text: 'Checking.', calls: [{id: 'toolu_1', name: 'read_sessions', input: {}}], blocks, effect: `${task(replay)?.taskId ?? ''}-step-0`});
  assert.match((await page(replay)).messages.at(-1)?.text ?? '', /Replayed 1/);
});

void test('expected cancellation before call admission uses info severity', async context => {
  const stopped = new AbortController();
  const w = await world(context, {}, context => ({...context, signal: stopped.signal, log: {...context.log, info: (event, fields, trace) => {
    context.log.info(event, fields, trace); if (event === 'assistant.run.started') stopped.abort();
  }}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic cancelled activation');
  await until(() => w.host().logs.some(record => record.event === 'assistant.run.settled'));
  assert.equal(status(w), 'paused');
  const log = w.host().logs.find(record => record.event === 'assistant.run.settled'); assert.ok(log);
  assert.equal(log.fields['bunny.code'], 'cancelled'); assert.equal(log.level, 'info');
  assert.equal(task(w)?.modelCalls, 0);
});

void test('a command the section does not allow is refused to the model without an effect, and reads need no approval', async context => {
  let sends = 0; const script = (input: TurnInput, turn: number): TurnReply => turn === 1 ? call('set_mode', {mode: 'free'}) : turn === 2 ? call('read_sessions') : reply(`Done: ${input.transcript.filter(item => item.role === 'tool').map(item => item.role === 'tool' ? item.result : '').join(' | ')}`);
  const w = await world(context, {provider: counted(script), tools: ['read_sessions'], core: () => ({sessions: [session('PRIVATE-LABEL')], mode: hub(1), synced: true}), dispatch: () => {sends += 1; return Promise.resolve(accepted('x'));}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'free mode and status');
  await until(() => status(w) === 'succeeded');
  assert.equal(sends, 0); assert.equal(task(w)?.toolCalls, 1); assert.equal(task(w)?.modelCalls, 3); assert.equal(task(w)?.questions, 0);
  const saved = await page(w), final = saved.messages.at(-1)?.text ?? '';
  assert.match(final, /not permitted/); assert.match(final, /PRIVATE-LABEL \(codex, desktop\): active; waiting for approval/);
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-LABEL'), false);
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-LABEL'), false);
  const unsynced = await world(context, {provider: counted(script), tools: ['read_sessions'], core: () => ({sessions: [session('x')], mode: undefined, synced: false})});
  await control(unsynced.core, unsynced.module(), 'enable'); await input(unsynced.core, unsynced.module(), 'status');
  await until(() => status(unsynced) === 'succeeded');
  assert.match((await page(unsynced)).messages.at(-1)?.text ?? '', /not synced/);
});

void test('provider refusal, truncation, faults and oversized text end the task with a registry code and no fallback', async context => {
  for (const [script, code, text] of [
    [(): TurnReply => ({text: 'Declined', calls: [], stop: 'refusal', units: 5}), 'forbidden', REFUSED],
    [(): TurnReply => ({text: 'cut', calls: [], stop: 'truncated', units: 5}), 'capacity', undefined],
    [(): TurnReply => {throw new ProviderFault('unauthenticated');}, 'unauthenticated', undefined],
    [(): TurnReply => reply('x'.repeat(8193)), 'capacity', undefined],
  ] as const) {
    const provider = counted(script);
    const w = await world(context, {provider});
    await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic failure');
    await until(() => status(w) === 'failed');
    assert.equal(task(w)?.code, code); assert.equal(provider.calls(), 1);
    if (text !== undefined) assert.equal((await page(w)).messages.at(-1)?.text, text);
    await w.restart(); assert.equal(status(w), 'failed'); assert.equal(provider.calls(), 1);
  }
});

void test('each model call carries the bunny persona and the owner\'s active preferences as they are now, and nothing else about the owner', async context => {
  const provider = counted((_input, turn) => turn === 1 ? call('ask_owner', {text: 'Which detail?'}) : reply('Done'));
  const w = await world(context, {provider});
  const database = w.host().moduleDatabase() ?? assert.fail('open database');
  const preferences = new PreferenceStore(database), knowledge = new PreferenceStore(database, 'knowledge');
  const change = (store: PreferenceStore, action: Record<string, unknown>) => {store.apply({expectedRevision: store.revision(), ...action} as never, Date.now()); store.bump();};
  change(preferences, {action: 'create', title: 'Tea', text: 'PRIVATE-PREFERENCE-TEA'});
  change(preferences, {action: 'create', title: 'Lights', text: 'PRIVATE-PREFERENCE-LIGHTS'});
  change(preferences, {action: 'create', title: 'Old', text: 'PRIVATE-PREFERENCE-OLD'});
  change(preferences, {action: 'set-active', id: preferences.entries()[2]?.id, active: false});
  change(knowledge, {action: 'create', title: 'Neighbour', text: 'PRIVATE-KNOWLEDGE-NEIGHBOUR'});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-PROMPT');
  await until(() => task(w)?.status === 'waiting');
  // Between the two calls the owner edits one preference and stops using another: the next call reads the current records.
  change(preferences, {action: 'edit', id: preferences.entries()[0]?.id, title: 'Tea', text: 'PRIVATE-PREFERENCE-TEA-EDITED'});
  change(preferences, {action: 'set-active', id: preferences.entries()[1]?.id, active: false});
  await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true);
  await until(() => status(w) === 'succeeded');
  assert.equal(provider.calls(), 2);
  assert.deepEqual(provider.inputs[0]?.context, {persona: {name: 'B.U.N.N.Y.', character: 'Helpful generalist. Be clear about what is known and unknown.'},
    preferences: [{title: 'Tea', text: 'PRIVATE-PREFERENCE-TEA'}, {title: 'Lights', text: 'PRIVATE-PREFERENCE-LIGHTS'}]});
  assert.deepEqual(provider.inputs[1]?.context.preferences, [{title: 'Tea', text: 'PRIVATE-PREFERENCE-TEA-EDITED'}]);
  const seen = JSON.stringify(provider.inputs.map(turn => turn.context));
  assert.equal(seen.includes('PRIVATE-PREFERENCE-OLD'), false); assert.equal(seen.includes('PRIVATE-KNOWLEDGE'), false); assert.equal(seen.includes('PRIVATE-SYNTHETIC'), false);
  for (const record of [w.module().inspectAssistant(), w.host().logs, w.spans.spans, w.store().task(task(w)?.taskId ?? '')]) assert.equal(JSON.stringify(record).includes('PRIVATE-PREFERENCE'), false);
  // Over the bound the call is refused before it leaves, the task ends with the capacity code and the owner reads why.
  for (let i = 0; i < 5; i += 1) change(preferences, {action: 'create', title: `Long ${String(i)}`, text: 'p'.repeat(4000)});
  await input(w.core, w.module(), 'Again');
  await until(() => status(w) === 'failed');
  assert.equal(task(w)?.code, 'capacity'); assert.equal(provider.calls(), 2);
  assert.equal((await page(w)).messages.at(-1)?.text, CONTEXT_TOO_LARGE);
});

void test('Reachy and MicroDuck keep the synthetic provider while bunny uses the configured one', async context => {
  const provider = counted(() => reply('Configured answer'));
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Synthetic reachy', false, randomUUID(), {profile: 'reachy'})).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.status === 'waiting');
  assert.equal(provider.calls(), 0);
  assert.equal((await page(w, 'reachy')).currentTask?.question?.kind, 'clarification');
  assert.match(JSON.stringify(await page(w, 'reachy')), new RegExp(SYNTHETIC_QUESTION));
});

void test('cancel fences a running call and records a late reply without running the next node', async context => {
  const result = deferred<TurnReply>(); const provider = counted(() => result.promise);
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic cancel');
  await until(() => provider.calls() === 1);
  const started = task(w); assert.ok(started);
  const stopped = await control(w.core, w.module(), 'cancel', started.taskId); assert.equal(stopped.status, 'accepted');
  await until(() => w.spans.named('bunny.assistant.run').every(span => span.endedAtMs !== undefined));
  result.resolve(reply('Synthetic late reply'));
  await until(() => w.store().calls(started.taskId)[0]?.result !== null);
  assert.equal(status(w), 'cancelled'); assert.equal(provider.calls(), 1);
  assert.equal(task(w)?.toolCalls, 0);
  assert.equal(task(w)?.activeMs, LIMITS.modelMs);
  await w.restart(); assert.equal(provider.calls(), 1); assert.equal(status(w), 'cancelled');
});

void test('deadline keeps unknown usage and reserved time across restart, then explicit resume reuses late evidence', async context => {
  const result = deferred<TurnReply>(); const provider = counted((_input, turn) => turn === 1 ? result.promise : new SyntheticProvider().turn(_input));
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic deadline');
  await until(() => provider.calls() === 1); w.advance(LIMITS.modelMs);
  await until(() => status(w) === 'uncertain');
  const first = task(w); assert.ok(first);
  assert.equal(first.usageUnits, null); assert.equal(first.reservedUnits, LIMITS.callUnits); assert.equal(first.activeMs, LIMITS.modelMs);
  const refused = await control(w.core, w.module(), 'resume', first.taskId); assert.equal(refused.status, 'rejected');
  result.resolve(call('ask_owner', {text: 'Late question?'}));
  await until(() => w.store().calls(first.taskId)[0]?.status === 'succeeded');
  assert.equal(status(w), 'uncertain');
  await w.restart(); assert.equal(provider.calls(), 1);
  assert.equal((await control(w.core, w.module(), 'resume', first.taskId)).status, 'accepted');
  await until(() => status(w) === 'waiting');
  assert.equal(provider.calls(), 1); assert.equal((await page(w)).currentTask?.question?.answer, null);
  assert.equal((await input(w.core, w.module(), 'Synthetic answer', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(provider.calls(), 3); assert.equal(task(w)?.modelCalls, 3);
  assert.equal(task(w)?.activeMs, LIMITS.modelMs);
});

void test('startup projects an interrupt and saved answer without invoking the graph', async context => {
  const provider = counted();
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic projection');
  await until(() => status(w) === 'waiting');
  const first = task(w); assert.ok(first);
  const store = w.store(), saved = store.task(first.taskId); assert.ok(saved?.question);
  // Recreate the domain side of a crash after the interrupt checkpoint, before its status projection.
  saved.status = 'running'; store.save(saved);
  await w.restart(); assert.equal(provider.calls(), 1); assert.equal(task(w)?.questionId, first.questionId); assert.equal(status(w), 'waiting');
  const answered = w.store().task(first.taskId); assert.ok(answered?.question);
  answered.question.answer = 'Synthetic durably saved answer'; answered.status = 'running'; w.store().save(answered);
  await w.restart(); assert.equal(provider.calls(), 1); assert.equal(status(w), 'paused');
  assert.equal(task(w)?.hasAnswer, true);
  assert.equal((await control(w.core, w.module(), 'resume', first.taskId)).status, 'accepted');
  await until(() => status(w) === 'succeeded'); assert.equal(provider.calls(), 3);
});

void test('duplicate controls and stale, wrong-question or cross-profile input never repeat calls', async context => {
  const provider = counted();
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable');
  const requestId = randomUUID(), revision = w.module().inspectAssistant()?.revision;
  const staged = await w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: revision, text: 'Synthetic idempotence'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const send = () => w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  assert.equal((await send()).status, 'accepted');
  await until(() => status(w) === 'waiting');
  assert.equal((await send()).status, 'accepted'); assert.equal(provider.calls(), 1);
  for (const extra of [{questionId: 'wrong'}, {profile: 'reachy'}, {expectedRevision: 0}]) {
    assert.equal((await input(w.core, w.module(), 'Synthetic refused', true, randomUUID(), extra)).status, 'rejected');
  }
  assert.equal(provider.calls(), 1); assert.equal(task(w)?.hasAnswer, false);
  assert.equal((await input(w.core, w.module(), 'Synthetic second unfinished')).status, 'rejected');
  assert.equal(w.store().latest().length, 1);
});

void test('per-task counters and usage ceilings survive restart and refuse calls before dispatch', async context => {
  for (const patch of [{modelCalls: LIMITS.modelCalls}, {toolCalls: LIMITS.toolCalls}, {reservedUnits: LIMITS.units}, {activeMs: LIMITS.activeMs}]) {
    const provider = counted();
    const w = await world(context, {provider});
    await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic budget');
    await until(() => status(w) === 'waiting');
    const id = task(w)?.taskId; assert.ok(id !== undefined); const saved = w.store().task(id); assert.ok(saved);
    Object.assign(saved, patch); w.store().save(saved); await w.restart();
    const answer = await input(w.core, w.module(), 'Synthetic answer', true);
    if (answer.status === 'accepted') await until(() => status(w) === 'failed');
    else assert.equal(answer.status, 'rejected');
    assert.equal(provider.calls(), 'toolCalls' in patch ? 2 : 1); assert.equal(task(w)?.toolCalls, 'toolCalls' in patch ? LIMITS.toolCalls : 0);
    const last = w.store().task(id); assert.ok(last); for (const [key, value] of Object.entries(patch)) assert.equal(last[key as keyof typeof last], value);
  }
});

void test('the persisted question ceiling prevents another question from being published', async context => {
  const result = deferred<TurnReply>(); const provider = counted(() => result.promise);
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic question ceiling');
  await until(() => provider.calls() === 1);
  const id = task(w)?.taskId; assert.ok(id !== undefined);
  const saved = w.store().task(id); assert.ok(saved); saved.questions = LIMITS.questions; w.store().save(saved);
  result.resolve(call('ask_owner', {text: 'One more?'}));
  await until(() => status(w) === 'failed');
  assert.equal(task(w)?.code, 'capacity');
  assert.equal(task(w)?.questionId, null);
  assert.equal(task(w)?.toolCalls, 0);
  await w.restart(); assert.equal(provider.calls(), 1); assert.equal(task(w)?.questions, LIMITS.questions);
});

void test('human wait and downtime use no active budget; profiles keep independent conversations', async context => {
  const w = await world(context);
  await control(w.core, w.module(), 'enable');
  const conversations = new Set<string>();
  for (const profile of ['bunny', 'reachy', 'microduck']) {
    assert.equal((await input(w.core, w.module(), `Synthetic ${profile}`, false, randomUUID(), {profile})).status, 'accepted');
    await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.status === 'waiting');
    const started = w.module().inspectAssistant()?.tasks.find(t => t.profile === profile); assert.ok(started);
    conversations.add(started.conversationId); w.advance(3_600_000); await w.restart();
    assert.equal(w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.activeMs, 0);
    assert.equal((await input(w.core, w.module(), 'Synthetic answer', true, randomUUID(), {profile, taskId: started.taskId, questionId: started.questionId})).status, 'accepted');
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
  await until(() => status(w) === 'waiting');
  const id = task(w)?.taskId; assert.ok(id !== undefined); const saved = w.store().task(id); assert.ok(saved?.question);
  saved.graphVersion = 'synthetic-1'; saved.question.answer = 'Synthetic saved'; w.store().save(saved); await w.restart();
  assert.equal(task(w)?.code, 'unavailable');
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
  const history = w.store().page('bunny', 0); assert.equal(history.currentTask?.question?.answer, 'Synthetic saved'); assert.ok(history.messages.length > 0);
});

void test('a hanging dispatch hits the tool deadline, leaves the effect uncertain and refuses a retry', async context => {
  let sends = 0;
  const w = await world(context, {provider: counted(), tools: ['set_mode'], core: () => ({sessions: [], mode: hub(2), synced: true}), dispatch: () => {sends += 1; return new Promise(() => {});}});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'quiet mode');
  await until(() => status(w) === 'waiting');
  assert.notEqual(task(w)?.usageUnits, null);
  await input(w.core, w.module(), 'approve', true); await until(() => sends === 1); w.advance(LIMITS.toolMs);
  await until(() => status(w) === 'uncertain'); assert.equal(task(w)?.modelCalls, 1);
  await w.restart(); assert.equal(task(w)?.activeMs, LIMITS.toolMs); assert.equal(sends, 1);
  const id = task(w)?.taskId; assert.ok(id !== undefined);
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected'); assert.equal(sends, 1);
});

void test('full disk refuses cancellation without claiming a durable fence or exposing exception content', async context => {
  const provider = counted(() => new Promise(() => {}));
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic full disk'); await until(() => provider.calls() === 1);
  const id = task(w)?.taskId; assert.ok(id !== undefined);
  const db = w.host().moduleDatabase(); assert.ok(db);
  db.exec('CREATE TABLE full_fixture (value BLOB); CREATE TRIGGER full_fixture_update BEFORE UPDATE ON assistant_tasks BEGIN INSERT INTO full_fixture VALUES(zeroblob(65536)); END;');
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
  db.exec(`PRAGMA max_page_count=${String(pages + 2)}`);
  assert.throws(() => db.prepare('UPDATE assistant_tasks SET status=status WHERE id=?').run(id), error => fullDisk(error));
  const result = await control(w.core, w.module(), 'cancel', id);
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') assert.equal(result.error.error.code, 'capacity');
  assert.equal(status(w), 'running');
  assert.equal(JSON.stringify(result).includes('SQLITE'), false);
  db.exec('PRAGMA max_page_count=1073741823; DROP TRIGGER full_fixture_update');
  assert.equal((await control(w.core, w.module(), 'cancel', id)).status, 'accepted');
});

void test('diagnostic records and spans correlate only registered identifiers with finished runs', async context => {
  const w = await world(context); await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-DIAGNOSTIC');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true);
  await until(() => status(w) === 'succeeded');
  const logs = w.host().logs.filter(record => record.event.startsWith('assistant.'));
  assert.deepEqual(logs.map(record => checkModuleRecord('companions', record)), logs.map(() => undefined));
  assert.equal(logs.filter(record => record.event === 'assistant.run.started').length, 2);
  assert.equal(w.spans.named('bunny.assistant.model').length, 3); assert.equal(w.spans.named('bunny.assistant.tool').length, 1);
  assert.ok(w.spans.spans.every(span => span.endedAtMs !== undefined));
  assert.equal(JSON.stringify([logs, w.spans.spans]).includes('PRIVATE-SYNTHETIC'), false);
});

void test('outbox replays the original outcome identity and trace without another graph invocation', async context => {
  let drop = true; const attempts: Message<object>[] = []; const provider = counted();
  const w = await world(context, {provider}, context => ({...context,
    sdk: {...context.sdk, publishMessage: (key, message) => {
      if (message.kind === 'outcome') {attempts.push(message); if (drop) return Promise.reject(new Error('Synthetic lost publication'));}
      return context.sdk.publishMessage(key, message);
    }}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic deferred outcome');
  await until(() => status(w) === 'waiting'); assert.equal(provider.calls(), 1);
  const original = attempts[0]; assert.ok(original); drop = false; await w.restart();
  assert.equal(provider.calls(), 1); const replay = attempts.filter(value => value.id === original.id); assert.ok(replay.length > 1);
  assert.ok(replay.every(value => value.traceparent === original.traceparent && value.time === original.time));
});

void test('throwing diagnostic sinks cannot fail a task or leak private exception text', async context => {
  const fail = () => {throw new Error('PRIVATE-SYNTHETIC-SINK-FAILURE');};
  const w = await world(context, {}, context => ({...context, log: {debug: fail, info: fail, warn: fail, error: fail}, trace: {...context.trace, start: fail}}));
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic silent diagnostics');
  await until(() => status(w) === 'waiting'); await input(w.core, w.module(), 'Synthetic answer', true);
  await until(() => status(w) === 'succeeded');
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-SYNTHETIC'), false);
});

void test('unavailable provider refuses activation while Reachy remains readable', async context => {
  const w = await world(context, {available: () => false});
  assert.equal(w.module().inspectAssistant()?.available, false);
  assert.equal((await control(w.core, w.module(), 'enable')).status, 'rejected');
  assert.equal(w.module().inspect()?.settings.enabled, false);
});

void test('private history pages remain bounded and always advance through escaped text', async context => {
  const w = await world(context), store = w.store(), started = store.newTask('bunny', '\u0001'.repeat(4096));
  started.question = {id: `${started.id}-q1`, text: 'Synthetic question', answer: '\u0001'.repeat(4096), kind: 'clarification', call: 'c', proposal: null}; store.save(started);
  store.message(started, 'prompt', 'owner', started.prompt, 0);
  for (let n = 0; n < 40; n += 1) store.message(started, `message-${String(n)}`, 'tool', '\u0001'.repeat(8192), 0);
  let after = 0, count = 0, pages = 0;
  do {
    const history = store.page('bunny', after); pages += 1; assert.ok(pages < 50);
    assert.ok(Buffer.byteLength(JSON.stringify(history)) <= LIMITS.pageBytes); count += history.messages.length;
    if (history.next === null) break;
    assert.ok(history.next > after); after = history.next;
  } while (pages < 50);
  assert.equal(count, 41);
});

for (const condition of ['unavailable', 'incompatible', 'recovery-failure'] as const) {
  void test(`recovery guards preserve uncertain receipts when ${condition}`, async context => {
    let available = true; const provider = counted(() => new Promise(() => {}));
    const w = await world(context, {available: () => available, provider});
    await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic uncertain recovery'); await until(() => provider.calls() === 1);
    const id = task(w)?.taskId; assert.ok(id !== undefined);
    if (condition === 'unavailable') available = false;
    if (condition === 'incompatible') {const saved = w.store().task(id); assert.ok(saved); saved.graphVersion = 'future-graph'; w.store().save(saved);}
    if (condition === 'recovery-failure') w.host().moduleDatabase()?.exec("UPDATE assistant_checkpoints SET checkpoint_type='unsupported-synthetic-format'");
    await w.restart();
    const state = w.module().inspectAssistant(), current = state?.tasks[0]; assert.ok(current);
    assert.equal(current.status, 'uncertain'); assert.equal(current.code, 'uncertain-result'); assert.equal(current.usageUnits, null);
    assert.equal(provider.calls(), 1); assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
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
  await until(() => status(w) === 'waiting');
  const originalRun = w.spans.named('bunny.assistant.run')[0]; assert.ok(originalRun);
  assert.equal(messages.at(-1)?.traceparent.split('-')[1], originalRun.traceId);
  await w.restart(); assert.equal(messages.at(-1)?.traceparent.split('-')[1], originalRun.traceId);
  await input(w.core, w.module(), 'Synthetic answer', true); await until(() => status(w) === 'succeeded');
  const finalRun = w.spans.named('bunny.assistant.run').at(-1); assert.ok(finalRun);
  assert.equal(messages.at(-1)?.traceparent.split('-')[1], finalRun.traceId);
});

void test('internal projection faults use error severity without exception content', async context => {
  const w = await world(context);
  w.host().moduleDatabase()?.exec("CREATE TRIGGER fail_projection BEFORE UPDATE ON assistant_tasks WHEN NEW.status='waiting' BEGIN SELECT RAISE(ABORT, 'PRIVATE-SYNTHETIC-FAULT'); END;");
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Synthetic projection fault');
  await until(() => w.host().logs.some(record => record.event === 'assistant.run.settled'));
  assert.equal(status(w), 'failed');
  const log = w.host().logs.find(record => record.event === 'assistant.run.settled'); assert.ok(log);
  assert.equal(log.fields['bunny.code'], 'internal'); assert.equal(log.level, 'error');
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC-FAULT'), false);
});

void test('the question and result that end a turn are offered to speech once each, and Speak replays a saved assistant message', async context => {
  const offers: {reply: SpokenReply; key: string}[] = [];
  const w = await world(context, {provider: counted(), speak: (reply, key) => {offers.push({reply, key});}});
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-SPOKEN-PROMPT')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  const id = task(w)?.taskId ?? assert.fail('task'), questionId = task(w)?.questionId ?? assert.fail('question');
  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0], {reply: {taskId: id, messageId: questionId, text: SYNTHETIC_QUESTION, validUntilMs: offers[0]?.reply.validUntilMs ?? 0}, key: questionId});
  assert.ok((offers[0]?.reply.validUntilMs ?? 0) > Date.now() + 50_000);
  await w.restart(); assert.equal(offers.length, 1, 'startup reconciliation speaks nothing');
  assert.equal((await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-SPOKEN-ANSWER', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(offers.length, 2); assert.equal(offers[1]?.key, `${id}-result`);
  assert.match(offers[1]?.reply.text ?? '', /^Synthetic result: PRIVATE-SYNTHETIC-SPOKEN-ANSWER/);
  const saved = (await page(w)).messages as {id: string; role: string; text: string}[];
  assert.ok(saved.every(message => typeof message.id === 'string' && message.id !== ''));
  const result = saved.find(message => message.id === `${id}-result`); assert.ok(result); assert.equal(result.text, offers[1]?.reply.text);
  // Speak reads the saved message again under a key that carries the request, so the coordinator admits the replay as its own utterance.
  const requestId = randomUUID(), revision = w.module().inspectAssistant()?.revision;
  const spoken = await control(w.core, w.module(), 'speak', id, requestId, {messageId: `${id}-result`}); assert.equal(spoken.status, 'accepted', JSON.stringify(spoken));
  assert.equal(offers.length, 3); assert.equal(offers[2]?.key, `${id}-result:${requestId}`); assert.equal(offers[2]?.reply.text, result.text);
  // The page retries with the same request and data; the saved receipt answers it without a second utterance.
  assert.equal((await control(w.core, w.module(), 'speak', id, requestId, {messageId: `${id}-result`, expectedRevision: revision})).status, 'accepted');
  assert.equal(offers.length, 3, 'a duplicate request does not speak again');
  const owner = await control(w.core, w.module(), 'speak', id, randomUUID(), {messageId: `${id}-prompt`});
  assert.equal(owner.status, 'rejected'); if (owner.status === 'rejected') assert.equal(owner.error.error.code, 'invalid-request');
  const missing = await control(w.core, w.module(), 'speak', id, randomUUID(), {messageId: `${id}-nothing`});
  assert.equal(missing.status, 'rejected'); if (missing.status === 'rejected') assert.equal(missing.error.error.code, 'not-found');
  const mixed = await control(w.core, w.module(), 'cancel', id, randomUUID(), {messageId: `${id}-result`});
  assert.equal(mixed.status, 'rejected'); if (mixed.status === 'rejected') assert.equal(mixed.error.error.code, 'invalid-request');
  assert.equal(offers.length, 3);
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC'), false);
  assert.equal(JSON.stringify(w.module().inspectAssistant()).includes('PRIVATE-SYNTHETIC'), false);
});

void test('a refusal is offered to speech, a result over the spoken bound stays written only, and a failed offer never fails the task', async context => {
  const offers: SpokenReply[] = [];
  let turn = 0;
  const provider = counted(() => {
    turn += 1;
    if (turn === 1) return {text: null, calls: [], stop: 'refusal', units: 1};
    return reply(`Long answer ${'x'.repeat(600)}`);
  });
  const w = await world(context, {provider, speak: offer => {offers.push(offer); throw new Error('PRIVATE-SYNTHETIC-SPEECH-FAULT');}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic refusal'); await until(() => status(w) === 'failed');
  assert.equal(offers.length, 1); assert.equal(offers[0]?.text, REFUSED);
  await input(w.core, w.module(), 'Synthetic long answer'); await until(() => status(w) === 'succeeded');
  assert.equal(offers.length, 1, 'a result over 512 characters is not offered');
  assert.equal(JSON.stringify(w.host().logs).includes('PRIVATE-SYNTHETIC'), false);
});

void test('an approved delegation is handed to the worker once, the owner cannot answer it, the worker\'s result resumes the task and a cancel stops the worker', async context => {
  const CODING = 'bunny/parts/coding-worker';
  let turn = 0;
  const provider = counted(() => {
    turn += 1;
    return turn === 1 ? call('delegate_coding', {repository: 'agent-device-hub', brief: 'Add a unit test for the readout generator.'}) : reply('Synthetic summary of the worker result.');
  });
  const w = await world(context, {provider, tools: ['delegate_coding']});
  const bus = w.core; // the core participant doubles as the tracked dispatcher's fake
  const work: Array<{action: string; taskId?: string; operationId: string}> = [];
  const endpointId = 'worker-endpoint-1';
  await bus.respond<{requestId: string; endpointId: string; taskId: string; repository: string; brief: string}>('bunny.cmd.coding-dispatch.assistant', async command => {
    const answer = await bus.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data}, {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  const workerPart = w.bus.connect(CODING);
  context.after(() => workerPart.close());
  await workerPart.respond<{action: string; taskId?: string; operationId: string}>('bunny.cmd.coding-work.*', command => {work.push(command.data); return {status: 'accepted'};});
  const progress = (data: object) => workerPart.publish(`bunny.event.coding-progress.${endpointId}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data});
  await control(w.core, w.module(), 'enable');
  // Without a connected worker the model's call is refused as a tool result, not proposed.
  assert.equal((await input(w.core, w.module(), 'Please delegate: add a test')).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.match(JSON.stringify((await page(w)).messages), /No coding worker is connected right now/);
  assert.equal((await workerPart.request(`bunny.cmd.coding-endpoint.${endpointId}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: 'enable-1', action: 'enable'}}, {timeoutMs: 5000})).status, 'accepted');
  await until(() => w.module().inspectCoding()?.availability === 'available');
  turn = 0;
  const before = provider.calls();
  assert.equal((await input(w.core, w.module(), 'Please delegate: add a test')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  const proposal = (await page(w)).currentTask?.question;
  assert.equal(proposal?.kind, 'approval');
  assert.deepEqual(proposal?.proposal, {family: 'coding-dispatch', target: 'assistant', data: {repository: 'agent-device-hub', brief: 'Add a unit test for the readout generator.'}, expectedRevision: w.module().inspectCoding()?.revision});
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => work.length === 1 && status(w) === 'waiting');
  assert.equal(work[0]?.action, 'start'); assert.equal(work[0]?.taskId, task(w)?.taskId);
  const delegation = (await page(w)).currentTask?.question; assert.equal(delegation?.kind, 'delegation'); assert.equal(delegation?.answer, null);
  const owner = await input(w.core, w.module(), 'done yet?', true); assert.equal(owner.status, 'rejected'); if (owner.status === 'rejected') assert.equal(owner.error.error.code, 'invalid-state');
  assert.equal(provider.calls(), before + 1, 'the model is not called while the worker runs');
  await progress({operationId: work[0]?.operationId, status: 'started'});
  await until(() => w.module().inspectCoding()?.active?.status === 'started');
  await progress({operationId: work[0]?.operationId, status: 'completed', result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: ['scripts/tests/readout.test.mjs'],
    checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: [], summary: 'Added the test; it passes.', sessionId: null, usage: null}});
  await until(() => status(w) === 'succeeded');
  assert.equal(provider.calls(), before + 2);
  const saved = await page(w);
  assert.ok(saved.messages.some(message => message.role === 'tool' && /^completed \(tested-candidate\): Added the test; it passes\./.test(message.text)));
  assert.equal(saved.messages.at(-1)?.text, 'Synthetic summary of the worker result.');
  assert.equal(task(w)?.questions, 1, 'the delegation counts no owner question');
  assert.equal(w.module().inspectCoding()?.active, null);
  // A second delegation is cancelled by the owner while the worker runs: the worker is asked to stop and its report ends the task's wait.
  turn = 0;
  assert.equal((await input(w.core, w.module(), 'Please delegate: another test')).status, 'accepted'); await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted'); await until(() => work.length === 2 && status(w) === 'waiting');
  const id = task(w)?.taskId ?? assert.fail('task');
  assert.equal((await control(w.core, w.module(), 'cancel', id)).status, 'accepted'); await until(() => status(w) === 'cancelled');
  await until(() => work.length === 3); assert.equal(work[2]?.action, 'cancel');
  await progress({operationId: work[1]?.operationId, status: 'cancelled', reason: 'cancelled', result: null});
  await until(() => w.module().inspectCoding()?.active === null);
  assert.equal(status(w), 'cancelled');
  assert.equal(JSON.stringify(w.host().logs).includes('readout generator'), false, 'briefs reach no diagnostic record');
});
