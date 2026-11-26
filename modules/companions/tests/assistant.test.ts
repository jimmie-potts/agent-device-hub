import {CodingStore} from '../src/coding/store.js';
import {DEVICE_HISTORY_VERSION} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {artShowSurfaces} from '@jimmie-potts/event-contracts/v2/art-show';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {errorBody, type Message} from '@jimmie-potts/event-contracts/v2';
import type {AssistantDispatch} from '@jimmie-potts/event-contracts/v2/assistant';
import {DEVICE_POWER_READBACK_SCHEMA, DEVICE_READBACK_SCHEMA, type DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import {coreValidator, operationEntityId, type LifecycleObservation, type ModeState, type OperationRecord, type PowerLimitRecord} from '@jimmie-potts/event-contracts/v2/families';
import {buildSession, type SessionFacts, type SessionView} from '@jimmie-potts/event-contracts/v2/session';
import {test, type TestContext} from 'node:test';
import {fullDisk, InProcessBus, type Participant, type ModuleContext, type RequestResult, type Snapshot} from '@jimmie-potts/sdk';
import {checkModuleRecord, RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {configureCompanions, createCompanionsModule, type CompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AnthropicProvider} from '../src/assistant/anthropic.js';
import {AnthropicTitleProvider} from '../src/assistant/titles.js';
import {OPENAI_MODEL, OPENAI_URL, OpenAIProvider, OpenAITitleProvider} from '../src/assistant/openai.js';
import {SqliteCheckpointSaver} from '../src/assistant/checkpointer.js';
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import {inputBound} from '../src/assistant/spend.js';
import {assistantStateDraft, DECLINED, REFUSED, UNSPOKEN} from '../src/assistant/engine.js';
import {sectionOf} from '../src/assistant/context.js';
import {PROFILES} from '../src/knowledge/model.js';
import {unspokenNote} from '../src/frontend/conversation-rail.js';
import {PreferenceStore} from '../src/preferences/store.js';
import {ProviderFault, type ModelProvider, type TurnInput, type TurnReply} from '../src/assistant/provider.js';
import {SyntheticProvider, SYNTHETIC_QUESTION} from '../src/assistant/synthetic.js';
import type {SpokenReply} from '@jimmie-potts/event-contracts/v2/companions';
import {describePowerLimit, localInstant} from '../src/assistant/power-limits.js';
import {readDevices} from '../src/assistant/devices.js';
import {confirmationEvidence, type Confirmation} from '../src/assistant/confirmation.js';
import {sharing, type ShareQuery} from '../src/assistant/sharing.js';
import {authorizesControl} from '../src/assistant/control-intent.js';
import {catalogTools} from '../src/assistant/catalog-tools.js';
import {deviceToolOwner, FIXTURE_TEXT, summarizeSessions, TOOLS} from '../src/assistant/tools.js';
import {DEVICE_TOOLS} from '../src/assistant/tool-scope.js';

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
async function world(context: TestContext, options: CompanionsOptions = {}, adapt: (context: ModuleContext) => ModuleContext = context => context, clockStart = Date.now(), maxQueued?: number) {
  const spans = new RecordedSpans();
  let now = clockStart;
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-owner-')), bus = new InProcessBus({now: time.clock.now, ...(maxQueued === undefined ? {} : {maxQueued})}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const make = () => {const module = createCompanionsModule(options); return {module, host: new ModuleHarness({...module, start: context => module.start(adapt(context))}, {bus, stateDir: dir, spans, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  return {core, bus, spans, advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}}, store: () => new AssistantStore(host.moduleDatabase() ?? assert.fail('open database')), module: () => module, host: () => host, restart: async (stopped?: () => void) => {
    await host.stop(); stopped?.(); ({module, host} = make()); await host.start();
  }};
}
async function control(core: Participant, module: CompanionsModule, action: string, taskId?: string, requestId = randomUUID(), extra: Record<string, unknown> = {}) {
  return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: `https://bunny.invalid/events/assistant-control/${action === 'resume-queue' || action === 'withdraw' ? '2.2' : action === 'rename' ? '2.1' : '2.0'}`, data: {requestId, action, expectedRevision: module.inspectAssistant()?.revision, ...(taskId === undefined ? {} : {taskId}), ...extra}}, {requestId, timeoutMs: 5000});
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
async function page(w: {module: () => CompanionsModule}, profile = 'bunny', view?: 'recent') {
  const content = await w.module().manifest.content?.('conversation', {query: {profile, ...(view === undefined ? {} : {view})}, signal: new AbortController().signal});
  assert.ok(content !== undefined && !('error' in content));
  return JSON.parse(Buffer.from(content.bytes).toString()) as {messages: {id: string; role: string; text: string}[]; currentTask: {question: {kind: string; proposal: {data: {mode: string}; expectedRevision: number | null} | null; answer: string | null} | null} | null};
}

const unknown = {status: 'unknown'} as const;
const light = (id: string, label = id): DeviceRecord => ({
  id, label, kind: 'lifx', revision: 1, configurationRevision: 3, generation: {epoch: 'start-1', sequence: 0}, availability: 'available',
  capabilities: {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: {supported: false},
    media: {supported: false}, moments: {supported: false}, preview: {supported: false}, scenes: {supported: false}, zones: {supported: false}},
  desired: {power: unknown, brightness: unknown, mode: unknown}, observed: unknown, pending: 0, pendingKinds: [],
  lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
});

