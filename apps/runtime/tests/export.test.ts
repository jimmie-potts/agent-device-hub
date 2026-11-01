// The Collector export (Hub #813): with the configuration file's `diagnostics.export.collector`, every record the
// runtime's writer wrote and every span go to the Collector through the host adapter's bounded queues, each once and
// with their trace; a Collector that refuses, stalls or is absent changes no result and leaves the loss counted and
// summarized; without the section nothing is exported.
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {TestContext} from 'node:test';
import type {Command, Reply, Scheduler} from '@jimmie-potts/sdk';
import {EXPORT_SUMMARY_MS, RuntimeError, checkDiagnosticsSection, type LogRecord} from '../src/index.js';
import {assertContractRecords, contextOf, fixture, health, it, run, setMode, waitFor} from './support.js';

const KEY = 'bunny.cmd.mode.wall';
const code = (expected: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === expected;

type Exported = {event: string; traceId?: string; spanId?: string; severity: string; attributes: Record<string, unknown>};
type Span = {name: string; traceId: string; spanId: string; attributes: Attribute[]};
type Received = {logs: Exported[]; spans: Span[]; requests: number};
type Mode = 'accept' | 'refuse' | 'stall';
type Attribute = {key: string; value: {stringValue?: string; intValue?: string; boolValue?: boolean}};
const plain = (attributes: Attribute[]): Record<string, unknown> =>
  Object.fromEntries(attributes.map(item => [item.key, item.value.stringValue ?? (item.value.intValue === undefined ? item.value.boolValue : Number(item.value.intValue))]));

/** A loopback OTLP/HTTP Collector that accepts, refuses with 500, or holds every request open; `received` keeps what arrived. */
async function collector(context: TestContext, mode: () => Mode): Promise<{origin: string; received: Received}> {
  const received: Received = {logs: [], spans: [], requests: 0};
  const open = new Set<ServerResponse>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.requests += 1;
      const selected = mode();
      if (selected === 'stall') { open.add(response); return; }
      if (selected === 'refuse') { response.writeHead(500, {'content-type': 'application/json'}).end('{}'); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        resourceLogs?: {scopeLogs: {logRecords: {eventName: string; traceId?: string; spanId?: string; severityText: string; attributes: Attribute[]}[]}[]}[];
        resourceSpans?: {scopeSpans: {spans: Span[]}[]}[];
      };
      if (request.url === '/v1/logs') {
        for (const group of body.resourceLogs ?? []) for (const scoped of group.scopeLogs) for (const log of scoped.logRecords) {
          received.logs.push({event: log.eventName, severity: log.severityText, attributes: plain(log.attributes), ...(log.traceId === undefined ? {} : {traceId: log.traceId, spanId: log.spanId})});
        }
      } else if (request.url === '/v1/traces') {
        for (const group of body.resourceSpans ?? []) for (const scoped of group.scopeSpans) for (const span of scoped.spans) received.spans.push({name: span.name, traceId: span.traceId, spanId: span.spanId, attributes: span.attributes});
      }
      response.writeHead(200, {'content-type': 'application/json'}).end(request.url === '/v1/logs' ? '{"partialSuccess":{}}' : '{}');
    });
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  context.after(() => new Promise<void>(resolve => {
    for (const response of open) response.destroy();
    server.closeAllConnections();
    server.close(() => { resolve(); });
  }));
  return {origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received};
}

/**
 * A device module that answers the mode command inside a device-call span and writes one record with the command's
 * trace, as the core and companions do, so a request leaves a trace of four spans and a traced record.
 */
function wall(): ReturnType<typeof fixture> {
  return fixture('wall', async ({sdk, trace, log}) => {
    await sdk.respond<{mode: string}>(KEY, async (command: Command<{mode: string}>): Promise<Reply> => {
      const call = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: {'bunny.device.id': 'wall-1', 'bunny.operation': 'mode'}});
      await Promise.resolve();
      call.end();
      log.info('command.completed', {'bunny.outcome': 'succeeded'}, command);
      return {status: 'accepted'};
    });
  });
}

/** A scheduler whose timers fire only when the test says so. */
function manual(): {scheduler: Scheduler; fire(): void; pending(): number} {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  return {
    scheduler: {after: (delayMs, callback) => {
      assert.ok(delayMs === EXPORT_SUMMARY_MS || delayMs > 0, 'a positive delay');
      const id = next;
      next += 1;
      callbacks.set(id, () => { void callback(); });
      return () => { callbacks.delete(id); };
    }},
    fire() {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) callback();
    },
    pending: () => callbacks.size,
  };
}

const events = (logs: readonly LogRecord[]): string[] => logs.map(record => record.event_name);
const summaries = (logs: readonly LogRecord[]): LogRecord[] => logs.filter(record => record.event_name === 'telemetry.dropped');

