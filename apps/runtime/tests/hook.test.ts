// The 2.0 agent hook (Hub #926): `bin/monitor-hook.mjs` reads an unchanged lifecycle 1.x producer file and publishes one
// lifecycle observation to the runtime's edge in one bounded call, as the producer's converted credential. Every path
// exits 0 quietly within the hook's budget, whatever the runtime does, and the hook's grant publishes lifecycle
// observations only. Every token, identity and payload here is synthetic; no test runs a real client's hook or reaches
// an installed service.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {constants} from 'node:fs';
import {chmod, link, mkdir, mkdtemp, open, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import type {Envelope} from '@jimmie-potts/agent-state';
import {MessageValidator, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies, sessionEntityId, type Identity, type SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER, prepareMessage, publishOnce} from '@jimmie-potts/sdk';
import {toEnvelope} from '../src/core/mapping.js';
import {
  HOOK_BUDGET_MS, LIFECYCLE_SCHEMA, lifecycleMessage, observationOf, producerCredentialId, producerSource, readProducer, runHook,
} from '../src/hook/index.js';
import {convertHubEdge, createCoreModule, tokenDigest, type LogRecord, type Runtime} from '../src/index.js';
import {edgeConfig, it, run} from './support.js';

const HOOK = fileURLToPath(new URL('../../bin/monitor-hook.mjs', import.meta.url));
const STALLED_READ = new URL('./fixtures/stalled-read.js', import.meta.url).href;
const NO_RESOURCE_INFO = new URL('./fixtures/no-resource-info.js', import.meta.url).href;
/** A producer's source configuration, as the Hub's setup writes it into `producer.json`, with its first hook's name. */
const SOURCE = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code-hooks', hook: 'SessionStart'} as const;
/** The Hub's `producerPrincipal` for SOURCE, computed once with apps/hub/src/setup.ts at main 8590332f. */
const HUB_ID = 'hub-079d58c5ae9c2723c5920d98dbb07935';
/** The synthetic marker of every token here: no record, answer or session may carry it. */
const MARKER = 'tok_SYNTHETIC926';
/** A producer token in the Hub's form, 43 base64url characters, carrying the marker. */
const producerToken = (): string => `${MARKER}_${randomBytes(20).toString('base64url').slice(0, 26)}`;
const readerToken = (): string => `${MARKER}_${randomBytes(24).toString('base64url')}`;
/** Content a hook carries that the allowlist drops: a prompt, a tool's input and its response. */
const CANARY = 'PRIVATE_CANARY_926';
const identityOf = (sessionId: string, source: {provider: 'claude'; client: 'code'; hostId: string; sourceId: string} = SOURCE): Identity => ({
  provider: source.provider, client: source.client, hostId: source.hostId, sourceId: source.sourceId, sessionId,
});
const payload = (name: string, sessionId: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({hook_event_name: name, session_id: sessionId, cwd: '/home/owner/projects/demo', ...extra});

type World = {runtime: Runtime; logs: LogRecord[]; url: string; port: number; producer: string; reader: string};

/** The runtime with the core and its gateway, a converted producer credential for SOURCE and a reader's credential. */
async function hookRuntime(context: TestContext): Promise<World> {
  const producer = producerToken();
  const reader = readerToken();
  const files = await edgeConfig(context, [
    {id: HUB_ID, source: producerSource(SOURCE), token: producer, scopes: ['ingest']},
    {id: 'reader', source: 'bunny/parts/reader', token: reader, scopes: ['read']},
  ]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  return {runtime, logs, url: runtime.url, port: Number(new URL(runtime.url).port), producer, reader};
}

async function writePrivate(file: string, text: string | Buffer, mode = 0o600): Promise<void> {
  await writeFile(file, text, {mode});
  await chmod(file, mode);
}

type Shape = {
  lifecycleVersion?: '1.1' | '1.2';
  /** The receipt beside the file: none, as the earlier migration API left it, installed, still applying, or another token's. */
  receipt?: 'none' | 'installed' | 'applying' | 'other-token' | 'not-private';
  /** Changes the producer file's members before it is written. */
  edit?: (value: Record<string, unknown>) => Record<string, unknown>;
  /** Changes the receipt's members before it is written. */
  editReceipt?: (receipt: {version: number; input: Record<string, unknown>}) => Record<string, unknown>;
  port?: number;
};

/** A producer file in a new private directory, as the Hub's setup writes it, with its receipt when the shape has one. */
async function producerFile(context: TestContext, token: string, port: number, shape: Shape = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-producer-')));
  await chmod(dir, 0o700);
  context.after(() => rm(dir, {recursive: true, force: true}));
  const endpoint = `http://127.0.0.1:${shape.port ?? port}/api/monitor/v1/events`;
  const version = shape.lifecycleVersion === undefined ? {} : {lifecycleVersion: shape.lifecycleVersion};
  const value = {...version, enabled: true, qualified: true, source: SOURCE, endpoint, token};
  const path = join(dir, 'producer.json');
  await writePrivate(path, JSON.stringify(shape.edit?.(value) ?? value));
  const receipt = shape.receipt ?? 'installed';
  if (receipt !== 'none') {
    const input = {directory: dir, target: '/home/owner/.claude/settings.json', source: SOURCE, endpoint, node: '/usr/bin/node', hook: '/opt/hub/bin/monitor-hook.mjs', owner: 'owner', qualified: true, ...version};
    const written = {
      version: 1, state: receipt === 'applying' ? 'applying' : 'installed', input, id: HUB_ID, token: receipt === 'other-token' ? producerToken() : token, entries: [], before: '{}', after: '{}',
    };
    await writePrivate(join(dir, 'receipt.json'), JSON.stringify(shape.editReceipt?.(written) ?? written), receipt === 'not-private' ? 0o644 : 0o600);
  }
  return path;
}

type Ran = {code: number | null; signal: NodeJS.Signals | null; output: string; elapsedMs: number};

/**
 * The hook's environment: this process's, without what a real client's hook would find in it, so a test run inside an
 * agent session reads nothing of that session's.
 */
const HOOK_ENV: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CLAUDE_CODE_') && name !== 'CODEX_HOME'));

/** Stdin left open, as by a client that never closes it. */
const OPEN = Symbol('open');

/** How long a test lets a hook run before it kills it, so a hook that never ends fails its test instead of outliving it. */
const KILL_AFTER_MS = 6000;

/**
 * Runs the hook as a client's hook command does: `node monitor-hook.mjs <args>`, with `input` on stdin, or stdin left
 * open, and Node's own `options` before the script.
 */
async function hook(args: readonly string[], input: string | Buffer | typeof OPEN, env: NodeJS.ProcessEnv = HOOK_ENV, options: readonly string[] = []): Promise<Ran> {
  const started = performance.now();
  const child = spawn(process.execPath, [...options, HOOK, ...args], {stdio: ['pipe', 'pipe', 'pipe'], env});
  const killer = setTimeout(() => { child.kill('SIGKILL'); }, KILL_AFTER_MS);
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  // A hook that stops reading early, as for input over its bound, closes its end of the pipe.
  child.stdin.on('error', () => {});
  if (input !== OPEN) child.stdin.end(input);
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  clearTimeout(killer);
  child.stdin.destroy();
  return {code, signal, output, elapsedMs: performance.now() - started};
}

/** Runs each case with at most `limit` hooks at once. */
async function each<T>(items: readonly T[], limit: number, body: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({length: limit}, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await body(item);
  }));
}

/** Fails unless the hook exited 0 on its own, wrote nothing and ended within `withinMs`. */
function quiet(ran: Ran, what: string, withinMs = 2000): void {
  assert.deepEqual({code: ran.code, signal: ran.signal, output: ran.output}, {code: 0, signal: null, output: ''}, what);
  assert.ok(ran.elapsedMs < withinMs, `${what}: exited after ${Math.round(ran.elapsedMs)} ms, not within ${withinMs} ms`);
}

async function sessions(world: World): Promise<SessionRecord[]> {
  const response = await fetch(new URL('/api/v2/families/session', world.url), {headers: {authorization: `Bearer ${world.reader}`}});
  assert.equal(response.status, 200);
  return (await response.json() as {records: SessionRecord[]}).records;
}

/** Waits until the session's record satisfies `ready`, polling the gateway, and returns it. */
async function until(world: World, sessionId: string, ready: (record: SessionRecord) => boolean, what: string): Promise<SessionRecord> {
  const id = sessionEntityId(identityOf(sessionId));
  const deadline = performance.now() + 5000;
  for (;;) {
    const record = (await sessions(world)).find(found => found.id === id);
    if (record !== undefined && ready(record)) return record;
    if (performance.now() > deadline) assert.fail(`timed out waiting for ${what}: ${JSON.stringify(record)}`);
    await new Promise(resolve => { setTimeout(resolve, 20); });
  }
}

const received = (logs: readonly LogRecord[]): LogRecord[] => logs.filter(record => record.event_name === 'message.received');

it('an unchanged 1.x producer file drives the 2.0 hook at each lifecycle version, and each accepted observation commits the session', async context => {
  const world = await hookRuntime(context);
  const versions = [['1.0', {}], ['1.1', {lifecycleVersion: '1.1'}], ['1.2', {lifecycleVersion: '1.2'}]] as const;
  for (const [version, shape] of versions) {
    const sessionId = `session-${version.replace('.', '-')}`;
    const producer = await producerFile(context, world.producer, world.port, shape);
    const files = [producer, join(producer, '..', 'receipt.json')];
    const before = await Promise.all(files.map(file => stat(file)));
    const send = async (name: string, extra: Record<string, unknown> = {}): Promise<void> => { quiet(await hook([producer], payload(name, sessionId, extra)), `${version} ${name}`); };

    await send('SessionStart');
    const started = await until(world, sessionId, () => true, `${version}: the session`);
    // Lifecycle 1.0 carries no project.
    assert.deepEqual({activity: started.activity, project: started.project, identity: started.identity},
      {activity: 'active', project: version === '1.0' ? undefined : 'demo', identity: identityOf(sessionId)}, version);
    await send('UserPromptSubmit', {prompt_id: 'prompt-1', prompt: CANARY});
    await until(world, sessionId, record => record.turn.status === 'known' && record.turn.id === 'prompt-1', `${version}: the turn`);
    await send('PermissionRequest', {prompt_id: 'prompt-1', tool_name: 'Bash', tool_input: {command: CANARY}});
    const asking = await until(world, sessionId, record => record.attention.length === 1, `${version}: the approval prompt`);
    assert.deepEqual(asking.attention, [{id: {status: 'unknown'}, kind: 'approval', turn: {status: 'known', id: 'prompt-1'}}], version);
    await send('PostToolUse', {prompt_id: 'prompt-1', tool_use_id: 'tool-1', tool_response: {output: CANARY}});
    await until(world, sessionId, record => record.attention.length === 0, `${version}: the approval prompt cleared`);
    await send('Stop', {prompt_id: 'prompt-1'});
    const ended = await until(world, sessionId, record => record.activity === 'idle' && record.notices.length === 1, `${version}: the finished turn`);
    assert.equal(ended.notices[0]?.kind, 'turn-ended', version);
    // The hook only reads its producer file and receipt.
    const after = await Promise.all(files.map(file => stat(file)));
    assert.deepEqual(after.map(info => [info.mtimeMs, info.size, info.mode]), before.map(info => [info.mtimeMs, info.size, info.mode]), version);
  }

  // The core took each observation from the producer's source, once.
  const intake = received(world.logs).filter(record => record.attributes['bunny.operation'] === 'lifecycle');
  assert.deepEqual(intake.map(record => [record.attributes['bunny.participant'], record.attributes['bunny.outcome']]), Array(15).fill([producerSource(SOURCE), 'accepted']));
  // What the allowlist drops never reached the runtime, and no token reached a record or a session.
  const evidence = JSON.stringify({logs: world.logs, sessions: await sessions(world)});
  for (const secret of [CANARY, world.producer, world.reader, MARKER]) assert.equal(evidence.includes(secret), false, 'a dropped field or a token reached the runtime');
});

it('a subagent\'s start and stop reach the core as a child of its session, and a parent in another source is refused', async context => {
  const world = await hookRuntime(context);
  const producer = await producerFile(context, world.producer, world.port, {lifecycleVersion: '1.2'});
  const send = async (name: string, sessionId: string, extra: Record<string, unknown> = {}): Promise<void> => {
    quiet(await hook([producer], payload(name, sessionId, extra)), `${name} ${sessionId} ${JSON.stringify(extra)}`);
  };
  // A subagent of a session the core holds, which counts its running child. Claude Code's hooks never say a session is
  // top-level, so the lead's own parent stays unknown.
  await send('SessionStart', 'lead');
  await send('UserPromptSubmit', 'lead', {prompt_id: 'prompt-1'});
  await until(world, 'lead', record => record.turn.status === 'known', 'the lead\'s turn');
  await send('SubagentStart', 'lead', {agent_id: 'helper-1', agent_type: 'Explore', prompt_id: 'prompt-1'});
  const child = await until(world, 'helper-1', () => true, 'the subagent');
  assert.deepEqual({parent: child.parent, turn: child.turn, activity: child.activity, project: child.project, hostSessionId: child.hostSessionId},
    {parent: {status: 'known', identity: identityOf('lead')}, turn: {status: 'unknown'}, activity: 'active', project: undefined, hostSessionId: undefined});
  const lead = await until(world, 'lead', record => record.children.active === 1, 'the lead counting its subagent');
  assert.deepEqual(lead.parent, {status: 'unknown'});
  await send('SubagentStop', 'lead', {agent_id: 'helper-1', prompt_id: 'prompt-1'});
  await until(world, 'helper-1', record => record.activity !== 'active', 'the subagent\'s end');
  await until(world, 'lead', record => record.children.active === 0, 'the lead with no running subagent');
  // A subagent of a session the core has not seen keeps its known parent.
  await send('SubagentStart', 'unseen-lead', {agent_id: 'helper-2'});
  const orphan = await until(world, 'helper-2', () => true, 'the second subagent');
  assert.deepEqual(orphan.parent, {status: 'known', identity: identityOf('unseen-lead')});
  // A subagent that names its own session is no subagent: the normalizers drop it, and nothing is sent.
  const count = received(world.logs).length;
  await send('SubagentStart', 'lead', {agent_id: 'lead'});
  await send('SubagentStop', 'lead', {});
  assert.equal(received(world.logs).length, count, 'nothing reached the core');

  // The 2.0 profile's parentage rule, at the edge: a known parent is in the child's own source, with another session.
  const source = producerSource(SOURCE);
  const options = {url: world.url, source, token: world.producer, timeoutMs: 2000};
  const started = observationOf(envelopeOf({kind: 'session.started'}, {identity: identityOf('helper-3'), parent: {status: 'known', identity: identityOf('lead')}, observedAtMs: Date.now()}));
  assert.ok(started, 'a subagent\'s observation');
  const parents: [string, Identity][] = [
    ['a parent in another source', {...identityOf('lead'), sourceId: 'other-hooks'}],
    ['a parent on another host', {...identityOf('lead'), hostId: 'host-other'}],
    ['the child\'s own session', identityOf('helper-3')],
  ];
  for (const [name, parent] of parents) {
    const {key, draft} = lifecycleMessage({...started, parent: {status: 'known', identity: parent}});
    const result = await publishOnce(options, key, prepareMessage(source, draft));
    assert.deepEqual(result.status === 'rejected' ? [result.status, result.error.error.code] : [result.status], ['rejected', 'invalid-message'], name);
  }
  assert.equal(received(world.logs).length, count, 'no refused parentage reached the core');
  // The same observation with its own source's parent is taken.
  const {key, draft} = lifecycleMessage(started);
  assert.deepEqual(await publishOnce(options, key, prepareMessage(source, draft)), {status: 'published'});
  await until(world, 'helper-3', record => record.parent.status === 'known', 'the third subagent');
  // A session its producer says is top-level, as the profile allows, and a subagent of it through the hook.
  const topLevel = observationOf(envelopeOf({kind: 'session.started'}, {identity: identityOf('root'), parent: {status: 'top-level'}, observedAtMs: Date.now()}));
  assert.ok(topLevel, 'a top-level session\'s observation');
  const root = lifecycleMessage(topLevel);
  assert.deepEqual(await publishOnce(options, root.key, prepareMessage(source, root.draft)), {status: 'published'});
  assert.deepEqual((await until(world, 'root', () => true, 'the top-level session')).parent, {status: 'top-level'});
  await send('SubagentStart', 'root', {agent_id: 'helper-4'});
  assert.deepEqual((await until(world, 'helper-4', () => true, 'its subagent')).parent, {status: 'known', identity: identityOf('root')});
  const counted = await until(world, 'root', record => record.children.active === 1, 'the top-level session counting its subagent');
  assert.deepEqual(counted.parent, {status: 'top-level'}, 'a child does not change its parent\'s parentage');
});

it('each lifecycle version a producer selected reaches the core as 2.0, with or without a receipt', async context => {
  const world = await hookRuntime(context);
  const desktop = {...HOOK_ENV, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_HOST_SESSION_ID: 'local_0123abcd'};
  const cases: [string, Shape, Partial<SessionRecord>][] = [
    ['1.0', {}, {}],
    ['1.0 without a receipt', {receipt: 'none'}, {}],
    ['1.1', {lifecycleVersion: '1.1'}, {project: 'demo'}],
    ['1.2', {lifecycleVersion: '1.2'}, {project: 'demo', hostSessionId: 'local_0123abcd'}],
    ['1.2 without a receipt', {lifecycleVersion: '1.2', receipt: 'none'}, {project: 'demo', hostSessionId: 'local_0123abcd'}],
  ];
  for (const [name, shape, expected] of cases) {
    const sessionId = `version-${name.replaceAll(/[^a-z0-9]+/g, '-')}`;
    const producer = await producerFile(context, world.producer, world.port, shape);
    quiet(await hook([producer], payload('SessionStart', sessionId), desktop), name);
    const record = await until(world, sessionId, () => true, name);
    assert.deepEqual({project: record.project, hostSessionId: record.hostSessionId}, {project: undefined, hostSessionId: undefined, ...expected}, name);
  }
});

it('the observation starts a trace that the runtime\'s record of its intake carries', async context => {
  const world = await hookRuntime(context);
  const producer = await producerFile(context, world.producer, world.port, {lifecycleVersion: '1.2'});
  const result = await runHook({producer, input: Readable.from([Buffer.from(payload('SessionStart', 'traced'))]), deadline: performance.now() + HOOK_BUDGET_MS});
  assert.equal(result.status, 'published');
  if (result.status !== 'published') return;
  await until(world, 'traced', () => true, 'the session');
  const record = received(world.logs).find(found => found.trace_id === result.traceId);
  assert.ok(record, 'the core\'s intake record carries the hook\'s trace');
  assert.deepEqual([record.attributes['bunny.message.id'], record.attributes['bunny.outcome']], [result.messageId, 'accepted']);
});

it('a producer file the hook may not use, or a receipt that does not let it emit, ends the hook quietly and sends nothing', async context => {
  const world = await hookRuntime(context);
  const valid = await producerFile(context, world.producer, world.port);
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-producer-')));
  context.after(() => rm(dir, {recursive: true, force: true}));
  const linked = join(dir, 'linked.json');
  await symlink(valid, linked);
  const directory = join(dir, 'directory.json');
  await mkdir(directory, {mode: 0o700});
  const shaped = (shape: Shape): Promise<string> => producerFile(context, world.producer, world.port, shape);
  // Without a receipt, so each case meets only the check it names, never the receipt's.
  const member = (name: string, value: unknown): Shape => ({receipt: 'none', edit: producer => ({...producer, [name]: value})});
  const hardLinked = await shaped({receipt: 'none'});
  await link(hardLinked, join(dir, 'second-name.json'));
  const groupReadable = await shaped({});
  await chmod(groupReadable, 0o640);
  const notJson = await shaped({receipt: 'none'});
  await writePrivate(notJson, '{"enabled": true,');
  const cases: [string, readonly string[]][] = [
    ['no producer argument', []],
    ['a second argument', [valid, 'extra']],
    ['a missing producer file', [join(dir, 'missing.json')]],
    ['a link to a producer file', [linked]],
    ['a producer file with a second link', [hardLinked]],
    ['a producer file others can read', [groupReadable]],
    ['a directory', [directory]],
    ['a producer file over 8 KiB', [await shaped({receipt: 'none', edit: producer => ({...producer, source: {...SOURCE, pad: 'x'.repeat(9000)}})})]],
    ['a producer file that is not JSON', [notJson]],
    ['an unknown member', [await shaped(member('devices', []))]],
    ['a disabled producer', [await shaped(member('enabled', false))]],
    ['an unqualified producer', [await shaped(member('qualified', false))]],
    ['a token not in the Hub\'s form', [await shaped(member('token', world.producer.slice(1)))]],
    ['an unknown lifecycle version', [await shaped(member('lifecycleVersion', '1.3'))]],
    ['an endpoint on another host', [await shaped(member('endpoint', `http://localhost:${world.port}/api/monitor/v1/events`))]],
    ['an https endpoint', [await shaped(member('endpoint', `https://127.0.0.1:${world.port}/api/monitor/v1/events`))]],
    ['an endpoint on another path', [await shaped(member('endpoint', `http://127.0.0.1:${world.port}/api/sdk/v1/publish`))]],
    ['an endpoint with a query', [await shaped(member('endpoint', `http://127.0.0.1:${world.port}/api/monitor/v1/events?x=1`))]],
    ['an endpoint with credentials', [await shaped(member('endpoint', `http://owner:pw@127.0.0.1:${world.port}/api/monitor/v1/events`))]],
    ['a receipt still applying', [await shaped({receipt: 'applying'})]],
    ['a receipt for another token', [await shaped({receipt: 'other-token'})]],
    ['a receipt others can read', [await shaped({receipt: 'not-private'})]],
    // A receipt that does not describe this producer file: setup installed another one there.
    ['a receipt for another source', [await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, source: {...SOURCE, sourceId: 'other-hooks'}}})})]],
    ['a receipt for another endpoint', [await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, endpoint: `http://127.0.0.1:${world.port + 1}/api/monitor/v1/events`}})})]],
    ['a receipt for another directory', [await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, directory: dir}})})]],
    ['a receipt for another lifecycle version', [await shaped({lifecycleVersion: '1.1', editReceipt: receipt => ({...receipt, input: {...receipt.input, lifecycleVersion: '1.2'}})})]],
    ['a receipt with a lifecycle version the file has not', [await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, lifecycleVersion: '1.1'}})})]],
    ['a receipt for an unqualified producer', [await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, qualified: false}})})]],
    ['a receipt of another version', [await shaped({editReceipt: receipt => ({...receipt, version: 2})})]],
  ];
  await each(cases, 4, async ([name, args]) => { quiet(await hook(args, payload('SessionStart', 'refused')), name); });
  assert.deepEqual(await sessions(world), [], 'nothing reached the core');
  assert.deepEqual(received(world.logs), []);
  // The valid producer file still works, so each case failed on its own fault, and so does a receipt that lists the
  // source's members in another order: setup compares them as canonical JSON.
  quiet(await hook([valid], payload('SessionStart', 'accepted')), 'the valid producer');
  await until(world, 'accepted', () => true, 'the session');
  const reordered = await shaped({editReceipt: receipt => ({...receipt, input: {...receipt.input, source: Object.fromEntries(Object.entries(SOURCE).reverse())}})});
  quiet(await hook([reordered], payload('SessionStart', 'reordered')), 'a receipt with the source\'s members in another order');
  await until(world, 'reordered', () => true, 'the session');
});

