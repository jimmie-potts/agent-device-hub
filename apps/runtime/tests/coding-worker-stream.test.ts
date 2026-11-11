// The coding worker against what headless Claude Code really emits (Hub #1743). `recorded-*` fixtures are real
// `claude -p --output-format stream-json --verbose` runs and status commands, recorded with synthetic prompts in an empty
// directory and scrubbed of identifiers, paths and account values before they entered Git. `constructed-*` fixtures are
// not recordings: a real usage limit cannot be provoked, so they follow the event shapes the tool's own stream schema
// documents (`rate_limit_event` with status `rejected`; an assistant message typed `usage_limit_reached` with
// `api_error_params.rate_limit_info`), and a signed-out status follows `claude auth status --json`'s recorded shape.
// Every case goes through the real parsing code. No real `claude`, edge or network; no test waits on the clock except
// the probe-deadline case, whose subject is the deadline itself.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {CodingEndpointControl, CodingProgress, CodingWork} from '@jimmie-potts/event-contracts/v2/coding';
import {MessageValidator} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {Command, Reply} from '@jimmie-potts/sdk';
import type {RemoteEndpoint, RemoteEndpointOptions, RemoteParticipant, connectRemote} from '@jimmie-potts/sdk/remote';
import {ClaudeStream, harnessEnvironment, parseAuthStatus, parseVersion, settingsRefusal} from '../src/worker/claude-stream.js';
import {CodingWorker, DEFAULT_ALLOWED_TOOLS, assembleResult, claudeHarness, parseConfiguration, projectSettingsRefusal, type Harness} from '../src/worker/coding-worker.js';

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

/**
 * What would make a fixture unfit for Git: a home or temporary path, an e-mail address, a token-like string, a UUID or a
 * tool-use, message or request identifier that is not synthetic, an account or organization member that is not
 * `redacted`, or a working or configuration directory that is not synthetic. Returns each problem found.
 */
function fixtureProblems(name: string, text: string): string[] {
  const problems: string[] = [];
  if (/(?:^|[^A-Za-z0-9])\/(?:Users|home|private|tmp|var\/folders|var\/tmp)\//.test(text)) problems.push(`${name}: home or temporary path`);
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(text)) problems.push(`${name}: e-mail address`);
  if (/sk-ant-|\beyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9+/_-]{40,}/.test(text)) problems.push(`${name}: token-like string`);
  for (const uuid of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []) {
    if (!uuid.startsWith('00000000-0000-4000-8000-')) problems.push(`${name}: identifier ${uuid.slice(0, 8)}… is not synthetic`);
  }
  // Tool-use identifiers anywhere; message and request identifiers by their opaque shape (capability names such as `msg_lifecycle_v1` are not identifiers).
  for (const id of text.match(/\btoolu_[A-Za-z0-9_]+|\b(?:msg|req)_[A-Za-z0-9]{10,}\b/g) ?? []) {
    if (!/^(?:toolu|msg|req)_synthetic/.test(id)) problems.push(`${name}: identifier ${id.slice(0, 6)}… is not synthetic`);
  }
  if (!name.endsWith('.json') && !name.endsWith('.jsonl')) return problems;
  for (const line of name.endsWith('.jsonl') ? text.trim().split('\n') : [text]) {
    const walk = (node: unknown, key?: string): void => {
      if (Array.isArray(node)) {node.forEach(item => {walk(item, key);}); return;}
      if (typeof node === 'object' && node !== null) {for (const [child, item] of Object.entries(node)) walk(item, child); return;}
      if (key !== undefined && /email|account|org(?:anization)?(?:Id|Uuid|Name)|organization/i.test(key) && !/overage/i.test(key) && node !== 'redacted') problems.push(`${name}: ${key} is not redacted`);
      if (typeof node === 'string' && (key === 'cwd' || key === 'configDirectory' || key === 'projectsDirectory') && !node.startsWith('/synthetic/')) problems.push(`${name}: ${key} is not synthetic`);
    };
    walk(JSON.parse(line) as unknown);
  }
  return problems;
}

