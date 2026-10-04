/**
 * Placeholder for the OS adapter that #742 implements: keystrokes, foreground identity, UI checks and deep links.
 * Version 0 marks the shape as unstable. Nothing here injects input; the Windows stub refuses every action.
 */
export const OS_ADAPTER_VERSION = 0;

export interface KeyRequest {
  /** `down` and `up` hold and release (for example a dictation chord); `tap` presses and releases. */
  action: 'down' | 'up' | 'tap';
  /** Platform-neutral key names such as `Enter`, `LeftControl`, `LeftWindows`, `L`. */
  keys: readonly string[];
}

export interface ForegroundWindow {
  /** Windows package family name, or the macOS bundle ID later. */
  packageIdentity: string | null;
  processName: string | null;
}

export interface UiCheckRequest { kind: string; [detail: string]: unknown }
export interface UiCheckResult { ok: boolean; detail?: string }

export interface OsAdapter {
  readonly platform: NodeJS.Platform;
  sendKeys(request: KeyRequest): Promise<void>;
  foregroundWindow(): Promise<ForegroundWindow | null>;
  inspectUi(request: UiCheckRequest): Promise<UiCheckResult>;
  openUri(uri: string): Promise<void>;
  /** Releases any held keys and helper processes. */
  close(): Promise<void>;
}

export class OsAdapterNotImplementedError extends Error {
  readonly code = 'os-adapter-not-implemented';
  constructor(operation: string) { super(`os-adapter-not-implemented: ${operation}`); }
}

/** The Windows adapter stub. #742 replaces it with FFI keystrokes/identity and a UI Automation helper. */
export function createWindowsAdapter(): OsAdapter {
  const refuse = (operation: string) => Promise.reject(new OsAdapterNotImplementedError(operation));
  return {
    platform: 'win32',
    sendKeys: () => refuse('sendKeys'),
    foregroundWindow: () => refuse('foregroundWindow'),
    inspectUi: () => refuse('inspectUi'),
    openUri: () => refuse('openUri'),
    close: async () => undefined,
  };
}
