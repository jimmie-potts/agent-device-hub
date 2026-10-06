import assert from 'node:assert/strict';
import test from 'node:test';
import { ManualClock } from '../dist/clock.js';
import { OS_ADAPTER_VERSION } from '../dist/os-adapter.js';
import { CLIENT_PACKAGES } from '../dist/routing/router.js';
import { SimulatedDesktop, createSimulatedOsAdapter } from '../dist/sim/desktop.js';
import { FakeAdapter, known, lid, tid } from './routing-helpers.mjs';

/**
 * The adapter behavior the router relies on (#853). The scripted test fake and the simulated desktop that disposable
 * verification runs use must both meet it, so a run cannot pass on behavior the router's own tests never assumed.
 * Each driver sets up the same desktop through its own interface.
 */
const DRIVERS = {
  'test fake': clock => {
    const adapter = new FakeAdapter(clock);
    return {
      adapter,
      codexThread(id, title) { adapter.codexThreads.set(id, title); },
      claudeSession(localId) { adapter.claudeRecords.set(localId, { localId, isArchived: false, lastFocusedAt: null }); },
      archive(client, id) { if (client === 'codex') adapter.codexArchivedIds.add(id); else adapter.claudeRecords.get(id).isArchived = true; },
      front(window) {
        adapter.foreground = window === 'other'
          ? { packageIdentity: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', processName: 'WindowsTerminal.exe' }
          : { packageIdentity: CLIENT_PACKAGES[window], processName: window === 'codex' ? 'ChatGPT.exe' : 'claude.exe' };
      },
      openCard(client, stops, focused = null) { adapter.openCard(client, stops, focused); },
      focusComposer(client) { adapter.composer[client] = true; },
      selectClaude(localId) { adapter.claudeSelected = localId; },
      pickers: adapter.pickers,
      typed: () => adapter.clientTaps.length,
    };
  },
  'simulated desktop': clock => {
    const desktop = new SimulatedDesktop({ clock });
    return {
      adapter: createSimulatedOsAdapter(desktop),
      desktop,
      codexThread(id, title) { desktop.addCodexThread(id, title); },
      claudeSession(localId) { desktop.addClaudeSession(localId, `Session ${localId.slice(-2)}`); },
      archive(client, id) { desktop.archive(client, id); },
      front(window) { desktop.bringToFront(window); },
      openCard(client, stops, focused = null) { desktop.openCard(client, { kind: 'approval', stops: Array.from({ length: stops }, (_, i) => `Option ${i + 1}`), focused }); },
      focusComposer(client) { desktop.focusComposer(client, true); },
      selectClaude(localId) { desktop.select('claude', localId); },
      pickers: desktop.pickers,
      typed: () => desktop.log.filter(e => e.kind === 'key').length,
    };
  },
};

for (const [name, make] of Object.entries(DRIVERS)) {
  test(`${name}: version 5 shape and the foreground window by package identity`, async () => {
    const d = make(new ManualClock(1_000));
    assert.equal(d.adapter.version, OS_ADAPTER_VERSION);
    assert.equal(typeof d.adapter.platform, 'string');
    for (const method of ['clientVersions', 'foregroundWindow', 'openUri', 'sendKeys', 'sendVolumeKey', 'releaseAll', 'scrollClient', 'codexSelectedThread', 'composerFocused',
      'approvalVisible', 'cardButtons', 'focusCardButton', 'invokeCardButton', 'tapInClient', 'pickerState', 'claudeSettings', 'codexArchived', 'claudeSessions', 'close']) {
      assert.equal(typeof d.adapter[method], 'function', method);
    }
    const versions = await d.adapter.clientVersions();
    assert.deepEqual(versions, { codex: known('26.930.3930.0'), claude: known('2.19675.0.0') }, 'both clients start at the shipped qualified versions');
    d.front('other');
    const other = await d.adapter.foregroundWindow();
    assert.equal(other.status, 'known');
    assert.ok(!Object.values(CLIENT_PACKAGES).includes(other.value.packageIdentity), 'another app is not a client');
    d.front('claude');
    assert.equal((await d.adapter.foregroundWindow()).value.packageIdentity, CLIENT_PACKAGES.claude);
  });

  test(`${name}: a Codex link raises Codex on the thread; its shortcut focuses the composer`, async () => {
    const d = make(new ManualClock(1_000));
    d.codexThread(tid(1), 'Task 1');
    d.codexThread(tid(2), 'Task 2');
    d.front('other');
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(false));
    assert.equal((await d.adapter.codexSelectedThread(tid(1), 'Task 1')).status, 'unknown', 'not in front');
    await d.adapter.openUri(`codex://threads/${tid(1)}`);
    assert.equal((await d.adapter.foregroundWindow()).value.packageIdentity, CLIENT_PACKAGES.codex);
    assert.deepEqual(await d.adapter.codexSelectedThread(tid(1), 'Task 1'), known({ matches: true, sameTitleRows: 1 }));
    assert.deepEqual(await d.adapter.codexSelectedThread(tid(2), 'Task 2'), known({ matches: false, sameTitleRows: 1 }));
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(false), 'the link does not focus the composer');
    await d.adapter.sendKeys({ action: 'tap', keys: ['LeftAlt', 'L'] });
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(true));
    assert.deepEqual(await d.adapter.composerFocused('claude'), known(false), 'a client not in front has no focused composer');
    assert.deepEqual(await d.adapter.scrollClient('codex', 2), known(true));
    assert.deepEqual(await d.adapter.scrollClient('claude', 2), known(false), 'wheel input reaches only the client in front');
    assert.deepEqual(await d.adapter.codexArchived(tid(1)), known(false));
    d.archive('codex', tid(2));
    assert.deepEqual(await d.adapter.codexArchived(tid(2)), known(true));
  });

  test(`${name}: a Claude link stamps lastFocusedAt unless Claude already shows that session`, async () => {
    const clock = new ManualClock(5_000);
    const d = make(clock);
    d.claudeSession(lid(1));
    d.claudeSession(lid(2));
    d.front('other');
    await d.adapter.openUri(`claude://code/continue?session=${lid(1)}`);
    const [first] = (await d.adapter.claudeSessions([lid(1)])).value;
    assert.ok(first.lastFocusedAt > 5_000, 'the link stamps the target');
    assert.deepEqual(await d.adapter.composerFocused('claude'), known(true));
    clock.advance(100);
    await d.adapter.openUri(`claude://code/continue?session=${lid(1)}`);
    assert.equal((await d.adapter.claudeSessions([lid(1)])).value[0].lastFocusedAt, first.lastFocusedAt, 'a link to the session in front stamps nothing');
    const both = await d.adapter.claudeSessions([lid(1), lid(2), lid(9)]);
    assert.deepEqual(both.value.map(s => s.localId), [lid(1), lid(2)], 'missing IDs are omitted');
    d.archive('claude', lid(2));
    assert.equal((await d.adapter.claudeSessions([lid(2)])).value[0].isArchived, true);
  });

  test(`${name}: cards report stops, move focus and press only the focused stop`, async () => {
    const d = make(new ManualClock(1_000));
    d.claudeSession(lid(1));
    await d.adapter.openUri(`claude://code/continue?session=${lid(1)}`);
    assert.deepEqual(await d.adapter.cardButtons('claude'), known(null));
    assert.deepEqual(await d.adapter.approvalVisible('claude'), known(false));
    d.openCard('claude', 3);
    assert.deepEqual(await d.adapter.approvalVisible('claude'), known(true));
    const card = (await d.adapter.cardButtons('claude')).value;
    assert.deepEqual({ count: card.count, focused: card.focused }, { count: 3, focused: null });
    assert.equal((await d.adapter.cardButtons('codex')).status, 'unknown', 'a client not in front answers unknown');
    assert.deepEqual(await d.adapter.invokeCardButton('claude', card.id, 1, 3), known(false), 'an unfocused stop is not pressed');
    assert.deepEqual(await d.adapter.focusCardButton('claude', card.id, 1, 3), known(1));
    assert.equal((await d.adapter.focusCardButton('claude', 'another-card', 1, 3)).status, 'unknown');
    assert.equal((await d.adapter.invokeCardButton('claude', card.id, 1, 2)).status, 'unknown', 'a changed stop count is unknown');
    assert.deepEqual(await d.adapter.invokeCardButton('claude', card.id, 1, 3), known(true));
    assert.deepEqual(await d.adapter.cardButtons('claude'), known(null), 'pressing a stop answers the card');
    assert.deepEqual(await d.adapter.approvalVisible('claude'), known(false));
    assert.equal((await d.adapter.invokeCardButton('claude', card.id, 1, 3)).status, 'unknown', 'the answered card is gone');
  });

  test(`${name}: a Codex card replaces the composer and its approval check is unknown`, async () => {
    const d = make(new ManualClock(1_000));
    d.codexThread(tid(1), 'Task 1');
    await d.adapter.openUri(`codex://threads/${tid(1)}`);
    await d.adapter.sendKeys({ action: 'tap', keys: ['LeftAlt', 'L'] });
    assert.deepEqual(await d.adapter.approvalVisible('codex'), known(false));
    d.openCard('codex', 2);
    assert.equal((await d.adapter.approvalVisible('codex')).status, 'unknown');
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(false));
    const card = (await d.adapter.cardButtons('codex')).value;
    assert.deepEqual({ count: card.count, focused: card.focused }, { count: 2, focused: null });
    assert.deepEqual(await d.adapter.focusCardButton('codex', card.id, 0, 2), known(0));
    assert.deepEqual(await d.adapter.invokeCardButton('codex', card.id, 0, 2), known(true));
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(true), 'the composer comes back focused');
  });

  test(`${name}: held keys are released by up, releaseAll and close`, async () => {
    const d = make(new ManualClock(1_000));
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
    assert.equal(d.adapter.held?.size ?? d.desktop.held.length, 2);
    await d.adapter.sendKeys({ action: 'up', keys: ['LeftControl', 'LeftWindows'] });
    assert.equal(d.adapter.held?.size ?? d.desktop.held.length, 0);
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl'] });
    await d.adapter.releaseAll();
    assert.equal(d.adapter.held?.size ?? d.desktop.held.length, 0);
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl'] });
    await d.adapter.close();
    assert.equal(d.adapter.held?.size ?? d.desktop.held.length, 0);
  });

  test(`${name}: a volume key reaches the system, never a window, and never joins held keys (#865)`, async () => {
    const d = make(new ManualClock(1_000));
    d.codexThread(tid(1), 'Task 1');
    await d.adapter.openUri(`codex://threads/${tid(1)}`);
    await d.adapter.sendKeys({ action: 'tap', keys: ['LeftAlt', 'L'] });
    const keysBefore = d.adapter.keys?.length ?? d.desktop.log.filter(e => e.kind === 'key').length;
    for (const [key, presses] of [['Enter', 1], ['VolumeUp', 0], ['VolumeUp', 11], ['VolumeDown', 1.5], ['VolumeMute', '1']]) {
      await assert.rejects(d.adapter.sendVolumeKey(key, presses), /invalid-volume-request/, `${key} x${presses} is refused`);
    }
    await d.adapter.sendVolumeKey('VolumeUp', 2);
    await d.adapter.sendVolumeKey('VolumeMute', 1);
    assert.equal(d.adapter.keys?.length ?? d.desktop.log.filter(e => e.kind === 'key').length, keysBefore, 'no keystroke reaches the client');
    assert.deepEqual(await d.adapter.composerFocused('codex'), known(true), 'the client is untouched');
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
    await assert.rejects(d.adapter.sendVolumeKey('VolumeDown', 1), /keys-held/);
    await d.adapter.releaseAll();
  });

  test(`${name}: model and effort controls open, step, pick and close as the clients do, only for the client in front (#906)`, async () => {
    const d = make(new ManualClock(1_000));
    d.claudeSession(lid(1));
    d.selectClaude(lid(1));
    d.front('claude');
    d.focusComposer('claude');
    assert.deepEqual(await d.adapter.pickerState('codex'), { status: 'unknown', reason: 'codex-not-foreground' });
    assert.deepEqual(await d.adapter.tapInClient('codex', ['LeftControl', 'LeftShift', 'M'], 1), known(false), 'a key for a client not in front is not typed');
    assert.equal(d.typed(), 0);
    await assert.rejects(d.adapter.tapInClient('claude', ['PageDown'], 1));
    await assert.rejects(d.adapter.tapInClient('claude', ['Down'], 11));
    const closed = (await d.adapter.pickerState('claude')).value;
    assert.deepEqual([closed.menu, closed.slider, closed.model, closed.effort, closed.announcement], [null, null, 'Sonnet 5.5', 'Low', null]);
    // Claude's model menu: no entry focused at first; the first Down focuses the first entry.
    assert.deepEqual(await d.adapter.tapInClient('claude', ['LeftControl', 'LeftShift', 'I'], 1), known(true));
    let menu = (await d.adapter.pickerState('claude')).value.menu;
    assert.deepEqual([menu.label, menu.focused, menu.items.map(i => i.kind)], ['Model: Sonnet 5.5', null, ['option', 'option', 'option', 'option', 'action']]);
    assert.deepEqual(await d.adapter.composerFocused('claude'), known(false), 'the menu takes keyboard focus');
    await d.adapter.tapInClient('claude', ['Down'], 2);
    assert.equal((await d.adapter.pickerState('claude')).value.menu.focused, 1);
    await d.adapter.tapInClient('claude', ['Enter'], 1);
    const picked = (await d.adapter.pickerState('claude')).value;
    assert.deepEqual([picked.menu, picked.model], [null, 'Fable 5.1']);
    assert.deepEqual(await d.adapter.claudeSettings(lid(1)), known({ model: 'claude-fable-5-1', effort: 'low' }));
    assert.deepEqual(await d.adapter.claudeSettings(lid(9)), known(null));
    assert.deepEqual(await d.adapter.composerFocused('claude'), known(true), 'focus returns to the composer');
    // Claude's Effort slider applies each step at once; Escape keeps it.
    await d.adapter.tapInClient('claude', ['LeftControl', 'LeftShift', 'E'], 1);
    assert.equal((await d.adapter.pickerState('claude')).value.slider, 'Effort');
    await d.adapter.tapInClient('claude', ['Right'], 1);
    assert.equal((await d.adapter.pickerState('claude')).value.effort, 'Medium');
    await d.adapter.tapInClient('claude', ['Escape'], 1);
    assert.deepEqual((await d.adapter.claudeSettings(lid(1))).value, { model: 'claude-fable-5-1', effort: 'medium' });
    // Codex's picker: "Select model" focused; the model list; the announcement; the picker stays open after a pick.
    d.front('codex');
    await d.adapter.tapInClient('codex', ['LeftControl', 'LeftShift', 'M'], 1);
    const main = (await d.adapter.pickerState('codex')).value;
    assert.deepEqual([main.menu.label, main.menu.items[main.menu.focused].label, main.announcement], ['Select effort', 'Select model', { label: 'GPT-6 Luna Light', position: 1, count: 5 }]);
    await d.adapter.tapInClient('codex', ['Enter'], 1);
    const list = (await d.adapter.pickerState('codex')).value.menu;
    assert.equal(list.items[list.focused].label, 'GPT-6 Luna');
    await d.adapter.tapInClient('codex', ['Up'], 1);
    await d.adapter.tapInClient('codex', ['Enter'], 1);
    const after = (await d.adapter.pickerState('codex')).value;
    assert.deepEqual([after.menu.label, after.announcement], ['Select effort', { label: 'GPT-6 Astra Light', position: 1, count: 6 }], 'the level count follows the model');
    await d.adapter.tapInClient('codex', ['Down'], 3);
    await d.adapter.tapInClient('codex', ['Right'], 1);
    assert.equal((await d.adapter.pickerState('codex')).value.announcement.position, 2);
    await d.adapter.tapInClient('codex', ['Escape'], 1);
    assert.equal((await d.adapter.pickerState('codex')).value.menu, null);
    // Held keys refuse a client tap, as the Windows keyboard does.
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
    await assert.rejects(d.adapter.tapInClient('codex', ['Down'], 1), /keys-held/);
    await d.adapter.releaseAll();
  });
}