it('input the normalizers do not map ends the hook quietly and sends nothing', async context => {
  const world = await hookRuntime(context);
  const producer = await producerFile(context, world.producer, world.port, {lifecycleVersion: '1.2'});
  const cases: [string, string | Buffer][] = [
    ['no input', ''],
    ['input that is not JSON', '{"hook_event_name":'],
    ['a JSON array', '[]'],
    ['no hook name', JSON.stringify({session_id: 'session-1'})],
    ['a hook the normalizers do not map', payload('Notification', 'session-1')],
    ['no session ID', JSON.stringify({hook_event_name: 'SessionStart'})],
    ['a session ID that is not an identifier', payload('SessionStart', 'not an id')],
    ['input over 8 MiB', payload('PostToolUse', 'session-1', {prompt_id: 'p', tool_use_id: 't', tool_response: 'x'.repeat(8 * 1024 * 1024)})],
    ['input that is not UTF-8', Buffer.from([0x7b, 0xff, 0xfe, 0x7d])],
  ];
  await each(cases, 4, async ([name, input]) => { quiet(await hook([producer], input), name, 2500); });
  assert.deepEqual(await sessions(world), []);
  assert.deepEqual(received(world.logs), []);
});

it('a runtime that is stopped, refuses the credential or never answers never delays the agent past the hook\'s budget', async context => {
  const world = await hookRuntime(context);
  // A port nothing listens on, as while the runtime is stopped.
  const closed = createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const closedPort = (closed.address() as AddressInfo).port;
  closed.close();
  await once(closed, 'close');
  // A listener that takes every call and never answers, as a runtime whose event loop is stuck.
  const silent: Server = createServer(() => {});
  silent.listen(0, '127.0.0.1');
  await once(silent, 'listening');
  context.after(() => {
    silent.closeAllConnections();
    silent.close();
  });
  const silentPort = (silent.address() as AddressInfo).port;
  const stopped = await producerFile(context, world.producer, world.port, {port: closedPort});
  const stuck = await producerFile(context, world.producer, world.port, {port: silentPort});
  const revoked = await producerFile(context, producerToken(), world.port, {receipt: 'none'});
  const valid = await producerFile(context, world.producer, world.port);
  const [atStopped, atStuck, atRevoked, openInput] = await Promise.all([
    hook([stopped], payload('SessionStart', 'session-1')),
    hook([stuck], payload('SessionStart', 'session-1')),
    hook([revoked], payload('SessionStart', 'session-1')),
    // A client that never closes the hook's stdin.
    hook([valid], OPEN),
  ]);
  quiet(atStopped, 'a stopped runtime');
  quiet(atRevoked, 'a credential the runtime does not hold');
  // The hook ends itself at its budget, measured from its own start, inside the clients' 3 s hook timeout.
  for (const [what, ran] of [['a runtime that never answers', atStuck], ['stdin left open', openInput]] as const) {
    quiet(ran, what, 3000);
    assert.ok(ran.elapsedMs > HOOK_BUDGET_MS - 300, `${what}: waited for its budget, ${Math.round(ran.elapsedMs)} ms`);
  }
  assert.deepEqual(await sessions(world), []);
});

