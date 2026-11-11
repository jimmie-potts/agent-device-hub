// The coding worker against what headless Claude Code really emits (Hub #1743). `recorded-*` fixtures are real
// `claude -p --output-format stream-json --verbose` runs and status commands, recorded with synthetic prompts in an empty
// directory and scrubbed of identifiers, paths and account values before they entered Git. `constructed-*` fixtures are
// not recordings: a real usage limit cannot be provoked, so they follow the event shapes the tool's own stream schema
// documents (`rate_limit_event` with status `rejected`; an assistant message typed `usage_limit_reached` with
// `api_error_params.rate_limit_info`), and a signed-out status follows `claude auth status --json`'s recorded shape.
// Every case goes through the real parsing code. No real `claude`, edge or network; no test waits on the clock.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {CodingEndpointControl, CodingProgress, CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {Command, Reply} from '@jimmie-potts/sdk';
import type {RemoteEndpoint, RemoteEndpointOptions, RemoteParticipant, connectRemote} from '@jimmie-potts/sdk/remote';
import {ClaudeStream, harnessEnvironment, parseAuthStatus, parseVersion} from '../src/worker/claude-stream.js';
import {CodingWorker, DEFAULT_ALLOWED_TOOLS, assembleResult, claudeHarness, parseConfiguration, type Harness} from '../src/worker/coding-worker.js';

const FIXTURES = fileURLToPath(new URL('../../tests/fixtures/claude-stream/', import.meta.url));
const fixture = (name: string): Promise<string> => readFile(join(FIXTURES, name), 'utf8');
const NOW = Date.parse('2026-01-01T09:00:00.000Z');
const validator = new MessageValidator(); registerCoreFamilies(validator);
/** A payload the worker sends, checked against the registered 2.1 schema as the gateway would. */
function admitted(family: string, kind: 'command' | 'occurrence', type: string, data: object): void {
  const message = {specversion: '1.0', bunnyprofile: '2.0', id: 'msg-1', source: 'bunny/parts/coding-worker', type, subject: 'worker-endpoint-1', time: new Date(NOW).toISOString(), kind,
    datacontenttype: 'application/json', dataschema: `https://bunny.invalid/events/${family}/2.1`, traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', data,
    ...(kind === 'command' ? {expiresat: new Date(NOW + 5000).toISOString()} : {})};
  const checked = validator.validate(message, {nowMs: NOW});
  assert.ok(checked.ok, JSON.stringify(checked));
}

