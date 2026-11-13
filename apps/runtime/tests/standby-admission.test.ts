import assert from 'node:assert/strict';
import {rm, stat, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse} from 'node:http';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {TestContext} from 'node:test';
import {SCHEMA_BASE, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {InProcessBus, REMOTE_SCHEMA, SdkError, edgeValidator, prepareMessage} from '@jimmie-potts/sdk';
import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import {admitStandbyStartupCredentials, credentialsDocument, tokenDigest, type EdgeCredential, type StandbyCredentialAdmission} from '../src/credentials.js';
import {Gateway, STANDBY_STATUS_PATH} from '../src/gateway/gateway.js';
import type {ModuleHost} from '../src/host.js';
import {LogWriter, type LogRecord} from '../src/log.js';
import {observation, turnEnded} from './fixtures/agents.js';
import {createCoreModule} from '../src/core/core.js';
import {startRuntime} from '../src/runtime.js';
import {deferred, edgeConfig, it, manualClock, run, stateDir} from './support.js';

const reader = {source: 'bunny/parts/standby-reader', token: 'tok_SYNTHETIC835-standby-reader', scopes: ['read']} as const;
const action = {target: 'hub', data: {mode: 'free', expectedRevision: 0}};

it('standby checks inbound credentials before creating state with the edge off', async t => {
  const root = join(await stateDir(t), 'not-created');
  const clock = manualClock();
  const files = await edgeConfig(t, [{...reader, scopes: ['read', 'control']}]);
  await assert.rejects(async () => {
    const runtime = await startRuntime({modules: [createCoreModule({standby: true})], stateDir: root,
      port: 0, configFile: files.config, clock, scheduler: clock.scheduler, log: () => {}});
    await runtime.stop();
  }, {code: 'edge-credentials-invalid'});
  await assert.rejects(stat(root), {code: 'ENOENT'});
  await rm(files.credentials);
  await assert.rejects(startRuntime({modules: [createCoreModule({standby: true})], stateDir: root,
    port: 0, configFile: files.config, clock, scheduler: clock.scheduler, log: () => {}}),
  {code: 'edge-credentials-missing', message: 'the standby credentials could not be admitted'});
  await assert.rejects(stat(root), {code: 'ENOENT'});
});

it('a standby startup credential admission is one-use and bound to its core and private file', async t => {
  const files = await edgeConfig(t, [reader]);
  const root = await stateDir(t), clock = manualClock();
  const core = createCoreModule({standby: true});
  const admission = await admitStandbyStartupCredentials(core, files.credentials);
  const options = {modules: [core], stateDir: join(root, 'original'), port: 0, configFile: files.config,
    clock, scheduler: clock.scheduler, log: () => {}, standbyCredentialAdmission: admission};
  for (const changed of [
    {...options, modules: [createCoreModule({standby: true})]},
    {...options, modules: [createCoreModule()]},
    {...options, standbyCredentialAdmission: {} as StandbyCredentialAdmission},
    {...options, configFile: (await edgeConfig(t, [reader])).config},
  ]) await assert.rejects(startRuntime(changed), {code: 'edge-credentials-invalid'});
  await assert.rejects(stat(options.stateDir), {code: 'ENOENT'});
  const runtime = await startRuntime(options);
  t.after(() => runtime.stop());
  await runtime.stop();
  await assert.rejects(startRuntime(options), {code: 'edge-credentials-invalid'});
});

it('an admitted standby HTTP mutation is refused before ordinary control permission', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, configFile: files.config, edge: {schemas: {}}});
  const response = await fetch(new URL('/api/v2/commands/mode-set', runtime.url), {
    method: 'POST', headers: {authorization: 'Bearer ' + reader.token, 'content-type': 'application/json'},
    body: JSON.stringify(action),
  });
  const result = await response.json() as {error: {code: string}};
  assert.deepEqual([response.status, result.error.code], [503, 'unavailable']);
});

