import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { asciiJson, encodeHelperCommand, helperScriptPath, UiaHelper } from '../dist/windows/index.js';

/** A scripted stand-in for the PowerShell helper process. */
class FakeChild extends EventEmitter {
  constructor({ ready = true, reply } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.requests = [];
    this.killed = false;
    this.ended = false;
    this.reply = reply;
    this.writes = [];
    this.stdin = Object.assign(new EventEmitter(), {
      write: chunk => {
        this.writes.push(chunk);
        if (this.onWrite?.(chunk, this) === false) return true;
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          const request = JSON.parse(line);
          this.requests.push(request);
          this.reply?.(request, this);
        }
        return true;
      },
      end: () => { this.ended = true; queueMicrotask(() => this.exit(0)); },
    });
    if (ready) queueMicrotask(() => this.out({ ready: true, protocol: 1 }));
  }
  out(value) { this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
  raw(text) { this.stdout.emit('data', Buffer.from(text)); }
  exit(code) { if (this.exited) return; this.exited = true; this.emit('exit', code, null); }
  kill() { this.killed = true; queueMicrotask(() => this.exit(null)); return true; }
}

function spawner(make) {
  const children = [];
  const spawn = () => { const child = make(children.length); children.push(child); return child; };
  return { spawn, children };
}

const echo = (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: true, value: { op: request.op } }));

test('requests and replies are newline-delimited JSON matched by request ID', async () => {
  const { spawn, children } = spawner(() => new FakeChild({
    reply: (request, child) => {
      // Reply out of order, split across chunks, with two replies in one chunk.
      if (request.id === 1) return;
      const first = JSON.stringify({ id: 1, ok: true, value: { pong: true } });
      const second = JSON.stringify({ id: 2, ok: true, value: { focused: false } });
      queueMicrotask(() => { child.raw(second.slice(0, 7)); child.raw(second.slice(7) + '\n' + first + '\n'); });
    },
  }));
  const helper = new UiaHelper({ spawn });
  const [a, b] = await Promise.all([helper.request('ping'), helper.request('composerFocused', { hwnd: 5, processId: 9 })]);
  assert.deepEqual(a, { ok: true, value: { pong: true } });
  assert.deepEqual(b, { ok: true, value: { focused: false } });
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].requests[1], { id: 2, op: 'composerFocused', hwnd: 5, processId: 9 });
  await helper.close();
  assert.equal(children[0].ended, true);
});

test('a request timeout kills the helper and the next request starts a fresh one', async () => {
  const { spawn, children } = spawner(index => new FakeChild({ reply: index === 0 ? undefined : echo }));
  const helper = new UiaHelper({ spawn, requestTimeoutMs: 30 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-timeout' });
  assert.equal(children[0].killed, true);
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('a crash fails pending requests and the helper restarts on demand', async () => {
  const { spawn, children } = spawner(index => new FakeChild({
    reply: index === 0 ? (request, child) => queueMicrotask(() => child.exit(1)) : echo,
  }));
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-exited' });
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('a helper that never reports ready is stopped', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ ready: false }));
  const helper = new UiaHelper({ spawn, startTimeoutMs: 30 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-start-timeout' });
  assert.equal(children[0].killed, true);
  await helper.close();
});

test('a spawn failure is an unknown reason, not an exception', async () => {
  const helper = new UiaHelper({ spawn: () => { throw new Error('ENOENT powershell.exe'); } });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-spawn-failed' });
  const erroring = new UiaHelper({ spawn: () => { const child = new FakeChild({ ready: false }); queueMicrotask(() => child.emit('error', new Error('spawn EACCES'))); return child; } });
  assert.deepEqual(await erroring.request('ping'), { ok: false, reason: 'helper-exited' });
});

test('the queue is bounded', async () => {
  const { spawn } = spawner(() => new FakeChild());
  const helper = new UiaHelper({ spawn, maxPending: 2, requestTimeoutMs: 50 });
  const first = helper.request('ping');
  const second = helper.request('ping');
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-busy' });
  await Promise.all([first, second]);
  await helper.close();
});

test('restarts are rate limited', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: (request, child) => queueMicrotask(() => child.exit(1)) }));
  let now = 0;
  const helper = new UiaHelper({ spawn, restartBudget: { count: 2, windowMs: 1000 }, now: () => now });
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal((await helper.request('ping')).reason, 'helper-restart-limit');
  assert.equal(children.length, 2);
  now = 1001;
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal(children.length, 3);
  await helper.close();
});

test('oversized or malformed output is a protocol error and never echoed', async () => {
  const canary = 'CANARY-conversation-title-1f3a';
  const { spawn, children } = spawner(index => new FakeChild({
    reply: index === 0
      ? (request, child) => queueMicrotask(() => child.raw('x'.repeat(70000)))
      : (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: false, reason: `Exception: ${canary}` })),
  }));
  const helper = new UiaHelper({ spawn, maxLineLength: 65536 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-protocol-error' });
  assert.equal(children[0].killed, true);
  const reply = await helper.request('ping');
  assert.deepEqual(reply, { ok: false, reason: 'helper-error' }, 'free-text reasons are replaced');
  assert.equal(JSON.stringify(reply).includes(canary), false);
  await helper.close();
});

