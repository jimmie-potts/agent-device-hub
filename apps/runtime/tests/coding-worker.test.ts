// The host-local coding worker (Hub #502) over a fake harness and a fake edge connection: it runs one task at a time in
// a fresh worktree of an allowlisted repository, reports the git facts it observed and the harness's structured result,
// and stops the harness on cancel. No real `claude`, edge or network.
import assert from 'node:assert/strict';
import {execFile, execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {test, type TestContext} from 'node:test';
import {promisify} from 'node:util';
import type {CodingAttemptContext, CodingNativeClient, CodingProgress, CodingWork, CodingWorkerProgress} from '@jimmie-potts/event-contracts/v2/coding';
import type {Command, Reply} from '@jimmie-potts/sdk';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {RemoteEndpoint, RemoteEndpointOptions, RemoteParticipant, connectRemote} from '@jimmie-potts/sdk/remote';
import type {CodingAdapter} from '../src/worker/adapter.js';
import {CodingWorker, DEFAULT_ALLOWED_TOOLS, DENIED_TOOLS, STOPPED_RUN_MS, assembleResult, parseConfiguration, type GitRunner, type Harness, type ProbeTimer} from '../src/worker/coding-worker.js';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example'}}).trim();
const configuration = (repository: string) => ({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: repository}],
  // No real `claude`: a worker started without a fake harness probes this path for readiness and finds nothing (Hub #1743).
  claude: {executable: '/nonexistent/claude', permissionMode: 'acceptEdits', allowedTools: DEFAULT_ALLOWED_TOOLS}});
