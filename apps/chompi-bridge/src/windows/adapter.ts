import { win32 as winPath } from 'node:path';
import {
  OS_ADAPTER_VERSION, type CardButtons, type ClaudeDesktopSession, type Client, type ClientVersions, type ForegroundWindow,
  type KeyRequest, type Observation, type OsAdapter, type VolumeKey,
} from '../os-adapter.js';
import { claudeSessions, CodexArchiveIndex, CodexThreadNames, type CodexArchiveOptions, type CodexThreadNameOptions } from './client-files.js';
import { CLAUDE_PACKAGE_FAMILY, PACKAGE_FAMILIES } from './constants.js';
import { KeyboardError, OpenUriError } from './errors.js';
import { Keyboard } from './keyboard.js';
import { MAX_SCROLL_NOTCHES, pointInRect, WHEEL_DELTA } from './mouse.js';
import { packageFamilyFromImagePath } from './package-path.js';
import { UiaHelper, type UiaHelperLike, type UiaHelperOptions } from './uia-helper.js';
import { parseDeepLink, THREAD_ID } from './uri.js';
import { loadWin32Api, type Win32Api } from './win32.js';

export interface WindowsAdapterOptions {
  /** Loads the Win32 surface (default: koffi bindings, loaded on first use). */
  win32?: () => Promise<Win32Api>;
  /** The UI Automation helper (default: a `UiaHelper` started on first use). */
  helper?: UiaHelperLike;
  helperOptions?: UiaHelperOptions;
  /** Program Files folder whose `WindowsApps` holds installed packages (default: `ProgramW6432`, else `ProgramFiles`). */
  programFiles?: string;
  /** Codex home (default: `CODEX_HOME`, else `%USERPROFILE%\.codex`). */
  codexHome?: string;
  /** Claude Desktop `claude-code-sessions` directory (default: under the package's `LocalCache` in `%LOCALAPPDATA%`). */
  claudeSessionsRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Archive scan bound and answer TTL (defaults: 1 s scan, 10 s TTL). */
  codexArchive?: Omit<CodexArchiveOptions, 'now'>;
  /** Largest Codex `session_index.jsonl` read for thread names (default 16 MiB). */
  codexThreadNames?: CodexThreadNameOptions;
  /** Longest wait for the shell to accept a deep link (default 10 s). */
  openUriTimeoutMs?: number;
  /** How long cached client versions stay fresh while the helper keeps running (default 10 min). */
  versionTtlMs?: number;
  now?: () => number;
}

/** Start-up and exit hooks the host adapters add to the portable interface. */
export interface HostOsAdapter extends OsAdapter {
  /** Starts the UI Automation helper and caches client versions. Never throws. */
  warmUp(): Promise<void>;
  /** Releases held keys synchronously, for a `process.on('exit')` hook. Never throws. */
  releaseAllSync(): void;
}

export type WindowsOsAdapter = HostOsAdapter;

type Unknown = { status: 'unknown'; reason: string };
const unknown = (reason: string): Unknown => ({ status: 'unknown', reason });
const known = <T>(value: T): Observation<T> => ({ status: 'known', value });

const VERSION = /^\d{1,9}(\.\d{1,9}){1,3}$/;
const REASON = /^[a-z0-9-]{1,64}$/;
const MAX_TITLE = 1024;
/** The helper's bound on a card's actionable buttons. */
const MAX_CARD_BUTTONS = 64;
/** The helper's bound on the Group elements it searches for a Codex card. */
const MAX_CARD_GROUPS = 512;

interface Foreground { hwnd: number; root: number; pid: number; packageIdentity: string | null; processName: string | null }

const isClient = (client: unknown): client is Client => client === 'codex' || client === 'claude';

