import assert from 'node:assert/strict';
import test from 'node:test';
import { CLAUDE_PACKAGE_FAMILY, CODEX_PACKAGE_FAMILY, createWindowsAdapter, encodeWheelInput, WHEEL_DELTA } from '../dist/windows/index.js';

/** Fake Win32 surface: a foreground window with a rect and a pointer position. Wheel inputs are recorded, never sent. */
function fakeWin32({ family = CODEX_PACKAGE_FAMILY } = {}) {
  const state = {
    hwnd: 0x1234, root: 0x1200, pid: 4242, family,
    rect: { left: 100, top: 50, right: 900, bottom: 650 },
    cursor: { x: 400, y: 300 },
    wheels: [], keys: [], rectFor: [],
  };
  return {
    state,
    foregroundWindow: () => state.hwnd,
    rootOwner: () => state.root,
    windowProcessId: () => state.pid,
    processIdentity: () => ({ packageFamily: state.family, imagePath: 'C:\\x\\ChatGPT.exe' }),
    isKeyDown: () => false,
    sendInput: events => { state.keys.push(events); return { inserted: events.length, error: 0 }; },
    shellOpen: () => 42,
    cursorPosition: () => state.cursor,
    windowRect: hwnd => { state.rectFor.push(hwnd); return state.rect; },
    sendWheel: delta => { state.wheels.push(delta); return { inserted: 1, error: 0 }; },
  };
}

const helper = { request: async () => ({ ok: false, reason: 'unused' }), close: async () => undefined };
const adapter = win32 => createWindowsAdapter({ win32: async () => win32, helper, codexHome: '/x', claudeSessionsRoot: '/x' });

test('the foreground client with the pointer inside its window gets one wheel input of notches x 120', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  assert.deepEqual(await instance.scrollClient('codex', 3), { status: 'known', value: true });
  assert.deepEqual(await instance.scrollClient('codex', -2), { status: 'known', value: true });
  assert.deepEqual(win32.state.wheels, [360, -240], 'positive notches scroll up');
  assert.deepEqual(win32.state.rectFor, [0x1200, 0x1200], 'the rect is the root-owner window');
  assert.deepEqual(win32.state.keys, [], 'no key is typed');
  assert.equal(WHEEL_DELTA, 120);
});

test('nothing is sent when the client is not foreground or the pointer is outside its window', async () => {
  const win32 = fakeWin32({ family: CLAUDE_PACKAGE_FAMILY });
  const instance = adapter(win32);
  assert.deepEqual(await instance.scrollClient('codex', 1), { status: 'known', value: false });
  win32.state.family = null;
  assert.deepEqual(await instance.scrollClient('codex', 1), { status: 'known', value: false });
  win32.state.hwnd = 0;
  assert.deepEqual(await instance.scrollClient('claude', 1), { status: 'known', value: false });
  win32.state.hwnd = 0x1234;
  win32.state.family = CLAUDE_PACKAGE_FAMILY;
  for (const cursor of [{ x: 99, y: 300 }, { x: 900, y: 300 }, { x: 400, y: 49 }, { x: 400, y: 650 }, { x: -5, y: -5 }]) {
    win32.state.cursor = cursor;
    assert.deepEqual(await instance.scrollClient('claude', 1), { status: 'known', value: false }, JSON.stringify(cursor));
  }
  win32.state.cursor = { x: 100, y: 50 };
  assert.deepEqual(await instance.scrollClient('claude', 1), { status: 'known', value: true }, 'the top-left edge is inside');
  assert.deepEqual(win32.state.wheels, [120]);
  assert.deepEqual(await instance.scrollClient('claude', 0), { status: 'known', value: false }, 'zero notches sends nothing');
  assert.deepEqual(win32.state.wheels, [120]);
});

test('notches are clamped to plus or minus ten per call and must be integers', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  await instance.scrollClient('codex', 25);
  await instance.scrollClient('codex', -11);
  await instance.scrollClient('codex', 10);
  assert.deepEqual(win32.state.wheels, [1200, -1200, 1200]);
  for (const notches of [1.5, Number.NaN, Infinity, '3', null]) {
    assert.deepEqual(await instance.scrollClient('codex', notches), { status: 'unknown', reason: 'invalid-notches' }, String(notches));
  }
  assert.deepEqual(await instance.scrollClient('other', 1), { status: 'unknown', reason: 'invalid-client' });
  assert.equal(win32.state.wheels.length, 3);
});

test('an FFI failure or an uninserted wheel event is unknown', async () => {
  for (const [label, patch, reason] of [
    ['cursor throws', w => { w.cursorPosition = () => { throw new Error('ffi'); }; }, 'win32-call-failed'],
    ['cursor unavailable', w => { w.cursorPosition = () => null; }, 'cursor-unavailable'],
    ['rect unavailable', w => { w.windowRect = () => null; }, 'window-rect-unavailable'],
    ['send throws', w => { w.sendWheel = () => { throw new Error('ffi'); }; }, 'win32-call-failed'],
    ['not inserted', w => { w.sendWheel = () => ({ inserted: 0, error: 5 }); }, 'send-input-failed'],
  ]) {
    const win32 = fakeWin32();
    patch(win32);
    assert.deepEqual(await adapter(win32).scrollClient('codex', 1), { status: 'unknown', reason }, label);
  }
  const unavailable = createWindowsAdapter({ win32: async () => { throw new Error('koffi missing'); }, helper });
  assert.deepEqual(await unavailable.scrollClient('codex', 1), { status: 'unknown', reason: 'win32-unavailable' });
});

test('a foreground change just before sending sends nothing', async () => {
  const win32 = fakeWin32();
  let calls = 0;
  win32.foregroundWindow = () => (++calls <= 2 ? 0x1234 : 0x9999);
  assert.deepEqual(await adapter(win32).scrollClient('codex', 1), { status: 'unknown', reason: 'foreground-changed' });
  assert.deepEqual(win32.state.wheels, []);
});

test('a closed adapter does not scroll', async () => {
  const win32 = fakeWin32();
  const instance = adapter(win32);
  await instance.close();
  assert.deepEqual(await instance.scrollClient('codex', 1), { status: 'unknown', reason: 'adapter-closed' });
  assert.deepEqual(win32.state.wheels, []);
});

test('a wheel INPUT record uses the 64-bit Win32 MOUSEINPUT layout', () => {
  const buffer = encodeWheelInput(-360);
  assert.equal(buffer.length, 40);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  assert.equal(view.getUint32(0, true), 0, 'INPUT_MOUSE');
  assert.equal(view.getInt32(8, true), 0, 'dx');
  assert.equal(view.getInt32(12, true), 0, 'dy: the pointer never moves');
  assert.equal(view.getInt32(16, true), -360, 'mouseData carries the signed wheel delta');
  assert.equal(view.getUint32(20, true), 0x0800, 'MOUSEEVENTF_WHEEL only, no move or button flags');
  assert.equal(view.getUint32(24, true), 0, 'time');
  assert.equal(view.getBigUint64(32, true), 0n, 'dwExtraInfo');
});
