// The host-local coding worker (Hub #502) over a fake harness and a fake edge connection: it runs one task at a time in
// a fresh worktree of an allowlisted repository, reports the git facts it observed and the harness's structured result,
// and stops the harness on cancel. No real `claude`, edge or network.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import type {CodingProgress, CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import type {Command, Reply} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {RemoteEndpoint, RemoteEndpointOptions, RemoteParticipant, connectRemote} from '@jimmie-potts/sdk/remote';
import {CodingWorker, DEFAULT_ALLOWED_TOOLS, DENIED_TOOLS, assembleResult, parseConfiguration, type Harness} from '../src/worker/coding-worker.js';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example'}}).trim();
const configuration = (repository: string) => ({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: repository}],
  claude: {executable: '/opt/homebrew/bin/claude', permissionMode: 'acceptEdits', allowedTools: DEFAULT_ALLOWED_TOOLS}});
const command = (data: CodingWork, source = 'bunny/modules/companions'): Command<CodingWork> => ({specversion: '1.0', bunnyprofile: '2.0', id: `cmd-${data.requestId}`, source, kind: 'command',
  type: 'org.bunny.coding.work.requested', subject: 'worker-endpoint-1', time: new Date().toISOString(), datacontenttype: 'application/json', dataschema: 'https://bunny.invalid/events/coding-work/2.0',
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', expiresat: new Date(Date.now() + 5000).toISOString(), data});
async function until(check: () => boolean, seen: () => unknown = () => undefined): Promise<void> {
  for (let i = 0; i < 400; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.ok(check(), `expected progress arrived; seen ${JSON.stringify(seen())}`);
}
async function repository(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'coding-worker-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bare = join(root, 'origin.git'), work = join(root, 'repo');
  execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', bare]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  await writeFile(join(work, 'README.md'), 'hello\n');
  git(work, 'add', '.'); git(work, 'commit', '--quiet', '-m', 'first'); git(work, 'remote', 'add', 'origin', bare); git(work, 'push', '--quiet', 'origin', 'main');
  return work;
}
function fakeEdge() {
  const requests: {family: string; data: unknown}[] = [], progress: CodingProgress[] = [];
  let responder: ((command: Command<CodingWork>) => Reply) | undefined, closed = 0, opened = 0, refuse = 0, onClosed: (() => void) | undefined, onDiagnostic: ((diagnostic: {event: string}) => void) | undefined;
  const endpoint: RemoteEndpoint = {id: 'worker-endpoint-1', close: () => {closed += 1; return Promise.resolve();},
    publish: (family, draft) => {progress.push(draft.data as CodingProgress); return Promise.resolve({} as never);},
    request: (family, draft) => {
      requests.push({family, data: draft.data});
      if (refuse > 0) {refuse -= 1; return Promise.resolve({status: 'rejected', requestId: 'r', error: errorBody('invalid-state')} as never);}
      return Promise.resolve({status: 'accepted', requestId: 'r', reply: {} as never});
    }};
  const participant = {openEndpoint: <T extends object>(options: RemoteEndpointOptions<T>) => {
    opened += 1; responder = options.respond as unknown as (command: Command<CodingWork>) => Reply; onClosed = options.onClosed; return Promise.resolve({...endpoint, id: `worker-endpoint-${String(opened)}`});
  }, close: () => Promise.resolve()} as unknown as RemoteParticipant;
  const connect = (options: {onDiagnostic?: (diagnostic: {event: string}) => void}) => {onDiagnostic = options.onDiagnostic; return Promise.resolve(participant);};
  return {connect: connect as unknown as typeof connectRemote, requests, progress, respond: (given: Command<CodingWork>) => (responder ?? assert.fail('endpoint opened'))(given), closed: () => closed, opened: () => opened,
    refuseNextEnable: () => {refuse += 1;},
    // The stream is lost: the SDK closes the connection-bound endpoint, reconnects and reports it.
    lose: () => {onClosed?.(); onDiagnostic?.({event: 'remote.disconnected'}); onDiagnostic?.({event: 'remote.reconnected'});}};
}

void test('the configuration names an origin, a token file, allowlisted repositories and a bounded harness', () => {
  const good = parseConfiguration(configuration('/tmp/repo'));
  assert.equal(good.edge, 'http://127.0.0.1:18788'); assert.deepEqual(good.repositories, [{name: 'agent-device-hub', path: '/tmp/repo'}]); assert.equal(good.claude.permissionMode, 'acceptEdits');
  for (const [changed, reason] of [[{schema: 'other'}, /not a coding-worker/], [{edge: 'http://127.0.0.1:18788/path'}, /origin/], [{tokenFile: 'relative'}, /absolute/],
    [{repositories: []}, /one to sixteen/], [{repositories: [{name: 'Bad Name', path: '/tmp/x'}]}, /distinct lowercase name/], [{claude: {executable: 'claude'}}, /absolute path/],
    [{claude: {executable: '/x/claude', permissionMode: 'bypassPermissions'}}, /permissionMode/], [{claude: {executable: '/x/claude', allowedTools: ['Bash(git push*)']}}, /without push/],
    [{claude: {executable: '/x/claude', maxTurns: 0}}, /maxTurns/], [{extra: true}, /unknown member/]] as const) {
    assert.throws(() => parseConfiguration({...configuration('/tmp/repo'), ...changed}), reason);
  }
});

void test('a result is assembled from the harness envelope and the observed git facts, with unknowns kept unknown', () => {
  const envelope = JSON.stringify({type: 'result', result: 'done', session_id: 'session-1', num_turns: 4, total_cost_usd: 0.12, duration_ms: 3000,
    structured_output: {outcome: 'tested-candidate', summary: 'Added the test.', checks: [{name: 'node --test', status: 'passed'}, {name: 'bad', status: 'green'}], findings: ['one'], limitations: []}});
  const {result} = assembleResult('agent-device-hub', 'a'.repeat(40), 'b'.repeat(40), ['x.ts'], envelope);
  assert.equal(result.outcome, 'tested-candidate'); assert.equal(result.summary, 'Added the test.'); assert.deepEqual(result.checks, [{name: 'node --test', status: 'passed'}]);
  assert.deepEqual(result.findings, ['one']); assert.equal(result.sessionId, 'session-1'); assert.deepEqual(result.usage, {turns: 4, costUsd: 0.12, durationMs: 3000});
  const plain = assembleResult('agent-device-hub', null, null, [], 'not json');
  assert.equal(plain.result.outcome, 'incomplete'); assert.equal(plain.result.usage, null); assert.match(plain.result.limitations[0] ?? '', /No structured result/);
  const failed = assembleResult('agent-device-hub', null, null, [], JSON.stringify({result: 'x'}), 'timeout');
  assert.equal(failed.result.outcome, 'failed'); assert.equal(failed.reason, 'timeout'); assert.deepEqual(failed.result.usage, {turns: null, costUsd: null, durationMs: null});
  const budget = assembleResult('agent-device-hub', null, null, [], JSON.stringify({type: 'result', subtype: 'error_max_budget_usd', result: 'stopped', num_turns: 9, total_cost_usd: 5, duration_ms: 100}));
  assert.equal(budget.result.outcome, 'failed'); assert.equal(budget.reason, 'budget'); assert.equal(budget.result.usage?.costUsd, 5);
});

void test('the worker declares its endpoint, runs one task in a fresh worktree, reports started then completed with the observed changes, and refuses a second task meanwhile', async t => {
  const repo = await repository(t), edge = fakeEdge();
  const harness: Harness = {start: async (args, cwd, input) => {
    // The brief is the harness's input, never an argument; the deny list, strict MCP and project-only settings always travel; the turn cap is the lower of the two.
    assert.equal(args[0], '--print'); assert.ok(!args.includes('Write a file.')); assert.equal(input, 'Write a file.');
    assert.ok(args.includes('--output-format') && args.includes('--max-budget-usd') && args.includes('acceptEdits') && args.includes('--strict-mcp-config'));
    assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2), ['--setting-sources', 'project']);
    assert.deepEqual(args.slice(args.indexOf('--max-turns'), args.indexOf('--max-turns') + 2), ['--max-turns', '5']);
    for (const denied of DENIED_TOOLS) assert.ok(args.indexOf(denied) > args.indexOf('--disallowedTools'), denied);
    assert.match(cwd, /\.local\/worktrees\/bunny-task-[12]-/);
    await writeFile(join(cwd, 'new-file.txt'), 'made by the harness\n');
    return {code: 0, signal: null, stdout: JSON.stringify({type: 'result', session_id: 'session-9', num_turns: 2, total_cost_usd: 0.05, duration_ms: 10,
      structured_output: {outcome: 'tested-candidate', summary: 'Wrote the file.', checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: []}}), truncated: false};
  }};
  const config = configuration(repo);
  const worker = new CodingWorker(parseConfiguration({...config, claude: {...config.claude, maxTurns: 200}}), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect);
  await worker.start();
  assert.deepEqual(edge.requests.map(request => request.family), ['coding-endpoint']);
  const start: CodingWork = {requestId: 'op-1', operationId: 'op-1', action: 'start', taskId: 'task-1', repository: 'agent-device-hub', brief: 'Write a file.', bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}};
  assert.deepEqual(edge.respond(command(start, 'bunny/parts/other')), {error: {code: 'forbidden', retryable: false}});
  const other = edge.respond(command({...start, requestId: 'op-x', operationId: 'op-x', repository: 'not-allowed'})); assert.ok('error' in other && other.error.code === 'invalid-request');
  assert.deepEqual(edge.respond(command(start)), {status: 'accepted'});
  const busy = edge.respond(command({...start, requestId: 'op-2', operationId: 'op-2'})); assert.ok('error' in busy && busy.error.code === 'capacity');
  await until(() => edge.progress.length === 2);
  assert.equal(edge.progress[0]?.status, 'started');
  const done = edge.progress[1]; assert.ok(done?.status === 'completed');
  assert.equal(done.result.outcome, 'tested-candidate'); assert.equal(done.result.base, git(repo, 'rev-parse', 'origin/main')); assert.equal(done.result.head, done.result.base);
  assert.deepEqual(done.result.changedFiles, ['new-file.txt']); assert.equal(done.result.sessionId, 'session-9'); assert.equal(done.result.usage?.turns, 2);
  assert.deepEqual(edge.respond(command({...start, requestId: 'op-3', operationId: 'op-3', taskId: 'task-2'})), {status: 'accepted'});
  await until(() => edge.progress.length === 4);
  // A lost stream closes the endpoint; once the SDK reconnects, the worker declares a fresh endpoint and enables it again.
  edge.lose(); await until(() => edge.requests.length === 2);
  assert.equal(edge.opened(), 2); assert.deepEqual(edge.requests.map(request => (request.data as {action: string}).action), ['enable', 'enable']);
  // A declaration the core refuses (it may still name the old endpoint) is closed and tried again after a short wait, so the worker never sits undeclared.
  edge.refuseNextEnable(); edge.lose(); await until(() => edge.requests.length === 4);
  assert.equal(edge.opened(), 4); assert.equal(edge.closed(), 1, 'the refused endpoint was closed');
  await worker.stop(); assert.equal(edge.closed(), 2);
});