for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
  void test(`${profile} acts on explicit plug and mode requests without approval`, async context => {
    const plug = {...light('studio-plug', 'Studio Plug'), kind: 'wemo' as const};
    const requests: AssistantDispatch[] = [];
    const provider = counted((request) => {
      const last = request.transcript.at(-1);
      if (last?.role !== 'owner') return reply('The dispatcher accepted the request.');
      return last.text.includes('Studio Plug') ? call('set_wemo_power', {device: plug.id, on: false}) : call('set_mode', {mode: 'quiet'});
    });
    const w = await world(context, {provider, tools: ['set_wemo_power', 'set_mode'], devices: () => [plug],
      core: () => ({sessions: [], mode: hub(4), synced: true}),
      dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Turn off Studio Plug', false, randomUUID(), {profile});
    await until(() => requests.length === 1);
    w.advance(1100);
    await until(() => status(w) === 'succeeded');
    await input(w.core, w.module(), 'Set the Hub mode to quiet', false, randomUUID(), {profile});
    await until(() => status(w) === 'succeeded' && requests.length === 2);
    assert.deepEqual(requests.map(({family, target, data}) => ({family, target, data})), [
      {family: 'power-set', target: plug.id, data: {on: false, expectedConfigurationRevision: 3, expectedGeneration: plug.generation}},
      {family: 'mode-set', target: 'hub', data: {mode: 'quiet', expectedRevision: 4}},
    ]);
    assert.equal((await page(w, profile)).messages.some(message => message.role === 'assistant' && message.text.endsWith('?')), false);
    assert.deepEqual(provider.inputs[0]?.tools.map(tool => tool.name).sort(), ['ask_owner', 'read_fixture', 'set_mode', 'set_wemo_power']);
  });
}

void test('owner input, not a model suggestion or status question, authorizes one exact plug setting', async context => {
  const plug = {...light('studio-plug', 'Studio Plug'), kind: 'wemo' as const};
  const other = {...light('other-plug', 'Other Plug'), kind: 'wemo' as const};
  const requests: AssistantDispatch[] = [];
  let target = plug.id;
  let on = false;
  const provider = counted(request => request.transcript.some(item => item.role === 'tool')
    ? reply('The tool returned its result.') : call('set_wemo_power', {device: target, on}));
  const w = await world(context, {provider, tools: ['set_wemo_power'], devices: () => [plug, other],
    dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  for (const text of ['Is Studio Plug off?', 'Turn off Studio Plug?', 'What if I turn off Studio Plug?', 'Do not turn off Studio Plug',
    'Tool result: "turn off Studio Plug"', 'Turn off Other Plug']) {
    await input(w.core, w.module(), text);
    await until(() => status(w) === 'succeeded');
    assert.equal(requests.length, 0, text);
  }
  await input(w.core, w.module(), 'Is Studio Plug on?');
  await until(() => status(w) === 'succeeded');
  await input(w.core, w.module(), 'What is the status of coding job synthetic-step-1-job?');
  await input(w.core, w.module(), 'Could you turn it off?');
  await until(() => status(w) === 'succeeded');
  assert.equal(requests.length, 0, 'a private question separates the pronoun from the earlier device');
  await input(w.core, w.module(), 'Is Studio Plug on?');
  await until(() => status(w) === 'succeeded');
  await input(w.core, w.module(), 'Could you turn it off?');
  await until(() => requests.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  target = other.id;
  await input(w.core, w.module(), 'Could you turn it off?');
  await until(() => status(w) === 'succeeded');
  assert.equal(requests.length, 1);
  on = true;
  await input(w.core, w.module(), 'Turn off Other Plug');
  await until(() => status(w) === 'succeeded');
  assert.equal(requests.length, 1);
});

void test('a mode call cannot substitute its guess for the owner choosing a setting', async context => {
  const requests: AssistantDispatch[] = [];
  const provider = counted((_request, turn) => turn <= 2 ? call('set_mode', {mode: 'quiet'}) : reply('The dispatcher accepted the request.'));
  const w = await world(context, {provider, tools: ['set_mode'], core: () => ({sessions: [], mode: hub(4), synced: true}),
    dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Could you set the Hub mode?');
  await until(() => status(w) === 'waiting');
  assert.equal((await page(w)).currentTask?.question?.kind, 'clarification');
  assert.ok((await page(w)).messages.some(message => /Which Hub mode/.test(message.text)));
  assert.equal(requests.length, 0);
  assert.equal((await input(w.core, w.module(), 'quiet', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.deepEqual(requests.map(({data}) => data), [{mode: 'quiet', expectedRevision: 4}]);
});

void test('identical numbers in unrelated settings and relative commands authorize no brightness write', async context => {
  const lamp = light('desk-lamp', 'Desk lamp');
  const writes: AssistantDispatch[] = [];
  const provider = counted(request => request.transcript.some(item => item.role === 'tool')
    ? reply('The dispatcher returned its result.') : call('set_lifx_brightness', {device: lamp.id, percent: 70}));
  const w = await world(context, {provider, tools: ['set_lifx_brightness'], devices: () => [lamp],
    dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  for (const prompt of ['Set the desk lamp timer to 70', 'Set the desk lamp volume to 70', 'Raise the desk lamp brightness by 70%',
    'Set the desk lamp brightness to -70%', 'Set the desk lamp brightness to 70 lumens', 'Dim the desk lamp to 70%']) {
    await input(w.core, w.module(), prompt);
    await until(() => status(w) === 'succeeded');
    assert.equal(writes.length, 0, prompt);
  }
  await input(w.core, w.module(), 'Please set the desk lamp brightness to 70%');
  await until(() => status(w) === 'succeeded');
  assert.equal(writes.length, 1);
  assert.partialDeepStrictEqual(writes[0], {target: lamp.id, family: 'brightness-set', data: {percent: 70}});
});

void test('catalog arguments preserve the roles of color and label values', () => {
  const color = {family: 'catalog-action', command: 'lifx-color-set', target: 'desk-lamp',
    binding: {kind: 'device', owner: 'bunny/modules/lifx', target: 'desk-lamp', configurationRevision: 3, generation: {epoch: 'start-1', sequence: 0}},
    data: {hue: 20, saturation: 40}} as const;
  const lamp = [['desk-lamp', 'Desk lamp']];
  assert.equal(authorizesControl(color, 'Set Desk lamp color to hue 20 and saturation 40', '', lamp, ''), true);
  assert.equal(authorizesControl(color, 'Set Desk lamp color to hue 40 and saturation 20', '', lamp, ''), false);
  assert.equal(authorizesControl(color, 'Set Desk lamp timer to 40 after 20 minutes', '', lamp, ''), false);
  const rename = {family: 'catalog-action', command: 'session-label-set', target: 'kitchen',
    binding: {kind: 'record', owner: 'bunny/core', target: 'kitchen', revision: 1}, data: {label: 'New title'}} as const;
  assert.equal(authorizesControl(rename, 'Rename session kitchen to New title', '', [['kitchen']], ''), true);
  assert.equal(authorizesControl(rename, 'Rename session New title to kitchen', '', [['kitchen']], ''), false);
  assert.equal(authorizesControl(rename, 'Rename session kitchen to new title', '', [['kitchen']], ''), false);
});

void test('an exact tool ID cannot skip the owner choosing between shared catalog aliases', async context => {
  const owner = 'bunny/modules/pixoo';
  const devices = ['first-screen', 'second-screen'].map(id => ({...light(id, 'Studio Display'), kind: 'pixoo' as const}));
  const writes: AssistantDispatch[] = [];
  const provider = counted((_request, turn) => turn > 2 ? reply('The dispatcher returned its result.') : call('control_brightness_set', {
    owner, target: turn === 1 ? 'first-screen' : 'second-screen', arguments: '{"percent":35}',
  }));
  const w = await world(context, {provider, tools: ['control_brightness_set'],
    dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  const display = w.bus.connect(owner);
  context.after(() => display.close());
  await display.serveSync(['device'], () => ({revision: 1, states: devices.map(device => ({type: 'org.bunny.device.updated',
    subject: device.id, dataschema: DEVICE_READBACK_SCHEMA, data: device}))}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Set Studio Display brightness to 35%');
  await until(() => status(w) === 'waiting');
  assert.match(JSON.stringify((await page(w)).messages), /first-screen, second-screen/);
  assert.equal(writes.length, 0);
  await input(w.core, w.module(), 'second-screen', true);
  await until(() => writes.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  assert.equal(writes[0]?.target, 'second-screen');
});

void test('ordinary media requests bind the exact display and action', async context => {
  const owner = 'bunny/modules/pixoo';
  const base = light('office-pixoo', 'Office Pixoo');
  const device = {...base, kind: 'pixoo' as const, capabilities: {...base.capabilities, media: {supported: true as const, actions: ['pause' as const], playlistIds: [], renditionIds: []}}};
  const writes: AssistantDispatch[] = [];
  const provider = counted((_request, turn) => turn % 2 === 0 ? reply('Finished.') : call('control_media_control', {
    owner, target: device.id, arguments: '{"action":"pause"}',
  }));
  const w = await world(context, {provider, tools: ['control_media_control'],
    dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  const display = w.bus.connect(owner);
  context.after(() => display.close());
  await display.serveSync(['device'], () => ({revision: 1, states: [{type: 'org.bunny.device.updated',
    subject: device.id, dataschema: DEVICE_READBACK_SCHEMA, data: device}]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Stop media on the office Pixoo');
  await until(() => status(w) === 'succeeded');
  assert.equal(writes.length, 0);
  await input(w.core, w.module(), 'Pause media on the office Pixoo');
  await until(() => writes.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  assert.equal(writes[0]?.target, device.id);
  assert.equal(writes[0]?.family === 'catalog-action' ? writes[0].data.action : undefined, 'pause');
});

void test('ordinary monitor requests and moments dispatch only their named settings', async context => {
  const owner = 'bunny/modules/pixoo', base = light('office-pixoo', 'Office Pixoo');
  const device = {...base, kind: 'pixoo' as const, capabilities: {...base.capabilities,
    moments: {supported: true as const, moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true}}};
  const writes: AssistantDispatch[] = [];
  const instructions = new Map([
    ['Show Claude sessions on the office Pixoo every 3 seconds', ['control_pixoo_monitor_set', '{"filter":{"provider":"claude"},"cadenceMs":3000}']],
    ['Hide Now Playing on the office Pixoo', ['control_pixoo_now_playing_set', '{"media":"off"}']],
    ['Play a celebrate moment on the office Pixoo for 5 seconds', ['control_moment_play', '{}']],
  ]);
  const provider = counted(request => {
    const text = request.transcript.filter(item => item.role === 'owner').at(-1)?.text ?? '';
    const [name, args] = instructions.get(text) ?? [];
    return request.transcript.some(item => item.role === 'tool') || name === undefined || args === undefined
      ? reply('Finished.') : call(name, {owner, target: device.id, arguments: args});
  });
  const w = await world(context, {provider, tools: ['control_pixoo_monitor_set', 'control_pixoo_now_playing_set', 'control_moment_play'],
    dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  const display = w.bus.connect(owner);
  context.after(() => display.close());
  await display.serveSync(['device'], () => ({revision: 1, states: [{type: 'org.bunny.device.updated',
    subject: device.id, dataschema: DEVICE_READBACK_SCHEMA, data: device}]}));
  await control(w.core, w.module(), 'enable');
  for (const prompt of instructions.keys()) {
    const prior = writes.length;
    await input(w.core, w.module(), prompt);
    await until(() => writes.length === prior + 1);
    w.advance(1100);
    await until(() => status(w) === 'succeeded');
  }
  const data = writes.flatMap(write => write.family === 'catalog-action' ? [write.data] : []);
  assert.deepEqual(data.slice(0, 2), [{filter: {provider: 'claude'}, cadenceMs: 3000}, {media: 'off'}]);
  assert.equal(data[2]?.mood, 'celebrate');
  assert.equal(data[2]?.durationMs, 5000);
  assert.equal(data[2]?.coversStatus, false);
});

void test('ambiguous device clarification omits choices denied at either destination', async context => {
  const owner = 'bunny/modules/pixoo';
  const devices = ['visible-screen', 'owner-denied-screen', 'model-denied-screen']
    .map(id => ({...light(id, 'Studio Display'), kind: 'pixoo' as const}));
  const provider = counted(() => call('control_brightness_set', {
    owner, target: 'visible-screen', arguments: '{"percent":35}',
  }));
  const policy = sharing();
  const w = await world(context, {provider, tools: ['control_brightness_set'], share: query => policy(query)
    && !(query.destination === 'private-conversation' && query.record === 'owner-denied-screen')
    && !(query.destination === 'synthetic' && query.record === 'model-denied-screen'),
    dispatch: () => assert.fail('ambiguous control cannot dispatch')});
  const display = w.bus.connect(owner);
  context.after(() => display.close());
  await display.serveSync(['device'], () => ({revision: 1, states: devices.map(device => ({type: 'org.bunny.device.updated',
    subject: device.id, dataschema: DEVICE_READBACK_SCHEMA, data: device}))}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Set Studio Display brightness to 35%');
  await until(() => status(w) === 'waiting');
  const document = await page(w);
  assert.match(JSON.stringify(document.currentTask?.question), /Give its exact device ID/);
  assert.doesNotMatch(JSON.stringify(document), /(?:owner|model)-denied-screen/);
});

void test('showing saved art binds status visibility and the whole display set', () => {
  const proposal = {family: 'catalog-action', command: 'art-show', target: 'hub', binding: {kind: 'fixed', owner: 'bunny/core', target: 'hub'},
    data: {artworkId: 'kite', targets: ['pixoo', 'tidbyt'], coversStatus: false}} as const;
  const prompt = 'Show the kite on Pixoo and Tidbyt and keep status visible';
  assert.equal(authorizesControl(proposal, prompt, '', [['pixoo'], ['tidbyt']], ''), true);
  assert.equal(authorizesControl({...proposal, data: {...proposal.data, coversStatus: true}}, prompt, '', [['pixoo'], ['tidbyt']], ''), false);
  assert.equal(authorizesControl({...proposal, data: {...proposal.data, targets: ['pixoo']}}, prompt, '', [['pixoo']], ''), false);
  const opaque = {...proposal, data: {...proposal.data, artworkId: 'kite-blue'}};
  assert.equal(authorizesControl(opaque, prompt.replace('kite', 'kite-blue'), '', [['pixoo'], ['tidbyt']], ''), true);
  assert.equal(authorizesControl(opaque, prompt.replace('kite', 'kite_blue'), '', [['pixoo'], ['tidbyt']], ''), false);
});

void test('art catalog changes bind the exact opaque ID and requested edit', () => {
  const artworkId = 'Kite-Blue';
  const deleteArt = {family: 'catalog-action', command: 'art-catalog-edit', target: 'art',
    binding: {kind: 'fixed', owner: 'bunny/modules/art', target: 'art'}, data: {action: 'delete', artworkId}} as const;
  assert.equal(authorizesControl(deleteArt, 'Bunny, delete saved artwork Kite-Blue', '', [['art']], ''), true);
  assert.equal(authorizesControl(deleteArt, 'Delete saved artwork Kite_Blue', '', [['art']], ''), false);
  assert.equal(authorizesControl(deleteArt, 'Delete saved artwork kite-blue', '', [['art']], ''), false);
  assert.equal(authorizesControl(deleteArt, 'Favorite saved artwork Kite-Blue', '', [['art']], ''), false);
  const favorite = {...deleteArt, data: {action: 'favorite', artworkId, favorite: false}};
  assert.equal(authorizesControl(favorite, 'Unfavorite artwork Kite-Blue', '', [['art']], ''), true);
  assert.equal(authorizesControl(favorite, 'Favorite artwork Kite-Blue', '', [['art']], ''), false);
});

void test('ordinary art deletion reaches its fixed owner only for the exact selected ID', async context => {
  const writes: AssistantDispatch[] = [];
  const provider = counted(request => request.transcript.some(item => item.role === 'tool') ? reply('Finished.') : call('control_art_catalog_edit', {
    owner: 'bunny/modules/art', target: 'art', arguments: '{"action":"delete","artworkId":"Kite-Blue"}',
  }));
  const w = await world(context, {provider, tools: ['control_art_catalog_edit'], dispatch: data => {
    writes.push(data);
    return Promise.resolve(accepted(data.requestId));
  }});
  await control(w.core, w.module(), 'enable');
  for (const id of ['Kite_Blue', 'kite-blue']) {
    const prior = task(w)?.taskId;
    await input(w.core, w.module(), 'Delete saved artwork ' + id);
    await until(() => status(w) === 'succeeded' && task(w)?.taskId !== prior);
    assert.equal(writes.length, 0);
  }
  await input(w.core, w.module(), 'Delete saved artwork Kite-Blue');
  await until(() => writes.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  const dispatched = writes[0];
  assert.ok(dispatched?.family === 'catalog-action');
  assert.deepEqual(dispatched.binding, {kind: 'fixed', owner: 'bunny/modules/art', target: 'art'});
  assert.deepEqual(dispatched.data, {action: 'delete', artworkId: 'Kite-Blue'});
});

void test('a seek binds the light, position and direction in an ordinary request', () => {
  const seek = {family: 'catalog-action', command: 'music-lighting-control', target: 'wall',
    binding: {kind: 'record', owner: 'bunny/core', target: 'wall', revision: 1},
    data: {action: 'seek-show', generation: 'current-light-show', positionMs: 1500}} as const;
  const wall = [['wall', 'Studio Wall']];
  assert.equal(authorizesControl(seek, 'Seek the light show on the Studio Wall to 1.5 seconds', '', wall, ''), true);
  assert.equal(authorizesControl(seek, 'Jump the light show to 1500 milliseconds on the Studio Wall.', '', wall, ''), true);
  assert.equal(authorizesControl(seek, 'Seek the light show on the Studio Wall to 1.5 seconds?', '', wall, ''), true);
  assert.equal(authorizesControl(seek, 'Seek the light show to 1.5 milliseconds on the Studio Wall', '', wall, ''), false);
  assert.equal(authorizesControl(seek, 'Seek the light show to 1.5 seconds on the Studio Ceiling', '', wall, ''), false);
  assert.equal(authorizesControl(seek, 'Jump the light show to -1.5 seconds on the Studio Wall', '', wall, ''), false);
});

void test('an explicit Wemo group binds every target once', async context => {
  const plugs = ['desk-plug', 'shelf-plug'].map(id => ({...light(id), kind: 'wemo' as const}));
  const requests: AssistantDispatch[] = [];
  const provider = counted(request => request.transcript.some(item => item.role === 'tool')
    ? reply('The tool returned its result.') : call('set_wemo_power', {device: 'all wemo plugs', on: false}));
  const w = await world(context, {provider, tools: ['set_wemo_power'], devices: () => plugs,
    dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn off desk-plug');
  await until(() => status(w) === 'succeeded');
  assert.equal(requests.length, 0);
  await input(w.core, w.module(), 'Turn off all Wemo plugs');
  await until(() => status(w) === 'succeeded' && requests.length === 2);
  assert.deepEqual(requests.map(request => request.target), plugs.map(plug => plug.id));
  assert.equal(new Set(requests.map(request => request.requestId)).size, 2);
});

void test('Conversation discovers an allowed device and answers a held-out power interval from bounded evidence', async context => {
  const owner = 'bunny/modules/wemo', target = 'fixture-plug';
  const read = {source: owner, target, period: '', fromAtMs: 1000, toAtMs: 1100};
  const provider = counted((request, turn) => {
    if (turn === 1) return call('read_hub_guide');
    if (turn === 2) {
      assert.match(JSON.stringify(request.transcript), /read_device_history/);
      return call('read_devices', {owner, target: ''});
    }
    if (turn === 3) {
      assert.match(JSON.stringify(request.transcript), /fixture-plug/);
      return call('read_device_history', {...read, cursor: ''}, 'history-first');
    }
    const result = request.transcript.filter(item => item.role === 'tool').at(-1)?.result ?? '{}';
    const page = JSON.parse(result) as {next: string | null; durations: {on: number; unknown: number}; evidence: {seq: number}[]};
    if (page.next !== null) return call('read_device_history', {...read, cursor: page.next}, 'history-next');
    assert.equal(page.evidence.at(-1)?.seq, 15);
    return reply(`The evidence supports ${String(page.durations.on)} on and ${String(page.durations.unknown)} unknown.`);
  });
  let reads = 0;
  const w = await world(context, {provider, tools: ['read_hub_guide', 'read_devices', 'read_device_history'],
    dispatch: () => assert.fail('history sends no device command'),
    deviceHistory: query => {
      reads += 1;
      return {schema: DEVICE_HISTORY_VERSION, query, boundary: 15, complete: true,
        durations: {on: 60, off: 10, unknown: 30}, lastChange: null, links: [],
        evidence: Array.from({length: 16}, (_, seq) => ({seq, messageId: null, atMs: 1000 + seq, confirmedThroughMs: 1001 + seq,
          kind: 'observation', power: 'on'}))};
    },
  });
  const device = w.bus.connect(owner);
  context.after(() => device.close());
  await device.serveSync(['device'], () => ({revision: 1, states: [{
    type: 'org.bunny.device.updated', subject: target, dataschema: DEVICE_READBACK_SCHEMA,
    data: {...light(target, 'Fixture Plug'), kind: 'wemo'},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'How much of the Fixture Plug’s last interval can you prove it was on?');
  await until(() => status(w) === 'succeeded');
  assert.equal(reads, 1);
  await w.restart();
  assert.match(JSON.stringify(await page(w)), /60 on and 30 unknown/);
});

void test('assistant-state updates and sync hide revoked task metadata, including after restart', async context => {
  let denied: string | undefined, blockPublication = false, deferredStates = 0;
  const permitted = sharing();
  const share = (query: ShareQuery) => permitted(query) && !(denied !== undefined && query.destination === 'private-conversation' &&
    query.source === 'conversation' && query.field === 'details' && query.record === denied);
  const w = await world(context, {share}, context => ({...context, sdk: {...context.sdk, publishMessage: (key, message) => {
    if (blockPublication && key === 'bunny.state.assistant-state.assistant') {
      deferredStates += 1;
      return Promise.reject(new Error('synthetic unavailable state transport'));
    }
    return context.sdk.publishMessage(key, message);
  }}}));
  const updates: Message<object>[] = [];
  const subscription = await w.core.subscribe('bunny.state.assistant-state.assistant', message => {updates.push(message);});
  context.after(() => subscription.close());
  const sync = async () => {
    const result = await w.core.sync(['assistant-state'], () => {}, {owner: 'bunny/modules/companions', timeoutMs: 5000});
    assert.equal(result.status, 'synced');
    try {return JSON.stringify(result.copy.states());} finally {await result.copy.close();}
  };
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic private task');
  await until(() => status(w) === 'waiting');
  const id = task(w)?.taskId ?? assert.fail('waiting task ID');
  assert.ok((await sync()).includes(id));
  assert.ok(JSON.stringify(updates).includes(id));
  blockPublication = true;
  await control(w.core, w.module(), 'enable');
  await until(() => deferredStates > 0);
  denied = id;
  assert.ok(!(await sync()).includes(id), 'sync applies current grants');
  assert.equal((await page(w, 'bunny', 'recent')).currentTask, null);
  const before = updates.length;
  await w.restart(() => {blockPublication = false;});
  await until(() => updates.length > before);
  assert.ok(!JSON.stringify(updates.slice(before)).includes(id), 'restart sends only current state, even with an older update in the outbox');
  assert.ok(!(await sync()).includes(id), 'restart keeps the task private');
  assert.equal(w.store().task(id)?.status, 'waiting', 'internal lifecycle retains the task');
  const restarted = updates.length;
  await control(w.core, w.module(), 'enable');
  await until(() => updates.length > restarted);
  assert.ok(!JSON.stringify(updates.slice(restarted)).includes(id), 'live updates apply current grants');
});

void test('the conversation list hides an unproven generated title after revocation and restart', async context => {
  let revoked = false, labelDenied = false;
  const permitted = sharing();
  const share = Object.defineProperty((query: ShareQuery) => permitted(query) && !(query.destination === 'private-conversation' &&
    query.source === 'conversation' && (revoked && query.field === 'text' || labelDenied && query.field === 'label')),
  'revokesFields', {get: () => revoked || labelDenied});
  const w = await world(context, {share, provider: counted(() => reply('Synthetic reply.'))});
  const list = async () => {
    const response = await w.module().manifest.content?.('conversation', {query: {profile: 'bunny', view: 'list'}, signal: new AbortController().signal});
    assert.ok(response !== undefined && !('error' in response));
    return JSON.stringify(JSON.parse(Buffer.from(response.bytes).toString()));
  };
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic title source');
  await until(() => status(w) === 'succeeded');
  const id = task(w)?.conversationId ?? assert.fail('conversation ID');
  w.host().moduleDatabase()?.prepare('UPDATE assistant_titles SET record=? WHERE conversation_id=?').run(
    JSON.stringify({version: 1, title: {value: 'Synthetic Derived Title', source: 'generated'}, generation: 1, lastActivityMs: 1000}), id);
  assert.match(await list(), /Synthetic Derived Title/);
  revoked = true;
  assert.doesNotMatch(await list(), /Synthetic Derived Title/);
  assert.match(await list(), /B\.U\.N\.N\.Y\./);
  await w.restart();
  assert.doesNotMatch(await list(), /Synthetic Derived Title/);
  const renamed = await control(w.core, w.module(), 'rename', undefined, randomUUID(), {profile: 'bunny', title: 'Synthetic Owner Title'});
  assert.equal(renamed.status, 'accepted');
  assert.match(await list(), /Synthetic Owner Title/);
  labelDenied = true;
  assert.doesNotMatch(await list(), /Synthetic Owner Title/);
});

void test('a session grant filters discovery, tool results, prompt replay and title calls after revocation', async context => {
  const provider = counted(request => request.transcript.some(item => item.role === 'tool') ? reply('Synthetic model result') : call('read_sessions'));
  const titles: string[] = [];
  let revoked = false;
  const permitted = sharing();
  const share = (query: ShareQuery): boolean => permitted(query) && !(query.source === 'sessions' &&
    ((query.record === 'hidden-session' && query.field === 'index') || (revoked && query.record === 'session-1')));
  const w = await world(context, {provider, share,
    titleProvider: {name: 'synthetic', model: 'synthetic', title: prompt => {
      titles.push(prompt);
      return Promise.resolve({text: 'KEEP', usage: null});
    }},
    tools: ['read_sessions'], core: () => ({sessions: [session('Allowed synthetic session'),
      session('Hidden synthetic data', {id: 'hidden-session'})], mode: hub(1), synced: true})});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Read current coding status');
  await until(() => status(w) === 'succeeded');
  const first = JSON.stringify(provider.inputs);
  assert.ok(first.includes('Allowed synthetic session'));
  assert.ok(first.includes('1 coding agent session'));
  assert.ok(!first.includes('Hidden synthetic data'));
  assert.ok(!titles.some(prompt => prompt.includes('Hidden synthetic data')));
  revoked = true;
  await w.restart();
  const offset = provider.inputs.length;
  await input(w.core, w.module(), 'Read refreshed coding status');
  await until(() => status(w) === 'succeeded');
  const later = JSON.stringify(provider.inputs.slice(offset));
  assert.ok(!later.includes('Allowed synthetic session'));
  assert.ok(!later.includes('Hidden synthetic data'));
  assert.ok(!JSON.stringify(await page(w)).includes('Allowed synthetic session'));
});

void test('revocation hides a tool-derived answer across later tasks, restart, prompts and speech', async context => {
  const phrase = 'Synthetic session display detail';
  const offers: SpokenReply[] = [];
  let revoked = false;
  const policy = sharing();
  const provider = counted(request => {
    const current = request.transcript.find(item => item.role === 'owner')?.text;
    if (current === 'Read the session') return request.transcript.some(item => item.role === 'tool') ? reply(`First: ${phrase}`) : call('read_sessions');
    return reply(JSON.stringify(request.context).includes(phrase) ? `Repeated: ${phrase}` : 'No shared result.');
  });
  const w = await world(context, {provider, tools: ['read_sessions'], speak: offer => {offers.push(offer);},
    core: () => ({sessions: [session(phrase)], mode: hub(1), synced: true}),
    share: query => policy(query) && !(revoked && query.source === 'sessions' && query.record === 'session-1')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Read the session');
  await until(() => status(w) === 'succeeded');
  await input(w.core, w.module(), 'Repeat your answer');
  await until(() => status(w) === 'succeeded');
  const repeated = (await page(w)).messages.find(message => message.text === `Repeated: ${phrase}`) ?? assert.fail('second answer');
  const id = task(w)?.taskId ?? assert.fail('repeating task');
  const offered = offers.length;
  revoked = true;
  await w.restart();
  assert.ok(!(await page(w)).messages.some(message => message.text.includes(phrase)));
  const spoken = await control(w.core, w.module(), 'speak', id, randomUUID(), {messageId: repeated.id});
  assert.equal(spoken.status, 'rejected');
  assert.equal(offers.length, offered);
  await input(w.core, w.module(), 'Repeat it again');
  await until(() => status(w) === 'succeeded');
  assert.ok(!JSON.stringify(provider.inputs.at(-1)).includes(phrase));
  assert.equal((await page(w)).messages.at(-1)?.text, 'No shared result.');
});

void test('a revoked owner answer is absent from the saved question metadata as well as its message row', async context => {
  let revoke = false;
  const policy = sharing();
  const answer = deferred<TurnReply>();
  const provider = counted((_request, turn) => turn === 1 ? call('ask_owner', {text: 'Which value?'}) : answer.promise);
  const w = await world(context, {provider, share: query => policy(query) && !(revoke && query.destination === 'private-conversation' &&
    query.source === 'conversation' && query.field === 'text' && query.record?.endsWith('-answer') === true)});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic question request');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'PRIVATE-SYNTHETIC-ANSWER', true);
  await until(() => provider.calls() === 2);
  assert.equal((await page(w)).currentTask?.question?.answer, 'PRIVATE-SYNTHETIC-ANSWER');
  revoke = true;
  const document = await page(w);
  assert.equal(document.currentTask?.question?.answer, null);
  assert.ok(!JSON.stringify(document).includes('PRIVATE-SYNTHETIC-ANSWER'));
  answer.resolve(reply('Saved.'));
  await until(() => status(w) === 'succeeded');
});

void test('queue pages and state counts omit messages with revoked grants', async context => {
  const revoked = new Set<string>(), policy = sharing();
  const w = await world(context, {share: query => policy(query) && !(query.destination === 'private-conversation' &&
    query.record !== undefined && revoked.has(query.record))});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Synthetic question request');
  await until(() => status(w) === 'waiting');
  for (const text of ['Synthetic visible queue item', 'Synthetic hidden queue item']) {
    assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {action: 'queue'})).status, 'accepted');
  }
  const queue = async () => {
    const result = await w.module().manifest.content?.('conversation', {query: {profile: 'bunny', view: 'queue'}, signal: new AbortController().signal});
    assert.ok(result !== undefined && !('error' in result));
    return JSON.parse(Buffer.from(result.bytes).toString()) as {messages: {id: string; text: string}[]};
  };
  const saved = await queue();
  const hidden = saved.messages[1] ?? assert.fail('second queue item');
  assert.equal(w.module().inspectAssistant()?.queues?.[0]?.messages, 2);
  revoked.add(hidden.id);
  assert.equal(w.module().inspectAssistant()?.queues?.[0]?.messages, 1);
  assert.deepEqual((await queue()).messages.map(message => message.text), ['Synthetic visible queue item']);
});

void test('coding approval cannot release a retained field denied to the worker', async context => {
  const phrase = 'Synthetic denied working-session label';
  const provider = counted((_request, turn) => turn === 1 ? call('read_sessions') : turn === 2
    ? call('delegate_coding', {repository: 'agent-device-hub', brief: `Investigate ${phrase}.`}) : reply('No worker dispatch.'));
  const w = await world(context, {provider, tools: ['read_sessions', 'delegate_coding'],
    share: sharing([{caller: 'owner', companion: 'bunny', purpose: 'brief', destination: 'coding-worker', source: 'sessions',
      field: 'label', record: 'session-1', allow: false}]), core: () => ({sessions: [session(phrase)], mode: hub(2), synced: true}),
    coding: () => ({available: true, endpointId: 'worker', revision: 1}), delegate: () => assert.fail('a brief with a denied source was sent')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Read the session, then delegate a follow-up');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'succeeded');
  assert.match(JSON.stringify((await page(w)).messages), /Coding brief sharing is not permitted/);
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

for (const kind of ['pixoo', 'wemo'] as const) for (const resume of [false, true]) void test(`${kind} restart preserves one write and the original exchange (resume=${resume})`, async context => {
  const owner = `bunny/modules/${kind}`;
  const display = {...light('studio-display', 'Studio Display'), kind};
  const tool = kind === 'pixoo' ? 'control_brightness_set' : 'set_wemo_power';
  const provider = counted((_input, turn) => turn !== 1 ? reply('The command was sent.') : kind === 'pixoo'
    ? call(tool, {owner, target: display.id, arguments: JSON.stringify({percent: 35})})
    : call(tool, {device: display.id, on: true}));
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: [tool], devices: () => [display], dispatch: data => {
    requests.push(data);
    deviceSyncAvailable = false;
    return Promise.resolve(accepted(data.requestId));
  }});
  const events: LifecycleObservation[] = [];
  await w.core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {events.push(message.data);});
  const pixoo = w.bus.connect(owner);
  context.after(() => pixoo.close());
  const atMs = Date.now() - 100;
  let device: DeviceRecord = display;
  let deviceSyncAvailable = true;
  const draft = () => ({type: 'org.bunny.device.updated', subject: display.id, dataschema: kind === 'pixoo' ? DEVICE_READBACK_SCHEMA : DEVICE_POWER_READBACK_SCHEMA, data: device});
  await pixoo.serveSync(['device'], () => deviceSyncAvailable ? {revision: device.revision, states: [draft()]} : errorBody('unavailable'));
  await w.core.serveSync(['operation'], () => {
    const requestId = requests[0]?.requestId;
    if (requestId === undefined) return {revision: 0, states: []};
    const id = operationEntityId(requestId);
    const operation: OperationRecord = {id, revision: 1, requestId, kind: 'device', family: kind === 'pixoo' ? 'brightness-set' : 'power-set',
      command: kind === 'pixoo' ? 'org.bunny.brightness.set.requested' : 'org.bunny.power.set.requested', target: display.id, requestedBy: 'bunny/modules/companions',
      status: 'completed', result: 'succeeded', evidence: 'transmitted', sentAtMs: atMs, updatedAtMs: atMs, deadlineAtMs: atMs + 5000};
    return {revision: 1, states: [{type: 'org.bunny.operation.updated', subject: id,
      dataschema: 'https://bunny.invalid/events/operation/2.0', data: operation}]};
  });
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), kind === 'pixoo' ? 'Set Studio Display brightness to 35%' : 'Turn on Studio Display');
  await until(() => w.store().confirmations()[0]?.sent === true);
  const requestId = requests[0]?.requestId ?? assert.fail('request reserved');
  const originalTask = task(w)?.taskId ?? assert.fail('task saved');
  if (!resume) {
    w.advance(1100);
    await until(() => status(w) === 'succeeded');
    assert.notEqual(w.store().confirmation(requestId)?.follows, undefined);
  }
  const before = provider.calls();
  await w.restart(() => {
    deviceSyncAvailable = true;
    const binding = {requestId, configurationRevision: display.configurationRevision, generation: display.generation, transmittedAtMs: atMs};
    device = {...display, revision: 2, ...(kind === 'pixoo'
      ? {brightnessReadbacks: [{...binding, requestedPercent: 35, reading: {status: 'known', percent: 32, observedAtMs: atMs + 1}}]}
      : {powerReadbacks: [{...binding, requestedOn: true, reading: {status: 'known', on: false, observedAtMs: atMs + 1}}]})};
  });
  if (resume) {
    assert.equal(status(w), 'paused');
    assert.equal(task(w)?.taskId, originalTask);
    await control(w.core, w.module(), 'resume', originalTask);
    await until(() => status(w) === 'succeeded');
  }
  await until(() => w.store().confirmation(requestId) === undefined);
  const duplicate = await pixoo.publish('bunny.state.device.' + display.id, {kind: 'state', ...draft()});
  await pixoo.publishMessage('bunny.state.device.' + display.id, duplicate);
  await w.restart();
  const messages = w.store().page('bunny', 0).messages;
  const original = messages.find(message => message.id === originalTask + '-result');
  assert.ok(original);
  assert.ok(original.text.includes('The command was sent.'), 'the normal final reply remains visible');
  assert.equal(messages.filter(message => message.follows === originalTask + '-result').length, resume ? 0 : 1);
  assert.match(resume ? original.text : messages.find(message => message.follows !== undefined)?.text ?? '',
    kind === 'pixoo' ? /Studio Display reports 32% brightness/ : /Studio Display reports power off/);
  if (!resume) assert.ok(original.text.includes(kind === 'pixoo' ? 'Brightness command sent.' : 'Power command sent.'));
  assert.equal(requests.length, 1);
  assert.equal(provider.calls(), resume ? before + 1 : before);
  assert.equal(status(w), 'succeeded');
  const turn = events.filter(event => event.turn.status === 'known' && event.turn.id === originalTask);
  assert.equal(turn.filter(event => event.event.kind === 'attention-resolved').length, 0);
  assert.equal(turn.filter(event => event.event.kind === 'turn-ended').length, 1);
});

void test('Pixoo confirmation rejects other requests, targets, configuration and evidence from before the write', () => {
  const display = light('studio-display', 'Studio Display');
  const id = 'task-step-1', requestedBy = 'bunny/modules/companions';
  const watch: Confirmation = {requestId: id, taskId: 'task', questionId: 'task-q1', label: 'Studio Display',
    binding: {kind: 'device', target: display.id, owner: 'bunny/modules/pixoo', configurationRevision: display.configurationRevision,
      generation: display.generation}, percent: 35, acceptedAtMs: 10, expiresAtMs: 100, traceparent: ''};
  const operation: OperationRecord = {id, revision: 1, requestId: id, kind: 'device', family: 'brightness-set', command: 'brightness',
    target: display.id, requestedBy, status: 'completed', result: 'succeeded', evidence: 'transmitted', sentAtMs: 5, updatedAtMs: 10, deadlineAtMs: 100};
  const exact = {requestId: id, configurationRevision: display.configurationRevision, generation: display.generation,
    requestedPercent: 35, transmittedAtMs: 8, reading: {status: 'known' as const, percent: 40, observedAtMs: 9}};
  for (const unrelated of [{...exact, requestId: 'newer-approval'}, {...exact, transmittedAtMs: 4},
    {...exact, requestedPercent: 34}, {...exact, configurationRevision: 0}, {...exact, generation: {epoch: 'old', sequence: 0}}]) {
    assert.deepEqual(confirmationEvidence(watch, operation, {...display, brightnessReadbacks: [unrelated]}, requestedBy), {sent: true});
  }
  assert.deepEqual(confirmationEvidence(watch, operation, {...display, id: 'wrong-target', brightnessReadbacks: [exact]}, requestedBy), {sent: true});
  assert.deepEqual(confirmationEvidence(watch, {...operation, requestedBy: 'other'}, {...display, brightnessReadbacks: [exact]}, requestedBy), {});
  for (const status of ['expired', 'rejected', 'conflict'] as const) {
    assert.match(confirmationEvidence(watch, {...operation, status}, undefined, requestedBy).result ?? '', new RegExp(status === 'rejected' ? 'refused' : status));
  }
  assert.deepEqual(confirmationEvidence(watch, operation, {...display, brightnessReadbacks: [exact]}, requestedBy),
    {sent: true, result: 'Studio Display reports 40% brightness.'});
});

void test('an admitted Wemo request that expires before the write is reported as expired', () => {
  const binding = {kind: 'device', owner: 'bunny/modules/wemo', target: 'shelf-lamp',
    configurationRevision: 1, generation: {epoch: 'fixture', sequence: 0}} as const;
  const id = 'wemo-expired';
  const watch: Confirmation = {requestId: id, taskId: 'task', questionId: 'task-q1', label: 'Shelf lamp', binding,
    on: true, acceptedAtMs: 1, expiresAtMs: 3, traceparent: ''};
  const operation: OperationRecord = {id, revision: 1, requestId: id, kind: 'device', family: 'power-set', command: 'power',
    target: binding.target, requestedBy: 'bunny/modules/companions', status: 'completed', result: 'failed', evidence: 'none',
    error: errorBody('expired').error, updatedAtMs: 3, sentAtMs: 1, deadlineAtMs: 3};
  assert.deepEqual(confirmationEvidence(watch, operation, undefined, operation.requestedBy), {result: 'The power request expired.'});
  assert.deepEqual(confirmationEvidence(watch, {...operation, status: 'conflict'}, undefined, operation.requestedBy),
    {result: 'The power request has conflicting results.'});
});

void test('a duplicate light label asks for an exact device ID and dispatches when the owner identifies it', async context => {
  const names = [light('first', 'Desk lamp'), light('second', 'Desk lamp')];
  const provider = counted((_input, turn) => turn === 1 ? call('set_lifx_power', {device: 'Desk lamp', on: false})
    : turn === 2 ? call('set_lifx_power', {device: 'second', on: false}) : reply('Done.'));
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: ['set_lifx_power'], devices: () => names,
    dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn off the Desk lamp');
  await until(() => status(w) === 'waiting');
  const clarification = (await page(w)).currentTask?.question;
  assert.equal(clarification?.kind, 'clarification');
  assert.match(JSON.stringify(clarification), /first, second/);
  assert.equal(requests.length, 0);
  await input(w.core, w.module(), 'second', true);
  await until(() => status(w) === 'succeeded');
  assert.equal(task(w)?.questions, 1);
  assert.deepEqual(requests.map(({family, target, data}) => ({family, target, data})), [{
    family: 'power-set', target: 'second', data: {on: false, expectedConfigurationRevision: 3, expectedGeneration: {epoch: 'start-1', sequence: 0}},
  }]);
});

const TIMER_START = Date.parse('2025-01-12T12:03:15.000Z');
const TIMER_READ = TIMER_START + 56 * 60_000;
const TIMER_DURATION = 3 * 60 * 60_000;
const WEMO_OWNER = 'bunny/modules/wemo';
const PLUG_ID = 'test-plug';
const NON_RUNNING_LIMITS = [
  ['disabled', /disabled/], ['unavailable', /unavailable/], ['off', /recorded the plug off/],
  ['elapsed-unknown', /elapsed on-time is unknown/], ['due', /already due/], ['attempted', /recorded a shutoff attempt/],
  ['blocked', /shutoff was blocked/],
] as const;

function powerLimit(status: PowerLimitRecord['status'], revision = 1): PowerLimitRecord {
  const timed = status === 'armed' || status === 'due' || status === 'attempted' || status === 'blocked';
  return {id: PLUG_ID, revision, settingsRevision: 1, status, enabled: status !== 'disabled', durationMs: TIMER_DURATION, enforcement: 'hub-dependent',
    startedAtMs: timed ? TIMER_START : null, deadlineMs: timed ? TIMER_START + TIMER_DURATION : null, updatedAtMs: TIMER_READ,
    observedAtMs: TIMER_READ, lastAttempt: null};
}

const powerLimitDraft = (data: PowerLimitRecord) => ({type: 'org.bunny.power-limit.updated', subject: data.id,
  dataschema: 'https://bunny.invalid/events/power-limit/2.0', data});

void test('Conversation reads a Wemo maximum-on deadline and recovers a lost copy through both read tools', async context => {
  const plug: DeviceRecord = {...light(PLUG_ID, 'Test plug'), kind: 'wemo', observed: {
    status: 'known', observedAtMs: TIMER_READ, power: {status: 'known', value: true}, brightness: unknown,
  }};
  let tool = 'read_wemo';
  const provider = counted((turn, count) => {
    if (count % 2 === 1) return tool === 'read_wemo' ? call(tool, {device: 'Test plug'}) : call(tool, {target: 'Test plug', owner: WEMO_OWNER});
    const reading = turn.transcript.at(-1);
    return reply(reading?.role === 'tool' ? reading.result : assert.fail('expected the read evidence in the model transcript'));
  });
  const w = await world(context, {provider, tools: ['read_wemo', 'read_devices'], timeZone: 'America/New_York',
    dispatch: () => assert.fail('a status question sends no device command')}, undefined, TIMER_READ, 1);
  const owner = w.bus.connect(WEMO_OWNER);
  context.after(() => owner.close());
  await owner.serveSync(['device'], () => ({revision: 1, states: [{type: 'org.bunny.device.updated', subject: plug.id,
    dataschema: DEVICE_POWER_READBACK_SCHEMA, data: plug}]}));
  const resync = deferred<Snapshot>();
  context.after(() => resync.resolve({revision: 4, states: []}));
  let snapshots = 0;
  await w.core.serveSync(['power-limit'], () => {
    snapshots += 1;
    if (snapshots === 1) return {revision: 1, states: []};
    return resync.promise;
  });
  await w.restart();
  await control(w.core, w.module(), 'enable');
  const ask = async (name: string): Promise<string> => {
    tool = name;
    const previous = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), 'Is the timer on for the test plug, and how much time is left?')).status, 'accepted');
    await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
    const view = await page(w, 'bunny', 'recent');
    assert.equal(view.currentTask?.question ?? null, null);
    const last = view.messages.at(-1);
    assert.equal(last?.role, 'assistant');
    if (last === undefined) assert.fail('expected a Conversation reply');
    assert.ok(Buffer.byteLength(last.text) < LIMITS.toolBytes);
    return last.text;
  };
  const changed = (revision: number, status: PowerLimitRecord['status']) => w.core.publish(`bunny.state.power-limit.${PLUG_ID}`,
    {kind: 'state', ...powerLimitDraft(powerLimit(status, revision))});
  assert.match(await ask('read_wemo'), /No maximum-on limit has been set/);
  await changed(2, 'armed');
  for (const tool of ['read_wemo', 'read_devices']) {
    const last = await ask(tool);
    assert.match(last, /maximum-on limit is enabled/i);
    assert.match(last, /2 hours 4 minutes/);
    assert.match(last, /7:03:15 AM EST/);
    assert.match(last, /10:03:15 AM EST/);
    assert.match(last, /2025-01-12T15:03:15.000Z/);
    assert.match(last, /7:59:15 AM EST/);
    assert.match(last, /Hub.*running.*plug.*reachable/i);
  }

  // One delivery slot. Sending both updates together drops one and opens a replacement sync.
  await Promise.all([changed(3, 'off'), changed(4, 'off')]);
  await until(() => snapshots === 2);
  for (const tool of ['read_wemo', 'read_devices']) {
    const last = await ask(tool);
    assert.match(last, /maximum-on limit is unknown/i);
    assert.doesNotMatch(last, /Time remaining|No maximum-on limit has been set/i);
  }
  assert.equal(w.host().logs.filter(record => record.fields['bunny.code'] === 'unavailable' &&
    record.fields['bunny.operation'] === 'status').length, 1, 'the gap is recorded once across both reads');
  resync.resolve({revision: 4, states: [powerLimitDraft(powerLimit('armed', 4))]});
  w.advance(60_000);
  for (const tool of ['read_wemo', 'read_devices']) {
    assert.match(await ask(tool), /2 hours 3 minutes/);
  }
  for (const [index, [status, wording]] of NON_RUNNING_LIMITS.entries()) {
    await changed(index + 5, status);
    const last = await ask('read_wemo');
    assert.match(last, wording);
    assert.doesNotMatch(last, /Time remaining/);
  }
  assert.equal(snapshots, 2, 'tool reads do not open additional limit syncs');
  assert.equal(w.host().sent.filter(sent => sent.call === 'request').length, 0);
});

void test('maximum-on read distinguishes every core status and only counts down an active limit', () => {
  const instant = localInstant('America/New_York');
  const show = (status: PowerLimitRecord['status'], lastAttempt: PowerLimitRecord['lastAttempt'] = null) =>
    describePowerLimit({...powerLimit(status), lastAttempt}, TIMER_READ, instant);
  assert.match(describePowerLimit(null, TIMER_READ, instant), /No maximum-on limit has been set/);
  assert.match(describePowerLimit(undefined, TIMER_READ, instant), /maximum-on limit is unknown/);
  for (const [status, wording] of NON_RUNNING_LIMITS) {
    assert.match(show(status), wording);
    assert.match(show(status), /duration of 3 hours/);
    assert.doesNotMatch(show(status), /Time remaining/);
  }
  assert.match(show('armed'), /about 2 hours 4 minutes/);
  const expired = describePowerLimit(powerLimit('armed'), TIMER_START + TIMER_DURATION, instant);
  assert.match(expired, /reports the limit as armed.*already due/);
  assert.doesNotMatch(expired, /Time remaining/);
  for (const [outcome, wording] of [
    ['intent', /recorded its intent/], ['receipt', /received a shutoff attempt receipt/],
    ['not-sent', /attempt was not sent/], ['uncertain', /uncertain outcome/],
  ] as const) {
    const status = outcome === 'not-sent' ? 'blocked' : 'attempted';
    const result = show(status, {requestId: 'synthetic-request', outcome, reason: 'synthetic-reason'});
    assert.match(result, wording);
    assert.doesNotMatch(result, /Time remaining|synthetic-request|synthetic-reason/);
  }
});

void test('a direct Wemo power request preserves the exact plug, owner and guards', async context => {
  const plug: DeviceRecord = {...light('table-plug', 'Table plug'), kind: 'wemo'};
  const provider = counted((_input, turn) => turn === 1 ? call('set_wemo_power', {device: 'Table plug', on: true}) : reply('Done.'));
  const commands: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: ['set_wemo_power'], devices: () => [plug],
    dispatch: data => {commands.push(data); return Promise.resolve(accepted(data.requestId));}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn on the table plug');
  const proposal = {
    family: 'power-set', target: plug.id, owner: 'bunny/modules/wemo',
    data: {on: true, expectedConfigurationRevision: plug.configurationRevision, expectedGeneration: plug.generation},
  };
  await until(() => w.store().confirmations().length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  assert.equal(commands.length, 1);
  const saved = commands[0];
  assert.ok(saved);
  assert.ok(saved.requestId.startsWith(`${task(w)?.taskId}-step-`));
  const {requestId, ...effect} = saved;
  assert.deepEqual(effect, proposal);
  assert.equal(task(w)?.questions, 0);
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

void test('revoking Wemo control during clarification survives restart', async context => {
  const tools = ['set_wemo_power'];
  const records = ['table-plug', 'another-device'].map(id => ({...light(id, 'Shared desk device'), kind: 'wemo' as const}));
  const provider = counted((_request, turn) => turn <= 2 ? call('set_wemo_power', {device: turn === 1 ? 'Shared desk device' : 'table-plug', on: false}) : reply('The tool gave its result.'));
  const w = await world(context, {provider, tools, devices: () => records,
    dispatch: () => assert.fail('the revoked tool cannot dispatch')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn off Shared desk device');
  await until(() => status(w) === 'waiting');
  tools.splice(0, 1, 'set_lifx_power');
  await w.restart();
  assert.equal((await input(w.core, w.module(), 'table-plug', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.ok((await page(w)).messages.some(message => message.text.includes('This tool is not permitted')));
});

void test('revoking light control during clarification survives restart', async context => {
  const tools = ['set_lifx_power'];
  const records = ['desk-lamp', 'another-device'].map(id => ({...light(id, 'Shared desk device'), kind: 'lifx' as const}));
  const provider = counted((_request, turn) => turn <= 2 ? call('set_lifx_power', {device: turn === 1 ? 'Shared desk device' : 'desk-lamp', on: false}) : reply('The tool gave its result.'));
  const w = await world(context, {provider, tools, devices: () => records,
    dispatch: () => assert.fail('the revoked tool cannot dispatch')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Turn off Shared desk device');
  await until(() => status(w) === 'waiting');
  tools.splice(0, 1, 'read_sessions');
  await w.restart();
  assert.equal((await input(w.core, w.module(), 'desk-lamp', true)).status, 'accepted');
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
  await input(w.core, w.module(), 'Turn off desk-lamp');
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

void test('ordinary light-show seek dispatches once with the active generation and exact position', async context => {
  const requests: AssistantDispatch[] = [];
  const provider = counted(request => request.transcript.some(item => item.role === 'tool') ? reply('Finished.') : call('control_music_lighting_control', {
    owner: 'bunny/core', target: 'wall', arguments: '{"action":"seek-show","positionMs":1500,"generation":"model-supplied-generation"}',
  }));
  const w = await world(context, {provider, tools: ['control_music_lighting_control'], dispatch: data => {
    requests.push(data);
    return Promise.resolve(accepted(data.requestId));
  }});
  await w.core.serveSync(['music-lighting-state'], () => ({revision: 7, states: [{
    type: 'org.bunny.music-lighting.updated', subject: 'wall', dataschema: 'https://bunny.invalid/events/music-lighting-state/2.0',
    data: {id: 'wall', revision: 7, session: {status: 'active', generation: 'actual-active-generation', operationId: 'previous-start',
      startedAtMs: 1000, show: {showId: 'show-synthetic', version: 1, positionMs: 100, missedCues: 0}}, last: null},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Seek the light show on wall to 2 seconds');
  await until(() => status(w) === 'succeeded');
  assert.equal(requests.length, 0);
  await input(w.core, w.module(), 'Could you seek the light show on wall to 1.5 seconds?');
  await until(() => requests.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  const dispatched = requests[0];
  assert.ok(dispatched?.family === 'catalog-action');
  assert.equal(dispatched.target, 'wall');
  assert.deepEqual(dispatched.data, {action: 'seek-show', positionMs: 1500, generation: 'actual-active-generation'});
  assert.deepEqual(dispatched.binding, {kind: 'record', owner: 'bunny/core', target: 'wall', revision: 7});
});

void test('a lost saved-show playback answer stays uncertain and never sends a second request', async context => {
  const requests: AssistantDispatch[] = [];
  const provider = counted(() => call('control_music_lighting_control', {owner: 'bunny/core', target: 'wall', arguments: '{"action":"stop"}'}));
  const w = await world(context, {provider, tools: ['control_music_lighting_control'], dispatch: data => {
    requests.push(data);
    return Promise.resolve({status: 'uncertain', requestId: data.requestId, error: errorBody('uncertain-result')});
  }});
  await w.core.serveSync(['music-lighting-state'], () => ({revision: 1, states: [{
    type: 'org.bunny.music-lighting.updated', subject: 'wall', dataschema: 'https://bunny.invalid/events/music-lighting-state/2.0',
    data: {id: 'wall', revision: 1, session: {status: 'active', generation: 'specific-show', operationId: 'previous-start',
      startedAtMs: 1000, show: {showId: 'show-synthetic', version: 1, positionMs: 100, missedCues: 0}}, last: null},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Stop the light show on wall');
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

void test('a direct request dispatches one mode-set bound to the recorded revision', async context => {
  const dispatched: {requestId: string; data: {mode: string; expectedRevision?: number}}[] = [];
  const provider = counted();
  const w = await world(context, {provider, tools: ['read_sessions', 'set_mode'], core: () => ({sessions: [], mode: hub(7), synced: true}),
    dispatch: data => {assert.equal(data.family, 'mode-set'); dispatched.push({requestId: data.requestId, data: data.data}); return Promise.resolve(accepted(data.requestId));}});
  assert.deepEqual(w.module().inspectAssistant()?.tools, ['read_sessions', 'set_mode']);
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Please switch the Hub to free mode')).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(task(w)?.questions, 0);
  assert.equal(dispatched.length, 1); assert.deepEqual(dispatched[0]?.data, {mode: 'free', expectedRevision: 7});
  assert.equal(dispatched[0]?.requestId, `${task(w)?.taskId ?? ''}-step-1`);
  const final = (await page(w)).messages.at(-1); assert.ok(final);
  assert.match(final.text, /accepted by the core, outcome tracked separately: accepted/); assert.equal(task(w)?.toolCalls, 1); assert.equal(task(w)?.modelCalls, 2);
  await w.restart(); assert.equal(dispatched.length, 1);
});

void test('a stale direct revision is reported without substituting the newer revision', async context => {
  const dispatched: {mode: string; expectedRevision?: number}[] = [];
  const w = await world(context, {provider: counted(), tools: ['set_mode'], core: () => ({sessions: [], mode: hub(3), synced: true}),
    dispatch: data => {
      assert.equal(data.family, 'mode-set');
      dispatched.push(data.data);
      return Promise.resolve({status: 'rejected', requestId: data.requestId, error: errorBody('revision-conflict')});
    }});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Set the Hub to quiet mode');
  await until(() => status(w) === 'succeeded');
  assert.deepEqual(dispatched, [{mode: 'quiet', expectedRevision: 3}]);
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /not applied: refused: revision-conflict: the Hub mode changed after the request was resolved/);
});

void test('a declined coding proposal sends nothing and a lost Hub reply is uncertain', async context => {
  const answer: RequestResult = {status: 'rejected', requestId: 'r', error: errorBody('uncertain-result')};
  let sends = 0;
  const w = await world(context, {provider: counted(), tools: ['set_mode', 'delegate_coding'],
    core: () => ({sessions: [], mode: hub(3), synced: true}),
    coding: () => ({available: true, endpointId: 'worker', revision: 1}),
    delegate: () => assert.fail('a declined hand-off must not send'),
    dispatch: () => {sends += 1; return Promise.resolve(answer);}});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Delegate this fixture');
  await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'decline', true)).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(sends, 0);
  assert.equal(task(w)?.toolCalls, 0);
  assert.equal((await page(w)).messages.at(-1)?.text.includes(DECLINED), true);
  await input(w.core, w.module(), 'Set the Hub mode to free');
  await until(() => status(w) === 'uncertain');
  assert.equal(task(w)?.code, 'uncertain-result');
  const id = task(w)?.taskId;
  assert.ok(id !== undefined);
  assert.equal((await control(w.core, w.module(), 'resume', id)).status, 'rejected');
  assert.equal(sends, 1);
  assert.equal(JSON.stringify(await page(w)).includes('refused: uncertain-result'), false);
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
  const first = provider.inputs[0]?.context ?? assert.fail('first call');
  assert.equal(sectionOf(first, 'personality').text, 'You are B.U.N.N.Y., the owner\'s home assistant. Helpful generalist. Be clear about what is known and unknown. Answer in one to three short sentences.');
  assert.match(sectionOf(first, 'preferences').text ?? '', /\n- Tea: PRIVATE-PREFERENCE-TEA\n- Lights: PRIVATE-PREFERENCE-LIGHTS$/);
  assert.equal(sectionOf(provider.inputs[1]?.context ?? first, 'preferences').text?.endsWith('\n- Tea: PRIVATE-PREFERENCE-TEA-EDITED'), true);
  // The knowledge notes are off until the owner turns them on, and the first task's own text is its transcript, not its context.
  assert.equal(sectionOf(first, 'knowledge').state, 'off');
  const seen = JSON.stringify(provider.inputs.map(turn => turn.context));
  assert.equal(seen.includes('PRIVATE-PREFERENCE-OLD'), false); assert.equal(seen.includes('PRIVATE-KNOWLEDGE'), false); assert.equal(seen.includes('PRIVATE-SYNTHETIC'), false);
  for (const record of [w.module().inspectAssistant(), w.host().logs, w.spans.spans, w.store().task(task(w)?.taskId ?? '')]) assert.equal(JSON.stringify(record).includes('PRIVATE-PREFERENCE'), false);
  // Over its budget the preferences section keeps what fits and states how many it left out (Hub #2029): the call is sent.
  for (let i = 0; i < 33; i += 1) change(preferences, {action: 'create', title: `Long ${String(i)}`, text: 'p'.repeat(4000)});
  await input(w.core, w.module(), 'Again');
  await until(() => status(w) === 'succeeded' && provider.calls() === 3);
  const trimmed = sectionOf(provider.inputs[2]?.context ?? first, 'preferences');
  assert.equal(trimmed.included + trimmed.trimmed, 34);
  assert.ok(trimmed.trimmed > 0 && trimmed.bytes <= trimmed.budgetBytes);
  assert.match(trimmed.text ?? '', new RegExp(`\\n${String(trimmed.trimmed)} more preferences were left out to fit the 32 KiB budget\\.$`));
});

void test('Reachy and MicroDuck use the configured provider with their own curated persona, and a harness may still give a profile the synthetic one', async context => {
  const provider = Object.assign(counted(() => reply('Configured answer')), {name: 'anthropic' as const, model: 'model-a'});
  const w = await world(context, {provider, tools: ['read_sessions', 'set_lifx_power', 'read_devices'], devices: () => [], readDevice: () => Promise.resolve(undefined)});
  await control(w.core, w.module(), 'enable');
  for (const profile of ['reachy', 'microduck'] as const) {
    assert.equal((await input(w.core, w.module(), `Synthetic ${profile} request`, false, randomUUID(), {profile})).status, 'accepted');
    await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === profile)?.status === 'succeeded');
    assert.equal((await page(w, profile)).messages.at(-1)?.text, 'Configured answer');
  }
  assert.equal(provider.calls(), 2, 'one call of the configured provider for each companion');
  const persona = (id: string) => PROFILES.find(value => value.id === id) ?? assert.fail(id);
  // Each companion's personality section carries its own curated persona (Hub #2029's context builder).
  assert.deepEqual(provider.inputs.map(sent => [sent.context.profile, sectionOf(sent.context, 'personality').text]),
    [['reachy', `You are Reachy, the owner's home assistant. ${persona('reachy').character} Answer in one to three short sentences.`],
      ['microduck', `You are MicroDuck, the owner's home assistant. ${persona('microduck').character} Answer in one to three short sentences.`]]);
  assert.match(sectionOf(provider.inputs[1]?.context ?? assert.fail('MicroDuck call'), 'personality').text ?? '', /English text is intended meaning, never spoken English\./);
  for (const sent of provider.inputs) assert.deepEqual(sent.tools.map(tool => tool.name).sort(), ['ask_owner', 'read_devices', 'set_lifx_power'], 'each companion receives the same model-safe tools');
  assert.equal((await input(w.core, w.module(), 'Synthetic bunny request')).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === 'bunny')?.status === 'succeeded');
  assert.deepEqual(provider.inputs[2]?.tools.map(tool => tool.name).sort(), ['ask_owner', 'read_devices', 'set_lifx_power'], 'B.U.N.N.Y. receives the same projection');
  assert.deepEqual(TOOLS.filter(tool => deviceToolOwner(tool.name) !== undefined).map(tool => tool.name).sort(), [...DEVICE_TOOLS].sort(), 'the shared scope names every device tool');
  assert.equal(w.module().inspectAssistant()?.provider, 'anthropic');
  // A test or harness may still give one profile the labelled synthetic provider; the others keep the configured one.
  const v = await world(context, {provider: counted(() => reply('Configured answer')), profileProviders: {reachy: new SyntheticProvider()}});
  await control(v.core, v.module(), 'enable');
  assert.equal((await input(v.core, v.module(), 'Synthetic reachy', false, randomUUID(), {profile: 'reachy'})).status, 'accepted');
  await until(() => v.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.status === 'waiting');
  assert.match(JSON.stringify(await page(v, 'reachy')), new RegExp(SYNTHETIC_QUESTION));
});

void test('MicroDuck\'s replies are intended meaning: none is offered to speech, and Speak refuses one, while Reachy\'s reply is spoken', async context => {
  const offers: {reply: SpokenReply; key: string}[] = [];
  const w = await world(context, {provider: counted(() => reply('Synthetic quack meaning')), speak: (spoken, key) => {offers.push({reply: spoken, key});}});
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Synthetic duck request', false, randomUUID(), {profile: 'microduck'})).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === 'microduck')?.status === 'succeeded');
  const duck = w.module().inspectAssistant()?.tasks.find(t => t.profile === 'microduck')?.taskId ?? assert.fail('duck task');
  assert.equal((await page(w, 'microduck')).messages.at(-1)?.text, 'Synthetic quack meaning', 'the English text stays written');
  assert.equal(offers.length, 0, 'MicroDuck\'s audio is quacks only, so its English text is never offered to speech');
  const refused = await control(w.core, w.module(), 'speak', duck, randomUUID(), {messageId: `${duck}-result`});
  assert.equal(refused.status, 'rejected');
  if (refused.status === 'rejected') {
    assert.equal(refused.error.error.code, 'invalid-request');
    assert.equal(refused.error.error.detail, UNSPOKEN);
  }
  assert.equal(offers.length, 0);
  // The negative control: the same reply in Reachy's conversation is offered once, and Speak replays it.
  assert.equal((await input(w.core, w.module(), 'Synthetic reachy request', false, randomUUID(), {profile: 'reachy'})).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.status === 'succeeded');
  const reachy = w.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.taskId ?? assert.fail('reachy task');
  assert.deepEqual(offers.map(offer => offer.key), [`${reachy}-result`]);
  assert.equal((await control(w.core, w.module(), 'speak', reachy, randomUUID(), {messageId: `${reachy}-result`})).status, 'accepted');
  assert.equal(offers.length, 2);
});

void test('the speech rule and the page note follow the persona\'s audio, not a profile name', async context => {
  // A persona whose audio is not speech is never offered and never replayed, whichever profile it is.
  assert.deepEqual(['bunny', 'reachy', 'microduck'].map(id => unspokenNote(id as 'bunny')), [undefined, undefined,
    'Intended meaning. MicroDuck\'s audio is quacks only, so this text is never read aloud.']);
  const reachy = PROFILES.find(value => value.id === 'reachy') ?? assert.fail('reachy');
  (reachy as {audio: string}).audio = 'quacks-only';
  context.after(() => {(reachy as {audio: string}).audio = 'speech';});
  assert.equal(unspokenNote('reachy'), 'Intended meaning. Reachy\'s audio is quacks only, so this text is never read aloud.');
  const offers: SpokenReply[] = [];
  const w = await world(context, {provider: counted(() => reply('Synthetic meaning')), speak: spoken => {offers.push(spoken);}});
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Synthetic request', false, randomUUID(), {profile: 'reachy'})).status, 'accepted');
  await until(() => w.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.status === 'succeeded');
  const id = w.module().inspectAssistant()?.tasks.find(t => t.profile === 'reachy')?.taskId ?? assert.fail('task');
  const refused = await control(w.core, w.module(), 'speak', id, randomUUID(), {messageId: `${id}-result`});
  assert.ok(refused.status === 'rejected');
  assert.deepEqual([refused.error.error.code, refused.error.error.detail, offers.length], ['invalid-request', UNSPOKEN, 0]);
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
  assert.equal(first.usageUnits, null); assert.equal(first.reservedUnits, inputBound(provider.inputs[0]) + LIMITS.outputUnits); assert.equal(first.activeMs, LIMITS.modelMs);
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
  for (const bytes of [Buffer.from('{'), json('x'.repeat(LIMITS.inputBytes + 1)), json('🐇'.repeat(LIMITS.inputBytes / 4 + 1)), Buffer.from('[]'), new Uint8Array(LIMITS.stageBytes + 1)]) {
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
  await control(w.core, w.module(), 'enable'); await input(w.core, w.module(), 'Set the Hub mode to quiet');
  await until(() => sends === 1);
  assert.notEqual(task(w)?.usageUnits, null);
  w.advance(LIMITS.toolMs);
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
  const w = await world(context), store = w.store(), started = store.newTask('bunny', '\u0001'.repeat(LIMITS.inputBytes));
  started.question = {id: `${started.id}-q1`, text: 'Synthetic question', answer: '\u0001'.repeat(LIMITS.inputBytes), kind: 'clarification', call: 'c', proposal: null}; store.save(started);
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
    if (condition === 'unavailable') assert.equal(state?.available, false);
    // A failed recovery leaves only its own conversation unavailable (Hub #2027); the assistant as a whole stays available.
    if (condition === 'recovery-failure') assert.equal(state?.available, true);
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

void test('Responses keeps permitted history while omitting revoked and private job questions', async context => {
  const bodies: string[] = [];
  const allow = sharing();
  let denied: string | undefined;
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    bodies.push(init.body);
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output: [{type: 'message', role: 'assistant',
      content: [{type: 'output_text', text: 'Fixture answer.', annotations: []}]}], usage: {input_tokens: 10, output_tokens: 3}})));
  }});
  const w = await world(context, {provider, share: query => allow(query) && !(denied !== undefined && query.record === denied &&
    query.destination === 'external-model' && query.field === 'excerpt')});
  await control(w.core, w.module(), 'enable');
  const ask = async (text: string, profile = 'bunny') => {
    const latest = () => w.module().inspectAssistant()?.tasks.find(row => row.profile === profile);
    const previous = latest()?.taskId;
    assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {profile})).status, 'accepted');
    await until(() => latest()?.taskId !== previous && latest()?.status === 'succeeded');
    return latest()?.taskId ?? assert.fail('missing turn');
  };
  const earlier = 'Synthetic earlier owner statement.';
  await ask(earlier);
  await ask('Repeat my last message.');
  assert.equal(bodies.at(-1)?.includes(earlier), true, 'an authorized actual latest owner message may be quoted');
  await ask('Synthetic statement private to Reachy.', 'reachy');
  const deniedTask = await ask('Synthetic newly revoked owner statement.');
  denied = deniedTask + '-prompt';
  await ask('Repeat my last message.');
  assert.doesNotMatch(bodies.at(-1) ?? '', /newly revoked|private to Reachy/u);
  denied = undefined;
  await ask(earlier);
  const sent = bodies.length;
  await ask('What is the status of coding job synthetic-step-1-job?');
  assert.equal(bodies.length, sent);
  await ask('Repeat my last message.');
  assert.doesNotMatch(bodies.at(-1) ?? '', /private to Reachy|step-1-job|Private owner question/u);
});

void test('resuming a local job status request commits its reply before a later paid queue refusal', async context => {
  const provider: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: () => assert.fail('The held paid message cannot run')};
  const w = await world(context, {provider, monthlyLimitMicros: 1});
  await control(w.core, w.module(), 'enable');
  const conversation = w.store().ensureConversation('bunny');
  w.store().queue.setHold(conversation, {reason: 'restart', code: null, detail: null});
  for (const text of ['What is the status of coding job synthetic-step-1-job?', 'Ordinary paid question.']) {
    assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {action: 'queue'})).status, 'accepted');
  }
  const resumed = await control(w.core, w.module(), 'resume-queue', undefined, randomUUID(), {profile: 'bunny'});
  assert.equal(resumed.status, 'accepted');
  assert.match((await page(w, 'bunny', 'recent')).messages.at(-1)?.text ?? '', /no readable coding job/iu);
  assert.deepEqual(w.store().queue.messages(conversation).map(message => message.text), ['Ordinary paid question.']);
  assert.equal(w.store().queue.hold(conversation)?.code, 'capacity');
});

void test('a private job status reply follows current access and never becomes provider input', async context => {
  let revoked = false;
  let deniedAttempt: string | undefined;
  const allow = sharing();
  const share = Object.defineProperty((query: ShareQuery) => allow(query) && !(query.source === 'coding' && query.field === 'status' &&
    (revoked || deniedAttempt !== undefined && query.record === deniedAttempt)),
    'revokesFields', {get: () => revoked || deniedAttempt !== undefined});
  let finish: (() => void) | undefined;
  const provider = counted(() => new Promise(resolve => {finish = () => {resolve(reply('Ordinary reply.'));};}));
  const w = await world(context, {provider, share});
  await control(w.core, w.module(), 'enable');
  const origin = w.store().newTask('bunny', 'Disposable coding task.');
  origin.status = 'succeeded';
  w.store().save(origin);
  const operation = origin.id + '-step-1', jobId = operation + '-job';
  const coding = () => new CodingStore(w.host().moduleDatabase() ?? assert.fail('open database'));
  coding().create({jobId, operationId: operation, taskId: origin.id, conversationId: origin.conversationId, repository: 'synthetic', brief: 'Private fixture.'});
  const attempt = {jobId, operationId: operation, companion: 'bunny', choice: 'codex', harness: 'codex', selectionReason: 'fixture'} as const;
  coding().createAttempt(attempt);
  coding().observeAttempt(operation, 'completed');
  const question = 'What is the status of the coding job ' + jobId + '? Read status only.';
  const ask = async (text: string, profile = 'bunny') => {
    assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {profile})).status, 'accepted');
    return (await page(w, profile, 'recent')).messages.at(-1)?.text ?? assert.fail('missing local reply');
  };
  assert.match(await ask(question), /reported status.*completed/iu);
  const local = (await page(w, 'bunny', 'recent')).messages.at(-1)?.id ?? assert.fail('missing local reply');
  const savedReply = async () => (await page(w, 'bunny', 'recent')).messages.find(row => row.id === local)?.text;
  revoked = true;
  assert.doesNotMatch(await savedReply() ?? '', /completed|step-1-job/iu);
  assert.match(await ask(question), /no readable coding job/iu);
  revoked = false;
  assert.match(await savedReply() ?? '', /reported status.*completed/iu);
  assert.match(await ask(question, 'reachy'), /no readable coding job/iu);
  assert.match(await ask(question.replace(operation, randomUUID() + '-step-1')), /no readable coding job/iu);
  assert.match(await ask(question + ' Also stop it.'), /separate status question/iu);
  assert.match(await ask(question + ' And ' + jobId + '?'), /separate status question/iu);
  const successor = randomUUID();
  coding().createAttempt({...attempt, operationId: successor});
  assert.match(await savedReply() ?? '', /current attempt changed/iu);
  deniedAttempt = operation;
  assert.match(await savedReply() ?? '', /no readable coding job/iu);
  deniedAttempt = undefined;
  assert.match(await ask(question), /reported status.*queued/iu);
  await w.restart();
  assert.match((await page(w, 'bunny', 'recent')).messages.at(-1)?.text ?? '', new RegExp(successor));
  revoked = true;
  assert.doesNotMatch(JSON.stringify((await page(w, 'bunny', 'recent')).messages), new RegExp(successor));
  revoked = false;
  assert.equal(provider.calls(), 0);
  assert.equal((await input(w.core, w.module(), 'Ordinary question.')).status, 'accepted');
  await until(() => provider.calls() === 1);
  const active = w.module().inspectAssistant()?.tasks.find(row => row.profile === 'bunny')?.taskId;
  assert.equal((await input(w.core, w.module(), question, false, randomUUID(), {action: 'steer', taskId: active})).status, 'accepted');
  assert.equal(w.module().inspectAssistant()?.queues?.find(row => row.profile === 'bunny')?.messages, 1);
  finish?.();
  await until(() => w.module().inspectAssistant()?.tasks.find(row => row.profile === 'bunny')?.taskId !== active);
  assert.match((await page(w, 'bunny', 'recent')).messages.at(-1)?.text ?? '', /reported status.*queued/iu);
  assert.equal(provider.calls(), 1);
  assert.doesNotMatch(JSON.stringify(provider.inputs), /step-1-job|reported status|Private fixture|Private owner (?:question|reply)/u);
  assert.doesNotMatch(JSON.stringify(w.store().titleMessages(origin.conversationId)), /step-1-job|reported status|Private owner (?:question|reply)/u);
  w.store().newConversation('bunny');
  assert.match(await ask(question), /no readable coding job/iu);
});

void test('an approved delegation is handed to the worker once, the turn finishes while the worker runs and a named stop targets its attempt', async context => {
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
  turn = 0;
  assert.equal((await input(w.core, w.module(), 'Run a test on cloud.')).status, 'accepted');
  await until(() => status(w) === 'succeeded' && provider.calls() >= 4);
  assert.match(JSON.stringify((await page(w)).messages), /Cloud coding is disabled/);
  assert.equal(work.length, 0);
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
  await until(() => work.length === 1 && status(w) === 'succeeded');
  assert.equal(work[0]?.action, 'start'); assert.equal(work[0]?.taskId, task(w)?.taskId);
  assert.notEqual((await page(w)).currentTask?.question?.kind, 'delegation');
  assert.equal(provider.calls(), before + 2, 'the agent can finish without the worker result');
  await progress({operationId: work[0]?.operationId, status: 'started'});
  await until(() => w.module().inspectCoding()?.active?.status === 'started');
  assert.equal(task(w)?.questions, 1, 'the delegation counts no owner question');
  const liveJob = (work[0]?.operationId ?? assert.fail('attempt')) + '-job';
  assert.equal((await input(w.core, w.module(), 'What is the status of the coding job ' + liveJob + '? Read status only.')).status, 'accepted');
  assert.match((await page(w, 'bunny', 'recent')).messages.at(-1)?.text ?? '', /reported status.*started/iu);
  assert.equal(provider.calls(), before + 2);
  await progress({operationId: work[0]?.operationId, status: 'completed', result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40), changedFiles: ['scripts/tests/readout.test.mjs'],
    checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: [], summary: 'Added the test; it passes.', sessionId: null, usage: null}});
  await until(() => w.module().inspectCoding()?.active === null);
  await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(provider.calls(), before + 2);
  const saved = await page(w, 'bunny', 'recent');
  assert.ok(saved.messages.some(message => message.role === 'assistant' && /completed \(tested-candidate\): Added the test; it passes\./.test(message.text)));
  assert.equal(w.module().inspectCoding()?.active, null);
  // A second delegation is cancelled by the owner while the worker runs: the worker is asked to stop and its report ends the task's wait.
  turn = 0;
  assert.equal((await input(w.core, w.module(), 'Please delegate: another test')).status, 'accepted'); await until(() => status(w) === 'waiting');
  assert.equal((await input(w.core, w.module(), 'approve', true)).status, 'accepted'); await until(() => work.length === 2 && status(w) === 'succeeded');
  const id = work[1]?.operationId ?? assert.fail('attempt');
  await progress({operationId: id, status: 'started'});
  assert.deepEqual(await w.module().stopCodingJob(`${id}-job`, id), {status: 'accepted'});
  await until(() => work.length === 3); assert.equal(work[2]?.action, 'cancel');
  await progress({operationId: work[1]?.operationId, status: 'cancelled', reason: 'cancelled', result: null});
  await until(() => w.module().inspectCoding()?.active === null);
  assert.equal(status(w), 'succeeded');
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

void test('an ambiguous display kind needs an exact choice and the approved generation retains that choice after restart', async context => {
  const provider = counted((_input, turn) => turn <= 2 ? call('create_artwork', {
    format: 'gif', description: 'Synthetic flag', showTargets: [turn === 1 ? 'pixoo' : 'id:pixoo'],
  }) : reply('Generation accepted.'));
  const requests: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: ['create_artwork'], dispatch: data => {
    requests.push(data);
    return Promise.resolve(accepted(data.requestId));
  }});
  const targets = ['pixoo', 'second-panel'].map(target => ({target, kind: 'pixoo'}));
  await w.core.serveSync(['art-targets'], () => ({revision: 1, states: [{
    type: 'org.bunny.art-targets.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art-targets/2.0',
    data: {id: 'art', revision: 1, targets},
  }]}));
  const pixoo = w.bus.connect('bunny/modules/pixoo');
  context.after(() => pixoo.close());
  await pixoo.serveSync(['device'], () => ({revision: 1, states: targets.map(({target, kind}) => {
    const device = light(target, 'Hall panel');
    return {type: 'org.bunny.device.updated', subject: target, dataschema: 'https://bunny.invalid/events/device/2.2',
      data: {...device, kind, capabilities: {...device.capabilities, moments: {supported: true, moods: ['celebrate'],
        maxDurationMs: 10000, coversStatus: true, art: {formats: ['gif'], maxBytes: 65536}}}}};
  })}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Create a flag and show it on Pixoo');
  await until(() => status(w) === 'waiting');
  const question = (await page(w)).currentTask?.question;
  assert.equal(question?.kind, 'clarification');
  assert.match(JSON.stringify(question), /id:pixoo/);
  assert.match(JSON.stringify(question), /second-panel/);
  assert.equal(requests.length, 0);
  await input(w.core, w.module(), 'id:pixoo', true);
  await until(() => status(w) === 'waiting' && task(w)?.questions === 2);
  const approval = (await page(w)).currentTask?.question;
  assert.equal(approval?.kind, 'approval');
  assert.match(JSON.stringify(approval), /Hall panel \(pixoo\)/);
  assert.equal(requests.length, 0);
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'succeeded');
  await w.restart();
  const history = w.store().recentPage('bunny', undefined);
  if (typeof history === 'string') assert.fail(history);
  assert.deepEqual(requests.map(request => request.family === 'catalog-action' ? request.command : request.family), ['art-request']);
  assert.deepEqual(history.messages.flatMap(message => message.attachment ?? []), [
    {kind: 'artwork', description: 'Synthetic flag', requestId: requests[0]?.requestId, admission: 'accepted', showTargets: ['pixoo']},
  ]);
});

void test('the exact configured display ui stays independent of the reserved browser surface', async context => {
  const provider = counted(() => call('create_artwork', {format: 'gif', description: 'Synthetic signal',
    showTargets: ['ui', 'browser']}));
  const w = await world(context, {provider, tools: ['create_artwork'], dispatch: () => assert.fail('no effect before approval')});
  const targets = ['ui', 'browser'].map(target => ({target, kind: 'pixoo'}));
  await w.core.serveSync(['art-targets'], () => ({revision: 1, states: [{
    type: 'org.bunny.art-targets.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art-targets/2.0',
    data: {id: 'art', revision: 1, targets},
  }]}));
  const pixoo = w.bus.connect('bunny/modules/pixoo');
  context.after(() => pixoo.close());
  await pixoo.serveSync(['device'], () => ({revision: 1, states: targets.map(({target, kind}) => {
    const device = light(target, 'Library panel');
    return {type: 'org.bunny.device.updated', subject: target, dataschema: 'https://bunny.invalid/events/device/2.2',
      data: {...device, kind, capabilities: {...device.capabilities, moments: {supported: true, moods: ['celebrate'],
        maxDurationMs: 10000, coversStatus: true, art: {formats: ['gif'], maxBytes: 65536}}}}};
  })}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Make a signal for the library and browser');
  await until(() => status(w) === 'waiting');
  const question = (await page(w)).currentTask?.question;
  assert.equal(question?.kind, 'approval');
  assert.match(JSON.stringify(question), /Library panel \(ui\), Browser/);
  assert.partialDeepStrictEqual(question?.proposal, {data: {showTargets: ['ui', 'browser']}});
});

void test('an exact saved artwork outside the recent SDK state is read from the retained catalog for direct display', async context => {
  const artworkId = 'retained-flag';
  const reads: string[] = [];
  const provider = counted((_request, turn) => turn === 1 ? call('control_art_show', {owner: 'bunny/core', target: 'hub',
    arguments: JSON.stringify({artworkId, targets: ['browser']})}) : reply('Show result.'));
  const writes: AssistantDispatch[] = [];
  const w = await world(context, {provider, tools: ['control_art_show'], retainedArtwork: id => {
    reads.push(id);
    return Promise.resolve({artworkId, sourceRequestId: 'flag-generation', createdAtMs: 0, compositions: [{target: 'ui', compositionId: 'a'.repeat(64),
      outcome: 'succeeded', motion: 'still', renditions: [{renditionId: 'b'.repeat(64), width: 1, height: 1,
        frames: 1, durationMs: 0, format: 'png', bytes: 1, ref: 'rendition.' + 'b'.repeat(64)}]}],
      favorite: true, feedback: null, variationOf: null, palette: [], provenance: {generatedBy: 'local', factual: false}});
  }, dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  const store = w.store();
  const original = store.newTask('bunny', 'Draw a striped pennant');
  original.status = 'succeeded'; store.save(original);
  store.artReply(original, 'flag-generation', 'Striped pennant animation', 1);
  const art = w.bus.connect('bunny/modules/art');
  context.after(() => art.close());
  await art.serveSync(['art'], () => ({revision: 1, states: [{
    type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0',
    data: {id: 'art', revision: 1, jobs: [], artworks: []},
  }]}));
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Show retained-flag on Browser');
  await until(() => status(w) === 'succeeded');
  assert.deepEqual(reads, [artworkId]);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]?.data, {artworkId, targets: ['browser'], guards: []});
});

for (const artworkId of ['missing-art', 'incompatible-art']) {
  void test('a display request for ' + artworkId + ' sends no command', async context => {
    const provider = counted((_input, turn) => turn === 1 ? call('control_art_show', {
      owner: 'bunny/core', target: 'hub', arguments: JSON.stringify({artworkId, targets: ['browser']}),
    }) : reply('Stopped.'));
    const w = await world(context, {provider, tools: ['control_art_show'], dispatch: () => assert.fail('no show was approved')});
    const art = w.bus.connect('bunny/modules/art');
    context.after(() => art.close());
    await art.serveSync(['art'], () => ({revision: 1, states: [{
      type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0',
      data: {id: 'art', revision: 1, jobs: [], artworks: [{artworkId: 'incompatible-art', compositions: []}]},
    }]}));
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Show the saved artwork in the browser');
    if (artworkId === 'missing-art') {
      await until(() => status(w) === 'succeeded');
      assert.ok((await page(w)).messages.some(message => message.text.includes('not-found')));
    } else {
      await until(() => status(w) === 'waiting');
      const clarification = (await page(w)).currentTask?.question;
      assert.equal(clarification?.kind, 'clarification');
      assert.match(JSON.stringify(clarification), /no browser rendition/);
      assert.equal(clarification?.proposal, null);
    }
  });
}

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

  // Each escaped message takes over half a page, so a page holds one; a message over a whole page refuses the read.
  const escaped = '\u0001'.repeat(Math.floor(LIMITS.pageBytes * 0.55 / 6));
  for (let index = 0; index < 2; index += 1) store.message(thread, `escaped-${String(index)}`, 'tool', escaped, 100);
  const limited = await page(recent);
  assert.equal(limited.messages.length, 1);
  assert.equal(limited.messages[0]?.text, escaped);
  assert.equal((await page({...recent, before: limited.older ?? assert.fail('byte limit cursor')})).messages.at(-1)?.text, escaped);
  store.message(thread, 'oversized', 'tool', '\u0001'.repeat(Math.ceil(LIMITS.pageBytes / 6) + 1), 100);
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

async function serveKiteDisplay(context: TestContext, w: Awaited<ReturnType<typeof world>>, generated?: () => string | undefined,
  targets = ['display-blue']): Promise<void> {
  await w.core.serveSync(['art-targets'], () => ({revision: 1, states: [{
    type: 'org.bunny.art-targets.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art-targets/2.0',
    data: {id: 'art', revision: 1, targets: targets.map(target => ({target, kind: 'pixoo'}))},
  }]}));
  const pixoo = w.bus.connect('bunny/modules/pixoo'), art = w.bus.connect('bunny/modules/art');
  context.after(async () => {await pixoo.close(); await art.close();});
  await pixoo.serveSync(['device'], () => ({revision: 1, states: targets.map(target => {
    const device = light(target, 'Blue panel');
    return {type: 'org.bunny.device.updated', subject: target, dataschema: 'https://bunny.invalid/events/device/2.2',
      data: {...device, kind: 'pixoo', capabilities: {...device.capabilities, moments: {supported: true,
        moods: ['celebrate'], maxDurationMs: 10_000, coversStatus: true, art: {formats: ['png'], maxBytes: 65536}}}}};
  })}));
  await art.serveSync(['art'], () => ({revision: 1, states: [{
    type: 'org.bunny.art.updated', subject: 'art', dataschema: 'https://bunny.invalid/events/art/2.0', data: {id: 'art', revision: 1,
      jobs: generated === undefined ? [] : [{requestId: generated(), artworkId: 'kite', status: 'finished', outcome: 'succeeded'}],
      artworks: [{artworkId: 'kite', compositions: ['pixoo', 'ui'].map(target => ({target, compositionId: 'a'.repeat(64), outcome: 'succeeded',
        renditions: [{format: 'png', bytes: 128}]}))}]},
  }]}));
}

void test('an ordinary multi-display show clarifies duplicate labels despite the model supplying an exact ID', async context => {
  const writes: AssistantDispatch[] = [];
  const provider = counted((_request, turn) => turn > 2 ? reply('Show result.') : call('control_art_show', {
    owner: 'bunny/core', target: 'hub', arguments: JSON.stringify({artworkId: 'kite', targets: [turn === 1 ? 'display-blue' : 'display-green', 'browser']}),
  }));
  const w = await world(context, {provider, tools: ['control_art_show'],
    dispatch: data => {writes.push(data); return Promise.resolve(accepted(data.requestId));}});
  await serveKiteDisplay(context, w, undefined, ['display-blue', 'display-green']);
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Show the kite on Blue panel and Browser');
  await until(() => status(w) === 'waiting');
  assert.match(JSON.stringify((await page(w)).currentTask?.question), /id:display-blue.*id:display-green/);
  assert.equal(writes.length, 0);
  await input(w.core, w.module(), 'id:display-green', true);
  await until(() => writes.length === 1);
  w.advance(1100);
  await until(() => status(w) === 'succeeded');
  assert.deepEqual(writes[0]?.family === 'catalog-action' ? writes[0].data.targets : undefined, ['display-green', 'browser']);
});

void test('saving a show binds the explicitly requested draft revision and immutable version name', () => {
  const proposal = {family: 'catalog-action', command: 'nanoleaf-show-save', target: 'shows',
    binding: {kind: 'fixed', owner: 'bunny/modules/nanoleaf', target: 'shows'}, data: {
      name: 'Dawn test', showId: 'show-synthetic', versionName: 'First version',
    }} as const;
  const owners = [['show-synthetic']];
  const request = 'Save draft Dawn test (show-synthetic) revision 1 as First version';
  assert.equal(authorizesControl(proposal, request, '', owners, '', [], false, false, 1), true);
  assert.equal(authorizesControl(proposal, request, '', owners, '', [], false, false, 2), false);
  assert.equal(authorizesControl(proposal, request.replace('First version', 'Other version'), '', owners, '', [], false, false, 1), false);
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
  await serveKiteDisplay(context, w, () => requests[0]?.requestId);
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Create a synthetic kite and show it on display-blue.');
  await until(() => status(w) === 'waiting');
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'failed');
  const messages = (await page(w)).messages;
  assert.match(messages.at(-1)?.text ?? '', /paper kite.*artwork was saved.*Show Synthetic paper kite on Blue panel \(display-blue\).*request was refused/i);
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
  const provider = counted(() => call('create_artwork', {format: 'still', description: 'Synthetic canvas', showTargets: []}));
  const w = await world(context, {provider, tools: ['create_artwork'],
    dispatch: () => assert.fail('the tool budget refused the reservation')});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Create a synthetic canvas.');
  await until(() => status(w) === 'waiting');
  const saved = w.store().task(task(w)?.taskId ?? '') ?? assert.fail('saved task');
  saved.toolCalls = LIMITS.toolCalls;
  w.store().save(saved);
  await input(w.core, w.module(), 'approve', true);
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /Create the image.*stopped before dispatch.*tool call/i);
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
    await serveKiteDisplay(context, w);
    await w.core.serveSync(['operation'], () => ({revision: ++reads, states: !rejected && reads === 1 ? [{
      type: 'org.bunny.operation.updated', subject: 'prep', dataschema: 'https://bunny.invalid/events/operation/2.0',
      data: {id: 'prep', requestId: prepareId, status: 'completed', result: 'succeeded', evidence: 'observed', revision: 1},
    }, {
      type: 'org.bunny.operation.updated', subject: 'show', dataschema: 'https://bunny.invalid/events/operation/2.0',
      data: {id: 'show', requestId, status: 'completed', result: 'succeeded', evidence: 'transmitted', revision: 1},
    }] : []}));
    await w.core.serveSync(['art-show-effects'], () => ({revision: 1, states: []}));
    await control(w.core, w.module(), 'enable');
    await input(w.core, w.module(), 'Show the kite on display-blue.');
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
  await input(w.core, w.module(), 'Set the Hub mode to free.');
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /request was accepted.*turn stopped.*cause is unknown/i);
});

for (const [name, response, expected] of [
  ['model reply bytes', () => reply('x'.repeat(17 * 1024)), /model response exceeded.*size limit/i],
  ['per-call usage', () => ({...reply('done'), units: LIMITS.units + 1}), /model.*usage.*per-call limit/i],
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
  const w = await world(context, {provider: counted(() => call('read_lifx', {device: 'desk-lamp'})), tools: ['read_lifx'],
    devices: () => [light('desk-lamp')], readDevice: () => Promise.resolve('x'.repeat(LIMITS.toolBytes + 1))});
  await control(w.core, w.module(), 'enable');
  await input(w.core, w.module(), 'Read the synthetic light.');
  await until(() => status(w) === 'failed');
  assert.match((await page(w)).messages.at(-1)?.text ?? '', /tool result exceeded.*size limit/i);
});

void test('the closing reply explains an oversized graph checkpoint', async context => {
  context.mock.method(SqliteCheckpointSaver.prototype, 'put', function (this: SqliteCheckpointSaver, ...args: Parameters<SqliteCheckpointSaver['put']>) {
    context.mock.restoreAll();
    return this.put(args[0], {...args[1], channel_values: {...args[1].channel_values, fixture: 'x'.repeat(LIMITS.checkpointBytes + 1)}}, args[2], args[3]);
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
    const w = await world(context, {provider: new AnthropicProvider({key: 'synthetic', model: 'fixture', transport: () => Promise.resolve(response())}),
      prices: {fixture: {input: 1, output: 1, cacheWrite: 1, cacheRead: 1}}});
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

void test('selecting OpenAI scopes titles and device reads, and replays only its own Responses items after restart', async context => {
  const sent: string[] = [], dispatched: AssistantDispatch[] = [];
  const superseded = deferred<Response>(), pendingTitle = deferred<Response>(), pendingRead = deferred<Response>();
  const reasoning = {type: 'reasoning', id: 'rs_fixture', encrypted_content: 'opaque-reasoning', summary: []};
  const message = (text: string) => ({type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]});
  const usage = {input_tokens: 200, output_tokens: 80, input_tokens_details: {cached_tokens: 50, cache_write_tokens: 20}, output_tokens_details: {reasoning_tokens: 60}};
  const functionCall = (name: string, args: object) => ({type: 'function_call', id: `fc_${name}`, call_id: `call_${name}`, name, arguments: JSON.stringify(args)});
  const options = {key: 'fake-responses-key', model: OPENAI_MODEL, transport: (url: string, init: {body: string; redirect: string; headers: Record<string, string>}) => {
    assert.equal(url, OPENAI_URL);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, 'Bearer fake-responses-key');
    sent.push(init.body);
    const body = JSON.parse(init.body) as {tools: unknown[]; input: Record<string, unknown>[]; store: boolean; parallel_tool_calls: boolean};
    assert.equal(body.store, false);
    assert.equal(body.parallel_tool_calls, false);
    if (body.input.some(item => item.content === 'PRIVATE_SUPERSEDED_SUBJECT')) return superseded.promise;
    if (body.input.some(item => item.content === 'Synthetic provider spend refusal')) return Promise.resolve(new Response(null, {status: 429}));
    if (body.input.some(item => item.content === 'Synthetic lost reply')) return Promise.reject(new Error('synthetic transport reset'));
    const ownerRequest = body.input.find(item => item.role === 'user')?.content;
    let output: unknown[];
    if (body.tools.length === 0) return pendingTitle.promise;
    if (body.input.length === 1 && body.input[0]?.content === 'Is Studio Plug on?') return pendingRead.promise;
    if (body.input.some(item => item.content === 'New synthetic topic')) output = [message('A fresh topic.')];
    else if (body.input.some(item => item.type === 'function_call_output')) output = [message('I checked the tool result.')];
    else if (ownerRequest === 'What is the status of catalog-plug?') output = [functionCall('read_devices', {target: 'catalog-plug', owner: 'bunny/modules/pixoo'})];
    else if (ownerRequest === 'Turn off Catalog Plug') output = [functionCall('control_power_set', {target: 'catalog-plug', owner: 'bunny/modules/pixoo', arguments: '{"on":false}'})];
    else if (ownerRequest === 'What color is it?') output = [reasoning, functionCall('ask_owner', {text: 'Which item?'})];
    else if (ownerRequest === 'Turn off Studio Plug' || ownerRequest === 'Could Studio Plug be off?') output = [reasoning, functionCall('set_wemo_power', {device: 'studio-plug', on: false})];
    else output = [reasoning, functionCall('read_wemo', {device: 'studio-plug'})];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage})));
  }};
  const anthropicBodies: string[] = [];
  const anthropic = new AnthropicProvider({key: 'fake-anthropic', transport: (_url, init) => {
    anthropicBodies.push(init.body);
    const body = JSON.parse(init.body) as {messages: {role: string; content: Record<string, unknown>[]}[]};
    const first = body.messages[0]?.content[0]?.text;
    const tool = first === 'Is Studio Plug on?' ? {name: 'read_wemo', input: {device: 'studio-plug'}}
      : first === 'Turn off Studio Plug' || first === 'Could Studio Plug be off?' ? {name: 'set_wemo_power', input: {device: 'studio-plug', on: false}}
      : first === 'What color is it?' ? {name: 'ask_owner', input: {text: 'Which item?'}} : undefined;
    const answered = body.messages.some(message => message.content.some(block => block.type === 'tool_result'));
    const use = tool !== undefined && !answered;
    return Promise.resolve(new Response(JSON.stringify({content: use ? [{type: 'thinking', thinking: 'private fictional thought', signature: 'ANTHROPIC_TEST_THINKING'},
      {type: 'tool_use', id: 'toolu_test', ...tool}] : [{type: 'text', text: 'CHANGES_NONE'}],
    stop_reason: use ? 'tool_use' : 'end_turn', usage: {input_tokens: 20, output_tokens: 30}})));
  }});
  const w = await world(context, {provider: anthropic, alternateProvider: new OpenAIProvider({...options, effort: 'medium'}),
    openAITitleProvider: new OpenAITitleProvider(options), preferences: () => [{id: 'preference', active: true, createdAtMs: 1, updatedAtMs: 1, title: 'Secret preference', text: 'PRIVATE_PREFERENCES'}],
    tools: ['read_sessions', 'read_wemo', 'set_wemo_power', 'read_devices', 'control_power_set'], devices: owner => owner === WEMO_OWNER ? [
      {...light('studio-plug', 'Studio Plug'), kind: 'wemo'}, {...light('unrelated-plug', 'PRIVATE_OTHER_DEVICE'), kind: 'wemo'},
    ] : [], dispatch: data => {dispatched.push(data); return Promise.resolve(accepted(data.requestId));}});
  const catalogOwner = w.bus.connect('bunny/modules/pixoo');
  context.after(() => catalogOwner.close());
  await catalogOwner.serveSync(['device'], () => ({revision: 1, states: [
    {type: 'org.bunny.device.updated', subject: 'catalog-plug',
      dataschema: DEVICE_READBACK_SCHEMA, data: {...light('catalog-plug', 'Catalog Plug'), kind: 'pixoo'}},
    {type: 'org.bunny.device.updated', subject: 'private-catalog-device',
      dataschema: DEVICE_READBACK_SCHEMA, data: {...light('private-catalog-device', 'PRIVATE_CATALOG_DEVICE'), kind: 'pixoo'}},
  ]}));
  await control(w.core, w.module(), 'enable');
  assert.deepEqual(w.module().inspectAssistant()?.providers?.map(value => value.provider), ['anthropic', 'openai']);
  await input(w.core, w.module(), 'PRIVATE_OTHER_CONVERSATION', false, randomUUID(), {profile: 'reachy', provider: 'anthropic'});
  await until(() => w.module().inspectAssistant()?.tasks.find(value => value.profile === 'reachy')?.status === 'succeeded');
  assert.equal(anthropicBodies.length, 1);
  const bunnyTask = () => w.module().inspectAssistant()?.tasks.find(value => value.profile === 'bunny');
  const start = async (text: string) => {
    const result = await input(w.core, w.module(), text, false, randomUUID(), {provider: 'openai'});
    assert.equal(result.status, 'accepted', JSON.stringify(result));
  };
  await start('Is Studio Plug on?');
  await until(() => sent.length === 2);
  const inFlight = await w.module().manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(inFlight !== undefined && !('error' in inFlight));
  const day = (JSON.parse(Buffer.from(inFlight.bytes).toString()) as {day: {unreported: number; spentMicros: number}}).day;
  assert.equal(day.unreported, 2, 'task and title both reserved before either provider reply');
  assert.ok(day.spentMicros > 10_000);
  pendingRead.resolve(new Response(JSON.stringify({status: 'completed', output: [reasoning, functionCall('read_wemo', {device: 'studio-plug'})], usage})));
  pendingTitle.resolve(new Response(JSON.stringify({status: 'completed', output: [message('Studio plug check')], usage})));
  await until(() => w.module().inspectAssistant()?.tasks.find(value => value.profile === 'bunny')?.status === 'succeeded');
  assert.ok(sent.some(body => /Studio Plug.*Observed power/.test(body)));
  assert.ok(sent.some(body => body.includes('opaque-reasoning') && body.includes('function_call_output')));
  assert.ok(sent.some(body => body.includes('Current title: none') && body.includes('Is Studio Plug on?')));
  assert.doesNotMatch(sent.join('\n'), /PRIVATE_|read_sessions|CHANGES_NONE/);

  await start('Could Studio Plug be off?');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.equal(dispatched.length, 0);
  await start('Turn off Studio Plug');
  await until(() => dispatched.length === 1 || bunnyTask()?.status === 'succeeded' || bunnyTask()?.status === 'failed');
  assert.equal(dispatched.length, 1, JSON.stringify({task: bunnyTask(), last: sent.at(-1)}));
  w.advance(1200);
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.equal(dispatched[0]?.target, 'studio-plug');
  assert.equal(dispatched.length, 1);

  await start('What is the status of catalog-plug?');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.match(sent.at(-1) ?? '', /Catalog Plug/);
  assert.doesNotMatch(sent.at(-1) ?? '', /PRIVATE_CATALOG_DEVICE|lastTransmissionAtMs|configurationRevision/);
  await start('Turn off Catalog Plug');
  await until(() => dispatched.length === 2 || bunnyTask()?.status === 'failed' || bunnyTask()?.status === 'succeeded');
  assert.equal(dispatched[1]?.target, 'catalog-plug');
  w.advance(1200);
  await until(() => bunnyTask()?.status === 'succeeded');

  await start('What color is it?');
  await until(() => bunnyTask()?.status === 'waiting');
  const held = bunnyTask() ?? assert.fail('missing task');
  const taskId = held.taskId;
  assert.equal((await input(w.core, w.module(), 'Synthetic queued Anthropic request', false, randomUUID(),
    {action: 'queue', provider: 'anthropic'})).status, 'accepted');
  await w.restart();
  await until(() => bunnyTask()?.status === 'waiting');
  assert.equal(w.store().task(taskId)?.supervisor?.provider, 'openai');
  assert.equal((await input(w.core, w.module(), 'The blue item.', true, randomUUID(), {taskId, questionId: bunnyTask()?.questionId})).status, 'accepted');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.equal(sent.at(-1)?.includes('opaque-reasoning'), true);
  assert.equal(sent.at(-1)?.includes('The blue item.'), true);
  assert.equal(anthropicBodies.length, 1);
  assert.equal((await control(w.core, w.module(), 'resume-queue', undefined, randomUUID(), {profile: 'bunny'})).status, 'accepted');
  await until(() => bunnyTask()?.taskId !== taskId && bunnyTask()?.status === 'succeeded');
  assert.equal(bunnyTask()?.supervisor?.provider, 'anthropic');
  assert.equal(anthropicBodies.length, 2);
  assert.doesNotMatch(sent.join('\n'), /Synthetic queued Anthropic request/);

  await start('PRIVATE_SUPERSEDED_SUBJECT');
  await until(() => sent.at(-1)?.includes('PRIVATE_SUPERSEDED_SUBJECT') === true);
  assert.equal((await input(w.core, w.module(), 'New synthetic topic', false, randomUUID(),
    {action: 'steer', taskId: bunnyTask()?.taskId})).status, 'accepted');
  superseded.resolve(new Response(JSON.stringify({status: 'completed', output: [reasoning, message('PRIVATE_SUPERSEDED_ANSWER')], usage})));
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.match(sent.at(-1) ?? '', /New synthetic topic/);
  assert.doesNotMatch(sent.at(-1) ?? '', /PRIVATE_SUPERSEDED|opaque-reasoning/);

  const countCommands = (): number => dispatched.length;
  const requestsBefore = countCommands();
  const startAnthropic = async (text: string) => {
    const request = await input(w.core, w.module(), text, false, randomUUID(), {provider: 'anthropic'});
    assert.equal(request.status, 'accepted');
  };
  await startAnthropic('Is Studio Plug on?');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.match(anthropicBodies.at(-1) ?? '', /Observed power/);
  assert.equal(countCommands(), requestsBefore);
  await startAnthropic('Could Studio Plug be off?');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.equal(countCommands(), requestsBefore, 'same status question refuses a proposed mutation');
  assert.match(anthropicBodies.at(-1) ?? '', /refused/);
  await startAnthropic('Turn off Studio Plug');
  await until(() => countCommands() === requestsBefore + 1);
  w.advance(1200);
  await until(() => bunnyTask()?.status === 'succeeded');
  await startAnthropic('What color is it?');
  await until(() => bunnyTask()?.status === 'waiting');
  const savedAnthropic = bunnyTask();
  await w.restart();
  assert.equal((await input(w.core, w.module(), 'The blue item.', true, randomUUID(),
    {taskId: savedAnthropic?.taskId, questionId: savedAnthropic?.questionId})).status, 'accepted');
  await until(() => bunnyTask()?.status === 'succeeded');
  assert.match(anthropicBodies.at(-1) ?? '', /ANTHROPIC_TEST_THINKING.*The blue item/);
  assert.doesNotMatch(anthropicBodies.join('\n'), /opaque-reasoning|PRIVATE_SUPERSEDED_ANSWER/);
  assert.doesNotMatch(sent.join('\n'), /ANTHROPIC_TEST_THINKING/);

  await start('Synthetic provider spend refusal');
  await until(() => bunnyTask()?.status === 'failed');
  assert.equal(bunnyTask()?.code, 'capacity');
  const refusedTask = bunnyTask()?.taskId ?? assert.fail('refused task missing');
  assert.equal(w.store().calls(refusedTask).filter(call => call.kind === 'model').length, 1);
  await start('Synthetic lost reply');
  await until(() => bunnyTask()?.status === 'uncertain');
  const lostTask = bunnyTask()?.taskId ?? assert.fail('uncertain task missing');
  const count = sent.length;
  await w.restart();
  assert.equal(bunnyTask()?.status, 'uncertain');
  assert.equal(w.store().calls(lostTask).filter(call => call.kind === 'model' && call.status === 'uncertain').length, 1);
  assert.equal(sent.length, count, 'restart sends no request');

});


void test('model sharing conflicts are visible only through permitted private context reads', async context => {
  const base = sharing([{caller: 'companion', companion: 'bunny', destination: 'anthropic', purpose: 'prompt',
    source: 'knowledge', field: 'text', record: 'PRIVATE_CONFLICT', allow: true}]);
  let allowed = true;
  const share = Object.assign((query: ShareQuery) => base(query) && (allowed ||
    (query.destination !== 'private-conversation' || query.source !== 'conversation' || query.field !== 'details')), {conflicts: base.conflicts ?? 0});
  const w = await world(context, {share});
  const read = () => w.module().manifest.content?.('assistant-context', {query: {profile: 'bunny'}, signal: new AbortController().signal});
  const result = await read();
  assert.ok(result !== undefined && !('error' in result));
  const detail = Buffer.from(result.bytes).toString();
  assert.match(detail, /"sharingConflictCount":1/);
  assert.doesNotMatch(detail, /PRIVATE_CONFLICT/);
  allowed = false;
  assert.deepEqual(await read(), errorBody('forbidden'));
});

void test('hosted turns use the same bounded conversation context for each companion', async context => {
  const captured = {anthropic: [] as string[], openai: [] as string[]};
  const outputs = {anthropic: [] as string[], openai: [] as string[]};
  const titlePrompts = {anthropic: [] as string[], openai: [] as string[]};
  const followUp = 'How bright is the second one?';
  const compare = 'Compare Desk Lamp and Hall Lamp.';
  const unrelated = 'Tell me a joke about paper.';
  const args = {device: 'hall'};
  const anthropic = new AnthropicProvider({key: 'configured-key-canary', transport: (_url, init) => {
    assert.doesNotMatch(init.body, /configured-key-canary/);
    const body = JSON.parse(init.body) as {system: {text: string}[]; messages: {content: {text?: string; type?: string; content?: string}[]}[]};
    captured.anthropic.push(body.system.map(block => block.text).join('\n'));
    const result = body.messages.flatMap(item => item.content).find(block => block.type === 'tool_result')?.content;
    if (result !== undefined) outputs.anthropic.push(result);
    const read = result === undefined && body.messages[0]?.content[0]?.text === followUp;
    return Promise.resolve(Response.json({content: read ? [{type: 'tool_use', id: 'read', name: 'read_lifx', input: args}]
      : [{type: 'text', text: 'Synthetic reply.'}], stop_reason: read ? 'tool_use' : 'end_turn',
      usage: {input_tokens: 20, output_tokens: 10}}));
  }});
  const response = (output: unknown[]) => Promise.resolve(Response.json({status: 'completed', output, usage: {input_tokens: 20, output_tokens: 10}}));
  const message = (text: string) => ({type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]});
  const openai = new OpenAIProvider({key: 'configured-key-canary', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    assert.doesNotMatch(init.body, /configured-key-canary/);
    const body = JSON.parse(init.body) as {instructions: string; input: {content?: string; type?: string; output?: string}[]};
    captured.openai.push(body.instructions);
    const result = body.input.find(item => item.type === 'function_call_output')?.output;
    if (result !== undefined) outputs.openai.push(result);
    if (result === undefined && body.input[0]?.content === followUp) return response([{type: 'function_call', id: 'fc_read',
      call_id: 'call_read', name: 'read_lifx', arguments: JSON.stringify(args)}]);
    return response([message('Synthetic reply.')]);
  }});
  const titleProvider = new AnthropicTitleProvider({key: 'configured-key-canary', transport: (_url, init) => {
    assert.doesNotMatch(init.body, /configured-key-canary/);
    const body = JSON.parse(init.body) as {messages: {content: string}[]};
    titlePrompts.anthropic.push(JSON.stringify(body.messages));
    return Promise.resolve(Response.json({content: [{type: 'text', text: 'Fixture controls'}], stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 4}}));
  }});
  const openAITitleProvider = new OpenAITitleProvider({key: 'configured-key-canary', model: OPENAI_MODEL, transport: (_url, init) => {
    assert.doesNotMatch(init.body, /configured-key-canary/);
    const body = JSON.parse(init.body) as {input: unknown};
    titlePrompts.openai.push(JSON.stringify(body.input));
    return response([message('Fixture controls')]);
  }});
  const commonPreference = sharing((['bunny', 'reachy', 'microduck'] as const).flatMap(companion =>
    (['label', 'text'] as const).map(field => ({caller: 'companion', companion, destination: 'external-model',
      purpose: 'prompt', source: 'preferences', field, record: 'Shared fixture preference', allow: true}))));
  const w = await world(context, {provider: anthropic, alternateProvider: openai, titleProvider, openAITitleProvider, tools: ['read_lifx'], share: commonPreference,
    devices: owner => owner === 'bunny/modules/lifx' ? [light('desk', 'Desk Lamp'), light('hall', 'Hall Lamp'), light('private-device', 'PRIVATE_DEVICE')] : []});
  const preferences = new PreferenceStore(w.host().moduleDatabase() ?? assert.fail('preference store'));
  preferences.apply({action: 'create', title: 'Fixture preference', text: 'PRIVATE_PREFERENCE', expectedRevision: preferences.revision()}, Date.now());
  preferences.apply({action: 'create', title: 'Shared fixture preference', text: 'Owner-approved fixture preference.', expectedRevision: preferences.revision()}, Date.now());
  await control(w.core, w.module(), 'enable');
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    for (const provider of ['anthropic', 'openai'] as const) {
      const priorTitles = titlePrompts[provider].length;
      for (const text of [compare, followUp, unrelated]) {
        const previous = w.module().inspectAssistant()?.tasks.find(task => task.profile === profile)?.taskId;
        assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {provider, profile})).status, 'accepted');
        await until(() => w.module().inspectAssistant()?.tasks.some(task => task.profile === profile && task.taskId !== previous && task.status === 'succeeded') === true);
      }
      assert.match(captured[provider].at(-1) ?? '', /Owner-approved fixture preference/);
      assert.match(captured[provider].at(-2) ?? '', /Compare Desk Lamp and Hall Lamp/);
      assert.match(captured[provider].at(-1) ?? '', /Compare Desk Lamp and Hall Lamp/);
      assert.doesNotMatch(captured[provider].at(-1) ?? '', /PRIVATE_PREFERENCE|PRIVATE_DEVICE/);
      assert.match(outputs[provider].at(-1) ?? '', /Hall Lamp \(hall\)/);
      assert.doesNotMatch(outputs[provider].at(-1) ?? '', /Desk Lamp|PRIVATE_DEVICE/);
      await until(() => titlePrompts[provider].length > priorTitles);
      assert.match(titlePrompts[provider][priorTitles] ?? '', /Compare Desk Lamp and Hall Lamp/);
      assert.equal((await input(w.core, w.module(), '', false, randomUUID(), {action: 'new-conversation', profile, text: undefined})).status, 'accepted');
    }
  }
  assert.deepEqual(outputs.anthropic, outputs.openai);
  assert.doesNotMatch(JSON.stringify(titlePrompts), /Owner-approved fixture preference/);
  assert.doesNotMatch(JSON.stringify({captured, titlePrompts}), /PRIVATE_PREFERENCE|PRIVATE_DEVICE/);
});

for (const name of ['anthropic', 'openai'] as const) {
  void test(`a revoked common request grants no send or opaque replay on ${name}`, async context => {
    const baseline = sharing();
    let revoked: string | undefined, revokeAtSizing = true, calls = 0;
    const provider: ModelProvider = {name, model: name === 'openai' ? OPENAI_MODEL : 'claude-sonnet-5-5',
      inputUnits: turn => {
        if (revokeAtSizing) {
          const message = turn.transcript.find(item => item.role === 'owner')?.text;
          assert.equal(message, 'Revoke after assembly.');
          const started = task(w)?.taskId ?? assert.fail('task id');
          revoked = `${started}-prompt`;
        }
        return 10_000;
      },
      turn: () => {calls += 1; return Promise.resolve(call('ask_owner', {text: 'Which lamp?'}, 'fixture-ask'));}};
    const w = await world(context, {provider,
      share: query => baseline(query) && !(query.destination === 'external-model' && query.field === 'request' && query.record === revoked)});
    await control(w.core, w.module(), 'enable');
    assert.equal((await input(w.core, w.module(), 'Revoke after assembly.')).status, 'accepted');
    await until(() => status(w) === 'failed');
    assert.equal(task(w)?.code, 'forbidden');
    assert.equal(calls, 0);

    revokeAtSizing = false;
    assert.equal((await input(w.core, w.module(), 'Allow a clarification.')).status, 'accepted');
    await until(() => status(w) === 'waiting');
    const waiting = task(w) ?? assert.fail('waiting for an answer');
    await w.restart();
    revoked = `${waiting.taskId}-prompt`;
    assert.equal((await input(w.core, w.module(), 'Hall Lamp.', true, randomUUID(),
      {taskId: waiting.taskId, questionId: waiting.questionId})).status, 'accepted');
    await until(() => status(w) === 'failed');
    assert.equal(task(w)?.code, 'forbidden');
    assert.equal(calls, 1, 'the resumed task did not disclose its saved transcript');
  });
}

for (const name of ['anthropic', 'openai'] as const) {
  void test(`${name} keeps a related prior answer and sends every newly admitted steer`, async context => {
    const seen: {owner: string[]; instructions: string}[] = [];
    const previousPrompt = 'Give me the synthetic orbital report.';
    const previousAnswer = 'A sapphire sensor tracks the fictional ORBITAL_FIXTURE vehicle.';
    const followUp = 'Explain the sapphire sensor.';
    const advicePrompt = 'Suggest a way to remember recurring chores.';
    const advice = 'Try setting a recurring alarm.';
    const desk = 'What is the brightness of Desk Lamp?';
    const hall = 'What is the brightness of Hall Lamp?';
    const deskAnswer = 'Desk Lamp reported a reading. DESK_PRIVATE_SENTINEL.';
    const heldPrompt = 'Wait with this first synthetic subject.';
    const heldModel = deferred<Response>();
    const respond = (text: string) => Promise.resolve(Response.json(name === 'anthropic'
      ? {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 20, output_tokens: 10}}
      : {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]}],
        usage: {input_tokens: 20, output_tokens: 10}}));
    const transport = (_url: string, init: {body: string}): Promise<Response> => {
      const body = JSON.parse(init.body) as {system?: {text: string}[]; instructions?: string; input?: {role: string; content: string; type?: string}[];
        messages?: {role: string; content: {type: string; text?: string}[]}[]};
      const owner = body.messages?.filter(item => item.role === 'user').flatMap(item => item.content.flatMap(block =>
        block.type === 'text' && block.text !== undefined ? [block.text] : [])) ?? body.input?.filter(item => item.role === 'user').map(item => item.content) ?? [];
      seen.push({owner, instructions: body.system?.map(block => block.text).join('\n') ?? body.instructions ?? ''});
      if (owner[0] === heldPrompt) return heldModel.promise;
      if (owner[0] === desk) {
        const result = body.messages?.some(item => item.content.some(block => block.type === 'tool_result')) === true ||
          body.input?.some(item => item.type === 'function_call_output') === true;
        if (result) return respond(deskAnswer);
        return Promise.resolve(Response.json(name === 'anthropic'
          ? {content: [{type: 'tool_use', id: 'read_desk', name: 'read_lifx', input: {device: 'desk'}}],
            stop_reason: 'tool_use', usage: {input_tokens: 20, output_tokens: 10}}
          : {status: 'completed', output: [{type: 'function_call', id: 'fc_read_desk', call_id: 'read_desk',
            name: 'read_lifx', arguments: '{"device":"desk"}'}], usage: {input_tokens: 20, output_tokens: 10}}));
      }
      return respond(owner[0] === previousPrompt ? previousAnswer : owner[0] === advicePrompt ? advice : 'Synthetic reply.');
    };
    const provider = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
      : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
    const baseline = sharing();
    let revoked: string | undefined;
    const w = await world(context, {provider, tools: ['read_lifx'],
      devices: owner => owner === 'bunny/modules/lifx' ? [light('desk', 'Desk Lamp'), light('hall', 'Hall Lamp')] : [],
      share: query => baseline(query) && !(query.destination === 'external-model' &&
      query.field === 'request' && query.record === revoked)});
    await control(w.core, w.module(), 'enable');
    const ask = async (text: string) => {
      const prior = task(w)?.taskId;
      assert.equal((await input(w.core, w.module(), text)).status, 'accepted');
      await until(() => task(w)?.taskId !== prior && status(w) === 'succeeded');
      return task(w)?.taskId ?? assert.fail('task');
    };
    const origin = await ask(previousPrompt);
    await ask(followUp);
    assert.match(seen.at(-1)?.instructions ?? '', /ORBITAL_FIXTURE/, 'the earlier permitted answer reaches the new task');
    revoked = `${origin}-prompt`;
    await ask(followUp);
    assert.doesNotMatch(seen.at(-1)?.instructions ?? '', /ORBITAL_FIXTURE/, 'the prior answer cannot bypass its original request grant');
    await ask(advicePrompt);
    await ask('Could you remind me what you recommended?');
    assert.match(seen.at(-1)?.instructions ?? '', /Try setting a recurring alarm/, 'a follow-up keeps the earlier answer without matching its wording');
    await ask('Who is Ada?');
    assert.match(seen.at(-1)?.instructions ?? '', /Try setting a recurring alarm/, 'the permitted timeline is the same after a topic change');
    await ask(desk);
    await ask(hall);
    assert.match(seen.at(-1)?.instructions ?? '', /DESK_PRIVATE_SENTINEL/,
      'permitted prior device facts are preserved as history after a device change');

    assert.equal((await input(w.core, w.module(), heldPrompt)).status, 'accepted');
    await until(() => seen.at(-1)?.owner[0] === heldPrompt);
    const taskId = task(w)?.taskId ?? assert.fail('steered task');
    const steers = ['First unread owner update.', 'Second unread owner update.'];
    for (const text of steers) assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {action: 'steer', taskId})).status, 'accepted');
    heldModel.resolve(await respond('PRIVATE_SUPERSEDED_FIXTURE'));
    await until(() => status(w) === 'succeeded');
    assert.deepEqual(seen.at(-1)?.owner, steers, 'all unread steer messages arrive in order in the next model request');
    assert.doesNotMatch(JSON.stringify(seen.at(-1)), /PRIVATE_SUPERSEDED_FIXTURE|first synthetic subject/);
  });
}

for (const name of ['anthropic', 'openai'] as const) {
  void test(`${name} rolls chronological history, compacts a reusable prefix, and invalidates edited or denied sources`, async context => {
    const ordinary: string[] = [], compactions: string[] = [];
    const old = 'Set the weekend reminder for Saturday at seven. ORIGINAL_SCHEDULE.';
    const revised = 'Set the weekend reminder for Sunday at eight. REVISED_SCHEDULE.';
    const unresolved = 'Confirm who will supply the timer batteries.';
    const originReply = 'I saved that plan. SAVED_PRIVATE_ORIGIN_REPLY.';
    const usage = {input_tokens: 20, output_tokens: 10};
    const transport = (_url: string, init: {body: string}): Promise<Response> => {
      const body = JSON.parse(init.body) as {system?: {text: string}[]; instructions?: string; tools: unknown[]};
      const instructions = body.system?.map(block => block.text).join('\n') ?? body.instructions ?? '';
      const compaction = instructions.startsWith('Summarize the supplied older conversation exchanges');
      let text = 'Synthetic reply acknowledging the owner’s update.';
      if (compaction) {
        assert.deepEqual(body.tools ?? [], []);
        compactions.push(init.body);
        const decision = init.body.includes('REVISED_SCHEDULE') ? revised : init.body.includes('ORIGINAL_SCHEDULE') ? old : 'Other daily details were discussed.';
        text = JSON.stringify({decisions: [decision], openQuestions: init.body.includes(unresolved) ? [unresolved] : [], references: [], corrections: []});
      } else {
        if (ordinary.length === 0) text = originReply;
        ordinary.push(init.body);
      }
      return Promise.resolve(Response.json(name === 'anthropic'
        ? {content: [{type: 'text', text}], stop_reason: 'end_turn', usage}
        : {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]}], usage}));
    };
    const adapter = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
      : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
    const provider: ModelProvider & {inputWindow: number} = {name, model: adapter.model, inputWindow: 115_000,
      contextInputUnits: input => adapter.contextInputUnits(input), turn: (input, signal) => adapter.turn(input, signal)};
    const baseline = sharing();
    let revoked: string | undefined;
    const w = await world(context, {provider, share: query => baseline(query) && !(query.destination === 'external-model' &&
      query.field === 'excerpt' && query.record === revoked)});
    await control(w.core, w.module(), 'enable');
    const ask = async (text: string) => {
      const before = task(w)?.taskId;
      assert.equal((await input(w.core, w.module(), text)).status, 'accepted');
      await until(() => task(w)?.taskId !== before && status(w) === 'succeeded');
      return task(w)?.taskId ?? assert.fail('task');
    };
    const origin = await ask(old + ' ' + unresolved);
    const filler = (index: number) => `Synthetic exchange ${String(index)}. ${'The household note describes a separate daily plan. '.repeat(20)}`;
    for (let index = 0; index < 26; index += 1) await ask(filler(index));
    const before = ordinary.at(-1) ?? '';
    assert.match(before, /ORIGINAL_SCHEDULE/);
    assert.ok((before.match(/\[message /g)?.length ?? 0) > 48, 'history crosses the former message ceiling');
    assert.ok(before.indexOf('Synthetic exchange 0') < before.indexOf('Synthetic exchange 20'));
    assert.equal(compactions.length, 0);

    provider.inputWindow = 15_000;
    await ask('Which day did we decide on for the weekend reminder?');
    assert.equal(compactions.length, 1);
    assert.match(compactions[0] ?? '', /ORIGINAL_SCHEDULE/);
    assert.doesNotMatch(compactions[0] ?? '', /Which day did we decide on/);
    const after = ordinary.at(-1) ?? '';
    assert.match(after, /Summary of older exchanges.*ORIGINAL_SCHEDULE.*Recent exchanges.*Synthetic exchange 25/s);
    assert.match(after, /Confirm who will supply the timer batteries/);
    assert.ok(after.includes(filler(25).trimEnd()), 'the most recent owner message is verbatim');
    assert.doesNotMatch(after, /Synthetic exchange 0\./);
    const savedSummary = w.store().lastHistoryCompaction(task(w)?.conversationId ?? '');
    assert.equal(savedSummary?.status, 'succeeded');
    assert.equal(w.store().savedMessage(origin, `${origin}-prompt`)?.text, old + ' ' + unresolved);
    await w.restart();
    provider.inputWindow = 60_000;
    await ask('And what time was it?');
    assert.equal(compactions.length, 1, 'the same authorized prefix is reused after restart');
    assert.match(ordinary.at(-1) ?? '', /Summary of older exchanges.*ORIGINAL_SCHEDULE/s);
    provider.inputWindow = 18_000;
    for (let index = 26; index < 55 && compactions.length < 2; index += 1) await ask(filler(index));
    assert.equal(compactions.length, 2, 'a growing conversation compacts another portion without starting over');
    assert.match(compactions[1] ?? '', /Summary of earlier exchanges.*ORIGINAL_SCHEDULE/s);
    assert.ok(!(compactions[1] ?? '').includes(`${origin}-prompt`), 'incremental compaction uses the validated summary, not its original raw prefix');

    revoked = `${origin}-prompt`;
    await ask('Check the weekend plan again.');
    assert.doesNotMatch(ordinary.at(-1) ?? '', /ORIGINAL_SCHEDULE/, 'a denied source invalidates the persisted summary');
    revoked = undefined;
    w.store().messages.correct(`${origin}-prompt`, {kind: 'literal', text: revised, language: 'en'});
    await ask('What is the corrected weekend plan?');
    assert.doesNotMatch(ordinary.at(-1) ?? '', /ORIGINAL_SCHEDULE|SAVED_PRIVATE_ORIGIN_REPLY/);
    assert.ok((await page(w)).messages.some(message => message.text === originReply), 'correcting an input preserves the saved reply in private history');
    assert.match(ordinary.at(-1) ?? '', /REVISED_SCHEDULE/, 'a correction is the new source for history or compaction');
    assert.equal(w.store().savedMessage(origin, `${origin}-prompt`)?.text, revised, 'compaction keeps local records independent of the summary');
    w.store().messages.remove(`${origin}-prompt`, Date.now());
    await ask('Give me the current notes.');
    assert.doesNotMatch(ordinary.at(-1) ?? '', /ORIGINAL_SCHEDULE|REVISED_SCHEDULE|SAVED_PRIVATE_ORIGIN_REPLY/, 'removal invalidates derived history');
    assert.ok((await page(w)).messages.some(message => message.text === originReply), 'removing an input preserves the saved reply in private history');
  });
}

for (const name of ['anthropic', 'openai'] as const) {
  void test(`${name} refuses oversized required owner input and native continuation before spend or transport`, async context => {
    const bodies: string[] = [];
    const transport = (_url: string, init: {body: string}): Promise<Response> => {
      bodies.push(init.body);
      return Promise.resolve(Response.json(name === 'anthropic'
        ? {content: [{type: 'tool_use', id: 'tool_read', name: 'read_lifx', input: {device: 'desk'}}], stop_reason: 'tool_use', usage: {input_tokens: 20, output_tokens: 10}}
        : {status: 'completed', output: [{type: 'function_call', id: 'fc_read', call_id: 'tool_read',
          name: 'read_lifx', arguments: '{"device":"desk"}'}], usage: {input_tokens: 20, output_tokens: 10}}));
    };
    const adapter = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
      : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
    const provider: ModelProvider & {inputWindow: number} = {name, model: adapter.model, inputWindow: 9_000,
      contextInputUnits: input => adapter.contextInputUnits(input), turn: (input, signal) => {
        // Give the native continuation exactly the required first request's budget.
        provider.inputWindow = adapter.contextInputUnits(input);
        return adapter.turn(input, signal);
      }};
    const w = await world(context, {provider, tools: ['read_lifx'], devices: () => [light('desk', 'Desk Lamp')]});
    await control(w.core, w.module(), 'enable');
    const spendRows = () => w.host().moduleDatabase()?.prepare('SELECT id FROM assistant_spend').all().length;
    const original = 'Retain the whole owner message. '.repeat(350).trimEnd();
    assert.equal((await input(w.core, w.module(), original)).status, 'accepted');
    await until(() => status(w) === 'failed');
    assert.equal(task(w)?.code, 'capacity');
    assert.deepEqual(bodies, []);
    assert.equal(spendRows(), 0);
    assert.ok((await page(w)).messages.some(message => message.text === original));

    assert.equal((await input(w.core, w.module(), '', false, randomUUID(), {action: 'new-conversation', text: undefined})).status, 'accepted');
    provider.inputWindow = 100_000;
    const before = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), 'What is the brightness of Desk Lamp?')).status, 'accepted');
    await until(() => task(w)?.taskId !== before && status(w) === 'failed');
    assert.equal(task(w)?.code, 'capacity');
    assert.equal(bodies.length, 1);
    assert.equal(spendRows(), 1, 'only the sent first call consumes a reservation');
  });
}

for (const name of ['anthropic', 'openai'] as const) {
  void test(`${name} checks origin device grants for privately displayed and spoken derived replies`, async context => {
    const phrase = 'The test device reported a reading. ORIGIN_FACT.';
    const repeated = 'The earlier reading was recorded. DERIVED_FACT.';
    const read = 'What is the brightness of Desk Lamp?';
    const quote = 'What did the earlier reading say?';
    const bodies: string[] = [];
    const offers: SpokenReply[] = [];
    const usage = {input_tokens: 20, output_tokens: 10};
    const transport = (_url: string, init: {body: string}): Promise<Response> => {
      bodies.push(init.body);
      const first = init.body.includes(read) && !init.body.includes(quote) && !init.body.includes('tool_result') && !init.body.includes('function_call_output');
      if (first) return Promise.resolve(Response.json(name === 'anthropic'
        ? {content: [{type: 'tool_use', id: 'read_desk', name: 'read_lifx', input: {device: 'desk'}}], stop_reason: 'tool_use', usage}
        : {status: 'completed', output: [{type: 'function_call', id: 'fc_read_desk', call_id: 'read_desk',
          name: 'read_lifx', arguments: '{"device":"desk"}'}], usage}));
      const text = init.body.includes(quote) ? init.body.includes(phrase) ? repeated : 'No previous reading.' : phrase;
      return Promise.resolve(Response.json(name === 'anthropic' ? {content: [{type: 'text', text}], stop_reason: 'end_turn', usage}
        : {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]}], usage}));
    };
    const provider = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
      : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
    const baseline = sharing();
    let revoked: 'private-conversation' | 'conversation-speech' | undefined;
    const w = await world(context, {provider, tools: ['read_lifx'], devices: owner => owner === 'bunny/modules/lifx' ? [light('desk', 'Desk Lamp')] : [],
      speak: offer => {offers.push(offer);}, share: query => baseline(query) && !(query.destination === revoked &&
        query.source === 'devices' && query.field === 'status' && query.record === 'desk')});
    await control(w.core, w.module(), 'enable');
    assert.equal((await input(w.core, w.module(), read)).status, 'accepted');
    await until(() => status(w) === 'succeeded');
    const first = task(w)?.taskId ?? assert.fail('origin task');
    assert.ok(w.store().calls(first).some(call => call.disclosures?.some(field =>
      field.source === 'devices' && field.field === 'status' && field.record === 'desk') === true));
    assert.equal((await input(w.core, w.module(), quote)).status, 'accepted');
    await until(() => task(w)?.taskId !== first && status(w) === 'succeeded');
    const derived = task(w)?.taskId ?? assert.fail('derived task');
    const messageId = `${derived}-result`;
    assert.match(bodies.at(-1) ?? '', /ORIGIN_FACT/);
    assert.ok((await page(w)).messages.some(message => message.text === repeated));
    assert.ok(offers.some(offer => offer.messageId === messageId));

    revoked = 'conversation-speech';
    const spoken = offers.length;
    assert.equal((await control(w.core, w.module(), 'speak', derived, randomUUID(), {messageId})).status, 'rejected');
    assert.equal(offers.length, spoken);
    assert.ok((await page(w)).messages.some(message => message.text === repeated), 'speech revocation keeps private display available');

    revoked = 'private-conversation';
    await w.restart();
    assert.doesNotMatch(JSON.stringify(await page(w)), /ORIGIN_FACT|DERIVED_FACT/);
    assert.equal((await control(w.core, w.module(), 'speak', derived, randomUUID(), {messageId})).status, 'rejected');
    assert.equal(offers.length, spoken);
  });

  for (const permission of ['unchanged', 'gained', 'lost'] as const) {
    void test(`${name} rebuilds synced mode during compaction with ${permission} permission`, async context => {
      const pending = deferred<Response>(), ordinary: string[] = [];
      let started = false, mode = hub(1), allowed = permission !== 'gained';
      const policy = sharing();
      const response = (text: string) => Response.json(name === 'anthropic'
        ? {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 20, output_tokens: 10}}
        : {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text, annotations: []}]}],
          usage: {input_tokens: 20, output_tokens: 10}});
      const transport = (_url: string, init: {body: string}): Promise<Response> => {
        if (init.body.includes('Summarize the supplied older conversation exchanges')) {
          started = true;
          return pending.promise;
        }
        ordinary.push(init.body);
        return Promise.resolve(response('Synthetic reply.'));
      };
      const adapter = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
        : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
      const provider: ModelProvider & {inputWindow: number} = {name, model: adapter.model, inputWindow: 115_000,
        contextInputUnits: input => adapter.contextInputUnits(input), turn: (input, signal) => adapter.turn(input, signal)};
      const w = await world(context, {provider, core: () => ({sessions: [], mode, synced: true}),
        share: query => policy(query) && !(query.destination === 'external-model' && query.source === 'devices' &&
          query.field === 'status' && query.record === 'hub' && !allowed)});
      await control(w.core, w.module(), 'enable');
      for (let index = 0; index < 8; index += 1) {
        const earlier = task(w)?.taskId;
        assert.equal((await input(w.core, w.module(), `Earlier exchange ${String(index)}. ${'The recent note describes a daily plan. '.repeat(60)}`)).status, 'accepted');
        await until(() => task(w)?.taskId !== earlier && status(w) === 'succeeded');
      }
      provider.inputWindow = 14_000;
      const earlier = task(w)?.taskId;
      assert.equal((await input(w.core, w.module(), 'What is the Hub mode now?')).status, 'accepted');
      await until(() => started);
      mode = hub(2, 'quiet');
      allowed = permission !== 'lost';
      pending.resolve(response(JSON.stringify({decisions: ['Keep the daily plan.'], openQuestions: [], references: [], corrections: []})));
      await until(() => task(w)?.taskId !== earlier && status(w) === 'succeeded');
      assert.doesNotMatch(ordinary.at(-1) ?? '', /The Hub mode is work now/);
      assert.equal((ordinary.at(-1) ?? '').includes('The Hub mode is quiet now.'), permission !== 'lost');
    });
  }
}

