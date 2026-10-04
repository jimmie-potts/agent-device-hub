import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeKeyboardInputs, HeldModifierError, INPUT_SIZE, Keyboard, KeyboardError, virtualKeyCode,
} from '../dist/windows/index.js';

/** A fake SendInput/GetAsyncKeyState pair. `physical` holds keys the user is pressing; injected keys count as down too. */
function fakeKeyboardApi({ physical = [], insertLimit = Infinity, throwOnSend = false } = {}) {
  const down = new Set(physical);
  const calls = [];
  return {
    calls, down,
    insertLimit,
    isKeyDown(vk) {
      if (down.has(vk)) return true;
      if (vk === 0x10) return down.has(0xa0) || down.has(0xa1);
      if (vk === 0x11) return down.has(0xa2) || down.has(0xa3);
      if (vk === 0x12) return down.has(0xa4) || down.has(0xa5);
      return false;
    },
    sendInput(events) {
      calls.push(events.map(event => ({ ...event })));
      if (throwOnSend) throw new Error('ffi-crash');
      const inserted = Math.min(events.length, this.insertLimit);
      for (const event of events.slice(0, inserted)) {
        if (event.up) down.delete(event.vk); else down.add(event.vk);
      }
      return { inserted, error: inserted < events.length ? 5 : 0 };
    },
  };
}

const step = (vk, up) => ({ vk, up });

test('platform-neutral key names map to Windows virtual-key codes', () => {
  assert.equal(virtualKeyCode('Enter'), 0x0d);
  assert.equal(virtualKeyCode('LeftControl'), 0xa2);
  assert.equal(virtualKeyCode('LeftShift'), 0xa0);
  assert.equal(virtualKeyCode('LeftAlt'), 0xa4);
  assert.equal(virtualKeyCode('LeftWindows'), 0x5b);
  assert.equal(virtualKeyCode('A'), 0x41);
  assert.equal(virtualKeyCode('L'), 0x4c);
  assert.equal(virtualKeyCode('Z'), 0x5a);
  assert.equal(virtualKeyCode('0'), 0x30);
  assert.equal(virtualKeyCode('9'), 0x39);
  for (const name of ['l', 'Escape', 'RightControl', 'F4', '', 'Enter ', 'Delete']) {
    assert.throws(() => virtualKeyCode(name), error => error instanceof KeyboardError && error.code === 'unknown-key', name);
  }
});

test('tap sends one complete down/up sequence and leaves nothing held', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  keyboard.send({ action: 'tap', keys: ['LeftAlt', 'L'] });
  assert.deepEqual(api.calls, [[step(0xa4, false), step(0x4c, false), step(0x4c, true), step(0xa4, true)]]);
  assert.deepEqual(keyboard.held, []);
  keyboard.send({ action: 'tap', keys: ['Enter'] });
  assert.deepEqual(api.calls[1], [step(0x0d, false), step(0x0d, true)]);
});

test('down holds a chord until up releases it in reverse order', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  keyboard.send({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
  assert.deepEqual(api.calls[0], [step(0xa2, false), step(0x5b, false)]);
  assert.deepEqual(keyboard.held, ['LeftControl', 'LeftWindows']);
  keyboard.send({ action: 'up', keys: ['LeftControl', 'LeftWindows'] });
  assert.deepEqual(api.calls[1], [step(0x5b, true), step(0xa2, true)]);
  assert.deepEqual(keyboard.held, []);
});

test('up releases only keys this adapter holds', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  keyboard.send({ action: 'up', keys: ['LeftControl'] });
  assert.equal(api.calls.length, 0, 'a key-up is never injected for a key the adapter did not press');
  keyboard.send({ action: 'down', keys: ['LeftControl'] });
  keyboard.send({ action: 'up', keys: ['LeftControl', 'LeftWindows'] });
  assert.deepEqual(api.calls[1], [step(0xa2, true)]);
});

test('a modifier the user is physically holding rejects typing with a held-modifier error', () => {
  for (const vk of [0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c]) {
    const api = fakeKeyboardApi({ physical: [vk] });
    const keyboard = new Keyboard(api);
    for (const action of ['tap', 'down']) {
      assert.throws(() => keyboard.send({ action, keys: ['Enter'] }),
        error => error instanceof HeldModifierError && error.code === 'held-modifier', `vk ${vk} ${action}`);
    }
    assert.equal(api.calls.length, 0, 'nothing is typed into an unknown modifier state');
  }
});

test('a target key already physically down is refused', () => {
  const api = fakeKeyboardApi({ physical: [0x0d] });
  const keyboard = new Keyboard(api);
  assert.throws(() => keyboard.send({ action: 'tap', keys: ['Enter'] }), error => error.code === 'held-key');
  assert.equal(api.calls.length, 0);
});

