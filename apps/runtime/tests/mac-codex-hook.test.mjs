import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
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
