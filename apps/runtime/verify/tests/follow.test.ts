// Hub #950: following one request through a disposable run's diagnostics. The query reads the run's journal records and
// its spans for one request or trace, and says what it could not read: records that were refused, spans that were
// evicted, a runtime that ended without its stop record, and the caps of the query itself. An absent record is reported
// as absent, never as proof that nothing happened, and nothing but registered, validated values reaches the output.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startMemoryHarness} from '../../tests/scenarios/memory.js';
import {runScenario, scenario} from '../../tests/scenarios/catalog.js';
import {INSTANCE_ID} from '../../src/log.js';
import {RUNTIME_SCOPE, record, runtimeResource, type LogRecord, type Resource} from '../../src/record.js';
import {contextOf, fixture, run, setMode, waitFor} from '../../tests/support.js';
import {
  FollowRefusal, follow, limitsOf, queryOf, selectorOf, type Evidence, type Followed, type JournalEntry, type Limits, type Selector, type SpanEvidence,
} from '../follow.js';

const SECRET = 'tok_SYNTHETIC950';
const NOW = Date.parse('2026-10-07T12:00:00.000Z');

type Captured = {journal: JournalEntry[]; spans: string[]};
let captured: Promise<Captured> | undefined;

/** The end-to-end scenario's records and spans on the remote transport, as the memory harness keeps them. */
function endToEnd(): Promise<Captured> {
  captured ??= (async () => {
    const h = await startMemoryHarness(scenario('end-to-end')?.seed ?? {modules: [], follows: []}, 'remote');
    try {
      const result = await runScenario(scenario('end-to-end') ?? {id: '', title: '', seed: {modules: [], follows: []}, steps: []}, h);
      assert.equal(result.outcome, 'passed');
      return {journal: h.logs().map(({generation, record: entry}) => ({generation, record: entry})), spans: [...await h.spans()]};
    } finally {
      await h.close();
    }
  })();
  return captured;
}

/** A `runtime.stopped` record of one generation, as a runtime writes it on a clean stop. */
function stopped(generation: number, dropped = 0, failed = 0, resource: Resource = runtimeResource('test', INSTANCE_ID)): JournalEntry {
  const entry = record('info', RUNTIME_SCOPE, 'runtime.stopped', {'bunny.telemetry.dropped_count': dropped, 'bunny.telemetry.failure_count': failed}, NOW, resource);
  assert.ok(entry, 'a valid record');
  return {generation, record: entry};
}

const present = (lines: readonly string[], extra: Partial<Extract<SpanEvidence, {recorded: true}>> = {}): SpanEvidence =>
  ({recorded: true, lines, evicted: 0, unreadable: 0, truncated: false, ...extra});

/** The scenario's evidence: the end-to-end path crashed generation 1 and restarted cleanly after it, to generation 4. */
async function evidence(over: Partial<Evidence> = {}): Promise<Evidence> {
  const {journal, spans} = await endToEnd();
  return {generation: 4, minimumLevel: 'info', skippedLines: 0, journal: [...journal, stopped(2), stopped(3)], spans: present(spans), ...over};
}

const ids = (followed: Followed): (string | undefined)[] => followed.records.map(entry => entry.attributes['bunny.request.id'] as string | undefined);
const events = (followed: Followed): string[] => followed.records.map(entry => entry.event);

void test('a command that succeeded: its decisions, its module\'s records and its spans, with one trace and nothing lost', {timeout: 60_000}, async () => {
  const followed = follow(await evidence(), {request: 'req-gap'});
  assert.equal(followed.result, 'found');
  assert.equal(followed.schema, 'runtime-follow/1.0');
  assert.deepEqual(events(followed), ['runtime.command.admitted', 'command.executing', 'outcome.published', 'command.completed', 'runtime.command.replied', 'message.received']);
  assert.deepEqual(followed.decision, {admitted: 1, unended: 0, ended: true, endings: [{generation: 1, event: 'replied', level: 'INFO'}]});
  assert.deepEqual(followed.names, {
    'bunny.command.execute': 1, 'bunny.command.queue': 1, 'bunny.command.request': 1, 'bunny.device.call': 1, 'bunny.outcome.publish': 1,
  });
  assert.equal(followed.traces.length, 1, 'the command, its module and its outcome share one trace');
  assert.ok(followed.records.every(entry => entry.attributes['bunny.request.id'] === 'req-gap'));
  assert.ok(followed.spans.every(span => span.attributes['bunny.request.id'] === 'req-gap' || span.name === 'bunny.device.call'));
  assert.deepEqual(followed.omitted, {records: 0, spans: 0, traces: 0, endings: 0});
  for (const span of followed.spans) {
    assert.ok(span.durationMs >= 0 && span.startedAt.endsWith('Z'), `${span.name} has a start and a duration`);
    assert.notEqual(span.parent?.state, 'missing', `${span.name} has its parent`);
  }
  const request = followed.spans.find(span => span.name === 'bunny.command.request');
  const queue = followed.spans.find(span => span.name === 'bunny.command.queue');
  assert.equal(request?.kind, 'server');
  assert.deepEqual(request?.parent?.state, 'caller', 'a remote command\'s request span continues its caller\'s context, which the run does not record');
  assert.deepEqual(queue?.parent, {spanId: request?.spanId, state: 'span'});
  assert.ok(followed.gaps.some(gap => gap.kind === 'generation-ended-without-stop'), 'the crashed generation 1 still shows');
});

