/**
 * OS adapter seam for task routing (#742). The routing core is portable and decides what to do;
 * an adapter only observes the desktop and performs one requested primitive. Only the Windows
 * adapter exists; a macOS adapter is a later, separately qualified step.
 *
 * Every observation returns `unknown` rather than guessing, and the core fails closed on it.
 * Observations never return conversation text: titles are compared inside the adapter and
 * only a boolean or count crosses this boundary.
 */
export const OS_ADAPTER_VERSION = 1;

export type Client = 'codex' | 'claude';

/** Platform-neutral key names: `Enter`, `LeftControl`, `LeftWindows`, `LeftAlt`, `L`. */
export type KeyName = string;

export interface KeyRequest {
  /** `down` and `up` hold and release a chord (dictation); `tap` presses and releases once. */
  action: 'down' | 'up' | 'tap';
  keys: readonly KeyName[];
}

export interface ForegroundWindow {
  /** Windows package family name (later: macOS bundle ID); null when the window has none. */
  packageIdentity: string | null;
  processName: string | null;
}

export type Observation<T> = { status: 'known'; value: T } | { status: 'unknown'; reason: string };

export interface ClientVersions {
  codex: Observation<string>;
  claude: Observation<string>;
}

/** One Claude Desktop Code session record, read by key only from Desktop's private store. */
export interface ClaudeDesktopSession {
  localId: string;
  isArchived: boolean;
  /** Epoch milliseconds Desktop stamped when the session last became visible; null when absent. */
  lastFocusedAt: number | null;
}

export interface OsAdapter {
  readonly version: typeof OS_ADAPTER_VERSION;
  readonly platform: NodeJS.Platform;

  /** Installed client versions, for the qualified-version gate. */
  clientVersions(): Promise<ClientVersions>;

  /** The current foreground window's identity. */
  foregroundWindow(): Promise<Observation<ForegroundWindow | null>>;

  /** Asks the OS to open a deep link; resolves when the request is handed off, not when the app acts. */
  openUri(uri: string): Promise<void>;

  /** Presses, holds or releases keys. Rejects with a held-modifier error rather than typing into an unknown state. */
  sendKeys(request: KeyRequest): Promise<void>;

  /** Releases every key this adapter currently holds. Never throws. */
  releaseAll(): Promise<void>;

  /**
   * Scrolls the client's conversation by `notches` mouse-wheel notches (positive scrolls up).
   * Sends nothing and returns known `false` unless the client's window is foreground and the
   * pointer is inside it; never moves the pointer, clicks or types.
   */
  scrollClient(client: Client, notches: number): Promise<Observation<boolean>>;

  /**
   * Codex: whether the selected sidebar row's accessible name equals `title`, and how many open
   * rows share that title. Compared inside the adapter; no title text is returned.
   */
  codexSelectedTitle(title: string): Promise<Observation<{ matches: boolean; sameTitleRows: number }>>;

  /** Whether keyboard focus is on the client's composer (an editable text element in its window). */
  composerFocused(client: Client): Promise<Observation<boolean>>;

  /** Whether an approval or permission card is visible in the client's window. */
  approvalVisible(client: Client): Promise<Observation<boolean>>;

  /** Codex: whether a thread ID appears as an archived rollout filename. Reads names only. */
  codexArchived(threadId: string): Promise<Observation<boolean>>;

  /** Claude Desktop: the named sessions' records (missing IDs are omitted). Reads keys only. */
  claudeSessions(localIds: readonly string[]): Promise<Observation<ClaudeDesktopSession[]>>;

  /** Releases held keys and stops helper processes. */
  close(): Promise<void>;

  /** Optional: starts helpers and caches slow observations so the first key press is not delayed. */
  warmUp?(): Promise<unknown>;

  /** Optional: releases held keys synchronously, for process `exit` hooks where no promise can settle. */
  releaseAllSync?(): void;
}

export class OsAdapterNotImplementedError extends Error {
  readonly code = 'os-adapter-not-implemented';
  constructor(operation: string) { super(`os-adapter-not-implemented: ${operation}`); }
}
