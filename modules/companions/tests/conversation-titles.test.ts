// Model-written conversation titles (Hub #2025): the instruction, prompt and normalization lifted from Codex and T3 Code,
// the Anthropic title call against a fake transport, and the engine's title lifecycle on a bus with the harness's manual
// clock: a title after the first message of an appearance, a refresh a few turns in and after expiry, the owner's rename
// that drops a title in flight, and failures that leave the persona and the task alone. Everything here is synthetic.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator, type LifecycleObservation} from '@jimmie-potts/event-contracts/v2/families';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus, type Outbox, type RequestResult} from '@jimmie-potts/sdk';
import {RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {ANTHROPIC_URL, ANTHROPIC_VERSION, type Transport} from '../src/assistant/anthropic.js';
import {ProviderFault, type ModelProvider, type TurnReply} from '../src/assistant/provider.js';
import {
  AnthropicTitleProvider, ConversationTitles, SyntheticTitleProvider, DEFAULT_TITLE_MODEL, generatedTitle, normalizeTitle, ownerTitle, SESSION_AGE_MS, SYNTHETIC_TITLE, TITLE_DEADLINE_MS,
  TITLE_INSTRUCTIONS, TITLE_MAX_TOKENS, TITLE_PROMPT_BYTES, titlePrompt, type TitleProvider, type TitleReply,
} from '../src/assistant/titles.js';

void test('normalization keeps one plain title: the issue reference, then at most 40 characters of description', () => {
  const cases: [string, string | undefined][] = [
    ['#1896 Session tracking', '#1896 Session tracking'],
    ['"#1896 Session tracking."', '#1896 Session tracking'],
    ['  `Lamp   schedule` ', 'Lamp schedule'],
    ['{"title": "#2025 Conversation titles"}', '#2025 Conversation titles'],
    ['agent-device-hub#2025 Conversation titles', '#2025 Conversation titles'],
    ['pixoo#14 Boot channel', 'pixoo#14 Boot channel'],
    ['#2025: Conversation titles', '#2025 Conversation titles'],
    ['## Fix the lamp', 'Fix the lamp'],
    ['**Lamp schedule**', 'Lamp schedule'],
    ['Title: Lamp schedule', 'Lamp schedule'],
    ['Lamp schedule\nSure, I can help with the lamp.', 'Lamp schedule'],
    [`#7 ${'Description '.repeat(6)}`, '#7 Description Description Description'],
    ['Why is the lamp off?', 'Why is the lamp off'],
    ['Title', undefined], ['title', undefined], ['Untitled', undefined], ['', undefined], ['  ', undefined], ['""', undefined], ['#1896', undefined], ['#1896 .', undefined],
    ['Bearer abcdefghijklmnopqrstuvwxyz', undefined], [`ghp_${'x'.repeat(20)}`, undefined], ['password=hunter2', undefined],
  ];
  for (const [answer, expected] of cases) assert.equal(normalizeTitle(answer), expected, JSON.stringify(answer));
  assert.equal([...(normalizeTitle(`#1 ${'🐰'.repeat(60)}`) ?? '')].length, 43, 'the bound counts characters, never splitting one');
  assert.equal(normalizeTitle(`${'x'.repeat(39)} words`), 'x'.repeat(39), 'a cut word goes');
});

void test('a generated title never repeats a message the prompt carried, whole or as its cut start, and the owner\'s title is bounded display text', () => {
  assert.equal(generatedTitle('Turn on the lamp.', ['turn on   the lamp']), undefined, 'raw prompt text is not a title');
  assert.equal(generatedTitle('Lamp control', ['turn on the lamp']), 'Lamp control');
  assert.equal(generatedTitle(null, []), undefined);
  // A long owner message repeated whole is compared before the description is cut, so its 40-character cut is no title either.
  const long = 'Please check why the kitchen lamp schedule skipped this morning and fix the timer';
  assert.equal(generatedTitle(long, [long]), undefined, 'a long owner message repeated whole');
  assert.equal(generatedTitle(`"${long}."`, [long]), undefined, 'with quotes and punctuation');
  // An answer that repeats only the start of a message is cut to a title that is that message's start.
  assert.equal(generatedTitle('Please check why the kitchen lamp schedule skipped', [long]), undefined, 'a cut title that is a message\'s start');
  assert.equal(generatedTitle('agent-device-hub#12 Please check why the kitchen lamp schedule skipped', [`#12 ${long}`]), undefined, 'with the reference written either way');
  // The assistant's own messages are prompt text too.
  assert.equal(generatedTitle('Synthetic answer about the lamp', ['Lamp please', 'Synthetic answer about the lamp.']), undefined, 'an assistant message repeated');
  assert.equal(generatedTitle('Kitchen lamp schedule', [long]), 'Kitchen lamp schedule', 'a summary is a title');
  assert.equal(generatedTitle('Please check why', [long]), 'Please check why', 'an uncut title may share a message\'s first words');
  assert.equal(ownerTitle('  My   kitchen  chat '), 'My kitchen chat');
  assert.equal(ownerTitle('🐰'.repeat(80)), '🐰'.repeat(80));
  for (const bad of ['🐰'.repeat(81), '   ', 'token=synthetic-secret', 'two\u0007bells']) assert.equal(ownerTitle(bad), undefined, JSON.stringify(bad));
});

void test('the prompt carries the last eight substantive messages, escaped and within its bound; the instruction never answers', () => {
  assert.equal(titlePrompt([]), undefined);
  assert.equal(titlePrompt([{role: 'owner', text: '  '}]), undefined);
  const prompt = titlePrompt([{role: 'owner', text: 'Fix <b>#1896</b> & more'}, {role: 'assistant', text: 'On it.'}]) ?? assert.fail('a prompt');
  assert.match(prompt, /^Prioritize the current task and latest substantive owner request\.\n\nRecent conversation messages:\n<conversation>\n/);
  assert.match(prompt, /<message role="owner">Fix &lt;b&gt;#1896&lt;\/b&gt; &amp; more<\/message>\n<message role="assistant">On it\.<\/message>\n<\/conversation>$/);
  const many = Array.from({length: 12}, (_value, index) => ({role: 'owner' as const, text: `message ${String(index)} ${'&'.repeat(400)}`}));
  const bounded = titlePrompt(many) ?? assert.fail('a prompt');
  assert.ok(Buffer.byteLength(bounded) <= TITLE_PROMPT_BYTES, String(Buffer.byteLength(bounded)));
  assert.equal(bounded.includes('message 3 '), false, 'only the last eight');
  assert.equal((bounded.match(/<message /g) ?? []).length, 8);
  assert.doesNotMatch(bounded, /&(?:a|am|amp)?</, 'no entity is cut');
  for (const rule of ['#<number>', '<repository>#<number>', 'at most 40 characters', 'Do not use quotes, markdown, or trailing punctuation', 'Do not answer the request']) {
    assert.ok(TITLE_INSTRUCTIONS.includes(rule), rule);
  }
});

type Sent = {url: string; init: Parameters<Transport>[1]};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
void test('the Anthropic title call sends the instruction and prompt with low effort to the default small model and reports usage by kind', async () => {
  const sent: Sent[] = [];
  let answer = json({content: [{type: 'thinking', thinking: ''}, {type: 'text', text: '#2025 Conversation titles'}], stop_reason: 'end_turn',
    usage: {input_tokens: 90, output_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 4}});
  const transport: Transport = (url, init) => {sent.push({url, init}); return Promise.resolve(answer);};
  const provider = new AnthropicTitleProvider({key: 'sk-PRIVATE-KEY', transport});
  assert.equal(provider.model, DEFAULT_TITLE_MODEL);
  assert.equal(DEFAULT_TITLE_MODEL, 'claude-haiku-5-5');
  assert.deepEqual(await provider.title('PROMPT', new AbortController().signal),
    {text: '#2025 Conversation titles', usage: {input: 90, output: 12, cacheWrite: 0, cacheRead: 4}});
  assert.equal(sent[0]?.url, ANTHROPIC_URL);
  assert.equal(sent[0]?.init.redirect, 'error');
  assert.deepEqual(sent[0]?.init.headers, {'content-type': 'application/json', 'x-api-key': 'sk-PRIVATE-KEY', 'anthropic-version': ANTHROPIC_VERSION});
  assert.deepEqual(JSON.parse(sent[0]?.init.body ?? '{}'), {model: 'claude-haiku-5-5', max_tokens: TITLE_MAX_TOKENS, system: TITLE_INSTRUCTIONS,
    messages: [{role: 'user', content: [{type: 'text', text: 'PROMPT'}]}], output_config: {effort: 'low'}});
  answer = json({content: [], stop_reason: 'refusal', usage: {input_tokens: 9, output_tokens: 0}});
  assert.deepEqual(await provider.title('PROMPT', new AbortController().signal), {text: null, usage: {input: 9, output: 0, cacheWrite: 0, cacheRead: 0}}, 'a refusal is no title');
  answer = json({content: [{type: 'text', text: '#2025 Conversation'}], stop_reason: 'max_tokens', usage: {}});
  assert.deepEqual(await provider.title('PROMPT', new AbortController().signal), {text: null, usage: null}, 'a cut answer is no title, and missing usage is unknown');
  answer = json({error: {type: 'rate_limit_error'}}, 429);
  await assert.rejects(provider.title('PROMPT', new AbortController().signal), (error: unknown) => error instanceof ProviderFault && error.code === 'capacity' && !error.uncertain);
  const lost = new AnthropicTitleProvider({key: 'k', model: 'claude-sonnet-5-5', transport: () => Promise.reject(new Error('socket'))});
  assert.equal(lost.model, 'claude-sonnet-5-5');
  await assert.rejects(lost.title('PROMPT', new AbortController().signal), (error: unknown) => error instanceof ProviderFault && error.code === 'unavailable' && error.uncertain);
});

/** A title provider that answers from a list; 'hold' keeps one call open until the test releases it. */
function titler(answers: (TitleReply | Error | 'hold')[]) {
  const prompts: string[] = [], held: {resolve: (reply: TitleReply) => void; signal: AbortSignal}[] = [];
  let calls = 0, arrived: () => void = () => {};
  const waiting = {count: 0};
  const provider: TitleProvider & {prompts: string[]; held: typeof held; called: (count: number) => Promise<void>} = {
    name: 'anthropic', model: 'claude-haiku-5-5', prompts, held,
    called: (count: number) => prompts.length >= count ? Promise.resolve() : new Promise<void>(resolve => {waiting.count = count; arrived = resolve;}),
    title: (prompt, signal) => {
      prompts.push(prompt);
      if (prompts.length >= waiting.count) arrived();
      const next = answers[calls++] ?? {text: 'Synthetic later title', usage: null};
      if (next === 'hold') return new Promise<TitleReply>(resolve => {held.push({resolve, signal});});
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return provider;
}
const titled = (text: string): TitleReply => ({text, usage: {input: 50, output: 6, cacheWrite: 0, cacheRead: 0}});
/** Synthetic prices for the title model, in dollars per million tokens. */
const PRICES = {'claude-haiku-5-5': {input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1}};
const done = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const model = (): ModelProvider => ({name: 'synthetic', model: 'synthetic', turn: () => Promise.resolve(done('Synthetic answer.'))});

/** The module on a bus with a manual clock; the title deadline's callbacks are kept so a test can fire them. */
async function world(context: TestContext, options: CompanionsOptions, synthetic = false) {
  let now = 1_790_000_000_000;
  const deadlines: (() => void)[] = [];
  const time = {clock: {now: () => now}, scheduler: {after: (ms: number, callback: () => void) => {
    if (ms === TITLE_DEADLINE_MS) deadlines.push(callback);
    return () => {};
  }}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-titles-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const seen: Message<LifecycleObservation>[] = [], titles: Message<LifecycleObservation>[] = [], waiters: {check: () => boolean; resolve: () => void}[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {
    (message.data.event.kind === 'metadata-observed' ? titles : seen).push(message);
    for (const waiter of waiters.filter(item => item.check())) waiter.resolve();
  });
  const until = (check: () => boolean) => check() ? Promise.resolve() : new Promise<void>(resolve => {waiters.push({check, resolve});});
  const module = createCompanionsModule(synthetic ? options : {syntheticTitleProvider: titler([]), prices: PRICES, ...options});
  const host = new ModuleHarness(module, {bus, stateDir: dir, spans: new RecordedSpans(), section: {}, ...time});
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const w = {
    core, seen, titles, module, host, deadlines, tick: (ms: number) => {now += ms;},
    observed: (count: number) => until(() => seen.length >= count),
    until,
    titled: (count: number) => until(() => titles.length >= count),
    store: () => new ConversationTitles(host.moduleDatabase() ?? assert.fail('open database'), {} as ConstructorParameters<typeof ConversationTitles>[1]),
    async control(action: string, data: Record<string, unknown> = {}): Promise<RequestResult> {
      const requestId = randomUUID(), schema = action === 'rename' ? '2.1' : '2.0';
      return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
        dataschema: `https://bunny.invalid/events/assistant-control/${schema}`, data: {requestId, action, expectedRevision: module.inspectAssistant()?.revision, ...data}}, {requestId, timeoutMs: 5000});
    },
    /** Starts a task in `profile` without waiting for it. */
    async start(text: string, profile = 'bunny'): Promise<void> {
      const requestId = randomUUID(), state = module.inspectAssistant();
      const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
        bytes: Buffer.from(JSON.stringify({action: 'start', profile, expectedRevision: state?.revision, text}))});
      assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
      const reply = await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
        dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
      assert.equal(reply.status, 'accepted', JSON.stringify(reply));
    },
    /** Starts a task in `profile` and waits until it ended, by its turn end. */
    async ask(text: string, profile = 'bunny'): Promise<void> {
      const before = seen.filter(message => message.data.event.kind === 'turn-ended').length;
      const requestId = randomUUID(), state = module.inspectAssistant();
      const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
        bytes: Buffer.from(JSON.stringify({action: 'start', profile, expectedRevision: state?.revision, text}))});
      assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
      const reply = await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
        dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
      assert.equal(reply.status, 'accepted', JSON.stringify(reply));
      await until(() => seen.filter(message => message.data.event.kind === 'turn-ended').length > before);
    },
    /** The shared spend ledger's rows: each call's purpose, owner, model and reported cost in millionths of a dollar, or null while it counts its reservation. */
    spent: () => (host.moduleDatabase()?.prepare('SELECT id,purpose,owner,model,cost_micros AS cost FROM assistant_spend ORDER BY at_ms,id').all() ?? []).map(row => ({...row})),
    conversation: (profile = 'bunny') => module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.conversationId ?? assert.fail('a conversation'),
  };
  assert.equal((await w.control('enable')).status, 'accepted');
  return w;
}
const titleOf = (message: Message<LifecycleObservation> | undefined) => message?.data.title;
const validated = (message: Message<LifecycleObservation>) => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;