void test('a command refused at its deadline: one WARN refusal, the spans it had, and no span for the work it never reached', {timeout: 60_000}, async () => {
  const followed = follow(await evidence(), {request: 'req-queued'});
  assert.deepEqual(followed.decision, {admitted: 1, unended: 0, ended: true, endings: [{generation: 1, event: 'refused', level: 'WARN', code: 'expired'}]});
  assert.equal(followed.names['bunny.command.request'], 1);
  assert.equal(followed.names['bunny.command.queue'], 1);
  assert.equal(followed.names['bunny.command.execute'], undefined, 'it never started, so the query reports no execute span');
  assert.equal(followed.names['bunny.device.call'], undefined);
  assert.equal(events(followed).includes('command.executing'), false, 'the lamp never saw it');
});

void test('a command whose effect is uncertain: the uncertain ending at WARN, and the outcome that reached history later', {timeout: 60_000}, async () => {
  const followed = follow(await evidence(), {request: 'req-held'});
  assert.deepEqual(followed.decision.endings, [{generation: 1, event: 'uncertain', level: 'WARN', code: 'uncertain-result'}]);
  assert.ok(events(followed).includes('outcome.published'), 'the late outcome is in the records');
  assert.equal(followed.names['bunny.device.call'], 1);
  const request = followed.spans.find(span => span.name === 'bunny.command.request');
  assert.equal(request?.status, 'error', 'the uncertain request span ends with error');
});

void test('a replayed outcome: published once, its replay a new trace linked to the stored context, never its child', {timeout: 60_000}, async () => {
  const followed = follow(await evidence(), {request: 'req-lost'});
  assert.equal(events(followed).filter(event => event === 'outcome.published').length, 1, 'one publication record, however often it was sent');
  const publishes = followed.spans.filter(span => span.name === 'bunny.outcome.publish');
  assert.equal(publishes.length, 2, 'it went out twice');
  const [first, replay] = publishes;
  assert.ok(first && replay);
  assert.equal(replay.parent, undefined, 'the replay is a root');
  assert.equal(replay.links.length, 1);
  assert.equal(replay.links[0]?.spanId, first.parent?.spanId, 'it links to the context the first publication continued');
  assert.notEqual(replay.traceId, first.traceId);
  assert.equal(followed.traces.length, 2, 'both traces are named, so the operator can follow the replay');
  assert.deepEqual(followed.records.filter(entry => entry.event === 'message.received').map(entry => entry.attributes['bunny.outcome']), ['accepted', 'duplicate'],
    'the core took the replay as a duplicate');
});

