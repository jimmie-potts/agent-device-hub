import type { ClaudeSettings, Client, MenuKind, PickerItem, PickerMenu, PickerState, SettingControl } from '../os-adapter.js';

/**
 * Simulated model and effort controls of the two clients (#906), as the 2026-10-06 keystroke-free qualification on #906
 * recorded them. The simulated desktop and the router tests' fake adapter share this model, so both drive the same
 * behavior:
 *
 * - Claude: the `Model: <name>` button expands a menu of model options plus "More models", with keyboard focus on the
 *   menu itself (the real initial focus varies). `SetFocus` moves focus to an entry; `Select` on a focused option
 *   applies it and closes the menu; `Collapse` closes it unchanged. The `Effort: <level>` button, absent for Haiku,
 *   expands the `Effort` slider (`RangeValue` 0-5, step 1), where each set value applies at once.
 * - Codex: the picker button reads `<model> <level>` while collapsed and `Select effort` while expanded. Expanding opens
 *   the `Select effort` menu ("Select model", a fast mode check box, "Reset to default", "Power") with its announcement
 *   `<model> <level>, <n> of <count>.`. Invoking "Select model" opens the model list; `Select` on a focused option
 *   applies it and returns to the picker, which stays open. `Collapse` does not close the picker; one Escape into it
 *   does. Right and Left on a focused "Power" step the level, as do the owner's chords (`LeftControl`+`LeftAlt`+`Equal`
 *   or `Minus`) while Codex is in front.
 * - Keys that reach an open menu or slider act there: Enter on a focused option picks it, and Claude's
 *   `LeftControl`+`LeftAlt`+`Minus` splits a pane. These are the hazards the router must avoid.
 * - With `lag` set, the read after each change returns the state from before it, once, as a lagging UI Automation view
 *   would, so tests can show that no flow acts twice on a stale read.
 *
 * Model and level names are the qualified ones where the report lists them and synthetic otherwise.
 */

export const SIM_CLAUDE_MODELS: readonly string[] = Object.freeze(['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5']);
/** Six levels, as the qualified slider's range 0-5. */
export const SIM_CLAUDE_EFFORTS: readonly string[] = Object.freeze(['Low', 'Medium', 'High', 'Extra High', 'Higher', 'Max']);
/** Models without an effort setting: Claude shows no Effort button for them. */
export const SIM_CLAUDE_NO_EFFORT: readonly string[] = Object.freeze(['Haiku 4.5']);
/** Codex model options in list order, with each model's levels. "Default" resolves to `CODEX_DEFAULT_MODEL`. */
export const SIM_CODEX_MODELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'GPT-6 Astra': Object.freeze(['Light', 'Standard', 'Extended', 'High', 'Extra High', 'Max']),
  'GPT-6 Luna': Object.freeze(['Light', 'Standard', 'Extended', 'High', 'Extra High']),
  'GPT-5.5': Object.freeze(['Light', 'Standard', 'Extended', 'High']),
});
export const SIM_CODEX_OPTIONS: readonly string[] = Object.freeze(['Default', ...Object.keys(SIM_CODEX_MODELS)]);
const CODEX_DEFAULT_MODEL = 'GPT-6 Luna';
const CODEX_MAIN = Object.freeze(['Select model', 'Enable fast mode', 'Reset to default', 'Power']);
const POWER = CODEX_MAIN.indexOf('Power');

export interface PickerSeed {
  claude?: { model?: string; effort?: string };
  codex?: { model?: string; level?: string };
}

type ClaudeSurface = null | { kind: 'model-menu'; focused: number | null } | { kind: 'effort-slider' };
type CodexSurface = null | { kind: 'main'; focused: number | null } | { kind: 'list'; focused: number | null };

/** One picker change, for the desktop log; labels are model and level names only. */
export interface PickerEvent { action: string; label?: string; position?: number; count?: number }

