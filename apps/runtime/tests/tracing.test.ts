// The runtime's recorded spans (ADR 0012, "Observability"; Hub #949): the bus's command spans and the modules' own spans,
// recorded through the observability package's host adapter with tracing on, no Collector and its bounded local span
// sink, as projected OTLP spans with durations, status and parents. Concurrent requests keep their own spans, and a
// failing span sink changes nothing.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {connectRemote, traceFields, type Command, type Reply, type TraceContext} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE, startRuntime, type LogRecord} from '../src/index.js';
import {contextOf, deferred, fixture, it, run, setMode, stateDir, waitFor} from './support.js';

const KEY = 'bunny.cmd.mode.wall';
const MODE_SCHEMA = 'https://bunny.invalid/events/test-mode/2.0';
const block = (name: string): object => ({$ref: `https://bunny.invalid/events/blocks/2.0#/$defs/${name}`});
const modeSchema = {type: 'object', additionalProperties: false, required: ['requestId', 'mode'], properties: {requestId: block('requestId'), mode: {type: 'string'}}};
const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const OTHER = {traceparent: '00-11111111111111111111111111111111-2222222222222222-01'};

type Attribute = {key: string; value: {stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number}};
/** One recorded span as the runtime's span sink got it, with its scope and resource. */
type Recorded = {
  traceId: string; spanId: string; parentSpanId?: string; name: string; kind: number; startTimeUnixNano: string; endTimeUnixNano: string;
  attributes: Attribute[]; links?: {traceId: string; spanId: string}[]; status: {code: number}; scope: string; service: string | undefined;
};

/** Each projected OTLP document as one span. */
function parse(lines: readonly string[]): Recorded[] {
  return lines.map(line => {
    const document = JSON.parse(line) as {resourceSpans: {resource: {attributes: Attribute[]}; scopeSpans: {scope: {name: string}; spans: Omit<Recorded, 'scope' | 'service'>[]}[]}[]};
    const [group] = document.resourceSpans;
    const [scoped] = group?.scopeSpans ?? [];
    const [span] = scoped?.spans ?? [];
    assert.ok(group && scoped && span, 'one span per document');
    return {...span, scope: scoped.scope.name, service: group.resource.attributes.find(item => item.key === 'service.name')?.value.stringValue};
  });
}
const attribute = (span: Recorded, key: string): unknown => {
  const value = span.attributes.find(item => item.key === key)?.value;
  return value?.stringValue ?? value?.intValue ?? value?.boolValue ?? value?.doubleValue;
};
const children = (spans: readonly Recorded[], parent: Recorded, name: string): Recorded[] =>
  spans.filter(span => span.name === name && span.traceId === parent.traceId && span.parentSpanId === parent.spanId);
const lasted = (span: Recorded | undefined): boolean => span !== undefined && BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano);

/** A module that answers mode commands with `answer` after a device call in its own span. */
function wall(answer: (command: Command<{mode: string}>) => Reply | Promise<Reply>, commands: Command<{mode: string}>[] = []): ReturnType<typeof fixture> {
  return fixture('wall', async ({sdk, trace}) => {
    await sdk.respond<{mode: string}>(KEY, async command => {
      commands.push(command);
      const call = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: {'bunny.device.id': 'wall-1', 'bunny.operation': 'mode'}});
      const reply = await answer(command);
      call.end();
      return reply;
    });
  });
}

it('the bus\'s and the modules\' spans reach the span sink through the host adapter, with no Collector', async context => {
  const lines: string[] = [];
  const commands: Command<{mode: string}>[] = [];
  const caller = fixture('caller');
  const {runtime} = await run(context, {modules: [wall(() => ({status: 'accepted'}), commands), caller], spans: line => { lines.push(line); }});
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, parent: PARENT, requestId: 'req-1'});
  assert.equal(result.status, 'accepted');
  await runtime.stop();
  const spans = parse(lines);
  const [request, ...others] = spans.filter(span => span.name === 'bunny.command.request');
  assert.ok(request && others.length === 0, 'one request span');
  assert.equal(request.scope, 'bunny.runtime');
  assert.equal(request.service, 'runtime');
  assert.equal(request.kind, 3, 'a client span, OTLP\'s kind 3');
  assert.equal(request.traceId, traceFields(PARENT)?.traceId);
  assert.equal(request.parentSpanId, traceFields(PARENT)?.spanId, 'the caller\'s parent');
  assert.deepEqual([attribute(request, 'bunny.request.id'), attribute(request, 'bunny.routing.key'), attribute(request, 'bunny.participant'),
    attribute(request, 'bunny.schema.version')], ['req-1', KEY, 'bunny/modules/caller', '1.3']);
  assert.equal(traceFields(commands[0] ?? {traceparent: ''})?.spanId, request.spanId, 'the command carries its request span\'s context');
  const [queue] = children(spans, request, 'bunny.command.queue');
  const [execute] = children(spans, request, 'bunny.command.execute');
  const [device] = children(spans, request, 'bunny.device.call');
  assert.ok(queue && execute && device, 'the queue, execute and device spans are the request span\'s children');
  assert.equal(device.scope, 'bunny.module');
  assert.equal(attribute(device, 'bunny.module'), 'wall', 'the module\'s name, which its own attributes cannot replace');
  if (result.status === 'accepted') assert.equal(traceFields(result.reply)?.spanId, execute.spanId, 'the reply carries the execute span\'s context');
  for (const span of [request, queue, execute, device]) {
    assert.ok(lasted(span), `${span.name} has a start and an end`);
    assert.equal(span.status.code, 0);
  }
  const recorded = new Set(spans.map(span => span.spanId));
  assert.deepEqual(spans.filter(span => span.parentSpanId !== undefined && !recorded.has(span.parentSpanId) && span !== request).map(span => span.name), [],
    'no lost parent: only the request span continues a parent from outside, its caller\'s');
  assert.deepEqual(runtime.spans(), [], 'with a sink, nothing is kept in memory');
});

