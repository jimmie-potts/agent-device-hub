import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // A fixed empty environment: results must not depend on the host's Program Files or profile.
  return createWindowsAdapter({ win32: async () => win32, helper, codexHome: '/nonexistent', claudeSessionsRoot: '/nonexistent', env: {}, ...extra });
}

test('the Windows adapter implements interface version 3', async () => {
  const instance = adapter(fakeWin32());
  assert.equal(instance.version, OS_ADAPTER_VERSION);
  assert.equal(instance.version, 3);
  assert.equal(instance.platform, 'win32');
  await instance.close();
});

test('foregroundWindow takes the package family from a WindowsApps image path when the process has no identity', async () => {
  // Codex Desktop 26.930's window process (ChatGPT.exe) runs from its package folder without package identity.
  const win32 = fakeWin32({ family: null, image: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe' });
  const instance = adapter(win32, undefined, { programFiles: 'C:\\Program Files' });
  assert.deepEqual(await instance.foregroundWindow(), { status: 'known', value: { packageIdentity: CODEX_PACKAGE_FAMILY, processName: 'ChatGPT.exe' } });
  win32.state.image = 'C:\\Users\\me\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\ChatGPT.exe';
  assert.deepEqual(await instance.foregroundWindow(), { status: 'known', value: { packageIdentity: null, processName: 'ChatGPT.exe' } }, 'outside WindowsApps: none');
  win32.state.family = CLAUDE_PACKAGE_FAMILY;
  win32.state.image = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  assert.equal((await instance.foregroundWindow()).value.packageIdentity, CLAUDE_PACKAGE_FAMILY, 'a real package identity always wins');
  await instance.close();
  // Default root: the 64-bit Program Files (ProgramW6432) wins over a 32-bit ProgramFiles.
  const fromEnv = adapter(fakeWin32({ family: null, image: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe' }),
    undefined, { env: { ProgramW6432: 'C:\\Program Files', ProgramFiles: 'C:\\Program Files (x86)' } });
  assert.equal((await fromEnv.foregroundWindow()).value.packageIdentity, CODEX_PACKAGE_FAMILY);
  await fromEnv.close();
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

test('codexSelectedThread compares inside the helper and returns only a boolean and a count', async t => {
  const win32 = fakeWin32();
  let reply = { ok: true, value: { matches: true, sameTitleRows: 1 } };
  const helper = fakeHelper(() => reply);
  const codexHome = mkdtempSync(join(tmpdir(), 'chompi-codex-home-'));
  t.after(() => rmSync(codexHome, { recursive: true, force: true }));
  const instance = adapter(win32, helper, { codexHome });
  const result = await instance.codexSelectedThread(thread, CANARY_TITLE);
  assert.deepEqual(result, { status: 'known', value: { matches: true, sameTitleRows: 1 } });
  assert.deepEqual(helper.calls[0], { op: 'codexSelectedTitle', hwnd: 0x1234, processId: 4242, title: CANARY_TITLE });
  assert.equal(JSON.stringify(result).includes('CANARY'), false);
  reply = { ok: true, value: { matches: true, sameTitleRows: 2, title: CANARY_TITLE } };
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'known', value: { matches: true, sameTitleRows: 2 } }, 'extra reply fields are dropped');
  reply = { ok: true, value: { matches: true, sameTitleRows: -1 } };
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'helper-invalid-reply' });
  reply = { ok: false, reason: 'selected-row-count' };
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'selected-row-count' });
  for (const title of ['', 'x'.repeat(1025), 42]) {
    assert.deepEqual(await instance.codexSelectedThread(thread, title), { status: 'unknown', reason: 'invalid-title' });
  }
  for (const id of ['', 'codex://threads/x', 42]) {
    assert.deepEqual(await instance.codexSelectedThread(id, CANARY_TITLE), { status: 'unknown', reason: 'invalid-thread-id' });
  }
  win32.state.family = CLAUDE_PACKAGE_FAMILY;
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'codex-not-foreground' });
});