it('standby refuses a valid SDK stream before opening a participant', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, configFile: files.config, edge: {schemas: {}}});
  const response = await fetch(new URL('/api/sdk/v1/stream', runtime.url), {
    headers: {authorization: 'Bearer ' + reader.token, 'bunny-source': reader.source},
  });
  if (response.status === 200) await response.body?.cancel();
  assert.equal(response.status, 503);
});

const grant: EdgeCredential = {id: 'reader', source: reader.source, digest: tokenDigest(reader.token), scopes: reader.scopes};
const nextToken = 'tok_SYNTHETIC835-rotated-reader';
const rotated = {...grant, digest: tokenDigest(nextToken)};
const bearer = {authorization: 'Bearer ' + reader.token};
const LOCAL = 'http://127.0.0.1:12345';
const PROXY = 'https://synthetic.ts.net';
const PROOF = 'synthetic-standby-private-proxy-proof';
const PARENT = {traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'};
const fixed = errorBody('unavailable', {detail: 'the standby does not accept this request'});

function boundary(t: TestContext, status?: () => object | Promise<object>) {
  const clock = manualClock();
  const attempts: string[] = [];
  const bus = new InProcessBus({now: clock.now, scheduler: clock.scheduler});
  for (const name of ['connect', 'requestMessage', 'syncMessage'] as const) {
    t.mock.method(bus, name, () => {attempts.push(name); throw new Error('unexpected bus use');});
  }
  const host = {
    modules: () => {attempts.push('modules'); return [];},
    invoke: () => {attempts.push('invoke'); throw new Error('unexpected owner invocation');},
  } as unknown as ModuleHost;
  const logs: LogRecord[] = [], spans = new RecordedSpans();
  const writer = new LogWriter(record => {logs.push(record);}, 'debug', clock);
  const options = {bus, host, validator: edgeValidator(), families: new Set<string>(), credentials: [grant], standby: {status},
    clock, scheduler: clock.scheduler, log: writer.logger('bunny.runtime'), redactions: writer.redactions, trace: spans,
    stateDir: '/synthetic-standby/unused',
    edge: {credentials: 'unused', launcher: true, mcp: true, browserAccess: 'trusted-loopback' as const, editorLinks: {}, placeLinks: {}}};
  const gateway = new Gateway(options);
  t.after(() => gateway.close());
  return {options, gateway, attempts, writer, clock, logs, spans, start: () => gateway.start(LOCAL, [new URL(LOCAL).host])};
}

type Result = {status: number; headers: Record<string, string>; body: unknown};
function rawCall(gateway: Gateway, path: string, options: {
  method?: string; headers?: IncomingHttpHeaders; chunks?: AsyncIterable<Buffer> | readonly Buffer[];
} = {}): Promise<Result> {
  const input = Object.assign(Readable.from(options.chunks ?? []), {
    url: path, method: options.method ?? 'GET', headers: {host: new URL(LOCAL).host, ...options.headers},
  }) as unknown as IncomingMessage;
  return new Promise(resolve => {
    let status = 0, headers: Record<string, string> = {};
    const response = {
      headersSent: false, destroyed: false,
      writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
        status = nextStatus;
        headers = nextHeaders;
        return response;
      },
      end(body: string) {resolve({status, headers, body: JSON.parse(body) as unknown});},
    };
    gateway.handle(input, response as unknown as ServerResponse);
  });
}
const codeOf = (result: Result): string => (result.body as ErrorBody).error.code;

function call(gateway: Gateway, path: string, options: {method?: string; headers?: IncomingHttpHeaders; body?: object | string} = {}) {
  const {body, headers, ...requestOptions} = options;
  return rawCall(gateway, path, {...requestOptions,
    headers: {...(body === undefined ? {} : {'content-type': 'application/json'}), ...bearer, ...headers},
    ...(body === undefined ? {} : {chunks: [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]}),
  });
}

