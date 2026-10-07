// The runtime's gateway (Hub #835): client credentials with the old Hub's scopes and device grants, browser sessions
// from the launcher and trusted loopback sign-in with their Origin checks, reloading credentials, MCP, the modules'
// pages, content and settings, and the route map of the old Hub. Every refusal is the shared error body with a registry
// code, and no token reaches a record, an answer, health or a span. The scenario catalog plays the same gateway end to
// end; these tests cover what a scenario cannot reach.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {request as httpRequest, type IncomingMessage} from 'node:http';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError, connectRemote, type BunnyModule} from '@jimmie-potts/sdk';
import {
  CONFIG_SCHEMA, RETIRED_ROUTES, RuntimeError, convertHubEdge, credentialsDocument, grantCredential, requestBrowserLaunch, retiredRoute, revokeCredential,
  tokenDigest, type LogRecord, type Runtime,
} from '../src/index.js';
import {createCoreModule} from './fixtures/core.js';
import {SIGN_SECTION, SYNTHETIC_TOKEN, SimulatedSigns, createSignModule, signSchemas} from './fixtures/sign.js';
import {contextOf, edgeConfig, entry, fixture, it, manualClock, run, stateDir, waitFor, type EdgePart} from './support.js';

/** A part's token, carrying the synthetic marker that every scan here looks for. */
const MARKER = 'tok_SYNTHETIC835';
const token = (): string => `${MARKER}_${randomBytes(24).toString('base64url')}`;
type Answer = {status: number; headers: Headers; text: string; body: unknown};