void test('the first message of a conversation earns a model-written title, published at once as display metadata and on every later observation', {timeout: 20_000}, async context => {
  const provider = titler([titled('"#1896 Session tracking."')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Please look at issue #1896 and tell me where session tracking stands.');
  await w.titled(1);
  assert.match(provider.prompts[0] ?? '', /<message role="owner">Please look at issue #1896 and tell me where session tracking stands\.<\/message>/);
  const [metadata] = w.titles;
  assert.ok(metadata !== undefined);
  assert.equal(metadata.dataschema, 'https://bunny.invalid/events/lifecycle/2.3');
  assert.equal(metadata.source, 'bunny/modules/companions');
  assert.deepEqual(metadata.data, {identity: {provider: 'bunny', client: 'assistant', hostId: 'core', sourceId: 'companions', sessionId: w.conversation()},
    turn: {status: 'unknown'}, parent: {status: 'top-level'}, event: {kind: 'metadata-observed'}, observedAtMs: metadata.data.observedAtMs, ordering: {status: 'unknown'},
    title: {value: '#1896 Session tracking', source: 'provider'}});
  assert.equal(validated(metadata), true);
  assert.equal(titleOf(w.seen[0])?.value, 'B.U.N.N.Y.', 'the persona stands until the title exists');
  const task = w.module.inspectAssistant()?.tasks[0];
  assert.equal(task?.modelCalls, 1, 'the title call is no call of the task');
  assert.equal(task?.reservedUnits, 10, 'and reserves none of its units');
  const [call] = w.store().calls();
  assert.deepEqual({status: call?.status, outcome: call?.outcome, model: call?.model, usage: call?.usage, conversationId: call?.conversationId},
    {status: 'succeeded', outcome: 'applied', model: 'claude-haiku-5-5', usage: {input: 50, output: 6, cacheWrite: 0, cacheRead: 0}, conversationId: w.conversation()},
    'the call and its usage are recorded on the conversation');
  // The shared spend ledger (Hub #2024) counts it as a conversation-level call: 50 input and 6 output tokens at $1 and $5 per million.
  assert.deepEqual(w.spent(), [{id: call?.id, purpose: 'conversation', owner: w.conversation(), model: 'claude-haiku-5-5', cost: 80}]);
  // The second task carries the title on its observations and asks for no new one.
  await w.ask('And the next step?');
  assert.deepEqual(w.seen.slice(-2).map(titleOf), [{value: '#1896 Session tracking', source: 'provider'}, {value: '#1896 Session tracking', source: 'provider'}]);
  assert.equal(provider.prompts.length, 1);
  assert.equal(JSON.stringify(w.titles.map(message => message.data)).includes('Please look'), false, 'no prompt text is published');
});

void test('the title is refreshed at the third task of an appearance and again when the session reappears after a day without evidence', {timeout: 20_000}, async context => {
  const provider = titler([titled('Lamp schedule'), titled('#88 Lamp schedule fix'), titled('#91 Morning routine')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('When does the lamp turn on?');
  await w.titled(1);
  w.tick(60_000);
  await w.ask('Move it to seven.');
  assert.equal(provider.prompts.length, 1, 'the second task keeps the title');
  w.tick(60_000);
  await w.ask('That is issue #88.');
  await w.titled(2);
  assert.equal(provider.prompts.length, 2, 'the third task refreshes it');
  assert.match(provider.prompts[1] ?? '', /When does the lamp turn on\?.*Move it to seven\..*That is issue #88\./s, 'with the recent conversation');
  w.tick(60_000);
  await w.ask('Thanks.');
  assert.equal(provider.prompts.length, 2, 'later tasks of the appearance keep it');
  w.tick(SESSION_AGE_MS);
  await w.ask('New day: the morning routine, #91.');
  await w.titled(3);
  assert.equal(provider.prompts.length, 3, 'the session reappears after expiry and is titled again');
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Lamp schedule', '#88 Lamp schedule fix', '#91 Morning routine']);
  assert.deepEqual(titleOf(w.seen.find(message => message.data.observedAtMs >= 1_790_000_000_000 + 180_000 + SESSION_AGE_MS)), {value: '#88 Lamp schedule fix', source: 'provider'},
    'the reappearing session shows the earlier title until the new one lands');
});

void test('the owner\'s rename is published at once, drops a title in flight and is never replaced by a generated title', {timeout: 20_000}, async context => {
  const provider = titler(['hold', titled('#5 Generated later')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Synthetic first request about issue #5.');
  await provider.called(1);
  const renamed = await w.control('rename', {profile: 'bunny', title: '  Kitchen   plans '});
  assert.equal(renamed.status, 'accepted');
  await w.titled(1);
  assert.deepEqual(w.titles.map(titleOf), [{value: 'Kitchen plans', source: 'user'}]);
  assert.equal(provider.held[0]?.signal.aborted, true, 'the title call in flight is abandoned');
  provider.held[0]?.resolve(titled('#5 Too late'));
  const calls = () => w.store().calls();
  assert.deepEqual(calls().map(call => call.status), ['uncertain'], 'the abandoned call keeps unknown usage');
  for (const text of ['Second', 'Third', 'Fourth']) {w.tick(1000); await w.ask(`${text} synthetic request.`);}
  assert.equal(provider.prompts.length, 1, 'an owner title earns no generated one');
  assert.deepEqual(w.titles.map(titleOf), [{value: 'Kitchen plans', source: 'user'}]);
  assert.deepEqual(titleOf(w.seen.at(-1)), {value: 'Kitchen plans', source: 'user'}, 'every later observation carries the owner\'s title');
  // A rename before any conversation opens it; a rename to text that is no title is refused, and the title stays.
  assert.equal((await w.control('rename', {profile: 'reachy', title: 'Reachy demo'})).status, 'accepted');
  assert.equal(w.titles.length, 1, 'a conversation that never reported has no session to show it on yet');
  for (const title of ['   ', 'password=synthetic-secret', 'x'.repeat(81)]) {
    const refused = await w.control('rename', {profile: 'bunny', title});
    assert.equal(refused.status, 'rejected', title);
  }
  const blank = await w.control('rename', {profile: 'bunny', title: '   '});
  assert.equal(blank.status === 'rejected' ? blank.error.error.code : blank.status, 'invalid-request', 'a title of whitespace only is a bad title');
  assert.equal(w.titles.length, 1, 'a refused rename publishes nothing');
  assert.deepEqual(w.store().record(w.conversation())?.title, {value: 'Kitchen plans', source: 'owner'});
});

void test('compare-before-write: an answer settled after a rename advanced the generation is dropped, even when the call was not abandoned', async () => {
  const database = new DatabaseSync(':memory:'), added: unknown[] = [];
  const outbox = {transaction: <T>(work: (add: (key: string, draft: unknown) => unknown) => T) => Promise.resolve(work((key, draft) => {added.push({key, draft}); return draft;}))} as unknown as Outbox;
  let release: (reply: TitleReply) => void = () => {};
  const provider: TitleProvider = {name: 'anthropic', model: 'claude-haiku-5-5', title: () => new Promise<TitleReply>(resolve => {release = resolve;})};
  const titles = new ConversationTitles(database, {outbox, spend: {reserve: () => undefined, settle: () => {}}, now: () => 1000, after: () => () => {}, provider: () => provider,
    messages: () => [{role: 'owner', text: 'Synthetic request.'}], reported: () => true, metadata: (_id, title) => ({key: 'title', draft: title})});
  titles.touched('conversation-1');
  const work = titles.generate('conversation-1', 'bunny');
  for (let turn = 0; turn < 10 && titles.calls().length === 0; turn += 1) await Promise.resolve();
  await outbox.transaction(add => {titles.rename(add, 'conversation-1', 'bunny', 'Owner title');});
  release(titled('#9 Stale title'));
  await work;
  assert.deepEqual(titles.calls().map(call => [call.status, call.outcome]), [['succeeded', 'dropped']]);
  assert.deepEqual(titles.record('conversation-1')?.title, {value: 'Owner title', source: 'owner'});
  assert.deepEqual(titles.published('conversation-1', 'bunny'), {value: 'Owner title', source: 'user'});
  assert.deepEqual(added, [{key: 'title', draft: {value: 'Owner title', source: 'user'}}], 'only the rename is announced');
  assert.equal(titles.started('conversation-1'), false, 'and an owner title earns no generated one');
  database.close();
});

void test('a failed, refused, invalid or late title leaves the persona, never touches the task, and is not retried', {timeout: 20_000}, async context => {
  const provider = titler([new ProviderFault('capacity'), {text: null, usage: null}, titled('Title'), titled('token=synthetic-secret-1234'), 'hold']);
  const w = await world(context, {provider: model(), titleProvider: provider});
  for (const text of ['One.', 'Two.', 'Three.']) {
    w.tick(SESSION_AGE_MS);
    await w.ask(`Synthetic request ${text}`);
    await provider.called(w.store().calls().length);
  }
  w.tick(SESSION_AGE_MS);
  await w.ask('Synthetic request Four.');
  w.tick(SESSION_AGE_MS);
  await w.ask('Synthetic request Five.');
  await provider.called(5);
  w.deadlines.at(-1)?.();
  // The settle transactions run after the answers; a later control commits after them.
  await w.control('enable');
  assert.equal(w.titles.length, 0, 'no title is published');
  assert.ok(w.seen.every(message => titleOf(message)?.value === 'B.U.N.N.Y.'), 'the persona stands');
  assert.ok((w.module.inspectAssistant()?.tasks ?? []).every(task => task.status === 'succeeded'), 'every task succeeded');
  assert.deepEqual(w.store().calls().map(call => [call.status, call.code ?? null, call.outcome]), [
    ['failed', 'capacity', null], ['succeeded', null, 'invalid'], ['succeeded', null, 'invalid'], ['succeeded', null, 'invalid'], ['uncertain', null, null],
  ]);
  assert.equal(provider.prompts.length, 5, 'one call each, no retry');
  assert.deepEqual(w.store().calls().map(call => call.answer ?? null), [null, null, 'Title', 'token=synthetic-secret-1234', null],
    'the raw answer is kept privately for diagnosis');
  assert.equal(JSON.stringify(w.host.logs).includes('synthetic-secret-1234'), false, 'and reaches no log');
  assert.deepEqual(w.spent().map(row => row.cost === null ? 'reserved' : 'reported'), ['reserved', 'reserved', 'reported', 'reported', 'reserved'],
    'a failed, unreported or lost call keeps counting its reservation; a reported one counts its usage');
});

void test('a profile without a real title model makes no title call and keeps its persona name', {timeout: 20_000}, async context => {
  // The synthetic B.U.N.N.Y. provider, and Reachy and MicroDuck, have no title model.
  const w = await world(context, {provider: model()}, true);
  await w.ask('SYNTHETIC-PRIVATE-REQUEST');
  for (const profile of ['reachy', 'microduck']) {
    // The demo profiles' synthetic provider asks its fixed question first; the owner cancels it.
    await w.start('SYNTHETIC-PRIVATE-REQUEST', profile);
    await w.until(() => w.module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.status === 'waiting');
    assert.equal((await w.control('cancel', {taskId: w.module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.taskId})).status, 'accepted');
  }
  await w.control('enable');
  assert.deepEqual(w.store().calls(), [], 'no title call is made');
  assert.equal(w.titles.length, 0);
  assert.deepEqual([...new Set(w.seen.map(message => titleOf(message)?.value))].sort(), ['B.U.N.N.Y.', 'MicroDuck', 'Reachy'], 'each keeps its persona name');
});

void test('a harness that injects the fixed synthetic title provider gets its fixed title, which never echoes the conversation', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: model(), syntheticTitleProvider: new SyntheticTitleProvider()}, true);
  await w.ask('SYNTHETIC-PRIVATE-REQUEST');
  await w.titled(1);
  assert.deepEqual(titleOf(w.titles[0]), {value: SYNTHETIC_TITLE, source: 'provider'});
  assert.equal(w.store().calls()[0]?.usage?.input, 0, 'it costs nothing');
  assert.deepEqual(w.spent(), [], 'and reserves no spend');
  assert.equal(JSON.stringify(w.titles).includes('SYNTHETIC-PRIVATE-REQUEST'), false);
});

void test('an accepted coding hand-off refreshes the title from its brief, unless the owner renamed the conversation', {timeout: 20_000}, async context => {
  let turn = 0;
  // Each task's first call proposes the hand-off; a later call in the task answers.
  const turns: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: input => {
    turn += 1;
    return Promise.resolve(input.transcript.every(item => item.role === 'owner')
      ? {text: null, calls: [{id: `call-${String(turn)}`, name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Fix the flaky timer test from issue #2041.'}}], stop: 'tool', units: 10}
      : done('Handed off.'));
  }};
  const delegated: string[] = [];
  const provider = titler([titled('Timer question'), titled('#2041 Flaky timer test')]);
  const w = await world(context, {provider: turns, titleProvider: provider, tools: ['delegate_coding'],
    coding: () => ({available: true, endpointId: 'worker', revision: 1}),
    delegate: data => {delegated.push(data.brief); return Promise.resolve({status: 'accepted', requestId: data.requestId} as unknown as RequestResult);}});
  const approve = async (): Promise<void> => {
    const state = w.module.inspectAssistant(), task = state?.tasks.find(item => item.profile === 'bunny');
    const requestId = randomUUID();
    const staged = await w.module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({action: 'answer', profile: 'bunny', expectedRevision: state?.revision, text: 'approve', taskId: task?.taskId, questionId: task?.questionId}))});
    assert.ok(staged !== undefined && !('error' in staged));
    const reply = await w.core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
    assert.equal(reply.status, 'accepted');
  };
  const status = () => w.module.inspectAssistant()?.tasks.find(task => task.profile === 'bunny');
  const awaitingApproval = () => w.until(() => status()?.status === 'waiting' && status()?.questionId !== null && status()?.hasAnswer === false);
  await w.start('Can the worker look at the flaky timer test?');
  await w.titled(1);
  await awaitingApproval();
  await approve();
  await w.until(() => delegated.length === 1 && status()?.status === 'waiting');
  await provider.called(2);
  await w.titled(2);
  assert.equal(delegated.length, 1);
  assert.match(provider.prompts[1] ?? '', /Delegated to the coding worker in agent-device-hub: Fix the flaky timer test from issue #2041\./, 'the brief is in the prompt');
  assert.deepEqual(titleOf(w.titles[1]), {value: '#2041 Flaky timer test', source: 'provider'});
  // After a rename, a later hand-off leaves the owner's name.
  assert.equal((await w.control('rename', {profile: 'bunny', title: 'Timer work'})).status, 'accepted');
  const cancelled = await w.control('cancel', {taskId: status()?.taskId});
  assert.equal(cancelled.status, 'accepted', JSON.stringify(cancelled));
  await w.until(() => status()?.status === 'cancelled');
  await w.start('And the other timer test?');
  await awaitingApproval();
  await approve();
  await w.until(() => delegated.length === 2);
  await w.control('enable');
  assert.equal(provider.prompts.length, 2, 'no title call after the rename');
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Timer question', '#2041 Flaky timer test', 'Timer work']);
});

void test('a title call the spend limits refuse is never sent and leaves the persona; a missing title price refuses it too', {timeout: 20_000}, async context => {
  const provider = titler([titled('#7 Never sent')]);
  // A reservation of 1,024 output tokens at $20,000 per million passes the $20 daily limit.
  const w = await world(context, {provider: model(), titleProvider: provider, prices: {'claude-haiku-5-5': {input: 1, output: 20_000, cacheWrite: 1, cacheRead: 1}}});
  await w.ask('Synthetic request.');
  await w.control('enable');
  assert.equal(provider.prompts.length, 0, 'nothing is sent');
  assert.deepEqual(w.store().calls().map(call => [call.status, call.code]), [['failed', 'capacity']]);
  assert.deepEqual(w.spent(), [], 'a refused reservation records nothing');
  assert.equal(w.titles.length, 0);
  assert.equal(w.module.inspectAssistant()?.tasks[0]?.status, 'succeeded', 'the task is untouched');
  const unpriced = await world(context, {provider: model(), titleProvider: titler([titled('#8 Never sent')]), prices: {}});
  await unpriced.ask('Synthetic request.');
  await unpriced.control('enable');
  assert.deepEqual(unpriced.store().calls().map(call => [call.status, call.code]), [['failed', 'capacity']]);
});

void test('stopping the module abandons a title call in flight without waiting for it', {timeout: 20_000}, async context => {
  const provider = titler(['hold']);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Synthetic request.');
  await provider.called(1);
  await w.host.stop();
  assert.equal(provider.held[0]?.signal.aborted, true);
});