void test('a command whose runtime crashed: no ending is recorded, the generation shows as ended without its stop record, and nothing is claimed', {timeout: 60_000}, async () => {
  // The memory harness stops the runtime by throwing at the crash point, so its bus still answers. A killed runtime writes
  // nothing more: drop what generation 1 would have written after the lamp's commit, as the verification run shows it.
  const base = await evidence();
  const request = (line: string): boolean => line.includes('"req-crash"');
  const afterKill = (entry: JournalEntry): boolean => entry.generation === 1 && (entry.record as LogRecord).attributes['bunny.request.id'] === 'req-crash' &&
    ['command.completed', 'runtime.command.replied'].includes((entry.record as LogRecord).event_name);
  const spans = base.spans.recorded ? base.spans.lines.filter(line => !(request(line) && line.includes('bunny.command.execute'))) : [];
  const followed = follow({...base, journal: base.journal.filter(entry => !afterKill(entry)), spans: present(spans)}, {request: 'req-crash'});
  assert.equal(followed.result, 'found');
  assert.deepEqual(followed.decision, {admitted: 1, unended: 1, ended: false, endings: []});
  assert.deepEqual(followed.gaps.filter(gap => gap.kind === 'generation-ended-without-stop').map(gap => gap.kind === 'generation-ended-without-stop' && gap.generation), [1]);
  assert.equal(followed.names['bunny.command.execute'], undefined, 'the execute span never ended, so it is not reported');
  assert.equal(followed.names['bunny.device.call'], 1, 'the device call ended before the kill');
});

void test('a request nothing carries is reported as absent, with every reason the evidence could be incomplete, and never as proof', {timeout: 60_000}, async () => {
  const followed = follow(await evidence(), {request: 'req-never-sent'});
  assert.equal(followed.result, 'none-found');
  assert.deepEqual([followed.records, followed.spans, followed.traces], [[], [], []]);
  assert.match(followed.note, /not evidence that nothing happened/);
  assert.ok(followed.gaps.some(gap => gap.kind === 'generation-ended-without-stop'), 'the gap that makes absence unprovable is named');
  assert.equal(JSON.stringify(followed).includes('req-never-sent'), true, 'the query it answered is echoed, validated');
});

void test('a query over its limits says so: what it matched, what it returned and what it left out', {timeout: 60_000}, async () => {
  const all = follow(await evidence(), {request: 'req-gap'});
  const capped = follow(await evidence(), {request: 'req-gap'}, {records: 2, spans: 1});
  assert.equal(capped.records.length, 2);
  assert.equal(capped.spans.length, 1);
  assert.deepEqual(capped.matched, all.matched);
  assert.deepEqual(capped.omitted, {records: all.matched.records - 2, spans: all.matched.spans - 1, traces: 0, endings: 0});
  assert.ok(capped.gaps.some(gap => gap.kind === 'capped'), 'the cap is a named gap');
  assert.deepEqual(capped.records.map(entry => entry.event), events(all).slice(0, 2), 'the first in order, so the start of the chain stays');
  assert.equal(all.gaps.some(gap => gap.kind === 'capped'), false, 'and no cap is reported when nothing was left out');
});

void test('a request never takes another request\'s records, even on the same trace; the query counts what else the trace holds', {timeout: 60_000}, () => {
  const resource = runtimeResource('test', INSTANCE_ID);
  const trace = {traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), flags: '01'};
  const made = (event: string, request: string | undefined): JournalEntry => {
    const entry = record('info', RUNTIME_SCOPE, event, request === undefined ? {} : {'bunny.request.id': request}, NOW, resource, trace);
    assert.ok(entry);
    return {generation: 1, record: entry};
  };
  const journal = [made('runtime.command.admitted', 'req-a'), made('runtime.command.admitted', 'req-b'), made('runtime.command.replied', 'req-a'),
    made('runtime.command.replied', 'req-b'), made('runtime.ready', undefined), stopped(1)];
  const followed = follow({generation: 1, minimumLevel: 'info', skippedLines: 0, journal, spans: present([])}, {request: 'req-a'});
  assert.deepEqual(ids(followed), ['req-a', 'req-a'], 'only its own');
  assert.deepEqual(followed.otherOnTrace, {records: 3, spans: 0}, 'the trace holds three more, which the trace query shows');
  const bytrace = follow({generation: 1, minimumLevel: 'info', skippedLines: 0, journal, spans: present([])}, {trace: trace.traceId});
  assert.equal(bytrace.records.length, 5, 'the trace query takes all of it');
});

void test('the trace query takes a trace\'s records and spans, and the span of a replay that links to it', {timeout: 60_000}, async () => {
  const lost = follow(await evidence(), {request: 'req-lost'});
  const original = lost.spans.find(span => span.name === 'bunny.outcome.publish' && span.links.length === 0)?.traceId;
  assert.ok(original !== undefined);
  const followed = follow(await evidence(), {trace: original});
  assert.ok(followed.spans.every(span => span.traceId === original || span.via === 'link'));
  const replay = followed.spans.find(span => span.via === 'link');
  assert.equal(replay?.name, 'bunny.outcome.publish', 'the replay is named, though it is in another trace');
  assert.ok(followed.traces.includes(replay?.traceId ?? ''), 'and its trace is listed to follow next');
  assert.ok(followed.records.every(entry => entry.traceId === original));
});