/** One HTTP call to the runtime's listener. */
async function call(url: string, path: string, init: {method?: string; token?: string; headers?: Record<string, string>; body?: unknown} = {}): Promise<Answer> {
  const headers: Record<string, string> = {...init.headers};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['content-type'] ??= 'application/json';
  const response = await fetch(new URL(path, url), {
    method: init.method ?? 'GET', headers, ...(init.body === undefined ? {} : {body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body)}),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return {status: response.status, headers: response.headers, text, body};
}
const codeOf = (answer: Answer): unknown => (answer.body as {error?: {code?: unknown}} | undefined)?.error?.code;

type Gateway = {
  runtime: Runtime; logs: LogRecord[]; url: string; files: Awaited<ReturnType<typeof edgeConfig>>; answers: Answer[]; spans: string[]; stateDir: string;
};

/**
 * The runtime with its gateway, the core and the configured sign, and the parts' credentials. Every answer a test makes
 * through `ask` is kept for the token scan.
 */
async function gateway(context: TestContext, parts: readonly EdgePart[], options: {modules?: BunnyModule[]; browserAccess?: 'trusted-loopback'} = {}): Promise<Gateway & {ask: typeof call}> {
  const dir = await stateDir(context);
  const signToken = `${dir}/sign-token`;
  await writeFile(signToken, `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
  const files = await edgeConfig(context, parts, {
    modules: {sign: {...SIGN_SECTION, secrets: {token: signToken}}}, editorLinks: {'sign-1': 'http://127.0.0.1:9100/editor'},
    placeLinks: {kitchen: 'http://127.0.0.1:9200/'}, ...(options.browserAccess === undefined ? {} : {browserAccess: options.browserAccess}),
  });
  const spans: string[] = [];
  const modules = options.modules ?? [createCoreModule(), createSignModule({transport: new SimulatedSigns({online: true})})];
  const {runtime, logs} = await run(context, {modules, stateDir: dir, configFile: files.config, edge: {schemas: signSchemas}, spans: line => { spans.push(line); }});
  const answers: Answer[] = [];
  const ask: typeof call = async (url, path, init) => {
    const answer = await call(url, path, init);
    answers.push(answer);
    return answer;
  };
  return {runtime, logs, url: runtime.url, files, answers, spans, ask, stateDir: dir};
}

/** Fails if a part's token, or the sign's secret, appears in a record, an answer, health or a span. */
function assertNoToken(g: Gateway): void {
  const places: [string, unknown][] = [['a log record', g.logs], ['an answer', g.answers.map(answer => answer.text)], ['health', g.runtime.health()], ['a span', g.spans]];
  for (const [place, value] of places) {
    const text = JSON.stringify(value);
    assert.equal(text.includes(MARKER), false, `no part's token in ${place}`);
    assert.equal(text.includes(SYNTHETIC_TOKEN), false, `no module secret in ${place}`);
  }
}

const READER = (): EdgePart => ({id: 'reader', source: 'bunny/parts/reader', token: token(), scopes: ['read']});
const OPERATOR = (): EdgePart => ({id: 'operator', source: 'bunny/parts/operator', token: token(), scopes: ['read', 'control'], devices: ['sign-1']});
const HOOK = (): EdgePart => ({id: 'hub-0123456789abcdef0123456789abcdef', source: 'bunny/parts/hook', token: token(), scopes: ['ingest']});

it('every refusal is the shared error body with a registry code: a malformed request, a made-up token, a scope or key outside the grant', async context => {
  const reader = READER(), operator = OPERATOR(), hook = HOOK();
  const g = await gateway(context, [reader, operator, hook]);
  const {ask, url} = g;
  assert.equal((await ask(url, '/api/v2/families/session', {token: reader.token})).status, 200);
  const cases: [string, Answer, number, string][] = [
    ['a malformed family', await ask(url, '/api/v2/families/Bad_Family', {token: reader.token}), 400, 'invalid-request'],
    ['a query on a route that takes none', await ask(url, '/api/v2/modules?x=1', {token: reader.token}), 400, 'invalid-request'],
    ['a recovery that is not JSON', await ask(url, '/api/v2/commands/approval-recover', {method: 'POST', token: operator.token, body: '{', headers: {'content-type': 'application/json'}}), 400, 'invalid-request'],
    ['a recovery over the body limit', await ask(url, '/api/v2/commands/approval-recover', {method: 'POST', token: operator.token, body: {pad: 'x'.repeat(20_000)}}), 413, 'too-large'],
    ['a made-up token', await ask(url, '/api/v2/modules', {token: token()}), 401, 'unauthenticated'],
    ['no token', await ask(url, '/api/v2/modules'), 401, 'unauthenticated'],
    ['a hook reading', await ask(url, '/api/v2/modules', {token: hook.token}), 403, 'forbidden'],
    ['a reader recovering an approval', await ask(url, '/api/v2/commands/approval-recover', {method: 'POST', token: reader.token, body: {}}), 403, 'forbidden'],
    ['a scope the caller lacks', await ask(url, '/api/v2/authority?scope=control', {token: reader.token}), 403, 'forbidden'],
    ['a route that does not exist', await ask(url, '/api/v2/nothing', {token: reader.token}), 404, 'not-found'],
  ];
  for (const [what, answer, status, code] of cases) {
    assert.equal(answer.status, status, what);
    assert.equal(codeOf(answer), code, what);
    assert.deepEqual(Object.keys((answer.body as {error: object}).error).filter(key => !['code', 'retryable', 'detail'].includes(key)), [], `${what}: only the body's own members`);
    assert.equal((answer.body as {error: {retryable: boolean}}).error.retryable, errorBody(code as 'internal').error.retryable, what);
  }
  assert.equal((await ask(url, '/api/v2/authority?scope=read', {token: reader.token})).status, 200);
  // The hook's credential may only publish lifecycle observations: a command through the SDK edge is forbidden.
  const remote = await connectRemote({url, source: hook.source, token: hook.token});
  context.after(() => remote.close());
  const commanded = await remote.request('bunny.cmd.approval-recover.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', {
    type: 'org.bunny.approval.recover.requested', subject: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    dataschema: 'https://bunny.invalid/events/approval-recover/2.0', data: {turnId: 'turn-1', expectedRevision: 1},
  }, {timeoutMs: 2000});
  assert.equal(commanded.status === 'rejected' && commanded.error.error.code, 'forbidden');
  await remote.close();
  const refusals = g.logs.filter(record => record.event_name === 'runtime.edge.refused');
  assert.ok(refusals.some(record => record.attributes['http.route'] === '/api/v2/families/{family}' && record.attributes['bunny.code'] === 'invalid-request'));
  assert.ok(refusals.some(record => record.attributes['bunny.code'] === 'forbidden' && record.attributes['bunny.participant'] === hook.source && record.severity_text === 'WARN'));
  assert.ok(refusals.every(record => !JSON.stringify(record).includes('Bad_Family')), 'a record names the route, never what the caller sent');
  await g.runtime.stop();
  assertNoToken(g);
});

it('a token used from a browser page, on another site or with another origin is refused, and a browser session only on this origin', async context => {
  const reader = READER();
  const g = await gateway(context, [reader], {browserAccess: 'trusted-loopback'});
  const {ask, url} = g;
  const origin = url;
  // A credential is never a browser's.
  for (const headers of [{origin}, {origin: 'http://pages.invalid'}, {'sec-fetch-site': 'same-origin'}, {'sec-fetch-site': 'cross-site'}]) {
    const answer = await ask(url, '/api/v2/modules', {token: reader.token, headers});
    assert.deepEqual([answer.status, codeOf(answer)], [403, 'forbidden'], JSON.stringify(headers));
  }
  // Sign-in takes this origin's own page and the request header.
  const signIn = (headers: Record<string, string>): Promise<Answer> => ask(url, '/api/v2/browser/session', {method: 'POST', body: {}, headers});
  for (const headers of [{}, {origin: 'http://pages.invalid', 'bunny-request': '1'}, {origin}, {origin, 'bunny-request': '1', 'sec-fetch-site': 'cross-site'}]) {
    const refused = await signIn(headers);
    assert.deepEqual([refused.status, codeOf(refused)], [403, 'forbidden'], JSON.stringify(headers));
    assert.equal(refused.headers.get('set-cookie'), null);
  }
  const signed = await signIn({origin, 'bunny-request': '1', 'sec-fetch-site': 'same-origin'});
  assert.equal(signed.status, 200);
  const setCookie = signed.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^bunny-session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  assert.equal(signed.text.includes(setCookie.split(';')[0]?.split('=')[1] ?? 'none'), false, 'the token travels only in the cookie');
  const cookie = setCookie.split(';')[0] ?? '';
  // The session reads from this origin's own pages, a bookmark included, and never from another site.
  assert.equal((await ask(url, '/api/v2/modules', {headers: {cookie, 'sec-fetch-site': 'same-origin'}})).status, 200);
  assert.equal((await ask(url, '/modules/sign/preview', {headers: {cookie, 'sec-fetch-site': 'none'}})).status, 200);
  for (const headers of [{cookie, 'sec-fetch-site': 'cross-site'}, {cookie, origin: 'http://pages.invalid'}, {cookie, 'sec-fetch-site': 'same-site'}]) {
    const answer = await ask(url, '/api/v2/modules', {headers});
    assert.deepEqual([answer.status, codeOf(answer)], [403, 'forbidden'], JSON.stringify(headers));
  }
  // A change with the session names this origin and carries the request header.
  const body = {session: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', turnId: 'turn-1', expectedRevision: 0};
  const unmarked = await ask(url, '/api/v2/commands/approval-recover', {method: 'POST', body, headers: {cookie, origin}});
  assert.deepEqual([unmarked.status, codeOf(unmarked)], [403, 'forbidden']);
  const marked = await ask(url, '/api/v2/commands/approval-recover', {method: 'POST', body, headers: {cookie, origin, 'bunny-request': '1'}});
  assert.deepEqual([marked.status, codeOf(marked)], [404, 'not-found'], 'the core refuses a session it does not hold');
  // MCP takes a client credential only.
  const mcp = await ask(url, '/mcp', {method: 'POST', body: {jsonrpc: '2.0', id: 1, method: 'initialize'}, headers: {cookie, origin, 'bunny-request': '1'}});
  assert.deepEqual([mcp.status, codeOf(mcp)], [403, 'forbidden']);
  // Logging out ends the session.
  const out = await ask(url, '/api/v2/browser/logout', {method: 'POST', body: {}, headers: {cookie, origin, 'bunny-request': '1'}});
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') ?? '', /^bunny-session=; .*Max-Age=0$/);
  assert.equal((await ask(url, '/api/v2/modules', {headers: {cookie, 'sec-fetch-site': 'same-origin'}})).status, 401);
  await g.runtime.stop();
  assertNoToken(g);
});

it('the launcher hands out a code that signs one browser in once; trusted loopback sign-in is off unless configured', async context => {
  const g = await gateway(context, [READER()]);
  const {ask, url} = g;
  const origin = url;
  const headers = {origin, 'bunny-request': '1'};
  const off = await ask(url, '/api/v2/browser/session', {method: 'POST', body: {}, headers});
  assert.deepEqual([off.status, codeOf(off)], [404, 'not-found'], 'trusted loopback sign-in is off');
  const launch = await requestBrowserLaunch(g.stateDir);
  assert.equal(launch.url, `${url}/`);
  const exchanged = await ask(url, '/api/v2/browser/launch', {method: 'POST', body: {code: launch.code}, headers});
  assert.equal(exchanged.status, 200);
  const cookie = (exchanged.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.equal((await ask(url, '/modules/sign/preview', {headers: {cookie}})).status, 200);
  const again = await ask(url, '/api/v2/browser/launch', {method: 'POST', body: {code: launch.code}, headers});
  assert.deepEqual([again.status, codeOf(again)], [401, 'unauthenticated'], 'a code is good once');
  const forged = await ask(url, '/api/v2/browser/launch', {method: 'POST', body: {code: randomBytes(32).toString('base64url')}, headers});
  assert.deepEqual([forged.status, codeOf(forged)], [401, 'unauthenticated']);
  assert.equal(JSON.stringify(g.logs).includes(launch.code), false, 'no record holds a launch code');
});

it('the edge\'s configuration section is checked whole, and a launcher whose socket path is too long refuses the start', async context => {
  const reader = READER();
  const files = await edgeConfig(context, [reader]);
  const edge = (section: object): string => JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {credentials: files.credentials, ...section}});
  for (const [what, text] of [
    ['a relative credentials path', JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {credentials: 'edge-credentials.json'}})],
    ['an unknown member', edge({tokens: []})], ['another browser access', edge({browserAccess: 'open'})], ['a launcher that is not a switch', edge({launcher: 'off'})],
    ['an editor link to another host', edge({editorLinks: {'sign-1': 'http://example.invalid/'}})],
    ['an editor link with a query', edge({editorLinks: {'sign-1': 'http://127.0.0.1:9100/?token=x'}})],
    ['a place link without a port', edge({placeLinks: {kitchen: 'http://127.0.0.1/'}})], ['a place called bunny', edge({placeLinks: {bunny: 'http://127.0.0.1:9200/'}})],
  ] as const) {
    await writeFile(files.config, text, {mode: 0o600});
    await assert.rejects(run(context, {modules: [], configFile: files.config, edge: {schemas: {}}}),
      (error: unknown) => error instanceof RuntimeError && error.code === 'config-invalid', what);
  }
  // A state directory too deep for a Unix socket: the launcher would bind where nobody looks, so the start is refused.
  await writeFile(files.config, edge({}), {mode: 0o600});
  const deep = `${await stateDir(context)}/${'d'.repeat(90)}`;
  await assert.rejects(run(context, {modules: [], stateDir: deep, configFile: files.config, edge: {schemas: {}}}),
    (error: unknown) => error instanceof RuntimeError && error.code === 'launcher-path-too-long');
  await writeFile(files.config, edge({launcher: false}), {mode: 0o600});
  const {runtime} = await run(context, {modules: [], stateDir: deep, configFile: files.config, edge: {schemas: {}}});
  await assert.rejects(requestBrowserLaunch(deep), 'no launcher serves when it is off');
  assert.equal((await call(runtime.url, '/api/v2/authority?scope=read', {token: reader.token})).status, 200);
});

