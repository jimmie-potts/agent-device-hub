// The runtime's log records are diagnostic-contract records (Hub #903): profile 1.2, a registered event with its static
// body, the runtime's resource and scope, and only registered attributes. A sink that fails never changes what the
// runtime does.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {parseRecord, type DiagnosticRecord} from '@jimmie-potts/bunny-observability';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {startRuntime, type LogRecord} from '../src/index.js';
import {LogWriter, errorFields} from '../src/log.js';
import {RUNTIME_PACKAGE_VERSION, UUID, contextOf, fixture, health, it, setMode, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/process.js', import.meta.url));
const clock = {now: () => Date.parse('2026-10-06T12:00:00.000Z')};

type Child = {child: ChildProcess; lines: () => string[]; stdout: () => string; exited: Promise<{code: number | null; signal: NodeJS.Signals | null}>};

/** Starts a runtime process; `closeStderr` closes the reading end of its stderr at once. Killed after the test. */
function start(context: TestContext, script: string, args: readonly string[], closeStderr = false): Child {
  const child = spawn(process.execPath, [script, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit').then(([code, signal]) => ({code: code as number | null, signal: signal as NodeJS.Signals | null}));
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  let stdout = '';
  if (closeStderr) child.stderr?.destroy();
  else child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  return {child, lines: () => stderr.split('\n').filter(line => line !== ''), stdout: () => stdout, exited};
}

/** Each stderr line as the contract parses it; a line it refuses fails the test. */
function parsed(lines: readonly string[]): DiagnosticRecord[] {
  return lines.map(line => {
    const result = parseRecord(line);
    assert.ok(result.ok, `a contract record: ${line}`);
    return result.value;
  });
}

const ready = (runtime: Child): Promise<void> => waitFor(() => runtime.stdout().includes('\n'), 15_000, 'the ready line');
const url = (runtime: Child): string => (JSON.parse(runtime.stdout().split('\n')[0] ?? '') as {url: string}).url;

it('every stderr line of a runtime process is a contract record carrying the runtime\'s resource, and each process has its own instance ID', async context => {
  const instances: string[] = [];
  for (const environment of ['development', 'production'] as const) {
    const args = ['--port', '0', '--state-dir', await stateDir(context), ...(environment === 'development' ? [] : ['--environment', environment])];
    const runtime = start(context, MAIN, args);
    await ready(runtime);
    assert.deepEqual(Object.keys(JSON.parse(runtime.stdout().split('\n')[0] ?? '') as object), ['event', 'url'], 'the ready line is unchanged');
    runtime.child.kill('SIGTERM');
    assert.deepEqual(await runtime.exited, {code: 0, signal: null});
    const records = parsed(runtime.lines());
    assert.deepEqual(records.map(record => record.event_name), ['runtime.started', 'runtime.ready', 'runtime.stopped']);
    for (const record of records) {
      assert.equal(record.schema_version, '1.3');
      assert.deepEqual(record.scope, {name: 'bunny.runtime', version: '1.0.0'});
      assert.equal(record.resource['service.name'], 'runtime');
      assert.equal(record.resource['service.version'], RUNTIME_PACKAGE_VERSION);
      assert.equal(record.resource['deployment.environment.name'], environment, 'development unless --environment says otherwise');
      assert.match(record.resource['service.instance.id'] ?? '', UUID);
    }
    assert.equal(records[0]?.attributes['server.port'], Number(new URL(url(runtime)).port));
    assert.deepEqual(records[2]?.attributes, {'bunny.telemetry.dropped_count': 0, 'bunny.telemetry.failure_count': 0, 'bunny.provenance': 'source'},
      'runtime.stopped counts the records the writer dropped or lost');
    assert.equal(new Set(records.map(record => record.resource['service.instance.id'])).size, 1, 'one instance ID per process');
    instances.push(records[0]?.resource['service.instance.id'] ?? '');
  }
  assert.notEqual(instances[0], instances[1], 'another process has another instance ID');
});

it('the entry point refuses an environment the contract does not know', async context => {
  const runtime = start(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context), '--environment', 'staging']);
  assert.deepEqual(await runtime.exited, {code: 2, signal: null});
  assert.match(runtime.lines().join('\n'), /--environment must be development, test or production/);
});

it('the watchdog thread\'s runtime.stuck record is a contract record with the process\'s own resource', async context => {
  const runtime = start(context, FIXTURE, ['stuck', '--port', '0', '--state-dir', await stateDir(context), '--lag-limit-ms', '300', '--environment', 'test']);
  assert.deepEqual(await runtime.exited, {code: null, signal: 'SIGKILL'});
  const records = parsed(runtime.lines());
  const started = records.find(record => record.event_name === 'runtime.started');
  const stuck = records.find(record => record.event_name === 'runtime.stuck');
  assert.ok(started && stuck);
  assert.deepEqual(stuck.resource, started.resource);
  assert.equal(stuck.resource['deployment.environment.name'], 'test', 'the thread has the process\'s environment');
  assert.equal(stuck.body, 'Runtime event loop stuck');
  assert.equal(stuck.attributes['bunny.lag.limit_ms'], 300);
});

it('the watchdog still kills a stuck process whose stderr is closed, though it cannot write runtime.stuck', async context => {
  const runtime = start(context, FIXTURE, ['stuck', '--port', '0', '--state-dir', await stateDir(context), '--lag-limit-ms', '300'], true);
  const stillRunning = new Promise(resolve => { setTimeout(() => { resolve('still running'); }, 10_000).unref(); });
  assert.deepEqual(await Promise.race([runtime.exited, stillRunning]), {code: null, signal: 'SIGKILL'});
});

it('a process whose stderr is closed keeps serving, and still stops cleanly on SIGTERM', async context => {
  const runtime = start(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context)], true);
  await Promise.race([ready(runtime), runtime.exited.then(exit => assert.fail(`exited: ${JSON.stringify(exit)}`))]);
  assert.equal((await health(url(runtime))).status, 200);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null}, 'writing runtime.stopped to a closed stderr is not a failure');
});