const command = (data: CodingWork, source = 'bunny/modules/companions'): Command<CodingWork> => ({specversion: '1.0', bunnyprofile: '2.0', id: `cmd-${data.requestId}`, source, kind: 'command',
  type: 'org.bunny.coding.work.requested', subject: 'worker-endpoint-1', time: new Date().toISOString(), datacontenttype: 'application/json',
  dataschema: `https://bunny.invalid/events/coding-work/${'continuation' in data ? '2.3' : 'harness' in data ? '2.2' : 'companion' in data ? '2.1' : '2.0'}`,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', expiresat: new Date(Date.now() + 5000).toISOString(), data});
async function until(check: () => boolean, seen: () => unknown = () => undefined): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  assert.ok(check(), `expected progress arrived; seen ${JSON.stringify(seen())}`);
}
async function repository(t: TestContext, temporary = tmpdir()): Promise<string> {
  const root = await mkdtemp(join(temporary, 'coding-worker-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bare = join(root, 'origin.git'), work = join(root, 'repo');
  execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', bare]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  await writeFile(join(work, 'README.md'), 'hello\n');
  git(work, 'add', '.'); git(work, 'commit', '--quiet', '-m', 'first'); git(work, 'remote', 'add', 'origin', bare); git(work, 'push', '--quiet', 'origin', 'main');
  return work;
}
function fakeEdge() {
  const requests: {family: string; data: unknown; dataschema?: string}[] = [], progress: CodingProgress[] = [];
  const contexts: CodingAttemptContext[] = [], nativeClients: CodingNativeClient[] = [];
  // Which endpoint each report went out on, so a run's report after its endpoint closed is seen to go nowhere.
  const reportedOn: string[] = [];
  let responder: ((command: Command<CodingWork>) => Reply) | undefined, closed = 0, opened = 0, refuse = 0, disconnected = 0, onClosed: (() => void) | undefined, onDiagnostic: ((diagnostic: {event: string}) => void) | undefined;
  let held: Promise<void> | undefined, releaseClose = (): void => {}, current = '';
  const endpoint: RemoteEndpoint = {id: 'worker-endpoint-1', close: () => {closed += 1; const closing = held ?? Promise.resolve(); held = undefined; return closing;},
    publish: (_family, draft) => {
      const report = draft.data as CodingWorkerProgress;
      if (report.status === 'attempt-context') contexts.push(report);
      else if (report.status === 'native-client') nativeClients.push(report);
      else if (report.status !== 'message-observed') {
        progress.push(report);
        reportedOn.push(current);
      }
      return Promise.resolve({} as never);
    },
    request: (family, draft) => {
      requests.push({family, data: draft.data, dataschema: draft.dataschema});
      if (refuse > 0) {refuse -= 1; return Promise.resolve({status: 'rejected', requestId: 'r', error: errorBody('invalid-state')} as never);}
      return Promise.resolve({status: 'accepted', requestId: 'r', reply: {} as never});
    }};
  const participant = {openEndpoint: <T extends object>(options: RemoteEndpointOptions<T>) => {
    opened += 1; responder = options.respond as unknown as (command: Command<CodingWork>) => Reply; onClosed = options.onClosed;
    const id = `worker-endpoint-${String(opened)}`;
    return Promise.resolve({...endpoint, id, publish: (family: string, draft: {data: unknown}) => {current = id; return endpoint.publish(family, draft as never);}});
  }, close: () => {disconnected += 1; return Promise.resolve();}} as unknown as RemoteParticipant;
  const connect = (options: {onDiagnostic?: (diagnostic: {event: string}) => void}) => {onDiagnostic = options.onDiagnostic; return Promise.resolve(participant);};
  return {connect: connect as unknown as typeof connectRemote, requests, progress, contexts, nativeClients, reportedOn, respond: (given: Command<CodingWork>) => (responder ?? assert.fail('endpoint opened'))(given), closed: () => closed, opened: () => opened, disconnected: () => disconnected,
    refuseNextEnable: () => {refuse += 1;},
    // The next endpoint close waits until released, as one that waits for the edge's answer does.
    holdNextClose: () => {held = new Promise(resolve => {releaseClose = resolve;});}, releaseClose: () => {releaseClose();},
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
  const failed = assembleResult('agent-device-hub', null, null, [], JSON.stringify({type: 'result', result: 'x'}), 'timeout');
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
    await writeFile(join(cwd, 'README.md'), 'hello\nchanged by the harness\n');
    // The real tool's first event names its credential source; without one the worker stops the run (Hub #1743).
    return {code: 0, signal: null, stdout: `${JSON.stringify({type: 'system', subtype: 'init', apiKeySource: 'none'})}\n` + JSON.stringify({type: 'result', session_id: 'session-9', num_turns: 2, total_cost_usd: 0.05, duration_ms: 10,
      structured_output: {outcome: 'tested-candidate', summary: 'Wrote the file.', checks: [{name: 'node --test', status: 'passed'}], findings: [], limitations: []}}), truncated: false};
  }};
  const config = configuration(repo);
  const worker = new CodingWorker(parseConfiguration({...config, claude: {...config.claude, maxTurns: 200}}), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect);
  await worker.start();
  assert.deepEqual(edge.requests.map(request => request.family), ['coding-endpoint']);
  const start: CodingWork = {requestId: 'op-1', operationId: 'op-1', action: 'start', taskId: 'task-1', repository: 'agent-device-hub', brief: 'Write a file.', bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}};
  assert.deepEqual(edge.respond(command(start, 'bunny/parts/other')), {error: {code: 'forbidden', retryable: false}});
  const other = edge.respond(command({...start, requestId: 'op-x', operationId: 'op-x', repository: 'not-allowed'})); assert.ok('error' in other && other.error.code === 'invalid-request');
  assert.deepEqual(edge.respond(command({...start, companion: 'bunny'})), {status: 'accepted'});
  const busy = edge.respond(command({...start, companion: 'bunny', requestId: 'op-2', operationId: 'op-2'})); assert.ok('error' in busy && busy.error.code === 'capacity');
  await until(() => edge.progress.length === 2);
  assert.equal(edge.progress[0]?.status, 'started');
  const done = edge.progress[1]; assert.ok(done?.status === 'completed');
  assert.equal(done.result.outcome, 'tested-candidate'); assert.equal(done.result.base, git(repo, 'rev-parse', 'origin/main')); assert.equal(done.result.head, done.result.base);
  // A modified tracked file's porcelain line starts with a space; the name keeps its first character (Hub #1360).
  assert.deepEqual(done.result.changedFiles, ['README.md', 'new-file.txt']); assert.equal(done.result.sessionId, 'session-9'); assert.equal(done.result.usage?.turns, 2);
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

// The process itself is coding-worker-process.test.ts (Hub #1384); this pins what start() leaves behind.
void test('a refused first declaration closes the endpoint and the connection, keeps its code, and a late reconnect declares nothing', async () => {
  const edge = fakeEdge();
  edge.refuseNextEnable();
  const worker = new CodingWorker(parseConfiguration(configuration('/tmp/repo')), 'token-'.padEnd(43, 'x'), undefined, () => {}, edge.connect);
  await assert.rejects(worker.start(), {message: 'coding-worker-enable-refused: invalid-state request r'});
  assert.equal(edge.closed(), 1); assert.equal(edge.disconnected(), 1);
  edge.lose(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(edge.opened(), 1); assert.equal(edge.requests.length, 1, 'no second enable');
});

void test('a reconnect while the refused first declaration is still closing declares nothing: the process sends one enable', async () => {
  const edge = fakeEdge();
  edge.refuseNextEnable(); edge.holdNextClose();
  const worker = new CodingWorker(parseConfiguration(configuration('/tmp/repo')), 'token-'.padEnd(43, 'x'), undefined, () => {}, edge.connect);
  const starting = worker.start();
  await until(() => edge.closed() === 1);
  // The stream drops on its own and comes back before start() has given up.
  edge.lose(); await new Promise(resolve => setTimeout(resolve, 20));
  edge.releaseClose();
  await assert.rejects(starting, {message: 'coding-worker-enable-refused: invalid-state request r'});
  assert.equal(edge.opened(), 1); assert.equal(edge.requests.length, 1, 'one enable');
  assert.equal(edge.disconnected(), 1);
});

void test('a refused re-declaration after a reconnect keeps the connection and tries again, unlike a refused first one', async () => {
  const edge = fakeEdge();
  const worker = new CodingWorker(parseConfiguration(configuration('/tmp/repo')), 'token-'.padEnd(43, 'x'), undefined, () => {}, edge.connect);
  await worker.start();
  assert.equal(edge.disconnected(), 0);
  edge.refuseNextEnable(); edge.lose(); await until(() => edge.requests.length === 3);
  assert.equal(edge.disconnected(), 0, 'a refused re-declaration keeps the connection');
  await worker.stop(); assert.equal(edge.disconnected(), 1);
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

// Hub #2028: one slot per companion, three at once. Runs on the same repository each get their own fresh worktree, a
// cancel or a lost endpoint stops only what it names, and the enable declares the slots.
void test('the worker declares three slots, runs one task per companion at once on the same repository, each in its own worktree, and refuses a fourth', async t => {
  const repo = await repository(t), edge = fakeEdge();
  const releases = new Map<string, () => void>(), cwds: string[] = [];
  const harness: Harness = {start: (_args, cwd, input, onChild) => new Promise(resolvePromise => {
    cwds.push(cwd);
    const finish = (code: number | null, signal: string | null) => {resolvePromise({code, signal, stdout: `${JSON.stringify({type: 'system', subtype: 'init', apiKeySource: 'none'})}\n${JSON.stringify({type: 'result', session_id: 'session-1', num_turns: 1,
      structured_output: {outcome: 'tested-candidate', summary: `Ran ${input}`, checks: [], findings: [], limitations: []}})}`, truncated: false});};
    releases.set(input, () => {finish(0, null);});
    onChild({kill: () => {finish(null, 'SIGTERM'); return true;}} as never);
  })};
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect);
  await worker.start();
  assert.equal(edge.requests[0]?.dataschema, 'https://bunny.invalid/events/coding-endpoint/2.2'); assert.equal((edge.requests[0]?.data as {slots?: number}).slots, 3);
  const start = (companion: 'bunny' | 'reachy' | 'microduck' | undefined, id: string): CodingWork => ({requestId: id, operationId: id, action: 'start', taskId: `task-${id}`, ...(companion === undefined ? {} : {companion}),
    repository: 'agent-device-hub', brief: id, bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}});
  for (const [companion, id] of [['bunny', 'op-b'], ['reachy', 'op-r'], ['microduck', 'op-m']] as const) assert.deepEqual(edge.respond(command(start(companion, id))), {status: 'accepted'});
  const fourth = edge.respond(command(start('bunny', 'op-b2'))); assert.ok('error' in fourth && fourth.error.code === 'capacity');
  const untagged = edge.respond(command(start(undefined, 'op-x'))); assert.ok('error' in untagged && untagged.error.code === 'capacity');
  await until(() => cwds.length === 3, () => ({cwds, progress: edge.progress}));
  assert.equal(new Set(cwds).size, 3, 'each run has its own worktree');
  for (const cwd of cwds) assert.match(cwd, /\.local\/worktrees\/bunny-task-op-/);
  // Cancelling Reachy's run stops that run alone; the others finish with their own results.
  assert.deepEqual(edge.respond(command({requestId: 'c-r', operationId: 'op-r', action: 'cancel'})), {status: 'accepted'});
  await until(() => edge.progress.some(entry => entry.operationId === 'op-r' && entry.status === 'cancelled'));
  // Reachy's slot is free again while the other two still run.
  assert.deepEqual(edge.respond(command(start('reachy', 'op-r2'))), {status: 'accepted'});
  await until(() => cwds.length === 4);
  for (const id of ['op-b', 'op-m', 'op-r2']) releases.get(id)?.();
  await until(() => ['op-b', 'op-m', 'op-r2'].every(id => edge.progress.some(entry => entry.operationId === id && entry.status === 'completed')), () => edge.progress);
  const summaries = edge.progress.flatMap(entry => entry.status === 'completed' ? [[entry.operationId, entry.result.summary]] : []);
  assert.deepEqual(summaries.sort(), [['op-b', 'Ran op-b'], ['op-m', 'Ran op-m'], ['op-r2', 'Ran op-r2']]);
  assert.equal(git(repo, 'worktree', 'list').split('\n').length, 5, 'four run worktrees beside the checkout');
  await worker.stop();
});

void test('a lost endpoint stops every run and frees their slots for the next endpoint; a stopped run reports nothing on the new one', async t => {
  const repo = await repository(t), edge = fakeEdge();
  let started = 0;
  const harness: Harness = {start: (_args, _cwd, _input, onChild) => new Promise(resolvePromise => {
    started += 1;
    onChild({kill: () => {resolvePromise({code: null, signal: 'SIGTERM', stdout: '', truncated: false}); return true;}} as never);
  })};
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect);
  await worker.start();
  const start = (companion: 'bunny' | 'reachy' | 'microduck', id: string): CodingWork => ({requestId: id, operationId: id, action: 'start', taskId: `task-${id}`, companion,
    repository: 'agent-device-hub', brief: id, bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}});
  for (const [companion, id] of [['bunny', 'op-1'], ['reachy', 'op-2'], ['microduck', 'op-3']] as const) edge.respond(command(start(companion, id)));
  await until(() => started === 3);
  edge.lose(); await until(() => edge.requests.length === 2);
  // The fresh endpoint is declared once the stopped runs have ended, so every slot is free on it.
  for (const [companion, id] of [['bunny', 'op-4'], ['reachy', 'op-5'], ['microduck', 'op-6']] as const) assert.deepEqual(edge.respond(command(start(companion, id))), {status: 'accepted'}, id);
  await until(() => started === 6);
  assert.deepEqual(edge.reportedOn.filter((endpoint, index) => endpoint === 'worker-endpoint-2' && ['op-1', 'op-2', 'op-3'].includes(edge.progress[index]?.operationId ?? '')), [],
    'a run started on the lost endpoint reports nothing on the new one');
  await worker.stop();
});

void test('a run whose endpoint closes after its last check and before its tool starts is stopped when the tool appears, and keeps its slot until it ends', async t => {
  const repo = await repository(t), edge = fakeEdge();
  let kills = 0, exit = (): void => {}, started = 0;
  // The endpoint closes inside the tool's start, after the run's own cancel check and before the tool exists.
  const harness: Harness = {start: (_args, _cwd, _input, onChild) => new Promise(resolvePromise => {
    started += 1;
    if (started === 1) edge.lose();
    exit = () => {resolvePromise({code: null, signal: 'SIGTERM', stdout: '', truncated: false});};
    onChild({kill: () => {kills += 1; return true;}} as never);
  })};
  // Git commands still running in the run's worktree, so the test sees that stop() waits for the run's own git steps.
  let inGit = 0;
  const runGit: GitRunner = async (cwd, args, options) => {
    inGit += 1;
    try {return await new Promise<string>((resolvePromise, reject) => {
      execFile('git', ['-C', cwd, ...args], {timeout: options?.timeoutMs ?? 60_000}, (error, stdout) => {if (error === null) resolvePromise(options?.trim === false ? stdout : stdout.trim()); else reject(new Error('git failed', {cause: error}));});
    });} finally {inGit -= 1;}
  };
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect, Date.now, runGit);
  await worker.start();
  const start = (id: string): CodingWork => ({requestId: id, operationId: id, action: 'start', taskId: `task-${id}`, companion: 'bunny', repository: 'agent-device-hub', brief: id,
    bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}});
  assert.deepEqual(edge.respond(command(start('op-1'))), {status: 'accepted'});
  await until(() => started === 1, () => ({started, kills}));
  // The tool is stopped as it appears, not by a later timer.
  assert.ok(kills > 0, 'the tool that started after the close was stopped at once');
  // While the stopped tool still lives, no fresh endpoint is declared, so no second B.U.N.N.Y. start can reach the worker.
  for (let turn = 0; turn < 20; turn += 1) await new Promise(resolve => {setImmediate(resolve);});
  assert.equal(edge.requests.length, 1, 'no fresh declaration while the stopped run lives');
  const second = edge.respond(command(start('op-2'))); assert.ok('error' in second && second.error.code === 'capacity', 'the companion\'s slot is still held');
  exit();
  await until(() => edge.requests.length === 2, () => edge.requests);
  assert.deepEqual(edge.respond(command(start('op-3'))), {status: 'accepted'}, 'the slot is free once the run ended');
  await until(() => started === 2);
  // The released run goes on to its own git steps; stopping the worker waits for them, so nothing writes in the
  // repository when the test removes it.
  exit(); await worker.stop();
  assert.equal(inGit, 0, 'no git command is still running after stop()');
});