it('standby keeps HTTP reads, browser, launcher and MCP closed and refuses structurally valid writes', async t => {
  const b = boundary(t);
  await b.start();
  const {gateway} = b;
  const encoded = (body: object): readonly Buffer[] => [Buffer.from(JSON.stringify(body))];
  const session = 'a'.repeat(64);
  const requests: readonly [string, string, object | undefined][] = [
    ['POST', '/api/v2/commands/mode-set', action],
    ['POST', '/api/v2/commands/approval-recover', {session, turnId: 'turn-1', expectedRevision: 0}],
    ['POST', '/api/v2/automation/routines', {name: 'Fixture', days: [1], time: '12:00',
      actions: [{target: 'wall', family: 'power-set', data: {on: true}}]}],
    ['PUT', '/api/v2/automation/power-limits/wall', {enabled: true, durationMs: 1000, expectedSettingsRevision: 0}],
    ['POST', '/api/v2/automation/routines/example/run', {}],
    ['DELETE', '/api/v2/automation/rules/example', undefined],
  ];
  for (const [method, path, body] of requests) {
    const result = await call(gateway, path, {method, headers: {'bunny-request': '1', ...PARENT}, ...(body === undefined ? {} : {body})});
    assert.deepEqual([result.status, result.body, result.headers['x-content-type-options']], [503, fixed, 'nosniff'], path);
  }
  const upload = '/api/v2/modules/fixture/upload?name=sample&family=pixoo-asset-change&requestId=upload&target=wall';
  const uploaded = await rawCall(gateway, upload, {method: 'POST',
    headers: {...bearer, 'content-type': 'application/octet-stream'}, chunks: [Buffer.from('sample')]});
  assert.deepEqual(uploaded.body, fixed);
  assert.equal(codeOf(await rawCall(gateway, upload, {method: 'POST', headers: bearer})), 'invalid-request');
  assert.equal(codeOf(await call(gateway, '/api/v2/commands/mode-set', {method: 'POST', body: '{'})), 'invalid-request');
  assert.equal(codeOf(await call(gateway, '/api/v2/commands/mode-set', {method: 'POST', body: {target: 'hub', data: {mode: 'unknown'}}})), 'invalid-request');
  assert.equal(codeOf(await call(gateway, '/api/v2/automation/routines/example/run', {method: 'POST', body: {}})), 'forbidden');
  assert.equal(codeOf(await call(gateway, '/api/v2/automation/routines/example/run', {method: 'POST',
    headers: {'bunny-request': '1'}, body: {extra: 1}})), 'invalid-request');
  assert.equal(codeOf(await call(gateway, '/api/v2/automation/routines/example/run', {method: 'POST',
    headers: {'bunny-request': '1'}, body: {extra: 'x'.repeat(40)}})), 'too-large');
  assert.equal(codeOf(await call(gateway, '/api/v2/automation/routines/example/preview', {method: 'POST', body: {}})), 'not-found');
  for (const path of ['/', '/dashboard.js', '/mcp', '/api/v2/history?settings=snapshot',
    '/api/v2/families/mode', '/api/v2/snapshot?families=mode', '/api/v2/authority?scope=read', STANDBY_STATUS_PATH]) {
    assert.equal(codeOf(await call(gateway, path)), 'not-found', path);
  }
  for (const action of ['launch', 'session', 'check', 'logout']) {
    const result = await rawCall(gateway, '/api/v2/browser/' + action, {method: 'POST', headers: {
      origin: LOCAL, 'bunny-request': '1', cookie: 'bunny-session=' + 'x'.repeat(43), 'content-type': 'application/json',
    }, chunks: encoded({})});
    assert.equal(codeOf(result), 'not-found');
    assert.equal(result.headers['set-cookie'], undefined);
  }
  assert.equal(codeOf(await call(gateway, '/api/v2/browser/session', {method: 'POST', body: {}})), 'forbidden');
  assert.deepEqual(gateway.access.counts(), {sessions: 0, launchCodes: 0});
  assert.deepEqual(b.attempts, []);
  assert.ok(b.spans.spans.some(span => span.parentSpanId === 'b7ad6b7169203331' && span.attributes['http.route'] === '/api/v2/commands/{family}'));
  assert.ok(b.logs.every(record => !JSON.stringify(record).includes(reader.token)));
});