void test('the fixtures hold no path, e-mail address, token, account value or identifier that is not synthetic', async () => {
  const names = await readdir(FIXTURES);
  assert.ok(names.filter(name => name.startsWith('recorded-')).length >= 4, names.join(', '));
  for (const name of names) assert.deepEqual(fixtureProblems(name, await fixture(name)), [], name);
});

void test('the fixture guard catches each kind of planted leak (negative controls)', async () => {
  const recorded = await fixture('recorded-success.jsonl');
  const planted: [string, string][] = [
    ['home path', recorded.replace('/synthetic/worktree', '/Users/someone/work')],
    ['temporary path', recorded.replace('/synthetic/worktree', '/tmp/someone/scratch')],
    ['e-mail address', '{"email": "someone@example.com"}'],
    ['subscription token', '{"note": "sk-ant-oat01-synthetic"}'],
    ['API key', '{"note": "sk-ant-api03-synthetic"}'],
    ['JWT', '{"note": "eyJhbGciOiJIUzI1NiJ9.synthetic"}'],
    ['opaque run', `{"note": "${'Ab9'.repeat(20)}"}`],
    ['account member', '{"accountUuid": "synthetic"}'],
    ['organization member', '{"organizationUuid": "synthetic"}'],
    ['session identifier', recorded.replace('00000000-0000-4000-8000-0000000000a1', '4f8a2c1e-0b3d-4e5f-8a9b-1c2d3e4f5a6b')],
    ['tool-use identifier', recorded.replace(/toolu_synthetic\d+/g, 'toolu_01AbCdEfGh')],
    ['message identifier', recorded.replace('msg_synthetic1', 'msg_01AbCdEfGh')],
  ];
  for (const [kind, text] of planted) {
    assert.notEqual(text, recorded, `${kind}: the plant changed the fixture`);
    assert.notDeepEqual(fixtureProblems('planted.jsonl', text), [], kind);
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
  // The run's own later stop wins over an earlier limit event: a budget stop is budget, a turn cap is not a limit.
  const rejected = (await fixture('constructed-usage-limit.jsonl')).split('\n').slice(0, 2).join('\n');
  const budget = assembleResult('agent-device-hub', null, null, [], `${rejected}\n${JSON.stringify({type: 'result', subtype: 'error_max_budget_usd', is_error: true, num_turns: 9})}`);
  assert.equal(budget.reason, 'budget'); assert.equal(budget.result.outcome, 'failed'); assert.equal(budget.result.limit, undefined);
  const turns = assembleResult('agent-device-hub', null, null, [], `${rejected}\n${JSON.stringify({type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 60})}`);
  assert.equal(turns.reason, undefined); assert.equal(turns.result.limit, undefined);
});

void test('a key source or a provider other than the subscription is stated; a key source stops a run at its first event (constructed init)', async t => {
  // Constructed, not recorded: an init event naming an API key source, as the stream schema allows.
  const init = JSON.stringify({type: 'system', subtype: 'init', session_id: '00000000-0000-4000-8000-0000000000d1', apiKeySource: 'ANTHROPIC_API_KEY'});
  const result = (await fixture('recorded-success.jsonl')).trim().split('\n').at(-1) ?? '';
  const keyed = assembleResult('agent-device-hub', null, null, [], `${init}\n${result}`);
  assert.ok(keyed.result.limitations.some(text => text.includes('API key source (ANTHROPIC_API_KEY)')), JSON.stringify(keyed.result.limitations));
  const bedrock = result.replace('"provider":"firstParty"', '"provider":"bedrock"');
  assert.notEqual(bedrock, result, 'the recorded result names its provider');
  assert.ok(assembleResult('agent-device-hub', null, null, [], bedrock).result.limitations.some(text => text.includes('provider other than the first-party one (bedrock)')));

  const repo = await repository(t), edge = eventEdge();
  let rest = 0, killed = 0;
  const harness: Harness = {start: (_args, _cwd, _input, onChild, onLine) => {
    onChild({kill: () => {killed += 1; return true;}} as never);
    onLine?.(init);
    // Whatever the tool would have done after its first event never counts.
    if (killed === 0) rest += 1;
    return Promise.resolve({code: null, signal: 'SIGTERM', truncated: false});
  }};
  const worker = new CodingWorker(configuration(repo), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect, () => NOW);
  await worker.start();
  assert.deepEqual(edge.respond(start('task-k')), {status: 'accepted'});
  await edge.until(() => edge.progress.length === 2);
  const ended = edge.progress[1];
  assert.equal(killed, 1); assert.equal(rest, 0);
  assert.ok(ended?.status === 'failed'); assert.equal(ended.reason, 'refused'); assert.equal(ended.result?.outcome, 'failed');
  assert.match(ended.result?.summary ?? '', /stopped at its first event: the tool reported the API key source ANTHROPIC_API_KEY/);
  admitted('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', ended);
  await worker.stop();
});

void test('project settings that would undo the harness environment refuse the run before the tool starts; clean ones pass', async t => {
  const cases: [string, string | undefined, RegExp | undefined][] = [
    ['absent', undefined, undefined],
    ['clean', JSON.stringify({permissions: {allow: ['Read']}, env: {MAX_THINKING_TOKENS: '1000', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '2000'}}), undefined],
    ['API key', JSON.stringify({env: {ANTHROPIC_API_KEY: 'synthetic'}}), /provider or credential variable ANTHROPIC_API_KEY/],
    ['base URL', JSON.stringify({env: {ANTHROPIC_BASE_URL: 'http://example.invalid'}}), /ANTHROPIC_BASE_URL/],
    ['provider switch', JSON.stringify({env: {CLAUDE_CODE_USE_BEDROCK: '1'}}), /CLAUDE_CODE_USE_BEDROCK/],
    ['cloud credential', JSON.stringify({env: {AWS_PROFILE: 'synthetic'}}), /AWS_PROFILE/],
    ['other token', JSON.stringify({env: {SERVICE_TOKEN: 'synthetic'}}), /SERVICE_TOKEN/],
    ['key helper', JSON.stringify({apiKeyHelper: '/bin/echo synthetic'}), /credential helper apiKeyHelper/],
    ['cloud refresh', JSON.stringify({awsAuthRefresh: 'synthetic', gcpAuthRefresh: 'synthetic'}), /credential helper awsAuthRefresh, gcpAuthRefresh/],
    ['credential export', JSON.stringify({awsCredentialExport: 'synthetic'}), /awsCredentialExport/],
    ['malformed', '{"env": ', /is not valid JSON/],
    ['not an object', '[]', /is not a JSON object/],
    ['env not an object', JSON.stringify({env: ['ANTHROPIC_API_KEY']}), /env member that is not an object/],
  ];
  for (const [kind, text, refused] of cases) {
    const reason = settingsRefusal('.claude/settings.json', text);
    if (refused === undefined) assert.equal(reason, undefined, kind); else assert.match(reason ?? '', refused, kind);
  }
  // Values never enter the reason.
  assert.doesNotMatch(settingsRefusal('.claude/settings.json', JSON.stringify({env: {ANTHROPIC_API_KEY: 'sk-ant-api03-synthetic'}})) ?? '', /sk-ant/);

  // Through the worker: a committed settings file with a key refuses the run and the tool never starts; the local file counts too.
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    const repo = await repository(t), edge = eventEdge();
    await mkdir(join(repo, '.claude'), {recursive: true});
    await writeFile(join(repo, file), JSON.stringify({env: {ANTHROPIC_API_KEY: 'synthetic'}}));
    if (file === '.claude/settings.json') {git(repo, 'add', '.'); git(repo, 'commit', '--quiet', '-m', 'settings'); git(repo, 'push', '--quiet', 'origin', 'main');}
    let started = 0;
    const harness: Harness = {start: () => {started += 1; return Promise.resolve({code: 0, signal: null, truncated: false});}};
    const worker = new CodingWorker(configuration(repo), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect, () => NOW);
    await worker.start();
    if (file === '.claude/settings.local.json') {
      // A local file is not committed, so it reaches a fresh worktree only if something writes it there: plant it through the worktree check directly.
      assert.match(await projectSettingsRefusal(repo) ?? '', /settings\.local\.json sets the provider or credential variable ANTHROPIC_API_KEY/);
      await worker.stop();
      continue;
    }
    assert.deepEqual(edge.respond(start('task-s')), {status: 'accepted'});
    await edge.until(() => edge.progress.length === 2);
    const ended = edge.progress[1];
    assert.equal(started, 0, 'the tool never started');
    assert.ok(ended?.status === 'failed'); assert.equal(ended.reason, 'refused');
    assert.match(ended.result?.summary ?? '', /refused before the tool started: \.claude\/settings\.json sets the provider or credential variable ANTHROPIC_API_KEY/);
    admitted('coding-progress', 'occurrence', 'org.bunny.coding.progress.observed', ended);
    await worker.stop();
  }
});

