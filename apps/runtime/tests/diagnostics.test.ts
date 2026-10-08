// The SDK's decisions in the runtime's log (ADR 0012, "Observability"; Hub #949): each command and sync decision becomes
// one contract record under the runtime's own scope, at the level the bus set, with the command's own trace, whether a
// module or a remote part sent the command. A request ID that the 1.x attribute refuses is left out, and the record kept.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {DeviceAvailability, connectRemote, traceFields, type Command, type Reply} from '@jimmie-potts/sdk';
import {diagnosticWriter} from '../src/diagnostics.js';
import type {LogRecord} from '../src/index.js';
import {LogWriter} from '../src/log.js';
import {MODULE_SCOPE, RUNTIME_SCOPE} from '../src/record.js';
import {contextOf, deferred, edgeConfig, fixture, it, manualClock, run, modeFor, setMode} from './support.js';

const KEY = 'bunny.cmd.mode.wall';
/** A consumer's notice acknowledgment for `session`: one of the core's operator commands, which a remote grant may request directly. */
const acknowledge = (session: string): {key: string; draft: {type: string; subject: string; dataschema: string; data: object}} => ({
  key: `bunny.cmd.notice-acknowledge.${session}`,
  draft: {type: 'org.bunny.notice.acknowledge.requested', subject: session, dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0', data: {consumerId: 'panel', noticeId: 'a'.repeat(64)}},
});
const ANSWERED = '5'.repeat(64);
const UNANSWERED = '6'.repeat(64);
const MODE_SCHEMA = 'https://bunny.invalid/events/test-mode/2.0';
const block = (name: string): object => ({$ref: `https://bunny.invalid/events/blocks/2.0#/$defs/${name}`});
const modeSchema = {type: 'object', additionalProperties: false, required: ['requestId', 'mode'], properties: {requestId: block('requestId'), mode: {type: 'string'}}};
const SECRET = 'tok_SYNTHETIC123';

/** The runtime's command records about one request, as event and severity. */
const about = (logs: readonly LogRecord[], requestId: string): string[] => logs
  .filter(record => record.event_name.startsWith('runtime.command.') && record.attributes['bunny.request.id'] === requestId)
  .map(record => `${record.event_name} ${record.severity_text}`);

/** A module that answers mode commands with `answer`, keeping each command it receives. */
function wall(answer: (command: Command<{mode: string}>) => Reply | Promise<Reply>, commands: Command<{mode: string}>[] = [], key = KEY): ReturnType<typeof fixture> {
  return fixture('wall', async ({sdk}) => {
    await sdk.respond<{mode: string}>(key, command => {
      commands.push(command);
      return answer(command);
    });
  });
}

it('a module\'s accepted request makes one admission and one reply record, contract records in the command\'s trace', async context => {
  const commands: Command<{mode: string}>[] = [];
  const caller = fixture('caller');
  const {runtime, logs} = await run(context, {modules: [wall(() => ({status: 'accepted'}), commands), caller]});
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, requestId: 'req-1'});
  assert.equal(result.status, 'accepted');
  await runtime.stop();
  const records = logs.filter(record => record.event_name.startsWith('runtime.command.'));
  assert.deepEqual(records.map(record => [record.event_name, record.severity_text, record.scope.name, record.schema_version]), [
    ['runtime.command.admitted', 'INFO', 'bunny.runtime', '1.5'], ['runtime.command.replied', 'INFO', 'bunny.runtime', '1.5'],
  ]);
  const [command] = commands;
  assert.ok(command);
  const ids = traceFields(command);
  for (const [record, outcome] of records.map((record, index) => [record, index === 0 ? 'queued' : 'accepted'] as const)) {
    assert.deepEqual(record.attributes, {
      'bunny.provenance': 'source', 'bunny.participant': 'bunny/modules/caller', 'bunny.routing.key': KEY, 'bunny.request.id': 'req-1',
      'bunny.message.id': command.id, 'bunny.outcome': outcome,
    });
    assert.deepEqual([record.trace_id, record.span_id, record.trace_flags], [ids?.traceId, ids?.spanId, ids?.flags], 'the command\'s own trace');
  }
});