void test('the recorded fixtures hold no home path, e-mail address, account identifier or real working directory', async () => {
  const names = await readdir(FIXTURES);
  assert.ok(names.filter(name => name.startsWith('recorded-')).length >= 4, names.join(', '));
  for (const name of names) {
    const text = await fixture(name);
    assert.doesNotMatch(text, /\/(?:Users|home|private|var\/folders)\//, `${name} has a home or temporary path`);
    assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, `${name} has an e-mail address`);
    if (!name.endsWith('.json') && !name.endsWith('.jsonl')) continue;
    for (const line of name.endsWith('.jsonl') ? text.trim().split('\n') : [text]) {
      const value: unknown = JSON.parse(line);
      const walk = (node: unknown, key?: string): void => {
        if (Array.isArray(node)) {node.forEach(item => {walk(item, key);}); return;}
        if (typeof node === 'object' && node !== null) {for (const [child, item] of Object.entries(node)) walk(item, child); return;}
        if (typeof node !== 'string') return;
        if (key === 'session_id' || key === 'uuid') assert.match(node, /^00000000-0000-4000-8000-/, `${name} ${key} is synthetic`);
        if (key === 'cwd' || key === 'configDirectory' || key === 'projectsDirectory') assert.match(node, /^\/synthetic\//, `${name} ${key} is synthetic`);
        if (key === 'email' || key === 'orgId' || key === 'orgName') assert.equal(node, 'redacted', `${name} ${key}`);
      };
      walk(value);
    }
  }
});

void test('a recorded successful run is read as a stream: the structured result, usage and the limit windows it reported, and no usage limit', async () => {
  const stream = ClaudeStream.of(await fixture('recorded-success.jsonl'));
  assert.equal(stream.unreadable, 0); assert.equal(stream.apiKeySource, 'none'); assert.equal(stream.limit, undefined);
  assert.deepEqual(stream.windows, [{window: 'seven-day', status: 'allowed', resetsAtMs: 1767268800000, utilization: 0.5}]);
  const {result, reason} = assembleResult('agent-device-hub', null, null, [], stream);
  assert.equal(reason, undefined);
  assert.equal(result.outcome, 'incomplete'); assert.equal(result.summary, 'Synthetic fixture: nothing to change.');
  assert.equal(result.sessionId, '00000000-0000-4000-8000-0000000000a1'); assert.equal(result.usage?.turns, 2); assert.equal(result.limit, undefined);
  assert.deepEqual(result.limitations, []);
});

void test('a recorded run that asks a question ends waiting-for-owner, with the question first among the findings', async () => {
  const {result, reason} = assembleResult('agent-device-hub', null, null, [], await fixture('recorded-question.jsonl'));
  assert.equal(reason, undefined);
  assert.equal(result.outcome, 'waiting-for-owner');
  assert.match(result.findings[0] ?? '', /^Question: /);
  admitted('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', {operationId: 'op-1', status: 'completed', result});
});

void test('a usage limit is its own outcome with the reset the tool gave, or unknown where it gave none (constructed streams)', async () => {
  const limited = assembleResult('agent-device-hub', null, null, [], await fixture('constructed-usage-limit.jsonl'));
  assert.equal(limited.reason, 'usage-limit'); assert.equal(limited.result.outcome, 'usage-limit');
  assert.deepEqual(limited.result.limit, {window: 'five-hour', resetsAtMs: 1767286800000});
  assert.equal(limited.result.summary, 'You\'ve hit your limit · resets 5pm (UTC)');
  admitted('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', {operationId: 'op-1', status: 'failed', reason: 'usage-limit', result: limited.result});
  const stream = ClaudeStream.of(await fixture('constructed-usage-limit.jsonl'));
  assert.deepEqual(stream.windows, [{window: 'five-hour', status: 'rejected', resetsAtMs: 1767286800000, utilization: 1}, {window: 'seven-day', status: 'unknown', resetsAtMs: 1767700800000, utilization: 0.62}]);

  const unknown = assembleResult('agent-device-hub', null, null, [], await fixture('constructed-usage-limit-no-reset.jsonl'));
  assert.equal(unknown.result.outcome, 'usage-limit'); assert.deepEqual(unknown.result.limit, {window: null, resetsAtMs: null});

  // A limit event on a run that still ended with its structured result is not the run's outcome; a generic rate-limit
  // error the tool did not type as a usage limit is an ordinary failure; a cancel or timeout keeps its own reason.
  const recovered = `${(await fixture('constructed-usage-limit.jsonl')).split('\n').slice(0, 2).join('\n')}\n${(await fixture('recorded-success.jsonl')).trim().split('\n').at(-1) ?? ''}`;
  assert.equal(assembleResult('agent-device-hub', null, null, [], recovered).result.outcome, 'incomplete');
  const throttled = JSON.stringify({type: 'assistant', error: 'rate_limit', is_api_error_message: true, api_error_status: 429, message: {content: []}});
  const plain = assembleResult('agent-device-hub', null, null, [], `${throttled}\n${JSON.stringify({type: 'result', subtype: 'success', is_error: true, result: 'Rate limited'})}`);
  assert.equal(plain.reason, undefined); assert.equal(plain.result.limit, undefined);
  assert.equal(assembleResult('agent-device-hub', null, null, [], await fixture('constructed-usage-limit.jsonl'), 'cancelled').result.outcome, 'failed');
});

void test('readiness is read from the recorded status commands; signed out and unreadable answers say so or stay unknown', async () => {
  assert.equal(parseVersion(await fixture('recorded-version.txt')), '2.1.292');
  assert.deepEqual(parseAuthStatus(await fixture('recorded-auth-status.json')), {signedIn: 'yes', plan: 'synthetic'});
  assert.deepEqual(parseAuthStatus(await fixture('constructed-auth-signed-out.json')), {signedIn: 'no', plan: null});
  for (const output of ['', 'not json', '[]', '{"loggedIn": "yes"}']) assert.deepEqual(parseAuthStatus(output), {signedIn: 'unknown', plan: null}, output);
  assert.deepEqual(parseAuthStatus('{"loggedIn": true, "subscriptionType": "Not A Plan!"}'), {signedIn: 'yes', plan: null});
  assert.equal(parseVersion('command not found'), null);
});

void test('the harness environment drops provider credentials and switches and keeps the rest', () => {
  const kept = harnessEnvironment({PATH: '/bin', HOME: '/synthetic/home', LANG: 'C', ANTHROPIC_API_KEY: 'synthetic', ANTHROPIC_AUTH_TOKEN: 'synthetic', ANTHROPIC_BASE_URL: 'http://example.invalid',
    ANTHROPIC_CUSTOM_HEADERS: 'x', ANTHROPIC_FOUNDRY_API_KEY: 'synthetic', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic', CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'synthetic', CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '3',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', AWS_BEARER_TOKEN_BEDROCK: 'synthetic', BUNNY_TOKEN: 'synthetic', anthropic_api_key: 'synthetic'});
  assert.deepEqual(Object.keys(kept).sort(), ['HOME', 'LANG', 'PATH']);
});

/** A stand-in executable: it prints the names in its environment for a run, and answers the two status commands. */
async function fakeClaude(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coding-worker-claude-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'claude');
  await writeFile(file, ['#!/bin/sh', 'if [ "$1" = "--version" ]; then cat "$FIXTURE_DIR/recorded-version.txt"; exit 0; fi',
    'if [ "$1" = "auth" ]; then cat "$FIXTURE_DIR/recorded-auth-status.json"; exit 0; fi', 'cat > /dev/null', 'env | cut -d= -f1', ''].join('\n'));
  await chmod(file, 0o755);
  return file;
}

