import type { ClaudeSettings, Client, PickerItem, PickerState } from '../os-adapter.js';

/**
 * Simulated model and effort controls of the two clients (#906), as the 2026-10-06 qualification on #906 recorded
 * them. The simulated desktop and the router tests' fake adapter share this model, so both drive the same behavior:
 *
 * - Claude: `LeftControl`+`LeftShift`+`I` with the composer focused and no card opens a `Model: <current>` menu of
 *   model options plus a "More models" entry, with focus on no entry; the first Down focuses the first entry, then
 *   Up and Down move one entry, Enter on an option applies it and closes the menu, and Escape closes it unchanged.
 *   `LeftControl`+`LeftShift`+`E` opens the `Effort` slider, unless the model has no effort setting (Haiku); Right and
 *   Left apply one level at once, and Escape closes it keeping the level. A closed menu or slider gives the composer
 *   focus back. `LeftControl`+`LeftAlt`+`Minus` splits the pane, the hazard behind Codex's effort chord.
 * - Codex: `LeftControl`+`LeftShift`+`M` with no card opens the `Select effort` menu with "Select model" focused, a fast
 *   mode check box, "Reset to default" and "Power", plus an announcement `<model> <level>, <n> of <count>.`. Enter on
 *   "Select model" opens the model list with the current option focused; Enter there applies the focused model and
 *   returns to the main menu, which stays open. Right and Left on "Power" step the level. Escape leaves the list, or
 *   closes the picker. The owner's effort chords (`LeftControl`+`LeftAlt`+`Equal` or `Minus`) step the level too.
 *
 * Arrow keys stop at the first and last entry and never wrap; whether the real clients wrap is not qualified. Model
 * and level names are the qualified ones where the report lists them and synthetic otherwise.
 */

export const SIM_CLAUDE_MODELS: readonly string[] = Object.freeze(['Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5']);
export const SIM_CLAUDE_EFFORTS: readonly string[] = Object.freeze(['Low', 'Medium', 'High', 'Max']);
/** Models without an effort setting: Claude shows no Effort button for them. */
export const SIM_CLAUDE_NO_EFFORT: readonly string[] = Object.freeze(['Haiku 4.5']);
/** Codex model options in list order, with each model's levels. "Default" resolves to the first named model. */
export const SIM_CODEX_MODELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'GPT-6 Astra': Object.freeze(['Light', 'Standard', 'Extended', 'Deep', 'Max', 'Ultra']),
  'GPT-6 Luna': Object.freeze(['Light', 'Standard', 'Extended', 'Deep', 'Max']),
  'GPT-5.5': Object.freeze(['Light', 'Standard', 'Extended', 'Deep']),
});
export const SIM_CODEX_OPTIONS: readonly string[] = Object.freeze(['Default', ...Object.keys(SIM_CODEX_MODELS)]);
const CODEX_DEFAULT_MODEL = 'GPT-6 Luna';
const CODEX_MAIN = Object.freeze(['Select model', 'Enable fast mode', 'Reset to default', 'Power']);

export interface PickerSeed {
  claude?: { model?: string; effort?: string };
  codex?: { model?: string; level?: string };
}

type ClaudeSurface = null | { kind: 'model-menu'; focused: number | null } | { kind: 'effort-slider' };
type CodexSurface = null | { kind: 'main'; focused: number } | { kind: 'list'; focused: number };

/** One picker change, for the desktop log; labels are model and level names only. */
export interface PickerEvent { action: string; label?: string; position?: number; count?: number }

export interface PickerTap {
  /** The keys acted on a picker (or were taken by an open one), so they reach no composer or card. */
  consumed: boolean;
  /** The composer's focus afterwards, when the picker changed it: false when one opened, true when one closed. */
  composerFocused?: boolean;
  events: PickerEvent[];
}

const NOT_CONSUMED: PickerTap = Object.freeze({ consumed: false, events: [] });