void test('runs on the same repository take turns at the git setup, each into its own worktree', async t => {
  const repo = await repository(t), edge = fakeEdge();
  let inSetup = 0, most = 0;
  const setup = new Set(['fetch', 'rev-parse', 'worktree']);
  // Each setup step on the shared checkout yields a few event-loop turns, so overlapping setups would be seen.
  const runGit: GitRunner = async (cwd, args, options) => {
    const shared = cwd === repo && setup.has(args[0] ?? '');
    if (shared) {inSetup += 1; most = Math.max(most, inSetup); for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => {setImmediate(resolve);});}
    try {return await new Promise<string>((resolvePromise, reject) => {
      execFile('git', ['-C', cwd, ...args], {timeout: options?.timeoutMs ?? 60_000}, (error, stdout) => {if (error === null) resolvePromise(options?.trim === false ? stdout : stdout.trim()); else reject(new Error('git failed', {cause: error}));});
    });} finally {if (shared) inSetup -= 1;}
  };
  const cwds: string[] = [];
  const harness: Harness = {start: (_args, cwd) => {cwds.push(cwd); return Promise.resolve({code: 0, signal: null, stdout: '', truncated: false});}};
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect, Date.now, runGit);
  await worker.start();
  for (const [companion, id] of [['bunny', 'op-b'], ['reachy', 'op-r'], ['microduck', 'op-m']] as const) {
    assert.deepEqual(edge.respond(command({requestId: id, operationId: id, action: 'start', taskId: `task-${id}`, companion, repository: 'agent-device-hub', brief: id,
      bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}})), {status: 'accepted'});
  }
  await until(() => cwds.length === 3, () => ({cwds, progress: edge.progress}));
  assert.equal(most, 1, 'one setup step at a time on the shared checkout');
  assert.equal(new Set(cwds).size, 3);
  await until(() => edge.progress.filter(entry => entry.status !== 'started').length === 3);
  await worker.stop();
});

