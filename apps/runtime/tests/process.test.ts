// The runtime as a service process, run in a child process as the service manager would run it: the shipped entry
// point with its module list and with zero modules, errors that escape to the process, and the event-loop lag check that makes the service
// manager restart the whole runtime when the process itself is stuck.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {access, chmod, mkdir, readFile, stat, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {connectRemote} from '@jimmie-potts/sdk';
import {parseArguments, shippedModules, type LogRecord} from '../src/index.js';
import {SPANS_FILE, readSpanFile} from '../src/span-file.js';
import {writeSimulatedConfiguration} from './fixtures/simulated.js';
import {edgeConfig, entry, health, it, stateDir, waitFor} from './support.js';

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

/**
 * Each shipped device module, which the shipped runtime refuses while no configuration gives it a section (Hub #919), at
 * the module API version its manifest declares.
 */
const UNCONFIGURED = shippedModules.slice(1).map(factory => ({
  name: factory.name, apiVersion: factory.simulate().manifest.apiVersion, state: 'refused', healthy: false, syncRestarts: 0,
  reason: {code: 'not-found', detail: 'the configuration has no section for this module'},
}));

it('the shipped runtime starts the core, refuses each device module that has no configuration, serves health and stops cleanly on SIGTERM', async context => {
  const runtime = await launch(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context)]);
  const {status, body} = await health(runtime.url);
  assert.equal(status, 200);
  assert.equal(body.status, UNCONFIGURED.length === 0 ? 'ok' : 'degraded');
  assert.deepEqual(body.modules, [{name: 'core', apiVersion: '1.2', state: 'running', healthy: true, syncRestarts: 0, serves: ['session', 'operation', 'inbox-item', 'mode']}, ...UNCONFIGURED]);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.ok(runtime.records().some(record => record.event_name === 'runtime.stopped'));
});