it('without a span sink, the runtime keeps its latest spans for runtime.spans()', async context => {
  const caller = fixture('caller');
  const {runtime} = await run(context, {modules: [wall(() => ({status: 'accepted'})), caller]});
  await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000});
  await waitFor(() => runtime.spans().length >= 4, 2000, 'the spans in memory');
  assert.deepEqual(parse(runtime.spans()).map(span => span.name).sort(),
    ['bunny.command.execute', 'bunny.command.queue', 'bunny.command.request', 'bunny.device.call']);
});

it('concurrent requests from two traces have their own spans, and a failure ends its spans with error', async context => {
  const lines: string[] = [];
  const held = deferred<Reply>();
  const caller = fixture('caller');
  const {runtime} = await run(context, {modules: [wall(command => command.data.mode === 'free' ? Promise.reject(new Error('jammed')) : held.promise), caller],
    spans: line => { lines.push(line); }});
  const {sdk} = contextOf(caller);
  const both = [PARENT, OTHER].map(parent => sdk.request(KEY, setMode, {timeoutMs: 1000, parent}));
  await waitFor(() => true);
  held.resolve({status: 'accepted'});
  assert.deepEqual((await Promise.all(both)).map(result => result.status), ['accepted', 'accepted']);
  await runtime.stop();
  const spans = parse(lines);
  const requests = spans.filter(span => span.name === 'bunny.command.request');
  assert.deepEqual(requests.map(span => span.traceId).sort(), [PARENT, OTHER].map(parent => traceFields(parent)?.traceId).sort());
  for (const request of requests) {
    assert.equal(children(spans, request, 'bunny.command.queue').length, 1, 'its own queue span');
    assert.equal(children(spans, request, 'bunny.command.execute').length, 1, 'its own execute span');
    assert.equal(children(spans, request, 'bunny.device.call').length, 1, 'its own device span');
  }
  assert.equal(spans.filter(span => span.name === 'bunny.command.execute').length, 2, 'no span joined the other trace');
});

it('a remote part\'s command gets a server span that continues its authenticated, validated context', async context => {
  const dir = await stateDir(context);
  const operator = {source: 'bunny/parts/operator', token: randomBytes(32).toString('base64url')};
  const file = join(dir, EDGE_GRANTS_FILE);
  await writeFile(file, JSON.stringify({schema: 'edge-grants/1.0', grants: [operator]}), {mode: 0o600});
  await chmod(file, 0o600);
  const lines: string[] = [];
  const commands: Command<{mode: string}>[] = [];
  const {runtime} = await run(context, {modules: [wall(() => ({status: 'accepted'}), commands)], stateDir: dir, edge: {schemas: {[MODE_SCHEMA]: modeSchema}},
    spans: line => { lines.push(line); }});
  const remote = await connectRemote({url: runtime.url, source: operator.source, token: operator.token});
  context.after(() => remote.close());
  assert.equal((await remote.request(KEY, setMode, {timeoutMs: 2000, parent: PARENT})).status, 'accepted');
  await remote.close();
  await runtime.stop();
  const spans = parse(lines);
  const [request] = spans.filter(span => span.name === 'bunny.command.request');
  const [command] = commands;
  assert.ok(request && command);
  assert.equal(request.kind, 2, 'a server span, OTLP\'s kind 2');
  assert.equal(request.parentSpanId, traceFields(command)?.spanId, 'the remote command\'s own context');
  assert.equal(request.traceId, traceFields(PARENT)?.traceId);
  assert.equal(children(spans, request, 'bunny.command.execute').length, 1);
});

it('a span sink that throws changes no result, and runtime.stopped counts the spans it lost', async context => {
  const logs: LogRecord[] = [];
  const caller = fixture('caller');
  const runtime = await startRuntime({
    modules: [wall(() => ({status: 'accepted'})), caller], port: 0, stateDir: await stateDir(context),
    log: record => { logs.push(record); }, spans: () => { throw new Error('the span store is gone'); },
  });
  context.after(() => runtime.stop());
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000});
  assert.equal(result.status, 'accepted');
  await runtime.stop();
  const stopped = logs.find(record => record.event_name === 'runtime.stopped');
  assert.ok(Number(stopped?.attributes['bunny.telemetry.failure_count']) >= 4, 'each lost span is counted');
});

it('a span whose parent was not sampled is not recorded, and the command keeps the parent\'s flag', async context => {
  const lines: string[] = [];
  const commands: Command<{mode: string}>[] = [];
  const caller = fixture('caller');
  const unsampled: TraceContext = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00'};
  const {runtime} = await run(context, {modules: [wall(() => ({status: 'accepted'}), commands), caller], spans: line => { lines.push(line); }});
  await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, parent: unsampled});
  await runtime.stop();
  assert.deepEqual(lines, [], 'nothing in an unsampled trace is recorded');
  assert.equal(traceFields(commands[0] ?? {traceparent: ''})?.flags, '00');
  assert.equal(traceFields(commands[0] ?? {traceparent: ''})?.traceId, traceFields(unsampled)?.traceId);
});
