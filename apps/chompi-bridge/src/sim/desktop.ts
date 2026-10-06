import { systemClock, type Clock } from '../clock.js';
import {
  MAX_CLIENT_PRESSES, MAX_VOLUME_PRESSES, NAVIGATION_KEYS, OS_ADAPTER_VERSION, type CardButtons, type ClaudeDesktopSession, type Client, type ClientVersions,
  type ForegroundWindow, type KeyRequest, type Observation, type OsAdapter, type VolumeKey,
} from '../os-adapter.js';
import { KEY_NAMES } from '../routing/profile.js';
import { CLAUDE_PACKAGE_FAMILY, CODEX_PACKAGE_FAMILY } from '../windows/constants.js';
import { SimPickers, type PickerSeed } from './pickers.js';

/**
 * A simulated Codex and Claude desktop behind OS adapter interface version 5, for disposable verification runs and the
 * shared scenario catalog (#853). `chompi-bridge run --desktop sim` selects it; nothing loads it otherwise. It models
 * what the router observes and causes, as the qualified clients behave (README "Safety rules", UIA-NOTES.md):
 *
 * - a Codex link raises Codex on an existing thread with its composer unfocused; `LeftAlt`+`L` focuses it;
 * - a Claude link raises Claude on the session, stamps its `lastFocusedAt` unless Claude already showed it, and
 *   focuses the composer;
 * - Enter submits the focused composer's text, or presses a focused card stop, as a keyboard would;
 * - a Claude card keeps the composer; a Codex card replaces it, so Codex's approval check is unknown while it is open;
 * - pressing a stop answers and closes the card; Codex's composer then comes back focused;
 * - releasing the dictation chord inserts a fixed synthetic phrase into the focused composer, as Wispr would;
 * - a volume key changes a synthetic system volume (2 points per press, 0-100) or toggles mute, reaches no window and,
 *   like the Windows keyboard, is refused while any key is held; a volume step unmutes, as Windows does;
 * - each client has the model and effort controls of `SimPickers` (#906): an open menu or slider takes the keys, so an
 *   Enter there picks a model instead of sending, and Claude's `LeftControl`+`LeftAlt`+`Minus` splits the pane.
 *
 * Everything is synthetic: titles and text come from the run's seed or its operator, never from a real desktop. This
 * proves routing behavior, not Windows client fidelity (UI Automation trees, real focus timing, Wispr).
 */

export type WindowId = Client | 'other';

/** The qualified package families, and one for "another app" that is no client. */
export const SIM_WINDOWS: Readonly<Record<WindowId, ForegroundWindow & { title: string }>> = Object.freeze({
  codex: { packageIdentity: CODEX_PACKAGE_FAMILY, processName: 'Codex.exe', title: 'Codex' },
  claude: { packageIdentity: CLAUDE_PACKAGE_FAMILY, processName: 'claude.exe', title: 'Claude' },
  other: { packageIdentity: 'Synthetic.OtherApp_0000000000000', processName: 'OtherApp.exe', title: 'Another app' },
});

/** The client versions the shipped profile qualifies. */
export const SIM_DEFAULT_VERSIONS: Readonly<Record<Client, string>> = Object.freeze({ codex: '26.930.3930.0', claude: '2.19675.0.0' });
export const SIM_DICTATION_CHORD: readonly string[] = Object.freeze(['LeftControl', 'LeftWindows']);
export const SIM_DICTATION_TEXT = 'synthetic dictation';
const CODEX_COMPOSER_SHORTCUT = 'LeftAlt+L';
const MAX_LOG = 500;
const MAX_TEXT = 2000;

export type CardKind = 'approval' | 'question';
export interface CardSeed {
  kind: CardKind;
  /** Stop labels in tree order (synthetic). A Claude question card's stops are its answer rows and "Other". */
  stops: readonly string[];
  focused?: number | null;
  /** False models a card whose container cannot be established: the adapter answers unknown. */
  established?: boolean;
}
export interface SimCard { id: string; kind: CardKind; stops: string[]; focused: number | null; established: boolean }
export interface SimComposer { focused: boolean; text: string; submitted: string[] }
export interface CodexThread { id: string; title: string; archived: boolean }
export interface ClaudeSession { localId: string; title: string; isArchived: boolean; lastFocusedAt: number | null }

