// The relaxed per-turn limits and the shared spend limits in the engine (Hub #2024). A paid task's model call reserves its
// request bound and its most expensive cost before it is sent, in the receipt's transaction; reported usage replaces both,
// and unreported usage keeps them. A conversation-level call records its spend in the same ledger. These tests use fake
// providers, synthetic prices, the harness's manual clock and scheduler and a fixed zone; they wait for messages, never for time.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import {InProcessBus, type Participant} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsModule, type CompanionsOptions} from '../src/module.js';
import {AssistantStore, LIMITS} from '../src/assistant/store.js';
import {BUILT_IN_PRICES_AS_OF, inputBound, reservationCost, SpendLedger, usageCost, type ModelPrices, type SpendView, type TokenUsage} from '../src/assistant/spend.js';
import {AnthropicProvider, SPEND_LIMIT_REACHED} from '../src/assistant/anthropic.js';
import {SyntheticProvider} from '../src/assistant/synthetic.js';
import {ProviderFault, type ModelProvider, type TurnInput, type TurnReply} from '../src/assistant/provider.js';

const ZONE = 'America/Chicago';
// Synthetic prices in US dollars per million tokens.
const PRICES: Record<string, ModelPrices> = {'model-a': {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2}};
const A = PRICES['model-a'] ?? assert.fail();
const used = (input: number, output: number, cacheRead = 0): TokenUsage => ({input, output, cacheWrite: 0, cacheRead});
const answer = (text: string, usage: TokenUsage | null): TurnReply => ({text, calls: [], stop: 'end', units: usage === null ? null : usage.input + usage.output + usage.cacheWrite + usage.cacheRead, usage});
const read = (usage: TokenUsage | null): TurnReply => ({...answer('', usage), text: null, calls: [{id: 'call-read', name: 'read_hub_guide', input: {}}], stop: 'tool'});
function deferred<T>() {let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.ok(check(), 'expected task state arrived');
}
/** A paid provider under test: scripted replies with reported usage, every turn counted. */
function paid(script: (input: TurnInput, turn: number) => TurnReply | Promise<TurnReply>): ModelProvider & {calls: () => number; inputs: TurnInput[]} {
  let calls = 0; const inputs: TurnInput[] = [];
  return {name: 'anthropic', model: 'model-a', calls: () => calls, inputs, turn: input => {calls += 1; inputs.push(input); return Promise.resolve(script(input, calls));}};
}
async function world(context: TestContext, options: CompanionsOptions = {}) {
  let now = Date.parse('2026-11-21T18:00:00Z');
  const timers = new Map<number, {due: number; callback: () => void}>(); let timerId = 0;
  const time = {clock: {now: () => now}, scheduler: {after: (delay: number, callback: () => void) => {const id = ++timerId; timers.set(id, {due: now + delay, callback}); return () => {timers.delete(id);};}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-spend-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const make = () => {const module = createCompanionsModule({prices: PRICES, timeZone: ZONE, ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const database = () => host.moduleDatabase() ?? assert.fail('open database');
  return {core, module: () => module, store: () => new AssistantStore(database()),
    // A second ledger on the module's own database, as a conversation-level call outside a task would use it (Hub #2025).
    ledger: () => new SpendLedger(database(), PRICES, time.clock.now, ZONE),
    advance: (ms: number) => {now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) {timers.delete(id); timer.callback();}},
    restart: async () => {await host.stop(); ({module, host} = make()); await host.start();}};
}
async function enable(core: Participant, module: CompanionsModule): Promise<void> {
  const requestId = randomUUID();
  const result = await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId, action: 'enable', expectedRevision: module.inspectAssistant()?.revision}}, {requestId, timeoutMs: 5000});
  assert.equal(result.status, 'accepted');
}
async function input(core: Participant, module: CompanionsModule, text: string, extra: Record<string, unknown> = {}) {
  const state = module.inspectAssistant(), task = state?.tasks[0], requestId = randomUUID(), answer = extra.action === 'answer';
  const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: state?.revision, text, ...(answer ? {taskId: task?.taskId, questionId: task?.questionId} : {}), ...extra}))});
  assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
  return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
}
const task = (w: {module: () => CompanionsModule}) => w.module().inspectAssistant()?.tasks.find(value => value.profile === 'bunny');
async function spend(w: {module: () => CompanionsModule}): Promise<SpendView> {
  const content = await w.module().manifest.content?.('spend', {query: {}, signal: new AbortController().signal});
  assert.ok(content !== undefined && !('error' in content), JSON.stringify(content));
  return JSON.parse(Buffer.from(content.bytes).toString()) as SpendView;
}
async function messages(w: {module: () => CompanionsModule}, profile = 'bunny'): Promise<string[]> {
  const content = await w.module().manifest.content?.('conversation', {query: {profile}, signal: new AbortController().signal});
  assert.ok(content !== undefined && !('error' in content));
  return (JSON.parse(Buffer.from(content.bytes).toString()) as {messages: {text: string}[]}).messages.map(message => message.text);
}