void test('readiness is read from the recorded status commands; signed out and unreadable answers say so or stay unknown', async () => {
  assert.equal(parseVersion(await fixture('recorded-version.txt')), '2.1.292');
  assert.deepEqual(parseAuthStatus(await fixture('recorded-auth-status.json')), {signedIn: 'yes', plan: 'synthetic'});
  assert.deepEqual(parseAuthStatus(await fixture('constructed-auth-signed-out.json')), {signedIn: 'no', plan: null});
  for (const output of ['', 'not json', '[]', '{"loggedIn": "yes"}']) assert.deepEqual(parseAuthStatus(output), {signedIn: 'unknown', plan: null}, output);
  const subscription = {loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty'};
  assert.deepEqual(parseAuthStatus(JSON.stringify({...subscription, subscriptionType: 'Not A Plan!'})), {signedIn: 'yes', plan: null});
  // Signed in some other way is not the subscription: unknown, with no plan.
  for (const other of [{authMethod: 'api_key'}, {authMethod: 'apiKeyHelper'}, {apiProvider: 'bedrock'}, {apiProvider: 'vertex'}, {authMethod: undefined}]) {
    assert.deepEqual(parseAuthStatus(JSON.stringify({...subscription, subscriptionType: 'pro', ...other})), {signedIn: 'unknown', plan: null}, JSON.stringify(other));
  }
  assert.equal(parseVersion('command not found'), null);
});

/** Every name the denylist must stop, with one example per family of variable. */
const STRIPPED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_FOUNDRY_API_KEY', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CONFIG_DIR', 'AWS_BEARER_TOKEN_BEDROCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_PROFILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUD_ML_REGION', 'HTTPS_PROXY', 'HTTP_PROXY',
  'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'BUNNY_EDGE_TOKEN'];
const synthetic = (names: readonly string[]): Record<string, string> => Object.fromEntries(names.map(name => [name, 'synthetic']));

void test('the harness environment is an allowlist plus configured names, with the denylist as a second pass', () => {
  const kept = harnessEnvironment({PATH: '/bin', HOME: '/synthetic/home', USER: 'owner', LOGNAME: 'owner', SHELL: '/bin/sh', TMPDIR: '/synthetic/tmp', LANG: 'C', LC_ALL: 'C', TERM: 'dumb',
    CLAUDE_CODE_OAUTH_TOKEN: 'synthetic', EDITOR: 'vi', SOME_TOOL_HOME: '/synthetic', anthropic_api_key: 'synthetic', ...synthetic(STRIPPED)}, ['SOME_TOOL_HOME', 'HTTPS_PROXY']);
  // The subscription token stays: it is a sign-in, not an API key. A configured name passes unless the denylist stops it.
  assert.deepEqual(Object.keys(kept).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'SOME_TOOL_HOME', 'TERM', 'TMPDIR', 'USER']);
  assert.throws(() => parseConfiguration({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: '/tmp/repo'}],
    claude: {executable: '/nonexistent/claude', environment: ['AWS_PROFILE']}}), /claude\.environment/);
  assert.deepEqual(parseConfiguration({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: '/tmp/repo'}],
    claude: {executable: '/nonexistent/claude', environment: ['SOME_TOOL_HOME']}}).claude.environment, ['SOME_TOOL_HOME']);
});