/** What a key or UI Automation action did: its answer, the composer's focus when it changed, and the changes. */
export interface PickerResult<T> {
  value: T;
  composerFocused?: boolean;
  events: PickerEvent[];
}

/** A key tap's result: whether an open menu or slider took the keys, so they reach no composer or card. */
export type PickerTap = PickerResult<boolean>;

/** A refused UI Automation action: the reason the adapter reports as unknown. */
export class PickerRefusal extends Error {}

export class SimPickers {
  /** When true, the read after each change returns the state from before it, once (a lagging UI Automation view). */
  lag = false;
  /** Claude keeps a model and effort per session; the key is the session Claude shows ('' for none). */
  readonly #claude = new Map<string, { model: string; effort: number }>();
  readonly #session: () => string;
  #claudeDefault: { model: string; effort: number } = { model: 'Sonnet 5.5', effort: 0 };
  #claudeSurface: ClaudeSurface = null;
  #codex = { option: 'GPT-6 Luna', level: 0, fast: false };
  #codexSurface: CodexSurface = null;
  readonly #stale: Partial<Record<Client, PickerState>> = {};

  constructor(claudeSession: () => string = () => '') { this.#session = claudeSession; }

  /** Sets the starting model and levels; unknown names are ignored. */
  seed(seed: PickerSeed): void {
    const claude = seed.claude ?? {};
    const model = claude.model && SIM_CLAUDE_MODELS.includes(claude.model) ? claude.model : this.#claudeDefault.model;
    const effort = claude.effort && SIM_CLAUDE_EFFORTS.includes(claude.effort) ? SIM_CLAUDE_EFFORTS.indexOf(claude.effort) : this.#claudeDefault.effort;
    this.#claudeDefault = { model, effort };
    this.#claude.clear();
    const codex = seed.codex ?? {};
    if (codex.model && SIM_CODEX_OPTIONS.includes(codex.model)) this.#codex.option = codex.model;
    const levels = this.#codexLevels();
    if (codex.level && levels.includes(codex.level)) this.#codex.level = levels.indexOf(codex.level);
  }

  /** Whether a menu or slider is open in the client. */
  open(client: Client): boolean { return client === 'claude' ? this.#claudeSurface !== null : this.#codexSurface !== null; }

  /** Closes whatever is open, as a mouse click elsewhere does. */
  dismiss(client: Client): void {
    this.#change(client, () => {
      if (client === 'claude') this.#claudeSurface = null;
      else this.#codexSurface = null;
    });
  }