void test('a stopped run whose tool never lets go keeps only its companion\'s slot: after a bound the worker declares again for the others', async t => {
  const repo = await repository(t), edge = fakeEdge();
  // A leftover process holds the tool's output open, so its run never ends until the test lets it.
  const exits = new Map<string, () => void>(), started: string[] = [];
  const harness: Harness = {start: (_args, _cwd, input, onChild) => new Promise(resolvePromise => {
    started.push(input);
    exits.set(input, () => {resolvePromise({code: null, signal: 'SIGKILL', stdout: '', truncated: false});});
    onChild({kill: () => true} as never);
  })};
  // The stopped-run bound is a timer the test fires itself; no real time passes.
  const bounds: {ms: number; fire: () => void}[] = [];
  const timer: ProbeTimer = (ms, fire) => {const entry = {ms, fire}; bounds.push(entry); return () => {bounds.splice(bounds.indexOf(entry), 1);};};
  const logs: string[] = [];
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'token-'.padEnd(43, 'x'), harness, line => {logs.push(line);}, edge.connect, Date.now, undefined, timer);
  await worker.start();
  const start = (companion: 'bunny' | 'reachy' | 'microduck', id: string): CodingWork => ({requestId: id, operationId: id, action: 'start', taskId: `task-${id}`, companion, repository: 'agent-device-hub', brief: id,
    bounds: {wallClockMs: 60000, maxTurns: 5, budgetUsd: 1}});
  assert.deepEqual(edge.respond(command(start('bunny', 'op-held'))), {status: 'accepted'});
  await until(() => started.length === 1);
  edge.lose();
  await until(() => bounds.some(entry => entry.ms === STOPPED_RUN_MS));
  assert.equal(edge.requests.length, 1, 'not declared while the stopped run may still end');
  bounds.find(entry => entry.ms === STOPPED_RUN_MS)?.fire();
  await until(() => edge.requests.length === 2, () => edge.requests);
  assert.ok(logs.some(line => line.includes('stopped run op-held has not ended')));
  // The held companion stays refused; the other two take their starts on the fresh endpoint.
  const held = edge.respond(command(start('bunny', 'op-b2'))); assert.ok('error' in held && held.error.code === 'capacity', 'B.U.N.N.Y.\'s slot is still held');
  assert.deepEqual(edge.respond(command(start('reachy', 'op-r'))), {status: 'accepted'});
  assert.deepEqual(edge.respond(command(start('microduck', 'op-m'))), {status: 'accepted'});
  await until(() => started.length === 3);
  // Once the held run ends, its companion's slot is free again.
  exits.get('op-held')?.();
  await until(() => !('error' in edge.respond(command(start('bunny', 'op-b3'))) && true));
  await until(() => started.length === 4);
  for (const id of ['op-r', 'op-m', 'op-b3']) exits.get(id)?.();
  await until(() => edge.progress.filter(entry => entry.status !== 'started' && ['op-r', 'op-m', 'op-b3'].includes(entry.operationId)).length === 3);
  await worker.stop();
});

void test('the connection-bound worker sends exact Git evidence and early session identities for registered adapters', async t => {
  const repo = await repository(t), edge = fakeEdge();
  const sha = git(repo, 'rev-parse', 'HEAD');
  const invocations: {id: string; brief: string}[] = [];
  const adapter = (id: string): CodingAdapter => ({
    id, capabilities: {resume: 'unsupported', steering: 'unsupported', review: true},
    readiness: () => Promise.resolve({installed: 'yes', version: '1.0.0', signedIn: 'yes', plan: 'test-plan'}),
    async run({worktree, brief, bounds, session}) {
      invocations.push({id, brief});
      assert.notEqual(worktree, repo);
      assert.ok(worktree.startsWith(join(repo, '.local', 'worktrees')));
      assert.equal(git(worktree, 'rev-parse', 'HEAD'), sha);
      assert.equal(bounds.wallClockMs, 120_000);
      await session(`${id}-native`);
      await session('unexpected-second-identity');
      await writeFile(join(worktree, 'review.txt'), 'Synthetic review facts');
      return {sessionId: 'unexpected-third-identity', structured: {outcome: 'tested-candidate', summary: 'Reviewed the supplied revision.',
        checks: [{name: 'git status', status: 'passed', ...(id === 'codex' ? {detail: null} : {})},
          {name: 'git diff', status: 'passed', detail: 'Compared the named revision.'}], findings: [], limitations: ['Fixture only.']}};
    },
  });
  const worker = new CodingWorker(parseConfiguration(configuration(repo)), 'fake-token', undefined, undefined, edge.connect,
    undefined, undefined, undefined, [adapter('codex'), adapter('third-fixture')]);
  await worker.start();
  t.after(() => worker.stop());
  const declared = edge.requests.find(entry => entry.family === 'coding-endpoint');
  assert.equal(declared?.dataschema, 'https://bunny.invalid/events/coding-endpoint/2.3');
  assert.deepEqual((declared?.data as {harnesses: {harness: string}[]}).harnesses.map(item => item.harness), ['claude-code', 'codex', 'third-fixture']);
  const ask = (id: string, companion: 'bunny' | 'reachy', operationId: string) => command({requestId: operationId, operationId,
    action: 'start', harness: id, companion, taskId: operationId, repository: 'agent-device-hub', brief: `Review exact revision ${sha}`,
    bounds: {wallClockMs: 120_000, maxTurns: 4, budgetUsd: 2}});
  assert.equal('error' in edge.respond(ask('missing-harness', 'bunny', 'missing')), true);
  assert.deepEqual(edge.respond(ask('codex', 'bunny', 'codex-review')), {status: 'accepted'});
  assert.deepEqual(edge.respond(ask('third-fixture', 'reachy', 'third-review')), {status: 'accepted'});
  await until(() => edge.progress.filter(observed => observed.status === 'completed').length === 2);
  assert.equal(invocations.length, 2);
  for (const [operation, id] of [['codex-review', 'codex'], ['third-review', 'third-fixture']] as const) {
    assert.ok(invocations.some(item => item.id === id && item.brief === `Review exact revision ${sha}`));
    const observed = edge.progress.filter(item => item.operationId === operation);
    assert.deepEqual(observed.map(item => [item.harness, item.status, item.sessionId ?? null]), [
      [id, 'started', null], [id, 'started', `${id}-native`], [id, 'completed', `${id}-native`],
    ]);
    const context = edge.contexts.find(item => item.operationId === operation);
    assert.ok(context?.worktreeRef !== undefined);
    assert.notEqual(context.worktreeRef, '');
    assert.equal(context.worktreeRef.includes('/'), false);
    assert.equal(context.branch, null);
    const completed = observed.find(item => item.status === 'completed');
    assert.equal(completed?.result.base, sha);
    assert.equal(completed?.result.head, sha);
    assert.equal(completed?.result.sessionId, `${id}-native`);
    assert.deepEqual(completed?.result.changedFiles, ['review.txt']);
    assert.deepEqual(completed?.result.checks, [{name: 'git status', status: 'passed'},
      {name: 'git diff', status: 'passed', detail: 'Compared the named revision.'}]);
  }
});

