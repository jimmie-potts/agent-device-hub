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
const PRICES = {'claude-opus-5-5': {input: 1, output: 2, cacheWrite: 1.5, cacheRead: 0.1}, 'claude-sonnet-5-5': {input: 0.5, output: 1, cacheWrite: 0.75, cacheRead: 0.05},
  'claude-haiku-5-5': {input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01}};
const configured = (section: unknown) => {const result = configureCompanions(section); return 'error' in result ? result.error.code : result.config;};

void test('the section accepts the synthetic default and a keyed hosted provider, and refuses everything else', () => {
  assert.deepEqual(configured({}), {assistant: {provider: 'synthetic', tools: []}});
  assert.deepEqual(configured({assistant: {tools: ['set_mode', 'read_sessions']}}), {assistant: {provider: 'synthetic', tools: ['set_mode', 'read_sessions']}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', tools: ['read_sessions'], prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', titleModel: 'claude-haiku-5-5', tools: ['read_sessions'], prices: PRICES}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', titleModel: 'claude-sonnet-5-5', prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}),
    {assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', titleModel: 'claude-sonnet-5-5', tools: [], prices: PRICES}}, 'the title model is configurable (Hub #2025)');
  const key = {[API_KEY_SECRET]: '/run/secrets/bunny/k'}, opus = PRICES['claude-opus-5-5'];
  for (const section of [
    [], {other: true}, {assistant: null}, {assistant: {provider: 'openai'}}, {assistant: {provider: 'anthropic'}}, {assistant: {provider: 'anthropic'}, secrets: {}},
    {assistant: {tools: ['ask_owner']}}, {assistant: {tools: ['read_fixture']}}, {assistant: {tools: ['set_mode', 'set_mode']}}, {assistant: {tools: 'set_mode'}},
    {assistant: {model: 'x'}}, {assistant: {provider: 'anthropic', model: 'Bad Model'}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}},
    {assistant: {provider: 'anthropic', effort: 'max', prices: PRICES}, secrets: key}, {assistant: {provider: 'anthropic', extra: 1, prices: PRICES}, secrets: key},
    // A hosted provider needs prices for its own model, each with all four classes in range (Hub #2024); the synthetic one takes none.
    {assistant: {provider: 'anthropic'}, secrets: key}, {assistant: {provider: 'anthropic', prices: {'claude-sonnet-5-5': PRICES['claude-sonnet-5-5']}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, cacheRead: undefined}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, extra: 1}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, output: -1}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, input: '4'}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': {...opus, input: 1001}}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: {...PRICES, 'Bad Model': opus}}, secrets: key},
    {assistant: {provider: 'anthropic', prices: Object.fromEntries(Array.from({length: 17}, (_, index) => [`model-${String(index)}`, opus]))}, secrets: key},
    {assistant: {prices: PRICES}},
    {assistant: {provider: 'anthropic', titleModel: 'Bad Model', prices: PRICES}, secrets: key}, {assistant: {provider: 'anthropic', titleModel: 5, prices: PRICES}, secrets: key},
    {assistant: {titleModel: 'claude-haiku-5-5'}},
    // The title model is priced too (Hub #2025).
    {assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': opus}}, secrets: key},
  ]) assert.equal(configured(section), 'invalid-request', JSON.stringify(section));
});

void test('a configured hosted provider uses the secret key through the transport and exposes only provider, model and tools', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-configured-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const headers: Record<string, string>[] = [], models: unknown[] = [];
  let titled: () => void = () => {};
  const title = new Promise<void>(resolve => {titled = resolve;});
  const transport: Transport = (_url, init) => {
    headers.push(init.headers); models.push((JSON.parse(init.body) as {model: unknown}).model);
    if (models.includes('claude-haiku-5-5')) titled();
    return Promise.resolve(new Response(JSON.stringify({content: [{type: 'text', text: 'Hello.'}], stop_reason: 'end_turn', usage: {input_tokens: 3, output_tokens: 2}}), {status: 200}));};
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
  // The conversation's title call (Hub #2025) goes through the same transport and key with the default title model.
  await title;
  assert.deepEqual([...models].sort(), ['claude-haiku-5-5', 'claude-opus-5-5']);
  const settled = () => host.moduleDatabase()?.prepare("SELECT 1 FROM assistant_title_calls WHERE json_extract(record,'$.status')='admitted'").get() === undefined;
  for (let turn = 0; turn < 1000 && !settled(); turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  // The section's prices count the reported usage toward the shared spend limits: 3 input and 2 output tokens at $1 and $2
  // per million for the task's call, and at $0.10 and $0.50 for the title call, each rounded up to a millionth of a dollar.
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  const {day} = JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {spentMicros: number; unreported: number}};
  assert.deepEqual([day.spentMicros, day.unreported], [9, 0]);
  // The secret reader trims the file's trailing newline; the adapter sends the key as read.
  assert.deepEqual(headers.map(header => header['x-api-key']), ['sk-PRIVATE-TEST-KEY', 'sk-PRIVATE-TEST-KEY']);
  assert.equal(JSON.stringify([module.inspectAssistant(), host.logs, host.moduleDatabase()?.prepare('SELECT record FROM assistant_tasks').all()]).includes('PRIVATE-TEST-KEY'), false);
});