it('standby preserves static command target and route refusals', async t => {
  const {gateway, start, attempts} = boundary(t);
  await start();
  const mutations = [
    ['art-show', {target: 'display', data: {artworkId: 'synthetic-art', targets: ['browser']}}, 'not-found'],
    ['notice-acknowledge', {target: 'a'.repeat(64), data: {consumerId: 'pixoo', noticeId: 'b'.repeat(64)}}, 'invalid-request'],
  ] as const;
  for (const [family, body, expected] of mutations) {
    assert.equal(codeOf(await call(gateway, '/api/v2/commands/' + family, {method: 'POST', body})), expected);
  }
  assert.deepEqual(attempts, []);
});

it('standby SDK keeps source, method and structural refusals and never enters the bus', async t => {
  const {gateway, start, clock, attempts, logs} = boundary(t);
  await start();
  const connection = {connection: 'stream-1'}, endpoint = {...connection, endpoint: 'a'.repeat(64)};
  const event = observation(turnEnded, clock.now());
  const message = prepareMessage(reader.source, event.draft, {now: clock.now});
  const command = {
    ...prepareMessage(reader.source, {kind: 'occurrence', type: 'org.bunny.mode.set.requested', subject: 'hub',
      dataschema: SCHEMA_BASE + 'mode-set/2.0', data: {...action.data, requestId: 'command-1'}}, {now: clock.now}),
    kind: 'command', ...PARENT, expiresat: new Date(clock.now() + 5000).toISOString(),
  };
  const sync = {...command, kind: 'sync-request', type: 'org.bunny.sync.requested', subject: 'mode',
    dataschema: SCHEMA_BASE + 'sync-request/2.0', data: {requestId: 'sync-1', families: ['mode']}};
  const calls: Record<string, object> = {
    publish: {key: event.key, message},
    request: {key: 'bunny.cmd.mode-set.hub', command},
    subscribe: {...connection, id: 'subscription', pattern: 'bunny.state.mode.*'},
    respond: {...endpoint, id: 'stream-1-1', pattern: 'bunny.cmd.mode-set.stream-1-1'},
    sync: {request: sync},
    serve: {...connection, id: 'server', families: ['mode']},
    reply: {...endpoint, responder: 'stream-1-1', command: 'command-1', requestId: 'command-1', reply: {status: 'accepted'}},
    answer: {...connection, server: 'server', request: 'sync-1', answer: errorBody('unavailable')},
    close: {...endpoint, id: 'stream-1-1'},
  };
  const post = (name: string, body: object, headers?: IncomingHttpHeaders) => rawCall(gateway, '/api/sdk/v1/' + name, {
    method: 'POST', headers: {...bearer, 'bunny-source': reader.source, ...headers},
    chunks: [Buffer.from(JSON.stringify({schema: REMOTE_SCHEMA, ...body}))],
  });
  for (const [name, body] of Object.entries(calls)) {
    const result = await post(name, body);
    assert.deepEqual([result.status, result.body], [503, fixed], name);
  }
  assert.equal(codeOf(await post('publish', {}, {'bunny-source': 'bunny/parts/another'})), 'forbidden');
  assert.equal(codeOf(await post('unknown', {})), 'not-found');
  assert.equal(codeOf(await post('request', {schema: 'unknown'})), 'unsupported-version');
  assert.equal(codeOf(await post('request', {key: 'bad', command})), 'invalid-request');
  assert.equal(codeOf(await post('publish', {key: event.key, message: {...message, source: 'bunny/parts/another'}})), 'forbidden');
  assert.equal(codeOf(await post('respond', {...calls.respond, endpoint: 'bad'})), 'forbidden');
  const decisions = logs.filter(record => record.event_name === 'runtime.edge.refused' && record.attributes['bunny.route'] === 'request');
  assert.deepEqual(decisions.map(record => [record.attributes['bunny.code'], record.trace_id, record.attributes['bunny.outcome']]), [
    ['unavailable', '0af7651916cd43dd8448eb211c80319c', undefined],
    ['unsupported-version', undefined, undefined],
    ['invalid-request', undefined, undefined],
  ]);
  assert.deepEqual(attempts, []);
});