/** A FIFO with no writer in a new private directory. A writer's open at the test's end releases any read still waiting on it. */
async function fifo(context: TestContext, name: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-fifo-')));
  const path = join(dir, name);
  execFileSync('mkfifo', ['-m', '600', path]);
  context.after(async () => {
    try {
      const writer = await open(path, constants.O_WRONLY | constants.O_NONBLOCK);
      await writer.close();
    } catch {
      // No read waits on it.
    }
    await rm(dir, {recursive: true, force: true});
  });
  return path;
}

it('a file read stuck at the deadline ends the hook by signal within its budget; a FIFO transcript, or a check that cannot tell, exits 0', async context => {
  const world = await hookRuntime(context);
  const producer = await producerFile(context, world.producer, world.port, {lifecycleVersion: '1.2'});
  // The title read opens the transcript without blocking, so a FIFO there gives no title and holds nothing.
  const transcript = await fifo(context, 'transcript.jsonl');
  quiet(await hook([producer], payload('SessionStart', 'fifo-transcript', {transcript_path: transcript})), 'a FIFO transcript');
  await until(world, 'fifo-transcript', () => true, 'the session');
  // A file read stuck in a file system call, as on a stalled mount: `process.exit` would wait for it, so the hook ends
  // by signal at its deadline, nothing printed, once its observation is published.
  const stalled = await fifo(context, 'stalled.jsonl');
  const stuck = await hook([producer], payload('SessionStart', 'stuck-read'), {...HOOK_ENV, BUNNY_STALLED_READ: stalled}, ['--import', STALLED_READ]);
  assert.deepEqual({code: stuck.code, signal: stuck.signal, output: stuck.output}, {code: null, signal: 'SIGKILL', output: ''});
  assert.ok(stuck.elapsedMs > HOOK_BUDGET_MS - 300 && stuck.elapsedMs < 3000, `ended at its deadline, after ${Math.round(stuck.elapsedMs)} ms`);
  await until(world, 'stuck-read', () => true, 'the session');
  // A process that cannot tell whether a read is under way counts it as none, and the hook stays fail-open.
  const unchecked = await hook([producer], payload('SessionStart', 'unchecked'), HOOK_ENV, ['--import', NO_RESOURCE_INFO]);
  quiet(unchecked, 'a check for a pending read that throws');
  await until(world, 'unchecked', () => true, 'the session');
});