it('the shipped runtime runs every shipped module with --simulate and each factory\'s simulated section', async context => {
  const dir = await stateDir(context);
  const config = await writeSimulatedConfiguration(join(dir, 'config'), shippedModules);
  const runtime = await launch(context, MAIN, ['--port', '0', '--state-dir', join(dir, 'state'), '--simulate', '--config', config]);
  const {body} = await health(runtime.url);
  assert.deepEqual(body.modules.map(module => [module.name, module.state]), shippedModules.map(({name}) => [name, 'running']));
  assert.equal(body.status, 'ok');
  // The device modules all serve the shared device family, each for its own devices (#967): none is refused it.
  assert.deepEqual(body.modules.filter(module => module.serves?.includes('device') === true).map(module => module.name), ['lifx', 'tidbyt', 'pixoo', 'nanoleaf', 'bb8']);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.deepEqual(runtime.records().filter(record => record.severity_number >= 17).map(record => record.event_name), [], 'no error record');
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
  assert.deepEqual(fatal.attributes, {'error.type': 'RangeError', 'error.code': 'EFIXTURE', 'bunny.provenance': 'source'}, 'the type and code, never the raw message');
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

it('a burst of 600 module messages at the default lag limit reaches history while the runtime stays up', async context => {
  const runtime = await launch(context, FIXTURE, ['burst', '--port', '0', '--state-dir', await stateDir(context)]);
  const taken = (): number => runtime.records().filter(record => record.event_name === 'message.received' && record.attributes['bunny.module'] === 'core' &&
    record.attributes['bunny.participant'] === 'bunny/modules/burster' && record.attributes['bunny.outcome'] === 'accepted').length;
  const died = runtime.exited.then(exit => assert.fail(`the runtime exited during the burst: ${JSON.stringify(exit)}`));
  await Promise.race([waitFor(() => taken() === 600, 60_000, 'all 600 in history'), died]);
  assert.equal(recorded(runtime, 'runtime.stuck'), false);
  assert.equal((await health(runtime.url)).status, 200, 'and it still serves');
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
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
    assert.deepEqual(fatal?.attributes, {'error.type': 'RuntimeError', 'error.code': code, 'bunny.provenance': 'source'}, dir);
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

it('an outcome committed before a kill between commit and publish is taken exactly once after the restart, then forgotten once acknowledged, and the command is never sent again', async context => {
  // Hub #882: the lamp's outbox holds the outcome across the kill; the core keeps the outcome in its own history.
  const dir = await stateDir(context);
  const args = ['--port', '0', '--state-dir', dir];
  const of = (runtime: Spawned, module: string, event: string): LogRecord[] =>
    runtime.records().filter(record => record.attributes['bunny.module'] === module && record.event_name === event);
  const taken = (runtime: Spawned): LogRecord[] => of(runtime, 'core', 'message.received')
    .filter(record => record.attributes['bunny.message.kind'] === 'outcome' && record.attributes['bunny.outcome'] === 'accepted');

  const crashed = spawnRuntime(context, FIXTURE, ['lamp-crash', ...args]);
  assert.deepEqual(await crashed.exited, {code: null, signal: 'SIGKILL'});
  assert.equal(of(crashed, 'lamp', 'command.executing').length, 1, 'the lamp had the command once');
  assert.equal(of(crashed, 'core', 'message.received').length, 0, 'nothing was published before the kill');

  const restarted = await launch(context, FIXTURE, ['lamp-restart', ...args]);
  assert.equal(of(restarted, 'lamp', 'outbox.republished')[0]?.attributes['bunny.outbox.republished_count'], 3, 'the state, the occurrence and the outcome');
  await waitFor(() => of(restarted, 'lamp', 'outbox.acknowledged').length > 0, 10_000, 'the core\'s acknowledgment');
  restarted.child.kill('SIGTERM');
  assert.deepEqual(await restarted.exited, {code: 0, signal: null});
  const [outcome] = taken(restarted);
  assert.equal(taken(restarted).length, 1);
  assert.equal(outcome?.attributes['bunny.request.id'], 'req-crash');
  assert.equal(of(restarted, 'lamp', 'outbox.acknowledged')[0]?.attributes['bunny.message.id'], outcome?.attributes['bunny.message.id']);
  assert.equal(of(restarted, 'lamp', 'command.executing').length, 0, 'no command was sent again');

  // Acknowledged, the outcome is forgotten: the next start sends nothing again, and the core takes nothing more.
  const again = await launch(context, FIXTURE, ['lamp-restart', ...args]);
  again.child.kill('SIGTERM');
  assert.deepEqual(await again.exited, {code: 0, signal: null});
  assert.equal(of(again, 'lamp', 'outbox.republished')[0]?.attributes['bunny.outbox.republished_count'], 0);
  assert.equal(of(again, 'core', 'message.received').length, 0, 'exactly once across all three runs');
  assert.equal(of(again, 'lamp', 'command.executing').length, 0);
});

it('a kill between the core\'s commit and its publish loses and duplicates nothing: the restart sends each stored message once', async context => {
  // Hub #831: the core's outbox holds the session's state and occurrence across the kill.
  const dir = await stateDir(context);
  const args = ['--port', '0', '--state-dir', dir];
  const of = (runtime: Spawned, module: string, event: string): LogRecord[] =>
    runtime.records().filter(record => record.attributes['bunny.module'] === module && record.event_name === event);
  const heard = (runtime: Spawned, outcome: string): string[] => of(runtime, 'listener', 'message.received')
    .filter(record => record.attributes['bunny.outcome'] === outcome).map(record => String(record.attributes['bunny.message.id']));

  const crashed = spawnRuntime(context, FIXTURE, ['core-crash', ...args]);
  assert.deepEqual(await crashed.exited, {code: null, signal: 'SIGKILL'});
  assert.deepEqual(heard(crashed, 'accepted'), [], 'nothing was published before the kill');
  const database = new DatabaseSync(join(dir, 'modules', 'core.sqlite'), {readOnly: true});
  const stored = database.prepare('SELECT id, kind FROM bunny_outbox ORDER BY seq').all().map(row => ({...row}) as {id: string; kind: string});
  const committed = (database.prepare('SELECT revision FROM state').get() as {revision: number} | undefined)?.revision;
  database.close();
  assert.deepEqual(stored.map(row => row.kind), ['state', 'occurrence'], 'the session and its attention-raised, committed and unpublished');
  assert.ok((committed ?? 0) > 0);

  const restarted = await launch(context, FIXTURE, ['core-restart', ...args]);
  await waitFor(() => heard(restarted, 'accepted').length >= 2, 10_000, 'the stored messages');
  restarted.child.kill('SIGTERM');
  assert.deepEqual(await restarted.exited, {code: 0, signal: null});
  const ids = heard(restarted, 'accepted');
  for (const {id} of stored) assert.equal(ids.filter(heardId => heardId === id).length, 1, `${id} went out once, with its stored id`);
  assert.deepEqual(heard(restarted, 'duplicate'), [], 'nothing twice');

  // Published, they are gone from the outbox: the next start sends none of them again.
  const again = await launch(context, FIXTURE, ['core-restart', ...args]);
  again.child.kill('SIGTERM');
  assert.deepEqual(await again.exited, {code: 0, signal: null});
  assert.equal(heard(again, 'accepted').filter(id => stored.some(row => row.id === id)).length, 0);
});

it('a core that fails ends the runtime with a failure exit, so the service manager restarts it whole', async context => {
  // A store the core cannot read: the core's start fails, and with it the runtime.
  const dir = await stateDir(context);
  await mkdir(join(dir, 'modules'), {mode: 0o700});
  const file = join(dir, 'modules', 'core.sqlite');
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL); INSERT INTO state VALUES (1, 1, \'{"not": "a store"}\')');
  database.close();
  await chmod(file, 0o600);
  const runtime = spawnRuntime(context, MAIN, ['--port', '0', '--state-dir', dir]);
  assert.deepEqual(await runtime.exited, {code: 1, signal: null});
  const failed = runtime.records().find(record => record.event_name === 'runtime.module.failed');
  assert.deepEqual([failed?.attributes['bunny.module'], failed?.attributes['bunny.phase']], ['core', 'start']);
  const fatal = runtime.records().find(record => record.event_name === 'runtime.failed');
  assert.deepEqual([fatal?.attributes['error.type'], fatal?.attributes['error.code'], fatal?.severity_text], ['RuntimeError', 'core-failed', 'FATAL']);
  assert.equal(runtime.stdout(), '', 'no ready line');
});

it('a second runtime on the same state directory cannot take the core\'s lease: its core fails, and it exits, while the first serves on', async context => {
  const dir = await stateDir(context);
  const first = await launch(context, MAIN, ['--port', '0', '--state-dir', dir]);
  const second = spawnRuntime(context, MAIN, ['--port', '0', '--state-dir', dir]);
  assert.deepEqual(await second.exited, {code: 1, signal: null}, 'refused: the first keeps the core\'s database to itself (Hub #972)');
  assert.equal(second.records().find(record => record.event_name === 'runtime.failed')?.attributes['error.code'], 'core-failed');
  const report = await health(first.url);
  assert.equal(entry(report.body, 'core').state, 'running');
  first.child.kill('SIGTERM');
  assert.deepEqual(await first.exited, {code: 0, signal: null});
});

it('the shipped entry point runs with --simulate and --edge, and a remote part with a run grant reaches the edge', async context => {
  const reader = {source: 'bunny/parts/reader', token: `tok_SYNTHETIC835_${randomBytes(16).toString('hex')}`, scopes: ['read'] as const};
  const {config} = await edgeConfig(context, [reader]);
  const runtime = await launch(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context), '--config', config, '--simulate', '--edge']);
  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token});
  await remote.close();
  const started = runtime.records().find(record => record.event_name === 'runtime.started');
  assert.deepEqual([started?.attributes['bunny.simulate'], started?.attributes['bunny.edge']], [true, true]);
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
  assert.equal(runtime.records().some(record => JSON.stringify(record).includes('tok_SYNTHETIC835')), false, 'no token reaches a log record');
});