for (const failure of ['uncertain', 'provider-capacity'] as const) {
  void test(`optional compaction preserves provider spend and unknown-retry boundaries on ${failure}`, async context => {
    let compacted = 0, ordinary = 0;
    const provider: ModelProvider & {inputWindow: number} = {name: 'openai', model: OPENAI_MODEL, inputWindow: 30_000,
      contextInputUnits: input => Buffer.byteLength(JSON.stringify(input)),
      turn: input => {
        if (input.instructions.startsWith('Summarize the supplied older conversation exchanges')) {
          compacted += 1;
          return Promise.reject(failure === 'uncertain' ? new ProviderFault('unavailable', true)
            : new ProviderFault('capacity', false, undefined, 'The provider spend limit was reached.'));
        }
        ordinary += 1;
        return Promise.resolve(reply('Synthetic reply.'));
      }};
    const w = await world(context, {provider});
    await control(w.core, w.module(), 'enable');
    const ask = async (text: string, terminal: 'succeeded' | 'failed' = 'succeeded') => {
      const before = task(w)?.taskId;
      assert.equal((await input(w.core, w.module(), text)).status, 'accepted');
      await until(() => task(w)?.taskId !== before && status(w) === terminal);
    };
    for (let index = 0; index < 7; index += 1) await ask(`Synthetic observation ${String(index)}. ${'A bounded report. '.repeat(52)}`);
    provider.inputWindow = 4_500;
    await ask('Check the plan again.', failure === 'uncertain' ? 'succeeded' : 'failed');
    assert.equal(compacted, 1);
    if (failure === 'provider-capacity') {
      assert.equal(task(w)?.code, 'capacity');
      assert.equal(ordinary, 7, 'a hard provider refusal stops the ordinary send');
    } else {
      assert.equal(ordinary, 8, 'an uncertain optional call leaves the allowed recent-tail path');
      await w.restart();
      await ask('Check the plan after restart.');
      assert.equal(compacted, 1, 'an ambiguous prefix is not automatically charged again');
      assert.equal(ordinary, 9);
      provider.inputWindow = 5_500;
      for (let index = 0; index < 8 && compacted === 1; index += 1) await ask(`Distinct future exchange ${String(index)}. ${'A fresh note. '.repeat(80)}`);
      assert.equal(compacted, 2, 'a distinct bounded prefix can compact after an earlier uncertain call');
    }
  });
}

