import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {codexAdapter, codexEnvironment, type CodexTransport} from '../src/worker/codex-adapter.js';

const threadId = '11111111-2222-4333-8444-555555555555';
const turnId = 'synthetic-turn';
const brief = 'Review the pinned revision and report checks.';
const account = {requiresOpenaiAuth: true, account: {type: 'chatgpt', planType: 'plus', email: 'synthetic@example.invalid'}};
const window = {primary: {usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300}};
const report = {outcome: 'tested-candidate', summary: 'Reviewed the requested revision.', checks: [
  {name: 'git diff', status: 'passed', detail: null}, {name: 'npm test', status: 'skipped', detail: 'No fixture dependencies installed.'},
], findings: [], limitations: []};
const bounds = {wallClockMs: 120_000, maxTurns: 3, budgetUsd: 2};

function assertStrictOutputSchema(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  if ('type' in value && value.type === 'object') {
    assert.ok('additionalProperties' in value && value.additionalProperties === false);
    assert.ok('properties' in value && typeof value.properties === 'object' && value.properties !== null);
    assert.ok('required' in value && Array.isArray(value.required));
    assert.deepEqual(new Set(value.required), new Set(Object.keys(value.properties)));
  }
  for (const child of Object.values(value)) assertStrictOutputSchema(child);
}

type Scenario = {
  auth?: unknown; laterAuth?: unknown; requireId?: boolean; malformed?: boolean; badPermissions?: boolean; changeAuth?: boolean;
  terminal?: 'usageLimitExceeded' | 'rateLimitExceeded' | 'serverOverloaded' | 'lost';
};

function fixture(scenario: Scenario = {}) {
  const requests: string[] = [], sessions: string[] = [];
  let starts = 0, accounts = 0;
  let wireSchema: unknown;
  const transport: CodexTransport = ({args, cwd, env, event, closed}) => {
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.ok(args.includes('model_provider="openai"'));
    assert.ok(args.includes('features.hooks=false'));
    assert.ok(args.includes('mcp_servers={}'));
    assert.ok(args.some(arg => arg.includes('.network.enabled=false')));
    assert.deepEqual(env, {PATH: '/synthetic/bin', HOME: '/synthetic/home'});
    return {
      notify(method) {assert.equal(method, 'initialized');},
      close() {closed();},
      request(method, params) {
        requests.push(method);
        switch (method) {
          case 'initialize': return Promise.resolve({});
          case 'account/read':
            assert.deepEqual(params, {refreshToken: false});
            accounts += 1;
            return Promise.resolve(accounts === 2 && scenario.laterAuth !== undefined ? scenario.laterAuth : scenario.auth ?? account);
          case 'account/rateLimits/read': return Promise.resolve({rateLimits: window});
          case 'thread/start': {
            const sent = params as {cwd: string; permissions: string; runtimeWorkspaceRoots: string[]};
            assert.equal(sent.cwd, cwd);
            assert.deepEqual(sent.runtimeWorkspaceRoots, [cwd]);
            return Promise.resolve({cwd, thread: {id: threadId}, modelProvider: 'openai', approvalPolicy: 'never',
              activePermissionProfile: {id: sent.permissions}, sandbox: {type: 'workspaceWrite', networkAccess: false, writableRoots: [cwd]}, runtimeWorkspaceRoots: scenario.badPermissions === true ? [cwd, '/other-checkout'] : [cwd]});
          }
          case 'turn/start': {
            starts += 1;
            assert.ok(params !== undefined && 'outputSchema' in params);
            const {outputSchema, ...turn} = params;
            wireSchema = outputSchema;
            assert.deepEqual(turn, {threadId, input: [{type: 'text', text: brief, text_elements: []}]});
            assert.deepEqual(sessions, scenario.requireId === false ? [] : [threadId], 'native identity was reported before the model turn');
            queueMicrotask(() => {
              if (scenario.terminal === 'lost') {closed(); return;}
              event('turn/started', {threadId, turn: {id: turnId}});
              event('account/rateLimits/updated', {rateLimits: window});
              event('item/completed', {threadId: 'other-thread', turnId, item: {type: 'agentMessage', text: '{}'}});
              event('item/completed', {threadId, turnId, item: {type: 'agentMessage', text: scenario.malformed === true ? '{}' : JSON.stringify(report)}});
              if (scenario.changeAuth === true) event('account/updated', {authMode: 'apikey'});
              event('turn/completed', {threadId, turn: {id: turnId, status: scenario.terminal === undefined ? 'completed' : 'failed',
                error: {codexErrorInfo: scenario.terminal}}});
            });
            return Promise.resolve({turn: {id: turnId}});
          }
          default: assert.fail(`unexpected request ${method}`);
        }
      },
    };
  };
  const adapter = codexAdapter({executable: '/synthetic/codex'}, {probeCwd: '/synthetic/repo', transport, version: () => Promise.resolve('0.163.0'),
    environment: {PATH: '/synthetic/bin', HOME: '/synthetic/home', OPENAI_API_KEY: 'synthetic-key', CODEX_HOME: '/untrusted/config',
      BUNNY_CODING_TOKEN: 'worker-credential', CLAUDE_CODE_OAUTH_TOKEN: 'other-provider-token'}});
  const run = (worktree: string) => adapter.run({worktree, brief, bounds, signal: new AbortController().signal, session: id => {sessions.push(id);}});
  return {adapter, requests, sessions, run, starts: () => starts, output: () => wireSchema};
}