test('the simulated desktop keeps a synthetic system volume and mute state that volume keys change (#865)', async () => {
  const desktop = new SimulatedDesktop({ clock: new ManualClock(1_000) });
  const adapter = createSimulatedOsAdapter(desktop);
  assert.deepEqual(desktop.snapshot().system, { volume: 50, muted: false });
  await adapter.sendVolumeKey('VolumeUp', 3);
  await adapter.sendVolumeKey('VolumeMute', 1);
  assert.deepEqual(desktop.snapshot().system, { volume: 56, muted: true });
  await adapter.sendVolumeKey('VolumeDown', 10);
  await adapter.sendVolumeKey('VolumeDown', 10);
  await adapter.sendVolumeKey('VolumeDown', 10);
  assert.deepEqual(desktop.snapshot().system, { volume: 0, muted: false }, 'the level stops at 0, and a volume step unmutes as Windows does');
  assert.deepEqual(desktop.log.filter(e => e.kind === 'volume').map(e => [e.key, e.presses]), [['VolumeUp', 3], ['VolumeMute', 1], ['VolumeDown', 10], ['VolumeDown', 10], ['VolumeDown', 10]]);
  assert.deepEqual(desktop.calls.filter(c => c === 'sendVolumeKey').length, 5);
});

test('the simulated desktop types Enter into the focused composer and nowhere else', async () => {
  const clock = new ManualClock(1_000);
  const desktop = new SimulatedDesktop({ clock });
  const adapter = createSimulatedOsAdapter(desktop);
  desktop.addCodexThread(tid(1), 'Task 1');
  await adapter.openUri(`codex://threads/${tid(1)}`);
  await adapter.sendKeys({ action: 'tap', keys: ['LeftAlt', 'L'] });
  desktop.typeText('codex', 'synthetic draft');
  assert.equal(desktop.snapshot().windows.codex.composer.text, 'synthetic draft');
  await adapter.sendKeys({ action: 'tap', keys: ['Enter'] });
  const after = desktop.snapshot();
  assert.equal(after.windows.codex.composer.text, '');
  assert.deepEqual(after.windows.codex.composer.submitted, ['synthetic draft']);
  assert.ok(desktop.log.some(e => e.kind === 'submit' && e.client === 'codex' && e.text === 'synthetic draft'));

  desktop.bringToFront('other');
  await adapter.sendKeys({ action: 'tap', keys: ['Enter'] });
  assert.deepEqual(desktop.snapshot().windows.codex.composer.submitted, ['synthetic draft'], 'Enter in another app submits nothing');
  assert.equal(desktop.log.at(-1).kind, 'key');
  assert.equal(desktop.log.at(-1).window, 'other');
});