void test('what the run could not keep is reported: spans evicted, a file read cut short, lost telemetry, and records and spans it could not read', {timeout: 60_000}, async () => {
  const base = await evidence({journal: [...(await endToEnd()).journal, stopped(2, 3, 4), stopped(3)]});
  const kinds = (followed: Followed): string[] => followed.gaps.map(gap => gap.kind).sort();
  const lost = follow({...base, spans: present((await endToEnd()).spans, {evicted: 7, unreadable: 2, truncated: true})}, {request: 'req-gap'});
  assert.deepEqual(lost.gaps.find(gap => gap.kind === 'spans-evicted'), {kind: 'spans-evicted', count: 7, meaning: lost.gaps.find(gap => gap.kind === 'spans-evicted')?.meaning});
  assert.ok(kinds(lost).includes('spans-truncated'));
  assert.deepEqual(lost.gaps.find(gap => gap.kind === 'telemetry-lost'), {kind: 'telemetry-lost', generation: 2, dropped: 3, failed: 4, meaning: lost.gaps.find(gap => gap.kind === 'telemetry-lost')?.meaning});
  assert.ok(lost.gaps.some(gap => gap.kind === 'unreadable'));
  assert.equal(lost.searched.unreadableSpans, 2);
  const unknown = follow({...base, spans: present((await endToEnd()).spans, {evicted: undefined})}, {request: 'req-gap'});
  assert.ok(kinds(unknown).includes('spans-eviction-unknown'));
  const none = follow({...base, spans: {recorded: false, reason: 'not-recorded'}}, {request: 'req-gap'});
  assert.deepEqual(none.spans, []);
  assert.ok(kinds(none).includes('spans-not-recorded'));
  const unreadable = follow({...base, spans: {recorded: false, reason: 'unreadable'}}, {request: 'req-gap'});
  assert.ok(kinds(unreadable).includes('spans-unreadable'));
});

void test('a span whose parent is not kept says so, and a span that is not kept is never reported', {timeout: 60_000}, async () => {
  const {spans} = await endToEnd();
  const parsed = (line: string): {name: string; spanId: string; requestId: string | undefined} => {
    const span = (JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: {name: string; spanId: string; attributes: {key: string; value: {stringValue?: string}}[]}[]}[]}[]}).resourceSpans[0]?.scopeSpans[0]?.spans[0];
    return {name: span?.name ?? '', spanId: span?.spanId ?? '', requestId: span?.attributes.find(item => item.key === 'bunny.request.id')?.value.stringValue};
  };
  const mine = spans.filter(line => parsed(line).requestId === 'req-gap');
  const requestLine = mine.find(line => parsed(line).name === 'bunny.command.request');
  assert.ok(requestLine !== undefined);
  const withoutRequest = follow(await evidence({spans: present(spans.filter(line => line !== requestLine))}), {request: 'req-gap'});
  assert.equal(withoutRequest.names['bunny.command.request'], undefined, 'it is not reported present');
  // The device span continued the remote caller's context, which only the request span names, so it is unexplained too.
  assert.deepEqual(withoutRequest.spans.filter(span => span.parent?.state === 'missing').map(span => span.name).sort(),
    ['bunny.command.execute', 'bunny.command.queue', 'bunny.device.call']);
  assert.ok(withoutRequest.gaps.some(gap => gap.kind === 'parent-missing' && gap.spans === 3));
  const executeLine = mine.find(line => parsed(line).name === 'bunny.command.execute');
  const withoutExecute = follow(await evidence({spans: present(spans.filter(line => line !== executeLine))}), {request: 'req-gap'});
  assert.equal(withoutExecute.names['bunny.command.execute'], undefined);
  assert.equal(withoutExecute.spans.some(span => span.name === 'bunny.command.execute'), false);
});