it('reloading the credentials file takes a granted credential, refuses a revoked one and ends its stream, and keeps the old ones when the file is refused', async context => {
  const reader = READER(), operator = OPERATOR();
  const g = await gateway(context, [reader, operator]);
  const {ask, url} = g;
  const remote = await connectRemote({url, source: reader.source, token: reader.token, reconnectDelayMs: 20});
  context.after(() => remote.close());
  const copy = await remote.sync(['session'], () => {}, {timeoutMs: 5000});
  assert.equal(copy.status, 'synced');
  // A new producer is granted, as a hook's setup would, and the old reader revoked.
  const producer = {id: 'hub-fedcba9876543210fedcba9876543210', source: 'bunny/parts/hook-codex', token: token()};
  await grantCredential(g.files.credentials, {id: producer.id, source: producer.source, digest: tokenDigest(producer.token), scopes: ['ingest'], devices: []});
  assert.equal(await revokeCredential(g.files.credentials, reader.id ?? ''), true);
  assert.equal(await revokeCredential(g.files.credentials, 'nobody'), false);
  assert.equal((await ask(url, '/api/v2/authority?scope=ingest', {token: producer.token})).status, 401, 'not before the reload');
  await g.runtime.reload();
  assert.equal((await ask(url, '/api/v2/authority?scope=ingest', {token: producer.token})).status, 200);
  const revoked = await ask(url, '/api/v2/modules', {token: reader.token});
  assert.deepEqual([revoked.status, codeOf(revoked)], [401, 'unauthenticated'], 'a revoked token is unauthenticated');
  await waitFor(() => g.logs.some(record => record.event_name === 'runtime.edge.disconnected' && record.attributes['bunny.participant'] === reader.source), 5000,
    'the revoked part\'s stream ended');
  // It cannot connect again.
  const again = await connectRemote({url, source: reader.source, token: reader.token}).then(
    async connected => { await connected.close(); return 'connected'; }, (error: unknown) => error instanceof SdkError ? error.body.error.code : 'failed');
  assert.equal(again, 'unauthenticated');
  // A file the runtime refuses keeps what it had.
  await writeFile(g.files.credentials, '{', {mode: 0o600});
  await assert.rejects(g.runtime.reload(), (error: unknown) => error instanceof RuntimeError && error.code === 'edge-credentials-invalid');
  assert.equal((await ask(url, '/api/v2/authority?scope=read', {token: operator.token})).status, 200, 'the operator still reads');
  const reloads = g.logs.filter(record => record.event_name === 'runtime.edge.reloaded').map(record => [record.severity_text, record.attributes['bunny.outcome'], record.attributes['error.code']]);
  assert.deepEqual(reloads, [['INFO', 'succeeded', undefined], ['ERROR', 'failed', 'edge-credentials-invalid']]);
  await remote.close();
  await g.runtime.stop();
  assertNoToken(g);
});