void test('a paid call reserves its request bound and dearest cost before it is sent, and its reported usage replaces both', async context => {
  const first = deferred<TurnReply>();
  const provider = paid(turn => turn.transcript.length === 1 ? first.promise : answer('Nothing is running.', used(30, 9, 2000)));
  const w = await world(context, {provider, tools: ['read_hub_guide']});
  await enable(w.core, w.module()); assert.equal((await input(w.core, w.module(), 'Anything running?')).status, 'accepted');
  await until(() => provider.calls() === 1);
  const bound = inputBound(provider.inputs[0]);
  assert.equal(task(w)?.reservedUnits, bound + LIMITS.outputUnits, 'the in-flight call reserves its request bytes, framing and output bound');
  const reserved = reservationCost(A, bound, LIMITS.outputUnits);
  assert.deepEqual((await spend(w)).day, {period: '2026-11-21', spentMicros: reserved, limitMicros: 20_000_000, unreported: 1, unreportedMicros: reserved});
  first.resolve(read(used(2100, 12)));
  await until(() => task(w)?.status === 'succeeded');
  const total = usageCost(A, used(2100, 12)) + usageCost(A, used(30, 9, 2000));
  assert.deepEqual((await spend(w)).day, {period: '2026-11-21', spentMicros: total, limitMicros: 20_000_000, unreported: 0, unreportedMicros: 0});
  assert.deepEqual((await spend(w)).month.spentMicros, total);
  assert.deepEqual([task(w)?.reservedUnits, task(w)?.usageUnits], [2112 + 2039, 2112 + 2039], 'reported units replace the reservation');
});

void test('a malformed Claude proposal sends no command and counts any reported usage', async context => {
  for (const outcome of ['reported', 'unreported', 'late'] as const) {
    let sends = 0;
    const late = deferred<Response>();
    const reported = outcome !== 'unreported';
    const malformed = () => Response.json({content: [{type: 'tool_use', id: 'toolu_bad', name: 'set_mode',
      input: {mode: 'party'}}], stop_reason: 'tool_use', usage: reported ? {input_tokens: 120, output_tokens: 30} : {}});
    const provider = new AnthropicProvider({key: 'fixture', model: 'model-a', transport: () => {
      sends += 1;
      return outcome === 'late' ? late.promise : Promise.resolve(malformed());
    }});
    const w = await world(context, {provider, tools: ['set_mode'], dispatch: () => assert.fail('malformed command reached dispatch')});
    await enable(w.core, w.module());
    assert.equal((await input(w.core, w.module(), 'Set the Hub mode to free.')).status, 'accepted');
    if (outcome === 'late') {
      await until(() => sends === 1);
      w.advance(LIMITS.modelMs);
      await until(() => task(w)?.status === 'uncertain');
      assert.equal((await spend(w)).day.unreported, 1);
      late.resolve(malformed());
      await until(() => w.ledger().totals().day.unreported === 0);
      assert.equal(task(w)?.status, 'uncertain');
    } else {
      await until(() => task(w)?.status === 'failed');
      assert.equal(task(w)?.code, 'invalid-message');
    }
    assert.equal(task(w)?.toolCalls, 0);
    assert.equal(sends, 1);
    const {day, month} = await spend(w);
    for (const period of [day, month]) {
      assert.equal(period.unreported, reported ? 0 : 1);
      if (reported) {
        assert.equal(period.spentMicros, usageCost(A, used(120, 30)));
        assert.equal(period.unreportedMicros, 0);
      } else {
        assert.ok(period.spentMicros > 0);
        assert.equal(period.spentMicros, period.unreportedMicros);
      }
    }
  }
});

