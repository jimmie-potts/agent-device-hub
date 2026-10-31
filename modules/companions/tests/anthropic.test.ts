// The Anthropic adapter behind the turn contract (Hub #46), against a fake transport: exact request shape, parsing of
// text and tool-use answers, usage, refusal and truncation stops, error mapping and abort. No network, no key in a log.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ANTHROPIC_URL, ANTHROPIC_VERSION, AnthropicProvider, MAX_TOKENS, toMessages, type Transport} from '../src/assistant/anthropic.js';
import {ProviderFault, type TurnInput} from '../src/assistant/provider.js';
import {permittedTools} from '../src/assistant/tools.js';

type Sent = {url: string; init: Parameters<Transport>[1]};
function fake(answer: (sent: Sent) => Response | Promise<Response>): {transport: Transport; sent: Sent[]} {
  const sent: Sent[] = [];
  return {sent, transport: (url, init) => {const record = {url, init}; sent.push(record); return Promise.resolve(answer(record));}};
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
const usage = {input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0};
const input: TurnInput = {instructions: 'Instructions', tools: permittedTools(['read_sessions', 'set_mode'], false), mode: {mode: 'work', revision: 4},
  transcript: [{role: 'owner', text: 'PRIVATE-OWNER-TEXT'}, {role: 'assistant', text: 'Checking.', calls: [{id: 'toolu_1', name: 'read_sessions', input: {}}]}, {role: 'tool', call: 'toolu_1', name: 'read_sessions', result: 'No session.', ok: true}]};
const signal = () => new AbortController().signal;

void test('a turn sends one versioned, keyed request with strict tools, medium effort and the transcript as API turns', async () => {
  const {transport, sent} = fake(() => json({content: [{type: 'text', text: 'All quiet.'}], stop_reason: 'end_turn', usage}));
  const provider = new AnthropicProvider({key: 'sk-PRIVATE-KEY', transport});
  const reply = await provider.turn(input, signal());
  assert.deepEqual(reply, {text: 'All quiet.', calls: [], stop: 'end', units: 150, blocks: [{type: 'text', text: 'All quiet.'}]});
  assert.equal(sent[0]?.init.redirect, 'error');
  assert.equal(sent.length, 1); assert.equal(sent[0]?.url, ANTHROPIC_URL);
  assert.deepEqual(sent[0]?.init.headers, {'content-type': 'application/json', 'x-api-key': 'sk-PRIVATE-KEY', 'anthropic-version': ANTHROPIC_VERSION});
  const body = JSON.parse(sent[0]?.init.body ?? '{}') as Record<string, unknown>;
  assert.equal(body.model, 'claude-opus-5-5'); assert.equal(body.max_tokens, MAX_TOKENS); assert.deepEqual(body.output_config, {effort: 'medium'}); assert.equal(body.thinking, undefined);
  assert.match(String(body.system), /^Instructions /);
  assert.deepEqual(body.tool_choice, {type: 'auto', disable_parallel_tool_use: true});
  assert.deepEqual((body.tools as {name: string; strict: boolean; input_schema: {additionalProperties: boolean}}[]).map(tool => [tool.name, tool.strict, tool.input_schema.additionalProperties]),
    [['ask_owner', true, false], ['read_sessions', true, false], ['set_mode', true, false]]);
  assert.match(String(body.system), /Hub mode is work/);
  assert.deepEqual(body.messages, toMessages(input.transcript));
  assert.deepEqual(toMessages(input.transcript), [
    {role: 'user', content: [{type: 'text', text: 'PRIVATE-OWNER-TEXT'}]},
    {role: 'assistant', content: [{type: 'text', text: 'Checking.'}, {type: 'tool_use', id: 'toolu_1', name: 'read_sessions', input: {}}]},
    {role: 'user', content: [{type: 'tool_result', tool_use_id: 'toolu_1', content: 'No session.'}]},
  ]);
  // An assistant item that kept the model's blocks replays them unchanged, thinking block and signature included.
  const blocks = [{type: 'thinking', thinking: '', signature: 'sig-PRIVATE'}, {type: 'text', text: 'Checking.'}, {type: 'tool_use', id: 'toolu_1', name: 'read_sessions', input: {}}];
  assert.deepEqual(toMessages([{role: 'owner', text: 'Hi'}, {role: 'assistant', text: 'Checking.', calls: [{id: 'toolu_1', name: 'read_sessions', input: {}}], blocks}, {role: 'tool', call: 'toolu_1', name: 'read_sessions', result: 'None.', ok: false}]),
    [{role: 'user', content: [{type: 'text', text: 'Hi'}]}, {role: 'assistant', content: blocks}, {role: 'user', content: [{type: 'tool_result', tool_use_id: 'toolu_1', content: 'None.', is_error: true}]}]);
  const custom = new AnthropicProvider({key: 'k', model: 'claude-sonnet-5-5', effort: 'low', transport, url: 'https://example.invalid/v1/messages'});
  await custom.turn(input, signal());
  assert.equal(sent[1]?.url, 'https://example.invalid/v1/messages'); assert.equal((JSON.parse(sent[1]?.init.body ?? '{}') as {model: string}).model, 'claude-sonnet-5-5');
  assert.equal(custom.name, 'anthropic'); assert.equal(custom.model, 'claude-sonnet-5-5');
});

void test('tool-use answers carry the calls, refusals and truncation stop the turn, and unknown usage stays unknown', async () => {
  const answers = [
    json({content: [{type: 'thinking', thinking: ''}, {type: 'text', text: 'Let me check.'}, {type: 'tool_use', id: 'toolu_2', name: 'set_mode', input: {mode: 'free'}}], stop_reason: 'tool_use', usage: {input_tokens: 10, output_tokens: 5}}),
    json({content: [{type: 'text', text: 'No.'}], stop_reason: 'refusal', usage: {}}),
    json({content: [{type: 'tool_use', id: 'toolu_3', name: 'set_mode', input: {mode: 'fr'}}], stop_reason: 'max_tokens', usage: {input_tokens: 1, output_tokens: 1024}}),
  ];
  const {transport} = fake(() => answers.shift() ?? json({}));
  const provider = new AnthropicProvider({key: 'k', transport});
  const first = await provider.turn(input, signal());
  assert.deepEqual(first, {text: 'Let me check.', calls: [{id: 'toolu_2', name: 'set_mode', input: {mode: 'free'}}], stop: 'tool', units: 15,
    blocks: [{type: 'thinking', thinking: ''}, {type: 'text', text: 'Let me check.'}, {type: 'tool_use', id: 'toolu_2', name: 'set_mode', input: {mode: 'free'}}]});
  assert.deepEqual(await provider.turn(input, signal()), {text: 'No.', calls: [], stop: 'refusal', units: null, blocks: [{type: 'text', text: 'No.'}]});
  assert.deepEqual(await provider.turn(input, signal()), {text: null, calls: [], stop: 'truncated', units: 1025, blocks: [{type: 'tool_use', id: 'toolu_3', name: 'set_mode', input: {mode: 'fr'}}]});
  // A second tool call in one answer is dropped with its block, so no replayed tool_use lacks a result.
  const {transport: twice} = fake(() => json({content: [{type: 'tool_use', id: 'toolu_a', name: 'read_sessions', input: {}}, {type: 'tool_use', id: 'toolu_b', name: 'set_mode', input: {mode: 'work'}}], stop_reason: 'tool_use', usage: {input_tokens: 1, output_tokens: 1}}));
  assert.deepEqual(await new AnthropicProvider({key: 'k', transport: twice}).turn(input, signal()), {text: null, calls: [{id: 'toolu_a', name: 'read_sessions', input: {}}], stop: 'tool', units: 2, blocks: [{type: 'tool_use', id: 'toolu_a', name: 'read_sessions', input: {}}]});
});

void test('HTTP errors, malformed answers, oversized bodies and aborts map once to registry codes', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => json({type: 'error'}, 401), 'unauthenticated'], [() => json({}, 403), 'forbidden'], [() => json({}, 404), 'not-found'],
    [() => json({}, 429), 'capacity'], [() => json({}, 400), 'invalid-request'], [() => json({}, 529), 'unavailable'], [() => json({}, 500), 'unavailable'],
    [() => new Response('not json', {status: 200}), 'invalid-message'], [() => json({content: 'text', usage}), 'invalid-message'],
    [() => json({content: [{type: 'tool_use', id: 'bad id', name: 'x', input: {}}], stop_reason: 'tool_use', usage}), 'invalid-message'],
    [() => new Response('x'.repeat(262_145), {status: 200}), 'too-large'],
    [() => new Response('{}', {status: 200, headers: {'content-length': '262145'}}), 'too-large'],
    [() => Promise.reject(new Error('PRIVATE-NETWORK-DETAIL https://example.invalid')), 'unavailable'],
  ];
  for (const [answer, code] of cases) {
    const {transport} = fake(answer);
    await assert.rejects(new AnthropicProvider({key: 'k', transport}).turn(input, signal()), (error: unknown) => error instanceof ProviderFault && error.code === code && !error.message.includes('PRIVATE'), code);
  }
  const controller = new AbortController(); controller.abort();
  const {transport} = fake(() => Promise.reject(Object.assign(new Error('aborted'), {name: 'AbortError'})));
  await assert.rejects(new AnthropicProvider({key: 'k', transport}).turn(input, controller.signal), (error: unknown) => error instanceof ProviderFault && error.code === 'cancelled');
});
