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
      suggestions: adapter.suggestions,
      showSuggestions(labels, ghost) { adapter.suggestions.show(labels, ghost); },
      type(text) { adapter.claudeDraft += text; adapter.composer.claude = true; },
      draft: () => adapter.claudeDraft,
      composerFocused: () => adapter.composer.claude,
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
      suggestions: desktop.suggestions,
      showSuggestions(labels, ghost) { desktop.showSuggestions(labels, ghost); },
      type(text) { desktop.typeText('claude', text); },
      draft: () => desktop.snapshot().windows.claude.composer.text,
      composerFocused: () => desktop.snapshot().windows.claude.composer.focused,
    };
  },
};

for (const [name, make] of Object.entries(DRIVERS)) {
  test(`${name}: version 6 shape and the foreground window by package identity`, async () => {
    const d = make(new ManualClock(1_000));
    assert.equal(d.adapter.version, OS_ADAPTER_VERSION);
    assert.equal(typeof d.adapter.platform, 'string');
    for (const method of ['clientVersions', 'foregroundWindow', 'openUri', 'sendKeys', 'sendVolumeKey', 'releaseAll', 'scrollClient', 'codexSelectedThread', 'composerFocused',
      'approvalVisible', 'cardButtons', 'focusCardButton', 'invokeCardButton', 'tapInClient', 'pickerState', 'expandSetting', 'collapseSetting', 'invokeSelectModel',
      'focusMenuEntry', 'selectMenuOption', 'setSliderValue', 'focusComposer', 'claudeSettings', 'suggestionState', 'focusSuggestion', 'invokeSuggestion', 'codexArchived',
      'claudeSessions', 'close']) {
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

  test(`${name}: model and effort controls open, move, select and close as the clients do, only for the client in front (#906)`, async () => {
    const d = make(new ManualClock(1_000));
    d.claudeSession(lid(1));
    d.selectClaude(lid(1));
    d.front('claude');
    d.focusComposer('claude');
    const state = async client => (await d.adapter.pickerState(client)).value;
    assert.deepEqual(await d.adapter.pickerState('codex'), { status: 'unknown', reason: 'codex-not-foreground' });
    assert.equal((await d.adapter.expandSetting('codex', 'codex-picker')).status, 'unknown', 'no action for a client not in front');
    assert.deepEqual(await d.adapter.tapInClient('codex', ['Escape'], 1), known(false), 'a key for a client not in front is not typed');
    assert.equal(d.typed(), 0);
    await assert.rejects(d.adapter.tapInClient('claude', ['Down'], 1), 'Up and Down are gone');
    await assert.rejects(d.adapter.tapInClient('claude', ['Escape'], 11));
    for (const keys of [['Enter'], ['LeftControl', 'Enter']]) await assert.rejects(d.adapter.tapInClient('claude', keys, 1), 'only Send types Enter (F7)');
    assert.equal(d.typed(), 0);
    const closed = await state('claude');
    assert.deepEqual([closed.menu, closed.slider, closed.model, closed.effort], [null, null, { label: 'Sonnet 5.5', expanded: false }, { label: 'Low', expanded: false }]);
    // Claude's model menu: Expand, SetFocus, Select on the focused option only; Collapse closes it unchanged.
    assert.deepEqual(await d.adapter.expandSetting('claude', 'claude-model'), known(true));
    assert.equal((await d.adapter.expandSetting('claude', 'claude-model')).status, 'unknown', 'only a collapsed button expands');
    let menu = (await state('claude')).menu;
    assert.deepEqual([menu.kind, menu.label, menu.focused, menu.items.map(i => i.kind)], ['claude-model', 'Model: Sonnet 5.5', null, ['option', 'option', 'option', 'option', 'action']]);
    assert.deepEqual(await d.adapter.selectMenuOption('claude', 'claude-model', 1, 5), known(false), 'an option without focus is not selected');
    assert.equal((await d.adapter.focusMenuEntry('claude', 'claude-model', 1, 4)).status, 'unknown', 'a changed entry count is refused');
    assert.deepEqual(await d.adapter.focusMenuEntry('claude', 'claude-model', 1, 5), known(1));
    assert.equal((await d.adapter.selectMenuOption('claude', 'claude-model', 4, 5)).status, 'unknown', '"More models" is not an option');
    assert.deepEqual(await d.adapter.selectMenuOption('claude', 'claude-model', 1, 5), known(true));
    assert.deepEqual([(await state('claude')).menu, (await state('claude')).model], [null, { label: 'Fable 5.1', expanded: false }]);
    assert.deepEqual(await d.adapter.claudeSettings(lid(1)), known({ model: 'claude-fable-5-1', effort: 'low' }));
    assert.deepEqual(await d.adapter.claudeSettings(lid(9)), known(null));
    await d.adapter.expandSetting('claude', 'claude-model');
    assert.deepEqual(await d.adapter.collapseSetting('claude', 'claude-model'), known(true));
    assert.equal((await state('claude')).model.label, 'Fable 5.1', 'Collapse changes nothing');
    assert.deepEqual(await d.adapter.focusComposer('claude'), known(true));
    assert.deepEqual(await d.adapter.composerFocused('claude'), known(true));
    // Claude's Effort slider: one step at a time from the value read, within its range.
    await d.adapter.expandSetting('claude', 'claude-effort');
    assert.deepEqual((await state('claude')).slider, { value: 0, min: 0, max: 5, step: 1 });
    assert.equal((await d.adapter.setSliderValue('claude', 1, 2)).status, 'unknown', 'a value other than the one read is refused');
    assert.equal((await d.adapter.setSliderValue('claude', 0, -1)).status, 'unknown', 'outside the range');
    assert.deepEqual(await d.adapter.setSliderValue('claude', 0, 1), known(1));
    assert.equal((await state('claude')).effort.label, 'Medium');
    await d.adapter.collapseSetting('claude', 'claude-effort');
    assert.deepEqual((await d.adapter.claudeSettings(lid(1))).value, { model: 'claude-fable-5-1', effort: 'medium' });
    // Codex's picker: the button names the model and level while collapsed; Collapse does not close it; one Escape does.
    d.front('codex');
    assert.deepEqual((await state('codex')).model, { label: 'GPT-6 Luna Light', expanded: false });
    assert.equal((await d.adapter.collapseSetting('codex', 'codex-picker')).status, 'unknown');
    assert.deepEqual(await d.adapter.expandSetting('codex', 'codex-picker'), known(true));
    const main = await state('codex');
    assert.deepEqual([main.menu.kind, main.menu.label, main.model, main.announcement], ['codex-picker', 'Select effort', { label: 'Select effort', expanded: true }, { label: 'GPT-6 Luna Light', position: 1, count: 5 }]);
    assert.deepEqual(await d.adapter.invokeSelectModel('codex'), known(true));
    const list = (await state('codex')).menu;
    assert.deepEqual([list.kind, list.items.find(i => i.selected).label], ['codex-models', 'GPT-6 Luna']);
    // Select on the selected model does nothing; Invoke on it returns to the picker unchanged (observed 2026-10-07).
    const current = list.items.findIndex(i => i.selected);
    await d.adapter.focusMenuEntry('codex', 'codex-models', current, list.items.length);
    assert.deepEqual(await d.adapter.selectMenuOption('codex', 'codex-models', current, list.items.length), known(true));
    assert.equal((await state('codex')).menu.kind, 'codex-models', 'the list stays open');
    assert.equal((await d.adapter.invokeCurrentOption('codex', 1, list.items.length)).status, 'unknown', 'only the current model is invoked');
    assert.deepEqual(await d.adapter.invokeCurrentOption('codex', current, list.items.length), known(true));
    const back = (await state('codex')).menu;
    assert.deepEqual([back.kind, back.hasFocus, (await state('codex')).announcement.label], ['codex-picker', false, 'GPT-6 Luna Light'], 'back in the picker, unchanged, without focus');
    await d.adapter.invokeSelectModel('codex');
    await d.adapter.focusMenuEntry('codex', 'codex-models', 1, list.items.length);
    assert.deepEqual(await d.adapter.selectMenuOption('codex', 'codex-models', 1, list.items.length), known(true));
    assert.deepEqual([(await state('codex')).menu.kind, (await state('codex')).announcement], ['codex-picker', { label: 'GPT-6 Astra Light', position: 1, count: 6 }], 'back in the picker, which stays open');
    await d.adapter.focusMenuEntry('codex', 'codex-picker', 3, 4);
    await d.adapter.tapInClient('codex', ['Right'], 1);
    assert.equal((await state('codex')).announcement.position, 2, 'Right on a focused Power steps the level');
    await d.adapter.tapInClient('codex', ['Escape'], 1);
    assert.deepEqual([(await state('codex')).menu, (await state('codex')).model], [null, { label: 'GPT-6 Astra Standard', expanded: false }]);
    // The owner's chord, with the picker closed, changes the button's name.
    await d.adapter.tapInClient('codex', ['LeftControl', 'LeftAlt', 'Equal'], 1);
    assert.equal((await state('codex')).model.label, 'GPT-6 Astra Extended');
    // A lagging read shows the state from before the last change, once.
    d.pickers.lag = true;
    await d.adapter.expandSetting('codex', 'codex-picker');
    assert.equal((await state('codex')).menu, null, 'the first read lags');
    assert.equal((await state('codex')).menu.kind, 'codex-picker', 'the next one does not');
    d.pickers.lag = false;
    // Held keys refuse a client tap, as the Windows keyboard does.
    await d.adapter.sendKeys({ action: 'down', keys: ['LeftControl', 'LeftWindows'] });
    await assert.rejects(d.adapter.tapInClient('codex', ['Escape'], 1), /keys-held/);
    await d.adapter.releaseAll();
  });

  test(`${name}: Claude's next-step band reports counts only, moves focus, fills only an empty composer from the focused suggestion, and a Right arrow accepts the ghost text (#907)`, async () => {
    const d = make(new ManualClock(1_000));
    const labels = ['Synthetic next step A', 'Synthetic next step B', 'Synthetic next step C'];
    d.claudeSession(lid(1));
    d.selectClaude(lid(1));
    d.front('claude');
    d.focusComposer('claude');
    const state = async () => (await d.adapter.suggestionState('claude')).value;
    assert.deepEqual(await state(), { count: 0, focused: null, composer: { focused: true, empty: true } }, 'no band');
    assert.deepEqual(await d.adapter.suggestionState('codex'), { status: 'unknown', reason: 'invalid-client' }, 'Codex has no next-step band (#908)');
    d.showSuggestions(labels, labels[0]);
    assert.deepEqual(await state(), { count: 3, focused: null, composer: { focused: true, empty: true } });
    assert.ok(!JSON.stringify(await d.adapter.suggestionState('claude')).includes('Synthetic'), 'no suggestion text crosses the adapter');
    assert.deepEqual(await d.adapter.invokeSuggestion('claude', 1, 3), known(false), 'a suggestion without focus is not invoked');
    assert.equal((await d.adapter.focusSuggestion('claude', 1, 2)).status, 'unknown', 'a changed count is refused');
    assert.equal((await d.adapter.focusSuggestion('claude', 3, 3)).status, 'unknown', 'an index past the suggestions is refused');
    assert.deepEqual(await d.adapter.focusSuggestion('claude', 1, 3), known(1));
    assert.deepEqual(await state(), { count: 3, focused: 1, composer: { focused: false, empty: true } }, 'focus left the composer for the suggestion');
    assert.deepEqual(await d.adapter.invokeSuggestion('claude', 1, 3), known(true));
    assert.equal(d.draft(), labels[1], 'the suggestion is the draft; nothing was sent');
    assert.deepEqual(await d.adapter.focusComposer('claude'), known(true));
    assert.deepEqual(await state(), { count: 3, focused: null, composer: { focused: true, empty: false } });
    await d.adapter.focusSuggestion('claude', 0, 3);
    assert.deepEqual(await d.adapter.invokeSuggestion('claude', 0, 3), known(false), 'a composer holding a draft is never filled');
    assert.equal(d.draft(), labels[1]);
    await d.adapter.focusComposer('claude');
    assert.deepEqual(await d.adapter.tapInClient('claude', ['Right'], 1), known(true));
    assert.equal(d.draft(), labels[1], 'Right in a composer with text changes nothing');
    // The ghost text: with the composer focused and empty, one Right arrow accepts it.
    const fresh = make(new ManualClock(1_000));
    fresh.front('claude');
    fresh.focusComposer('claude');
    fresh.showSuggestions(labels, labels[2]);
    assert.deepEqual(await fresh.adapter.tapInClient('claude', ['Right'], 1), known(true));
    assert.equal(fresh.draft(), labels[2], 'the ghost text is the draft');
    assert.deepEqual((await fresh.adapter.suggestionState('claude')).value.composer, { focused: true, empty: false });
    // A lagging read shows the state from before the last change, once.
    fresh.suggestions.lag = true;
    await fresh.adapter.focusSuggestion('claude', 2, 3);
    assert.equal((await fresh.adapter.suggestionState('claude')).value.focused, null, 'the first read lags');
    assert.equal((await fresh.adapter.suggestionState('claude')).value.focused, 2, 'the next one does not');
    fresh.front('other');
    for (const call of [fresh.adapter.suggestionState('claude'), fresh.adapter.focusSuggestion('claude', 0, 3), fresh.adapter.invokeSuggestion('claude', 0, 3)]) {
      assert.deepEqual(await call, { status: 'unknown', reason: 'claude-not-foreground' });
    }
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
