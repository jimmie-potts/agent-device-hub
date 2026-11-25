import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {OPENAI_MODEL, OpenAIProvider, responsesUsage} from '../src/assistant/openai.js';
import {ProviderFault, type TurnInput} from '../src/assistant/provider.js';
import {buildContext} from '../src/assistant/context.js';
import {SpendLedger} from '../src/assistant/spend.js';

const input: TurnInput = {instructions: 'Test', context: buildContext({profile: 'bunny', persona: {name: 'Bunny', character: ''},
  knowledge: {enabled: false, entries: []}, preferences: [], recent: {conversationId: null, messages: [], total: 0}}),
  transcript: [{role: 'owner', text: 'Test request'}], tools: [], mode: null};
const signal = () => new AbortController().signal;

void test('Responses bills output once including reasoning and splits the inclusive input count', () => {
  assert.deepEqual(responsesUsage({input_tokens: 25, output_tokens: 10, input_tokens_details: {cached_tokens: 5, cache_write_tokens: 12},
    output_tokens_details: {reasoning_tokens: 8}}), {input: 8, output: 10, cacheRead: 5, cacheWrite: 12});
  assert.equal(responsesUsage({input_tokens: 5, output_tokens: 10, input_tokens_details: {cached_tokens: 5, cache_write_tokens: 1}}), null);
  assert.equal(responsesUsage({input_tokens: 25, output_tokens: 10}), null);
});

void test('Responses handles refusal and uncertain errors without resending or replaying foreign blocks', async () => {
  let calls = 0;
  const provider = new OpenAIProvider({key: 'fake', model: OPENAI_MODEL, effort: 'low', transport: () => {
    calls += 1;
    return Promise.resolve(calls === 1 ? new Response(JSON.stringify({status: 'incomplete', incomplete_details: {reason: 'content_filter'}, output: []}))
      : new Response('PRIVATE-ERROR', {status: 502}));
  }});
  assert.equal((await provider.turn(input, signal())).stop, 'refusal');
  await assert.rejects(provider.turn(input, signal()), error => error instanceof ProviderFault && error.uncertain && !error.message.includes('PRIVATE-ERROR'));
  await assert.rejects(provider.turn({...input, transcript: [...input.transcript, {role: 'assistant', text: null, calls: [],
    blocks: [{type: 'thinking', signature: 'FOREIGN-THINKING'}]}]}, signal()), {code: 'invalid-message'});
  assert.equal(calls, 2);
});

void test('task and title reserve from the same ceiling and a lost answer retains its pinned long-context reservation', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const now = () => Date.parse('2026-11-24T00:00:00Z');
    const ledger = new SpendLedger(db, {}, now, 'UTC', 2_000_000);
    const pricing = ledger.pricing(OPENAI_MODEL, 'openai') ?? assert.fail('missing published rates');
    assert.equal(ledger.pricing('unknown-openai-model', 'openai'), undefined);
    assert.equal(ledger.reserve({id: 'task', purpose: 'task', owner: 'task', model: OPENAI_MODEL, inputUnits: 300_000, outputUnits: 16_000, pricing}), undefined);
    assert.equal(ledger.totals().month.spentMicros, 1_740_000);
    ledger.settle('task', null);
    assert.match(ledger.reserve({id: 'title', purpose: 'conversation', owner: 'conversation', model: 'anthropic-title', inputUnits: 300_000, outputUnits: 1024}) ?? '', /monthly|month/);
    const restarted = new SpendLedger(db, {[OPENAI_MODEL]: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}}, now, 'UTC', 2_000_000);
    assert.equal(restarted.totals().month.unreportedMicros, 1_740_000);
    restarted.settle('task', {input: 10, output: 20, cacheRead: 100, cacheWrite: 40});
    assert.equal(restarted.totals().month.spentMicros, 330);
    assert.equal(restarted.totals().month.unreported, 0);
  } finally {db.close();}
});
