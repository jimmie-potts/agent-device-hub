import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chmod, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sanitizeMacCodexHook, sanitizedInput} from '../bin/mac-codex-hook.mjs';

const base = {session_id: 'synthetic-session', turn_id: 'synthetic-turn'};
const events = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'];

for (const hook_event_name of events) {
  test(`${hook_event_name} keeps only root lifecycle identity`, () => {
    const raw = {...base, hook_event_name, source: 'startup', prompt: 'PRIVATE_CANARY',
      last_assistant_message: 'PRIVATE_CANARY', cwd: '/PRIVATE_CANARY',
      transcript_path: '/PRIVATE_CANARY', model: 'PRIVATE_CANARY', permission_mode: 'default',
      tool_input: {secret: 'PRIVATE_CANARY'}, reason: 'other', stop_hook_active: false};
    assert.deepEqual(sanitizeMacCodexHook(raw), {...base, hook_event_name});
  });
}

test('session events may omit turn identity; turn events require it', () => {
  for (const hook_event_name of ['SessionStart', 'SessionEnd']) {
    assert.deepEqual(sanitizeMacCodexHook({session_id: 's', hook_event_name, source: 'resume'}),
      {session_id: 's', hook_event_name});
  }
  for (const hook_event_name of ['UserPromptSubmit', 'Stop', 'Interrupt']) {
    assert.equal(sanitizeMacCodexHook({session_id: 's', hook_event_name}), null);
  }
});

test('child presence is refused rather than attributed to the parent', () => {
  for (const hook_event_name of events) {
    for (const agent_id of ['child', null, '', false, undefined]) {
      assert.equal(sanitizeMacCodexHook({...base, hook_event_name, source: 'startup', agent_id}), null);
    }
  }
});

test('unselected events, compaction and unknown start sources are refused', () => {
  for (const hook_event_name of ['PermissionRequest', 'SubagentStart', 'SubagentStop', 'PostToolUse', 'Unknown']) {
    assert.equal(sanitizeMacCodexHook({...base, hook_event_name}), null);
  }
  for (const source of ['compact', 'unknown', undefined, null]) {
    assert.equal(sanitizeMacCodexHook({...base, hook_event_name: 'SessionStart', source}), null);
  }
  for (const source of ['startup', 'resume', 'clear', 'fork']) {
    assert.ok(sanitizeMacCodexHook({...base, hook_event_name: 'SessionStart', source}));
  }
});

test('malformed identities and objects are dropped whole', () => {
  for (const raw of [null, [], 'text', 2]) assert.equal(sanitizeMacCodexHook(raw), null);
  for (const value of ['', 'has spaces', 'x'.repeat(129), 'id\n', null, 2]) {
    assert.equal(sanitizeMacCodexHook({...base, hook_event_name: 'Stop', session_id: value}), null);
    assert.equal(sanitizeMacCodexHook({...base, hook_event_name: 'Stop', turn_id: value}), null);
  }
});

test('ignored fields are never evaluated and input is unchanged', () => {
  const raw = {...base, hook_event_name: 'Stop'};
  Object.defineProperty(raw, 'transcript_path', {enumerable: true, get() { throw new Error('must not read'); }});
  assert.deepEqual(sanitizeMacCodexHook(raw), {...base, hook_event_name: 'Stop'});
  assert.equal(Object.keys(raw).length, 4);
});

test('stream sanitization removes content before the existing publisher sees it', async () => {
  const raw = Buffer.from(JSON.stringify({...base, hook_event_name: 'Stop',
    transcript_path: '/DO_NOT_OPEN', last_assistant_message: 'PRIVATE_CANARY'}));
  const output = [];
  for await (const chunk of sanitizedInput([raw.subarray(0, 12), raw.subarray(12)], 1024)) output.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(output).toString()), {...base, hook_event_name: 'Stop'});
  assert.equal(Buffer.concat(output).includes('PRIVATE_CANARY'), false);
});

test('malformed JSON, invalid UTF-8 and oversized streams produce no input', async () => {
  for (const bytes of [Buffer.from('{'), Buffer.from([0xc3, 0x28]), Buffer.alloc(65, 32)]) {
    const output = [];
    for await (const chunk of sanitizedInput([bytes], 64)) output.push(chunk);
    assert.deepEqual(output, []);
  }
});

test('input limit stops consumption and no input is read until requested', async () => {
  let reads = 0;
  async function* source() {
    reads++;
    yield Buffer.alloc(65);
    reads++;
    yield Buffer.from('PRIVATE_CANARY');
  }
  const filtered = sanitizedInput(source(), 64);
  assert.equal(reads, 0);
  assert.deepEqual(await filtered.next(), {done: true, value: undefined});
  assert.equal(reads, 1);
});