it('MCP lists and calls only what a credential may use, maps results and refusals to the shared error body, and recovers no approval for a reader', async context => {
  const reader = READER(), operator = OPERATOR(), hook = HOOK();
  const g = await gateway(context, [reader, operator, hook]);
  const {ask, url} = g;
  const accept = {accept: 'application/json, text/event-stream'};
  const session = async (part: EdgePart): Promise<Record<string, string>> => {
    const init = await ask(url, '/mcp', {method: 'POST', token: part.token, headers: accept, body: {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1.0.0'}},
    }});
    assert.equal(init.status, 200, init.text);
    const headers = {...accept, 'mcp-session-id': init.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25'};
    await ask(url, '/mcp', {method: 'POST', token: part.token, headers, body: {jsonrpc: '2.0', method: 'notifications/initialized'}});
    return headers;
  };
  const tools = async (part: EdgePart): Promise<string[]> => {
    const listed = await ask(url, '/mcp', {method: 'POST', token: part.token, headers: await session(part), body: {jsonrpc: '2.0', id: 2, method: 'tools/list'}});
    return ((listed.body as {result: {tools: {name: string}[]}}).result.tools).map(tool => tool.name).sort();
  };
  assert.deepEqual(await tools(operator), ['core_recover_approval', 'core_sessions', 'sign_status']);
  assert.deepEqual(await tools(reader), ['core_sessions', 'sign_status'], 'a reader sees no action');
  assert.deepEqual(await tools(hook), [], 'a hook sees no tool');
  const headers = await session(operator);
  const tool = async (name: string, args: object): Promise<{isError: boolean; structuredContent: Record<string, unknown>}> => {
    const answer = await ask(url, '/mcp', {method: 'POST', token: operator.token, headers, body: {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name, arguments: args}}});
    return (answer.body as {result: {isError: boolean; structuredContent: Record<string, unknown>}}).result;
  };
  const status = await tool('sign_status', {});
  assert.equal(status.isError, false);
  assert.deepEqual(status.structuredContent, {kind: 'extension', data: {result: {signs: [{id: 'sign-1', availability: (status.structuredContent.data as {result: {signs: {availability: string}[]}}).result.signs[0]?.availability}]}}});
  const recovery = await tool('core_recover_approval', {session: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', turnId: 'turn-1', expectedRevision: 0});
  assert.equal(recovery.isError, true);
  assert.deepEqual(recovery.structuredContent.kind, 'extension');
  assert.equal(((recovery.structuredContent.data as {error: {code: string}}).error.code), 'not-found', 'the core\'s refusal, in the shared error body');
  const unknown = await ask(url, '/mcp', {method: 'POST', token: operator.token, headers, body: {jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'no_such_tool', arguments: {}}}});
  assert.equal(typeof (unknown.body as {error?: {code?: unknown}}).error?.code, 'number', 'an unknown tool is an MCP protocol error, as the MCP specification has it');
  const withOrigin = await ask(url, '/mcp', {method: 'POST', token: operator.token, headers: {...headers, origin: url}, body: {jsonrpc: '2.0', id: 5, method: 'tools/list'}});
  assert.deepEqual([withOrigin.status, codeOf(withOrigin)], [403, 'forbidden']);
  await g.runtime.stop();
  assertNoToken(g);
});

it('a module\'s page and content come with the gateway\'s policy, its settings never show a secret, and a contribution that throws fails only its module', async context => {
  const reader = READER();
  const thrower: BunnyModule = {
    manifest: {name: 'broken', apiVersion: '1.2', pages: [{id: 'status', title: 'Status', render: () => { throw new Error(`the page quoted ${SYNTHETIC_TOKEN}`); }}]},
    start: () => {}, stop: () => {},
  };
  const leaky: BunnyModule<{token: string}> = {
    manifest: {
      name: 'leaky', apiVersion: '1.2', configure: () => ({config: {token: SYNTHETIC_TOKEN}}),
      settings: {schema: {type: 'object'}, show: config => ({token: config.token})},
      content: ref => ref === 'odd' ? {type: 'text/html', bytes: new Uint8Array([60])} : undefined,
      tools: [{name: 'peek', description: 'Answers with what it should not.', input: {type: 'object', additionalProperties: false}, output: {type: 'object'},
        read: () => ({token: SYNTHETIC_TOKEN})}],
    },
    async start({secrets}) { await secrets.read('token'); }, stop: () => {},
  };
  const dir = await stateDir(context);
  const secret = `${dir}/leaky-token`;
  await writeFile(secret, `${SYNTHETIC_TOKEN}\n`, {mode: 0o600});
  const files = await edgeConfig(context, [reader], {modules: {leaky: {secrets: {token: secret}}}});
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), thrower, leaky], configFile: files.config, edge: {schemas: {}}});
  const url = runtime.url;
  const page = await call(url, '/modules/broken/status', {token: reader.token});
  assert.deepEqual([page.status, codeOf(page)], [500, 'internal']);
  assert.equal(page.text.includes(SYNTHETIC_TOKEN), false);
  assert.deepEqual([entry(runtime.health(), 'broken').state, entry(runtime.health(), 'core').state], ['failed', 'running'], 'the module failed, the others run');
  const again = await call(url, '/modules/broken/status', {token: reader.token});
  assert.deepEqual([again.status, codeOf(again)], [503, 'unavailable'], 'a failed module is not called again');
  const settings = await call(url, '/api/v2/modules/leaky/settings', {token: reader.token});
  assert.deepEqual([settings.status, codeOf(settings)], [500, 'internal'], 'settings that show a secret are never served');
  assert.equal(settings.text.includes(SYNTHETIC_TOKEN), false);
  const odd = await call(url, '/modules/leaky/content/odd', {token: reader.token});
  assert.deepEqual([odd.status, codeOf(odd)], [500, 'internal'], 'content of a type the gateway does not serve');
  assert.deepEqual([(await call(url, '/modules/leaky/content/none', {token: reader.token})).status, (await call(url, '/modules/nobody/page', {token: reader.token})).status], [404, 404]);
  // A tool's answer that holds a secret a module read is refused too.
  const accept = {accept: 'application/json, text/event-stream'};
  const init = await call(url, '/mcp', {method: 'POST', token: reader.token, headers: accept, body: {
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1.0.0'}},
  }});
  const session = {...accept, 'mcp-session-id': init.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25'};
  await call(url, '/mcp', {method: 'POST', token: reader.token, headers: session, body: {jsonrpc: '2.0', method: 'notifications/initialized'}});
  const peeked = await call(url, '/mcp', {method: 'POST', token: reader.token, headers: session, body: {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'leaky_peek', arguments: {}}}});
  assert.equal(peeked.text.includes(SYNTHETIC_TOKEN), false);
  assert.equal(((peeked.body as {result: {structuredContent: {data: {error: {code: string}}}}}).result.structuredContent.data.error.code), 'internal');
  await runtime.stop();
  assert.equal(JSON.stringify(logs).includes(SYNTHETIC_TOKEN), false);
  assert.equal(JSON.stringify(logs).includes(MARKER), false);
});