it('a SIGHUP while the runtime still starts is kept, and the credentials reload once the gateway serves', async context => {
  const reader = {source: 'bunny/parts/reader', token: `tok_SYNTHETIC835_${randomBytes(16).toString('hex')}`, scopes: ['read'] as const};
  const {config} = await edgeConfig(context, [reader]);
  const runtime = spawnRuntime(context, FIXTURE, ['slow-start', '--port', '0', '--state-dir', await stateDir(context), '--config', config, '--edge']);
  await waitFor(() => recorded(runtime, 'runtime.started'), 5000, 'the health server');
  runtime.child.kill('SIGHUP');
  await waitFor(() => runtime.stdout().includes('\n'), 15_000, 'the ready line');
  await waitFor(() => recorded(runtime, 'runtime.edge.reloaded'), 5000, 'the reload');
  const records = runtime.records();
  const reloads = records.filter(record => record.event_name === 'runtime.edge.reloaded');
  assert.deepEqual(reloads.map(record => record.attributes['bunny.outcome']), ['succeeded']);
  const served = records.findIndex(record => record.event_name === 'runtime.edge.serving');
  assert.ok(served >= 0 && served < records.findIndex(record => record.event_name === 'runtime.edge.reloaded'), 'the reload came once the gateway served');
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
});