it('standby re-admits the original bearer before inspecting pending SDK operation fields', async t => {
  const {gateway, start, attempts} = boundary(t);
  await start();
  for (const replacement of [[rotated], []]) {
    gateway.reload([grant]);
    const entered = deferred<void>(), release = deferred<void>();
    async function* chunks() {
      yield Buffer.from('{"schema":"sdk-remote/1.0",');
      entered.resolve();
      await release.promise;
      yield Buffer.from('"connection":5}');
    }
    const pending = rawCall(gateway, '/api/sdk/v1/close', {method: 'POST', headers: bearer, chunks: chunks()});
    await entered.promise;
    gateway.reload(replacement);
    gateway.reload([grant]);
    release.resolve();
    assert.equal(codeOf(await pending), 'unauthenticated');
  }
  gateway.reload([grant]);
  const entered = deferred<void>(), release = deferred<void>();
  async function* chunks() {
    yield Buffer.from('{"schema":"sdk-remote/1.0",');
    entered.resolve();
    await release.promise;
    yield Buffer.from('"connection":"stream","id":"handle"}');
  }
  const pending = rawCall(gateway, '/api/sdk/v1/close', {method: 'POST', headers: bearer, chunks: chunks()});
  await entered.promise;
  await gateway.close();
  release.resolve();
  const closed = await pending;
  assert.equal(codeOf(closed), 'unavailable');
  assert.notDeepEqual(closed.body, fixed);
  assert.deepEqual(attempts, []);
});

it('status checks the exact response bytes and re-admits after the handler returns', async t => {
  let status: () => object | Promise<object> = () => ({ok: true});
  let reads = 0;
  const {gateway, writer, start, options} = boundary(t, () => {reads += 1; return status();});
  await start();
  assert.throws(() => new Gateway({...options, credentials: [{...grant, scopes: ['read', 'control']}]}), {code: 'edge-credentials-invalid'});
  for (const list of [[rotated, {...grant, id: 'operator', source: 'bunny/parts/operator', digest: 'a'.repeat(64), scopes: ['control'] as const}],
    [grant, grant]]) {
    assert.throws(() => gateway.reload(list), {code: 'edge-credentials-invalid'});
  }
  assert.equal((await call(gateway, STANDBY_STATUS_PATH)).status, 200);
  assert.equal(codeOf(await call(gateway, STANDBY_STATUS_PATH + '?extra=1')), 'invalid-request');
  assert.equal(codeOf(await call(gateway, STANDBY_STATUS_PATH, {headers: {origin: LOCAL}})), 'forbidden');
  assert.equal(codeOf(await rawCall(gateway, STANDBY_STATUS_PATH)), 'unauthenticated');
  assert.equal(codeOf(await rawCall(gateway, STANDBY_STATUS_PATH, {headers: {cookie: 'bunny-session=' + 'x'.repeat(43)}})), 'forbidden');
  assert.equal(reads, 1);
  status = () => ({value: 'é'.repeat(2048)});
  assert.equal(codeOf(await call(gateway, STANDBY_STATUS_PATH)), 'internal');
  const secret = 'synthetic"protected';
  writer.redact(secret);
  status = () => ({toJSON: () => ({value: secret})});
  assert.equal(codeOf(await call(gateway, STANDBY_STATUS_PATH)), 'internal');
  status = () => ({[secret]: true});
  assert.equal(codeOf(await call(gateway, STANDBY_STATUS_PATH)), 'internal');
  for (const end of ['rotate', 'stop'] as const) {
    const entered = deferred<void>(), release = deferred<object>();
    status = () => {entered.resolve(); return release.promise;};
    const pending = call(gateway, STANDBY_STATUS_PATH);
    await entered.promise;
    if (end === 'stop') await gateway.close();
    else gateway.reload([rotated]);
    release.resolve({ok: true});
    assert.equal(codeOf(await pending), end === 'stop' ? 'unavailable' : 'unauthenticated');
    if (end === 'rotate') {
      status = () => ({ok: true});
      assert.equal((await call(gateway, STANDBY_STATUS_PATH, {headers: {authorization: 'Bearer ' + nextToken}})).status, 200);
      gateway.reload([grant]);
    }
  }
});