it('the sign\'s page refers to its preview by reference and is served with a policy that allows no script, frame or form', async context => {
  const reader = READER();
  const g = await gateway(context, [reader]);
  const page = await g.ask(g.url, '/modules/sign/preview', {token: reader.token});
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(page.text, /<img src="content\/preview.png"/);
  const policy = page.headers.get('content-security-policy') ?? '';
  for (const directive of ['default-src \'none\'', 'img-src \'self\'', 'frame-ancestors \'none\'', 'form-action \'none\'', 'base-uri \'none\'']) assert.ok(policy.includes(directive), directive);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  const preview = await fetch(new URL('/modules/sign/content/preview.png', g.url), {headers: {authorization: `Bearer ${reader.token}`}});
  assert.equal(preview.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await preview.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71]);
  const settings = await g.ask(g.url, '/api/v2/modules/sign/settings', {token: reader.token});
  assert.deepEqual((settings.body as {settings: unknown}).settings, {greeting: 'hello', signs: [{id: 'sign-1', address: '192.0.2.10'}]});
  const links = await g.ask(g.url, '/api/v2/links', {token: reader.token});
  assert.deepEqual(links.body, {schema: 'links/2.0', editors: {}, places: {kitchen: 'http://127.0.0.1:9200/'}}, 'an editor link only for a device the caller may command');
  await g.runtime.stop();
  assertNoToken(g);
});