void test('unreported usage and a lost answer keep counting their reservations across restart, and a late report replaces one', async context => {
  const late = deferred<TurnReply>();
  const provider = paid((_input, turn) => turn === 1 ? answer('Unmetered.', null) : late.promise);
  const w = await world(context, {provider});
  await enable(w.core, w.module()); await input(w.core, w.module(), 'First');
  await until(() => task(w)?.status === 'succeeded');
  const firstReserved = reservationCost(A, inputBound(provider.inputs[0]), LIMITS.outputUnits);
  assert.deepEqual([(await spend(w)).day.spentMicros, (await spend(w)).day.unreported, task(w)?.usageUnits], [firstReserved, 1, null]);
  await input(w.core, w.module(), 'Second');
  await until(() => provider.calls() === 2); w.advance(LIMITS.modelMs);
  await until(() => task(w)?.status === 'uncertain');
  const secondReserved = reservationCost(A, inputBound(provider.inputs[1]), LIMITS.outputUnits);
  assert.deepEqual([(await spend(w)).day.spentMicros, (await spend(w)).day.unreported], [firstReserved + secondReserved, 2]);
  // The late answer is evidence: its usage replaces the second call's reservation, without refunding the turn's budget.
  late.resolve(answer('Late.', used(500, 20)));
  await until(() => w.store().calls(task(w)?.taskId ?? '')[0]?.status === 'succeeded');
  await until(() => w.ledger().totals().day.unreported === 1);
  assert.equal((await spend(w)).day.spentMicros, firstReserved + usageCost(A, used(500, 20)));
  await w.restart();
  assert.deepEqual([(await spend(w)).day.spentMicros, (await spend(w)).day.unreported], [firstReserved + usageCost(A, used(500, 20)), 1], 'the ledger survives restart');
  // The late evidence settled the call, so startup recovers the task as paused for an explicit resume; nothing is resent.
  assert.equal(task(w)?.status, 'paused'); assert.equal(provider.calls(), 2);
});

void test('at a spend limit a new paid turn is refused with capacity naming the limit in every profile, while a synthetic profile still starts', async context => {
  const provider = paid(() => answer('Never sent.', used(1, 1)));
  // Reachy and MicroDuck use the configured provider too (Hub #2026); a harness gives MicroDuck the synthetic one here.
  const w = await world(context, {provider, profileProviders: {microduck: new SyntheticProvider()}});
  await enable(w.core, w.module());
  // A conversation-level call counted $20 today through the same ledger.
  assert.equal(w.ledger().reserve({id: 'title-1', purpose: 'conversation', owner: 'conversation-1', model: 'model-a', inputUnits: 4_000_000, outputUnits: 0}), undefined);
  const refused = await input(w.core, w.module(), 'Hello');
  assert.equal(refused.status, 'rejected');
  assert.ok(refused.status === 'rejected');
  assert.equal(refused.error.error.code, 'capacity');
  assert.match(refused.error.error.detail ?? '', /^The daily spend limit of \$20\.00 is reached: \$20\.00 is counted today\./);
  assert.equal(provider.calls(), 0); assert.equal(task(w), undefined);
  const companion = await input(w.core, w.module(), 'Hello Reachy', {profile: 'reachy'});
  assert.ok(companion.status === 'rejected', 'a companion on the configured model meets the same limit');
  assert.equal(companion.error.error.code, 'capacity');
  assert.match(companion.error.error.detail ?? '', /^The daily spend limit of \$20\.00 is reached/);
  assert.equal(provider.calls(), 0);
  assert.equal((await input(w.core, w.module(), 'Synthetic request', {profile: 'microduck'})).status, 'accepted', 'the synthetic provider costs nothing');
  // The next local day starts at zero.
  await until(() => w.module().inspectAssistant()?.tasks.find(value => value.profile === 'microduck')?.status === 'waiting');
  w.advance(Date.parse('2026-11-22T06:00:00Z') - Date.parse('2026-11-21T18:00:00Z'));
  assert.equal((await spend(w)).day.spentMicros, 0); assert.equal((await spend(w)).month.spentMicros, 20_000_000);
});