void test('with API keys in the worker\'s environment the real harness starts the tool without them, and probes readiness the same way', async t => {
  const executable = await fakeClaude(t);
  const environment = {PATH: process.env.PATH ?? '/usr/bin:/bin', FIXTURE_DIR: FIXTURES, KEEP_ME: '1', ANTHROPIC_API_KEY: 'sk-ant-synthetic', ANTHROPIC_AUTH_TOKEN: 'synthetic',
    CLAUDE_CODE_OAUTH_TOKEN: 'synthetic', CLAUDE_CODE_USE_BEDROCK: '1', AWS_BEARER_TOKEN_BEDROCK: 'synthetic', ANTHROPIC_BASE_URL: 'http://example.invalid', BUNNY_EDGE_TOKEN: 'synthetic'};
  const harness = claudeHarness(executable, environment);
  const names: string[] = [];
  const finished = await harness.start(['--print'], tmpdir(), 'brief', () => {}, line => {names.push(line);});
  assert.deepEqual(finished, {code: 0, signal: null, truncated: false});
  assert.ok(names.includes('KEEP_ME') && names.includes('PATH'), names.join(','));
  for (const stripped of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_BASE_URL', 'BUNNY_EDGE_TOKEN']) {
    assert.ok(!names.includes(stripped), `${stripped} reached the harness`);
  }
  assert.deepEqual(await harness.readiness?.(), {installed: 'yes', version: '2.1.292', signedIn: 'yes', plan: 'synthetic'});
  assert.deepEqual(await claudeHarness('/nonexistent/claude', environment).readiness?.(), {installed: 'no', version: null, signedIn: 'unknown', plan: null});
});

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', env: {...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@example', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@example'}}).trim();
async function repository(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'coding-worker-stream-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bare = join(root, 'origin.git'), work = join(root, 'repo');
  execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', bare]);
  execFileSync('git', ['init', '--quiet', '-b', 'main', work]);
  await writeFile(join(work, 'README.md'), 'hello\n');
  git(work, 'add', '.'); git(work, 'commit', '--quiet', '-m', 'first'); git(work, 'remote', 'add', 'origin', bare); git(work, 'push', '--quiet', 'origin', 'main');
  return work;
}
/** A fake edge that wakes waiters on every request and publication, so the tests wait on events, never on a timer. */
function eventEdge() {
  const requests: CodingEndpointControl[] = [], progress: CodingProgress[] = [], waiters: (() => void)[] = [];
  const wake = (): void => {for (const waiter of waiters.splice(0)) waiter();};
  let responder: ((command: Command<CodingWork>) => Reply) | undefined;
  const endpoint: RemoteEndpoint = {id: 'worker-endpoint-1', close: () => Promise.resolve(),
    publish: (_family, draft) => {progress.push(draft.data as CodingProgress); wake(); return Promise.resolve({} as never);},
    request: (_family, draft) => {requests.push(draft.data as CodingEndpointControl); wake(); return Promise.resolve({status: 'accepted', requestId: 'r', reply: {} as never});}};
  const participant = {openEndpoint: <T extends object>(options: RemoteEndpointOptions<T>) => {responder = options.respond as unknown as (command: Command<CodingWork>) => Reply; return Promise.resolve(endpoint);},
    close: () => Promise.resolve()} as unknown as RemoteParticipant;
  return {connect: (() => Promise.resolve(participant)) as unknown as typeof connectRemote, requests, progress,
    respond: (data: CodingWork): Reply => (responder ?? assert.fail('endpoint opened'))({specversion: '1.0', bunnyprofile: '2.0', id: `cmd-${data.requestId}`, source: 'bunny/modules/companions',
      kind: 'command', type: 'org.bunny.coding.work.requested', subject: 'worker-endpoint-1', time: new Date(NOW).toISOString(), datacontenttype: 'application/json',
      dataschema: 'https://bunny.invalid/events/coding-work/2.0', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', expiresat: new Date(NOW + 5000).toISOString(), data}),
    until: async (check: () => boolean): Promise<void> => {while (!check()) await new Promise<void>(resolve => {waiters.push(resolve);});}};
}
/** Replays a fixture through the harness's line callback, as the real harness streams it, with the recorded readiness. */
const replaying = (name: string): Harness => ({
  start: async (_args, _cwd, _input, _onChild, onLine) => {for (const line of (await fixture(name)).split('\n')) onLine?.(line); return {code: 0, signal: null, truncated: false};},
  readiness: async () => ({installed: 'yes', version: parseVersion(await fixture('recorded-version.txt')), ...parseAuthStatus(await fixture('recorded-auth-status.json'))}),
});
const configuration = (repo: string) => parseConfiguration({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: repo}],
  claude: {executable: '/nonexistent/claude', permissionMode: 'acceptEdits', allowedTools: DEFAULT_ALLOWED_TOOLS}});
