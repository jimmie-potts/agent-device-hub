import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, test} from 'node:test';
import {codexAdapter, codexEnvironment, type CodexTransport} from '../src/worker/codex-adapter.js';

const profileHome = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-profile-')));
after(() => rm(profileHome, {recursive: true, force: true}));

const threadId = '11111111-2222-4333-8444-555555555555';
const turnId = 'synthetic-turn';
const brief = 'Review the pinned revision and report checks.';
const account = {requiresOpenaiAuth: true, account: {type: 'chatgpt', planType: 'plus', email: 'synthetic@example.invalid'},
  workspaceRouting: {backendOrigin: 'https://chatgpt.com', accountRoutingOverride: 'NO_CONSTRAINT', chatgptAccountId: 'synthetic-account'}};
const window = {primary: {usedPercent: 100, resetsAt: 1_800_000_000, windowDurationMins: 300}};
const report = {outcome: 'tested-candidate', summary: 'Reviewed the requested revision.', checks: [
  {name: 'git diff', status: 'passed', detail: null}, {name: 'npm test', status: 'skipped', detail: 'No fixture dependencies installed.'},
], findings: [], limitations: []};
const bounds = {wallClockMs: 120_000, maxTurns: 3, budgetUsd: 2};
const safeConfig = {mcp_servers: {}, plugins: {}, hooks: null, allow_login_shell: false, cli_auth_credentials_store: 'file',
  forced_login_method: 'chatgpt', model_provider: 'openai', chatgpt_base_url: 'https://chatgpt.com/backend-api/', openai_base_url: 'https://api.openai.com/v1',
  otel: {exporter: 'none', trace_exporter: 'none', metrics_exporter: 'none', log_user_prompt: false},
  features: {hooks: false, apps: false, plugins: false, shell_snapshot: false}};

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
  effectiveConfig?: object; auth?: unknown; laterAuth?: unknown; requireId?: boolean; malformed?: boolean; badPermissions?: boolean; changeAuth?: boolean;
  terminal?: 'usageLimitExceeded' | 'rateLimitExceeded' | 'serverOverloaded' | 'lost';
};