void test('a record or span that is not a contract record is counted and never shown, so no secret reaches the output', {timeout: 60_000}, async () => {
  const base = await evidence();
  const genuine = base.journal.find(entry => (entry.record as LogRecord).attributes['bunny.request.id'] === 'req-gap')?.record as LogRecord | undefined;
  assert.ok(genuine, 'a real record to poison');
  const poisoned = JSON.parse(JSON.stringify(genuine)) as LogRecord;
  poisoned.attributes['http.url'] = `https://device.invalid/?token=${SECRET}`;
  const forged: unknown[] = [
    {event_name: 'runtime.command.admitted', attributes: {'bunny.request.id': 'req-gap', detail: SECRET}},
    {...genuine, message: `the token is ${SECRET}`},
    poisoned,
  ];
  // A span that is shaped as the adapter projects it, with one more attribute that the catalog does not register.
  const genuineSpan = base.spans.recorded ? base.spans.lines.find(line => line.includes('"req-gap"') && line.includes('bunny.command.queue')) : undefined;
  assert.ok(genuineSpan !== undefined, 'a real span to poison');
  const document = JSON.parse(genuineSpan) as {resourceSpans: {scopeSpans: {spans: {attributes: object[]}[]}[]}[]};
  document.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.attributes.push({key: 'exception.message', value: {stringValue: SECRET}});
  const poisonedSpan = JSON.stringify(document);
  const shapeless = JSON.stringify({resourceSpans: [{resource: {attributes: []}, scopeSpans: [{scope: {name: 'bunny.runtime', version: '1.0.0'},
    spans: [{traceId: 'c'.repeat(32), spanId: 'd'.repeat(16), name: 'bunny.command.request', attributes: [{key: 'exception.message', value: {stringValue: SECRET}}]}]}]}]});
  const followed = follow({...base, journal: [...base.journal, ...forged.map((entry): JournalEntry => ({generation: 1, record: entry}))],
    spans: present([...(base.spans.recorded ? base.spans.lines : []), poisonedSpan, shapeless, `not json ${SECRET}`])}, {request: 'req-gap'});
  assert.equal(JSON.stringify(followed).includes(SECRET), false, 'a secret reaches no field');
  assert.equal(followed.searched.unreadableRecords, 3);
  assert.equal(followed.searched.unreadableSpans, 3, 'the poisoned span, the one with no shape and the line that is not JSON');
  assert.deepEqual(events(followed), events(follow(base, {request: 'req-gap'})), 'the forged records took no part in the answer');
  const gap = followed.gaps.find(entry => entry.kind === 'unreadable');
  assert.ok(gap, 'and the loss is a named gap');
});

void test('an exception that holds a secret never reaches the answer: a real handler, the real runtime, the real records and spans', {timeout: 60_000}, async context => {
  const spans: string[] = [];
  const caller = fixture('caller');
  const wall = fixture('wall', async ({sdk}) => {
    await sdk.respond('bunny.cmd.mode.wall', () => { throw new Error(`the device said ${SECRET}`); });
  });
  const {runtime, logs} = await run(context, {modules: [wall, caller], spans: line => { spans.push(line); }}, {});
  const result = await contextOf(caller).sdk.request('bunny.cmd.mode.wall', setMode, {timeoutMs: 1000, requestId: 'req-secret'});
  assert.notEqual(result.status, 'accepted', 'the handler failed');
  await runtime.stop();
  await waitFor(() => logs.some(entry => entry.event_name === 'runtime.stopped'));
  const followed = follow({generation: 1, minimumLevel: 'info', skippedLines: 0, journal: logs.map(entry => ({generation: 1, record: entry})), spans: present(spans)}, {request: 'req-secret'});
  assert.equal(followed.result, 'found');
  assert.ok(followed.decision.admitted >= 1);
  assert.equal(JSON.stringify(logs).includes(SECRET), false, 'the runtime wrote no secret');
  assert.equal(JSON.stringify(followed).includes(SECRET), false, 'and the answer holds none');
  assert.ok(followed.spans.some(span => span.status === 'error'), 'the failure is a span status, with no message');
});

