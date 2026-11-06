// The coding worker's real entry point as a child process over a fake edge (Hub #1384): the SDK's real edge and stream
// on 127.0.0.1, with a fake core behind it that selects one endpoint as the companions coordinator does. A first
// declaration that fails ends the process non-zero with its connection closed, whoever holds the endpoint keeps it, and a
// later fresh invocation declares once the old owner has released it. No real `claude`, core, supervisor or device.
import assert from 'node:assert/strict';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chmod, writeFile} from 'node:fs/promises';
import {createServer, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {MessageValidator, errorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {CODING_WORKER_SOURCE, type CodingEndpointControl} from '@jimmie-potts/event-contracts/v2/coding';
import {InProcessBus, RemoteEdge, type Command, type EdgePermissions, type Reply} from '@jimmie-potts/sdk';
import {stateDir, waitFor} from './support.js';

const BIN = fileURLToPath(new URL('../../bin/coding-worker.mjs', import.meta.url));
/** The coding-worker role's grant, which coding-access.test.ts checks against the real gateway's. */
const WORKER_GRANT: EdgePermissions = {calls: [], keys: [], publishes: [], endpoint: {respond: ['coding-work'], publish: ['coding-progress'], request: ['coding-endpoint']}};
/** The fake core's refusal text, which must never reach the worker's log. */
const DETAIL = 'another coding worker endpoint is selected';
/** A process that does not exit by then counts as the defect: it is killed and the test fails. */
const EXIT_BOUND_MS = 10_000;
/** A silent edge costs the enable's five-second deadline and the endpoint close's five-second bound. */
const SILENT_EXIT_BOUND_MS = 18_000;

type Exit = {code: number | null; signal: NodeJS.Signals | null};
type Control = {action: string; endpoint: string; traceId: string};
type Worker = {child: ChildProcess; stderr: () => string; exited: Promise<Exit>};

/** The SDK's edge on a free port, with a fake core that selects one endpoint and releases it on disable or loss. */
async function fakeEdge(context: TestContext, grant: EdgePermissions = WORKER_GRANT) {
  const token = randomBytes(32).toString('base64url'), validator = new MessageValidator();
  registerCoreFamilies(validator);
  const bus = new InProcessBus(), companions = bus.connect('bunny/modules/companions');
  const controls: Control[] = [], lost: string[] = [], held: ServerResponse[] = [], silent = new Set<string>(), calls = new Map<string, number>();
  let selected: string | null = null, streams = 0, hang: Promise<void> | undefined;
  await companions.respond<CodingEndpointControl>('bunny.cmd.coding-endpoint.*', async (command: Command<CodingEndpointControl>): Promise<Reply> => {
    controls.push({action: command.data.action, endpoint: command.subject, traceId: command.traceparent.split('-')[1] ?? ''});
    if (command.data.action === 'disable') {
      if (selected !== command.subject) return errorBody('forbidden');
      selected = null;
      return {status: 'accepted'};
    }
    if (selected !== null && selected !== command.subject) return errorBody('invalid-state', {detail: DETAIL});
    selected = command.subject;
    await hang;
    return {status: 'accepted'};
  });
  const edge = new RemoteEdge({bus, validator, grants: [{source: CODING_WORKER_SOURCE, token, ...grant}], onEndpointClosed: ({id}) => {
    lost.push(id);
    if (selected === id) selected = null;
  }});
  const server = createServer((request, response) => {
    const route = (request.url ?? '').split('/').pop() ?? '';
    calls.set(route, (calls.get(route) ?? 0) + 1);
    if (route === 'stream') {
      streams += 1;
      response.once('close', () => { streams -= 1; });
    }
    if (silent.has(route)) held.push(response);
    else edge.handle(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  let release = (): void => {};
  context.after(async () => {
    release();
    await companions.close();
    await edge.close();
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  return {
    url, token, controls, lost, selected: () => selected, streams: () => streams, calls: (route: string) => calls.get(route) ?? 0, disconnect: () => { edge.disconnect(); },
    /** The core records the next enable and answers only when released, so the worker's answer is uncertain at its deadline. */
    hangEnables: () => { hang = new Promise(resolve => { release = resolve; }); },
    releaseEnables: () => { release(); hang = undefined; },
    /** The edge takes calls of this route and never answers them. */
    silence: (route: string) => { silent.add(route); },
    probe: (endpoint: string) => companions.request(`bunny.cmd.coding-work.${endpoint}`, {type: 'org.bunny.coding.work.requested', subject: endpoint, dataschema: 'https://bunny.invalid/events/coding-work/2.0',
      data: {requestId: `probe-${String(controls.length)}`, operationId: 'op-none', action: 'cancel'}}, {timeoutMs: 3000}),
  };
}

/** The worker's private configuration and token files, outside every checkout, as the guide says to write them. */
async function privateConfiguration(context: TestContext, url: string, token: string): Promise<string> {
  const dir = await stateDir(context), tokenFile = join(dir, 'coding-worker.token'), file = join(dir, 'coding-worker.json');
  await writeFile(tokenFile, `${token}\n`, {mode: 0o600});
  await chmod(tokenFile, 0o600);
  await writeFile(file, JSON.stringify({schema: 'coding-worker/1.0', edge: url, tokenFile, repositories: [{name: 'agent-device-hub', path: dir}], claude: {executable: '/nonexistent/claude', permissionMode: 'acceptEdits'}}), {mode: 0o600});
  await chmod(file, 0o600);
  return file;
}

/** One invocation of the real entry point, as the supervisor runs it. It is killed after the test if it is still running. */
function invoke(context: TestContext, configuration: string): Worker {
  const child = spawn(process.execPath, [BIN, configuration], {stdio: ['ignore', 'ignore', 'pipe'], env: {PATH: process.env.PATH}});
  const exited = once(child, 'exit').then(([code, signal]) => ({code: code as number | null, signal: signal as NodeJS.Signals | null}));
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  return {child, exited, stderr: () => stderr};
}

/** Waits for the process to exit within the bound. A process still running at the bound is killed and fails the test. */
async function exitOf(worker: Worker, boundMs: number): Promise<Exit> {
  const exit = await Promise.race([worker.exited, delay(boundMs, 'running' as const, {ref: false})]);
  if (exit !== 'running') return exit;
  worker.child.kill('SIGKILL');
  await worker.exited;
  return assert.fail(`the worker was still running after ${String(boundMs)} ms; its log: ${worker.stderr()}`);
}

/** Waits until the worker has declared, and for its entry point to pass `start()` and take its signal handlers. */
async function declared(worker: Worker): Promise<string> {
  await Promise.race([waitFor(() => /available as endpoint \S+/.test(worker.stderr()), EXIT_BOUND_MS, 'the declaration'),
    worker.exited.then(exit => assert.fail(`the worker exited before it declared: ${JSON.stringify(exit)} ${worker.stderr()}`))]);
  await delay(100);
  return /available as endpoint (\S+)/.exec(worker.stderr())?.[1] ?? assert.fail('the endpoint is named');
}

void test('a second worker is refused, ends non-zero with its connection closed and leaves the declared worker alone; a fresh one declares after the old owner stops', {timeout: 60_000}, async context => {
  const world = await fakeEdge(context), configuration = await privateConfiguration(context, world.url, world.token);
  const owner = invoke(context, configuration), holder = await declared(owner);
  assert.equal(world.selected(), holder);

  // All refused: each fresh process is refused once, closes what it opened and ends. None stays connected and idle.
  for (const attempt of [1, 2, 3]) {
    const before = world.controls.length;
    const second = invoke(context, configuration);
    assert.deepEqual(await exitOf(second, EXIT_BOUND_MS), {code: 1, signal: null}, second.stderr());
    const sent = world.controls.slice(before);
    assert.equal(sent.length, 1, 'one enable and no application-level resend');
    assert.equal(sent[0]?.action, 'enable');
    // The refusal's own code and the command's trace reach the log; its detail stays out of it, and so does the credential.
    assert.match(second.stderr(), new RegExp(`^coding-worker-enable-refused: invalid-state trace ${sent[0]?.traceId ?? ''} request \\S+$`, 'm'));
    assert.ok(!second.stderr().includes(DETAIL) && !second.stderr().includes(world.token) && !second.stderr().includes(configuration), second.stderr());
    // The worker said it was done with the endpoint before it went, and only the owner's stream is left.
    assert.equal(world.calls('close'), attempt);
    await waitFor(() => world.streams() === 1, EXIT_BOUND_MS, 'the refused worker\'s stream to close');
    assert.deepEqual(world.lost, world.controls.filter(control => control.endpoint !== holder).map(control => control.endpoint), 'only the refused endpoints were closed');
    assert.equal(world.selected(), holder);
  }

  // The declared worker still holds its endpoint and answers on it.
  assert.equal(owner.child.exitCode, null);
  const answer = await world.probe(holder);
  assert.ok(answer.status === 'rejected' && answer.error.error.code === 'not-found', JSON.stringify(answer));

  // The old owner stops first and releases the endpoint; only then can a fresh process take it.
  owner.child.kill('SIGTERM');
  assert.deepEqual(await exitOf(owner, EXIT_BOUND_MS), {code: 0, signal: null}, owner.stderr());
  assert.equal(world.controls.filter(control => control.action === 'disable').length, 1);
  assert.equal(world.selected(), null);
  await waitFor(() => world.streams() === 0, EXIT_BOUND_MS, 'the old owner\'s stream to close');

  const fresh = invoke(context, configuration), endpoint = await declared(fresh);
  assert.equal(world.selected(), endpoint);
  assert.notEqual(endpoint, holder);
  assert.equal(world.streams(), 1);
  assert.equal(fresh.child.exitCode, null);
  fresh.child.kill('SIGTERM');
  assert.deepEqual(await exitOf(fresh, EXIT_BOUND_MS), {code: 0, signal: null}, fresh.stderr());
});

void test('an enable with no answer is uncertain, not refused: with the edge silent too the worker still ends non-zero, and the core\'s possible selection is released for a fresh one', {timeout: 60_000}, async context => {
  const world = await fakeEdge(context), configuration = await privateConfiguration(context, world.url, world.token);
  world.hangEnables();
  world.silence('close');
  const worker = invoke(context, configuration);
  await waitFor(() => world.selected() !== null, EXIT_BOUND_MS, 'the core to record the enable');
  assert.deepEqual(await exitOf(worker, SILENT_EXIT_BOUND_MS), {code: 1, signal: null}, worker.stderr());
  // The core may have acted on it, so the log says uncertain with the code that says so, in the command's own trace.
  assert.match(worker.stderr(), new RegExp(`^coding-worker-enable-uncertain: uncertain-result trace ${world.controls[0]?.traceId ?? ''} request \\S+$`, 'm'));
  assert.ok(!/enable-refused/.test(worker.stderr()), worker.stderr());
  assert.equal(world.controls.length, 1, 'one enable and no resend');
  // With no answer to the close either, the stream's end is what tells the edge, and the edge what tells the core.
  await waitFor(() => world.streams() === 0 && world.selected() === null, EXIT_BOUND_MS, 'the stream to close and the selection to be released');

  world.releaseEnables();
  const fresh = invoke(context, configuration), endpoint = await declared(fresh);
  assert.equal(world.selected(), endpoint);
  fresh.child.kill('SIGTERM');
  // The silenced close route leaves this worker's own close to its bound as well, which the bound above allows.
  assert.deepEqual(await exitOf(fresh, SILENT_EXIT_BOUND_MS), {code: 0, signal: null}, fresh.stderr());
});

void test('a stream lost during the first enable is uncertain and ends the process rather than reconnecting', {timeout: 60_000}, async context => {
  const world = await fakeEdge(context), configuration = await privateConfiguration(context, world.url, world.token);
  world.hangEnables();
  const worker = invoke(context, configuration);
  await waitFor(() => world.selected() !== null, EXIT_BOUND_MS, 'the core to record the enable');
  world.disconnect();
  assert.deepEqual(await exitOf(worker, EXIT_BOUND_MS), {code: 1, signal: null}, worker.stderr());
  assert.match(worker.stderr(), /^coding-worker-enable-uncertain: uncertain-result /m);
  assert.equal(world.selected(), null, 'the edge reported the lost endpoint');
  assert.equal(world.calls('stream'), 1, 'no second stream');
  assert.equal(world.controls.length, 1, 'one enable and no resend');
});

void test('an endpoint the edge will not register ends the process non-zero with the refusal\'s code, sending no enable', {timeout: 60_000}, async context => {
  for (const grant of [{calls: [], keys: [], publishes: []}, {...WORKER_GRANT, endpoint: {respond: ['coding-progress'], publish: ['coding-progress'], request: ['coding-endpoint']}}] satisfies EdgePermissions[]) {
    const world = await fakeEdge(context, grant), configuration = await privateConfiguration(context, world.url, world.token);
    const worker = invoke(context, configuration);
    assert.deepEqual(await exitOf(worker, EXIT_BOUND_MS), {code: 1, signal: null}, worker.stderr());
    assert.match(worker.stderr(), /^coding-worker-endpoint-refused: forbidden$/m);
    // The worker's own closed handler runs while the registration fails, and must not be reported as a fault.
    assert.ok(!worker.stderr().includes('Warning'), worker.stderr());
    assert.equal(world.controls.length, 0);
    await waitFor(() => world.streams() === 0, EXIT_BOUND_MS, 'the stream to close');
  }
});

void test('a worker that cannot reach the core at start ends non-zero as before, and a wrong credential the same way', {timeout: 60_000}, async context => {
  const away = createServer();
  away.listen(0, '127.0.0.1');
  await once(away, 'listening');
  const port = (away.address() as AddressInfo).port;
  away.close();
  await once(away, 'close');
  const world = await fakeEdge(context);
  for (const configuration of [await privateConfiguration(context, `http://127.0.0.1:${String(port)}`, world.token), await privateConfiguration(context, world.url, randomBytes(32).toString('base64url'))]) {
    const worker = invoke(context, configuration);
    assert.deepEqual(await exitOf(worker, EXIT_BOUND_MS), {code: 1, signal: null}, worker.stderr());
    assert.match(worker.stderr(), /^coding-worker failed: SdkError$/m);
    assert.equal(world.controls.length, 0);
    // The edge's refused stream may finish its own close a moment after the worker has gone.
    await waitFor(() => world.streams() === 0, EXIT_BOUND_MS, 'the refused stream to close');
  }
});