/**
 * A stand-in executable that prints the names in its environment for a run, and answers the two status commands from
 * the recordings, except that its sign-in status says signed out when any stripped name reached it.
 */
async function fakeClaude(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'coding-worker-claude-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'claude');
  await writeFile(file, ['#!/bin/sh', 'if [ "$1" = "--version" ]; then cat "$FIXTURE_DIR/recorded-version.txt"; exit 0; fi',
    `if [ "$1" = "auth" ]; then if env | cut -d= -f1 | grep -q -x -E '${STRIPPED.join('|')}'; then cat "$FIXTURE_DIR/constructed-auth-signed-out.json"; exit 1; fi; cat "$FIXTURE_DIR/recorded-auth-status.json"; exit 0; fi`,
    'cat > /dev/null', 'env | cut -d= -f1', ''].join('\n'));
  await chmod(file, 0o755);
  return file;
}

void test('with API keys in the worker\'s environment the real harness and its readiness probe start the tool without them', async t => {
  const executable = await fakeClaude(t);
  const environment = {PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/synthetic/home', FIXTURE_DIR: FIXTURES, NOT_LISTED: '1', CLAUDE_CODE_OAUTH_TOKEN: 'synthetic', ...synthetic(STRIPPED)};
  const harness = claudeHarness(executable, environment, {environment: ['FIXTURE_DIR']});
  const names: string[] = [];
  const finished = await harness.start(['--print'], tmpdir(), 'brief', () => {}, line => {names.push(line);});
  assert.deepEqual(finished, {code: 0, signal: null, truncated: false});
  assert.ok(names.includes('FIXTURE_DIR') && names.includes('PATH') && names.includes('CLAUDE_CODE_OAUTH_TOKEN'), names.join(','));
  assert.ok(!names.includes('NOT_LISTED'), 'an unlisted variable reached the harness');
  for (const stripped of STRIPPED) assert.ok(!names.includes(stripped), `${stripped} reached the harness`);
  // The stand-in's status says signed out if any stripped name reached the probe; it says signed in, so none did.
  assert.deepEqual(await harness.readiness?.(), {installed: 'yes', version: '2.1.292', signedIn: 'yes', plan: 'synthetic'});
  // Negative control for the stand-in: given the stripped names directly, its status is signed out.
  assert.throws(() => execFileSync(executable, ['auth', 'status'], {env: environment, encoding: 'utf8'}), (error: {stdout?: string}) => /"loggedIn": false/.test(error.stdout ?? ''));
  assert.deepEqual(await claudeHarness('/nonexistent/claude', environment).readiness?.(), {installed: 'no', version: null, signedIn: 'unknown', plan: null});
});

void test('a worker started without a harness uses the process environment through the same filter', {timeout: 60_000}, async t => {
  const executable = await fakeClaude(t), repo = await repository(t), edge = eventEdge();
  const saved = {...process.env};
  t.after(() => {for (const name of Object.keys(process.env)) if (!(name in saved)) Reflect.deleteProperty(process.env, name); Object.assign(process.env, saved);});
  Object.assign(process.env, {FIXTURE_DIR: FIXTURES, ...synthetic(STRIPPED)});
  const config = parseConfiguration({schema: 'coding-worker/1.0', edge: 'http://127.0.0.1:18788', tokenFile: '/private/token', repositories: [{name: 'agent-device-hub', path: repo}],
    claude: {executable, permissionMode: 'acceptEdits', allowedTools: DEFAULT_ALLOWED_TOOLS, environment: ['FIXTURE_DIR']}});
  const worker = new CodingWorker(config, 'token-'.padEnd(43, 'x'), undefined, () => {}, edge.connect, () => NOW);
  await worker.start();
  assert.equal(edge.requests[0]?.readiness?.signedIn, 'yes', 'no stripped name reached the probe from the process environment');
  await worker.stop();
});

void test('the real harness splits lines across chunks, counts noise, skips an oversized event and keeps an unterminated last line', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'coding-worker-lines-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'claude');
  const result = JSON.stringify({type: 'result', subtype: 'success', is_error: false, num_turns: 1, structured_output: {outcome: 'tested-candidate', summary: 'Done.', checks: [], findings: [], limitations: []}});
  await writeFile(file, ['#!/bin/sh', 'cat > /dev/null', 'printf \'not json\\n\'', 'printf \'{"type":"system",\'', 'printf \'"subtype":"init","apiKeySource":"none"}\\n\'',
    // One event over the per-line bound: skipped, and the next line still arrives.
    'printf \'{"type":"assistant","x":"\'', 'head -c 4200000 /dev/zero | tr "\\0" "x"', 'printf \'"}\\n\'',
    `printf '%s\\n' '${result}'`, 'printf \'{"type":"system","subtype":"tail"}\'', ''].join('\n'));
  await chmod(file, 0o755);
  const lines: string[] = [];
  const finished = await claudeHarness(file, {PATH: process.env.PATH ?? '/usr/bin:/bin'}).start([], dir, '', () => {}, line => {lines.push(line);});
  assert.equal(finished.truncated, true);
  assert.deepEqual(lines, ['not json', '{"type":"system","subtype":"init","apiKeySource":"none"}', result, '{"type":"system","subtype":"tail"}']);
  const stream = new ClaudeStream(); for (const line of lines) stream.push(line);
  assert.equal(stream.unreadable, 1); assert.equal(stream.apiKeySource, 'none'); assert.equal(stream.result?.subtype, 'success');
});

