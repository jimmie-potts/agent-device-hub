// The companions section (Hub #46): synthetic by default, a hosted provider only with its key secret, and an allowlist
// of permitted tool names. A configured hosted provider reaches the API through the module's transport with the key
// read from the section's secret file, which never reaches public state or the module's records.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {API_KEY_SECRET, configureCompanions, createCompanionsModule} from '../src/module.js';
import type {Transport} from '../src/assistant/anthropic.js';

// Synthetic prices: the shape the private section takes, not a price list.
const PRICES = {'claude-opus-5-5': {input: 1, output: 2, cacheWrite: 1.5, cacheRead: 0.1}, 'claude-sonnet-5-5': {input: 0.5, output: 1, cacheWrite: 0.75, cacheRead: 0.05}};
const configured = (section: unknown) => {const result = configureCompanions(section); return 'error' in result ? result.error.code : result.config;};

void test('the section accepts the synthetic default and a keyed hosted provider, and refuses everything else', () => {
  assert.deepEqual(configured({}), {assistant: {provider: 'synthetic', tools: []}});
  assert.deepEqual(configured({assistant: {tools: ['set_mode', 'read_sessions']}}), {assistant: {provider: 'synthetic', tools: ['set_mode', 'read_sessions']}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', tools: ['read_sessions'], prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', tools: ['read_sessions'], prices: PRICES}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}),
    {assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', tools: [], prices: PRICES}});
  const key = {[API_KEY_SECRET]: '/run/secrets/bunny/k'}, opus = PRICES['claude-opus-5-5'];
  // Prices are optional (Hub #2024 review): a section without them, or without the hosted model's entry, still starts the
  // module, and the engine refuses that model's paid turns and calls.
  assert.deepEqual(configured({assistant: {provider: 'anthropic'}, secrets: key}), {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', tools: [], prices: {}}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', prices: {'claude-sonnet-5-5': PRICES['claude-sonnet-5-5']}}, secrets: key}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', tools: [], prices: {'claude-sonnet-5-5': PRICES['claude-sonnet-5-5']}}});
  for (const section of [
    [], {other: true}, {assistant: null}, {assistant: {provider: 'openai'}}, {assistant: {provider: 'anthropic'}}, {assistant: {provider: 'anthropic'}, secrets: {}},
    {assistant: {tools: ['ask_owner']}}, {assistant: {tools: ['read_fixture']}}, {assistant: {tools: ['set_mode', 'set_mode']}}, {assistant: {tools: 'set_mode'}},
    {assistant: {model: 'x'}}, {assistant: {provider: 'anthropic', model: 'Bad Model'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}},
    {assistant: {provider: 'anthropic', effort: 'max', prices: PRICES}, secrets: key}, {assistant: {provider: 'anthropic', extra: 1, prices: PRICES}, secrets: key},
    // Prices that are present are checked: all four classes in range for at most 16 models (Hub #2024); the synthetic provider takes none.
    {assistant: {provider: 'anthropic', prices: []}, secrets: key}, {assistant: {provider: 'anthropic', prices: null}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, cacheRead: undefined}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, extra: 1}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, output: -1}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, input: '4'}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, input: 1001}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {...PRICES, 'Bad Model': opus}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: Object.fromEntries(Array.from({length: 17}, (_, index) => [`model-${String(index)}`, opus]))}, secrets: key},
    {assistant: {prices: PRICES}},
  ]) assert.equal(configured(section), 'invalid-request', JSON.stringify(section));
});

