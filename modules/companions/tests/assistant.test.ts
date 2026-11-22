import {artShowSurfaces} from '@jimmie-potts/event-contracts/v2/art-show';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {coreValidator, type ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionFacts, type SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {test, type TestContext} from 'node:test';
import {fullDisk, InProcessBus, type Participant, type ModuleContext, type RequestResult} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AnthropicProvider} from '../src/assistant/anthropic.js';
import {SqliteCheckpointSaver} from '../src/assistant/checkpointer.js';
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import {assistantStateDraft, CONTEXT_TOO_LARGE, DECLINED, REFUSED} from '../src/assistant/engine.js';
import {PreferenceStore} from '../src/preferences/store.js';
import {ProviderFault, type ModelProvider, type TurnInput, type TurnReply} from '../src/assistant/provider.js';
import {SyntheticProvider, SYNTHETIC_QUESTION} from '../src/assistant/synthetic.js';
import type {SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {readDevices} from '../src/assistant/devices.js';
import {catalogTools} from '../src/assistant/catalog-tools.js';
import {FIXTURE_TEXT, summarizeSessions} from '../src/assistant/tools.js';

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
/** A session as the module's synced copy reads it: its session/3.0 record, which is its view. */
const session = (label: string, patch: Partial<SessionFacts> = {}): SessionView => buildSession({id: 'session-1', revision: 1, generation: 1,
  identity: {provider: 'codex', client: 'desktop', hostId: 'host', sourceId: 'desktop', sessionId: 's-1'},
  parent: {status: 'top-level'}, turn: {status: 'unknown'}, work: 'active', attention: [{id: {status: 'known', id: 'a-1'}, kind: 'approval', turn: {status: 'unknown'}}], notices: [], read: 'unknown', unavailable: [],
  ordering: {status: 'unknown'}, observedAtMs: 1000, lastEvidenceAtMs: 1000, children: {working: 0, unconfirmed: 0}, label: {value: label, origin: 'user'}, ...patch});
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

const unknown = {status: 'unknown'} as const;
const light = (id: string, label = id): DeviceRecord => ({
  id, label, kind: 'lifx', revision: 1, configurationRevision: 3, generation: {epoch: 'start-1', sequence: 0}, availability: 'available',
  capabilities: {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: false},
    media: {supported: false}, moments: {supported: false}, preview: {supported: false}, scenes: {supported: false}, zones: {supported: false}},
  desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: 0, pendingKinds: [],
  lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
});

void test('light status preserves unknown state after copy loss and evidence older than a write', () => {
  assert.match(readDevices(undefined, 'desk-lamp', 1000), /unavailable/);
  assert.match(readDevices([light('desk-lamp')], 'desk-lamp', 1000), /Observed power and brightness are unknown/);
  const device: DeviceRecord = {...light('desk-lamp'),
    observed: {status: 'known', observedAtMs: 1000, power: {status: 'known', value: true}, brightness: {status: 'known', value: 60}},
    lastTransmission: {status: 'known', transmittedAtMs: 2000, operationIds: []},
  };
  assert.match(readDevices([device], 'desk-lamp', 2000), /Current state is unknown. The observation is stale. Observed power: on/);
  const noWrite = {...device, lastTransmission: unknown};
  assert.doesNotMatch(readDevices([noWrite], 'desk-lamp', 2000), /unknown|stale/);
  assert.match(readDevices([noWrite], 'desk-lamp', 31_000), /Current state is unknown. The observation is stale/);
});