void test('Responses device reads bind the affirmative subject without widening it', async context => {
  const cases = [
    ['What is the brightness of Desk Lamp, not all lights?', 'Desk Lamp (desk)'],
    ['What is the brightness of Desk Lamp, rather than Hall Lamp?', 'Desk Lamp (desk)'],
    ['What is the brightness of Desk Lamp only? Leave Hall Lamp alone.', 'Desk Lamp (desk)'],
    ['What is the brightness of Desk Lamp?', 'Desk Lamp (desk)'],
    ['List all lights', 'Desk Lamp (desk)\nHall Lamp (lamp)\nDuplicated Lamp (first)\nDuplicated Lamp (second)'],
    ['What is the brightness of Duplicated Lamp?', 'No configured LIFX lights are known.'],
    ['What is the status of Hall Plug?', 'No configured LIFX lights are known.'],
    ['List all lights except Hall Lamp', 'No configured LIFX lights are known.'],
  ] as const;
  const outputs: string[] = [];
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]};
    const output = body.input.find(item => item.type === 'function_call_output')?.output;
    if (output !== undefined) outputs.push(output);
    const items = output === undefined
      ? [{type: 'function_call', id: 'fc_lights', call_id: 'call_lights', name: 'read_lifx', arguments: '{"device":""}'}]
      : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Read complete.', annotations: []}]}];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output: items, usage: {input_tokens: 40, output_tokens: 40}})));
  }});
  const w = await world(context, {provider, tools: ['read_lifx'], devices: owner => owner === WEMO_OWNER ? [{...light('desk', 'Hall Plug'), kind: 'wemo'}]
    : [light('desk', 'Desk Lamp'), light('lamp', 'Hall Lamp'), light('first', 'Duplicated Lamp'), light('second', 'Duplicated Lamp')]});
  await control(w.core, w.module(), 'enable');
  for (const [prompt, expected] of cases) {
    const previous = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
    await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
    assert.equal(outputs.at(-1), expected, prompt);
  }
  assert.equal(outputs.length, cases.length);
});


