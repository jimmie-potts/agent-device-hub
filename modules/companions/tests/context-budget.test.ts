import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AnthropicProvider, MAX_TOKENS, type Transport} from '../src/assistant/anthropic.js';
import {buildContext} from '../src/assistant/context.js';
import {estimateHostedInputTokens, estimateTextTokens, hostedInputBudget, hostedInputTokenCeiling} from '../src/assistant/context-budget.js';
import {OPENAI_MODEL, OPENAI_OUTPUT_TOKENS, OpenAIProvider} from '../src/assistant/openai.js';
import {hostedInputCapacity, hostedInputUnits, type TurnInput} from '../src/assistant/provider.js';

const context = buildContext({profile: 'bunny', persona: {name: 'Bunny', character: ''}, knowledge: {enabled: false, entries: []},
  preferences: [], recent: {conversationId: null, messages: [], total: 0}});
const input: TurnInput = {instructions: 'Test instructions', context, mode: null, transcript: [{role: 'owner', text: 'Test "日本語" 🐇'}],
  tools: [{name: 'read_test', description: 'Find the test object.', input: {type: 'object', properties: {}, required: [], additionalProperties: false}, effect: 'read'}]};

void test('context capacity reserves response tokens and respects separate model input limits', () => {
  assert.equal(hostedInputBudget({provider: 'anthropic', model: 'claude-opus-5-5', maxOutputTokens: MAX_TOKENS}), 1_000_000 - MAX_TOKENS);
  assert.equal(hostedInputBudget({provider: 'openai', model: OPENAI_MODEL, maxOutputTokens: OPENAI_OUTPUT_TOKENS}), 922_000);
  assert.equal(hostedInputBudget({provider: 'openai', model: OPENAI_MODEL, maxOutputTokens: 128_001}), 921_999);
  assert.equal(hostedInputBudget({provider: 'anthropic', model: 'unknown', maxOutputTokens: MAX_TOKENS}), 128_000 - MAX_TOKENS);
});

void test('the local token estimate includes multibyte text and serialized escaping', () => {
  assert.equal(estimateTextTokens('a🐇日'), 8);
  const prose = 'Please check the temperature in the kitchen.';
  assert.ok(estimateTextTokens(prose) < Buffer.byteLength(prose));
  for (const opaque of ['fffffffffffffffffffffffff', 'AbcDeFgHiJ1KlMnOpQrS+TuVwXyZ=']) {
    assert.equal(estimateTextTokens(opaque), Buffer.byteLength(opaque));
  }
  const body = JSON.stringify({text: `${prose}\u0001`});
  assert.ok(estimateHostedInputTokens(body) > estimateTextTokens(body));
  assert.ok(estimateHostedInputTokens(body) < hostedInputTokenCeiling(body));
  assert.equal(estimateHostedInputTokens(body, {name: 'openai', model: 'unknown'}), hostedInputTokenCeiling(body));
});

void test('both adapters size the rendered request including tools and refuse oversized input before transport', async () => {
  for (const name of ['anthropic', 'openai'] as const) {
    const bodies: string[] = [];
    const transport: Transport = (_url, init) => {
      bodies.push(init.body);
      return Promise.resolve(Response.json(name === 'anthropic'
        ? {content: [{type: 'text', text: 'ok'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}
        : {output: [], status: 'completed'}));
    };
    const provider = name === 'anthropic' ? new AnthropicProvider({key: 'fake', transport})
      : new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'medium', transport});
    const signal = new AbortController().signal;
    await provider.turn(input, signal);
    const body = bodies[0] ?? assert.fail('missing transport body');
    assert.equal(hostedInputCapacity(provider), 128_000);
    assert.equal(hostedInputUnits(provider, input), estimateHostedInputTokens(body));
    assert.ok(hostedInputUnits(provider, input) > hostedInputUnits(provider, {...input, tools: []}));
    await assert.rejects(provider.turn({...input, transcript: [{role: 'owner', text: '🐇'.repeat(250_000)}]}, signal),
      {code: 'too-large', sizeLimit: 'request', uncertain: false});
    assert.equal(bodies.length, 1);
    const shortInput = {...input, maxOutputTokens: 2048, tools: []};
    await provider.turn(shortInput, signal);
    const shortBody = bodies[1] ?? assert.fail('missing short request');
    assert.equal(hostedInputUnits(provider, shortInput), estimateHostedInputTokens(shortBody));
    assert.match(shortBody, /"max_(?:output_)?tokens":2048/u);
    if (name === 'anthropic') assert.doesNotMatch(shortBody, /"tool_choice"/u);
  }
});
