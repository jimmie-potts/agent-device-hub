// The gateway's action routes (Hub #782): `POST /api/v2/commands/<family>` and MCP's `core_send_command` send a device's
// command through the core's dispatcher as the caller's source, so every action is tracked. Invalid input is refused
// with a registry code before anything is tracked, and a remote grant may request only the core's own operator commands
// directly at the SDK edge: never a device's, a moment, a mode change or a module's own family.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import type {TestContext} from 'node:test';
import {connectRemote} from '@jimmie-potts/sdk';
import {createCoreModule, type CoreHandle, type LogRecord, type Runtime} from '../src/index.js';
import {standInParts} from './fixtures/core.js';
import {lampSchemas, SimulatedLamps, createLampModule, switchLamp} from './fixtures/lamp.js';
import {edgeConfig, it, run, waitFor, type EdgePart} from './support.js';

const MARKER = 'tok_SYNTHETIC835';
const token = (): string => `${MARKER}_${randomBytes(24).toString('base64url')}`;
const READER = (): EdgePart => ({id: 'reader', source: 'bunny/parts/reader', token: token(), scopes: ['read']});
const OPERATOR = (): EdgePart => ({id: 'operator', source: 'bunny/parts/operator', token: token(), scopes: ['read', 'control']});
const HOOK = (): EdgePart => ({id: 'hub-0123456789abcdef0123456789abcdef', source: 'bunny/parts/hook', token: token(), scopes: ['ingest']});
type Answer = {status: number; headers: Headers; text: string; body: unknown};

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

type Actions = {runtime: Runtime; logs: LogRecord[]; url: string; lamps: SimulatedLamps; handle: () => CoreHandle | undefined; answers: Answer[]};

/** The runtime with its gateway and MCP, the core and the lamp, for the parts' credentials. `core: false` leaves the core out. */
async function actions(context: TestContext, parts: readonly EdgePart[], {core = true}: {core?: boolean} = {}): Promise<Actions & {ask: typeof call}> {
  const files = await edgeConfig(context, parts, {mcp: true});
  const lamps = new SimulatedLamps();
  let handle: CoreHandle | undefined;
  const modules = [
    // The stand-in parts serve the mode the lamp copies.
    ...(core ? [createCoreModule({parts: [standInParts(), {start: given => { handle = given; return Promise.resolve(); }}]})] : []),
    createLampModule({transport: lamps}),
  ];
  const {runtime, logs} = await run(context, {modules, configFile: files.config, edge: {schemas: lampSchemas}});
  const answers: Answer[] = [];
  const ask: typeof call = async (url, path, init) => {
    const answer = await call(url, path, init);
    answers.push(answer);
    return answer;
  };
  return {runtime, logs, url: runtime.url, lamps, handle: () => handle, answers, ask};
}

/** Fails if a part's token appears in a record or an answer. */
function assertNoToken(a: Actions): void {
  assert.equal(JSON.stringify(a.logs).includes(MARKER), false, 'no token in a record');
  assert.equal(JSON.stringify(a.answers.map(answer => answer.text)).includes(MARKER), false, 'no token in an answer');
}

it('an operator\'s action goes through the core\'s dispatcher as its own source, and the lamp switches once', async context => {
  const operator = OPERATOR();
  const a = await actions(context, [operator]);
  const answer = await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', token: operator.token, body: {target: 'lamp-1', data: {power: 'on'}, requestId: 'req-http'}});
  assert.equal(answer.status, 200, answer.text);
  assert.deepEqual(answer.body, {schema: 'command-reply/2.0', status: 'accepted', requestId: 'req-http'});
  await waitFor(() => a.lamps.state().power['lamp-1'] === 'on', 5000, 'the lamp on');
  await waitFor(() => a.handle()?.operation('req-http')?.status === 'completed', 5000, 'the tracked outcome');
  const operation = a.handle()?.operation('req-http');
  assert.deepEqual([operation?.requestedBy, operation?.key, operation?.result, operation?.evidence], [operator.source, 'bunny.cmd.lamp-switch.lamp-1', 'succeeded', 'observed']);
  // Sent again with the same request ID, it is the same action: answered again, never sent again.
  const again = await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', token: operator.token, body: {target: 'lamp-1', data: {power: 'on'}, requestId: 'req-http'}});
  assert.deepEqual(again.body, {schema: 'command-reply/2.0', status: 'accepted', requestId: 'req-http'});
  const other = await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', token: operator.token, body: {target: 'lamp-1', data: {power: 'off'}, requestId: 'req-http'}});
  assert.deepEqual([other.status, codeOf(other)], [409, 'duplicate-conflict'], 'another action under the same request ID');
  assert.equal(a.lamps.state().calls.length, 1, 'the lamp switched once');
  const generated = await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', token: operator.token, body: {target: 'lamp-1', data: {power: 'off'}}});
  assert.match(String((generated.body as {requestId?: unknown}).requestId), /^[0-9a-f-]{36}$/, 'a request ID is generated when none is given');
  await a.runtime.stop();
  assertNoToken(a);
});