it('a standby reload never revives a pending admission whose grant was removed or changed', async t => {
  let status: () => object | Promise<object> = () => ({ok: true});
  const {gateway, start} = boundary(t, () => status());
  await start();
  for (const [intermediate, expected] of [[null, 200], [[rotated], 401], [[], 401]] as const) {
    const entered = deferred<void>(), release = deferred<object>();
    status = () => {entered.resolve(); return release.promise;};
    const pending = call(gateway, STANDBY_STATUS_PATH);
    await entered.promise;
    if (intermediate !== null) gateway.reload(intermediate);
    gateway.reload([{...grant, scopes: ['read']}]);
    release.resolve({ok: true});
    assert.equal((await pending).status, expected);
    assert.equal((await call(gateway, STANDBY_STATUS_PATH)).status, 200);
  }
});

it('every standby Access replacement is validated and returned references cannot widen it', async t => {
  const {gateway, start} = boundary(t, () => ({ok: true}));
  await start();
  const added = {id: 'extra', source: 'bunny/parts/extra', digest: tokenDigest(nextToken), scopes: ['read']} as const;
  assert.throws(() => gateway.access.replace([{...grant, scopes: ['control']}, added]), {code: 'edge-credentials-invalid'});
  const original = gateway.access.current(grant.id);
  const found = gateway.access.credential(reader.token);
  assert.ok(original && found);
  const reserved = {...added, source: 'bunny/core'};
  for (const attempt of [
    () => (gateway.access.credentials as EdgeCredential[]).push(reserved),
    () => Object.assign(original, reserved),
    () => Object.assign(found, reserved),
    () => (found.scopes as string[]).push('control'),
  ]) {
    try {attempt();} catch (error) {assert.ok(error instanceof TypeError);}
  }
  assert.deepEqual(gateway.access.credentials, [grant]);
  assert.equal((await call(gateway, STANDBY_STATUS_PATH)).status, 200);
  assert.equal((await call(gateway, STANDBY_STATUS_PATH, {headers: {authorization: 'Bearer ' + nextToken}})).status, 401);
});

it('standby revalidates configured edge-off reloads and leaves absent configuration dormant', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime, logs} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, configFile: files.config});
  await writeFile(files.credentials, credentialsDocument([{...grant, scopes: ['ingest']}]));
  await assert.rejects(runtime.reload(), {code: 'edge-credentials-invalid'});
  await writeFile(files.credentials, credentialsDocument([rotated]));
  await runtime.reload();
  assert.equal(runtime.gateway(), undefined);
  assert.equal(logs.find(record => record.event_name === 'runtime.started')?.attributes['bunny.edge'], false);
  assert.deepEqual(logs.filter(record => record.event_name === 'runtime.edge.reloaded').map(record =>
    [record.attributes['bunny.outcome'], record.attributes['error.code'], record.attributes['bunny.grant_count']]), [
    ['failed', 'edge-credentials-invalid', undefined], ['succeeded', undefined, 1],
  ]);
  const dormant = await run(t, {modules: [createCoreModule({standby: true})], clock, scheduler: clock.scheduler});
  await rm(files.credentials);
  await dormant.runtime.reload();
  assert.ok(dormant.logs.every(record => record.event_name !== 'runtime.edge.reloaded'));
});