void test('Codex readiness reports only subscription fields, plan and quota without opening a thread', async () => {
  const {adapter, requests} = fixture();
  assert.deepEqual(await adapter.readiness(), {installed: 'yes', signedIn: 'yes', version: '0.163.0', plan: 'plus',
    windows: [{window: 'primary-300m', status: 'rejected', utilization: 100, resetsAtMs: 1_800_000_000_000}]});
  assert.deepEqual(requests, ['initialize', 'account/read', 'account/rateLimits/read']);
  assert.deepEqual(codexEnvironment({HOME: '/synthetic/home', OPENAI_BASE_URL: 'https://invalid.example',
    CODEX_API_KEY: 'synthetic-key', SSH_AUTH_SOCK: '/private/socket'}), {HOME: '/synthetic/home'});
});

void test('Codex sends one bounded model turn after confirmed worktree scope and early session identity', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const {run, starts, output} = fixture();
  const evidence = await run(cwd);
  assert.equal(starts(), 1);
  assert.ok(output() !== undefined);
  assertStrictOutputSchema(output());
  assert.equal(evidence.sessionId, threadId);
  assert.deepEqual(evidence.structured, report);
  assert.equal(evidence.usage?.costUsd, null);
});

void test('Codex refuses signed-out, API key, unknown credentials and broadened worktree authority before model work', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  for (const scenario of [
    {auth: {requiresOpenaiAuth: true, account: null}},
    {auth: {requiresOpenaiAuth: true, account: {type: 'apiKey'}}},
    {auth: {requiresOpenaiAuth: false, account: account.account}},
    {badPermissions: true},
    {laterAuth: {requiresOpenaiAuth: true, account: {type: 'apiKey'}}},
  ]) {
    const {run, starts} = fixture(scenario);
    assert.equal((await run(cwd)).reason, 'refused');
    assert.equal(starts(), 0);
  }
  const missing = codexAdapter({executable: '/nonexistent/codex'}, {probeCwd: cwd});
  assert.equal((await missing.readiness()).installed, 'no');
});

void test('Codex distinguishes plan exhaustion, provider slowdown, unreadable output and loss after start', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const exhausted = await fixture({terminal: 'usageLimitExceeded'}).run(cwd);
  assert.deepEqual(exhausted.limit, {window: 'primary-300m', resetsAtMs: 1_800_000_000_000});
  assert.equal(exhausted.reason, 'usage-limit');
  for (const terminal of ['rateLimitExceeded', 'serverOverloaded'] as const) {
    const evidence = await fixture({terminal}).run(cwd);
    assert.equal(evidence.reason, 'exit');
    assert.equal(evidence.limit, undefined);
  }
  assert.equal((await fixture({malformed: true}).run(cwd)).reason, 'invalid-output');
  const lost = fixture({terminal: 'lost'});
  const evidence = await lost.run(cwd);
  assert.equal(evidence.reason, 'lost');
  assert.equal(evidence.uncertain, true);
  assert.equal(evidence.sessionId, threadId);
  assert.equal(lost.starts(), 1);
  const changed = await fixture({changeAuth: true}).run(cwd);
  assert.equal(changed.reason, 'refused');
  assert.equal(changed.uncertain, true);
});

void test('the production Codex transport reads a disposable scripted process over stdio', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-process-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const executable = join(cwd, 'codex-fixture');
  await writeFile(executable, `#!${process.execPath}
const lines = require('node:readline').createInterface({input: process.stdin});
if (process.argv.includes('--version')) {console.log('codex-cli 0.163.0'); process.exit(0);}
lines.on('line', line => {
  const {id, method} = JSON.parse(line);
  if (method === 'initialize') console.log(JSON.stringify({id, result: {}}));
  if (method === 'account/read') console.log(JSON.stringify({id, result: {requiresOpenaiAuth: true, account: null}}));
});
`, {mode: 0o700});
  const adapter = codexAdapter({executable}, {probeCwd: cwd});
  assert.deepEqual(await adapter.readiness(), {installed: 'yes', signedIn: 'no', version: '0.163.0', plan: null});
});