export type DesktopLogEntry =
  | { at: number; seq: number; kind: 'key'; action: KeyRequest['action']; keys: string[]; window: WindowId | null }
  | { at: number; seq: number; kind: 'link'; client: Client; task: string; followed: boolean }
  | { at: number; seq: number; kind: 'submit'; client: Client; text: string }
  | { at: number; seq: number; kind: 'card-focus'; client: Client; index: number }
  | { at: number; seq: number; kind: 'card-press'; client: Client; index: number; stop: string; card: CardKind }
  | { at: number; seq: number; kind: 'scroll'; client: Client; notches: number }
  | { at: number; seq: number; kind: 'dictation'; client: Client | null; text: string }
  | { at: number; seq: number; kind: 'volume'; key: VolumeKey; presses: number; volume: number; muted: boolean }
  | { at: number; seq: number; kind: 'picker'; client: Client; action: string; label?: string; position?: number; count?: number }
  | { at: number; seq: number; kind: 'operator'; action: string };

type LogInput = DesktopLogEntry extends infer T ? T extends unknown ? Omit<T, 'at' | 'seq'> : never : never;

/** The synthetic system audio the volume keys change. */
export interface SystemAudio { volume: number; muted: boolean }
/** Volume points per volume key press, as Windows steps it. */
export const SIM_VOLUME_STEP = 2;

export interface DesktopSnapshot {
  foreground: WindowId | null;
  system: SystemAudio;
  dictating: boolean;
  held: string[];
  versions: Record<Client, string | null>;
  windows: {
    codex: { selected: string | null; threads: CodexThread[]; composer: SimComposer; card: SimCard | null; picker: PickerView };
    claude: { selected: string | null; sessions: ClaudeSession[]; composer: SimComposer; card: SimCard | null; picker: PickerView };
    other: { title: string };
  };
}

/** A client's model, effort level (null where the model has none), the open menu or slider, if any, and its focused entry. */
export interface PickerView { model: string; effort: string | null; open: string | null; focus: string | null }

export interface SimulatedDesktopOptions { clock?: Clock }

