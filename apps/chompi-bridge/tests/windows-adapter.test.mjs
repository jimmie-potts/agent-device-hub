import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLAUDE_PACKAGE_FAMILY, CODEX_PACKAGE_FAMILY, createWindowsAdapter, HeldModifierError, OpenUriError,
} from '../dist/windows/index.js';
import { OS_ADAPTER_VERSION } from '../dist/os-adapter.js';

const thread = '019a3b1c-7d2e-7f00-8a11-0123456789ab';
const CANARY_TITLE = 'CANARY task title 93ab';

/** Fake Win32 surface: one foreground window whose owner process has the given package. */
function fakeWin32({ family = CODEX_PACKAGE_FAMILY, image = 'C:\\Program Files\\WindowsApps\\x\\ChatGPT.exe', hwnd = 0x1234 } = {}) {
  const state = { hwnd, root: hwnd, pid: 4242, family, image, opened: [], sent: [], physical: new Set(), shellResult: 42, open: true };
  return {
    state,
    foregroundWindow: () => state.hwnd,
    rootOwner: () => state.root,
    windowProcessId: () => state.pid,
    processIdentity: () => state.open ? { packageFamily: state.family, imagePath: state.image } : null,
    isKeyDown: vk => state.physical.has(vk),
    sendInput: events => { state.sent.push(events); return { inserted: events.length, error: 0 }; },
    shellOpen: async uri => { state.opened.push(uri); await new Promise(resolve => setTimeout(resolve, 1)); return state.shellResult; },
  };
}

function fakeHelper(handler) {
  const calls = [];
  return {
    calls,
    closed: false,
    async request(op, params = {}) { calls.push({ op, ...params }); return handler(op, params); },
    async close() { this.closed = true; },
  };
}

function adapter(win32, helper = fakeHelper(() => ({ ok: false, reason: 'unused' })), extra = {}) {
  return createWindowsAdapter({ win32: async () => win32, helper, codexHome: '/nonexistent', claudeSessionsRoot: '/nonexistent', ...extra });
}

test('the Windows adapter implements interface version 1', async () => {
  const instance = adapter(fakeWin32());
  assert.equal(instance.version, OS_ADAPTER_VERSION);
  assert.equal(instance.version, 1);
  assert.equal(instance.platform, 'win32');
  await instance.close();
});

test('foregroundWindow reports package identity and process image name only', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  assert.deepEqual(await instance.foregroundWindow(), { status: 'known', value: { packageIdentity: CODEX_PACKAGE_FAMILY, processName: 'ChatGPT.exe' } });
  win32.state.family = null;
  win32.state.image = 'C:\\tools\\wezterm-gui.exe';
  assert.deepEqual(await instance.foregroundWindow(), { status: 'known', value: { packageIdentity: null, processName: 'wezterm-gui.exe' } });
  win32.state.hwnd = 0;
  assert.deepEqual(await instance.foregroundWindow(), { status: 'known', value: null });
  win32.state.hwnd = 0x1234;
  win32.state.open = false;
  assert.deepEqual(await instance.foregroundWindow(), { status: 'unknown', reason: 'process-unavailable' });
  win32.state.open = true;
  win32.state.pid = 0;
  assert.deepEqual(await instance.foregroundWindow(), { status: 'unknown', reason: 'window-process-unavailable' });
  await instance.close();
});

test('a foreground change during the lookup is unknown', async () => {
  const win32 = fakeWin32();
  let calls = 0;
  win32.foregroundWindow = () => (calls++ === 0 ? 0x1234 : 0x9999);
  const instance = adapter(win32);
  assert.deepEqual(await instance.foregroundWindow(), { status: 'unknown', reason: 'foreground-changed' });
});

test('a Win32 load failure makes observations unknown and actions reject', async () => {
  const instance = createWindowsAdapter({ win32: async () => { throw new Error('koffi missing'); }, helper: fakeHelper(() => ({ ok: true, value: {} })) });
  assert.deepEqual(await instance.foregroundWindow(), { status: 'unknown', reason: 'win32-unavailable' });
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'unknown', reason: 'win32-unavailable' });
  await assert.rejects(instance.sendKeys({ action: 'tap', keys: ['Enter'] }), error => error.code === 'win32-unavailable');
  await assert.rejects(instance.openUri(`codex://threads/${thread}`), error => error instanceof OpenUriError && error.code === 'win32-unavailable');
  await instance.releaseAll();
  await instance.close();
});