test('an exact-boundary input is accepted', async () => {
  const bytes = Buffer.from(JSON.stringify({...base, hook_event_name: 'Stop'}));
  const output = [];
  for await (const chunk of sanitizedInput([bytes], bytes.length)) output.push(chunk);
  assert.equal(output.length, 1);
});

test('missing arguments exit silently without reading stdin', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/mac-codex-hook.mjs', import.meta.url))],
      {stdio: ['pipe', 'pipe', 'pipe']});
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('hook exceeded budget')); }, 4000);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({code, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString()});
    });
  });
  assert.deepEqual(result, {code: 0, signal: null, stdout: '', stderr: ''});
});

const SOURCE = {provider: 'codex', client: 'local', hostId: 'mac-synthetic', sourceId: 'codex-local-hooks'};
const TOKEN = 's'.repeat(43); // Synthetic fixture only.
const HOOK = fileURLToPath(new URL('../bin/mac-codex-hook.mjs', import.meta.url));

async function receiver(context, {hang = false, lifecycleVersion} = {}) {
  const {REMOTE_SCHEMA} = await import('@jimmie-potts/sdk');
  const directory = await mkdtemp(join(tmpdir(), 'bunny-mac-hook-'));
  await chmod(directory, 0o700);
  const calls = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8').on('data', chunk => { body += chunk; });
    request.once('end', () => {
      calls.push({url: request.url, headers: request.headers, body: JSON.parse(body)});
      if (!hang) response.writeHead(200, {'content-type': 'application/json'})
        .end(JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'}));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  });
  const path = join(directory, 'producer.json');
  const endpoint = `http://127.0.0.1:${server.address().port}/api/monitor/v1/events`;
  await writeFile(path, JSON.stringify({enabled: true, qualified: true, source: SOURCE, endpoint, token: TOKEN,
    ...(lifecycleVersion === undefined ? {} : {lifecycleVersion})}), {mode: 0o600});
  return {path, calls, server};
}

function invoke(producer, input, options = []) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [...options, HOOK, producer], {stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('hook exceeded test deadline')); }, 6000);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({code, signal, output: Buffer.concat(chunks).toString(), elapsed: performance.now() - started});
    });
    if (input !== undefined) child.stdin.end(typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input));
  });
}

function quiet(result) {
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.output, '');
  assert.ok(result.elapsed < 4000, `hook took ${result.elapsed} ms`);
}