it('the producer\'s credential publishes lifecycle observations only: a command, a read and any other key are forbidden', async context => {
  const world = await hookRuntime(context);
  const source = producerSource(SOURCE);
  const call = async (path: string, init: {method?: string; body?: unknown} = {}): Promise<{status: number; body: unknown}> => {
    const response = await fetch(new URL(path, world.url), {
      method: init.method ?? 'GET', headers: {authorization: `Bearer ${world.producer}`, 'content-type': 'application/json', [SOURCE_HEADER]: source},
      ...(init.body === undefined ? {} : {body: JSON.stringify(init.body)}),
    });
    return {status: response.status, body: await response.json() as unknown};
  };
  const codeOf = (answer: {body: unknown}): unknown => (answer.body as ErrorBody).error.code;
  const session = sessionEntityId(identityOf('session-1'));
  const recover = prepareMessage(source, {kind: 'occurrence', type: 'unused', subject: session, dataschema: 'unused', data: {}});
  const command = {...recover, kind: 'command', type: 'org.bunny.approval.recover.requested', dataschema: 'https://bunny.invalid/events/approval-recover/2.0',
    expiresat: new Date(Date.now() + 5000).toISOString(), data: {requestId: 'req-hook', turnId: 'prompt-1', expectedRevision: 1}};
  const request = await call(`${REMOTE_PATH}/request`, {method: 'POST', body: {schema: REMOTE_SCHEMA, key: `bunny.cmd.approval-recover.${session}`, command}});
  assert.deepEqual([request.status, codeOf(request)], [403, 'forbidden'], 'a command');
  // Every part may hold a stream (#835), but this one may hear nothing on it: a subscription and a sync are refused.
  for (const [route, body] of [['subscribe', {connection: 'c', id: 's', pattern: 'bunny.state.session.*'}], ['sync', {request: {}}]] as const) {
    const answer = await call(`${REMOTE_PATH}/${route}`, {method: 'POST', body: {schema: REMOTE_SCHEMA, ...body}});
    assert.deepEqual([answer.status, codeOf(answer)], [403, 'forbidden'], route);
  }
  // A lifecycle observation on a key outside the grant, and another family's message on a lifecycle key.
  const {draft} = lifecycleMessage(observationOf(envelopeOf({kind: 'session.started'}, {observedAtMs: Date.now()})) ?? assert.fail('an observation'));
  const observation = prepareMessage(source, draft);
  const elsewhere = await call(`${REMOTE_PATH}/publish`, {method: 'POST', body: {schema: REMOTE_SCHEMA, key: `bunny.event.turn-ended.${session}`, message: observation}});
  assert.deepEqual([elsewhere.status, codeOf(elsewhere)], [403, 'forbidden'], 'another key');
  const ended = prepareMessage(source, {kind: 'occurrence', type: 'org.bunny.turn.ended', subject: session, dataschema: 'https://bunny.invalid/events/turn-ended/2.0', data: {
    session, identity: identityOf('session-1'), turn: {status: 'known', id: 'prompt-1'}, observedAtMs: Date.now(), ordering: {status: 'unknown'}, revision: 1,
  }});
  const family = await call(`${REMOTE_PATH}/publish`, {method: 'POST', body: {schema: REMOTE_SCHEMA, key: `bunny.event.lifecycle.${session}`, message: ended}});
  assert.deepEqual([family.status, codeOf(family)], [403, 'forbidden'], 'another family on a lifecycle key');
  // The gateway's reads and its authority check: the credential holds `ingest` and nothing else.
  const read = await call('/api/v2/families/session');
  assert.deepEqual([read.status, codeOf(read)], [403, 'forbidden'], 'a read');
  assert.deepEqual(await call('/api/v2/authority?scope=ingest'), {status: 200, body: {schema: 'authority/2.0', scope: 'ingest'}});
  for (const scope of ['read', 'control', 'admin']) assert.equal(codeOf(await call(`/api/v2/authority?scope=${scope}`)), 'forbidden', scope);
  // None of it reached the core, while the same credential's observation does.
  assert.deepEqual(received(world.logs), []);
  const accepted = await call(`${REMOTE_PATH}/publish`, {method: 'POST', body: {schema: REMOTE_SCHEMA, key: `bunny.event.lifecycle.${session}`, message: observation}});
  assert.deepEqual(accepted, {status: 200, body: {schema: REMOTE_SCHEMA, status: 'published'}});
  await until(world, 'session-1', () => true, 'the session');
});