test('openUri validates the link before handing it to the shell', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  await instance.openUri(`codex://threads/${thread}`);
  await instance.openUri('claude://code/continue?session=local_4f1e2d3c-1b2a-4c5d-8e9f-a0b1c2d3e4f5');
  assert.equal(win32.state.opened.length, 2);
  await assert.rejects(instance.openUri('claude://resume?session=local_4f1e2d3c-1b2a-4c5d-8e9f-a0b1c2d3e4f5'),
    error => error instanceof OpenUriError && error.code === 'invalid-deep-link' && !error.message.includes('resume'));
  await assert.rejects(instance.openUri('file:///C:/Windows/System32/calc.exe'), error => error.code === 'invalid-deep-link');
  assert.equal(win32.state.opened.length, 2, 'rejected links never reach the shell');
  win32.state.shellResult = 31;
  await assert.rejects(instance.openUri(`codex://threads/${thread}`), error => error.code === 'open-uri-failed' && error.shellResult === 31);
});

test('sendKeys and releaseAll go through the held-key tracker', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  await instance.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
  await instance.releaseAll();
  assert.deepEqual(win32.state.sent.at(-1), [{ vk: 0x5b, up: true }, { vk: 0xa2, up: true }]);
  win32.state.physical.add(0xa0);
  await assert.rejects(instance.sendKeys({ action: 'tap', keys: ['Enter'] }), HeldModifierError);
  const before = win32.state.sent.length;
  await instance.releaseAll();
  assert.equal(win32.state.sent.length, before, 'nothing held, nothing sent');
});

test('close releases held keys and stops the helper; later calls fail closed', async () => {
  const win32 = fakeWin32();
  const helper = fakeHelper(() => ({ ok: true, value: { focused: true } }));
  const instance = adapter(win32, helper);
  await instance.sendKeys({ action: 'down', keys: ['LeftControl'] });
  await instance.close();
  assert.deepEqual(win32.state.sent.at(-1), [{ vk: 0xa2, up: true }]);
  assert.equal(helper.closed, true);
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'unknown', reason: 'adapter-closed' });
  await assert.rejects(instance.sendKeys({ action: 'tap', keys: ['Enter'] }), error => error.code === 'adapter-closed');
  await instance.releaseAll();
});

test('composerFocused is false when another app is foreground and asks the helper about the client window otherwise', async () => {
  const win32 = fakeWin32({ family: CLAUDE_PACKAGE_FAMILY });
  win32.state.root = 0x1200;
  const helper = fakeHelper(op => (op === 'composerFocused' ? { ok: true, value: { focused: true } } : { ok: false, reason: 'x' }));
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'known', value: false });
  assert.equal(helper.calls.length, 0, 'no UI query when the client is not foreground');
  assert.deepEqual(await instance.composerFocused('claude'), { status: 'known', value: true });
  assert.deepEqual(helper.calls, [{ op: 'composerFocused', client: 'claude', hwnd: 0x1200, processId: 4242 }]);
  assert.deepEqual(await instance.composerFocused('other'), { status: 'unknown', reason: 'invalid-client' });
});

test('helper failures, malformed replies and foreground changes during a UI check are unknown', async () => {
  const win32 = fakeWin32();
  let reply = { ok: false, reason: 'helper-timeout' };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'unknown', reason: 'helper-timeout' });
  reply = { ok: true, value: { focused: 'yes' } };
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'unknown', reason: 'helper-invalid-reply' });
  reply = { ok: true, value: { focused: true } };
  helper.request = async op => { win32.state.hwnd = 0x7777; return { ok: true, value: { focused: true } }; };
  assert.deepEqual(await instance.composerFocused('codex'), { status: 'unknown', reason: 'foreground-changed' });
});

