import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AnthropicProvider} from '../src/assistant/anthropic.js';
import {OPENAI_MODEL, OpenAIProvider} from '../src/assistant/openai.js';
import {buildConversationCompactionInput, COMPACTION_OUTPUT_TOKENS,
  readConversationCompactionReply} from '../src/assistant/conversation-compaction.js';
import type {ModelProvider, TurnReply} from '../src/assistant/provider.js';

const boilerplate = 'The planning discussion continued with background details as part of an ordinary conversation. '.repeat(14);
const exchanges = [
  {id: '1', role: 'owner', text: `${boilerplate}The Reading Lamp is the bedside fixture. ${boilerplate}`},
  {id: '2', role: 'assistant', text: `${boilerplate}We settled on 40% brightness for the Reading Lamp. ${boilerplate}`},
  {id: '3', role: 'owner', text: 'Use it only after sunset.'},
  {id: '4', role: 'assistant', text: 'Should that include weekends?'},
  {id: '5', role: 'owner', text: 'No, 30% instead.'},
] as const;

const report = {
  decisions: ['Use the Reading Lamp after sunset.'],
  openQuestions: ['Whether to include weekends is still open.'],
  references: ['The Reading Lamp is the bedside fixture.'],
  corrections: ['The owner replaced 40% brightness with 30%.'],
};
const reply: TurnReply = {text: JSON.stringify(report), stop: 'end', calls: [], units: 60};
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

void test('uses the same text-only compaction source with Anthropic Messages and OpenAI Responses', async () => {
  for (const name of ['anthropic', 'openai'] as const) {
    const bodies: Record<string, unknown>[] = [];
    const transport: typeof fetch = (_url, init) => {
      assert.equal(typeof init?.body, 'string');
      if (typeof init?.body !== 'string') assert.fail('expected JSON request');
      const body: unknown = JSON.parse(init.body);
      assert.ok(isObject(body));
      bodies.push(body);
      return Promise.resolve(Response.json(name === 'anthropic'
        ? {stop_reason: 'end_turn', content: [{type: 'text', text: reply.text}], usage: {input_tokens: 40, output_tokens: 20}}
        : {status: 'completed', output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: reply.text}]}]}));
    };
    const provider: ModelProvider = name === 'anthropic' ? new AnthropicProvider({key: 'fixture', transport})
      : new OpenAIProvider({key: 'fixture', model: OPENAI_MODEL, effort: 'low', transport});
    const measureInput = (input: NonNullable<ReturnType<typeof buildConversationCompactionInput>>) =>
      provider.contextInputUnits?.(input) ?? assert.fail('no hosted size estimate');
    const options = {profile: 'bunny' as const, conversationId: 'private-conversation', messages: exchanges,
      budgetTokens: 1024, inputTokens: 20_000, measureInput};
    assert.equal(buildConversationCompactionInput({...options, inputTokens: 10}), null);
    const input = buildConversationCompactionInput(options) ?? assert.fail('expected an admissible summary request');
    assert.equal(bodies.length, 0);
    const result = readConversationCompactionReply(await provider.turn(input, new AbortController().signal), options.budgetTokens);
    for (const line of Object.values(report).flat()) assert.equal(result?.includes(line), true, line);
    const [body] = bodies;
    if (body === undefined) assert.fail('missing fake transport request');
    if (name === 'anthropic') {
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
    } else assert.deepEqual(body.tools, []);
    assert.equal(body[name === 'anthropic' ? 'max_tokens' : 'max_output_tokens'], COMPACTION_OUTPUT_TOKENS);
    const wireInput = body[name === 'anthropic' ? 'messages' : 'input'];
    assert.ok(Array.isArray(wireInput));
    const message: unknown = wireInput[0];
    assert.ok(isObject(message));
    assert.equal(message.role, 'user');
    let source = message.content;
    if (name === 'anthropic') {
      assert.ok(Array.isArray(source));
      const block: unknown = source[0];
      assert.ok(isObject(block));
      source = block.text;
    }
    assert.equal(typeof source, 'string');
    if (typeof source !== 'string') assert.fail('expected quoted conversation history');
    assert.deepEqual(JSON.parse(source), exchanges);
    assert.ok(!JSON.stringify(body).includes(options.conversationId));
  }
});

void test('discards compaction replies containing actions, truncation, invalid shapes or oversized text', () => {
  const call = {id: 'tool1', name: 'set_mode', input: {mode: 'quiet'}};
  for (const invalid of [
    {...reply, calls: [call]},
    {...reply, stop: 'truncated'} as const,
    {...reply, text: JSON.stringify({...report, openQuestions: 'wrong'})},
    {...reply, text: JSON.stringify({...report, injected: ['unexpected']})},
    {...reply, text: JSON.stringify({...report, decisions: ['long'.repeat(1024)]})},
  ]) assert.equal(readConversationCompactionReply(invalid, 1024), null);
});