test('modifiers the adapter itself holds are expected, including the generic left/right codes', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  keyboard.send({ action: 'down', keys: ['LeftControl'] });
  keyboard.send({ action: 'down', keys: ['LeftWindows'] });
  assert.deepEqual(keyboard.held, ['LeftControl', 'LeftWindows']);
  assert.throws(() => keyboard.send({ action: 'down', keys: ['LeftControl'] }), error => error.code === 'key-already-down');
  assert.throws(() => keyboard.send({ action: 'tap', keys: ['Enter'] }), error => error.code === 'keys-held',
    'a tap while the adapter holds a chord would type a different shortcut');
  api.down.add(0xa1); // the user presses right Shift while the chord is held
  assert.throws(() => keyboard.send({ action: 'down', keys: ['A'] }), HeldModifierError);
});

test('releaseAll releases every held key in reverse order and never throws', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  assert.equal(keyboard.releaseAll(), true);
  assert.equal(api.calls.length, 0, 'releaseAll with nothing held sends nothing');
  keyboard.send({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
  assert.equal(keyboard.releaseAll(), true);
  assert.deepEqual(api.calls.at(-1), [step(0x5b, true), step(0xa2, true)]);
  assert.deepEqual(keyboard.held, []);

  const failing = fakeKeyboardApi();
  const stuck = new Keyboard(failing);
  stuck.send({ action: 'down', keys: ['LeftControl'] });
  failing.sendInput = () => { throw new Error('ffi-crash'); };
  assert.equal(stuck.releaseAll(), false);
  assert.deepEqual(stuck.held, ['LeftControl'], 'the outstanding key stays tracked for the next attempt');
  assert.equal(stuck.recoveryPending, true);
  assert.throws(() => stuck.send({ action: 'down', keys: ['A'] }), error => error.code === 'release-pending');
});

test('a partial SendInput insertion releases the inserted prefix and rejects', () => {
  const api = fakeKeyboardApi({ insertLimit: 1 });
  const keyboard = new Keyboard(api);
  assert.throws(() => keyboard.send({ action: 'tap', keys: ['LeftAlt', 'L'] }), error => {
    assert.equal(error.code, 'send-input-failed');
    assert.equal(error.inserted, 1);
    assert.equal(error.expected, 4);
    return true;
  });
  // Recovery inserts one event per call here: the inserted LeftAlt down is released.
  assert.deepEqual(api.calls[1], [step(0xa4, true)]);
  assert.deepEqual(keyboard.held, []);
  assert.equal(api.down.size, 0);
  assert.equal(keyboard.recoveryPending, false);
});

test('a SendInput exception treats every attempted key as possibly down and recovers', () => {
  const api = fakeKeyboardApi({ throwOnSend: true });
  const keyboard = new Keyboard(api);
  assert.throws(() => keyboard.send({ action: 'down', keys: ['LeftControl', 'LeftWindows'] }), error => error.code === 'send-input-failed');
  assert.equal(keyboard.recoveryPending, true, 'release attempts also threw');
  api.sendInput = events => ({ inserted: events.length, error: 0 });
  assert.equal(keyboard.releaseAll(), true);
  assert.deepEqual(keyboard.held, []);
});

test('malformed key requests are rejected before anything is sent', () => {
  const api = fakeKeyboardApi();
  const keyboard = new Keyboard(api);
  const bad = [
    { action: 'press', keys: ['Enter'] }, { action: 'tap', keys: [] }, { action: 'tap', keys: ['Enter', 'Enter'] },
    { action: 'tap', keys: 'Enter' }, { action: 'tap', keys: Array(9).fill('A').map((_, i) => String(i)) }, null,
  ];
  for (const request of bad) assert.throws(() => keyboard.send(request), error => error instanceof KeyboardError, JSON.stringify(request));
  assert.throws(() => keyboard.send({ action: 'tap', keys: ['Enter', 'Nope'] }), error => error.code === 'unknown-key');
  assert.equal(api.calls.length, 0);
});

test('keyboard INPUT records use the 64-bit Win32 layout', () => {
  assert.equal(INPUT_SIZE, 40);
  const buffer = encodeKeyboardInputs([step(0x5b, false), step(0x5b, true), step(0x0d, true)]);
  assert.equal(buffer.length, 120);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  assert.equal(view.getUint32(0, true), 1, 'INPUT_KEYBOARD');
  assert.equal(view.getUint16(8, true), 0x5b, 'wVk at offset 8');
  assert.equal(view.getUint16(10, true), 0, 'wScan');
  assert.equal(view.getUint32(12, true), 0x0001, 'left Windows is an extended key');
  assert.equal(view.getUint32(40 + 12, true), 0x0003, 'extended key-up');
  assert.equal(view.getUint16(80 + 8, true), 0x0d);
  assert.equal(view.getUint32(80 + 12, true), 0x0002, 'Enter key-up is not extended');
  assert.equal(view.getUint32(16, true), 0, 'time');
  assert.equal(view.getBigUint64(24, true), 0n, 'dwExtraInfo');
});