test('requests after close are refused without spawning', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: echo }));
  const helper = new UiaHelper({ spawn });
  await helper.close();
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-closed' });
  assert.equal(children.length, 0);
});

test('the shipped helper script is read-only and fits one PowerShell command line', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  for (const forbidden of [
    /SetFocus/i, /\.Invoke\(/, /InvokePattern/, /SetValue/, /\.Select\(\)/, /AddToSelection/, /\.Toggle\(/, /\.Expand\(/,
    /SendKeys/i, /SendInput/i, /keybd_event/i, /mouse_event/i, /Start-Process/i, /Invoke-Item/i, /ShellExecute/i,
    /Out-File/i, /Set-Content/i, /Add-Content/i, /Write-Host/i, /Write-Output/i, /Current\.Name\s*\}/,
  ]) assert.equal(forbidden.test(script), false, `helper script must not use ${forbidden}`);
  const encoded = encodeHelperCommand(script);
  assert.ok(encoded.length < 30000, `encoded helper is ${encoded.length} characters; Windows allows 32767 per command line`);
  assert.equal(Buffer.from(encoded, 'base64').toString('utf16le'), script);
});

const NON_ASCII_TITLES = ['Résumé café', 'Plan \u2014 review', '\u4efb\u52a1\u8def\u7531', 'Ship it \u{1f680}', 'mixed \u00e9\u2014\u4e2d\u{1f600}\u0000\u007f'];

/** Windows PowerShell 5.1 reads redirected stdin in the console code page; decoding bytes as Latin-1 models that. */
const powershellStyleDecode = line => JSON.parse(Buffer.from(line, 'utf8').toString('latin1'));

test('request lines are pure ASCII and non-ASCII titles survive a code-page decoder', () => {
  for (const title of NON_ASCII_TITLES) {
    const line = asciiJson({ id: 1, op: 'codexSelectedTitle', title });
    assert.match(line, /^[\x00-\x7f]*$/, JSON.stringify(title));
    assert.equal(powershellStyleDecode(line).title, title, 'escapes decode to the exact UTF-16 string');
  }
  assert.equal(asciiJson({ t: '\u{1f680}' }), '{"t":"\\ud83d\\ude80"}', 'a surrogate pair becomes two escapes');
  // Raw UTF-8 would not survive the same decoder: this is the bug the escaping prevents.
  assert.notEqual(powershellStyleDecode(JSON.stringify({ title: NON_ASCII_TITLES[0] })).title, NON_ASCII_TITLES[0]);
});

test('the helper client writes only ASCII to the helper stdin', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: true, value: { matches: false, sameTitleRows: 0 } })) }));
  const helper = new UiaHelper({ spawn });
  for (const title of NON_ASCII_TITLES) {
    assert.deepEqual(await helper.request('codexSelectedTitle', { hwnd: 1, processId: 2, title }), { ok: true, value: { matches: false, sameTitleRows: 0 } });
  }
  for (const chunk of children[0].writes) assert.match(chunk, /^[\x00-\x7f]*$/);
  assert.deepEqual(children[0].writes.map(chunk => powershellStyleDecode(chunk.trim()).title), NON_ASCII_TITLES);
  await helper.close();
});

test('a reply split inside a multi-byte character still decodes', async () => {
  const { spawn } = spawner(() => new FakeChild({
    reply: (request, child) => queueMicrotask(() => {
      const bytes = Buffer.from(JSON.stringify({ id: request.id, ok: true, value: { note: '\u00e9\u{1f680}' } }) + '\n');
      const cut = bytes.indexOf(0xf0) + 2; // inside the four-byte emoji
      child.stdout.emit('data', bytes.subarray(0, cut));
      child.stdout.emit('data', bytes.subarray(cut));
    }),
  }));
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { note: '\u00e9\u{1f680}' } });
  await helper.close();
});

test('a broken stdin pipe is a helper failure, not a crash, and the next request restarts', async () => {
  const { spawn, children } = spawner(index => {
    const child = new FakeChild({ reply: index === 0 ? undefined : echo });
    if (index === 0) child.onWrite = (chunk, self) => { queueMicrotask(() => self.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); return false; };
    return child;
  });
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-exited' });
  assert.equal(children[0].killed, true);
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('the helper script escapes non-ASCII replies and answers a decode probe without echoing text', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /\$NonAscii = \[regex\]'\[\^\\x00-\\x7F\]'/);
  assert.match(script, /Reply\(\$value\) \{\n\s+\[Console\]::Out\.WriteLine\(\$NonAscii\.Replace\(/);
  assert.match(script, /probeLength = \$text\.Length; probeSum = \$sum/);
  assert.equal(/\[Console\]::(Out\.Write|WriteLine)\((?!\$NonAscii)/.test(script), false, 'every reply goes through the escaper');
});