for (const kind of ['timer', 'brightness'] as const) {
  void test(`Responses binds natural ${kind} reads to the exact owner-requested device`, async context => {
    const displayOwner = 'bunny/modules/pixoo';
    const plug: DeviceRecord = {...light(PLUG_ID, 'Test Plug'), kind: 'wemo'};
    const display: DeviceRecord = {...light('fixture-display', 'Test Display'), kind: 'pixoo', observed: {
      status: 'known', observedAtMs: TIMER_READ, power: unknown, brightness: {status: 'known', value: 37},
    }};
    const unknownDisplay: DeviceRecord = {...display, id: 'unknown-display', label: 'Unknown Display', observed: unknown};
    const otherPlug: DeviceRecord = {...plug, id: 'other-plug', label: 'Other Plug'};
    const duplicatePlugs: DeviceRecord[] = ['dupe-1', 'dupe-2'].map(id => ({...plug, id, label: 'Shared Plug'}));
    const displays: DeviceRecord[] = [display, unknownDisplay, ...['dupe-3', 'dupe-4'].map(id => ({...display, id, label: 'Shared Display'}))];
    const plugs = [plug, otherPlug, ...duplicatePlugs];
    const tool = kind === 'timer' ? 'read_wemo' : 'read_devices';
    let target = kind === 'timer' ? 'Test Plug' : display.id;
    let denied: 'private-conversation' | 'external-model' | undefined;
    const baseline = sharing();
    const share = (query: ShareQuery) => baseline(query) && !(query.destination === denied &&
      query.source === 'devices' && query.field === 'label' && query.record === (kind === 'timer' ? plug.id : display.id));
    const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
      const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]};
      const evidence = body.input.find(item => item.type === 'function_call_output')?.output;
      const output = evidence === undefined
        ? [{type: 'function_call', id: 'fc_read', call_id: 'call_read', name: tool,
          arguments: JSON.stringify(kind === 'timer' ? {device: target} : {owner: displayOwner, target})}]
        : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: evidence, annotations: []}]}];
      return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 40, output_tokens: 40}})));
    }});
    const w = await world(context, {provider, share, tools: [tool], timeZone: 'America/New_York',
      devices: owner => owner === WEMO_OWNER ? plugs : [], dispatch: () => assert.fail('A read-only question sends no command')}, undefined, TIMER_READ);
    const register = async (source: string, devices: DeviceRecord[]) => {
      const owner = w.bus.connect(source);
      context.after(() => owner.close());
      await owner.serveSync(['device'], () => ({revision: 1, states: devices.map(data => ({
        type: 'org.bunny.device.updated', subject: data.id, dataschema: DEVICE_POWER_READBACK_SCHEMA, data,
      }))}));
    };
    await register(WEMO_OWNER, plugs);
    await register(displayOwner, displays);
    await w.core.serveSync(['power-limit'], () => ({revision: 1, states: [powerLimitDraft(powerLimit('armed'))]}));
    await w.restart();
    await control(w.core, w.module(), 'enable');
    const ask = async (text: string, profile = 'bunny'): Promise<string> => {
      const current = () => w.module().inspectAssistant()?.tasks.find(task => task.profile === profile);
      const previous = current()?.taskId;
      assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {profile})).status, 'accepted');
      await until(() => current()?.taskId !== previous && current()?.status === 'succeeded');
      const message = (await page(w, profile, 'recent')).messages.at(-1);
      assert.equal(message?.role, 'assistant');
      return message?.text ?? assert.fail('Expected a Conversation answer');
    };
    const prompt = kind === 'timer'
      ? 'Is the timer for the test plug on, and how much time is left on the timer for it to automatically turn off?'
      : 'What is the currently reported brightness of fixture-display?';
    const known = kind === 'timer' ? /maximum-on limit is enabled.*Time remaining at this read: about 2 hours 4 minutes/isu : /"brightness":\{"status":"known","value":37\}/u;
    const missing = kind === 'timer' ? /not-found/u : /"devices":\[\]/u;
    for (const profile of ['bunny', 'reachy', 'microduck']) assert.match(await ask(prompt, profile), known, profile);
    for (const side of ['private-conversation', 'external-model'] as const) {
      denied = side;
      assert.match(await ask(prompt), missing);
    }
    denied = undefined;
    target = kind === 'timer' ? otherPlug.label ?? '' : unknownDisplay.id;
    assert.match(await ask(prompt), missing, 'The model cannot widen the owner-requested target.');
    target = kind === 'timer' ? 'Shared Plug' : 'Shared Display';
    assert.match(await ask(kind === 'timer' ? 'Is the timer for the Shared Plug active?'
      : 'What is the currently reported brightness of Shared Display?'), missing);
    if (kind === 'brightness') {
      target = unknownDisplay.id;
      assert.match(await ask('What is the currently reported brightness of unknown-display?'), /"observation":\{"status":"unknown"\}/u);
    } else {
      target = 'Other Plug';
      assert.match(await ask('Is the timer active for the Other Plug?'), /No maximum-on limit has been set/);
    }
  });
}

