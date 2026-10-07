/**
 * OS adapter seam for task routing (#742). The routing core is portable and decides what to do;
 * an adapter only observes the desktop and performs one requested primitive. Only the Windows
 * adapter exists; a macOS adapter is a later, separately qualified step.
 *
 * Every observation returns `unknown` rather than guessing, and the core fails closed on it.
 * Observations never return conversation text: titles are compared inside the adapter and
 * only a boolean, count or index crosses this boundary, plus, since version 5, the clients' own model and effort labels.
 *
 * Version 3 (#821) adds the card operations: the open approval or question card's actionable buttons,
 * moving keyboard focus between them and pressing the focused one. Version 4 (#865) adds `sendVolumeKey`, the
 * system volume and mute keys, which target no window and need no window check. Version 5 (#906) adds the model and
 * effort operations: `pickerState`, a read-only view of the clients' model and effort controls; UI Automation actions on
 * those controls only (`expandSetting`, `collapseSetting`, `invokeSelectModel`, `focusMenuEntry`, `selectMenuOption`,
 * `invokeCurrentOption`, `setSliderValue`, `focusComposer`), each checked against a fresh read before it acts; `tapInClient`, which types a key
 * only while the named client is in front, for Codex's one closing Escape and the owner's effort chords; and
 * `claudeSettings`, a Claude session record's `model` and `effort`. They return model and effort labels only. Version 6
 * (#907) adds Claude's next-step suggestions: `suggestionState`, a read of the band above Claude's composer and of the
 * composer itself as counts and booleans, never the suggestions' text; and `focusSuggestion` and `invokeSuggestion`, UI
 * Automation actions on the qualified band only, each checked against a fresh read before it acts.
 */
export const OS_ADAPTER_VERSION = 6;

export type Client = 'codex' | 'claude';

/** Platform-neutral key names: `Enter`, `LeftControl`, `LeftWindows`, `LeftAlt`, `L`. */
export type KeyName = string;

/** The system volume keys. They change the system volume or mute it, whatever window is in front. */
export type VolumeKey = 'VolumeUp' | 'VolumeDown' | 'VolumeMute';
/** Presses per `sendVolumeKey` call. */
export const MAX_VOLUME_PRESSES = 10;

/**
 * Keys only `tapInClient` types, into the named client's window while it is in front, and no profile can name (#906):
 * Escape, the one key that closes Codex's picker, and Left and Right, which step its Power entry when no effort chords
 * are configured. Every other menu move is a UI Automation action.
 */
export const NAVIGATION_KEYS = Object.freeze(['Left', 'Right', 'Escape'] as const);
export type NavigationKey = typeof NAVIGATION_KEYS[number];
/** Presses per `tapInClient` call. */
export const MAX_CLIENT_PRESSES = 10;

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

/** What a menu entry is: a model `RadioButton` (`option`), a `MenuItem` (`action`) or a `CheckBox` (`toggle`). */
export type PickerItemKind = 'option' | 'action' | 'toggle';
export interface PickerItem {
  kind: PickerItemKind;
  /** The entry's UI label, such as a model name; at most `MAX_PICKER_LABEL` characters. */
  label: string;
  /** The option the client marks as current. */
  selected: boolean;
}
/**
 * The qualified menus (#906), and only these: Claude's `Model: <name>` menu, Codex's `Select effort` picker and the
 * Codex model list opened from it.
 */
export type MenuKind = 'claude-model' | 'codex-picker' | 'codex-models';
/** One open qualified menu: its label, its own entries in order, the entry holding keyboard focus, and whether focus is in it. */
export interface PickerMenu { kind: MenuKind; label: string; items: PickerItem[]; focused: number | null; hasFocus: boolean }
/** Claude's open `Effort` slider and its range (`RangeValue`). */
export interface PickerSlider { value: number; min: number; max: number; step: number }
/**
 * A composer button that opens a setting: Claude's `Model: <name>` or `Effort: <level>` (label after the prefix), or
 * Codex's picker button (whole name: `<model> <effort>` while collapsed, `Select effort` while expanded).
 */
export interface SettingButton { label: string; expanded: boolean }
/** Codex's picker announcement, `<model> <level>, <n> of <count>.`, parsed. */
export interface PickerAnnouncement { label: string; position: number; count: number }
/**
 * The model and effort controls of the client's foreground window (#906), read without changing anything. Labels are
 * the client's own model and effort names; nothing else crosses this boundary, and other menus are not read.
 */
export interface PickerState {
  /** The open qualified menu (the Codex model list before its picker), focused or not; null when none is open. */
  menu: PickerMenu | null;
  /** Claude's `Effort` slider while it is open; null otherwise (Codex: always null). */
  slider: PickerSlider | null;
  /** Claude's `Model:` button, or Codex's picker button; null when absent. */
  model: SettingButton | null;
  /** Claude's `Effort:` button; null when absent (a model without effort) and for Codex. */
  effort: SettingButton | null;
  /** Codex: the open picker's announcement; null when there is none. */
  announcement: PickerAnnouncement | null;
}
/** The controls the UI Automation actions may open or close. */
export type SettingControl = 'claude-model' | 'claude-effort' | 'codex-picker';
/** Bounds on a menu's entries and on one label. */
export const MAX_PICKER_ITEMS = 64;
export const MAX_PICKER_LABEL = 128;