it('a sink that throws never changes what the runtime or its modules do', async context => {
  let calls = 0;
  const chatty = fixture('chatty', async ({sdk, log}) => {
    await sdk.respond('bunny.cmd.mode.chatty', command => {
      log.info('command.completed', {'bunny.outcome': 'succeeded'}, command);
      return {status: 'accepted'};
    });
  });
  const caller = fixture('caller');
  const runtime = await startRuntime({
    modules: [chatty, caller], port: 0, stateDir: await stateDir(context),
    log: () => { calls += 1; throw new Error('the journal is gone'); },
  });
  context.after(() => runtime.stop());
  const result = await contextOf(caller).sdk.request('bunny.cmd.mode.chatty', setMode, {timeoutMs: 1000});
  assert.equal(result.status, 'accepted');
  assert.equal(runtime.health().status, 'ok');
  assert.ok(runtime.health().modules.every(module => module.state === 'running'));
  await runtime.stop();
  assert.ok(calls > 3, 'the runtime and the module kept logging');
});

it('a writer counts written, dropped and failed records, and a failing sink never reaches the caller', () => {
  const written: LogRecord[] = [];
  let failing = false;
  const writer = new LogWriter(record => {
    if (failing) throw new Error('sink down');
    written.push(record);
  }, 'info', clock);
  const log = writer.logger('bunny.module', {'bunny.module': 'lamp'});
  log.info('command.completed', {'bunny.outcome': 'succeeded'});
  log.debug('command.completed');
  log.info('lamp.switched');
  log.info('command.completed', {'bunny.device.id': 'http://192.0.2.7/?token=secret'});
  failing = true;
  assert.doesNotThrow(() => { log.error('operation.failed'); });
  assert.deepEqual(writer.counts(), {written: 1, dropped: 2, failed: 1});
  assert.equal(written[0]?.timestamp, '2026-10-06T12:00:00.000Z');
  assert.deepEqual(writer.resource, written[0]?.resource);
});

it('an error\'s record fields are its type and an identifier code, never its message', () => {
  const coded = Object.assign(new TypeError('GET http://192.0.2.7/?token=secret refused'), {code: 'ECONNREFUSED'});
  assert.deepEqual(errorFields(coded), {'error.type': 'TypeError', 'error.code': 'ECONNREFUSED'});
  assert.deepEqual(errorFields(Object.assign(new Error('x'), {code: 'not an identifier'})), {'error.type': 'Error'});
  assert.deepEqual(errorFields(Object.assign(new Error('x'), {name: 'Bad name with spaces'})), {'error.type': 'Error'});
  assert.deepEqual(errorFields(new SdkError(errorBody('unavailable', {detail: 'secret'}))), {'error.type': 'SdkError', 'error.code': 'unavailable'});
  assert.deepEqual(errorFields('a thrown string'), {'error.type': 'string'});
});