void test('a skipped oversized event fails the run only when no result arrived', {timeout: 60_000}, async t => {
  const result = (await fixture('recorded-success.jsonl')).trim().split('\n').at(-1) ?? '';
  for (const [lines, expected] of [[[result], 'completed'], [[], 'invalid-output']] as const) {
    const repo = await repository(t), edge = eventEdge();
    const harness: Harness = {start: (_args, _cwd, _input, _onChild, onLine) => {for (const line of lines) onLine?.(line); return Promise.resolve({code: 0, signal: null, truncated: true});}};
    const worker = new CodingWorker(configuration(repo), 'token-'.padEnd(43, 'x'), harness, () => {}, edge.connect, () => NOW);
    await worker.start();
    assert.deepEqual(edge.respond(start('task-t')), {status: 'accepted'});
    await edge.until(() => edge.progress.length === 2);
    const ended = edge.progress[1];
    assert.equal(ended?.status === 'failed' ? ended.reason : ended?.status, expected);
    await worker.stop();
  }
});

void test('a readiness probe that ignores the terminate signal is killed at its deadline and reads unknown', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'coding-worker-hang-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'claude');
  // No child process: the shell itself spins, ignoring SIGTERM, so only SIGKILL ends it.
  await writeFile(file, ['#!/bin/sh', 'if [ "$1" = "--version" ]; then echo "2.1.292 (Claude Code)"; exit 0; fi', 'trap "" TERM', 'while :; do :; done', ''].join('\n'));
  await chmod(file, 0o755);
  // The deadline under test is the bound itself, not a wait for something to happen.
  const readiness = await claudeHarness(file, {PATH: process.env.PATH ?? '/usr/bin:/bin'}, {probeMs: 150}).readiness?.();
  assert.deepEqual(readiness, {installed: 'yes', version: '2.1.292', signedIn: 'unknown', plan: null});
});


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
