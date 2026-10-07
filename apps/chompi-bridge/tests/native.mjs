// Native Windows check: run with native Windows Node 24 after `npm run build`. It enumerates HID devices read-only
// (nothing is opened, read or written), checks that the matcher rejects the attached stock CHOMPI, checks the
// named-pipe single-instance lock across processes, runs the Windows OS adapter's read-only observations, then runs
// the portable suites under this runtime. The adapter check never sends a keystroke or opens a link: its Win32
// surface is wrapped so SendInput (keys, the volume keys and wheel) and ShellExecute throw. On a \\wsl.localhost checkout installed from Linux, the
// win32-x64 koffi prebuild (@koromix/koffi-win32-x64, pinned in the lockfile) must sit beside koffi; npm ci on Windows
// installs it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeHidTransport, loadNodeHid } from '../dist/node-hid-transport.js';
import { matchesController } from '../dist/matcher.js';
import { acquireInstanceLock, defaultLockPath, InstanceLockHeldError } from '../dist/lock.js';
import { CLAUDE_PACKAGE_FAMILY, CODEX_PACKAGE_FAMILY, createWindowsAdapter, loadWin32Api, NAVIGATION_KEY_CODES, UiaHelper, VIRTUAL_KEYS, VOLUME_KEYS } from '../dist/windows/index.js';

assert.equal(process.platform, 'win32', 'native CHOMPI bridge check requires Windows');
assert.equal(process.versions.node.split('.')[0], '24', 'native CHOMPI bridge check requires Node 24');
const here = dirname(fileURLToPath(import.meta.url));

const hid = await loadNodeHid();
const devices = await createNodeHidTransport(async () => hid).list();
const stock = devices.filter(device => device.vendorId === 0x0483 && device.productId === 0x5740);
assert.equal(stock.some(device => matchesController(device)), false, 'the stock CHOMPI ID must never match');
assert.equal(matchesController({ vendorId: 0x0483, productId: 0x5740, product: 'CHOMPI', usagePage: 0xff00, usage: 0x01 }), false);
const controllers = devices.filter(device => matchesController(device));
for (const device of controllers) assert.equal(device.vendorId === 0x1209 && device.productId === 0x000c && device.product === 'Agent Controller', true);