it('a remote part\'s refused request, and one with no responder, make their records at their levels', async context => {
  const operator = {source: 'bunny/parts/operator', token: randomBytes(32).toString('base64url')};
  const {config} = await edgeConfig(context, [operator]);
  // A stand-in answers the core's operator command, the only kind a remote grant may request directly (#782).
  const answered = acknowledge(ANSWERED), unanswered = acknowledge(UNANSWERED);
  const {runtime, logs} = await run(context, {
    modules: [wall(() => errorBody('invalid-state', {detail: 'quiet mode keeps the lamps off'}), [], answered.key)], configFile: config, edge: {schemas: {[MODE_SCHEMA]: modeSchema}},
  });
  const remote = await connectRemote({url: runtime.url, source: operator.source, token: operator.token});
  context.after(() => remote.close());
  const device = await remote.request(KEY, setMode, {timeoutMs: 2000, requestId: 'req-device'});
  assert.equal(device.status === 'rejected' && device.error.error.code, 'forbidden', 'a device\'s command goes through the core\'s dispatcher, never directly');
  const refused = await remote.request(answered.key, answered.draft, {timeoutMs: 2000, requestId: 'req-refused'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'invalid-state');
  const none = await remote.request(unanswered.key, unanswered.draft, {timeoutMs: 2000, requestId: 'req-none'});
  assert.equal(none.status === 'rejected' && none.error.error.code, 'unavailable');
  await remote.close();
  await runtime.stop();
  assert.deepEqual(about(logs, 'req-refused'), ['runtime.command.admitted INFO', 'runtime.command.replied INFO'], 'a domain refusal is INFO');
  assert.deepEqual(about(logs, 'req-none'), ['runtime.command.refused WARN'], 'no responder is WARN');
  const replied = logs.find(record => record.event_name === 'runtime.command.replied');
  assert.deepEqual(replied?.attributes, {
    'bunny.provenance': 'source', 'bunny.participant': operator.source, 'bunny.routing.key': answered.key, 'bunny.request.id': 'req-refused',
    'bunny.message.id': replied?.attributes['bunny.message.id'] ?? '', 'bunny.outcome': 'rejected', 'bunny.code': 'invalid-state', 'bunny.reason': 'invalid-input',
  });
  const unrouted = logs.find(record => record.event_name === 'runtime.command.refused');
  assert.equal(unrouted?.attributes['bunny.code'], 'unavailable');
  assert.equal(unrouted?.attributes['bunny.reason'], 'unavailable');
  assert.ok(logs.some(record => record.event_name === 'runtime.edge.connected' && record.attributes['bunny.participant'] === operator.source));
  assert.equal(JSON.stringify(logs).includes(operator.token), false, 'no record quotes the token');
});

it('a request ID that the 1.x request attribute refuses is left out, and the records are kept', async context => {
  const caller = fixture('caller');
  const {runtime, logs} = await run(context, {modules: [wall(() => ({status: 'accepted'})), caller]});
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, requestId: '_req-2.0-form'});
  assert.equal(result.status, 'accepted');
  await runtime.stop();
  const records = logs.filter(record => record.event_name.startsWith('runtime.command.'));
  assert.deepEqual(records.map(record => record.event_name), ['runtime.command.admitted', 'runtime.command.replied']);
  assert.ok(records.every(record => !('bunny.request.id' in record.attributes) && record.trace_id !== undefined), 'kept, with its trace');
});

