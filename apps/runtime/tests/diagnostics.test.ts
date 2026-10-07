// The SDK's decisions in the runtime's log (ADR 0012, "Observability"; Hub #949): each command and sync decision becomes
// one contract record under the runtime's own scope, at the level the bus set, with the command's own trace, whether a
// module or a remote part sent the command. A request ID that the 1.x attribute refuses is left out, and the record kept.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {connectRemote, traceFields, type Command, type Reply} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE, type LogRecord} from '../src/index.js';
import {contextOf, deferred, fixture, it, run, setMode, stateDir} from './support.js';

const KEY = 'bunny.cmd.mode.wall';
const MODE_SCHEMA = 'https://bunny.invalid/events/test-mode/2.0';
const block = (name: string): object => ({$ref: `https://bunny.invalid/events/blocks/2.0#/$defs/${name}`});
const modeSchema = {type: 'object', additionalProperties: false, required: ['requestId', 'mode'], properties: {requestId: block('requestId'), mode: {type: 'string'}}};
const SECRET = 'tok_SYNTHETIC123';

/** The runtime's command records about one request, as event and severity. */
const about = (logs: readonly LogRecord[], requestId: string): string[] => logs
  .filter(record => record.event_name.startsWith('runtime.command.') && record.attributes['bunny.request.id'] === requestId)
  .map(record => `${record.event_name} ${record.severity_text}`);

/** A module that answers mode commands with `answer`, keeping each command it receives. */
function wall(answer: (command: Command<{mode: string}>) => Reply | Promise<Reply>, commands: Command<{mode: string}>[] = []): ReturnType<typeof fixture> {
  return fixture('wall', async ({sdk}) => {
    await sdk.respond<{mode: string}>(KEY, command => {
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
    ['runtime.command.admitted', 'INFO', 'bunny.runtime', '1.3'], ['runtime.command.replied', 'INFO', 'bunny.runtime', '1.3'],
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
  const dir = await stateDir(context);
  const operator = {source: 'bunny/parts/operator', token: randomBytes(32).toString('base64url')};
  const file = join(dir, EDGE_GRANTS_FILE);
  await writeFile(file, JSON.stringify({schema: 'edge-grants/1.0', grants: [operator]}), {mode: 0o600});
  await chmod(file, 0o600);
  const {runtime, logs} = await run(context, {
    modules: [wall(() => errorBody('invalid-state', {detail: 'quiet mode keeps the lamps off'}))], stateDir: dir, edge: {schemas: {[MODE_SCHEMA]: modeSchema}},
  });
  const remote = await connectRemote({url: runtime.url, source: operator.source, token: operator.token});
  context.after(() => remote.close());
  const refused = await remote.request(KEY, setMode, {timeoutMs: 2000, requestId: 'req-refused'});
  assert.equal(refused.status === 'rejected' && refused.error.error.code, 'invalid-state');
  const none = await remote.request('bunny.cmd.mode.none', setMode, {timeoutMs: 2000, requestId: 'req-none'});
  assert.equal(none.status === 'rejected' && none.error.error.code, 'unavailable');
  await remote.close();
  await runtime.stop();
  assert.deepEqual(about(logs, 'req-refused'), ['runtime.command.admitted INFO', 'runtime.command.replied INFO'], 'a domain refusal is INFO');
  assert.deepEqual(about(logs, 'req-none'), ['runtime.command.refused WARN'], 'no responder is WARN');
  const replied = logs.find(record => record.event_name === 'runtime.command.replied');
  assert.deepEqual(replied?.attributes, {
    'bunny.provenance': 'source', 'bunny.participant': operator.source, 'bunny.routing.key': KEY, 'bunny.request.id': 'req-refused',
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

it('a secret in a handler\'s exception reaches no record: the bus records the uncertain result, the host the module\'s failure', async context => {
  const caller = fixture('caller');
  const {runtime, logs} = await run(context, {modules: [wall(() => { throw new Error(`the device said ${SECRET}`); }), caller]});
  const result = await contextOf(caller).sdk.request(KEY, setMode, {timeoutMs: 1000, requestId: 'req-throws'});
  assert.equal(result.status === 'uncertain' && result.error.error.code, 'uncertain-result');
  await runtime.stop();
  assert.deepEqual(about(logs, 'req-throws'), ['runtime.command.admitted INFO', 'runtime.command.uncertain WARN']);
  const failed = logs.find(record => record.event_name === 'runtime.module.failed');
  assert.equal(failed?.attributes['error.type'], 'Error');
  assert.equal(JSON.stringify([logs, runtime.spans()]).includes(SECRET), false, 'the exception\'s message stays in memory');
});
