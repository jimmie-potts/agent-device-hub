// The runtime as a service process, run in a child process as the service manager would run it: the shipped entry
// point with zero modules, errors that escape to the process, and the event-loop lag check that makes the service
// manager restart the whole runtime when the process itself is stuck.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {access, mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {LogRecord} from '../src/index.js';
import {entry, health, it, stateDir, waitFor} from './support.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/process.js', import.meta.url));
const SLOW_LOAD = fileURLToPath(new URL('./fixtures/slow-load.js', import.meta.url));

type Exit = {code: number | null; signal: NodeJS.Signals | null};
type Spawned = {child: ChildProcess; records: () => LogRecord[]; stdout: () => string; exited: Promise<Exit>};
type Launched = Spawned & {url: string};

/** Starts a runtime process. It is killed after the test if it is still running. */
function spawnRuntime(context: TestContext, script: string, args: readonly string[]): Spawned {
  const child = spawn(process.execPath, [script, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  const exited = once(child, 'exit').then(([code, signal]) => ({code: code as number | null, signal: signal as NodeJS.Signals | null}));
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  let stdout = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  const records = (): LogRecord[] => stderr.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as LogRecord);
  return {child, records, stdout: () => stdout, exited};
}

/** Starts a runtime process and waits for its ready line. */
async function launch(context: TestContext, script: string, args: readonly string[]): Promise<Launched> {
  const spawned = spawnRuntime(context, script, args);
  const exitedEarly = spawned.exited.then(exit => assert.fail(`exited before ready: ${JSON.stringify(exit)} ${JSON.stringify(spawned.records())}`));
  await Promise.race([waitFor(() => spawned.stdout().includes('\n'), 15_000, 'the ready line'), exitedEarly]);
  const ready = JSON.parse(spawned.stdout().split('\n')[0] ?? '') as {event: string; url: string};
  assert.equal(ready.event, 'runtime.ready');
  return {...spawned, url: ready.url};
}

const recorded = (runtime: Spawned, event: string): boolean => runtime.records().some(record => record.event_name === event);

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
  assert.deepEqual(fatal.attributes, {'error.type': 'RangeError', 'error.code': 'EFIXTURE'}, 'the type and code, never the raw message');
});

it('an abort listener that throws or rejects stays with its own module, on a handler error, a failed start and the runtime\'s stop', async context => {
  const runtime = await launch(context, FIXTURE, ['abort-listeners', '--port', '0', '--state-dir', await stateDir(context)]);
  const failedAll = async (): Promise<boolean> => (await health(runtime.url)).body.modules.filter(module => module.state === 'failed').length === 4;
  await waitFor(failedAll, 5000, 'the four failures');
  await new Promise(resolve => { setTimeout(resolve, 200); });
  const {body} = await health(runtime.url);
  for (const name of ['handler-throws', 'handler-rejects']) assert.deepEqual(entry(body, name).reason, {code: 'internal', detail: 'a handler threw'}, name);
  for (const name of ['start-throws', 'start-rejects']) assert.deepEqual(entry(body, name).reason, {code: 'internal', detail: 'start failed'}, name);
  for (const name of ['publisher', 'stop-throws', 'stop-rejects', 'steady']) assert.equal(entry(body, name).state, 'running', `${name} is not blamed`);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null}, 'abort listeners that fail during the runtime\'s stop do not fail the process');
  assert.equal(recorded(runtime, 'runtime.failed'), false);
});

it('a signal during startup stops the runtime cleanly once the module starts settle', async context => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    const runtime = spawnRuntime(context, FIXTURE, ['slow-start', '--port', '0', '--state-dir', await stateDir(context)]);
    await waitFor(() => recorded(runtime, 'runtime.started'), 5000, 'the health server');
    runtime.child.kill(signal);
    assert.deepEqual(await runtime.exited, {code: 0, signal: null}, signal);
    assert.ok(recorded(runtime, 'fixture.stopped'), `${signal}: the slow module was stopped`);
    assert.equal(runtime.stdout(), '', `${signal}: no ready line`);
  }
});