test('codexSelectedThread prefers the name Codex keeps for the thread and fails closed on every unknown', async t => {
  const home = mkdtempSync(join(tmpdir(), 'chompi-codex-names-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const index = join(home, 'session_index.jsonl');
  const line = (id, name, at = '2026-10-04T10:00:00Z') => JSON.stringify({ id, thread_name: name, updated_at: at });
  const other = '019a3b1c-7d2e-7f00-8a11-ba9876543210';
  const helper = fakeHelper(() => ({ ok: true, value: { matches: true, sameTitleRows: 1 } }));
  const instance = adapter(fakeWin32(), helper, { codexHome: home });
  assert.deepEqual(await instance.codexSelectedThread(thread, null), { status: 'unknown', reason: 'codex-title-missing' });
  assert.equal(helper.calls.length, 0, 'no name means no UI query');
  await instance.codexSelectedThread(thread, CANARY_TITLE);
  assert.equal(helper.calls.at(-1).title, CANARY_TITLE, 'the Hub title is the fallback for a thread Codex never named');
  writeFileSync(index, line(thread, 'CANARY codex name') + '\n');
  const result = await instance.codexSelectedThread(thread, CANARY_TITLE);
  assert.equal(helper.calls.at(-1).title, 'CANARY codex name', "Codex's own name wins over the Hub title");
  assert.equal(JSON.stringify(result).includes('CANARY'), false);
  const calls = helper.calls.length;
  writeFileSync(index, line(thread, 'CANARY codex name') + '\n' + line(other, 'CANARY codex name') + '\n');
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'codex-name-not-unique' });
  writeFileSync(index, line(other, 'CANARY hub title') + '\n');
  assert.deepEqual(await instance.codexSelectedThread(thread, 'CANARY hub title'), { status: 'unknown', reason: 'codex-name-not-unique' }, 'a fallback another thread holds is not unique');
  writeFileSync(index, line(thread, 'Good') + '\n' + line(thread, '', '2026-10-04T11:00:00Z') + '\n');
  assert.deepEqual(await instance.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'codex-name-invalid' });
  assert.equal(helper.calls.length, calls, 'none of these reach the UI query');
  const missingHome = adapter(fakeWin32(), helper, { codexHome: join(home, 'absent') });
  assert.deepEqual(await missingHome.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'codex-home-missing' }, 'an unreadable index fails closed');
  const unset = adapter(fakeWin32(), helper, { codexHome: undefined, env: {} });
  assert.deepEqual(await unset.codexSelectedThread(thread, CANARY_TITLE), { status: 'unknown', reason: 'codex-home-unset' });
});

test('Claude approval visibility counts approval cards in its foreground window', async () => {
  const win32 = fakeWin32({ family: CLAUDE_PACKAGE_FAMILY });
  win32.state.root = 0x1200;
  let reply = { ok: true, value: { approvalCards: 1 } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'known', value: true });
  assert.deepEqual(helper.calls, [{ op: 'approvalVisible', client: 'claude', hwnd: 0x1200, processId: 4242 }]);
  reply = { ok: true, value: { approvalCards: 0 } };
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'known', value: false });
  reply = { ok: true, value: { approvalCards: 2 } };
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'known', value: true }, 'several cards are still visible');
  for (const value of [{}, { approvalCards: -1 }, { approvalCards: 1.5 }, { approvalCards: '1' }, { composers: 1 }, null, 7]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }
  reply = { ok: false, reason: 'window-mismatch' };
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'window-mismatch' });
  reply = { ok: false, reason: 'Not A Reason' };
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'helper-error' });
});

test('Codex approval visibility is false only while exactly one composer exists, because a card replaces it', async () => {
  const win32 = fakeWin32();
  let reply = { ok: true, value: { composers: 1 } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'known', value: false });
  assert.deepEqual(helper.calls, [{ op: 'approvalVisible', client: 'codex', hwnd: 0x1234, processId: 4242 }]);
  reply = { ok: true, value: { composers: 0 } };
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'codex-composer-absent' });
  reply = { ok: true, value: { composers: 2 } };
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'codex-composer-count' });
  for (const value of [{}, { composers: -1 }, { composers: true }, { approvalCards: 0 }, null]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }
  reply = { ok: false, reason: 'helper-timeout' };
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'helper-timeout' });
});

