/**
 * OS adapter seam for task routing (#742). The routing core is portable and decides what to do;
 * an adapter only observes the desktop and performs one requested primitive. Only the Windows
 * adapter exists; a macOS adapter is a later, separately qualified step.
 *
 * Every observation returns `unknown` rather than guessing, and the core fails closed on it.
 * Observations never return conversation text: titles are compared inside the adapter and
 * only a boolean, count or index crosses this boundary.
 *
 * Version 3 (#821) adds the card operations: the open approval or question card's actionable buttons,
 * moving keyboard focus between them and pressing the focused one. Version 4 (#865) adds `sendVolumeKey`, the
 * system volume and mute keys, which act on the system rather than any window.
 */
export const OS_ADAPTER_VERSION = 4;

export type Client = 'codex' | 'claude';

/** Platform-neutral key names: `Enter`, `LeftControl`, `LeftWindows`, `LeftAlt`, `L`. */
export type KeyName = string;

/** The system volume keys. They change the system volume or mute it, whatever window is in front. */
export type VolumeKey = 'VolumeUp' | 'VolumeDown' | 'VolumeMute';
/** Presses per `sendVolumeKey` call. */
export const MAX_VOLUME_PRESSES = 10;

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

/**
 * The open card's wheel stops, counted in tree order: its actionable buttons (enabled, invokable, not menus), or for a
 * Claude question card only its answer rows and "Other" row.
 */
export interface CardButtons {
  /**
   * The card's identity for this window: an opaque UI Automation runtime ID, no text. A new card is assumed never to
   * share it (not yet established live; see UIA-NOTES.md "Not established").
   */
  id: string;
  /** How many stops the card has (0-64). */
  count: number;
  /** The index of the one with keyboard focus, or null when focus is on none of them. */
  focused: number | null;
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

  /**
   * Taps a system volume key `presses` times (1-`MAX_VOLUME_PRESSES`). It needs no foreground, composer or card check,
   * because the system, not a window, handles it. Rejects, sending nothing, while this adapter holds any key (such as
   * the dictation chord), so a volume key never combines with held keys, and while the user holds a modifier.
   */
  sendVolumeKey(key: VolumeKey, presses: number): Promise<void>;

  /** Releases every key this adapter currently holds. Never throws. */
  releaseAll(): Promise<void>;

  /**
   * Scrolls the client's conversation by `notches` mouse-wheel notches (positive scrolls up).
   * Sends nothing and returns known `false` unless the client's window is foreground and the
   * pointer is inside it; never moves the pointer, clicks or types.
   */
  scrollClient(client: Client, notches: number): Promise<Observation<boolean>>;

  /**
   * Codex: whether the selected sidebar row shows the thread's name, and how many open rows share
   * that name. The adapter takes the name Codex itself keeps for `threadId` and uses `fallbackTitle`
   * (the Hub's title) only when Codex has never named the thread. It answers unknown when the name
   * source cannot be read or the current name is unusable, `codex-title-missing` with no name at all
   * and `codex-name-not-unique` when another thread has the same name. Compared inside the adapter;
   * no title text is returned.
   */
  codexSelectedThread(threadId: string, fallbackTitle: string | null): Promise<Observation<{ matches: boolean; sameTitleRows: number }>>;

  /** Whether keyboard focus is on the client's composer (an editable text element in its window). */
  composerFocused(client: Client): Promise<Observation<boolean>>;

  /** Whether an approval or permission card is visible in the client's window. */
  approvalVisible(client: Client): Promise<Observation<boolean>>;

  /**
   * The card open in the client's foreground window: known `null` when there is none, its actionable buttons when
   * there is exactly one, and unknown when the client is not in front or the card cannot be established.
   */
  cardButtons(client: Client): Promise<Observation<CardButtons | null>>;

  /**
   * Moves keyboard focus to actionable button `index` of the open card `cardId`. Answers unknown when that card is gone
   * or no longer has `count` stops; otherwise the focused index once focus settles (a client may apply focus
   * asynchronously, so the adapter reads it back for a short bounded time), or null when focus is on none by then.
   */
  focusCardButton(client: Client, cardId: string, index: number, count: number): Promise<Observation<number | null>>;

  /**
   * Presses actionable button `index` of the open card `cardId`: unknown when that card is gone or no longer has `count`
   * actionable buttons, known `false` when the button does not have keyboard focus, and known `true` when pressed.
   * Never retried by the caller.
   */
  invokeCardButton(client: Client, cardId: string, index: number, count: number): Promise<Observation<boolean>>;

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