const start = (taskId: string): CodingWork => ({requestId: `op-${taskId}`, operationId: `op-${taskId}`, action: 'start', taskId, repository: 'agent-device-hub', brief: 'Synthetic brief.',
  bounds: {wallClockMs: 1_200_000, maxTurns: 60, budgetUsd: 5}});

void test('the worker declares with its readiness, reports a recorded question as waiting-for-owner, and then reports the limit windows the run saw', {timeout: 60_000}, async t => {
  const repo = await repository(t), edge = eventEdge();
  const worker = new CodingWorker(configuration(repo), 'token-'.padEnd(43, 'x'), replaying('recorded-question.jsonl'), () => {}, edge.connect, () => NOW);
  await worker.start();
  const declared = edge.requests[0];
  assert.deepEqual(declared?.readiness, {tool: 'claude-code', installed: 'yes', version: '2.1.292', signedIn: 'yes', plan: 'synthetic', limits: null, limitsObservedAtMs: null, checkedAtMs: NOW});
  admitted('coding-endpoint', 'command', 'org.bunny.coding.endpoint.requested', declared ?? {});
  assert.deepEqual(edge.respond(start('task-1')), {status: 'accepted'});
  await edge.until(() => edge.progress.length === 2 && edge.requests.length === 2);
  const done = edge.progress[1];
  assert.ok(done?.status === 'completed'); assert.equal(done.result.outcome, 'waiting-for-owner'); assert.match(done.result.findings[0] ?? '', /^Question: /);
  // After the run, one more enable carries the windows it reported, observed now; it is a report, sent once.
  assert.deepEqual(edge.requests[1]?.readiness?.limits, [{window: 'seven-day', status: 'allowed', resetsAtMs: 1767268800000, utilization: 0.5}]);
  assert.equal(edge.requests[1]?.readiness?.limitsObservedAtMs, NOW); assert.equal(edge.requests[1]?.action, 'enable');
  await worker.stop();
});

void test('a run stopped at a usage limit ends failed with the usage-limit reason, outcome and reset (constructed stream)', {timeout: 60_000}, async t => {
  const repo = await repository(t), edge = eventEdge();
  const worker = new CodingWorker(configuration(repo), 'token-'.padEnd(43, 'x'), replaying('constructed-usage-limit.jsonl'), () => {}, edge.connect, () => NOW);
  await worker.start();
  assert.deepEqual(edge.respond(start('task-2')), {status: 'accepted'});
  await edge.until(() => edge.progress.length === 2 && edge.requests.length === 2);
  const ended = edge.progress[1];
  assert.ok(ended?.status === 'failed'); assert.equal(ended.reason, 'usage-limit');
  assert.equal(ended.result?.outcome, 'usage-limit'); assert.deepEqual(ended.result?.limit, {window: 'five-hour', resetsAtMs: 1767286800000});
  admitted('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', ended);
  assert.equal(edge.requests[1]?.readiness?.limits?.[0]?.status, 'rejected');
  await worker.stop();
});