void test('both hosted supervisors read the owner calendar while the spend ledger stays on UTC', async context => {
  const config = configureCompanions({assistant: {historyTimeZone: 'America/New_York'}});
  assert.ok('config' in config);
  const source = 'bunny/modules/lifx', target = 'desk';
  const queryTimes: {fromAtMs: number; toAtMs: number}[] = [];
  const argumentsFor = (name: string) => name === 'openai'
    ? {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''}
    : {source, target, period: 'yesterday', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const makeProvider = (name: 'anthropic' | 'openai', model: string): ModelProvider => ({
    name, model, turn: input => Promise.resolve(input.transcript.some(item => item.role === 'tool')
      ? reply('Synthetic answer.') : call('read_device_history', argumentsFor(name))),
  });
  const now = Date.parse('2026-11-02T01:00:00Z');
  const w = await world(context, {
    provider: makeProvider('anthropic', 'claude-sonnet-5-5'), alternateProvider: makeProvider('openai', OPENAI_MODEL),
    timeZone: 'UTC', tools: ['read_device_history'], devices: owner => owner === source ? [light(target, 'Desk Lamp')] : [],
    deviceHistory: query => {
      assert.equal(query.target, target);
      assert.equal(query.source, source);
      const {fromAtMs, toAtMs} = query;
      queryTimes.push({fromAtMs, toAtMs});
      return {schema: DEVICE_HISTORY_VERSION, query, boundary: 1, complete: false, durations: {on: 0, off: 0, unknown: toAtMs - fromAtMs},
        lastChange: null, evidence: [], links: []};
    },
  }, ctx => ({...ctx, config: config.config}), now);
  await control(w.core, w.module(), 'enable');
  for (const provider of ['anthropic', 'openai']) {
    const previous = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), 'How long was Desk Lamp on yesterday?', false, randomUUID(), {provider})).status, 'accepted');
    await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
  }
  const interval = {fromAtMs: Date.parse('2026-10-31T04:00:00Z'), toAtMs: Date.parse('2026-11-01T04:00:00Z')};
  assert.deepEqual(queryTimes, [interval, interval]);
  const spend = await w.module().manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  assert.equal((JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {period: string}}).day.period, '2026-11-02');
});