/**
 * Claude's next-step suggestions (#907) and its composer, as counts and booleans: never the suggestions' text, which is
 * model output. The band is the qualified shape only: a `Group` beside the composer's group holding a "next:" label,
 * one button per suggestion and a "dismiss" button, which is never counted.
 */
export interface NextSteps {
  /** Suggestion buttons in the band (0-`MAX_SUGGESTIONS`); 0 when no band shows. */
  count: number;
  /** The suggestion holding keyboard focus, or null. */
  focused: number | null;
  /**
   * Claude's one composer: whether it holds keyboard focus, and whether it is empty. Empty means its value is empty or
   * only one trailing line break: Claude's empty composer reads as one `\n`, and its ghost text never shows there.
   */
  composer: { focused: boolean; empty: boolean };
}
/** Bound on a band's suggestion buttons (the mod shows up to three). */
export const MAX_SUGGESTIONS = 8;

/** A Claude Desktop session record's model and effort values, read by allowlisted key; null when absent. */
export interface ClaudeSettings { model: string | null; effort: string | null }

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

  /**
   * Taps one chord `presses` times (1-`MAX_CLIENT_PRESSES`), but only while `client`'s window is in front, checked right
   * before the input goes in (#906): Codex's one closing Escape, the owner's Codex effort chords and the picker's arrows
   * when no chords are configured. It never types `Enter`: only Send does. The keys are profile key names or `NAVIGATION_KEYS`. Known `true` when sent, known
   * `false` when the client is not in front (nothing sent). Rejects, sending nothing, on a malformed request, while this
   * adapter holds any key, or while the user holds a modifier.
   */
  tapInClient(client: Client, keys: readonly KeyName[], presses: number): Promise<Observation<boolean>>;

  /**
   * The model and effort controls of `client`'s foreground window, read-only (#906): unknown when the client is not in
   * front or the controls cannot be read.
   */
  pickerState(client: Client): Promise<Observation<PickerState>>;

  /*
   * UI Automation actions on the qualified model and effort controls only (#906). Each runs in the client's own foreground
   * window, re-reads its target just before acting and refuses (unknown) on any difference: a missing or duplicated
   * control, a changed entry count, a state other than the one named. None types a key.
   */

  /** Expands a collapsed setting button (`ExpandCollapse.Expand`); known whether it reads expanded within the read-back bound. */
  expandSetting(client: Client, control: SettingControl): Promise<Observation<boolean>>;
  /** Collapses an expanded Claude setting button; Codex's picker does not close this way and is refused. */
  collapseSetting(client: Client, control: SettingControl): Promise<Observation<boolean>>;
  /** Codex: invokes the open `Select effort` picker's "Select model" entry, which opens the model list. */
  invokeSelectModel(client: Client): Promise<Observation<boolean>>;
  /**
   * Moves keyboard focus to entry `index` of the open `menu` of `count` entries (`SetFocus`), and reads focus back for
   * a short bounded time: the focused index then, or null.
   */
  focusMenuEntry(client: Client, menu: MenuKind, index: number, count: number): Promise<Observation<number | null>>;
  /**
   * Selects model option `index` of the open `menu` (`SelectionItem.Select`) only while it has keyboard focus: known
   * `false`, with nothing done, when it does not.
   */
  selectMenuOption(client: Client, menu: MenuKind, index: number, count: number): Promise<Observation<boolean>>;
  /**
   * Codex: invokes model option `index` of the open model list of `count` entries, only when it is the selected (current)
   * model. Codex then returns to its picker with nothing changed, the way to leave the list without a pick: `Select` on
   * the selected option does nothing there (observed 2026-10-07).
   */
  invokeCurrentOption(client: Client, index: number, count: number): Promise<Observation<boolean>>;
  /**
   * Claude: sets the open Effort slider from `from` to `to` (`RangeValue.SetValue`), only when it reads `from` and `to`
   * is one step away within its range; the value read back, or null when it did not settle.
   */
  setSliderValue(client: Client, from: number, to: number): Promise<Observation<number | null>>;
  /** Gives the client's one composer keyboard focus; known whether it has it within the read-back bound. */
  focusComposer(client: Client): Promise<Observation<boolean>>;

  /** Claude Desktop: the named session record's `model` and `effort`, or known null when there is no record. Reads those keys only. */
  claudeSettings(localId: string): Promise<Observation<ClaudeSettings | null>>;

  /*
   * Claude's next-step suggestions (#907), in Claude's own foreground window only; Codex answers unknown
   * (`invalid-client`). The actions re-read the band just before acting and refuse (unknown) when it is gone, out of
   * its qualified shape or no longer has `count` suggestions. None types a key, and none returns text.
   */

  /** The band and the composer, read without changing anything: unknown when Claude is not in front or either cannot be read. */
  suggestionState(client: Client): Promise<Observation<NextSteps>>;
  /**
   * Moves keyboard focus to suggestion `index` of the band of `count` (`SetFocus`), and reads focus back for a short
   * bounded time: the focused suggestion then, or null.
   */
  focusSuggestion(client: Client, index: number, count: number): Promise<Observation<number | null>>;
  /**
   * Invokes suggestion `index` of the band of `count`, which writes it into the composer as a draft, only while it holds
   * keyboard focus and the composer is empty: known `false`, with nothing done, otherwise. It never sends.
   */
  invokeSuggestion(client: Client, index: number, count: number): Promise<Observation<boolean>>;

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
