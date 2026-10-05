import { OS_ADAPTER_VERSION, OsAdapterNotImplementedError } from '../os-adapter.js';
import { createWindowsAdapter, type HostOsAdapter, type WindowsAdapterOptions } from './adapter.js';

/**
 * The adapter for a platform without a qualified implementation: every observation is unknown, so the routing
 * core fails closed, and every action rejects with `os-adapter-not-implemented`.
 */
export function createUnsupportedAdapter(platform: NodeJS.Platform = process.platform): HostOsAdapter {
  const unknown = { status: 'unknown', reason: 'os-adapter-not-implemented' } as const;
  return {
    version: OS_ADAPTER_VERSION,
    platform,
    clientVersions: async () => ({ codex: unknown, claude: unknown }),
    foregroundWindow: async () => unknown,
    openUri: async () => { throw new OsAdapterNotImplementedError('openUri'); },
    sendKeys: async () => { throw new OsAdapterNotImplementedError('sendKeys'); },
    releaseAll: async () => undefined,
    releaseAllSync: () => undefined,
    warmUp: async () => undefined,
    scrollClient: async () => unknown,
    codexSelectedThread: async () => unknown,
    composerFocused: async () => unknown,
    approvalVisible: async () => unknown,
    cardButtons: async () => unknown,
    focusCardButton: async () => unknown,
    invokeCardButton: async () => unknown,
    codexArchived: async () => unknown,
    claudeSessions: async () => unknown,
    close: async () => undefined,
  };
}

/** The Windows adapter on Windows; the unsupported adapter elsewhere. */
export function createOsAdapter(options: WindowsAdapterOptions = {}): HostOsAdapter {
  return process.platform === 'win32' ? createWindowsAdapter(options) : createUnsupportedAdapter();
}