void test('a cancel stops the running harness and the worker reports cancelled; an exit code reports failed with the facts it has', async t => {
  const repo = await repository(t), edge = fakeEdge();
  let release: ((value: {code: number | null; signal: string | null; stdout: string; truncated: boolean}) => void) | undefined, started = 0;
  const harness: Harness = {start: (_args, _cwd, _input, onChild) => new Promise(resolvePromise => {
    release = resolvePromise; started += 1;
    onChild({kill: () => {resolvePromise({code: null, signal: 'SIGTERM', stdout: '', truncated: false}); return true;}} as never);
  })};
  const logs: string[] = [];
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, line => {logs.push(line);}, edge.connect);
  await worker.start();
  const start: CodingWork = {requestId: 'op-1', operationId: 'op-1', action: 'start', taskId: 'task-1', repository: 'agent-device-hub', brief: 'Wait.', bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}};
  // Wait for the harness itself to be running, so the cancel exercises the kill path rather than the pre-start check.
  assert.deepEqual(edge.respond(command(start)), {status: 'accepted'}); await until(() => edge.progress.length === 1 && started === 1, () => ({progress: edge.progress.map(p => p.status), started, logs}));
  const missing = edge.respond(command({requestId: 'c-0', operationId: 'op-9', action: 'cancel'})); assert.ok('error' in missing && missing.error.code === 'not-found');
  assert.deepEqual(edge.respond(command({requestId: 'c-1', operationId: 'op-1', action: 'cancel'})), {status: 'accepted'});
  await until(() => edge.progress.length === 2);
  assert.equal(edge.progress[1]?.status, 'cancelled');
  assert.deepEqual(edge.respond(command({...start, requestId: 'op-2', operationId: 'op-2'})), {status: 'accepted'}); await until(() => edge.progress.length === 3 && started === 2, () => ({progress: edge.progress.map(p => p.status), started, logs}));
  release?.({code: 2, signal: null, stdout: JSON.stringify({result: 'crashed'}), truncated: false});
  await until(() => edge.progress.length === 4);
  const failed = edge.progress[3]; assert.ok(failed?.status === 'failed'); assert.equal(failed.reason, 'exit'); assert.equal(failed.result?.outcome, 'failed');
  await worker.stop();
});