void test('a selector or limit that is not an identifier, a trace or a small count is refused, and the refusal never echoes it', () => {
  const refused = (make: () => unknown): FollowRefusal => {
    try {
      make();
    } catch (error) {
      assert.ok(error instanceof FollowRefusal);
      return error;
    }
    return assert.fail('refused');
  };
  const forged: {request?: string | undefined; trace?: string | undefined}[] = [
    {}, {request: '', trace: undefined}, {request: `${SECRET}/../x`}, {request: 'x'.repeat(129)}, {request: 'a', trace: 'b'.repeat(32)},
    {trace: 'A'.repeat(32)}, {trace: '0'.repeat(32)}, {trace: 'b'.repeat(31)},
  ];
  for (const input of forged) {
    const error = refused(() => selectorOf(input));
    assert.equal(error.message.includes(SECRET) || error.message.includes('x'.repeat(8)), false, 'no echo');
  }
  assert.deepEqual(selectorOf({request: 'req-1'}), {request: 'req-1'} satisfies Selector);
  assert.deepEqual(selectorOf({trace: 'b'.repeat(32)}), {trace: 'b'.repeat(32)});
  for (const input of [{records: '0'}, {records: '101'}, {spans: '-1'}, {spans: '1.5'}, {records: `${SECRET}`}, {records: '1e2'}]) refused(() => limitsOf(input));
  assert.deepEqual(limitsOf({}), {records: 50, spans: 50} satisfies Limits);
  assert.deepEqual(limitsOf({records: '7', spans: '100'}), {records: 7, spans: 100});
});

/** A bus record of one command, built the way the runtime builds it, with the command's own message ID and trace. */
function bus(event: string, request: string, message: string, trace: string, extra: Record<string, string | number | boolean> = {}, generation = 1): JournalEntry {
  const made = record(event === 'runtime.command.refused' ? 'warn' : 'info', RUNTIME_SCOPE, event, {'bunny.request.id': request, 'bunny.message.id': message, ...extra}, NOW,
    runtimeResource('test', INSTANCE_ID), {traceId: trace.padEnd(32, '0'), spanId: trace.padEnd(16, '1').slice(0, 16), flags: '01'});
  assert.ok(made, `${event} is a valid record`);
  return {generation, record: made};
}
const live = (journal: readonly JournalEntry[], generation = 1): Evidence => ({generation, minimumLevel: 'info', skippedLines: 0, journal, spans: present([])});

void test('an ending counts only for the admission it follows: a refusal that was never admitted does not end the command that was', () => {
  const refused = bus('runtime.command.refused', 'req-a', 'm1', 'a1', {'bunny.code': 'unavailable'});
  const admitted = bus('runtime.command.admitted', 'req-a', 'm2', 'a2');
  // One refused with no admission, one admitted, then the runtime was killed: the admitted command never ended.
  const killed = follow(live([refused, admitted], 2), {request: 'req-a'});
  assert.deepEqual(killed.decision, {admitted: 1, unended: 1, ended: false, endings: [{generation: 1, event: 'refused', level: 'WARN', code: 'unavailable'}]});
  // The same pair, with the admitted command's own ending: both ended.
  const replied = bus('runtime.command.replied', 'req-a', 'm2', 'a2');
  assert.deepEqual(follow(live([refused, admitted, replied]), {request: 'req-a'}).decision,
    {admitted: 1, unended: 0, ended: true, endings: [{generation: 1, event: 'refused', level: 'WARN', code: 'unavailable'}, {generation: 1, event: 'replied', level: 'INFO'}]});
  // A refusal alone, which the bus makes with no admission, is an ended command.
  assert.deepEqual(follow(live([refused]), {request: 'req-a'}).decision, {admitted: 0, unended: 0, ended: true, endings: [{generation: 1, event: 'refused', level: 'WARN', code: 'unavailable'}]});
  // An ending of another command with the same request ID does not end this one, though the order alone would pair them.
  const other = bus('runtime.command.replied', 'req-a', 'm9', 'a9');
  assert.deepEqual(follow(live([admitted, other]), {request: 'req-a'}).decision.unended, 1);
  // Two admitted commands and one ending: one is unended.
  const second = bus('runtime.command.admitted', 'req-a', 'm3', 'a3');
  assert.deepEqual(follow(live([admitted, second, replied]), {request: 'req-a'}).decision, {admitted: 2, unended: 1, ended: false, endings: [{generation: 1, event: 'replied', level: 'INFO'}]});
});