it('the export section names an exact owned Collector origin and refuses anything else', () => {
  assert.deepEqual(checkDiagnosticsSection({export: {collector: 'http://127.0.0.1:4318'}}), {modules: {}, export: {collector: 'http://127.0.0.1:4318'}});
  assert.deepEqual(checkDiagnosticsSection({level: 'warn', export: {collector: 'http://host.docker.internal:4318'}}), {level: 'warn', modules: {}, export: {collector: 'http://host.docker.internal:4318'}});
  assert.deepEqual(checkDiagnosticsSection({export: {collector: 'http://[::1]:4318'}}).export, {collector: 'http://[::1]:4318'});
  for (const [section, why] of [
    [{export: 'http://127.0.0.1:4318'}, 'export is an object'], [{export: {}}, 'collector is required'], [{export: {collector: 4318}}, 'a string'],
    [{export: {collector: 'http://127.0.0.1:4318', signal: 'logs'}}, 'collector only'], [{export: {collector: 'https://127.0.0.1:4318'}}, 'http only'],
    [{export: {collector: 'http://127.0.0.1:4318/v1/logs'}}, 'an origin, no path'], [{export: {collector: 'http://127.0.0.1:4318/'}}, 'the exact origin'],
    [{export: {collector: 'http://collector:4318'}}, 'an owned host only'], [{export: {collector: 'http://localhost:4318'}}, 'numeric loopback, not a name'],
    [{export: {collector: 'http://10.0.0.5:4318'}}, 'no LAN address'], [{export: {collector: 'http://user@127.0.0.1:4318'}}, 'no user information'],
    [{export: {collector: 'http://127.0.0.1'}}, 'an explicit port'],
  ] as const) {
    assert.throws(() => checkDiagnosticsSection(section), code('config-invalid'), why);
  }
});

it('every written record and every span reach the Collector once, with their trace, and the journal is unchanged', async context => {
  const {origin, received} = await collector(context, () => 'accept');
  const caller = fixture('caller');
  const {runtime, logs} = await run(context, {modules: [wall(), caller], config: {modules: {}, diagnostics: {export: {collector: origin}}}});
  const reply = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000});
  assert.equal(reply.status, 'accepted');
  await waitFor(() => received.spans.length >= 4, 3000, 'the request\'s spans at the Collector');
  await runtime.stop();
  // `runtime.stopped` is the journal's last word, written after the export's final flush, so the export ends before it.
  const exported = logs.slice(0, -1);
  await waitFor(() => received.logs.length >= exported.length, 3000, `${exported.length} records at the Collector (${received.logs.length} so far)`);
  assert.deepEqual(received.logs.map(log => log.event), events(exported), 'each record once, in the journal\'s order');
  assert.deepEqual(received.logs.map(log => log.traceId), exported.map(record => record.trace_id), 'each with its trace');
  assert.deepEqual(received.spans.map(span => span.name).sort(), ['bunny.command.execute', 'bunny.command.queue', 'bunny.command.request', 'bunny.device.call']);
  const traced = received.logs.filter(log => log.traceId !== undefined);
  assert.ok(traced.length > 0 && traced.every(log => received.spans.some(span => span.traceId === log.traceId)), 'a traced record\'s trace has spans');
  // The exported journal is a copy: a record with the command's trace is never attached to the bus's request span, so the
  // span keeps its own attributes and nothing counts as loss (the adapter's association is off for the export).
  const request = received.spans.find(span => span.name === 'bunny.command.request');
  assert.ok(request !== undefined && !request.attributes.some(item => ['bunny.outcome', 'bunny.module'].includes(item.key)), `the request span carries the bus's attributes only: ${JSON.stringify(request?.attributes)}`);
  assert.ok(received.logs.some(log => log.event === 'command.completed' && log.attributes['bunny.module'] === 'wall' && log.traceId === request.traceId), 'the module\'s traced record arrived as itself');
  assert.ok(received.logs.every(log => typeof log.attributes['bunny.schema.version'] === 'string'), 'the profile travels with each record');
  const stopped = logs.at(-1);
  assert.equal(stopped?.event_name, 'runtime.stopped');
  assert.deepEqual([stopped?.attributes['bunny.telemetry.dropped_count'], stopped?.attributes['bunny.telemetry.failure_count']], [0, 0], 'nothing lost');
  assert.equal(summaries(logs).length, 0, 'no loss, no summary');
});

