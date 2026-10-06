// The runtime as a service process, run in a child process as the service manager would run it: the shipped entry
// point with zero modules, errors that escape to the process, and the event-loop lag check that makes the service
// manager restart the whole runtime when the process itself is stuck.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {LogRecord} from '../src/index.js';
import {entry, health, it, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/process.js', import.meta.url));

type Launched = {child: ChildProcess; url: string; records: () => LogRecord[]; exited: Promise<{code: number | null; signal: NodeJS.Signals | null}>};

/** Starts a runtime process and waits for its ready line. The process is killed after the test if it is still running. */
async function launch(context: TestContext, script: string, args: readonly string[]): Promise<Launched> {
  const child = spawn(process.execPath, [script, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit').then(([code, signal]) => ({code: code as number | null, signal: signal as NodeJS.Signals | null}));
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const records = (): LogRecord[] => stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as LogRecord);
  const lines = createInterface({input: child.stdout ?? process.stdin});
  const line: unknown[] = await Promise.race([once(lines, 'line'), exited.then(exit => assert.fail(`exited before ready: ${JSON.stringify(exit)} ${stderr}`))]);
  const ready = JSON.parse(String(line[0])) as {event: string; url: string};
  assert.equal(ready.event, 'runtime.ready');
  return {child, url: ready.url, records, exited};
}

it('the shipped runtime starts with zero modules, serves health and stops cleanly on SIGTERM', async context => {
  const runtime = await launch(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context)]);
  const {status, body} = await health(runtime.url);
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.modules, []);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.ok(runtime.records().some(record => record.event_name === 'runtime.stopped'));
});

it('the entry point refuses missing or malformed arguments', async context => {
  for (const args of [[], ['--port', 'eighty'], ['--port', '70000'], ['--port', '0', '--lag-limit-ms', '0'], ['--port', '0', '--unknown']]) {
    const child = spawn(process.execPath, [MAIN, ...args, '--state-dir', await stateDir(context)], {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const [code] = await once(child, 'exit') as [number | null];
    assert.equal(code, 2, args.join(' '));
    assert.match(stderr, /usage: /, args.join(' '));
  }
});

it('errors that escape two modules stop only those modules, and the process keeps serving', async context => {
  const runtime = await launch(context, FIXTURE, ['escaping', '--port', '0', '--state-dir', await stateDir(context)]);
  await waitFor(async () => (await health(runtime.url)).body.modules.filter(module => module.state === 'failed').length === 2, 5000, 'two failures');
  const {body} = await health(runtime.url);
  for (const name of ['thrower', 'rejecter']) {
    assert.deepEqual(entry(body, name).reason, {code: 'internal', detail: 'an error escaped the module'}, name);
  }
  assert.equal(entry(body, 'steady').state, 'running');
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
});

it('an error that no module raised exits with a failure, for the service manager to restart the runtime', async context => {
  const runtime = await launch(context, FIXTURE, ['runtime-error', '--port', '0', '--state-dir', await stateDir(context)]);
  assert.deepEqual(await runtime.exited, {code: 1, signal: null});
  const fatal = runtime.records().find(record => record.event_name === 'runtime.failed');
  assert.equal(fatal?.severity_text, 'FATAL');
  assert.equal(fatal.attributes['error.message'], 'a bug outside every module');
});

it('a stuck event loop is detected, and the process is killed for the service manager to restart', async context => {
  const runtime = await launch(context, FIXTURE, ['stuck', '--port', '0', '--state-dir', await stateDir(context), '--lag-limit-ms', '300']);
  assert.equal((await health(runtime.url)).status, 200, 'health answers before the loop sticks');
  const began = performance.now();
  assert.deepEqual(await runtime.exited, {code: null, signal: 'SIGKILL'});
  assert.ok(performance.now() - began < 5000, 'killed soon after the limit');
  const stuck = runtime.records().find(record => record.event_name === 'runtime.stuck');
  assert.equal(stuck?.severity_text, 'FATAL');
  assert.equal(stuck.attributes['bunny.lag.limit_ms'], 300);
});

it('a busy spell shorter than the lag limit does not restart the runtime', async context => {
  const runtime = await launch(context, FIXTURE, ['busy', '--port', '0', '--state-dir', await stateDir(context), '--lag-limit-ms', '1000']);
  await new Promise(resolve => { setTimeout(resolve, 1500); });
  assert.equal((await health(runtime.url)).status, 200);
  assert.equal(runtime.child.exitCode, null);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.equal(runtime.records().some(record => record.event_name === 'runtime.stuck'), false);
});