test('codexSelectedTitle compares inside the helper and returns only a boolean and a count', async () => {
  const win32 = fakeWin32();
  let reply = { ok: true, value: { matches: true, sameTitleRows: 1 } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  const result = await instance.codexSelectedTitle(CANARY_TITLE);
  assert.deepEqual(result, { status: 'known', value: { matches: true, sameTitleRows: 1 } });
  assert.deepEqual(helper.calls[0], { op: 'codexSelectedTitle', hwnd: 0x1234, processId: 4242, title: CANARY_TITLE });
  assert.equal(JSON.stringify(result).includes('CANARY'), false);
  reply = { ok: true, value: { matches: true, sameTitleRows: 2, title: CANARY_TITLE } };
  assert.deepEqual(await instance.codexSelectedTitle(CANARY_TITLE), { status: 'known', value: { matches: true, sameTitleRows: 2 } }, 'extra reply fields are dropped');
  reply = { ok: true, value: { matches: true, sameTitleRows: -1 } };
  assert.deepEqual(await instance.codexSelectedTitle(CANARY_TITLE), { status: 'unknown', reason: 'helper-invalid-reply' });
  reply = { ok: false, reason: 'selected-row-count' };
  assert.deepEqual(await instance.codexSelectedTitle(CANARY_TITLE), { status: 'unknown', reason: 'selected-row-count' });
  for (const title of ['', 'x'.repeat(1025), 42]) {
    assert.deepEqual(await instance.codexSelectedTitle(title), { status: 'unknown', reason: 'invalid-title' });
  }
  win32.state.family = CLAUDE_PACKAGE_FAMILY;
  assert.deepEqual(await instance.codexSelectedTitle(CANARY_TITLE), { status: 'unknown', reason: 'codex-not-foreground' });
});

test('approval-card detection is not qualified and stays unknown', async () => {
  const helper = fakeHelper(() => ({ ok: true, value: {} }));
  const instance = adapter(fakeWin32(), helper);
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'approval-detection-unqualified' });
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'approval-detection-unqualified' });
  assert.equal(helper.calls.length, 0);
});

test('clientVersions returns versions only and marks anything else unknown', async () => {
  const check = async (reply, expected) => assert.deepEqual(await adapter(fakeWin32(), fakeHelper(() => reply)).clientVersions(), expected);
  await check({ ok: true, value: { codex: { version: '26.930.3930.0' }, claude: { version: '2.19675.0.0' } } }, {
    codex: { status: 'known', value: '26.930.3930.0' },
    claude: { status: 'known', value: '2.19675.0.0' },
  });
  await check({ ok: true, value: { codex: { reason: 'not-installed' }, claude: { version: 'C:\\Users\\someone' } } }, {
    codex: { status: 'unknown', reason: 'not-installed' },
    claude: { status: 'unknown', reason: 'helper-invalid-reply' },
  });
  await check({ ok: false, reason: 'helper-timeout' }, {
    codex: { status: 'unknown', reason: 'helper-timeout' },
    claude: { status: 'unknown', reason: 'helper-timeout' },
  });
});

test('client versions are cached for the helper lifetime, refreshed on restart and after ten minutes', async () => {
  let clock = 0;
  let version = '26.930.3930.0';
  let fail = false;
  const helper = fakeHelper(op => {
    if (op === 'ping') return { ok: true, value: { pong: true } };
    return fail ? { ok: false, reason: 'helper-timeout' } : { ok: true, value: { codex: { version }, claude: { version: '2.19675.0.0' } } };
  });
  helper.starts = 1;
  const instance = createWindowsAdapter({ win32: async () => fakeWin32(), helper, now: () => clock });
  await instance.warmUp();
  assert.deepEqual(helper.calls.map(call => call.op), ['ping', 'clientVersions'], 'warm-up starts the helper and fetches versions');
  version = '26.999.0.0';
  assert.equal((await instance.clientVersions()).codex.value, '26.930.3930.0', 'the first call after warm-up is served from the cache');
  assert.equal(helper.calls.length, 2);
  helper.starts = 2;
  assert.equal((await instance.clientVersions()).codex.value, '26.999.0.0', 'a helper restart refreshes');
  version = '27.0.0.0';
  clock += 10 * 60_000 - 1;
  assert.equal((await instance.clientVersions()).codex.value, '26.999.0.0');
  clock += 1;
  assert.equal((await instance.clientVersions()).codex.value, '27.0.0.0', 'the TTL refreshes');
  fail = true;
  clock += 10 * 60_000;
  assert.equal((await instance.clientVersions()).codex.reason, 'helper-timeout');
  fail = false;
  assert.equal((await instance.clientVersions()).codex.value, '27.0.0.0', 'a failed fetch is not cached');
  const before = helper.calls.length;
  clock += 10 * 60_000;
  await Promise.all([instance.clientVersions(), instance.clientVersions(), instance.clientVersions()]);
  assert.equal(helper.calls.length, before + 1, 'concurrent calls share one fetch');
});

test('warmUp never throws, even when the helper rejects', async () => {
  const helper = { request: async () => { throw new Error('boom'); }, close: async () => undefined };
  await createWindowsAdapter({ win32: async () => fakeWin32(), helper }).warmUp();
});