  /**
   * A Claude session's values as its session record stores them (`claude-<model>` and the level, lowercase), by default
   * the session Claude shows.
   */
  claudeSettings(session: string = this.#session()): ClaudeSettings {
    const { model, effort } = this.#claudeValues(session);
    return { model: `claude-${model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, effort: SIM_CLAUDE_NO_EFFORT.includes(model) ? null : SIM_CLAUDE_EFFORTS[effort].toLowerCase() };
  }

  /** What the client's window shows, for the operator and the page: the model, the level, what is open and its focused entry. */
  describe(client: Client): { model: string; effort: string | null; open: string | null; focus: string | null } {
    const state = this.#read(client);
    const focus = state.menu && state.menu.focused !== null ? state.menu.items[state.menu.focused].label : null;
    if (client === 'claude') {
      const { model, effort } = this.#claudeNow();
      return { model, effort: SIM_CLAUDE_NO_EFFORT.includes(model) ? null : SIM_CLAUDE_EFFORTS[effort], open: this.#claudeSurface?.kind ?? null, focus };
    }
    return { model: this.#codex.option, effort: this.#codexLevels()[this.#codex.level], open: this.#codexSurface ? `picker-${this.#codexSurface.kind}` : null, focus };
  }

  /** The `pickerState` observation of the client's window; with `lag`, the state from before the last change, once. */
  state(client: Client): PickerState {
    const stale = this.#stale[client];
    if (stale) {
      delete this.#stale[client];
      return stale;
    }
    return this.#read(client);
  }

  // Keys

  /** One tap of `chord` (key names joined with `+`) in the client in front. */
  tap(client: Client, chord: string, context: { composerFocused: boolean; card: boolean }): PickerTap {
    return this.#change(client, () => client === 'claude' ? this.#claudeTap(chord) : this.#codexTap(chord, context));
  }

  // UI Automation actions. A refusal throws `PickerRefusal`.

  expand(client: Client, control: SettingControl): PickerResult<boolean> {
    return this.#change(client, () => {
      if (control === 'codex-picker') {
        if (client !== 'codex') throw new PickerRefusal('setting-missing');
        if (this.#codexSurface) throw new PickerRefusal('setting-not-collapsed');
        this.#codexSurface = { kind: 'main', focused: null };
        return { value: true, composerFocused: false, events: [{ action: 'open-picker', label: this.#codexModel() }] };
      }
      if (client !== 'claude') throw new PickerRefusal('setting-missing');
      if (this.#claudeSurface) throw new PickerRefusal('setting-not-collapsed');
      const values = this.#claudeNow();
      if (control === 'claude-model') {
        this.#claudeSurface = { kind: 'model-menu', focused: null };
        return { value: true, composerFocused: false, events: [{ action: 'open-model-menu', label: values.model }] };
      }
      if (SIM_CLAUDE_NO_EFFORT.includes(values.model)) throw new PickerRefusal('setting-missing');
      this.#claudeSurface = { kind: 'effort-slider' };
      return { value: true, composerFocused: false, events: [{ action: 'open-effort-slider', label: SIM_CLAUDE_EFFORTS[values.effort] }] };
    });
  }

  /** Claude only: Codex's picker stays expanded on `Collapse`, so the adapter refuses it. */
  collapse(client: Client, control: SettingControl): PickerResult<boolean> {
    return this.#change(client, () => {
      if (client !== 'claude' || control === 'codex-picker') throw new PickerRefusal('collapse-unsupported');
      const want = control === 'claude-model' ? 'model-menu' : 'effort-slider';
      if (this.#claudeSurface?.kind !== want) throw new PickerRefusal('setting-not-expanded');
      this.#claudeSurface = null;
      // Focus stays on the button: the composer does not get it back by itself.
      return { value: true, events: [{ action: control === 'claude-model' ? 'close-model-menu' : 'close-effort-slider' }] };
    });
  }

  invokeSelectModel(client: Client): PickerResult<boolean> {
    return this.#change(client, () => {
      if (client !== 'codex' || this.#codexSurface?.kind !== 'main') throw new PickerRefusal('menu-absent');
      this.#codexSurface = { kind: 'list', focused: null };
      return { value: true, events: [{ action: 'open-model-list' }] };
    });
  }

  focusEntry(client: Client, kind: MenuKind, index: number, count: number): PickerResult<number | null> {
    return this.#change(client, () => {
      const surface = this.#menuSurface(client, kind, count);
      if (!Number.isInteger(index) || index < 0 || index >= count) throw new PickerRefusal('invalid-menu-index');
      surface.focused = index;
      return { value: index, events: [{ action: 'focus', position: index + 1, count }] };
    });
  }

  selectOption(client: Client, kind: MenuKind, index: number, count: number): PickerResult<boolean> {
    return this.#change(client, () => {
      const surface = this.#menuSurface(client, kind, count);
      const menu = this.#read(client).menu!;
      if (menu.items[index]?.kind !== 'option') throw new PickerRefusal('not-an-option');
      if (surface.focused !== index) return { value: false, events: [] };
      if (client === 'claude') {
        this.#claudeNow().model = SIM_CLAUDE_MODELS[index];
        this.#claudeSurface = null;
        return { value: true, events: [{ action: 'pick-model', label: SIM_CLAUDE_MODELS[index] }] };
      }
      this.#codex.option = SIM_CODEX_OPTIONS[index];
      // The level keeps its place, clamped to the new model's levels, as the qualification saw Extended stay Extended.
      this.#codex.level = Math.min(this.#codex.level, this.#codexLevels().length - 1);
      this.#codexSurface = { kind: 'main', focused: null };
      return { value: true, events: [{ action: 'pick-model', label: this.#codex.option }] };
    });
  }

  setSlider(client: Client, from: number, to: number): PickerResult<number> {
    return this.#change(client, () => {
      if (client !== 'claude' || this.#claudeSurface?.kind !== 'effort-slider') throw new PickerRefusal('slider-absent');
      const values = this.#claudeNow();
      if (values.effort !== from || Math.abs(to - from) !== 1 || to < 0 || to >= SIM_CLAUDE_EFFORTS.length) throw new PickerRefusal('slider-changed');
      values.effort = to;
      return { value: to, events: [{ action: 'effort', label: SIM_CLAUDE_EFFORTS[to], position: to + 1, count: SIM_CLAUDE_EFFORTS.length }] };
    });
  }

  // State

  #read(client: Client): PickerState {
    if (client === 'claude') {
      const { model, effort } = this.#claudeNow();
      const surface = this.#claudeSurface;
      const items: PickerItem[] = [...SIM_CLAUDE_MODELS.map(label => ({ kind: 'option' as const, label, selected: label === model })),
        { kind: 'action', label: 'More models', selected: false }];
      const supported = !SIM_CLAUDE_NO_EFFORT.includes(model);
      return {
        menu: surface?.kind === 'model-menu' ? { kind: 'claude-model', label: `Model: ${model}`, items, focused: surface.focused, hasFocus: true } : null,
        slider: surface?.kind === 'effort-slider' ? { value: effort, min: 0, max: SIM_CLAUDE_EFFORTS.length - 1, step: 1 } : null,
        model: { label: model, expanded: surface?.kind === 'model-menu' },
        effort: supported ? { label: SIM_CLAUDE_EFFORTS[effort], expanded: surface?.kind === 'effort-slider' } : null,
        announcement: null,
      };
    }
    const surface = this.#codexSurface;
    const levels = this.#codexLevels();
    const title = `${this.#codexModel()} ${levels[this.#codex.level]}`;
    let menu: PickerMenu | null = null;
    if (surface?.kind === 'main') {
      menu = {
        kind: 'codex-picker', label: 'Select effort', focused: surface.focused, hasFocus: true,
        items: CODEX_MAIN.map(label => ({ kind: label === 'Enable fast mode' ? 'toggle' as const : 'action' as const, label, selected: label === 'Enable fast mode' && this.#codex.fast })),
      };
    } else if (surface?.kind === 'list') {
      menu = {
        kind: 'codex-models', label: title, focused: surface.focused, hasFocus: true,
        items: SIM_CODEX_OPTIONS.map(label => ({ kind: 'option' as const, label, selected: label === this.#codex.option })),
      };
    }
    return {
      menu, slider: null,
      model: { label: surface ? 'Select effort' : title, expanded: surface !== null },
      effort: null,
      announcement: surface ? { label: title, position: this.#codex.level + 1, count: levels.length } : null,
    };
  }

  /** Runs one change; with `lag`, the next read returns the state from before it. */
  #change<T>(client: Client, change: () => T): T {
    const before = this.lag ? this.#read(client) : undefined;
    const result = change();
    if (before && JSON.stringify(before) !== JSON.stringify(this.#read(client))) this.#stale[client] = before;
    return result;
  }

  /** The open surface behind a menu of `kind` with `count` entries, or a refusal. */
  #menuSurface(client: Client, kind: MenuKind, count: number): { focused: number | null } {
    const menu = this.#read(client).menu;
    if (!menu || menu.kind !== kind) throw new PickerRefusal('menu-absent');
    if (menu.items.length !== count) throw new PickerRefusal('menu-changed');
    return (client === 'claude' ? this.#claudeSurface : this.#codexSurface) as { focused: number | null };
  }

  #claudeNow(): { model: string; effort: number } { return this.#claudeValues(this.#session()); }

  #claudeValues(key: string): { model: string; effort: number } {
    let values = this.#claude.get(key);
    if (!values) this.#claude.set(key, values = { ...this.#claudeDefault });
    return values;
  }

  #claudeTap(chord: string): PickerTap {
    const surface = this.#claudeSurface;
    if (!surface) {
      return chord === 'LeftControl+LeftAlt+Minus' ? { value: true, events: [{ action: 'split-pane' }] } : { value: false, events: [] };
    }
    if (chord === 'Escape') {
      this.#claudeSurface = null;
      return { value: true, composerFocused: true, events: [{ action: surface.kind === 'model-menu' ? 'close-model-menu' : 'close-effort-slider' }] };
    }
    if (surface.kind === 'model-menu' && chord === 'Enter' && surface.focused !== null && surface.focused < SIM_CLAUDE_MODELS.length) {
      this.#claudeNow().model = SIM_CLAUDE_MODELS[surface.focused];
      this.#claudeSurface = null;
      return { value: true, composerFocused: true, events: [{ action: 'pick-model', label: this.#claudeNow().model }] };
    }
    // An open menu or slider has keyboard focus and takes every other key.
    return { value: true, events: [] };
  }

  #codexModel(): string { return this.#codex.option === 'Default' ? CODEX_DEFAULT_MODEL : this.#codex.option; }
  #codexLevels(): readonly string[] { return SIM_CODEX_MODELS[this.#codexModel()]; }

  #codexLevelStep(delta: number): PickerEvent[] {
    const levels = this.#codexLevels();
    const before = this.#codex.level;
    this.#codex.level = Math.max(0, Math.min(levels.length - 1, before + delta));
    return this.#codex.level === before ? [] : [{ action: 'effort', label: levels[this.#codex.level], position: this.#codex.level + 1, count: levels.length }];
  }

  #codexTap(chord: string, { card }: { composerFocused: boolean; card: boolean }): PickerTap {
    // The owner's effort chords are app-wide shortcuts while Codex is in front, picker open or not.
    if (chord === 'LeftControl+LeftAlt+Equal' || chord === 'LeftControl+LeftAlt+Minus') {
      return card ? { value: false, events: [] } : { value: true, events: this.#codexLevelStep(chord.endsWith('Equal') ? 1 : -1) };
    }
    const surface = this.#codexSurface;
    if (!surface) return { value: false, events: [] };
    if (surface.kind === 'main') {
      if (chord === 'Escape') { this.#codexSurface = null; return { value: true, composerFocused: true, events: [{ action: 'close-picker' }] }; }
      if ((chord === 'Right' || chord === 'Left') && surface.focused === POWER) return { value: true, events: this.#codexLevelStep(chord === 'Right' ? 1 : -1) };
      if (chord === 'Enter' && surface.focused === 0) { this.#codexSurface = { kind: 'list', focused: null }; return { value: true, events: [{ action: 'open-model-list' }] }; }
      return { value: true, events: [] };
    }
    if (chord === 'Escape') { this.#codexSurface = { kind: 'main', focused: null }; return { value: true, events: [{ action: 'close-model-list' }] }; }
    if (chord === 'Enter' && surface.focused !== null) {
      this.#codex.option = SIM_CODEX_OPTIONS[surface.focused];
      this.#codex.level = Math.min(this.#codex.level, this.#codexLevels().length - 1);
      this.#codexSurface = { kind: 'main', focused: null };
      return { value: true, events: [{ action: 'pick-model', label: this.#codex.option }] };
    }
    return { value: true, events: [] };
  }
}