it('runtime pins the exact registered standby start across asynchronous admission', async t => {
  const clock = manualClock();
  const files = await edgeConfig(t, [reader]);
  const root = join(await stateDir(t), 'new-root');
  const core = createCoreModule({standby: true}), replacement = () => {assert.fail('unverified start ran');};
  const modules = [core];
  const pending = startRuntime({modules, stateDir: root, port: 0, clock, scheduler: clock.scheduler,
    configFile: files.config, log: () => {}, edge: {schemas: {}, standbyStatus: () => ({ok: true})}});
  Object.assign(core, {start: replacement});
  modules[0] = createCoreModule();
  const runtime = await pending;
  t.after(() => runtime.stop());
  assert.equal(runtime.health().status, 'ok');
  const result = await fetch(new URL(STANDBY_STATUS_PATH, runtime.url), {headers: bearer});
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {ok: true});
  const untouched = join(await stateDir(t), 'must-not-exist');
  await assert.rejects(startRuntime({modules: [core], stateDir: untouched, port: 0, clock, scheduler: clock.scheduler}),
    (error: unknown) => error instanceof SdkError && error.body.error.code === 'unavailable');
  await assert.rejects(stat(untouched), {code: 'ENOENT'});
});

function listenerStatus(url: string, headers: IncomingHttpHeaders): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(STANDBY_STATUS_PATH, url), {headers}, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode ?? 0, headers: {}, body: JSON.parse(Buffer.concat(chunks).toString()) as unknown}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

it('bounded status requires valid loopback or private proxy proof and an ordinary bearer', async t => {
  const files = await edgeConfig(t, [reader]);
  const clock = manualClock();
  const {runtime} = await run(t, {modules: [createCoreModule({standby: true})], clock,
    scheduler: clock.scheduler, edge: {schemas: {}, standbyStatus: () => ({ok: true})},
    config: {modules: {}, edge: {credentials: files.credentials, launcher: true, mcp: true, editorLinks: {}, placeLinks: {},
      privateProxy: {origin: PROXY, tokenDigest: tokenDigest(PROOF)}}}});
  const privateHeaders = {host: new URL(PROXY).host, 'bunny-private-proxy': PROOF};
  for (const [headers, status] of [
    [bearer, 200], [{...privateHeaders, ...bearer}, 200], [privateHeaders, 401],
    [{...privateHeaders, ...bearer, 'bunny-private-proxy': PROOF + '-wrong'}, 403],
    [{...privateHeaders, ...bearer, 'bunny-wifi-proxy': PROOF}, 403],
    [{...bearer, host: 'other.invalid'}, 403], [{...privateHeaders, ...bearer, origin: PROXY}, 403],
  ] as const) {
    assert.equal((await listenerStatus(runtime.url, headers)).status, status);
  }
});

it('ordinary edge on and off retain their route and grant behavior with the same fixture', async t => {
  for (const edge of [true, false]) {
    const files = await edgeConfig(t, [reader], {browserAccess: 'trusted-loopback'});
    const clock = manualClock();
    const {runtime} = await run(t, {modules: [createCoreModule()], clock, scheduler: clock.scheduler,
      configFile: files.config, ...(edge ? {edge: {schemas: {}, standbyStatus: () => ({ok: true})}} : {})});
    const send = async (path: string, init?: RequestInit): Promise<number> => {
      const response = await fetch(new URL(path, runtime.url), init);
      await response.arrayBuffer();
      return response.status;
    };
    assert.equal(await send('/api/v2/history?settings=snapshot', {headers: bearer}), edge ? 200 : 404);
    assert.equal(await send('/api/v2/commands/mode-set', {
      method: 'POST', headers: {...bearer, 'content-type': 'application/json'}, body: JSON.stringify(action),
    }), edge ? 403 : 404);
    assert.equal(await send(STANDBY_STATUS_PATH, {headers: bearer}), 404);
    assert.equal(await send('/api/v2/browser/session', {method: 'POST',
      headers: {origin: runtime.url, 'bunny-request': '1', 'content-type': 'application/json'}, body: '{}',
    }), edge ? 200 : 403);
  }
});