export class SimPickers {
  /** Claude keeps a model and effort per session; the key is the session Claude shows ('' for none). */
  readonly #claude = new Map<string, { model: string; effort: number }>();
  readonly #session: () => string;
  #claudeDefault: { model: string; effort: number } = { model: 'Sonnet 5.5', effort: 0 };
  #claudeSurface: ClaudeSurface = null;
  #codex = { option: 'GPT-6 Luna', level: 0, fast: false };
  #codexSurface: CodexSurface = null;

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
    if (client === 'claude') this.#claudeSurface = null;
    else this.#codexSurface = null;
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
    const state = this.state(client);
    const focus = state.menu && state.menu.focused !== null ? state.menu.items[state.menu.focused].label : null;
    if (client === 'claude') {
      const { model, effort } = this.#claudeNow();
      const surface = this.#claudeSurface;
      return { model, effort: SIM_CLAUDE_NO_EFFORT.includes(model) ? null : SIM_CLAUDE_EFFORTS[effort], open: surface ? surface.kind : null, focus };
    }
    return { model: this.#codex.option, effort: this.#codexLevels()[this.#codex.level], open: this.#codexSurface ? `picker-${this.#codexSurface.kind}` : null, focus };
  }

  /** The `pickerState` observation of the client's window. */
  state(client: Client): PickerState {
    if (client === 'claude') {
      const { model, effort } = this.#claudeNow();
      const surface = this.#claudeSurface;
      const items: PickerItem[] = [...SIM_CLAUDE_MODELS.map(label => ({ kind: 'option' as const, label, selected: label === model })),
        { kind: 'action', label: 'More models', selected: false }];
      return {
        menu: surface?.kind === 'model-menu' ? { label: `Model: ${model}`, items, focused: surface.focused } : null,
        slider: surface?.kind === 'effort-slider' ? 'Effort' : null,
        model,
        effort: SIM_CLAUDE_NO_EFFORT.includes(model) ? null : SIM_CLAUDE_EFFORTS[effort],
        announcement: null,
      };
    }
    const surface = this.#codexSurface;
    const levels = this.#codexLevels();
    const title = `${this.#codexModel()} ${levels[this.#codex.level]}`;
    let menu: PickerState['menu'] = null;
    if (surface?.kind === 'main') {
      menu = {
        label: 'Select effort', focused: surface.focused,
        items: CODEX_MAIN.map(label => ({ kind: label === 'Enable fast mode' ? 'toggle' as const : 'action' as const, label, selected: label === 'Enable fast mode' && this.#codex.fast })),
      };
    } else if (surface?.kind === 'list') {
      menu = { label: title, focused: surface.focused, items: SIM_CODEX_OPTIONS.map(label => ({ kind: 'option' as const, label, selected: label === this.#codex.option })) };
    }
    return { menu, slider: null, model: null, effort: null, announcement: surface ? { label: title, position: this.#codex.level + 1, count: levels.length } : null };
  }

  /** One tap of `chord` (key names joined with `+`) in the client in front. */
  tap(client: Client, chord: string, context: { composerFocused: boolean; card: boolean }): PickerTap {
    return client === 'claude' ? this.#claudeTap(chord, context) : this.#codexTap(chord, context);
  }

  #claudeNow(): { model: string; effort: number } { return this.#claudeValues(this.#session()); }

  #claudeValues(key: string): { model: string; effort: number } {
    let values = this.#claude.get(key);
    if (!values) this.#claude.set(key, values = { ...this.#claudeDefault });
    return values;
  }

  #claudeTap(chord: string, { composerFocused, card }: { composerFocused: boolean; card: boolean }): PickerTap {
    const values = this.#claudeNow();
    const surface = this.#claudeSurface;
    const close = (action: string): PickerTap => { this.#claudeSurface = null; return { consumed: true, composerFocused: true, events: [{ action }] }; };
    if (!surface) {
      if (chord === 'LeftControl+LeftAlt+Minus') return { consumed: true, events: [{ action: 'split-pane' }] };
      if (!composerFocused || card) return NOT_CONSUMED;
      if (chord === 'LeftControl+LeftShift+I') {
        this.#claudeSurface = { kind: 'model-menu', focused: null };
        return { consumed: true, composerFocused: false, events: [{ action: 'open-model-menu', label: values.model }] };
      }
      if (chord === 'LeftControl+LeftShift+E' && !SIM_CLAUDE_NO_EFFORT.includes(values.model)) {
        this.#claudeSurface = { kind: 'effort-slider' };
        return { consumed: true, composerFocused: false, events: [{ action: 'open-effort-slider', label: SIM_CLAUDE_EFFORTS[values.effort] }] };
      }
      return NOT_CONSUMED;
    }
    if (surface.kind === 'model-menu') {
      const count = SIM_CLAUDE_MODELS.length + 1;
      if (chord === 'Escape') return close('close-model-menu');
      if (chord === 'Down' || chord === 'Up') {
        const from = surface.focused;
        surface.focused = from === null ? (chord === 'Down' ? 0 : count - 1) : Math.max(0, Math.min(count - 1, from + (chord === 'Down' ? 1 : -1)));
        return { consumed: true, events: [{ action: 'focus', position: surface.focused + 1, count }] };
      }
      if (chord === 'Enter' && surface.focused !== null && surface.focused < SIM_CLAUDE_MODELS.length) {
        values.model = SIM_CLAUDE_MODELS[surface.focused];
        this.#claudeSurface = null;
        return { consumed: true, composerFocused: true, events: [{ action: 'pick-model', label: values.model }] };
      }
      return { consumed: true, events: [] };
    }
    if (chord === 'Escape' || chord === 'Enter') return close('close-effort-slider');
    if (chord === 'Right' || chord === 'Left') {
      const before = values.effort;
      values.effort = Math.max(0, Math.min(SIM_CLAUDE_EFFORTS.length - 1, before + (chord === 'Right' ? 1 : -1)));
      return { consumed: true, events: values.effort === before ? [] : [{ action: 'effort', label: SIM_CLAUDE_EFFORTS[values.effort], position: values.effort + 1, count: SIM_CLAUDE_EFFORTS.length }] };
    }
    return { consumed: true, events: [] };
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
    // The owner's effort chords are app-wide shortcuts: they act with the picker open or closed.
    if (chord === 'LeftControl+LeftAlt+Equal' || chord === 'LeftControl+LeftAlt+Minus') {
      return { consumed: true, events: this.#codexLevelStep(chord.endsWith('Equal') ? 1 : -1) };
    }
    const surface = this.#codexSurface;
    if (!surface) {
      if (chord !== 'LeftControl+LeftShift+M' || card) return NOT_CONSUMED;
      this.#codexSurface = { kind: 'main', focused: 0 };
      return { consumed: true, composerFocused: false, events: [{ action: 'open-picker', label: this.#codexModel() }] };
    }
    if (surface.kind === 'main') {
      if (chord === 'Escape') { this.#codexSurface = null; return { consumed: true, composerFocused: true, events: [{ action: 'close-picker' }] }; }
      if (chord === 'Down' || chord === 'Up') {
        surface.focused = Math.max(0, Math.min(CODEX_MAIN.length - 1, surface.focused + (chord === 'Down' ? 1 : -1)));
        return { consumed: true, events: [{ action: 'focus', position: surface.focused + 1, count: CODEX_MAIN.length }] };
      }
      const entry = CODEX_MAIN[surface.focused];
      if (chord === 'Enter' && entry === 'Select model') {
        this.#codexSurface = { kind: 'list', focused: SIM_CODEX_OPTIONS.indexOf(this.#codex.option) };
        return { consumed: true, events: [{ action: 'open-model-list' }] };
      }
      if (chord === 'Enter' && entry === 'Enable fast mode') { this.#codex.fast = !this.#codex.fast; return { consumed: true, events: [{ action: 'fast-mode' }] }; }
      if (chord === 'Enter' && entry === 'Reset to default') { this.#codex.level = 1; return { consumed: true, events: [{ action: 'reset' }] }; }
      if ((chord === 'Right' || chord === 'Left') && entry === 'Power') return { consumed: true, events: this.#codexLevelStep(chord === 'Right' ? 1 : -1) };
      return { consumed: true, events: [] };
    }
    if (chord === 'Escape') { this.#codexSurface = { kind: 'main', focused: 0 }; return { consumed: true, events: [{ action: 'close-model-list' }] }; }
    if (chord === 'Down' || chord === 'Up') {
      surface.focused = Math.max(0, Math.min(SIM_CODEX_OPTIONS.length - 1, surface.focused + (chord === 'Down' ? 1 : -1)));
      return { consumed: true, events: [{ action: 'focus', position: surface.focused + 1, count: SIM_CODEX_OPTIONS.length }] };
    }
    if (chord === 'Enter') {
      this.#codex.option = SIM_CODEX_OPTIONS[surface.focused];
      // The level keeps its place, clamped to the new model's levels, as the qualification saw Extended stay Extended.
      this.#codex.level = Math.min(this.#codex.level, this.#codexLevels().length - 1);
      this.#codexSurface = { kind: 'main', focused: 0 };
      return { consumed: true, events: [{ action: 'pick-model', label: this.#codex.option }] };
    }
    return { consumed: true, events: [] };
  }
}