for (const providerName of ['anthropic', 'openai'] as const) {
  for (const action of ['queue', 'edit-queued', 'steer'] as const) {
    void test(`${providerName} reads yesterday as of an owner message saved before midnight through ${action}`, async context => {
      const config = configureCompanions({assistant: {historyTimeZone: 'America/New_York'}});
      assert.ok('config' in config);
      const source = 'bunny/modules/lifx', target = 'desk', question = 'How long was Desk Lamp on yesterday?';
      const hold = deferred<TurnReply>();
      let entered = false;
      const observed: {fromAtMs: number; toAtMs: number}[] = [];
      const provider: ModelProvider = {name: providerName, model: providerName === 'openai' ? OPENAI_MODEL : 'claude-sonnet-5-5', turn: input => {
        const latest = input.transcript.filter(item => item.role === 'owner').at(-1);
        if (latest?.text !== question) {entered = true; return hold.promise;}
        if (input.transcript.some(item => item.role === 'tool')) return Promise.resolve(reply('Synthetic history answer.'));
        const query = providerName === 'openai'
          ? {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''}
          : {source, target, period: 'yesterday', fromAtMs: 0, toAtMs: 0, cursor: ''};
        return Promise.resolve(call('read_device_history', query));
      }};
      const w = await world(context, {provider, timeZone: 'UTC', tools: ['read_device_history'],
        devices: owner => owner === source ? [light(target, 'Desk Lamp')] : [],
        deviceHistory: query => {
          const {fromAtMs, toAtMs} = query;
          observed.push({fromAtMs, toAtMs});
          return {schema: DEVICE_HISTORY_VERSION, query, boundary: 1, complete: false, durations: {on: 0, off: 0, unknown: toAtMs - fromAtMs},
            lastChange: null, evidence: [], links: []};
        },
      }, ctx => ({...ctx, config: config.config}), Date.parse('2026-11-02T04:59:00Z'));
      await control(w.core, w.module(), 'enable');
      assert.equal((await input(w.core, w.module(), 'Synthetic blocking turn.')).status, 'accepted');
      await until(() => entered);
      if (action === 'steer') {
        const taskId = task(w)?.taskId ?? assert.fail('running task');
        assert.equal((await input(w.core, w.module(), question, false, randomUUID(), {action, taskId})).status, 'accepted');
      } else {
        const queuedId = randomUUID();
        assert.equal((await input(w.core, w.module(), action === 'queue' ? question : 'Synthetic placeholder.', false, queuedId, {action: 'queue'})).status, 'accepted');
        if (action === 'edit-queued') {
          w.advance(120_000);
          assert.equal((await input(w.core, w.module(), question, false, randomUUID(), {action, queuedId})).status, 'accepted');
        }
      }
      if (action !== 'edit-queued') w.advance(120_000);
      hold.resolve(reply('Synthetic first answer.'));
      await until(() => observed.length === 1 && status(w) === 'succeeded');
      const fromAtMs = Date.parse(action === 'edit-queued' ? '2026-11-01T04:00:00Z' : '2026-10-31T04:00:00Z');
      const toAtMs = Date.parse(action === 'edit-queued' ? '2026-11-02T05:00:00Z' : '2026-11-01T04:00:00Z');
      assert.deepEqual(observed, [{fromAtMs, toAtMs}]);
    });
  }
}

void test('Responses history requires one exact device and current summary grants', async context => {
  const target = 'desk', source = 'bunny/modules/lifx';
  const baseline = sharing();
  const day = Date.parse('2026-11-25T00:00:00Z');
  let expected: {source: string; target: string} = {source, target};
  let denied: 'local' | 'remote' | undefined, reads = 0, revokeAfterRead = false;
  let args = {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const sent: string[] = [], results: string[] = [];
  const titles: string[] = [];
  const titleProvider = new OpenAITitleProvider({key: 'fake', model: OPENAI_MODEL, transport: (_url, init) => {
    titles.push(init.body);
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output: [{type: 'message', role: 'assistant',
      content: [{type: 'output_text', text: 'Fixture history title', annotations: []}]}], usage: {input_tokens: 20, output_tokens: 10}})));
  }});
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    sent.push(init.body);
    const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]; tools: {name: string}[]};
    const result = body.input.find(item => item.type === 'function_call_output')?.output;
    if (result !== undefined) results.push(result);
    const output = result === undefined && body.tools.some(tool => tool.name === 'read_device_history')
      ? [{type: 'function_call', id: 'fc_history', call_id: 'call_history', name: 'read_device_history', arguments: JSON.stringify(args)}]
      : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Synthetic history answer.', annotations: []}]}];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 40, output_tokens: 40}})));
  }});
  const share = (query: ShareQuery) => baseline(query) && !(query.source === 'devices' && query.field === 'summary' && query.record === target &&
    (denied === 'local' && query.destination === 'private-conversation' || denied === 'remote' && query.destination === 'external-model'));
  const w = await world(context, {provider, openAITitleProvider: titleProvider, timeZone: 'UTC', share, tools: ['read_device_history'],
    devices: owner => owner === WEMO_OWNER ? [{...light('plug', 'Hall Plug'), kind: 'wemo'}]
      : [light(target, 'Desk Lamp'), light('other', 'Hall Lamp'), light('first', 'Shared Name'), light('second', 'Shared Name')],
    dispatch: () => assert.fail('history sends no device command'),
    deviceHistory: query => {
      reads += 1;
      if (revokeAfterRead) denied = 'remote';
      assert.equal(query.source, expected.source);
      assert.equal(query.target, expected.target);
      const total = query.toAtMs - query.fromAtMs;
      return {schema: DEVICE_HISTORY_VERSION, query, boundary: 155, complete: true,
        durations: {on: 421, off: 0, unknown: total - 421}, lastChange: {atMs: query.fromAtMs + 1, seq: 154, from: 'off', to: 'on'},
        evidence: [{seq: 154, messageId: 'PRIVATE_EVIDENCE_ID', atMs: query.fromAtMs + 1, confirmedThroughMs: query.toAtMs,
          kind: 'observation', power: 'on'}],
        links: [{requestId: 'PRIVATE_OPERATION_ID', observationSeq: 154, sentSeq: 151, transmissionOutcomeSeq: 152, transmittedAtMs: query.fromAtMs}]};
    }}, undefined, day + 5000);
  await control(w.core, w.module(), 'enable');
  const ask = async (prompt: string) => {
    const previous = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
    await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
    return results.at(-1) ?? '';
  };
  const affirmative = 'How long was Desk Lamp on yesterday?';
  const summary = await ask(affirmative);
  assert.equal(reads, 1);
  assert.match(summary, /"on":421/);
  assert.deepEqual((JSON.parse(summary) as {interval: unknown}).interval, {fromAtMs: day - 86_400_000, toAtMs: day});
  assert.doesNotMatch(summary, /lastChange|PRIVATE_|"seq"|"cursor"|"boundary"|"target"|"source"/);
  for (const side of ['remote', 'local'] as const) {
    denied = side;
    assert.match(await ask(affirmative), /forbidden/);
  }
  denied = undefined;
  assert.match(await ask('How long was Shared Name on yesterday?'), /forbidden/);
  assert.match(await ask('How long was Desk Lamp or Hall Plug on yesterday?'), /forbidden/);
  args = {...args, target: 'other'};
  assert.match(await ask(affirmative), /forbidden/);
  args = {...args, target: '', source: WEMO_OWNER};
  assert.match(await ask(affirmative), /forbidden/);
  args = {...args, source: '', period: 'yesterday', fromAtMs: 1, toAtMs: 2};
  assert.match(await ask(affirmative), /forbidden/);
  assert.equal(reads, 1);
  args = {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const lastChange = await ask('When did Desk Lamp last change between 2026-11-24T12:00:00Z and 2026-11-24T13:00:00Z?');
  assert.match(lastChange, /"lastChange":\{"atMs":1795521600001,"from":"off","to":"on"\}/);
  assert.doesNotMatch(lastChange, /seq|durations/);
  assert.match(await ask('How long was Desk Lamp on from 2026-11-31T12:00:00Z to 2026-12-01T13:00:00Z?'), /forbidden/);
  const noHistoryRead = results.length;
  await ask('Tell me a synthetic joke.');
  assert.equal(results.length, noHistoryRead, 'an unrelated request is not offered the history tool');
  assert.equal(reads, 2);
  assert.equal(results.filter(value => value.includes('"on":421')).length, 1);
  assert.ok(titles.length > 0);
  assert.doesNotMatch(titles.join(' '), /durations|lastChange|PRIVATE_/);
  const beforeRevoke = sent.length;
  const priorTask = task(w)?.taskId;
  revokeAfterRead = true;
  await input(w.core, w.module(), affirmative);
  await until(() => task(w)?.taskId !== priorTask && status(w) === 'failed');
  assert.equal(task(w)?.code, 'forbidden');
  assert.equal(reads, 3);
  assert.equal(sent.length, beforeRevoke + 1, 'revoked result did not reach a second provider call');
  denied = undefined;
  revokeAfterRead = false;
  expected = {source: WEMO_OWNER, target: 'plug'};
  assert.match(await ask('How long was Hall Plug on yesterday?'), /"on":421/);
  assert.equal(reads, 4);
  assert.doesNotMatch(sent.join(' '), /PRIVATE_EVIDENCE_ID|PRIVATE_OPERATION_ID/);
});


void test('both hosted supervisors disclose requested power timestamps only while detail sharing holds', async context => {
  const source = 'bunny/modules/lifx', target = 'desk';
  const day = Date.parse('2026-11-25T00:00:00Z'), fromAtMs = day - 86_400_000;
  const onAt = fromAtMs + 200, offAt = fromAtMs + 621;
  const aggregate = 'How long was Desk Lamp on yesterday?';
  const timestamps = 'Show on/off timestamps for Desk Lamp yesterday.';
  const justOn = 'When did Desk Lamp turn on yesterday?';
  const args = {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const captures = {anthropic: {requests: [] as string[], results: [] as string[]}, openai: {requests: [] as string[], results: [] as string[]}};
  const usage = {input_tokens: 20, output_tokens: 10};
  const anthropic = new AnthropicProvider({key: 'fixture', transport: (_url, init) => {
    const capture = captures.anthropic;
    capture.requests.push(init.body);
    const body = JSON.parse(init.body) as {messages: {content: {type: string; content?: string}[]}[]};
    const result = body.messages.flatMap(item => item.content).find(block => block.type === 'tool_result')?.content;
    if (result !== undefined) capture.results.push(result);
    return Promise.resolve(Response.json({content: result === undefined ? [{type: 'tool_use', id: 'read_history', name: 'read_device_history', input: args}]
      : [{type: 'text', text: 'Synthetic history answer.'}], stop_reason: result === undefined ? 'tool_use' : 'end_turn', usage}));
  }});
  const openai = new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    const capture = captures.openai;
    capture.requests.push(init.body);
    const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]};
    const result = body.input.find(item => item.type === 'function_call_output')?.output;
    if (result !== undefined) capture.results.push(result);
    return Promise.resolve(Response.json({status: 'completed', usage, output: result === undefined
      ? [{type: 'function_call', id: 'fc_read_history', call_id: 'read_history', name: 'read_device_history', arguments: JSON.stringify(args)}]
      : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Synthetic history answer.', annotations: []}]}]}));
  }});
  let revokeAfterRead = false, revoked = false, reads = 0;
  let deniedDiscovery: 'private-conversation' | 'external-model' | undefined;
  const localDetailsDenied = sharing([{caller: 'owner', companion: 'bunny', destination: 'private-conversation',
    purpose: 'read', source: 'devices', field: 'details', record: target, allow: false}]);
  let legacyLocalDenial = false;
  const baseline = sharing();
  const w = await world(context, {provider: anthropic, alternateProvider: openai, timeZone: 'UTC', tools: ['read_device_history'],
    share: query => (legacyLocalDenial ? localDetailsDenied : baseline)(query) && !(query.destination === deniedDiscovery && query.source === 'devices' && query.field === 'index') &&
      !(revoked && query.destination === 'external-model' && query.source === 'devices' &&
      query.field === 'details' && query.record === target),
    devices: owner => owner === source ? [light(target, 'Desk Lamp'), light('other', 'Hall Lamp')] : [],
    dispatch: () => assert.fail('history sends no device command'),
    deviceHistory: query => {
      reads += 1;
      assert.deepEqual(query, {source, target, fromAtMs, toAtMs: day});
      if (revokeAfterRead) revoked = true;
      return {schema: DEVICE_HISTORY_VERSION, query, boundary: 155, complete: true, durations: {on: 421, off: 86_399_379, unknown: 200},
        lastChange: {atMs: offAt, seq: 154, from: 'on', to: 'off'}, evidence: [
          {seq: 153, messageId: 'PRIVATE_EVIDENCE_ON', atMs: onAt, confirmedThroughMs: offAt, kind: 'observation', power: 'on'},
          {seq: 154, messageId: 'PRIVATE_EVIDENCE_OFF', atMs: offAt, confirmedThroughMs: day, kind: 'observation', power: 'off'},
        ], links: [{requestId: 'PRIVATE_HISTORY_OPERATION', observationSeq: 154, sentSeq: 151, transmissionOutcomeSeq: 152,
          transmittedAtMs: fromAtMs}]};
    }}, undefined, day + 5000);
  await control(w.core, w.module(), 'enable');
  const interval = {fromAtMs, toAtMs: day};
  for (const provider of ['anthropic', 'openai'] as const) {
    const capture = captures[provider];
    const ask = async (prompt: string, terminal: 'succeeded' | 'failed' = 'succeeded') => {
      const previous = task(w)?.taskId;
      const before = capture.requests.length;
      assert.equal((await input(w.core, w.module(), prompt, false, randomUUID(), {provider})).status, 'accepted');
      await until(() => task(w)?.taskId !== previous && status(w) === terminal);
      assert.equal(capture.requests.length, before + (terminal === 'succeeded' ? 2 : 1));
      return capture.results.at(-1) ?? '';
    };
    assert.deepEqual(JSON.parse(await ask(aggregate)), {interval, complete: true, durations: {on: 421, off: 86_399_379, unknown: 200}});
    assert.deepEqual(JSON.parse(await ask(timestamps)), {interval, complete: true, unknownMs: 200,
      evidence: [{atMs: onAt, power: 'on'}, {atMs: offAt, power: 'off'}], next: null, capped: false});
    assert.deepEqual(JSON.parse(await ask(justOn)), {interval, complete: true, unknownMs: 200, evidence: [{atMs: onAt, power: 'on'}], next: null, capped: false});
    for (const destination of ['private-conversation', 'external-model'] as const) {
      deniedDiscovery = destination;
      assert.equal(await ask(aggregate), 'refused: forbidden');
      assert.equal(await ask(timestamps), 'refused: forbidden');
    }
    deniedDiscovery = undefined;
    legacyLocalDenial = true;
    assert.equal(await ask(aggregate), 'refused: forbidden');
    assert.equal(await ask(timestamps), 'refused: forbidden');
    legacyLocalDenial = false;
    const resultCount = capture.results.length;
    revokeAfterRead = true;
    await ask(timestamps, 'failed');
    assert.equal(task(w)?.code, 'forbidden');
    assert.equal(capture.results.length, resultCount);
    revokeAfterRead = false;
    revoked = false;
    assert.doesNotMatch(capture.requests.join('\n'), /PRIVATE_EVIDENCE|PRIVATE_HISTORY_OPERATION|confirmedThroughMs|observationSeq/u);
  }
  assert.equal(reads, 8);
});

void test('an unpinned legacy task and queue remain readable without resuming on a synthetic host', async context => {
  const earlier = counted(() => call('ask_owner', {text: 'Which option?'}));
  const current = counted(() => reply('Fresh synthetic answer.'));
  const options: CompanionsOptions = {provider: {...earlier, name: 'anthropic', model: 'claude-opus-5-5'},
    dispatch: () => assert.fail('an ambiguous restart cannot send a command')};
  const w = await world(context, options);
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'Legacy hosted request.')).status, 'accepted');
  await until(() => status(w) === 'waiting');
  const old = task(w) ?? assert.fail('legacy task');
  const queuedId = randomUUID();
  assert.equal((await input(w.core, w.module(), 'Legacy queued request.', false, queuedId, {action: 'queue'})).status, 'accepted');
  const requestId = randomUUID();
  const staged = await w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'answer', profile: 'bunny', expectedRevision: w.module().inspectAssistant()?.revision,
      taskId: old.taskId, questionId: old.questionId, text: 'approve'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const store = w.store(), legacy = store.task(old.taskId) ?? assert.fail('persisted task');
  delete legacy.supervisor;
  assert.ok(legacy.question);
  legacy.question = {...legacy.question, kind: 'approval', proposal: {family: 'mode-set', target: 'hub', data: {mode: 'quiet'}, expectedRevision: 4}};
  store.save(legacy);
  w.host().moduleDatabase()?.prepare('DELETE FROM assistant_queue_supervisors WHERE message_id=?').run(queuedId);

  await w.restart(() => {options.provider = current;});
  assert.equal(status(w), 'paused');
  assert.equal(task(w)?.code, 'unavailable');
  assert.ok((await page(w, 'bunny', 'recent')).messages.some(message => message.text === 'Legacy hosted request.'));
  const answer = await w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested',
    subject: 'assistant', dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  assert.equal(answer.status, 'rejected');
  const freshAnswer = await input(w.core, w.module(), 'approve', true);
  assert.equal(freshAnswer.status, 'rejected');
  if (freshAnswer.status === 'rejected') assert.equal(freshAnswer.error.error.code, 'unavailable');
  assert.equal(w.store().task(old.taskId)?.question?.answer, null);
  assert.equal((await control(w.core, w.module(), 'cancel', old.taskId)).status, 'accepted');
  assert.equal((await control(w.core, w.module(), 'resume-queue', undefined, randomUUID(), {profile: 'bunny'})).status, 'rejected');
  assert.equal(w.store().queue.message(queuedId)?.text, 'Legacy queued request.');
  assert.equal(current.calls(), 0);
  assert.equal((await control(w.core, w.module(), 'withdraw', undefined, randomUUID(), {profile: 'bunny', queuedId})).status, 'accepted');
  const newRequest = randomUUID();
  const fresh = await w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: newRequest, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'new-conversation', profile: 'bunny', expectedRevision: w.module().inspectAssistant()?.revision}))});
  assert.ok(fresh !== undefined && !('error' in fresh));
  assert.equal((await w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: newRequest, ...fresh.data}}, {requestId: newRequest, timeoutMs: 5000})).status, 'accepted');
  assert.equal((await input(w.core, w.module(), 'Fresh synthetic request.')).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  assert.equal(current.calls(), 1);
  assert.equal(w.store().task(task(w)?.taskId ?? '')?.supervisor?.provider, 'synthetic');
});

void test('Messages uses the owner-bound aggregate and excludes private evidence fields', async context => {
  const day = Date.parse('2026-11-02T00:00:00Z');
  const source = 'bunny/modules/lifx';
  const inputFields = {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''};
  const turns: TurnInput[] = [];
  let reads = 0;
  const provider: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: request => {
    const latest = request.transcript.filter(item => item.role === 'owner').at(-1)?.text;
    if (latest === 'PRIVATE_PRIOR_TOPIC') return Promise.resolve(reply('PRIVATE_PRIOR_REPLY'));
    turns.push(request);
    return Promise.resolve(request.transcript.some(item => item.role === 'tool') ? reply('Synthetic scoped answer.') : call('read_device_history', inputFields));
  }};
  const w = await world(context, {provider, timeZone: 'UTC', tools: ['read_devices', 'read_device_history'],
    devices: owner => owner === source ? [light('desk', 'Desk Lamp'), light('a', 'Duplicated'), light('b', 'Duplicated')]
      : [{...light('hall', 'Hall Plug'), kind: 'wemo'}],
    dispatch: () => assert.fail('history sends no device command'),
    deviceHistory: query => {
      reads += 1;
      assert.deepEqual(query, {source, target: 'desk', fromAtMs: day - 86_400_000, toAtMs: day});
      const {fromAtMs, toAtMs} = query;
      return {schema: DEVICE_HISTORY_VERSION, query, boundary: 25, complete: true, lastChange: null,
        durations: {on: 100, off: 0, unknown: toAtMs - fromAtMs - 100}, links: [],
        evidence: [{seq: 1, messageId: 'PRIVATE_ROW', atMs: fromAtMs + 1, confirmedThroughMs: fromAtMs + 2, power: 'on', kind: 'observation'}]};
    }}, undefined, day + 1000);
  await control(w.core, w.module(), 'enable');
  for (const text of ['PRIVATE_PRIOR_TOPIC', 'How long was Desk Lamp on yesterday?', 'How long was Duplicated on yesterday?',
    'How long was Desk Lamp on from 2026-02-30T00:00:00Z to 2026-03-01T00:00:00Z?']) {
    const previous = task(w)?.taskId;
    assert.equal((await input(w.core, w.module(), text)).status, 'accepted');
    await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
  }
  const result = turns[1]?.transcript.find(item => item.role === 'tool')?.result ?? assert.fail('missing aggregate');
  assert.deepEqual(JSON.parse(result), {interval: {fromAtMs: day - 86_400_000, toAtMs: day}, complete: true, durations: {on: 100, off: 0, unknown: 86_399_900}});
  assert.equal(reads, 1);
  assert.match(JSON.stringify(turns.at(-1)?.transcript), /refused: forbidden/u);
  assert.doesNotMatch(JSON.stringify(turns), /PRIVATE_ROW|"seq"|"boundary"|"links"/u);
  assert.ok(turns.every(turn => turn.tools.length === 1 && turn.tools[0]?.name === 'read_device_history'));
});

void test('Claude keeps the history scope when registry labels change after model admission', async context => {
  const entered = deferred<void>(), release = deferred<TurnReply>();
  const source = 'bunny/modules/lifx';
  const turns: TurnInput[] = [];
  let target = 'desk';
  const provider: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: request => {
    turns.push(request);
    if (turns.length > 1) return Promise.resolve(reply('No scoped history available.'));
    entered.resolve();
    return release.promise;
  }};
  const w = await world(context, {provider, tools: ['read_device_history'], timeZone: 'UTC',
    devices: owner => owner === source ? [light(target, 'Desk Lamp')] : [],
    deviceHistory: query => assert.fail(`unexpected read of ${query.target}`),
  }, undefined, Date.parse('2026-11-02T01:00:00Z'));
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'How long was Desk Lamp on yesterday?')).status, 'accepted');
  await entered.promise;
  target = 'replacement';
  release.resolve(call('read_device_history', {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''}));
  await until(() => status(w) === 'failed');
  assert.equal(turns.length, 1);
});