it('a Collector that refuses, stalls or is absent changes no result; the loss is counted, summarized at most once a minute, and totaled at stop', async context => {
  let mode: Mode = 'refuse';
  const {origin, received} = await collector(context, () => mode);
  const timers = manual();
  const caller = fixture('caller');
  // The journal keeps every record; the loss `runtime.stopped` totals here is the export's, so the journal is collected
  // directly and the support's no-loss check does not apply.
  const logs: LogRecord[] = [];
  const {runtime} = await run(context, {modules: [wall(), caller], scheduler: timers.scheduler, log: record => { logs.push(record); }, config: {modules: {}, diagnostics: {export: {collector: origin}}}});
  assert.equal(timers.pending(), 1, 'one summary timer armed');
  assert.equal((await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000})).status, 'accepted', 'a refusing Collector changes no reply');
  await waitFor(() => received.requests >= 4, 3000, 'the Collector saw the attempts');
  assert.deepEqual(received.logs, [], 'nothing accepted');
  timers.fire();
  await waitFor(() => summaries(logs).length === 1, 2000, 'one summary');
  const [first] = summaries(logs);
  assert.equal(first?.severity_text, 'WARN');
  // The Collector has seen four attempts, but some refusals may still be in flight when the summary is written.
  assert.ok(Number(first?.attributes['bunny.telemetry.failure_count']) >= 1, `the refused records and spans count as failures: ${JSON.stringify(first?.attributes)}`);
  // The summary itself goes to the Collector; while the Collector refuses, that failure is growth too, so an outage keeps
  // one summary a minute. Once the Collector takes records again and the late refusals have landed, a summary minute
  // writes at most one more, and the next minute without new loss writes none.
  mode = 'accept';
  await waitFor(() => received.logs.some(log => log.event === 'telemetry.dropped'), 3000, 'the summary reached the Collector once it accepted');
  await waitFor(async () => {
    const seen = received.requests;
    await new Promise(resolve => { setTimeout(resolve, 150); });
    return received.requests === seen;
  }, 5000, 'the export to settle');
  timers.fire();
  await new Promise(resolve => { setTimeout(resolve, 100); });
  const settled = summaries(logs).length;
  assert.ok(settled <= 2, `at most one summary for the late refusals: ${settled}`);
  timers.fire();
  await new Promise(resolve => { setTimeout(resolve, 100); });
  assert.equal(summaries(logs).length, settled, 'no growth since the last summary, no second one');
  mode = 'stall';
  assert.equal((await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000})).status, 'accepted', 'a stalling Collector changes no reply');
  assert.equal((await health(runtime.url)).body.status, 'ok', 'health does not wait for the Collector');
  const stopping = performance.now();
  await runtime.stop();
  assert.ok(performance.now() - stopping < 5000, `stop completes within its bound while the Collector holds requests: ${(performance.now() - stopping).toFixed(0)} ms`);
  const stopped = logs.at(-1);
  assert.equal(stopped?.event_name, 'runtime.stopped', 'stop completes within its bound while the Collector holds requests, and the totals are the last word');
  const total = (record: LogRecord | undefined): number => Number(record?.attributes['bunny.telemetry.failure_count']) + Number(record?.attributes['bunny.telemetry.dropped_count']);
  assert.ok(total(stopped) > Number(first?.attributes['bunny.telemetry.failure_count']), `the totals include the stalled export: ${JSON.stringify(stopped?.attributes)}`);
  assert.equal(timers.pending(), 0, 'the summary timer is cancelled at stop');
  assertContractRecords(logs);

  // An absent Collector: a loopback port nothing listens on.
  const absent = fixture('absent');
  const aloneLogs: LogRecord[] = [];
  const {runtime: alone} = await run(context, {modules: [wall(), absent], log: record => { aloneLogs.push(record); }, config: {modules: {}, diagnostics: {export: {collector: 'http://127.0.0.1:9'}}}});
  assert.equal((await contextOf(absent).sdk.request(KEY, setMode, {timeoutMs: 1000})).status, 'accepted', 'an absent Collector changes no reply');
  await alone.stop();
  const last = aloneLogs.at(-1);
  assert.equal(last?.event_name, 'runtime.stopped');
  assert.ok(Number(last?.attributes['bunny.telemetry.failure_count']) > 0, `the connection failures are counted: ${JSON.stringify(last?.attributes)}`);
  assert.deepEqual(events(aloneLogs).filter(event => event === 'telemetry.dropped'), [], 'no minute passed, no summary');
  assertContractRecords(aloneLogs);
});

it('without the export section nothing leaves the process', async context => {
  const {origin, received} = await collector(context, () => 'accept');
  const caller = fixture('caller');
  const {runtime} = await run(context, {modules: [wall(), caller], config: {modules: {}}});
  assert.equal((await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000})).status, 'accepted');
  await runtime.stop();
  assert.equal(received.requests, 0, `no request reached ${origin}`);
});