it('a sync makes one record of its answer, and a deadline that passes while a handler has the command one uncertain warning', async context => {
  const held = deferred<Reply>();
  const owner = fixture('owner', async ({sdk}) => {
    await sdk.serveSync(['test-session'], () => ({revision: 0, states: []}));
  });
  const caller = fixture('caller');
  const {runtime, logs} = await run(context, {modules: [owner, wall(() => held.promise), caller]});
  const copy = await contextOf(caller).sdk.sync(['test-session'], () => {}, {timeoutMs: 1000});
  assert.equal(copy.status, 'synced');
  if (copy.status === 'synced') await copy.copy.close();
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 200, requestId: 'req-held'});
  assert.equal(result.status, 'uncertain');
  held.resolve({status: 'accepted'});
  await runtime.stop();
  const served = logs.filter(record => record.event_name === 'runtime.sync.served');
  assert.deepEqual(served.map(record => [record.severity_text, record.attributes['bunny.participant'], record.attributes['bunny.pattern']]),
    [['INFO', 'bunny/modules/caller', 'sync test-session']]);
  assert.deepEqual(about(logs, 'req-held'), ['runtime.command.admitted INFO', 'runtime.command.uncertain WARN'], 'the late reply adds nothing');
});

it('a secret in a handler\'s or a device call\'s exception reaches no record or span', async context => {
  const caller = fixture('caller');
  // A device call that fails is the device's failure, not the module's (policy A): its span ends with an error, and the
  // module reports it; the exception's message stays in memory.
  const panel = fixture('panel', async ({sdk, trace, log}) => {
    await sdk.respond<{mode: string}>('bunny.cmd.mode.panel', command => {
      const call = trace.start('bunny.device.call', {parent: command, kind: 'client', attributes: {'bunny.device.id': 'panel-1'}});
      try {
        throw new Error(`GET http://192.0.2.7/?token=${SECRET} refused`);
      } catch {
        call.end('error');
        log.warn('operation.failed', {'bunny.device.id': 'panel-1', 'bunny.reason': 'unavailable'}, command);
      }
      return {status: 'accepted'};
    });
  });
  const {runtime, logs} = await run(context, {modules: [wall(() => { throw new Error(`the device said ${SECRET}`); }), panel, caller]});
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, requestId: 'req-throws'});
  assert.equal(result.status === 'uncertain' && result.error.error.code, 'uncertain-result');
  assert.equal((await contextOf(caller).sdk.request('bunny.cmd.mode.panel', modeFor('panel'), {timeoutMs: 1000})).status, 'accepted');
  await runtime.stop();
  assert.deepEqual(about(logs, 'req-throws'), ['runtime.command.admitted INFO', 'runtime.command.uncertain WARN']);
  const failed = logs.find(record => record.event_name === 'runtime.module.failed');
  assert.equal(failed?.attributes['error.type'], 'Error');
  const spans = runtime.spans().recent;
  assert.ok(spans.some(line => line.includes('"bunny.device.call"') && line.includes('"code":2')), 'the failed device call\'s span ended with an error');
  assert.equal(JSON.stringify([logs, spans]).includes(SECRET), false, 'the exceptions\' messages stay in memory');
});

it('a polled device that stays offline writes one degradation and one recovery at INFO and above, as module records', async context => {
  const clock = manualClock();
  const poller = fixture('poller');
  const {runtime, logs} = await run(context, {modules: [poller], clock: {now: clock.now}, scheduler: clock.scheduler, logLevel: 'debug'});
  const {log, clock: moduleClock} = contextOf(poller);
  const devices = new DeviceAvailability({log, clock: moduleClock});
  for (let poll = 0; poll < 200; poll += 1) {
    devices.unreachable('lamp-1', 'unavailable');
    clock.advance(3000);
  }
  devices.reached('lamp-1');
  await runtime.stop();
  const records = logs.filter(record => record.event_name.startsWith('device.'));
  assert.deepEqual(records.filter(record => record.severity_text !== 'DEBUG').map(record => [record.event_name, record.severity_text, record.attributes]), [
    ['device.unavailable', 'WARN', {'bunny.provenance': 'source', 'bunny.module': 'poller', 'bunny.device.id': 'lamp-1', 'bunny.code': 'unavailable', 'bunny.attempt_count': 1}],
    ['device.available', 'INFO', {'bunny.provenance': 'source', 'bunny.module': 'poller', 'bunny.device.id': 'lamp-1', 'bunny.attempt_count': 200, 'bunny.duration_ms': 600_000}],
  ], 'one degradation and one recovery, not a warning per poll');
  const summaries = records.filter(record => record.severity_text === 'DEBUG');
  assert.ok(summaries.length > 0 && summaries.length <= 10, `the repeats are summarized at most once a minute: ${summaries.length}`);
});

