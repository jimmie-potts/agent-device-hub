// The companions section (Hub #46): synthetic by default, a hosted provider only with its key secret, and an allowlist
// of permitted tool names. A configured hosted provider reaches the API through the module's transport with the key
// read from the section's secret file, which never reaches public state or the module's records.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {API_KEY_SECRET, configureCompanions, createCompanionsModule} from '../src/module.js';
import {SPEND_LIMIT_REACHED, type Transport} from '../src/assistant/anthropic.js';
import {PROFILES} from '../src/knowledge/model.js';

// Synthetic prices: the shape the private section takes, not a price list.
const PRICES = {'claude-opus-5-5': {input: 1, output: 2, cacheWrite: 1.5, cacheRead: 0.1}, 'claude-sonnet-5-5': {input: 0.5, output: 1, cacheWrite: 0.75, cacheRead: 0.05},
  'claude-haiku-5-5': {input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01}};
const configured = (section: unknown) => {const result = configureCompanions(section); return 'error' in result ? result.error.code : result.config;};

void test('the section accepts the synthetic default and a keyed hosted provider, and refuses everything else', () => {
  assert.deepEqual(configured({}), {assistant: {provider: 'synthetic', tools: []}});
  assert.deepEqual(configured({assistant: {tools: ['set_mode', 'read_sessions']}}), {assistant: {provider: 'synthetic', tools: ['set_mode', 'read_sessions']}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', tools: ['read_sessions'], prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', titleModel: 'claude-haiku-5-5', tools: ['read_sessions'], prices: PRICES}});
  // A section without a price for the title model is accepted: the ledger prices it at its built-in tiers, or a model the table
  // does not know at the dearest known rate (Hub #2047).
  assert.deepEqual(configured({assistant: {provider: 'anthropic', prices: {'claude-opus-5-5': PRICES['claude-opus-5-5']}}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', titleModel: 'claude-haiku-5-5', tools: [], prices: {'claude-opus-5-5': PRICES['claude-opus-5-5']}}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', titleModel: 'claude-sonnet-5-5', prices: PRICES}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/k'}}),
    {assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', effort: 'low', titleModel: 'claude-sonnet-5-5', tools: [], prices: PRICES}}, 'the title model is configurable (Hub #2025)');
  const key = {[API_KEY_SECRET]: '/run/secrets/bunny/k'}, opus = PRICES['claude-opus-5-5'];
  // Prices are optional (Hub #2024 review): a section without them, or without the hosted model's entry, still starts the
  // module, and the engine refuses that model's paid turns and calls.
  assert.deepEqual(configured({assistant: {provider: 'anthropic'}, secrets: key}), {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', titleModel: 'claude-haiku-5-5', tools: [], prices: {}}});
  assert.deepEqual(configured({assistant: {provider: 'anthropic', prices: {'claude-sonnet-5-5': PRICES['claude-sonnet-5-5']}}, secrets: key}),
    {assistant: {provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium', titleModel: 'claude-haiku-5-5', tools: [], prices: {'claude-sonnet-5-5': PRICES['claude-sonnet-5-5']}}});
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
    {assistant: {provider: 'anthropic', titleModel: 'Bad Model', prices: PRICES}, secrets: key}, {assistant: {provider: 'anthropic', titleModel: 5, prices: PRICES}, secrets: key},
    {assistant: {titleModel: 'claude-haiku-5-5'}},
  ]) assert.equal(configured(section), 'invalid-request', JSON.stringify(section));
});

void test('a configured hosted provider uses the secret key through the transport and exposes only provider, model and tools', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-configured-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const headers: Record<string, string>[] = [], models: unknown[] = [];
  const transport: Transport = (_url, init) => {
    headers.push(init.headers); models.push((JSON.parse(init.body) as {model: unknown}).model);
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
  // The conversation's title checks (Hub #2025, #2075), after the first message and after the finished task, go through
  // the same transport and key with the default title model.
  const settled = () => models.filter(model => model === 'claude-haiku-5-5').length === 2 &&
    host.moduleDatabase()?.prepare("SELECT 1 FROM assistant_title_calls WHERE json_extract(record,'$.status')='admitted'").get() === undefined;
  for (let turn = 0; turn < 2000 && !settled(); turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.deepEqual([...models].sort(), ['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
  // The section's prices count the reported usage toward the shared spend limits: 3 input and 2 output tokens at $1 and $2
  // per million for the task's call, and at $0.10 and $0.50 for each title call, each rounded up to a millionth of a dollar.
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  const {day} = JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {spentMicros: number; unreported: number}};
  assert.deepEqual([day.spentMicros, day.unreported], [7 + 2 + 2, 0]);
  // The secret reader trims the file's trailing newline; the adapter sends the key as read.
  assert.deepEqual(headers.map(header => header['x-api-key']), ['sk-PRIVATE-TEST-KEY', 'sk-PRIVATE-TEST-KEY', 'sk-PRIVATE-TEST-KEY']);
  assert.equal(JSON.stringify([module.inspectAssistant(), host.logs, host.moduleDatabase()?.prepare('SELECT record FROM assistant_tasks').all()]).includes('PRIVATE-TEST-KEY'), false);
});

/** A hosted companions module with no configured prices, its transport answering each request from `answer`. */
async function hosted(context: TestContext, assistant: Record<string, unknown>, answer: () => Response) {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-hosted-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  // Turn and title requests share the transport; each is counted by the model it names.
  const sent: string[] = [];
  const transport: Transport = (_url, init) => {sent.push(String((JSON.parse(init.body) as {model: unknown}).model)); return Promise.resolve(answer());};
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic', ...assistant}, secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const control = async (requestId: string) => core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: module.inspectAssistant()?.revision}}, {requestId, timeoutMs: 5000});
  assert.equal((await control('hosted-enable')).status, 'accepted');
  const start = async (text: string) => {
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: 'hosted-start', signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, text}))});
    assert.ok(staged !== undefined && !('error' in staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: 'hosted-start', ...staged.data}}, {requestId: 'hosted-start', timeoutMs: 5000});
  };
  const read = async (ref: string, query: Record<string, string>) => {
    const content = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    assert.ok(content !== undefined && !('error' in content));
    return JSON.parse(Buffer.from(content.bytes).toString()) as unknown;
  };
  // Waits for the task's own messages to settle it; the bound only turns a missing settlement into a clear failure.
  const settled = async () => {
    for (let n = 0; n < 100 && !['succeeded', 'failed'].includes(module.inspectAssistant()?.tasks[0]?.status ?? ''); n += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const task = module.inspectAssistant()?.tasks[0];
    if (task === undefined || !['succeeded', 'failed'].includes(task.status)) assert.fail(`the hosted task did not settle: ${task?.status ?? 'no task'}`);
    return task;
  };
  const turnModel = typeof assistant.model === 'string' ? assistant.model : 'claude-opus-5-5';
  const titleCalls = () => sent.filter(model => model === 'claude-haiku-5-5').length;
  /** Waits, in event-loop turns, until `count` title requests were sent and none is still waiting for its answer. */
  const titlesSettled = async (count: number) => {
    const open = () => host.moduleDatabase()?.prepare("SELECT 1 FROM assistant_title_calls WHERE json_extract(record,'$.status')='admitted'").get() !== undefined;
    for (let turn = 0; turn < 2000 && (titleCalls() < count || open()); turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  };
  return {module, sent: () => sent.filter(model => model === turnModel).length, titleCalls, titlesSettled, start, settled,
    spend: async () => await read('spend', {}) as {day: {spentMicros: number}; paid: unknown},
    said: async () => (await read('conversation', {profile: 'bunny'}) as {messages: {text: string}[]}).messages.map(message => message.text)};
}
const answered = () => new Response(JSON.stringify({content: [{type: 'text', text: 'Hello.'}], stop_reason: 'end_turn', usage: {input_tokens: 3, output_tokens: 2}}), {status: 200});

void test('without configured prices a hosted turn runs at the dated built-in price and counts its usage', async context => {
  const w = await hosted(context, {}, answered);
  assert.equal(w.module.inspectAssistant()?.available, true);
  assert.equal((await w.start('Hi')).status, 'accepted');
  assert.equal((await w.settled())?.status, 'succeeded');
  // 3 input and 2 output tokens at the built-in $4 and $20 per million for claude-opus-5-5, and the conversation's two title
  // checks, after the first message and after the finished task, on claude-haiku-5-5 at its built-in lower tier, $0.10 and $0.50.
  await w.titlesSettled(2);
  const spend = await w.spend();
  assert.equal(w.titleCalls(), 2);
  assert.deepEqual([spend.day.spentMicros, spend.paid], [3 * 4 + 2 * 20 + 2 * Math.ceil(3 * 0.1 + 2 * 0.5), {model: 'claude-opus-5-5', minimumMicros: 8192 * 5 + 16_384 * 20, prices: 'built-in', pricesAsOf: '2026-11-22'}]);
});

void test('a model the built-in table does not know, even one named after an inherited member, is priced at the dearest known rate', async context => {
  const w = await hosted(context, {model: 'constructor'}, answered);
  assert.equal((await w.start('Hi')).status, 'accepted');
  assert.equal((await w.settled())?.status, 'succeeded');
  await w.titlesSettled(2);
  const spend = await w.spend();
  assert.deepEqual([spend.day.spentMicros, (spend.paid as {prices: string}).prices], [3 * 4 + 2 * 20 + 2 * Math.ceil(3 * 0.1 + 2 * 0.5), 'dearest'], 'the turn at the dearest rate, the titles at Haiku\'s');
});

void test('an Anthropic spend-limit refusal ends the turn capacity, names the monthly limit in the conversation and sends nothing more', async context => {
  const refusal = (status: number, error: Record<string, unknown>) => () => new Response(JSON.stringify({type: 'error', error, request_id: 'req_synthetic'}), {status});
  for (const answer of [
    refusal(400, {type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'}),
    refusal(400, {type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'}),
    refusal(429, {type: 'rate_limit_error', message: 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold.', details: {error_code: 'enforced_spend_limit_reached'}}),
  ]) {
    const w = await hosted(context, {}, answer);
    assert.equal((await w.start('Hi')).status, 'accepted');
    const task = await w.settled();
    assert.deepEqual([task?.status, task?.code, w.sent()], ['failed', 'capacity', 1], 'one turn request, no retry');
    assert.ok(w.titleCalls() <= 2, 'at most one title request for each of the two checks, which keep the persona');
    assert.ok((await w.said()).at(-1)?.endsWith(SPEND_LIMIT_REACHED) === true, 'the closing reply names the monthly limit');
  }
  // Another 400 or 429 keeps its own code and adds no spend-limit message.
  for (const [answer, code] of [
    [refusal(400, {type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty'}), 'invalid-request'],
    [refusal(429, {type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit', details: {error_code: 'ramp_limit_exceeded'}}), 'capacity'],
  ] as const) {
    const w = await hosted(context, {}, answer);
    await w.start('Hi');
    assert.deepEqual([(await w.settled())?.code, w.sent()], [code, 1]);
    assert.equal((await w.said()).some(text => text.includes(SPEND_LIMIT_REACHED)), false);
  }
});

/** Waits in event-loop turns, never on a clock, until `check` holds. */
async function turnsUntil(check: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 5000 && !check(); turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.ok(check(), what);
}
void test('a section that names only B.U.N.N.Y.\'s model gives Reachy and MicroDuck that model, their personas, prompt caching, titles and the shared spend', async context => {
  // An installation configured before Hub #2026 names one provider, model and key; after the upgrade the same section
  // serves every profile, so nothing in it changes.
  const dir = await mkdtemp(join(tmpdir(), 'assistant-companions-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const sent: {model: string; system: unknown; cache: unknown; prompt: string}[] = [];
  const transport: Transport = (_url, init) => {
    const body = JSON.parse(init.body) as {model: string; system: unknown; cache_control?: unknown; messages: {content: {text?: string}[]}[]};
    const prompt = body.messages.flatMap(message => message.content.map(block => block.text ?? '')).join('\n');
    sent.push({model: body.model, system: body.system, cache: body.cache_control, prompt});
    // A title request answers a title for the conversation it reads; a turn request answers in the persona's words.
    const text = body.model === 'claude-haiku-5-5' ? prompt.includes('pantry') ? 'Pantry shelf labels' : 'Bath timer' : 'Synthetic companion answer.';
    return Promise.resolve(new Response(JSON.stringify({content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 3, output_tokens: 2}}), {status: 200}));
  };
  const module = createCompanionsModule({transport});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'anthropic', model: 'claude-sonnet-5-5', prices: PRICES},
    secrets: {[API_KEY_SECRET]: '/run/secrets/bunny/anthropic-api-key'}}, secrets: {[API_KEY_SECRET]: 'sk-PRIVATE-TEST-KEY'}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  const requestId = 'companions-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: module.inspectAssistant()?.revision}}, {requestId, timeoutMs: 5000})).status, 'accepted');
  const open = () => host.moduleDatabase()?.prepare("SELECT 1 FROM assistant_title_calls WHERE json_extract(record,'$.status')='admitted'").get() !== undefined;
  for (const [profile, text] of [['reachy', 'Help me label the pantry shelf.'], ['microduck', 'Time the bath for me.']] as const) {
    const id = `companions-${profile}`;
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: id, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'start', profile, expectedRevision: module.inspectAssistant()?.revision, text}))});
    assert.ok(staged !== undefined && !('error' in staged));
    assert.equal((await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: id, ...staged.data}}, {requestId: id, timeoutMs: 5000})).status, 'accepted');
    await turnsUntil(() => module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.status === 'succeeded', `${profile} succeeded`);
    // Each conversation is titled after its first message and checked again after its finished task.
    await turnsUntil(() => sent.filter(request => request.model === 'claude-haiku-5-5').length >= (profile === 'reachy' ? 2 : 4) && !open(), `${profile} titles settled`);
  }
  const turns = sent.filter(request => request.model !== 'claude-haiku-5-5'), titles = sent.filter(request => request.model === 'claude-haiku-5-5');
  assert.deepEqual(turns.map(request => request.model), ['claude-sonnet-5-5', 'claude-sonnet-5-5'], 'both companions use the configured model');
  assert.equal(titles.length, 4, 'two title checks for each conversation, on the configured title model');
  for (const [index, name] of ['Reachy', 'MicroDuck'].entries()) {
    const persona = PROFILES.find(value => value.name === name) ?? assert.fail(name);
    assert.ok(String(turns[index]?.system).includes(`You are ${name}, the owner's home assistant. ${persona.character}`), `${name}'s curated persona`);
    assert.deepEqual(turns[index]?.cache, {type: 'ephemeral'}, `${name}'s request asks for prompt caching`);
  }
  const record = (profile: string) => {
    const conversation = module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.conversationId;
    return (host.moduleDatabase()?.prepare('SELECT record FROM assistant_titles WHERE conversation_id=?').get(String(conversation)) as {record: string} | undefined)?.record;
  };
  assert.match(record('reachy') ?? '', /"value":"Pantry shelf labels"/);
  assert.match(record('microduck') ?? '', /"value":"Bath timer"/);
  // Every companion turn and title check counts in the shared spend ledger at the section's prices: 3 input and 2 output
  // tokens at $0.50 and $1 per million for each turn on claude-sonnet-5-5, and at $0.10 and $0.50 for each title check.
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  const {day} = JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {spentMicros: number; unreported: number}};
  assert.deepEqual([day.spentMicros, day.unreported], [2 * Math.ceil(3 * 0.5 + 2 * 1) + 4 * Math.ceil(3 * 0.1 + 2 * 0.5), 0]);
  assert.deepEqual([module.inspectAssistant()?.provider, module.inspectAssistant()?.model], ['anthropic', 'claude-sonnet-5-5']);
});

void test('an explicit synthetic provider serves every profile without a request', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'assistant-synthetic-')), bus = new InProcessBus(), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  let requests = 0;
  const module = createCompanionsModule({transport: () => {requests += 1; return Promise.reject(new Error('no request expected'));}});
  const host = new ModuleHarness(module, {bus, stateDir: dir, section: {assistant: {provider: 'synthetic'}}});
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  await host.start();
  assert.equal(module.inspectAssistant()?.provider, 'synthetic');
  const requestId = 'synthetic-enable';
  assert.equal((await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: module.inspectAssistant()?.revision}}, {requestId, timeoutMs: 5000})).status, 'accepted');
  for (const profile of ['bunny', 'reachy', 'microduck'] as const) {
    const id = `synthetic-${profile}`;
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: id, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'start', profile, expectedRevision: module.inspectAssistant()?.revision, text: 'Synthetic request'}))});
    assert.ok(staged !== undefined && !('error' in staged));
    assert.equal((await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId: id, ...staged.data}}, {requestId: id, timeoutMs: 5000})).status, 'accepted');
    // The synthetic script asks its fixed question first.
    await turnsUntil(() => module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.status === 'waiting', `${profile} waits on the synthetic question`);
  }
  assert.equal(requests, 0, 'nothing leaves the module');
  const spend = await module.manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(spend !== undefined && !('error' in spend));
  assert.equal((JSON.parse(Buffer.from(spend.bytes).toString()) as {day: {spentMicros: number}}).day.spentMicros, 0);
});
