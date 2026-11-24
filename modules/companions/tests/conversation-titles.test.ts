// Model-written conversation titles (Hub #2025) that follow the conversation's topic (Hub #2075): the instruction, prompt
// and normalization lifted from Codex and T3 Code, the Anthropic title call against a fake transport, and the engine's
// title checks on a bus with the harness's manual clock: a first title after the first message, a check after each
// finished task and major event that keeps the title or writes a new one, no trigger from a task count or a time gap, an
// owner's rename the model keeps until the topic changes, one call per conversation with later triggers coalesced, late
// answers dropped, and failures that leave the title and the task alone. Everything here is synthetic.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test, type TestContext} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {coreValidator, type LifecycleObservation, type ModeState} from '@jimmie-potts/event-contracts/v2/families';
import {DatabaseSync} from 'node:sqlite';
import {InProcessBus, type Outbox, type RequestResult} from '@jimmie-potts/sdk';
import {RecordedSpans, ModuleHarness} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule, type CompanionsOptions} from '../src/module.js';
import {ANTHROPIC_URL, ANTHROPIC_VERSION, SPEND_LIMIT_REACHED, type Transport} from '../src/assistant/anthropic.js';
import {ProviderFault, type ModelProvider, type TurnReply} from '../src/assistant/provider.js';
import {
  AnthropicTitleProvider, ConversationTitles, ECHO_RUN_WORDS, KEEP, SyntheticTitleProvider, DEFAULT_TITLE_MODEL, eventLabel, generatedTitle, keeps, normalizeTitle, ownerTitle,
  SESSION_AGE_MS, SYNTHETIC_TITLE, TITLE_DEADLINE_MS, TITLE_EVENTS, TITLE_INSTRUCTIONS, TITLE_MAX_TOKENS, TITLE_PROMPT_BYTES, titlePrompt, type TitleCall, type TitleMessage,
  type TitleProvider, type TitleReply,
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

void test('a generated title never repeats text the prompt carried, and the owner\'s title is bounded display text', () => {
  const owner = (...texts: string[]): TitleMessage[] => texts.map(text => ({role: 'owner', text}));
  const assistant = (text: string): TitleMessage => ({role: 'assistant', text});
  const handOff = (brief: string): TitleMessage => assistant(`Delegated to the coding worker in agent-device-hub: ${brief}`);
  assert.equal(ECHO_RUN_WORDS, 6);
  assert.equal(generatedTitle('Turn on the lamp.', owner('turn on   the lamp')), undefined, 'raw prompt text is not a title');
  assert.equal(generatedTitle('Lamp control', owner('turn on the lamp')), 'Lamp control');
  assert.equal(generatedTitle(null, []), undefined);
  // A long owner message repeated whole, with quotes and punctuation, or its start, or an excerpt from its middle.
  const long = 'Please check why the kitchen lamp schedule skipped this morning and fix the timer';
  assert.equal(generatedTitle(long, owner(long)), undefined, 'a long owner message repeated whole');
  assert.equal(generatedTitle(`"${long}."`, owner(long)), undefined, 'with quotes and punctuation');
  assert.equal(generatedTitle('Please check why the kitchen lamp schedule skipped', owner(long)), undefined, 'a message\'s start');
  assert.equal(generatedTitle('agent-device-hub#12 Please check why the kitchen lamp schedule skipped', owner(`#12 ${long}`)), undefined, 'with the reference written either way');
  assert.equal(generatedTitle('why the kitchen lamp schedule skipped this morning', owner(long)), undefined, 'a mid-message owner excerpt');
  // The assistant's replies: an equal answer, or a cut answer inside one.
  assert.equal(generatedTitle('Synthetic answer about the lamp', [...owner('Lamp please'), assistant('Synthetic answer about the lamp.')]), undefined, 'an assistant reply repeated');
  assert.equal(generatedTitle('The kitchen lamp schedule skipped because the timer', [assistant('I looked: the kitchen lamp schedule skipped because the timer was off.')]), undefined,
    'a cut answer inside a reply');
  // A coding hand-off is saved with a fixed wrapper; its brief repeated on its own is an echo, long or short.
  const brief = 'Fix the flaky timer test from the kitchen lamp schedule module';
  assert.equal(generatedTitle(brief, [handOff(brief)]), undefined, 'a long brief echoed');
  assert.equal(generatedTitle('Fix the timer test', [handOff('Fix the timer test.')]), undefined, 'a short brief echoed');
  // The prompt escapes markup; an answer copied in escaped form is the same text.
  assert.equal(generatedTitle('Fix &lt;b&gt;lamp&lt;/b&gt; &amp; timer', owner('Fix <b>lamp</b> & timer')), undefined, 'an entity-escaped echo');
  assert.equal(generatedTitle('Check why &lt;kitchen&gt; lamp schedule skipped this morning', owner('Please check why <kitchen> lamp schedule skipped this morning and more')), undefined,
    'an entity-escaped mid-message excerpt');
  // The shape the instruction asks for: an issue reference, then six or more words verbatim from wherever the reference was.
  const titleBrief = 'Fix the stale session title shown on the hallway Tidbyt after a rename (#2025).';
  assert.equal(generatedTitle('#2025 Fix the stale session title shown on the hallway Tidbyt after a rename', [handOff(titleBrief)]), undefined, '#N and a hand-off brief');
  // The approval question words the hand-off as "Delegate to"; a declined or refused hand-off is checked the same way.
  assert.equal(generatedTitle('#2025 Fix the stale session title shown on the hallway Tidbyt after a rename',
    [assistant(`Delegate to the coding worker in agent-device-hub: ${titleBrief}`)]), undefined, '#N and an approval\'s brief');
  // A hand-off waiting for its companion's busy slot is worded "Waiting to delegate to" until it is sent (Hub #2028).
  assert.equal(generatedTitle('Fix the timer test', [assistant('Waiting to delegate to the coding worker in agent-device-hub: Fix the timer test.')]), undefined, 'a waiting hand-off\'s brief');
  // Uncut answers, which only the brief rules can catch: equality with the approval's brief, and a six-word run of it.
  assert.equal(generatedTitle('Fix the timer test', [assistant('Delegate to the coding worker in agent-device-hub: Fix the timer test.')]), undefined,
    'a short answer equal to an approval\'s brief');
  assert.equal(generatedTitle('Flaky lamp timer test in schedule module',
    [assistant('Delegate to the coding worker in agent-device-hub: Fix the flaky lamp timer test in schedule module today.')]), undefined, 'six words of an approval\'s brief');
  // A cut answer inside a reply, behind a new issue reference.
  const lamp = assistant('Done: I turned off the bedroom lamp and set the alarm for six tomorrow. Sleep well.');
  assert.equal(generatedTitle('#7 I turned off the bedroom lamp and set the alarm for six tomorrow', [lamp]), undefined, '#N and a reply excerpt');
  assert.equal(generatedTitle('Bedroom lamp and alarm setup', [lamp]), 'Bedroom lamp and alarm setup', 'a reply\'s topic as a summary');
  const night = 'My brother keeps waking me up at 3am every single night, see #1896';
  assert.equal(generatedTitle('#1896 My brother keeps waking me up at 3am', owner(night)), undefined, '#N and an owner excerpt');
  assert.equal(generatedTitle('pixoo#14 The boot channel resets to the cloud clock face', owner('After a power cut the boot channel resets to the cloud clock face again (pixoo#14).')), undefined,
    'repo#N and an excerpt');
  // Kept: summaries, reordered or reworded titles, a reply's topic words, and fewer than six shared words with an owner message.
  const replyText = 'Session tracking for native conversations is in progress: the native session titles are not published yet, and Tidbyt shows a stale title after a rename.';
  const conversation: TitleMessage[] = [...owner(night, long, 'Where does session tracking stand for #1896?', 'Pixoo boots to the cloud face after a power cut, see pixoo#14.'),
    handOff(titleBrief), handOff(brief), assistant(replyText)];
  for (const title of ['#1896 Session tracking for native conversations on dashboard', '#1896 Session tracking status', '#2025 Stale title after rename', 'pixoo#14 Boot channel',
    '#1896 Native session title publication and', 'Kitchen lamp schedule']) {
    assert.equal(generatedTitle(title, conversation), normalizeTitle(title), title);
  }
  assert.equal(generatedTitle('#7 Check the kitchen lamp schedule again', owner('Please check the kitchen lamp schedule for tonight')), '#7 Check the kitchen lamp schedule again',
    'five shared words with an owner message');
  assert.equal(generatedTitle('#2041 Flaky timer test in the lamp scheduler code paths', [...owner(long), handOff(brief)]), '#2041 Flaky timer test in the lamp scheduler',
    'a long summary that shares fewer than six consecutive words');
  assert.equal(generatedTitle('Please check why', owner(long)), 'Please check why', 'an uncut title may share a message\'s first words');
  assert.equal(ownerTitle('  My   kitchen  chat '), 'My kitchen chat');
  assert.equal(ownerTitle('🐰'.repeat(80)), '🐰'.repeat(80));
  for (const bad of ['🐰'.repeat(81), '   ', 'token=synthetic-secret', 'two\u0007bells']) assert.equal(ownerTitle(bad), undefined, JSON.stringify(bad));
});

void test('the prompt carries the current title with its source, the event labels and the last eight substantive messages, within its bound', () => {
  assert.equal(titlePrompt([], null, []), undefined);
  assert.equal(titlePrompt([{role: 'owner', text: '  '}], null, ['The owner sent a message.']), undefined);
  const prompt = titlePrompt([{role: 'owner', text: 'Fix <b>#1896</b> & more'}, {role: 'assistant', text: 'On it.'}], null, ['The owner sent a message.']) ?? assert.fail('a prompt');
  assert.match(prompt, /^Current title: none\n\nLatest events:\n- The owner sent a message\.\n\nPrioritize the current task and latest substantive owner request\.\n\nRecent conversation messages:\n<conversation>\n/);
  assert.match(prompt, /<message role="owner">Fix &lt;b&gt;#1896&lt;\/b&gt; &amp; more<\/message>\n<message role="assistant">On it\.<\/message>\n<\/conversation>$/);
  // The current title is the session's display text, escaped as the messages are, and its source says who set it.
  const generated = titlePrompt([{role: 'owner', text: 'Lamp?'}], {value: '#7 Lamp <schedule>', source: 'generated'}, ['A task finished: succeeded.']) ?? assert.fail('a prompt');
  assert.match(generated, /^Current title, written by the title model: #7 Lamp &lt;schedule&gt;\n\nLatest events:\n- A task finished: succeeded\.\n\n/);
  const owned = titlePrompt([{role: 'owner', text: 'Lamp?'}], {value: 'Kitchen plans', source: 'owner'}, ['A task finished: succeeded.', 'The owner approved set_mode.']) ?? assert.fail('a prompt');
  assert.match(owned, /^Current title, set by the owner: Kitchen plans\n\nLatest events:\n- A task finished: succeeded\.\n- The owner approved set_mode\.\n\n/);
  // With the longest owner title, all of it escaped, and the most event labels, the whole prompt keeps its bound.
  const many = Array.from({length: 12}, (_value, index) => ({role: 'owner' as const, text: `message ${String(index)} ${'&'.repeat(400)}`}));
  const labels = Array.from({length: TITLE_EVENTS}, (_value, index) => eventLabel({kind: 'approval', tool: `set_mode_${String(index)}`, decision: 'declined'}));
  const bounded = titlePrompt(many, {value: '&'.repeat(80), source: 'owner'}, labels) ?? assert.fail('a prompt');
  assert.ok(Buffer.byteLength(bounded) <= TITLE_PROMPT_BYTES, String(Buffer.byteLength(bounded)));
  assert.ok(bounded.includes(`Current title, set by the owner: ${'&amp;'.repeat(80)}\n`), 'the current title is never cut');
  assert.equal(bounded.includes('message 3 '), false, 'only the last eight');
  assert.equal((bounded.match(/<message /g) ?? []).length, 8);
  assert.doesNotMatch(bounded, /&(?:a|am|amp)?</, 'no entity is cut');
  for (const rule of ['#<number>', '<repository>#<number>', 'at most 40 characters', 'Do not use quotes, markdown, or trailing punctuation', 'Do not answer the request',
    `reply with ${KEEP} and nothing else`, `A title set by the owner is their choice: reply ${KEEP} unless the topic has clearly changed since they set it.`]) {
    assert.ok(TITLE_INSTRUCTIONS.includes(rule), rule);
  }
});

void test('each event label is fixed text from the module: a tool name, a decision or an outcome, never a tool result', () => {
  assert.equal(eventLabel({kind: 'message'}), 'The owner sent a message.');
  assert.equal(eventLabel({kind: 'task', result: 'succeeded'}), 'A task finished: succeeded.');
  assert.equal(eventLabel({kind: 'task', result: 'cancelled'}), 'A task finished: cancelled.');
  assert.equal(eventLabel({kind: 'tool', tool: 'set_mode'}), 'A tool call changed state: set_mode was accepted.');
  assert.equal(eventLabel({kind: 'approval', tool: 'set_lifx_power', decision: 'approved'}), 'The owner approved set_lifx_power.');
  assert.equal(eventLabel({kind: 'approval', tool: 'set_mode', decision: 'declined'}), 'The owner declined set_mode.');
  assert.equal(eventLabel({kind: 'hand-off'}), 'A coding hand-off was accepted.');
  assert.equal(eventLabel({kind: 'hand-off-result', outcome: 'completed'}), 'A coding hand-off\'s result arrived: completed.');
  // A name that is not a tool identifier is never sent.
  assert.equal(eventLabel({kind: 'tool', tool: 'Turn on <the lamp>'}), 'A tool call changed state: a tool was accepted.');
});

void test('an answer of KEEP keeps the title, in any case, quoted or with trailing punctuation; anything else is a title or no title', () => {
  for (const answer of ['KEEP', 'keep', ' "Keep." ', 'KEEP\nThe topic has not changed.', '{"title": "KEEP"}', '**KEEP**']) assert.equal(keeps(answer), true, JSON.stringify(answer));
  for (const answer of [null, '', 'Keep lamp schedule', 'Kept', '#7 KEEP']) assert.equal(keeps(answer), false, JSON.stringify(answer));
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
  await assert.rejects(provider.title('PROMPT', new AbortController().signal), (error: unknown) => error instanceof ProviderFault && error.code === 'capacity' && !error.uncertain && error.closingReason === undefined);
  // Anthropic's monthly spend-limit refusal maps as for a task's call (Hub #2047); the engine keeps the persona on any failure.
  answer = json({type: 'error', error: {type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'}}, 400);
  await assert.rejects(provider.title('PROMPT', new AbortController().signal), (error: unknown) => error instanceof ProviderFault && error.code === 'capacity' && error.closingReason === SPEND_LIMIT_REACHED);
  const lost = new AnthropicTitleProvider({key: 'k', model: 'claude-sonnet-5-5', transport: () => Promise.reject(new Error('socket'))});
  assert.equal(lost.model, 'claude-sonnet-5-5');
  await assert.rejects(lost.title('PROMPT', new AbortController().signal), (error: unknown) => error instanceof ProviderFault && error.code === 'unavailable' && error.uncertain);
});


/** A title provider that answers from a list, then KEEP; 'hold' keeps one call open until the test releases it. */
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
      const next = answers[calls++] ?? {text: KEEP, usage: {input: 50, output: 1, cacheWrite: 0, cacheRead: 0}};
      if (next === 'hold') return new Promise<TitleReply>(resolve => {held.push({resolve, signal});});
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
  return provider;
}
const titled = (text: string): TitleReply => ({text, usage: {input: 50, output: 6, cacheWrite: 0, cacheRead: 0}});
const kept: TitleReply = {text: KEEP, usage: {input: 50, output: 1, cacheWrite: 0, cacheRead: 0}};
/** Synthetic prices for the title model, in dollars per million tokens. */
const PRICES = {'claude-haiku-5-5': {input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1}};
const done = (text: string): TurnReply => ({text, calls: [], stop: 'end', units: 10});
const model = (): ModelProvider => ({name: 'synthetic', model: 'synthetic', turn: () => Promise.resolve(done('Synthetic answer.'))});
/** A turn model whose call waits for the test while the owner's message holds `HOLD`; every other call answers at once. */
function gatedModel() {
  const waiting: (() => void)[] = [];
  const provider: ModelProvider & {waiting: typeof waiting} = {name: 'synthetic', model: 'synthetic', waiting, turn: input => {
    const owner = input.transcript.find(item => item.role === 'owner');
    return owner?.role === 'owner' && owner.text.includes('HOLD') ? new Promise<TurnReply>(resolve => {waiting.push(() => {resolve(done('Synthetic held answer.'));});})
      : Promise.resolve(done('Synthetic answer.'));
  }};
  return provider;
}
/** Event-loop turns, no clock: what a missing call would need to start. */
const turns = async (count = 20): Promise<void> => {for (let turn = 0; turn < count; turn += 1) await new Promise(resolve => {setImmediate(resolve);});};

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
  const seen: Message<LifecycleObservation>[] = [], titles: Message<LifecycleObservation>[] = [];
  await core.subscribe<LifecycleObservation>('bunny.event.lifecycle.*', message => {(message.data.event.kind === 'metadata-observed' ? titles : seen).push(message);});
  /** Waits, in event-loop turns and never on a clock, until `check` holds. */
  const until = async (check: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 5000; turn += 1) {
      if (check()) return;
      await new Promise(resolve => {setImmediate(resolve);});
    }
    assert.ok(check(), 'the awaited condition holds');
  };
  const module = createCompanionsModule(synthetic ? options : {syntheticTitleProvider: titler([]), prices: PRICES, ...options});
  const host = new ModuleHarness(module, {bus, stateDir: dir, spans: new RecordedSpans(), section: {}, ...time});
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const store = () => new ConversationTitles(host.moduleDatabase() ?? assert.fail('open database'), {} as ConstructorParameters<typeof ConversationTitles>[1]);
  const stage = async (data: Record<string, unknown>): Promise<RequestResult> => {
    const requestId = randomUUID(), state = module.inspectAssistant();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({profile: 'bunny', expectedRevision: state?.revision, ...data}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    return core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
  };
  const ended = () => seen.filter(message => message.data.event.kind === 'turn-ended').length;
  const w = {
    core, bus, seen, titles, module, host, deadlines, tick: (ms: number) => {now += ms;},
    until,
    titled: (count: number) => until(() => titles.length >= count),
    store,
    /** Waits, in event-loop turns, until `count` title calls exist and none is still waiting for its answer. */
    async settled(count: number): Promise<TitleCall[]> {
      for (let turn = 0; turn < 2000; turn += 1) {
        const calls = store().calls();
        if (calls.length >= count && calls.every(call => call.status !== 'admitted')) return calls;
        await new Promise(resolve => {setImmediate(resolve);});
      }
      return assert.fail(`${String(count)} settled title calls: ${JSON.stringify(store().calls().map(call => call.status))}`);
    },
    async control(action: string, data: Record<string, unknown> = {}): Promise<RequestResult> {
      const requestId = randomUUID(), schema = action === 'rename' ? '2.1' : '2.0';
      return core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
        dataschema: `https://bunny.invalid/events/assistant-control/${schema}`, data: {requestId, action, expectedRevision: module.inspectAssistant()?.revision, ...data}}, {requestId, timeoutMs: 5000});
    },
    /** Starts a task in `profile` without waiting for it. */
    async start(text: string, profile = 'bunny'): Promise<void> {
      const reply = await stage({action: 'start', profile, text});
      assert.equal(reply.status, 'accepted', JSON.stringify(reply));
    },
    /** Starts a task in `profile` and waits until it ended, by its turn end. */
    async ask(text: string, profile = 'bunny'): Promise<void> {
      const before = ended();
      await w.start(text, profile);
      await until(() => ended() > before);
    },
    /** Answers the B.U.N.N.Y. task's open question or approval. */
    async answer(text: string): Promise<void> {
      const task = module.inspectAssistant()?.tasks.find(item => item.profile === 'bunny');
      const reply = await stage({action: 'answer', text, taskId: task?.taskId, questionId: task?.questionId});
      assert.equal(reply.status, 'accepted', JSON.stringify(reply));
    },
    /** The shared spend ledger's rows: each call's purpose, owner, model and reported cost in millionths of a dollar, or null while it counts its reservation. */
    spent: () => (host.moduleDatabase()?.prepare('SELECT id,purpose,owner,model,cost_micros AS cost FROM assistant_spend ORDER BY at_ms,id').all() ?? []).map(row => ({...row})),
    conversation: (profile = 'bunny') => module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.conversationId ?? assert.fail('a conversation'),
    status: () => module.inspectAssistant()?.tasks.find(task => task.profile === 'bunny'),
  };
  assert.equal((await w.control('enable')).status, 'accepted');
  return w;
}
const titleOf = (message: Message<LifecycleObservation> | undefined) => message?.data.title;
const validated = (message: Message<LifecycleObservation>) => coreValidator().validate(message, {nowMs: Date.parse(message.time)}).ok;
const MESSAGE = 'The owner sent a message.', SUCCEEDED = 'A task finished: succeeded.';
const outcomes = (calls: readonly TitleCall[]) => calls.map(call => call.outcome);

void test('the first message of a conversation earns a model-written title, published at once as display metadata and on every later observation', {timeout: 20_000}, async context => {
  const provider = titler([titled('"#1896 Session tracking."')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Please look at issue #1896 and tell me where session tracking stands.');
  await w.titled(1);
  assert.match(provider.prompts[0] ?? '', /^Current title: none\n\nLatest events:\n- The owner sent a message\.\n/);
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
  // The finished task is checked too; the model keeps the title, which publishes nothing.
  const calls = await w.settled(2);
  assert.deepEqual(calls.map(call => ({status: call.status, outcome: call.outcome, model: call.model, conversationId: call.conversationId, events: call.events})), [
    {status: 'succeeded', outcome: 'applied', model: 'claude-haiku-5-5', conversationId: w.conversation(), events: [MESSAGE]},
    {status: 'succeeded', outcome: 'kept', model: 'claude-haiku-5-5', conversationId: w.conversation(), events: [SUCCEEDED]},
  ], 'each call is recorded on the conversation with its events');
  assert.deepEqual(calls[0]?.usage, {input: 50, output: 6, cacheWrite: 0, cacheRead: 0});
  assert.match(provider.prompts[1] ?? '', /^Current title, written by the title model: #1896 Session tracking\n\nLatest events:\n- A task finished: succeeded\.\n/);
  // The shared spend ledger (Hub #2024) counts each as a conversation-level call: 50 input and 6 output tokens at $1 and $5 per million.
  assert.deepEqual(w.spent().filter(row => row.id === calls[0]?.id), [{id: calls[0]?.id, purpose: 'conversation', owner: w.conversation(), model: 'claude-haiku-5-5', cost: 80}]);
  assert.deepEqual(w.spent().map(row => row.purpose), ['conversation', 'conversation'], 'a kept title is a paid check too');
  // The second task carries the title on its observations; its start asks for no check, its end for one that keeps it.
  await w.ask('And the next step?');
  assert.deepEqual(w.seen.slice(-2).map(titleOf), [{value: '#1896 Session tracking', source: 'provider'}, {value: '#1896 Session tracking', source: 'provider'}]);
  assert.deepEqual(outcomes(await w.settled(3)), ['applied', 'kept', 'kept']);
  assert.equal(w.titles.length, 1, 'a kept title publishes nothing');
  assert.equal(JSON.stringify(w.titles.map(message => message.data)).includes('Please look'), false, 'no prompt text is published');
});

void test('after a finished task the model keeps the title or gives a new one when the topic moved', {timeout: 20_000}, async context => {
  const provider = titler([titled('Lamp schedule'), kept, kept, titled('#91 Morning routine')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('When does the lamp turn on?');
  await w.settled(2);
  await w.ask('Move it to seven.');
  assert.deepEqual(outcomes(await w.settled(3)), ['applied', 'kept', 'kept']);
  await w.ask('Different thing: the morning routine, issue #91.');
  await w.titled(2);
  assert.deepEqual(outcomes(await w.settled(4)), ['applied', 'kept', 'kept', 'applied']);
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Lamp schedule', '#91 Morning routine']);
  assert.match(provider.prompts[3] ?? '', /^Current title, written by the title model: Lamp schedule\n/);
  assert.match(provider.prompts[3] ?? '', /When does the lamp turn on\?.*Move it to seven\..*the morning routine, issue #91\./s, 'with the recent conversation');
  assert.deepEqual(w.store().record(w.conversation())?.title, {value: '#91 Morning routine', source: 'generated'});
});

void test('no task count or time gap starts a check: the third task and a task after a day make no call at their start', {timeout: 20_000}, async context => {
  // Negative control for the #2025 triggers: that release called the title model when the third task of an appearance
  // started and when the first task after a day without lifecycle evidence started, so both held tasks below would find
  // a title call already made.
  const turnModel = gatedModel(), provider = titler([titled('Lamp schedule')]);
  const w = await world(context, {provider: turnModel, titleProvider: provider});
  await w.ask('When does the lamp turn on?');
  await w.ask('Move it to seven.');
  await turns();
  await w.settled(provider.prompts.length);
  const before = provider.prompts.length;
  await w.start('HOLD: and on weekends?');
  await w.until(() => turnModel.waiting.length === 1);
  await turns();
  assert.equal(provider.prompts.length, before, 'the third task\'s start makes no title call');
  turnModel.waiting.shift()?.();
  await w.settled(before + 1);
  w.tick(SESSION_AGE_MS);
  await w.start('HOLD: a day later.');
  await w.until(() => turnModel.waiting.length === 1);
  await turns();
  assert.equal(provider.prompts.length, before + 1, 'a start after a day without evidence makes no title call');
  turnModel.waiting.shift()?.();
  const calls = await w.settled(before + 2);
  assert.deepEqual(calls.map(call => call.events), [[MESSAGE], [SUCCEEDED], [SUCCEEDED], [SUCCEEDED], [SUCCEEDED]], 'the first message and each finished task, nothing else');
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Lamp schedule'], 'the model kept the title each time');
});

void test('the owner\'s rename is published at once, drops a title in flight and its follow-up, and the model keeps it until the topic changes', {timeout: 20_000}, async context => {
  const provider = titler(['hold', kept, kept, titled('Pantry inventory')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Synthetic first request about issue #5.');
  await provider.called(1);
  await turns();
  const renamed = await w.control('rename', {profile: 'bunny', title: '  Kitchen   plans '});
  assert.equal(renamed.status, 'accepted');
  await w.titled(1);
  assert.deepEqual(w.titles.map(titleOf), [{value: 'Kitchen plans', source: 'user'}]);
  assert.equal(provider.held[0]?.signal.aborted, true, 'the title call in flight is abandoned');
  provider.held[0]?.resolve(titled('#5 Too late'));
  assert.deepEqual((await w.settled(1)).map(call => call.status), ['uncertain'], 'the abandoned call keeps unknown usage');
  await turns();
  assert.equal(provider.prompts.length, 1, 'the finished task\'s check that waited behind it is dropped with it');
  // Later checks tell the model the title is the owner's; it keeps it while the topic stays.
  w.tick(1000); await w.ask('Second synthetic request about the kitchen.');
  assert.deepEqual(outcomes(await w.settled(2)), [null, 'kept']);
  assert.match(provider.prompts[1] ?? '', /^Current title, set by the owner: Kitchen plans\n\nLatest events:\n- A task finished: succeeded\.\n/);
  w.tick(1000); await w.ask('Third synthetic request about the kitchen.');
  assert.deepEqual(outcomes(await w.settled(3)), [null, 'kept', 'kept']);
  assert.deepEqual(titleOf(w.seen.at(-1)), {value: 'Kitchen plans', source: 'user'}, 'every later observation carries the owner\'s title');
  // The topic changes: a generated title replaces the owner's, with source provider, and later observations carry it.
  w.tick(1000); await w.ask('Now a different job: count what is in the pantry.');
  await w.titled(2);
  assert.deepEqual(w.titles.map(titleOf), [{value: 'Kitchen plans', source: 'user'}, {value: 'Pantry inventory', source: 'provider'}]);
  assert.deepEqual(w.store().record(w.conversation())?.title, {value: 'Pantry inventory', source: 'generated'});
  await w.ask('How many jars?');
  assert.deepEqual(titleOf(w.seen.at(-1)), {value: 'Pantry inventory', source: 'provider'});
  // A rename before any conversation opens it; a rename to text that is no title is refused, and the title stays.
  assert.equal((await w.control('rename', {profile: 'reachy', title: 'Reachy demo'})).status, 'accepted');
  assert.equal(w.titles.length, 2, 'a conversation that never reported has no session to show it on yet');
  for (const title of ['   ', 'password=synthetic-secret', 'x'.repeat(81)]) {
    const refused = await w.control('rename', {profile: 'bunny', title});
    assert.equal(refused.status, 'rejected', title);
  }
  const blank = await w.control('rename', {profile: 'bunny', title: '   '});
  assert.equal(blank.status === 'rejected' ? blank.error.error.code : blank.status, 'invalid-request', 'a title of whitespace only is a bad title');
  assert.equal(w.titles.length, 2, 'a refused rename publishes nothing');
  assert.deepEqual(w.store().record(w.conversation())?.title, {value: 'Pantry inventory', source: 'generated'});
});

void test('compare-before-write: an answer settled after a rename advanced the generation is dropped, even when the call was not abandoned', async () => {
  const database = new DatabaseSync(':memory:'), added: unknown[] = [];
  const outbox = {transaction: <T>(work: (add: (key: string, draft: unknown) => unknown) => T) => Promise.resolve(work((key, draft) => {added.push({key, draft}); return draft;}))} as unknown as Outbox;
  let release: (reply: TitleReply) => void = () => {};
  const provider: TitleProvider = {name: 'anthropic', model: 'claude-haiku-5-5', title: () => new Promise<TitleReply>(resolve => {release = resolve;})};
  const titles = new ConversationTitles(database, {outbox, spend: {reserve: () => undefined, settle: () => {}}, now: () => 1000, after: () => () => {}, provider: () => provider,
    messages: () => [{role: 'owner', text: 'Synthetic request.'}], reported: () => true, metadata: (_id, title) => ({key: 'title', draft: title})});
  titles.touched('conversation-1');
  assert.equal(titles.started('conversation-1'), true, 'an untitled conversation is due its first title');
  const work = titles.check('conversation-1', 'bunny', {kind: 'message'});
  for (let turn = 0; turn < 10 && titles.calls().length === 0; turn += 1) await Promise.resolve();
  await outbox.transaction(add => {titles.rename(add, 'conversation-1', 'bunny', 'Owner title');});
  release(titled('#9 Stale title'));
  await work;
  assert.deepEqual(titles.calls().map(call => [call.status, call.outcome]), [['succeeded', 'dropped']]);
  assert.deepEqual(titles.record('conversation-1')?.title, {value: 'Owner title', source: 'owner'});
  assert.deepEqual(titles.published('conversation-1', 'bunny'), {value: 'Owner title', source: 'user'});
  assert.deepEqual(added, [{key: 'title', draft: {value: 'Owner title', source: 'user'}}], 'only the rename is announced');
  assert.equal(titles.started('conversation-1'), false, 'a titled conversation\'s next message is not due a check by itself');
  database.close();
});

void test('a trigger just after a call settles is never lost: at every microtask delay it starts a call or joins one that runs', async () => {
  const lost: number[] = [];
  for (let delay = 0; delay <= 40; delay += 1) {
    const database = new DatabaseSync(':memory:');
    const outbox = {transaction: <T>(work: (add: (key: string, draft: unknown) => unknown) => T) => Promise.resolve(work(() => undefined))} as unknown as Outbox;
    const prompts: string[] = [];
    let release: () => void = () => {};
    const provider: TitleProvider = {name: 'anthropic', model: 'claude-haiku-5-5', title: prompt => {
      prompts.push(prompt);
      return prompts.length === 1 ? new Promise<TitleReply>(resolve => {release = () => {resolve(kept);};}) : Promise.resolve(kept);
    }};
    const titles = new ConversationTitles(database, {outbox, spend: {reserve: () => undefined, settle: () => {}}, now: () => 1000, after: () => () => {}, provider: () => provider,
      messages: () => [{role: 'owner', text: 'Synthetic request.'}], reported: () => true, metadata: (_id, title) => ({key: 'title', draft: title})});
    const first = titles.check('conversation-1', 'bunny', {kind: 'message'});
    for (let turn = 0; turn < 20 && prompts.length === 0; turn += 1) await Promise.resolve();
    assert.equal(prompts.length, 1);
    // The first answer settles; the next trigger arrives `delay` microtasks later, in or after the run's last steps.
    release();
    for (let turn = 0; turn < delay; turn += 1) await Promise.resolve();
    const second = titles.check('conversation-1', 'bunny', {kind: 'task', result: 'succeeded'});
    await Promise.all([first, second]);
    if (titles.calls().length !== 2 || prompts.filter(Boolean).length !== 2) lost.push(delay);
    database.close();
  }
  assert.deepEqual(lost, [], 'the microtask delays whose trigger was never sent');
});

void test('one title call per conversation: triggers during a call coalesce into one follow-up check with their events', {timeout: 20_000}, async context => {
  let turn = 0;
  const failing: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: () => {
    turn += 1;
    return turn === 2 ? Promise.reject(new ProviderFault('invalid-message')) : Promise.resolve(done('Synthetic answer.'));
  }};
  const provider = titler(['hold', kept]);
  const w = await world(context, {provider: failing, titleProvider: provider});
  await w.ask('When does the lamp turn on?');
  await provider.called(1);
  await turns();
  // Two more tasks start in the still untitled conversation and finish, one failed and one succeeded, while the first
  // message's call is open.
  await w.ask('Move it to seven.');
  await turns();
  await w.ask('And on weekends?');
  await turns();
  assert.equal(provider.prompts.length, 1, 'no second call runs beside the first');
  provider.held[0]?.resolve(titled('Lamp schedule'));
  const calls = await w.settled(2);
  await turns();
  assert.equal(provider.prompts.length, 2, 'three triggers made one follow-up');
  assert.deepEqual(calls.map(call => [call.outcome, call.events]), [['applied', [MESSAGE]], ['kept', [SUCCEEDED, MESSAGE, 'A task finished: failed.']]],
    'each distinct event once, oldest first');
  assert.match(provider.prompts[1] ?? '', /^Current title, written by the title model: Lamp schedule\n\nLatest events:\n- A task finished: succeeded\.\n- The owner sent a message\.\n- A task finished: failed\.\n\n/);
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Lamp schedule']);
});

void test('a late answer after a newer check is dropped: a call past its deadline is abandoned and its follow-up decides', {timeout: 20_000}, async context => {
  const provider = titler(['hold', titled('Newer title')]);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Synthetic request about the lamp.');
  await provider.called(1);
  await turns();
  // The finished task's check waits behind the open call; the deadline abandons the call and the follow-up runs.
  w.deadlines.at(-1)?.();
  await w.titled(1);
  provider.held[0]?.resolve(titled('Late title'));
  const calls = await w.settled(2);
  await turns();
  assert.deepEqual(calls.map(call => [call.status, call.outcome]), [['uncertain', null], ['succeeded', 'applied']]);
  assert.ok(calls[1] !== undefined && calls[0] !== undefined && calls[1].generation > calls[0].generation, 'each check has a newer generation');
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Newer title'], 'the late answer publishes nothing');
  assert.equal(provider.prompts.length, 2, 'and nothing is retried');
});

void test('a failed turn\'s closing reply is saved but never reaches the title prompt, and the failed task is checked like any other', {timeout: 20_000}, async context => {
  let turn = 0;
  const failing: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: () => {
    turn += 1;
    return turn === 2 ? Promise.reject(new ProviderFault('invalid-message')) : Promise.resolve(done('Synthetic answer.'));
  }};
  const provider = titler([titled('Lamp schedule'), kept, kept, titled('#88 Lamp schedule fix')]);
  const w = await world(context, {provider: failing, titleProvider: provider});
  await w.ask('When does the lamp turn on?');
  await w.settled(2);
  await w.ask('Move it to seven.');
  assert.equal(w.module.inspectAssistant()?.tasks[0]?.status, 'failed');
  await w.settled(3);
  const history = await w.module.manifest.content?.('conversation', {query: {profile: 'bunny', view: 'recent'}, signal: new AbortController().signal});
  assert.ok(history !== undefined && !('error' in history));
  assert.match(Buffer.from(history.bytes).toString(), /The provider returned an invalid response\./, 'the closing reply is saved in the conversation');
  assert.match(provider.prompts[2] ?? '', /Latest events:\n- A task finished: failed\.\n/);
  await w.ask('That is issue #88.');
  await w.titled(2);
  assert.match(provider.prompts[3] ?? '', /Move it to seven\..*That is issue #88\./s);
  for (const prompt of provider.prompts) assert.doesNotMatch(prompt, /invalid response|The turn stopped/, 'the closing reply is not in the title prompt');
});

void test('a failed, refused, invalid or late title leaves the persona, never touches the task, and is not retried', {timeout: 20_000}, async context => {
  const provider = titler([new ProviderFault('capacity'), {text: null, usage: null}, titled('Title'), titled('token=synthetic-secret-1234'), 'hold']);
  const w = await world(context, {provider: model(), titleProvider: provider});
  // Each task of the untitled conversation is checked at its first message and when it finishes.
  await w.ask('Synthetic request One.');
  await w.settled(2);
  await w.ask('Synthetic request Two.');
  await w.settled(4);
  await w.ask('Synthetic request Three.');
  await provider.called(5);
  w.deadlines.at(-1)?.();
  await w.settled(6);
  await turns();
  assert.equal(w.titles.length, 0, 'no title is published');
  assert.ok(w.seen.every(message => titleOf(message)?.value === 'B.U.N.N.Y.'), 'the persona stands');
  assert.ok((w.module.inspectAssistant()?.tasks ?? []).every(task => task.status === 'succeeded'), 'every task succeeded');
  assert.deepEqual(w.store().calls().map(call => [call.status, call.code ?? null, call.outcome]), [
    ['failed', 'capacity', null], ['succeeded', null, 'invalid'], ['succeeded', null, 'invalid'], ['succeeded', null, 'invalid'], ['uncertain', null, null], ['succeeded', null, 'kept'],
  ], 'the abandoned call\'s check is followed by the finished task\'s, whose KEEP keeps the persona');
  assert.equal(provider.prompts.length, 6, 'one call each, no retry');
  assert.deepEqual(w.store().calls().map(call => call.answer ?? null), [null, null, 'Title', 'token=synthetic-secret-1234', null, KEEP],
    'the raw answer is kept privately for diagnosis');
  assert.equal(JSON.stringify(w.host.logs).includes('synthetic-secret-1234'), false, 'and reaches no log');
  const spent = w.spent();
  assert.deepEqual(w.store().calls().map(call => spent.find(row => row.id === call.id)?.cost === null ? 'reserved' : 'reported'), ['reserved', 'reserved', 'reported', 'reported', 'reserved', 'reported'],
    'a failed, unreported or lost call keeps counting its reservation; a reported one counts its usage');
});

void test('a profile without a real title model makes no title call and keeps its persona name', {timeout: 20_000}, async context => {
  // On the synthetic provider no profile has a title model: B.U.N.N.Y., Reachy and MicroDuck alike.
  const w = await world(context, {}, true);
  for (const profile of ['bunny', 'reachy', 'microduck']) {
    // The synthetic provider asks its fixed question first; the owner cancels it.
    await w.start('SYNTHETIC-PRIVATE-REQUEST', profile);
    await w.until(() => w.module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.status === 'waiting');
    assert.equal((await w.control('cancel', {taskId: w.module.inspectAssistant()?.tasks.find(task => task.profile === profile)?.taskId})).status, 'accepted');
  }
  await w.control('enable');
  await turns();
  assert.deepEqual(w.store().calls(), [], 'no title call is made');
  assert.equal(w.titles.length, 0);
  assert.deepEqual([...new Set(w.seen.map(message => titleOf(message)?.value))].sort(), ['B.U.N.N.Y.', 'MicroDuck', 'Reachy'], 'each keeps its persona name');
  assert.deepEqual(w.spent(), [], 'and nothing is counted');
});

void test('Reachy and MicroDuck on the configured model get topic-following titles, and each turn and check counts in the shared spend ledger', {timeout: 20_000}, async context => {
  // The configured provider and title model serve every profile (Hub #2026), so the companions' conversations are
  // titled by B.U.N.N.Y.'s rules (Hub #2075): a check after the first message and after each finished task.
  const provider = titler([titled('Pantry shelf labels'), kept, titled('Bath timer'), kept, titled('Bath playlist')]);
  const paid: ModelProvider = {name: 'anthropic', model: 'claude-sonnet-5-5', turn: () => Promise.resolve({...done('Synthetic companion answer.'), usage: {input: 40, output: 8, cacheWrite: 0, cacheRead: 0}})};
  const w = await world(context, {provider: paid, titleProvider: provider});
  await w.ask('Help me label the pantry shelf.', 'reachy');
  assert.deepEqual(outcomes(await w.settled(2)), ['applied', 'kept']);
  await w.ask('Time the bath for me.', 'microduck');
  assert.deepEqual(outcomes(await w.settled(4)), ['applied', 'kept', 'applied', 'kept']);
  // The duck's topic changes, and its title follows.
  w.tick(1000); await w.ask('Now pick songs for bath time.', 'microduck');
  assert.deepEqual(outcomes(await w.settled(5)), ['applied', 'kept', 'applied', 'kept', 'applied']);
  const reachy = w.conversation('reachy'), duck = w.conversation('microduck');
  assert.deepEqual(w.titles.map(message => [message.data.identity.sessionId, titleOf(message)?.value]),
    [[reachy, 'Pantry shelf labels'], [duck, 'Bath timer'], [duck, 'Bath playlist']]);
  assert.deepEqual(w.store().record(duck)?.title, {value: 'Bath playlist', source: 'generated'});
  // Every companion turn and every title check is a paid call in the one ledger: three task calls on the turn model and
  // five conversation-level calls on the title model, each with its reported cost.
  const spent = w.spent();
  const profileOf = (id: unknown) => (w.host.moduleDatabase()?.prepare('SELECT profile FROM assistant_tasks WHERE id=?').get(String(id)) as {profile: string} | undefined)?.profile;
  // The ledger orders rows of one instant by id, so each list is compared sorted.
  assert.deepEqual(spent.filter(row => row.purpose === 'task').map(row => `${String(profileOf(row.owner))} ${String(row.model)}`).sort(),
    ['microduck claude-sonnet-5-5', 'microduck claude-sonnet-5-5', 'reachy claude-sonnet-5-5']);
  assert.deepEqual(spent.filter(row => row.purpose === 'conversation').map(row => `${row.owner === reachy ? 'reachy' : row.owner === duck ? 'microduck' : String(row.owner)} ${String(row.model)}`).sort(),
    ['microduck claude-haiku-5-5', 'microduck claude-haiku-5-5', 'microduck claude-haiku-5-5', 'reachy claude-haiku-5-5', 'reachy claude-haiku-5-5']);
  assert.ok(spent.every(row => typeof row.cost === 'number' && row.cost > 0), `each counts its reported usage: ${JSON.stringify(spent)}`);
});

void test('a harness that injects the fixed synthetic title provider gets its fixed title, which never echoes the conversation', {timeout: 20_000}, async context => {
  const w = await world(context, {provider: model(), syntheticTitleProvider: new SyntheticTitleProvider()}, true);
  await w.ask('SYNTHETIC-PRIVATE-REQUEST');
  await w.titled(1);
  assert.deepEqual(titleOf(w.titles[0]), {value: SYNTHETIC_TITLE, source: 'provider'});
  assert.deepEqual(outcomes(await w.settled(2)), ['applied', 'unchanged'], 'the same title again changes nothing');
  assert.equal(w.store().calls()[0]?.usage?.input, 0, 'it costs nothing');
  assert.deepEqual(w.spent(), [], 'and reserves no spend');
  assert.equal(JSON.stringify(w.titles).includes('SYNTHETIC-PRIVATE-REQUEST'), false);
});

const hub = (revision: number): ModeState => ({id: 'hub', revision, mode: 'work', selectedAtMs: 0});
void test('an answered approval and a state-changing tool call each start a check with a fixed label and no tool result', {timeout: 20_000}, async context => {
  // Each task proposes a Hub mode change first; once the tool answered, the model replies.
  const turnModel: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: input => Promise.resolve(input.transcript.some(item => item.role === 'tool')
    ? done('Synthetic reply about the mode.') : {text: null, calls: [{id: `call-${String(input.transcript.length)}`, name: 'set_mode', input: {mode: 'free'}}], stop: 'tool', units: 10})};
  const dispatched: string[] = [];
  const provider = titler([titled('Hub mode')]);
  const w = await world(context, {provider: turnModel, titleProvider: provider, tools: ['set_mode'], core: () => ({sessions: [], mode: hub(7), synced: true}),
    dispatch: data => {dispatched.push(data.requestId); return Promise.resolve({status: 'accepted', requestId: data.requestId, reply: {}} as unknown as RequestResult);}});
  const waiting = () => w.until(() => w.status()?.status === 'waiting' && w.status()?.hasAnswer === false);
  await w.start('Please switch the Hub to free mode.');
  await waiting();
  await w.settled(1);
  await w.answer('approve');
  await w.until(() => w.status()?.status === 'succeeded');
  const approved = await w.settled(provider.prompts.length);
  await turns();
  const events = (calls: readonly TitleCall[]) => [...new Set(calls.flatMap(call => call.events ?? []))];
  assert.deepEqual(events(await w.settled(provider.prompts.length)).sort(),
    [MESSAGE, 'The owner approved set_mode.', 'A tool call changed state: set_mode was accepted.', SUCCEEDED].sort(), JSON.stringify(approved.map(call => call.events)));
  assert.equal(dispatched.length, 1);
  // A declined proposal is an answered approval too, and changes nothing.
  const before = w.store().calls().length;
  await w.start('Switch it to free again.');
  await waiting();
  await w.answer('decline');
  await w.until(() => w.status()?.status === 'succeeded');
  await turns();
  const later = (await w.settled(provider.prompts.length)).slice(before);
  assert.deepEqual(events(later).sort(), ['The owner declined set_mode.', SUCCEEDED].sort());
  assert.equal(dispatched.length, 1);
  // The receipt the dispatch returned is a tool result: it is in the transcript, never in a title prompt.
  for (const prompt of provider.prompts) assert.doesNotMatch(prompt, /accepted: the core accepted|operation [0-9a-f-]+-step|nothing was changed/);
  assert.ok(provider.prompts.every(prompt => Buffer.byteLength(prompt) <= TITLE_PROMPT_BYTES));
});

void test('an accepted coding hand-off starts a check whose prompt carries the brief, and the owner\'s name is kept unless the model sees a new topic', {timeout: 20_000}, async context => {
  let turn = 0;
  // Each task's first call proposes the hand-off; a later call in the task answers.
  const turnModel: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: input => {
    turn += 1;
    return Promise.resolve(input.transcript.every(item => item.role === 'owner')
      ? {text: null, calls: [{id: `call-${String(turn)}`, name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Fix the flaky timer test from issue #2041.'}}], stop: 'tool', units: 10}
      : done('Handed off.'));
  }};
  const delegated: string[] = [];
  const provider = titler([titled('Timer question'), titled('#2041 Flaky timer test')]);
  const w = await world(context, {provider: turnModel, titleProvider: provider, tools: ['delegate_coding'],
    coding: () => ({available: true, endpointId: 'worker', revision: 1}),
    delegate: data => {delegated.push(data.brief); return Promise.resolve({status: 'accepted', requestId: data.requestId} as unknown as RequestResult);}});
  const awaitingApproval = () => w.until(() => w.status()?.status === 'waiting' && w.status()?.questionId !== null && w.status()?.hasAnswer === false);
  await w.start('Can the worker look at the flaky timer test?');
  await w.titled(1);
  await awaitingApproval();
  await w.answer('approve');
  await w.until(() => delegated.length === 1 && w.status()?.status === 'waiting');
  await w.titled(2);
  const calls = await w.settled(provider.prompts.length);
  const handedOff = calls.find(call => call.events?.includes('A coding hand-off was accepted.') === true) ?? assert.fail(JSON.stringify(calls.map(call => call.events)));
  assert.match(provider.prompts[calls.indexOf(handedOff)] ?? '', /Delegated to the coding worker in agent-device-hub: Fix the flaky timer test from issue #2041\./, 'the brief is in the prompt');
  assert.deepEqual(titleOf(w.titles[1]), {value: '#2041 Flaky timer test', source: 'provider'});
  // After a rename, a later hand-off is checked with the owner's name, which the model keeps.
  assert.equal((await w.control('rename', {profile: 'bunny', title: 'Timer work'})).status, 'accepted');
  const cancelled = await w.control('cancel', {taskId: w.status()?.taskId});
  assert.equal(cancelled.status, 'accepted', JSON.stringify(cancelled));
  await w.until(() => w.status()?.status === 'cancelled');
  await w.start('And the other timer test?');
  await awaitingApproval();
  await w.answer('approve');
  await w.until(() => delegated.length === 2);
  await turns();
  const after = await w.settled(provider.prompts.length);
  assert.ok(after.some(call => call.events?.includes('A coding hand-off was accepted.') === true && call.outcome === 'kept'), JSON.stringify(after.map(call => [call.events, call.outcome])));
  assert.ok(provider.prompts.slice(-1).every(prompt => prompt.startsWith('Current title, set by the owner: Timer work\n')));
  assert.deepEqual(w.titles.map(message => titleOf(message)?.value), ['Timer question', '#2041 Flaky timer test', 'Timer work']);
});

void test('a hand-off that waits for its companion\'s busy slot is an accepted hand-off for the title, checked once (Hub #2028)', {timeout: 20_000}, async context => {
  const turnModel: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: input => Promise.resolve(input.transcript.every(item => item.role === 'owner')
    ? {text: null, calls: [{id: 'call-1', name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Fix the flaky timer test from issue #2041.'}}], stop: 'tool', units: 10}
    : done('Handed off.'))};
  const provider = titler([titled('Timer question'), titled('#2041 Flaky timer test')]);
  const w = await world(context, {provider: turnModel, titleProvider: provider, tools: ['delegate_coding'],
    coding: () => ({available: true, endpointId: 'worker', revision: 1}),
    delegate: data => Promise.resolve({status: 'waiting' as const, requestId: data.requestId})});
  await w.start('Can the worker look at the flaky timer test?');
  await w.titled(1);
  await w.until(() => w.status()?.status === 'waiting' && w.status()?.questionId !== null && w.status()?.hasAnswer === false);
  await w.answer('approve');
  await w.until(() => w.status()?.status === 'waiting' && w.status()?.questionId?.includes('delegation') === true);
  await w.titled(2);
  await turns();
  const calls = await w.settled(provider.prompts.length);
  assert.equal(calls.filter(call => call.events?.includes('A coding hand-off was accepted.') === true).length, 1, JSON.stringify(calls.map(call => call.events)));
});

void test('a coding hand-off\'s result starts a check labelled with its outcome alone; the worker\'s text never reaches the title model', {timeout: 20_000}, async context => {
  let turn = 0;
  const turnModel: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: () => {
    turn += 1;
    return Promise.resolve(turn === 1 ? {text: null, calls: [{id: 'call-1', name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Add a unit test for the readout generator.'}}], stop: 'tool', units: 10}
      : done('Synthetic summary of the worker result.'));
  }};
  const provider = titler([titled('Readout generator test')]);
  const w = await world(context, {provider: turnModel, titleProvider: provider, tools: ['delegate_coding']});
  const work: {action: string; operationId: string}[] = [], endpointId = 'worker-endpoint-1';
  await w.core.respond<{requestId: string}>('bunny.cmd.coding-dispatch.assistant', async command => {
    const answer = await w.core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  const worker = w.bus.connect('bunny/parts/coding-worker');
  context.after(() => worker.close());
  await worker.respond<{action: string; operationId: string}>('bunny.cmd.coding-work.*', command => {work.push(command.data); return {status: 'accepted'};});
  const progress = (data: object) => worker.publish(`bunny.event.coding-progress.${endpointId}`, {kind: 'occurrence', type: 'org.bunny.coding.progress.observed', subject: endpointId,
    dataschema: 'https://bunny.invalid/events/coding-progress/2.0', data});
  assert.equal((await worker.request(`bunny.cmd.coding-endpoint.${endpointId}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpointId,
    dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: 'enable-1', action: 'enable'}}, {timeoutMs: 5000})).status, 'accepted');
  await w.until(() => w.module.inspectCoding()?.availability === 'available');
  await w.start('Please delegate: add a test.');
  await w.until(() => w.status()?.status === 'waiting');
  await w.answer('approve');
  await w.until(() => work.length === 1 && w.status()?.status === 'waiting');
  await progress({operationId: work[0]?.operationId, status: 'started'});
  await progress({operationId: work[0]?.operationId, status: 'completed', result: {outcome: 'tested-candidate', repository: 'agent-device-hub', base: 'a'.repeat(40), head: 'a'.repeat(40),
    changedFiles: ['scripts/tests/readout.test.mjs'], checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: [], summary: 'WORKER-PRIVATE-SUMMARY.', sessionId: null, usage: null}});
  await w.until(() => w.status()?.status === 'succeeded');
  await turns();
  const calls = await w.settled(provider.prompts.length);
  assert.ok(calls.some(call => call.events?.includes('A coding hand-off\'s result arrived: completed.') === true), JSON.stringify(calls.map(call => call.events)));
  for (const prompt of provider.prompts) assert.doesNotMatch(prompt, /WORKER-PRIVATE-SUMMARY|tested-candidate|readout\.test/, 'no worker result text');
});

/** The module on a bus with a manual clock that can be stopped and started again on the same state, as a restart does. */
async function restartable(context: TestContext, options: CompanionsOptions) {
  const now = 1_790_000_000_000;
  const time = {clock: {now: () => now}, scheduler: {after: () => () => {}}};
  const dir = await mkdtemp(join(tmpdir(), 'assistant-titles-restart-')), bus = new InProcessBus({now: time.clock.now}), core = bus.connect('bunny/core');
  await core.serveSync(['session', 'mode'], () => ({revision: 0, states: []}));
  const make = () => {const module = createCompanionsModule({prices: PRICES, ...options}); return {module, host: new ModuleHarness(module, {bus, stateDir: dir, spans: new RecordedSpans(), section: {}, ...time})};};
  let {module, host} = make();
  await host.start();
  context.after(async () => {await host.stop(); await core.close(); await rm(dir, {recursive: true, force: true});});
  const database = () => host.moduleDatabase() ?? assert.fail('open database');
  const calls = () => new ConversationTitles(database(), {} as ConstructorParameters<typeof ConversationTitles>[1]).calls();
  const status = () => module.inspectAssistant()?.tasks.find(task => task.profile === 'bunny');
  const until = async (check: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 5000 && !check(); turn += 1) await new Promise(resolve => {setImmediate(resolve);});
    assert.ok(check(), 'the awaited condition holds');
  };
  const send = async (data: Record<string, unknown>): Promise<void> => {
    const requestId = randomUUID();
    const staged = await module.manifest.upload?.stage({target: 'assistant', name: 'input.json', requestId, signal: new AbortController().signal,
      bytes: Buffer.from(JSON.stringify({profile: 'bunny', expectedRevision: module.inspectAssistant()?.revision, ...data}))});
    assert.ok(staged !== undefined && !('error' in staged), JSON.stringify(staged));
    const reply = await core.request('bunny.cmd.assistant-input.assistant', {type: 'org.bunny.assistant.input.requested', subject: 'assistant',
      dataschema: 'https://bunny.invalid/events/assistant-input/2.0', data: {requestId, ...staged.data}}, {requestId, timeoutMs: 5000});
    assert.equal(reply.status, 'accepted', JSON.stringify(reply));
  };
  const enable = await core.request('bunny.cmd.assistant-control.assistant', {type: 'org.bunny.assistant.control.requested', subject: 'assistant',
    dataschema: 'https://bunny.invalid/events/assistant-control/2.0', data: {requestId: 'enable', action: 'enable', expectedRevision: module.inspectAssistant()?.revision}}, {requestId: 'enable', timeoutMs: 5000});
  assert.equal(enable.status, 'accepted');
  return {core, bus, database, calls, status, until, module: () => module,
    start: (text: string) => send({action: 'start', text}),
    answer: (text: string) => send({action: 'answer', text, taskId: status()?.taskId, questionId: status()?.questionId}),
    async settled(count: number): Promise<TitleCall[]> {
      await until(() => calls().length >= count && calls().every(call => call.status !== 'admitted'));
      return calls();
    },
    async restart(): Promise<void> {await host.stop(); ({module, host} = make()); await host.start();},
  };
}

void test('startup reconciliation that finds a finished turn starts no title check', {timeout: 20_000}, async context => {
  const provider = titler([titled('Lamp schedule')]);
  const w = await restartable(context, {provider: model(), titleProvider: provider});
  await w.start('When does the lamp turn on?');
  await w.until(() => w.status()?.status === 'succeeded');
  await w.settled(2);
  await turns();
  assert.equal(provider.prompts.length, 2, 'the first message and the finished task');
  // A crash after the graph saved its result and before the task's end committed leaves the task running in the store.
  w.database().prepare("UPDATE assistant_tasks SET status='running', record=json_set(record,'$.status','running')").run();
  await w.restart();
  assert.equal(w.status()?.status, 'succeeded', 'startup reconciled the saved result');
  await turns();
  assert.equal(provider.prompts.length, 2, 'the restart made no title call');
  assert.equal(w.calls().length, 2);
});

void test('a coding hand-off left pending at stop is settled at start without a title check; the resumed task\'s end is checked', {timeout: 20_000}, async context => {
  let turn = 0;
  const turnModel: ModelProvider = {name: 'synthetic', model: 'synthetic', turn: () => {
    turn += 1;
    return Promise.resolve(turn === 1 ? {text: null, calls: [{id: 'call-1', name: 'delegate_coding', input: {repository: 'agent-device-hub', brief: 'Add a unit test for the readout generator.'}}], stop: 'tool', units: 10}
      : done('Synthetic summary of the lost hand-off.'));
  }};
  const provider = titler([titled('Readout generator test')]);
  const w = await restartable(context, {provider: turnModel, titleProvider: provider, tools: ['delegate_coding']});
  const work: {action: string; operationId: string}[] = [], endpointId = 'worker-endpoint-1';
  await w.core.respond<{requestId: string}>('bunny.cmd.coding-dispatch.assistant', async command => {
    const answer = await w.core.request('bunny.cmd.coding-run.assistant', {type: 'org.bunny.coding.run.requested', subject: 'assistant', dataschema: 'https://bunny.invalid/events/coding-run/2.0', data: command.data},
      {timeoutMs: 5000, requestId: command.data.requestId, parent: command});
    return answer.status === 'accepted' ? {status: 'accepted'} : answer.error;
  });
  const worker = w.bus.connect('bunny/parts/coding-worker');
  context.after(() => worker.close());
  await worker.respond<{action: string; operationId: string}>('bunny.cmd.coding-work.*', command => {work.push(command.data); return {status: 'accepted'};});
  assert.equal((await worker.request(`bunny.cmd.coding-endpoint.${endpointId}`, {type: 'org.bunny.coding.endpoint.requested', subject: endpointId,
    dataschema: 'https://bunny.invalid/events/coding-endpoint/2.0', data: {requestId: 'enable-1', action: 'enable'}}, {timeoutMs: 5000})).status, 'accepted');
  await w.until(() => w.module().inspectCoding()?.availability === 'available');
  await w.start('Please delegate: add a test.');
  await w.until(() => w.status()?.status === 'waiting');
  await w.answer('approve');
  await w.until(() => work.length === 1 && w.status()?.status === 'waiting');
  await turns();
  const before = (await w.settled(provider.prompts.length)).length;
  // The module stops while the worker holds the hand-off; at start the coordinator settles it as an uncertain result.
  await w.restart();
  await w.until(() => w.status()?.status === 'succeeded');
  await turns();
  const after = (await w.settled(provider.prompts.length)).slice(before);
  const labels = after.flatMap(call => call.events ?? []);
  assert.equal(labels.includes('A coding hand-off\'s result arrived: uncertain.'), false, JSON.stringify(labels));
  assert.deepEqual(labels, [SUCCEEDED], 'only the resumed task\'s end is checked');
});

void test('a check the spend limits refuse is never sent and leaves the title as it was; without prices the title model is priced at its built-in tier', {timeout: 20_000}, async context => {
  const provider = titler([titled('#7 Never sent')]);
  // A reservation of 1,024 output tokens at $20,000 per million passes the $20 daily limit.
  const w = await world(context, {provider: model(), titleProvider: provider, prices: {'claude-haiku-5-5': {input: 1, output: 20_000, cacheWrite: 1, cacheRead: 1}}});
  await w.ask('Synthetic request.');
  assert.deepEqual((await w.settled(2)).map(call => [call.status, call.code]), [['failed', 'capacity'], ['failed', 'capacity']], 'the first message and the finished task');
  await turns();
  assert.equal(provider.prompts.length, 0, 'nothing is sent');
  assert.deepEqual(w.spent(), [], 'a refused reservation records nothing');
  assert.equal(w.titles.length, 0);
  assert.equal(w.module.inspectAssistant()?.tasks[0]?.status, 'succeeded', 'the task is untouched');
  // A titled conversation whose title call spent the day's limit: the next check is refused, and the title stays.
  const spender = titler([{text: 'Lamp schedule', usage: {input: 0, output: 4_000_000, cacheWrite: 0, cacheRead: 0}}]);
  const titledWorld = await world(context, {provider: model(), titleProvider: spender});
  await titledWorld.ask('Synthetic lamp request.');
  assert.deepEqual((await titledWorld.settled(2)).map(call => [call.status, call.code ?? null, call.outcome]), [['succeeded', null, 'applied'], ['failed', 'capacity', null]]);
  await turns();
  assert.equal(spender.prompts.length, 1, 'the refused check is not sent and not retried');
  assert.deepEqual(titledWorld.titles.map(message => titleOf(message)?.value), ['Lamp schedule']);
  assert.deepEqual(titledWorld.store().record(titledWorld.conversation())?.title, {value: 'Lamp schedule', source: 'generated'});
  // With no configured prices (Hub #2047) claude-haiku-5-5 takes its built-in lower tier: 50 input and 6 output tokens at $0.10 and $0.50 per million.
  const builtIn = await world(context, {provider: model(), titleProvider: titler([titled('#8 Built-in price')]), prices: {}});
  await builtIn.ask('Synthetic request.');
  await builtIn.titled(1);
  const [first] = await builtIn.settled(2);
  assert.equal(first?.status, 'succeeded');
  assert.deepEqual(builtIn.spent().filter(row => row.id === first?.id).map(row => row.cost), [Math.ceil(50 * 0.1 + 6 * 0.5)]);
});

void test('a title call that Anthropic\'s monthly spend limit refuses keeps the persona and leaves the task untouched', {timeout: 20_000}, async context => {
  const provider = titler([new ProviderFault('capacity', false, undefined, SPEND_LIMIT_REACHED)]);
  const w = await world(context, {provider: model(), titleProvider: provider, prices: {}});
  await w.ask('Synthetic request.');
  const calls = await w.settled(2);
  await turns();
  assert.deepEqual([calls[0]?.status, calls[0]?.code], ['failed', 'capacity']);
  assert.equal(provider.prompts.length, 2, 'one request per check, no retry');
  assert.equal(w.titles.length, 0, 'the persona name stands');
  assert.equal(w.module.inspectAssistant()?.tasks[0]?.status, 'succeeded');
});

void test('stopping the module abandons a title call in flight without waiting for it', {timeout: 20_000}, async context => {
  const provider = titler(['hold']);
  const w = await world(context, {provider: model(), titleProvider: provider});
  await w.ask('Synthetic request.');
  await provider.called(1);
  await w.host.stop();
  assert.equal(provider.held[0]?.signal.aborted, true);
  assert.equal(provider.prompts.length, 1, 'the waiting follow-up is not sent');
});