it('a producer\'s source is the one the cutover gives its converted credential, from the Hub\'s credential ID', () => {
  assert.equal(producerCredentialId(SOURCE), HUB_ID, 'the Hub\'s producerPrincipal');
  assert.equal(producerCredentialId({...SOURCE, hook: 'Stop'}), HUB_ID, 'the hook\'s name is not part of it');
  assert.notEqual(producerCredentialId({...SOURCE, sourceId: 'other'}), HUB_ID);
  const converted = convertHubEdge({credentials: [{id: HUB_ID, digest: tokenDigest(producerToken()), scopes: ['ingest'], devices: []}]});
  assert.equal(converted.credentials[0]?.source, producerSource(SOURCE));
  assert.deepEqual(converted.widened, [], 'an ingest credential reaches no device');
});

it('readProducer gives the runtime\'s origin, the token and the converted source, and nothing for a file it may not use', async context => {
  const token = producerToken();
  const path = await producerFile(context, token, 41999, {lifecycleVersion: '1.1'});
  assert.deepEqual(await readProducer(path), {
    edge: 'http://127.0.0.1:41999', token, configuration: SOURCE, source: `bunny/parts/${HUB_ID}`, lifecycleVersion: '1.1',
  });
  assert.equal(await readProducer(await producerFile(context, token, 41999, {receipt: 'applying'})), undefined);
});