test('approval visibility is unknown when the client is not in front or the foreground moves during the check', async () => {
  const win32 = fakeWin32();
  const helper = fakeHelper(() => ({ ok: true, value: { approvalCards: 0 } }));
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'claude-not-foreground' });
  win32.state.family = CLAUDE_PACKAGE_FAMILY;
  assert.deepEqual(await instance.approvalVisible('codex'), { status: 'unknown', reason: 'codex-not-foreground' });
  win32.state.hwnd = 0;
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'claude-not-foreground' }, 'no foreground window');
  assert.equal(helper.calls.length, 0, 'no UI query for a window that is not the client');
  win32.state.hwnd = 0x1234;
  helper.request = async () => { win32.state.hwnd = 0x7777; return { ok: true, value: { approvalCards: 0 } }; };
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'foreground-changed' });
  assert.deepEqual(await instance.approvalVisible('other'), { status: 'unknown', reason: 'invalid-client' });
  await instance.close();
  assert.deepEqual(await instance.approvalVisible('claude'), { status: 'unknown', reason: 'adapter-closed' });
});

// Card answers (#821): counts, indexes and booleans only.

test('Claude card buttons come from the one approval card in its foreground window', async () => {
  const win32 = fakeWin32({ family: CLAUDE_PACKAGE_FAMILY });
  win32.state.root = 0x1200;
  let reply = { ok: true, value: { cards: 1, buttons: 5, focused: -1, cardId: '42.7.4' } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'known', value: { id: '42.7.4', count: 5, focused: null } }, 'the composer keeps focus when a card opens');
  assert.deepEqual(helper.calls, [{ op: 'cardButtons', client: 'claude', hwnd: 0x1200, processId: 4242 }]);
  reply = { ok: true, value: { cards: 1, buttons: 3, focused: 2, cardId: '42.7.5' } };
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'known', value: { id: '42.7.5', count: 3, focused: 2 } });
  reply = { ok: true, value: { cards: 0, buttons: 0, focused: -1 } };
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'known', value: null }, 'no card');
  reply = { ok: true, value: { cards: 2, buttons: 0, focused: -1 } };
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'unknown', reason: 'card-count' }, 'several cards are not qualified');
  for (const value of [{}, { cards: 1, buttons: 65, focused: -1 }, { cards: 1, buttons: 2, focused: 2 }, { cards: 1, buttons: 2, focused: -2 },
    { cards: 1, buttons: 2.5, focused: -1 }, { cards: '1', buttons: 2, focused: 0 }, { cards: 1, buttons: 2 },
    { cards: 1, buttons: 2, focused: 0 }, { cards: 1, buttons: 2, focused: 0, cardId: 'Allow once' }, { cards: 1, buttons: 2, focused: 0, cardId: 42 }, null, 7]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.cardButtons('claude'), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }
  reply = { ok: false, reason: 'card-too-many-buttons' };
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'unknown', reason: 'card-too-many-buttons' });
  reply = { ok: false, reason: 'window-mismatch' };
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'unknown', reason: 'window-mismatch' });
});