it('--edge refuses a configuration without its edge section and a credential that acts as the core or a module, naming the reason in runtime.failed', async context => {
  const token = (): string => randomBytes(32).toString('base64url');
  const cases: readonly (readonly [readonly string[] | undefined, string])[] = [
    [undefined, 'edge-config-missing'], [['bunny/parts/reader', 'bunny/core'], 'edge-credential-source'], [['bunny/modules/lamp'], 'edge-credential-source'],
  ];
  for (const [sources, code] of cases) {
    const config = sources === undefined ? [] : ['--config', (await edgeConfig(context, sources.map(source => ({source, token: token()})))).config];
    const runtime = spawnRuntime(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context), ...config, '--edge']);
    assert.deepEqual(await runtime.exited, {code: 1, signal: null}, code);
    assert.equal(runtime.records().find(record => record.event_name === 'runtime.failed')?.attributes['error.code'], code, code);
    assert.equal(runtime.stdout(), '', 'no ready line');
  }
});

it('--config reads a private configuration file, and a file the runtime cannot trust names its reason in runtime.failed', async context => {
  const root = await stateDir(context);
  const valid = JSON.stringify({schema: 'runtime-config/1.0', modules: {}});
  const write = async (name: string, text: string, mode = 0o600): Promise<string> => {
    await writeFile(join(root, name), text, {mode});
    await chmod(join(root, name), mode);
    return join(root, name);
  };
  const good = await write('config.json', valid);
  const cases: readonly (readonly [string, string])[] = [
    ['relative/config.json', 'config-relative'],
    [join(root, 'missing.json'), 'config-missing'],
    [await write('shared.json', valid, 0o644), 'config-not-private'],
    [await write('broken.json', '{'), 'config-invalid'],
  ];
  await symlink(good, join(root, 'linked.json'));
  for (const [file, code] of [...cases, [join(root, 'linked.json'), 'config-link'] as const]) {
    const runtime = spawnRuntime(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context), '--config', file]);
    assert.deepEqual(await runtime.exited, {code: 1, signal: null}, file);
    assert.deepEqual(runtime.records().find(record => record.event_name === 'runtime.failed')?.attributes,
      {'error.type': 'RuntimeError', 'error.code': code, 'bunny.provenance': 'source'}, file);
    assert.equal(runtime.stdout(), '', `${file}: no ready line`);
  }
  const runtime = await launch(context, MAIN, ['--port', '0', '--state-dir', await stateDir(context), '--config', good]);
  // The file names no module, so the core runs and each shipped device module is refused for want of its section.
  assert.deepEqual((await health(runtime.url)).body.modules.slice(1), UNCONFIGURED);
  assert.equal(entry((await health(runtime.url)).body, 'core').state, 'running');
  runtime.child.kill('SIGTERM');
  assert.deepEqual(await runtime.exited, {code: 0, signal: null});
});