void test('an uncapped worker keeps native identity for several Codex jobs from one companion and a sibling adapter', async t => {
  const repo = await repository(t), edge = fakeEdge();
  const sha = git(repo, 'rev-parse', 'HEAD');
  const invocations: {id: string; brief: string}[] = [];
  const adapter = (id: string): CodingAdapter => ({
    id, capabilities: {resume: 'unsupported', steering: 'unsupported', review: true},
    readiness: () => Promise.resolve({installed: 'yes', version: '1.0.0', signedIn: 'yes', plan: 'test-plan'}),
    async run({worktree, brief, bounds, session}) {
      invocations.push({id, brief});
      assert.notEqual(worktree, repo);
      assert.ok(worktree.startsWith(join(repo, '.local', 'worktrees')));
      assert.equal(git(worktree, 'rev-parse', 'HEAD'), sha);
      assert.equal(bounds.wallClockMs, 120_000);
      await session(`${id}-native`);
      await session('unexpected-second-identity');
      await writeFile(join(worktree, 'review.txt'), 'Synthetic review facts');
      return {sessionId: 'unexpected-third-identity', structured: {outcome: 'tested-candidate', summary: 'Reviewed the supplied revision.',
        checks: [{name: 'git status', status: 'passed', ...(id === 'codex' ? {detail: null} : {})},
          {name: 'git diff', status: 'passed', detail: 'Compared the named revision.'}], findings: [], limitations: ['Fixture only.']}};
    },
  });
  const worker = new CodingWorker(parseConfiguration({...configuration(repo), schema: 'coding-worker/1.2'}), 'fake-token', undefined, undefined, edge.connect,
    undefined, undefined, undefined, [adapter('codex'), adapter('third-fixture')]);
  await worker.start();
  t.after(() => worker.stop());
  const declared = edge.requests.find(entry => entry.family === 'coding-endpoint');
  assert.equal(declared?.dataschema, 'https://bunny.invalid/events/coding-endpoint/2.4');
  assert.deepEqual((declared?.data as {harnesses: {harness: string}[]}).harnesses.map(item => item.harness), ['claude-code', 'codex', 'third-fixture']);
  const ask = (id: string, companion: 'bunny' | 'reachy', operationId: string) => command({requestId: operationId, operationId,
    action: 'start', harness: id, companion, taskId: operationId, repository: 'agent-device-hub', brief: `Review exact revision ${sha}`,
    bounds: {wallClockMs: 120_000, maxTurns: 4, budgetUsd: 2}});
  assert.equal('error' in edge.respond(ask('missing-harness', 'bunny', 'missing')), true);
  const operations = Array.from({length: 5}, (_, index) => [`codex-review-${String(index)}`, 'codex'] as const);
  for (const [operation, id] of operations) assert.deepEqual(edge.respond(ask(id, 'bunny', operation)), {status: 'accepted'});
  assert.deepEqual(edge.respond(ask('third-fixture', 'reachy', 'third-review')), {status: 'accepted'});
  await until(() => edge.progress.filter(observed => observed.status === 'completed').length === 6);
  assert.equal(invocations.length, 6);
  for (const [operation, id] of [...operations, ['third-review', 'third-fixture']] as const) {
    assert.ok(invocations.some(item => item.id === id && item.brief === `Review exact revision ${sha}`));
    const observed = edge.progress.filter(item => item.operationId === operation);
    assert.ok(observed.every(item => item.harness === id));
    assert.ok(observed.some(item => item.status === 'started' && item.setup === 'ready'));
    assert.deepEqual(observed.filter(item => item.sessionId !== undefined).map(item => [item.status, item.sessionId]), [
      ['started', `${id}-native`], ['completed', `${id}-native`],
    ]);
    const completed = observed.find(item => item.status === 'completed');
    assert.equal(completed?.result.base, sha);
    assert.equal(completed?.result.head, sha);
    assert.equal(completed?.result.sessionId, `${id}-native`);
    assert.deepEqual(completed?.result.changedFiles, ['review.txt']);
    assert.deepEqual(completed?.result.checks, [{name: 'git status', status: 'passed'},
      {name: 'git diff', status: 'passed', detail: 'Compared the named revision.'}]);
  }
});

void test('uncapped jobs share only conflicting Git setup and isolate a cancelled wait, disk error and spawn failure', async t => {
  const repo = await repository(t), edge = fakeEdge();
  const alias = join(repo, '..', 'linked');
  git(repo, 'worktree', 'add', '--detach', '--quiet', alias, 'origin/main');
  let release = (): void => {};
  const hold = new Promise<void>(resolve => {release = resolve;});
  let inSetup = 0, most = 0, fetches = 0;
  const worktrees: string[] = [], started: string[] = [];
  const runGit: GitRunner = async (cwd, args, options) => {
    const setup = args[0] === 'fetch' || args[0] === 'worktree' || args[1] === 'origin/main';
    if (setup) {inSetup += 1; most = Math.max(most, inSetup);}
    try {
      if (args[0] === 'fetch' && ++fetches === 1) await hold;
      if (args[0] === 'worktree') {
        const fresh = args.at(-2) ?? assert.fail('worktree path');
        worktrees.push(fresh);
        if (fresh.includes('bunny-disk-')) throw Object.assign(new Error('synthetic disk full'), {code: 'ENOSPC'});
      }
      return await new Promise<string>((resolve, reject) => {
        execFile('git', ['-C', cwd, ...args], {timeout: options?.timeoutMs ?? 60_000}, (error, stdout) => {
          if (error !== null) reject(new Error('git failed', {cause: error}));
          else resolve(options?.trim === false ? stdout : stdout.trim());
        });
      });
    } finally {if (setup) inSetup -= 1;}
  };
  const harness: Harness = {start: (_args, _cwd, brief) => {
    started.push(brief);
    if (brief === 'spawn') return Promise.resolve({code: null, signal: null, truncated: false, spawnFailed: true});
    const stdout = [
      {type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'synthetic-session'},
      {type: 'result', session_id: 'synthetic-mismatched-session', structured_output: {outcome: 'tested-candidate', summary: 'Synthetic result.', checks: [], findings: [], limitations: []}},
    ].map(event => JSON.stringify(event)).join('\n');
    return Promise.resolve({code: 0, signal: null, truncated: false, stdout});
  }};
  const worker = new CodingWorker(parseConfiguration({...configuration(repo), schema: 'coding-worker/1.2',
    repositories: [{name: 'primary', path: repo}, {name: 'linked', path: alias}]}), 'fake-token', harness, undefined, edge.connect, Date.now, runGit);
  await worker.start();
  t.after(async () => {release(); await worker.stop();});
  assert.equal(edge.requests.find(request => request.family === 'coding-endpoint')?.dataschema, 'https://bunny.invalid/events/coding-endpoint/2.4');
  const start = (operationId: string, repository: string, companion: 'bunny' | 'reachy') => edge.respond(command({
    requestId: operationId, operationId, taskId: operationId, companion, action: 'start', repository, brief: operationId,
    bounds: {wallClockMs: 60_000, maxTurns: 5, budgetUsd: 1},
  }));
  assert.deepEqual(start('first', 'primary', 'bunny'), {status: 'accepted'});
  await until(() => fetches === 1);
  for (const id of ['cancel', 'disk', 'spawn', 'sibling']) assert.deepEqual(start(id, 'linked', 'bunny'), {status: 'accepted'});
  assert.deepEqual(start('reachy', 'primary', 'reachy'), {status: 'accepted'});
  await until(() => edge.progress.some(progress => progress.operationId === 'cancel' && progress.status === 'started' && progress.setup === 'waiting'));
  assert.deepEqual(edge.respond(command({requestId: 'cancel-command', operationId: 'cancel', action: 'cancel'})), {status: 'accepted'});
  release();
  await until(() => edge.progress.filter(progress => progress.status !== 'started').length === 6, () => edge.progress);
  assert.equal(most, 1, 'linked repositories share the same Git setup lock');
  assert.ok(!worktrees.some(path => path.includes('bunny-cancel-')));
  assert.deepEqual(started.sort(), ['first', 'reachy', 'sibling', 'spawn']);
  const ended = (id: string) => edge.progress.find(progress => progress.operationId === id && progress.status !== 'started');
  assert.equal(ended('cancel')?.status, 'cancelled');
  const disk = ended('disk'), spawn = ended('spawn');
  assert.equal(disk?.status === 'failed' && disk.reason, 'worktree');
  assert.equal(spawn?.status === 'failed' && spawn.reason, 'spawn');
  assert.equal(ended('sibling')?.status, 'completed');
  assert.equal(ended('sibling')?.sessionId, 'synthetic-session');
  const early = edge.progress.findIndex(progress => progress.operationId === 'sibling' && progress.status === 'started' && progress.sessionId === 'synthetic-session');
  const terminal = edge.progress.findIndex(progress => progress.operationId === 'sibling' && progress.status === 'completed');
  assert.ok(early >= 0 && early < terminal);
  const completed = ended('sibling');
  assert.equal(completed?.status === 'completed' && completed.result.sessionId, 'synthetic-session');
});