it('a pause of the whole process longer than the lag limit does not restart the runtime', async context => {
  // A 1000 ms limit checks every 250 ms; a 3 s pause, like a VM paused while its host sleeps, outlasts it threefold.
  const runtime = await launch(context, FIXTURE, ['quiet', '--port', '0', '--state-dir', await stateDir(context), '--lag-limit-ms', '1000']);
  runtime.child.kill('SIGSTOP');
  await new Promise(resolve => { setTimeout(resolve, 3000); });
  runtime.child.kill('SIGCONT');
  await new Promise(resolve => { setTimeout(resolve, 1500); });
  assert.equal((await health(runtime.url)).status, 200);
  assert.equal(runtime.child.signalCode, null, 'a stopped and continued process is not stuck');
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.equal(recorded(runtime, 'runtime.stuck'), false);
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

it('the entry point imports only the launcher, so its signal handlers come before the rest of the runtime loads', async () => {
  const source = await readFile(MAIN, 'utf8');
  const imports = [...source.matchAll(/^import\s.*?from\s+'([^']+)';/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['./launch.js']);
});

it('a signal while the runtime still loads stops it with exit 0, before it creates any state', async context => {
  for (const [mode, signal] of [['wait', 'SIGTERM'], ['wait', 'SIGINT'], ['block', 'SIGTERM']] as const) {
    const dir = join(await stateDir(context), 'state');
    const runtime = spawnRuntime(context, SLOW_LOAD, [mode, '--port', '0', '--state-dir', dir]);
    await waitFor(() => recorded(runtime, 'fixture.loading'), 5000, 'the load to begin');
    runtime.child.kill(signal);
    assert.deepEqual(await runtime.exited, {code: 0, signal: null}, `${mode} ${signal}`);
    await assert.rejects(access(dir), `${mode} ${signal}: no state was created`);
    assert.equal(runtime.stdout(), '', `${mode} ${signal}: no ready line`);
  }
});

it('a refused state directory names its reason in the runtime.failed record, so the journal says why', async context => {
  const root = await stateDir(context);
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, '.git'), {recursive: true});
  await mkdir(join(root, 'real'), {mode: 0o700});
  await symlink(join(root, 'real'), join(root, 'link'));
  await symlink(join(root, 'nowhere'), join(root, 'dangling'));
  await writeFile(join(root, 'file'), '');
  await mkdir(join(root, 'shared'), {mode: 0o750});
  const cases: readonly (readonly [string, string])[] = [
    ['relative/state', 'state-dir-relative'],
    [`/mnt/bunny-runtime-test-${process.pid}/state`, 'state-dir-mount'],
    [join(checkout, 'state'), 'state-dir-checkout'],
    [join(root, 'link', 'state'), 'state-dir-link'],
    [join(root, 'dangling'), 'state-dir-link'],
    [join(root, 'file'), 'state-dir-not-directory'],
    [join(root, 'shared'), 'state-dir-not-private'],
  ];
  for (const [dir, code] of cases) {
    const runtime = spawnRuntime(context, MAIN, ['--port', '0', '--state-dir', dir]);
    assert.deepEqual(await runtime.exited, {code: 1, signal: null}, dir);
    const fatal = runtime.records().find(record => record.event_name === 'runtime.failed');
    assert.deepEqual(fatal?.attributes, {'error.type': 'RuntimeError', 'error.code': code}, dir);
  }
});

it('a health port already in use names its reason in the runtime.failed record', async context => {
  const blocker = createServer();
  await new Promise<void>(resolve => { blocker.listen({host: '127.0.0.1', port: 0}, resolve); });
  context.after(() => { blocker.close(); });
  const {port} = blocker.address() as AddressInfo;
  const runtime = spawnRuntime(context, MAIN, ['--port', String(port), '--state-dir', join(await stateDir(context), 'state')]);
  assert.deepEqual(await runtime.exited, {code: 1, signal: null});
  assert.equal(runtime.records().find(record => record.event_name === 'runtime.failed')?.attributes['error.code'], 'EADDRINUSE');
});
