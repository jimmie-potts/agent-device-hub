import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowsAdapter, OsAdapterNotImplementedError, OS_ADAPTER_VERSION } from '../dist/os-adapter.js';

test('the Windows adapter is a placeholder that refuses every action', async () => {
  assert.equal(OS_ADAPTER_VERSION, 0, 'version 0 marks the adapter interface as unstable until #742');
  const adapter = createWindowsAdapter();
  assert.equal(adapter.platform, 'win32');
  const calls = [
    adapter.sendKeys({ action: 'tap', keys: ['Enter'] }),
    adapter.foregroundWindow(),
    adapter.inspectUi({ kind: 'composer-focus' }),
    adapter.openUri('codex://threads/example'),
  ];
  for (const call of calls) await assert.rejects(call, error => error instanceof OsAdapterNotImplementedError && error.code === 'os-adapter-not-implemented');
  await adapter.close();
});
