import { OS_ADAPTER_VERSION, type OsAdapter } from '../os-adapter.js';
import { createOsAdapter } from '../windows/index.js';

export * from './profile.js';
export * from './feed.js';
export * from './slots.js';
export * from './lights.js';
export * from './router.js';
export { ensurePrivateDir, writePrivateFileAtomic } from './files.js';

/**
 * The OS adapter for this platform: the Windows adapter on Windows, otherwise the unsupported adapter, whose
 * observations are all unknown so every focus fails closed. Native bindings load lazily inside the adapter.
 */
export async function loadOsAdapter(): Promise<OsAdapter> {
  const adapter = createOsAdapter();
  if (adapter.version !== OS_ADAPTER_VERSION) throw new Error(`os-adapter-unavailable: adapter version ${String(adapter.version)} is not ${OS_ADAPTER_VERSION}`);
  return adapter;
}