test('a Codex card is the one on-screen group with text and two actionable buttons in the thread view, focused or not', async () => {
  const win32 = fakeWin32();
  const base = { composers: 0, selectedRows: 1, cardGroups: 1 };
  let reply = { ok: true, value: { composers: 1, selectedRows: 1, cardGroups: 0, cards: 0, buttons: 0, focused: -1 } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'known', value: null }, 'a composer is present: no card');
  assert.deepEqual(helper.calls, [{ op: 'cardButtons', client: 'codex', hwnd: 0x1234, processId: 4242 }]);
  reply = { ok: true, value: { ...base, cards: 1, buttons: 2, focused: 1, cardId: '42.-9.3' } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'known', value: { id: '42.-9.3', count: 2, focused: 1 } }, 'the card group with its approve button focused');
  reply = { ok: true, value: { ...base, cards: 1, buttons: 2, focused: -1, cardId: '42.-9.3' } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'known', value: { id: '42.-9.3', count: 2, focused: null } },
    'the card group with nothing focused, as Codex left it in the 2026-10-05 live check');
  reply = { ok: true, value: { ...base, cardGroups: 0, cards: 0, buttons: 0, focused: -1 } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'codex-card-unestablished' },
    'no on-screen group with text and two actionable buttons: off-screen message actions and the text-less side strip never count');
  reply = { ok: true, value: { ...base, cardGroups: 2, cards: 0, buttons: 0, focused: -1 } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'codex-card-ambiguous' }, 'two candidate groups');
  // Codex may leave keyboard focus on the sidebar row, a button outside the card group: the card stays established.
  reply = { ok: true, value: { ...base, cards: 1, buttons: 2, focused: -1, cardId: '42.-9.4' } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'known', value: { id: '42.-9.4', count: 2, focused: null } },
    'a focused sidebar-like button outside the group still gives the card, with no stop focused');
  for (const selectedRows of [0, 2]) {
    reply = { ok: true, value: { ...base, selectedRows, cardGroups: 0, cards: 0, buttons: 0, focused: -1 } };
    assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'codex-selected-row-count' },
      `${selectedRows} selected rows: not the thread view, so the wheel stays inert`);
  }
  reply = { ok: true, value: { ...base, composers: 2, cardGroups: 0, cards: 0, buttons: 0, focused: -1 } };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'codex-composer-count' });
  reply = { ok: false, reason: 'card-too-many-groups' };
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'card-too-many-groups' });
  for (const value of [
    { cards: 1, buttons: 2, focused: 0 },
    { composers: 0, selectedRows: 1, cards: 1, buttons: 2, focused: 0, cardId: '1.2' },
    { ...base, cardGroups: 513, cards: 0, buttons: 0, focused: -1 },
    { ...base, selectedRows: 2, cards: 1, buttons: 2, focused: 0, cardId: '1.2' },
    { ...base, cardGroups: 2, cards: 1, buttons: 2, focused: 0, cardId: '1.2' },
    { ...base, composers: 1, cards: 1, buttons: 2, focused: 0, cardId: '1.2' },
    { ...base, cards: 0, buttons: 0, focused: -1 },
    { ...base, composers: -1, cards: 0, buttons: 0, focused: -1 },
  ]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }
});

