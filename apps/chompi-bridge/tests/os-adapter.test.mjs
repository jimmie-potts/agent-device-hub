import assert from 'node:assert/strict';
import test from 'node:test';
import { OsAdapterNotImplementedError, OS_ADAPTER_VERSION } from '../dist/os-adapter.js';
import { createOsAdapter, createUnsupportedAdapter, createWindowsAdapter } from '../dist/windows/index.js';

test('the OS adapter interface is version 1', () => {
  assert.equal(OS_ADAPTER_VERSION, 1);
});

test('an unsupported platform observes nothing and refuses every action', async () => {
  const adapter = createUnsupportedAdapter('darwin');
  assert.equal(adapter.version, 1);
  assert.equal(adapter.platform, 'darwin');
  const unknown = { status: 'unknown', reason: 'os-adapter-not-implemented' };
  assert.deepEqual(await adapter.clientVersions(), { codex: unknown, claude: unknown });
  assert.deepEqual(await adapter.foregroundWindow(), unknown);
  assert.deepEqual(await adapter.codexSelectedTitle('x'), unknown);
  assert.deepEqual(await adapter.composerFocused('codex'), unknown);
  assert.deepEqual(await adapter.approvalVisible('claude'), unknown);
  assert.deepEqual(await adapter.codexArchived('019a3b1c-7d2e-7f00-8a11-0123456789ab'), unknown);
  assert.deepEqual(await adapter.claudeSessions([]), unknown);
  assert.deepEqual(await adapter.scrollClient('codex', 1), unknown);
  for (const call of [adapter.sendKeys({ action: 'tap', keys: ['Enter'] }), adapter.openUri('codex://threads/x')]) {
    await assert.rejects(call, error => error instanceof OsAdapterNotImplementedError && error.code === 'os-adapter-not-implemented');
  }
  await adapter.releaseAll();
  await adapter.close();
});

test('createOsAdapter picks the Windows adapter only on Windows', async () => {
  const adapter = createOsAdapter();
  assert.equal(adapter.version, 1);
  assert.equal(adapter.platform, process.platform === 'win32' ? 'win32' : process.platform);
  if (process.platform !== 'win32') assert.deepEqual(await adapter.foregroundWindow(), { status: 'unknown', reason: 'os-adapter-not-implemented' });
  await adapter.close();
  assert.equal(typeof createWindowsAdapter, 'function');
});