const isCount = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
const record = (value: unknown) => (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
/** A helper's focused-index answer: -1 is none, otherwise an index below `count`. */
const focusedIndex = (value: unknown, count: number): number | null | undefined =>
  value === -1 ? null : isCount(value, MAX_CARD_BUTTONS) && value < count ? value : undefined;
/** A valid index into a card of `count` actionable buttons. */
const validCardIndex = (index: unknown, count: unknown): boolean =>
  isCount(count, MAX_CARD_BUTTONS) && count >= 1 && isCount(index, MAX_CARD_BUTTONS) && index < count;
/** A card identity: a UI Automation runtime ID joined with dots. */
const CARD_ID = /^-?\d{1,10}(\.-?\d{1,10}){0,15}$/;

/**
 * The Windows OS adapter (interface version 4). Keystrokes, the system volume keys (#865), foreground identity and
 * deep links use Win32 through koffi; UI checks go to a UI Automation helper scoped to the client's foreground
 * top-level window, which changes UI state only to focus or press one button of an open card (#821); the Codex archive
 * and Claude Desktop records are read by name and by allowlisted key, and Codex thread names come from
 * `session_index.jsonl` (`id`, `thread_name` and `updated_at` only) and stay inside the adapter. Nothing here logs.
 */
export function createWindowsAdapter(options: WindowsAdapterOptions = {}): WindowsOsAdapter {
  const env = options.env ?? process.env;
  const loadApi = options.win32 ?? (() => loadWin32Api());
  let api: Promise<Win32Api> | undefined;
  let keyboard: Keyboard | undefined;
  let helper = options.helper;
  let closed = false;
  const now = options.now ?? Date.now;
  const versionTtlMs = options.versionTtlMs ?? 10 * 60_000;
  const openUriTimeoutMs = options.openUriTimeoutMs ?? 10_000;
  let versions: { value: ClientVersions; at: number; starts: number | undefined; epoch: number } | null = null;
  let versionsInflight: { promise: Promise<ClientVersions>; epoch: number } | null = null;
  // Each client's last foreground process ID. A new or changed one (a restart, possibly after a self-update)
  // advances the epoch, which invalidates cached versions, including a fetch already in flight.
  const clientPids: Partial<Record<Client, number>> = {};
  let pidEpoch = 0;
  const noteClientProcess = (packageIdentity: string | null, pid: number) => {
    for (const client of ['codex', 'claude'] as const) {
      if (PACKAGE_FAMILIES[client] === packageIdentity && clientPids[client] !== pid) { clientPids[client] = pid; pidEpoch += 1; }
    }
  };
  let archive: { home: string; index: CodexArchiveIndex } | null = null;
  let threadNames: { home: string; index: CodexThreadNames } | null = null;

  const win32 = async (): Promise<Win32Api | null> => {
    api ??= loadApi();
    try {
      const loaded = await api;
      keyboard ??= new Keyboard(loaded);
      return loaded;
    } catch {
      return null;
    }
  };
  const uia = () => (helper ??= new UiaHelper(options.helperOptions));

  const programFiles = () => options.programFiles ?? env.ProgramW6432 ?? env.ProgramFiles;
  const codexHome = () => options.codexHome ?? env.CODEX_HOME ?? (env.USERPROFILE ? winPath.join(env.USERPROFILE, '.codex') : undefined);
  const claudeRoot = () => options.claudeSessionsRoot
    ?? (env.LOCALAPPDATA ? winPath.join(env.LOCALAPPDATA, 'Packages', CLAUDE_PACKAGE_FAMILY, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions') : undefined);

  async function foreground(): Promise<Observation<Foreground | null>> {
    if (closed) return unknown('adapter-closed');
    const loaded = await win32();
    if (!loaded) return unknown('win32-unavailable');
    try {
      const hwnd = loaded.foregroundWindow();
      if (!hwnd) return known(null);
      const pid = loaded.windowProcessId(hwnd);
      if (!pid) return unknown('window-process-unavailable');
      const identity = loaded.processIdentity(pid);
      if (!identity) return unknown('process-unavailable');
      const root = loaded.rootOwner(hwnd) || hwnd;
      // A foreground change during the lookup would mix two windows' facts.
      if (loaded.foregroundWindow() !== hwnd) return unknown('foreground-changed');
      // Codex Desktop's window process runs from its package folder without package identity.
      const packageIdentity = identity.packageFamily ?? packageFamilyFromImagePath(identity.imagePath, programFiles());
      noteClientProcess(packageIdentity, pid);
      const processName = identity.imagePath ? winPath.basename(identity.imagePath) : null;
      return known({ hwnd, root, pid, packageIdentity, processName });
    } catch {
      return unknown('win32-call-failed');
    }
  }

  /** Runs a helper query against the client's foreground window, then confirms the foreground did not move. */
  async function windowQuery<T>(client: Client, op: string, params: Record<string, unknown>, parse: (value: unknown) => T | null,
    whenNotForeground: Observation<T>): Promise<Observation<T>> {
    const before = await foreground();
    if (before.status === 'unknown') return before;
    if (!before.value || before.value.packageIdentity !== PACKAGE_FAMILIES[client]) return whenNotForeground;
    const { root, pid } = before.value;
    const reply = await uia().request(op, { ...params, hwnd: root, processId: pid });
    if (!reply.ok) return unknown(REASON.test(reply.reason) ? reply.reason : 'helper-error');
    const value = parse(reply.value);
    if (value === null) return unknown('helper-invalid-reply');
    const after = await foreground();
    if (after.status === 'unknown') return after;
    if (!after.value || after.value.hwnd !== before.value.hwnd || after.value.pid !== pid) return unknown('foreground-changed');
    return known(value);
  }

  async function fetchVersions(epoch: number): Promise<ClientVersions> {
    const current = uia();
    const reply = await current.request('clientVersions');
    if (!reply.ok) {
      const reason = REASON.test(reply.reason) ? reply.reason : 'helper-error';
      return { codex: unknown(reason), claude: unknown(reason) };
    }
    const values = (typeof reply.value === 'object' && reply.value !== null ? reply.value : {}) as Record<string, unknown>;
    const one = (entry: unknown): Observation<string> => {
      const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
      if (typeof record.version === 'string') return VERSION.test(record.version) ? known(record.version) : unknown('helper-invalid-reply');
      if (record.reason === 'not-installed' || record.reason === 'multiple-packages') return unknown(record.reason);
      return unknown('helper-invalid-reply');
    };
    const value = { codex: one(values.codex), claude: one(values.claude) };
    versions = { value, at: now(), starts: current.starts, epoch };
    return value;
  }

  const adapter: WindowsOsAdapter = {
    version: OS_ADAPTER_VERSION,
    platform: 'win32',

    /** Cached; see "Adapter caches and their staleness" in UIA-NOTES.md for when it refreshes and how stale it can be. */
    async clientVersions(): Promise<ClientVersions> {
      if (closed) return { codex: unknown('adapter-closed'), claude: unknown('adapter-closed') };
      // Cached while the helper and every seen client process stay the same, for at most the TTL.
      if (versions && versions.epoch === pidEpoch && versions.starts === uia().starts && now() - versions.at < versionTtlMs) return versions.value;
      if (versionsInflight?.epoch !== pidEpoch) {
        const epoch = pidEpoch;
        const promise = fetchVersions(epoch).finally(() => { if (versionsInflight?.promise === promise) versionsInflight = null; });
        versionsInflight = { promise, epoch };
      }
      return versionsInflight!.promise;
    },

    async warmUp(): Promise<void> {
      if (closed) return;
      try {
        await uia().request('ping');
        await adapter.clientVersions();
      } catch {
        // Warm-up is an optimization; every observation still fails closed on its own.
      }
    },

    async foregroundWindow(): Promise<Observation<ForegroundWindow | null>> {
      const result = await foreground();
      if (result.status === 'unknown' || !result.value) return result as Observation<null> | Unknown;
      return known({ packageIdentity: result.value.packageIdentity, processName: result.value.processName });
    },

    async openUri(uri: string): Promise<void> {
      if (closed) throw new OpenUriError('adapter-closed');
      if (!parseDeepLink(uri)) throw new OpenUriError('invalid-deep-link');
      const loaded = await win32();
      if (!loaded) throw new OpenUriError('win32-unavailable');
      let result: number;
      let timer: NodeJS.Timeout | undefined;
      try {
        // ShellExecuteW runs on a worker thread; a hung activation times out here without blocking the event loop.
        result = await Promise.race([
          loaded.shellOpen(uri),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('open-uri-timeout')), openUriTimeoutMs); }),
        ]);
      } catch (cause) {
        throw new OpenUriError('open-uri-failed', { cause });
      } finally {
        clearTimeout(timer);
      }
      if (!(result > 32)) throw new OpenUriError('open-uri-failed', { shellResult: result });
    },

    async sendKeys(request: KeyRequest): Promise<void> {
      if (closed) throw new KeyboardError('adapter-closed');
      const loaded = await win32();
      if (!loaded || !keyboard) throw new KeyboardError('win32-unavailable');
      keyboard.send(request);
    },

    async sendVolumeKey(key: VolumeKey, presses: number): Promise<void> {
      if (closed) throw new KeyboardError('adapter-closed');
      const loaded = await win32();
      if (!loaded || !keyboard) throw new KeyboardError('win32-unavailable');
      // The system handles volume keys, so no window is observed or required.
      keyboard.tapVolume(key, presses);
    },

    async releaseAll(): Promise<void> {
      adapter.releaseAllSync();
    },

    releaseAllSync(): void {
      // Only keys this adapter pressed can be held; without a loaded keyboard there are none. FFI calls are synchronous.
      try { keyboard?.releaseAll(); } catch { /* never throws */ }
    },

    async scrollClient(client: Client, notches: number): Promise<Observation<boolean>> {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      if (typeof notches !== 'number' || !Number.isInteger(notches)) return unknown('invalid-notches');
      const clamped = Math.max(-MAX_SCROLL_NOTCHES, Math.min(MAX_SCROLL_NOTCHES, notches));
      const current = await foreground();
      if (current.status === 'unknown') return current;
      if (!current.value || current.value.packageIdentity !== PACKAGE_FAMILIES[client] || clamped === 0) return known(false);
      const loaded = await win32();
      if (!loaded) return unknown('win32-unavailable');
      try {
        const rect = loaded.windowRect(current.value.root);
        if (!rect) return unknown('window-rect-unavailable');
        const cursor = loaded.cursorPosition();
        if (!cursor) return unknown('cursor-unavailable');
        if (!pointInRect(cursor, rect)) return known(false);
        if (loaded.foregroundWindow() !== current.value.hwnd) return unknown('foreground-changed');
        const { inserted } = loaded.sendWheel(clamped * WHEEL_DELTA);
        return inserted === 1 ? known(true) : unknown('send-input-failed');
      } catch {
        return unknown('win32-call-failed');
      }
    },

    async codexSelectedThread(threadId: string, fallbackTitle: string | null) {
      if (closed) return unknown('adapter-closed');
      if (typeof threadId !== 'string' || !THREAD_ID.test(threadId)) return unknown('invalid-thread-id');
      if (fallbackTitle !== null && (typeof fallbackTitle !== 'string' || fallbackTitle.length === 0 || fallbackTitle.length > MAX_TITLE)) {
        return unknown('invalid-title');
      }
      // Codex's own name is what its sidebar shows; the Hub only has a title the owner set. Every unknown fails closed:
      // an unreadable index, an unusable current name, no name at all, or a name another thread also has (its row may
      // be collapsed or gone, so the sidebar's own duplicate count cannot see it).
      const home = codexHome();
      if (!home) return unknown('codex-home-unset');
      if (threadNames?.home !== home) threadNames = { home, index: new CodexThreadNames(home, options.codexThreadNames) };
      const read = await threadNames.index.read();
      if (closed) return unknown('adapter-closed');
      if (read.status !== 'known') return read;
      const current = read.value.nameOf(threadId);
      if (current.status === 'invalid') return unknown('codex-name-invalid');
      const title = current.status === 'named' ? current.name : fallbackTitle;
      if (title === null) return unknown('codex-title-missing');
      if (read.value.sharedWithOtherThread(title, threadId)) return unknown('codex-name-not-unique');
      return windowQuery('codex', 'codexSelectedTitle', { title }, value => {
        const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
        const { matches, sameTitleRows } = record;
        if (typeof matches !== 'boolean' || typeof sameTitleRows !== 'number' || !Number.isInteger(sameTitleRows) || sameTitleRows < 0 || sameTitleRows > 100000) return null;
        return { matches, sameTitleRows };
      }, unknown('codex-not-foreground'));
    },

    async composerFocused(client: Client) {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      return windowQuery(client, 'composerFocused', { client }, value => {
        const focused = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
        return typeof focused.focused === 'boolean' ? focused.focused : null;
      }, known(false));
    },

    /** Selectors and the client versions they were qualified on are in UIA-NOTES.md ("Approval cards"). */
    async approvalVisible(client: Client): Promise<Observation<boolean>> {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      // Claude reports its approval-card count; Codex reports its composer count, because its approval card replaces the
      // composer. The helper only counts elements in the client's own foreground window.
      const key = client === 'claude' ? 'approvalCards' : 'composers';
      const count = await windowQuery(client, 'approvalVisible', { client }, value => {
        const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
        const n = record[key];
        return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100000 ? n : null;
      }, unknown(`${client}-not-foreground`));
      if (count.status === 'unknown') return count;
      if (client === 'claude') return known(count.value > 0);
      // No composer is not proof of a card (another view could hide it), and several composers are unqualified.
      if (count.value === 0) return unknown('codex-composer-absent');
      return count.value === 1 ? known(false) : unknown('codex-composer-count');
    },

    /**
     * The helper reports `{ cards, buttons, focused }` (Codex adds `composers` and `selectedRows`); the adapter decides.
     * Claude: no card element is no card, one is the card, several are unknown. Codex: one composer is no card; no
     * composer is a card only with exactly one selected sidebar row and exactly one on-screen group holding text and two
     * or more actionable buttons, wherever keyboard focus is; anything else, or several composers, is unknown.
     * Containers and button rules are in UIA-NOTES.md ("Card answers").
     */
    async cardButtons(client: Client): Promise<Observation<CardButtons | null>> {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      type Reply = { kind: 'none' } | { kind: 'card'; card: CardButtons } | { kind: 'unknown'; reason: string };
      const reply = await windowQuery<Reply>(client, 'cardButtons', { client }, value => {
        const { cards, buttons, focused, composers, selectedRows, cardGroups, cardId } = record(value);
        if (!isCount(cards, 100000) || !isCount(buttons, MAX_CARD_BUTTONS)) return null;
        const index = focusedIndex(focused, buttons);
        if (index === undefined) return null;
        if (client === 'codex') {
          if (!isCount(composers, 100000) || !isCount(selectedRows, 100000) || !isCount(cardGroups, MAX_CARD_GROUPS)) return null;
          if (composers > 1) return { kind: 'unknown', reason: 'codex-composer-count' };
          if (composers === 1) return cards === 0 ? { kind: 'none' } : null;
          if (cards === 0) {
            // A Codex card belongs to the thread view (one selected sidebar row) and is the one on-screen group holding
            // text and at least two actionable buttons, wherever keyboard focus is.
            if (selectedRows !== 1) return { kind: 'unknown', reason: 'codex-selected-row-count' };
            if (cardGroups === 0) return { kind: 'unknown', reason: 'codex-card-unestablished' };
            if (cardGroups > 1) return { kind: 'unknown', reason: 'codex-card-ambiguous' };
            return null;
          }
          if (selectedRows !== 1 || cardGroups !== 1) return null;
        } else if (cards === 0) return { kind: 'none' };
        if (cards > 1) return { kind: 'unknown', reason: 'card-count' };
        if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) return null;
        return { kind: 'card', card: { id: cardId, count: buttons, focused: index } };
      }, unknown(`${client}-not-foreground`));
      if (reply.status === 'unknown') return reply;
      if (reply.value.kind === 'unknown') return unknown(reply.value.reason);
      return known(reply.value.kind === 'card' ? reply.value.card : null);
    },

    async focusCardButton(client: Client, cardId: string, index: number, count: number): Promise<Observation<number | null>> {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) return unknown('invalid-card-id');
      if (!validCardIndex(index, count)) return unknown('invalid-card-index');
      const reply = await windowQuery<{ focused: number | null }>(client, 'focusCardButton', { client, cardId, index, count }, value => {
        const focused = focusedIndex(record(value).focused, count);
        return focused === undefined ? null : { focused };
      }, unknown(`${client}-not-foreground`));
      return reply.status === 'unknown' ? reply : known(reply.value.focused);
    },

    async invokeCardButton(client: Client, cardId: string, index: number, count: number): Promise<Observation<boolean>> {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) return unknown('invalid-card-id');
      if (!validCardIndex(index, count)) return unknown('invalid-card-index');
      return windowQuery(client, 'invokeCardButton', { client, cardId, index, count }, value => {
        const { invoked } = record(value);
        return typeof invoked === 'boolean' ? invoked : null;
      }, unknown(`${client}-not-foreground`));
    },

    async codexArchived(threadId: string) {
      if (closed) return unknown('adapter-closed');
      const home = codexHome();
      if (!home) return unknown('codex-home-unset');
      if (archive?.home !== home) archive = { home, index: new CodexArchiveIndex(home, { ...options.codexArchive, now }) };
      return archive.index.archivedThread(threadId);
    },

    async claudeSessions(localIds: readonly string[]): Promise<Observation<ClaudeDesktopSession[]>> {
      if (closed) return unknown('adapter-closed');
      const root = claudeRoot();
      if (!root) return unknown('claude-store-unset');
      return claudeSessions(root, localIds);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await adapter.releaseAll();
      await helper?.close();
    },
  };
  return adapter;
}