void test('the traces and the endings are capped, and the cap is counted and named, as the records and the spans are', () => {
  const journal: JournalEntry[] = [];
  for (let index = 0; index < 20; index += 1) {
    const id = `m${String(index).padStart(2, '0')}`;
    journal.push(bus('runtime.command.admitted', 'req-many', id, `b${String(index).padStart(2, '0')}`), bus('runtime.command.replied', 'req-many', id, `b${String(index).padStart(2, '0')}`));
  }
  const all = follow(live(journal), {request: 'req-many'}, {records: 100, spans: 100});
  assert.equal(all.traces.length, 16, 'at most 16 traces are named');
  assert.equal(all.omitted.traces, 4, 'and the other four are counted');
  assert.equal(all.decision.endings.length, 20, 'the endings are not cut by the trace cap');
  const cap = all.gaps.find(gap => gap.kind === 'capped');
  assert.deepEqual(cap && 'traces' in cap ? cap.traces : undefined, 4, 'and the cap is a named gap');
  // The endings follow the record limit, whatever the records that carry them: 20 endings with 5 records.
  const few = follow(live(journal), {request: 'req-many'}, {records: 5, spans: 5});
  assert.equal(few.decision.endings.length, 5);
  assert.deepEqual([few.omitted.endings, few.decision.admitted, few.decision.unended, few.decision.ended], [15, 20, 0, true], 'what was left out is counted, and the verdict still covers every command');
  const capped = few.gaps.find(gap => gap.kind === 'capped');
  assert.deepEqual(capped && 'endings' in capped ? [capped.endings, capped.records] : undefined, [15, 35]);
  const none = follow(live(journal.slice(0, 2)), {request: 'req-many'}, {records: 100, spans: 100});
  assert.deepEqual([none.omitted, none.gaps.some(gap => gap.kind === 'capped')], [{records: 0, spans: 0, traces: 0, endings: 0}, false], 'nothing is reported when nothing was left out');
});

void test('a runtime that has not stopped is a standing gap: its losses are counted only at its stop, so an answer cannot call the evidence complete', async () => {
  const base = await evidence();
  const standing = (followed: Followed): unknown[] => followed.gaps.filter(gap => gap.kind === 'losses-uncounted').map(gap => gap.kind === 'losses-uncounted' && gap.generation);
  assert.deepEqual(standing(follow(base, {request: 'req-gap'})), [4], 'the live runtime, whether the request is found');
  assert.deepEqual(standing(follow(base, {request: 'req-never-sent'})), [4], 'or not');
  const meaning = follow(base, {request: 'req-never-sent'}).gaps.find(gap => gap.kind === 'losses-uncounted')?.meaning ?? '';
  assert.match(meaning, /only when it stops/);
  // Once it has stopped, the gap gives way to what it counted.
  const stoppedNow = follow({...base, journal: [...base.journal, stopped(4, 2, 0)]}, {request: 'req-gap'});
  assert.deepEqual([standing(stoppedNow), stoppedNow.gaps.some(gap => gap.kind === 'telemetry-lost' && gap.generation === 4)], [[], true]);
});

void test('an answer that found nothing carries the same caveats as one that found something', async () => {
  const none = follow(await evidence(), {request: 'req-never-sent'});
  const found = follow(await evidence(), {request: 'req-gap'});
  for (const note of [none.note, found.note]) {
    assert.match(note, /below the minimum level are not written/);
    assert.match(note, /queues drop under pressure/);
    assert.match(note, /ends abruptly loses/);
    assert.match(note, /not evidence that nothing happened/);
  }
  assert.match(none.note, /No record or span in the evidence carries this ID/);
});

void test('lines of the journal that were not records are counted with the records the contract refused', async () => {
  const base = await evidence();
  const followed = follow({...base, skippedLines: 7}, {request: 'req-gap'});
  assert.equal(followed.searched.unreadableRecords, 7);
  const gap = followed.gaps.find(entry => entry.kind === 'unreadable');
  assert.deepEqual(gap && 'records' in gap ? gap.records : undefined, 7);
});

void test('a query takes each parameter once, and ignores the ones it does not know', () => {
  const refused = (query: string): FollowRefusal => {
    try {
      queryOf(new URLSearchParams(query));
    } catch (error) {
      assert.ok(error instanceof FollowRefusal, query);
      return error;
    }
    return assert.fail(`${query} was taken`);
  };
  for (const query of ['request=a&request=b', 'request=a&request=a', `trace=${'b'.repeat(32)}&trace=${'c'.repeat(32)}`, 'request=a&records=1&records=2', 'request=a&spans=1&spans=2', 'request=&request=a']) {
    const error = refused(query);
    assert.equal(error.message, 'name each parameter once', `${query}: a fixed message`);
  }
  assert.deepEqual(queryOf(new URLSearchParams('request=req-1&records=3&unknown=1&unknown=2')), {selector: {request: 'req-1'}, limits: {records: 3, spans: 50}});
});
