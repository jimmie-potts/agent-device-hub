// The runtime's SDK edge and simulated modules (Hub #920, #835): with an edge, remote parts reach the module bus over SSE
// and HTTP on the health listener, each with a client credential from the private file that the configuration file's
// edge section names. A credential may not act as the core or a module. With `--simulate`, every module is built with
// its simulated transport.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {link, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {catalog} from '@jimmie-potts/bunny-observability';
import {errorCodes} from '@jimmie-potts/event-contracts/v2';
import {SdkError, connectRemote, type BunnyModule} from '@jimmie-potts/sdk';
import {RuntimeError, buildModules, moduleSchemas, startRuntime, tokenDigest, type LogRecord, type ModuleFactory} from '../src/index.js';
import {REGISTRY_REASONS} from '../src/runtime.js';
import {createCoreModule} from './fixtures/core.js';
import {deferred, edgeConfig, fixture, it, run, stateDir, waitFor, type EdgePart} from './support.js';

const token = (): string => randomBytes(32).toString('base64url');

/** A free loopback port, so a test can reach the listener before `startRuntime` resolves. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => { server.listen({host: '127.0.0.1', port: 0}, resolve); });
  const {port} = server.address() as AddressInfo;
  await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
  return port;
}

const refused = (code: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === code;

/** Fails unless a runtime with an edge refuses to start as `accept` expects; one that starts anyway is stopped. */
async function refusesToStart(dir: string, configFile: string | undefined, accept: (error: unknown) => boolean, what: string): Promise<void> {
  let runtime;
  try {
    runtime = await startRuntime({modules: [], port: 0, stateDir: dir, ...(configFile === undefined ? {} : {configFile}), edge: {schemas: {}}, log: () => {}});
  } catch (error) {
    assert.ok(accept(error), `${what}: ${String(error)}`);
    return;
  }
  await runtime.stop();
  assert.fail(`${what}: the runtime started`);
}

it('a remote part with a run grant connects and syncs the core\'s sessions; one without a grant is unauthenticated', async context => {
  const reader = {source: 'bunny/parts/reader', token: token()};
  const {config} = await edgeConfig(context, [reader]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: config, edge: {schemas: {}}});

  const remote = await connectRemote({url: runtime.url, source: reader.source, token: reader.token});
  context.after(() => remote.close());
  const synced = await remote.sync(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(synced.status, 'synced', 'the core serves its sessions to the remote part');
  if (synced.status === 'synced') await synced.copy.close();

  // A part that connects anyway is closed, so a failed check leaves no stream open.
  const without = await connectRemote({url: runtime.url, source: reader.source, token: token()}).then(
    async remote => { await remote.close(); return 'connected'; },
    (error: unknown) => error instanceof SdkError ? error.body.error.code : 'failed',
  );
  assert.equal(without, 'unauthenticated');
  const bare = await fetch(new URL('/api/sdk/v1/publish', runtime.url), {method: 'POST', body: '{}'});
  assert.equal(bare.status, 401);
  assert.equal(((await bare.json()) as {error: {code: string}}).error.code, 'unauthenticated');

  const connected = logs.filter(record => record.event_name === 'runtime.edge.connected');
  assert.deepEqual(connected.map(record => record.attributes['bunny.participant']), [reader.source]);
  assert.equal(JSON.stringify(logs).includes(reader.token), false, 'no token reaches a log record');
});