it('an error that escapes every module carrying a secret a module read leaves that secret out of runtime.failed', async context => {
  // The reviewer's case: an error code copied from a credential, thrown by a listener on an emitter outside every module.
  const secret = 'tok_SYNTHETIC919';
  const dir = await stateDir(context);
  await writeFile(join(dir, 'token'), `${secret}\n`, {mode: 0o600});
  await chmod(join(dir, 'token'), 0o600);
  await writeFile(join(dir, 'config.json'), JSON.stringify({schema: 'runtime-config/1.0', modules: {leaker: {secrets: {token: join(dir, 'token')}}}}), {mode: 0o600});
  await chmod(join(dir, 'config.json'), 0o600);
  const runtime = spawnRuntime(context, FIXTURE, ['secret-escape', '--port', '0', '--state-dir', await stateDir(context), '--config', join(dir, 'config.json')]);
  assert.deepEqual(await runtime.exited, {code: 1, signal: null}, 'an error outside every module is the runtime\'s own failure');
  const fatal = runtime.records().find(record => record.event_name === 'runtime.failed');
  assert.deepEqual(fatal?.attributes, {'error.type': 'Error', 'bunny.provenance': 'source'}, 'the record is written, without the code that holds the secret');
  assert.equal(runtime.records().some(record => JSON.stringify(record).includes(secret)), false, 'no record holds the secret');
  assert.equal(runtime.stdout().includes(secret), false);
});

it('--record-spans keeps the runtime\'s spans in a private file of the state directory, and without it there is none', async context => {
  for (const record of [true, false]) {
    const dir = await stateDir(context);
    const runtime = await launch(context, FIXTURE, ['lamp-driven', '--port', '0', '--state-dir', dir, ...(record ? ['--record-spans'] : [])]);
    await waitFor(() => runtime.records().some(entry => entry.event_name === 'command.completed' && entry.attributes['bunny.request.id'] === 'req-crash'), 10_000, 'the driver\'s command');
    runtime.child.kill('SIGTERM');
    assert.deepEqual(await runtime.exited, {code: 0, signal: null});
    if (record) {
      assert.equal((await stat(join(dir, SPANS_FILE))).mode & 0o777, 0o600);
      const names = readSpanFile(dir).lines.map(line => (JSON.parse(line) as {resourceSpans: {scopeSpans: {spans: {name: string}[]}[]}[]}).resourceSpans[0]?.scopeSpans[0]?.spans[0]?.name);
      assert.ok(['bunny.command.request', 'bunny.command.execute', 'bunny.device.call'].every(name => names.includes(name)), `the spans are in the file: ${names.join(',')}`);
    } else {
      await assert.rejects(stat(join(dir, SPANS_FILE)), 'the installed default writes no span file');
    }
  }
});

it('--record-spans is a flag with no value, and the usage line names it', () => {
  assert.equal(parseArguments(['--port', '0']).recordSpans, false);
  assert.equal(parseArguments(['--port', '0', '--record-spans']).recordSpans, true);
  assert.throws(() => parseArguments(['--port', '0', '--record-spans', 'yes']), /unexpected argument|positional/i);
});