it('the action route refuses invalid input with a registry code, and nothing is tracked or sent', async context => {
  const operator = OPERATOR(), reader = READER(), hook = HOOK();
  const a = await actions(context, [operator, reader, hook]);
  const post = (path: string, body: unknown, as = operator): Promise<Answer> => a.ask(a.url, path, {method: 'POST', token: as.token, body});
  const valid = {target: 'lamp-1', data: {power: 'on'}};
  const cases: [string, Answer, number, string][] = [
    ['a body that is not JSON', await post('/api/v2/commands/lamp-switch', '{'), 400, 'invalid-request'],
    ['a member the route does not take', await post('/api/v2/commands/lamp-switch', {...valid, extra: 1}), 400, 'invalid-request'],
    ['a target that is not a routing ID', await post('/api/v2/commands/lamp-switch', {...valid, target: 'Lamp 1'}), 400, 'invalid-request'],
    ['a request ID inside the payload', await post('/api/v2/commands/lamp-switch', {...valid, data: {power: 'on', requestId: 'req-x'}}), 400, 'invalid-request'],
    ['a malformed request ID', await post('/api/v2/commands/lamp-switch', {...valid, requestId: 'two words'}), 400, 'invalid-request'],
    ['a payload outside its family\'s schema', await post('/api/v2/commands/lamp-switch', {...valid, data: {power: 'dim'}}), 400, 'invalid-request'],
    ['a family no module answers', await post('/api/v2/commands/kettle-boil', valid), 404, 'not-found'],
    ['a family that is no command', await post('/api/v2/commands/session', valid), 400, 'invalid-request'],
    ['a state family', await post('/api/v2/commands/inbox-item', valid), 400, 'invalid-request'],
    ['the core\'s own operator command', await post('/api/v2/commands/notice-acknowledge', {target: 'a'.repeat(64), data: {consumerId: 'pixoo', noticeId: 'b'.repeat(64)}}), 400, 'invalid-request'],
    ['a reader', await post('/api/v2/commands/lamp-switch', valid, reader), 403, 'forbidden'],
    ['a hook', await post('/api/v2/commands/lamp-switch', valid, hook), 403, 'forbidden'],
    ['a query', await a.ask(a.url, '/api/v2/commands/lamp-switch?now=1', {method: 'POST', token: operator.token, body: valid}), 400, 'invalid-request'],
    ['no token', await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', body: valid}), 401, 'unauthenticated'],
  ];
  for (const [what, answer, status, code] of cases) assert.deepEqual([answer.status, codeOf(answer)], [status, code], what);
  assert.equal(a.lamps.state().calls.length, 0, 'nothing reached the lamp');
  const refused = a.logs.filter(record => record.event_name === 'runtime.edge.refused' && record.attributes['http.route'] === '/api/v2/commands/{family}');
  assert.ok(refused.length > 0 && refused.every(record => !JSON.stringify(record).includes('kettle')), 'logged by route template, never what the caller sent');
  await a.runtime.stop();
  assertNoToken(a);
});

it('a remote grant may request only the core\'s operator commands directly: a device\'s command or a module\'s own family is forbidden at the edge', async context => {
  const operator = OPERATOR();
  const a = await actions(context, [operator]);
  const remote = await connectRemote({url: a.url, source: operator.source, token: operator.token});
  context.after(() => remote.close());
  const {key, draft} = switchLamp('lamp-1', 'on');
  const direct = await remote.request(key, draft, {timeoutMs: 2000});
  assert.equal(direct.status === 'rejected' && direct.error.error.code, 'forbidden', 'a device\'s command goes through the dispatcher');
  // So is a mode change, a core family that only the dispatcher sends; the lamp's own family above is a module's.
  const mode = await remote.request('bunny.cmd.mode-set.hub', {
    type: 'org.bunny.mode.set.requested', subject: 'hub', dataschema: 'https://bunny.invalid/events/mode-set/2.0', data: {mode: 'quiet'},
  }, {timeoutMs: 2000});
  assert.equal(mode.status === 'rejected' && mode.error.error.code, 'forbidden', 'a mode change too');
  // The core's own operator command is still requested directly, and the core answers it.
  const acknowledged = await remote.request(`bunny.cmd.notice-acknowledge.${'a'.repeat(64)}`, {
    type: 'org.bunny.notice.acknowledge.requested', subject: 'a'.repeat(64), dataschema: 'https://bunny.invalid/events/notice-acknowledge/2.0',
    data: {consumerId: 'pixoo', noticeId: 'b'.repeat(64)},
  }, {timeoutMs: 2000});
  assert.equal(acknowledged.status === 'rejected' && acknowledged.error.error.code, 'forbidden', 'the core\'s own refusal: an operator acknowledges for no consumer');
  assert.ok(acknowledged.status === 'rejected' && acknowledged.reply !== undefined, 'from the core itself, in a reply');
  assert.equal(a.lamps.state().calls.length, 0);
  await remote.close();
  await a.runtime.stop();
  assertNoToken(a);
});

it('MCP\'s core_send_command sends an action through the dispatcher for a credential with control, and refuses invalid input in the shared error body', async context => {
  const operator = OPERATOR(), reader = READER();
  const a = await actions(context, [operator, reader]);
  const accept = {accept: 'application/json, text/event-stream'};
  const session = async (part: EdgePart): Promise<Record<string, string>> => {
    const init = await a.ask(a.url, '/mcp', {method: 'POST', token: part.token, headers: accept, body: {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1.0.0'}},
    }});
    assert.equal(init.status, 200, init.text);
    const headers = {...accept, 'mcp-session-id': init.headers.get('mcp-session-id') ?? '', 'mcp-protocol-version': '2025-11-25'};
    await a.ask(a.url, '/mcp', {method: 'POST', token: part.token, headers, body: {jsonrpc: '2.0', method: 'notifications/initialized'}});
    return headers;
  };
  const tool = async (part: EdgePart, name: string, args: object): Promise<{isError?: boolean; structuredContent?: Record<string, unknown>}> => {
    const answer = await a.ask(a.url, '/mcp', {method: 'POST', token: part.token, headers: await session(part), body: {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name, arguments: args}}});
    return (answer.body as {result: {isError?: boolean; structuredContent?: Record<string, unknown>}}).result;
  };
  const sent = await tool(operator, 'core_send_command', {family: 'lamp-switch', target: 'lamp-1', data: {power: 'on'}, requestId: 'req-mcp'});
  assert.deepEqual(sent.structuredContent, {kind: 'extension', data: {result: {status: 'accepted', requestId: 'req-mcp'}}});
  await waitFor(() => a.handle()?.operation('req-mcp')?.status === 'completed', 5000, 'the tracked outcome');
  assert.equal(a.handle()?.operation('req-mcp')?.requestedBy, operator.source);
  const invalid = await tool(operator, 'core_send_command', {family: 'lamp-switch', target: 'lamp-1', data: {power: 'dim'}});
  assert.equal(invalid.isError, true);
  assert.equal(((invalid.structuredContent?.data as {error: {code: string}}).error.code), 'invalid-request');
  const readerCall = await tool(reader, 'core_send_command', {family: 'lamp-switch', target: 'lamp-1', data: {power: 'off'}});
  assert.notEqual(readerCall.structuredContent?.kind, 'extension', 'a reader\'s call is refused before the core has it');
  assert.equal(a.lamps.state().calls.length, 1, 'only the operator\'s action reached the lamp');
  await a.runtime.stop();
  assertNoToken(a);
});

it('without the core, an action is unavailable and nothing is sent', async context => {
  const operator = OPERATOR();
  const a = await actions(context, [operator], {core: false});
  const answer = await a.ask(a.url, '/api/v2/commands/lamp-switch', {method: 'POST', token: operator.token, body: {target: 'lamp-1', data: {power: 'on'}}});
  assert.deepEqual([answer.status, codeOf(answer)], [503, 'unavailable']);
  assert.equal(a.lamps.state().calls.length, 0);
  await a.runtime.stop();
  assertNoToken(a);
});
