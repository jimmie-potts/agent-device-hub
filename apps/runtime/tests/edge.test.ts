// The runtime's SDK edge and simulated modules (Hub #920): with an edge, remote parts reach the module bus over SSE and
// HTTP on the health listener, each with a run-generated grant read from a private file in the state directory. A
// grant may not act as the core or a module. With `--simulate`, every module is built with its simulated transport.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chmod, link, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {SdkError, connectRemote, type BunnyModule} from '@jimmie-potts/sdk';
import {EDGE_GRANTS_FILE, RuntimeError, buildModules, moduleSchemas, startRuntime, type LogRecord, type ModuleFactory} from '../src/index.js';
import {createCoreModule} from './fixtures/core.js';
import {deferred, fixture, it, run, stateDir} from './support.js';

const token = (): string => randomBytes(32).toString('base64url');
type Grant = {source: string; token: string};

/** Writes the edge's grants into the state directory, owner-only unless `mode` says otherwise. */
async function grant(dir: string, grants: readonly Grant[], mode = 0o600, text?: string): Promise<void> {
  const file = join(dir, EDGE_GRANTS_FILE);
  await writeFile(file, text ?? JSON.stringify({schema: 'edge-grants/1.0', grants}), {mode});
  await chmod(file, mode);
}

/** A free loopback port, so a test can reach the listener before `startRuntime` resolves. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => { server.listen({host: '127.0.0.1', port: 0}, resolve); });
  const {port} = server.address() as AddressInfo;
  await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  return port;
}

const refused = (code: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === code;

/** Fails unless a runtime with an edge on `dir` refuses to start as `accept` expects; one that starts anyway is stopped. */
async function refusesToStart(dir: string, accept: (error: unknown) => boolean, what: string): Promise<void> {
  let runtime;
  try {
    runtime = await startRuntime({modules: [], port: 0, stateDir: dir, edge: {schemas: {}}, log: () => {}});
  } catch (error) {
    assert.ok(accept(error), `${what}: ${String(error)}`);
    return;
  }
  await runtime.stop();
  assert.fail(`${what}: the runtime started`);
}

it('a remote part with a run grant connects and syncs the stand-in core\'s sessions; one without a grant is unauthenticated', async context => {
  const dir = await stateDir(context);
  const reader = {source: 'bunny/parts/reader', token: token()};
  await grant(dir, [reader]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], stateDir: dir, edge: {schemas: {}}});

  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token});
  context.after(() => remote.close());
  const synced = await remote.sync(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced', 'the stand-in core serves its sessions to the remote part');
  if (synced.status === 'synced') await synced.copy.close();

  await assert.rejects(connectRemote({url: runtime.url, source: reader.source, token: token()}),
    (error: unknown) => error instanceof SdkError && error.body.error.code === 'unauthenticated');
  const bare = await fetch(new URL('/api/sdk/v1/publish', runtime.url), {method: 'POST', body: '{}'});
  assert.equal(bare.status, 401);
  assert.equal(((await bare.json()) as {error: {code: string}}).error.code, 'unauthenticated');

  const connected = logs.filter(record => record.event_name === 'runtime.edge.connected');
  assert.deepEqual(connected.map(record => record.attributes['bunny.source']), [reader.source]);
  assert.equal(JSON.stringify(logs).includes(reader.token), false, 'no token reaches a log record');
});

it('the edge answers only requests that name the listener, and none before the modules have started', async context => {
  const dir = await stateDir(context);
  const part = {source: 'bunny/parts/hook', token: token()};
  await grant(dir, [part]);
  const port = await freePort();
  const gate = deferred<undefined>();
  const slow = fixture('slow', () => gate.promise);
  const starting = startRuntime({modules: [slow], port, stateDir: dir, edge: {schemas: {}}, log: () => {}});
  // Registered first, so a failed check still stops the runtime once its start settles.
  context.after(async () => {
    gate.resolve(undefined);
    await (await starting.catch(() => undefined))?.stop();
  });
  const url = `http://127.0.0.1:${port}`;
  const stream = (): Promise<Response> => fetch(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${part.token}`}});
  let early: Response | undefined;
  for (let attempt = 0; early === undefined && attempt < 200; attempt += 1) {
    early = await stream().catch(() => undefined);
    if (early === undefined) await new Promise(resolve => { setTimeout(resolve, 10); });
  }
  assert.equal(early?.status, 503, 'remote parts wait until every module has started');
  assert.equal(((await early.json()) as {error: {code: string}}).error.code, 'unavailable');
  gate.resolve(undefined);
  await starting;
  const remote = await connectRemote({url, source: part.source, token: part.token});
  await remote.close();
  const foreign = await fetch(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${part.token}`, origin: 'http://evil.invalid'}});
  assert.equal(foreign.status, 403);
});