test('the simulated desktop models an Enter on a focused card stop pressing that stop', async () => {
  const desktop = new SimulatedDesktop({ clock: new ManualClock(1_000) });
  const adapter = createSimulatedOsAdapter(desktop);
  desktop.addCodexThread(tid(1), 'Task 1');
  await adapter.openUri(`codex://threads/${tid(1)}`);
  desktop.openCard('codex', { kind: 'approval', stops: ['Deny', 'Approve'], focused: 1 });
  await adapter.sendKeys({ action: 'tap', keys: ['Enter'] });
  assert.equal(desktop.snapshot().windows.codex.card, null);
  assert.deepEqual(desktop.log.filter(e => e.kind === 'card-press').map(e => e.stop), ['Approve'], 'a stray Enter would approve, so the router must never send one there');
});

test('the simulated desktop inserts synthetic dictation when the dictation chord comes up', async () => {
  const desktop = new SimulatedDesktop({ clock: new ManualClock(1_000) });
  const adapter = createSimulatedOsAdapter(desktop);
  desktop.addClaudeSession(lid(1), 'Session 1');
  await adapter.openUri(`claude://code/continue?session=${lid(1)}`);
  await adapter.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
  assert.equal(desktop.snapshot().dictating, true);
  await adapter.sendKeys({ action: 'up', keys: ['LeftControl', 'LeftWindows'] });
  assert.equal(desktop.snapshot().dictating, false);
  assert.equal(desktop.snapshot().windows.claude.composer.text, 'synthetic dictation');
  assert.ok(desktop.log.some(e => e.kind === 'dictation' && e.client === 'claude'));
});

test('the simulated desktop records every adapter call and is branded as simulated', async () => {
  const desktop = new SimulatedDesktop({ clock: new ManualClock(1_000) });
  const adapter = createSimulatedOsAdapter(desktop);
  assert.equal(adapter.simulated, true);
  await adapter.foregroundWindow();
  await adapter.clientVersions();
  assert.deepEqual(desktop.calls.slice(-2), ['foregroundWindow', 'clientVersions']);
  desktop.setVersion('codex', null);
  assert.equal((await adapter.clientVersions()).codex.status, 'unknown');
});