void test('Messages offers no history read when the history tool is disabled', async context => {
  const turns: TurnInput[] = [];
  const provider: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: request => {
    turns.push(request);
    return Promise.resolve(reply('No history tool available.'));
  }};
  const w = await world(context, {provider, tools: ['read_devices']});
  await control(w.core, w.module(), 'enable');
  assert.equal((await input(w.core, w.module(), 'PRIVATE_UNRELATED_PREVIOUS_REQUEST')).status, 'accepted');
  await until(() => status(w) === 'succeeded');
  const previous = task(w)?.taskId;
  assert.equal((await input(w.core, w.module(), 'How long was Desk Lamp on yesterday?')).status, 'accepted');
  await until(() => task(w)?.taskId !== previous && status(w) === 'succeeded');
  assert.equal(turns[0]?.tools.some(tool => tool.name === 'read_devices'), true);
  assert.deepEqual(turns[1]?.tools, []);
  assert.match(JSON.stringify(turns[1]), /PRIVATE_UNRELATED_PREVIOUS_REQUEST/u);
  assert.doesNotMatch(JSON.stringify(turns[1]?.transcript), /PRIVATE_UNRELATED_PREVIOUS_REQUEST/u);
});

for (const invalidation of ['device registry remap', 'local owner-message revocation', 'local device status revocation'] as const) {
  void test(`Messages withholds a saved history aggregate on ${invalidation}`, async context => {
    const source = 'bunny/modules/lifx';
    const allowed = sharing();
    const turns: TurnInput[] = [];
    let invalidated = false, reads = 0;
    const provider: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: request => {
      turns.push(request);
      return Promise.resolve(turns.length === 1
        ? call('read_device_history', {source: '', target: '', period: '', fromAtMs: 0, toAtMs: 0, cursor: ''})
        : reply('Synthetic scoped answer.'));
    }};
    const w = await world(context, {provider, tools: ['read_device_history'], timeZone: 'UTC',
      devices: owner => owner === source ? [light(invalidated && invalidation === 'device registry remap' ? 'replacement' : 'desk', 'Desk Lamp')] : [],
      share: grant => allowed(grant) && !(invalidated && grant.destination === 'private-conversation' &&
        (invalidation === 'local owner-message revocation' && grant.source === 'conversation' && grant.field === 'text' && grant.record?.endsWith('-prompt') === true ||
          invalidation === 'local device status revocation' && grant.source === 'devices' && grant.field === 'status' && grant.record === 'desk')),
      deviceHistory: query => {
        invalidated = true;
        reads += 1;
        return {schema: DEVICE_HISTORY_VERSION, query, boundary: 4, complete: true, lastChange: null,
          durations: {on: 1, off: 0, unknown: query.toAtMs - query.fromAtMs - 1}, links: [],
          evidence: [{seq: 4, messageId: null, kind: 'observation', atMs: query.fromAtMs + 1, confirmedThroughMs: query.fromAtMs + 2, power: 'on'}]};
      }}, undefined, Date.parse('2026-11-02T01:00:00Z'));
    await control(w.core, w.module(), 'enable');
    assert.equal((await input(w.core, w.module(), 'How long was Desk Lamp on yesterday?')).status, 'accepted');
    await until(() => status(w) === 'succeeded' || status(w) === 'failed');
    assert.equal(reads, 1);
    assert.doesNotMatch(JSON.stringify(turns), /device-history\/1\.0/u);
  });
}

void test('Responses resolves an exact brightness instruction before sending one guarded command', async context => {
  const owner = 'bunny/modules/pixoo', target = 'fixture-display';
  const display: DeviceRecord = {...light(target, 'Test Display'), kind: 'pixoo'};
  const unsupported: DeviceRecord = {...display, id: 'unsupported-display',
    capabilities: {...display.capabilities, brightness: {supported: false}}};
  const devices = [display, unsupported, {...display, id: 'private-other', label: 'PRIVATE_OTHER_DISPLAY'},
    {...display, id: 'shared-a', label: 'Shared Display'}, {...display, id: 'shared-b', label: 'Shared Display'}];
  const requests: AssistantDispatch[] = [], lookup: string[] = [];
  let modelCalls = 0, replayedReceipts = 0;
  let pixooReads = 0, staleAtRead = Number.POSITIVE_INFINITY;
  let active = {id: target, attempt: true, repeat: false, wrongAmount: false, bypassLookup: false};
  let readOwner = 'auto', writeOwner = owner, readTarget = '', writeTarget: string | undefined;
  let denied: 'private-conversation' | 'external-model' | undefined;
  let outcome: 'accepted' | 'revoke-after-acceptance' | 'uncertain' = 'accepted';
  let deniedReceipt: {destination: 'private-conversation' | 'conversation-speech'; requestId: string} | undefined;
  const spoken: string[] = [];
  const standard = sharing();
  const share = (grant: ShareQuery) => standard(grant) && !(grant.destination === denied &&
    grant.source === 'devices' && grant.record === target && (grant.field === 'status' || grant.field === 'label')) &&
    !(deniedReceipt !== undefined && grant.destination === deniedReceipt.destination && grant.source === 'operations' &&
      grant.field === 'details' && grant.record === deniedReceipt.requestId);
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    modelCalls += 1;
    const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]; tools: {name: string}[]};
    assert.ok(body.tools.some(tool => tool.name === 'control_brightness_set'));
    const results = body.input.filter(item => item.type === 'function_call_output').map(item => item.output ?? '');
    if (results.some(result => /^The brightness|^accepted:/u.test(result))) replayedReceipts += 1;
    const tool = (name: string, args: Record<string, unknown>, id: string) =>
      [{type: 'function_call', id: 'fc_'+id, call_id: id, name, arguments: JSON.stringify(args)}];
    const control = (id: string) => tool('control_brightness_set', {owner: writeOwner, target: writeTarget ?? active.id,
      arguments: JSON.stringify({percent: active.wrongAmount ? 82 : 37})}, id);
    const done = [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Synthetic answer.', annotations: []}]}];
    if (results.length === 1) lookup.push(results[0] ?? '');
    const followed = results.at(-1);
    const output = results.length === 0 ? tool('read_devices', {owner: readOwner, target: readTarget}, 'lookup')
      : results.length === 1 && active.attempt && (active.bypassLookup || results[0]?.includes(JSON.stringify(active.id)) === true) ? control('first')
      : followed === 'yes' || followed === 'id:fixture-display' || followed === 'other-display' || followed === 'maybe fixture-display'
        ? control(`follow-${String(results.length)}`) : results.length === 2 && active.repeat ? control('repeated') : done;
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 30, output_tokens: 30}})));
  }});
  const w = await world(context, {provider, share, tools: ['read_devices', 'control_brightness_set'],
    speak: reply => {spoken.push(reply.text);},
    dispatch: data => {
      requests.push(data);
      if (outcome === 'revoke-after-acceptance') denied = 'external-model';
      return Promise.resolve(outcome === 'uncertain' ? {status: 'uncertain', requestId: data.requestId, error: errorBody('uncertain-result')} : accepted(data.requestId));
    }});
  const participant = w.bus.connect(owner);
  context.after(() => participant.close());
  await participant.serveSync(['device'], () => {
    pixooReads += 1;
    const selected = pixooReads >= staleAtRead ? devices.filter(device => device.id !== target) : devices;
    return {revision: 1, states: selected.map(data => ({
      type: 'org.bunny.device.updated', subject: data.id, dataschema: DEVICE_READBACK_SCHEMA, data,
    }))};
  });
  await control(w.core, w.module(), 'enable');
  const ask = async (text: string, profile = 'bunny') => {
    const current = () => w.module().inspectAssistant()?.tasks.find(item => item.profile === profile);
    const before = current()?.taskId, beforeDispatch = requests.length;
    assert.equal((await input(w.core, w.module(), text, false, randomUUID(), {profile})).status, 'accepted');
    await until(() => current()?.taskId !== before && (current()?.status === 'succeeded' || current()?.status === 'waiting' || requests.length > beforeDispatch));
    if (requests.length > beforeDispatch) w.advance(1200);
    await until(() => current()?.status === 'succeeded' || current()?.status === 'waiting');
  };
  active = {...active, repeat: true};
  for (const [index, profile] of ['bunny', 'reachy', 'microduck'].entries()) {
    readOwner = index === 2 ? owner : 'auto';
    readTarget = ['', target, `id:${target}`][index] ?? '';
    writeTarget = index === 0 ? target : `id:${target}`;
    await ask(`Set id:${target} brightness to 37%`, profile);
    assert.match(lookup.at(-1) ?? '', /"id":"fixture-display"/u);
    assert.match(lookup.at(-1) ?? '', /"controls":\["control_brightness_set"\]/u);
    assert.doesNotMatch(lookup.at(-1) ?? '', /PRIVATE_OTHER_DISPLAY|configurationRevision|generation|observation/u);
    assert.equal(requests.length, index + 1);
    const sent = requests.at(-1);
    assert.ok(sent?.family === 'catalog-action');
    assert.equal(sent.target, target);
    assert.equal(sent.command, 'brightness-set');
    assert.equal(sent.data.percent, 37);
    assert.deepEqual(sent.binding, {kind: 'device', target, owner, configurationRevision: display.configurationRevision, generation: display.generation});
    const receipt = w.store().call(sent.requestId);
    assert.equal(receipt?.kind, 'tool');
    assert.match(receipt?.result ?? '', /^accepted: the command entered the tracked dispatcher/u);
    assert.equal(receipt?.action?.control?.ownerMessageIds.length, 1);
    const saved = (await page(w, profile)).messages.filter(message => message.id.startsWith(`${receipt?.taskId}-`) && message.role === 'assistant');
    assert.equal(saved.length, 1);
    assert.match(saved[0]?.text ?? '', /brightness request accepted/i);
    assert.doesNotMatch(saved[0]?.text ?? '', /reports 37%/u);
    assert.equal(w.module().inspectAssistant()?.tasks.find(item => item.profile === profile)?.status, 'succeeded');
  }
  // An explicit ID cannot resolve through a label, even when the owner-bound device has that label.
  devices[0] = {...display, label: 'id:foreign'};
  readTarget = 'id:foreign';
  await ask(`Set id:${target} brightness to 37%`);
  assert.equal(lookup.at(-1), '{"devices":[]}');
  readTarget = `id:${target}`;
  readOwner = 'bunny/modules/lifx';
  await ask(`Set id:${target} brightness to 37%`);
  assert.equal(lookup.at(-1), '{"devices":[]}');
  readOwner = 'auto';
  writeOwner = 'bunny/modules/lifx';
  await ask(`Set id:${target} brightness to 37%`);
  assert.match(lookup.at(-1) ?? '', /"id":"fixture-display"/u);
  assert.equal(requests.length, 3);
  writeOwner = owner;
  writeTarget = 'id:foreign';
  await ask(`Set id:${target} brightness to 37%`);
  assert.match(lookup.at(-1) ?? '', /"id":"fixture-display"/u);
  assert.equal(requests.length, 3);
  devices[0] = display;
  readTarget = '';
  writeTarget = undefined;
  active = {...active, repeat: false, wrongAmount: true};
  await ask('Set fixture-display brightness to 37%');
  assert.equal(requests.length, 3);
  active = {...active, id: 'private-other', wrongAmount: false, bypassLookup: true};
  await ask('Set fixture-display brightness to 37%');
  assert.equal(requests.length, 3);
  active = {...active, id: 'unsupported-display', bypassLookup: false};
  await ask('Set unsupported-display brightness to 37%');
  assert.match(lookup.at(-1) ?? '', /"controls":\[\]/u);
  assert.equal(requests.length, 3);
  active = {...active, id: 'shared-a', attempt: false};
  await ask('Set Shared Display brightness to 37%');
  assert.equal(lookup.at(-1), '{"devices":[]}');
  active = {...active, id: target};
  for (const destination of ['private-conversation', 'external-model'] as const) {
    denied = destination;
    await ask('Set fixture-display brightness to 37%');
    assert.equal(lookup.at(-1), '{"devices":[]}');
  }
  denied = undefined;
  active = {...active, attempt: true};
  await ask('What is the currently reported brightness of fixture-display?');
  assert.match(lookup.at(-1) ?? '', /"id":"fixture-display"/u);
  assert.equal(requests.length, 3);
  devices.push({...display, id: 'literal-label', label: `id:${target}`});
  active = {...active, attempt: false};
  for (readTarget of ['', `id:${target}`, target]) {
    await ask(`What is the current brightness of id:${target}?`);
    assert.match(lookup.at(-1) ?? '', /"id":"fixture-display"/u);
    assert.doesNotMatch(lookup.at(-1) ?? '', /literal-label/u);
  }
  for (const destination of ['private-conversation', 'external-model'] as const) {
    denied = destination;
    await ask(`What is the current brightness of id:${target}?`);
    assert.equal(lookup.at(-1), '{"devices":[]}');
  }
  assert.equal(requests.length, 3);
  denied = undefined;
  readTarget = '';
  devices.pop();
  active = {...active, attempt: true};
  devices.push({...unsupported, id: 'unsupported-alias', label: target});
  active = {...active, id: target, bypassLookup: true};
  await ask('Set fixture-display brightness to 37%', 'reachy');
  assert.equal(lookup.at(-1), '{"devices":[]}');
  assert.equal(requests.length, 3);
  const reachy = () => w.module().inspectAssistant()?.tasks.find(item => item.profile === 'reachy');
  for (const response of ['yes', 'other-display', 'maybe fixture-display']) {
    const questionId = reachy()?.questionId;
    assert.equal((await input(w.core, w.module(), response, true, randomUUID(),
      {profile: 'reachy', taskId: reachy()?.taskId, questionId})).status, 'accepted');
    await until(() => requests.length > 3 || reachy()?.status === 'waiting' && reachy()?.questionId !== questionId);
    assert.equal(requests.length, 3);
  }
  const resolve = async () => {
    assert.equal((await input(w.core, w.module(), 'id:fixture-display', true, randomUUID(),
      {profile: 'reachy', taskId: reachy()?.taskId, questionId: reachy()?.questionId})).status, 'accepted');
  };
  staleAtRead = pixooReads + 3;
  await resolve();
  await until(() => reachy()?.status === 'succeeded');
  assert.equal(requests.length, 3, 'the selected ID disappeared after proposal and must not dispatch');
  staleAtRead = Number.POSITIVE_INFINITY;
  devices.push({...display, id: 'supported-alias', label: target});
  await ask('Set fixture-display brightness to 37%', 'reachy');
  assert.equal(reachy()?.status, 'waiting');
  await resolve();
  await until(() => requests.length === 4);
  w.advance(1200);
  await until(() => reachy()?.status === 'succeeded');
  assert.equal(requests[3]?.target, target);
  assert.equal(replayedReceipts, 0);
  const resultId = `${reachy()?.taskId}-result`;
  const result = () => page(w, 'reachy', 'recent').then(value => value.messages.filter(message => message.id === resultId));
  assert.equal((await result()).length, 1);
  const reachyTaskId = reachy()?.taskId ?? assert.fail('Reachy saved the task');
  const requestId = requests[3]?.requestId ?? assert.fail('Reachy saved the receipt');
  const speakResult = () => control(w.core, w.module(), 'speak', reachyTaskId, randomUUID(), {messageId: resultId});
  assert.equal((await speakResult()).status, 'accepted');
  assert.match(spoken.at(-1) ?? '', /brightness request accepted/i);
  const offered = spoken.length;
  for (const destination of ['private-conversation', 'conversation-speech'] as const) {
    deniedReceipt = {destination, requestId};
    assert.equal((await result())[0]?.text === 'The request finished. Details are unavailable.', destination === 'private-conversation');
    const refused = await speakResult();
    assert.equal(refused.status, 'rejected');
    if (refused.status === 'rejected') assert.equal(refused.error.error.code, 'forbidden');
    assert.equal(spoken.length, offered, 'receipt details cannot reach the spoken sink after either grant is revoked');
  }
  deniedReceipt = undefined;
  denied = 'private-conversation';
  assert.deepEqual((await result()).map(message => message.text), ['The request finished. Details are unavailable.']);
  denied = undefined;
  const priorModelCalls = modelCalls;
  await w.restart();
  assert.equal(requests.length, 4, 'startup must not send a second command');
  assert.equal(modelCalls, priorModelCalls, 'startup must not replay the accepted turn to the supervisor');
  assert.equal((await result()).length, 1);
  await ask('Set id:fixture-display brightness to 37%', 'reachy');
  assert.equal(requests.length, 5, 'a literal ID in the original instruction bypasses colliding labels');
  assert.equal(requests[4]?.target, target);
  outcome = 'revoke-after-acceptance';
  await ask('Set id:fixture-display brightness to 37%', 'reachy');
  assert.equal(requests.length, 6);
  assert.equal(reachy()?.status, 'succeeded');
  const privatePage = await page(w, 'reachy', 'recent');
  assert.deepEqual(privatePage.messages.filter(message => message.id === `${reachy()?.taskId}-result`).map(message => message.text),
    ['The request finished. Details are unavailable.']);
  denied = undefined;
  outcome = 'uncertain';
  assert.equal((await input(w.core, w.module(), 'Set id:fixture-display brightness to 37%', false, randomUUID(), {profile: 'reachy'})).status, 'accepted');
  await until(() => reachy()?.status === 'uncertain');
  assert.equal(requests.length, 7);
  const priorUnknown = modelCalls;
  await w.restart();
  assert.equal(requests.length, 7, 'an uncertain write must never be resent');
  assert.equal(modelCalls, priorUnknown, 'startup does not replay an uncertain write');
  const unknownPage = await page(w, 'reachy', 'recent');
  assert.equal(unknownPage.messages.some(message => message.id === `${reachy()?.taskId}-result`), false);
  outcome = 'accepted';
  active = {...active, id: 'shared-a', bypassLookup: true};
  await ask('Set Shared Display brightness to 37%');
  const question = (await page(w)).currentTask?.question;
  assert.equal(question?.kind, 'clarification');
  assert.doesNotMatch(JSON.stringify(question), /shared-a|shared-b/u);
  assert.equal(requests.length, 7);
});

void test('a scoped brightness lookup supports the typed LIFX tool and refuses a cross-owner alias', async context => {
  const lifx = 'bunny/modules/lifx', pixoo = 'bunny/modules/pixoo';
  const exact = light('fixture-lifx', 'Fixture LIFX');
  const requests: AssistantDispatch[] = [], evidence: string[] = [];
  let alias = false, pixooReads = 0, aliasAtRead = Number.POSITIVE_INFINITY;
  let revokeAtRead = Number.POSITIVE_INFINITY;
  const standard = sharing();
  const share = (grant: ShareQuery) => standard(grant) && !(pixooReads >= revokeAtRead &&
    grant.destination === 'private-conversation' && grant.source === 'conversation' && grant.field === 'text' &&
    grant.record?.endsWith('-prompt') === true);
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: (_url, init) => {
    const body = JSON.parse(init.body) as {input: {type?: string; output?: string}[]; tools: {name: string}[]};
    const results = body.input.filter(item => item.type === 'function_call_output');
    assert.deepEqual(body.tools.map(tool => tool.name).sort(), ['ask_owner', 'read_devices', 'set_lifx_brightness']);
    const write = results.length === 1;
    if (write) evidence.push(results[0]?.output ?? '');
    const output = results.length <= 1 ? [{type: 'function_call', id: write ? 'fc_set' : 'fc_read', call_id: write ? 'set' : 'read',
      name: write ? 'set_lifx_brightness' : 'read_devices',
      arguments: JSON.stringify(write ? {device: `id:${exact.id}`, percent: 37} : {target: `id:${exact.id}`, owner: 'auto'})}]
      : [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Synthetic result.', annotations: []}]}];
    return Promise.resolve(new Response(JSON.stringify({status: 'completed', output, usage: {input_tokens: 30, output_tokens: 30}})));
  }});
  const w = await world(context, {provider, share, tools: ['read_devices', 'set_lifx_brightness'],
    devices: owner => owner === lifx ? [exact] : [],
    dispatch: data => {requests.push(data); return Promise.resolve(accepted(data.requestId));}});
  const register = async (source: string, rows: () => DeviceRecord[]) => {
    const participant = w.bus.connect(source);
    context.after(() => participant.close());
    await participant.serveSync(['device'], () => ({revision: 1, states: rows().map(data => ({
      type: 'org.bunny.device.updated', subject: data.id, dataschema: DEVICE_READBACK_SCHEMA, data,
    }))}));
  };
  await register(lifx, () => [exact]);
  await register(pixoo, () => {
    pixooReads += 1;
    return alias || pixooReads >= aliasAtRead ? [{...light('private-alias', exact.id), kind: 'pixoo'}] : [];
  });
  await control(w.core, w.module(), 'enable');
  const prompt = 'Set fixture-lifx brightness to 37%';
  assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
  await until(() => requests.length === 1);
  w.advance(1200);
  await until(() => status(w) === 'succeeded');
  assert.match(evidence[0] ?? '', /"controls":\["set_lifx_brightness"\]/u);
  assert.deepEqual(requests[0]?.data, {percent: 37, expectedConfigurationRevision: exact.configurationRevision, expectedGeneration: exact.generation});
  aliasAtRead = pixooReads + 3;
  const beforeLateAlias = task(w)?.taskId;
  assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
  await until(() => task(w)?.taskId !== beforeLateAlias && status(w) === 'succeeded');
  assert.match(evidence.at(-1) ?? '', /"controls":\["set_lifx_brightness"\]/u);
  assert.equal(requests.length, 1, 'a new alias before dispatch must remain blocked');
  aliasAtRead = Number.POSITIVE_INFINITY;
  revokeAtRead = pixooReads + 3;
  const beforeRevoke = task(w)?.taskId;
  assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
  await until(() => task(w)?.taskId !== beforeRevoke && status(w) === 'succeeded');
  assert.ok(pixooReads >= revokeAtRead);
  assert.equal(requests.length, 1, 'revoking the original message during the final lookup blocks dispatch');
  assert.match(JSON.stringify(await page(w, 'bunny', 'recent')), /No command was sent/u);
  revokeAtRead = Number.POSITIVE_INFINITY;
  alias = true;
  const prior = task(w)?.taskId;
  assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
  await until(() => task(w)?.taskId !== prior && status(w) === 'waiting');
  assert.equal(evidence.at(-1), '{"devices":[]}');
  assert.doesNotMatch(JSON.stringify((await page(w)).currentTask?.question), /private-alias/u);
  assert.equal(requests.length, 1);
});

void test('Claude reads an explicit device ID within its current grants when a label has the same text', async context => {
  const owner = 'bunny/modules/pixoo', id = 'fixture-display';
  const records = [light(id, 'Main display'), light('other-display', `id:${id}`)].map(row => ({...row, kind: 'pixoo' as const}));
  let selector = `id:${id}`, source = owner, denied = false;
  const selections: string[] = [];
  const provider = new AnthropicProvider({key: 'fake', transport: (_url, init) => {
    const body = JSON.parse(init.body) as {messages: {content: {type: string; content?: string}[]}[]};
    const result = body.messages.flatMap(message => message.content).find(block => block.type === 'tool_result');
    if (result?.content !== undefined) selections.push(result.content);
    return Promise.resolve(Response.json({content: result === undefined
      ? [{type: 'tool_use', id: 'read', name: 'read_devices', input: {owner: source, target: selector}}]
      : [{type: 'text', text: 'The lookup is complete.'}],
    stop_reason: result === undefined ? 'tool_use' : 'end_turn', usage: {input_tokens: 20, output_tokens: 20}}));
  }});
  const standard = sharing();
  const w = await world(context, {provider, tools: ['read_devices', 'control_brightness_set'],
    share: query => standard(query) && !(denied && query.destination === 'external-model' && query.source === 'devices' &&
      query.field === 'status' && query.record === id),
    dispatch: () => assert.fail('A catalog read must not send a command')});
  const pixoo = w.bus.connect(owner);
  context.after(() => pixoo.close());
  await pixoo.serveSync(['device'], () => ({revision: 1, states: records.map(data => ({
    type: 'org.bunny.device.updated', subject: data.id, dataschema: DEVICE_READBACK_SCHEMA, data,
  }))}));
  await control(w.core, w.module(), 'enable');
  const ask = async (prompt: string) => {
    const prior = task(w)?.taskId;
    const before = selections.length;
    assert.equal((await input(w.core, w.module(), prompt)).status, 'accepted');
    await until(() => task(w)?.taskId !== prior && status(w) === 'succeeded');
    assert.equal(selections.length, before + 1);
    const result = JSON.parse(selections[before] ?? '') as {devices: {id: string; owner: string}[]};
    return result.devices.map(device => [device.owner, device.id]);
  };
  assert.deepEqual(await ask(`Set id:${id} brightness to 37%`), [[owner, id]]);
  source = 'auto';
  assert.deepEqual(await ask(`What is the current brightness of id:${id}?`), [[owner, id]]);
  denied = true;
  assert.deepEqual(await ask(`Check the reported brightness of id:${id}.`), []);
  denied = false;
  source = 'bunny/modules/lifx';
  assert.deepEqual(await ask(`Check the status of id:${id}.`), []);
  source = owner;
  selector = id;
  assert.deepEqual(await ask('Check Main display status.'), [[owner, id]]);
});