it('without an edge, the SDK routes are not found', async context => {
  const {runtime} = await run(context, {modules: []});
  const response = await fetch(new URL('/api/sdk/v1/stream', runtime.url));
  assert.equal(response.status, 404);
});

it('a grants file that is missing, not private, linked or malformed is refused before the runtime serves', async context => {
  const good = {source: 'bunny/parts/reader', token: token()};
  await refusesToStart(await stateDir(context), refused('edge-grants-missing'), 'missing');

  const shared = await stateDir(context);
  await grant(shared, [good], 0o644);
  await refusesToStart(shared, refused('edge-grants-not-private'), 'mode 644');

  const linked = await stateDir(context);
  const elsewhere = await stateDir(context);
  await grant(elsewhere, [good]);
  await symlink(join(elsewhere, EDGE_GRANTS_FILE), join(linked, EDGE_GRANTS_FILE));
  await refusesToStart(linked, refused('edge-grants-not-private'), 'a symbolic link');

  const hard = await stateDir(context);
  await grant(hard, [good]);
  await link(join(hard, EDGE_GRANTS_FILE), join(hard, 'second-name'));
  await refusesToStart(hard, refused('edge-grants-not-private'), 'a second hard link');

  for (const [what, text] of [
    ['not JSON', 'grants'],
    ['another schema', JSON.stringify({schema: 'edge-grants/2.0', grants: [good]})],
    ['no grants', JSON.stringify({schema: 'edge-grants/1.0', grants: []})],
    ['a short token', JSON.stringify({schema: 'edge-grants/1.0', grants: [{source: good.source, token: 'short'}]})],
    ['a malformed source', JSON.stringify({schema: 'edge-grants/1.0', grants: [{source: 'parts/reader', token: token()}]})],
    ['a shared token', JSON.stringify({schema: 'edge-grants/1.0', grants: [good, {source: 'bunny/parts/hook', token: good.token}]})],
  ] as const) {
    const dir = await stateDir(context);
    await grant(dir, [], 0o600, text);
    await refusesToStart(dir, error => refused('edge-grants-invalid')(error) && !String(error).includes(good.token), what);
  }
});

it('a grant may not act as the core or as a module', async context => {
  for (const source of ['bunny/core', 'bunny/modules/lamp', 'bunny/modules/core']) {
    const dir = await stateDir(context);
    await grant(dir, [{source: 'bunny/parts/reader', token: token()}, {source, token: token()}]);
    await refusesToStart(dir, refused('edge-grant-source'), source);
  }
});

it('the runtime.started record says whether modules are simulated and whether the edge serves', async context => {
  const dir = await stateDir(context);
  await grant(dir, [{source: 'bunny/parts/reader', token: token()}]);
  const started = (logs: readonly LogRecord[]): LogRecord['attributes'] | undefined => logs.find(record => record.event_name === 'runtime.started')?.attributes;
  const plain = await run(context, {modules: []});
  assert.equal(started(plain.logs)?.['bunny.simulate'], false);
  assert.equal(started(plain.logs)?.['bunny.edge'], false);
  const simulated = await run(context, {modules: [], stateDir: dir, simulate: true, edge: {schemas: {}}});
  assert.equal(started(simulated.logs)?.['bunny.simulate'], true);
  assert.equal(started(simulated.logs)?.['bunny.edge'], true);
});

it('a module factory builds the module with its real transport, or with its simulated one', () => {
  const made: string[] = [];
  const module = (name: string, how: string): BunnyModule => ({manifest: {name, apiVersion: '1.0'}, start: () => { made.push(`${name} ${how}`); }, stop: () => {}});
  const factories: ModuleFactory[] = [
    {name: 'lamp', create: () => module('lamp', 'real'), simulate: () => module('lamp', 'simulated'), schemas: {'https://bunny.invalid/events/lamp/2.0': {type: 'object'}}},
    {name: 'chime', create: () => module('chime', 'real'), simulate: () => module('chime', 'simulated')},
  ];
  for (const built of [...buildModules(factories, true), ...buildModules(factories, false)]) void built.start({} as never);
  assert.deepEqual(made, ['lamp simulated', 'chime simulated', 'lamp real', 'chime real']);
  assert.deepEqual(Object.keys(moduleSchemas(factories)), ['https://bunny.invalid/events/lamp/2.0']);
});