test('native wrapper publishes all selected events with source-bound metadata only', async context => {
  const {producerSource} = await import('@jimmie-potts/runtime/hook');
  const {REMOTE_PATH, REMOTE_SCHEMA, SOURCE_HEADER} = await import('@jimmie-potts/sdk');
  const world = await receiver(context);
  const poison = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    for (const [object, keys] of [[fs, ['open', 'openSync', 'readFile', 'readFileSync']], [fs.promises, ['open', 'readFile']]]) {
      for (const key of keys) { const original = object[key]; object[key] = function(path, ...args) {
        if (String(path).includes('DO_NOT_OPEN')) { process.stderr.write('FORBIDDEN_READ'); throw new Error('forbidden'); }
        return original.call(this, path, ...args);
      }; }
    } syncBuiltinESMExports();`;
  const options = ['--import', 'data:text/javascript,' + encodeURIComponent(poison)];
  const kinds = ['session-started', 'turn-started', 'turn-ended', 'turn-interrupted', 'runtime-ended'];
  for (const [index, hook_event_name] of events.entries()) {
    quiet(await invoke(world.path, {...base, hook_event_name, source: 'startup',
      prompt: 'PRIVATE_CANARY', last_assistant_message: 'PRIVATE_CANARY', cwd: '/DO_NOT_OPEN',
      transcript_path: '/DO_NOT_OPEN/transcript.jsonl'}, options));
    assert.equal(world.calls.length, index + 1);
    const call = world.calls[index];
    assert.equal(call.url, REMOTE_PATH + '/publish');
    assert.equal(call.headers.authorization, 'Bearer ' + TOKEN);
    assert.equal(call.headers[SOURCE_HEADER], producerSource(SOURCE));
    assert.equal(call.body.schema, REMOTE_SCHEMA);
    const message = call.body.message;
    assert.equal(message.source, producerSource(SOURCE));
    assert.equal(message.data.event.kind, kinds[index]);
    assert.deepEqual(message.data.identity, {...SOURCE, sessionId: base.session_id});
    assert.deepEqual(message.data.turn, {status: 'known', id: base.turn_id});
    assert.ok(Number.isFinite(message.data.observedAtMs));
    assert.deepEqual(Object.keys(message.data).sort(), ['event', 'identity', 'observedAtMs', 'ordering', 'parent', 'turn']);
    assert.equal(JSON.stringify(call.body).includes('PRIVATE_CANARY'), false);
    assert.equal(JSON.stringify(call.body).includes('DO_NOT_OPEN'), false);
  }
});

test('native wrapper drops child, compact and malformed input without publication', async context => {
  const world = await receiver(context);
  for (const input of [
    {...base, hook_event_name: 'Stop', agent_id: 'child'},
    {...base, hook_event_name: 'Stop', agent_id: null},
    {...base, hook_event_name: 'SessionStart', source: 'compact'},
    {...base, hook_event_name: 'PermissionRequest'}, '{', Buffer.from([0xc3, 0x28]),
    Buffer.alloc(8 * 1024 * 1024 + 1, 32),
  ]) quiet(await invoke(world.path, input));
  assert.equal(world.calls.length, 0);
});

test('native metadata guard refuses enrichment before waiting for stdin', async context => {
  for (const lifecycleVersion of ['1.1', '1.2']) {
    const world = await receiver(context, {lifecycleVersion});
    const result = await invoke(world.path, undefined);
    quiet(result);
    assert.ok(result.elapsed < 1500, 'enrichment configuration must refuse before reading input');
    assert.equal(world.calls.length, 0);
  }
});

test('native hook ends open stdin and a stalled receiver within its hard budget', async context => {
  const world = await receiver(context, {hang: true});
  const openInput = await invoke(world.path, undefined);
  quiet(openInput);
  assert.ok(openInput.elapsed >= 2500, 'positive control: valid producer waited for input');
  assert.equal(world.calls.length, 0);
  const stalled = await invoke(world.path, {...base, hook_event_name: 'Stop'});
  quiet(stalled);
  assert.ok(stalled.elapsed >= 2500, 'positive control: request reached the stalled receiver');
  assert.equal(world.calls.length, 1, 'one attempt, no retries');
});

test('native hook fails open when its receiver is unavailable', async context => {
  const world = await receiver(context);
  await new Promise(resolve => world.server.close(resolve));
  quiet(await invoke(world.path, {...base, hook_event_name: 'Stop'}));
  assert.equal(world.calls.length, 0);
});

// The core uses Linux /proc file-identity checks; macOS runs that core in its container.
test('hook reaches the real Linux core and its ingest token cannot read state',
  {skip: process.platform !== 'linux' ? 'core private-file checks require Linux; native hook tests run above' : false}, async context => {
  const {createCoreModule} = await import('../dist/src/index.js');
  const {producerCredentialId, producerSource} = await import('@jimmie-potts/runtime/hook');
  const {edgeConfig, run} = await import('../dist/tests/support.js');
  const source = producerSource(SOURCE);
  const reader = 'r'.repeat(43);
  const files = await edgeConfig(context, [
    {id: producerCredentialId(SOURCE), source, token: TOKEN, scopes: ['ingest']},
    {id: 'synthetic-reader', source: 'bunny/parts/synthetic-reader', token: reader, scopes: ['read']},
  ]);
  const {runtime, logs} = await run(context, {modules: [createCoreModule()], configFile: files.config, edge: {schemas: {}}});
  const path = join(files.dir, 'producer.json');
  await writeFile(path, JSON.stringify({enabled: true, qualified: true, source: SOURCE,
    endpoint: runtime.url + '/api/monitor/v1/events', token: TOKEN}), {mode: 0o600});
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    quiet(await invoke(path, {...base, hook_event_name, source: 'startup', prompt: 'PRIVATE_CANARY'}));
  }
  const route = new URL('/api/v2/families/session', runtime.url);
  let records;
  const deadline = performance.now() + 3000;
  do {
    const response = await fetch(route, {headers: {authorization: 'Bearer ' + reader}});
    assert.equal(response.status, 200);
    records = (await response.json()).records;
    if (records.length === 1 && records[0].notices.length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (performance.now() < deadline);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].identity, {...SOURCE, sessionId: base.session_id});
  assert.equal(records[0].activity, 'idle');
  assert.equal(records[0].notices[0]?.kind, 'turn-ended');
  assert.equal(JSON.stringify(records).includes('PRIVATE_CANARY'), false);
  assert.equal(JSON.stringify(logs).includes('PRIVATE_CANARY'), false);
  assert.equal((await fetch(route, {headers: {authorization: 'Bearer ' + TOKEN}})).status, 403);
});