it('the edge answers only requests that name the listener, and one part retrying across the start connects once it settles', async context => {
  const dir = await stateDir(context);
  const part = {source: 'bunny/parts/hook', token: token()};
  const {config} = await edgeConfig(context, [part]);
  const port = await freePort();
  const gate = deferred<undefined>();
  const slow = fixture('slow', () => gate.promise);
  const starting = startRuntime({modules: [slow], port, stateDir: dir, configFile: config, edge: {schemas: {}}, log: () => {}});
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

  // One part keeps trying with its grant while the modules start. The listener already answers, so each refusal it
  // gets is the edge's 503; once the start settles, the same part's next attempt connects.
  const refusals: string[] = [];
  let stopTrying = false;
  context.after(() => { stopTrying = true; });
  const retrying = (async () => {
    while (!stopTrying) {
      try {
        return await connectRemote({url, source: part.source, token: part.token});
      } catch (error) {
        refusals.push(error instanceof SdkError ? error.body.error.code : 'failed');
        await new Promise(resolve => { setTimeout(resolve, 10); });
      }
    }
    return undefined;
  })();
  await waitFor(() => refusals.length >= 2, 5000, 'the part to be refused while the modules start');
  gate.resolve(undefined);
  const remote = await retrying;
  assert.ok(remote, 'the retrying part connected');
  await remote.close();
  await starting;
  assert.deepEqual([...new Set(refusals)], ['unavailable'], 'every refusal before the start settled was unavailable');
  const foreign = await fetch(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${part.token}`, origin: 'http://evil.invalid'}});
  assert.equal(foreign.status, 403);
});

it('without an edge, the SDK routes are not found', async context => {
  const {runtime} = await run(context, {modules: []});
  const response = await fetch(new URL('/api/sdk/v1/stream', runtime.url));
  assert.equal(response.status, 404);
});

it('an edge without its configuration section, or with a credentials file that is missing, not private, linked or malformed, is refused before the runtime serves', async context => {
  const good: EdgePart = {source: 'bunny/parts/reader', token: token()};
  await refusesToStart(await stateDir(context), undefined, refused('edge-config-missing'), 'no configuration file');
  const unconfigured = await edgeConfig(context, [good]);
  await writeFile(unconfigured.config, JSON.stringify({schema: 'runtime-config/1.0', modules: {}}));
  await refusesToStart(await stateDir(context), unconfigured.config, refused('edge-config-missing'), 'no edge section');

  const missing = await edgeConfig(context, [good]);
  await rm(missing.credentials);
  await refusesToStart(await stateDir(context), missing.config, refused('edge-credentials-missing'), 'missing');

  const shared = await edgeConfig(context, [good], {mode: 0o644});
  await refusesToStart(await stateDir(context), shared.config, refused('edge-credentials-not-private'), 'mode 644');

  const linked = await edgeConfig(context, [good]);
  const elsewhere = await edgeConfig(context, [good]);
  await rm(linked.credentials);
  await symlink(elsewhere.credentials, linked.credentials);
  await refusesToStart(await stateDir(context), linked.config, refused('edge-credentials-not-private'), 'a symbolic link');

  const hard = await edgeConfig(context, [good]);
  await link(hard.credentials, join(hard.dir, 'second-name'));
  await refusesToStart(await stateDir(context), hard.config, refused('edge-credentials-not-private'), 'a second hard link');

  const credential = {id: 'reader', source: good.source, digest: tokenDigest(good.token), scopes: ['read']};
  for (const [what, text] of [
    ['not JSON', 'credentials'],
    ['another schema', JSON.stringify({schema: 'edge-credentials/2.0', credentials: [credential]})],
    ['a digest that is not one', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [{...credential, digest: good.token}]})],
    ['a malformed source', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [{...credential, source: 'parts/reader'}]})],
    ['an unknown scope', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [{...credential, scopes: ['read', 'owner']}]})],
    // No grant limits a credential to some devices: one that names devices is refused, never read wider than it was written.
    ['a credential that names devices', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [{...credential, devices: ['lamp-1']}]})],
    ['a shared token', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [credential, {...credential, id: 'hook', source: 'bunny/parts/hook'}]})],
    ['a repeated ID', JSON.stringify({schema: 'edge-credentials/1.0', credentials: [credential, {...credential, digest: tokenDigest(token())}]})],
  ] as const) {
    const files = await edgeConfig(context, [], {credentials: text});
    await refusesToStart(await stateDir(context), files.config, error => refused('edge-credentials-invalid')(error) && !String(error).includes(good.token), what);
  }
});

it('a credential may not act as the core, a module or the runtime itself', async context => {
  for (const source of ['bunny/core', 'bunny/modules/lamp', 'bunny/modules/core', 'bunny/runtime/gateway']) {
    const {config} = await edgeConfig(context, [{source: 'bunny/parts/reader', token: token()}, {source, token: token()}]);
    await refusesToStart(await stateDir(context), config, refused('edge-credential-source'), source);
  }
});

it('runtime.started says whether modules are simulated and the edge is configured; runtime.edge.serving follows once it serves', async context => {
  const {config} = await edgeConfig(context, [{source: 'bunny/parts/reader', token: token()}]);
  const started = (logs: readonly LogRecord[]): LogRecord['attributes'] | undefined => logs.find(record => record.event_name === 'runtime.started')?.attributes;
  const events = (logs: readonly LogRecord[]): string[] => logs.map(record => record.event_name);
  const plain = await run(context, {modules: [fixture('one')]});
  assert.equal(started(plain.logs)?.['bunny.simulate'], false);
  assert.equal(started(plain.logs)?.['bunny.edge'], false);
  assert.equal(events(plain.logs).includes('runtime.edge.serving'), false, 'no edge, no serving record');
  const simulated = await run(context, {modules: [fixture('one'), fixture('two')], configFile: config, simulate: true, edge: {schemas: {}}});
  assert.equal(started(simulated.logs)?.['bunny.simulate'], true);
  assert.equal(started(simulated.logs)?.['bunny.edge'], true);
  const order = events(simulated.logs);
  assert.equal(order.filter(event => event === 'runtime.edge.serving').length, 1);
  assert.ok(order.indexOf('runtime.edge.serving') > order.lastIndexOf('runtime.module.started'), `the edge serves after every module started: ${order.join(', ')}`);
  const serving = simulated.logs.find(record => record.event_name === 'runtime.edge.serving');
  const port = Number(new URL(simulated.runtime.url).port);
  assert.deepEqual(serving?.attributes, {'server.port': port, 'bunny.grant_count': 1, 'bunny.provenance': 'source'}, 'the port, never the URL');
  assert.equal(started(simulated.logs)?.['server.port'], port);
  assert.equal(JSON.stringify(simulated.logs).includes(simulated.runtime.url), false);
});

it('while the runtime stops, the edge answers 503 with unavailable until the listener closes', async context => {
  const part = {source: 'bunny/parts/hook', token: token()};
  const {config} = await edgeConfig(context, [part]);
  const gate = deferred<undefined>();
  const stopping: BunnyModule = {manifest: {name: 'stopping', apiVersion: '1.0'}, start: () => {}, stop: () => gate.promise};
  context.after(() => { gate.resolve(undefined); });
  const {runtime} = await run(context, {modules: [stopping], configFile: config, edge: {schemas: {}}});
  const stopped = runtime.stop();
  const during = await fetch(new URL('/api/sdk/v1/stream', runtime.url), {headers: {authorization: `Bearer ${part.token}`}});
  assert.equal(during.status, 503, 'the edge is stopping, not missing');
  assert.equal(((await during.json()) as {error: {code: string}}).error.code, 'unavailable');
  const call = await fetch(new URL('/api/sdk/v1/publish', runtime.url), {method: 'POST', headers: {authorization: `Bearer ${part.token}`}, body: '{}'});
  assert.equal(call.status, 503);
  gate.resolve(undefined);
  await stopped;
});

it('an edge refusal is logged at its level with a known route, its registry code and that code\'s registered reason, never the refusal\'s detail', async context => {
  const part = {source: 'bunny/parts/hook', token: token()};
  const {config} = await edgeConfig(context, [part]);
  const {runtime, logs} = await run(context, {modules: [], configFile: config, edge: {schemas: {}}});
  const marker = 'caller-sent-7f3a91';
  const headers = {authorization: `Bearer ${part.token}`, 'content-type': 'application/json'};
  const unknown = await fetch(new URL(`/api/sdk/v1/${marker}`, runtime.url), {method: 'POST', headers, body: '{}'});
  assert.equal(unknown.status, 404);
  const malformed = await fetch(new URL('/api/sdk/v1/publish', runtime.url), {method: 'POST', headers, body: JSON.stringify({key: marker, message: {id: marker}})});
  assert.ok(malformed.status >= 400 && malformed.status < 500, `a malformed publish is refused: ${malformed.status}`);
  const anonymous = await fetch(new URL(`/api/sdk/v1/publish?${marker}`, runtime.url), {method: 'POST', body: '{}'});
  assert.equal(anonymous.status, 401);

  const refusals = logs.filter(record => record.event_name === 'runtime.edge.refused');
  assert.deepEqual(refusals.map(record => record.attributes['bunny.route']), ['other', 'publish', 'publish']);
  assert.deepEqual(refusals.map(record => record.severity_text), ['INFO', 'INFO', 'WARN'], 'validation refusals at INFO, an unauthenticated call at WARN');
  for (const record of refusals) {
    const code = record.attributes['bunny.code'];
    assert.ok(typeof code === 'string' && code in errorCodes, `a registry code: ${String(code)}`);
    assert.equal(record.attributes['bunny.reason'], REGISTRY_REASONS[code as keyof typeof REGISTRY_REASONS], 'the reason is the code\'s registered reason');
    assert.equal('bunny.detail' in record.attributes, false, 'no detail');
  }
  assert.deepEqual(refusals.map(record => record.attributes['bunny.participant']), [part.source, part.source, undefined]);
  assert.equal(JSON.stringify(logs).includes(marker), false, 'nothing the caller sent reaches a log record');
});

it('every registry code has a fixed registered reason, except internal and uncertain-result, which carry only their code', () => {
  assert.deepEqual(Object.keys(REGISTRY_REASONS).sort(), Object.keys(errorCodes).sort());
  const reasons: readonly unknown[] = catalog.attributes['bunny.reason'].enum;
  for (const [code, reason] of Object.entries(REGISTRY_REASONS)) {
    if (code === 'internal' || code === 'uncertain-result') assert.equal(reason, undefined, `${code} has no reason: its effect is unknown`);
    else assert.ok(reasons.includes(reason), `${code}: ${String(reason)}`);
  }
  assert.equal(REGISTRY_REASONS['duplicate-conflict'], 'duplicate', 'as the core\'s stand-in history logs a conflict');
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
