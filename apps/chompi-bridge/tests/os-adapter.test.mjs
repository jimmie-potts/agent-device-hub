import assert from 'node:assert/strict';
import test from 'node:test';
import { OsAdapterNotImplementedError, OS_ADAPTER_VERSION } from '../dist/os-adapter.js';
import { createOsAdapter, createUnsupportedAdapter, createWindowsAdapter } from '../dist/windows/index.js';

test('the OS adapter interface is version 6', () => {
  assert.equal(OS_ADAPTER_VERSION, 6);
});

test('an unsupported platform observes nothing and refuses every action', async () => {
  const adapter = createUnsupportedAdapter('darwin');
  assert.equal(adapter.version, 6);
  assert.equal(adapter.platform, 'darwin');
  const unknown = { status: 'unknown', reason: 'os-adapter-not-implemented' };
  assert.deepEqual(await adapter.clientVersions(), { codex: unknown, claude: unknown });
  assert.deepEqual(await adapter.foregroundWindow(), unknown);
  assert.deepEqual(await adapter.codexSelectedThread('019a3b1c-7d2e-7f00-8a11-0123456789ab', 'x'), unknown);
  assert.deepEqual(await adapter.composerFocused('codex'), unknown);
  assert.deepEqual(await adapter.approvalVisible('claude'), unknown);
  assert.deepEqual(await adapter.codexArchived('019a3b1c-7d2e-7f00-8a11-0123456789ab'), unknown);
  assert.deepEqual(await adapter.claudeSessions([]), unknown);
  assert.deepEqual(await adapter.scrollClient('codex', 1), unknown);
  assert.deepEqual(await adapter.cardButtons('claude'), unknown);
  assert.deepEqual(await adapter.focusCardButton('claude', '42.1', 0, 2), unknown);
  assert.deepEqual(await adapter.invokeCardButton('claude', '42.1', 0, 2), unknown);
  assert.deepEqual(await adapter.pickerState('claude'), unknown);
  for (const call of [adapter.expandSetting('claude', 'claude-model'), adapter.collapseSetting('claude', 'claude-model'), adapter.invokeSelectModel('codex'),
    adapter.focusMenuEntry('claude', 'claude-model', 0, 2), adapter.selectMenuOption('claude', 'claude-model', 0, 2), adapter.setSliderValue('claude', 0, 1), adapter.focusComposer('claude')]) {
    assert.deepEqual(await call, unknown);
  }
  assert.deepEqual(await adapter.claudeSettings('local_4f1e2d3c-1b2a-4c5d-8e9f-a0b1c2d3e4f5'), unknown);
  for (const call of [adapter.suggestionState('claude'), adapter.focusSuggestion('claude', 0, 3), adapter.invokeSuggestion('claude', 0, 3)]) assert.deepEqual(await call, unknown);
  for (const call of [adapter.sendKeys({ action: 'tap', keys: ['Enter'] }), adapter.openUri('codex://threads/x'), adapter.sendVolumeKey('VolumeUp', 1), adapter.tapInClient('codex', ['Escape'], 1)]) {
    await assert.rejects(call, error => error instanceof OsAdapterNotImplementedError && error.code === 'os-adapter-not-implemented');
  }
  await adapter.releaseAll();
  await adapter.close();
});

test('createOsAdapter picks the Windows adapter only on Windows', async () => {
  const adapter = createOsAdapter();
  assert.equal(adapter.version, 6);
  assert.equal(adapter.platform, process.platform === 'win32' ? 'win32' : process.platform);
  if (process.platform !== 'win32') assert.deepEqual(await adapter.foregroundWindow(), { status: 'unknown', reason: 'os-adapter-not-implemented' });
  await adapter.close();
  assert.equal(typeof createWindowsAdapter, 'function');
});