void test('a model call that could pass the daily limit is refused before it is sent, after the call already sent finishes', async context => {
  const first = deferred<TurnReply>();
  const provider = paid((_input, turn) => turn === 1 ? first.promise : answer('Never sent.', used(1, 1)));
  const w = await world(context, {provider, tools: ['read_hub_guide']});
  await enable(w.core, w.module()); await input(w.core, w.module(), 'Check sessions');
  await until(() => provider.calls() === 1);
  // While the first call is in flight, a conversation-level call reports $19.80 of usage.
  const ledger = w.ledger();
  assert.equal(ledger.reserve({id: 'title-2', purpose: 'conversation', owner: 'conversation-1', model: 'model-a', inputUnits: 1, outputUnits: 0}), undefined);
  ledger.settle('title-2', used(4_950_000, 0));
  first.resolve(read(used(10, 5)));
  await until(() => task(w)?.status === 'failed');
  assert.deepEqual([task(w)?.code, task(w)?.modelCalls, task(w)?.toolCalls, provider.calls()], ['capacity', 1, 1, 1], 'the sent call finished and its tool ran; the next call was never sent');
  const said = await messages(w);
  assert.match(said.at(-1) ?? '', /^The daily spend limit of \$20\.00 would be passed: \$19\.80 is counted today and this model call could cost up to \$0\.\d\d\. The next model call was not sent\.$/);
  assert.equal((await spend(w)).day.unreported, 0, 'the refused call reserved nothing');
});

void test('a turn that reaches a per-turn limit ends capacity with a conversation message naming the limit', async context => {
  for (const [patch, expected] of [
    [{modelCalls: LIMITS.modelCalls}, 'This turn reached its limit of 50 model calls.'],
    [{reservedUnits: LIMITS.units - LIMITS.outputUnits}, 'This turn reached its limit of 1,000,000 synthetic units: the next model call could pass it.'],
    [{activeMs: LIMITS.activeMs - 1000}, 'This turn reached its limit of 40 minutes of active time.'],
  ] as const) {
    const w = await world(context, {provider: new SyntheticProvider()});
    await enable(w.core, w.module()); await input(w.core, w.module(), 'Synthetic limit');
    await until(() => task(w)?.status === 'waiting');
    const id = task(w)?.taskId ?? assert.fail(), saved = w.store().task(id) ?? assert.fail();
    Object.assign(saved, patch); w.store().save(saved); await w.restart();
    assert.equal((await input(w.core, w.module(), 'Synthetic answer', {action: 'answer'})).status, 'accepted');
    await until(() => task(w)?.status === 'failed');
    assert.equal(task(w)?.code, 'capacity');
    assert.equal((await messages(w)).at(-1), 'I received your answer, but could not finish the request. ' + expected);
    assert.deepEqual((await spend(w)).day, {...(await spend(w)).day, spentMicros: 0, unreported: 0}, 'synthetic calls record no spend');
  }
});

void test('the staging bound admits the largest 32 KiB message after JSON escaping and refuses a longer one', async context => {
  const w = await world(context, {provider: new SyntheticProvider()});
  await enable(w.core, w.module());
  const stage = (text: string) => w.module().manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId: randomUUID(), signal: new AbortController().signal,
    bytes: Buffer.from(JSON.stringify({action: 'start', profile: 'bunny', expectedRevision: w.module().inspectAssistant()?.revision, text}))});
  // Control characters escape to six JSON bytes each, so the largest message still fits the staging bound.
  const largest = await stage('\u0001'.repeat(LIMITS.inputBytes));
  assert.ok(largest !== undefined && !('error' in largest), JSON.stringify(largest));
  const over = await stage('x'.repeat(LIMITS.inputBytes + 1));
  assert.ok(over !== undefined && 'error' in over && over.error.code === 'invalid-request');
});

void test('a turn at its question limit ends capacity with a message naming the limit', async context => {
  const asking: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: () => Promise.resolve({text: null, calls: [{id: 'call-ask', name: 'ask_owner', input: {text: 'Another detail?'}}], stop: 'tool', units: 1})};
  const w = await world(context, {provider: asking});
  await enable(w.core, w.module()); await input(w.core, w.module(), 'Synthetic questions');
  await until(() => task(w)?.status === 'waiting');
  const id = task(w)?.taskId ?? assert.fail(), saved = w.store().task(id) ?? assert.fail();
  saved.questions = LIMITS.questions; w.store().save(saved); await w.restart();
  assert.equal((await input(w.core, w.module(), 'Synthetic answer', {action: 'answer'})).status, 'accepted');
  await until(() => task(w)?.status === 'failed');
  assert.deepEqual([task(w)?.code, task(w)?.questions], ['capacity', LIMITS.questions]);
  assert.equal((await messages(w)).at(-1), 'I received your answer, but could not finish the request. This turn reached its limit of 10 questions.');
});