it('the route map covers every route of the old Hub\'s server and its route modules, and a retired route answers not-found', async context => {
  const read = async (path: string): Promise<string> => readFile(fileURLToPath(new URL(`../../../hub/src/${path}`, import.meta.url)), 'utf8');
  const server = await read('server.ts');
  const automation = await read('automation-routes.ts');
  const found = new Set<string>();
  for (const [, path] of server.matchAll(/path\s*===\s*'(\/[^']*)'/g)) found.add(path ?? '');
  for (const [, path] of server.matchAll(/\['(\/)', '(\/dashboard\.js)', '(\/dashboard\.css)'\]/g)) found.add(path ?? '');
  for (const asset of ['/dashboard.js', '/dashboard.css']) if (server.includes(`'${asset}'`)) found.add(asset);
  // The controller routes are regular expressions; each alternative is a route.
  for (const [, body] of server.matchAll(/\/\^\\\/api\\\/controllers\\\/v1\\\/\(\[A-Za-z0-9_\.-\]\{1,128\}\)\\\/(.*?)\$\//g)) {
    const pattern = body ?? '';
    const prefix = pattern.startsWith('integration') ? 'integration/' : pattern.startsWith('lighting') ? 'lighting/' : '';
    const alternatives = /\(((?:\?:)?[a-z|]+)\)/.exec(pattern.slice(prefix.length > 0 ? prefix.length + 2 : 0))?.[1]?.replace('?:', '').split('|') ?? [];
    for (const alternative of alternatives) found.add(`/api/controllers/v1/{device}/${prefix}${alternative}${/\\\/\.\*/.test(pattern) ? '/*' : ''}`);
  }
  if (server.includes('/^\\/api\\/wispr\\/v1\\/([a-z]+)$/')) found.add('/api/wispr/v1/{operation}');
  if (server.includes('previewProof.prefix')) found.add('/__app-verify/proof/*');
  const prefix = /AUTOMATION_PREFIX = '([^']+)'/.exec(automation)?.[1] ?? '';
  for (const [, path] of automation.matchAll(/path === '([a-z-]+)'/g)) found.add(`${prefix}${path ?? ''}`);
  if (automation.includes('rules\\/([A-Za-z0-9_.-]{1,128})(?:\\/(enable|disable))?')) {
    for (const path of ['rules/{rule}', 'rules/{rule}/enable', 'rules/{rule}/disable']) found.add(`${prefix}${path}`);
  }
  const mapped = new Set(RETIRED_ROUTES.map(route => route.path));
  assert.ok(found.size >= 30, `the parser found the routes: ${[...found].join(', ')}`);
  const missing = [...found].filter(path => !mapped.has(path));
  assert.deepEqual(missing, [], 'every route of the old Hub has a 2.0 replacement or a recorded drop');
  assert.equal(retiredRoute('GET', '/api/controllers/v1/pixoo-desk/integration/catalog/media/a.gif')?.owner, '#843');
  assert.equal(retiredRoute('POST', '/api/monitor/v1/events')?.replacement.includes('bunny.event.lifecycle'), true);

  const reader = READER();
  const g = await gateway(context, [reader]);
  for (const path of ['/api/monitor/v1/events', '/api/controllers/v1/pixoo-desk/snapshot', '/api/automation/v1/rules/r1/enable', '/']) {
    const answer = await g.ask(g.url, path, {token: reader.token, method: path === '/' ? 'GET' : 'POST', ...(path === '/' ? {} : {body: {}})});
    assert.deepEqual([answer.status, codeOf(answer)], [404, 'not-found'], path);
  }
  const logged = g.logs.filter(record => record.event_name === 'runtime.edge.refused' && record.attributes['bunny.code'] === 'not-found').map(record => record.attributes['http.route']);
  assert.deepEqual(logged, ['/api/monitor/v1/events', '/api/controllers/v1/{device}/snapshot', '/api/automation/v1/rules/{rule}/enable', '/']);
  assert.equal(JSON.stringify(g.logs).includes('pixoo-desk'), false, 'a record names the route, never the device in its path');
});