const known = <T>(value: T): Observation<T> => ({ status: 'known', value });
const unknown = (reason: string): Observation<never> => ({ status: 'unknown', reason });
const isClient = (value: unknown): value is Client => value === 'codex' || value === 'claude';
const CLIENT_KEYS = new Set<string>([...KEY_NAMES, ...NAVIGATION_KEYS]);
/** An array check that keeps the element type (`Array.isArray` widens a readonly array's elements to `any`). */
const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** The in-memory desktop. Operator methods script it; `createSimulatedOsAdapter` is the router's view of it. */
export class SimulatedDesktop {
  readonly clock: Clock;
  readonly log: DesktopLogEntry[] = [];
  /** Adapter operations in call order, for boundary evidence and tests. Bounded like the log. */
  readonly calls: string[] = [];
  #foreground: WindowId | null = 'other';
  readonly #versions: Record<Client, string | null> = { ...SIM_DEFAULT_VERSIONS };
  readonly #threads = new Map<string, CodexThread>();
  readonly #sessions = new Map<string, ClaudeSession>();
  readonly #selected: Record<Client, string | null> = { codex: null, claude: null };
  readonly #composer: Record<Client, SimComposer> = { codex: { focused: false, text: '', submitted: [] }, claude: { focused: false, text: '', submitted: [] } };
  readonly #cards: Record<Client, SimCard | null> = { codex: null, claude: null };
  readonly #held = new Set<string>();
  #dictating = false;
  readonly #system: SystemAudio = { volume: 50, muted: false };
  #cardSerial = 0;
  #logSeq = 0;
  #listeners = new Set<() => void>();
  /** Both clients' model and effort controls; Claude's values follow the session it shows. */
  readonly pickers = new SimPickers(() => this.#selected.claude ?? '');

  constructor(options: SimulatedDesktopOptions = {}) { this.clock = options.clock ?? systemClock; }

  get foreground(): WindowId | null { return this.#foreground; }
  get held(): string[] { return [...this.#held].sort(); }
  get dictating(): boolean { return this.#dictating; }

  /** Called after every change, so a page can follow the desktop. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // Operator actions: what a person at the simulated desktop does.

  bringToFront(window: WindowId | null): void {
    this.#foreground = window;
    this.#record({ kind: 'operator', action: `front:${window ?? 'none'}` });
  }

  addCodexThread(id: string, title: string): void {
    this.#threads.set(id, { id, title, archived: false });
    this.#changed();
  }

  addClaudeSession(localId: string, title: string, lastFocusedAt: number | null = null): void {
    this.#sessions.set(localId, { localId, title, isArchived: false, lastFocusedAt });
    this.#changed();
  }

  archive(client: Client, id: string): void {
    if (client === 'codex') { const thread = this.#threads.get(id); if (thread) thread.archived = true; }
    else { const session = this.#sessions.get(id); if (session) session.isArchived = true; }
    this.#record({ kind: 'operator', action: `archive:${client}` });
  }

  /** Selects a task in its client's sidebar, as a mouse click would. Claude stamps the session it shows. */
  select(client: Client, id: string): void {
    if (client === 'codex' ? !this.#threads.has(id) : !this.#sessions.has(id)) return;
    this.#selected[client] = id;
    if (client === 'claude') this.#sessions.get(id)!.lastFocusedAt = this.clock.now();
    this.#record({ kind: 'operator', action: `select:${client}` });
  }

  setVersion(client: Client, version: string | null): void {
    this.#versions[client] = version;
    this.#record({ kind: 'operator', action: `version:${client}` });
  }

  /** Sets the clients' starting models and effort levels (#906). */
  seedPickers(seed: PickerSeed): void {
    this.pickers.seed(seed);
    this.#record({ kind: 'operator', action: 'seed-pickers' });
  }

  focusComposer(client: Client, focused: boolean): void {
    // A click into the composer closes an open model menu, effort slider or picker, as the mouse would.
    if (focused) this.pickers.dismiss(client);
    this.#composer[client].focused = focused && !(client === 'codex' && this.#cards.codex);
    this.#record({ kind: 'operator', action: `composer-${focused ? 'focus' : 'blur'}:${client}` });
  }

  /** Types into the client's composer, as the operator would; it focuses the composer. */
  typeText(client: Client, text: string): void {
    const composer = this.#composer[client];
    composer.text = (composer.text + text).slice(0, MAX_TEXT);
    this.pickers.dismiss(client);
    composer.focused = !(client === 'codex' && this.#cards.codex);
    this.#record({ kind: 'operator', action: `type:${client}` });
  }

  clearComposer(client: Client): void {
    this.#composer[client].text = '';
    this.#changed();
  }

  /** Opens a card the way the qualified clients show one: Claude keeps its composer, Codex's card replaces it. */
  openCard(client: Client, seed: CardSeed): SimCard {
    const stops = seed.stops.slice(0, 64).map(String);
    const focused = seed.focused === undefined || seed.focused === null || seed.focused < 0 || seed.focused >= stops.length ? null : seed.focused;
    const card: SimCard = { id: `sim-card-${++this.#cardSerial}`, kind: seed.kind, stops, focused, established: seed.established !== false };
    this.#cards[client] = card;
    if (client === 'codex') this.#composer.codex.focused = false;
    this.#record({ kind: 'operator', action: `open-card:${client}:${seed.kind}` });
    return card;
  }

  /** Closes a card without answering it, as the mouse would. */
  closeCard(client: Client): void {
    this.#closeCard(client);
    this.#record({ kind: 'operator', action: `close-card:${client}` });
  }

  snapshot(): DesktopSnapshot {
    const composer = (client: Client): SimComposer => ({ ...this.#composer[client], submitted: [...this.#composer[client].submitted] });
    const card = (client: Client): SimCard | null => this.#cards[client] ? { ...this.#cards[client]!, stops: [...this.#cards[client]!.stops] } : null;
    return {
      foreground: this.#foreground,
      system: { ...this.#system },
      dictating: this.#dictating,
      held: this.held,
      versions: { ...this.#versions },
      windows: {
        codex: { selected: this.#selected.codex, threads: [...this.#threads.values()].map(t => ({ ...t })), composer: composer('codex'), card: card('codex'), picker: this.pickers.describe('codex') },
        claude: {
          selected: this.#selected.claude, sessions: [...this.#sessions.values()].map(s => ({ ...s })), composer: composer('claude'), card: card('claude'),
          picker: this.pickers.describe('claude'),
        },
        other: { title: SIM_WINDOWS.other.title },
      },
    };
  }

  // What the adapter does to the desktop.

  /** @internal */
  call(name: string): void {
    this.calls.push(name);
    if (this.calls.length > MAX_LOG * 4) this.calls.splice(0, this.calls.length - MAX_LOG * 4);
  }

  /** @internal */
  clientInFront(client: Client): boolean { return this.#foreground === client; }

  /** @internal */
  observeVersions(): ClientVersions {
    const of = (client: Client) => this.#versions[client] === null ? unknown('client-not-installed') : known(this.#versions[client]!);
    return { codex: of('codex'), claude: of('claude') };
  }

  /** @internal */
  observeForeground(): Observation<ForegroundWindow | null> {
    if (this.#foreground === null) return known(null);
    const { packageIdentity, processName } = SIM_WINDOWS[this.#foreground];
    return known({ packageIdentity, processName });
  }

  /** @internal A link opens only the two qualified shapes; anything else is refused like the shell adapter does. */
  openLink(uri: string): void {
    const codex = /^codex:\/\/threads\/([^/?#]+)$/.exec(uri);
    const claude = /^claude:\/\/code\/continue\?session=([^&#]+)$/.exec(uri);
    if (!codex && !claude) throw new Error('open-uri-refused');
    if (codex) {
      const id = decodeURIComponent(codex[1]!);
      this.#foreground = 'codex';
      const thread = this.#threads.get(id);
      const followed = !!thread && !thread.archived;
      if (followed) this.#selected.codex = id;
      this.#composer.codex.focused = false;
      this.#record({ kind: 'link', client: 'codex', task: id, followed });
      return;
    }
    const id = decodeURIComponent(claude![1]!);
    const reselect = this.#foreground === 'claude' && this.#selected.claude === id;
    this.#foreground = 'claude';
    const session = this.#sessions.get(id);
    const followed = !!session && !session.isArchived;
    if (followed) {
      if (!reselect) session!.lastFocusedAt = this.clock.now() + 1;
      this.#selected.claude = id;
      this.#composer.claude.focused = true;
    }
    this.#record({ kind: 'link', client: 'claude', task: id, followed });
  }

  /** @internal */
  keys(request: KeyRequest): void {
    const keys = [...request.keys];
    this.#record({ kind: 'key', action: request.action, keys, window: this.#foreground });
    if (request.action === 'down') {
      for (const key of keys) this.#held.add(key);
      if (SIM_DICTATION_CHORD.every(key => this.#held.has(key))) this.#dictating = true;
    } else if (request.action === 'up') {
      for (const key of keys) this.#held.delete(key);
      this.#endDictation();
    } else this.#tap(keys.join('+'));
    this.#changed();
  }

  /**
   * @internal A chord typed only into `client` while it is in front (#906); false, with nothing typed, otherwise. Like the
   * Windows keyboard it is refused while any key is held.
   */
  clientTap(client: Client, keys: readonly string[], presses: number): boolean {
    if (!isClient(client) || !isList(keys) || keys.length < 1 || keys.length > 4 || !keys.every(key => CLIENT_KEYS.has(key)) || new Set(keys).size !== keys.length
      || !Number.isInteger(presses) || presses < 1 || presses > MAX_CLIENT_PRESSES) throw new Error('invalid-key-request');
    if (this.#held.size > 0) throw new Error('keys-held');
    if (!this.clientInFront(client)) return false;
    for (let i = 0; i < presses; i++) this.keys({ action: 'tap', keys: [...keys] });
    return true;
  }

  /** @internal A volume key acts on the system, never a window; like the Windows keyboard it never joins held keys. */
  volume(key: VolumeKey, presses: number): void {
    if (this.#held.size > 0) throw new Error('keys-held');
    if (key === 'VolumeMute') this.#system.muted = !this.#system.muted;
    else {
      const step = key === 'VolumeUp' ? SIM_VOLUME_STEP : -SIM_VOLUME_STEP;
      this.#system.volume = Math.max(0, Math.min(100, this.#system.volume + step * presses));
      this.#system.muted = false;
    }
    this.#record({ kind: 'volume', key, presses, ...this.#system });
  }

  /** @internal */
  releaseKeys(): void {
    if (this.#held.size === 0) return;
    this.#held.clear();
    this.#endDictation();
    this.#record({ kind: 'key', action: 'up', keys: [], window: this.#foreground });
  }

  /** @internal */
  composerFocused(client: Client): boolean { return this.clientInFront(client) && this.#composer[client].focused; }

  /** @internal Claude: a card is visible. Codex: unknown while a card replaced the composer. */
  approval(client: Client): Observation<boolean> {
    if (client === 'claude') return known(this.#cards.claude !== null);
    return this.#cards.codex ? unknown('codex-composer-absent') : known(false);
  }

  /** @internal */
  card(client: Client): Observation<SimCard | null> {
    if (!this.clientInFront(client)) return unknown(`${client}-not-foreground`);
    const card = this.#cards[client];
    if (card && !card.established) return unknown(client === 'codex' ? 'codex-card-unestablished' : 'claude-card-unestablished');
    return known(card);
  }

  /** @internal */
  focusStop(client: Client, card: SimCard, index: number): void {
    card.focused = index;
    if (client === 'claude') this.#composer.claude.focused = false;
    this.#record({ kind: 'card-focus', client, index });
  }

  /** @internal */
  pressStop(client: Client, card: SimCard, index: number): void {
    this.#record({ kind: 'card-press', client, index, stop: card.stops[index] ?? '', card: card.kind });
    this.#closeCard(client);
    this.#changed();
  }

  /** @internal */
  scroll(client: Client, notches: number): boolean {
    if (!this.clientInFront(client)) return false;
    this.#record({ kind: 'scroll', client, notches });
    return true;
  }

  /** @internal */
  codexThread(id: string): CodexThread | undefined { return this.#threads.get(id); }
  /** @internal */
  codexThreads(): CodexThread[] { return [...this.#threads.values()]; }
  /** @internal */
  selected(client: Client): string | null { return this.#selected[client]; }
  /** @internal */
  claudeRecords(ids: readonly string[]): ClaudeDesktopSession[] {
    return ids.filter(id => this.#sessions.has(id)).map(id => {
      const { localId, isArchived, lastFocusedAt } = this.#sessions.get(id)!;
      return { localId, isArchived, lastFocusedAt };
    });
  }

  #tap(chord: string): void {
    const front = this.#foreground;
    // An open menu or slider has keyboard focus and takes every key; the picker shortcuts open one (#906).
    if (isClient(front)) {
      const tap = this.pickers.tap(front, chord, { composerFocused: this.#composer[front].focused, card: this.#cards[front] !== null });
      if (tap.composerFocused !== undefined) this.#composer[front].focused = tap.composerFocused && !(front === 'codex' && this.#cards.codex);
      for (const event of tap.events) this.#record({ kind: 'picker', client: front, ...event });
      if (tap.consumed) return;
    }
    if (chord === CODEX_COMPOSER_SHORTCUT && front === 'codex' && !this.#cards.codex) this.#composer.codex.focused = true;
    if (chord !== 'Enter' || !isClient(front)) return;
    const composer = this.#composer[front];
    const card = this.#cards[front];
    if (composer.focused && !(front === 'codex' && card)) {
      const text = composer.text;
      composer.submitted.push(text);
      if (composer.submitted.length > 50) composer.submitted.shift();
      composer.text = '';
      this.#record({ kind: 'submit', client: front, text });
      return;
    }
    // A keyboard Enter on a focused card stop presses it; the router must never send one there.
    if (card && card.established && card.focused !== null) this.pressStop(front, card, card.focused);
  }

  #endDictation(): void {
    if (!this.#dictating || SIM_DICTATION_CHORD.every(key => this.#held.has(key))) return;
    this.#dictating = false;
    const front = this.#foreground;
    const target = isClient(front) && this.composerFocused(front) ? front : null;
    if (target) this.#composer[target].text = `${this.#composer[target].text}${this.#composer[target].text ? ' ' : ''}${SIM_DICTATION_TEXT}`.slice(0, MAX_TEXT);
    this.#record({ kind: 'dictation', client: target, text: target ? SIM_DICTATION_TEXT : '' });
  }

  #closeCard(client: Client): void {
    if (!this.#cards[client]) return;
    this.#cards[client] = null;
    if (client === 'codex') this.#composer.codex.focused = true;
  }

  #record(entry: LogInput): void {
    this.log.push({ at: this.clock.now(), seq: ++this.#logSeq, ...entry } as DesktopLogEntry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.#changed();
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* a page listener never breaks the desktop */ }
    }
  }
}

/** The router's view of a simulated desktop: OS adapter interface version 5, branded `simulated`. */
export interface SimulatedOsAdapter extends OsAdapter {
  readonly simulated: true;
  readonly desktop: SimulatedDesktop;
  warmUp(): Promise<{ codex: string | null; claude: string | null }>;
  releaseAllSync(): void;
}

export function createSimulatedOsAdapter(desktop: SimulatedDesktop): SimulatedOsAdapter {
  const enter = (name: string) => desktop.call(name);
  return {
    version: OS_ADAPTER_VERSION,
    platform: process.platform,
    simulated: true,
    desktop,
    async warmUp() {
      enter('warmUp');
      const versions = desktop.observeVersions();
      return { codex: versions.codex.status === 'known' ? versions.codex.value : null, claude: versions.claude.status === 'known' ? versions.claude.value : null };
    },
    async clientVersions() { enter('clientVersions'); return desktop.observeVersions(); },
    async foregroundWindow() { enter('foregroundWindow'); return desktop.observeForeground(); },
    async openUri(uri) { enter('openUri'); desktop.openLink(uri); },
    async sendKeys(request) { enter('sendKeys'); desktop.keys(request); },
    sendVolumeKey: (key, presses) => new Promise<void>(resolve => {
      enter('sendVolumeKey');
      if (!['VolumeUp', 'VolumeDown', 'VolumeMute'].includes(key) || !Number.isInteger(presses) || presses < 1 || presses > MAX_VOLUME_PRESSES) {
        throw new Error('invalid-volume-request');
      }
      desktop.volume(key, presses);
      resolve();
    }),
    async releaseAll() { enter('releaseAll'); desktop.releaseKeys(); },
    releaseAllSync() { enter('releaseAllSync'); desktop.releaseKeys(); },
    async scrollClient(client, notches) { enter('scrollClient'); return known(desktop.scroll(client, notches)); },
    async codexSelectedThread(threadId, fallbackTitle) {
      enter('codexSelectedThread');
      const title = desktop.codexThread(threadId)?.title ?? fallbackTitle;
      if (!title) return unknown('codex-title-missing');
      const open = desktop.codexThreads().filter(t => !t.archived);
      if (open.some(t => t.id !== threadId && t.title === title)) return unknown('codex-name-not-unique');
      if (!desktop.clientInFront('codex')) return unknown('codex-not-foreground');
      const selected = desktop.selected('codex');
      const selectedTitle = selected === null ? undefined : desktop.codexThread(selected)?.title;
      return known({ matches: selectedTitle === title, sameTitleRows: open.filter(t => t.title === title).length });
    },
    async composerFocused(client) { enter('composerFocused'); return known(desktop.composerFocused(client)); },
    async approvalVisible(client) { enter('approvalVisible'); return desktop.approval(client); },
    async cardButtons(client) {
      enter('cardButtons');
      const card = desktop.card(client);
      if (card.status !== 'known') return card;
      return known(card.value ? { id: card.value.id, count: card.value.stops.length, focused: card.value.focused } satisfies CardButtons : null);
    },
    async focusCardButton(client, cardId, index, count) {
      enter('focusCardButton');
      const card = desktop.card(client);
      if (card.status !== 'known') return card;
      if (!card.value) return unknown('card-absent');
      if (card.value.id !== cardId || card.value.stops.length !== count) return unknown('card-changed');
      if (!Number.isInteger(index) || index < 0 || index >= count) return unknown('card-index');
      desktop.focusStop(client, card.value, index);
      return known(card.value.focused);
    },
    async invokeCardButton(client, cardId, index, count) {
      enter('invokeCardButton');
      const card = desktop.card(client);
      if (card.status !== 'known') return card;
      if (!card.value) return unknown('card-absent');
      if (card.value.id !== cardId || card.value.stops.length !== count) return unknown('card-changed');
      if (card.value.focused !== index) return known(false);
      desktop.pressStop(client, card.value, index);
      return known(true);
    },
    tapInClient: (client, keys, presses) => new Promise(resolve => { enter('tapInClient'); resolve(known(desktop.clientTap(client, keys, presses))); }),
    pickerState: client => {
      enter('pickerState');
      if (!isClient(client) || !desktop.clientInFront(client)) return Promise.resolve(unknown(`${String(client)}-not-foreground`));
      return Promise.resolve(known(desktop.pickers.state(client)));
    },
    claudeSettings: localId => {
      enter('claudeSettings');
      return Promise.resolve(known(desktop.claudeRecords([localId]).length ? desktop.pickers.claudeSettings(localId) : null));
    },
    async codexArchived(threadId) { enter('codexArchived'); return known(desktop.codexThread(threadId)?.archived ?? false); },
    async claudeSessions(localIds) { enter('claudeSessions'); return known(desktop.claudeRecords(localIds)); },
    async close() { enter('close'); desktop.releaseKeys(); },
  };
}