function fixture(scenario: Scenario = {}, home = profileHome, environment: NodeJS.ProcessEnv = {}) {
  const storage = {sqlite_home: join(home, 'sqlite'), log_dir: join(home, 'log')};
  const requests: string[] = [], sessions: string[] = [];
  let starts = 0, accounts = 0;
  let wireSchema: unknown;
  const transport: CodexTransport = ({args, cwd, env, event, closed}) => {
    assert.ok(args.includes('forced_login_method="chatgpt"'));
    assert.ok(args.includes('model_provider="openai"'));
    assert.ok(args.includes('features.hooks=false'));
    assert.ok(args.includes('features.plugins=false'));
    assert.ok(args.includes('features.shell_snapshot=false'));
    assert.ok(args.includes('allow_login_shell=false'));
    assert.ok(args.includes('cli_auth_credentials_store="file"'));
    assert.ok(args.includes('mcp_servers={}'));
    assert.ok(args.includes(`sqlite_home=${JSON.stringify(storage.sqlite_home)}`));
    assert.ok(args.includes(`log_dir=${JSON.stringify(storage.log_dir)}`));
    assert.ok(args.some(arg => arg.includes('.network.enabled=false')));
    assert.ok(args.some(arg => arg.includes(`${JSON.stringify(join(home, 'auth.json'))}="deny"`)));
    assert.equal(cwd, home, 'app-server starts outside the worktree');
    assert.deepEqual(env, {PATH: '/synthetic/bin', HOME: home, CODEX_HOME: home, SHELL: '/bin/sh'});
    return {
      notify(method) {assert.equal(method, 'initialized');},
      close() {closed();},
      request(method, params) {
        requests.push(method);
        switch (method) {
          case 'initialize': return Promise.resolve({});
          case 'config/read':
            assert.ok(params !== undefined && 'cwd' in params && typeof params.cwd === 'string');
            assert.deepEqual(params, {cwd: params.cwd, includeLayers: false});
            return Promise.resolve({config: {...storage, ...(scenario.effectiveConfig ?? safeConfig)}});
          case 'account/read':
            assert.deepEqual(params, {refreshToken: false});
            accounts += 1;
            return Promise.resolve(accounts === 2 && scenario.laterAuth !== undefined ? scenario.laterAuth : scenario.auth ?? account);
          case 'account/rateLimits/read': return Promise.resolve({rateLimits: window});
          case 'thread/start': {
            const sent = params as {cwd: string; permissions: string; runtimeWorkspaceRoots: string[]};
            assert.notEqual(sent.cwd, home);
            assert.deepEqual(sent.runtimeWorkspaceRoots, [sent.cwd]);
            return Promise.resolve({cwd: sent.cwd, thread: {id: threadId}, modelProvider: 'openai', approvalPolicy: 'never',
              activePermissionProfile: {id: sent.permissions}, sandbox: {type: 'workspaceWrite', networkAccess: false, writableRoots: [sent.cwd]}, runtimeWorkspaceRoots: scenario.badPermissions === true ? [sent.cwd, '/other-checkout'] : [sent.cwd]});
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
  const adapter = codexAdapter({executable: '/synthetic/codex', home}, {transport, version: () => Promise.resolve('0.163.0'),
    environment: {PATH: '/synthetic/bin', HOME: '/synthetic/home', OPENAI_API_KEY: 'synthetic-key', CODEX_HOME: '/untrusted/config',
      BUNNY_CODING_TOKEN: 'worker-credential', CLAUDE_CODE_OAUTH_TOKEN: 'other-provider-token', ...environment}});
  const run = (worktree: string) => adapter.run({worktree, brief, bounds, signal: new AbortController().signal, session: id => {sessions.push(id);}});
  return {adapter, requests, sessions, run, starts: () => starts, output: () => wireSchema};
}

void test('Codex readiness reports only subscription fields, plan and quota without opening a thread', async () => {
  const {adapter, requests} = fixture();
  assert.deepEqual(await adapter.readiness(), {installed: 'yes', signedIn: 'yes', version: '0.163.0', plan: 'plus',
    windows: [{window: 'primary-300m', status: 'rejected', utilization: 100, resetsAtMs: 1_800_000_000_000}]});
  assert.deepEqual(requests, ['initialize', 'config/read', 'account/read', 'account/rateLimits/read']);
  assert.deepEqual(codexEnvironment({HOME: '/synthetic/home', OPENAI_BASE_URL: 'https://invalid.example',
    CODEX_API_KEY: 'synthetic-key', SSH_AUTH_SOCK: '/private/socket'}, profileHome), {HOME: profileHome, CODEX_HOME: profileHome, SHELL: '/bin/sh'});
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

void test('Codex refuses effective MCP or plugin configuration before probing auth or opening a thread', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  for (const effectiveConfig of [
    {...safeConfig, mcp_servers: {synthetic: {command: '/usr/bin/false'}}},
    {...safeConfig, plugins: {'synthetic@test': {enabled: true}}},
    {...safeConfig, features: {...safeConfig.features, shell_snapshot: true}},
    {...safeConfig, log_dir: '/synthetic/redirected'},
    {...safeConfig, sqlite_home: '/synthetic/redirected'},
    {...safeConfig, cli_auth_credentials_store: 'keyring'},
    {...safeConfig, model_provider: 'custom'},
    {...safeConfig, chatgpt_base_url: 'https://synthetic.invalid/backend-api/'},
    {...safeConfig, otel: {exporter: {otlp_http: {endpoint: 'https://synthetic.invalid'}}}},
    {},
  ]) {
    const probe = fixture({effectiveConfig});
    assert.equal((await probe.adapter.readiness()).signedIn, 'unknown');
    assert.deepEqual(probe.requests, ['initialize', 'config/read']);
    const run = fixture({effectiveConfig});
    assert.equal((await run.run(cwd)).reason, 'refused');
    assert.deepEqual(run.requests, ['initialize', 'config/read']);
    assert.equal(run.starts(), 0);
  }
});

void test('a worker profile containing user configuration refuses both entry points before app-server starts', async t => {
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'bunny-forbidden-codex-profile-')));
  t.after(() => rm(profile, {recursive: true, force: true}));
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await writeFile(join(profile, 'config.toml'), '[mcp_servers.synthetic]\ncommand = "/usr/bin/false"\n');
  const candidate = fixture({}, profile);
  assert.equal((await candidate.adapter.readiness()).signedIn, 'unknown');
  assert.equal((await candidate.run(cwd)).reason, 'refused');
  assert.deepEqual(candidate.requests, []);
});

void test('canonical personal Codex profile aliases refuse both entry points without starting app-server', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-aliases-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const home = join(root, 'worker'), user = join(root, 'user'), worktree = join(root, 'worktree');
  for (const path of [home, user, worktree]) await mkdir(path, {mode: 0o700});
  const alias = join(root, 'alias');
  await symlink(home, alias);
  await symlink(home, join(user, '.codex'));
  for (const environment of [{CODEX_HOME: alias}, {HOME: user}]) {
    const candidate = fixture({}, home, environment);
    assert.equal((await candidate.run(worktree)).reason, 'refused');
    assert.equal((await candidate.adapter.readiness()).signedIn, 'unknown');
    assert.deepEqual(candidate.requests, []);
  }
});

void test('Codex refuses a foreign session-store alias before app-server startup', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-storage-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const home = join(root, 'worker'), sessions = join(root, 'elsewhere'), worktree = join(root, 'worktree');
  for (const path of [home, sessions, worktree]) await mkdir(path, {mode: 0o700});
  await symlink(sessions, join(home, 'sessions'));
  const candidate = fixture({}, home);
  assert.equal((await candidate.adapter.readiness()).signedIn, 'unknown');
  assert.equal((await candidate.run(worktree)).reason, 'refused');
  assert.deepEqual(candidate.requests, []);
});

void test('Codex refuses signed-out, API key, unknown credentials and broadened worktree authority before model work', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-worktree-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  for (const scenario of [
    {auth: {requiresOpenaiAuth: true, account: null}},
    {auth: {requiresOpenaiAuth: true, account: {type: 'apiKey'}}},
    {auth: {requiresOpenaiAuth: false, account: account.account}},
    {auth: {...account, account: {...account.account, planType: 'business'}}},
    {auth: {...account, workspaceRouting: {backendOrigin: 'https://synthetic.invalid'}}},
    {badPermissions: true},
    {laterAuth: {requiresOpenaiAuth: true, account: {type: 'apiKey'}}},
  ]) {
    const {run, starts} = fixture(scenario);
    assert.equal((await run(cwd)).reason, 'refused');
    assert.equal(starts(), 0);
  }
  const missing = codexAdapter({executable: '/nonexistent/codex', home: profileHome}, {});
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

void test('the production Codex transport supports a standalone CLI without a startup inspection flag', async t => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'bunny-codex-process-')));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  const executable = join(cwd, 'codex-fixture');
  await writeFile(executable, `#!${process.execPath}
const lines = require('node:readline').createInterface({input: process.stdin});
if (process.argv.includes('--version')) {console.log('codex-cli 0.163.0'); process.exit(0);}
if (process.argv.includes('--print-startup-config')) process.exit(2);
lines.on('line', line => {
  const {id, method} = JSON.parse(line);
  if (method === 'initialize') console.log(JSON.stringify({id, result: {}}));
  if (method === 'config/read') console.log(JSON.stringify({id, result: {config: ${JSON.stringify({...safeConfig, sqlite_home: join(profileHome, 'sqlite'), log_dir: join(profileHome, 'log')})}}}));
  if (method === 'account/read') console.log(JSON.stringify({id, result: {requiresOpenaiAuth: true, account: null}}));
});
`, {mode: 0o700});
  const adapter = codexAdapter({executable, home: profileHome}, {});
  assert.deepEqual(await adapter.readiness(), {installed: 'yes', signedIn: 'no', version: '0.163.0', plan: null});
});