void test('a configured hosted provider uses the secret key through the transport and exposes only provider, model and tools', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-configured-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const headers: Record<string, string>[] = [];
  const transport: Transport = (_url, init) => {headers.push(init.headers); return Promise.resolve(new Response(JSON.stringify({content: [{type: 'text', text: 'Hello.'}], stop_reason: 'end_turn', usage: {input_tokens: 3, output_tokens: 2}}), {status: 200}));};
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic', tools: ['set_mode'], prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY\n'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const state = module.inspectAssistant(); assert.ok(state);
  assert.deepEqual([state.provider, state.model, state.tools], ['anthropic', 'claude-opus-5-5', ['set_mode']]);
  const requestId = 'configured-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: state.revision}}, {requestId, timeoutMs: 5000})).status, 'accepted');
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: 'configured-start', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, text: 'Hi'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  assert.equal((await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: 'configured-start', ...staged.data}}, {requestId: 'configured-start', timeoutMs: 5000})).status, 'accepted');
  for (let n = 0; n < 100 && module.inspectAssistant()?.tasks[0]?.status !== 'succeeded'; n += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(module.inspectAssistant()?.tasks[0]?.status, 'succeeded');
  assert.equal(module.inspectAssistant()?.tasks[0]?.usageUnits, 5);
  // The section's prices count the reported usage toward the shared spend limits: 3 input and 2 output tokens at $1 and $2 per million.
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  const {day} = JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {spentMicros: number; unreported: number}};
  assert.deepEqual([day.spentMicros, day.unreported], [7, 0]);
  // The secret reader trims the file's trailing newline; the adapter sends the key as read.
  assert.deepEqual(headers.map(header => header['x-api-key']), ['sk-PRIVATE-TEST-KEY']);
  assert.equal(JSON.stringify([module.inspectAssistant(), host.logs, host.moduleDatabase()?.prepare('SELECT record FROM assistant_tasks').all()]).includes('PRIVATE-TEST-KEY'), false);
});

void test('a hosted section without prices starts the module, and a paid turn is refused naming the missing price before any request', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-unpriced-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let sent = 0;
  const transport: Transport = () => {sent += 1; return Promise.resolve(new Response('{}', {status: 500}));};
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const state = module.inspectAssistant(); assert.ok(state); assert.equal(state.available, true);
  assert.ok(module.inspect() !== undefined, 'the rest of the module runs: Reachy state is served');
  const enable = 'unpriced-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId: enable, action: 'enable', expectedRevision: state.revision}}, {requestId: enable, timeoutMs: 5000})).status, 'accepted');
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: 'unpriced-start', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, text: 'Hi'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const refused = await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: 'unpriced-start', ...staged.data}}, {requestId: 'unpriced-start', timeoutMs: 5000});
  assert.ok(refused.status === 'rejected');
  assert.deepEqual([refused.error.error.code, refused.error.error.detail], ['capacity', 'No price is configured for the model claude-opus-5-5, so its spend cannot be counted. Nothing was sent.']);
  assert.equal(sent, 0);
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  assert.deepEqual((JSON.parse(Buffer.from(spend.bytes).toString()) as {paid: unknown}).paid, {model: 'claude-opus-5-5', minimumMicros: null});
});

void test('a hosted model named after an inherited member is unpriced and its paid turn is refused naming the missing price', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-inherited-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let sent = 0;
  const transport: Transport = () => {sent += 1; return Promise.resolve(new Response('{}', {status: 500}));};
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic', model: 'constructor', prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const state = module.inspectAssistant(); assert.ok(state);
  const enable = 'inherited-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId: enable, action: 'enable', expectedRevision: state.revision}}, {requestId: enable, timeoutMs: 5000})).status, 'accepted');
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: 'inherited-start', signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, text: 'Hi'}))});
  assert.ok(staged !== undefined && !('error' in staged));
  const refused = await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: 'inherited-start', ...staged.data}}, {requestId: 'inherited-start', timeoutMs: 5000});
  assert.ok(refused.status === 'rejected');
  assert.deepEqual([refused.error.error.code, refused.error.error.detail], ['capacity', 'No price is configured for the model constructor, so its spend cannot be counted. Nothing was sent.']);
  assert.equal(sent, 0);
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  assert.deepEqual((JSON.parse(Buffer.from(spend.bytes).toString()) as {paid: unknown}).paid, {model: 'constructor', minimumMicros: null});
});