// The 1.x envelope the normalizers build, as 2.0.

const IDENTITY = identityOf('session-1');
function envelopeOf(event: Envelope['event'], extra: Partial<Envelope> = {}): Envelope {
  return {apiVersion: '1.2', identity: IDENTITY, turn: {status: 'known', id: 'prompt-1'}, parent: {status: 'unknown'}, event, observedAtMs: 1_790_000_000_000, ordering: {status: 'unknown'}, ...extra};
}

it('every 1.x lifecycle event maps to its 2.0 observation, which the core turns back into the same 1.2 envelope', () => {
  const validator = new MessageValidator();
  registerCoreFamilies(validator);
  const known = {status: 'known', id: 'tool-1'} as const;
  const events: Envelope['event'][] = [
    {kind: 'session.started'}, {kind: 'turn.started'}, {kind: 'activity.observed'}, {kind: 'turn.ended'}, {kind: 'turn.interrupted'}, {kind: 'runtime.ended'},
    {kind: 'question.continuing', attention: known}, {kind: 'attention.input', attention: known}, {kind: 'attention.approval', attention: {status: 'unknown'}},
    {kind: 'attention.resolved', attention: known}, {kind: 'evidence.unavailable', dimension: 'turn', reason: 'missing'},
  ];
  const kinds: string[] = [];
  for (const event of events) {
    const envelope = envelopeOf(event, {
      eventId: 'native-1', occurredAtMs: 1_789_999_999_000, ordering: {status: 'known', epoch: 'epoch-1', sequence: 4}, projectId: 'project-1',
      label: {origin: 'user', value: 'Demo'}, title: {value: 'Fix the build', source: 'provider'}, project: 'demo', hostSessionId: 'local_1',
    });
    const observation = observationOf(envelope);
    assert.ok(observation, event.kind);
    kinds.push(observation.event.kind);
    assert.equal(observation.nativeEventId, 'native-1');
    assert.deepEqual(observation.ordering, {status: 'known', authority: IDENTITY.sourceId, epoch: 'epoch-1', sequence: 4});
    assert.deepEqual(toEnvelope(observation), envelope, `${event.kind} survives the round trip`);
    const {key, draft} = lifecycleMessage(observation);
    assert.equal(key, `bunny.event.lifecycle.${sessionEntityId(IDENTITY)}`);
    assert.equal(draft.dataschema, LIFECYCLE_SCHEMA);
    const checked = validator.validate(prepareMessage(producerSource(SOURCE), draft));
    assert.equal(checked.ok, true, `${event.kind}: ${checked.ok ? '' : `${checked.error.code} ${checked.error.detail ?? ''}`}`);
  }
  assert.deepEqual(kinds, [
    'session-started', 'turn-started', 'activity-observed', 'turn-ended', 'turn-interrupted', 'runtime-ended', 'question-continuing', 'attention-input',
    'attention-approval', 'attention-resolved', 'evidence-unavailable',
  ]);
  // Codex Desktop's read evidence, for a Codex Desktop session.
  const desktop: Identity = {provider: 'codex', client: 'desktop', hostId: 'host-sim', sourceId: 'codex-desktop', sessionId: 'thread-1'};
  const read = observationOf(envelopeOf({kind: 'read.observed', state: 'read'}, {identity: desktop}));
  assert.deepEqual(read?.event, {kind: 'read-observed', state: 'read'});
  // A consumer's acknowledgment is a command in 2.0, never an observation.
  assert.equal(observationOf(envelopeOf({kind: 'notice.acknowledged', consumerId: 'nanoleaf', noticeId: 'a'.repeat(64)})), undefined);
  // A 1.0 envelope keeps its unknown ordering and gains nothing.
  assert.deepEqual(observationOf({apiVersion: '1.0', identity: IDENTITY, turn: {status: 'unknown'}, parent: {status: 'unknown'}, event: {kind: 'turn.ended'}, observedAtMs: 5, ordering: {status: 'unknown'}}), {
    identity: IDENTITY, turn: {status: 'unknown'}, parent: {status: 'unknown'}, event: {kind: 'turn-ended'}, observedAtMs: 5, ordering: {status: 'unknown'},
  });
});