it('the conversion carries a Hub\'s credentials with every scope and device grant, its sign-in and links, and a converted token authenticates', async context => {
  const tokens = {dashboard: token(), producer: token(), admin: token()};
  const hub = {
    directory: '/home/owner/.local/state/agent-device-hub/hub', ownerId: 'owner', port: 8788, browserAccess: 'trusted-loopback',
    credentials: [
      {id: 'Pixoo_Monitor', digest: tokenDigest(tokens.dashboard), scopes: ['read', 'control'], devices: ['sign-1', 'pixoo-desk']},
      {id: 'hub-0123456789abcdef0123456789abcdef', digest: tokenDigest(tokens.producer), scopes: ['ingest'], devices: []},
      {id: 'owner-admin', digest: tokenDigest(tokens.admin), scopes: ['read', 'control', 'ingest', 'admin'], devices: ['sign-1']},
    ],
    editorLinks: {'sign-1': 'http://127.0.0.1:9100/editor'}, placeLinks: {kitchen: 'http://127.0.0.1:9200/'},
  };
  const converted = convertHubEdge(hub);
  assert.deepEqual(converted.credentials.map(({id, source, scopes, devices}) => ({id, source, scopes, devices})), [
    {id: 'Pixoo_Monitor', source: 'bunny/parts/pixoo-monitor', scopes: ['read', 'control'], devices: ['sign-1', 'pixoo-desk']},
    {id: 'hub-0123456789abcdef0123456789abcdef', source: 'bunny/parts/hub-0123456789abcdef0123456789abcdef', scopes: ['ingest'], devices: []},
    {id: 'owner-admin', source: 'bunny/parts/owner-admin', scopes: ['read', 'control', 'ingest', 'admin'], devices: ['sign-1']},
  ]);
  assert.deepEqual(converted.credentials.map(credential => credential.digest), hub.credentials.map(credential => credential.digest), 'the digests, never a token');
  assert.deepEqual(converted.edge, {browserAccess: 'trusted-loopback', launcher: true, editorLinks: hub.editorLinks, placeLinks: hub.placeLinks});
  for (const [what, broken] of [
    ['two IDs, one source', {...hub, credentials: [...hub.credentials, {...hub.credentials[0], id: 'pixoo-monitor', digest: tokenDigest(token())}]}],
    ['a device that is not a routing ID', {...hub, credentials: [{...hub.credentials[0], devices: ['Pixoo Desk']}]}],
    ['an unknown scope', {...hub, credentials: [{...hub.credentials[0], scopes: ['owner']}]}],
    ['another browser access', {...hub, browserAccess: 'open'}],
  ] as const) {
    assert.throws(() => convertHubEdge(broken), (error: unknown) => error instanceof RuntimeError && error.code === 'convert-invalid' && !String(error).includes(MARKER), what);
  }
  // The installer writes what the conversion gives, and the runtime takes it.
  const files = await edgeConfig(context, []);
  await writeFile(files.credentials, credentialsDocument(converted.credentials), {mode: 0o600});
  await writeFile(files.config, JSON.stringify({schema: CONFIG_SCHEMA, modules: {}, edge: {credentials: files.credentials, ...converted.edge}}), {mode: 0o600});
  const {runtime} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const authority = async (value: string, scope: string): Promise<number> => (await call(runtime.url, `/api/v2/authority?scope=${scope}`, {token: value})).status;
  assert.deepEqual([await authority(tokens.dashboard, 'control'), await authority(tokens.dashboard, 'ingest')], [200, 403]);
  assert.deepEqual([await authority(tokens.producer, 'ingest'), await authority(tokens.producer, 'read')], [200, 403]);
  assert.equal(await authority(tokens.admin, 'admin'), 200);
  const signed = await call(runtime.url, '/api/v2/browser/session', {method: 'POST', body: {}, headers: {origin: runtime.url, 'bunny-request': '1'}});
  assert.equal(signed.status, 200, 'trusted loopback sign-in came across');
  assert.equal(JSON.stringify(await readFile(files.credentials, 'utf8')).includes(MARKER), false, 'the credentials file holds no token');
});