void test('a duplicate light label asks for an exact device ID and sends nothing without a specific approval', async context => {
  const names = [light('first', 'Desk lamp'), light('second', 'Desk lamp')];
  const provider = counted((_input, turn) => turn === 1 ? call('set_lifx_power', {device: 'Desk lamp', on: false})
    : turn === 2 ? call('set_lifx_power', {device: 'second', on: false}) : reply('Done.'));
  const w = await world(context, {provider, tools: ['set_lifx_power'], devices: () => names,
    dispatch: () => assert.fail('no approval was given')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn off the desk light');
  await until(() => status(w) === 'waiting');
  const clarification = (await page(w)).currentTask?.question;
  assert.equal(clarification?.kind, 'clarification');
  assert.match(JSON.stringify(clarification), /first, second/);
  await input(w.core, w.module(), 'second', true);
  await until(() => status(w) === 'waiting' && task(w)?.questions === 2);
  assert.deepEqual((await page(w)).currentTask?.question?.proposal, {
    family: 'power-set', target: 'second', data: {on: false, expectedConfigurationRevision: 3, expectedGeneration: {epoch: 'start-1', sequence: 0}},
  });
});

void test('an owner-approved Wemo power request preserves the exact plug, owner and guards', async context => {
  const plug: DeviceRecord = {...light('table-plug', 'Table plug'), kind: 'wemo'};
  const provider = counted((_input, turn) => turn === 1 ? call('set_wemo_power', {device: 'Table plug', on: true}) : reply('Done.'));
  const commands: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: ['set_wemo_power'], devices: () => [plug],
    dispatch: data => {commands.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn on the table plug');
  await until(() => status(w) === 'waiting' || status(w) === 'succeeded');
  assert.equal(status(w), 'waiting', 'the Wemo action needs an explicit approval');
  const proposal = {
    family: 'power-set', target: plug.id, owner: 'bunny/modules/wemo',
    data: {on: true, expectedConfigurationRevision: plug.configurationRevision, expectedGeneration: plug.generation},
  };
  assert.deepEqual((await page(w)).currentTask?.question?.proposal, proposal);
  assert.equal(commands.length, 0);
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'succeeded');
  assert.equal(commands.length, 1);
  const saved = commands[0];
  assert.ok(saved);
  assert.ok(saved.requestId.startsWith(`${task(w)?.taskId}-step-`));
  const {requestId, ...effect} = saved;
  assert.deepEqual(effect, proposal);
  assert.ok((await page(w)).messages.some(message => message.text.includes(`as operation ${requestId}`)));
});

void test('duplicate Wemo labels ask for an exact plug before proposing power', async context => {
  const plugs = ['first-plug', 'second-plug'].map(id => ({...light(id, 'Table plug'), kind: 'wemo'}));
  const provider = counted(() => call('set_wemo_power', {device: 'Table plug', on: true}));
  const w = await world(context, {provider, tools: ['set_wemo_power'], devices: () => plugs,
    dispatch: () => assert.fail('ambiguous Wemo power cannot be dispatched')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn on the table plug');
  await until(() => status(w) === 'waiting');
  const clarification = (await page(w)).currentTask?.question;
  assert.equal(clarification?.kind, 'clarification');
  assert.match(JSON.stringify(clarification), /first-plug, second-plug/);
  assert.equal(clarification?.proposal, null);
});

void test('a Wemo hold refuses a power proposal without dispatch', async context => {
  const plug: DeviceRecord = {...light('table-plug'), kind: 'wemo', availability: 'degraded', held: {requestId: 'prior', heldAtMs: 1}};
  const w = await world(context, {tools: ['set_wemo_power'], devices: () => [plug],
    dispatch: () => assert.fail('a held plug cannot be dispatched')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_WEMO power table-plug on');
  await until(() => status(w) === 'succeeded');
  assert.ok((await page(w)).messages.some(message => message.text.includes('refused: unavailable')));
});

void test('a saved Wemo proposal does not use a different power permission after restart', async context => {
  const tools = ['set_wemo_power'];
  const w = await world(context, {tools, devices: () => [{...light('table-plug'), kind: 'wemo'}],
    dispatch: () => assert.fail('the Wemo power permission was revoked')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_WEMO power table-plug off');
  await until(() => status(w) === 'waiting');
  tools.splice(0, 1, 'set_lifx_power');
  await w.restart();
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.ok((await page(w)).messages.some(message => message.text.includes('This tool is not permitted')));
});

void test('revoking a light tool across a restart stops the saved approval before dispatch', async context => {
  const tools = ['set_lifx_power'];
  const w = await world(context, {tools, devices: () => [light('desk-lamp')],
    dispatch: () => assert.fail('permission was revoked')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_LIFX power desk-lamp off');
  await until(() => status(w) === 'waiting');
  tools.length = 0;
  await w.restart();
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.ok((await page(w)).messages.some(message => message.text.includes('This tool is not permitted')));
});

void test('the light command stays uncertain after a lost dispatch reply and does not replay after restart', async context => {
  let attempts = 0;
  const w = await world(context, {tools: ['set_lifx_power'], devices: () => [light('desk-lamp')], dispatch: data => {
    attempts += 1;
    return Promise.resolve({status: 'rejected', requestId: data.requestId, error: errorBody('uncertain-result')});
  }});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_LIFX power desk-lamp off');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'uncertain');
  assert.equal(task(w)?.code, 'uncertain-result');
  await w.restart();
  assert.equal(status(w), 'uncertain');
  assert.equal(attempts, 1);
});

void test('all rollout tools fit in the published Conversation state and remain opt-in', async context => {
  const tools = ['read_lifx', 'set_lifx_power', 'set_lifx_brightness', 'read_wemo', 'set_wemo_power', ...catalogTools.map(tool => tool.name)];
  const w = await world(context, {tools});
  const state = w.module().inspectAssistant();
  assert.ok(state);
  assert.deepEqual(state.tools, tools);
  assert.ok(tools.length > 32);
  const payload = {...assistantStateDraft(state), specversion: '1.0', bunnyprofile: '2.0',
    source: 'bunny/modules/companions', id: 'rollout-state', time: '2026-11-05T00:00:00.000Z', datacontenttype: 'application/json',
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
  assert.equal(payload.dataschema, 'https://bunny.invalid/events/assistant-state/2.1');
  assert.equal(coreValidator().validate(payload).ok, true);
  assert.equal(coreValidator().validate({...payload, dataschema: 'https://bunny.invalid/events/assistant-state/2.0'}).ok, false);
});

void test('Conversation pages through large show catalogs and can read a saved title at the end', async context => {
  const w = await world(context, {tools: ['read_light_shows']});
  const owner = w.bus.connect('bunny/modules/nanoleaf');
  context.after(() => owner.close());
  const versions = Array.from({length: 48}, (_, index) => ({version: index + 1, versionName: `Synthetic immutable version ${String(index + 1)}`}));
  await owner.serveSync(['nanoleaf-shows'], () => ({revision: 1, states: [{
    type: 'org.bunny.nanoleaf-shows.updated', subject: 'shows', dataschema: 'https://bunny.invalid/events/nanoleaf-shows/2.1',
    data: {id: 'shows', revision: 1, shows: [{id: 'show-long', name: 'Synthetic catalog', version: versions.length, versions}]},
  }]}));
  await control(w.core, w.module(), 'enable');
  const read = async (offset: number, expected: string) => {
    const prior = task(w)?.taskId;
    await input(w.core, w.module(), 'SYNTHETIC_CATALOG ' + JSON.stringify({name: 'read_light_shows',
      input: {view: 'saved', id: 'show-long', offset}}));
    await until(() => status(w) === 'succeeded' && task(w)?.taskId !== prior);
    const message = (await page(w)).messages.filter(message => message.role === 'tool').at(-1)?.text;
    assert.match(message ?? '', new RegExp(expected));
    const content = JSON.parse(message ?? '{}') as {items: object[]; nextOffset: number | null};
    assert.equal(content.items.length, 8);
    assert.equal(content.nextOffset, offset === 0 ? 8 : null);
  };
  await read(0, 'Synthetic immutable version 8');
  await read(40, 'Synthetic immutable version 48');
});

void test('a lost saved-show playback answer stays uncertain and never sends a second request', async context => {
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {tools: ['control_music_lighting_control'], dispatch: data => {
    requests.push(data);
    return Promise.resolve({status: 'uncertain', requestId: data.requestId, error: errorBody('uncertain-result')});
  }});
  await w.core.serveSync(['music-lighting-state'], () => ({revision: 1, states: [{
    type: 'org.bunny.music-lighting.updated', subject: 'wall', dataschema: 'https://bunny.invalid/events/music-lighting-state/2.0',
    data: {id: 'wall', revision: 1, session: {status: 'active', generation: 'specific-show', operationId: 'previous-start',
      startedAtMs: 1000, show: {showId: 'show-synthetic', version: 1, positionMs: 100, missedCues: 0}}, last: null},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_CATALOG ' + JSON.stringify({name: 'control_music_lighting_control',
    input: {owner: 'bunny/core', target: 'wall', arguments: '{"action":"stop"}'}}));
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'uncertain');
  assert.equal(task(w)?.code, 'uncertain-result');
  assert.deepEqual(requests[0]?.data, {action: 'stop', generation: 'specific-show'});
  await w.restart();
  assert.equal(status(w), 'uncertain');
  assert.equal(requests.length, 1);
});

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
    dispatch: data => {assert.equal(data.family, 'mode-set'); dispatched.push({requestId: data.requestId, data: data.data}); return Promise.resolve(accepted(data.requestId));}});
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

void test('an approval stays bound to the revision it was proposed against after an owner mode change, and the reply explains the refusal', async context => {
  // #1657 (AC3): the owner changed the mode by hand after the proposal and before approving it. The approval must not
  // override that choice, so it still carries the proposed revision, and the core's refusal is explained in the reply.
  let revision = 3;
  const dispatched: {mode: string; expectedRevision?: number}[] = [];
  const w = await world(context, {provider: counted(), tools: ['set_mode'], core: () => ({sessions: [], mode: hub(revision), synced: true}),
    dispatch: data => {assert.equal(data.family, 'mode-set'); dispatched.push(data.data); return Promise.resolve({status: 'rejected', requestId: data.requestId, error: errorBody('revision-conflict')});}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'quiet mode now'); await until(() => status(w) === 'waiting');
  assert.equal((await page(w)).currentTask?.question?.proposal?.expectedRevision, 3);
  revision = 9;
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.deepEqual(dispatched, [{mode: 'quiet', expectedRevision: 3}], 'the proposed revision, never the newer one');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /not applied: refused: revision-conflict: the Hub mode changed since this was proposed; nothing was changed/);
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
  assert.match(final, /not permitted/); assert.match(final, /PRIVATE-LABEL \(codex, desktop\): needs-owner \(approval\); work active, confirmed; waiting for approval/);
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
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /tool call timed out/i);
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

void test('a worker result that comes back before the hand-off is recorded still answers the delegation', async context => {
  const CODING = 'bunny/parts/coding-worker', endpointId = 'worker-endpoint-1';
  let turn = 0;
  const provider = counted(() => {turn += 1; return turn === 1 ? call('delegate_coding', {repository: 'agent-device-hub', brief: 'Add a unit test.'}) : reply('Summary of the refusal.');});
  const w = await world(context, {provider, tools: ['delegate_coding']});
  const bus = w.core;
  await bus.respond<{requestId: string}>('bunny.cmd.coding-dispatch.assistant', async command => {
    const answer = await bus.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data}, {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  const workerPart = w.bus.connect(CODING); context.after(() => workerPart.close());
  const progress = (data: object) => workerPart.publish(`bunny.event.coding-progress.${endpointId}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data});
  // The worker's word leaves before it even accepts the work, so the failure reaches the task while the hand-off is still being recorded.
  await workerPart.respond<{operationId: string}>('bunny.cmd.coding-work.*', async command => {
    await progress({operationId: command.data.operationId, status: 'started'});
    await progress({operationId: command.data.operationId, status: 'failed', reason: 'refused', result: null});
    return {status: 'accepted'};
  });
  await control(w.core, w.module(), 'enable');
  assert.equal((await workerPart.request(`bunny.cmd.coding-endpoint.${endpointId}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpointId, dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: 'enable-1', action: 'enable'}}, {timeoutMs: 5000})).status, 'accepted');
  await until(() => w.module().inspectCoding()?.availability === 'available');
  assert.equal((await input(w.core, w.module(), 'Please delegate: add a test')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.match(JSON.stringify((await page(w)).messages), /failed \(refused\)/);
  assert.equal(task(w)?.questions, 1, 'the delegation counts no owner question');
});

void test('an approved art request keeps its reply reference when admission is uncertain', async context => {
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {tools: ['create_artwork'], dispatch: data => {
    const history = w.store().recentPage('bunny', undefined);
    assert.equal(typeof history === 'object' && history.messages.at(-1)?.attachment?.requestId, data.requestId,
      'the private reference commits before dispatch');
    requests.push(data);
    return Promise.resolve({status: 'uncertain', requestId: data.requestId, error: errorBody('uncertain-result')});
  }});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'SYNTHETIC_CATALOG {"name":"create_artwork","input":{"format":"gif","description":"Blue flowers"}}');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'uncertain');
  await w.restart();
  const history = w.store().recentPage('bunny', undefined);
  if (typeof history === 'string') assert.fail(history);
  assert.deepEqual(history.messages.flatMap(message => message.attachment === undefined ? [] : [message.attachment]), [
    {kind: 'artwork', description: 'Blue flowers', requestId: requests[0]?.requestId, admission: 'uncertain'},
  ]);
  assert.match(history.messages.at(-1)?.text ?? '', /Blue flowers.*cannot confirm whether the request took effect/);
  assert.equal(requests.length, 1);
  const requestId = requests[0]?.requestId ?? assert.fail('no request');
  const store = w.store(), receipt = store.call(requestId) ?? assert.fail('no receipt');
  store.saveCall({...receipt, status: 'failed', code: 'internal'});
  const failedReceipt = store.recentPage('bunny', undefined);
  assert.equal(typeof failedReceipt === 'object' && failedReceipt.messages.find(m => m.attachment !== undefined)?.attachment?.admission, 'uncertain');
});

void test('a repeated art result keeps one attachment on the original companion message', async context => {
  const w = await world(context);
  const store = w.store();
  const task = store.newTask('bunny', 'Synthetic art prompt');
  store.save(task);
  store.message(task, 'text-fixture', 'owner', 'An ordinary text message', 1);
  store.artReply(task, 'art-job-original', 'Blue flowers', 2);
  store.artReply(task, 'art-job-original', 'Duplicate result text', 3);
  store.artReply(task, 'art-job-other', 'Other result for same turn', 4);
  const page = store.recentPage('bunny', undefined);
  assert.equal(typeof page, 'object');
  if (typeof page === 'string') assert.fail(page);
  assert.deepEqual(page.messages.map(message => message.attachment), [
    undefined, {kind: 'artwork', requestId: 'art-job-original', description: 'Blue flowers', admission: 'uncertain'},
  ]);
  assert.equal(page.messages[1]?.taskId, task.id);
  assert.deepEqual(store.page('reachy', 0).messages, []);
});

void test('recent conversation reads page backwards without changing saved state', async context => {
  const w = await world(context);
  const store = w.store();
  const thread = store.newTask('bunny', 'Synthetic prompt');
  thread.question = {id: 'fixture-question', text: 'Synthetic question', answer: null, kind: 'clarification', call: 'private-call', proposal: null};
  store.save(thread);
  for (let index = 1; index <= 40; index += 1) store.message(thread, `m-${String(index)}`, 'owner', 'Synthetic history', index);
  const other = store.newTask('reachy', 'Separate');
  store.message(other, 'other-message', 'owner', 'Separate synthetic history', 1);
  const snapshot = store.meta();
  const changes = store.database.prepare('SELECT total_changes() AS count').get();
  const read = async (query: Record<string, string>, signal = new AbortController().signal) => {
    const result = await w.module().manifest.content?.('conversation', {query, signal});
    assert.ok(result !== undefined);
    return result;
  };
  const page = async (query: Record<string, string>) => {
    const result = await read(query);
    assert.ok(!('error' in result), JSON.stringify(result));
    assert.ok(result.bytes.byteLength <= LIMITS.pageBytes);
    return JSON.parse(Buffer.from(result.bytes).toString()) as {
      version: number; profile: string; conversationId: string | null; messages: {seq: number; text: string}[];
      currentTask: {taskId: string; question: {kind: string}} | null; older: string | null; next?: number;
    };
  };
  const recent = {profile: 'bunny', view: 'recent'};
  const newest = await page(recent);
  assert.equal(newest.version, 2);
  assert.equal(newest.profile, 'bunny');
  assert.equal(newest.conversationId, thread.conversationId);
  assert.deepEqual(newest.messages.map(message => message.seq), Array.from({length: 16}, (_, index) => 25 + index));
  assert.deepEqual(newest.currentTask, {taskId: thread.id, question: {id: 'fixture-question', text: 'Synthetic question', answer: null, kind: 'clarification', proposal: null}});
  const middle = await page({...recent, before: newest.older ?? assert.fail('first cursor')});
  assert.equal(middle.currentTask, null);
  const oldest = await page({...recent, before: middle.older ?? assert.fail('second cursor')});
  assert.equal(oldest.older, null);
  assert.deepEqual([...oldest.messages, ...middle.messages, ...newest.messages].map(message => message.seq),
    Array.from({length: 40}, (_, index) => index + 1));
  assert.deepEqual(await page({profile: 'microduck', view: 'recent'}), {version: 2, profile: 'microduck', conversationId: null, messages: [], currentTask: null, older: null});
  const legacy = await page({profile: 'bunny', after: '0'});
  assert.equal(legacy.version, 1);
  assert.equal(legacy.next, 16);
  assert.equal(legacy.messages[0]?.seq, 1);
  assert.equal((await page({profile: 'bunny', after: '16'})).currentTask, null);
  const token = (profile: string, id: string, seq: number): string => Buffer.from(JSON.stringify([profile, id, seq])).toString('base64url');
  for (const query of [
    {...recent, before: newest.older ?? '', profile: 'reachy'}, {...recent, before: token('bunny', 'stale-id', 25)},
    {...recent, before: token('bunny', thread.conversationId, Number.MAX_SAFE_INTEGER + 1)}, {...recent, before: 'invalid'},
    {...recent, after: '0'}, {profile: 'bunny', before: newest.older ?? ''}, {...recent, view: 'unknown'},
  ]) assert.deepEqual(await read(query), errorBody('invalid-request'));
  assert.deepEqual(await read(recent, AbortSignal.abort()), errorBody('invalid-request'));
  assert.deepEqual(store.meta(), snapshot);
  assert.deepEqual(store.database.prepare('SELECT total_changes() AS count').get(), changes);

  const escaped = '\u0001'.repeat(6000);
  for (let index = 0; index < 2; index += 1) store.message(thread, `escaped-${String(index)}`, 'tool', escaped, 100);
  const limited = await page(recent);
  assert.equal(limited.messages.length, 1);
  assert.equal(limited.messages[0]?.text, escaped);
  assert.equal((await page({...recent, before: limited.older ?? assert.fail('byte limit cursor')})).messages.at(-1)?.text, escaped);
  store.message(thread, 'oversized', 'tool', '\u0001'.repeat(11_000), 100);
  assert.deepEqual(await read(recent), errorBody('capacity'));

  for (let index = 1; index < 16; index += 1) store.message(other, `reachy-${String(index)}`, 'assistant', 'Other synthetic history', index);
  const exactCount = await page({...recent, profile: 'reachy'});
  assert.equal(exactCount.messages.length, 16);
  assert.equal(exactCount.older, null);

  const finalThread = store.newTask('microduck', 'Metadata fixture');
  finalThread.question = {id: 'question-limit', text: '\u0001'.repeat(1024), answer: '\u0001'.repeat(LIMITS.inputBytes), kind: 'clarification', call: 'internal', proposal: null};
  store.save(finalThread);
  const metadata = await page({...recent, profile: 'microduck'});
  assert.equal(metadata.currentTask?.question.kind, 'clarification');
  assert.equal(metadata.messages.length, 0);

  const approval = {id: 'approval-fixture', text: '\u0001'.repeat(1024), answer: null, kind: 'approval' as const, call: 'internal',
    proposal: {family: 'coding-dispatch' as const, target: 'assistant' as const, data: {repository: 'synthetic-repository', brief: '\u0001'.repeat(4096)}, expectedRevision: 12}};
  finalThread.question = approval;
  store.save(finalThread);
  const approved = await page({...recent, profile: 'microduck'});
  assert.deepEqual(approved.currentTask, {taskId: finalThread.id, question: {id: approval.id, text: approval.text,
    answer: approval.answer, kind: approval.kind, proposal: approval.proposal}});
  finalThread.question = {id: 'delegation-fixture', text: 'Synthetic worker pending', answer: null, kind: 'delegation', call: 'internal', proposal: approval.proposal};
  store.save(finalThread);
  assert.equal((await page({...recent, profile: 'microduck'})).currentTask?.question.kind, 'delegation');

  store.message(finalThread, 'exact-byte-row', 'tool', '', 100);
  const exactQuery = {...recent, profile: 'microduck'};
  const emptyRow = await read(exactQuery);
  assert.ok(!('error' in emptyRow));
  store.database.prepare('UPDATE assistant_messages SET text=? WHERE id=?').run('x'.repeat(LIMITS.pageBytes - emptyRow.bytes.byteLength), 'exact-byte-row');
  const exactBytes = await read(exactQuery);
  assert.ok(!('error' in exactBytes));
  assert.equal(exactBytes.bytes.byteLength, LIMITS.pageBytes);
  assert.equal((await page(exactQuery)).older, null);
});

void test('read_sessions reports each session\'s shared status class and detail and its work confirmation, newest evidence first', () => {
  const finished = session('FINISHED', {id: 'session-2', identity: {provider: 'claude', client: 'code', hostId: 'host', sourceId: 'code', sessionId: 's-2'}, work: 'idle', attention: [],
    turn: {status: 'known', id: 't-1'}, notices: [{id: 'n-1', kind: 'turn-ended', turn: {status: 'known', id: 't-1'}, acknowledgedBy: []}], lastEvidenceAtMs: 3000});
  const restarted = session('RESTARTED', {id: 'session-3', attention: [], unconfirmed: 'restart', lastEvidenceAtMs: 2000});
  const text = summarizeSessions({sessions: [session('ASKING'), restarted, finished], mode: undefined, synced: true}, 61_000);
  assert.deepEqual(text.split('\n'), [
    '3 coding agent session(s):',
    '- FINISHED (claude, code): finished (turn-ended); work idle, confirmed; last evidence 58 s ago',
    '- RESTARTED (codex, desktop): working (unconfirmed); work active, unconfirmed; last evidence 59 s ago',
    '- ASKING (codex, desktop): needs-owner (approval); work active, confirmed; waiting for approval; last evidence 1 min ago',
  ]);
  assert.doesNotMatch(text, /freshness|evidence uncertain/);
});

void test('a failed turn closes after clarification without another model call', async context => {
  const provider = counted((_input, turn) => {
    if (turn === 1) return call('ask_owner', {text: 'Which fixture?'});
    throw new ProviderFault('unavailable');
  });
  const w = await world(context, {provider});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Inspect a fixture.');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'The blue fixture.', true);
  await until(() => status(w) === 'failed');
  const messages = (await page(w)).messages;
  assert.equal(messages.at(-1)?.role, 'assistant');
  assert.match(messages.at(-1)?.text ?? '', /received your answer/i);
  assert.equal(provider.calls(), 2);
  await w.restart();
  assert.deepEqual((await page(w)).messages, messages);
});

void test('a failed compound turn reports the saved artwork and exact rejected display action', async context => {
  const requests: AssistantDispatch[] = [];
  const provider = counted((_input, turn) => {
    if (turn === 1) return call('create_artwork', {format: 'still', description: 'Synthetic paper kite'});
    if (turn === 2) return call('read_saved_art');
    if (turn === 3) return call('control_art_show', {owner: 'bunny/core', target: 'hub', arguments: JSON.stringify({artworkId: 'kite', targets: ['display-blue']})});
    throw new ProviderFault('unavailable');
  });
  const w = await world(context, {provider, tools: ['create_artwork', 'read_saved_art', 'control_art_show'], dispatch: data => {
    requests.push(data);
    return Promise.resolve(requests.length === 1 ? accepted(data.requestId) : {status: 'rejected', requestId: data.requestId, error: errorBody('not-found')});
  }});
  const art = w.bus.connect('bunny/modules/art');
  context.after(() => art.close());
  await art.serveSync(['art'], () => ({revision: 1, states: [{
    type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0', data: {id: 'art', revision: 1,
      jobs: [{requestId: requests[0]?.requestId, artworkId: 'kite', status: 'finished', outcome: 'succeeded'}],
      artworks: [{artworkId: 'kite', compositions: [{target: 'ui', outcome: 'succeeded', renditions: [{format: 'webp'}]}]}]},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Create and show the synthetic poster.');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'waiting' && task(w)?.questions === 2);
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'failed');
  const messages = (await page(w)).messages;
  assert.match(messages.at(-1)?.text ?? '', /paper kite.*artwork was saved.*display-blue.*request was refused/i);
  assert.equal(requests.length, 2);
  assert.equal(provider.calls(), 4);
  await w.restart();
  assert.deepEqual((await page(w)).messages, messages);
  assert.equal(requests.length, 2);
});

void test('the exhausted model budget saves a single read-only closing reply with no extra call', async context => {
  const provider = counted(() => call('ask_owner', {text: 'Which fixture?'}));
  const offers: SpokenReply[] = [];
  const w = await world(context, {provider, speak: reply => {offers.push(reply);}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic request with an exhausted budget.');
  await until(() => status(w) === 'waiting');
  assert.equal(offers.length, 1, 'the speaker received the clarification');
  const saved = w.store().task(task(w)?.taskId ?? '') ?? assert.fail('saved task');
  saved.modelCalls = LIMITS.modelCalls;
  w.store().save(saved);
  await input(w.core, w.module(), 'The second fixture.', true);
  await until(() => status(w) === 'failed');
  const messages = (await page(w)).messages;
  assert.match(messages.at(-1)?.text ?? '', /received your answer.*model call/i);
  assert.equal(messages.filter(item => item.text.includes('model call')).length, 1);
  assert.equal(provider.calls(), 1);
  assert.equal(offers.length, 1, 'the fallback is written only');
  assert.equal(task(w)?.toolCalls, 0);
});

void test('an approval that runs out of tool calls before dispatch closes without a write', async context => {
  const provider = counted(() => call('set_mode', {mode: 'quiet'}));
  const w = await world(context, {provider, tools: ['set_mode'], core: () => ({synced: true, sessions: [], mode: hub(5)}),
    dispatch: () => assert.fail('the tool budget refused the reservation')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Propose quiet mode.');
  await until(() => status(w) === 'waiting');
  const saved = w.store().task(task(w)?.taskId ?? '') ?? assert.fail('saved task');
  saved.toolCalls = LIMITS.toolCalls;
  w.store().save(saved);
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /Set the Hub mode to quiet.*stopped before dispatch.*tool call/i);
  assert.equal(provider.calls(), 1);
});

for (const rejected of [true, false]) {
  void test(`a later empty art effects read preserves ${rejected ? 'dispatch rejection' : 'observed preparation'} in the closing reply`, async context => {
    let requestId = '', prepareId = '', reads = 0;
    const provider = counted((_input, turn) => {
      if (turn === 1) return call('control_art_show', {owner: 'bunny/core', target: 'hub', arguments: JSON.stringify({artworkId: 'kite', targets: ['display-blue']})});
      if (turn <= 3) return call('read_art_show_effects', {requestId}, `effects-${turn}`);
      throw new ProviderFault('unavailable');
    });
    const w = await world(context, {provider, tools: ['control_art_show', 'read_art_show_effects'], dispatch: async data => {
      requestId = data.requestId;
      const [surface] = await artShowSurfaces(requestId, ['display-blue']);
      assert.ok(surface?.kind === 'display');
      prepareId = surface.prepareRequestId;
      return rejected ? {status: 'rejected', requestId, error: errorBody('not-found')} : accepted(requestId);
    }});
    await w.core.serveSync(['operation'], () => ({revision: ++reads, states: !rejected && reads === 1 ? [{
      type: 'org.bunny.operation.updated', subject: 'prep', dataschema: 'https://bunny.invalid/events/operation/2.0',
      data: {id: 'prep', requestId: prepareId, status: 'completed', result: 'succeeded', evidence: 'observed', revision: 1},
    }, {
      type: 'org.bunny.operation.updated', subject: 'show', dataschema: 'https://bunny.invalid/events/operation/2.0',
      data: {id: 'show', requestId, status: 'completed', result: 'succeeded', evidence: 'transmitted', revision: 1},
    }] : []}));
    await w.core.serveSync(['art-show-effects'], () => ({revision: 1, states: []}));
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Show the synthetic kite.');
    await until(() => status(w) === 'waiting');
    await input(w.core, w.module(), 'approve', true);
    await until(() => status(w) === 'failed');
    assert.equal(reads, 2);
    const closing = (await page(w)).messages.at(-1)?.text ?? '';
    assert.match(closing, rejected ? /request was refused/i : /command was transmitted.*preparation on display-blue.*observed a successful outcome.*presentation on display-blue is unconfirmed/i);
  });
}

void test('an unclassified failure after a recorded action explains that the turn stopped', async context => {
  const w = await world(context, {tools: ['set_mode'], core: () => ({synced: true, sessions: [], mode: hub(1)}),
    provider: counted((_input, turn) => {
      if (turn === 1) return call('set_mode', {mode: 'free'});
      throw new ProviderFault('internal');
    }), dispatch: data => Promise.resolve(accepted(data.requestId))});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic mode change followed by a question.');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /request was accepted.*turn stopped.*cause is unknown/i);
});

for (const [name, response, expected] of [
  ['model reply bytes', () => reply('x'.repeat(17 * 1024)), /model response exceeded.*size limit/i],
  ['per-call usage', () => ({...reply('done'), units: LIMITS.callUnits + 1}), /model.*usage.*per-call limit/i],
  ['invalid usage', () => ({...reply('done'), units: -1}), /invalid usage/i],
  ['provider capacity without a specific limit', () => {throw new ProviderFault('capacity');}, /^A capacity limit stopped this turn\.$/],
] as const) {
  void test(`the closing reply reports ${name}`, async context => {
    const provider = counted(response);
    const w = await world(context, {provider});
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Synthetic read-only question.');
    await until(() => status(w) === 'failed');
    assert.match((await page(w)).messages.at(-1)?.text ?? '', expected);
    assert.equal(provider.calls(), 1);
  });
}

void test('the closing reply explains an oversized tool result', async context => {
  const w = await world(context, {provider: counted(() => call('read_lifx')), tools: ['read_lifx'],
    readDevice: () => Promise.resolve('x'.repeat(LIMITS.toolBytes + 1))});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Read the synthetic light.');
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /tool result exceeded.*size limit/i);
});

void test('the closing reply explains an oversized graph checkpoint', async context => {
  context.mock.method(SqliteCheckpointSaver.prototype, 'put', function (this: SqliteCheckpointSaver, ...args: Parameters<SqliteCheckpointSaver['put']>) {
    context.mock.restoreAll();
    return this.put(args[0], {...args[1], channel_values: {...args[1].channel_values, fixture: 'x'.repeat(33 * 1024)}}, args[2], args[3]);
  });
  const w = await world(context);
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic checkpoint question.');
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /saved turn state exceeded.*size limit/i);
});

for (const [name, response, expected] of [
  ['response', () => new Response('x'.repeat(262_145)), /provider response exceeded.*size limit/i],
  ['request', () => new Response('', {status: 413}), /provider rejected.*request.*too large/i],
] as const) {
  void test(`the closing reply identifies the oversized provider ${name}`, async context => {
    const w = await world(context, {provider: new AnthropicProvider({key: 'synthetic', transport: () => Promise.resolve(response())})});
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Synthetic provider size test.');
    await until(() => status(w) === 'failed');
    assert.match((await page(w)).messages.at(-1)?.text ?? '', expected);
  });
}

void test('a full disk reported by the checkpoint writer names the storage cause if settlement can still be saved', async context => {
  const fault = Object.assign(new Error('private fixture detail'), {errcode: 13});
  context.mock.method(SqliteCheckpointSaver.prototype, 'put', () => Promise.reject(fault));
  const w = await world(context);
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic storage question.');
  await until(() => status(w) === 'failed');
  assert.equal(task(w)?.code, 'capacity');
  assert.equal((await page(w)).messages.at(-1)?.text, 'There was no space left to save the turn.');
});