void test('a new paid turn is refused when what remains of the day is below the smallest first call', async context => {
  const provider = paid(() => answer('Never sent.', used(1, 1)));
  const w = await world(context, {provider});
  await enable(w.core, w.module());
  const least = reservationCost(A, LIMITS.overheadUnits, LIMITS.outputUnits);
  assert.deepEqual((await spend(w)).paid, {model: 'model-a', minimumMicros: least, prices: 'configured', pricesAsOf: BUILT_IN_PRICES_AS_OF}, 'the route names the paid model, its prices and its smallest call');
  // A conversation-level call leaves one millionth less than the smallest call: input at $4, and five cache reads for the last millionth.
  const ledger = w.ledger();
  assert.equal(ledger.reserve({id: 'title-3', purpose: 'conversation', owner: 'conversation-1', model: 'model-a', inputUnits: 1, outputUnits: 0}), undefined);
  ledger.settle('title-3', {input: (20_000_000 - least) / 4, output: 0, cacheWrite: 0, cacheRead: 5});
  const refused = await input(w.core, w.module(), 'Hello');
  assert.ok(refused.status === 'rejected');
  assert.equal(refused.error.error.code, 'capacity');
  assert.match(refused.error.error.detail ?? '', /^The daily spend limit of \$20\.00 leaves too little for a model call: /);
  assert.equal(provider.calls(), 0); assert.equal(task(w), undefined, 'the message was not admitted');
});

void test('a provider spend-limit refusal ends the turn capacity with its message, after the call before it finished, and sends nothing more', async context => {
  const provider = paid((_input, turn) => {
    if (turn === 1) return read(used(10, 5));
    throw new ProviderFault('capacity', false, undefined, SPEND_LIMIT_REACHED);
  });
  const w = await world(context, {provider, tools: ['read_hub_guide']});
  await enable(w.core, w.module()); await input(w.core, w.module(), 'Check sessions');
  await until(() => task(w)?.status === 'failed');
  assert.deepEqual([task(w)?.code, task(w)?.modelCalls, task(w)?.toolCalls, provider.calls()], ['capacity', 2, 1, 2], 'no retry and no further call');
  // The turn's closing reply ends with the provider's reason (Hub #2046).
  assert.ok((await messages(w)).at(-1)?.endsWith(SPEND_LIMIT_REACHED) === true, (await messages(w)).at(-1));
  // The refused call reported no usage, so its reservation keeps counting in the local estimate.
  assert.equal((await spend(w)).day.unreported, 1);
});

void test('with no configured prices the paid model is priced from the built-in table or the dearest rate, and turns run', async context => {
  const provider = paid(() => answer('Priced.', used(100, 10)));
  const options: CompanionsOptions = {provider, prices: {}};
  const w = await world(context, options);
  await enable(w.core, w.module()); await input(w.core, w.module(), 'Hello');
  await until(() => task(w)?.status === 'succeeded');
  const view = await spend(w);
  assert.deepEqual([view.paid?.prices, view.day.spentMicros], ['dearest', 100 * 4 + 10 * 20], 'model-a is unknown, so it takes the dearest known rate, Opus 5.5 here');
});

void test('a spend limit after dispatch preserves the requested action and names the unsent model call once', async context => {
  const provider = paid(() => ({...answer('', used(1, 1)), text: null, stop: 'tool', calls: [{id: 'mode', name: 'set_mode', input: {mode: 'free'}}]}));
  let sends = 0;
  const w = await world(context, {provider, tools: ['set_mode'], core: () => ({synced: true, sessions: [],
    mode: {id: 'hub', revision: 2, mode: 'work', selectedAtMs: 0}}),
    dispatch: data => {
      sends += 1;
      const ledger = w.ledger();
      assert.equal(ledger.reserve({id: 'synthetic-title', purpose: 'conversation', owner: 'conversation-1', model: 'model-a', inputUnits: 1, outputUnits: 0}), undefined);
      ledger.settle('synthetic-title', used(4_950_000, 0));
      return Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {} as never});
    }});
  await enable(w.core, w.module());
  await input(w.core, w.module(), 'Set the Hub mode to free.');
  await until(() => task(w)?.status === 'failed');
  const history = await messages(w);
  assert.match(history.at(-1) ?? '', /requested.*free.*request was accepted.*daily spend limit.*next model call was not sent/i);
  assert.equal(history.filter(text => text.includes('daily spend limit')).length, 1);
  assert.equal(sends, 1);
  assert.equal(provider.calls(), 1);
  await w.restart();
  assert.deepEqual(await messages(w), history);
});