it('a stalled reader\'s stream is ended at the runtime\'s stall limit, and the end is a warning with its code', async context => {
  const reader = READER();
  const files = await edgeConfig(context, [reader]);
  const clock = manualClock();
  const blob = fixture('blob');
  const {runtime, logs} = await run(context, {modules: [createCoreModule(), blob], configFile: files.config,
    edge: {schemas: {}, liveness: {stallMs: 5000, heartbeatMs: 3_600_000, scheduler: clock.scheduler}}});
  // A reader that subscribes, then stops reading, as a suspended host would.
  const stream = await rawStream(runtime.url, reader.token);
  context.after(() => { stream.response.destroy(); });
  const subscribed = await call(runtime.url, '/api/sdk/v1/subscribe', {method: 'POST', token: reader.token, body: {schema: 'sdk-remote/1.0', connection: stream.connection, id: 's1', pattern: 'bunny.state.blob.*'}});
  assert.equal(subscribed.status, 200, subscribed.text);
  const {sdk} = contextOf(blob);
  for (let revision = 1; revision <= 60; revision += 1) {
    await sdk.publish('bunny.state.blob.b1', {kind: 'state', type: 'org.bunny.blob.updated', subject: 'b1', dataschema: 'https://bunny.invalid/events/blob/2.0',
      data: {id: 'b1', revision, pad: 'x'.repeat(100_000)}});
    await new Promise(resolve => { setImmediate(resolve); });
  }
  // The socket is full, so the edge's writes wait, and its stall limit is running.
  await waitFor(() => clock.pending() > 0, 5000, 'the full socket');
  assert.equal(logs.some(record => record.event_name === 'runtime.edge.disconnected'), false, 'a full socket alone ends nothing');
  clock.advance(5000);
  await waitFor(() => logs.some(record => record.event_name === 'runtime.edge.disconnected'), 5000, 'the stalled stream ended');
  const ended = logs.find(record => record.event_name === 'runtime.edge.disconnected');
  assert.deepEqual([ended?.severity_text, ended?.attributes['bunny.code'], ended?.attributes['bunny.reason'], ended?.attributes['bunny.participant']],
    ['WARN', 'capacity', 'busy', reader.source]);
  await runtime.stop();
});

/** Opens a raw stream to the runtime's edge, reads its ready event, and then stops reading. */
async function rawStream(url: string, bearer: string): Promise<{connection: string; response: IncomingMessage}> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL('/api/sdk/v1/stream', url), {headers: {authorization: `Bearer ${bearer}`}}, response => {
      let text = '';
      const onData = (chunk: Buffer): void => {
        text += chunk.toString('utf8');
        const ready = /event: ready\ndata: (.*)\n\n/.exec(text);
        if (ready?.[1] === undefined) return;
        response.off('data', onData);
        response.pause();
        resolve({connection: (JSON.parse(ready[1]) as {connection: string}).connection, response});
      };
      response.on('data', onData);
    });
    request.once('error', reject);
    request.end();
  });
}
