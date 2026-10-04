import { win32 as winPath } from 'node:path';
import {
  OS_ADAPTER_VERSION, type ClaudeDesktopSession, type Client, type ClientVersions, type ForegroundWindow, type KeyRequest,
  type Observation, type OsAdapter,
} from '../os-adapter.js';
import { claudeSessions, codexArchived } from './client-files.js';
import { CLAUDE_PACKAGE_FAMILY, PACKAGE_FAMILIES } from './constants.js';
import { KeyboardError, OpenUriError } from './errors.js';
import { Keyboard } from './keyboard.js';
import { MAX_SCROLL_NOTCHES, pointInRect, WHEEL_DELTA } from './mouse.js';
import { UiaHelper, type UiaHelperLike, type UiaHelperOptions } from './uia-helper.js';
import { parseDeepLink } from './uri.js';
import { loadWin32Api, type Win32Api } from './win32.js';

export interface WindowsAdapterOptions {
  /** Loads the Win32 surface (default: koffi bindings, loaded on first use). */
  win32?: () => Promise<Win32Api>;
  /** The UI Automation helper (default: a `UiaHelper` started on first use). */
  helper?: UiaHelperLike;
  helperOptions?: UiaHelperOptions;
  /** Codex home (default: `CODEX_HOME`, else `%USERPROFILE%\.codex`). */
  codexHome?: string;
  /** Claude Desktop `claude-code-sessions` directory (default: under the package's `LocalCache` in `%LOCALAPPDATA%`). */
  claudeSessionsRoot?: string;
  env?: NodeJS.ProcessEnv;
}

type Unknown = { status: 'unknown'; reason: string };
const unknown = (reason: string): Unknown => ({ status: 'unknown', reason });
const known = <T>(value: T): Observation<T> => ({ status: 'known', value });

const VERSION = /^\d{1,9}(\.\d{1,9}){1,3}$/;
const REASON = /^[a-z0-9-]{1,64}$/;
const MAX_TITLE = 1024;

interface Foreground { hwnd: number; root: number; pid: number; packageIdentity: string | null; processName: string | null }

const isClient = (client: unknown): client is Client => client === 'codex' || client === 'claude';

/**
 * The Windows OS adapter (interface version 1). Keystrokes, foreground identity and deep links use Win32 through
 * koffi; UI checks go to a read-only UI Automation helper scoped to the client's foreground top-level window; the
 * Codex archive and Claude Desktop records are read by name and by allowlisted key. Nothing here logs.
 */
export function createWindowsAdapter(options: WindowsAdapterOptions = {}): OsAdapter {
  const env = options.env ?? process.env;
  const loadApi = options.win32 ?? (() => loadWin32Api());
  let api: Promise<Win32Api> | undefined;
  let keyboard: Keyboard | undefined;
  let helper = options.helper;
  let closed = false;

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
      const processName = identity.imagePath ? winPath.basename(identity.imagePath) : null;
      return known({ hwnd, root, pid, packageIdentity: identity.packageFamily, processName });
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

  const adapter: OsAdapter = {
    version: OS_ADAPTER_VERSION,
    platform: 'win32',

    async clientVersions(): Promise<ClientVersions> {
      if (closed) return { codex: unknown('adapter-closed'), claude: unknown('adapter-closed') };
      const reply = await uia().request('clientVersions');
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
      return { codex: one(values.codex), claude: one(values.claude) };
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
      try {
        result = loaded.shellOpen(uri);
      } catch (cause) {
        throw new OpenUriError('open-uri-failed', { cause });
      }
      if (!(result > 32)) throw new OpenUriError('open-uri-failed', { shellResult: result });
    },

    async sendKeys(request: KeyRequest): Promise<void> {
      if (closed) throw new KeyboardError('adapter-closed');
      const loaded = await win32();
      if (!loaded || !keyboard) throw new KeyboardError('win32-unavailable');
      keyboard.send(request);
    },

    async releaseAll(): Promise<void> {
      // Only keys this adapter pressed can be held; without a loaded keyboard there are none.
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

    async codexSelectedTitle(title: string) {
      if (closed) return unknown('adapter-closed');
      if (typeof title !== 'string' || title.length === 0 || title.length > MAX_TITLE) return unknown('invalid-title');
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

    async approvalVisible(client: Client) {
      if (closed) return unknown('adapter-closed');
      if (!isClient(client)) return unknown('invalid-client');
      // No approval or permission card was open during read-only qualification, so its structure is unknown.
      return unknown('approval-detection-unqualified');
    },

    async codexArchived(threadId: string) {
      if (closed) return unknown('adapter-closed');
      const home = codexHome();
      if (!home) return unknown('codex-home-unset');
      return codexArchived(home, threadId);
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