const codexHandoffCases = ['continue', 'changed', 'uncertain', 'no-confinement', 'restart', 'staged-new', 'untracked', 'changed-during-copy', 'root-replaced-live', 'root-replaced', 'gitdir-replaced', 'gitdir-retargeted'] as const;
const claudeHandoffCases = ['continue', 'uncertain', 'no-confinement', 'restart', 'staged-new', 'changed-during-copy'] as const;
for (const [origin, destination, scenarios] of [
  ['codex', 'claude-code', codexHandoffCases], ['claude-code', 'codex', claudeHandoffCases],
] as const) for (const scenario of scenarios) {
  void test(`cross-harness handoff from ${origin} verifies writer and exact worktree (${scenario})`, {timeout: 30_000}, async t => {
    const repo = await repository(t), edge = fakeEdge();
    const base = git(repo, 'rev-parse', 'HEAD');
    const newFile = 'new-file.test.ts';
    const fullBrief = 'Exact user brief. ' + 'x'.repeat(4096 - 'Exact user brief. '.length);
    const writerHome = join(dirname(repo), 'isolated-writer-home');
    await mkdir(writerHome);
    let priorWorktree: string | undefined, resumed = 0, edited = false;
    const initialSession = `${origin}-partial-id`, resumedSession = `${destination}-continuation-id`;
    const partialReport = {outcome: 'incomplete', summary: 'Synthetic partial result.', checks: [{name: 'git diff', status: 'passed'}], findings: [], limitations: []};
    const completeReport = {outcome: 'tested-candidate', summary: 'Synthetic completion.', checks: [{name: 'unit test', status: 'passed'}], findings: [], limitations: []};
    const partial = async (worktree: string, signal: AbortSignal, session: () => void | Promise<void>) => {
      priorWorktree = worktree;
      await writeFile(join(worktree, 'README.md'), 'partially edited\n');
      if (scenario === 'staged-new' || scenario === 'untracked') {
        await writeFile(join(worktree, newFile), 'export const synthetic = true;\n');
        if (scenario === 'staged-new') git(worktree, 'add', '--', newFile);
      }
      await session();
      const stopped = new Promise<void>(resolve => {if (signal.aborted) resolve(); else signal.addEventListener('abort', () => {resolve();}, {once: true});});
      edited = true;
      await stopped;
    };
    const complete = async (worktree: string, brief: string) => {
      resumed += 1;
      const original = priorWorktree ?? assert.fail('source checkout');
      assert.notEqual(worktree, await realpath(original));
      assert.equal(git(worktree, 'rev-parse', 'HEAD'), base);
      assert.notEqual(git(worktree, 'rev-parse', '--absolute-git-dir'), git(original, 'rev-parse', '--absolute-git-dir'));
      assert.equal(git(worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'), join(worktree, '.git'));
      assert.equal(await readFile(join(worktree, 'README.md'), 'utf8'), 'partially edited\n');
      assert.ok(brief.endsWith(fullBrief));
      assert.match(brief.slice(0, -fullBrief.length), /git diff/);
      assert.ok(!brief.includes(initialSession));
      if (scenario === 'staged-new') {
        assert.equal(await readFile(join(worktree, newFile), 'utf8'), 'export const synthetic = true;\n');
        assert.equal(git(worktree, 'diff', '--cached', '--name-only'), newFile);
      }
      await writeFile(join(original, 'README.md'), 'an old watcher wrote only here\n');
      assert.equal(await readFile(join(worktree, 'README.md'), 'utf8'), 'partially edited\n');
      await writeFile(join(worktree, 'README.md'), 'finished\n');
    };
    const codex: CodingAdapter = {
      id: 'codex', capabilities: {steering: 'unsupported', resume: 'saved-session', review: true},
      readiness: () => Promise.resolve({installed: 'yes', signedIn: 'yes', version: 'synthetic', plan: 'plus'}),
      async run({worktree, session, signal, brief, continuationRoot}) {
        if (origin !== 'codex') {
          await complete(worktree, brief);
          await session(resumedSession);
          return {writerStopped: true, structured: completeReport};
        }
        await partial(worktree, signal, () => session(initialSession));
        return {reason: 'cancelled', structured: partialReport,
          ...(scenario === 'uncertain' ? {uncertain: true} : {writerStopped: true}),
          ...(scenario === 'no-confinement' || continuationRoot === undefined ? {} : {writerFence: {root: continuationRoot, home: writerHome}})};
      },
    };
    const claude: Harness = {
      async start(_args, worktree, brief, _onChild, onLine, continuation) {
        const isPartial = origin === 'claude-code';
        const sessionId = isPartial ? initialSession : resumedSession;
        onLine?.(JSON.stringify({type: 'system', subtype: 'init', apiKeySource: 'none', session_id: sessionId}));
        if (isPartial) await partial(worktree, continuation?.signal ?? assert.fail('reserved continuation root'), () => {});
        else await complete(worktree, brief);
        onLine?.(JSON.stringify({type: 'result', session_id: sessionId, structured_output: isPartial ? partialReport : completeReport}));
        return {code: 0, signal: null, truncated: false, writerStopped: scenario !== 'uncertain',
          ...(isPartial && continuation !== undefined && scenario !== 'no-confinement' ? {fencedRoot: continuation.root} : {})};
      },
    };
    const runGit: GitRunner = async (cwd, args, options) => {
      if (scenario === 'changed-during-copy' && args.includes('--depth=1')) {
        await writeFile(join(priorWorktree ?? assert.fail('source checkout'), 'README.md'), 'external edit during copy\n');
      }
      const {stdout} = await promisify(execFile)('git', ['-C', cwd, ...args], {timeout: options?.timeoutMs ?? 60_000, encoding: 'utf8'});
      return options?.trim === false ? stdout : stdout.trim();
    };
    const make = () => new CodingWorker(parseConfiguration({...configuration(repo), schema: 'coding-worker/1.2'}),
      'fake-token', claude, undefined, edge.connect, undefined, runGit, undefined, [codex]);
    const worker = make();
    await worker.start();
    t.after(() => worker.stop());
    const initial = {action: 'start' as const, requestId: 'partial', operationId: 'partial', taskId: 'synthetic-task', companion: 'bunny' as const,
      harness: origin, repository: 'agent-device-hub', brief: 'Synthetic approved brief.', bounds: {wallClockMs: 60_000, maxTurns: 4, budgetUsd: 1}};
    assert.deepEqual(edge.respond(command(initial)), {status: 'accepted'});
    await until(() => edited);
    if (scenario === 'root-replaced-live') {
      const original = priorWorktree ?? assert.fail('source checkout');
      await rename(original, `${original}-old`);
      await cp(`${original}-old`, original, {recursive: true});
    }
    const next = (token: string, operationId = 'continuation') => command({...initial, requestId: operationId, operationId,
      harness: destination, brief: fullBrief, continuation: {fromOperationId: 'partial', token}});
    assert.ok('error' in edge.respond(next('01234567-89ab-4cde-8fab-0123456789ab')));
    assert.deepEqual(edge.respond(command({action: 'cancel', requestId: 'stop-partial', operationId: 'partial'})), {status: 'accepted'});
    await until(() => edge.progress.some(entry => entry.operationId === 'partial' && entry.status !== 'started'));
    const result = edge.progress.find(entry => entry.operationId === 'partial' && entry.status !== 'started');
    if (scenario === 'uncertain') {assert.equal(result?.status, 'uncertain'); assert.equal(result?.handoffToken, undefined); return;}
    assert.ok(result?.status === 'cancelled');
    if (scenario === 'untracked' || scenario === 'no-confinement' || scenario === 'root-replaced-live') {assert.equal(result.handoffToken, undefined); return;}
    const proof = result.handoffToken ?? assert.fail('confirmed stopped partial attempt');
    assert.equal(result.result?.head, base);
    assert.equal(result.sessionId, initialSession);
    const original = priorWorktree ?? assert.fail('worktree');
    if (scenario === 'changed') await writeFile(join(original, 'README.md'), 'external edit\n');
    if (scenario === 'root-replaced') {
      await rename(original, `${original}-old`);
      await cp(`${original}-old`, original, {recursive: true});
    }
    if (scenario === 'gitdir-replaced') {
      const storage = git(original, 'rev-parse', '--absolute-git-dir');
      await rename(storage, `${storage}-old`);
      await cp(`${storage}-old`, storage, {recursive: true});
    }
    if (scenario === 'gitdir-retargeted') {
      const storage = git(original, 'rev-parse', '--absolute-git-dir');
      await cp(storage, `${storage}-new`, {recursive: true});
      await writeFile(join(original, '.git'), `gitdir: ${storage}-new\n`);
    }
    if (scenario === 'restart') {
      await worker.stop();
      const replacement = make();
      await replacement.start();
      t.after(() => replacement.stop());
      assert.ok('error' in edge.respond(next(proof)));
      assert.equal(resumed, 0);
      return;
    }
    assert.ok('error' in edge.respond(command({...initial, requestId: 'same-harness', operationId: 'same-harness',
      continuation: {fromOperationId: 'partial', token: proof}})));
    assert.deepEqual(edge.respond(next(proof)), {status: 'accepted'});
    assert.ok('error' in edge.respond(next(proof, 'simultaneous')));
    await until(() => edge.progress.some(entry => entry.operationId === 'continuation' && entry.status !== 'started'));
    const completed = edge.progress.find(entry => entry.operationId === 'continuation' && entry.status !== 'started');
    assert.ok('error' in edge.respond(next(proof, 'repeated')));
    if (scenario === 'changed' || scenario === 'changed-during-copy' || scenario === 'root-replaced' || scenario === 'gitdir-replaced' || scenario === 'gitdir-retargeted') {
      assert.equal(resumed, 0);
      assert.equal(completed?.status, 'failed');
    } else {
      assert.equal(resumed, 1);
      assert.equal(completed?.status, 'completed');
      assert.equal(completed?.sessionId, resumedSession);
      assert.deepEqual(completed?.result?.checks, [{name: 'unit test', status: 'passed'}]);
    }
  });
}

for (const committed of [false, true]) {
  void test(`a completed Codex attempt can offer exact terminal continuation without a cross-harness token (commit: ${String(committed)})`, async t => {
    const repo = await repository(t), edge = fakeEdge(), root = await realpath(dirname(repo));
    const home = join(root, 'native-profile');
    await mkdir(home);
    const sessionId = '7eedd100-0000-4000-8000-000000000001';
    const codex: CodingAdapter = {
      id: 'codex', capabilities: {steering: 'unsupported', resume: 'saved-session', review: true},
      readiness: () => Promise.resolve({installed: 'yes', signedIn: 'yes', version: '0.163.0', plan: 'plus'}),
      async run({worktree, session, continuationRoot}) {
        if (committed) {
          await writeFile(join(worktree, 'README.md'), 'Synthetic committed result.\n');
          git(worktree, 'add', '--', 'README.md');
          git(worktree, 'commit', '--quiet', '-m', 'Synthetic committed result');
        }
        await session(sessionId);
        return {sessionId, writerStopped: true, writerFence: {root: continuationRoot ?? assert.fail('native fence root'), home},
          structured: {outcome: 'tested-candidate', summary: 'Synthetic completed attempt.', checks: [], findings: [], limitations: []}};
      },
    };
    const worker = new CodingWorker(parseConfiguration({...configuration(repo), schema: 'coding-worker/1.2',
      nativeClients: {socket: join(root, 'native.sock'), harnesses: ['codex']}}),
    'fake-token', undefined, undefined, edge.connect, undefined, undefined, undefined, [codex]);
    await worker.start();
    t.after(() => worker.stop());
    assert.deepEqual(edge.respond(command({action: 'start', requestId: 'clean', operationId: 'clean', taskId: 'synthetic-task', companion: 'bunny',
      harness: 'codex', repository: 'agent-device-hub', brief: 'Review without editing.', bounds: {wallClockMs: 60_000, maxTurns: 4, budgetUsd: 1}})), {status: 'accepted'});
    await until(() => edge.progress.some(entry => entry.status === 'completed'));
    const completion = edge.progress.find(entry => entry.status === 'completed');
    assert.deepEqual(completion?.result.changedFiles, committed ? ['README.md'] : []);
    assert.equal(completion?.sessionId, sessionId);
    assert.equal(completion?.handoffToken, undefined);
    assert.deepEqual(edge.nativeClients.map(({operationId, clients, state}) => ({operationId, clients, state})),
      [{operationId: 'clean', clients: ['terminal'], state: 'available'}]);
  });
}

for (const {alias, conflictingRoute} of [{alias: false, conflictingRoute: false}, {alias: true, conflictingRoute: false}, {alias: false, conflictingRoute: true}]) void test(
  `a saved Codex launch verifies the Mac checkout and subscription route (alias: ${String(alias)}, conflicting route: ${String(conflictingRoute)})`,
  {skip: process.platform !== 'darwin', timeout: 30_000}, async t => {
    const standalone = '/opt/homebrew/bin/codex';
    if (await realpath(standalone).catch(() => undefined) === undefined) {t.skip('standalone Codex unavailable'); return;}
    const canonical = await repository(t, '/private/tmp'), root = dirname(canonical), edge = fakeEdge();
    const repo = alias ? canonical.slice('/private'.length) : canonical;
    assert.equal(await realpath(repo), canonical);
    const executable = join(root, 'native-codex'), home = join(root, 'profile'), socketPath = join(root, 'native.sock');
    const sessionId = '7eedd100-0000-4000-8000-000000000001';
    await mkdir(home, {mode: 0o700});
    const config = {sqlite_home: join(home, 'sqlite'), log_dir: join(home, 'log'), mcp_servers: {}, plugins: {}, hooks: null,
      allow_login_shell: false, cli_auth_credentials_store: 'file', forced_login_method: 'chatgpt', model_provider: 'openai',
      chatgpt_base_url: 'https://chatgpt.com/backend-api/',
      openai_base_url: conflictingRoute ? 'https://api.openai.com/v1' : 'https://chatgpt.com/backend-api/codex',
      otel: {exporter: 'none', trace_exporter: 'none', metrics_exporter: 'none', log_user_prompt: false},
      features: {hooks: false, apps: false, plugins: false, shell_snapshot: false}};
    await writeFile(executable, `#!${process.execPath}
const args=process.argv.slice(2);
if(args[0]==='sandbox') process.exit(require('node:child_process').spawnSync(${JSON.stringify(standalone)},args,{stdio:'inherit'}).status ?? 8);
if(args[0]==='resume') {
  console.log(JSON.stringify({cwd:process.cwd(), threadId:args.at(-1), selectedCwd:args[args.indexOf('--cd')+1], home:process.env.CODEX_HOME,
    modelRoute:args.filter(arg=>arg.startsWith('openai_base_url='))}));
  process.exit(0);
}
if(args[0]!=='app-server') process.exit(9);
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const {id,method,params}=JSON.parse(line);
  if(id===undefined) return;
  let result={};
  if(method==='config/read') result={config:${JSON.stringify(config)}};
  if(method==='account/read') result={requiresOpenaiAuth:true,account:{type:'chatgpt',planType:'plus'}};
  if(method==='thread/resume') {
    if(params.threadId!==${JSON.stringify(sessionId)}) process.exit(10);
    result={thread:{id:params.threadId,cwd:params.cwd},cwd:params.cwd,runtimeWorkspaceRoots:[params.cwd],modelProvider:'openai',
      approvalPolicy:'never',activePermissionProfile:{id:params.permissions},sandbox:{type:'workspaceWrite',networkAccess:false,writableRoots:[params.cwd]}};
  } else if(method==='turn/start') process.exit(11);
  console.log(JSON.stringify({id,result}));
});
`, {mode: 0o700});
    let original: string | undefined, releaseSibling = () => {};
    const sibling = new Promise<void>(resolve => {releaseSibling = resolve;});
    const claude: Harness = {
      async start(_args, _cwd, _brief, _child, observe) {
        observe?.(JSON.stringify({type: 'system', subtype: 'init', apiKeySource: 'none', session_id: 'sibling-session'}));
        await sibling;
        return {code: 0, signal: null, truncated: false};
      },
    };
    const codex: CodingAdapter = {
      id: 'codex', capabilities: {steering: 'unsupported', resume: 'saved-session', review: true},
      readiness: () => Promise.resolve({installed: 'yes', signedIn: 'yes', version: '0.163.0', plan: 'plus'}),
      async run({worktree, session, continuationRoot}) {
        original = await realpath(worktree);
        await session(sessionId);
        return {sessionId, writerStopped: true, writerFence: {root: continuationRoot ?? assert.fail('reserved root'), home},
          structured: {outcome: 'tested-candidate', summary: 'Synthetic saved result.', checks: [], findings: [], limitations: []}};
      },
    };
    const parsed = parseConfiguration({...configuration(repo), schema: 'coding-worker/1.2', nativeClients: {socket: socketPath, harnesses: ['codex']}});
    const worker = new CodingWorker(parsed, 'fake-token', claude, undefined, edge.connect, undefined, undefined, undefined, [codex]);
    // The fixture produces source evidence locally. The real prepare and launch paths then use the fake CLI.
    parsed.codex = {executable, home};
    await worker.start();
    t.after(async () => {releaseSibling(); await worker.stop();});
    const start = (operationId: string, harness: 'codex' | 'claude-code') => edge.respond(command({action: 'start', requestId: operationId,
      operationId, taskId: operationId, companion: 'bunny', harness, repository: 'agent-device-hub', brief: 'Synthetic saved attempt.',
      bounds: {wallClockMs: 60_000, maxTurns: 4, budgetUsd: 1}}));
    assert.deepEqual(start('sibling', 'claude-code'), {status: 'accepted'});
    assert.deepEqual(start('native', 'codex'), {status: 'accepted'});
    await until(() => edge.progress.some(row => row.operationId === 'sibling' && row.sessionId === 'sibling-session') &&
      edge.progress.some(row => row.operationId === 'native' && row.status === 'completed'));
    assert.equal(edge.nativeClients.find(row => row.operationId === 'native')?.state, 'available');

    const socket = createConnection(socketPath);
    t.after(() => {socket.destroy();});
    const replies = createInterface({input: socket})[Symbol.asyncIterator]();
    await once(socket, 'connect');
    socket.write('native\n');
    assert.equal((await replies.next()).value, 'waiting');
    const prepare = command({action: 'prepare-native-client', client: 'terminal', requestId: 'prepare-native', operationId: 'native'});
    const prepared = await Promise.resolve(edge.respond({...prepare, expiresat: new Date(Date.now() + 25000).toISOString()}));
    if (conflictingRoute) {
      assert.deepEqual(prepared, errorBody('unavailable'));
      return;
    }
    assert.deepEqual(prepared, {status: 'accepted'});
    const launch = command({action: 'open-native-terminal', requestId: 'launch-native', operationId: 'native', intentId: 'prepare-native'});
    assert.deepEqual(await Promise.resolve(edge.respond(launch)), {status: 'accepted'});
    const plan = JSON.parse((await replies.next()).value ?? assert.fail('native launch plan')) as {executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv};
    assert.notEqual(plan.cwd, original);
    assert.equal(await realpath(plan.cwd), plan.cwd);
    const {stdout} = await promisify(execFile)(plan.executable, plan.args, {cwd: plan.cwd, env: plan.env, timeout: 5000});
    assert.deepEqual(JSON.parse(stdout), {cwd: plan.cwd, threadId: sessionId, selectedCwd: plan.cwd, home,
      modelRoute: ['openai_base_url="https://chatgpt.com/backend-api/codex"']});
    assert.equal(edge.progress.some(row => row.operationId === 'sibling' && row.status !== 'started'), false);
  });