test('focusing and pressing a card button pass only an index and a count and read back indexes and booleans', async () => {
  const win32 = fakeWin32({ family: CLAUDE_PACKAGE_FAMILY });
  let reply = { ok: true, value: { focused: 1 } };
  const helper = fakeHelper(() => reply);
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', 1, 3), { status: 'known', value: 1 });
  assert.deepEqual(helper.calls.at(-1), { op: 'focusCardButton', client: 'claude', cardId: '42.7.5', index: 1, count: 3, hwnd: 0x1234, processId: 4242 });
  reply = { ok: true, value: { focused: -1 } };
  assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', 1, 3), { status: 'known', value: null }, 'focus landed on none of the card buttons');
  for (const value of [{ focused: 3 }, { focused: '1' }, {}, null]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', 1, 3), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }
  reply = { ok: false, reason: 'card-changed' };
  assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', 1, 3), { status: 'unknown', reason: 'card-changed' });

  reply = { ok: true, value: { invoked: true } };
  assert.deepEqual(await instance.invokeCardButton('claude', '42.7.5', 2, 3), { status: 'known', value: true });
  assert.deepEqual(helper.calls.at(-1), { op: 'invokeCardButton', client: 'claude', cardId: '42.7.5', index: 2, count: 3, hwnd: 0x1234, processId: 4242 });
  reply = { ok: true, value: { invoked: false } };
  assert.deepEqual(await instance.invokeCardButton('claude', '42.7.5', 2, 3), { status: 'known', value: false }, 'focus moved: nothing pressed');
  for (const value of [{ invoked: 'yes' }, {}, null]) {
    reply = { ok: true, value };
    assert.deepEqual(await instance.invokeCardButton('claude', '42.7.5', 2, 3), { status: 'unknown', reason: 'helper-invalid-reply' }, JSON.stringify(value));
  }

  const calls = helper.calls.length;
  for (const [index, count] of [[-1, 3], [3, 3], [1.5, 3], ['1', 3], [0, 0], [0, 65], [0, 2.5]]) {
    assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', index, count), { status: 'unknown', reason: 'invalid-card-index' }, `${index}/${count}`);
    assert.deepEqual(await instance.invokeCardButton('claude', '42.7.5', index, count), { status: 'unknown', reason: 'invalid-card-index' }, `${index}/${count}`);
  }
  for (const cardId of ['', 'Allow once', 7, null, '1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17']) {
    assert.deepEqual(await instance.focusCardButton('claude', cardId, 0, 2), { status: 'unknown', reason: 'invalid-card-id' }, String(cardId));
    assert.deepEqual(await instance.invokeCardButton('claude', cardId, 0, 2), { status: 'unknown', reason: 'invalid-card-id' }, String(cardId));
  }
  reply = { ok: false, reason: 'card-changed' };
  assert.equal(helper.calls.length, calls, 'invalid arguments never reach the helper');
  assert.deepEqual(await instance.invokeCardButton('claude', '42.7.6', 2, 3), { status: 'unknown', reason: 'card-changed' }, 'another card or a changed count is unknown, not false');
});

test('card operations query no window when the client is not in front, and a foreground change is unknown', async () => {
  const win32 = fakeWin32();
  const helper = fakeHelper(() => ({ ok: true, value: { invoked: true } }));
  const instance = adapter(win32, helper);
  assert.deepEqual(await instance.cardButtons('claude'), { status: 'unknown', reason: 'claude-not-foreground' });
  assert.deepEqual(await instance.focusCardButton('claude', '42.7.5', 0, 2), { status: 'unknown', reason: 'claude-not-foreground' });
  assert.deepEqual(await instance.invokeCardButton('claude', '42.7.5', 0, 2), { status: 'unknown', reason: 'claude-not-foreground' });
  assert.equal(helper.calls.length, 0);
  helper.request = async () => { win32.state.hwnd = 0x7777; return { ok: true, value: { invoked: true } }; };
  assert.deepEqual(await instance.invokeCardButton('codex', '42.7.5', 0, 2), { status: 'unknown', reason: 'foreground-changed' });
  for (const call of [() => instance.cardButtons('other'), () => instance.focusCardButton('other', '42.7.5', 0, 2), () => instance.invokeCardButton('other', '42.7.5', 0, 2)]) {
    assert.deepEqual(await call(), { status: 'unknown', reason: 'invalid-client' });
  }
  await instance.close();
  assert.deepEqual(await instance.cardButtons('codex'), { status: 'unknown', reason: 'adapter-closed' });
  assert.deepEqual(await instance.invokeCardButton('codex', '42.7.5', 0, 2), { status: 'unknown', reason: 'adapter-closed' });
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

test('a new process of an identity-less Codex window invalidates the cached versions too', async () => {
  let version = '26.930.3930.0';
  const helper = fakeHelper(op => (op === 'ping'
    ? { ok: true, value: { pong: true } }
    : { ok: true, value: { codex: { version }, claude: { version: '2.19675.0.0' } } }));
  helper.starts = 1;
  const image = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.930.3930.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe';
  const win32 = fakeWin32({ family: null, image });
  const instance = createWindowsAdapter({ win32: async () => win32, helper, env: {}, programFiles: 'C:\\Program Files' });
  const fetches = () => helper.calls.filter(call => call.op === 'clientVersions').length;
  await instance.warmUp();
  await instance.foregroundWindow();
  await instance.clientVersions();
  const seen = fetches();
  version = '27.0.0.0';
  win32.state.pid = 9000; // Codex restarted after an update
  await instance.foregroundWindow();
  assert.equal((await instance.clientVersions()).codex.value, '27.0.0.0', 'the derived family tracks the client process');
  assert.equal(fetches(), seen + 1);
  helper.calls.length = 0;
  await instance.composerFocused('codex');
  assert.equal(helper.calls.some(call => call.op === 'composerFocused'), true, 'the helper is asked about the identity-less Codex window');
  await instance.close();
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