test('openUri waits for the asynchronous shell call and times out a hung activation', async () => {
  const win32 = fakeWin32();
  win32.shellOpen = () => new Promise(() => undefined);
  const instance = adapter(win32, undefined, { openUriTimeoutMs: 20 });
  await assert.rejects(instance.openUri(`codex://threads/${thread}`), error => error.code === 'open-uri-failed' && error.cause?.message === 'open-uri-timeout');
  win32.shellOpen = async () => { throw new Error('ffi'); };
  await assert.rejects(instance.openUri(`codex://threads/${thread}`), error => error.code === 'open-uri-failed');
});

test('releaseAllSync releases held keys synchronously for an exit hook', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  instance.releaseAllSync();
  assert.equal(win32.state.sent.length, 0, 'nothing loaded or held yet');
  await instance.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
  const result = instance.releaseAllSync();
  assert.equal(result, undefined);
  assert.deepEqual(win32.state.sent.at(-1), [{ vk: 0x5b, up: true }, { vk: 0xa2, up: true }], 'released before releaseAllSync returns');
  await instance.sendKeys({ action: 'down', keys: ['LeftAlt'] });
  win32.sendInput = () => { throw new Error('ffi'); };
  assert.doesNotThrow(() => instance.releaseAllSync(), 'a failing release never throws from an exit hook');
});

test('a new foreground process ID for a client invalidates the cached versions', async () => {
  let version = '26.930.3930.0';
  const helper = fakeHelper(op => (op === 'ping'
    ? { ok: true, value: { pong: true } }
    : { ok: true, value: { codex: { version }, claude: { version: '2.19675.0.0' } } }));
  helper.starts = 1;
  const win32 = fakeWin32({ family: null, image: 'C:\\tools\\wezterm-gui.exe' });
  const instance = createWindowsAdapter({ win32: async () => win32, helper });
  const fetches = () => helper.calls.filter(call => call.op === 'clientVersions').length;
  await instance.warmUp();
  assert.equal(fetches(), 1);
  await instance.foregroundWindow();
  await instance.clientVersions();
  assert.equal(fetches(), 1, 'another app in the foreground changes nothing');

  // Codex self-updated and restarted before it was ever seen: its first foreground sighting refreshes.
  version = '26.999.0.0';
  Object.assign(win32.state, { family: CODEX_PACKAGE_FAMILY, pid: 4242 });
  await instance.composerFocused('codex');
  assert.equal((await instance.clientVersions()).codex.value, '26.999.0.0');
  assert.equal(fetches(), 2);
  await instance.foregroundWindow();
  await instance.clientVersions();
  assert.equal(fetches(), 2, 'the same process again keeps the cache');

  version = '27.0.0.0';
  win32.state.pid = 5000; // the client restarted
  await instance.foregroundWindow();
  assert.equal((await instance.clientVersions()).codex.value, '27.0.0.0');
  assert.equal(fetches(), 3);

  Object.assign(win32.state, { family: CLAUDE_PACKAGE_FAMILY, pid: 777 });
  await instance.foregroundWindow();
  await instance.clientVersions();
  assert.equal(fetches(), 4, 'a Claude process change refreshes too');
  Object.assign(win32.state, { family: CODEX_PACKAGE_FAMILY, pid: 5000 });
  await instance.foregroundWindow();
  await instance.clientVersions();
  assert.equal(fetches(), 4, 'returning to the known Codex process keeps the refreshed cache');
});

test('a process change seen while versions are being fetched is not lost', async () => {
  let release;
  const helper = fakeHelper(op => (op === 'clientVersions'
    ? new Promise(resolve => { release = () => resolve({ ok: true, value: { codex: { version: '1.0.0.0' }, claude: { version: '2.0.0.0' } } }); })
    : { ok: true, value: { pong: true } }));
  helper.starts = 1;
  const win32 = fakeWin32({ family: CODEX_PACKAGE_FAMILY });
  const instance = createWindowsAdapter({ win32: async () => win32, helper });
  await instance.foregroundWindow();
  const pending = instance.clientVersions();
  await new Promise(resolve => setImmediate(resolve));
  win32.state.pid = 9999; // Codex restarts while the helper is still answering
  await instance.foregroundWindow();
  release();
  await pending;
  const before = helper.calls.length;
  const next = instance.clientVersions();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await next;
  assert.equal(helper.calls.length, before + 1, 'the answer fetched before the restart is not trusted for the new process');
});