it('an edge failure after dispatch is one valid record in the command\'s trace, beside the bus\'s records', () => {
  const written: LogRecord[] = [];
  const writer = new LogWriter(record => { written.push(record); }, 'info', {now: () => Date.parse('2026-10-07T12:00:00.000Z')});
  const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  diagnosticWriter(writer.logger(RUNTIME_SCOPE))({
    event: 'edge.failed', level: 'error', route: 'request', code: 'uncertain-result', source: 'bunny/core', key: KEY, requestId: 'req-ran',
    messageId: '6d1f0f6e-3b5e-4c8b-9b51-1d0c2f8a7e11', trace: {traceparent}, errorType: 'Error',
  });
  assert.deepEqual(writer.counts(), {written: 1, dropped: 0, failed: 0});
  const [record] = written;
  assert.equal(record?.severity_text, 'ERROR');
  assert.equal(record.trace_id, '0af7651916cd43dd8448eb211c80319c');
  assert.deepEqual(record.attributes, {
    'bunny.participant': 'bunny/core', 'bunny.routing.key': KEY, 'bunny.request.id': 'req-ran', 'bunny.message.id': '6d1f0f6e-3b5e-4c8b-9b51-1d0c2f8a7e11',
    'bunny.code': 'uncertain-result', 'bunny.route': 'request', 'error.type': 'Error', 'bunny.provenance': 'source',
  });
});

it('an edge\'s summary of a repeated refusal is one valid record with the count of repeats', () => {
  const written: LogRecord[] = [];
  const writer = new LogWriter(record => { written.push(record); }, 'info', {now: () => Date.parse('2026-10-07T12:00:00.000Z')});
  diagnosticWriter(writer.logger(RUNTIME_SCOPE))({event: 'edge.refused', level: 'warn', route: 'stream', code: 'unauthenticated', attempts: 4});
  assert.deepEqual(writer.counts(), {written: 1, dropped: 0, failed: 0});
  assert.deepEqual(written.map(record => [record.event_name, record.severity_text, record.attributes]), [['runtime.edge.refused', 'WARN', {
    'bunny.route': 'stream', 'bunny.code': 'unauthenticated', 'bunny.reason': 'unauthorized', 'bunny.attempt_count': 4, 'bunny.provenance': 'source',
  }]]);
});

it('a device whose ID the contract refuses still writes its records, without the ID', () => {
  const written: LogRecord[] = [];
  const writer = new LogWriter(record => { written.push(record); }, 'info', {now: () => Date.parse('2026-10-07T12:00:00.000Z')});
  const devices = new DeviceAvailability({log: writer.logger(MODULE_SCOPE, {'bunny.module': 'lamp'}), clock: {now: () => Date.parse('2026-10-07T12:00:00.000Z')}});
  devices.unreachable('http://192.0.2.7/?token=tok_SYNTHETIC123', 'unavailable');
  devices.reached('http://192.0.2.7/?token=tok_SYNTHETIC123');
  assert.deepEqual(writer.counts(), {written: 2, dropped: 0, failed: 0}, 'kept, not dropped');
  assert.deepEqual(written.map(record => [record.event_name, 'bunny.device.id' in record.attributes]), [['device.unavailable', false], ['device.available', false]]);
  assert.equal(JSON.stringify(written).includes(SECRET), false);
});