const pipe = `${defaultLockPath()}-native-check-${process.pid}`;
assert.match(pipe, /^\\\\\.\\pipe\\agent-chompi-bridge-/);
const lockModule = new URL('../dist/lock.js', import.meta.url).href;
async function holder() {
  const source = `const {acquireInstanceLock}=await import(${JSON.stringify(lockModule)});
const lock=await acquireInstanceLock(${JSON.stringify(pipe)});
process.stdout.write('held\\n');
process.stdin.on('data',async()=>{await lock.release();process.exit(0);});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', data => { out += data; });
  while (!out.includes('held')) {
    if (child.exitCode !== null) throw new Error('lock holder exited early');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return child;
}

const graceful = await holder();
await assert.rejects(acquireInstanceLock(pipe), InstanceLockHeldError, 'a second holder must be refused');
graceful.stdin.write('release\n');
assert.deepEqual(await once(graceful, 'exit'), [0, null]);
await (await acquireInstanceLock(pipe)).release();

const killed = await holder();
await assert.rejects(acquireInstanceLock(pipe), InstanceLockHeldError);
killed.kill();
await once(killed, 'exit');
await (await acquireInstanceLock(pipe)).release();

// Windows OS adapter, read-only. Both SendInput paths (keys and wheel) and ShellExecute are replaced by throwing guards.
const win32 = await loadWin32Api();
const guarded = { calls: 0 };
const adapterApi = {
  ...win32,
  sendInput: () => { guarded.calls += 1; throw new Error('the native check never sends input'); },
  shellOpen: () => { guarded.calls += 1; throw new Error('the native check never opens links'); },
  sendWheel: () => { guarded.calls += 1; throw new Error('the native check never scrolls'); },
};
const helper = new UiaHelper();
const adapter = createWindowsAdapter({ win32: async () => adapterApi, helper });
const helperStart = Date.now();
assert.deepEqual(await helper.request('ping'), { ok: true, value: { pong: true } }, 'the UI Automation helper answers a ping');
const helperPingMs = Date.now() - helperStart;
// Non-ASCII crosses stdin as \uXXXX escapes; the probe reply is a length and code-unit sum, never the text.
const probeText = `\u00e9\u2014\u4efb\u52a1 \u{1f680} ${randomUUID()}`;
const probeSum = [...Array(probeText.length).keys()].reduce((sum, i) => (sum + probeText.charCodeAt(i)) % 2147483647, 0);
assert.deepEqual(await helper.request('ping', { probe: probeText }), { ok: true, value: { pong: true, probeLength: probeText.length, probeSum } },
  'the helper decodes non-ASCII request text exactly');
// One non-ASCII random title against the running Codex window, found read-only by process; it can never match.
const codexWindow = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '$p = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1; if ($p) { "$([long]$p.MainWindowHandle) $($p.Id)" }'],
{ encoding: 'utf8', timeout: 30000, windowsHide: true }).stdout.trim().split(/\s+/).map(Number);
let nonAsciiTitle = 'codex-not-running';
let codexApprovalCount = 'codex-not-running';
let codexCardButtons = 'codex-not-running';
let codexPicker = 'codex-not-running';
/**
 * The picker read (#906) is read-only: it records which qualified controls the helper finds and which UI Automation
 * patterns they expose (a setting button is listed only when it supports ExpandCollapse; a slider only with RangeValue),
 * never their labels. A refusal, such as an ambiguous Codex picker button, is recorded, not asserted, because it is
 * itself the qualification evidence. No setting action is called.
 */
const pickerShape = reply => {
  if (!reply.ok) return { refused: reply.reason };
  assert.deepEqual(Object.keys(reply.value).sort(), ['announcement', 'effort', 'menu', 'model', 'slider']);
  const { menu, slider, model, effort, announcement } = reply.value;
  if (menu) assert.ok(Array.isArray(menu.items) && menu.items.length <= 64 && Number.isInteger(menu.focused));
  return {
    menu: menu ? { kind: menu.kind, entries: menu.items.length, options: menu.items.filter(item => item.kind === 'option').length, focused: menu.focused, hasFocus: menu.hasFocus } : null,
    slider: slider ? { rangeValue: true, min: slider.min, max: slider.max, step: slider.step } : null,
    modelButton: model ? { expandCollapse: true, expanded: model.expanded } : null,
    effortButton: effort ? { expandCollapse: true, expanded: effort.expanded } : null,
    announcement: announcement !== null,
  };
};
if (codexWindow.length === 2 && codexWindow.every(Number.isInteger)) {
  const reply = await helper.request('codexSelectedTitle', { hwnd: codexWindow[0], processId: codexWindow[1], title: `\u00e9\u2014\u4e2d\u{1f600} ${randomUUID()}` });
  assert.deepEqual(reply, { ok: true, value: { matches: false, sameTitleRows: 0 } }, 'a non-ASCII random title verifies as no match without errors');
  nonAsciiTitle = reply.value;
  // The approval check counts composers in the same window, whether or not Codex is in front; nothing else is read.
  const approvalStart = Date.now();
  const counted = await helper.request('approvalVisible', { client: 'codex', hwnd: codexWindow[0], processId: codexWindow[1] });
  codexApprovalCount = { ...counted, ms: Date.now() - approvalStart };
  assert.equal(counted.ok, true, `approvalVisible: ${counted.reason ?? ''}`);
  assert.deepEqual(Object.keys(counted.value), ['composers']);
  assert.ok(Number.isInteger(counted.value.composers) && counted.value.composers >= 0);
  // The card read (#821) is read-only: it counts buttons and finds the focused index; it never focuses or presses.
  const cardStart = Date.now();
  const card = await helper.request('cardButtons', { client: 'codex', hwnd: codexWindow[0], processId: codexWindow[1] });
  codexCardButtons = { ...card, ms: Date.now() - cardStart };
  assert.equal(card.ok, true, `cardButtons: ${card.reason ?? ''}`);
  assert.deepEqual(Object.keys(card.value), ['composers', 'selectedRows', 'cardGroups', 'cards', 'buttons', 'focused', 'cardId']);
  const pickerStart = Date.now();
  codexPicker = { ...pickerShape(await helper.request('pickerState', { client: 'codex', hwnd: codexWindow[0], processId: codexWindow[1] })), ms: Date.now() - pickerStart };
}
// The same count against the running Claude Desktop window, found read-only by its package folder.
const claudeWindow = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -like \'*\\WindowsApps\\Claude_*__pzs8sxrjxfjjc\\*\' } | Select-Object -First 1; if ($p) { "$([long]$p.MainWindowHandle) $($p.Id)" }'],
{ encoding: 'utf8', timeout: 30000, windowsHide: true }).stdout.trim().split(/\s+/).map(Number);
let claudeApprovalCount = 'claude-not-running';
let claudeCardButtons = 'claude-not-running';
let claudePicker = 'claude-not-running';
if (claudeWindow.length === 2 && claudeWindow.every(Number.isInteger)) {
  const approvalStart = Date.now();
  const counted = await helper.request('approvalVisible', { client: 'claude', hwnd: claudeWindow[0], processId: claudeWindow[1] });
  claudeApprovalCount = { ...counted, ms: Date.now() - approvalStart };
  assert.equal(counted.ok, true, `approvalVisible: ${counted.reason ?? ''}`);
  assert.deepEqual(Object.keys(counted.value), ['approvalCards']);
  assert.ok(Number.isInteger(counted.value.approvalCards) && counted.value.approvalCards >= 0);
  const cardStart = Date.now();
  const card = await helper.request('cardButtons', { client: 'claude', hwnd: claudeWindow[0], processId: claudeWindow[1] });
  claudeCardButtons = { ...card, ms: Date.now() - cardStart };
  assert.equal(card.ok, true, `cardButtons: ${card.reason ?? ''}`);
  assert.deepEqual(Object.keys(card.value), ['cards', 'buttons', 'focused', 'cardId']);
  const pickerStart = Date.now();
  claudePicker = { ...pickerShape(await helper.request('pickerState', { client: 'claude', hwnd: claudeWindow[0], processId: claudeWindow[1] })), ms: Date.now() - pickerStart };
}
const foreground = await adapter.foregroundWindow();
assert.equal(foreground.status, 'known', `foregroundWindow: ${foreground.reason ?? ''}`);
await adapter.releaseAll();
const composerStart = Date.now();
const codexComposer = await adapter.composerFocused('codex');
const composerMs = Date.now() - composerStart;
assert.ok(codexComposer.status === 'known' ? typeof codexComposer.value === 'boolean' : typeof codexComposer.reason === 'string');
const codexSelected = await adapter.codexSelectedThread(randomUUID(), `chompi-native-check-${randomUUID()}`);
if (codexSelected.status === 'known') assert.deepEqual(codexSelected.value, { matches: false, sameTitleRows: 0 }, 'a random title never matches');
const approval = await adapter.approvalVisible('codex');
assert.ok(approval.status === 'known' ? typeof approval.value === 'boolean' : typeof approval.reason === 'string');
const cardButtons = await adapter.cardButtons('codex');
assert.ok(cardButtons.status === 'known' ? cardButtons.value === null || Number.isInteger(cardButtons.value.count) : typeof cardButtons.reason === 'string');
await adapter.warmUp();
const versionsStart = Date.now();
const versions = await adapter.clientVersions();
const versionsAfterWarmUpMs = Date.now() - versionsStart;
assert.equal(versions.codex.status, 'known', `Codex version: ${versions.codex.reason ?? ''}`);
assert.equal(versions.claude.status, 'known', `Claude version: ${versions.claude.reason ?? ''}`);
assert.deepEqual(await adapter.codexArchived(randomUUID()), { status: 'known', value: false });
assert.deepEqual(await adapter.claudeSessions([]), { status: 'known', value: [] });
assert.deepEqual(await adapter.claudeSessions([`local_${randomUUID()}`]), { status: 'known', value: [] }, 'a missing record is omitted');
// The volume keys (#865) use the same guarded SendInput. Their key table is checked, and malformed requests are refused
// before any attempt; no volume key is sent.
assert.deepEqual([...VOLUME_KEYS], [['VolumeUp', 0xaf], ['VolumeDown', 0xae], ['VolumeMute', 0xad]]);
for (const [key, presses] of [['VolumeUp', 0], ['VolumeDown', 11], ['Enter', 1]]) {
  await assert.rejects(adapter.sendVolumeKey(key, presses), error => error.code === 'invalid-volume-request', `${key} x${presses} is refused`);
}
// The model and effort keys (#906) use the same guarded SendInput. Their key table is checked, and malformed client taps
// are refused before the window in front is even read; no key is sent.
assert.deepEqual([...NAVIGATION_KEY_CODES], [['Left', 0x25], ['Right', 0x27], ['Escape', 0x1b]]);
assert.deepEqual([VIRTUAL_KEYS.get('Equal'), VIRTUAL_KEYS.get('Minus')], [0xbb, 0xbd]);
for (const [client, keys, presses] of [['codex', ['PageDown'], 1], ['codex', ['Down'], 1], ['claude', ['Escape'], 0], ['claude', [], 1], ['other', ['Escape'], 1]]) {
  await assert.rejects(adapter.tapInClient(client, keys, presses), error => ['invalid-key-request', 'unknown-key'].includes(error.code), `${client} ${keys} x${presses} is refused`);
}
const pickerCodex = await adapter.pickerState('codex');
assert.ok(pickerCodex.status === 'known' ? pickerCodex.value.effort === null && pickerCodex.value.slider === null : typeof pickerCodex.reason === 'string', 'Codex has no Effort button or slider');
assert.deepEqual(await adapter.claudeSettings(`local_${randomUUID()}`), { status: 'known', value: null }, 'a missing record has no settings');
await adapter.close();
assert.equal(guarded.calls, 0, 'no keystroke or link was attempted');
const foregroundPackage = foreground.value?.packageIdentity ?? null;
// The scroll gate's two reads (GetCursorPos, GetWindowRect) are read-only; scrollClient itself is not exercised.
const cursor = win32.cursorPosition();
const foregroundRoot = win32.rootOwner(win32.foregroundWindow());
const rect = foregroundRoot ? win32.windowRect(foregroundRoot) : null;
assert.ok(cursor && Number.isInteger(cursor.x) && Number.isInteger(cursor.y), 'GetCursorPos reports the pointer');
if (foregroundRoot) assert.ok(rect && rect.right > rect.left && rect.bottom > rect.top, 'GetWindowRect reports the foreground window');

// node --test treats its arguments as globs, where Windows backslashes are escapes; pass names relative to cwd.
// The codec fixture suite stays on the Linux runs: it resolves the protocol workspace through a symlink that
// Windows does not follow on a \\wsl.localhost checkout, and it has no platform-specific code.
const suites = [
  'bridge', 'simulator', 'lock', 'node-hid-transport', 'os-adapter',
  'windows-keyboard', 'windows-uri', 'windows-uia-helper', 'windows-client-files', 'windows-adapter', 'windows-scroll',
  'routing-cli', 'routing-feed', 'routing-knobs', 'routing-lights', 'routing-profile', 'routing-router', 'routing-slots',
].map(name => `${name}.test.mjs`);
const portable = spawnSync(process.execPath, ['--test', ...suites], { cwd: here, encoding: 'utf8', timeout: 120000 });
const failing = [...new Set(`${portable.stdout}`.split('\n').filter(line => line.startsWith('\u2716') && !line.includes('failing tests')))];
assert.equal(portable.status, 0, `portable suites failed (status ${portable.status}): ${failing.join('; ') || 'no failing test named'}\n${(portable.stdout + portable.stderr).slice(-4000)}`);
const count = /^ℹ pass (\d+)$/m.exec(portable.stdout)?.[1];

console.log(JSON.stringify({
  result: 'passed',
  scope: 'read-only HID enumeration, matcher, named-pipe lock, OS adapter observations and portable suites; no device opened, no input sent, no link opened',
  node: process.versions.node,
  hidapi: hid.getHidapiVersion?.() ?? null,
  hidInterfaces: devices.length,
  stockChompiHidInterfaces: stock.length,
  controllerMatches: controllers.length,
  lock: { secondHolderRefused: true, releasedOnExit: true, releasedOnKill: true },
  osAdapter: {
    scope: 'read-only; SendInput (keys, volume keys, wheel, client taps) and ShellExecute guarded, zero attempts; no card button focused or pressed',
    volumeKeys: { table: 'VolumeUp 0xAF, VolumeDown 0xAE, VolumeMute 0xAD', malformedRefused: true, sent: 0 },
    clientTaps: { table: 'Left 0x25, Right 0x27, Escape 0x1B, Equal 0xBB, Minus 0xBD', malformedRefused: true, sent: 0 },
    settingActions: 'none called: no Expand, Collapse, Invoke, SetFocus, Select or SetValue',
    codexPicker,
    claudePicker,
    ffiLoaded: true,
    foreground: foreground.value === null ? 'none' : foregroundPackage === CODEX_PACKAGE_FAMILY ? 'codex' : foregroundPackage === CLAUDE_PACKAGE_FAMILY ? 'claude' : foregroundPackage ? 'other-packaged' : 'unpackaged',
    releaseAllNoop: true,
    scrollGateReads: { cursorKnown: true, foregroundRectKnown: Boolean(rect) },
    helperStartAndPingMs: helperPingMs,
    nonAsciiProbe: 'decoded exactly',
    nonAsciiRandomTitle: nonAsciiTitle,
    clientVersionsAfterWarmUpMs: versionsAfterWarmUpMs,
    composerFocusedCodex: codexComposer,
    composerCheckMs: composerMs,
    codexSelectedThreadRandom: codexSelected,
    approvalVisible: approval,
    codexApprovalCount,
    claudeApprovalCount,
    cardButtonsCodex: cardButtons,
    codexCardButtons,
    claudeCardButtons,
    clientVersions: { codex: versions.codex.value, claude: versions.claude.value },
    codexArchivedRandom: false,
    claudeSessionsEmpty: [],
  },
  portableTestsPassed: Number(count),
}));
